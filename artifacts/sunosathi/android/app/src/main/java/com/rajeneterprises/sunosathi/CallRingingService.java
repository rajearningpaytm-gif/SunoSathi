package com.rajeneterprises.sunosathi;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.Vibrator;
import android.os.VibratorManager;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.Person;

/**
 * Foreground service that GUARANTEES a loud ringtone + persistent
 * full-screen call notification when an FCM incoming-call push arrives.
 *
 * Why this exists:
 *   A plain NotificationManager.notify() with channel-attached sound is
 *   silenced or dropped by aggressive OEM ROMs (MIUI, ColorOS, Funtouch,
 *   OneUI) when the app is swiped away. The Android-recommended fix for
 *   "WhatsApp-style" incoming-call UX is a foreground service of type
 *   phoneCall — the OS treats it as a real call and:
 *     * keeps the service alive past Doze / app-standby
 *     * lets the notification ring with setFullScreenIntent
 *     * exempts MediaPlayer playback from background restrictions
 *
 * Behaviour:
 *   1. Show foreground call notification (Accept / Decline buttons)
 *   2. Play the system default ringtone on STREAM_RING at MAX volume,
 *      looping until accept / decline / 25 s timeout
 *   3. Vibrate in a 0.5 s on / 0.3 s off pattern
 *   4. Auto-stop after 25 s if user does not act (matches server's 20 s
 *      ring-timeout + 5 s buffer)
 */
public class CallRingingService extends Service {

    public static final String ACTION_START = "com.rajeneterprises.sunosathi.RING_START";
    public static final String ACTION_STOP  = "com.rajeneterprises.sunosathi.RING_STOP";

    private static final int NOTIFICATION_ID       = 1771;
    private static final int NOTIFICATION_ID_POPUP = 1772;
    private static final long AUTO_STOP_MS         = 25_000L;

    private MediaPlayer player;
    private Vibrator vibrator;
    private Handler autoStop;
    private Runnable autoStopRunnable;
    private int previousRingVolume = -1;

