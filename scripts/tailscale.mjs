import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
// Use an existing system daemon when present; otherwise the signed-in GUI client.
export function tailscaleClient() {
  const env = { ...process.env, TAILSCALE_BE_CLI: '1' };
  const system = existsSync('/var/run/tailscaled.socket');
  const candidates = system ? ['/opt/homebrew/bin/tailscale','/usr/local/bin/tailscale'] : ['/Applications/Tailscale.app/Contents/MacOS/Tailscale','/opt/homebrew/bin/tailscale','/usr/local/bin/tailscale'];
  const file = candidates.find(existsSync);
  if (!file) throw new Error('Install Tailscale on your Mac and sign in first.');
  const prefix = system ? ['--socket=/var/run/tailscaled.socket'] : [];
  const run = args => execFileSync(file, [...prefix, ...args], { env, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
  return { run, file, prefix };
}
