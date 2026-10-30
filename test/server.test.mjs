import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { WebSocket } from 'ws';
import { createApp, probeVNC } from '../server.mjs';

async function fixture(t, sessionMs = 1000) {
  const mock = net.createServer(socket => { socket.on('error', () => {}); socket.write('RFB 003.008\n'); socket.on('data', data => socket.write(data)); });
  mock.listen(0, '127.0.0.1'); await once(mock, 'listening');
  const app = createApp({ port: 18796, publicURL: 'https://mac.example.ts.net:9447', allowedLogin: 'owner@example.com', vncPort: mock.address().port, sessionMs });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  t.after(async () => { await app.close(); await new Promise(resolve => mock.close(resolve)); });
  return { port: app.server.address().port, vncPort: mock.address().port };
}
function request(port, pathname = '/', headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: pathname, method, headers: { Host: 'localhost:18796', ...headers } }, res => {
      let body = ''; res.on('data', data => body += data); res.on('end', () => resolve({ code: res.statusCode, body, headers: res.headers }));
    }); req.on('error', reject); req.end();
  });
}
function connect(port, headers = {}) {
  return new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Host: 'localhost:18796', Origin: 'http://localhost:18796', ...headers } });
}
async function refused(ws) {
  const [error] = await once(ws, 'error'); assert.match(error.message, /Unexpected server response/); return error.message;
}

test('localhost UI serves with no caching and no framing; private files stay inaccessible', async t => {
  const { port } = await fixture(t);
  const index = await request(port); assert.equal(index.code, 200); assert.match(index.body, /AppleSeed/);
  assert.equal(index.headers['cache-control'], 'no-store'); assert.match(index.headers['content-security-policy'], /frame-ancestors 'none'/);
  for (const url of ['/package.json', '/server.mjs', '/api/mobile', '/mobile-mode.js', '/novnc/%2e%2e/server.js', '/novnc/core/rfb.js%00', '/novnc/..%5cserver.js']) assert.equal((await request(port, url)).code, 404);
  assert.equal((await request(port, '/novnc/core/rfb.js')).code, 200);
  assert.equal((await request(port, '/api/status', {}, 'POST')).code, 405);
  assert.equal((await request(port, '/api/mobile', {}, 'POST')).code, 404);
  assert.doesNotMatch(index.body, /id="(?:mode-mobile|privacy-toggle|tab-mobile)"/);
  assert.equal((await request(port, 'http://[invalid')).code, 400);
});

test('tailnet requests require both the configured host and owner identity', async t => {
  const { port } = await fixture(t);
  const Host = 'mac.example.ts.net:9447';
  assert.equal((await request(port, '/', { Host })).code, 403);
  assert.equal((await request(port, '/', { Host, 'Tailscale-User-Login': 'other@example.com' })).code, 403);
  assert.equal((await request(port, '/', { Host: 'evil.example', 'Tailscale-User-Login': 'owner@example.com' })).code, 403);
  assert.equal((await request(port, '/', { Host, 'Tailscale-User-Login': 'owner@example.com' })).code, 200);
});

test('APK downloads use an attachment and retain the owner access boundary', async t => {
  const { port } = await fixture(t);
  const Host = 'mac.example.ts.net:9447';
  assert.equal((await request(port, '/AppleSeed.apk', { Host })).code, 403);
  assert.equal((await request(port, '/AppleSeed.apk', { Host, 'Tailscale-User-Login': 'other@example.com' })).code, 403);
  const response = await request(port, '/AppleSeed.apk', { Host, 'Tailscale-User-Login': 'owner@example.com' });
  if (existsSync(new URL('../public/AppleSeed.apk', import.meta.url))) {
    assert.equal(response.code, 200);
    assert.equal(response.headers['content-type'], 'application/vnd.android.package-archive');
    assert.match(response.headers['content-disposition'], /attachment; filename="AppleSeed-2.1.0.apk"/);
  } else assert.equal(response.code, 404);
});

test('websocket rejects cross-site origins, missing origin, and wrong tailnet identity', async t => {
  const { port } = await fixture(t);
  assert.match(await refused(connect(port, { Origin: 'https://evil.example' })), /403/);
  assert.match(await refused(connect(port, { Origin: '' })), /403/);
  assert.match(await refused(connect(port, { Host: 'mac.example.ts.net:9447', Origin: 'https://mac.example.ts.net:9447' })), /403/);
});

test('bridge passes binary protocol data, enforces one session, and releases it on disconnect', async t => {
  const { port } = await fixture(t);
  const ws = connect(port);
  const greeting = once(ws, 'message'); await once(ws, 'open');
  assert.equal((await greeting)[0].toString(), 'RFB 003.008\n');
  const echoed = once(ws, 'message'); ws.send(Buffer.from([0, 1, 2, 255]));
  assert.deepEqual((await echoed)[0], Buffer.from([0, 1, 2, 255]));
  assert.match(await refused(connect(port)), /409/);
  const closed = once(ws, 'close'); ws.close(); await closed;
  const replacement = connect(port); await once(replacement, 'open'); replacement.close(); await once(replacement, 'close');
});

test('sessions expire, text protocol messages are rejected, and health probes validate RFB', async t => {
  const { port, vncPort } = await fixture(t, 120);
  assert.equal(await probeVNC(vncPort), true);
  const status = JSON.parse((await request(port, '/api/status')).body); assert.equal(status.sharing, true);
  assert.equal(status.publicURL, 'https://mac.example.ts.net:9447');
  const ws = connect(port); await once(ws, 'open'); const [code, reason] = await once(ws, 'close');
  assert.equal(code, 1000); assert.equal(reason.toString(), 'Session expired');
  const textWS = connect(port); await once(textWS, 'open'); const closed = once(textWS, 'close'); textWS.send('not RFB');
  assert.equal((await closed)[0], 1003);
});

