# Security

AppleSeed provides powerful remote desktop access. Use it only on computers you own or are authorized to manage, through private Tailscale Serve or the explicitly enabled Web Portal. Never publish the owner API on port 18796 or raw VNC on port 5900. The optional public proxy must target only the separate portal listener, normally loopback port 18798.

## Boundaries

- The server binds loopback. Remote HTTP and WebSocket requests require the configured host and Tailscale owner identity. WebSocket and modifying API calls also require the exact same origin. Local processes on the Mac can reach the loopback server; AppleSeed is not a defense against a compromised local account.
- macOS Screen Sharing authenticates the Mac credentials. AppleSeed has no remote shell or arbitrary-command endpoint. It can type in the connected desktop after authentication, just like a remote user.
- The APK accepts a user-chosen HTTPS MagicDNS address on port 9447 and pins WebView requests and its native bridge to that origin. Invalid certificates are rejected. Changing the chosen address clears remembered credentials.
- Credentials are optional AES-GCM ciphertext protected by Android Keystore, bound to the endpoint. A fresh successful HTTPS owner check gates loading/saving. Plaintext exists in process memory while connecting and unlocking. Anyone with access to an unlocked phone running this app may use its saved access; protect the phone accordingly.
- In the Android WebView, cookies, browser storage, autofill, file/content access, WebView debugging, mixed content, and extra web windows are disabled. Screenshots are allowed at the owner's request; captured remote screens can contain sensitive information.
- Live sessions have bounded protocol buffers, one private-client enforcement, configurable expiry, and cleanup of held inputs and temporary awake state. Backgrounding is not a disconnect guarantee; operating systems and networks can terminate the session.
- The Mac companion's Unix socket is in a mode-0700 user directory, mode-0600 socket, and checks peer UID. The optional root helper supports only fixed power actions and bounded numbers. It cannot disable authentication, FileVault, or password requirements.

## Safe Unlock

The Mac shortcut requires an authenticated private session and exact origin, plus a short-lived, one-use nonce from the Mac companion. Each explicit tap checks fresh lock state. The companion verifies loginwindow executable identity and the secure-field subrole immediately before writing that exact Accessibility object. Passwords never use keyboard events or the clipboard. The only synthesized key is Return, directed to the same verified loginwindow process while the same password field remains focused. No arbitrary default button is pressed. Duplicate nonces are rejected; there is no automatic password retry. Unknown/unlocked state, a stale nonce, a missing helper or absent Accessibility permission prevents secure-field entry. Manual remote keyboard input remains ordinary user-controlled input. Non-Mac hosts do not offer the Mac shortcut.

## Optional Web Portal

- The public listener is separate from the owner API. It does not accept Tailscale headers as authentication and cannot invoke Unlock, power controls, or portal Enable.
- Portal enable/disable remains behind the existing private owner boundary. Enable authenticates to loopback macOS Screen Sharing using the Mac account first. Windows/Linux use a separate explicit classic-VNC adapter; it never downgrades the Mac ARD requirement and refuses a server offering only no-auth.
- Random 8-character codes contain 40 bits of entropy, expire after five minutes, and are consumed by one browser pairing. The portal allows five attempts per minute and twenty per code. Code hashes and browser token hashes stay in memory.
- Pairing issues a 256-bit Secure, HttpOnly, SameSite=Strict cookie restricted to the portal path. Two shared VNC connections are allowed for that browser. Exact Host and Origin checks protect WebSocket upgrades and modifying requests.
- A Mac-account credential copy is held only in the Mac service's memory for the selected portal duration. It authenticates each browser stream to loopback VNC and never goes to the browser or a relay. Buffers are cleared on disable, replacement, expiry, or restart. JavaScript runtimes may retain temporary immutable copies until garbage collection; this is not guaranteed memory erasure.
- Disable, expiry, and replacement revoke the cookie and terminate existing sockets. A service restart starts disabled. Phone app closure does not end the independently timed portal.
- HTTPS terminates at the configured reverse proxy. In a Cloudflare deployment, Cloudflare is part of the trust boundary and can technically inspect the browser desktop stream. The portal is not an end-to-end encrypted tunnel through Cloudflare. A compromised browser, host account, or same-origin website is outside this protection.
- This initial version supports Mac account ARD authentication. Classic separate VNC passwords and arbitrary target hosts are not supported by the portal.

## Reporting

Use the repository's **Security → Report a vulnerability** feature if private reporting is enabled. If it is unavailable, open a minimal issue requesting a private reporting channel without exploit details, credentials, private URLs, or captured screens. Do not post sensitive logs in public issues.

This release has automated regression checks and local integration checks; it has not had an independent security audit. Supported fixes target the current stable release.
