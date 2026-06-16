import { useState, useEffect, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { Mic, MicOff, PhoneOff, Wifi, WifiOff, Radio, Volume2, VolumeX, Video, VideoOff, Flag } from "lucide-react";
import { useWebRTC } from "@/hooks/useWebRTC";
import { AnonymousAvatar } from "@/components/AnonymousAvatar";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { API_ORIGIN } from "@/lib/apiBase";
import { watchCallEnd } from "../lib/callWatcher";

// ── Report categories ──────────────────────────────────────────────────────────
const REPORT_CATEGORIES = [
  { id: "rude_abusive",       label: "Rude / Abusive",        desc: "Gaali dena, bura bolna" },
  { id: "sexual_harassment",  label: "Sexual Harassment",     desc: "Galat baatein karna" },
  { id: "fake_caller",        label: "Fake / Prank Call",     desc: "Jhooth bolna ya time waste karna" },
] as const;
type ReportCategory = typeof REPORT_CATEGORIES[number]["id"];

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

interface SessionData {
  id: string;
  userId: string;
  userAnonymousName?: string;
  userAvatarSeed?: string;
  status: string;
  kind?: string;
}

export default function ListenerCallPage() {
  const { id: sessionId } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const [session, setSession] = useState<SessionData | null>(null);
  const [isEnding, setIsEnding] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  // ── Report modal state ──────────────────────────────────────────────────────
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportCategory, setReportCategory] = useState<ReportCategory | null>(null);
  const [reportNotes, setReportNotes] = useState("");
  const [isReporting, setIsReporting] = useState(false);
  const [reportDone, setReportDone] = useState(false);
  // <video playsInline> routes audio to earpiece on iOS Safari (unlike <audio>)
  const remoteMediaRef = useRef<HTMLVideoElement | null>(null);
  const localVideoRef  = useRef<HTMLVideoElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Video calls removed — always audio-only, even if server says "video_call"
  const isVideoSession = false;
  // CRITICAL: video prop must match the session kind. Hard-coding `video: true`
  // would force every listener to grant camera permission even for audio-only
  // calls. We pass `isVideoSession` so the useWebRTC hook acquires the camera
  // up-front ONLY for video_call sessions. The start() effect below waits for
  // `session` to be loaded so the correct value is in scope when start() runs.
  const webrtc = useWebRTC({ sessionId: sessionId ?? null, role: "answerer", video: isVideoSession });

  // Fetch + accept + start, gated on session being loaded so `video` prop is
  // correct when start() acquires media. Merged into a single effect to avoid
  // a race where start() ran before session arrived (which would have used the
  // wrong `video` value frozen in the start() closure).
  const startedRef = useRef(false);
  useEffect(() => {
    if (!sessionId || startedRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${API_ORIGIN}${BASE}/api/chat/sessions/${sessionId}`, { credentials: "include" });
        if (!r.ok || cancelled) return;
        const s: SessionData = await r.json();
        setSession(s);
        // Accept if still ringing (FCM-tap entry path)
        if (s.status === "ringing") {
          await fetch(`${API_ORIGIN}${BASE}/api/chat/sessions/${sessionId}/accept`, {
            method: "POST", credentials: "include",
            headers: { "Content-Type": "application/json" },
          });
        }

        // NOTE: Camera probe removed — was causing NotReadableError on Android
        // when start() tried to re-acquire camera 50ms later (HAL race). Now
        // useWebRTC.start() acquires camera directly with its own audio-only fallback.
        if (s.kind === "video_call") {
          try {
            const perms: any = (navigator as any).permissions;
            if (perms?.query) {
              const cam = await perms.query({ name: "camera" as PermissionName });
              if (cam.state === "denied") {
                toast.error("Camera blocked. Settings → Apps → SunoSathi → Permissions → Camera ON karo.", { duration: 8000 });
              }
            }
          } catch { /* Permissions API unsupported — fall through */ }
        }
      } catch { /* best effort */ }
      if (cancelled) return;
      // Brief tick so React commits the `session` state (and thus the new
      // `video` prop into useWebRTC) before start() reads it from closure.
      setTimeout(() => {
        if (cancelled || startedRef.current) return;
        startedRef.current = true;
        webrtc.start();
      }, 50);
    })();
    return () => { cancelled = true; };
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Session-status watchdog (user cut call OR server-ended) ---
  // Polls session every 2.5s (cache disabled). If the USER ends the call or the
  // server marks it terminal, listener is sent home immediately -- independent
  // of SSE / RTDB delivery.
  useEffect(() => {
    if (!sessionId) return;
    let stopped = false;
    const poll = async () => {
      if (stopped || isEnding) return;
      try {
        const r = await fetch(`${API_ORIGIN}${BASE}/api/chat/sessions/${sessionId}`, {
          credentials: "include",
          cache: "no-store",
          headers: { "Cache-Control": "no-cache" },
        });
        if (!r.ok || stopped) return;
        const d = await r.json();
        const st = String(d?.status || "");
        if (st === "ended" || st === "declined" || st === "missed" || st === "cancelled" || st === "completed") {
          stopped = true;
          setIsEnding(true);
          webrtc.stop();
          if (timerRef.current) clearInterval(timerRef.current);
          toast("Call ended.");
          setLocation(`${BASE}/home`);
        }
      } catch { /* ignore */ }
    };
    const iv = setInterval(poll, 2500);
    const onVisible = () => { if (!document.hidden) poll(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { stopped = true; clearInterval(iv); document.removeEventListener("visibilitychange", onVisible); };
  }, [sessionId, isEnding]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Network-drop watchdog ---
  // If the link stays "reconnecting" for >12s (user's network died, ICE never
  // recovers), give up and return to dashboard instead of staying stuck.
  useEffect(() => {
    if (isEnding) return;
    if (webrtc.status !== "reconnecting") return;
    const t = setTimeout(() => {
      if (isEnding) return;
      setIsEnding(true);
      webrtc.stop();
      if (timerRef.current) clearInterval(timerRef.current);
      fetch(`${API_ORIGIN}${BASE}/api/chat/sessions/${sessionId}/end`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
      }).catch(() => {});
      toast.error("Connection lost -- dashboard pe le ja rahe hain.");
      setLocation(`${BASE}/home`);
    }, 12000);
    return () => clearTimeout(t);
  }, [webrtc.status, isEnding, sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Wire remote stream to <video> element then immediately enforce earpiece.
  // Backoff schedule: 250ms → 500ms → 1000ms → 2000ms (4 attempts) — Android
  // WebView's autoplay block sometimes only releases after the codec is fully
  // initialised, which takes longer on low-end devices. Progressive backoff
  // covers a wider timing window than flat retries.
  useEffect(() => {
    const el = remoteMediaRef.current;
    if (!el || !webrtc.remoteStream) return;
    el.srcObject = webrtc.remoteStream;
    let cancelled = false;
    const tryPlay = (n = 0) => {
      if (cancelled) return;
      el.play().catch(() => {
        if (cancelled || n >= 3) return;
        setTimeout(() => tryPlay(n + 1), 250 * Math.pow(2, n));
      });
    };
    tryPlay();
    webrtc.reapplySink(el); // enforce earpiece (loudspeakerRef=false by default)
    return () => { cancelled = true; };
  }, [webrtc.remoteStream]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Re-play on peer-connection "connected" ─────────────────────────────────
  // useWebRTC dispatches "webrtc:connected" when pc.connectionState === "connected".
  // We re-attempt .play() on both video elements at that moment — Android WebView
  // sometimes only releases its autoplay block AFTER the connection is fully up,
  // so the initial play() at srcObject-assign time silently fails.
  useEffect(() => {
    const onConnected = () => {
      const rel = remoteMediaRef.current;
      const lcl = localVideoRef.current;
      const tryPlay = (el: HTMLVideoElement | null, n = 0) => {
        if (!el) return;
        el.play().catch(() => {
          if (n < 3) setTimeout(() => tryPlay(el, n + 1), 250 * Math.pow(2, n));
        });
      };
      tryPlay(rel);
      tryPlay(lcl);
    };
    window.addEventListener("webrtc:connected", onConnected);
    return () => window.removeEventListener("webrtc:connected", onConnected);
  }, []);

  // Earphone detection — re-route when headphones plugged/unplugged
  useEffect(() => {
    const handler = () => webrtc.reapplySink(remoteMediaRef.current);
    navigator.mediaDevices.addEventListener("devicechange", handler);
    return () => navigator.mediaDevices.removeEventListener("devicechange", handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Wire local stream to self-view <video> when camera is available
  useEffect(() => {
    const el = localVideoRef.current;
    if (!el || !webrtc.localStream) return;
    el.srcObject = webrtc.localStream;
    const tryPlay = (n = 0) => {
      el.play().catch(() => { if (n < 3) setTimeout(() => tryPlay(n + 1), 250); });
    };
    tryPlay();
  }, [webrtc.localStream]);

  // Call duration timer — starts when WebRTC is connected
  useEffect(() => {
    if (webrtc.status === "connected") {
      timerRef.current = setInterval(() => setCallDuration((d) => d + 1), 1000);
    } else {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [webrtc.status]);

  // Auto-enable camera for video sessions when WebRTC connects.
  // If it fails (permission denied at OS level, camera busy, etc.) the user
  // can manually retry via the always-visible Cam button below.
  const autoCamTriedRef = useRef(false);
  useEffect(() => {
    if (!isVideoSession) return;
    if (webrtc.status !== "connected") return;
    if (webrtc.isCameraEnabled) return;
    if (autoCamTriedRef.current) return;
    autoCamTriedRef.current = true;
    webrtc.enableCamera().catch((err: any) => {
      toast.error(err?.message || "Camera start nahi ho saka — Cam button dabake retry karo.");
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVideoSession, webrtc.status]);

  const handleEndCall = async () => {
    if (isEnding) return;
    setIsEnding(true);
    webrtc.stop();
    try {
      await fetch(`${API_ORIGIN}${BASE}/api/chat/sessions/${sessionId}/end`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
    } catch { /* best effort */ }
    toast.success("Call ended.");
    setLocation(`${BASE}/home`);
  };

  const handleSubmitReport = async () => {
    if (!reportCategory || !session) return;
    setIsReporting(true);
    try {
      const res = await fetch(`${API_ORIGIN}${BASE}/api/safety/report`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportedUserId: session.userId,
          sessionId: sessionId ?? undefined,
          category: reportCategory,
          notes: reportNotes.trim() || undefined,
        }),
      });
      if (res.status === 409) {
        toast("Is session mein pehle hi report kar diya hai.");
        setShowReportModal(false);
        return;
      }
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast.error(d.error ?? "Report send nahi ho saka. Dobara try karo.");
        return;
      }
      setReportDone(true);
      toast.success("Report bheji gayi. Hum review karenge.");
      setTimeout(() => setShowReportModal(false), 1800);
    } catch {
      toast.error("Network error. Internet check karo.");
    } finally {
      setIsReporting(false);
    }
  };

  // WebRTC peer-connection failure → graceful return to dashboard.
  // Without this, if the user drops abruptly (Wi-Fi cut, app killed,
  // ICE failure), the listener stays stuck on the active-call screen.
  useEffect(() => {
    if (!sessionId || isEnding) return;
    const s = webrtc.status as string;
    if (s === "failed" || s === "closed" || s === "disconnected") {
      setIsEnding(true);
      webrtc.stop();
      if (timerRef.current) clearInterval(timerRef.current);
      // Tell the server too so the caller side gets the SSE event
      fetch(`${API_ORIGIN}${BASE}/api/chat/sessions/${sessionId}/end`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
      }).catch(() => { /* best effort */ });
      toast.error("Connection lost — dashboard pe le ja rahe hain.");
      setLocation(`${BASE}/home`);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webrtc.status, sessionId, isEnding]);

  // Listen for user ending the call from their side via SSE
  useEffect(() => {
    const onSessionEnded = (e: Event) => {
      const ev = e as CustomEvent<{ sessionId: string }>;
      if (ev.detail.sessionId !== sessionId) return;
      if (isEnding) return;
      setIsEnding(true);
      webrtc.stop();
      if (timerRef.current) clearInterval(timerRef.current);
      toast("Call ended by the user.");
      setLocation(`${BASE}/home`);
    };
    window.addEventListener("ss:session_ended", onSessionEnded);
    const _stopWatcher = watchCallEnd(sessionId);
    return () => { window.removeEventListener("ss:session_ended", onSessionEnded); _stopWatcher(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, isEnding]);

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  const callerName = session?.userAnonymousName ?? "Caller";
  const callerSeed = session?.userAvatarSeed ?? session?.userId ?? "unknown";

  const statusLabel: Record<typeof webrtc.status, string> = {
    idle:                    "Starting…",
    "requesting-permissions": isVideoSession ? "Requesting camera + mic…" : "Requesting mic access…",
    connecting:              isVideoSession ? "Connecting video…" : "Connecting audio…",
    connected:               fmt(callDuration),
    reconnecting:            "Reconnecting…",
    failed:                  "Connection failed",
    ended:                   "Call ended",
  };

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-between bg-gradient-to-b from-emerald-950 via-teal-950 to-slate-950 text-white select-none">
      {/*
        Remote media element — <video> NOT <audio> for earpiece routing on iOS Safari.
        display:none still plays audio. Becomes visible when remote video stream arrives.
      */}
      <video
        ref={remoteMediaRef}
        autoPlay
        playsInline
        style={{
          position: "absolute", inset: 0,
          width: "100%", height: "100%",
          objectFit: "cover", zIndex: 1,
          display: webrtc.hasRemoteVideo && webrtc.status === "connected" ? "block" : "none",
        }}
      />

      {/* Local camera self-view pip — shows when listener's camera is active */}
      {webrtc.localStream && (webrtc.localStream.getVideoTracks().length > 0) && webrtc.status === "connected" && (
        <div className="absolute bottom-40 right-4 z-20 w-24 h-32 rounded-2xl overflow-hidden border-2 border-white/30 shadow-xl bg-black">
          <video ref={localVideoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
        </div>
      )}

      {/* Ambient blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-72 h-72 rounded-full bg-emerald-500/10 blur-3xl animate-pulse" />
        <div className="absolute bottom-1/3 right-1/4 w-64 h-64 rounded-full bg-teal-500/8 blur-3xl animate-pulse" style={{ animationDelay: "1.3s" }} />
      </div>

      {/* ── Top status bar ─────────────────────────────────────────────────── */}
      <div className="relative z-10 w-full flex items-center justify-between px-5 pt-safe pt-4">
        <div className="flex items-center gap-2 bg-white/10 rounded-full px-3 py-1.5">
          {webrtc.status === "connected"
            ? <Wifi className="w-3.5 h-3.5 text-green-400" />
            : <WifiOff className="w-3.5 h-3.5 text-yellow-400 animate-pulse" />}
          <span className="text-xs text-white/70 font-mono tabular-nums">
            {webrtc.status === "connected" ? fmt(callDuration) : statusLabel[webrtc.status]}
          </span>
        </div>

        <div className="flex items-center gap-1.5 text-xs text-white/40 bg-white/5 rounded-full px-3 py-1.5">
          <Radio className="w-3 h-3" />
          Listener Mode
        </div>
      </div>

      {/* ── Caller avatar + name ────────────────────────────────────────────── */}
      <div className="relative z-10 flex flex-col items-center gap-5 mt-4">
        <div className="relative">
          {webrtc.status === "connected" && (
            <>
              <span className="absolute inset-0 rounded-full animate-ping bg-emerald-500/25" />
              <span className="absolute inset-0 rounded-full animate-ping bg-emerald-400/15" style={{ animationDelay: "0.7s" }} />
            </>
          )}
          {webrtc.status === "connecting" && (
            <span className="absolute inset-0 rounded-full animate-ping bg-teal-500/20" style={{ animationDuration: "1.6s" }} />
          )}
          <div className="w-36 h-36 rounded-full overflow-hidden border-4 border-white/20 shadow-2xl bg-violet-900/50 relative z-10">
            <AnonymousAvatar seed={callerSeed} name={callerName} size="lg" />
          </div>
        </div>

        <div className="text-center px-8">
          <h1 className="text-3xl font-bold tracking-tight">{callerName}</h1>
          <p className="text-emerald-300/60 text-sm mt-1.5">
            {webrtc.status === "connected"
              ? isVideoSession ? "In call · video active" : "In call · audio active"
              : webrtc.status === "failed"
              ? "Could not connect"
              : isVideoSession ? "Setting up secure video…" : "Setting up secure audio…"}
          </p>
        </div>

        {/* Permission error */}
        {webrtc.permissionError && (
          <div className="mx-6 bg-red-500/20 border border-red-500/30 rounded-2xl px-5 py-3 text-center">
            <p className="text-red-300 text-sm font-medium">🎤 {webrtc.permissionError}</p>
            <p className="text-red-400/60 text-xs mt-1">The caller may not hear you.</p>
          </div>
        )}

        {/* Video permission notice */}
        {isVideoSession && webrtc.status === "connecting" && !webrtc.isCameraEnabled && !webrtc.permissionError && (
          <div className="mx-6 bg-violet-500/15 border border-violet-500/30 rounded-2xl px-5 py-3 text-center">
            <p className="text-violet-200 text-sm font-medium">📷 Video Call aaya hai</p>
            <p className="text-violet-300/70 text-xs mt-1">
              Connect hone par browser camera ki permission maangega — Allow zaroor karna.
            </p>
          </div>
        )}

        {/* Connecting hint */}
        {webrtc.status === "connecting" && !webrtc.permissionError && (
          <p className="text-white/30 text-xs animate-pulse px-8 text-center">
            {isVideoSession ? "Establishing P2P video connection…" : "Establishing P2P audio connection…"}
          </p>
        )}

        {/* Waiting-for-remote-video banner — connected but caller's camera hasn't
            arrived yet. Without this, the listener stares at a blank screen and
            assumes video is broken. */}
        {isVideoSession && webrtc.status === "connected" && !webrtc.hasRemoteVideo && (
          <div className="mx-6 bg-blue-500/15 border border-blue-500/30 rounded-2xl px-5 py-2 text-center">
            <p className="text-blue-200 text-xs font-medium animate-pulse">
              📹 Caller ka camera connect ho raha hai…
            </p>
          </div>
        )}

        {/* Audio-only fallback banner — start() acquired audio but no video track
            (probe failed or camera was busy). The Cam button can still be tapped
            to retry. */}
        {isVideoSession && webrtc.status === "connected" && !webrtc.isCameraEnabled && (
          <div className="mx-6 bg-orange-500/15 border border-orange-500/30 rounded-2xl px-5 py-2 text-center">
            <p className="text-orange-200 text-xs font-medium">
              📷 Aapki camera off hai — neeche <span className="font-bold">Cam On</span> dabake video chalu karo.
            </p>
          </div>
        )}

        {/* Connected mic indicator */}
        {webrtc.status === "connected" && !webrtc.isMuted && (
          <div className="flex items-center gap-2 bg-emerald-500/20 border border-emerald-500/30 rounded-full px-4 py-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs text-emerald-300 font-medium">Mic active</span>
          </div>
        )}
        {webrtc.status === "connected" && webrtc.isMuted && (
          <div className="flex items-center gap-2 bg-white/10 border border-white/20 rounded-full px-4 py-1.5">
            <MicOff className="w-3 h-3 text-white/50" />
            <span className="text-xs text-white/50">Muted</span>
          </div>
        )}
      </div>

      {/* ── Controls ───────────────────────────────────────────────────────── */}
      <div className="relative z-10 w-full px-10 pb-16 space-y-6">
        <div className="flex justify-center gap-10">
          {/* Mute */}
          <button
            onClick={webrtc.toggleMute}
            className={cn(
              "flex flex-col items-center gap-2 transition-opacity",
              webrtc.isMuted ? "opacity-100" : "opacity-70"
            )}
          >
            <span className={cn(
              "w-16 h-16 rounded-full flex items-center justify-center transition-colors",
              webrtc.isMuted
                ? "bg-white/20 border-2 border-white/40"
                : "bg-white/10"
            )}>
              {webrtc.isMuted ? <MicOff className="w-7 h-7" /> : <Mic className="w-7 h-7" />}
            </span>
            <span className="text-xs text-white/60">
              {webrtc.isMuted ? "Unmute" : "Mute"}
            </span>
          </button>

          {/* Speaker toggle — earpiece ↔ loudspeaker */}
          <button
            onClick={() => webrtc.toggleSpeaker(remoteMediaRef.current)}
            className={cn("flex flex-col items-center gap-2", webrtc.isLoudspeaker ? "opacity-100" : "opacity-70")}
          >
            <span className={cn(
              "w-16 h-16 rounded-full flex items-center justify-center transition-colors",
              webrtc.isLoudspeaker ? "bg-blue-500/30 border-2 border-blue-400/50" : "bg-white/10"
            )}>
              {webrtc.isLoudspeaker ? <Volume2 className="w-7 h-7 text-blue-400" /> : <VolumeX className="w-7 h-7" />}
            </span>
            <span className="text-xs text-white/60">{webrtc.isLoudspeaker ? "Speaker" : "Earpiece"}</span>
          </button>

          {/* Camera toggle — ALWAYS visible for video sessions so listener can
              retry if the initial auto-enable failed (permission denied, camera busy). */}
          {isVideoSession && (
            <button
              onClick={async () => {
                if (!webrtc.isCameraEnabled) {
                  try { await webrtc.enableCamera(); toast.success("Camera on!"); }
                  catch (err: any) { toast.error(err?.message || "Camera start nahi ho saka."); }
                } else {
                  webrtc.toggleVideo();
                }
              }}
              className={cn(
                "flex flex-col items-center gap-2 transition-opacity",
                webrtc.isCameraEnabled && !webrtc.isVideoOff ? "opacity-100" : "opacity-70"
              )}
            >
              <span className={cn(
                "w-16 h-16 rounded-full flex items-center justify-center transition-colors",
                webrtc.isCameraEnabled && !webrtc.isVideoOff
                  ? "bg-violet-500/30 border-2 border-violet-400/50"
                  : "bg-white/10"
              )}>
                {webrtc.isCameraEnabled && !webrtc.isVideoOff
                  ? <Video className="w-7 h-7 text-violet-300" />
                  : <VideoOff className="w-7 h-7" />}
              </span>
              <span className="text-xs text-white/60">
                {!webrtc.isCameraEnabled ? "Cam On" : webrtc.isVideoOff ? "Cam Off" : "Cam On"}
              </span>
            </button>
          )}

          {/* Report user button */}
          {!reportDone && (
            <button
              onClick={() => { setShowReportModal(true); setReportCategory(null); setReportNotes(""); setReportDone(false); }}
              className="flex flex-col items-center gap-2 opacity-70 hover:opacity-100 transition-opacity"
            >
              <span className="w-16 h-16 rounded-full flex items-center justify-center bg-orange-500/20 border border-orange-400/30">
                <Flag className="w-7 h-7 text-orange-400" />
              </span>
              <span className="text-xs text-white/60">Report</span>
            </button>
          )}
          {reportDone && (
            <div className="flex flex-col items-center gap-2 opacity-60">
              <span className="w-16 h-16 rounded-full flex items-center justify-center bg-green-500/20 border border-green-400/30">
                <Flag className="w-7 h-7 text-green-400" />
              </span>
              <span className="text-xs text-green-400">Reported</span>
            </div>
          )}
        </div>

        <div className="flex justify-center">
          <button
            onClick={handleEndCall}
            disabled={isEnding}
            className="w-20 h-20 rounded-full flex items-center justify-center bg-red-500 hover:bg-red-600 active:scale-95 transition-all shadow-[0_0_30px_rgba(239,68,68,0.5)] disabled:opacity-50"
          >
            <PhoneOff className="w-8 h-8 text-white" />
          </button>
        </div>

        <p className="text-center text-white/30 text-xs">
          {isEnding ? "Ending call…" : "Tap red to end the call"}
        </p>
      </div>

      {/* ── Report Modal ─────────────────────────────────────────────────────── */}
      {showReportModal && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center"
          style={{ background: "rgba(0,0,0,0.75)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowReportModal(false); }}
        >
          <div className="w-full max-w-md rounded-t-3xl p-6 space-y-5"
            style={{ background: "linear-gradient(180deg,#1a1a2e 0%,#16213e 100%)", border: "1px solid rgba(255,255,255,0.08)" }}>

            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Flag className="w-5 h-5 text-orange-400" />
                <h2 className="text-white font-bold text-lg">User Report Karo</h2>
              </div>
              <button onClick={() => setShowReportModal(false)}
                className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-white/60 hover:bg-white/20 text-lg leading-none">
                ×
              </button>
            </div>

            <p className="text-white/50 text-sm">
              {session?.userAnonymousName ?? "Is user"} ke baare mein kya problem hai?
            </p>

            {/* Category buttons */}
            <div className="space-y-3">
              {REPORT_CATEGORIES.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => setReportCategory(cat.id)}
                  className={cn(
                    "w-full rounded-2xl px-4 py-3 text-left transition-all border",
                    reportCategory === cat.id
                      ? "border-orange-400/60 bg-orange-500/15"
                      : "border-white/10 bg-white/5 hover:bg-white/10"
                  )}
                >
                  <p className={cn("font-semibold text-sm", reportCategory === cat.id ? "text-orange-300" : "text-white")}>
                    {cat.label}
                  </p>
                  <p className="text-white/40 text-xs mt-0.5">{cat.desc}</p>
                </button>
              ))}
            </div>

            {/* Optional notes */}
            <div>
              <label className="text-white/50 text-xs block mb-1.5">Kuch aur batana hai? (Optional)</label>
              <textarea
                value={reportNotes}
                onChange={e => setReportNotes(e.target.value)}
                placeholder="Kya hua... (optional)"
                maxLength={300}
                rows={2}
                className="w-full rounded-xl px-3 py-2 text-sm text-white bg-white/8 border border-white/10 placeholder-white/25 resize-none focus:outline-none focus:border-orange-400/40"
                style={{ background: "rgba(255,255,255,0.05)" }}
              />
            </div>

            {/* Submit */}
            <button
              onClick={handleSubmitReport}
              disabled={!reportCategory || isReporting}
              className={cn(
                "w-full py-4 rounded-2xl font-bold text-sm transition-all",
                reportCategory && !isReporting
                  ? "bg-orange-500 hover:bg-orange-600 text-white active:scale-98"
                  : "bg-white/10 text-white/30 cursor-not-allowed"
              )}
            >
              {isReporting ? "Bhej raha hun…" : reportDone ? "Report Bheji ✓" : "Report Bhejo"}
            </button>

            <p className="text-white/25 text-[10px] text-center">
              Report ki jaanch hogi. Yeh user aapko dobara call nahi kar payega.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
