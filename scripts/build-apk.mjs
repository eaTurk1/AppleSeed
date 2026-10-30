import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, copyFileSync, chmodSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
if (process.argv[2]) throw new Error('Usage: node scripts/build-apk.mjs. AppleSeed has one complete free edition.');
const version = '2.1.0', versionCode = 21;
const appName = 'AppleSeed';
const sdk = process.env.ANDROID_HOME || path.join(os.homedir(), 'Library/Android/sdk');
const jdk = process.env.JAVA_HOME || '/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home';
const tools = path.join(sdk, 'build-tools/36.0.0');
const androidJar = path.join(sdk, 'platforms/android-36/android.jar');
for (const file of [androidJar, path.join(jdk, 'bin/javac'), path.join(tools, 'aapt2')]) if (!existsSync(file)) throw new Error(`Build prerequisite missing: ${file}`);
const main = path.join(root, 'android/app/src/main');
const build = path.join(root, 'android/build', 'appleseed');
const out = path.join(root, 'releases');
// Only task-generated intermediates are removed. The signing identity is retained elsewhere.
rmSync(build, { recursive: true, force: true });
for (const dir of ['classes', 'generated', 'dex', 'policy']) mkdirSync(path.join(build, dir), { recursive: true });
mkdirSync(out, { recursive: true });
const assets = path.join(build, 'assets');
mkdirSync(path.join(assets, 'client'), { recursive: true });
for (const file of ['app.js', 'free-tools.js', 'appearance.js', 'quick-access.js', 'safe-unlock.js', 'portal-control.js', 'monitor-strip.js', 'stream-quality.js', 'desktop-model.js', 'desktop-controller.js', 'app-switcher.js', 'apple-rfb.js', 'style.css']) copyFileSync(path.join(root, 'public', file), path.join(assets, 'client', file));
const manifest = path.join(build, 'AndroidManifest.xml');
writeFileSync(manifest, readFileSync(path.join(main, 'AndroidManifest.xml'), 'utf8').replace(/android:label="AppleSeed"/, `android:label="${appName}"`).replace(/android:versionCode="[^"]+"/, `android:versionCode="${versionCode}"`).replace(/android:versionName="[^"]+"/, `android:versionName="${version}"`));
const config = path.join(build, 'generated/org/appleseed/remote/Edition.java');
mkdirSync(path.dirname(config), { recursive: true });
writeFileSync(config, `package org.appleseed.remote;\nfinal class Edition {\n static final String NAME = "AppleSeed";\n static final String VERSION = "${version}";\n}\n`);
const env = { ...process.env, JAVA_HOME: jdk, PATH: `${path.join(jdk, 'bin')}:${process.env.PATH}` };
function run(file, args, options = {}) { return execFileSync(file, args, { env, encoding: 'utf8', stdio: 'pipe', ...options }); }
function files(dir, suffix) { return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(dir, entry.name), suffix) : entry.name.endsWith(suffix) ? [path.join(dir, entry.name)] : []); }
console.log('Compiling Android resources and Java…');
run(path.join(tools, 'aapt2'), ['compile', '--dir', path.join(main, 'res'), '-o', path.join(build, 'resources.zip')]);
run(path.join(tools, 'aapt2'), ['link', '-o', path.join(build, 'unsigned.apk'), '-I', androidJar, '--manifest', manifest, '--java', path.join(build, 'generated'), '-A', assets, path.join(build, 'resources.zip')]);
run(path.join(jdk, 'bin/javac'), ['--release', '17', '-classpath', androidJar, '-d', path.join(build, 'classes'), ...files(path.join(main, 'java'), '.java'), ...files(path.join(build, 'generated'), '.java')]);
run(path.join(jdk, 'bin/javac'), ['--release', '17', '-d', path.join(build, 'policy'), path.join(main, 'java/org/appleseed/remote/ConnectionPolicy.java'), path.join(main, 'java/org/appleseed/remote/ClientAssets.java'), path.join(root, 'android/test/ConnectionPolicyTest.java')]);
console.log(run(path.join(jdk, 'bin/java'), ['-classpath', path.join(build, 'policy'), 'ConnectionPolicyTest']).trim());
run(path.join(jdk, 'bin/javac'), ['--release', '17', '-d', path.join(build, 'policy'), path.join(main, 'java/org/appleseed/remote/SessionLifetime.java'), path.join(root, 'android/test/SessionLifetimeTest.java')]);
console.log(run(path.join(jdk, 'bin/java'), ['-classpath', path.join(build, 'policy'), 'SessionLifetimeTest']).trim());
run(path.join(tools, 'd8'), ['--release', '--min-api', '28', '--lib', androidJar, '--output', path.join(build, 'dex'), ...files(path.join(build, 'classes'), '.class')]);
run('/usr/bin/zip', ['-q', '-j', path.join(build, 'unsigned.apk'), path.join(build, 'dex/classes.dex')]);
run(path.join(tools, 'zipalign'), ['-f', '4', path.join(build, 'unsigned.apk'), path.join(build, 'aligned.apk')]);

const signing = path.join(os.homedir(), 'Library/Application Support/AppleSeed/public-signing');
mkdirSync(signing, { recursive: true, mode: 0o700 }); chmodSync(signing, 0o700);
const key = path.join(signing, 'release.pk8');
const cert = path.join(signing, 'release.x509.pem');
if (existsSync(key) !== existsSync(cert)) throw new Error('Incomplete signing identity. Restore the matching key and certificate before building an update.');
if (!existsSync(key)) {
  const temporaryKey = path.join(signing, 'temporary-key.pem');
  try {
    run('/usr/bin/openssl', ['genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:3072', '-out', temporaryKey]); chmodSync(temporaryKey, 0o600);
    run('/usr/bin/openssl', ['req', '-new', '-x509', '-key', temporaryKey, '-out', cert, '-days', '10000', '-subj', '/CN=AppleSeed/O=AppleSeed']);
    run('/usr/bin/openssl', ['pkcs8', '-topk8', '-inform', 'PEM', '-outform', 'DER', '-in', temporaryKey, '-out', key, '-nocrypt']); chmodSync(key, 0o600);
  } finally { rmSync(temporaryKey, { force: true }); }
}
chmodSync(key, 0o600); chmodSync(cert, 0o600);
const apk = path.join(out, `AppleSeed-${version}.apk`);
run(path.join(tools, 'apksigner'), ['sign', '--key', key, '--cert', cert, '--out', apk, path.join(build, 'aligned.apk')]);
console.log(run(path.join(tools, 'apksigner'), ['verify', '--verbose', apk]).trim());
run(path.join(tools, 'zipalign'), ['-c', '4', apk]);
console.log(run(path.join(tools, 'aapt2'), ['dump', 'badging', apk]).split('\n').filter(line => /^(package:|minSdkVersion:|targetSdkVersion:|application-label:|launchable-activity:|uses-permission:)/.test(line)).join('\n'));
copyFileSync(apk, path.join(root, 'public/AppleSeed.apk'));
console.log(`Signed APK: ${apk}`);
