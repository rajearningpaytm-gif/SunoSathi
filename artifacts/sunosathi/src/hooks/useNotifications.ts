import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import type { IncomingCallData } from "@/components/IncomingCallOverlay";

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

  useEffect(() => {
    if (!enabled) return;

    const url = `/api/notifications/stream`;
    const es = new EventSource(url, { withCredentials: true });
    esRef.current = es;

    const handleNewSession = (e: MessageEvent) => {
      try {
        const data: NotificationEvent = JSON.parse(e.data);
        if (data.type !== "new_session") return;

        if (onIncomingCall) {
          // Show the full-screen IncomingCallOverlay for the listener
          onIncomingCall({
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

    es.addEventListener("new_session",   handleNewSession);
    es.addEventListener("call_accepted", handleCallAccepted);
    es.addEventListener("call_declined", handleCallDeclined);
    es.addEventListener("call_missed",   handleCallMissed);
    es.addEventListener("session_ended", handleSessionEnded);

    es.onerror = () => { es.close(); };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps
}
