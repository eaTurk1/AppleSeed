import test from 'node:test';
import assert from 'node:assert/strict';
import { StreamOptimizer, normalizeStreamMode } from '../public/stream-quality.js';
function fixture(mode) {
  const applied = [], handlers = new Map(); let time = 0;
  const client = { setStreamProfile: profile => applied.push(profile), addEventListener: (n,f) => handlers.set(n,f), removeEventListener: (n,f) => { if (handlers.get(n) === f) handlers.delete(n); } };
  const optimizer = new StreamOptimizer(client, mode, () => {}, () => time);
  return { optimizer, applied, handlers, advance: ms => time += ms };
}
test('Auto starts balanced, reduces load on slow streams, recovers gradually, and never flaps during cooldown', () => {
  const f = fixture('auto'); assert.equal(f.optimizer.profile, 'balanced');
  f.optimizer.sample({frameMs:500}); f.optimizer.sample({frameMs:500}); assert.equal(f.applied.length, 1);
  f.advance(6001); f.optimizer.sample({frameMs:500}); assert.equal(f.optimizer.profile, 'speed');
  for(let i=0;i<10;i++) f.optimizer.sample({frameMs:10}); assert.equal(f.optimizer.profile, 'speed');
  f.advance(6001); f.optimizer.sample({frameMs:10}); assert.equal(f.optimizer.profile, 'balanced');
  f.advance(6001); for(let i=0;i<6;i++) f.optimizer.sample({frameMs:10}); assert.equal(f.optimizer.profile, 'detail');
  f.advance(6001); f.optimizer.sample({latencyMs:600}); f.optimizer.sample({latencyMs:600}); assert.equal(f.optimizer.profile, 'speed');
});
test('manual modes remain fixed despite congestion and invalid choices fall back to Auto', () => {
  const f = fixture('quality'); f.advance(60000);
  for(let i=0;i<20;i++)f.optimizer.sample({frameMs:1000, queuedBytes:3000000});
  assert.equal(f.optimizer.profile,'detail'); assert.equal(f.applied.length,1);
  f.optimizer.setMode('speed'); assert.equal(f.applied.at(-1).quality,2);
  for(let i=0;i<20;i++)f.optimizer.sample({frameMs:1}); assert.equal(f.optimizer.profile,'speed');
  assert.equal(normalizeStreamMode('invalid'),'auto'); f.optimizer.setMode('invalid'); assert.equal(f.optimizer.profile,'balanced');
});
test('invalid samples and late events after disconnect cannot change the encoder', () => {
  const f = fixture('auto'); f.advance(60000);
  f.optimizer.sample({frameMs:NaN}); f.optimizer.sample({frameMs:-1}); assert.equal(f.applied.length,1);
  f.optimizer.destroy(); assert.equal(f.handlers.size,0);
  for(let i=0;i<20;i++)f.optimizer.sample({frameMs:1000}); f.optimizer.setMode('quality'); assert.equal(f.applied.length,1);
});
