export function mountPortalControl({ credentials, notify, copyCode = () => false, buttons = [], document: doc = document }) {
  const button = doc.createElement('button'); button.type = 'button'; button.className = 'secondary portal-open'; button.textContent = 'Web Portal';
  if (!buttons.length) doc.querySelector('header').append(button);
  const dialog = doc.createElement('dialog'); dialog.id = 'travel-portal';
  dialog.innerHTML = `<form method="dialog"><div class="tools-title"><strong>Web Portal</strong><button class="secondary" aria-label="Close Web Portal">✕</button></div></form><p class="small">Browser access from a computer without Tailscale. Enable only when you need it.</p><label for="portal-minutes">Allow access for <input id="portal-minutes" type="number" min="1" max="720" value="60" inputmode="numeric"> minutes</label><p id="portal-address" class="small"></p><div class="portal-code-row"><output id="portal-code" aria-label="One-use portal code" hidden></output><button id="portal-copy" class="secondary" type="button" hidden disabled>Copy code</button></div><p id="portal-state" class="small" role="status">Checking…</p><div class="dialog-buttons"><button id="portal-disable" class="secondary" disabled>Disable now</button><button id="portal-enable" class="primary" disabled>Enable portal</button></div><p class="small">Code expires in 5 minutes. Closing this app leaves the portal on until its timer ends. Disable closes every browser window immediately.</p>`;
  doc.body.append(dialog);
  const $ = id => doc.getElementById(id); let busy = false, known = null, operation = 0, copyReset;
  const apply = state => {
    known = state; $('portal-address').textContent = state.url || '';
    $('portal-enable').disabled = busy || !state.configured;
    $('portal-enable').textContent = state.enabled ? 'New session' : 'Enable portal';
    $('portal-disable').disabled = busy || !state.enabled;
    $('portal-state').textContent = !state.configured ? 'The Mac portal route needs to be set up first.' : !state.enabled ? 'Off. Browser access is unavailable.' : state.paired ? `Connected browser · ${state.viewers} window${state.viewers === 1 ? '' : 's'}. Ends ${new Date(state.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` : state.codeExpiresAt <= Date.now() ? 'Code expired. Start a new session.' : $('portal-code').textContent ? 'Enabled. Enter this one-use code in your computer’s browser.' : 'Enabled. Choose New session to generate a code on this phone.';
    if (!state.enabled || state.paired || state.codeExpiresAt <= Date.now()) { $('portal-code').hidden = true; $('portal-code').textContent = ''; }
    $('portal-copy').hidden = $('portal-code').hidden;
    $('portal-copy').disabled = busy || $('portal-code').hidden;
  };
  async function refresh() {
    try { const response = await fetch('/api/portal', { cache: 'no-store' }); if (!response.ok) throw new Error(); apply(await response.json()); }
    catch { $('portal-state').textContent = 'Update or start the Mac service to use the Web Portal.'; $('portal-enable').disabled = true; }
  }
  const open = () => { if (!dialog.open) dialog.showModal(); refresh(); };
  if (buttons.length) for (const launcher of buttons) launcher.addEventListener('click', open);
  else {
    button.addEventListener('click', open);
    const liveButton = button.cloneNode(true); liveButton.classList.remove('portal-open'); liveButton.classList.add('portal-session-open');
    doc.getElementById('panel-session').prepend(liveButton); liveButton.addEventListener('click', open);
  }
  async function change(op) {
    if (busy && op !== 'disable') return; const current = ++operation; busy = true; $('portal-enable').disabled = true; $('portal-disable').disabled = op === 'disable';
    clearTimeout(copyReset); $('portal-copy').textContent = 'Copy code'; $('portal-copy').disabled = true;
    $('portal-state').textContent = op === 'disable' ? 'Disabling…' : 'Checking Mac authorization…';
    let value = { op };
    try {
      if (op === 'enable') {
        const minutes = Number($('portal-minutes').value); if (!Number.isInteger(minutes) || minutes < 1 || minutes > 720) throw new Error('Choose 1 to 720 minutes.');
        const saved = await credentials(); if (!saved?.password || saved.macAccount && !saved.username) throw new Error('Connect to your Mac with its account first, then enable the portal.');
        Object.assign(value, { username: saved.username || 'vnc', password: saved.password, seconds: minutes * 60 });
      }
      const response = await fetch('/api/portal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
      const state = await response.json(); if (!response.ok) throw new Error(state.error || 'Portal could not be changed.');
      if (current !== operation) return;
      busy = false;
      if (state.code) { $('portal-code').textContent = state.code.slice(0,4) + ' ' + state.code.slice(4); $('portal-code').hidden = false; }
      apply(state);
      notify(op === 'disable' ? 'Portal disabled. Browser access ended.' : 'Portal enabled. Use the code on your computer.');
    } catch (error) { if (current === operation) $('portal-state').textContent = error.message; }
    finally { value.password = ''; value.username = ''; if (current === operation) { busy = false; $('portal-disable').disabled = !known?.enabled; $('portal-enable').disabled = !known?.configured; } }
  }
  $('portal-enable').addEventListener('click', () => change('enable'));
  $('portal-disable').addEventListener('click', () => change('disable'));
  $('portal-copy').addEventListener('click', () => {
    if (busy || !known?.enabled || known.paired || known.codeExpiresAt <= Date.now()) return;
    const code = $('portal-code').textContent.replace(/ /g, '');
    if (!/^[2-9A-HJ-NP-Z]{8}$/.test(code)) return;
    try {
      if (copyCode(code) !== true) { $('portal-state').textContent = 'Update AppleSeed to use Copy code.'; return; }
      $('portal-copy').textContent = 'Copied'; clearTimeout(copyReset);
      copyReset = setTimeout(() => { $('portal-copy').textContent = 'Copy code'; }, 2000);
    } catch { $('portal-state').textContent = 'Could not copy the code. Try again.'; }
  });
  setInterval(() => { if (dialog.open && !busy) refresh(); }, 3000);
  return { refresh, open };
}
