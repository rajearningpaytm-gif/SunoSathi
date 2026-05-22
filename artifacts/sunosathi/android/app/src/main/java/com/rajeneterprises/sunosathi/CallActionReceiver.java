package com.rajeneterprises.sunosathi;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Looper;
import android.webkit.CookieManager;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Handles Accept / Decline button taps from the incoming-call notification
 * (shown by MyFirebaseMessagingService when the app is in background / killed).
 *
 * ACCEPT: Launches MainActivity with extras so the JS app can navigate to the
 *         call screen and call the accept API.
 *
 * DECLINE: Uses the WebView's CookieManager (same process, main thread) to
 *          read the existing session cookie and call the decline API over HTTP,
 *          then finishes without opening the app.
 */
public class CallActionReceiver extends BroadcastReceiver {

    static final String ACTION_ACCEPT  = "com.rajeneterprises.sunosathi.ACTION_ACCEPT";
    static final String ACTION_DECLINE = "com.rajeneterprises.sunosathi.ACTION_DECLINE";

    private static final String API_BASE = "https://sunosathi.replit.app";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action    = intent.getAction();
        String sessionId = intent.getStringExtra("sessionId");
        String kind      = intent.getStringExtra("kind");

        // Dismiss the call notification
        if (sessionId != null) {
            NotificationManager nm =
                (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.cancel(Math.abs(sessionId.hashCode()));
        }

        if (ACTION_ACCEPT.equals(action)) {
            // Store pending action so JS can pick it up when the app opens
            if (sessionId != null) {
                String json = buildActionJson("accept", sessionId, kind != null ? kind : "call");
                SharedPreferences prefs =
                    context.getSharedPreferences(MyFirebaseMessagingService.PREFS_NAME, Context.MODE_PRIVATE);
                prefs.edit().putString(MyFirebaseMessagingService.KEY_PENDING_ACTION, json).apply();
            }
            // Launch / bring MainActivity to foreground
            Intent launchIntent = new Intent(context, MainActivity.class);
            launchIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            launchIntent.putExtra("from", "notification_accept");
            launchIntent.putExtra("sessionId", sessionId);
            launchIntent.putExtra("kind", kind);
            context.startActivity(launchIntent);

        } else if (ACTION_DECLINE.equals(action) && sessionId != null) {
            final String sid = sessionId;

            // CookieManager must be read on the main thread
            // BroadcastReceiver.onReceive() runs on main thread — safe to call directly
            String cookies = null;
            try {
                if (Looper.myLooper() == Looper.getMainLooper()) {
                    cookies = CookieManager.getInstance().getCookie(API_BASE);
                }
            } catch (Exception ignored) { }

            final String cookieHeader = cookies != null ? cookies : "";
            final PendingResult pendingResult = goAsync();

            new Thread(() -> {
                try {
                    URL url = new URL(API_BASE + "/api/chat/sessions/" + sid + "/decline");
                    HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                    conn.setRequestMethod("POST");
                    conn.setRequestProperty("Content-Type", "application/json");
                    if (!cookieHeader.isEmpty()) {
                        conn.setRequestProperty("Cookie", cookieHeader);
                    }
                    conn.setDoOutput(true);
                    conn.setConnectTimeout(5_000);
                    conn.setReadTimeout(5_000);
                    try (OutputStream os = conn.getOutputStream()) { os.write(new byte[0]); }
                    conn.getResponseCode();
                    conn.disconnect();
                } catch (Exception ignored) {
                    // Best effort — the session will auto-expire after 20 s anyway
                } finally {
                    pendingResult.finish();
                }
            }).start();
        }
    }

    private static String buildActionJson(String action, String sessionId, String kind) {
        // Safe for simple alphanumeric/UUID values — no JSON library needed
        return "{\"action\":\"" + action + "\"," +
               "\"sessionId\":\"" + sessionId + "\"," +
               "\"kind\":\"" + kind + "\"}";
    }
}
