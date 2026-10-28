// Keep quick actions in normal layout flow so unlocking never covers the desktop.
export function mountQuickAccess({ document: doc = document, tools = true, connected = () => false, connecting = () => false, connect, manualLogin = () => {}, beforeOpen = () => {}, onHide = () => {}, cancelUnlock = () => {}, refreshUnlock = () => {}, notify = () => {} }) {
  const $ = id => doc.getElementById(id);
  const icon = kind => kind === 'unlock' ? '<path d="M8 10V7a4 4 0 0 1 7.5-2M6 10h12v10H6Z"/><path d="M12 14v2"/>' : '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z"/>';
  const button = (id, label, kind) => {
    const el = doc.createElement('button'); el.id = id; el.type = 'button'; el.className = 'secondary quick-action';
    el.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icon(kind)}</svg><span>${label}</span>`;

    return el;
  };
  const home = doc.createElement('div'); home.className = 'home-quick-actions'; home.setAttribute('aria-label','Quick access');
  const homeUnlock = button('home-unlock', 'Unlock Mac', 'unlock'), homePortal = button('home-portal', 'Web Portal', 'portal');
  home.append(homeUnlock, homePortal); $('connect').after(home);
  const liveUnlock = button('quick-unlock', 'Unlock', 'unlock'), livePortal = button('quick-portal', 'Web Portal', 'portal');
  const toolbar = $('tools-toggle').parentElement; toolbar.prepend(liveUnlock, livePortal); toolbar.classList.add('with-quick-actions');
  const dock = $('panel-unlock'); dock.classList.add('unlock-dock'); dock.setAttribute('role','region'); dock.setAttribute('aria-label','Mac unlock controls');
  toolbar.before(dock); dock.hidden = true;
  // Retain existing field/form IDs so the security path and older Mac HTML work.
  $('typing').classList.add('dock-form'); $('wake').textContent = 'Wake'; $('wake').setAttribute('aria-label','Wake Mac login screen');
  const close = doc.createElement('button'); close.id = 'close-unlock'; close.type = 'button'; close.className = 'secondary dock-close'; close.textContent = '×'; close.setAttribute('aria-label','Close unlock controls'); dock.append(close);
  $('tab-unlock').hidden = true;
  let requested = false, safeUnlock = true;
  function hide() {
    dock.hidden = true; liveUnlock.setAttribute('aria-pressed','false'); cancelUnlock();
    $('screen-password').blur(); onHide();
  }
  function show() {
    if (!safeUnlock) { manualLogin(); return; }
    beforeOpen();
    $('session-tools').hidden = true;
    $('keyboard-panel').hidden = true;
    dock.hidden = false; liveUnlock.setAttribute('aria-pressed','true');
    refreshUnlock();
  }
  function openUnlock() {
    if (connected()) { show(); return; }
    requested = true;
    if (!connecting() && connect() !== true) { requested = false; notify('Connect Tailscale and your Mac, then try Unlock Mac.'); }
  }
  homeUnlock.addEventListener('click', openUnlock);
  liveUnlock.addEventListener('click', () => {
    if (!dock.hidden) hide(); else openUnlock();
  });
  close.addEventListener('click',hide);
  $('tab-unlock').addEventListener('click',show);
  for (const id of ['tools-toggle','keyboard-toggle']) $(id).addEventListener('click',() => { if (!dock.hidden) hide(); });
  return {
    homePortal, livePortal, show, hide,
    hostFeatures(features) { safeUnlock = features.safeUnlock !== false; homeUnlock.querySelector('span').textContent = safeUnlock ? 'Unlock Mac' : 'Open desktop'; liveUnlock.querySelector('span').textContent = safeUnlock ? 'Unlock' : 'Login'; },
    connected() { if (requested) { requested = false; show(); } },
    ended() { requested = false; hide(); },
    get visible() { return !dock.hidden; },
  };
}
