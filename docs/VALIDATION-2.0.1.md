# AppleSeed 2.0.1 validation

- 83 shared tests passed, including fullscreen entry/exit, explicit choices across rotation, selected-monitor and zoom preservation, control dismissal and Back behavior.
- The signed Android APK passed signature, alignment, asset-origin and deadline checks. Android emulator instrumentation verified hidden system bars, no reserved top/bottom space in fullscreen, retained explicit fullscreen requests, exit, and the existing theme/background-session/clipboard checks.
- The real shared client was exercised with a synthetic two-monitor desktop at 412 × 915 and 915 × 412 viewport sizes. Fullscreen occupied the complete viewport. Exit and Controls remained reachable, and monitor switching and remote tools were accessible through Controls.
- Android retains the official signing identity for installation over an existing AppleSeed APK. Tests use disposable emulator data and synthetic credentials.
- The Mac companion was rebuilt with the updated shared client. Windows, Linux and iOS binary downloads remain the previously validated 2.0.0 platform previews. Their source remains included, and current Mac hosts deliver the shared web-client update to browser, iOS and desktop viewers.

Phone-specific display cutouts and system navigation can vary. The Android emulator check does not claim a physical Samsung phone test. Remote desktop aspect ratio is preserved; pinch zoom remains available.
