const modes = new Set(['auto', 'quality', 'speed']);
const profiles = {
  speed: { encoding: 'speed', quality: 2, compression: 7, label: 'Speed' },
  balanced: { encoding: 'balanced', quality: 6, compression: 4, label: 'Balanced' },
  detail: { encoding: 'quality', quality: 9, compression: 2, label: 'Quality' },
};
export function normalizeStreamMode(mode) { return modes.has(mode) ? mode : 'auto'; }
export class StreamOptimizer {
  constructor(client, mode = 'auto', change = () => {}, now = () => Date.now()) {
    this.client = client; this.change = change; this.now = now; this.dead = false;
    this.listener = event => this.sample(event.detail);
    client.addEventListener('streamsample', this.listener); this.setMode(mode);
  }
  setMode(mode) {
    if (this.dead) return;
    this.mode = normalizeStreamMode(mode); this.good = 0; this.bad = 0;
    this.apply(this.mode === 'quality' ? 'detail' : this.mode === 'speed' ? 'speed' : 'balanced');
  }
  apply(name) {
    this.profile = name; this.changedAt = this.now();
    const p = profiles[name]; this.profileLabel = p.label;
    if (this.client.setStreamProfile) this.client.setStreamProfile(p);
    else { this.client.qualityLevel = p.quality; this.client.compressionLevel = p.compression; }
    this.change({ mode: this.mode, profile: name, label: p.label });
  }
  sample({ frameMs, queuedBytes = 0, latencyMs } = {}) {
    if (this.dead || this.mode !== 'auto') return;
    const validFrame = Number.isFinite(frameMs) && frameMs >= 0;
    const validLatency = Number.isFinite(latencyMs) && latencyMs >= 0;
    if (!validFrame && !validLatency) return;
    const slow = validFrame && frameMs > 180 || queuedBytes > 1024 * 1024 || validLatency && latencyMs > 250;
    const fast = (!validFrame || frameMs < 60) && queuedBytes < 256 * 1024 && (!validLatency || latencyMs < 120);
    this.bad = slow ? this.bad + 1 : 0; this.good = fast ? this.good + 1 : 0;
    if (this.now() - this.changedAt < 6000) return;
    if (this.bad >= 2 && this.profile !== 'speed') { this.bad = 0; this.good = 0; this.apply('speed'); }
    else if (this.good >= 6 && this.profile !== 'detail') {
      this.bad = 0; this.good = 0; this.apply(this.profile === 'speed' ? 'balanced' : 'detail');
    }
  }
  destroy() { this.dead = true; this.client.removeEventListener('streamsample', this.listener); }
}
const options = '<option value="auto">Auto</option><option value="quality">Quality</option><option value="speed">Speed</option>';
export function mountStreamControls(document) {
  if (!document.getElementById('stream-mode')) {
    const row = document.createElement('div'); row.className = 'stream-preference';
    row.innerHTML = `<label for="stream-mode">Optimize connection</label><select id="stream-mode">${options}</select>`;
    const note = document.createElement('p'); note.className = 'small'; note.id = 'stream-note';
    document.getElementById('preferences').append(row, note);
  }
  if (!document.getElementById('stream-mode-live')) {
    const select = document.createElement('select'); select.id = 'stream-mode-live';
    select.setAttribute('aria-label', 'Optimize connection'); select.innerHTML = options;
    const disconnect = document.getElementById('disconnect'); disconnect.before(select);
  }
}
