import test from 'node:test';
import assert from 'node:assert/strict';
import { mountQuickAccess } from '../public/quick-access.js';
function fixture({tools=true,online=true}={}) {
  const elements=new Map();
  class Element {
    constructor(){this.hidden=false;this.handlers={};this.attrs={};this.children=[];this.classList={add(){}};}
    set id(value){this._id=value;elements.set(value,this);} get id(){return this._id;}
    addEventListener(name,fn){(this.handlers[name]??=[]).push(fn);}
    click(){for(const fn of this.handlers.click||[])fn();}
    setAttribute(name,value){this.attrs[name]=value;}
    append(...nodes){for(const node of nodes){if(node.parentElement)node.parentElement.children=node.parentElement.children.filter(n=>n!==node);node.parentElement=this;this.children.push(node);}}
    prepend(...nodes){this.append(...nodes);this.children=this.children.filter(n=>!nodes.includes(n));this.children.unshift(...nodes);}
    after(node){this.parentElement.append(node);}
    before(node){this.parentElement.append(node);}
    blur(){this.blurred=true;} showModal(){this.open=true;}
  }
  const get=id=>{if(!elements.has(id)){const el=new Element();el.id=id;}return elements.get(id);};
  const shell=get('desktop-shell'), toolbar=get('live-toolbar'), card=get('device-card'), toolsPanel=get('session-tools');
  shell.append(get('screen'),toolbar); toolbar.append(get('tools-toggle')); card.append(get('connect')); toolsPanel.append(get('panel-unlock'));
  get('keyboard-panel').hidden=true;
  let connected=false,connecting=false,connections=0,cancelled=0,checks=0,releases=0,notices=[];
  const doc={getElementById:get,createElement:()=>new Element()};
  const quick=mountQuickAccess({document:doc,tools,connected:()=>connected,connecting:()=>connecting,
    connect:()=>{if(!online)return false;connections++;connecting=true;return true;},
    beforeOpen:()=>releases++,cancelUnlock:()=>cancelled++,refreshUnlock:()=>checks++,notify:value=>notices.push(value)});
  return {quick,get,shell,toolbar,toolsPanel,notices,get connections(){return connections;},get cancelled(){return cancelled;},get checks(){return checks;},get releases(){return releases;},connected(){connected=true;connecting=false;quick.connected();}};
}
test('home Unlock starts a connection and opens a separate dock without sending a password',()=>{
 const f=fixture(); f.get('home-unlock').click(); assert.equal(f.connections,1); assert.equal(f.quick.visible,false);
 f.connected(); assert.equal(f.quick.visible,true); assert.equal(f.get('session-tools').hidden,true); assert.equal(f.checks,1);
 assert.equal(f.get('panel-unlock').parentElement,f.shell,'Unlock occupies desktop layout space, outside Tools');
 assert.ok(!f.toolsPanel.children.includes(f.get('panel-unlock')));
});
test('live quick access opens and closes independently while preserving the stream',()=>{
 const f=fixture(); f.connected(); f.get('quick-unlock').click(); assert.equal(f.quick.visible,true);
 f.get('close-unlock').click(); assert.equal(f.quick.visible,false); assert.equal(f.cancelled,1); assert.equal(f.connections,0);
 f.get('quick-unlock').click(); f.get('keyboard-toggle').click(); assert.equal(f.quick.visible,false);
});
test('opening Tools closes the dock and a disconnected Mac clears the pending request',()=>{
 const f=fixture(); f.get('home-unlock').click(); f.quick.ended(); f.connected(); assert.equal(f.quick.visible,false);
 f.get('quick-unlock').click(); f.get('tools-toggle').click(); assert.equal(f.quick.visible,false);
});
test('all users get direct Unlock without an upgrade gate',()=>{
 const f=fixture({tools:false}); f.get('home-unlock').click(); assert.equal(f.connections,1); f.connected(); assert.equal(f.quick.visible,true);
});
test('offline home shortcut gives a reachable explanation without leaving a stale open request',()=>{
 const f=fixture({online:false});f.get('home-unlock').click();assert.equal(f.connections,0);assert.match(f.notices[0],/Tailscale/);
 f.connected();assert.equal(f.quick.visible,false);
});
