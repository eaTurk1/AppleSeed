# AppleSeed

Remote Mac access from your Android phone over Tailscale, including the normal Mac lock screen while the Mac and service are online.

[Download AppleSeed and the Mac companion](https://github.com/eaTurk1/AppleSeed/releases/tag/v1.6.0) · [Website](https://erhan.ai/appleseed) · [Setup](SETUP.md)

AppleSeed includes relative trackpad control, clicking and dragging, pinch zoom, keyboard input, landscape fullscreen, an optional timer set before connection, encrypted credential remembering, and a background session notification. Tools stays visible with a lock.

AppleSeed Pro is a separate **$5 one-time** download. It adds quick password reuse for unlocking, monitor selection, display and screen saver controls, and session changes while connected. Checkout is being set up. Its APK and development repository are private and are not published here.

## Downloads

- `AppleSeed-1.6.0.apk`: Android 9 or newer.
- `AppleSeed-Mac-1.6.0-arm64.zip`: shared AppleSeed.app companion for Apple silicon, macOS 13 or newer.
- `SHA256SUMS.txt`: checksums for those two files.

The Mac companion is ad-hoc signed, not Apple-notarized. The native APK retains your configured Mac and encrypted credentials when installed over the signed 1.5 public app. AppleSeed Pro uses the same signing identity.

## Set up

1. Connect Tailscale on your Mac and phone under the same user identity.
2. Enable macOS System Settings → General → Sharing → Screen Sharing and allow your Mac account.
3. Unzip AppleSeed.app, move it to Applications, open it, and choose Setup Mac service… from its menu bar.
4. Choose Copy Mac address, then enter that private HTTPS address in the Android app.
5. Connect with the allowed Mac account. In AppleSeed, unlock the lock screen using the remote keyboard. The password shortcut in Tools belongs to AppleSeed Pro.

The shared Mac browser client has locked Tools. AppleSeed Pro's native client exposes the full controls. Your actual remote desktop stays on your Mac behind Tailscale; this public repository only distributes AppleSeed, the shared companion, and documentation.

## Limits

Tailscale and Screen Sharing are required. AppleSeed does not bypass passwords, FileVault, administrator restrictions, or macOS permissions. It cannot power on an offline Mac or unlock FileVault's preboot screen. Standard setup becomes available after the Mac has been signed in once. Network loss, Mac sleep, or Android process termination can end a session.

Useful for an OpenClaw, Codex, or other remote workstation when you need to configure something or personally approve a permission prompt. No special integration is required. Virtual mobile displays and monitor privacy covers are not included.

## Support and licensing

Report reproducible issues here with OS versions and steps. Never include passwords, saved credential files, or private machine addresses. Bundled components retain their license notices; the Mac companion contains the shared runtime and dependency source required by those notices. This is a binary distribution and documentation repository, not the complete development repository.

AppleSeed is not affiliated with Apple, Tailscale, OpenClaw, or OpenAI.
