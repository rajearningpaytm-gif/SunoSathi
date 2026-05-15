// Central API origin utility — used by all manual fetch() calls.
//
// Web (production):  VITE_API_ORIGIN is empty → relative URLs work through the proxy.
// APK (Capacitor):   VITE_API_ORIGIN=https://sunosathi.replit.app is injected at build time
//                    → all /api/... calls resolve to the production server.
export const API_ORIGIN = (import.meta.env.VITE_API_ORIGIN ?? "").replace(/\/+$/, "");

/** Prepend API_ORIGIN to a root-relative path (e.g. "/api/me" → "https://...sunosathi.replit.app/api/me"). */
export function apiUrl(path: string): string {
  return `${API_ORIGIN}${path}`;
}
