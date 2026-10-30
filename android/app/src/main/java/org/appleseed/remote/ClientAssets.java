package org.appleseed.remote;

import java.net.URI;

/** Ship input fixes with the APK while the Mac still authenticates the page, APIs and stream. */
public final class ClientAssets {
    private ClientAssets() {}
    public static String path(String url, String method, boolean mainFrame) {
        if (mainFrame || !"GET".equals(method) || !ConnectionPolicy.isTrusted(url)) return null;
        try {
            String path = new URI(url).getRawPath();
            switch (path) {
                case "/app-switcher.js": case "/app.js": case "/free-tools.js": case "/appearance.js": case "/quick-access.js": case "/safe-unlock.js": case "/portal-control.js": case "/monitor-strip.js": case "/stream-quality.js": case "/desktop-model.js": case "/desktop-controller.js": case "/apple-rfb.js": case "/style.css":
                    return "client" + path;
                default: return null;
            }
        } catch (Exception ignored) { return null; }
    }
}
