const modes = new Set(['light', 'dark', 'auto']);
export function mountAppearance({ native = false, nativeCall = () => null, document: doc = document, window: win = window } = {}) {
  const media = win.matchMedia('(prefers-color-scheme: dark)');
  let mode = 'auto', nativeLight;
  if (native) {
    const settings = nativeCall('settings');
    if (modes.has(settings?.appearance)) mode = settings.appearance;
    if (typeof settings?.appearanceLight === 'boolean') nativeLight = settings.appearanceLight;
  } else {
    try { const saved = win.localStorage.getItem('appleseed-appearance'); if (modes.has(saved)) mode = saved; } catch {}
  }
  const row = doc.createElement('div'); row.className = 'appearance-preference';
  row.innerHTML = '<span id="appearance-label">Appearance</span><div class="appearance-options" role="group" aria-labelledby="appearance-label"><button type="button" data-appearance="light" aria-pressed="false">Light</button><button type="button" data-appearance="dark" aria-pressed="false">Dark</button><button type="button" data-appearance="auto" aria-pressed="false">Auto</button></div>';
  const preferences = doc.getElementById('preferences');
  const content = doc.createElement('div'); content.className = 'preference-content';
  for (const child of [...preferences.childNodes]) if (child.nodeName !== 'SUMMARY') content.append(child);
  content.prepend(row); preferences.append(content);
  function apply() {
    const light = mode === 'light' || mode === 'auto' && (native && typeof nativeLight === 'boolean' ? nativeLight : !media.matches);
    doc.documentElement.dataset.theme = light ? 'light' : 'dark';
    for (const button of row.querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.appearance === mode));
    doc.querySelector('meta[name="theme-color"]')?.setAttribute('content', light ? '#f4f5f7' : '#090a0c');
  }
  row.addEventListener('click', event => {
    const chosen = event.target.closest('button[data-appearance]')?.dataset.appearance;
    if (!modes.has(chosen)) return;
    if (native && nativeCall('appearance-preference', { mode: chosen }) !== true) return;
    mode = chosen;
    if (native) { const state = nativeCall('settings'); nativeLight = state?.appearanceLight; }
    else { try { win.localStorage.setItem('appleseed-appearance', mode); } catch {} }
    apply();
  });
  media.addEventListener('change', apply);
  win.addEventListener('appleseed-appearance', event => {
    if (!native || !modes.has(event.detail?.mode)) return;
    mode = event.detail.mode; nativeLight = event.detail.light; apply();
  });
  apply();
}
