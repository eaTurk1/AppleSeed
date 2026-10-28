export class MonitorStrip {
  constructor(controller, doc = document) {
    this.controller = controller; this.doc = doc; this.signature = ''; this.lastPaint = 0; this.visible = true;
    this.visibility = event => { this.visible = !!event.detail.visible; };
    globalThis.addEventListener?.('appleseed-visibility', this.visibility);
    this.element = doc.createElement('nav'); this.element.className = 'monitor-strip'; this.element.setAttribute('aria-label', 'Home monitors');
    controller.stage.parentNode.insertBefore(this.element, controller.stage);
    this.overview = doc.createElement('div'); this.overview.className = 'monitor-overview'; this.overview.hidden = true; controller.stage.append(this.overview);
  }
  update(monitors, selected, hostCount) {
    const signature = JSON.stringify(monitors);
    if (signature !== this.signature) {
      this.signature = signature; this.element.replaceChildren(); this.overview.replaceChildren(); this.previews = [];
      for (const monitor of monitors) {
        const button = this.doc.createElement('button'); button.type = 'button'; button.className = 'monitor-card'; button.dataset.monitor = monitor.id;
        const label = this.doc.createElement('span'); label.textContent = monitor.id === 'all' && monitors.length > 1 ? 'Both screens' : monitor.name;
        if (monitor.id !== 'all') {
          const canvas = this.doc.createElement('canvas'); canvas.width = 160; canvas.height = 90; canvas.setAttribute('aria-hidden', 'true'); button.append(canvas); this.previews.push({ canvas, monitor });
          const overviewButton = this.doc.createElement('button'); overviewButton.type = 'button'; overviewButton.className = 'monitor-overview-card';
          const large = this.doc.createElement('canvas'); const ratio = Math.min(1, 1000 / monitor.width, 1000 / monitor.height); large.width = Math.max(1, Math.round(monitor.width * ratio)); large.height = Math.max(1, Math.round(monitor.height * ratio)); large.setAttribute('aria-hidden', 'true');
          const caption = this.doc.createElement('span'); caption.textContent = monitor.name + ' · Tap to control'; overviewButton.append(large, caption);
          overviewButton.addEventListener('click', () => this.controller.selectMonitor(monitor.id)); this.overview.append(overviewButton); this.previews.push({ canvas: large, monitor, overview: true });
        }
        button.append(label); button.addEventListener('click', () => this.controller.selectMonitor(monitor.id)); this.element.append(button);
      }
      if (monitors.length === 1) {
        const note = this.doc.createElement('span'); note.className = 'monitor-missing';
        note.textContent = hostCount > 1 ? 'Second screen is not in this stream.' : 'Mac detects one display.'; this.element.append(note);
      }
    }
    for (const button of this.element.querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.monitor === selected));
    this.paint(true);
  }
  paint(force = false) {
    if (this.doc.hidden || !this.visible) return;
    if (!force && Date.now() - this.lastPaint < 500) {
      if (!this.repaintTimer) this.repaintTimer = setTimeout(() => { this.repaintTimer = null; this.paint(true); }, 500);
      return;
    }
    this.lastPaint = Date.now();
    for (const { canvas, monitor: m, overview } of this.previews || []) {
      if (overview && this.overview.hidden) continue;
      const context = canvas.getContext('2d'); if (!context) continue;
      const scale = Math.min(canvas.width / m.width, canvas.height / m.height), w = m.width * scale, h = m.height * scale;
      context.clearRect(0,0,canvas.width,canvas.height);
      context.drawImage(this.controller.client.canvas,m.x,m.y,m.width,m.height,(canvas.width-w)/2,(canvas.height-h)/2,w,h);
    }
  }
  showOverview(enabled) { this.overview.hidden = !enabled; return enabled; }
  destroy() { globalThis.removeEventListener?.('appleseed-visibility', this.visibility); clearTimeout(this.repaintTimer); this.element.remove(); this.overview.remove(); }
}
