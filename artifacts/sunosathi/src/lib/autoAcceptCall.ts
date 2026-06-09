// Self-installs on import. When notification Answer is tapped, auto-accepts the call.
const ACCEPT = new Set(["accept","answer","call_accept","call_answer"]);
const BASE = location.protocol.startsWith("http") ? "" : "https://sunosathi.rajenterprises.info";

window.addEventListener("ss:fcm_call_action", async (e: Event) => {
  const d = (e as CustomEvent).detail ?? {};
  const action = String(d.action ?? d.callAction ?? d.call_action ?? "").toLowerCase();
  const sid = String(d.sessionId ?? d.session_id ?? "");
  if (!sid) return;
  if (!ACCEPT.has(action)) return;
  try {
    await fetch(`${BASE}/api/chat/sessions/${sid}/accept`, {
      method: "POST", credentials: "include", cache: "no-store",
    });
  } catch { /* noop */ }
}, { passive: true });
