import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {AppsGesture} from '../public/desktop-model.js';
import {monitorForApp} from '../public/app-switcher.js';

test('three-finger upward swipe triggers once, then suppresses remaining contacts',()=>{
 let opened=0,time=0;const g=new AppsGesture(()=>opened++,()=>time);
 for(let i=0;i<3;i++)g.down(i,80+i*60,200,'touch');
 assert.equal(g.blocking,true);
 for(let i=0;i<3;i++)g.motion(i,80+i*60,100);
 time=200;g.up(0);assert.equal(opened,1);assert.equal(g.blocking,true);
 g.up(1);g.up(2);assert.equal(opened,1);assert.equal(g.blocking,false);
});
test('pinches, three-finger taps, cancellations, horizontal moves and extra contacts never open Apps',()=>{
 for(const mode of ['pinch','tap','cancel','horizontal','four','slow']){
  let opened=0,time=0;const g=new AppsGesture(()=>opened++,()=>time);
  const count=mode==='pinch'?2:3;
  for(let i=0;i<count;i++)g.down(i,i*60,200,'touch');
  if(mode==='four')g.down(3,240,200,'touch');
  for(let i=0;i<count;i++)g.motion(i,i*60+(mode==='horizontal'?120:0),mode==='tap'?200:100);
  time=mode==='slow'?2000:100;
  for(let i=0;i<4;i++)g.up(i,mode==='cancel');
  assert.equal(opened,0,mode);assert.equal(g.blocking,false,mode);
 }
});
test('app display mapping follows the correct monitor without inventing unshared displays',()=>{
 const hosts=[{id:'22'},{id:'33'}];
 assert.equal(monitorForApp('33',hosts,[{id:'all'},{id:'host-22'},{id:'host-33'}]),'host-33');
 assert.equal(monitorForApp('33',hosts,[{id:'all'},{id:'99'},{id:'100'}]),'100');
 assert.equal(monitorForApp('missing',hosts,[{id:'all'},{id:'99'},{id:'100'}]),null);
 assert.equal(monitorForApp('33',hosts,[{id:'all'}]),null);
});
const script=await readFile(new URL('../native/BrowserTabs.js',import.meta.url),'utf8');
function browserFixture(){
 const calls=[];
 const tab=(id,title)=>({id:()=>id,title:()=>title});
 const win={id:()=>22,activeTabIndex:()=>1,tabs:null};let tabs=[tab(1,'First'),tab(2,'Second')];
 const get=()=>tabs;get.title=()=>tabs.map(t=>t.title());get.id=()=>tabs.map(t=>t.id());win.tabs=get;
 const browser={running:()=>true,windows:()=>[win],activate:()=>calls.push('activate')};
 const c={Application:()=>browser};vm.runInNewContext(script,c);
 return {run:(op,target)=>JSON.parse(c.run(['com.google.Chrome',op,...(target?[JSON.stringify(target)]:[])])),reorder:()=>tabs.reverse(),close:()=>tabs=[],win,calls};
}
test('browser selection follows stable IDs after tab reordering and refuses a closed tab',()=>{
 const f=browserFixture();const list=f.run('list');assert.equal(list.tabs[1].tabId,'2');
 f.reorder();assert.equal(f.run('select',{windowId:'22',tabId:'2'}).ok,true);assert.equal(f.win.activeTabIndex,1);assert.deepEqual(f.calls,['activate']);
 f.close();assert.equal(f.run('select',{windowId:'22',tabId:'2'}).ok,false);assert.equal(f.calls.length,1);
});
test('tab metadata is limited to titles and references, with no URL or page script access',()=>{
 const f=browserFixture();const list=f.run('list');assert.deepEqual(Object.keys(list.tabs[0]).sort(),['active','tabId','title','window','windowId']);
 assert.doesNotMatch(script,/executeJavaScript|\.url\(|\.URL\(|\.source\(|\.text\(/);
});
