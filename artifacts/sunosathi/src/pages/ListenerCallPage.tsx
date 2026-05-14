import { useState, useEffect, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { Mic, MicOff, PhoneOff, Wifi, WifiOff, Radio, Volume2, VolumeX, Video, VideoOff } from "lucide-react";
import { useWebRTC } from "@/hooks/useWebRTC";
import { AnonymousAvatar } from "@/components/AnonymousAvatar";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

interface SessionData {
  id: string;
  userId: string;
  userAnonymousName?: string;
  userAvatarSeed?: string;
  status: string;
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
  const webrtc = useWebRTC({ sessionId: sessionId ?? null, role: "answerer", video: true });

  // Fetch session info for caller name/avatar
  useEffect(() => {
    if (!sessionId) return;
    fetch(`${BASE}/api/chat/sessions/${sessionId}`, { credentials: "include" })
      .then((r) => r.json())
      .then(setSession)
      .catch(() => {});
  }, [sessionId]);

  // Start WebRTC as answerer immediately on mount
  useEffect(() => {
    if (!sessionId) return;
    // Small delay to let sessionId propagate into the hook's ref
    const t = setTimeout(() => { webrtc.start(); }, 300);
    return () => clearTimeout(t);
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Wire remote stream to <video> element then immediately enforce earpiece.
  useEffect(() => {
    const el = remoteMediaRef.current;
    if (!el || !webrtc.remoteStream) return;
    el.srcObject = webrtc.remoteStream;
    el.play().catch(() => {});
    webrtc.reapplySink(el); // enforce earpiece (loudspeakerRef=false by default)
  }, [webrtc.remoteStream]); // eslint-disable-line react-hooks/exhaustive-deps

  // Earphone detection — re-route when headphones plugged/unplugged
  useEffect(() => {
    const handler = () => webrtc.reapplySink(remoteMediaRef.current);
    navigator.mediaDevices.addEventListener("devicechange", handler);
    return () => navigator.mediaDevices.removeEventListener("devicechange", handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Wire local stream to self-view <video> when camera is available
  useEffect(() => {
    if (localVideoRef.current && webrtc.localStream) {
      localVideoRef.current.srcObject = webrtc.localStream;
    }
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

  // Auto-enable camera for video sessions when WebRTC connects
  useEffect(() => {
    if (!isVideoSession) return;
    if (webrtc.status !== "connected") return;
    if (webrtc.isCameraEnabled) return;
    webrtc.enableCamera();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVideoSession, webrtc.status]);

  const handleEndCall = async () => {
    if (isEnding) return;
    setIsEnding(true);
    webrtc.stop();
    try {
      await fetch(`${BASE}/api/chat/sessions/${sessionId}/end`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
    } catch { /* best effort */ }
    toast.success("Call ended.");
    setLocation(`${BASE}/home`);
  };

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  const callerName = session?.userAnonymousName ?? "Caller";
  const callerSeed = session?.userAvatarSeed ?? session?.userId ?? "unknown";

  const statusLabel: Record<typeof webrtc.status, string> = {
    idle:                    "Starting…",
    "requesting-permissions":"Requesting mic access…",
    connecting:              "Connecting audio…",
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

          {/* Camera toggle — listener can turn their camera on/off during video calls */}
          {webrtc.isCameraEnabled && (
            <button
              onClick={webrtc.toggleVideo}
              className={cn("flex flex-col items-center gap-2", webrtc.isVideoOff ? "opacity-70" : "opacity-100")}
            >
              <span className={cn(
                "w-16 h-16 rounded-full flex items-center justify-center transition-colors",
                webrtc.isVideoOff ? "bg-white/10" : "bg-violet-500/30 border-2 border-violet-400/50"
              )}>
                {webrtc.isVideoOff ? <VideoOff className="w-7 h-7" /> : <Video className="w-7 h-7 text-violet-300" />}
              </span>
              <span className="text-xs text-white/60">{webrtc.isVideoOff ? "Cam Off" : "Cam On"}</span>
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
