import RFB from './assets/apple-rfb.js';
import Keyboard from './assets/novnc/core/input/keyboard.js';
import { DesktopViewport, availableMonitors } from './assets/desktop-model.js';
import { StreamOptimizer } from './assets/stream-quality.js';
const $ = id => document.getElementById(id), view = new DesktopViewport();
let client, optimizer, screens = [], monitors = [], mask = 0, cursor = { x: 0, y: 0 }, ended = false;
const chosen = new URL(location.href).searchParams.get('monitor');
let selection = 'all', initialized = false, requestedIndex = chosen && /^[12]$/.test(chosen) ? Number(chosen) : null;
const keyboard = new Keyboard($('input'));
keyboard.onkeyevent = (keysym, code, down) => client?.sendKey(keysym, code, down);
function release() { keyboard._allKeysUp(); if (mask) { mask = 0; client?.sendPointer(cursor.x, cursor.y, 0); } }
function render() {
  if (!client?.canvas) return;
  const { crop, frameWidth, frameHeight, scale, tx, ty } = view;
  client.canvas.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`;
  client.canvas.style.clipPath = `inset(${crop.y}px ${Math.max(0, frameWidth-crop.x-crop.width)}px ${Math.max(0,frameHeight-crop.y-crop.height)}px ${crop.x}px)`;
}
function resize() { const r = $('viewport').getBoundingClientRect(); view.resize(r.width,r.height); render(); }
function frame() {
  const f = client.framebuffer; if (!f.width || !f.height) return;
  view.frame(f.width,f.height); monitors = availableMonitors(f.width,f.height,f.screens,screens);
  const previous = selection;
  if (requestedIndex && monitors[requestedIndex]) { selection = monitors[requestedIndex].id; requestedIndex = null; }
  const selected = monitors.find(m => m.id === selection) || monitors[0]; selection = selected.id;
  $('monitor').replaceChildren(...monitors.map(m => new Option(m.name,m.id))); $('monitor').value = selection;
  view.select(selected, initialized && previous === selection); initialized = true; resize();
  $('second').disabled = monitors.length < 3;
  $('notice').textContent = monitors.length >= 3 ? 'Two monitors available. Open a second window and move it to your other screen.' : screens.length > 1 ? 'macOS is sending one display. Reconnect after both monitors are online.' : 'One display detected by macOS.';
}
function stop(message) { if (ended) return; ended = true; release(); keyboard.ungrab(); optimizer?.destroy(); client?.disconnect(); $('notice').textContent = message; $('framebuffer').replaceChildren(); $('input').hidden = true; }
async function status() {
  try {
    const response = await fetch('./status', { cache: 'no-store' }); if (!response.ok) throw new Error();
    const state = await response.json(); screens = state.displays || [];
    if (client && !ended) frame(); return state;
  } catch { stop('Access ended. Enable a new session from your phone.'); return null; }
}
$('monitor').addEventListener('change', () => { release(); requestedIndex = null; selection = $('monitor').value; view.select(monitors.find(m => m.id === selection)); render(); $('input').focus(); });
$('quality').addEventListener('change', () => optimizer?.setMode($('quality').value));
$('fit').addEventListener('click', () => { view.fit(); render(); });
$('fullscreen').addEventListener('click', () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => {}));
$('second').addEventListener('click', () => {
  if (monitors.length < 3) return;
  selection = monitors[1].id; $('monitor').value = selection; view.select(monitors[1]); render();
  window.open('./?monitor=2', 'AppleSeedSecondMonitor', 'popup,width=1280,height=800');
});
$('end').addEventListener('click', async () => {
  try { const response = await fetch('./logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); if (!response.ok) throw new Error(); stop('Access ended.'); location.replace('./'); }
  catch { stop('This window closed. Use Disable on your phone to confirm access has ended everywhere.'); }
});
function point(event) { const r = $('input').getBoundingClientRect(); cursor = view.clampCursor(...Object.values(view.toRemote(event.clientX-r.left,event.clientY-r.top))); return cursor; }
$('input').addEventListener('pointermove', event => { const p=point(event); client?.sendPointer(p.x,p.y,mask); });
$('input').addEventListener('pointerdown', event => { event.preventDefault(); $('input').focus(); $('input').setPointerCapture(event.pointerId); const p=point(event); mask |= [1,2,4][event.button] || 0; client?.sendPointer(p.x,p.y,mask); });
$('input').addEventListener('pointerup', event => { event.preventDefault(); const p=point(event); mask &= ~([1,2,4][event.button] || 0); client?.sendPointer(p.x,p.y,mask); });
$('input').addEventListener('pointercancel',release);
$('input').addEventListener('contextmenu',event=>event.preventDefault());
$('input').addEventListener('wheel',event=>{
  event.preventDefault(); const r=$('input').getBoundingClientRect();
  if(event.ctrlKey){view.zoomAt(view.zoom*Math.exp(-event.deltaY/300),event.clientX-r.left,event.clientY-r.top);render();return;}
  const p=point(event), bit=Math.abs(event.deltaY)>=Math.abs(event.deltaX)?(event.deltaY>0?16:8):(event.deltaX>0?64:32);
  client?.sendPointer(p.x,p.y,mask|bit);client?.sendPointer(p.x,p.y,mask);
},{passive:false});
window.addEventListener('blur',release); window.addEventListener('resize',resize); window.addEventListener('pagehide',()=>stop('Window closed.'));
document.addEventListener('visibilitychange',()=>{if(document.hidden)release();});
if (await status()) {
  const url=new URL('./ws',location.href);url.protocol=location.protocol==='https:'?'wss:':'ws:';
  client=new RFB($('framebuffer'),url.href,{shared:true});client.resizeSession=false;
  optimizer=new StreamOptimizer(client,'auto');
  client.addEventListener('connect',()=>{client.prepareViewport(); keyboard.grab(); frame(); $('input').focus();});
  client.addEventListener('framebufferresize',frame);
  client.addEventListener('credentialsrequired',()=>stop('Mac authorization expired. Enable a new session from your phone.'));
  client.addEventListener('disconnect',()=>stop('Connection ended. Return to your phone to check portal access.'));
  setInterval(()=>{if(!ended)status();},5000);
}
