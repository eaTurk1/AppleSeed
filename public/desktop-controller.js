import { MonitorStrip } from './monitor-strip.js';
import Keyboard from '/novnc/core/input/keyboard.js';
import Keysyms from '/novnc/core/input/keysymdef.js';
import { DesktopViewport, PointerGestures, availableMonitors } from './desktop-model.js';
import { ScreenSettings } from './screen-settings.js';

export class DesktopController {
  constructor(client, hostScreens = [], nativeCall = () => null, options = {}) {
    this.client = client; this.hostScreens = hostScreens; this.nativeCall = nativeCall;
    this.$ = id => document.getElementById(id); this.surface = this.$('pointer-surface'); this.stage = this.$('screen');
    this.view = new DesktopViewport(); this.handlers = []; this.held = new Map(); this.fullscreen = null; this.nativeLandscape = nativeCall('capabilities')?.landscape; this.composing = false;
    this.pointer = new PointerGestures(this.view, (x, y, mask, immediate) => this.sendPointer(x, y, mask, immediate), () => this.render());
    if (nativeCall('capabilities')?.pointer === 'mouse') { this.pointer.trackpad = false; this.$('trackpad-toggle').textContent = 'Direct mouse'; this.$('trackpad-toggle').setAttribute('aria-pressed', 'false'); }
    client.prepareViewport();
    this.keyboard = new Keyboard(this.surface); this.keyboard.onkeyevent = (keysym, code, down) => {
      if (down) this.held.set(code, keysym); else this.held.delete(code);
      client.sendKey(keysym, code, down);
    }; this.keyboard.grab();
    this.listen(this.surface, 'pointerdown', event => {
      if (event.pointerType === 'mouse' && event.button !== 0) { event.preventDefault(); return; }
      event.preventDefault(); this.surface.setPointerCapture(event.pointerId);
      if (document.activeElement !== this.$('remote-input')) this.surface.focus({ preventScroll: true });
      const point = this.local(event); this.pointer.down(event.pointerId, point.x, point.y, event.pointerType);
    });
    this.listen(this.surface, 'pointermove', event => { event.preventDefault(); const p = this.local(event); this.pointer.motion(event.pointerId, p.x, p.y, event.pointerType); });
    this.listen(this.surface, 'pointerup', event => { event.preventDefault(); this.pointer.up(event.pointerId); });
    this.listen(this.surface, 'pointercancel', event => { event.preventDefault(); this.pointer.up(event.pointerId, true); });
    this.listen(this.surface, 'lostpointercapture', event => this.pointer.up(event.pointerId, true));
    this.listen(this.surface, 'contextmenu', event => { event.preventDefault(); this.pointer.click(4); });
    this.listen(this.surface, 'wheel', event => {
      event.preventDefault(); const p = this.local(event);
      if (event.ctrlKey) this.view.zoomAt(this.view.zoom * Math.exp(-event.deltaY / 300), p.x, p.y);
      else this.pointer.scroll(-event.deltaX, -event.deltaY);
      this.render();
    }, { passive: false });
    this.listen(this.$('trackpad-toggle'), 'click', () => {
      this.release(); this.pointer.trackpad = !this.pointer.trackpad;
      this.$('trackpad-toggle').textContent = this.pointer.trackpad ? 'Trackpad' : 'Direct touch';
      this.$('trackpad-toggle').setAttribute('aria-pressed', String(this.pointer.trackpad));
    });
    this.listen(this.$('left-click'), 'click', () => this.pointer.click());
    this.listen(this.$('right-click'), 'click', () => this.pointer.click(4));
    this.listen(this.$('drag-toggle'), 'click', () => {
      this.release(); this.pointer.dragArmed = !this.pointer.dragArmed;
      this.$('drag-toggle').querySelector('span').textContent = this.pointer.dragArmed ? 'Drag on' : 'Drag';
      this.$('drag-toggle').setAttribute('aria-pressed', String(this.pointer.dragArmed));
    });
    this.listen(this.$('zoom'), 'click', () => { this.view.fit(); this.render(); });
    this.listen(this.$('monitor-select'), 'change', () => {
      this.selectMonitor(this.$('monitor-select').value);
    });
    this.listen(this.$('keyboard-toggle'), 'click', () => this.toggleKeyboard());
    this.listen(this.$('keyboard-more'), 'pointerdown', event => event.preventDefault());
    this.listen(this.$('keyboard-more'), 'click', () => { const show = this.$('keyboard-extra').hidden; this.$('keyboard-extra').hidden = !show; this.$('keyboard-more').setAttribute('aria-pressed', String(show)); });
    this.listen(this.$('fullscreen'), 'click', () => { this.fullscreen = !document.body.classList.contains('remote-fullscreen'); this.updateFullscreen(); });
    this.listen(this.$('tools-toggle'), 'click', () => { this.toggleKeyboard(false); this.$('session-tools').hidden = !this.$('session-tools').hidden; if (!this.$('session-tools').hidden && !this.$('panel-display').hidden) this.screenSettings?.refresh(); });
    this.listen(this.$('close-tools'), 'click', () => this.$('session-tools').hidden = true);
    this.listen(document, 'visibilitychange', () => { if (document.hidden) { this.release(); this.toggleKeyboard(false); } });
    this.listen(window, 'blur', () => this.release());
    this.listen(window, 'resize', () => { this.updateFullscreen(); this.resize(); });
    this.listen(window, 'appleseed-orientation', event => { this.nativeLandscape = event.detail.landscape; this.fullscreen = null; this.updateFullscreen(); });
    this.listen(document, 'fullscreenchange', () => { if (!document.fullscreenElement) { this.fullscreen = false; this.updateFullscreen(); } });
    this.listen(client, 'framebufferresize', () => this.updateFrame());
    this.setupIME();
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(this.stage);
    if (document.createElement) this.monitorStrip = new MonitorStrip(this);
    this.listen(client, 'streamsample', () => this.monitorStrip?.paint());
    this.updateFrame(); this.updateFullscreen();
    if (options.session) { this.screenSettings = new ScreenSettings(this, options); }
    for (const tab of ['controls','session','display']) this.listen(this.$(`tab-${tab}`), 'click', () => {
      for (const name of ['controls','session','display']) { this.$(`panel-${name}`).hidden = name !== tab; this.$(`tab-${name}`).setAttribute('aria-selected', String(name === tab)); }
      if (tab === 'display') this.screenSettings?.refresh();
    });
  }
  listen(target, name, handler, options) { target.addEventListener(name, handler, options); this.handlers.push(() => target.removeEventListener(name, handler, options)); }
  local(event) { const rect = this.stage.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; }
  updateFrame() {
    const frame = this.client.framebuffer; if (!frame.width || !frame.height) return;
    const previous = this.$('monitor-select').value, initialized = this.view.initialized;
    this.view.frame(frame.width, frame.height);
    this.monitors = availableMonitors(frame.width, frame.height, frame.screens, this.hostScreens);
    this.$('monitor-select').replaceChildren(...this.monitors.map(m => new Option(m.name, m.id)));
    this.$('monitor-select').value = this.monitors.some(m => m.id === previous) ? previous : this.monitors[0].id;
    const selected = this.monitors.find(m => m.id === this.$('monitor-select').value);
    this.view.select(selected, initialized && previous === selected.id);
    this.$('monitor-select').disabled = this.monitors.length < 2;
    this.$('monitor-note').textContent = this.monitors.length > 1 ? 'Choose one monitor or the entire desktop.' : this.hostScreens.length > 1 ? 'macOS is sharing one display in this session. Other monitors are not included.' : 'One display is currently shared.';
    this.monitorStrip?.update(this.monitors, selected.id, this.hostScreens.length);
    this.resize();
    if (!initialized || previous !== selected.id) this.pointer.center();
    else this.pointer.cursor = this.view.clampCursor(this.pointer.cursor.x, this.pointer.cursor.y);
    this.render();
  }
  selectMonitor(id) {
    const crop = this.monitors.find(s => s.id === id); if (!crop) return;
    this.$('monitor-select').value = id; this.release(); this.view.select(crop); this.pointer.center();
    this.monitorStrip?.update(this.monitors, id, this.hostScreens.length); this.render();
  }
  sendPointer(x, y, mask, immediate = true) {
    if (!immediate) { this.pendingPointer = [x, y, mask]; this.render(); return; }
    this.flushPointer(); this.client.sendPointer(x, y, mask);
  }
  flushPointer() { if (this.pendingPointer) { const point = this.pendingPointer; this.pendingPointer = null; this.client.sendPointer(...point); } }
  resize() { const rect = this.stage.getBoundingClientRect(); if (rect.width && rect.height) this.view.resize(rect.width, rect.height); this.render(); }
  render() {
    if (this.raf || this.destroyed) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = null; if (this.destroyed) return;
      this.flushPointer();
      const { crop, frameWidth, frameHeight, scale, tx, ty } = this.view;
      const canvas = this.client.canvas;
      const overview = this.monitorStrip?.showOverview(this.view.width < 600 && this.$('monitor-select').value === 'all' && this.monitors.length > 1) || false;
      this.surface.hidden = overview; canvas.style.visibility = overview ? 'hidden' : 'visible';
      for (const id of ['left-click', 'right-click', 'drag-toggle', 'keyboard-toggle']) this.$(id).disabled = overview;
      canvas.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
      canvas.style.clipPath = `inset(${crop.y}px ${Math.max(0, frameWidth - crop.x - crop.width)}px ${Math.max(0, frameHeight - crop.y - crop.height)}px ${crop.x}px)`;
      const cursor = this.view.toView(this.pointer.cursor.x, this.pointer.cursor.y);
      this.$('remote-cursor').style.transform = `translate(${cursor.x - 1}px, ${cursor.y - 1}px)`;
      this.$('remote-cursor').hidden = overview || cursor.x < 0 || cursor.y < 0 || cursor.x > this.view.width || cursor.y > this.view.height;
      this.$('zoom-level').hidden = overview;
      this.$('zoom-level').textContent = `${Math.round(this.view.zoom * 100)}%`;
    });
  }
  updateFullscreen() {
    const mobileBrowser = typeof navigator !== 'undefined' && /Android|iPhone|iPad/.test(navigator.userAgent);
    const landscape = this.nativeLandscape ?? (mobileBrowser && screen.orientation?.type ? screen.orientation.type.startsWith('landscape') : window.innerWidth > window.innerHeight);
    if (this.lastLandscape !== undefined && this.lastLandscape !== landscape) { this.fullscreen = null; }
    this.lastLandscape = landscape;
    const full = this.fullscreen ?? landscape;
    document.body.classList.toggle('remote-fullscreen', full);
    this.$('fullscreen').textContent = full ? 'Window' : 'Fullscreen';
    this.$('fullscreen').setAttribute('aria-pressed', String(full));
    this.nativeCall('fullscreen', { enabled: full });
    // Fullscreen API is optional: CSS always fills the available view, native hides system bars.
    if (!this.nativeCall('capabilities')?.native && this.fullscreen === true && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
    else if (this.fullscreen === false && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  }
  toggleKeyboard(open = this.$('keyboard-panel').hidden) {
    if (open) this.$('session-tools').hidden = true;
    this.$('keyboard-panel').hidden = !open; this.$('keyboard-toggle').setAttribute('aria-pressed', String(open));
    if (open) { this.$('remote-input').value = '\u200b'; this.$('remote-input').focus({ preventScroll: true }); }
    else { this.release(); this.$('remote-input').value = ''; this.$('remote-input').blur(); this.$('keyboard-extra').hidden = true; this.$('keyboard-more').setAttribute('aria-pressed', 'false'); this.nativeCall('keyboard', { enabled: false }); }
  }
  text(value) {
    for (const character of value) {
      if (character === '\n') this.client.sendKey(0xff0d, 'Enter');
      else if (character === '\t') this.client.sendKey(0xff09, 'Tab');
      else this.client.sendKey(Keysyms.lookup(character.codePointAt(0)));
    }
  }
  setupIME() {
    const input = this.$('remote-input');
    const commit = () => {
      if (this.composing) return;
      const value = input.value;
      if (value === '') this.client.sendKey(0xff08, 'Backspace');
      else this.text(value.replace(/\u200b/g, ''));
      input.value = '\u200b'; input.setSelectionRange(1, 1);
    };
    for (const id of ['modifier-command','modifier-control','modifier-alt','modifier-shift','enter-key','tab-key','backspace','escape','key-left','key-up','key-right','key-down','key-delete']) this.listen(this.$(id), 'pointerdown', event => event.preventDefault());
    for (const [id, keysym, code] of [['kbd-tab',0xff09,'Tab'],['kbd-enter',0xff0d,'Enter'],['kbd-backspace',0xff08,'Backspace'],['kbd-escape',0xff1b,'Escape'],['kbd-delete',0xffff,'Delete'],['kbd-left',0xff51,'ArrowLeft'],['kbd-up',0xff52,'ArrowUp'],['kbd-down',0xff54,'ArrowDown'],['kbd-right',0xff53,'ArrowRight']]) {
      this.listen(this.$(id), 'pointerdown', event => event.preventDefault());
      this.listen(this.$(id), 'click', () => this.client.sendKey(keysym, code));
    }
    this.listen(input, 'compositionstart', () => this.composing = true);
    this.listen(input, 'compositionend', () => { this.composing = false; commit(); });
    this.listen(input, 'input', commit);
    const special = { Enter: [0xff0d, 'Enter'], Backspace: [0xff08, 'Backspace'], Tab: [0xff09, 'Tab'], Escape: [0xff1b, 'Escape'], Delete: [0xffff, 'Delete'], ArrowLeft: [0xff51, 'ArrowLeft'], ArrowUp: [0xff52, 'ArrowUp'], ArrowRight: [0xff53, 'ArrowRight'], ArrowDown: [0xff54, 'ArrowDown'], Home: [0xff50, 'Home'], End: [0xff57, 'End'], PageUp: [0xff55, 'PageUp'], PageDown: [0xff56, 'PageDown'] };
    this.listen(input, 'keydown', event => {
      if (event.isComposing || event.keyCode === 229) return;
      let key = special[event.key];
      if (!key && /^F([1-9]|1[0-2])$/.test(event.key)) key = [0xffbd + Number(event.key.slice(1)), event.code];
      if (!key && ['Control', 'Alt', 'Meta', 'Shift'].includes(event.key)) key = [{ Control: 0xffe3, Alt: 0xffe9, Meta: 0xffe7, Shift: 0xffe1 }[event.key] + (event.location === 2 ? 1 : 0), event.code];
      if (!key && (event.ctrlKey || event.metaKey || event.altKey) && [...event.key].length === 1) key = [Keysyms.lookup(event.key.codePointAt(0)), event.code];
      if (key) { event.preventDefault(); this.held.set(event.code, key[0]); this.client.sendKey(key[0], key[1], true); }
    });
    this.listen(input, 'keyup', event => { if (this.held.has(event.code)) { event.preventDefault(); this.client.sendKey(this.held.get(event.code), event.code, false); this.held.delete(event.code); } });
    this.listen(input, 'blur', () => { input.value = ''; this.composing = false; this.release(); });
    for (const [id, keysym, code] of [['key-left',0xff51,'ArrowLeft'],['key-up',0xff52,'ArrowUp'],['key-down',0xff54,'ArrowDown'],['key-right',0xff53,'ArrowRight'],['key-delete',0xffff,'Delete']]) this.listen(this.$(id), 'click', () => this.client.sendKey(keysym, code));
    for (const [id, keysym, code] of [['modifier-command',0xffe7,'MetaLeft'],['modifier-control',0xffe3,'ControlLeft'],['modifier-alt',0xffe9,'AltLeft'],['modifier-shift',0xffe1,'ShiftLeft']]) {
      this.listen(this.$(id), 'click', () => {
        const down = !this.held.has(code); if (down) this.held.set(code, keysym); else this.held.delete(code);
        this.client.sendKey(keysym, code, down); this.$(id).setAttribute('aria-pressed', String(down));
        if (!this.$('keyboard-panel').hidden) this.$('remote-input').focus({ preventScroll: true });
      });
    }
  }
  release() {
    this.pointer.release(); this.keyboard?._allKeysUp();
    for (const [code, keysym] of this.held) this.client.sendKey(keysym, code, false);
    this.held.clear();
    for (const id of ['modifier-command', 'modifier-control', 'modifier-alt', 'modifier-shift']) this.$(id).setAttribute('aria-pressed', 'false');
  }
  destroy() {
    this.monitorStrip?.destroy();
    this.screenSettings?.destroy();
    this.release(); this.toggleKeyboard(false); this.destroyed = true; cancelAnimationFrame(this.raf);
    this.keyboard.ungrab(); this.observer.disconnect(); this.handlers.forEach(remove => remove());
    document.body.classList.remove('remote-fullscreen'); this.nativeCall('fullscreen', { enabled: false });
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  }
}
