import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { getDisplays } from './display-info.mjs';
import { companionCommand } from './companion-control.mjs';
import { screenCommand, validateScreenRequest } from './power-control.mjs';
import { WebSocketServer, WebSocket } from 'ws';
import { createTravelPortal } from './travel-portal.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.apk': 'application/vnd.android.package-archive' };

export function createApp({ publicURL, allowedLogin, port = 18796, vncPort = 5900, portalURL, portalAuthenticate, hostPlatform = 'darwin', sessionMs = 10 * 60_000, powerCommand = screenCommand, unlockCommand = companionCommand, deviceName = os.hostname().replace(/\.local$/, ''), accountName = os.userInfo().username, onSessionClose = () => {} } = {}) {
  const portal = createTravelPortal({ publicURL: portalURL, vncPort, ...(portalAuthenticate ? { authenticate: portalAuthenticate } : {}) });
  const external = publicURL ? new URL(publicURL) : null;
  const localHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024, perMessageDeflate: false });
  let active = 0, currentSession = null;
  let screenQueue = Promise.resolve();
  const performScreen = command => { const next = screenQueue.then(() => {
    if (!['end','lease'].includes(command.op) && currentSession?.id !== command.session) return { ok: false, error: 'Session ended.' };
    return powerCommand(command);
  }); screenQueue = next.catch(() => {}); return next; };
  const lease = setInterval(() => {
    if (currentSession?.screenUsed) performScreen({ op: 'lease', session: currentSession.id }).catch(() => {});
  }, 30000); lease.unref();
  const validSeconds = value => Number.isInteger(value) && value >= 0 && value <= 86400;

  function authorized(req) {
    if (localHosts.has(req.headers.host)) return true;
    return !!(external && allowedLogin && req.headers.host === external.host &&
      req.headers['tailscale-user-login'] === allowedLogin);
  }
  function originAllowed(req) {
    try {
      const origin = new URL(req.headers.origin);
      return origin.host === req.headers.host &&
        (localHosts.has(origin.host) ? origin.protocol === 'http:' : origin.origin === external?.origin);
    } catch { return false; }
  }
  const headers = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-src 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'",
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), clipboard-read=(), clipboard-write=()'
  };
  function reply(res, code, data, type = 'text/plain; charset=utf-8') {
    res.writeHead(code, { ...headers, 'Content-Type': type, ...(type === types['.apk'] ? { 'Content-Disposition': 'attachment; filename="AppleSeed-2.0.0.apk"' } : {}) }); res.end(data);
  }
  const server = http.createServer(async (req, res) => {
    if (!authorized(req)) return reply(res, 403, 'This page is limited to the Mac owner’s Tailscale account.');
    let pathname;
    try { pathname = new URL(req.url, 'http://localhost').pathname; }
    catch { return reply(res, 400, 'Bad path'); }
    if (pathname === '/api/mobile') return reply(res, 404, 'Not found');
    if (pathname === '/api/portal' && req.method === 'POST') {
      if (!originAllowed(req)) return reply(res, 403, 'Forbidden');
      if (req.headers['content-type'] !== 'application/json') return reply(res, 415, 'JSON required');
      let body = '', size = 0, value;
      try {
        for await (const chunk of req) { size += chunk.length; if (size > 8192) return reply(res, 413, 'Too large'); body += chunk; }
        value = JSON.parse(body); body = '';
      } catch { return reply(res, 400, 'Bad request'); }
      if (!value || typeof value !== 'object' || Array.isArray(value)) return reply(res, 400, 'Invalid portal action');
      try {
        if (value?.op === 'disable') { portal.disable(); return reply(res, 200, JSON.stringify(portal.status()), types['.json']); }
        if (value?.op === 'enable') return reply(res, 200, JSON.stringify(await portal.enable(value)), types['.json']);
        return reply(res, 400, 'Invalid portal action');
      } catch (error) { return reply(res, 422, JSON.stringify({ error: error.message }), types['.json']); }
      finally { if (value) { value.password = ''; value.username = ''; } }
    }
    if (pathname === '/api/unlock' && req.method === 'POST') {
      if (hostPlatform !== 'darwin') return reply(res, 422, JSON.stringify({ok:false,state:'unsupported',ready:false,sent:false,error:'Use Keyboard to sign in on this computer. Automatic secure-field unlock is a macOS feature.'}), types['.json']);
      if (!originAllowed(req)) return reply(res, 403, 'Forbidden');
      if (req.headers['content-type'] !== 'application/json') return reply(res, 415, 'JSON required');
      let body = '', size = 0, value;
      try {
        for await (const chunk of req) { size += chunk.length; if (size > 8192) return reply(res, 413, 'Too large'); body += chunk; }
        value = JSON.parse(body); body = '';
      } catch { return reply(res, 400, 'Bad request'); }
      if (!value || !['status', 'submit'].includes(value.op)) return reply(res, 400, 'Invalid action');
      const session = currentSession;
      if (!session || session.id !== value.session) return reply(res, 409, 'Session unavailable');
      const command = { op: `unlock-${value.op}` };
      if (value.op === 'submit') {
        if (typeof value.password !== 'string' || !value.password.length || value.password.length > 4096 ||
            !/^[a-f0-9-]{36}$/i.test(value.cycle) || !/^[a-f0-9-]{36}$/i.test(value.nonce)) return reply(res, 400, 'Invalid unlock request');
        Object.assign(command, { password: value.password, cycle: value.cycle, nonce: value.nonce });
      }
      try {
        const result = await unlockCommand(command);
        if (session !== currentSession) return reply(res, 409, 'Session ended');
        return reply(res, result.ok ? 200 : 422, JSON.stringify(result), types['.json']);
      } catch { return reply(res, 503, JSON.stringify({ ok: false, state: 'unknown', ready: false, error: 'Update or start the AppleSeed Mac companion for safe unlock.' }), types['.json']); }
      finally { command.password = ''; value.password = ''; }
    }
    if (pathname === '/api/screen' && req.method === 'POST') {
      if (hostPlatform !== 'darwin') return reply(res, 422, JSON.stringify({ok:false,error:'Set display and sleep timing in this computer’s operating system.'}), types['.json']);
      if (!originAllowed(req)) return reply(res, 403, 'Forbidden');
      if (req.headers['content-type'] !== 'application/json') return reply(res, 415, 'JSON required');
      let body = '', bytes = 0, value;
      try {
        for await (const chunk of req) { bytes += chunk.length; if (bytes > 2048) { reply(res, 413, 'Too large'); req.resume(); return; } body += chunk; }
        value = JSON.parse(body);
      } catch { return reply(res, 400, 'Bad request'); }
      if (!validateScreenRequest(value)) return reply(res, 400, 'Invalid display action');
      const session = currentSession;
      if (!session || session.id !== value.session) return reply(res, 409, 'Session unavailable');
      const command = { op: value.op, session: session.id };
      if (value.op === 'save') {
        for (const key of ['source','displayMinutes','sleepMinutes','saverSeconds']) if (value[key] !== undefined) command[key] = value[key];
      }
      if (value.op === 'awake') command.mode = value.mode;
      if (value.op === 'settings') command.pane = value.pane;
      session.screenUsed = true;
      try {
        const result = await performScreen(command);
        if (session !== currentSession) return reply(res, 409, 'Session ended');
        return reply(res, result.ok ? 200 : 422, JSON.stringify(result), types['.json']);
      } catch (error) { return reply(res, 503, JSON.stringify({ ok: false, error: error.message }), types['.json']); }
    }
    if (pathname === '/api/session/timer' && req.method === 'POST') {
      if (!originAllowed(req)) return reply(res, 403, 'Forbidden');
      if (req.headers['content-type'] !== 'application/json') return reply(res, 415, 'JSON required');
      let body = '', bytes = 0;
      try {
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > 1024) { reply(res, 413, 'Too large'); req.resume(); return; }
          body += chunk;
        }
        const value = JSON.parse(body);
        if (!validSeconds(value.seconds)) return reply(res, 400, 'Invalid timer');
        if (!currentSession || currentSession.id !== value.session) return reply(res, 409, 'Session unavailable');
        currentSession.setTimer(value.seconds * 1000);
        return reply(res, 200, JSON.stringify({ expiresAt: currentSession.expiresAt }), types['.json']);
      } catch { return reply(res, 400, 'Bad request'); }
    }
    if (req.method !== 'GET') return reply(res, 405, 'Method not allowed');
    if (pathname === '/api/portal') return reply(res, 200, JSON.stringify(portal.status()), types['.json']);
    if (pathname === '/api/status') {
      const [sharing, displays] = await Promise.all([probeVNC(vncPort), getDisplays()]);
      return reply(res, 200, JSON.stringify({ sharing, active: active > 0, account: accountName,
        name: deviceName, platform: hostPlatform, features: {safeUnlock:hostPlatform === 'darwin',displaySettings:hostPlatform === 'darwin'}, publicURL: external?.origin || null,
        startup: process.env.MAC_UNLOCK_STARTUP === 'boot' ? 'boot' : 'login', displays }), types['.json']);
    }
    let filename;
    if (pathname === '/') filename = path.join(root, 'public/index.html');
    else if (['/app.js', '/appearance.js', '/quick-access.js', '/safe-unlock.js', '/portal-control.js', '/monitor-strip.js', '/stream-quality.js', '/free-tools.js', '/apple-rfb.js', '/desktop-model.js', '/desktop-controller.js', '/screen-settings.js', '/style.css', '/icon.svg', '/icon.png', '/manifest.json', '/AppleSeed.apk'].includes(pathname)) filename = path.join(root, 'public', pathname);
    else if (pathname.startsWith('/novnc/')) {
      let relative;
      try { relative = decodeURIComponent(pathname.slice(7)); } catch { return reply(res, 400, 'Bad path'); }
      if (!relative.endsWith('.js') || relative.split('/').some(p => p === '..' || p.startsWith('.')) || relative.includes('\\')) return reply(res, 404, 'Not found');
      filename = path.join(root, 'node_modules/@novnc/novnc', relative);
    } else return reply(res, 404, 'Not found');
    try { reply(res, 200, await readFile(filename), types[path.extname(filename)] || 'application/octet-stream'); }
    catch { reply(res, 404, 'Not found'); }
  });
  server.on('upgrade', (req, socket, head) => {
    const reject = (code, message) => { socket.end(`HTTP/1.1 ${code} ${message}\r\nConnection: close\r\n\r\n`); };
    if (!authorized(req)) return reject(403, 'Forbidden');
    if (!originAllowed(req)) return reject(403, 'Forbidden');
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { return reject(400, 'Bad Request'); }
    if (url.pathname !== '/ws') return reject(404, 'Not Found');
    const seconds = url.searchParams.has('seconds') ? Number(url.searchParams.get('seconds')) : null;
    const id = url.searchParams.get('session') || randomUUID();
    if ((seconds !== null && (!validSeconds(seconds) || !/^\d+$/.test(url.searchParams.get('seconds')))) || !/^[a-f0-9-]{36}$/i.test(id)) return reject(400, 'Bad Request');
    if (active >= 1) return reject(409, 'Session Already Active');
    wss.handleUpgrade(req, socket, head, ws => {
      // handleUpgrade is synchronous. Count only completed, valid handshakes.
      active++;
      const tcp = net.connect({ host: '127.0.0.1', port: vncPort });
      let disposed = false;
      const startedAt = Date.now();
      let peakQueuedBytes = 0, flowPauses = 0;
      let ttl;
      const session = { id, expiresAt: null, setTimer(ms) {
        clearTimeout(ttl); session.expiresAt = ms ? Date.now() + ms : null;
        if (ms) { ttl = setTimeout(() => { ws.close(1000, 'Session expired'); dispose('Session expired'); }, ms); ttl.unref(); }
      } };
      currentSession = session; session.setTimer(seconds === null ? sessionMs : seconds * 1000);
      function dispose(reason = 'Connection closed') {
        if (disposed) return;
        disposed = true; active--; clearTimeout(ttl); tcp.destroy();
        if (session.screenUsed) performScreen({ op: 'end', session: session.id }).catch(() => {});
        if (currentSession === session) currentSession = null;
        onSessionClose({ reason, durationMs: Date.now() - startedAt, peakQueuedBytes, flowPauses });
      }
      tcp.setTimeout(30_000);
      tcp.on('timeout', () => { ws.close(1011, 'Screen Sharing timed out'); dispose('Screen Sharing timed out'); });
      tcp.once('connect', () => tcp.setTimeout(0));
      tcp.on('data', data => {
        if (disposed || ws.readyState !== WebSocket.OPEN) return;
        // A full desktop can arrive over loopback faster than the phone can
        // receive it. Bound the queue by pausing the source, not the session.
        ws.send(data, { binary: true }, error => {
          if (disposed) return;
          if (error) { ws.close(1011, 'Screen stream interrupted'); dispose('Screen stream interrupted'); return; }
          if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount <= 256 * 1024) tcp.resume();
        });
        peakQueuedBytes = Math.max(peakQueuedBytes, ws.bufferedAmount);
        if (ws.bufferedAmount >= 1024 * 1024) { flowPauses++; tcp.pause(); }
      });
      tcp.on('error', () => { ws.close(1011, 'Screen Sharing unavailable'); dispose('Screen Sharing unavailable'); });
      tcp.on('close', () => { if (ws.readyState === WebSocket.OPEN) ws.close(1000); dispose('Mac Screen Sharing closed'); });
      ws.on('message', (data, binary) => {
        if (!binary) { ws.close(1003, 'Binary protocol required'); return dispose('Invalid stream data'); }
        if (!tcp.write(data)) ws.pause();
      });
      tcp.on('drain', () => ws.resume());
      ws.on('error', () => dispose('WebSocket error'));
      ws.on('close', code => dispose(`WebSocket closed (${code})`));
    });
  });
  return { server, portal, close: async () => {
    await portal.close();
    clearInterval(lease);
    const closed = [...wss.clients].map(ws => new Promise(resolve => { ws.once('close', resolve); ws.terminate(); }));
    await Promise.all(closed); wss.close(); await new Promise(resolve => server.close(resolve)); await screenQueue;
  } };
}

