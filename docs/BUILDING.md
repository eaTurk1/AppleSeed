# Build AppleSeed

The complete source is MIT-licensed. Do not commit personal configuration, credentials, signing keys or provisioning profiles.

## Shared client and host

Use Node.js 22 or newer and run `npm ci` followed by `npm test`. The web client lives in `public/`, the temporary browser portal in `portal/`, and the private loopback bridge in `server.mjs`. macOS adapters are in `native/`. Never expose the owner listener or VNC directly to the public Internet.

## Android

Install Android SDK platform 36, build tools 36.0.0, and JDK 17. Set `ANDROID_HOME` and `JAVA_HOME` when they are outside their standard Mac locations. Run `npm run build-apk`. There is one complete AppleSeed APK.

The builder retains its signing identity outside the checkout under `~/Library/Application Support/AppleSeed/public-signing`. Back it up privately. A release signed with a different identity cannot update existing installations. The source contains no release signing key. CI can build with a new development identity, but maintainers must use the original private identity for official updates.

The APK contains the shared input/layout modules, so Android UI fixes can work with existing compatible Mac services. A new native Mac feature can still require the matching companion. The builder checks origin/asset policy, timer lifetime, APK signature and alignment.

For native lifecycle checks, set `APPLESEED_TEST_EMULATOR` to a disposable emulator serial and run `node scripts/test-android-session.mjs`. Physical phones are refused. The fixture uses a synthetic private origin and does not use a real Mac password.

## Mac companion

Build on Apple silicon with a standalone Node binary: `APPLESEED_NODE=/absolute/path/to/node npm run build-mac`. The output is `native/build/AppleSeed.app`. The builder compiles native code and includes the runtime, pinned dependencies, sources, licenses and setup docs. The local build is ad-hoc signed with a stable bundle identifier. Commercial signing and notarization require the maintainer's Apple signing account.

`npm run install-companion` installs the menu-bar app for the current account. User-login setup and optional boot setup are separate. See [setup](SETUP.md) and preserve an existing boot-service configuration when upgrading.

## Windows and Linux desktop

Run `npm --prefix desktop ci`. Package with `node desktop/package.mjs win32 x64` or `node desktop/package.mjs linux x64`. The packager downloads the matching official Electron runtime and includes the shared host/client runtime. Windows icon/version resources are branded locally; unsigned output is not represented as an Authenticode release. Runtime archives are created from `desktop/dist/AppleSeed-<platform>-<arch>`.

`--smoke-test` checks a packaged app's initial UI using disposable user data and exits. Use a native Windows runner or a Linux graphical/Xvfb environment for runtime tests. Cross-packaging on a Mac alone does not verify the target OS.

## iOS and iPadOS

See [iOS build and distribution](IOS.md). Open `ios/AppleSeed.xcodeproj`. Build the AppleSeed scheme for Simulator or select your own development signing team for a connected iPhone. `node scripts/build-ios.mjs` builds unsigned device and simulator release apps and strips private linker debug paths. Select the full Xcode installation with `DEVELOPER_DIR` if necessary. Do not commit team profiles or certificates. Unsigned `.app` output is for subsequent signing, not direct public iPhone installation.

## Publication

Run tests, inspect the public-source allowlist, scan it and the final artifacts for private paths/secrets, then generate checksums. Publish the reviewed source and artifacts to GitHub and update the existing website. Keep donation-provider payout details out of the source. A payment-provider setup step must not block free downloads or any app feature.
