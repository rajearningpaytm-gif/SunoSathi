package com.rajeneterprises.sunosathi;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.widget.Toast;

/**
 * Auto-opens the manufacturer-specific autostart / background-permission
 * settings page on first launch. This is the closest we can get to a
 * "no jahmela, one-tap" experience on aggressive OEM ROMs.
 *
 * Why this exists:
 *   Xiaomi MIUI, Realme/Oppo ColorOS, Vivo Funtouch, OnePlus OxygenOS and
 *   Huawei/Honor EMUI lock "Autostart" and "Run in background" toggles
 *   behind their OWN settings pages — separate from Google Android. These
 *   toggles default to OFF for newly-installed apps, and the OS silently
 *   kills FCM delivery within minutes of the app being swiped away. There
 *   is NO API for an app to flip these toggles programmatically (Google
 *   doesn't expose it because each OEM defines their own restriction).
 *
 *   The best we can do is JUMP THE USER directly to the right page so they
 *   don't have to hunt through 5 levels of Settings to find it. The user
 *   still has to tap "Allow" once, but they don't have to navigate.
 *
 *   This is exactly what WhatsApp, Truecaller, Zoom, Microsoft Teams all do.
 *
 * Throttling: only fires once every 24 hours so we don't annoy people on
 * every single launch. Stops after the user actually whitelists the app
 * (battery-opt check serves as a proxy for "user has done OEM setup").
 */
public class OemAutostartHelper {

    private static final String PREF_KEY = "oem_autostart_last_prompt_ms";

    /** Try to open the OEM autostart page. Returns true if an intent was launched. */
    public static boolean maybePromptAutostart(Context ctx) {
        // Throttle: at most once every 24 hours
        SharedPreferences prefs =
            ctx.getSharedPreferences(MyFirebaseMessagingService.PREFS_NAME, Context.MODE_PRIVATE);
        long now = System.currentTimeMillis();
        long lastPrompt = prefs.getLong(PREF_KEY, 0L);
        if (now - lastPrompt < 24L * 60L * 60L * 1000L) return false;

        String manufacturer = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.toLowerCase();
        String brand        = Build.BRAND == null ? "" : Build.BRAND.toLowerCase();

        Intent[] candidates = buildCandidatesFor(manufacturer, brand);
        for (Intent intent : candidates) {
            if (intent == null) continue;
            try {
                intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(intent);
                prefs.edit().putLong(PREF_KEY, now).apply();
                Toast.makeText(ctx,
                    "SunoSathi ke saamne 'Allow' / 'On' dabao taaki calls hamesha aayein 📞",
                    Toast.LENGTH_LONG).show();
                return true;
            } catch (Exception ignored) {
                // Try the next candidate
            }
        }

        // No OEM-specific page worked — fall back to the standard app-details
        // page where every Android version lets the user manage permissions.
        try {
            Intent fallback = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:" + ctx.getPackageName()));
            fallback.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(fallback);
            prefs.edit().putLong(PREF_KEY, now).apply();
            return true;
        } catch (Exception ignored) { }

        // Stock Android (Pixel / Motorola / generic) — nothing OEM-specific to
        // open. Battery-opt prompt elsewhere handles those phones fully.
        prefs.edit().putLong(PREF_KEY, now).apply();
        return false;
    }

    /**
     * Build a prioritised list of intents to try for this manufacturer.
     * Different ROM versions move these activities around, so we try several
     * known component names and take the first that works.
     */
    private static Intent[] buildCandidatesFor(String manufacturer, String brand) {
        // ── Xiaomi / Redmi / POCO (MIUI) ───────────────────────────────────
        if (manufacturer.contains("xiaomi") || brand.contains("redmi") || brand.contains("poco")) {
            return new Intent[]{
                componentIntent("com.miui.securitycenter",
                    "com.miui.permcenter.autostart.AutoStartManagementActivity"),
                componentIntent("com.miui.securitycenter",
                    "com.miui.permcenter.permissions.PermissionsEditorActivity"),
            };
        }
        // ── Realme / Oppo (ColorOS) ────────────────────────────────────────
        if (manufacturer.contains("realme") || manufacturer.contains("oppo")
                || brand.contains("realme") || brand.contains("oppo")) {
            return new Intent[]{
                componentIntent("com.coloros.safecenter",
                    "com.coloros.safecenter.permission.startup.StartupAppListActivity"),
                componentIntent("com.coloros.safecenter",
                    "com.coloros.safecenter.startupapp.StartupAppListActivity"),
                componentIntent("com.oppo.safe",
                    "com.oppo.safe.permission.startup.StartupAppListActivity"),
                componentIntent("com.coloros.oppoguardelf",
                    "com.coloros.powermanager.fuelgaue.PowerUsageModelActivity"),
            };
        }
        // ── Vivo / iQOO (Funtouch / OriginOS) ──────────────────────────────
        if (manufacturer.contains("vivo") || brand.contains("vivo") || brand.contains("iqoo")) {
            return new Intent[]{
                componentIntent("com.vivo.permissionmanager",
                    "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"),
                componentIntent("com.iqoo.secure",
                    "com.iqoo.secure.ui.phoneoptimize.BgStartUpManager"),
                componentIntent("com.iqoo.secure",
                    "com.iqoo.secure.MainActivity"),
            };
        }
        // ── OnePlus (OxygenOS) ─────────────────────────────────────────────
        if (manufacturer.contains("oneplus") || brand.contains("oneplus")) {
            return new Intent[]{
                componentIntent("com.oneplus.security",
                    "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity"),
            };
        }
        // ── Huawei / Honor (EMUI / Magic UI) ───────────────────────────────
        if (manufacturer.contains("huawei") || manufacturer.contains("honor")
                || brand.contains("huawei") || brand.contains("honor")) {
            return new Intent[]{
                componentIntent("com.huawei.systemmanager",
                    "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"),
                componentIntent("com.huawei.systemmanager",
                    "com.huawei.systemmanager.optimize.process.ProtectActivity"),
                componentIntent("com.huawei.systemmanager",
                    "com.huawei.systemmanager.appcontrol.activity.StartupAppControlActivity"),
            };
        }
        // ── Samsung (One UI) — uses standard battery optimisation page ─────
        if (manufacturer.contains("samsung") || brand.contains("samsung")) {
            return new Intent[]{
                componentIntent("com.samsung.android.lool",
                    "com.samsung.android.sm.ui.battery.BatteryActivity"),
            };
        }
        // ── LeEco / Letv ───────────────────────────────────────────────────
        if (manufacturer.contains("letv") || brand.contains("letv") || brand.contains("leeco")) {
            return new Intent[]{
                componentIntent("com.letv.android.letvsafe",
                    "com.letv.android.letvsafe.AutobootManageActivity"),
            };
        }
        // ── ASUS (ZenUI) ───────────────────────────────────────────────────
        if (manufacturer.contains("asus") || brand.contains("asus")) {
            return new Intent[]{
                componentIntent("com.asus.mobilemanager",
                    "com.asus.mobilemanager.powersaver.PowerSaverSettings"),
                componentIntent("com.asus.mobilemanager",
                    "com.asus.mobilemanager.entry.FunctionActivity"),
            };
        }
        // Stock Android / Pixel / Motorola / Nokia — no OEM page needed
        return new Intent[0];
    }

    private static Intent componentIntent(String pkg, String cls) {
        Intent i = new Intent();
        i.setComponent(new ComponentName(pkg, cls));
        return i;
    }
}
