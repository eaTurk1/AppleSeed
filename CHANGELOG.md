# AppleSeed 2.1.0

- Add Apps to the live toolbar and a three-finger upward swipe to open it.
- Show running Mac applications with icons. Bring an app forward or expand it to select a window.
- Expand Chrome, Edge, Brave, Chromium and Vivaldi into their open tabs across browser windows. Selection uses stable tab IDs and fails safely when a tab has closed or moved.
- Follow the selected window to its shared monitor. Keep the existing view when that monitor is unavailable.
- Add app/tab filtering and explicit Automation-permission guidance. Clear titles on close or background; keep owner controls private and unavailable while the Mac is locked.
- Keep unlock checks and password entry separate from app switching. Browser operations cannot block the companion's unlock request queue.

# AppleSeed 2.0.1

- Add Full screen beside Disconnect while viewing a desktop.
- Hide app toolbars and Android system bars for edge-to-edge viewing, with Exit full screen and Controls always available.
- Keep the selected monitor and zoom when entering, leaving or rotating fullscreen. Android Back closes controls, then exits fullscreen before leaving the app.

# AppleSeed 2.0.0 preview

- One complete, free, MIT-licensed AppleSeed edition. All Tools, monitors, session controls, Mac unlock and Web Portal access are included.
- Public source for Android, the Mac companion, Windows/Linux desktop clients and host bridges, and the native iOS/iPadOS client.
- Windows/Linux private hosts bridge an existing localhost VNC server through Tailscale Serve. Platform-specific Mac unlock/display controls stay Mac-only.
- iOS credentials use device-bound Keychain and strict endpoint/TLS checks. Public iOS installation still requires owner signing and TestFlight/App Store setup.
- Optional support replaces upgrades and checkout. Tips never gate features.
- Retain direct home/live Unlock and Web Portal shortcuts, the unlock strip below the desktop image, guarded secure-field password entry, remembered theme, 32× zoom and stream optimization.

New platform ports are development builds. Check the platform setup and release validation notes before using unattended access.
