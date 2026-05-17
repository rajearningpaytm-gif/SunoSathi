package com.rajeneterprises.sunosathi;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.media.AudioDeviceInfo;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
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

    private static final int REQ_CALL_PERMISSIONS = 4711;

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
        settings.setMediaPlaybackRequiresUserGesture(false);

        // ── CRITICAL: WebChromeClient.onPermissionRequest ──────────────────────
        // When JS calls navigator.mediaDevices.getUserMedia({video:true,audio:true})
        // inside a WebView, Chromium fires onPermissionRequest() asking the native
        // app whether to grant mic / camera. WITHOUT this override (or with the
        // default that calls deny()), getUserMedia rejects silently and video
        // calls never start — the user sees "Establishing P2P video..." forever.
        //
        // We grant all media resources the page asks for. Android runtime
        // CAMERA + RECORD_AUDIO permissions are requested below at startup so
        // by the time JS asks, the OS-level grant is already in place.
        getBridge().getWebView().setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> request.grant(request.getResources()));
            }
        });

        // Create notification channels (no-op on API < 26)
        createNotificationChannels();

        // Request runtime CAMERA + RECORD_AUDIO at startup so video/audio calls
        // work immediately when the user accepts. Without this, Android 6+
        // silently denies the WebView's media request even though the manifest
        // declares the permissions.
        requestCallPermissions();

        // Store any pending call action from the launch intent
        handleCallIntent(getIntent());
    }

    private void requestCallPermissions() {
        java.util.ArrayList<String> need = new java.util.ArrayList<>();
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            need.add(Manifest.permission.RECORD_AUDIO);
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
                != PackageManager.PERMISSION_GRANTED) {
            need.add(Manifest.permission.CAMERA);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.BLUETOOTH_CONNECT)
                    != PackageManager.PERMISSION_GRANTED) {
                need.add(Manifest.permission.BLUETOOTH_CONNECT);
            }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                need.add(Manifest.permission.POST_NOTIFICATIONS);
            }
        }
        if (!need.isEmpty()) {
            ActivityCompat.requestPermissions(
                this, need.toArray(new String[0]), REQ_CALL_PERMISSIONS
            );
        }
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
        // Hold a single focus request so we can abandon it cleanly on stop
        private AudioFocusRequest focusRequest;

        SunoAudioBridge(Context context) {
            this.context = context;
        }

        /**
         * Request VOICE_COMMUNICATION audio focus.
         * Without focus, MODE_IN_COMMUNICATION + setSpeakerphoneOn(false) is
         * silently ignored on Android 10+ (the WebView's media stream keeps
         * routing to the loudspeaker). This is the root cause of earpiece
         * failing on the seeker side when the toggle was pressed.
         */
        private void requestFocus(AudioManager am) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    AudioAttributes attrs = new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build();
                    // AUDIOFOCUS_GAIN (not _TRANSIENT) — this is an ongoing
                    // voice call, we own the audio stream until call ends.
                    // GAIN_TRANSIENT was making other apps' audio resume mid-call
                    // and confusing the system about who owns the voice stream.
                    focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                        .setAudioAttributes(attrs)
                        .setAcceptsDelayedFocusGain(false)
                        .setWillPauseWhenDucked(false)
                        .build();
                    am.requestAudioFocus(focusRequest);
                } else {
                    am.requestAudioFocus(null, AudioManager.STREAM_VOICE_CALL,
                        AudioManager.AUDIOFOCUS_GAIN);
                }
            } catch (Exception ignored) { /* best effort */ }
        }

        /**
         * Android 12+ (API 31): setSpeakerphoneOn() is DEPRECATED and silently
         * ignored on most newer devices (Pixel 6+, Samsung One UI 4+, etc).
         * The official replacement is setCommunicationDevice(AudioDeviceInfo).
         * This is THE root cause of earpiece not switching on modern phones.
         *
         * @param am AudioManager
         * @param toEarpiece true = earpiece, false = loudspeaker
         */
        private void routeCommunicationDevice(AudioManager am, boolean toEarpiece) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return; // pre-Android 12
            try {
                int wantedType = toEarpiece
                    ? AudioDeviceInfo.TYPE_BUILTIN_EARPIECE
                    : AudioDeviceInfo.TYPE_BUILTIN_SPEAKER;
                AudioDeviceInfo target = null;
                for (AudioDeviceInfo dev : am.getAvailableCommunicationDevices()) {
                    if (dev.getType() == wantedType) { target = dev; break; }
                }
                // If a wired headset / bluetooth headset is plugged in, the user
                // expects audio to go there — only override when picking earpiece
                // AND no headset is connected.
                if (toEarpiece) {
                    for (AudioDeviceInfo dev : am.getAvailableCommunicationDevices()) {
                        int t = dev.getType();
                        if (t == AudioDeviceInfo.TYPE_WIRED_HEADSET
                            || t == AudioDeviceInfo.TYPE_WIRED_HEADPHONES
                            || t == AudioDeviceInfo.TYPE_BLUETOOTH_SCO
                            || t == AudioDeviceInfo.TYPE_USB_HEADSET) {
                            target = dev; break;
                        }
                    }
                }
                if (target != null) {
                    am.setCommunicationDevice(target);
                }
            } catch (Exception ignored) { /* best effort */ }
        }

        private void clearCommunicationDevice(AudioManager am) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return;
            try { am.clearCommunicationDevice(); } catch (Exception ignored) { }
        }

        private void abandonFocus(AudioManager am) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    if (focusRequest != null) {
                        am.abandonAudioFocusRequest(focusRequest);
                        focusRequest = null;
                    }
                } else {
                    am.abandonAudioFocus(null);
                }
            } catch (Exception ignored) { /* best effort */ }
        }

        /** Set audio output mode. @param mode  "earpiece" | "speaker" | "default" */
        @JavascriptInterface
        public void setMode(String mode) {
            AudioManager am =
                (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
            if (am == null) return;
            switch (mode) {
                case "earpiece":
                    requestFocus(am);
                    am.setMode(AudioManager.MODE_IN_COMMUNICATION);
                    // Android 12+: setSpeakerphoneOn is deprecated/ignored, use
                    // setCommunicationDevice. We do BOTH so legacy + modern paths
                    // both route correctly. The legacy off→on→off cycle still
                    // helps on some Xiaomi/Realme ROMs running Android 10/11.
                    am.setSpeakerphoneOn(true);
                    am.setSpeakerphoneOn(false);
                    routeCommunicationDevice(am, true);
                    break;
                case "speaker":
                    requestFocus(am);
                    am.setMode(AudioManager.MODE_IN_COMMUNICATION);
                    am.setSpeakerphoneOn(true);
                    routeCommunicationDevice(am, false);
                    break;
                default:
                    clearCommunicationDevice(am);
                    am.setMode(AudioManager.MODE_NORMAL);
                    am.setSpeakerphoneOn(false);
                    abandonFocus(am);
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
