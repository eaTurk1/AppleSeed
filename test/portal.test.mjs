import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { createHash, createDecipheriv, getDiffieHellman } from 'node:crypto';
import { WebSocket } from 'ws';
import { createTravelPortal } from '../travel-portal.mjs';
import { HandshakeReader, authenticateMac } from '../rfb-auth.mjs';
import { modPow, bigIntToU8Array, u8ArrayToBigInt } from '../node_modules/@novnc/novnc/core/crypto/bigint.js';

const credentials = { username: 'fixture-owner', password: 'fixture-password', seconds: 3600 };
async function fixture(t) {
  const sockets = new Set(); let authenticated = 0, shared = 0;
  const mock = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    const reader = new HandshakeReader(socket);
    (async () => {
      socket.write('RFB 003.889\n'); assert.equal((await reader.read(12)).toString(), 'RFB 003.008\n');
      socket.write(Buffer.from([1,30])); assert.equal((await reader.read(1))[0], 30);
      const prime = getDiffieHellman('modp2').getPrime(), p = u8ArrayToBigInt(prime), exponent = 123456789123456789n;
      const peer = Buffer.from(bigIntToU8Array(modPow(2n, exponent, p), prime.length));
      const header = Buffer.alloc(4); header.writeUInt16BE(2); header.writeUInt16BE(prime.length,2); socket.write(Buffer.concat([header,prime,peer]));
      const response = await reader.read(128+prime.length);
      const secret = Buffer.from(bigIntToU8Array(modPow(u8ArrayToBigInt(response.subarray(128)),exponent,p),prime.length));
      const decipher=createDecipheriv('aes-128-ecb',createHash('md5').update(secret).digest(),null);decipher.setAutoPadding(false);
      const plain=Buffer.concat([decipher.update(response.subarray(0,128)),decipher.final()]);
      const user=plain.subarray(0,64).toString().split('\0')[0], password=plain.subarray(64).toString().split('\0')[0];
      if(user!==credentials.username||password!==credentials.password){socket.end(Buffer.from([0,0,0,1]));return;}
      authenticated++; socket.write(Buffer.alloc(4));
      assert.equal((await reader.read(1))[0],1);shared++;
      const pending=reader.release();socket.on('error',()=>{});socket.on('data',data=>socket.write(data));
      socket.write(Buffer.from('frame'));if(pending.length)socket.write(pending);
    })().catch(()=>{reader.release();socket.destroy();});
  });
  mock.listen(0,'127.0.0.1');await once(mock,'listening');
  let time=Date.now();
  const portal=createTravelPortal({publicURL:'https://portal.example/appleseed/remote',vncPort:mock.address().port,now:()=>time,displays:async()=>[{id:'test',width:100,height:100}]});
  portal.server.listen(0,'127.0.0.1');await once(portal.server,'listening');const port=portal.server.address().port;
  t.after(async()=>{await portal.close();for(const socket of sockets)socket.destroy();await new Promise(resolve=>mock.close(resolve));});
  const request=(pathname='',{method='GET',body,headers={}}={})=>new Promise((resolve,reject)=>{
    const req=http.request({host:'127.0.0.1',port,path:'/appleseed/remote/'+pathname,method,headers:{Host:'portal.example',Origin:'https://portal.example','Content-Type':'application/json',...headers}},res=>{
      let data='';res.on('data',c=>data+=c);res.on('end',()=>resolve({code:res.statusCode,body:data,headers:res.headers}));});req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
  });
  const pair=code=>request('pair',{method:'POST',body:{code}});
  const connect=cookie=>new WebSocket(`ws://127.0.0.1:${port}/appleseed/remote/ws`,{headers:{Host:'portal.example',Origin:'https://portal.example',Cookie:cookie}});
  return {portal,request,pair,connect,port,advance:n=>time+=n,counts:()=>({authenticated,shared}),vncPort:mock.address().port};
}
async function paired(f) {const enabled=await f.portal.enable(credentials);const response=await f.pair(enabled.code);assert.equal(response.code,200);return {enabled,cookie:response.headers['set-cookie'][0].split(';')[0]};}
async function desktop(f,cookie){const ws=f.connect(cookie),reader=new HandshakeReader(ws,'message');await once(ws,'open');assert.equal((await reader.read(12)).toString(),'RFB 003.008\n');ws.send(Buffer.from('RFB 003.008\n'));assert.deepEqual(await reader.read(2),Buffer.from([1,1]));ws.send(Buffer.from([1]));assert.equal((await reader.read(4)).readUInt32BE(),0);ws.send(Buffer.from([1]));assert.equal((await reader.read(5)).toString(),'frame');reader.release();return ws;}
test('disabled public portal exposes no owner endpoints, assets or status',async t=>{
 const f=await fixture(t);for(const route of ['', 'status','assets/apple-rfb.js','../api/status'])assert.equal((await f.request(route)).code,404);
 assert.deepEqual(f.portal.status().enabled,false);const ws=f.connect('');const [error]=await once(ws,'error');assert.match(error.message,/403/);
});
test('one-use code creates secure cookie and cannot expose credentials or private controls',async t=>{
 const f=await fixture(t);const {enabled,cookie}=await paired(f);assert.match(enabled.code,/^[2-9A-HJ-NP-Z]{8}$/);
 assert.equal((await f.pair(enabled.code)).code,403);
 assert.equal((await f.request('status')).code,403);
 const state=await f.request('status',{headers:{Cookie:cookie}});assert.equal(state.code,200);assert.doesNotMatch(state.body,/fixture-password|fixture-owner/);
 for(const route of ['api/status','api/unlock','api/portal','assets/novnc/../../server.js','assets/novnc/%2e%2e/server.js'])assert.equal((await f.request(route,{headers:{Cookie:cookie}})).code,404);
 const page=await f.request('',{headers:{Cookie:cookie}});assert.match(page.body,/Open second monitor/);assert.doesNotMatch(page.body,/fixture-password/);
});
test('two authenticated browser windows share the Mac and disable revokes both immediately',async t=>{
 const f=await fixture(t);const {cookie}=await paired(f);const a=await desktop(f,cookie),b=await desktop(f,cookie);
 const extra=f.connect(cookie);const [error]=await once(extra,'error');assert.match(error.message,/403/);
 const echo=once(a,'message');a.send(Buffer.from([7,8,9]));assert.deepEqual((await echo)[0],Buffer.from([7,8,9]));
 assert.equal(f.counts().shared,2);const closedA=once(a,'close'),closedB=once(b,'close');f.portal.disable();await Promise.all([closedA,closedB]);
 assert.equal((await f.request('status',{headers:{Cookie:cookie}})).code,404);
});
test('code expiry, session expiry, replacement and attempt limits fail closed',async t=>{
 const f=await fixture(t);let enabled=await f.portal.enable(credentials);f.advance(300001);assert.equal((await f.pair(enabled.code)).code,403);
 enabled=await f.portal.enable(credentials);for(let n=0;n<5;n++)assert.equal((await f.pair('!!!!!!!!')).code,403);assert.equal((await f.pair(enabled.code)).code,429);
 f.advance(60001);const response=await f.pair(enabled.code);assert.equal(response.code,200);const cookie=response.headers['set-cookie'][0].split(';')[0];
 assert.match(response.headers['set-cookie'][0],/Secure; HttpOnly; SameSite=Strict/);
 await f.portal.enable(credentials);assert.equal((await f.request('status',{headers:{Cookie:cookie}})).code,403);
 f.advance(3600001);assert.equal((await f.request('')).code,404);assert.equal(f.portal.status().enabled,false);
});
test('cross-site pairing/logout and spoofed owner headers cannot authorize the public surface',async t=>{
 const f=await fixture(t);const enabled=await f.portal.enable(credentials);
 assert.equal((await f.request('pair',{method:'POST',body:{code:enabled.code},headers:{Origin:'https://evil.example'}})).code,403);
 assert.equal((await f.request('status',{headers:{'Tailscale-User-Login':'owner@example.com',Host:'localhost:18796'}})).code,404);
 const {cookie}=await paired(f);assert.equal((await f.request('logout',{method:'POST',headers:{Cookie:cookie,Origin:'https://evil.example'}})).code,403);assert.equal(f.portal.status().enabled,true);
});
test('Mac password authentication is required before any code is issued',async t=>{
 const f=await fixture(t);await assert.rejects(f.portal.enable({...credentials,password:'wrong'}));assert.equal(f.portal.status().enabled,false);
 const result=await authenticateMac({port:f.vncPort,username:Buffer.from(credentials.username),password:Buffer.from(credentials.password)});result.reader.release();result.socket.destroy();
});

test('disable during Mac authentication prevents a late success from enabling the portal',async t=>{
 let complete, destroyed=false;
 const portal=createTravelPortal({publicURL:'https://portal.example/appleseed/remote',authenticate:async ({connected})=>{
   const socket={destroy(){destroyed=true;}};connected(socket);
   await new Promise(resolve=>complete=resolve);
   return {socket,reader:{release(){}}};
 }});
 t.after(()=>portal.close());
 const enabling=portal.enable(credentials);portal.disable();complete();
 await assert.rejects(enabling);
 assert.equal(destroyed,true);assert.equal(portal.status().enabled,false);
});
