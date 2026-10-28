import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPowerController, parsePowerSettings, validateScreenRequest, powerHelper } from '../power-control.mjs';

test('power parsing distinguishes power sources and ignores unrelated system settings', () => {
 assert.deepEqual(parsePowerSettings('AC Power:\n sleep 0\n displaysleep 20\n autorestart 1\nBattery Power:\n displaysleep 5\n sleep 10\nUPS Power:\n displaysleep 3\n sleep 7\n'), [
  { source:'ac',label:'Power adapter',sleepMinutes:0,displayMinutes:20 },
  { source:'battery',label:'Battery',displayMinutes:5,sleepMinutes:10 },
  { source:'ups',label:'UPS',displayMinutes:3,sleepMinutes:7 }
 ]);
 for (const value of [{op:'save',source:'all',displayMinutes:5,sleepMinutes:0},{op:'save',source:'ac',displayMinutes:'5',sleepMinutes:0},{op:'save',source:'ac',displayMinutes:1441,sleepMinutes:0},{op:'save',source:'ac',displayMinutes:5,sleepMinutes:0,saverSeconds:-1},{op:'privacy',enabled:true},{op:'end'},{op:'awake',mode:'forever'},{op:'settings',pane:'arbitrary'}]) assert.equal(validateScreenRequest(value),false);
 assert.ok(validateScreenRequest({op:'save',source:'ac',displayMinutes:1440,sleepMinutes:0,saverSeconds:null}));
});
function fixture({ saverFails=false, rollbackFails=false }={}) {
 let displayMinutes=20,sleepMinutes=0,saverSeconds=null; const calls=[];
 const controller=createPowerController({
  execute:async (file,args)=>{
   calls.push({file,args});
   if(file==='/usr/bin/pmset') return `AC Power:\n displaysleep ${displayMinutes}\n sleep ${sleepMinutes}\n`;
   assert.equal(file,'/usr/bin/sudo'); assert.deepEqual(args.slice(0,2),['-n',powerHelper]);
   if(args[2]==='save') { if(rollbackFails && args[4]==='20') throw new Error('rollback failed'); displayMinutes=Number(args[4]);sleepMinutes=Number(args[5]); }
   return 'ready';
  },
  companion:async value=>{ if(value.op==='screen-save') { if(saverFails) return {ok:false,error:'Saver unavailable.'};saverSeconds=value.saverSeconds; }
   return {ok:true,available:true,saverManaged:false,saverSeconds,saverDefault:saverSeconds===null,awake:'normal'}; }
 }); return {controller,calls,state:()=>({displayMinutes,sleepMinutes,saverSeconds})};
}
test('saving verifies actual retained values and only sends fixed executable arguments',async()=>{
 const f=fixture(); const result=await f.controller({op:'save',session:'session',source:'ac',displayMinutes:15,sleepMinutes:0,saverSeconds:600});
 assert.equal(result.sources[0].displayMinutes,15);assert.equal(result.saverSeconds,600);
 assert.deepEqual(f.calls.find(c=>c.args[2]==='save').args,['-n',powerHelper,'save','ac','15','0']);
});
test('a screen saver failure rolls back power timers; rollback failure is reported honestly',async()=>{
 const f=fixture({saverFails:true}); await assert.rejects(f.controller({op:'save',session:'session',source:'ac',displayMinutes:15,sleepMinutes:0,saverSeconds:600}),/Power timers were restored/);
 assert.equal(f.state().displayMinutes,20);
 const broken=fixture({saverFails:true,rollbackFails:true}); await assert.rejects(broken.controller({op:'save',session:'session',source:'ac',displayMinutes:15,sleepMinutes:0,saverSeconds:600}),/Power timers may have changed/);
});
test('native root helper rejects argument injection and out-of-range timings before permission checks',{skip:process.platform==='win32'},()=>{
 const temporary=mkdtempSync(path.join(os.tmpdir(),'appleseed-power-validation-'));
 const binary=path.join(temporary,'power-control');
 try {
 const args=['-O2','native/PowerControl.c','-o',binary];
 execFileSync(process.platform==='darwin'?'/usr/bin/xcrun':'/usr/bin/cc',process.platform==='darwin'?['clang',...args]:args);
 for(const args of [['save','ac','-1','0'],['save','ac','1441','0'],['save','ac','1;echo','0'],['save','-a','20','0'],['save','ac','0.1','0'],['off','extra'],['shell','anything'],['save','ac','0','0','sleepnow']]) assert.equal(spawnSync(binary,args).status,64);
 if(process.getuid()!==0) assert.equal(spawnSync(binary,['save','ac','0','0']).status,77,'valid inputs still require the installed root permission');
 } finally { rmSync(temporary,{recursive:true,force:true}); }
});
