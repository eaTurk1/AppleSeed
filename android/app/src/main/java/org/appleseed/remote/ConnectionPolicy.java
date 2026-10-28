package org.appleseed.remote;

import java.net.URI;
import java.util.Locale;

/** Pin all WebView and credential access to the Mac explicitly chosen on this phone. */
public final class ConnectionPolicy {
    public static volatile String URL = "";
    private ConnectionPolicy() {}
    public static String normalize(String value) {
        try {
            URI uri = new URI(value.trim());
            String host = uri.getHost();
            if (!"https".equals(uri.getScheme()) || host == null || uri.getPort() != 9447
                || uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null
                || !(uri.getRawPath().isEmpty() || "/".equals(uri.getRawPath()))) return null;
            host = host.toLowerCase(Locale.ROOT);
            if (!host.matches("[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.ts\\.net")) return null;
            return "https://" + host + ":9447/";
        } catch (Exception ignored) { return null; }
    }
    public static boolean isTrusted(String value) {
        try {
            if (URL.isEmpty()) return false;
            URI uri = new URI(value), origin = new URI(URL);
            return "https".equals(uri.getScheme()) && origin.getHost().equalsIgnoreCase(uri.getHost())
                && uri.getPort() == 9447 && uri.getRawUserInfo() == null;
        } catch (Exception ignored) { return false; }
    }
}
