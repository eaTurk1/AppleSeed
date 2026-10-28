import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { DesktopViewport, PointerGestures, availableMonitors } from '../public/desktop-model.js';
const source = (await readFile(new URL('../public/desktop-controller.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '').replace('export class DesktopController', 'class DesktopController') + '\nthis.Controller = DesktopController;';
function fixture() {
  const elements = new Map(), keys = [], pointer = [], classes = new Set(), handlers = new Map();
  class Element {
    constructor() { this.value = ''; this.hidden = false; this.style = {}; this.attrs = {}; this.events = new Map(); }
    addEventListener(name, fn) { if (!this.events.has(name)) this.events.set(name, []); this.events.get(name).push(fn); }
    removeEventListener(name, fn) { this.events.set(name, (this.events.get(name) || []).filter(f => f !== fn)); }
    emit(name, values = {}) { const event = { preventDefault() {}, ...values }; for (const fn of this.events.get(name) || []) fn(event); }
    getBoundingClientRect() { return this.rect || { left: 0, top: 0, width: 400, height: 300 }; }
    setAttribute(name, value) { this.attrs[name] = value; }
    setPointerCapture() {} replaceChildren() {} setSelectionRange() {} focus() {} blur() {}
  }
  const get = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  get('keyboard-panel').hidden = true;
  get('keyboard-extra').hidden = true;
  const classList = { toggle(name, on) { if (on) classes.add(name); else classes.delete(name); }, remove: name => classes.delete(name), contains: name => classes.has(name) };
  const document = new Element(); document.getElementById = get; document.body = { classList }; document.documentElement = {};
  const client = new Element(); client.framebuffer = { width: 3200, height: 1200, screens: [{ id: '1', x: 0, y: 0, width: 1600, height: 1200 }, { id: '2', x: 1600, y: 0, width: 1600, height: 1200 }] };
  client.canvas = new Element(); client.prepareViewport = () => {}; client.sendPointer = (...value) => pointer.push(value); client.sendKey = (...value) => keys.push(value);
  const window = new Element(); window.innerWidth = 400; window.innerHeight = 800;
  const context = { DesktopViewport, PointerGestures, availableMonitors, document, window, screen: { orientation: { type: 'portrait-primary' } },
    Keyboard: class { grab() {} ungrab() {} _allKeysUp() {} }, Keysyms: { lookup: value => value }, Option: class { constructor(name, id) { this.value = id; } },
    ResizeObserver: class { observe() {} disconnect() {} }, requestAnimationFrame: fn => { handlers.set(1, fn); return 1; }, cancelAnimationFrame: () => handlers.clear(), setTimeout, clearTimeout,
  };
  vm.runInNewContext(source, context);
  const controller = new context.Controller(client, [], () => null);
  get('monitor-select').value = 'all';
  return { get, controller, keys, pointer, document, window, client, classes, flush: () => { const fn = handlers.get(1); handlers.delete(1); fn?.(); } };
}

test('phone keyboard commits text and IME composition once, handles deletion/Return, and never keeps typed text', () => {
  const f = fixture(), input = f.get('remote-input');
  f.get('keyboard-toggle').emit('click'); assert.equal(f.get('keyboard-panel').hidden, false);
  input.value = '\u200bhello'; input.emit('input');
  assert.deepEqual(f.keys.map(e => e[0]), [...'hello'].map(c => c.codePointAt(0))); assert.equal(input.value, '\u200b');
  input.emit('compositionstart'); input.value = '\u200b日本'; input.emit('input'); assert.equal(f.keys.length, 5);
  input.emit('compositionend'); input.emit('input'); assert.equal(f.keys.length, 7);
  input.value = ''; input.emit('input'); assert.equal(f.keys.at(-1)[0], 0xff08);
  input.value = '\u200b\n'; input.emit('input'); assert.equal(f.keys.at(-1)[0], 0xff0d);
  f.get('modifier-command').emit('click'); assert.equal(f.keys.at(-1)[2], true);
  f.document.hidden = true; f.document.emit('visibilitychange');
  assert.equal(input.value, ''); assert.equal(f.get('keyboard-panel').hidden, true); assert.equal(f.keys.at(-1)[2], false);
  f.controller.destroy();
});

test('monitor changes move the viewport/cursor into that display; rotation uses fullscreen without reconnecting', () => {
  const f = fixture(); f.get('monitor-select').value = '2'; f.get('monitor-select').emit('change');
  assert.equal(f.controller.view.crop.x, 1600); assert.equal(f.controller.pointer.cursor.x, 2400);
  f.window.emit('appleseed-orientation', { detail: { landscape: true } }); assert.ok(f.classes.has('remote-fullscreen'));
  f.window.emit('appleseed-orientation', { detail: { landscape: false } }); assert.ok(!f.classes.has('remote-fullscreen'));
  f.controller.destroy(); assert.equal(f.get('pointer-surface').events.get('pointerdown').length, 0);
});

test('keyboard extra keys preserve held modifiers and release them when the keyboard closes', () => {
  const f = fixture();
  f.get('keyboard-toggle').emit('click');
  f.get('modifier-command').emit('click');
  f.get('keyboard-more').emit('click');
  assert.equal(f.get('keyboard-extra').hidden, false);
  f.get('kbd-tab').emit('click');
  f.get('kbd-left').emit('click');
  assert.deepEqual(f.keys.map(key => [key[0], key[2]]), [[0xffe7, true], [0xff09, undefined], [0xff51, undefined]]);
  assert.equal(f.get('modifier-command').attrs['aria-pressed'], 'true');
  f.get('keyboard-toggle').emit('click');
  assert.equal(f.keys.at(-1)[2], false);
  assert.equal(f.get('keyboard-extra').hidden, true);
  assert.equal(f.get('keyboard-more').attrs['aria-pressed'], 'false');
  f.controller.destroy();
});

test('repeated framebuffer/layout announcements cannot reset zoom, pan or cursor', () => {
  const f = fixture(); f.controller.view.zoomAt(6, 200, 150); f.controller.view.pan(-40, -20);
  f.controller.pointer.cursor = { x: 1800, y: 700 };
  const before = { zoom: f.controller.view.zoom, tx: f.controller.view.tx, ty: f.controller.view.ty };
  for (let i = 0; i < 10; i++) f.client.emit('framebufferresize');
  assert.deepEqual({ zoom: f.controller.view.zoom, tx: f.controller.view.tx, ty: f.controller.view.ty }, before);
  assert.deepEqual(f.controller.pointer.cursor, { x: 1800, y: 700 });
  f.get('screen').rect = { left: 0, top: 0, width: 400, height: 150 };
  const scale = f.controller.view.scale; f.window.emit('resize'); assert.equal(f.controller.view.scale, scale);
  f.controller.destroy();
});

test('framebuffer size changes preserve a zoomed selection and only clamp an out-of-bounds cursor', () => {
  const f = fixture(); f.controller.view.zoomAt(4, 200, 150); const scale = f.controller.view.scale;
  f.controller.pointer.cursor = { x: 3100, y: 1000 };
  f.client.framebuffer = { width: 2800, height: 1200, screens: [] }; f.client.emit('framebufferresize');
  assert.equal(f.controller.view.scale, scale); assert.deepEqual(f.controller.pointer.cursor, { x: 2799, y: 1000 });
  f.controller.destroy();
});

test('pointer motion is coalesced per visual frame while click and release ordering stays intact', () => {
  const f = fixture();
  f.controller.sendPointer(20, 30, 0, false); f.controller.sendPointer(40, 50, 0, false);
  assert.equal(f.pointer.length, 0); f.flush(); assert.deepEqual(f.pointer, [[40, 50, 0]]);
  f.controller.sendPointer(60, 70, 0, false); f.controller.sendPointer(60, 70, 1, true);
  f.controller.sendPointer(80, 90, 1, false); f.controller.sendPointer(80, 90, 0, true);
  assert.deepEqual(f.pointer.slice(1), [[60, 70, 0], [60, 70, 1], [80, 90, 1], [80, 90, 0]]);
  f.flush(); assert.equal(f.pointer.length, 5); f.controller.destroy();
});
