package org.appleseed.remote;

import android.content.Context;
import android.content.ClipData;
import android.content.ClipDescription;
import android.content.ClipboardManager;
import android.content.SharedPreferences;
import android.content.MutableContextWrapper;
import android.view.ViewGroup;
import android.os.SystemClock;
import android.os.PersistableBundle;
import java.lang.ref.WeakReference;

import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Handler;
import android.view.View;
import android.view.inputmethod.InputMethodManager;
import android.webkit.CookieManager;
import android.webkit.HttpAuthHandler;
import android.webkit.SslErrorHandler;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;
import android.webkit.JsPromptResult;
import android.webkit.RenderProcessGoneDetail;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.net.URL;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONObject;

/** The connection belongs to the foreground session, never to a dismissed Activity. */
final class RemoteSession {
    static RemoteSession current;
    private final Context app;
    private final MutableContextWrapper context;
    private final SharedPreferences prefs;
    private final CredentialVault vault;
    final SessionLifetime lifetime = new SessionLifetime();
    private WeakReference<MainActivity> owner = new WeakReference<>(null);
    private volatile WebView web;
    boolean pageReady, closed, loadFailed;
    Boolean requestedFullscreen;
    private String errorTitle, errorMessage;
    private final Handler handler = new Handler();
    private final Runnable timeout = () -> { if (!pageReady) showError("Mac unreachable.", "Connect Tailscale, then try again. Your Mac needs power and internet."); };

