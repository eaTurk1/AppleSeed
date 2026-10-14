# AppleSeed 1.6.3

AppleSeed 1.6.3 fixes the connection teardown when you close the Android app or remove it from Recents. The foreground service retains the actual page and transport; reopening reuses the same session and timer deadline.

Also includes the 1.6.1 and 1.6.2 improvements:
- Preserve zoom across keyboard, layout and rotation changes, with up to 32x pinch zoom.
- Smaller cursor, finer trackpad control, smoother fast movement and reliable drag/release ordering.
- Auto, Quality and Speed stream modes, available before connection and during a live session.
- Release held input and cancel password typing when the app leaves the foreground.

**Updating:** install `AppleSeed-1.6.3.apk` over your existing official app. The package and signing identity are unchanged. Existing users do not need to reinstall the Mac companion. For new installations, this release includes the unchanged `AppleSeed-Mac-1.6.0-arm64.zip`.

Tailscale is required on both devices. AppleSeed works with the normal macOS lock screen while the Mac and service are online. Use the remote keyboard to unlock in AppleSeed. AppleSeed Pro's Tools > Unlock shortcut reuses your session password; Pro is private and is not included here.

Timer expiry and notification Disconnect still end the session. Android force-stop, process termination, network loss, or Mac sleep can end it too. Mac idle lock settings still apply. FileVault preboot, powered-off Macs, virtual mobile displays and privacy covers are unsupported.

Validation: 53 automated JavaScript/native-helper checks, 42 Android origin/asset policy checks, 10 deadline checks, APK signature/alignment verification, and Android 15 emulator checks for task removal, same-page reopening, Activity release, background timer expiry and notification Disconnect. The emulator uses synthetic page content. The owner reported the app-close fix appears to work on their phone; this is not verification of every device or cold boot.

See [SETUP.md](https://github.com/eaTurk1/AppleSeed/blob/main/SETUP.md) and `SHA256SUMS.txt`. The Mac companion requires Apple silicon and macOS 13+ and is ad-hoc signed, not notarized. Android 9+ is required.
