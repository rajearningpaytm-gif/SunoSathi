package com.rajeneterprises.sunosathi;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import com.getcapacitor.BridgeActivity;

/**
 * MainActivity — thin glue layer between native Android and the Capacitor WebView.
 *
 * Responsibilities:
 *   1. JS bridge (window.SunoAudio): audio routing, native FCM token access,
 *      pending call-action retrieval for notification Accept flows.
 *   2. Notification channels: "incoming_calls" channel created at startup so
 *      MyFirebaseMessagingService can post high-priority call notifications.
 *   3. Intent handling: when the app is opened from a call notification (Accept
 *      button or full-screen intent), the extras are stored and dispatched to JS.
 *
 * Usage from JavaScript:
 *   window.SunoAudio.setMode("earpiece");       // route to earpiece
 *   window.SunoAudio.setMode("speaker");        // route to loudspeaker
 *   window.SunoAudio.setMode("default");        // restore system default
 *   window.SunoAudio.getMode();                 // returns "earpiece"|"speaker"|"default"
 *   window.SunoAudio.getNativeFcmToken();       // returns native FCM token or null
 *   window.SunoAudio.getPendingCallAction();    // consumes + returns pending JSON or null
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Inject JS bridge after the WebView is ready
        getBridge().getWebView().addJavascriptInterface(
            new SunoAudioBridge(this), "SunoAudio"
        );

        // Ensure DOM storage (IndexedDB / localStorage) is enabled.
        // Firebase uses IndexedDB to persist redirect state.
        WebSettings settings = getBridge().getWebView().getSettings();
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setJavaScriptEnabled(true);

        // Create notification channels (no-op on API < 26)
        createNotificationChannels();

        // Store any pending call action from the launch intent
        handleCallIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleCallIntent(intent);
    }

    // ── Notification channels ────────────────────────────────────────────────

    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;

        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null) return;

        // HIGH importance ensures heads-up / full-screen display on lock screen
        NotificationChannel callChannel = new NotificationChannel(
            MyFirebaseMessagingService.CHANNEL_CALLS,
            "Incoming Calls",
            NotificationManager.IMPORTANCE_HIGH
        );
        callChannel.setDescription("Incoming audio and video call notifications");
        callChannel.enableVibration(true);
        callChannel.setVibrationPattern(new long[]{0, 500, 300, 500, 300, 500});
        callChannel.enableLights(true);
        callChannel.setLightColor(0xFF6200EE);
        callChannel.setShowBadge(true);

        Uri ringtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        AudioAttributes audioAttrs = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        callChannel.setSound(ringtoneUri, audioAttrs);

        nm.createNotificationChannel(callChannel);
    }

    // ── Incoming-call intent handling ────────────────────────────────────────

    /**
     * Called when the app is opened from a notification intent:
     *   from=fcm_call             → app was swiped open (full-screen intent)
     *   from=notification_accept  → user tapped the Accept action button
     *
     * Stores the action in SharedPreferences so JS can poll via
     * window.SunoAudio.getPendingCallAction(), and also tries an immediate
     * JS dispatch in case the WebView is already loaded.
     */
    private void handleCallIntent(Intent intent) {
        if (intent == null) return;
        String from      = intent.getStringExtra("from");
        String sessionId = intent.getStringExtra("sessionId");
        String kind      = intent.getStringExtra("kind");

        if (from == null || sessionId == null || sessionId.isEmpty()) return;

        String action;
        if ("notification_accept".equals(from)) {
            action = "accept";
        } else if ("fcm_call".equals(from)) {
            action = "incoming";
        } else {
            return;
        }

        String safeKind = (kind != null && !kind.isEmpty()) ? kind : "call";
        String json = "{\"action\":\"" + action + "\"," +
                      "\"sessionId\":\"" + sessionId + "\"," +
                      "\"kind\":\"" + safeKind + "\"}";

        // Persist so JS can consume it even if WebView isn't ready yet
        SharedPreferences prefs =
            getSharedPreferences(MyFirebaseMessagingService.PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putString(MyFirebaseMessagingService.KEY_PENDING_ACTION, json).apply();

        // Also try immediate dispatch if WebView is already running
        try {
            final String js =
                "window.dispatchEvent(new CustomEvent('ss:fcm_call_action',{detail:" + json + "}));";
            getBridge().getWebView().post(
                () -> getBridge().getWebView().evaluateJavascript(js, null)
            );
        } catch (Exception ignored) {
            // Bridge may not be ready on cold start — JS will poll via getPendingCallAction()
        }
    }

    // ── JS Bridge ────────────────────────────────────────────────────────────

    /** JavaScript-callable audio routing + native token bridge. */
    private static class SunoAudioBridge {
        private final Context context;

        SunoAudioBridge(Context context) {
            this.context = context;
        }

        /** Set audio output mode. @param mode  "earpiece" | "speaker" | "default" */
        @JavascriptInterface
        public void setMode(String mode) {
            android.media.AudioManager am =
                (android.media.AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
            if (am == null) return;
            switch (mode) {
                case "earpiece":
                    am.setMode(android.media.AudioManager.MODE_IN_COMMUNICATION);
                    am.setSpeakerphoneOn(false);
                    break;
                case "speaker":
                    am.setMode(android.media.AudioManager.MODE_IN_COMMUNICATION);
                    am.setSpeakerphoneOn(true);
                    break;
                default:
                    am.setMode(android.media.AudioManager.MODE_NORMAL);
                    am.setSpeakerphoneOn(false);
                    break;
            }
        }

        /** Returns current audio routing. */
        @JavascriptInterface
        public String getMode() {
            android.media.AudioManager am =
                (android.media.AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
            if (am == null) return "default";
            if (am.isSpeakerphoneOn()) return "speaker";
            if (am.getMode() == android.media.AudioManager.MODE_IN_COMMUNICATION) return "earpiece";
            return "default";
        }

        /**
         * Returns the native Firebase FCM token, or null if not yet available.
         * Token is stored by MyFirebaseMessagingService.onNewToken().
         * useFcmToken.ts retries up to 5× with 3 s delay to handle cold-start timing.
         */
        @JavascriptInterface
        public String getNativeFcmToken() {
            SharedPreferences prefs =
                context.getSharedPreferences(MyFirebaseMessagingService.PREFS_NAME, Context.MODE_PRIVATE);
            return prefs.getString(MyFirebaseMessagingService.KEY_FCM_TOKEN, null);
        }

        /**
         * Consumes and returns the pending call action JSON, or null.
         * Format: {"action":"accept"|"incoming","sessionId":"...","kind":"..."}
         * Called by App.tsx on auth-ready to handle notification-launched sessions.
         */
        @JavascriptInterface
        public String getPendingCallAction() {
            SharedPreferences prefs =
                context.getSharedPreferences(MyFirebaseMessagingService.PREFS_NAME, Context.MODE_PRIVATE);
            String pending = prefs.getString(MyFirebaseMessagingService.KEY_PENDING_ACTION, null);
            if (pending != null) {
                prefs.edit().remove(MyFirebaseMessagingService.KEY_PENDING_ACTION).apply();
            }
            return pending;
        }
    }
}
