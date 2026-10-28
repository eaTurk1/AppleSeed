// Disposable local UI fixture: two synthetic monitors, no Mac credentials or input.
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server.mjs';
import { HandshakeReader } from '../rfb-auth.mjs';
import { readFile } from 'node:fs/promises';
let layout = [{ id: '101', x: 0, y: 0, width: 960, height: 1080 }, { id: '102', x: 960, y: 0, width: 960, height: 1080 }];
const viewers = new Set();
// Never route synthetic preview passwords to the owner's real Mac companion.
const previewCycle = randomUUID(); let previewNonce = randomUUID();
async function previewUnlock(value) {
  if (value.op === 'unlock-status') return { ok: true, protocol: 2, state: 'locked', ready: true, pending: false,
    cycle: previewCycle, nonce: previewNonce, accessibility: true };
  if (value.op !== 'unlock-submit' || value.cycle !== previewCycle || value.nonce !== previewNonce) return { ok: false, sent: false, error: 'Synthetic fixture rejected stale entry.' };
  previewNonce = randomUUID();
  return { ok: true, pending: false, submitted: true, message: 'Synthetic test only. No Mac password was entered.' };
}

let fakePower = {ok:true, available:true, powerWritable:true, sources:[{source:'ac', label:'Power adapter', displayMinutes:20, sleepMinutes:0}], saverSeconds:null, saverDefault:true, saverManaged:false, awake:'normal', covered:0};
async function previewScreens(v) {
 if (v.op==='save') { fakePower.sources[0].displayMinutes=v.displayMinutes; fakePower.sources[0].sleepMinutes=v.sleepMinutes; if(v.saverSeconds!==undefined) {fakePower.saverSeconds=v.saverSeconds;fakePower.saverDefault=v.saverSeconds===null;} }
 if (v.op==='awake') fakePower.awake=v.mode;
 if (v.op==='end') {fakePower.awake='normal';}
 return {...fakePower};
}
const dimensions = () => ({ width: Math.max(...layout.map(s => s.x + s.width)), height: Math.max(...layout.map(s => s.y + s.height)) });
const sockets = new Set();
let pointerCount = 0, keyCount = 0;
function rect(x, y, width, height, encoding, data) {
  const header = Buffer.alloc(12); header.writeUInt16BE(x, 0); header.writeUInt16BE(y, 2); header.writeUInt16BE(width, 4); header.writeUInt16BE(height, 6); header.writeInt32BE(encoding, 8); return Buffer.concat([header, data]);
}
function frames() {
  const { width, height } = dimensions();
  const screens = Buffer.alloc(4 + layout.length * 16); screens[0] = layout.length;
  for (let i = 0; i < layout.length; i++) { const s = layout[i], offset = 4 + i * 16; screens.writeUInt32BE(Number(s.id), offset); screens.writeUInt16BE(s.x, offset + 4); screens.writeUInt16BE(s.y, offset + 6); screens.writeUInt16BE(s.width, offset + 8); screens.writeUInt16BE(s.height, offset + 10); }
  const filled = (color, panels) => { const payload = Buffer.alloc(8 + panels.length * 12); payload.writeUInt32BE(panels.length); Buffer.from(color).copy(payload, 4); panels.forEach((p, i) => { const offset = 8 + i * 12; Buffer.from(p[0]).copy(payload, offset); for (let j = 0; j < 4; j++) payload.writeUInt16BE(p[j + 1], offset + 4 + j * 2); }); return payload; };
  const packets = [rect(0, 0, width, height, -308, screens)];
  layout.forEach((s, i) => { const inset = 25, w = s.width - inset * 2, h = s.height - 95; packets.push(rect(s.x, s.y, s.width, s.height, 2, filled([18,16,14,0], [[[43,38,34,0],inset,50,w,h], [[90,i ? 80 : 170,i ? 235 : 65,0],inset+18,75,Math.min(w-36,170),22], [[94,94,100,0],inset+18,130,w-36,8], [[94,94,100,0],inset+18,162,Math.max(10,w-85),8], [[70,70,76,0],inset+18,210,w-36,Math.max(12,h-220)]]))); });
  return Buffer.concat([Buffer.from([0,0,0,packets.length]), ...packets]);
}
const mock = net.createServer(socket => {
  sockets.add(socket); socket.on('close', () => { sockets.delete(socket); viewers.delete(socket); }); socket.on('error', () => {});
  socket.write('RFB 003.008\n'); let input = Buffer.alloc(0), phase = 0, painted = false;
  socket.on('data', chunk => {
    input = Buffer.concat([input, chunk]);
    while (input.length) {
      if (phase === 0) { if (input.length < 12) return; input = input.subarray(12); socket.write(Buffer.from([1,1])); phase++; continue; }
      if (phase === 1) { input = input.subarray(1); socket.write(Buffer.alloc(4)); phase++; continue; }
      if (phase === 2) { input = input.subarray(1); const name = Buffer.from('AppleSeed gesture test · synthetic monitors'); const init = Buffer.alloc(24); init.writeUInt16BE(dimensions().width); init.writeUInt16BE(dimensions().height,2); init[4]=32; init[5]=24; init[7]=1; init.writeUInt16BE(255,8); init.writeUInt16BE(255,10); init.writeUInt16BE(255,12); init[14]=16; init[15]=8; init.writeUInt32BE(name.length,20); socket.write(Buffer.concat([init,name])); phase++; continue; }
      const type = input[0]; let length;
      if (type === 0) length = 20;
      else if (type === 2) { if (input.length < 4) return; length = 4 + input.readUInt16BE(2) * 4; }
      else if (type === 3) length = 10;
      else if (type === 4) length = 8;
      else if (type === 5) length = 6;
      else if (type === 6) { if (input.length < 8) return; length = 8 + input.readUInt32BE(4); }
      else if (type === 150) length = 10;
      else return socket.destroy();
      if (input.length < length) return;
      if (type === 3 && !painted) { painted = true; viewers.add(socket); socket.write(frames()); }
      if (type === 4) keyCount++;
      if (type === 5) pointerCount++;
      input = input.subarray(length);
    }
  });
});
mock.listen(0, '127.0.0.1', () => {
  const app = createApp({ port: 18797, deviceName: 'Demo Mac', accountName: 'demo', vncPort: mock.address().port, powerCommand: previewScreens, unlockCommand: previewUnlock,
    portalURL: 'https://127.0.0.1:18797/appleseed/remote',
    portalAuthenticate: async ({ connected }) => {
      const socket = net.createConnection({ host: '127.0.0.1', port: mock.address().port }); connected(socket);
      const reader = new HandshakeReader(socket); await reader.read(12); socket.write('RFB 003.008\n'); await reader.read(2); socket.write(Buffer.from([1])); await reader.read(4);
      return { socket, reader };
    }
  });
  // Loopback-only synthetic browser fixture. Never copy this adapter to runtime.
  // It supplies the HTTPS proxy headers without publishing or connecting to a Mac.
  for (const event of ['request', 'upgrade']) {
    const original = app.server.listeners(event)[0]; app.server.removeListener(event, original);
    app.server.on(event, async (req, ...args) => {
      if(event==='request' && req.url==='/phone-fixture') {
        const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
        args[0].writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});
        return args[0].end(html.replace('<head>','<head><script src="/fixture-native.js"></script>'));
      }
      if(event==='request' && req.url==='/fixture-native.js') {
        args[0].writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'});
        return args[0].end(`Object.defineProperty(navigator,'userAgent',{value:navigator.userAgent+' AppleSeed/2.0'});window.prompt=(message,data)=>{const v=JSON.parse(data);if(v.op==='appearance-preference'){localStorage.setItem('fixture-appearance',v.mode);return 'true';}return JSON.stringify(v.op==='capabilities'?{native:true,tools:true,landscape:false}:v.op==='settings'?{saved:false,seconds:0,appearance:localStorage.getItem('fixture-appearance')||'auto',appearanceLight:!matchMedia('(prefers-color-scheme: dark)').matches}:v.op==='load'?{username:'fixture',password:'fixture',macAccount:true}:true);};`);
      }
      if (req.url.startsWith('/appleseed/remote')) { if(req.headers.origin === 'http://127.0.0.1:18797') req.headers.origin = 'https://127.0.0.1:18797'; app.portal.server.emit(event, req, ...args); }
      else original(req, ...args);
    });
  }
  app.portal.enable({ seconds: 3600, username: 'fixture', password: 'fixture' }).then(state => console.log('Synthetic portal code: ' + state.code));
  app.server.listen(18797, '127.0.0.1', () => console.log('Gesture preview (simulated desktop): http://127.0.0.1:18797'));
  process.on('SIGTERM', async () => { await app.close(); for (const socket of sockets) socket.destroy(); mock.close(); console.log(JSON.stringify({ pointerEventsReceived: pointerCount, keyEventsReceived: keyCount })); process.exit(0); });
});
