// One tap, one fresh Mac-side check. Passwords never use the remote keyboard.
export class SafeUnlock {
  constructor({ request, changed = () => {}, visible = () => true, timeoutMs = 4000 }) {
    this.request = request; this.changed = changed; this.visible = visible; this.timeoutMs = timeoutMs;
    this.state = { state: 'unknown', ready: false }; this.busy = false;
    this.revision = 0; this.cancelRevision = 0; this.destroyed = false;
  }
  get ready() { return !this.destroyed && !this.busy && this.visible() && this.state.state !== 'unlocked'; }
  async call(value) {
    const controller = new AbortController(); let timer;
    try {
      return await Promise.race([this.request(value, { signal: controller.signal }), new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('Unlock check timed out')); }, this.timeoutMs);
      })]);
    } finally { clearTimeout(timer); }
  }
  refresh() {
    if (this.refreshing) return this.refreshRevision === this.revision ? this.refreshing : this.refreshing.then(() => this.refresh());
    const revision = ++this.revision; this.refreshRevision = revision;
    const task = (async () => {
      try {
        const state = await this.call({ op: 'status' });
        if (!this.destroyed && revision === this.revision) this.state = state;
      } catch { if (!this.destroyed && revision === this.revision) this.state = { state: 'unknown', ready: false, error: 'Could not reach the Mac. Tap Unlock Mac to check again.' }; }
      this.changed(); return this.state;
    })();
    this.refreshing = task;
    task.finally(() => { if (this.refreshing === task) this.refreshing = null; });
    return task;
  }
  async submit(password) {
    if (!this.ready || typeof password !== 'string' || !password.length) return null;
    this.busy = true; this.changed();
    const cancelRevision = this.cancelRevision;
    try {
      // Never act on an old displayed lock state, even if video/status polling lags.
      if (this.refreshing) await this.refreshing;
      await this.refresh();
      if (cancelRevision !== this.cancelRevision || this.destroyed || !this.visible()) return null;
      if (this.state.state !== 'locked' || !this.state.ready || !this.state.nonce) return this.state;
      if (this.state.protocol !== 2) { this.state = { ...this.state, error: 'Update the Mac companion before using Unlock.' }; return this.state; }
      const result = await this.call({ op: 'submit', password, nonce: this.state.nonce, cycle: this.state.cycle });
      if (!this.destroyed) this.state = { ...this.state, ...result, nonce: '', ready: false };
      return result;
    } catch { this.state = { state: 'unknown', ready: false, error: 'No response from the Mac. Check the screen, then tap Unlock Mac to check again.' }; return this.state; }
    finally { password = ''; this.busy = false; this.changed(); }
  }
  cancelPending() { this.cancelRevision++; this.revision++; this.changed(); }
  destroy() { this.destroyed = true; this.cancelPending(); }
}
