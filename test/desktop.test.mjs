import test from 'node:test';
import assert from 'node:assert/strict';
import { DesktopViewport, PointerGestures, availableMonitors, decodeDesktopLayout } from '../public/desktop-model.js';

function fixture() {
  const view = new DesktopViewport(); view.resize(400, 300); view.frame(1600, 1200);
  const events = []; let now = 1000, hold;
  const pointer = new PointerGestures(view, (x, y, mask) => events.push({ x, y, mask }), () => {}, { now: () => now, delay: fn => { hold = fn; return 1; }, clearDelay: () => hold = null });
  pointer.center();
  return { view, pointer, events, time: value => now += value, hold: () => hold?.() };
}

test('relative trackpad motion never jumps to the finger; tap and double-tap click at the cursor', () => {
  const f = fixture();
  f.pointer.down(1, 10, 10); assert.equal(f.pointer.cursor.x, 800);
  f.pointer.motion(1, 35, 20); f.pointer.up(1);
  assert.ok(f.pointer.cursor.x > 800 && f.pointer.cursor.x < 1000);
  assert.ok(f.pointer.cursor.y > 600 && f.pointer.cursor.y < 700);
  const position = { ...f.pointer.cursor };
  f.events.length = 0; f.pointer.down(1, 300, 280); f.time(50); f.pointer.up(1);
  f.time(80); f.pointer.down(1, 20, 20); f.time(50); f.pointer.up(1);
  assert.deepEqual(f.events.map(e => e.mask), [1, 0, 1, 0]);
  assert.ok(f.events.every(e => e.x === Math.round(position.x) && e.y === Math.round(position.y)));
});

test('holding and sliding drags; cancellation/background release does not leave a button pressed', () => {
  const f = fixture(); f.pointer.down(1, 40, 50); f.time(400); f.hold();
  f.pointer.motion(1, 60, 50); assert.equal(f.events.at(-1).mask, 1);
  f.pointer.up(1); assert.equal(f.events.at(-1).mask, 0);
  f.pointer.dragArmed = true; f.pointer.down(2, 30, 30); assert.equal(f.events.at(-1).mask, 1);
  f.pointer.release(); assert.equal(f.events.at(-1).mask, 0); assert.equal(f.pointer.points.size, 0);
  f.events.length = 0; f.pointer.dragArmed = false; f.pointer.down(3, 80, 80); f.pointer.up(3, true); assert.equal(f.events.length, 0);
});

test('pinch zoom preserves its anchor; two-finger pan clamps within the selected display', () => {
  const f = fixture(); f.pointer.down(1, 150, 150); f.pointer.down(2, 250, 150);
  f.pointer.motion(1, 100, 150); f.pointer.motion(2, 300, 150);
  assert.equal(f.view.zoom, 2); assert.deepEqual(f.view.toRemote(200, 150), { x: 800, y: 600 });
  f.pointer.up(1); f.pointer.up(2); assert.equal(f.events.length, 0, 'pinch emits no remote clicks');
  f.view.pan(10000, -10000); assert.deepEqual(f.view.toRemote(0, 300), { x: 0, y: 1200 });
  f.view.zoomAt(100, 200, 150); assert.equal(f.view.zoom, 32);
  f.view.zoomAt(.1, 200, 150); assert.equal(f.view.zoom, 1);
});

test('two-finger tap right-clicks; scroll at Fit emits wheel clicks and cancelled gestures do not click', () => {
  const f = fixture(); f.pointer.down(1, 140, 100); f.pointer.down(2, 240, 100); f.time(60); f.pointer.up(1); f.pointer.up(2);
  assert.deepEqual(f.events.map(e => e.mask), [4, 0]);
  f.events.length = 0; f.pointer.down(1, 100, 150); f.pointer.down(2, 200, 150);
  f.pointer.motion(1, 100, 80); f.pointer.motion(2, 200, 80); f.pointer.up(1); f.pointer.up(2);
  assert.ok(f.events.some(e => e.mask === 16)); assert.ok(!f.events.some(e => e.mask === 1));
  f.events.length = 0; f.pointer.down(1, 10, 10); f.pointer.down(2, 20, 20); f.pointer.up(1, true); f.pointer.up(2); assert.equal(f.events.length, 0);
});

test('monitor crop uses framebuffer coordinates, handles negative host positions, and rejects mismatched shared layouts', () => {
  const hosts = [{ id: 'left', x: -1600, y: 0, width: 1600, height: 1200 }, { id: 'right', x: 0, y: 0, width: 1600, height: 1200, primary: true }];
  const monitors = availableMonitors(3200, 1200, [], hosts); assert.equal(monitors.length, 3);
  const view = new DesktopViewport(); view.resize(400, 300); view.frame(3200, 1200); view.select(monitors[2]);
  assert.deepEqual(view.toRemote(200, 150), { x: 2400, y: 600 });
  assert.deepEqual(view.clampCursor(-10, 4000), { x: 1600, y: 1199 });
  assert.equal(availableMonitors(1600, 1200, [], hosts).length, 1);
  const mixed = [{ id: 'main', x: 0, y: 0, width: 1920, height: 1200, pixelWidth: 1920, pixelHeight: 1200, primary: true }, { id: 'mobile', x: 1920, y: 0, width: 480, height: 850, pixelWidth: 960, pixelHeight: 1700 }];
  const nativePixels = availableMonitors(2880, 1700, [], mixed);
  assert.equal(nativePixels.length, 3); assert.equal(nativePixels[2].width, 960); assert.equal(nativePixels[2].x, 1920);
  const protocol = [{ id: '1', x: 0, y: 0, width: 1000, height: 1200 }, { id: '2', x: 1000, y: 0, width: 2200, height: 1200 }];
  assert.equal(availableMonitors(3200, 1200, protocol, hosts)[2].x, 1000, 'protocol geometry takes priority');
  view.zoomAt(2, 200, 150); const center = view.toRemote(200, 150); view.resize(800, 300); assert.deepEqual(view.toRemote(400, 150), center);
});

