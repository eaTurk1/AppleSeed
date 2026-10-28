# Windows and Linux

The desktop app can connect to an AppleSeed host and can share its own computer through a local VNC server. All controls are free.

## Connect to a Mac

Connect Tailscale using the same user identity as the Mac. Extract the portable download and open `AppleSeed.exe` on Windows or `./AppleSeed` on Linux. Paste the private address copied from the Mac companion. The address must use HTTPS, your `.ts.net` name, and port 9447. Certificates are checked normally.

The desktop client offers the same remote controls and optional Web Portal. Its tray retains an active connection when its window closes. Use Disconnect or Quit to end it. Saved credentials use Electron safeStorage and are bound to the selected endpoint. Linux requires a working Secret Service/keyring; remembering is refused if Electron reports its plaintext backend.

## Share this computer

1. Install and connect Tailscale. AppleSeed uses the signed-in Tailscale user identity.
2. Install a VNC server suitable for your system and configure a password. Windows can use a separately installed VNC service. Linux X11 can use a physical-desktop VNC server; Wayland needs a compatible server for its compositor. AppleSeed does not translate RDP to VNC.
3. Bind the VNC server to `127.0.0.1`. Do not expose port 5900 to the Internet or tailnet.
4. In AppleSeed's initial window, expand **Share this computer**, select its local port, and press **Start sharing**.
5. Tailscale Serve must already be available to your user. If its CLI requests administrative setup, finish that through Tailscale's documented local setup. AppleSeed does not silently elevate privileges.
6. Enter the displayed private HTTPS address into another AppleSeed client. Authenticate using the VNC password requested by your server.

AppleSeed refuses to replace an unrelated Tailscale listener or use Funnel on port 9447. Its bridge listens only on loopback port 18796. Closing the window keeps an active host in its tray; Stop sharing or Quit ends it. OS startup/service configuration is separate. This GUI host does not promise access before the user has signed in.

## OS differences

Mac secure-field Unlock and macOS display/screen-saver settings are Mac companion features. For Windows/Linux sign-in, select the OS password field and use Keyboard. AppleSeed never pastes a remembered VNC password into an OS or application field. Display detection depends on your VNC server's shared framebuffer and monitor metadata.

For a browser Web Portal, configure a public HTTPS reverse proxy to loopback 18798 and enter its URL ending in `/remote` before starting the host. The route remains unavailable until enabled from an authenticated client. The non-Mac portal adapter requires classic password-authenticated RFB 3.7/3.8 and a 1–8 ASCII-character VNC password. Servers offering only no-auth, VeNCrypt, RDP, or another auth method cannot enable this adapter. The private desktop bridge supports the authentication methods implemented by noVNC, but the public portal must authenticate independently.

## Linux runtime libraries

A graphical session and common Electron runtime libraries are required, including GTK 3, NSS, X11/XCB, GBM, and ALSA. Install the equivalents from your distribution's package manager. The portable download is not a system daemon or a universal Wayland compatibility layer.
