import RFB from './apple-rfb.js';
import { DesktopController } from './desktop-controller.js';
import { StreamOptimizer, normalizeStreamMode, mountStreamControls } from './stream-quality.js';
import { mountPortalControl } from './portal-control.js';
import { SafeUnlock } from './safe-unlock.js';
import { mountAppearance } from './appearance.js';
import { mountQuickAccess } from './quick-access.js';
import { initLogging } from '/novnc/core/util/logging.js';

initLogging('error');
const $ = id => document.getElementById(id);
mountStreamControls(document);
let unlock = null;
const unlockHelp = $('typing').querySelector?.('p');
if (unlockHelp) unlockHelp.textContent = 'Choose your Mac account if needed, then tap Unlock Mac.';
let optimizer = null, streamMode = 'auto', appVisible = true, visibilityRevision = 0;
const native = /AppleSeed\/\d+\.\d+/.test(navigator.userAgent);
mountAppearance({ native, nativeCall });
const nativeInfo = native ? nativeCall('capabilities') || {} : {};
let rfb = null, connected = false, sharing = false, account = '', failure = '', connectionCredentials;
let sessionUsername = '', sessionPassword = '', sessionID = null, expiresAt = null, rememberAfterAuth = false, storedAttempt = false, typing = false, desktop = null, hostDisplays = [];
const toolsAvailable = true;
const quick = mountQuickAccess({ tools: toolsAvailable, connected: () => connected, connecting: () => !!rfb,
  connect: () => { if ($('connect').disabled) return false; $('connect').click(); return true; },
  manualLogin: () => { desktop?.toggleKeyboard(true); notify('Choose the operating system password field and use Keyboard to sign in.'); },
  beforeOpen: () => desktop?.toggleKeyboard(false), onHide: () => nativeCall('keyboard', { enabled: false }),
  cancelUnlock: () => unlock?.cancelPending(), refreshUnlock: () => unlock?.refresh(), notify });
