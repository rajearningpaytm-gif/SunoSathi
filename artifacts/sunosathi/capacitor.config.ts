import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.rajeneterprises.sunosathi",
  appName: "Suno Sathi",
  webDir: "dist/public",
  server: {
    // For development testing against the production server.
    // The release APK uses the bundled web assets (url is NOT set).
    // url: "https://sunosathi.replit.app",
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