test('extended desktop layouts retain every display and reject truncated/out-of-bounds records', () => {
  const bytes = new Uint8Array(36), data = new DataView(bytes.buffer); bytes[0] = 2;
  for (let i = 0; i < 2; i++) { const o = 4 + i * 16; data.setUint32(o, i + 1); data.setUint16(o + 4, i * 1600); data.setUint16(o + 8, 1600); data.setUint16(o + 10, 1200); }
  assert.equal(decodeDesktopLayout(bytes, 3200, 1200).length, 2);
  assert.equal(decodeDesktopLayout(bytes.slice(0, 20), 3200, 1200).length, 0);
  assert.equal(decodeDesktopLayout(bytes, 1600, 1200).length, 1);
});

test('a basic framebuffer resize cannot leave the old physical layout hiding the Mobile display', () => {
  const oldProtocol = [{ id: '1', x: 2560, y: 0, width: 2560, height: 1440 }, { id: '5', x: 0, y: 0, width: 2560, height: 1440 }];
  const hosts = [{ id: '1', x: 0, y: 0, width: 2560, height: 1440, primary: true }, { id: '5', x: -2560, y: 0, width: 2560, height: 1440 }, { id: '72', x: 2560, y: 0, width: 640, height: 1202 }];
  const monitors = availableMonitors(5760, 1440, oldProtocol, hosts);
  assert.equal(monitors.length, 4);
  assert.deepEqual(monitors.find(s => s.id === 'host-72'), { id: 'host-72', name: 'Monitor 3', x: 5120, y: 0, width: 640, height: 1202 });
  assert.equal(availableMonitors(5120, 1440, oldProtocol, hosts).some(s => s.id === 'host-72'), false, 'never claim that an unshared virtual display is visible');
});

test('keyboard and rotation resizes preserve actual magnification and Fit stays fitted', () => {
  const f = fixture(); f.view.zoomAt(6, 200, 150);
  const scale = f.view.scale, center = f.view.toRemote(200, 150);
  f.view.resize(400, 150);
  assert.equal(f.view.scale, scale); assert.deepEqual(f.view.toRemote(200, 75), center);
  f.view.resize(800, 300);
  assert.equal(f.view.scale, scale); assert.deepEqual(f.view.toRemote(400, 150), center);
  f.view.fit(); f.view.resize(400, 150);
  assert.equal(f.view.zoom, 1);
  f.view.zoomAt(32, 200, 75); assert.equal(f.view.zoom, 32);
});

test('two-finger pan remains pan despite finger lag and changing separation', () => {
  const f = fixture(); f.view.zoomAt(4, 200, 150);
  f.pointer.down(1, 100, 150); f.pointer.down(2, 200, 150);
  f.pointer.motion(1, 100, 130); f.pointer.motion(2, 200, 130);
  f.time(200); f.pointer.motion(1, 100, 90); f.pointer.motion(2, 200, 100);
  assert.equal(f.view.zoom, 4); assert.equal(f.pointer.multi.mode, 'pan');
  f.pointer.up(1); f.pointer.up(2); assert.ok(!f.events.some(e => e.mask === 1 || e.mask === 4));
});

test('trackpad ignores tap jitter and gives slow adjustments finer control than fast swipes', () => {
  const quiet = fixture(); quiet.pointer.down(1, 100, 100); quiet.pointer.motion(1, 102, 101);
  assert.deepEqual(quiet.pointer.cursor, { x: 800, y: 600 });
  quiet.pointer.up(1); assert.deepEqual(quiet.events.map(e => e.mask), [1, 0]);
  const slow = fixture(), fast = fixture();
  for (const f of [slow, fast]) f.pointer.down(1, 100, 100);
  slow.time(100); slow.pointer.motion(1, 120, 100);
  fast.time(8); fast.pointer.motion(1, 120, 100);
  assert.ok(slow.pointer.cursor.x - 800 < fast.pointer.cursor.x - 800);
  slow.pointer.release(); fast.pointer.release();
});

test('zoomed trackpad follows the pointer at the viewport edge without changing zoom', () => {
  const f = fixture(); f.view.zoomAt(4, 200, 150);
  f.pointer.down(1, 100, 100); f.time(100); f.pointer.motion(1, 350, 100);
  const p = f.view.toView(f.pointer.cursor.x, f.pointer.cursor.y);
  assert.ok(p.x <= f.view.width - 27); assert.ok(p.x >= 0); assert.equal(f.view.zoom, 4);
  f.pointer.release();
});
