import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const socketPath = path.join(os.homedir(), 'Library/Application Support/AppleSeed/companion/companion.sock');
export function companionCommand(command) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath); let data = '', finished = false;
    const finish = (error, result) => { if (finished) return; finished = true; socket.destroy(); error ? reject(error) : resolve(result); };
    socket.setTimeout(12000, () => finish(new Error('The Mac companion did not respond. Try again.')));
    socket.on('error', () => finish(new Error('AppleSeed is unavailable. Sign in on your Mac and start its companion.')));
    socket.on('connect', () => socket.write(JSON.stringify(command) + '\n'));
    socket.on('data', chunk => {
      data += chunk;
      if (Buffer.byteLength(data) > 65536) return finish(new Error('Invalid companion response.'));
      if (data.includes('\n')) { try { finish(null, JSON.parse(data.slice(0, data.indexOf('\n')))); } catch { finish(new Error('Invalid companion response.')); } }
    });
    socket.on('end', () => { if (!finished) finish(new Error('The Mac companion ended the request.')); });
  });
}
