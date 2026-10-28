# iPhone and iPad

The native SwiftUI/WKWebView client targets iOS/iPadOS 16 and newer. It uses the complete AppleSeed web client served by your selected host and requires the updated 2.0 host for the newest interface.

Connect Tailscale under the same user identity as the Mac, open AppleSeed, and paste the private HTTPS `.ts.net:9447` address copied from the Mac companion. The app rejects other origins and never accepts an invalid TLS certificate.

Credentials are stored only when you choose Remember, using a device-bound, unlocked-device Keychain item scoped to that host. A fresh authenticated HTTPS status check is required before loading or saving. Web Portal codes use the local clipboard with a short expiry and are not shared through Universal Clipboard.

Light, Dark and Auto appearance, orientation changes, remote controls, monitor selection, and the optional Web Portal use the shared client. iOS can suspend WebView networking after the app goes into the background. Keep it in the foreground while controlling the desktop; this client does not claim Android-style indefinite background sessions.

## Build

Open `ios/AppleSeed.xcodeproj`, select the AppleSeed scheme, and choose an iPhone simulator. To install on your own device, select your Apple Development signing team in Xcode and let Xcode manage a provisioning profile. A simulator build runs only in Simulator. An unsigned device `.app` cannot be installed as a normal downloaded iPhone app.

Public TestFlight or App Store distribution requires an Apple Developer Program account, a signing team, a bundle identifier available to that team, and App Store Connect setup. These are owner-account steps and are not included in the unsigned build. No signing certificates or provisioning profiles belong in the repository.
