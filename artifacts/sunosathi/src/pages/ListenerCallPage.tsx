import { useState, useEffect, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { Mic, MicOff, PhoneOff, Wifi, WifiOff, Radio, Volume2, VolumeX, Video, VideoOff } from "lucide-react";
import { useWebRTC } from "@/hooks/useWebRTC";
import { AnonymousAvatar } from "@/components/AnonymousAvatar";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
const API_ORIGIN = (import.meta.env.VITE_API_ORIGIN ?? "").replace(/\/+$/, "");

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
  // <video playsInline> routes audio to earpiece on iOS Safari (unlike <audio>)
  const remoteMediaRef = useRef<HTMLVideoElement | null>(null);
  const localVideoRef  = useRef<HTMLVideoElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isVideoSession = session?.kind === "video_call";
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

        // ── Pre-call camera + mic probe for video sessions ──────────────────
        // Mirrors the caller-side gate in ListenerDetail.handleStartVideoCall:
        //   1) Permissions API check — bail with clear message if hard-denied.
        //   2) Probe getUserMedia({video, audio}) to force the OS prompt up-front
        //      and detect NotAllowedError / NotFoundError / NotReadableError
        //      BEFORE webrtc.start() runs (so the listener doesn't end up in an
        //      audio-only fallback where their camera silently never reaches the
        //      caller).
        //   3) Release probe tracks so start()'s getUserMedia can re-acquire them
        //      cleanly — Android camera HAL refuses a second open() if tracks are
        //      still live.
        if (s.kind === "video_call") {
          try {
            const perms: any = (navigator as any).permissions;
            if (perms?.query) {
              const cam = await perms.query({ name: "camera" as PermissionName });
              if (cam.state === "denied") {
                toast.error("Camera blocked. Settings → Apps → SunoSathi → Permissions → Camera ON karo.", { duration: 8000 });
                // Keep going — webrtc.start() will fall back to audio-only and
                // the listener can still answer with voice. UI shows the toast.
              }
            }
          } catch { /* Permissions API unsupported — fall through */ }

          let probe: MediaStream | null = null;
          try {
            probe = await navigator.mediaDevices.getUserMedia({
              video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
              audio: true,
            });
          } catch (err: any) {
            const name = err?.name || "";
            if (name === "NotAllowedError" || name === "SecurityError") {
              toast.error("Camera permission deny ho gaya. Settings → Permissions → Camera ON karke retry karo.", { duration: 9000 });
            } else if (name === "NotFoundError" || name === "OverconstrainedError") {
              toast.error("Camera nahi mila is phone pe. Audio Call hi possible hai.");
            } else if (name === "NotReadableError") {
              toast.error("Camera kisi aur app me use ho raha hai. Wo app band karo phir try karo.");
            } else {
              toast.warning("Camera start nahi ho saka (" + (name || "unknown") + "). Audio only.");
            }
          }
          // Release probe tracks regardless of success — start() must reacquire.
          if (probe) {
            try { probe.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
          }
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
    return () => window.removeEventListener("ss:session_ended", onSessionEnded);
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
    </div>
  );
}
