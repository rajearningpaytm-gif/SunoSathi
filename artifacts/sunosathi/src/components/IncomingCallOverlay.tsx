import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Phone, PhoneOff, MessageCircle, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import { AnonymousAvatar } from "@/components/AnonymousAvatar";
import { startRingtone } from "@/lib/ringtone";
import { apiUrl } from "@/lib/apiBase";

export type IncomingCallData = {
  sessionId: string;
  userName: string;
  userAvatarSeed: string;
  kind: "call" | "chat" | "video_call";
};

const RING_TIMEOUT_SEC = 20;
const RADIUS = 38;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

interface Props {
  call: IncomingCallData | null;
  onDismiss: () => void;
  onNavigate: (sessionId: string, kind: "call" | "chat" | "video_call") => void;
}

export function IncomingCallOverlay({ call, onDismiss, onNavigate }: Props) {
  const [countdown, setCountdown] = useState(RING_TIMEOUT_SEC);
  const stopRingRef = useRef<(() => void) | null>(null);
  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef  = useRef<ReturnType<typeof setTimeout>  | null>(null);
  const dismissedRef = useRef(false);

  function cleanup() {
    stopRingRef.current?.();
    if (timerRef.current)   clearInterval(timerRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    dismissedRef.current = true;
  }

  useEffect(() => {
    if (!call) return;
    dismissedRef.current = false;
    setCountdown(RING_TIMEOUT_SEC);

    // Start ringtone (may fail if no user gesture yet; ignore gracefully)
    try { stopRingRef.current = startRingtone(); } catch { /* ignore */ }

    // Countdown
    timerRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) { clearInterval(timerRef.current!); return 0; }
        return c - 1;
      });
    }, 1000);

    // Auto ring-timeout
    timeoutRef.current = setTimeout(async () => {
      if (dismissedRef.current) return;
      try {
        await fetch(apiUrl(`/api/chat/sessions/${call.sessionId}/ring-timeout`), {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
        });
      } catch { /* best effort */ }
      cleanup();
      onDismiss();
    }, RING_TIMEOUT_SEC * 1000);

    return cleanup;
  }, [call?.sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleAnswer() {
    if (!call || dismissedRef.current) return;
    cleanup();
    if (call.kind !== "chat") {
      // For calls/video: call accept endpoint to trigger billing + notify user
      try {
        await fetch(apiUrl(`/api/chat/sessions/${call.sessionId}/accept`), {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
        });
      } catch { /* best effort */ }
    }
    // Chat sessions are already active — navigate directly
    onDismiss();
    onNavigate(call.sessionId, call.kind);
  }

  const progress = countdown / RING_TIMEOUT_SEC;
  const strokeDash = progress * CIRCUMFERENCE;

  return (
    <AnimatePresence>
      {call && (
        <motion.div
          key={call.sessionId}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.25 }}
          className="fixed inset-0 z-[200] flex flex-col items-center justify-between bg-gradient-to-b from-violet-950 via-indigo-950 to-slate-950 text-white select-none"
        >
          {/* Ambient blobs */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <div className="absolute top-1/4 left-1/4 w-72 h-72 rounded-full bg-violet-500/12 blur-3xl animate-pulse" />
            <div className="absolute bottom-1/3 right-1/4 w-64 h-64 rounded-full bg-pink-500/10 blur-3xl animate-pulse" style={{ animationDelay: "1.2s" }} />
          </div>

          {/* ── Top section ─────────────────────────────────────────── */}
          <div className="flex flex-col items-center pt-20 gap-3 relative z-10 px-8 text-center">
            {/* Kind badge */}
            <div className="flex items-center gap-1.5 bg-white/10 border border-white/15 rounded-full px-3.5 py-1 text-xs font-semibold text-violet-200 tracking-wide">
              {call.kind === "video_call"
                ? <><Video className="w-3.5 h-3.5" /> Incoming Video Call</>
                : call.kind === "call"
                ? <><Phone className="w-3.5 h-3.5" /> Incoming Audio Call</>
                : <><MessageCircle className="w-3.5 h-3.5" /> Incoming Chat Request</>}
            </div>

            {/* Avatar + countdown ring */}
            <div className="relative mt-6">
              {/* SVG countdown ring */}
              <svg
                className="absolute inset-0 -m-4"
                width={96 + 32}
                height={96 + 32}
                viewBox={`0 0 ${96 + 32} ${96 + 32}`}
              >
                <circle
                  cx={(96 + 32) / 2} cy={(96 + 32) / 2} r={RADIUS}
                  fill="none" stroke="rgba(167,139,250,0.18)" strokeWidth="5"
                />
                <circle
                  cx={(96 + 32) / 2} cy={(96 + 32) / 2} r={RADIUS}
                  fill="none"
                  stroke={countdown <= 5 ? "#f87171" : "#a78bfa"}
                  strokeWidth="5"
                  strokeLinecap="round"
                  strokeDasharray={`${strokeDash} ${CIRCUMFERENCE}`}
                  transform={`rotate(-90 ${(96 + 32) / 2} ${(96 + 32) / 2})`}
                  style={{ transition: "stroke-dasharray 1s linear, stroke 0.3s" }}
                />
              </svg>

              {/* Pulse rings */}
              <span className="absolute inset-0 rounded-full animate-ping bg-violet-500/20 m-0" style={{ animationDuration: "1.6s" }} />
              <span className="absolute inset-0 rounded-full animate-ping bg-violet-400/12" style={{ animationDuration: "1.6s", animationDelay: "0.8s" }} />

              {/* Avatar */}
              <div className="w-24 h-24 rounded-full border-[3px] border-violet-400/50 overflow-hidden bg-violet-900/60 relative z-10">
                <AnonymousAvatar
                  seed={call.userAvatarSeed || call.userName}
                  name={call.userName}
                  size="lg"
                />
              </div>
            </div>

            {/* Name */}
            <h1 className="text-2xl font-bold mt-5 text-white tracking-tight">{call.userName}</h1>
            <p className="text-violet-300/70 text-sm">
              {call.kind === "video_call" ? "wants to video call you"
                : call.kind === "call" ? "is calling you"
                : "wants to chat with you"}
            </p>

            {/* Countdown pill */}
            <div className={cn(
              "flex items-center gap-1.5 mt-2 rounded-full px-4 py-1.5 text-sm font-mono transition-colors",
              countdown <= 5 ? "bg-red-500/20 text-red-300" : "bg-white/8 text-violet-200"
            )}>
              <span className={cn(
                "w-2 h-2 rounded-full",
                countdown <= 5 ? "bg-red-400 animate-pulse" : "bg-violet-400"
              )} />
              {countdown}s
            </div>
          </div>

          {/* ── Bottom controls ─────────────────────────────────────── */}
          <div className="flex flex-col items-center gap-5 pb-20 relative z-10 w-full px-10">
            {/* Answer — single large button */}
            <button
              onClick={handleAnswer}
              className="w-20 h-20 rounded-full bg-green-500 hover:bg-green-600 active:scale-90 transition-all shadow-2xl shadow-green-500/50 flex items-center justify-center relative"
            >
              <span className="absolute inset-0 rounded-full animate-ping bg-green-400/40" style={{ animationDuration: "1s" }} />
              <span className="absolute inset-0 rounded-full animate-ping bg-green-400/20" style={{ animationDuration: "1s", animationDelay: "0.4s" }} />
              {call.kind === "chat"
                ? <MessageCircle className="w-9 h-9 text-white relative z-10" />
                : <Phone className="w-9 h-9 text-white relative z-10" />}
            </button>
            <span className="text-sm font-semibold text-white/70">
              {call.kind === "chat" ? "Open Chat" : "Answer"}
            </span>

            {/* Decline — calls backend so caller sees "declined" immediately */}
            <button
              onClick={async () => {
                cleanup();
                if (call?.sessionId) {
                  try {
                    await fetch(apiUrl(`/api/chat/sessions/${call.sessionId}/decline`), {
                      method: "POST",
                      credentials: "include",
                      headers: { "Content-Type": "application/json" },
                    });
                  } catch { /* best effort */ }
                }
                onDismiss();
              }}
              className="flex items-center gap-2 text-white/30 text-xs hover:text-white/60 transition-colors mt-1 px-4 py-2"
            >
              <PhoneOff className="w-4 h-4" />
              Can't talk right now
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
