import org.appleseed.remote.ConnectionPolicy;
import org.appleseed.remote.ClientAssets;

public final class ConnectionPolicyTest {
    public static void main(String[] args) {
        if (ConnectionPolicy.isTrusted("https://mac.example.ts.net:9447/")) throw new AssertionError("Unconfigured app trusted an origin");
        String configured = ConnectionPolicy.normalize(" https://MAC.example.ts.net:9447 ");
        if (!"https://mac.example.ts.net:9447/".equals(configured)) throw new AssertionError("Normalization failed");
        ConnectionPolicy.URL = configured;
        String[] allowed = { configured, configured + "api/status", configured + "novnc/core/rfb.js" };
        String[] denied = { "http://mac.example.ts.net:9447/", "https://mac.example.ts.net/", "https://mac.example.ts.net:443/", "https://mac.example.ts.net.evil.example:9447/", "https://evil.example@mac.example.ts.net:9447/", "https://other.example.ts.net:9447/", "file:///etc/passwd", "content://example", "javascript:alert(1)", "intent://example", "https://[invalid" };
        for (String value : allowed) if (!ConnectionPolicy.isTrusted(value)) throw new AssertionError("Trusted origin rejected");
        for (String value : denied) if (ConnectionPolicy.isTrusted(value)) throw new AssertionError("Untrusted origin accepted");
        String[] badSetup = { "https://example.com:9447/", "https://mac.example.ts.net:9447/api/status", configured + "?x=1", configured + "#x", "https://user@mac.example.ts.net:9447/", "https://mac.example.ts.net.:9447/", "https://127.0.0.1:9447/", "https://mac.example.ts.net:443/", "http://mac.example.ts.net:9447/" };
        for (String value : badSetup) if (ConnectionPolicy.normalize(value) != null) throw new AssertionError("Invalid endpoint configured");
        ConnectionPolicy.URL = "https://second.example.ts.net:9447/";
        if (ConnectionPolicy.isTrusted(configured)) throw new AssertionError("Previous Mac remained trusted");
        String origin = ConnectionPolicy.URL;
        for (String asset : new String[]{"app.js", "free-tools.js", "appearance.js", "quick-access.js", "safe-unlock.js", "portal-control.js", "monitor-strip.js", "stream-quality.js", "desktop-model.js", "desktop-controller.js", "apple-rfb.js", "style.css"}) {
            if (!("client/" + asset).equals(ClientAssets.path(origin + asset, "GET", false))) throw new AssertionError("Client fix not bundled");
        }
        for (String path : new String[]{"", "api/status", "api/screen", "vnc", "novnc/core/rfb.js", "credential-vault", "%2e%2e/style.css"}) {
            if (ClientAssets.path(origin + path, "GET", false) != null) throw new AssertionError("Mac authentication or protocol request intercepted");
        }
        if (ClientAssets.path(origin + "style.css", "POST", false) != null || ClientAssets.path(origin + "style.css", "GET", true) != null || ClientAssets.path("https://other.example.ts.net:9447/style.css", "GET", false) != null) throw new AssertionError("Asset boundary failed");
        System.out.println("Android origin and client asset policy: 46 checks passed.");
    }
}