    RemoteSession(Context application) {
        app = application.getApplicationContext(); context = new MutableContextWrapper(app);
        prefs = app.getSharedPreferences("MainActivity", Context.MODE_PRIVATE);
        vault = new CredentialVault(app); current = this;
    }
    boolean back(Runnable fallback) {
        if (web == null || !pageReady || closed) return false;
        web.evaluateJavascript("typeof window.appleSeedBack === 'function' && window.appleSeedBack() === true", result -> {
            if (!"true".equals(result)) fallback.run();
        });
        return true;
    }
    interface ActivityAction { void run(MainActivity activity); }
    private void withActivity(ActivityAction action) {
        MainActivity activity = owner.get(); if (activity != null && !activity.isDestroyed()) action.run(activity);
    }
    private void updateActivity() { withActivity(activity -> activity.updateWindowMode()); }
    void attach(MainActivity activity) {
        owner = new WeakReference<>(activity); context.setBaseContext(activity);
        if (web == null) { if (!closed) load(); return; }
        activity.attachWeb(web); web.onResume();
        if (loadFailed) activity.showError(errorTitle, errorMessage);
        else if (pageReady) activity.presentPage(); else activity.presentConnecting();
        updateActivity(); signalVisibility(true);
        if (pageReady) orientation(activity.getResources().getConfiguration().orientation == Configuration.ORIENTATION_LANDSCAPE);
    }
    void detach(MainActivity activity) {
        if (owner.get() != activity) return;
        signalVisibility(false);
        if (web != null) { web.onPause(); removeParent(web); }
        owner.clear(); context.setBaseContext(app);
    }
    void closeIfIdleAndDetached() { if (owner.get() == null && !lifetime.retainWhenHidden()) close(null); }
    private static void removeParent(WebView view) {
        if (view.getParent() instanceof ViewGroup) ((ViewGroup) view.getParent()).removeView(view);
    }
    private void signalVisibility(boolean visible) {
        if (web != null && pageReady) web.evaluateJavascript("window.dispatchEvent(new CustomEvent('appleseed-visibility',{detail:{visible:" + visible + "}}));", null);
    }
    void appearance() {
        if (web == null) return;
        web.setBackgroundColor(Appearance.background(app));
        if (pageReady) {
            try {
                JSONObject detail = new JSONObject().put("mode", Appearance.mode(app)).put("light", Appearance.light(app));
                web.evaluateJavascript("window.dispatchEvent(new CustomEvent('appleseed-appearance',{detail:" + detail + "}));", null);
            } catch (Exception ignored) {}
        }
    }
    void orientation(boolean landscape) {
        if (web != null && pageReady) web.evaluateJavascript("window.dispatchEvent(new CustomEvent('appleseed-orientation',{detail:{landscape:" + landscape + "}}));", null);
    }
    private void showError(String title, String message) {
        handler.removeCallbacks(timeout); pageReady = false; loadFailed = true; errorTitle = title; errorMessage = message;
        if (web != null) { web.stopLoading(); web.setVisibility(View.GONE); }
        withActivity(activity -> activity.showError(title, message));
    }
    private void load() {
        withActivity(activity -> activity.presentConnecting());
        web = new WebView(context); final WebView current = web;
        web.setBackgroundColor(Appearance.background(app)); web.setVisibility(View.INVISIBLE);
        web.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        WebView.setWebContentsDebuggingEnabled(false);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(false);
        settings.setUserAgentString(settings.getUserAgentString() + " AppleSeed/" + Edition.VERSION);
        web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE); settings.setSaveFormData(false);
        settings.setSupportMultipleWindows(false); settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSafeBrowsingEnabled(true);
        // Themes change the app chrome, never the streamed Mac pixels.
        if (android.os.Build.VERSION.SDK_INT >= 29) settings.setForceDark(WebSettings.FORCE_DARK_OFF);
        if (android.os.Build.VERSION.SDK_INT >= 33) settings.setAlgorithmicDarkeningAllowed(false);
        CookieManager.getInstance().setAcceptCookie(false); CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onJsPrompt(WebView view, String url, String message, String payload, JsPromptResult result) {
                if (view != web || !ConnectionPolicy.isTrusted(url) || !"AppleSeedNative".equals(message)) { result.cancel(); return true; }
                try {
                    JSONObject request = new JSONObject(payload);
                    String op = request.getString("op");
                    if ("settings".equals(op)) {
                        result.confirm(new JSONObject().put("appearance", Appearance.mode(app)).put("appearanceLight", Appearance.light(app)).put("phoneAwake", prefs.getBoolean("phoneAwake", false)).put("streamMode", prefs.getString("streamMode", "auto")).put("saved", vault.hasSaved()).put("seconds", prefs.getInt("seconds", 600)).toString());
                    } else if ("appearance-preference".equals(op)) {
                        String mode = request.getString("mode");
                        if (!Appearance.valid(mode)) throw new Exception();
                        prefs.edit().putString("appearance", mode).apply();
                        withActivity(activity -> activity.applyAppearance());
                        appearance(); result.confirm("true");
                    } else if ("configure".equals(op)) {
                        result.confirm("true"); handler.post(() -> withActivity(activity -> activity.configureMac()));
                    } else if ("capabilities".equals(op)) {
                        result.confirm(new JSONObject().put("phoneAwakeSupported", true).put("native", true).put("tools", true).put("storageLabel", "Android Keystore").put("backgroundSession", true).put("landscape", app.getResources().getConfiguration().orientation == Configuration.ORIENTATION_LANDSCAPE).toString());
                    } else if ("copy-portal-code".equals(op)) {
                        String code = request.getString("code");
                        if (owner.get() == null || !view.hasWindowFocus() || !code.matches("[2-9A-HJ-NP-Z]{8}")) throw new Exception();
                        ClipData clip = ClipData.newPlainText("AppleSeed Web Portal code", code);
                        PersistableBundle extras = new PersistableBundle();
                        extras.putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true);
                        clip.getDescription().setExtras(extras);
                        app.getSystemService(ClipboardManager.class).setPrimaryClip(clip);
                        result.confirm("true");
                    } else if ("support".equals(op)) {
                        result.confirm("true"); handler.post(() -> withActivity(activity -> activity.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://erhan.ai/appleseed/#support")))));
                    } else if ("fullscreen".equals(op)) {
                        requestedFullscreen = request.getBoolean("enabled"); updateActivity(); result.confirm("true");
                    } else if ("phone-awake".equals(op)) {
                        prefs.edit().putBoolean("phoneAwake", request.getBoolean("enabled")).apply(); updateActivity(); result.confirm("true");
                    } else if ("keyboard".equals(op)) {
                        if (!request.getBoolean("enabled")) app.getSystemService(InputMethodManager.class).hideSoftInputFromWindow(view.getWindowToken(), 0);
                        result.confirm("true");
                    } else if ("stream-preference".equals(op)) {
                        String mode = request.getString("mode");
                        if (!"auto".equals(mode) && !"quality".equals(mode) && !"speed".equals(mode)) throw new Exception();
                        prefs.edit().putString("streamMode", mode).apply(); result.confirm("true");
                    } else if ("timer-preference".equals(op)) {
                        int seconds = request.getInt("seconds");
                        if (seconds < 0 || seconds > 86400) throw new Exception();
                        prefs.edit().putInt("seconds", seconds).apply(); result.confirm("true");
                    } else if ("forget".equals(op)) {
                        vault.forget(); result.confirm("true");
                    } else if ("session-start".equals(op)) {
                        int seconds = request.getInt("seconds");
                        if (seconds < 0 || seconds > 86400) throw new Exception();
                        MainActivity activity = owner.get();
                        if (activity == null) throw new Exception();
                        app.startForegroundService(new Intent(app, SessionService.class));
                        lifetime.start(seconds, SystemClock.elapsedRealtime()); updateActivity();
                        activity.requestSessionNotification();
                        result.confirm("true");
                    } else if ("session-end".equals(op)) {
                        endFromPage(); result.confirm("true");
                    } else if ("load".equals(op) || "save".equals(op)) {
                        // Verify the owner-authorized, private Mac endpoint freshly before touching credentials.
                        // Never send the credentials in this HTTP request.
                        final String endpoint = ConnectionPolicy.URL;
                        new Thread(() -> {
                            String answer = "null";
                            HttpsURLConnection connection = null;
                            try {
                                connection = (HttpsURLConnection) new URL(endpoint + "api/status").openConnection();
                                connection.setConnectTimeout(5000); connection.setReadTimeout(5000); connection.setUseCaches(false);
                                connection.setInstanceFollowRedirects(false); connection.setRequestProperty("Cache-Control", "no-store");
                                if (connection.getResponseCode() == 200 && endpoint.equals(ConnectionPolicy.URL) && view == web) {
                                    if ("load".equals(op)) answer = vault.load();
                                    else {
                                        JSONObject credentials = request.getJSONObject("credentials");
                                        String username = credentials.getString("username"), password = credentials.getString("password");
                                        if (username.length() > 256 || password.isEmpty() || password.length() > 4096) throw new Exception();
                                        vault.save(new JSONObject().put("username", username).put("password", password).put("macAccount", credentials.getBoolean("macAccount")).toString()); answer = "true";
                                    }
                                }
                            } catch (Exception ignored) { /* No credential material in logs or error messages. */ }
                            finally { if (connection != null) connection.disconnect(); }
                            final String reply = answer;
                            handler.post(() -> { if (view == web) result.confirm(reply); else result.cancel(); });
                        }, "AppleSeed-vault").start();
                    } else result.cancel();
                } catch (Exception ignored) { result.cancel(); }
                return true;
            }
        });
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                if (view == web) close("Android stopped the screen renderer. Reconnect when ready.");
                return true;
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return !ConnectionPolicy.isTrusted(request.getUrl().toString()); }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) { return !ConnectionPolicy.isTrusted(url); }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (!ConnectionPolicy.isTrusted(request.getUrl().toString())) return new WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", null, new ByteArrayInputStream(new byte[0]));
                String asset = ClientAssets.path(request.getUrl().toString(), request.getMethod(), request.isForMainFrame());
                if (asset != null) {
                    try { return new WebResourceResponse(asset.endsWith(".css") ? "text/css" : "text/javascript", "UTF-8", app.getAssets().open(asset)); }
                    catch (Exception ignored) { return new WebResourceResponse("text/plain", "UTF-8", 503, "Client unavailable", null, new ByteArrayInputStream(new byte[0])); }
                }
                return null;
            }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler callback, SslError error) {
                callback.cancel(); if (view == web) showError("Connection blocked.", "The Mac's secure certificate could not be verified. Check the phone's date, network, and Tailscale.");
            }
            @Override public void onReceivedHttpAuthRequest(WebView view, HttpAuthHandler callback, String host, String realm) { callback.cancel(); }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (view == web && request.isForMainFrame()) showError("Mac unreachable.", "Connect Tailscale, then try again. Your Mac needs power and internet.");
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (view == web && request.isForMainFrame()) showError(response.getStatusCode() == 403 ? "Access denied." : "Mac unreachable.", response.getStatusCode() == 403 ? "Use the same Tailscale account as your Mac." : "The Mac service is unavailable. Try again shortly.");
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (view != web || !ConnectionPolicy.isTrusted(url) || loadFailed) return;
                finishPage(view);
            }
        });
        withActivity(activity -> activity.attachWeb(current));
        handler.postDelayed(timeout, 14000); web.loadUrl(ConnectionPolicy.URL);
    }
    private void finishPage(WebView view) {

        handler.removeCallbacks(timeout); pageReady = true; view.setVisibility(View.VISIBLE); withActivity(activity -> activity.presentPage());
        appearance();
        signalVisibility(owner.get() != null);
    }
    private void endFromPage() {
        lifetime.end(); requestedFullscreen = null; updateActivity();
        app.stopService(new Intent(app, SessionService.class));
        // Finish the native prompt before destroying a page that ended while detached.
        handler.post(() -> closeIfIdleAndDetached());
    }
    void close(String message) {
        if (closed) return;
        closed = true; lifetime.end(); requestedFullscreen = null;
        handler.removeCallbacksAndMessages(null);
        WebView old = web; web = null;
        if (old != null) { removeParent(old); old.stopLoading(); old.clearCache(true); old.clearHistory(); old.destroy(); }
        if (current == this) current = null;
        app.stopService(new Intent(app, SessionService.class));
        updateActivity();
        if (message != null) withActivity(activity -> activity.showError("Session closed.", message));
        owner.clear(); context.setBaseContext(app);
    }
}
