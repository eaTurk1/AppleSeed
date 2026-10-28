import net from 'node:net';
import { randomBytes, createHash, createCipheriv } from 'node:crypto';
import { modPow, bigIntToU8Array, u8ArrayToBigInt } from './node_modules/@novnc/novnc/core/crypto/bigint.js';

// A bounded reader for the handshake only. Protocol/credential bytes never log.
export class HandshakeReader {
  constructor(source, event = 'data') {
    this.source = source; this.event = event; this.buffer = Buffer.alloc(0); this.pending = null; this.error = null;
    this.receive = (chunk, binary = true) => {
      if (!binary || this.buffer.length + chunk.length > 65536) return this.fail();
      this.buffer = Buffer.concat([this.buffer, chunk]); this.pump();
    };
    this.failed = () => this.fail();
    source.on(event, this.receive); source.on('error', this.failed); source.on('close', this.failed);
  }
  fail() { this.error = new Error('Screen Sharing handshake ended'); if (this.pending) { const { reject, timer } = this.pending; this.pending = null; clearTimeout(timer); reject(this.error); } }
  pump() {
    if (!this.pending || this.buffer.length < this.pending.size) return;
    const { size, resolve, timer } = this.pending; this.pending = null; clearTimeout(timer);
    const data = this.buffer.subarray(0, size); this.buffer = this.buffer.subarray(size); resolve(data);
  }
  read(size) {
    if (this.error) return Promise.reject(this.error);
    if (this.pending) return Promise.reject(new Error('Concurrent handshake read'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(), 10000); timer.unref();
      this.pending = { size, resolve, reject, timer }; this.pump();
    });
  }
  release() {
    this.source.off(this.event, this.receive); this.source.off('error', this.failed); this.source.off('close', this.failed);
    if (this.pending) this.fail();
    const rest = this.buffer; this.buffer = Buffer.alloc(0); return rest;
  }
}

export function ardResponse(generator, prime, peer, username, password) {
  const size = prime.length, p = u8ArrayToBigInt(prime), g = u8ArrayToBigInt(generator), other = u8ArrayToBigInt(peer);
  if (size < 64 || size > 512 || g < 2n || g >= p - 1n || other < 2n || other >= p - 1n || username.length > 63 || password.length > 63) throw new Error('Unsupported Mac authentication');
  const privateBytes = randomBytes(size), exponent = u8ArrayToBigInt(privateBytes);
  privateBytes.fill(0);
  const publicKey = Buffer.from(bigIntToU8Array(modPow(g, exponent, p), size));
  const secret = Buffer.from(bigIntToU8Array(modPow(other, exponent, p), size));
  const key = createHash('md5').update(secret).digest(); secret.fill(0);
  const plain = randomBytes(128); username.copy(plain, 0); plain[username.length] = 0; password.copy(plain, 64); plain[64 + password.length] = 0;
  try {
    const cipher = createCipheriv('aes-128-ecb', key, null); cipher.setAutoPadding(false);
    return Buffer.concat([cipher.update(plain), cipher.final(), publicKey]);
  } finally { plain.fill(0); key.fill(0); }
}

// Authenticate only to loopback macOS Screen Sharing. No arbitrary target hosts,
// no downgrade to unauthenticated/VNC-password modes, no credentials to browsers.
export async function authenticateMac({ port = 5900, username, password, connected = () => {} }) {
  const socket = net.createConnection({ host: '127.0.0.1', port });
  const reader = new HandshakeReader(socket); connected(socket);
  try {
    const version = (await reader.read(12)).toString('ascii');
    if (!['RFB 003.889\n', 'RFB 003.008\n'].includes(version)) throw new Error('Unsupported Mac protocol');
    socket.write('RFB 003.008\n');
    const count = (await reader.read(1))[0];
    if (!count || !(await reader.read(count)).includes(30)) throw new Error('Mac account authentication required');
    socket.write(Buffer.from([30]));
    const header = await reader.read(4), size = header.readUInt16BE(2);
    if (size < 64 || size > 512) throw new Error('Unsupported Mac authentication');
    const challenge = await reader.read(size * 2);
    const response = ardResponse(header.subarray(0, 2), challenge.subarray(0, size), challenge.subarray(size), username, password);
    socket.write(response, () => response.fill(0));
    if ((await reader.read(4)).readUInt32BE(0) !== 0) throw new Error('Mac authentication rejected');
    return { socket, reader };
  } catch (error) { reader.release(); socket.destroy(); throw error; }
}

// Explicit non-Mac adapter. It never downgrades authenticateMac's ARD requirement.
export async function authenticateVNC({port=5900,password,connected=()=>{}}) {
  const socket=net.createConnection({host:'127.0.0.1',port});
  const reader=new HandshakeReader(socket);connected(socket);
  const secret=Buffer.from(password);
  try {
    if(!secret.length || secret.length>8 || secret.some(byte=>byte>127))throw Error('Classic VNC requires 1 to 8 ASCII password characters');
    const version=(await reader.read(12)).toString('ascii');
    if(!['RFB 003.008\n','RFB 003.007\n'].includes(version))throw Error('VNC server must support RFB 3.7 or 3.8 with password authentication');
    socket.write(version);const count=(await reader.read(1))[0];
    if(!count || !(await reader.read(count)).includes(2))throw Error('VNC password authentication required');
    socket.write(Buffer.from([2]));const challenge=await reader.read(16);
    const {DESECBCipher}=await import('./node_modules/@novnc/novnc/core/crypto/des.js');
    const key=new Uint8Array(8);key.set(secret);
    const cipher=DESECBCipher.importKey(key);const response=Buffer.from(cipher.encrypt({},challenge));key.fill(0);
    socket.write(response,()=>response.fill(0));
    if((await reader.read(4)).readUInt32BE(0)!==0)throw Error('VNC authentication rejected');
    return {socket,reader};
  }catch(error){reader.release();socket.destroy();throw error;}
  finally{secret.fill(0);}
}
