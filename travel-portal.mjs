import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { authenticateMac, HandshakeReader } from './rfb-auth.mjs';
import { getDisplays } from './display-info.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const hash = value => createHash('sha256').update(value).digest();
const cookieName = '__Secure-AppleSeedPortal';
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), clipboard-read=(), clipboard-write=()' };
const unavailable = '<!doctype html><meta name="viewport" content="width=device-width"><title>AppleSeed</title><p>Unavailable.</p>';
export function createTravelPortal({ publicURL, vncPort = 5900, now = Date.now, authenticate = authenticateMac, displays = getDisplays } = {}) {
  const url = publicURL ? new URL(publicURL) : null;
  if (url && (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\/?$/.test(url.pathname))) throw new Error('Portal requires an HTTPS URL with a safe path');
  const base = url?.pathname.replace(/\/$/, '') || '/remote';
  let grant = null, epoch = 0, timer, enabling = false;
  const connections = new Set();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024, perMessageDeflate: false });
  function disable() {
    epoch++; clearTimeout(timer);
    if (grant) { grant.username.fill(0); grant.password.fill(0); grant.code.fill(0); grant.token?.fill(0); }
    grant = null;
    for (const close of [...connections]) close();
  }
  function current() { if (grant && grant.expiresAt <= now()) disable(); return grant; }
  function status() { const g = current(); return { configured: !!url, enabled: !!g, url: url?.href || null, expiresAt: g?.expiresAt || null, codeExpiresAt: g?.codeExpiresAt || null, paired: !!g?.token, viewers: connections.size }; }
  async function enable({ seconds, username, password }) {
    if (!url) throw new Error('Web Portal hosting is not configured.');
    if (enabling) throw new Error('Web Portal is already being enabled.');
    if (!Number.isInteger(seconds) || seconds < 60 || seconds > 43200 || typeof username !== 'string' || typeof password !== 'string' || !username || !password || Buffer.byteLength(username) > 63 || Buffer.byteLength(password) > 63 || /\0/.test(username + password)) throw new Error('Choose 1 to 720 minutes and a valid Mac account.');
    enabling = true; disable(); const revision = epoch;
    const user = Buffer.from(username), secret = Buffer.from(password); username = ''; password = '';
    let probe;
    const abort = () => probe?.destroy(); connections.add(abort);
    try {
      const result = await authenticate({ port: vncPort, username: user, password: secret, connected: socket => probe = socket });
      result.reader.release(); result.socket.destroy();
      if (revision !== epoch) throw new Error('Web Portal was disabled.');
      const code = [...randomBytes(8)].map(n => alphabet[n % alphabet.length]).join('');
      grant = { username: user, password: secret, code: hash(code), codeExpiresAt: now() + 5 * 60_000, expiresAt: now() + seconds * 1000, token: null, attempts: 0, windowAt: now(), windowAttempts: 0 };
      timer = setTimeout(disable, seconds * 1000); timer.unref();
      return { ...status(), code };
    } catch { user.fill(0); secret.fill(0); throw new Error('Portal could not authenticate with your Mac. Check the account or reconnect AppleSeed.'); }
    finally { enabling = false; connections.delete(abort); }
  }
  function allowedHost(req) { return !!url && req.headers.host === url.host; }
  function sameOrigin(req) { return allowedHost(req) && req.headers.origin === url.origin; }
  function authorized(req) {
    const g = current(); if (!g?.token || !allowedHost(req)) return false;
    const matches = (req.headers.cookie || '').split(';').map(s => s.trim()).filter(s => s.startsWith(cookieName + '='));
    if (matches.length !== 1) return false;
    const value = matches[0].slice(cookieName.length + 1);
    return /^[a-f0-9]{64}$/.test(value) && timingSafeEqual(hash(value), g.token);
  }
  const reply = (res, code, data, type = 'application/json', extra = {}) => { res.writeHead(code, { ...headers, 'Content-Type': type, ...extra }); res.end(type === 'application/json' ? JSON.stringify(data) : data); };
  async function body(req) {
    if (req.headers['content-type'] !== 'application/json') throw new Error('JSON required');
    let text = '', size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 1024) throw new Error('Too large'); text += chunk; }
    return JSON.parse(text);
  }
  const server = http.createServer(async (req, res) => {
    if (!allowedHost(req)) return reply(res, 404, unavailable, 'text/html; charset=utf-8');
    let pathname; try { pathname = new URL(req.url, url).pathname; } catch { return reply(res, 400, {}); }
    const g = current();
    if (!g || !(pathname === base || pathname.startsWith(base + '/'))) return reply(res, 404, unavailable, 'text/html; charset=utf-8');
    if (pathname === base && req.method === 'GET') return reply(res, 302, '', 'text/plain', { Location: base + '/' });
    if (pathname === base + '/pair' && req.method === 'POST') {
      if (!sameOrigin(req)) return reply(res, 403, { error: 'Access denied.' });
      if (g.token || g.codeExpiresAt <= now() || g.attempts >= 20) return reply(res, 403, { error: 'Code unavailable. Enable a new session on your phone.' });
      if (now() - g.windowAt >= 60000) { g.windowAt = now(); g.windowAttempts = 0; }
      if (g.windowAttempts >= 5) return reply(res, 429, { error: 'Wait one minute before trying again.' }, 'application/json', { 'Retry-After': '60' });
      g.windowAttempts++; g.attempts++;
      let value; try { value = await body(req); } catch { return reply(res, 400, { error: 'Invalid code.' }); }
      if (g !== current() || g.token || g.codeExpiresAt <= now()) return reply(res, 403, { error: 'Code unavailable.' });
      const code = typeof value?.code === 'string' ? value.code.replace(/[ -]/g, '').toUpperCase() : '';
      if (!/^[2-9A-HJ-NP-Z]{8}$/.test(code) || !timingSafeEqual(hash(code), g.code)) return reply(res, 403, { error: 'Invalid code.' });
      const token = randomBytes(32).toString('hex'); g.token = hash(token); g.code.fill(0);
      return reply(res, 200, { ok: true }, 'application/json', { 'Set-Cookie': `${cookieName}=${token}; Path=${base}/; Secure; HttpOnly; SameSite=Strict; Max-Age=${Math.max(1, Math.floor((g.expiresAt - now()) / 1000))}` });
    }
    if (req.method === 'POST' && pathname === base + '/logout') {
      if (!sameOrigin(req) || !authorized(req)) return reply(res, 403, {});
      disable(); return reply(res, 200, { ok: true }, 'application/json', { 'Set-Cookie': `${cookieName}=; Path=${base}/; Secure; HttpOnly; SameSite=Strict; Max-Age=0` });
    }
    if (req.method !== 'GET') return reply(res, 405, {});
    if (pathname === base + '/status') {
      if (!authorized(req)) return reply(res, 403, { error: 'Session unavailable.' });
      const screens = await displays();
      if (g !== current()) return reply(res, 403, {});
      return reply(res, 200, { displays: screens, expiresAt: g.expiresAt });
    }
    let filename, type;
    if (pathname === base + '/') { filename = path.join(root, 'portal', authorized(req) ? 'desktop.html' : 'index.html'); type = 'text/html; charset=utf-8'; }
    else if ([base + '/portal.css', base + '/pair.js'].includes(pathname)) { filename = path.join(root, 'portal', path.basename(pathname)); type = pathname.endsWith('.css') ? 'text/css' : 'text/javascript'; }
    else if (pathname === base + '/icon.png') { filename = path.join(root, 'public/icon.png'); type = 'image/png'; }
    else if (authorized(req)) {
      if (pathname === base + '/desktop.js') filename = path.join(root, 'portal/desktop.js');
      else if (['apple-rfb.js', 'desktop-model.js', 'stream-quality.js'].some(file => pathname === `${base}/assets/${file}`)) filename = path.join(root, 'public', path.basename(pathname));
      else if (pathname.startsWith(base + '/assets/novnc/')) {
        const relative = pathname.slice((base + '/assets/novnc/').length);
        if (!relative.endsWith('.js') || !/^[a-zA-Z0-9_/.-]+$/.test(relative) || relative.split('/').some(p => p.startsWith('.'))) return reply(res, 404, {});
        filename = path.join(root, 'node_modules/@novnc/novnc', relative);
      }
      type = 'text/javascript';
    }
    if (!filename) return reply(res, 404, {});
    try { const data = await readFile(filename); if (g !== current()) return reply(res, 404, unavailable, 'text/html'); return reply(res, 200, data, type); }
    catch { return reply(res, 404, {}); }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  server.on('upgrade', (req, socket, head) => {
    const reject = () => socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    if (!sameOrigin(req) || !authorized(req) || req.url !== base + '/ws' || connections.size >= 2) return reject();
    const g = grant;
    wss.handleUpgrade(req, socket, head, ws => {
      let tcp, reader, ended = false;
      const browser = new HandshakeReader(ws, 'message');
      const close = () => { if (ended) return; ended = true; browser.release(); reader?.release(); tcp?.destroy(); ws.terminate(); connections.delete(close); };
      connections.add(close); ws.on('error', close); ws.on('close', close);
      (async () => {
        ws.send('RFB 003.008\n', { binary: true });
        if ((await browser.read(12)).toString('ascii') !== 'RFB 003.008\n') throw new Error('Unsupported browser protocol');
        ws.send(Buffer.from([1, 1])); if ((await browser.read(1))[0] !== 1) throw new Error('Invalid authentication');
        const result = await authenticate({ port: vncPort, username: g.username, password: g.password, connected: stream => tcp = stream }); reader = result.reader;
        if (ended || current() !== g) return close();
        ws.send(Buffer.alloc(4));
        if ((await browser.read(1))[0] !== 1) throw new Error('Only shared sessions are allowed');
        const pendingClient = browser.release(), pendingServer = reader.release(); reader = null;
        tcp.on('error', close); tcp.on('close', close);
        tcp.on('data', data => {
          if (ended || current() !== g || ws.readyState !== WebSocket.OPEN) return close();
          ws.send(data, { binary: true }, error => { if (error) close(); else if (!ended && ws.bufferedAmount <= 262144) tcp.resume(); });
          if (ws.bufferedAmount >= 1048576) tcp.pause();
        });
        ws.on('message', (data, binary) => {
          if (ended || current() !== g || !binary) return close();
          if (!tcp.write(data)) ws.pause();
        });
        tcp.on('drain', () => { if (!ended) ws.resume(); });
        tcp.write(Buffer.from([1]));
        if (pendingClient.length) tcp.write(pendingClient);
        if (pendingServer.length) ws.send(pendingServer);
      })().catch(close);
    });
  });
  return { server, status, enable, disable, close: async () => { disable(); wss.close(); if (server.listening) await new Promise(resolve => server.close(resolve)); } };
}
