import test from 'node:test';import assert from 'node:assert/strict';import net from 'node:net';import {once} from 'node:events';import {createCipheriv} from 'node:crypto';
import http from 'node:http';
import {authenticateVNC} from '../rfb-auth.mjs';
function expected(password,challenge){const key=Buffer.alloc(8);Buffer.from(password).copy(key);for(let i=0;i<8;i++){let b=key[i],r=0;for(let n=0;n<8;n++){r=(r<<1)|(b&1);b>>=1;}key[i]=r;}const cipher=createCipheriv('des-ede3',Buffer.concat([key,key,key]),null);cipher.setAutoPadding(false);return Buffer.concat([cipher.update(challenge),cipher.final()]);}
test('Windows/Linux portal adapter authenticates classic VNC without selecting no-auth',async t=>{
 let offered=false;const challenge=Buffer.from('00112233445566778899aabbccddeeff','hex');
 const server=net.createServer(socket=>{socket.on('error',()=>{});socket.write('RFB 003.008\n');let phase=0,bytes=Buffer.alloc(0);socket.on('data',data=>{bytes=Buffer.concat([bytes,data]);if(phase===0&&bytes.length>=12){bytes=bytes.subarray(12);phase=1;socket.write(Buffer.from([2,1,2]));}if(phase===1&&bytes.length){assert.equal(bytes[0],2);offered=true;bytes=bytes.subarray(1);phase=2;socket.write(challenge);}if(phase===2&&bytes.length>=16){assert.deepEqual(bytes.subarray(0,16),expected('passw0rd',challenge));phase=3;socket.write(Buffer.alloc(4));}});});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
 const result=await authenticateVNC({port:server.address().port,password:Buffer.from('passw0rd')});assert.equal(offered,true);result.reader.release();result.socket.destroy();
});
test('non-Mac unlock and power routes reject without invoking a Mac helper',async t=>{
 const {createApp}=await import('../server.mjs');let called=0;const app=createApp({port:18796,hostPlatform:'linux',unlockCommand:async()=>{called++;},powerCommand:async()=>{called++;}});
 app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(()=>app.close());
 for(const path of ['/api/unlock','/api/screen']){
  const status=await new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:app.server.address().port,path,method:'POST',headers:{Host:'localhost:18796',Origin:'http://localhost:18796','Content-Type':'application/json'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end(JSON.stringify({op:'submit',password:'synthetic-only'}));});assert.equal(status,422);
 }
 assert.equal(called,0);
});
