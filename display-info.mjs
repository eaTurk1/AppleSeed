import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const binary = fileURLToPath(new URL('./display-info', import.meta.url));
let cached = [], fetched = 0, pending;
export function getDisplays(force = false) {
  if (!force && Date.now() - fetched < 15000) return Promise.resolve(cached);
  if (pending) return pending;
  pending = new Promise(resolve => execFile(binary, [], { timeout: 2500, maxBuffer: 16384 }, (error, stdout) => {
    try { if (!error) { const result = JSON.parse(stdout); if (Array.isArray(result)) cached = result; } } catch { /* Keep the last valid layout across transient probe failures. */ }
    fetched = Date.now(); pending = null; resolve(cached);
  }));
  return pending;
}
