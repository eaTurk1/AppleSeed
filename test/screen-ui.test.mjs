import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=(await readFile(new URL('../public/screen-settings.js',import.meta.url),'utf8')).replace('export class ScreenSettings','class ScreenSettings')+'\nthis.Controller=ScreenSettings;';
function fixture() {
 const elements=new Map(),calls=[],notices=[];let resolve,delay=false;
 const get=id=>{if(!elements.has(id))elements.set(id,{value:'',hidden:false,checked:false,handlers:{},attrs:{},addEventListener(n,f){this.handlers[n]=f},removeEventListener(n){delete this.handlers[n]},setAttribute(n,v){this.attrs[n]=v},replaceChildren(...options){this.value=options[0]?.value||''}});return elements.get(id)};
 const state={ok:true,available:true,powerWritable:true,sources:[{source:'ac',label:'Power adapter',displayMinutes:20,sleepMinutes:0}],saverSeconds:null,saverDefault:true,awake:'normal'};
 const desktop={$:get,release(){},nativeCall(){return null}};
 const context={Option:class{constructor(name,value){this.value=value}},fetch:async(url,args)=>{assert.equal(url,'/api/screen');const v=JSON.parse(args.body);calls.push(v);if(delay)await new Promise(r=>resolve=r);if(v.op==='save'){state.sources[0].displayMinutes=v.displayMinutes;state.sources[0].sleepMinutes=v.sleepMinutes;state.saverSeconds=v.saverSeconds;state.saverDefault=v.saverSeconds===null;}return {ok:true,json:async()=>({...state})};}};
 vm.runInNewContext(source,context);const controller=new context.Controller(desktop,{session:'session',notify:n=>notices.push(n)});
 return {controller,desktop,get,calls,notices,delay(){delay=true},finish(){resolve()}};
}
test('timer inputs distinguish zero Never and Mac default, reject empty/fractional/out-of-range values',async()=>{
 const f=fixture();await f.controller.refresh();assert.equal(f.get('display-minutes').value,20);assert.equal(f.get('saver-default').checked,true);
 f.get('display-minutes').value='';await f.controller.save();assert.equal(f.calls.length,1);
 f.get('display-minutes').value='15';f.get('sleep-minutes').value='0';f.get('saver-default').checked=false;f.get('saver-minutes').value='2.5';await f.controller.save();assert.equal(f.calls.length,1);
 f.get('saver-minutes').value='0';await f.controller.save();assert.equal(f.calls[1].saverSeconds,0);assert.equal(f.calls[1].sleepMinutes,0);
 f.get('saver-default').checked=true;f.get('display-minutes').value='15';f.get('sleep-minutes').value='0';await f.controller.save();assert.equal(f.calls[2].saverSeconds,null);
});
test('late display responses cannot repaint a disconnected session',async()=>{
 const f=fixture();f.delay();const pending=f.controller.refresh();while(!f.calls.length) await new Promise(r=>setImmediate(r));f.controller.destroy();f.finish();await pending;
 assert.deepEqual(Object.keys(f.controller.state),[]);assert.equal(Object.keys(f.get('display-refresh').handlers).length,0);
});

