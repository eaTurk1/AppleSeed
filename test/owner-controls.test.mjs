import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createApp } from '../server.mjs';

async function fixture(t, unlockCommand, options = {}) {
  const sockets = new Set();
  const vnc = net.createServer(socket => { sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket)); socket.write('RFB 003.008\n'); });
  vnc.listen(0, '127.0.0.1'); await once(vnc, 'listening');
  const app = createApp({ port: 18796, vncPort: vnc.address().port, publicURL: 'https://mac.example.ts.net', allowedLogin: 'owner@example.com', portalURL: 'https://portal.example/appleseed/remote', sessionMs: 0, unlockCommand, ...options });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  t.after(async () => { await app.close(); for (const socket of sockets) socket.destroy(); await new Promise(resolve => vnc.close(resolve)); });
  const port = app.server.address().port;
  const post = (route, value, headers = {}) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: route, method: 'POST', headers: { Host: 'localhost:18796', Origin: 'http://localhost:18796', 'Content-Type': 'application/json', ...headers } }, res => {
      let body = ''; res.on('data', chunk => body += chunk); res.on('end', () => resolve({ status: res.statusCode, body }));
    }); req.on('error', reject); req.end(JSON.stringify(value));
  });
  const session = 'c831889c-49bf-4b8f-bde8-9e6a46309be8';
  const connect = async () => { const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?session=${session}&seconds=0`, { headers: { Host: 'localhost:18796', Origin: 'http://localhost:18796' } }); await once(ws, 'open'); return ws; };
  return { app, post, connect, session };
}

test('unlock requires the private owner origin and active session before contacting the helper', async t => {
  const commands = [];
  const f = await fixture(t, async command => { commands.push({ ...command }); return { ok: true, state: 'unlocked', ready: false }; });
  const value = { op: 'status', session: f.session };
  assert.equal((await f.post('/api/unlock', value)).status, 409);
  const ws = await f.connect();
  assert.equal((await f.post('/api/unlock', value, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await f.post('/api/unlock', value, { Host: 'mac.example.ts.net', Origin: 'https://mac.example.ts.net', 'Tailscale-User-Login': 'other@example.com' })).status, 403);
  assert.equal((await f.post('/api/unlock', { ...value, session: 'wrong' })).status, 409);
  assert.equal((await f.post('/api/unlock', { ...value, op: 'submit', password: 'test-only' })).status, 400);
  assert.deepEqual(commands, []);
  const response = await f.post('/api/unlock', { ...value, password: 'not-forwarded', arbitrary: true });
  assert.equal(response.status, 200);
  assert.deepEqual(commands, [{ op: 'unlock-status' }]);
  ws.close(); await once(ws, 'close');
});

test('an unavailable native helper fails closed without echoing the submitted password', async t => {
  const f = await fixture(t, async () => { throw new Error('sensitive helper detail'); });
  const ws = await f.connect();
  const response = await f.post('/api/unlock', { op: 'submit', session: f.session, cycle: f.session, nonce: f.session, password: 'test-only-secret' });
  assert.equal(response.status, 503); assert.equal(JSON.parse(response.body).ready, false);
  assert.doesNotMatch(response.body, /test-only-secret|sensitive helper detail/);
  ws.close(); await once(ws, 'close');
});

test('portal owner controls reject cross-site and primitive bodies without crashing the service', async t => {
  const f = await fixture(t, async () => ({ ok: true }));
  assert.equal((await f.post('/api/portal', { op: 'disable' }, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await f.post('/api/portal', { op: 'disable' }, { Host: 'portal.example', Origin: 'https://portal.example', 'Tailscale-User-Login': 'owner@example.com' })).status, 403);
  for (const value of [null, true, 1, 'invalid', []]) assert.equal((await f.post('/api/portal', value)).status, 400);
  const response = await f.post('/api/portal', { op: 'disable' });
  assert.equal(response.status, 200); assert.equal(JSON.parse(response.body).enabled, false);
});

test('Apps requires private owner origin, active session and opaque references only', async t => {
 const calls=[];
 const f=await fixture(t,async()=>({ok:true}),{appsCommand:async value=>{calls.push(value);return {ok:true,apps:[]};}});
 const post=(value,headers)=>f.post('/api/apps',value,headers);
 assert.equal((await post({op:'list'})).status,409);
 const ws=await f.connect();
 assert.equal((await post({op:'list',session:f.session},{Origin:'https://evil.example'})).status,403);
 assert.equal((await post({op:'list',session:f.session},{Host:'mac.example.ts.net',Origin:'https://mac.example.ts.net','Tailscale-User-Login':'stranger@example.com'})).status,403);
 for(const value of [null,true,[],{op:'execute'},{op:'activate',session:f.session,app:'arbitrary script'},{op:'tab-activate',session:f.session,app:f.session,tab:1}])assert.equal((await post(value)).status,400);
 assert.deepEqual(calls,[]);
 assert.equal((await post({op:'list',session:f.session,password:'not-forwarded',script:'not-forwarded'})).status,200);
 assert.deepEqual(calls,[{op:'apps-list'}]);
 assert.equal((await post({op:'tab-activate',session:f.session,app:f.session,tab:f.session,url:'not-forwarded'})).status,200);
 assert.deepEqual(calls[1],{op:'apps-tab-activate',app:f.session,tab:f.session});
 ws.close();await once(ws,'close');
 assert.equal((await post({op:'list',session:f.session})).status,409);
});
