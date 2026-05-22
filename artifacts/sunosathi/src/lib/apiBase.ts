import { Capacitor } from "@capacitor/core";

const VPS_ORIGIN = "https://sunosathi.rajenterprises.info";

function computeApiOrigin(): string {
  try {
    if (Capacitor.isNativePlatform()) {
      return VPS_ORIGIN;
    }
  } catch {}
  const envOrigin = (import.meta.env.VITE_API_ORIGIN ?? "").replace(/\/+$/, "");
  if (envOrigin) return envOrigin;
  return "";
}

export const API_ORIGIN = computeApiOrigin();
export const IS_APK = API_ORIGIN === VPS_ORIGIN;

export function apiUrl(path: string): string {
  return `${API_ORIGIN}${path}`;
}
