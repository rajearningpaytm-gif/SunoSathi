package com.rajeneterprises.sunosathi;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.PowerManager;
import android.provider.Settings;
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
import android.webkit.WebSettings;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

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

        // ── CRITICAL: extend BridgeWebChromeClient (NOT plain WebChromeClient) ──
        // Capacitor installs its own BridgeWebChromeClient on the WebView to
        // handle file uploads, geolocation, console proxying, and plugin
        // permission flows. Replacing it with `new WebChromeClient()` BREAKS
        // Capacitor plugins silently (camera, filesystem, etc. all stop working).
        //
        // We extend BridgeWebChromeClient and only override onPermissionRequest
        // to grant the page's getUserMedia() request. Everything else still
        // delegates to Capacitor's parent implementation.
        getBridge().getWebView().setWebChromeClient(new BridgeWebChromeClient(getBridge()) {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                // Grant whatever the page asks for (camera / mic / midi).
                // Android runtime perms are requested below at startup, so the
                // OS-level grant is already in place by the time JS hits this.
                runOnUiThread(() -> request.grant(request.getResources()));
            }
        });

        // ── Enable Chrome DevTools remote inspection (helps debug WebRTC live) ──
        // Set on the WebView class itself (static), so works even in release
        // builds. Connect via chrome://inspect#devices from a paired desktop.
        android.webkit.WebView.setWebContentsDebuggingEnabled(true);

        // Create notification channels (no-op on API < 26)
        createNotificationChannels();

        // Request runtime CAMERA + RECORD_AUDIO at startup so video/audio calls
        // work immediately when the user accepts. Without this, Android 6+
        // silently denies the WebView's media request even though the manifest
        // declares the permissions.
        requestCallPermissions();

        // ── Battery-optimization opt-out (one-time prompt) ─────────────────
        // Aggressive OEM battery managers (Xiaomi MIUI, Realme/Oppo ColorOS,
        // Vivo Funtouch, Samsung One UI) silently kill FCM background delivery
        // when the app is swiped away. This means listeners receive zero
        // incoming calls until they open the app — defeating the entire point
        // of background notifications. The Android-standard way to fix this
        // is REQUEST_IGNORE_BATTERY_OPTIMIZATIONS. We only prompt ONCE; if
        // the user denies it the call still works while the app is open.
        maybePromptIgnoreBatteryOptimizations();

        // Android 14+ full-screen-intent permission (required for call popup)
        maybePromptFullScreenIntentPermission();

        // OEM-specific autostart / background-activity page (Realme / MIUI /
        // Vivo / Oppo / OnePlus / Huawei / Honor / Samsung / ASUS). Opens
        // the right Settings screen directly so the user just taps Allow
        // once instead of hunting through 5 levels of menu. Throttled to
        // once every 24 hours and skipped on stock Android.
        OemAutostartHelper.maybePromptAutostart(this);

        // Show this activity OVER the lockscreen + turn the screen on when
        // the OS launches us via a call notification's fullScreenIntent. This
        // is what lets the call UI appear even when the phone is locked,
        // exactly like the system phone app or WhatsApp.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            try {
                setShowWhenLocked(true);
                setTurnScreenOn(true);
            } catch (Throwable ignored) { }
        } else {
            //noinspection deprecation
            getWindow().addFlags(
                android.view.WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
                android.view.WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON |
                android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON |
                android.view.WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
            );
        }

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

        // ── Channel 1: incoming_calls (foreground-service host channel) ─────
        // SOUND IS DELIBERATELY DISABLED here because CallRingingService plays
        // a MediaPlayer ringtone manually at MAX volume on STREAM_RING. If we
        // also set a channel sound, the user would hear the ringtone twice
        // (double playback) and overlapping. The foreground notification is
        // just the persistent "ongoing call" entry in the tray.
        NotificationChannel callChannel = new NotificationChannel(
            MyFirebaseMessagingService.CHANNEL_CALLS,
            "Ongoing Calls",
            NotificationManager.IMPORTANCE_HIGH
        );
        callChannel.setDescription("Persistent notification while a call is ringing");
        callChannel.setSound(null, null);
        callChannel.enableVibration(false);
        callChannel.setBypassDnd(true);
        callChannel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
        callChannel.setShowBadge(true);
        nm.createNotificationChannel(callChannel);

        // ── Channel 2: call_heads_up (heads-up POPUP channel) ───────────────
        // Used to post a SEPARATE notification right after startForeground so
        // the user actually SEES a heads-up banner on top of whatever screen
        // they're on. A pure foreground-service notification often does NOT
        // pop up as heads-up on many OEMs — Android treats it as "service
        // chrome", not "user alert". A second nm.notify() with PRIORITY_MAX
        // on a dedicated heads-up channel forces the banner to appear.
        // Sound disabled here too (MediaPlayer in CallRingingService handles it).
        NotificationChannel popupChannel = new NotificationChannel(
            MyFirebaseMessagingService.CHANNEL_CALL_POPUP,
            "Incoming Call Alerts",
            NotificationManager.IMPORTANCE_HIGH
        );
        popupChannel.setDescription("Pop-up banner when someone is calling you");
        popupChannel.setSound(null, null);
        popupChannel.enableVibration(false);
        popupChannel.setBypassDnd(true);
        popupChannel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
        popupChannel.setShowBadge(false);
        nm.createNotificationChannel(popupChannel);
    }

    // ── Android 14+ full-screen-intent permission ────────────────────────────
    // Android 14 (API 34) revoked USE_FULL_SCREEN_INTENT from non-default
    // calling/calendar apps. Without this permission granted at runtime, the
    // setFullScreenIntent() on our incoming-call notification is silently
    // downgraded to a regular notification — no pop-up, no lock-screen UI.
    // This is THE most common reason "ringtone plays but no pop-up appears".
    // We open the system Settings screen so the user can flip the toggle.
    // Throttled to once per 6 hours so we don't nag every launch.
    private void maybePromptFullScreenIntentPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null) return;
        try {
            if (nm.canUseFullScreenIntent()) return;
        } catch (Throwable ignored) { return; }

        SharedPreferences prefs =
            getSharedPreferences(MyFirebaseMessagingService.PREFS_NAME, Context.MODE_PRIVATE);
        long now = System.currentTimeMillis();
        long lastPrompt = prefs.getLong("fsi_last_prompt_ms", 0L);
        if (now - lastPrompt < 6L * 60L * 60L * 1000L) return;

        try {
            Intent intent = new Intent(
                Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT,
                Uri.parse("package:" + getPackageName())
            );
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
            prefs.edit().putLong("fsi_last_prompt_ms", now).apply();
        } catch (Exception ignored) {
            prefs.edit().putLong("fsi_last_prompt_ms", now).apply();
        }
    }

    // ── Battery optimization opt-out ─────────────────────────────────────────
    // Re-prompt every launch UNTIL the app is actually whitelisted from Doze /
    // background restrictions. Without this, listeners on Xiaomi / Realme /
    // Vivo / Oppo never get FCM call pushes when their app is swiped away.
    // We deliberately do NOT use a "prompted once" gate — the previous version
    // did, which meant a single "Deny" tap permanently broke background calls
    // for that user. Now we keep nudging until they grant the exemption.
    // Throttled to once per 6 hours so we don't spam the dialog on every
    // single launch within the same session.
    private void maybePromptIgnoreBatteryOptimizations() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm == null) return;
        String pkg = getPackageName();

        // Already whitelisted — nothing to do
        if (pm.isIgnoringBatteryOptimizations(pkg)) return;

        // Throttle: re-prompt at most once every 6 hours so we don't nag on
        // every screen-on, but DO keep asking until they actually allow it.
        SharedPreferences prefs =
            getSharedPreferences(MyFirebaseMessagingService.PREFS_NAME, Context.MODE_PRIVATE);
        long now = System.currentTimeMillis();
        long lastPrompt = prefs.getLong("battery_opt_last_prompt_ms", 0L);
        if (now - lastPrompt < 6L * 60L * 60L * 1000L) return;

        try {
            Intent intent = new Intent(
                Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                Uri.parse("package:" + pkg)
            );
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
            prefs.edit().putLong("battery_opt_last_prompt_ms", now).apply();
        } catch (Exception ignored) {
            // Some highly-locked-down ROMs reject this intent. Still record
            // the attempt so we throttle correctly.
            prefs.edit().putLong("battery_opt_last_prompt_ms", now).apply();
        }
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

        /**
         * Aggressively disable Bluetooth SCO when user explicitly wants earpiece.
         * Without this, some Android builds (especially MIUI / ColorOS) leave
         * SCO connected from a prior call and the audio keeps routing to the
         * paired BT device even after the user toggles earpiece in-app.
         */
        private void killBluetoothSco(AudioManager am) {
            try {
                am.setBluetoothScoOn(false);
                am.stopBluetoothSco();
            } catch (Exception ignored) { }
        }

        /**
         * Boost STREAM_VOICE_CALL to a high but safe level so the earpiece is
         * actually audible. Many devices default this stream to ~40% which is
         * why users say "earpiece is too quiet" even when routing is correct.
         * We use ~85% of max so we don't blast on devices with loud earpieces.
         */
        private void boostVoiceCallVolume(AudioManager am) {
            try {
                int max = am.getStreamMaxVolume(AudioManager.STREAM_VOICE_CALL);
                int target = Math.max(1, (int) Math.round(max * 0.85));
                int current = am.getStreamVolume(AudioManager.STREAM_VOICE_CALL);
                if (current < target) {
                    am.setStreamVolume(AudioManager.STREAM_VOICE_CALL, target, 0);
                }
            } catch (Exception ignored) { /* SecurityException on locked devices */ }
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
                    // Kill any stale BT SCO route from a previous call
                    killBluetoothSco(am);
                    // Android 12+: setSpeakerphoneOn is deprecated/ignored, use
                    // setCommunicationDevice. We do BOTH so legacy + modern paths
                    // both route correctly. The legacy off→on→off cycle still
                    // helps on some Xiaomi/Realme ROMs running Android 10/11.
                    am.setSpeakerphoneOn(true);
                    am.setSpeakerphoneOn(false);
                    routeCommunicationDevice(am, true);
                    // Make the earpiece actually loud enough to hear
                    boostVoiceCallVolume(am);
                    break;
                case "speaker":
                    requestFocus(am);
                    am.setMode(AudioManager.MODE_IN_COMMUNICATION);
                    killBluetoothSco(am);
                    am.setSpeakerphoneOn(true);
                    routeCommunicationDevice(am, false);
                    boostVoiceCallVolume(am);
                    break;
                default:
                    clearCommunicationDevice(am);
                    am.setMode(AudioManager.MODE_NORMAL);
                    am.setSpeakerphoneOn(false);
                    abandonFocus(am);
                    break;
            }
        }

        /**
         * Re-apply the current routing (called from JS periodically during a
         * call). Some OEM ROMs silently flip back to speaker after ~5-10s
         * when MODE_IN_COMMUNICATION fights with MODE_NORMAL apps in the
         * background. Calling enforce() every 2s keeps earpiece locked in.
         *
         * @param mode "earpiece" | "speaker"
         */
        @JavascriptInterface
        public void enforce(String mode) {
            AudioManager am =
                (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
            if (am == null) return;
            if (am.getMode() != AudioManager.MODE_IN_COMMUNICATION) {
                am.setMode(AudioManager.MODE_IN_COMMUNICATION);
            }
            boolean wantSpeaker = "speaker".equals(mode);
            if (am.isSpeakerphoneOn() != wantSpeaker) {
                am.setSpeakerphoneOn(wantSpeaker);
            }
            routeCommunicationDevice(am, !wantSpeaker);
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
