# AppleSeed 2.0.0 preview validation

This is the first unified release and the first Windows, Linux and native iOS preview. Every feature is free. New ports need real-device feedback before a stable cross-platform release.

- Shared server, authentication, portal, client, input, timing and origin policies: 81 automated tests passed.
- Android: same official signing identity, APK alignment/signature checks, embedded client-asset checks and disposable Android emulator lifecycle tests passed. Tests cover theme, Back, retained sessions, background expiry, sensitive clipboard marking and notification disconnect. No real Mac password is used in these fixtures.
- Linux x64 and ARM64: packaged Electron apps launched under Xvfb in isolated Linux containers. Initial native bridge/UI and bundled host runtime checks passed on both architectures. These checks do not validate every compositor, VNC server, keyring or physical desktop configuration.
- Windows x64: portable executable and original AppleSeed icon/version resources packaged on macOS. Native Windows runtime validation is pending the GitHub Actions runner. Cross-packaging is not a Windows test.
- iOS: unsigned arm64 device and simulator release builds compiled in Xcode. The app launched in the iPhone simulator. Physical iPhone remote-desktop testing and Apple distribution signing remain pending.
- macOS: native companion built and its ad-hoc signature verified. The installed Mac service was updated while preserving its existing configuration. Full unattended restart and power-outage testing are outside these release checks.
- Public source and app bundles were checked for private owner paths and obvious private-key/token material. Release archives have SHA-256 checksums. This is not a claim of an independent security audit.

Use the setup instructions for the selected host. Mac secure-field Unlock and macOS power/display settings require the Mac companion. Windows/Linux hosting requires a separately configured localhost VNC server. iOS background execution is subject to Apple's suspension rules.
