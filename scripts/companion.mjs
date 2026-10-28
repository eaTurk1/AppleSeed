import { execFileSync } from 'node:child_process';
import { mkdirSync, cpSync, writeFileSync, existsSync, unlinkSync, renameSync, rmSync, chmodSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const home = os.homedir(), domain = `gui/${process.getuid()}`;
const app = path.join(home, 'Applications/AppleSeed.app');
const label = 'org.appleseed.remote.companion';
const agent = path.join(home, `Library/LaunchAgents/${label}.plist`);
const xml = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const run = (command, args) => execFileSync(command, args, { encoding: 'utf8' });
if (process.getuid() === 0) throw new Error('Install the companion from your normal Mac account.');
if (process.argv[2] === 'uninstall') {
  if (existsSync(agent)) { try { run('/bin/launchctl', ['bootout', domain, agent]); } catch {} unlinkSync(agent); }
  console.log('Mac companion stopped and removed from login startup. Its app remains in Applications.');
} else if (['build', 'install'].includes(process.argv[2])) {
  const output = path.join(root, 'native/build/AppleSeed.app');
  rmSync(output, { recursive: true, force: true });
  const contents = path.join(output, 'Contents'), binary = path.join(contents, 'MacOS/AppleSeedCompanion');
  mkdirSync(path.dirname(binary), { recursive: true }); mkdirSync(path.join(contents, 'Resources'), { recursive: true });
  // Finish compiling before stopping the working helper.
  const next = `${binary}.next`;
  run('/usr/bin/xcrun', ['clang', '-mmacosx-version-min=13.0', '-fobjc-arc', '-O2', '-framework', 'Cocoa', '-framework', 'CoreGraphics', '-framework', 'ApplicationServices', '-framework', 'IOKit', path.join(root, 'native/Companion.m'), '-o', next]);
  cpSync(next, binary); unlinkSync(next);
  cpSync(path.join(root, 'native/AppleSeed.icns'), path.join(contents, 'Resources/AppleSeed.icns'));
  writeFileSync(path.join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${label}</string><key>CFBundleName</key><string>AppleSeed</string><key>CFBundleDisplayName</key><string>AppleSeed</string><key>CFBundleIconFile</key><string>AppleSeed.icns</string><key>CFBundleExecutable</key><string>AppleSeedCompanion</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>2.0.0</string><key>CFBundleVersion</key><string>19</string><key>LSUIElement</key><true/><key>NSHighResolutionCapable</key><true/><key>NSPrincipalClass</key><string>NSApplication</string><key>LSMinimumSystemVersion</key><string>13.0</string></dict></plist>`);
  const runtime = path.join(contents, 'Resources/runtime'); mkdirSync(runtime, { recursive: true });
  const node = process.env.APPLESEED_NODE || process.execPath;
  cpSync(node, path.join(runtime, 'node')); chmodSync(path.join(runtime, 'node'), 0o755);
  try { run(path.join(runtime, 'node'), ['--version']); }
  catch { throw new Error('Use APPLESEED_NODE to specify a standalone Node binary for this app.'); }
  for (const entry of ['server.mjs','travel-portal.mjs','rfb-auth.mjs','portal','display-info.mjs','companion-control.mjs','power-control.mjs','public','node_modules','package.json','package-lock.json','scripts','LICENSE','THIRD_PARTY_NOTICES.md','README.md','docs','licenses']) {
    cpSync(path.join(root, entry), path.join(runtime, entry), { recursive: true, filter: source => !source.includes('/native/build') && !source.endsWith('/public/AppleSeed.apk') && !source.endsWith('/docs/RELEASE_SHA256SUMS.txt') });
  }
  mkdirSync(path.join(runtime, 'native'), { recursive: true });
  for (const entry of readdirSync(path.join(root, 'native'))) if (entry !== 'build') cpSync(path.join(root, 'native', entry), path.join(runtime, 'native', entry));
  run('/usr/bin/xcrun', ['swiftc', '-target', `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macosx13.0`, '-O', path.join(root, 'native/displays.swift'), '-o', path.join(runtime, 'display-info')]);
  run('/usr/bin/codesign', ['--force', '--sign', '-', path.join(runtime, 'node')]);
  run('/usr/bin/codesign', ['--force', '--sign', '-', path.join(runtime, 'display-info')]);
  run('/usr/bin/codesign', ['--force', '--sign', '-', '--identifier', label, '--requirements', `=designated => identifier "${label}";`, output]);
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', output]);
  if (process.argv[2] === 'install') {
    // Refuse to replace a different application.
    for (const existing of [app]) if (existsSync(existing)) {
      const identifier = run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', path.join(existing, 'Contents/Info.plist')]).trim();
      if (identifier !== label) throw new Error(`Refusing to replace another app: ${existing}`);
    }
    if (existsSync(agent)) { try { run('/bin/launchctl', ['bootout', domain, agent]); } catch {} }
    const register = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
    cpSync(output, app, { recursive: true });
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
    run(register, ['-f', app]);
    const installedBinary = path.join(app, 'Contents/MacOS/AppleSeedCompanion');
    mkdirSync(path.dirname(agent), { recursive: true });
    writeFileSync(agent, `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
<key>Label</key><string>${label}</string><key>ProgramArguments</key><array><string>${xml(installedBinary)}</string></array><key>RunAtLoad</key><true/><key>ThrottleInterval</key><integer>10</integer><key>ProcessType</key><string>Interactive</string><key>LimitLoadToSessionType</key><string>Aqua</string></dict></plist>`, { mode: 0o600 });
    run('/bin/launchctl', ['bootstrap', domain, agent]);
  }
  console.log(`${process.argv[2] === 'install' ? 'Installed' : 'Built'}: ${process.argv[2] === 'install' ? app : output}`);
} else throw new Error('Usage: node scripts/companion.mjs build|install|uninstall');
