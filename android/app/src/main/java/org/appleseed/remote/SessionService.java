package org.appleseed.remote;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.SystemClock;

/** User-started remote session, with a visible and stoppable background notification. */
public final class SessionService extends Service {
    private RemoteSession session;
    private static final String CHANNEL = "remote-session";
    private final Handler handler = new Handler();
    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if (session == null || !session.lifetime.retainWhenHidden()) { stopSelf(); return; }
            if (session.lifetime.expired(SystemClock.elapsedRealtime())) { end(); return; }
            publish(); handler.postDelayed(this, 1000);
        }
    };
    private void end() {
        if (session != null) session.close("Your timer ended or Disconnect was selected. Reconnect when ready.");
        stopSelf();
    }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) { stopSelf(); return START_NOT_STICKY; }
        if ("disconnect".equals(intent.getAction())) { end(); return START_NOT_STICKY; }
        session = RemoteSession.current;
        if (session == null || !session.lifetime.retainWhenHidden()) { stopSelf(); return START_NOT_STICKY; }
        handler.removeCallbacks(tick);
        publish(); handler.postDelayed(tick, 1000);
        return START_NOT_STICKY;
    }
    private void publish() {
        NotificationManager manager = getSystemService(NotificationManager.class);
        NotificationChannel channel = new NotificationChannel(CHANNEL, "Mac connection", NotificationManager.IMPORTANCE_LOW);
        channel.setShowBadge(false); manager.createNotificationChannel(channel);
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent launch = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        PendingIntent close = PendingIntent.getService(this, 1, new Intent(this, SessionService.class).setAction("disconnect"), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        long deadline = session.lifetime.deadline();
        long remaining = Math.max(0, (deadline - SystemClock.elapsedRealtime() + 999) / 1000);
        String detail = deadline == 0 ? "No timer · stays connected" : "Disconnects in " + (remaining / 60) + ":" + String.format(java.util.Locale.US, "%02d", remaining % 60);
        Notification notification = new Notification.Builder(this, CHANNEL).setSmallIcon(R.drawable.appleseed_notification)
            .setContentTitle(Edition.NAME + " · Mac session").setContentText(detail).setContentIntent(launch).setOngoing(true)
            .setOnlyAlertOnce(true).setVisibility(Notification.VISIBILITY_SECRET)
            .addAction(new Notification.Action.Builder(null, "Disconnect", close).build()).build();
        if (Build.VERSION.SDK_INT >= 34) startForeground(7, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(7, notification);
    }
    @Override public void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (session != null && session.lifetime.retainWhenHidden()) session.close("Android stopped the background connection. Reconnect when ready.");
        session = null; super.onDestroy();
    }
    @Override public IBinder onBind(Intent intent) { return null; }
}
