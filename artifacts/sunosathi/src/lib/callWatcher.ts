import { getApp } from "firebase/app";
import { getDatabase, ref, onValue } from "firebase/database";

const TERMINAL = new Set(["ended", "declined", "missed", "completed", "cancelled"]);
let active: { sessionId: string; stop: () => void } | null = null;
let _navTimer: ReturnType<typeof setTimeout> | null = null;
const _ORIGIN = location.protocol.startsWith("http") ? "" : "https://sunosathi.rajenterprises.info";

export function watchCallEnd(sessionId?: string | null): () => void {
  const sid = sessionId ? String(sessionId) : "";
  if (!sid) return () => {};
  if (active) { try { active.stop(); } catch { /**/ } active = null; }

  let stopped = false;
  let unsub: (() => void) | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  function cleanup() {
    if (unsub) { try { unsub(); } catch { /**/ } unsub = null; }
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (active && active.sessionId === sid) active = null;
    if (_navTimer) { clearTimeout(_navTimer); _navTimer = null; }
  }

  function fire() {
    if (stopped) return;
    stopped = true;
    cleanup();
    try { window.dispatchEvent(new CustomEvent("ss:session_ended", { detail: { sessionId: sid } })); } catch { /**/ }
    try { document.querySelectorAll("video,audio").forEach(el => { const m = el as HTMLVideoElement; if (m.srcObject instanceof MediaStream) m.srcObject.getTracks().forEach(t => t.stop()); }); } catch { /**/ }
    // Guaranteed: navigate home after 1.5s no matter what
    _navTimer = setTimeout(() => { _navTimer = null; try { window.location.href = "/"; } catch { /**/ } }, 1500);
  }

  // Primary: RTDB instant signal
  try {
    const db = getDatabase(getApp());
    unsub = onValue(ref(db, `calls/${sid}`), (snap) => {
      const val = snap.val();
      const st = val && typeof val === "object" ? (val as {status?:unknown}).status : val;
      if (st && TERMINAL.has(String(st))) fire();
    });
  } catch { /**/ }

  // Fallback: poll API every 3s (works even if RTDB blocked)
  const pollOnce = async () => {
    if (stopped) return;
    try {
      const r = await fetch(`${_ORIGIN}/api/chat/sessions/${sid}`, { credentials: "include" });
      if (r.ok) { const d = await r.json(); if (d.status && TERMINAL.has(d.status)) fire(); }
    } catch { /**/ }
  };
  pollTimer = setInterval(pollOnce, 3000);
  const onVisible = () => { if (!document.hidden) pollOnce(); };
  document.addEventListener("visibilitychange", onVisible);
  const stop = () => { if (stopped) return; stopped = true; cleanup(); document.removeEventListener("visibilitychange", onVisible); };
  setTimeout(stop, 2 * 60 * 60 * 1000);
  active = { sessionId: sid, stop };
  return stop;
}