export function probeVNC(port = 5900) {
  return new Promise(resolve => {
    const socket = net.connect(port, '127.0.0.1');
    let done = false, bytes = Buffer.alloc(0);
    const finish = result => { if (done) return; done = true; socket.destroy(); resolve(result); };
    socket.setTimeout(1800, () => finish(false));
    socket.on('data', data => { bytes = Buffer.concat([bytes, data]); if (bytes.length >= 12) finish(/^RFB \d{3}\.\d{3}\n/.test(bytes.subarray(0, 12).toString('ascii'))); });
    socket.on('error', () => finish(false));
    socket.on('end', () => finish(false));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.MAC_UNLOCK_PORT || 18796);
  // Release temporary awake assertions left by a restarted service.
  await companionCommand({ op: 'recover' }).catch(() => {});
  const app = createApp({ hostPlatform: process.platform, port, publicURL: process.env.MAC_UNLOCK_URL, allowedLogin: process.env.MAC_UNLOCK_LOGIN,
    portalURL: process.env.APPLESEED_PORTAL_URL,
    // Operational metadata only: never log protocol bytes, credentials or session IDs.
    onSessionClose: event => console.info('AppleSeed connection ended', JSON.stringify(event)) });
  app.server.listen(port, '127.0.0.1', () => console.log(`Mac Unlock listening at http://127.0.0.1:${port}`));
  // A separate listener has no owner API or Tailscale-header trust. Only this
  // listener may be routed through a public HTTPS reverse proxy.
  if (process.env.APPLESEED_PORTAL_URL) app.portal.server.listen(Number(process.env.APPLESEED_PORTAL_PORT || 18798), '127.0.0.1');
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await app.close(); process.exit(0); });
}
