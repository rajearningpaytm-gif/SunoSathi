import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.rajeneterprises.sunosathi",
  appName: "Suno Sathi",
  webDir: "dist/public",
  server: {
    url: "https://sunosathi.replit.app",
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
    FirebaseAuthentication: {
      skipNativeAuth: false,
      providers: ["google.com"],
    },
  },
};

export default config;
