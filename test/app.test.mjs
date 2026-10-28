import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { SafeUnlock } from '../public/safe-unlock.js';
import { StreamOptimizer, normalizeStreamMode } from '../public/stream-quality.js';

const source = (await readFile(new URL('../public/app.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
function fixture({ saved = null, native = true, streamMode = 'auto' } = {}) {
  const elements = new Map(), intervals = [], callbacks = {}, nativeOps = [], clients = [];
  class Element {
    constructor() { this.handlers = {}; this.value = ''; this.hidden = false; this.checked = false; this.open = false; this.classList = { toggle() {}, remove() {} }; }
    addEventListener(name, fn) { this.handlers[name] = fn; }
    emit(name) { return this.handlers[name]?.({ preventDefault() {} }); }
    append(child) { if (child.id) elements.set(child.id, child); } replaceChildren() {} focus() {} blur() {} showModal() { this.open = true; } close() { this.open = false; }
  }
  const element = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  element('timer-enabled').checked = true; element('timer-minutes').value = '10';
  const document = { body: { classList: { add() {}, remove() {} } }, hidden: false, getElementById: element, createElement: () => new Element(), querySelector: () => element('credentials').open ? Object.assign(element('credentials'), { id: 'credentials' }) : null, addEventListener: (name, fn) => callbacks[name] = fn };
  class RFB {
    constructor(screen, url) { this.handlers = {}; this.url = url; this.keys = []; this.credentials = null; clients.push(this); }
    addEventListener(name, fn) { this.handlers[name] = fn; }
    removeEventListener(name, fn) { if (this.handlers[name] === fn) delete this.handlers[name]; }
    emit(name, detail = {}) { this.handlers[name]?.({ detail }); }
    sendCredentials(value) { this.credentials = value; }
    sendKey(value) { this.keys.push(value); }
    disconnect() { this.emit('disconnect', { clean: true }); }
  }
  const context = {
    mountPortalControl() {}, mountQuickAccess(options) { return {
      homePortal: {}, livePortal: {}, hostFeatures() {}, connected() { element('panel-unlock').hidden = false; }, ended() { this.hide(); },
      hide() { element('panel-unlock').hidden = true; options.cancelUnlock(); },
      get visible() { return !element('panel-unlock').hidden; },
    }; }, mountAppearance() {}, SafeUnlock, StreamOptimizer, normalizeStreamMode, mountStreamControls() { element('stream-mode'); element('stream-mode-live'); element('stream-note'); },
    DesktopController: class { constructor() {this.hostScreens=[];} updateFrame() {} release() {} toggleKeyboard() {} destroy() {} }, RFB, Keysyms: { lookup: value => value }, initLogging() {}, document, URL, crypto: { randomUUID: () => 'ecff85b4-e307-401b-b153-30545ee407c1' },
    navigator: { userAgent: native ? 'Test AppleSeed/1.1' : 'Browser' }, location: { href: 'https://mac.example.ts.net:9447/' },
    fetch: async (url, options) => ({ ok: true, json: async () => url === '/api/status' ? { sharing: true, active: false, account: 'owner', name: 'Mac', startup: 'boot' } : url === '/api/unlock' ? { ok: true, protocol: 2, state: 'locked', ready: true, nonce: 'one-use', cycle: 'lock-cycle', pending: options && JSON.parse(options.body).op === 'submit' } : { expiresAt: null } }),
    setTimeout: fn => { queueMicrotask(fn); return 1; }, clearTimeout() {}, setInterval: fn => { intervals.push(fn); },
    window: { isSecureContext: true, addEventListener: (name, fn) => callbacks[name] = fn, prompt: (message, data) => {
      const request = JSON.parse(data); nativeOps.push(request);
      if (request.op === 'settings') return JSON.stringify({ saved: !!saved, seconds: 600, streamMode });
      if (request.op === 'load') return JSON.stringify(saved);
      if (request.op === 'save') { saved = { ...request.credentials }; return 'true'; }
      if (request.op === 'forget') { saved = null; return 'true'; }
      return 'true';
    } },
  };
  vm.runInNewContext(source, context);
  return { element, clients, document, callbacks, nativeOps, intervals, window: context.window };
}
const settle = async () => { for (let n = 0; n < 32; n++) await Promise.resolve(); };
async function start(f) { await settle(); await f.element('connect').emit('click'); return f.clients[0]; }

test('one Mac password entry covers authentication and live-screen unlock; backgrounding preserves the session', async () => {
  const f = fixture(); const client = await start(f);
  client.emit('credentialsrequired', { types: ['username', 'password'] });
  f.element('username').value = 'owner'; f.element('password').value = 'test-only-password'; f.element('remember-password').checked = true;
  f.element('credential-form').emit('submit');
  assert.equal(client.credentials.password, 'test-only-password'); client.emit('connect');
  assert.equal(client.credentials.password, '', 'noVNC authentication copy is cleared after use');
  assert.ok(f.nativeOps.some(op => op.op === 'save' && op.credentials.password === 'test-only-password'));
  f.document.hidden = true; f.callbacks.visibilitychange();
  assert.equal(f.element('session').hidden, false, 'Leaving the app does not disconnect');
  assert.equal(f.element('screen-password').value, '');
  f.document.hidden = false; f.callbacks.visibilitychange();
  await settle();
  f.element('focus-confirmed').checked = true; f.element('focus-confirmed').emit('change');
  assert.equal(f.element('screen-password').value, 'test-only-password');
  await f.element('typing').emit('submit');
  assert.deepEqual(client.keys, [], 'Unlock never emits RFB keystrokes');
  f.element('disconnect').emit('click');
  assert.equal(f.element('session').hidden, true); assert.equal(f.element('screen-password').value, '');
  assert.equal(f.nativeOps.at(-2)?.op === 'session-end' || f.nativeOps.some(op => op.op === 'session-end'), true);
});

test('remembered credentials authenticate without a dialog; Forget removes persistence and the reusable password', async () => {
  const f = fixture({ saved: { username: 'owner', password: 'test-remembered', macAccount: true } }); const client = await start(f);
  client.emit('credentialsrequired', { types: ['username', 'password'] });
  assert.equal(client.credentials.password, 'test-remembered'); assert.equal(f.element('credentials').open, false);
  client.emit('connect');
  f.element('forget-password').emit('click');
  f.element('focus-confirmed').checked = true; f.element('focus-confirmed').emit('change');
  assert.equal(f.element('screen-password').value, ''); assert.equal(f.element('forget-password').hidden, true);
});

test('no timer and custom durations are sent to the server; classic VNC passwords are not reused as Mac login passwords', async () => {
  const f = fixture({ native: false }); await settle();
  f.element('timer-enabled').checked = false;
  const client = await start(f); assert.equal(new URL(client.url).searchParams.get('seconds'), '0');
  client.emit('credentialsrequired', { types: ['password'] }); f.element('password').value = 'vnc-only'; f.element('credential-form').emit('submit'); client.emit('connect');
  f.element('focus-confirmed').checked = true; f.element('focus-confirmed').emit('change');
  assert.equal(f.element('screen-password').value, '');
  f.element('disconnect').emit('click'); await settle();
  f.element('timer-enabled').checked = true; f.element('timer-minutes').value = '37';
  await f.element('connect').emit('click'); assert.equal(new URL(f.clients[1].url).searchParams.get('seconds'), '2220');
});

test('backgrounding clears the password-field confirmation and prevents unseen typing', async () => {
  const f = fixture(); const client = await start(f);
  client.emit('connect'); f.element('focus-confirmed').checked = true; f.element('screen-password').value = 'private-test';
  f.document.hidden = true;
  await f.element('typing').emit('submit'); assert.deepEqual(client.keys, []);
  assert.equal(f.element('focus-confirmed').checked, false);
});

test('server disconnect reasons remain visible instead of looking like a requested disconnect', async () => {
  const f = fixture(); const client = await start(f); client.emit('connect');
  client.disconnectReason = 'Your session timer ended.'; client.emit('disconnect', { clean: true });
  assert.equal(f.element('notification').textContent, 'Your session timer ended.');
});

test('native window dismissal preserves the connection and timer; reopening does not start another session', async () => {
  const f = fixture(); const client = await start(f); client.emit('connect');
  f.element('focus-confirmed').checked = true; f.element('screen-password').value = 'test-private';
  f.callbacks['appleseed-visibility']({ detail: { visible: false } });
  f.callbacks.pagehide({ persisted: false });
  assert.equal(f.element('session').hidden, false);
  assert.equal(f.element('screen-password').value, '');
  assert.equal(f.element('focus-confirmed').checked, false);
  f.element('focus-confirmed').checked = true; f.element('screen-password').value = 'unseen';
  await f.element('typing').emit('submit'); assert.deepEqual(client.keys, []);
  f.callbacks['appleseed-visibility']({ detail: { visible: true } });
  assert.equal(f.clients.length, 1);
  assert.equal(f.nativeOps.filter(op => op.op === 'session-start').length, 1);
  f.element('disconnect').emit('click'); assert.equal(f.element('session').hidden, true);
});

test('closing a browser document still disconnects, while switching away preserves it', async () => {
  const f = fixture({ native: false }); const client = await start(f); client.emit('connect');
  f.document.hidden = true; f.callbacks.visibilitychange();
  assert.equal(f.element('session').hidden, false);
  f.callbacks.pagehide({ persisted: false }); assert.equal(f.element('session').hidden, true);
});

test('a quick close and reopen cancels password typing already in progress', async () => {
  const f = fixture(); const client = await start(f); client.emit('connect');
  f.element('focus-confirmed').checked = true; f.element('screen-password').value = 'test-sensitive';
  const pending = f.element('typing').emit('submit');
  f.callbacks['appleseed-visibility']({ detail: { visible: false } });
  f.callbacks['appleseed-visibility']({ detail: { visible: true } });
  await pending;
  assert.deepEqual(client.keys, [], 'No keystroke fallback, including partial passwords');
  assert.equal(f.element('focus-confirmed').checked, false);
});

test('optimization can change live without reconnecting; selectors stay synchronized and only the mode is remembered', async () => {
  const f = fixture({ streamMode: 'speed' }); const client = await start(f); client.emit('connect');
  assert.equal(client.qualityLevel, 2); assert.equal(f.element('stream-mode-live').value, 'speed');
  f.element('stream-mode-live').value = 'quality'; f.element('stream-mode-live').emit('change');
  assert.equal(client.qualityLevel, 9); assert.equal(client.compressionLevel, 2); assert.equal(f.element('stream-mode').value, 'quality');
  assert.equal(f.clients.length, 1); assert.deepEqual(f.nativeOps.filter(x => x.op === 'stream-preference'), [{ op: 'stream-preference', mode: 'quality' }]);
  f.element('stream-mode').value = 'auto'; f.element('stream-mode').emit('change');
  assert.equal(client.qualityLevel, 6); assert.equal(f.element('stream-mode-live').value, 'auto');
  f.element('disconnect').emit('click'); assert.equal(client.handlers.streamsample, undefined);
});

test('Back closes Tools and cancels unseen unlock, then preserves the desktop session', async () => {
  const f = fixture(); const client = await start(f); client.emit('connect'); await settle();
  f.element('session-tools').hidden = false; f.element('panel-unlock').hidden = true; f.element('keyboard-panel').hidden = true;
  assert.equal(f.window.appleSeedBack(), true);
  assert.equal(f.element('session-tools').hidden, true); assert.equal(f.clients.length, 1);
  assert.equal(f.element('screen-password').disabled, true);
  assert.equal(f.window.appleSeedBack(), false, 'At the desktop, native Back may background without disconnecting');
  assert.equal(f.element('session').hidden, false);
});
test('Back cancels the authentication dialog and returns to Connect', async () => {
  const f = fixture(); const client = await start(f);
  client.emit('credentialsrequired', { types: ['username', 'password'] });
  assert.equal(f.element('credentials').open, true);
  assert.equal(f.window.appleSeedBack(), true);
  assert.equal(f.element('credentials').open, false); assert.equal(f.element('session').hidden, true);
});
