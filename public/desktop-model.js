const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export class DesktopViewport {
  constructor() { this.width = 1; this.height = 1; this.frameWidth = 1; this.frameHeight = 1; this.zoom = 1; this.initialized = false; this.crop = { x: 0, y: 0, width: 1, height: 1 }; this.tx = 0; this.ty = 0; }
  get scale() { return Math.min(this.width / this.crop.width, this.height / this.crop.height) * this.zoom; }
  resize(width, height) {
    const center = this.toRemote(this.width / 2, this.height / 2), scale = this.scale, zoomed = this.initialized && this.zoom > 1;
    this.width = Math.max(1, width); this.height = Math.max(1, height);
    if (zoomed) this.zoom = Math.max(1, scale / Math.min(this.width / this.crop.width, this.height / this.crop.height));
    this.tx = this.width / 2 - center.x * this.scale; this.ty = this.height / 2 - center.y * this.scale; this.constrain();
  }
  frame(width, height) {
    this.frameWidth = width; this.frameHeight = height;
    if (!this.initialized) { this.select({ x: 0, y: 0, width, height }); this.initialized = true; }
  }
  select(crop, preserve = false) {
    const center = this.toRemote(this.width / 2, this.height / 2), scale = this.scale, zoomed = this.zoom > 1;
    this.crop = { ...crop };
    if (!preserve || !zoomed) { this.fit(); return; }
    this.zoom = Math.max(1, scale / Math.min(this.width / crop.width, this.height / crop.height));
    this.tx = this.width / 2 - center.x * this.scale; this.ty = this.height / 2 - center.y * this.scale; this.constrain();
  }
  fit() { this.zoom = 1; this.tx = this.width / 2 - (this.crop.x + this.crop.width / 2) * this.scale; this.ty = this.height / 2 - (this.crop.y + this.crop.height / 2) * this.scale; this.constrain(); }
  toRemote(x, y) { return { x: (x - this.tx) / this.scale, y: (y - this.ty) / this.scale }; }
  toView(x, y) { return { x: x * this.scale + this.tx, y: y * this.scale + this.ty }; }
  zoomAt(zoom, x, y, remoteAnchor = this.toRemote(x, y)) {
    this.zoom = clamp(zoom, 1, Math.max(32, this.zoom)); this.tx = x - remoteAnchor.x * this.scale; this.ty = y - remoteAnchor.y * this.scale; this.constrain();
  }
  pan(dx, dy) { this.tx += dx; this.ty += dy; this.constrain(); }
  constrain() {
    const s = this.scale, c = this.crop;
    this.tx = c.width * s <= this.width ? (this.width - c.width * s) / 2 - c.x * s : clamp(this.tx, this.width - (c.x + c.width) * s, -c.x * s);
    this.ty = c.height * s <= this.height ? (this.height - c.height * s) / 2 - c.y * s : clamp(this.ty, this.height - (c.y + c.height) * s, -c.y * s);
  }
  followCursor(x, y) {
    const p = this.toView(x, y), margin = Math.min(28, this.width / 4, this.height / 4);
    const dx = p.x < margin ? margin - p.x : p.x > this.width - margin ? this.width - margin - p.x : 0;
    const dy = p.y < margin ? margin - p.y : p.y > this.height - margin ? this.height - margin - p.y : 0;
    if (dx || dy) this.pan(dx, dy);
  }
  clampCursor(x, y) { const c = this.crop; return { x: clamp(x, c.x, c.x + c.width - 1), y: clamp(y, c.y, c.y + c.height - 1) }; }
}

