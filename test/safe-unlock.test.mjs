import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SafeUnlock } from '../public/safe-unlock.js';
const locked = { ok: true, protocol: 2, state: 'locked', ready: true, nonce: 'nonce', cycle: 'cycle' };
function fixture() {
  let state = { ...locked }, visible = true, wait;
  const submissions = [];
  const unlock = new SafeUnlock({ visible: () => visible, request: async value => {
    if (value.op === 'status') { if (wait) await wait; return { ...state }; }
    submissions.push(value); return { ok: true, pending: false, submitted: true };
  } });
  return { unlock, submissions, state: value => state = value, visible: value => visible = value, wait: value => wait = value };
}
test('delayed locked video cannot send a password after the Mac reports unlocked', async () => {
  const f = fixture(); await f.unlock.refresh();
  f.state({ ...locked, state: 'unlocked', ready: false });
  await f.unlock.submit('fixture'); assert.equal(f.submissions.length, 0); assert.equal(f.unlock.ready, false);
});
test('concurrent taps send once, but the next explicit tap needs no cooldown or rearm step', async () => {
  const f = fixture(); await f.unlock.refresh();
  await Promise.all([f.unlock.submit('fixture'), f.unlock.submit('fixture')]);
  assert.equal(f.submissions.length, 1); assert.equal(f.unlock.ready, true);
  f.state({ ...locked, nonce: 'next-one-use-nonce' });
  await f.unlock.submit('corrected-fixture'); assert.equal(f.submissions.length, 2); assert.equal(f.submissions[1].nonce, 'next-one-use-nonce');
});
test('a tap always checks again even when it overlaps an older poll', async () => {
  let reads=0, submissions=0, finish;
  const unlock=new SafeUnlock({request:async value=>{
    if(value.op==='submit') { submissions++; return {}; }
    reads++; if(reads===1) { await new Promise(resolve=>finish=resolve); return locked; }
    return {...locked,state:'unlocked',ready:false};
  }});
  unlock.refresh(); const pending=unlock.submit('fixture'); finish(); await pending;
  assert.equal(reads,2); assert.equal(submissions,0);
});
test('background and foreground during a fresh check cancel the pending password', async () => {
  const f = fixture(); await f.unlock.refresh(); let finish;
  f.wait(new Promise(resolve => finish = resolve)); const pending=f.unlock.submit('fixture');
  f.visible(false); f.unlock.cancelPending(); f.visible(true); finish(); await pending;
  assert.equal(f.submissions.length,0);
});
test('old companion protocol cannot execute its unverified default-button behavior', async () => {
  const f=fixture(); f.state({...locked,protocol:undefined}); await f.unlock.submit('fixture');
  assert.equal(f.submissions.length,0); assert.match(f.unlock.state.error,/Update the Mac companion/);
});
test('a missing companion never sends a password; a new tap may check again', async () => {
  let calls=0;
  const unlock=new SafeUnlock({request:async()=>{calls++;throw Error('offline');}});
  await unlock.submit('fixture'); assert.equal(calls,1); assert.equal(unlock.busy,false); assert.equal(unlock.ready,true);
  await unlock.submit('fixture'); assert.equal(calls,2);
});
test('stalled polling is shared and times out without locking the interface', async () => {
  let count=0;
  const unlock=new SafeUnlock({timeoutMs:20,request:async()=>{count++;return new Promise(()=>{});}});
  await Promise.all([unlock.refresh(),unlock.refresh(),unlock.refresh()]);
  assert.equal(count,1); assert.equal(unlock.busy,false); assert.equal(unlock.ready,true);
});
test('lost response never automatically repeats; a later tap checks actual unlock state', async () => {
  let count=0, state=locked;
  const unlock=new SafeUnlock({timeoutMs:20,request:async value=>{
    if(value.op==='status')return state;
    count++;return new Promise(()=>{});
  }});
  await unlock.submit('fixture'); assert.equal(count,1); assert.equal(unlock.busy,false);
  state={...locked,state:'unlocked',ready:false}; await unlock.submit('fixture'); assert.equal(count,1);
});
test('field errors leave a single ordinary Unlock action available', async () => {
  let count=0;
  const unlock=new SafeUnlock({request:async value=>value.op==='status'?locked:(count++,{ok:false,sent:false,error:'Choose your account.'})});
  await unlock.submit('fixture'); assert.equal(unlock.ready,true);
  await unlock.submit('fixture'); assert.equal(count,2);
});
test('native entry never puts the password in a global event or presses an arbitrary default button', async()=>{
  const source=await readFile(new URL('../native/SafeUnlock.h',import.meta.url),'utf8');
  assert.doesNotMatch(source,/CGEventPost\s*\(|CGEventKeyboardSetUnicodeString|NSPasteboard|kAXDefaultButtonAttribute|AXUIElementPerformAction|AXConfirm|attemptedAt/);
  for(const expected of ['kAXSecureTextFieldSubrole','com.apple.loginwindow','AXUIElementSetAttributeValue(field,kAXValueAttribute','CGEventPostToPid(pid,event)','0x24','self.lockState','request[@"nonce"]']) assert.ok(source.includes(expected),expected);
});
