package com.rajeneterprises.sunosathi;

import android.content.Context;
import android.media.AudioManager;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import com.getcapacitor.BridgeActivity;

/**
 * MainActivity — adds a thin JS bridge so the React app can request native
 * earpiece / speaker routing during calls without depending on Capacitor plugins.
 *
 * Also configures WebView for Firebase Google Sign-In via signInWithRedirect:
 *   - DOM storage (localStorage / IndexedDB) must stay enabled
 *   - JavaScript window management enabled so auth state can be persisted
 *
 * Usage from JavaScript:
 *   window.SunoAudio.setMode("earpiece");  // route to earpiece (private call)
 *   window.SunoAudio.setMode("speaker");   // route to loudspeaker
 *   window.SunoAudio.setMode("default");   // restore system default
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
        // Firebase uses IndexedDB to persist redirect state — without this
        // the "missing initial state" error returns after the Google redirect.
        WebSettings settings = getBridge().getWebView().getSettings();
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setJavaScriptEnabled(true);
    }

    /** JavaScript-callable audio routing bridge. */
    private static class SunoAudioBridge {
        private final Context context;

        SunoAudioBridge(Context context) {
            this.context = context;
        }

        /**
         * Set audio output mode.
         * @param mode  "earpiece" | "speaker" | "default"
         */
        @JavascriptInterface
        public void setMode(String mode) {
            AudioManager am = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
            if (am == null) return;

            switch (mode) {
                case "earpiece":
                    am.setMode(AudioManager.MODE_IN_COMMUNICATION);
                    am.setSpeakerphoneOn(false);
                    break;
                case "speaker":
                    am.setMode(AudioManager.MODE_IN_COMMUNICATION);
                    am.setSpeakerphoneOn(true);
                    break;
                default:
                    am.setMode(AudioManager.MODE_NORMAL);
                    am.setSpeakerphoneOn(false);
                    break;
            }
        }

        /** Returns current routing: "earpiece", "speaker", or "default". */
        @JavascriptInterface
        public String getMode() {
            AudioManager am = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
            if (am == null) return "default";
            if (am.isSpeakerphoneOn()) return "speaker";
            if (am.getMode() == AudioManager.MODE_IN_COMMUNICATION) return "earpiece";
            return "default";
        }
    }
}
