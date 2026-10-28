import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync, cpSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tailscaleClient } from './tailscale.mjs';
import { portalEnvironment } from './portal-config.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const label = 'org.appleseed.remote.service';
const agents = path.join(os.homedir(), 'Library/LaunchAgents');
const filename = path.join(agents, `${label}.plist`);
const logs = path.join(os.homedir(), 'Library/Logs/MacUnlock');
const runtime = path.join(os.homedir(), 'Library/Application Support/MacUnlock/app');
const domain = `gui/${process.getuid()}`;
const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
function launch(...args) { return execFileSync('/bin/launchctl', args, { encoding: 'utf8' }); }
if (existsSync(filename) && !readFileSync(filename, 'utf8').includes(xml(path.join(root, 'server.mjs'))) && !readFileSync(filename, 'utf8').includes(`<key>MAC_UNLOCK_SOURCE</key><string>${xml(root)}</string>`)) throw new Error('A Mac Unlock installation already exists at another location. Keep or remove it before installing here.');
if (process.argv[2] === 'uninstall') {
  if (existsSync(filename)) { try { launch('bootout', domain, filename); } catch {} unlinkSync(filename); }
  console.log('Mac Unlock login service removed.');
  console.log('To remove only its Tailscale listener: tailscale serve --https=9447 off');
} else if (process.argv[2] === 'install') {
  const portal = portalEnvironment(filename);
  if (existsSync('/Library/LaunchDaemons/org.appleseed.remote.service.plist')) throw new Error('A boot service is already installed. Update it with npm run install-boot-service.');
  const status = JSON.parse(tailscaleClient().run(['status','--json']));
  if (status.BackendState !== 'Running') throw new Error('Connect Tailscale before installing.');
  const login = status.User?.[status.Self?.UserID]?.LoginName;
  const dns = status.Self?.DNSName?.replace(/\.$/, '');
  if (!login || !dns) throw new Error('Cannot identify the Mac owner’s Tailscale account.');
  const url = `https://${dns}:9447`;
  mkdirSync(agents, { recursive: true }); mkdirSync(logs, { recursive: true, mode: 0o700 });
  if (existsSync(filename)) { try { launch('bootout', domain, filename); } catch {} }
  mkdirSync(runtime, { recursive: true, mode: 0o700 });
  // A login agent should not depend on permission to read the protected Documents folder.
  for (const entry of ['server.mjs', 'travel-portal.mjs', 'rfb-auth.mjs', 'portal', 'display-info.mjs', 'companion-control.mjs', 'power-control.mjs', 'public', 'node_modules', 'package.json', 'package-lock.json', 'licenses', 'THIRD_PARTY_NOTICES.md']) cpSync(path.join(root, entry), path.join(runtime, entry), { recursive: true });
  if (existsSync(path.join(root, 'display-info'))) cpSync(path.join(root, 'display-info'), path.join(runtime, 'display-info'));
  else execFileSync('/usr/bin/xcrun', ['swiftc', '-O', path.join(root, 'native/displays.swift'), '-o', path.join(runtime, 'display-info')]);
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(path.join(runtime, 'server.mjs'))}</string></array>
<key>WorkingDirectory</key><string>${xml(runtime)}</string>
<key>EnvironmentVariables</key><dict><key>MAC_UNLOCK_URL</key><string>${xml(url)}</string><key>MAC_UNLOCK_LOGIN</key><string>${xml(login)}</string><key>MAC_UNLOCK_SOURCE</key><string>${xml(root)}</string>${Object.entries(portal).map(([key,value]) => `<key>${key}</key><string>${xml(value)}</string>`).join('')}</dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer>
<key>StandardOutPath</key><string>${xml(path.join(logs, 'service.log'))}</string>
<key>StandardErrorPath</key><string>${xml(path.join(logs, 'error.log'))}</string>
</dict></plist>\n`;
  writeFileSync(filename, plist, { mode: 0o600 });
  launch('bootstrap', domain, filename);
  console.log(`Installed login service. Phone URL: ${url}`);
  console.log('Enable its private listener with: tailscale serve --bg --https=9447 http://127.0.0.1:18796');
} else throw new Error('Usage: node scripts/service.mjs install|uninstall');
