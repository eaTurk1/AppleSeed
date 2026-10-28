import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { tailscaleClient } from './tailscale.mjs';
const app = process.argv[2];
const label = 'org.appleseed.remote.companion';
if (!app || !path.isAbsolute(app) || !existsSync(path.join(app, 'Contents/MacOS/AppleSeedCompanion'))) throw new Error('Open Setup Mac service from the AppleSeed menu.');
const ts = tailscaleClient();
// Do not replace a listener belonging to another service, or expose any Funnel listener.
const configuration = JSON.parse(ts.run(['serve','status','--json']));
const listener = Object.entries(configuration.Web || {}).find(([host]) => host.endsWith(':9447'));
const target = 'http://127.0.0.1:18796';
if (listener && (Object.keys(listener[1].Handlers || {}).length !== 1 || listener[1].Handlers?.['/']?.Proxy !== target)) throw new Error('Port 9447 belongs to another Tailscale service. Remove that listener before setting up AppleSeed.');
if (Object.entries(configuration.AllowFunnel || {}).some(([host, enabled]) => host.endsWith(':9447') && enabled)) throw new Error('Disable Funnel for port 9447 before setting up AppleSeed. AppleSeed requires private Tailscale Serve.');
// The ordinary setup creates only user login agents. Boot installation is separate.
process.argv[2] = 'install';
await import('./service.mjs');
const agent = path.join(os.homedir(), `Library/LaunchAgents/${label}.plist`);
const xml = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const binary = path.join(app,'Contents/MacOS/AppleSeedCompanion');
if (existsSync(agent) && !readFileSync(agent, 'utf8').includes(xml(binary))) throw new Error('A companion is installed at a different path. Uninstall its login agent before moving the app.');
mkdirSync(path.dirname(agent), { recursive: true });
writeFileSync(agent, `<?xml version="1.0"?><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array><string>${xml(binary)}</string></array><key>RunAtLoad</key><true/><key>LimitLoadToSessionType</key><string>Aqua</string></dict></plist>`, { mode: 0o600 });
// Do not launch a second copy of the already-running GUI companion.
if (!listener) ts.run(['serve','--bg','--https=9447',target]);
console.log('Tailscale Serve configured privately. Enable Screen Sharing for your Mac account, then enter the Phone URL in the Android app.');
