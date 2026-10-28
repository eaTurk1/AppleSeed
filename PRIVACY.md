# Privacy

AppleSeed is a free, open-source remote desktop tool. No AppleSeed developer account, analytics service or license server is required.

The remote connection goes to the computer address you choose over Tailscale. Screen Sharing/VNC authenticates it. Stored credentials stay on your device using Android Keystore, iOS Keychain or an available desktop OS encryption backend. Forget password removes that app's saved credential for the selected endpoint. App credentials are not backed up through the Android app.

The optional Web Portal temporarily holds its authorized host credentials in host RAM to connect approved browser windows. It uses a one-use pairing code and a secure browser cookie, expires automatically, and is disabled after a service restart. A reverse-proxy provider terminating HTTPS can observe portal traffic. This is not end-to-end encryption through that provider.

The public website and GitHub are separate from private remote sessions and may receive normal server request metadata. Optional support links open an external payment provider; its privacy policy applies there. Tips are never required for an app feature.

When reporting bugs, remove passwords, tokens, private machine names, Tailscale addresses and personal screen content. Contact the maintainer through the repository's security instructions for sensitive reports.
