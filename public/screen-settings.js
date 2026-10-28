export class ScreenSettings {
  constructor(desktop, { session, notify, request } = {}) {
    this.desktop = desktop; this.$ = desktop.$; this.session = session; this.notify = notify || (() => {});
    this.request = request || ((...args) => fetch(...args)); this.handlers = []; this.state = {}; this.busy = false; this.revision = 0;
    this.listen('display-timing-tab', 'click', () => this.panel('timing'));
    this.listen('display-quick-tab', 'click', () => this.panel('quick'));
    this.listen('display-refresh', 'click', () => this.refresh());
    this.listen('saver-default', 'change', () => this.paint());
    this.listen('display-source', 'change', () => this.paintTimers());
    this.listen('display-apply', 'pointerdown', event => event.preventDefault());
    this.listen('display-apply', 'click', () => { this.$('display-minutes').blur(); this.$('sleep-minutes').blur(); this.$('saver-minutes').blur(); this.desktop.nativeCall('keyboard', { enabled: false }); this.save(); });
    this.listen('display-awake', 'change', () => this.action('awake', { mode: this.$('display-awake').value }));
    for (const op of ['off','wake','saver']) this.listen(`display-${op}`, 'click', () => this.action(op));
    this.listen('display-choose', 'click', () => this.action('settings', { pane: 'saver' }));
    this.listen('display-mac-settings', 'click', () => this.action('settings', { pane: 'timing' }));
    this.listen('phone-awake', 'change', () => {
      desktop.nativeCall('phone-awake', { enabled: this.$('phone-awake').checked });
    });
    this.$('phone-awake-row').hidden = !desktop.nativeCall('capabilities')?.phoneAwakeSupported;
    this.$('phone-awake').checked = !!desktop.nativeCall('settings')?.phoneAwake;
    this.panel('timing'); this.paint();
  }
  listen(id, event, fn) { const el = this.$(id); el.addEventListener(event, fn); this.handlers.push(() => el.removeEventListener(event, fn)); }
  panel(name) {
    for (const n of ['timing','quick']) { this.$(`display-${n}`).hidden = n !== name; this.$(`display-${n}-tab`).setAttribute('aria-selected', String(n === name)); }
  }
  async command(op, values = {}) {
    const response = await this.request('/api/screen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, session: this.session, ...values }) });
    const result = await response.json().catch(() => ({ ok: false, error: response.status === 409 ? 'Session ended. Reconnect to your Mac.' : 'The display action could not be completed.' }));
    if (!response.ok || !result.ok) throw new Error(result.error || 'The display action could not be completed.');
    return result;
  }
  async refresh() {
    if (this.busy || this.destroyed) return;
    this.busy = true; const revision = ++this.revision; this.paint();
    try {
      const state = await this.command('status'); if (this.destroyed || revision !== this.revision) return;
      this.state = state;
      this.$('display-source').replaceChildren(...state.sources.map(s => new Option(s.label, s.source)));
      this.paintTimers();
    } catch (error) { this.notify(error.message); }
    finally { this.busy = false; this.paint(); }
  }
  paintTimers() {
    const source = this.state.sources?.find(s => s.source === this.$('display-source').value);
    this.$('display-minutes').value = source?.displayMinutes ?? '';
    this.$('sleep-minutes').value = source?.sleepMinutes ?? '';
    const seconds = this.state.saverSeconds;
    this.$('saver-default').checked = this.state.saverDefault ?? seconds == null;
    this.$('saver-minutes').value = seconds == null ? '' : seconds / 60;
    this.$('display-awake').value = this.state.awake || 'normal';
    this.$('display-source-row').hidden = (this.state.sources?.length || 0) < 2;
  }
  async save() {
    const number = id => { const text = this.$(id).value; return /^\d+$/.test(text) ? Number(text) : NaN; };
    const displayMinutes = number('display-minutes'), sleepMinutes = number('sleep-minutes');
    const values = { source: this.$('display-source').value, displayMinutes, sleepMinutes };
    if (this.state.available && !this.state.saverManaged) {
      const saverMinutes = number('saver-minutes');
      values.saverSeconds = this.$('saver-default').checked ? null : saverMinutes * 60;
      if (values.saverSeconds !== null && (!Number.isInteger(saverMinutes) || saverMinutes < 0 || saverMinutes > 1440)) { this.notify('Choose a screen saver timer from 0 to 1440 minutes, or Mac default.'); return; }
    }
    if (![displayMinutes,sleepMinutes].every(n => Number.isInteger(n) && n >= 0 && n <= 1440)) { this.notify('Choose screen-off and sleep timers from 0 to 1440 minutes. Zero means Never.'); return; }
    await this.action('save', values);
  }
  async action(op, values = {}) {
    if (this.busy || this.destroyed) return false;
    this.busy = true; const revision = ++this.revision; this.paint();
    try {
      this.desktop.release();
      const result = await this.command(op, values); if (this.destroyed || revision !== this.revision) return false;
      this.state = result; if (op === 'save') this.paintTimers();
      const messages = { save: 'Mac timers saved.', awake: 'Awake setting updated for this session.', off: 'Mac screens turned off.', wake: 'Wake request sent to the Mac screens.', saver: 'Screen saver started. Your Mac may lock according to its settings.', settings: 'Mac settings opened in your remote desktop.' };
      this.notify(messages[op] || 'Display settings updated.');
      return true;
    } catch (error) { this.notify(error.message); return false; }
    finally { this.busy = false; this.paint(); }
  }
  paint() {
    if (this.destroyed) return;
    const s = this.state;
    this.$('display-awake').value = s.awake || 'normal';
    for (const id of ['display-apply','display-off']) this.$(id).disabled = this.busy || !s.powerWritable;
    for (const id of ['display-wake','display-saver','display-choose','display-awake','display-mac-settings']) this.$(id).disabled = this.busy || !s.available;
    for (const id of ['display-source','display-minutes','sleep-minutes','display-refresh']) this.$(id).disabled = this.busy;
    this.$('saver-minutes').disabled = this.busy || !s.available || s.saverManaged || this.$('saver-default').checked;
    this.$('saver-default').disabled = this.busy || !s.available || s.saverManaged;
    this.$('display-status').textContent = this.busy ? 'Working…' : !s.sources ? 'Read the Mac’s settings with Refresh.' : s.powerWritable ? 'Persistent Mac timers · 0 means Never' : 'Mac power helper needs an update.';
  }
  destroy() { this.destroyed = true; this.revision++; this.handlers.forEach(fn => fn()); }
}
