// Unsigned release builds. Development signing is configured separately in Xcode.
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
for (const target of ['device', 'simulator']) {
  const simulator = target === 'simulator';
  const output = path.join(root, 'ios/build', target);
  execFileSync('xcodebuild', ['-project', 'ios/AppleSeed.xcodeproj', '-scheme', 'AppleSeed', '-configuration', 'Release', '-sdk', simulator ? 'iphonesimulator' : 'iphoneos', '-destination', simulator ? 'generic/platform=iOS Simulator' : 'generic/platform=iOS', '-derivedDataPath', output, 'CODE_SIGNING_ALLOWED=NO', 'build'], {cwd: root, stdio: 'inherit'});
  const binary = path.join(output, 'Build/Products', simulator ? 'Release-iphonesimulator' : 'Release-iphoneos', 'AppleSeed.app/AppleSeed');
  // Remove linker debugger records containing the builder's absolute paths.
  execFileSync('xcrun', ['strip', '-S', binary], {stdio: 'inherit'});
  if (readFileSync(binary).includes(Buffer.from(root))) throw Error('Private build path remains in iOS executable');
}