export function decodeDesktopLayout(bytes, width, height) {
  if (bytes.length < 4 || bytes.length < 4 + bytes[0] * 16) return [];
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), screens = [];
  for (let i = 0; i < bytes[0]; i++) {
    const offset = 4 + i * 16;
    const screen = { id: String(data.getUint32(offset)), x: data.getUint16(offset + 4), y: data.getUint16(offset + 6), width: data.getUint16(offset + 8), height: data.getUint16(offset + 10) };
    if (screen.width && screen.height && screen.x + screen.width <= width && screen.y + screen.height <= height) screens.push(screen);
  }
  return screens;
}
export function availableMonitors(width, height, protocolScreens = [], hostScreens = []) {
  const full = { id: 'all', name: 'All monitors', x: 0, y: 0, width, height };
  // macOS can resize the framebuffer without publishing a new extended layout.
  // The old monitor list must not hide a newly added virtual display.
  const validProtocol = protocolScreens.length > 1
    && protocolScreens.every(s => s.x >= 0 && s.y >= 0 && s.width > 0 && s.height > 0 && s.x + s.width <= width && s.y + s.height <= height)
    && Math.max(...protocolScreens.map(s => s.x + s.width)) === width
    && Math.max(...protocolScreens.map(s => s.y + s.height)) === height;
  if (validProtocol) return [full, ...protocolScreens.map((screen, i) => ({ ...screen, name: `Monitor ${i + 1}` }))];
  const hosts = hostScreens.filter(s => Number.isFinite(s.x) && Number.isFinite(s.y) && s.width > 0 && s.height > 0);
  if (hosts.length > 1) {
    const primary = hosts.find(s => s.primary) || hosts[0];
    const pixelScale = primary.pixelWidth / primary.width;
    const layouts = [hosts];
    // Some VNC servers share native pixels when displays use different HiDPI
    // scales. Accept that geometry only when its entire span matches the frame.
    if (pixelScale > 0 && hosts.every(s => s.pixelWidth > 0 && s.pixelHeight > 0)) layouts.push(hosts.map(s => ({ ...s, x: s.x * pixelScale, y: s.y * pixelScale, width: s.pixelWidth, height: s.pixelHeight })));
    for (const layout of layouts) {
    const minX = Math.min(...layout.map(s => s.x)), minY = Math.min(...layout.map(s => s.y));
    const spanW = Math.max(...layout.map(s => s.x + s.width)) - minX, spanH = Math.max(...layout.map(s => s.y + s.height)) - minY;
    const scaleX = width / spanW, scaleY = height / spanH;
    // Only crop known layouts when the VNC framebuffer actually spans those displays.
    if (Math.abs(scaleX / scaleY - 1) < .01 && scaleX > 0) {
      return [full, ...layout.map((s, i) => ({ id: `host-${s.id}`, name: `Monitor ${i + 1}${s.primary ? ' · Main' : ''}`, x: Math.round((s.x - minX) * scaleX), y: Math.round((s.y - minY) * scaleY), width: Math.round(s.width * scaleX), height: Math.round(s.height * scaleY) }))];
    }
    }
  }
  return [{ ...full, name: 'Shared display' }];
}