const controlIDs = ['wake', 'tab-key', 'enter-key', 'backspace', 'escape', 'zoom', 'keyboard-toggle', 'trackpad-toggle', 'left-click', 'right-click', 'drag-toggle', 'fullscreen', 'tools-toggle'];
function nativeCall(op, value = {}) {
  if (!native) return null;
  if (window.AppleSeedBridge?.call) { try { return window.AppleSeedBridge.call({ op, ...value }); } catch { return null; } }
  try { return JSON.parse(window.prompt('AppleSeedNative', JSON.stringify({ op, ...value })) || 'null'); }
  catch { return null; }
}
function streamDescription() {
  $('stream-mode').value = streamMode; $('stream-mode-live').value = streamMode;
  $('stream-note').textContent = streamMode === 'quality' ? 'Sharper detail. Uses more bandwidth.' : streamMode === 'speed' ? 'Prioritize responsiveness and lower bandwidth.' : `Adjusts to the connection${optimizer ? '. Currently ' + optimizer.profileLabel.toLowerCase() + '.' : ' automatically.'}`;
}
for (const id of ['stream-mode', 'stream-mode-live']) $(id).addEventListener('change', () => {
  streamMode = normalizeStreamMode($(id).value); nativeCall('stream-preference', { mode: streamMode });
  optimizer?.setMode(streamMode); streamDescription();
});
function notify(message) {
  $('notification').textContent = message; $('notification').hidden = false;
  clearTimeout(notify.timer); notify.timer = setTimeout(() => $('notification').hidden = true, 6500);
}
function timerSeconds() {
  if (!$('timer-enabled').checked) return 0;
  const minutes = Number($('timer-minutes').value);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) throw new Error('Choose 1–1440 minutes, or turn the timer off.');
  return minutes * 60;
}
function timerDescription() {
  try {
    const seconds = timerSeconds(); $('timer-minutes').disabled = !seconds;
    $('timer-note').textContent = seconds ? `${seconds / 60} minutes from connection or Apply. Keeps running when you leave.` : nativeInfo.backgroundSession === false ? 'No timer. iOS can suspend the connection in the background.' : 'No timer. Stays connected until you disconnect.';
  } catch (error) { $('timer-note').textContent = error.message; }
}
function countdown() {
  if (!rfb) return;
  const remaining = expiresAt === null ? null : Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
  $('session-title').textContent = `${connected ? 'Connected' : 'Connecting…'}${remaining === null ? ' · No timer' : ` · ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`}`;
  if (remaining === 0) { failure = 'Your session timer ended.'; disconnect(); }
}
function typingState() {
  const armed = connected && appVisible && !document.hidden && !!unlock?.ready && !typing;
  if (armed && !$('screen-password').value && sessionPassword) $('screen-password').value = sessionPassword;
  $('screen-password').disabled = !armed;
  $('send-password').disabled = !armed || !$('screen-password').value;
  $('send-password').textContent = unlock?.busy ? 'Checking…' : unlock?.state.state === 'unlocked' ? 'Already unlocked' : 'Unlock Mac';
  const note = $('unlock-status');
  if (note) note.textContent = unlock?.state.error || (unlock?.state.state === 'unlocked' ? 'Mac is already unlocked.' : unlock?.busy ? 'Signing in…' : unlock?.state.lastOutcome === 'filled' ? 'Password filled. Tap the Mac login arrow to finish.' : 'Tap Unlock Mac. If you see two accounts, choose yours on the live screen first.');
}
function clearFields() {
  $('password').value = ''; $('screen-password').value = ''; $('focus-confirmed').checked = false;
  typingState();
}
function forgetCredentials() {
  if (connectionCredentials) { connectionCredentials.username = ''; connectionCredentials.password = ''; }
  connectionCredentials = null;
}
function memoryState() {
  if (!native) return;
  const state = nativeCall('settings');
  $('password-status').textContent = state?.saved ? 'PASSWORD REMEMBERED' : 'PASSWORD PRIVATE';
  $('saved-note').textContent = state?.saved ? 'Remembered on this device. Available through your private Tailscale connection.' : 'Remember a password next time you connect. Encrypted on this device.';
  $('forget-password').hidden = !state?.saved;
  $('remember-password').checked = !!state?.saved;
}
async function refresh() {
  const observedDesktop = desktop, observedOptimizer = optimizer, started = Date.now();
  try {
    const response = await fetch('/api/status', { cache: 'no-store' });
    if (!response.ok) throw new Error('access');
    const state = await response.json();
    if (connected && optimizer && optimizer === observedOptimizer && !document.hidden) optimizer.sample({ latencyMs: Date.now() - started });
    if (state.features) { quick.hostFeatures(state.features); $('tab-display').hidden = state.features.displaySettings === false; }
    sharing = state.sharing; account = state.account; hostDisplays = state.displays || [];
    if (desktop && desktop === observedDesktop && JSON.stringify(desktop.hostScreens) !== JSON.stringify(hostDisplays)) { desktop.hostScreens = hostDisplays; desktop.updateFrame(); }
    $('mac-name').textContent = state.name;
    if (state.startup === 'boot') $('startup-note').textContent = 'Starts at boot. Power-outage recovery still needs a controlled restart test.';
    $('status-pill').textContent = sharing ? '● ONLINE' : 'SETUP NEEDED';
    $('status-pill').classList.toggle('ready', sharing);
    $('status-message').textContent = sharing ? 'Mac online. Ready when you are.' : 'Enable Screen Sharing on your Mac to connect.';
    $('connect').disabled = !sharing || !!rfb || state.active;
    if (state.active && !rfb) $('status-message').textContent = 'A session is already open. Disconnect it before starting another.';
    if (!sharing) $('help').open = true;
    return state;
  } catch {
    sharing = false; $('status-pill').textContent = 'OFFLINE'; $('status-pill').classList.remove('ready');
    $('status-message').textContent = 'Cannot reach your Mac. Check Tailscale and refresh this page.';
    $('connect').disabled = true; return null;
  }
}
function disconnect() {
  clearFields(); if ($('credentials').open) $('credentials').close();
  if (rfb) rfb.disconnect();
}
function endSession(message) {
  unlock?.destroy(); unlock = null;
  optimizer?.destroy(); optimizer = null; streamDescription();
  desktop?.destroy(); desktop = null; document.body.classList.remove('in-session'); $('session-tools').hidden = true; $('preferences').open = false;
  quick.ended();
  connected = false; rfb = null; sessionID = null; expiresAt = null; sessionPassword = ''; sessionUsername = ''; typing = false;
  clearFields(); forgetCredentials(); nativeCall('session-end');
  if ($('credentials').open) $('credentials').close();
  $('session').hidden = true; $('intro').hidden = false;
  $('intro-settings').append($('preferences')); $('apply-timer').hidden = true;
  $('framebuffer').replaceChildren(); controlIDs.forEach(id => $(id).disabled = true);
  if (message) notify(message); refresh(); memoryState();
}
function submitCredentials(client, credentials, remember, reuse) {
  connectionCredentials = credentials; rememberAfterAuth = remember;
  sessionPassword = reuse ? credentials.password : ''; sessionUsername = reuse ? credentials.username : '';
  client.sendCredentials(connectionCredentials);
}
$('connect').addEventListener('click', async () => {
  if (rfb || !sharing) return;
  let seconds;
  try { seconds = timerSeconds(); } catch (error) { return notify(error.message); }
  $('connect').disabled = true;
  const state = await refresh();
  if (!state || !state.sharing || state.active || rfb) return;
  if (!window.isSecureContext) return notify('Open the HTTPS Tailscale address to connect securely.');
  if (native && nativeCall('session-start', { seconds }) !== true) return notify('Could not start the background session. Try again.');
  nativeCall('timer-preference', { seconds });
  failure = ''; connected = false; storedAttempt = false; rememberAfterAuth = false;
  sessionID = crypto.randomUUID(); expiresAt = seconds ? Date.now() + seconds * 1000 : null;
  $('intro').hidden = true; $('session').hidden = false; document.body.classList.add('in-session');
  $('session-settings').append($('preferences')); $('apply-timer').hidden = false; $('preferences').open = true;
  $('session-note').textContent = 'Authenticating with macOS Screen Sharing.';
  $('connect').disabled = true;
  try {
    const url = new URL('/ws', location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('seconds', seconds); url.searchParams.set('session', sessionID);
    const client = new RFB($('framebuffer'), url.href, { shared: true }); rfb = client; countdown();
    client.scaleViewport = false; client.resizeSession = false; client.showDotCursor = true;
    optimizer = new StreamOptimizer(client, streamMode, streamDescription); streamDescription();
    client.addEventListener('credentialsrequired', async event => {
      if (client !== rfb) return;
      const needsUsername = event.detail.types.includes('username');
      if (native && !storedAttempt) {
        storedAttempt = true;
        const saved = window.AppleSeedBridge?.invoke ? await window.AppleSeedBridge.invoke({op:'load'}) : nativeCall('load');
        if (client !== rfb) return;
        if (saved?.password && saved.macAccount === needsUsername && (!needsUsername || saved.username)) {
          submitCredentials(client, saved, false, needsUsername); return;
        }
      }
      $('username-label').hidden = !needsUsername; $('username').required = needsUsername;
      $('username').value = account; $('password').value = '';
      $('credential-note').textContent = needsUsername ? 'Enter your Mac password once. Reuse it to unlock the live screen.' : 'Enter the VNC password configured in Screen Sharing. It may differ from the Mac login password.';
      if (!$('credentials').open) $('credentials').showModal();
      $('password').focus();
    });
    client.addEventListener('securityfailure', () => failure = 'macOS rejected the connection. Use Forget password in Session settings if your remembered password changed.');
    client.addEventListener('connect', async () => {
      if (client !== rfb) return;
      connected = true;
      if (native && connectionCredentials && rememberAfterAuth) {
        if ((window.AppleSeedBridge?.invoke ? await window.AppleSeedBridge.invoke({op:'save',credentials:{...connectionCredentials}}) : nativeCall('save', { credentials: connectionCredentials })) !== true) notify('Connected, but the password could not be remembered.');
        if (client !== rfb) return;
      } else if (native && connectionCredentials && !storedAttempt && !$('remember-password').checked) nativeCall('forget');
      forgetCredentials(); clearFields(); memoryState();
      if ($('credentials').open) $('credentials').close();
      $('session-note').textContent = 'Slide to move the cursor. Tap to click. Pinch to zoom.';
      desktop = new DesktopController(client, hostDisplays, nativeCall, { session: sessionID, notify, closeUnlock: () => quick.hide() });
      controlIDs.forEach(id => $(id).disabled = false); countdown();
      const unlockSession = sessionID;
      unlock = new SafeUnlock({ visible: () => connected && appVisible && !document.hidden && !$('panel-unlock').hidden && sessionID === unlockSession, changed: typingState, request: async (value, { signal } = {}) => {
        const response = await fetch('/api/unlock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...value, session: unlockSession }), signal });
        if (response.status === 404 || response.status === 503) throw new Error('Safe unlock unavailable');
        const result = await response.json(); return result;
      } });
      quick.connected();
      unlock.refresh();
    });
    client.addEventListener('disconnect', event => {
      if (client !== rfb) return;
      endSession(failure || client.disconnectReason || (event.detail.clean ? 'Disconnected. Your session is closed.' : 'Connection ended. Check Tailscale and Screen Sharing.'));
    });
  } catch { endSession('Unable to start the screen connection. Refresh and try again.'); }
});
$('credential-form').addEventListener('submit', event => {
  event.preventDefault();
  if (!rfb) return;
  // Username-required authentication is the Mac account. Classic VNC may use another password.
  submitCredentials(rfb, { username: $('username').value, password: $('password').value, macAccount: !$('username-label').hidden }, native && $('remember-password').checked, !$('username-label').hidden);
  $('password').value = ''; $('credentials').close();
});
$('cancel-auth').addEventListener('click', disconnect);
$('credentials').addEventListener('cancel', disconnect);
$('disconnect').addEventListener('click', disconnect);
for (const [id, keysym, code] of [['wake',0xffe1,'ShiftLeft'],['tab-key',0xff09,'Tab'],['enter-key',0xff0d,'Enter'],['backspace',0xff08,'Backspace'],['escape',0xff1b,'Escape']]) {
  $(id).addEventListener('click', () => { if (connected) rfb.sendKey(keysym, code); });
}
$('focus-confirmed').addEventListener('change', typingState);
$('screen-password').addEventListener('input', typingState);
$('typing').addEventListener('submit', async event => {
  event.preventDefault();
  if (!unlock?.ready || typing || !appVisible || document.hidden) { clearFields(); return; }
  let password = $('screen-password').value;
  if (!password) return;
  typing = true; clearFields(); desktop?.release();
  const current = unlock;
  try {
    const result = await current.submit(password);
    if (current === unlock && result) notify(result.error || result.message || 'Unlock requested. Waiting for macOS.');
  } finally { password = ''; typing = false; typingState(); }
});
for (const id of ['timer-enabled', 'timer-minutes']) $(id).addEventListener('change', () => {
  timerDescription(); try { if (!rfb) nativeCall('timer-preference', { seconds: timerSeconds() }); } catch {}
});
$('timer-minutes').addEventListener('input', timerDescription);
$('apply-timer').addEventListener('click', async () => {
  if (!rfb || !sessionID) return;
  const id = sessionID;
  try {
    const seconds = timerSeconds();
    const response = await fetch('/api/session/timer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session: id, seconds }) });
    if (!response.ok) throw new Error('Could not update the session timer.');
    const state = await response.json(); if (id !== sessionID) return;
    expiresAt = state.expiresAt; nativeCall('timer-preference', { seconds });
    if (native && nativeCall('session-start', { seconds }) !== true) notify('Mac timer updated, but the Android notification could not be updated.');
    countdown(); notify(seconds ? `Timer set to ${seconds / 60} minutes from now.` : 'Timer off. Your session stays connected.');
  } catch (error) { notify(error.message); }
});
$('forget-password').addEventListener('click', () => {
  if (nativeCall('forget') !== true) return notify('Could not forget the password. Try again.');
  sessionPassword = ''; clearFields(); memoryState(); notify('Remembered password removed from this phone.');
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { visibilityRevision++; unlock?.cancelPending(); }
  desktop?.release(); clearFields(); if (!document.hidden) { countdown(); refresh(); unlock?.refresh(); }
});
// A retained native WebView can lose its window without losing its transport.
window.addEventListener('appleseed-visibility', event => {
  appVisible = event.detail.visible;
  if (!appVisible) { visibilityRevision++; unlock?.cancelPending(); }
  desktop?.release(); clearFields();
  if (!appVisible) { desktop?.toggleKeyboard(false); $('password').blur(); }
  else { countdown(); refresh(); unlock?.refresh(); }
});
window.addEventListener('pagehide', event => { if (!native && !event.persisted) disconnect(); });
$('intro-settings').append($('preferences'));
if (native) {
  $('remember-label').hidden = false; $('remembered-settings').hidden = false;
  $('remember-note').textContent = `Encrypted with ${nativeInfo.storageLabel || 'device storage'}. Available while your private Tailscale connection is reachable.`;
  const settings = nativeCall('settings');
  streamMode = normalizeStreamMode(settings?.streamMode);
  if (Number.isInteger(settings?.seconds) && settings.seconds >= 0 && settings.seconds <= 86400) {
    $('timer-enabled').checked = settings.seconds !== 0; $('timer-minutes').value = settings.seconds ? settings.seconds / 60 : 10;
  }
  memoryState();
}
streamDescription(); timerDescription(); refresh(); setInterval(refresh, 15_000); setInterval(countdown, 1000);

$('choose-mac').addEventListener('click', () => nativeCall('configure'));

function refreshUnlock() { if (connected && appVisible && !document.hidden && !$('panel-unlock').hidden) unlock?.refresh(); }
setInterval(refreshUnlock, 1000);
$('tab-unlock').addEventListener('click', refreshUnlock);
$('close-tools').addEventListener('click', () => unlock?.cancelPending());
for (const tab of ['controls', 'display', 'session']) $(`tab-${tab}`).addEventListener('click', () => unlock?.cancelPending());
$('tools-toggle').addEventListener('click', refreshUnlock);
// Back dismisses the current control layer before leaving the app.
window.appleSeedBack = () => {
  const dialog = document.querySelector('dialog[open]');
  if (dialog) { if (dialog.id === 'credentials') disconnect(); else dialog.close(); return true; }
  if (!$('session-tools').hidden) { $('session-tools').hidden = true; unlock?.cancelPending(); return true; }
  if (quick.visible) { quick.hide(); return true; }
  if (!$('keyboard-panel').hidden) { desktop?.toggleKeyboard(false); return true; }
  if (desktop?.dismissFullscreen?.()) return true;
  if (rfb && !connected) { disconnect(); return true; }
  return false;
};

if (toolsAvailable) mountPortalControl({ buttons: [quick.homePortal, quick.livePortal], notify, copyCode: code => nativeCall('copy-portal-code', { code }) === true, credentials: async () => sessionPassword ? { username: sessionUsername, password: sessionPassword, macAccount: true } : window.AppleSeedBridge?.invoke ? await window.AppleSeedBridge.invoke({op:'load'}) : nativeCall('load') });

const support = document.createElement('a'); support.className = 'support-link'; support.href = 'https://erhan.ai/appleseed/#support'; support.target = '_blank'; support.rel = 'noopener noreferrer'; support.textContent = 'Support AppleSeed · optional';
if (native) support.addEventListener('click', event => { event.preventDefault(); nativeCall('support'); });
$('preferences').append(support);
