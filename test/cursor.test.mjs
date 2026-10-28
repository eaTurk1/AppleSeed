import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = (await readFile(new URL('../public/apple-rfb.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '').replace('export default class AppleRFB', 'class AppleRFB') + '\nthis.AppleRFB = AppleRFB;';
test('own cursor disables noVNC fallback and all later cursor refreshes without touching a detached target', () => {
  let attached = true, nativeRefreshes = 0;
  class RFB {
    constructor() { this._canvas = { style: {} }; this._screen = { style: {} }; this._cursor = { detach() { attached = false; }, change() { if (!attached) throw new Error('Detached cursor target'); nativeRefreshes++; } }; }
    set showDotCursor(value) { this._refreshCursor(); }
    _refreshCursor() { this._cursor.change(); }
  }
  const context = { RFB }; vm.runInNewContext(source, context);
  const client = new context.AppleRFB(); client._refreshCursor(); assert.equal(nativeRefreshes, 1);
  client.prepareViewport(); client._refreshCursor(); client.showDotCursor = false;
  assert.equal(attached, false); assert.equal(nativeRefreshes, 1); assert.equal(client.canvas.style.cursor, 'none');
});

test('profiles negotiate real encoding preferences and retain desktop, input and cursor capabilities', async () => {
  const { encodings } = await import('../node_modules/@novnc/novnc/core/encodings.js');
  const messages = [];
  class RFB { constructor() { this._rfbConnectionState='connected'; this._fbDepth=24; this._sock={}; } }
  RFB.messages = {clientEncodings: (_, list) => messages.push(list)};
  const context = {RFB,encodings,supportsWebCodecsH264Decode:false}; vm.runInNewContext(source,context);
  const c = new context.AppleRFB();
  c.setStreamProfile({encoding:'speed',quality:2,compression:7});
  assert.ok(messages[0].indexOf(encodings.encodingJPEG)<messages[0].indexOf(encodings.encodingZRLE));
  c.setStreamProfile({encoding:'quality',quality:9,compression:2});
  assert.ok(messages[1].indexOf(encodings.encodingZRLE)<messages[1].indexOf(encodings.encodingJPEG));
  for(const list of messages) {
    assert.ok(list.every(Number.isInteger)); assert.ok(list.includes(encodings.pseudoEncodingExtendedDesktopSize));
    assert.ok(list.includes(encodings.pseudoEncodingExtendedMouseButtons)); assert.ok(list.includes(encodings.pseudoEncodingCursor));
  }
  assert.ok(messages[0].includes(encodings.pseudoEncodingQualityLevel0+2)); assert.ok(messages[1].includes(encodings.pseudoEncodingQualityLevel0+9));
});

test('partial frame timings include transfer/decode delay and complete frames emit one bounded sample', () => {
  let time=10, complete=false; const samples=[];
  class RFB {constructor(){this._sock={_rQlen:500,_rQi:200};} _framebufferUpdate(){return complete;} dispatchEvent(event){samples.push(event.detail);} }
  const context={RFB,performance:{now:()=>time},document:{hidden:false},CustomEvent:class{constructor(_,v){this.detail=v.detail;}}};
  vm.runInNewContext(source,context); const c=new context.AppleRFB();
  assert.equal(c._framebufferUpdate(),false); time=310; complete=true; assert.equal(c._framebufferUpdate(),true);
  assert.deepEqual({...samples[0]},{frameMs:300,queuedBytes:300});
  context.document.hidden=true; time=320; c._framebufferUpdate(); assert.equal(samples.length,1);
});
