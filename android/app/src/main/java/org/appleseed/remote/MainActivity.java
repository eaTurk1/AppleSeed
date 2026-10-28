package org.appleseed.remote;

import android.app.Activity;
import android.app.AlertDialog;
import android.widget.EditText;
import android.text.InputType;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.Insets;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.view.WindowInsetsController;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

public final class MainActivity extends Activity {
    private int BG, RED, INK, MUTED;
    private FrameLayout root;
    private RemoteSession remote;
    private LinearLayout fallback;
    private TextView brand, stateTitle, stateMessage;
    private Button retry, tailscale, chooseMac, appearanceButton;
    private CredentialVault vault;
    private int lastOrientation;

    @Override public void onCreate(Bundle state) {
        setTheme(Appearance.light(this) ? R.style.AppleSeedLightTheme : R.style.AppleSeedTheme);
        super.onCreate(state);
        applyAppearance();
        vault = new CredentialVault(this);
        String configured = ConnectionPolicy.normalize(getPreferences(MODE_PRIVATE).getString("macURL", ""));
        ConnectionPolicy.URL = configured == null ? "" : configured;
        lastOrientation = getResources().getConfiguration().orientation;
        if (Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);
        root = new FrameLayout(this); root.setBackgroundColor(BG);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                Insets padding = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime() | WindowInsets.Type.displayCutout());
                view.setPadding(padding.left, padding.top, padding.right, padding.bottom);
            } else view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });
        setContentView(root); root.requestApplyInsets();
        createFallback();
    }
    private int dp(float value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private TextView text(String label, int size, int color, boolean bold) {
        TextView view = new TextView(this); view.setText(label); view.setTextSize(size); view.setTextColor(color);
        view.setGravity(Gravity.CENTER); view.setTypeface(Typeface.create("sans-serif", bold ? Typeface.BOLD : Typeface.NORMAL)); return view;
    }
    private void createFallback() {
        fallback = new LinearLayout(this); fallback.setOrientation(LinearLayout.VERTICAL); fallback.setGravity(Gravity.CENTER);
        fallback.setPadding(dp(26), dp(24), dp(26), dp(28));
        LinearLayout heading = new LinearLayout(this); heading.setGravity(Gravity.CENTER_VERTICAL);
        brand = text(Edition.NAME, 24, INK, true); brand.setGravity(Gravity.START); heading.addView(brand, new LinearLayout.LayoutParams(0, -2, 1));
        appearanceButton = button(Appearance.label(this) + " ▾", false); appearanceButton.setTextSize(11); appearanceButton.setContentDescription("Appearance: " + Appearance.label(this)); appearanceButton.setOnClickListener(v -> chooseAppearance());
        heading.addView(appearanceButton, new LinearLayout.LayoutParams(dp(82), dp(36))); fallback.addView(heading, new LinearLayout.LayoutParams(-1, -2));
        ImageView seed = new ImageView(this); seed.setImageResource(R.drawable.appleseed_logo); seed.setScaleType(ImageView.ScaleType.FIT_CENTER); seed.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO); LinearLayout.LayoutParams image = new LinearLayout.LayoutParams(dp(190), dp(190)); image.topMargin = dp(28); fallback.addView(seed, image);
        stateTitle = text("Connecting.", 34, INK, true); fallback.addView(stateTitle);
        stateMessage = text("Your Mac. Always within reach.", 13, MUTED, false); stateMessage.setLineSpacing(dp(5), 1); stateMessage.setPadding(0, dp(14), 0, dp(26)); fallback.addView(stateMessage);
        retry = button("Retry connection ↗", true); retry.setOnClickListener(v -> loadMac()); fallback.addView(retry, buttonParams());
        tailscale = button("Open Tailscale", false); tailscale.setOnClickListener(v -> openTailscale()); fallback.addView(tailscale, buttonParams());
        chooseMac = button("Set Mac address", false); chooseMac.setOnClickListener(v -> configureMac()); fallback.addView(chooseMac, buttonParams());
        root.addView(fallback, new FrameLayout.LayoutParams(-1, -1));
    }
    private LinearLayout.LayoutParams buttonParams() { LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, dp(54)); p.topMargin = dp(10); return p; }
    private Button button(String label, boolean accent) {
        Button view = new Button(this); view.setText(label); view.setAllCaps(false); view.setTextSize(13);
        view.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        paintButton(view, accent); return view;
    }
    private void paintButton(Button view, boolean accent) {
        if (view == null) return;
        boolean light = Appearance.light(this); view.setTextColor(accent ? Color.WHITE : INK);
        GradientDrawable drawable = new GradientDrawable(); drawable.setColor(accent ? RED : light ? Color.WHITE : Color.rgb(21,22,27)); drawable.setCornerRadius(dp(10));
        if (!accent) drawable.setStroke(dp(1), light ? Color.rgb(212,215,224) : Color.rgb(39,40,46));
        view.setBackground(drawable);
    }
    private void chooseAppearance() {
        String mode = Appearance.mode(this); int selected = "light".equals(mode) ? 0 : "dark".equals(mode) ? 1 : 2;
        new AlertDialog.Builder(this).setTitle("Appearance").setSingleChoiceItems(new String[]{"Light", "Dark", "Auto"}, selected, (dialog, index) -> {
            getPreferences(MODE_PRIVATE).edit().putString("appearance", new String[]{"light","dark","auto"}[index]).apply();
            dialog.dismiss(); applyAppearance();
        }).setNegativeButton("Cancel", null).show();
    }
    void applyAppearance() {
        boolean light = Appearance.light(this);
        BG = Appearance.background(this); RED = light ? Color.rgb(217,34,59) : Color.rgb(255,61,82);
        INK = light ? Color.rgb(25,27,34) : Color.rgb(243,243,245); MUTED = light ? Color.rgb(97,102,114) : Color.rgb(137,138,148);
        setTheme(light ? R.style.AppleSeedLightTheme : R.style.AppleSeedTheme);
        if (root != null) root.setBackgroundColor(BG);
        if (brand != null) brand.setTextColor(INK);
        if (stateTitle != null) stateTitle.setTextColor(INK);
        if (stateMessage != null) stateMessage.setTextColor(MUTED);
        paintButton(retry, true); paintButton(tailscale, false); paintButton(chooseMac, false); paintButton(appearanceButton, false);
        if (appearanceButton != null) { appearanceButton.setText(Appearance.label(this) + " ▾"); appearanceButton.setContentDescription("Appearance: " + Appearance.label(this)); }
        getWindow().setStatusBarColor(BG); getWindow().setNavigationBarColor(BG);
        if (remote != null) remote.appearance();
        if (root != null) updateWindowMode();
    }
    void configureMac() {
        if (remote != null) remote.close(null); remote = null;
        fallback.setVisibility(View.VISIBLE); retry.setVisibility(View.VISIBLE); chooseMac.setVisibility(View.VISIBLE);
        stateTitle.setText("Choose your Mac."); stateMessage.setText("Use the private HTTPS address printed by the Mac installer. Tailscale must be connected on both devices.");
        EditText input = new EditText(this); input.setSingleLine(true); input.setTextColor(INK); input.setTextSize(14);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setHint("https://mac.your-tailnet.ts.net:9447"); input.setText(ConnectionPolicy.URL);
        LinearLayout container = new LinearLayout(this); container.setPadding(dp(24), dp(12), dp(24), dp(8)); container.addView(input, new LinearLayout.LayoutParams(-1, -2));
        AlertDialog dialog = new AlertDialog.Builder(this).setTitle("Mac address").setView(container)
            .setNegativeButton("Cancel", (d, which) -> {}).setPositiveButton("Save & connect", null).create();
        dialog.setOnShowListener(d -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            String url = ConnectionPolicy.normalize(input.getText().toString());
            if (url == null) { input.setError("Enter https://<mac>.<tailnet>.ts.net:9447"); return; }
            try {
                if (!url.equals(ConnectionPolicy.URL)) vault.forget();
                if (!getPreferences(MODE_PRIVATE).edit().putString("macURL", url).commit()) throw new Exception();
                ConnectionPolicy.URL = url; dialog.dismiss(); loadMac();
            } catch (Exception ignored) { input.setError("Could not save the address. Try again."); }
        }));
        dialog.show();
    }
    private void openTailscale() {
        Intent launch = getPackageManager().getLaunchIntentForPackage("com.tailscale.ipn");
        if (launch != null) startActivity(launch); else startActivity(new Intent(Settings.ACTION_VPN_SETTINGS));
    }
    void showError(String title, String message) {
        stateTitle.setText(title); stateMessage.setText(message);
        fallback.setVisibility(View.VISIBLE); fallback.bringToFront(); retry.setVisibility(View.VISIBLE); tailscale.setVisibility(View.VISIBLE); chooseMac.setVisibility(View.VISIBLE);
    }
    void presentConnecting() {
        stateTitle.setText("Connecting."); stateMessage.setText("Establishing your private connection.");
        retry.setVisibility(View.GONE); tailscale.setVisibility(View.GONE); chooseMac.setVisibility(View.GONE); fallback.setVisibility(View.VISIBLE);
    }
    void attachWeb(WebView view) {
        if (view.getParent() instanceof android.view.ViewGroup) ((android.view.ViewGroup) view.getParent()).removeView(view);
        root.addView(view, 0, new FrameLayout.LayoutParams(-1, -1));
    }
    void presentPage() { fallback.setVisibility(View.GONE); }
    private void loadMac() {
        if (ConnectionPolicy.URL.isEmpty()) { configureMac(); return; }
        if (remote != null) remote.close(null);
        remote = new RemoteSession(getApplicationContext()); remote.attach(this);
    }
    @Override protected void onResume() {
        super.onResume();
        if (remote == null || remote.closed) remote = RemoteSession.current;
        if (remote == null) loadMac(); else remote.attach(this);
        applyAppearance();
    }
    void requestSessionNotification() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED && !getPreferences(MODE_PRIVATE).getBoolean("notificationAsked", false)) {
            getPreferences(MODE_PRIVATE).edit().putBoolean("notificationAsked", true).apply();
            requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, 7);
        }
    }
    void updateWindowMode() {
        boolean sessionActive = remote != null && remote.lifetime.retainWhenHidden();
        Boolean requestedFullscreen = remote == null ? null : remote.requestedFullscreen;
        if (sessionActive && getPreferences(MODE_PRIVATE).getBoolean("phoneAwake", false)) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        boolean fullscreen = sessionActive && (requestedFullscreen != null ? requestedFullscreen : getResources().getConfiguration().orientation == Configuration.ORIENTATION_LANDSCAPE);
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                int lightBars = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                controller.setSystemBarsAppearance(Appearance.light(this) ? lightBars : 0, lightBars);
                controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                if (fullscreen) controller.hide(WindowInsets.Type.systemBars()); else controller.show(WindowInsets.Type.systemBars());
            }
        } else {
            int lightBars = Appearance.light(this) ? View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR : 0;
            getWindow().getDecorView().setSystemUiVisibility(lightBars | (fullscreen ? View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN : View.SYSTEM_UI_FLAG_VISIBLE));
        }
        if (root != null) root.requestApplyInsets();
    }
    @Override public void onConfigurationChanged(Configuration configuration) {
        super.onConfigurationChanged(configuration);
        boolean rotated = lastOrientation != configuration.orientation;
        if (rotated) { lastOrientation = configuration.orientation; if (remote != null) remote.orientation(configuration.orientation == Configuration.ORIENTATION_LANDSCAPE); }
        applyAppearance();

    }
    @Override protected void onStop() { if (remote != null) remote.detach(this); super.onStop(); }
    @Override public void onBackPressed() {
        if (remote != null && remote.back(() -> moveTaskToBack(true))) return;
        moveTaskToBack(true);
    }
    @Override protected void onDestroy() {
        if (remote != null) { remote.detach(this); remote.closeIfIdleAndDetached(); }
        super.onDestroy();
    }

}