test('unavailable Screen Sharing closes cleanly without exposing TCP errors', async t => {
  const ephemeral = net.createServer(); ephemeral.listen(0, '127.0.0.1'); await once(ephemeral, 'listening');
  const vncPort = ephemeral.address().port; await new Promise(resolve => ephemeral.close(resolve));
  const app = createApp({ port: 18796, vncPort }); app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening'); t.after(app.close);
  assert.equal(await probeVNC(vncPort), false);
  const ws = connect(app.server.address().port); await once(ws, 'open');
  const [code, reason] = await once(ws, 'close'); assert.equal(code, 1011); assert.equal(reason.toString(), 'Screen Sharing unavailable');
});

function timerRequest(port, session, seconds, origin = 'http://localhost:18796') {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: '/api/session/timer', method: 'POST', headers: { Host: 'localhost:18796', Origin: origin, 'Content-Type': 'application/json' } }, res => {
      let body = ''; res.on('data', data => body += data); res.on('end', () => resolve({ code: res.statusCode, body }));
    }); req.on('error', reject); req.end(JSON.stringify({ session, seconds }));
  });
}
function timedConnect(port, session, seconds) {
  return new WebSocket(`ws://127.0.0.1:${port}/ws?session=${session}&seconds=${seconds}`, { headers: { Host: 'localhost:18796', Origin: 'http://localhost:18796' } });
}

test('optional timers stay open, can be changed, and require the session token and same origin', async t => {
  const { port } = await fixture(t, 80);
  const id = 'f3db2c93-bc18-4d84-b38c-77e955dbda42';
  const ws = timedConnect(port, id, 0); await once(ws, 'open');
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(ws.readyState, WebSocket.OPEN, 'No timer overrides the default expiry');
  assert.equal((await timerRequest(port, id, 1, 'https://evil.example')).code, 403);
  assert.equal((await timerRequest(port, 'wrong-session', 1)).code, 409);
  for (const seconds of [-1, 86401, 1.5, '600', null]) assert.equal((await timerRequest(port, id, seconds)).code, 400);
  const response = await timerRequest(port, id, 1);
  assert.equal(response.code, 200); assert.ok(JSON.parse(response.body).expiresAt > Date.now());
  const removed = await timerRequest(port, id, 0);
  assert.equal(removed.code, 200); assert.equal(JSON.parse(removed.body).expiresAt, null);
  await new Promise(resolve => setTimeout(resolve, 1100));
  assert.equal(ws.readyState, WebSocket.OPEN, 'Turning off a running timer cancels expiry');
  const closed = once(ws, 'close');
  assert.equal((await timerRequest(port, id, 1)).code, 200);
  const [code, reason] = await closed;
  assert.equal(code, 1000); assert.equal(reason.toString(), 'Session expired');
  assert.equal((await timerRequest(port, id, 0)).code, 409);
});

test('WebSocket timer validates duration and enforces the selected expiry', async t => {
  const { port } = await fixture(t, 80);
  const id = '76fca9ac-799e-4a53-a74c-57506e357f8d';
  for (const seconds of ['-1', 'NaN', '1.5', '86401', '']) assert.match(await refused(timedConnect(port, id, seconds)), /400/);
  const ws = timedConnect(port, id, 1); await once(ws, 'open');
  const closed = once(ws, 'close');
  await new Promise(resolve => setTimeout(resolve, 150)); assert.equal(ws.readyState, WebSocket.OPEN);
  const [code, reason] = await closed; assert.equal(code, 1000); assert.equal(reason.toString(), 'Session expired');
});

test('a slow phone survives a large login-screen burst and receives every byte in order', { timeout: 12000 }, async t => {
  const sockets = new Set(), total = 24 * 1024 * 1024;
  let ended; const sessionEnded = new Promise(resolve => ended = resolve);
  const mock = net.createServer(socket => {
    sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket));
    socket.once('data', () => {
      const payload = Buffer.alloc(total);
      for (let i = 0; i < total; i++) payload[i] = i % 251;
      socket.write(payload);
    });
  });
  mock.listen(0, '127.0.0.1'); await once(mock, 'listening');
  const app = createApp({ port: 18796, vncPort: mock.address().port, sessionMs: 0, onSessionClose: ended });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  const ws = connect(app.server.address().port);
  t.after(async () => { ws.terminate(); await app.close(); for (const socket of sockets) socket.destroy(); await new Promise(resolve => mock.close(resolve)); });
  await once(ws, 'open');
  let received = 0;
  const complete = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Only received ${received}/${total} bytes`)), 8000);
    ws.on('message', data => {
      for (let i = 0; i < data.length; i++) if (data[i] !== (received + i) % 251) { clearTimeout(timer); reject(new Error('Stream corrupted')); return; }
      received += data.length;
      if (received === total) { clearTimeout(timer); resolve(); }
    });
    ws.on('close', (code, reason) => { clearTimeout(timer); reject(new Error(`Disconnected during initial screen: ${code} ${reason}`)); });
    ws.on('error', error => { clearTimeout(timer); reject(error); });
  });
  ws.pause(); ws.send(Buffer.from([1]));
  const resume = setTimeout(() => ws.resume(), 350); t.after(() => clearTimeout(resume));
  await complete;
  assert.equal(ws.readyState, WebSocket.OPEN);
  assert.equal(received, total);
  ws.close(); const stats = await sessionEnded;
  assert.ok(stats.flowPauses > 0, 'The test exercised flow control');
  assert.ok(stats.peakQueuedBytes < 1200 * 1024, 'Queue stays bounded while the phone pauses');
});
