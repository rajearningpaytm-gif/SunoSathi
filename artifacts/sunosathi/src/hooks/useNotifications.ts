import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import type { IncomingCallData } from "@/components/IncomingCallOverlay";
import { API_ORIGIN } from "@/lib/apiBase";

type NotificationEvent =
  | {
      type: "new_session";
      sessionId: string;
      kind: "call" | "video_call";
      userName: string;
      userAvatarSeed: string;
    }
  | { type: "call_accepted"; sessionId: string }
  | { type: "call_declined"; sessionId: string }
  | { type: "call_missed";   sessionId: string }
  | { type: "session_ended"; sessionId: string };

export function useNotifications(
  enabled: boolean,
  onIncomingCall?: (data: IncomingCallData | null) => void,
) {
  const [, setLocation] = useLocation();
  const esRef = useRef<EventSource | null>(null);
  // Stable refs so the EventSource handlers always see the latest callback /
  // route fn without us having to tear down + reopen the SSE connection on
  // every render.
  const onIncomingCallRef = useRef(onIncomingCall);
  const setLocationRef    = useRef(setLocation);
  useEffect(() => { onIncomingCallRef.current = onIncomingCall; }, [onIncomingCall]);
  useEffect(() => { setLocationRef.current    = setLocation;    }, [setLocation]);

  useEffect(() => {
    if (!enabled) return;

    // CRITICAL: Must use API_ORIGIN so SSE works inside the Capacitor APK.
    // Without this prefix, EventSource resolves to capacitor://localhost/api/...
    // inside the APK and the listener silently never receives incoming calls.
    const url = `${API_ORIGIN}/api/notifications/stream`;

    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let backoffMs = 1000;
    let closed = false;

    const handleNewSession = (e: MessageEvent) => {
      try {
        const data: NotificationEvent = JSON.parse(e.data);
        if (data.type !== "new_session") return;

        const cb = onIncomingCallRef.current;
        if (cb) {
          // Show the full-screen IncomingCallOverlay for the listener
          cb({
            sessionId: data.sessionId,
            kind: data.kind,
            userName: data.userName,
            userAvatarSeed: data.userAvatarSeed ?? data.userName,
          });
        } else {
          // Fallback toast if no overlay handler
          const label = data.kind === "video_call" ? "Video call" : "Audio call";
          toast(`${label} from ${data.userName}`, {
            description: "A user wants to connect with you.",
            duration: 20000,
          });
        }
      } catch { /* ignore */ }
    };

    // Dispatch browser custom events so CallScreen (user side) can react
    // without polling delay when the SSE event arrives
    const handleCallEvent = (e: MessageEvent, eventType: string) => {
      try {
        const data: NotificationEvent = JSON.parse(e.data);
        window.dispatchEvent(new CustomEvent(eventType, { detail: { sessionId: data.sessionId } }));
      } catch { /* ignore */ }
    };

    const handleCallAccepted  = (e: MessageEvent) => handleCallEvent(e, "ss:call_accepted");
    const handleCallDeclined  = (e: MessageEvent) => handleCallEvent(e, "ss:call_declined");
    const handleCallMissed    = (e: MessageEvent) => handleCallEvent(e, "ss:call_missed");
    const handleSessionEnded  = (e: MessageEvent) => handleCallEvent(e, "ss:session_ended");

    const connect = () => {
      if (closed) return;
      const es = new EventSource(url, { withCredentials: true });
      esRef.current = es;

      es.addEventListener("connected",     () => { backoffMs = 1000; });
      es.addEventListener("new_session",   handleNewSession);
      es.addEventListener("call_accepted", handleCallAccepted);
      es.addEventListener("call_declined", handleCallDeclined);
      es.addEventListener("call_missed",   handleCallMissed);
      es.addEventListener("session_ended", handleSessionEnded);

      es.onerror = () => {
        // Native EventSource closes itself on transport error in some browsers;
        // explicitly close + schedule a reconnect with exponential backoff so a
        // freshly-onboarded listener doesn't lose incoming-call delivery after
        // a transient drop (mobile data hiccup, server restart, etc.).
        try { es.close(); } catch { /* ignore */ }
        if (esRef.current === es) esRef.current = null;
        if (closed) return;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connect, backoffMs);
        backoffMs = Math.min(backoffMs * 2, 15000);
      };
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try { esRef.current?.close(); } catch { /* ignore */ }
      esRef.current = null;
    };
  }, [enabled]);
}
