package com.rajeneterprises.sunosathi;

import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;

import androidx.core.app.NotificationCompat;
import androidx.core.app.Person;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * Handles FCM messages when the app is in background or killed.
 *
 * The server sends DATA-ONLY FCM messages (no notification field), which means:
 *   - This onMessageReceived() is ALWAYS called, regardless of app state
 *   - We show a custom CallStyle-like notification with Accept / Decline buttons
 *
 * Requires google-services.json in android/app/ for native Firebase to work.
 * See build.gradle — the google-services plugin is applied conditionally.
 */
public class MyFirebaseMessagingService extends FirebaseMessagingService {

    static final String PREFS_NAME        = "SunoSathi";
    static final String KEY_FCM_TOKEN     = "native_fcm_token";
    static final String KEY_PENDING_ACTION = "pending_call_action";
    static final String CHANNEL_CALLS      = "incoming_calls";
    static final String CHANNEL_CALL_POPUP = "call_popup_v3";

    @Override
    public void onNewToken(String token) {
        super.onNewToken(token);
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putString(KEY_FCM_TOKEN, token).apply();
    }

    @Override
    public void onMessageReceived(RemoteMessage remoteMessage) {
        super.onMessageReceived(remoteMessage);

        Map<String, String> data = remoteMessage.getData();
        if (data.isEmpty()) return;

        String type = data.get("type");
        if (!"incoming_call".equals(type)) return;

        String sessionId = data.containsKey("sessionId") ? data.get("sessionId") : "";
        String userName  = data.containsKey("userName")  ? data.get("userName")  : "Someone";
        String kind      = data.containsKey("kind")      ? data.get("kind")      : "call";

        if (sessionId == null || sessionId.isEmpty()) return;

        // ── Wake the screen so the full-screen call UI is actually visible ──
        acquireBriefWakeLock();

        // ── Hand off to the foreground CallRingingService ─────────────────────
        // This is what GUARANTEES a loud ringtone + persistent notification
        // even when the app has been swiped away and the device is in Doze.
        // The service plays MediaPlayer on STREAM_RING at MAX volume in a
        // loop and hosts the notification as foreground (Android refuses to
        // kill a phoneCall-type foreground service for ~30 s minimum, which
        // is more than enough to outlast our 20 s ring window).
        CallRingingService.start(getApplicationContext(), sessionId, userName, kind);
    }

    private void acquireBriefWakeLock() {
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm == null) return;
            @SuppressWarnings("deprecation")
            PowerManager.WakeLock wl = pm.newWakeLock(
                PowerManager.FULL_WAKE_LOCK
                    | PowerManager.ACQUIRE_CAUSES_WAKEUP
                    | PowerManager.ON_AFTER_RELEASE,
                "SunoSathi:IncomingCallWake"
            );
            // 10 s is plenty — the full-screen activity will take over wakefulness
            // after that, and we never hold the lock long enough to drain battery.
            wl.acquire(10_000L);
        } catch (Exception ignored) { /* best effort */ }
    }

    private void showIncomingCallNotification(String sessionId, String userName, String kind) {
        Context ctx = getApplicationContext();

        // ── Accept PendingIntent ──────────────────────────────────────────────
        Intent acceptIntent = new Intent(ctx, CallActionReceiver.class);
        acceptIntent.setAction(CallActionReceiver.ACTION_ACCEPT);
        acceptIntent.putExtra("sessionId", sessionId);
        acceptIntent.putExtra("kind", kind);
        int acceptReqCode = Math.abs(sessionId.hashCode());
        PendingIntent acceptPI = PendingIntent.getBroadcast(
            ctx, acceptReqCode, acceptIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        // ── Decline PendingIntent ─────────────────────────────────────────────
        Intent declineIntent = new Intent(ctx, CallActionReceiver.class);
        declineIntent.setAction(CallActionReceiver.ACTION_DECLINE);
        declineIntent.putExtra("sessionId", sessionId);
        int declineReqCode = Math.abs(sessionId.hashCode()) + 1;
        PendingIntent declinePI = PendingIntent.getBroadcast(
            ctx, declineReqCode, declineIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        // ── Full-screen intent (shows on lock screen) ─────────────────────────
        Intent fullScreenIntent = new Intent(ctx, MainActivity.class);
        fullScreenIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        fullScreenIntent.putExtra("from", "fcm_call");
        fullScreenIntent.putExtra("sessionId", sessionId);
        fullScreenIntent.putExtra("kind", kind);
        int fsReqCode = Math.abs(sessionId.hashCode()) + 2;
        PendingIntent fullScreenPI = PendingIntent.getActivity(
            ctx, fsReqCode, fullScreenIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        // ── Notification text ─────────────────────────────────────────────────
        // For video calls we prefix the caller name with a 📹 emoji so that the
        // Android 12+ CallStyle UI (which renders Person.name and ignores
        // setContentTitle) still surfaces a clear "video call" indication. The
        // contentTitle below is used on Android 11 and older where CallStyle
        // is not available.
        boolean isVideo = "video_call".equals(kind);
        String displayName = isVideo ? ("📹 " + userName) : userName;
        String title = isVideo
            ? "📹 Incoming video call"
            : "📞 Incoming call";
        String body = isVideo
            ? (userName + " video call kar rahe hain")
            : (userName + " connect karna chahte hain");

        Uri ringtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);

        // ── Build notification ────────────────────────────────────────────────
        NotificationCompat.Builder builder = new NotificationCompat.Builder(ctx, CHANNEL_CALLS)
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setContentTitle(title)
            .setContentText(body)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setAutoCancel(true)
            .setOngoing(true)
            .setSound(ringtoneUri)
            .setVibrate(new long[]{0, 500, 300, 500, 300, 500})
            .setLights(0xFF6200EE, 500, 500)
            .setFullScreenIntent(fullScreenPI, true)
            .setContentIntent(fullScreenPI)
            .addAction(android.R.drawable.ic_menu_call,
                "✅ Accept", acceptPI)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel,
                "❌ Decline", declinePI)
            .setTimeoutAfter(22_000);

        // Use CallStyle on Android 12+ for a native call UI appearance
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            Person caller = new Person.Builder()
                .setName(displayName)
                .setImportant(true)
                .build();
            builder.setStyle(
                NotificationCompat.CallStyle.forIncomingCall(caller, declinePI, acceptPI)
            );
        }

        NotificationManager nm =
            (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.notify(Math.abs(sessionId.hashCode()), builder.build());
        }
    }
}
