import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createApp } from '../server.mjs';
const id='ba66f8ec-3b32-4f55-ae6a-adf7c7470e01';
async function fixture(t,{screen}={}) {
 const sockets=new Set(),calls=[];
 const mock=net.createServer(socket=>{sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));socket.write('RFB 003.008\n');});mock.listen(0,'127.0.0.1');await once(mock,'listening');
 const app=createApp({port:18799,vncPort:mock.address().port,publicURL:'https://mac.example.ts.net:9447',allowedLogin:'owner@example.com',
  powerCommand:async v=>{calls.push(v);return screen?screen(v):{ok:true,available:true,sources:[]};} });
 app.server.listen(0,'127.0.0.1');await once(app.server,'listening');const port=app.server.address().port;
 t.after(async()=>{await app.close();for(const socket of sockets)socket.destroy();await new Promise(r=>mock.close(r));});
 const ws=new WebSocket(`ws://127.0.0.1:${port}/ws?session=${id}&seconds=0`,{headers:{Host:'localhost:18799',Origin:'http://localhost:18799'}});await once(ws,'open');
 const request=(value,headers={},raw)=>new Promise(resolve=>{
  const req=http.request({hostname:'127.0.0.1',port,path:'/api/screen',method:'POST',headers:{Host:'localhost:18799',Origin:'http://localhost:18799','Content-Type':'application/json',...headers}},res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>resolve({code:res.statusCode,body}));});req.end(raw??JSON.stringify({session:id,...value}));
 });return {request,ws,calls,app};
}
test('display actions require the owner, same origin, bounded body, valid arguments and a live session',async t=>{
 const f=await fixture(t);
 assert.equal((await f.request({op:'status'},{Host:'mac.example.ts.net:9447',Origin:'https://mac.example.ts.net:9447'})).code,403);
 assert.equal((await f.request({op:'awake',mode:'system'},{Origin:'https://evil.example'})).code,403);
 assert.equal((await f.request({op:'off',session:'wrong'})).code,409);
 for(const v of [{op:'end'},{op:'recover'},{op:'execute'},{op:'privacy',enabled:true},{op:'privacy',enabled:false},{op:'awake',mode:'shell'},{op:'save',source:'ac',displayMinutes:-1,sleepMinutes:0}])assert.equal((await f.request(v)).code,400);
 assert.equal((await f.request({}, {}, ' '.repeat(2100))).code,413);
 assert.equal((await f.request({}, {}, '{broken')).code,400);
 assert.equal(f.calls.length,0);
 assert.equal((await f.request({op:'awake',mode:'system',command:'ignored',force:true})).code,200);
 assert.deepEqual(f.calls[0],{op:'awake',session:id,mode:'system'});
 const closed=once(f.ws,'close');f.ws.close();await closed;
 await new Promise(r=>setTimeout(r,25));
 assert.equal(f.calls.at(-1).op,'end');

});
