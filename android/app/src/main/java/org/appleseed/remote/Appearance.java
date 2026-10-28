package org.appleseed.remote;

import android.content.Context;
import android.content.res.Configuration;
import android.graphics.Color;

final class Appearance {
    static boolean valid(String mode) { return "auto".equals(mode) || "light".equals(mode) || "dark".equals(mode); }
    static String mode(Context context) {
        String mode = context.getSharedPreferences("MainActivity", Context.MODE_PRIVATE).getString("appearance", "auto");
        return valid(mode) ? mode : "auto";
    }
    static boolean light(Context context) {
        String mode = mode(context);
        return "light".equals(mode) || "auto".equals(mode) && (context.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) != Configuration.UI_MODE_NIGHT_YES;
    }
    static int background(Context context) { return light(context) ? Color.rgb(244,245,247) : Color.rgb(9,10,12); }
    static String label(Context context) { String mode = mode(context); return Character.toUpperCase(mode.charAt(0)) + mode.substring(1); }
}
