# Web Portal

AppleSeed can temporarily allow access from a desktop browser without installing software or Tailscale on that computer. The host and controlling AppleSeed client still use Tailscale for private controls. The portal is optional and requires its own HTTPS route to the host.

The 2.0 platform ports are development builds. Automated protocol and browser tests pass, but a real phone, real Mac lock screen, and the intended travel computer must be tested before relying on it away from home.

## Use it

1. Connect AppleSeed to the Mac with its Mac account. On a Mac, use its authorized Mac account. Windows/Linux hosts use the password-authenticated VNC adapter described in DESKTOP.md.
2. Open **Web Portal** on the opening screen or live toolbar.
3. Select an access duration, from 1 to 720 minutes, and tap **Enable portal**.
4. Open the displayed HTTPS address on your computer. Tap **Copy code**, then paste the eight-character code within five minutes. The code can pair one browser only and cannot be reused.
5. Select a monitor. For two local screens, click **Open second monitor**, move the new window to your other screen, and choose Fullscreen in each window. Allow the site's popup if the browser blocks it.
6. Tap **Disable now** on the phone or **End access** in the browser to close both remote connections immediately. The selected timer also ends access.

Closing AppleSeed or a browser window does not disable the portal. A new session invalidates the previous code and browser session. Restarting the Mac or AppleSeed service always turns the portal off. If the code expires before pairing, choose **New session**. A page left open while the portal is off must be reloaded after enabling it.

The two browser windows share one Mac desktop and one Mac cursor. They do not create independent user sessions or virtual monitors. Both home monitors must be connected and detected by macOS. A screen that disconnects when powered off cannot be shown until it reconnects. Some managed work computers block remote desktop traffic or popups; test that computer before travel.

## Host configuration

The private AppleSeed service stays on loopback port **18796**, behind private Tailscale Serve. macOS Screen Sharing stays on **5900**. Never route either port through a public tunnel.

Configure these non-secret environment variables in the AppleSeed launchd service:

```text
APPLESEED_PORTAL_URL=https://example.com/appleseed/remote
APPLESEED_PORTAL_PORT=18798
```

The URL must use HTTPS and a path made of letters, numbers, hyphens, or underscores. A nested path such as `/appleseed/remote` is supported. Use `/remote` when the app has its own domain. The portal listens only on `127.0.0.1:18798`. The installer preserves an existing portal URL and port when updating the service. Restart the service after changing its configuration; doing so revokes any active portal session.

Route only this path through the HTTPS tunnel. For an existing Cloudflare Tunnel, place the specific route before a broader route for the same hostname:

```yaml
ingress:
  - hostname: example.com
    path: ^/appleseed/remote(/.*)?$
    service: http://127.0.0.1:18798
  # Keep the existing routes and final catch-all here.
```

Validate the tunnel configuration before restarting it. Preserve the original public Host and Origin. Do not expose the private listener, add a public route to all AppleSeed services, or pass public requests into the owner API. No router port forwarding is needed with Cloudflare Tunnel.

The disabled portal returns **404 Unavailable**. When enabled it serves a code form. The public listener has no routes to unlock, change power settings, or enable the portal.

## Access protection

The Mac authenticates the supplied account with its local Screen Sharing service before issuing a code. The code has 40 bits of randomness, expires after five minutes, and is limited to five attempts per minute and twenty attempts total. Pairing creates a random secure, HttpOnly, same-site cookie. The cookie grants at most two desktop connections until the selected expiry. Exact Host and Origin checks protect pairing, logout, and WebSocket access.

Mac credentials remain temporarily in the Mac service's memory while the portal is enabled. They are not included in the page, cookie, browser storage, logs, source, or APK. Disabling or expiring a session clears the credential buffers and closes its connections. The browser receives remote screen content and can control the Mac, so use a computer you trust.

Cloudflare terminates HTTPS and forwards traffic through its tunnel. Cloudflare is therefore part of the trust boundary; this is not end-to-end encryption through Cloudflare. See [SECURITY.md](../SECURITY.md) for limits.

## Pre-travel check

- Verify normal AppleSeed access over the phone's cellular connection and Tailscale.
- Verify both home screens in the phone overview and the two browser windows.
- Disable the portal from the phone and verify that both browser windows stop receiving the desktop.
- Verify expiry with a one-minute session, then choose the duration needed for actual use.
- For Safe Unlock, enable AppleSeed in macOS Accessibility and verify that the Mac exposes its secure login field. Every tap checks the current Mac lock state before filling only that secure field. The button reports Already unlocked once the Mac is unlocked. It never falls back to blind password keystrokes.

The portal cannot start a powered-off Mac or bypass FileVault's preboot unlock screen. A service restart after a power outage turns public access off until enabled again from the phone.
