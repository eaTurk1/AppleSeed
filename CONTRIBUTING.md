# Contributing

AppleSeed has one free, open-source edition. Contributions must not add license keys, checkout requirements or feature paywalls.

Open a GitHub issue with reproducible steps, platform/client versions, host platform, VNC server when relevant, and expected versus actual behavior. Redact private addresses, passwords and screen content. Report security issues privately using SECURITY.md.

For code changes, run `npm ci` and `npm test`, then the relevant platform build. Preserve strict endpoint/TLS checks, owner-origin authorization, clipboard/credential boundaries and the distinction between a normal OS lock and preboot disk encryption. Do not add blind stored-password keystrokes as an unlock fallback.

New platforms and VNC adapters need protocol tests and runtime validation on the target OS. Label unverified distribution paths accurately. Keep the existing AppleSeed identity and make optional support entirely voluntary.
