# Security

Use your private Tailscale HTTPS address, never public VNC forwarding or Tailscale Funnel. Screen Sharing authenticates with your existing Mac account. Passwords stay in the session or in the optional Android Keystore-backed encrypted vault; they are not sent to checkout.

Changing the Mac address clears saved credentials. Certificate validation is strict. Backgrounding releases held input. Optional timers expire the connection on the Mac server as well as in the app.

Do not publish credentials, private addresses, or an exploit against an active remote workstation in an issue. For ordinary bugs, report OS versions and reproducible steps without private data.

This app cannot bypass FileVault, macOS permissions, administrator controls, or a Mac that is offline. Automated checks do not replace independent security review or physical-device testing.