    public static void start(Context ctx, String sessionId, String userName, String kind) {
        Intent i = new Intent(ctx, CallRingingService.class);
        i.setAction(ACTION_START);
        i.putExtra("sessionId", sessionId);
        i.putExtra("userName", userName);
        i.putExtra("kind", kind);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            ctx.startForegroundService(i);
        } else {
            ctx.startService(i);
        }
    }

    public static void stop(Context ctx) {
        Intent i = new Intent(ctx, CallRingingService.class);
        i.setAction(ACTION_STOP);
        ctx.startService(i);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || ACTION_STOP.equals(intent.getAction())) {
            stopRinging();
            try {
                NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
                if (nm != null) nm.cancel(NOTIFICATION_ID_POPUP);
            } catch (Exception ignored) { }
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }

        String sessionId = intent.getStringExtra("sessionId");
        String userName  = intent.getStringExtra("userName");
        String kind      = intent.getStringExtra("kind");
        if (sessionId == null) sessionId = "";
        if (userName == null)  userName  = "Someone";
        if (kind == null)      kind      = "call";

        Notification notif = buildCallNotification(sessionId, userName, kind);
        // Android 14+ requires the foregroundServiceType to match the manifest
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            try {
                startForeground(
                    NOTIFICATION_ID, notif,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL
                );
            } catch (Exception e) {
                // Some highly-locked-down devices reject phoneCall type — fall back
                startForeground(NOTIFICATION_ID, notif);
            }
        } else {
            startForeground(NOTIFICATION_ID, notif);
        }

        // ── ALSO post a separate heads-up popup notification ───────────────
        // The foreground-service notification we just started often does NOT
        // pop up as a heads-up banner on many OEMs — Android treats it as
        // "service chrome" rather than a user-facing alert. Posting a
        // SECOND notification on the dedicated call_heads_up channel
        // (IMPORTANCE_HIGH, no sound — MediaPlayer handles sound) forces
        // the pop-up banner to appear at the top of whatever screen the
        // user is currently looking at, exactly like WhatsApp / Truecaller.
        try {
            Notification popup = buildHeadsUpPopup(sessionId, userName, kind);
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(NOTIFICATION_ID_POPUP, popup);
        } catch (Exception ignored) { }

        startRinging();
        scheduleAutoStop();
        return START_NOT_STICKY;
    }

    private Notification buildHeadsUpPopup(String sessionId, String userName, String kind) {
        Context ctx = getApplicationContext();

        Intent acceptIntent = new Intent(ctx, CallActionReceiver.class);
        acceptIntent.setAction(CallActionReceiver.ACTION_ACCEPT);
        acceptIntent.putExtra("sessionId", sessionId);
        acceptIntent.putExtra("kind", kind);
        PendingIntent acceptPI = PendingIntent.getBroadcast(
            ctx, Math.abs(sessionId.hashCode()) + 100, acceptIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Intent declineIntent = new Intent(ctx, CallActionReceiver.class);
        declineIntent.setAction(CallActionReceiver.ACTION_DECLINE);
        declineIntent.putExtra("sessionId", sessionId);
        PendingIntent declinePI = PendingIntent.getBroadcast(
            ctx, Math.abs(sessionId.hashCode()) + 101, declineIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Intent fullScreenIntent = new Intent(ctx, MainActivity.class);
        fullScreenIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        fullScreenIntent.putExtra("from", "fcm_call");
        fullScreenIntent.putExtra("sessionId", sessionId);
        fullScreenIntent.putExtra("kind", kind);
        PendingIntent fullScreenPI = PendingIntent.getActivity(
            ctx, Math.abs(sessionId.hashCode()) + 102, fullScreenIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        boolean isVideo = "video_call".equals(kind);
        String title = isVideo ? ("📹 " + userName) : ("📞 " + userName);
        String body  = isVideo ? "Video call kar rahe hain" : "Aapko call kar rahe hain";

        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, MyFirebaseMessagingService.CHANNEL_CALL_POPUP)
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setContentTitle(title)
            .setContentText(body)
            .setTicker(userName + " calling…")
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setFullScreenIntent(fullScreenPI, true)
            .setContentIntent(fullScreenPI)
            .addAction(android.R.drawable.ic_menu_call, "✅ Accept", acceptPI)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "❌ Decline", declinePI);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            Person caller = new Person.Builder().setName(userName).setImportant(true).build();
            b.setStyle(NotificationCompat.CallStyle.forIncomingCall(caller, declinePI, acceptPI));
        }
        return b.build();
    }

    // ── Ringtone playback ────────────────────────────────────────────────────

    private void startRinging() {
        try {
            AudioManager am = (AudioManager) getSystemService(AUDIO_SERVICE);
            if (am != null) {
                // Boost ring stream to MAX so the user actually hears it. Saved
                // value is restored in stopRinging() so we don't permanently
                // change the user's preferred volume.
                previousRingVolume = am.getStreamVolume(AudioManager.STREAM_RING);
                int max = am.getStreamMaxVolume(AudioManager.STREAM_RING);
                am.setStreamVolume(AudioManager.STREAM_RING, max, 0);
            }

            Uri ringtoneUri = RingtoneManager.getActualDefaultRingtoneUri(
                getApplicationContext(), RingtoneManager.TYPE_RINGTONE);
            if (ringtoneUri == null) {
                ringtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            }

            player = new MediaPlayer();
            player.setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .setLegacyStreamType(AudioManager.STREAM_RING)
                .build());
            player.setDataSource(getApplicationContext(), ringtoneUri);
            player.setLooping(true);
            player.prepare();
            player.start();
        } catch (Exception ignored) { /* best effort — notification sound still plays */ }

        // Vibration in parallel
        try {
            long[] pattern = new long[]{0, 500, 300, 500, 300, 500, 300, 500};
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                VibratorManager vm = (VibratorManager) getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
                if (vm != null) vibrator = vm.getDefaultVibrator();
            } else {
                vibrator = (Vibrator) getSystemService(VIBRATOR_SERVICE);
            }
            if (vibrator != null && vibrator.hasVibrator()) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator.vibrate(android.os.VibrationEffect.createWaveform(pattern, 0));
                } else {
                    //noinspection deprecation
                    vibrator.vibrate(pattern, 0);
                }
            }
        } catch (Exception ignored) { }
    }

    private void stopRinging() {
        try { if (player != null) { player.stop(); player.release(); player = null; } } catch (Exception ignored) { }
        try { if (vibrator != null) { vibrator.cancel(); vibrator = null; } } catch (Exception ignored) { }
        try {
            AudioManager am = (AudioManager) getSystemService(AUDIO_SERVICE);
            if (am != null && previousRingVolume >= 0) {
                am.setStreamVolume(AudioManager.STREAM_RING, previousRingVolume, 0);
                previousRingVolume = -1;
            }
        } catch (Exception ignored) { }
        if (autoStop != null && autoStopRunnable != null) {
            autoStop.removeCallbacks(autoStopRunnable);
        }
    }

    private void scheduleAutoStop() {
        autoStop = new Handler(Looper.getMainLooper());
        autoStopRunnable = () -> {
            stopRinging();
            try {
                NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
                if (nm != null) nm.cancel(NOTIFICATION_ID_POPUP);
            } catch (Exception ignored) { }
            stopForeground(true);
            stopSelf();
        };
        autoStop.postDelayed(autoStopRunnable, AUTO_STOP_MS);
    }

    // ── Notification (identical layout to MyFirebaseMessagingService) ────────

    private Notification buildCallNotification(String sessionId, String userName, String kind) {
        Context ctx = getApplicationContext();

        Intent acceptIntent = new Intent(ctx, CallActionReceiver.class);
        acceptIntent.setAction(CallActionReceiver.ACTION_ACCEPT);
        acceptIntent.putExtra("sessionId", sessionId);
        acceptIntent.putExtra("kind", kind);
        PendingIntent acceptPI = PendingIntent.getBroadcast(
            ctx, Math.abs(sessionId.hashCode()), acceptIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Intent declineIntent = new Intent(ctx, CallActionReceiver.class);
        declineIntent.setAction(CallActionReceiver.ACTION_DECLINE);
        declineIntent.putExtra("sessionId", sessionId);
        PendingIntent declinePI = PendingIntent.getBroadcast(
            ctx, Math.abs(sessionId.hashCode()) + 1, declineIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Intent fullScreenIntent = new Intent(ctx, MainActivity.class);
        fullScreenIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        fullScreenIntent.putExtra("from", "fcm_call");
        fullScreenIntent.putExtra("sessionId", sessionId);
        fullScreenIntent.putExtra("kind", kind);
        PendingIntent fullScreenPI = PendingIntent.getActivity(
            ctx, Math.abs(sessionId.hashCode()) + 2, fullScreenIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        boolean isVideo = "video_call".equals(kind);
        String displayName = isVideo ? ("📹 " + userName) : userName;
        String title = isVideo ? "📹 Incoming video call" : "📞 Incoming call";
        String body  = isVideo
            ? (userName + " video call kar rahe hain")
            : (userName + " connect karna chahte hain");

        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, MyFirebaseMessagingService.CHANNEL_CALLS)
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setContentTitle(title)
            .setContentText(body)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setOngoing(true)
            .setAutoCancel(false)
            .setFullScreenIntent(fullScreenPI, true)
            .setContentIntent(fullScreenPI)
            .addAction(android.R.drawable.ic_menu_call, "✅ Accept", acceptPI)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "❌ Decline", declinePI);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            Person caller = new Person.Builder().setName(displayName).setImportant(true).build();
            b.setStyle(NotificationCompat.CallStyle.forIncomingCall(caller, declinePI, acceptPI));
        }
        return b.build();
    }

    @Override
    public void onDestroy() {
        stopRinging();
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) { return null; }
}