export class PointerGestures {
  constructor(viewport, send, render, clock = {}) {
    this.view = viewport; this.send = send; this.render = render;
    this.now = clock.now || (() => Date.now()); this.delay = clock.delay || ((fn, ms) => setTimeout(fn, ms)); this.clearDelay = clock.clearDelay || (timer => clearTimeout(timer));
    this.points = new Map(); this.cursor = { x: 0, y: 0 }; this.mask = 0; this.trackpad = true; this.dragArmed = false;
    this.scrollX = 0; this.scrollY = 0; this.lastTap = -Infinity;
  }
  center() { const c = this.view.crop; this.cursor = this.view.clampCursor(c.x + c.width / 2, c.y + c.height / 2); this.render(); }
  pointer(mask = this.mask, immediate = true) { this.mask = mask; this.send(Math.round(this.cursor.x), Math.round(this.cursor.y), mask, immediate); this.render(); }
  move(x, y, follow = false) { this.cursor = this.view.clampCursor(x, y); if (follow) this.view.followCursor(this.cursor.x, this.cursor.y); this.pointer(this.mask, false); }
  click(mask = 1) { this.pointer(mask); this.pointer(0); }
  release() { this.clearDelay(this.hold); if (this.mask) this.pointer(0); this.points.clear(); this.multi = null; this.multiUsed = false; this.single = null; }
  scroll(dx, dy) {
    this.scrollX += dx; this.scrollY += dy;
    for (const [axis, positive, negative] of [['scrollY', 8, 16], ['scrollX', 32, 64]]) {
      let steps = 0;
      while (Math.abs(this[axis]) >= 24 && steps++ < 12) {
        this.pointer(this[axis] > 0 ? positive : negative); this.pointer(0); this[axis] -= Math.sign(this[axis]) * 24;
      }
    }
  }
  down(id, x, y, kind = 'touch') {
    if (this.points.size >= 2) { this.release(); return; }
    this.points.set(id, { x, y });
    if (this.points.size === 1) {
      this.multiUsed = false; this.single = { lastTime: this.now(), gain: 1, id, startX: x, startY: y, lastX: x, lastY: y, time: this.now(), moved: false, kind };
      if (!this.trackpad || kind === 'mouse') { const remote = this.view.toRemote(x, y); this.move(remote.x, remote.y); }
      if (this.dragArmed || kind === 'mouse' || this.now() - this.lastTap < 300) this.pointer(1);
      else this.hold = this.delay(() => { if (this.points.size === 1 && this.single && !this.single.moved) this.pointer(1); }, 350);
    } else {
      this.clearDelay(this.hold); if (this.mask) this.pointer(0); this.multiUsed = true;
      const [a, b] = [...this.points.values()];
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      this.multi = { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), cx, cy, lastX: cx, lastY: cy, anchor: this.view.toRemote(cx, cy), zoom: this.view.zoom, time: this.now(), moved: false, pinch: false, mode: null, origins: [a, b] };
    }
  }
  motion(id, x, y, kind = 'touch') {
    if (!this.points.has(id)) { if (kind === 'mouse') { const remote = this.view.toRemote(x, y); this.move(remote.x, remote.y); } return; }
    this.points.set(id, { x, y });
    if (this.points.size === 2 && this.multi) {
      const [a, b] = [...this.points.values()], m = this.multi;
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2, distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (Math.abs(distance - m.distance) > 8 || Math.hypot(cx - m.cx, cy - m.cy) > 8) m.moved = true;
      const ax = a.x - m.origins[0].x, ay = a.y - m.origins[0].y, bx = b.x - m.origins[1].x, by = b.y - m.origins[1].y;
      const bothMoved = Math.hypot(ax, ay) > 3 && Math.hypot(bx, by) > 3;
      const spreading = bothMoved && ax * bx + ay * by <= 0;
      const stationaryPinch = !bothMoved && this.now() - m.time > 100 && Math.abs(distance - m.distance) > 20;
      // Decide once per gesture. Uneven scroll events must not become a pinch halfway through.
      if (!m.mode && (spreading || stationaryPinch) && Math.abs(distance - m.distance) > 12 && Math.abs(distance / m.distance - 1) > .06) m.mode = 'pinch';
      if (!m.mode && bothMoved && Math.hypot(cx - m.cx, cy - m.cy) > 6) m.mode = this.view.zoom > 1 ? 'pan' : 'scroll';
      m.pinch = m.mode === 'pinch';
      if (m.pinch) this.view.zoomAt(m.zoom * distance / m.distance, cx, cy, m.anchor);
      else if (m.mode === 'pan') this.view.pan(cx - m.lastX, cy - m.lastY);
      else if (m.mode === 'scroll') this.scroll(cx - m.lastX, cy - m.lastY);
      if (m.mode) { m.lastX = cx; m.lastY = cy; }
      this.render(); return;
    }
    if (this.multiUsed || !this.single) return;
    const s = this.single;
    const travel = Math.hypot(x - s.startX, y - s.startY);
    if (kind !== 'mouse' && !s.moved && !this.mask && travel < 4) return;
    if (travel >= 4) { s.moved = true; this.clearDelay(this.hold); }
    if (this.trackpad && kind !== 'mouse') {
      const dx = x - s.lastX, dy = y - s.lastY, elapsed = Math.max(8, this.now() - s.lastTime);
      const speed = Math.hypot(dx, dy) / elapsed;
      // Fine movements stay precise; faster swipes cover more of the desktop. Dragging stays 1:1.
      const gain = this.mask ? 1 : .7 + Math.min(1.1, Math.max(0, speed - .25));
      s.gain = this.mask ? 1 : s.gain * .6 + gain * .4;
      this.move(this.cursor.x + dx * s.gain / this.view.scale, this.cursor.y + dy * s.gain / this.view.scale, true);
    } else { const remote = this.view.toRemote(x, y); this.move(remote.x, remote.y); }
    s.lastX = x; s.lastY = y; s.lastTime = this.now();
  }
  up(id, cancelled = false) {
    if (!this.points.has(id)) return;
    this.points.delete(id); this.clearDelay(this.hold);
    if (cancelled && this.multi) this.multi.cancelled = true;
    if (this.mask) this.pointer(0);
    if (!this.points.size) {
      if (!cancelled && this.multiUsed && this.multi && !this.multi.cancelled && !this.multi.moved && this.now() - this.multi.time < 300) this.click(4);
      else if (!cancelled && !this.multiUsed && this.single && !this.single.moved && this.now() - this.single.time < 300 && this.single.kind !== 'mouse' && !this.dragArmed) {
        // A double-tap's second contact already pressed the button in down().
        if (!(this.now() - this.lastTap < 300)) this.click();
        this.lastTap = this.now();
      }
      this.multi = null; this.single = null; this.multiUsed = false;
    }
  }
}

// Reserve a three-finger upward swipe without emitting a remote click or key.
export class AppsGesture {
  constructor(open, now = () => Date.now()) { this.open = open; this.now = now; this.points = new Map(); this.blocking = false; }
  down(id, x, y, kind) {
    if (kind !== 'touch') return;
    this.points.set(id, {x,y});
    if (this.points.size === 3 && !this.blocking) { this.blocking = true; this.start = this.center(); this.time = this.now(); this.valid = true; }
    if (this.points.size > 3) this.valid = false;
  }
  center() { const p=[...this.points.values()]; return {x:p.reduce((n,s)=>n+s.x,0)/p.length,y:p.reduce((n,s)=>n+s.y,0)/p.length}; }
  motion(id,x,y) { if(this.points.has(id))this.points.set(id,{x,y}); }
  up(id,cancelled=false) {
    if (!this.points.has(id)) return;
    let fire=false;
    if(this.blocking && this.valid && this.points.size===3 && !cancelled){const end=this.center();fire=this.now()-this.time<1200 && end.y-this.start.y < -55 && Math.abs(end.x-this.start.x)<80;}
    if(cancelled)this.valid=false;
    this.points.delete(id);
    if(fire){this.valid=false;this.open();}
    if(!this.points.size){this.blocking=false;this.valid=false;}
  }
  reset(){this.points.clear();this.blocking=false;this.valid=false;}
}
