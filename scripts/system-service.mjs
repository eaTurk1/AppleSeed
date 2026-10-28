import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync, cpSync, chmodSync, chownSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { portalEnvironment } from './portal-config.mjs';

const source = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const runtime = '/Library/Application Support/MacUnlock';
const label = 'org.appleseed.remote.service';
const powerRule = '/private/etc/sudoers.d/appleseed-power';
const ruleMarker = '# AppleSeed fixed power settings\n# Source: ' + source + '\n';
if (existsSync(powerRule) && !readFileSync(powerRule, 'utf8').startsWith(ruleMarker)) throw new Error('An unrelated power permission already exists.');
const plistPath = `/Library/LaunchDaemons/${label}.plist`;
const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const run = (file, args) => execFileSync(file, args, { encoding: 'utf8' });
if (process.getuid() !== 0) throw new Error('Install this boot service using sudo. It runs the server as your normal Mac user.');
if (existsSync(plistPath) && !readFileSync(plistPath, 'utf8').includes(`<key>MAC_UNLOCK_SOURCE</key><string>${xml(source)}</string>`)) throw new Error('A boot installation from another source already exists.');
if (process.argv[2] === 'uninstall') {
  if (existsSync(plistPath)) { try { run('/bin/launchctl', ['bootout', 'system', plistPath]); } catch {} unlinkSync(plistPath); }
  if (existsSync(powerRule)) unlinkSync(powerRule);
  console.log('Mac Unlock boot service removed. Its app files remain in Application Support.');
  console.log('Remove only its private listener with: /opt/homebrew/bin/tailscale --socket=/var/run/tailscaled.socket serve --https=9447 off');
} else if (process.argv[2] === 'install') {
  const portal = portalEnvironment(plistPath);
  const owner = process.env.SUDO_USER;
  if (!owner || owner === 'root') throw new Error('Run sudo from your normal Mac account.');
  const uid = Number(run('/usr/bin/id', ['-u', owner]).trim());
  const gid = Number(run('/usr/bin/id', ['-g', owner]).trim());
  if (uid < 501) throw new Error('A normal Mac user must own the remote session.');
  const fv = run('/usr/bin/fdesetup', ['status']);
  if (!fv.includes('FileVault is Off')) throw new Error('FileVault blocks this local boot service before disk unlock. Keep FileVault as configured; use a separate subnet router for recovery.');
  // Confirm this is an existing system daemon; do not change or replace Tailscale.
  const tsService = run('/bin/launchctl', ['print', 'system/homebrew.mxcl.tailscale']);
  if (!tsService.includes('state = running')) throw new Error('A running system-level Tailscale daemon is required.');
  const tailscale = '/opt/homebrew/bin/tailscale';
  const status = JSON.parse(run(tailscale, ['--socket=/var/run/tailscaled.socket', 'status', '--json']));
  const dns = status.Self?.DNSName?.replace(/\.$/, '');
  const login = status.User?.[status.Self?.UserID]?.LoginName;
  if (status.BackendState !== 'Running' || !dns || !login) throw new Error('The system-level Tailscale daemon must be signed in and connected.');
  const home = run('/usr/bin/dscl', ['.', '-read', `/Users/${owner}`, 'NFSHomeDirectory']).trim().replace(/^NFSHomeDirectory:\s*/, '');
  if (!path.isAbsolute(home)) throw new Error('Cannot identify the Mac user home directory.');
  const logs = path.join(home, 'Library/Logs/MacUnlock');
  mkdirSync(logs, { recursive: true, mode: 0o700 }); chownSync(logs, uid, gid);
  mkdirSync(runtime, { recursive: true, mode: 0o755 }); chmodSync(runtime, 0o755); chownSync(runtime, 0, 0);
  if (!/^[a-z_][a-z0-9_-]*$/i.test(owner)) throw new Error('Unsupported Mac account name for power permission.');
  const powerCandidate = path.join(runtime, '.power-control-next');
  run('/usr/bin/xcrun', ['clang', '-O2', '-Wall', '-Wextra', path.join(source, 'native/PowerControl.c'), '-o', powerCandidate]);
  chmodSync(powerCandidate, 0o755); chownSync(powerCandidate, 0, 0);
  run(powerCandidate, ['check']);
  mkdirSync(path.dirname(powerRule), { recursive: true, mode: 0o755 });
  const nextRule = `${powerRule}.next`;
  writeFileSync(nextRule, ruleMarker + owner + ' ALL=(root) NOPASSWD: /Library/Application\\ Support/MacUnlock/power-control\n', { mode: 0o440 });
  chmodSync(nextRule, 0o440); chownSync(nextRule, 0, 0);
  try { run('/usr/sbin/visudo', ['-c', '-f', nextRule]); } catch (error) { unlinkSync(nextRule); unlinkSync(powerCandidate); throw error; }
  renameSync(powerCandidate, path.join(runtime, 'power-control')); renameSync(nextRule, powerRule);
  const displayCandidate = path.join(runtime, '.display-info-next');
  run('/usr/bin/xcrun', ['swiftc', path.join(source, 'native/displays.swift'), '-O', '-o', displayCandidate]);
  JSON.parse(run(displayCandidate, [])); chmodSync(displayCandidate, 0o755);
  renameSync(displayCandidate, path.join(runtime, 'display-info'));
  // Some Homebrew Node builds need a relative libnode dylib and cannot be relocated.
  // Validate a candidate before replacing the installed executable.
  const nodeBinary = path.join(runtime, 'node'), candidate = path.join(runtime, '.node-next');
  cpSync(process.execPath, candidate); chmodSync(candidate, 0o755);
  try { run(candidate, ['--version']); }
  catch { unlinkSync(candidate); throw new Error('This Node build cannot run after relocation. Run the installer with a standalone Node distribution.'); }
  renameSync(candidate, nodeBinary);
  for (const entry of ['server.mjs', 'travel-portal.mjs', 'rfb-auth.mjs', 'portal', 'display-info.mjs', 'companion-control.mjs', 'power-control.mjs', 'public', 'node_modules', 'package.json', 'package-lock.json', 'licenses', 'THIRD_PARTY_NOTICES.md']) cpSync(path.join(source, entry), path.join(runtime, entry), { recursive: true });
  const url = `https://${dns}:9447`;
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>UserName</key><string>${xml(owner)}</string>
<key>ProgramArguments</key><array><string>${xml(nodeBinary)}</string><string>${xml(path.join(runtime, 'server.mjs'))}</string></array>
<key>WorkingDirectory</key><string>${xml(runtime)}</string>
<key>EnvironmentVariables</key><dict>
<key>HOME</key><string>${xml(home)}</string>
<key>MAC_UNLOCK_URL</key><string>${xml(url)}</string>
<key>MAC_UNLOCK_LOGIN</key><string>${xml(login)}</string>
<key>MAC_UNLOCK_SOURCE</key><string>${xml(source)}</string>
<key>MAC_UNLOCK_STARTUP</key><string>boot</string>
${Object.entries(portal).map(([key,value]) => `<key>${key}</key><string>${xml(value)}</string>`).join('')}
</dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer>
<key>StandardOutPath</key><string>${xml(path.join(logs, 'service.log'))}</string>
<key>StandardErrorPath</key><string>${xml(path.join(logs, 'error.log'))}</string>
</dict></plist>\n`;
  const agentPath = path.join(home, 'Library/LaunchAgents', `${label}.plist`);
  let agentStopped = false;
  if (existsSync(agentPath)) {
    if (!readFileSync(agentPath, 'utf8').includes(`<key>MAC_UNLOCK_SOURCE</key><string>${xml(source)}</string>`)) throw new Error('A login agent from another source already exists.');
    try { run('/bin/launchctl', ['bootout', `gui/${uid}`, agentPath]); agentStopped = true; } catch {}
  }
  if (existsSync(plistPath)) { try { run('/bin/launchctl', ['bootout', 'system', plistPath]); } catch {} }
  writeFileSync(plistPath, plist, { mode: 0o644 }); chownSync(plistPath, 0, 0);
  try { run('/bin/launchctl', ['bootstrap', 'system', plistPath]); }
  catch (error) { if (agentStopped) run('/bin/launchctl', ['bootstrap', `gui/${uid}`, agentPath]); throw error; }
  if (existsSync(agentPath)) unlinkSync(agentPath);
  console.log(`Installed boot service, running as ${owner}. Phone URL: ${url}`);
  console.log('The existing Tailscale system daemon is unchanged. A controlled restart test is still required.');
  console.log('Configure the private listener with: /opt/homebrew/bin/tailscale --socket=/var/run/tailscaled.socket serve --bg --https=9447 http://127.0.0.1:18796');
} else throw new Error('Usage: sudo node scripts/system-service.mjs install|uninstall');
