# AppleSeed setup and recovery

## Standard Mac app setup

Connect Tailscale, enable macOS Screen Sharing for your chosen account, put AppleSeed.app in a permanent Applications folder, and choose Setup Mac service from its menu bar icon. It creates a login agent, copies its web runtime into `~/Library/Application Support/MacUnlock/app`, and configures private HTTPS with Tailscale Serve. It does not grant Screen Sharing access, change security settings, or install a privileged helper.

The server listens only on `127.0.0.1:18796` and connects only to local Screen Sharing on port 5900. Tailscale Serve forwards HTTPS port 9447 to it and supplies user identity headers. AppleSeed restricts remote requests to the Tailscale user who owns the Mac. Tagged devices lacking user identity are unsupported. Other members of the same tailnet do not automatically get access.

If setup reports another listener on port 9447, inspect `tailscale serve status` and resolve the conflict yourself. AppleSeed will not overwrite it. If Tailscale returns a URL to enable HTTPS/Serve, follow its normal configuration flow and run Setup again. Do not turn on Funnel.

Use **Copy Mac address** in the menu to copy the installed Phone URL. The app's Setup guide, Screen Sharing settings, and Open Tailscale menu items provide shortcuts. The Mac display helper runs in the signed-in Aqua session; safe Unlock requires AppleSeed to be enabled in System Settings → Privacy & Security → Accessibility. Display timing controls do not require that permission.

## Optional boot service and power settings

Use this only if you understand your Mac's existing setup. The boot installer requires an **already-running Homebrew Tailscale system daemon** at `/var/run/tailscaled.socket`, and **FileVault already off**. It refuses to disable FileVault or install/replace Tailscale. The GUI Tailscale client by itself is not sufficient for this boot path.

From an extracted source checkout with dependencies installed, run the installer using a **standalone** Node binary (a Homebrew Node binary often cannot be relocated). From a downloaded Mac app, the same script and runtime are bundled:

```sh
cd "$HOME/Applications/AppleSeed.app/Contents/Resources/runtime"
sudo ./node scripts/system-service.mjs install
```

It installs a root-owned server runtime under `/Library/Application Support/MacUnlock` and the `org.appleseed.remote.service` LaunchDaemon. The server runs as your normal Mac user, not root. The root helper permits only display-off and bounded display/sleep timer changes for the specified power source; it cannot execute arbitrary commands. The companion is still needed in the signed-in desktop for screen saver and awake controls.

Configure the matching **system-daemon** listener using the exact command printed by the installer. If GUI and system Tailscale identities differ, use the Phone URL from the boot installer. Do not expose port 18796 or 5900 publicly.

Before relying on outage recovery, save your work, arrange local fallback access, perform a controlled restart, and test from your phone's mobile data **before local sign-in**. Then confirm that signing in through the visible login screen reaches the actual desktop. The installer does not reboot the Mac, enable automatic restart, or bypass disk unlocking. No cold-boot claim is made by this release.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Mac unreachable | Power, internet, Tailscale connected on both devices, saved HTTPS URL, listener status |
| Access denied | Same Tailscale user identity; a different user or a tagged node is rejected |
| Connect disabled | Screen Sharing enabled, intended account allowed, no other AppleSeed session open |
| Return to Connect | Read the displayed reason; check network, timer, Mac sleep, and service logs |
| One monitor missing | Turn both physical monitors on. macOS may disconnect a powered-off monitor. The monitor list refreshes automatically; only displays actually included in Screen Sharing can be controlled |
| Safe Unlock disabled | Enable AppleSeed in Accessibility, update both Mac and APK, select the loginwindow password field, and wait for Mac verification. There is no blind-typing fallback |
| Unlock attempt already sent | Wait for the live result. Automatic retries stay blocked for that lock cycle, including ambiguous failures |
| Power timers unavailable | Install the optional boot/power helper; ordinary login setup does not grant sudo |
| Screen saver controls unavailable | Mac must be signed in with AppleSeed companion running |
| First Mac launch blocked | Release is not notarized; use macOS's normal security review flow if you choose to trust it |

Logs are stored locally under `~/Library/Logs/MacUnlock`. They include startup errors and connection duration/backpressure counters, not passwords or framebuffer bytes. Review and redact paths, account names, and private URLs before sharing logs.

## Optional Web Portal

See [Web Portal setup](WEB-PORTAL.md). It uses its own public listener and does not publish the private owner API.

## Remove

First disconnect from the phone. Stop the login server with the bundled command:

```sh
cd "$HOME/Applications/AppleSeed.app/Contents/Resources/runtime"
./node scripts/service.mjs uninstall
launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/org.appleseed.remote.companion.plist"
rm "$HOME/Library/LaunchAgents/org.appleseed.remote.companion.plist"
```

Quit AppleSeed and remove its app if desired. Remove only its port 9447 listener with `tailscale serve --https=9447 off` using the same client/daemon as setup. Never use `serve reset` on a Mac hosting other services. The boot service has a separate removal command, `sudo ./node scripts/system-service.mjs uninstall`, from the same installation source. It removes its daemon and restricted power permission but leaves runtime files and logs for you to review/remove.
