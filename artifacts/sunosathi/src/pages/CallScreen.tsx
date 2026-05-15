import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useStartChatSession, useEndChatSession, useGetWallet, getGetWalletQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { PhoneOff, Mic, MicOff, Volume2, VolumeX, ArrowLeft, ShieldAlert, X, ChevronRight, Wifi, WifiOff, Video, VideoOff } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useWebRTC } from "@/hooks/useWebRTC";
import { startOutgoingRing, playLowBalanceBeep } from "@/lib/ringtone";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

interface CallScreenProps {
  listenerId: string;
  listenerName: string;
  listenerPhoto: string;
  pricePerMinute: number;
  onClose: () => void;
  video?: boolean;
}

const FREE_TRIAL_SECONDS = 30;
const RING_TIMEOUT_SECONDS = 20;

const REPORT_CATEGORIES = [
  { id: "rude_abusive",       label: "Rude or Abusive",      emoji: "😡", desc: "Insulting, hostile, or disrespectful behaviour" },
  { id: "sexual_harassment",  label: "Sexual Harassment",     emoji: "🚨", desc: "Inappropriate or unwanted sexual remarks" },
  { id: "fake_caller",        label: "Fake / Misleading",     emoji: "🎭", desc: "Pretending to need help; wasting time" },
];

export default function CallScreen({ listenerId, listenerName, listenerPhoto, pricePerMinute, onClose, video = false }: CallScreenProps) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  // ── Auto-redirect helper ─────────────────────────────────────────────────────
  // Call this instead of raw onClose so the user always lands on /home after a call
  const goHome = (delayMs = 800) => {
    setTimeout(() => {
      onClose();
      setLocation(`${BASE}/home`);
    }, delayMs);
  };
  const { data: wallet } = useGetWallet();
  const [phase, setPhase] = useState<"connecting" | "ringing" | "trial" | "billing" | "ended">("connecting");
  const [ringCountdown, setRingCountdown] = useState(RING_TIMEOUT_SECONDS);
  const [elapsed, setElapsed] = useState(0);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [balanceRupees, setBalanceRupees] = useState<number>(0);
  const [billedMinutes, setBilledMinutes] = useState(1);
  const [endReason, setEndReason] = useState<string>("Call ended");
  const [wasConnected, setWasConnected] = useState(false);
  const [endedSessionId, setEndedSessionId] = useState<string | null>(null);

  // Report modal state
  const [reportOpen, setReportOpen] = useState(false);
  const [reportPhase, setReportPhase] = useState<"choose" | "category">("choose");
  const [reportMode, setReportMode] = useState<"continue" | "end" | null>(null);
  const [submittingReport, setSubmittingReport] = useState(false);

  const startSession = useStartChatSession();
  const endSession   = useEndChatSession();
  const timerRef       = useRef<ReturnType<typeof setInterval> | null>(null);
  const ringTimerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const ringTimeoutRef = useRef<ReturnType<typeof setTimeout>  | null>(null);
  const pollRef        = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionIdRef   = useRef<string | null>(null);
  const isEndingRef        = useRef(false);
  const lowBalanceWarnedRef = useRef(false);
  const phaseRef           = useRef<string>("connecting");
  // remoteMediaRef is a hidden <video> element — iOS Safari routes <video playsInline>
  // to earpiece by default, whereas <audio> goes to loudspeaker.
  const remoteMediaRef = useRef<HTMLVideoElement | null>(null);
  const localVideoRef  = useRef<HTMLVideoElement | null>(null);

  // ── WebRTC (initiator — caller side) ────────────────────────────────────────
  const webrtc = useWebRTC({ sessionId, role: "initiator", video });

  // Wire remote stream to <video> element then immediately enforce earpiece.
  // setSinkId("") routes to OS-default (earpiece when mic is active on Android).
  // iOS Safari ignores setSinkId — <video playsInline> already uses earpiece naturally.
  useEffect(() => {
    const el = remoteMediaRef.current;
    if (!el || !webrtc.remoteStream) return;
    el.srcObject = webrtc.remoteStream;
    el.play().catch(() => {}); // autoplay guard
    // Force earpiece immediately (loudspeakerRef starts false → setSinkId(""))
    webrtc.reapplySink(el);
  }, [webrtc.remoteStream]); // eslint-disable-line react-hooks/exhaustive-deps

  // Earphone detection — re-route audio when headphones are plugged/unplugged.
  // reapplySink reads current loudspeakerRef; if earpiece mode is active it
  // will call setSinkId("") which the OS automatically routes through new earphones.
  useEffect(() => {
    const handler = () => webrtc.reapplySink(remoteMediaRef.current);
    navigator.mediaDevices.addEventListener("devicechange", handler);
    return () => navigator.mediaDevices.removeEventListener("devicechange", handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Proximity sensor — auto-switch to earpiece when phone is near ear ────────
  const callActive = phase === "trial" || phase === "billing";

  useEffect(() => {
    if (!callActive) return;
    let sensor: any = null;

    const handleNear = () => {
      // Phone near ear → revert to earpiece (re-apply without toggling)
      // Uses same priority chain as applySinkId in useWebRTC:
      //   "communications" → "earpiece" → "" → "default"
      const el = remoteMediaRef.current;
      if (!el) return;
      const target = el as HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> };
      if (typeof target.setSinkId === "function") {
        target.setSinkId("communications").catch(() =>
          target.setSinkId!("earpiece").catch(() =>
            target.setSinkId!("").catch(() =>
              target.setSinkId!("default").catch(() => {})
            )
          )
        );
      }
    };

    // Generic Sensor API (Chrome Android 67+)
    if ("ProximitySensor" in window) {
      try {
        sensor = new (window as any).ProximitySensor({ frequency: 5 });
        sensor.onreading = () => { if (sensor.near) handleNear(); };
        sensor.start();
      } catch { /* permission denied or not supported */ }
    }
    // Legacy deviceproximity event (Firefox)
    const onProximity = (e: any) => { if (e.near) handleNear(); };
    window.addEventListener("deviceproximity", onProximity);

    return () => {
      try { sensor?.stop?.(); } catch { /* ignore */ }
      window.removeEventListener("deviceproximity", onProximity);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callActive]);

  // Wire local stream to <video> element (self-view for video calls)
  useEffect(() => {
    if (localVideoRef.current && webrtc.localStream) {
      localVideoRef.current.srcObject = webrtc.localStream;
    }
  }, [webrtc.localStream]);

  function clearRingTimers() {
    if (ringTimerRef.current)  clearInterval(ringTimerRef.current);
    if (ringTimeoutRef.current) clearTimeout(ringTimeoutRef.current);
    if (pollRef.current)       clearInterval(pollRef.current);
  }

  // Transition from ringing → trial once listener accepts
  function transitionToActive() {
    clearRingTimers();
    phaseRef.current = "trial";
    setPhase("trial");
    setElapsed(0);
    setBilledMinutes(1);
    setBalanceRupees(wallet?.balanceInRupees ?? 0);
    setWasConnected(true);
    queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
    // ── Start real WebRTC audio ──────────────────────────────────────────────
    webrtc.start();
  }

  // Handle ring-timeout (20 sec no answer)
  async function handleRingTimeout() {
    if (isEndingRef.current || phaseRef.current !== "ringing") return;
    isEndingRef.current = true;
    clearRingTimers();
    const sid = sessionIdRef.current;
    if (sid) {
      try {
        await fetch(`${BASE}/api/chat/sessions/${sid}/ring-timeout`, {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
        });
      } catch { /* best effort */ }
    }
    setEndReason("No answer — listener unavailable.");
    phaseRef.current = "ended";
    setPhase("ended");
    toast.error("No answer — listener unavailable.");
    goHome(800);
  }

  // Poll session status every 2 s while ringing
  async function pollSessionStatus(sid: string) {
    if (phaseRef.current !== "ringing") return;
    try {
      const res = await fetch(`${BASE}/api/chat/sessions/${sid}`, { credentials: "include" });
      if (!res.ok) return;
      const data = await res.json();
      if (phaseRef.current !== "ringing") return;
      if (data.status === "active") {
        transitionToActive();
      } else if (data.status === "declined" || data.status === "missed" || data.status === "ended") {
        clearRingTimers();
        isEndingRef.current = true;
        setEndReason("Call ended.");
        phaseRef.current = "ended";
        setPhase("ended");
        goHome(800);
      }
    } catch { /* ignore */ }
  }

  useEffect(() => {
    startSession.mutate(
      { data: { listenerId, kind: video ? "video_call" : "call" } },
      {
        onSuccess: (data) => {
          setSessionId(data.id);
          sessionIdRef.current = data.id;
          phaseRef.current = "ringing";
          setPhase("ringing");
          setRingCountdown(RING_TIMEOUT_SECONDS);

          ringTimerRef.current = setInterval(() => {
            setRingCountdown((c) => Math.max(0, c - 1));
          }, 1000);
          ringTimeoutRef.current = setTimeout(() => handleRingTimeout(), RING_TIMEOUT_SECONDS * 1000);
          pollRef.current = setInterval(() => pollSessionStatus(data.id), 2000);
        },
        onError: (err: any) => {
          toast.error(err?.data?.error || "Could not connect the call.");
          onClose();
        },
      }
    );
    return () => {
      clearRingTimers();
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // SSE-dispatched call events (faster than polling)
  useEffect(() => {
    const onAccepted = (e: Event) => {
      const ev = e as CustomEvent<{ sessionId: string }>;
      if (ev.detail.sessionId === sessionIdRef.current && phaseRef.current === "ringing") {
        transitionToActive();
      }
    };
    const onDeclined = (e: Event) => {
      const ev = e as CustomEvent<{ sessionId: string }>;
      if (ev.detail.sessionId === sessionIdRef.current && phaseRef.current === "ringing") {
        clearRingTimers();
        isEndingRef.current = true;
        phaseRef.current = "ended";
        setPhase("ended");
        setEndReason("Listener unavailable right now.");
        goHome(1000);
      }
    };
    const onMissed = (e: Event) => {
      const ev = e as CustomEvent<{ sessionId: string }>;
      if (ev.detail.sessionId === sessionIdRef.current && phaseRef.current === "ringing") {
        clearRingTimers();
        isEndingRef.current = true;
        phaseRef.current = "ended";
        setPhase("ended");
        goHome(800);
      }
    };
    window.addEventListener("ss:call_accepted", onAccepted);
    window.addEventListener("ss:call_declined", onDeclined);
    window.addEventListener("ss:call_missed",   onMissed);
    return () => {
      window.removeEventListener("ss:call_accepted", onAccepted);
      window.removeEventListener("ss:call_declined", onDeclined);
      window.removeEventListener("ss:call_missed",   onMissed);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Outgoing ring — plays while waiting for listener to pick up
  useEffect(() => {
    if (phase !== "ringing") return;
    let stop: (() => void) | null = null;
    try { stop = startOutgoingRing(); } catch { /* autoplay may be blocked */ }
    return () => stop?.();
  }, [phase]);

  // Auto-enable camera for video calls when call becomes active
  useEffect(() => {
    if (!video) return;
    if (phase !== "trial" && phase !== "billing") return;
    if (webrtc.isCameraEnabled) return;
    webrtc.enableCamera();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video, phase]);

  // Per-minute billing tick
  const tickMinute = async (sid: string) => {
    try {
      const res = await fetch(`${BASE}/api/chat/sessions/${sid}/tick`, {
        method: "POST", credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.autoEnded) {
          toast.error("Wallet balance exhausted — call ended.");
          // handleEndCall stops WebRTC + signals backend + redirects home
          handleEndCall(true);
        }
        return;
      }
      setBalanceRupees(data.balanceInRupees);
      setBilledMinutes(data.billedMinutes);
      // Low balance warning — when ≤ 2 minutes remaining
      if (!lowBalanceWarnedRef.current && data.balanceInRupees <= pricePerMinute * 2) {
        lowBalanceWarnedRef.current = true;
        try { playLowBalanceBeep(); } catch { /* ignore */ }
        toast.warning("⚠️ Sirf 2 minute bacha hai! Abhi recharge karo.");
      }
      queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
    } catch { /* ignore */ }
  };

  useEffect(() => {
    if (phase !== "trial" && phase !== "billing") return;
    timerRef.current = setInterval(() => {
      setElapsed((s) => {
        const next = s + 1;
        if (phase === "trial" && next >= FREE_TRIAL_SECONDS) setPhase("billing");
        if (phase === "billing" && next % 60 === 0 && sessionIdRef.current) tickMinute(sessionIdRef.current);
        return next;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const handleEndCall = (autoEnd = false) => {
    if (isEndingRef.current) return;
    isEndingRef.current = true;
    webrtc.stop();
    clearRingTimers();
    if (timerRef.current) clearInterval(timerRef.current);
    phaseRef.current = "ended";
    setPhase("ended");

    const sid = sessionIdRef.current;
    if (sid) {
      endSession.mutate(
        { id: sid },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });
            toast.success(autoEnd ? "Wallet exhausted — call ended." : "Call ended.");
            setEndedSessionId(sid);
            goHome(800);
          },
          onError: () => goHome(1000),
        }
      );
    } else {
      goHome(800);
    }
  };

  const handleSubmitReport = async (category: string) => {
    const sid = sessionIdRef.current;
    setSubmittingReport(true);
    try {
      const res = await fetch(`${BASE}/api/safety/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          sessionId: sid,
          reportedListenerId: listenerId,
          category,
        }),
      });
      const data = await res.json();
      if (!res.ok && res.status !== 409) throw new Error(data.error || "Failed");
      toast.success("Thank you — your report has been recorded.");
    } catch {
      toast.error("Report could not be submitted. Please contact support.");
    } finally {
      setSubmittingReport(false);
      setReportOpen(false);
      setReportPhase("choose");
      setReportMode(null);
    }
    if (reportMode === "end") handleEndCall();
  };

  const openReport = () => { setReportPhase("choose"); setReportMode(null); setReportOpen(true); };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, "0");
    const s = (secs % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  const trialSecsLeft = Math.max(0, FREE_TRIAL_SECONDS - elapsed);
  const billedSecs    = phase === "billing" ? elapsed - FREE_TRIAL_SECONDS : 0;
  const costSoFar     = ((billedSecs / 60) * pricePerMinute).toFixed(2);
  const isActive      = phase === "trial" || phase === "billing";

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-between bg-gradient-to-b from-gray-900 via-slate-900 to-black text-white select-none">
      {/*
        Remote media element — always a <video> NOT <audio>:
        • iOS Safari: <video playsInline> routes audio to earpiece by default
        • Android Chrome: setSinkId() handles routing (see toggleSpeaker)
        • When video call is active and remote has video, it becomes full-screen
      */}
      <video
        ref={remoteMediaRef}
        autoPlay
        playsInline
        style={{
          position: "absolute", inset: 0,
          width: "100%", height: "100%",
          objectFit: "cover", zIndex: 1,
          // display:none still plays audio — only hidden visually for audio-only calls
          display: video && webrtc.hasRemoteVideo && isActive ? "block" : "none",
        }}
      />

      {/* Local self-view pip — only shown after user explicitly enables camera */}
      {video && isActive && webrtc.isCameraEnabled && webrtc.localStream && (
        <div className="absolute bottom-40 right-4 z-20 w-24 h-32 rounded-2xl overflow-hidden border-2 border-white/30 shadow-xl bg-black">
          <video ref={localVideoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
          {webrtc.isVideoOff && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/80">
              <span className="text-white/60 text-xs">Cam off</span>
            </div>
          )}
        </div>
      )}

      {/* ── Top bar ──────────────────────────────────────────────────────────── */}
      <div className="w-full flex items-center justify-between px-5 pt-safe pt-4">
        <button onClick={() => handleEndCall()} className="p-2 rounded-full bg-white/10 backdrop-blur">
          <ArrowLeft className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2">
          {/* WebRTC connection indicator */}
          {isActive && (
            <div className={cn(
              "flex items-center gap-1.5 rounded-full px-2.5 py-1",
              webrtc.status === "reconnecting"
                ? "bg-orange-500/20 border border-orange-500/30"
                : "bg-white/10"
            )}>
              {webrtc.status === "connected"
                ? <Wifi className="w-3 h-3 text-green-400" />
                : webrtc.status === "reconnecting"
                ? <WifiOff className="w-3 h-3 text-orange-400 animate-pulse" />
                : <WifiOff className="w-3 h-3 text-yellow-400 animate-pulse" />}
              <span className="text-[10px] text-white/50">
                {webrtc.status === "connected"
                  ? "Live"
                  : webrtc.status === "reconnecting"
                  ? "Reconnecting…"
                  : "Connecting…"}
              </span>
            </div>
          )}

          {isActive && (
            <button
              onClick={openReport}
              className="p-2 rounded-full bg-white/10 backdrop-blur flex items-center gap-1.5 text-xs text-white/70 hover:bg-red-500/20 hover:text-red-300 transition-colors"
              title="Report or emergency"
            >
              <ShieldAlert className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* ── Caller info ───────────────────────────────────────────────────────── */}
      <div className="flex flex-col items-center gap-5 mt-6">
        <div className="relative">
          {isActive && <span className="absolute inset-0 rounded-full animate-ping bg-green-500/30" />}
          {phase === "ringing" && (
            <span className="absolute inset-0 rounded-full animate-ping bg-violet-500/30" style={{ animationDuration: "1.5s" }} />
          )}
          <img src={listenerPhoto} alt={listenerName} className="w-36 h-36 rounded-full object-cover border-4 border-white/20 shadow-2xl" />
        </div>

        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight">{listenerName}</h1>

          {phase === "connecting" && (
            <p className="text-white/60 mt-2 text-lg animate-pulse">Connecting…</p>
          )}
          {phase === "ringing" && (
            <div className="mt-2 text-center">
              <p className="text-violet-300 text-lg animate-pulse">Calling…</p>
              <p className="text-white/40 text-sm mt-1">{listenerName} · {ringCountdown}s</p>
            </div>
          )}
          {phase === "trial" && (
            <div className="mt-2 text-center">
              <span className="inline-block bg-green-500/20 border border-green-500/40 text-green-400 text-sm font-semibold px-4 py-1 rounded-full">
                Free trial — {formatTime(trialSecsLeft)} left
              </span>
              <p className="text-white/50 text-sm mt-2">{formatTime(elapsed)}</p>
            </div>
          )}
          {phase === "billing" && (
            <div className="mt-2 text-center space-y-1">
              <p className="text-white/80 text-xl font-mono tracking-widest">{formatTime(elapsed)}</p>
              <p className="text-white/50 text-sm">₹{costSoFar} charged · ₹{pricePerMinute}/min</p>
              <p className="text-yellow-400 text-xs font-medium">Balance: ₹{balanceRupees.toFixed(2)}</p>
              {balanceRupees <= pricePerMinute * 2 && (
                <p className="text-orange-400 text-xs font-semibold animate-pulse">
                  ⚠️ Sirf ~{Math.floor(balanceRupees / pricePerMinute)} min bacha — Recharge karo!
                </p>
              )}
              <p className="text-white/30 text-[10px]">
                {video ? "Listener earns ₹5/min · Platform ₹7/min" : "You earn ₹2/min · Platform ₹4/min"}
              </p>
            </div>
          )}
          {phase === "ended" && (
            <div className="mt-3 flex flex-col items-center gap-2">
              <p className="text-white/60 text-base">{endReason}</p>
              <p className="text-white/30 text-xs animate-pulse">Returning to home…</p>
            </div>
          )}
        </div>

        {/* Video permission notice — prompt user before camera starts */}
        {video && (phase === "ringing" || phase === "connecting") && (
          <div className="mx-6 bg-violet-500/15 border border-violet-500/30 rounded-2xl px-5 py-3 text-center max-w-xs">
            <p className="text-violet-200 text-sm font-medium">📷 Video Call</p>
            <p className="text-violet-300/70 text-xs mt-1">
              Jab call connect ho, browser camera ki permission maangega — Allow karna na bhulen.
            </p>
          </div>
        )}

        {/* Permission error banner */}
        {webrtc.permissionError && isActive && (
          <div className="mx-6 bg-red-500/20 border border-red-500/30 rounded-2xl px-5 py-3 text-center max-w-xs">
            <p className="text-red-300 text-sm font-medium">🎤 {webrtc.permissionError}</p>
            <p className="text-red-400/60 text-xs mt-1">Go to browser Settings → allow Microphone.</p>
          </div>
        )}

        {/* Mic active indicator */}
        {webrtc.status === "connected" && !webrtc.isMuted && isActive && (
          <div className="flex items-center gap-2 bg-green-500/20 border border-green-500/30 rounded-full px-4 py-1.5">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-xs text-green-300 font-medium">Mic active · real audio</span>
          </div>
        )}
        {webrtc.status === "connected" && webrtc.isMuted && isActive && (
          <div className="flex items-center gap-2 bg-white/10 rounded-full px-4 py-1.5">
            <MicOff className="w-3 h-3 text-white/50" />
            <span className="text-xs text-white/50">Muted</span>
          </div>
        )}
      </div>

      {/* ── Controls ─────────────────────────────────────────────────────────── */}
      <div className="w-full px-10 pb-16 pb-safe space-y-6">
        {isActive && (
          <div className="flex justify-center gap-8 flex-wrap">
            {/* Mute */}
            <button
              onClick={webrtc.toggleMute}
              className={cn("flex flex-col items-center gap-2", webrtc.isMuted ? "opacity-100" : "opacity-70")}
            >
              <span className={cn(
                "w-16 h-16 rounded-full flex items-center justify-center transition-colors",
                webrtc.isMuted ? "bg-white/20 border-2 border-white/40" : "bg-white/10"
              )}>
                {webrtc.isMuted ? <MicOff className="w-7 h-7" /> : <Mic className="w-7 h-7" />}
              </span>
              <span className="text-xs text-white/60">{webrtc.isMuted ? "Unmute" : "Mute"}</span>
            </button>

            {/* Speaker toggle — earpiece ↔ loudspeaker.
                State lives in webrtc.isLoudspeaker; no local mirror needed.
                toggleSpeaker() uses enumerateDevices() on Android Chrome
                and is a no-op on iOS Safari (earpiece = default for <video playsInline>). */}
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

            {/* Camera toggle — video calls only. Camera starts OFF for privacy;
                user must tap this to share their face with the listener. */}
            {video && (
              <button
                onClick={() => {
                  if (!webrtc.isCameraEnabled) {
                    webrtc.enableCamera();
                  } else {
                    webrtc.toggleVideo();
                  }
                }}
                className={cn(
                  "flex flex-col items-center gap-2",
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
                  {!webrtc.isCameraEnabled ? "Cam Off" : webrtc.isVideoOff ? "Cam Off" : "Cam On"}
                </span>
              </button>
            )}
          </div>
        )}

        <div className="flex justify-center">
          <button
            onClick={() => handleEndCall()}
            disabled={phase === "ended"}
            className={cn(
              "w-20 h-20 rounded-full flex items-center justify-center transition-all disabled:opacity-40",
              phase === "ringing"
                ? "bg-red-500/70 hover:bg-red-500 shadow-[0_0_20px_rgba(239,68,68,0.3)]"
                : "bg-red-500 hover:bg-red-600 active:scale-95 shadow-[0_0_30px_rgba(239,68,68,0.5)]"
            )}
          >
            <PhoneOff className="w-8 h-8 text-white" />
          </button>
        </div>

        {phase === "connecting" && <p className="text-center text-white/40 text-xs">Please wait while we connect your call</p>}
        {phase === "ringing"    && <p className="text-center text-white/40 text-xs">Tap the red button to cancel</p>}
        {phase === "trial"      && <p className="text-center text-white/40 text-xs">First {FREE_TRIAL_SECONDS}s free, then ₹{pricePerMinute}/min</p>}
      </div>

      {/* ── Report / Emergency Overlay ───────────────────────────────────────── */}
      {reportOpen && (
        <div className="absolute inset-0 z-10 flex flex-col justify-end bg-black/70 backdrop-blur-sm">
          <div className="bg-gray-900 border border-white/10 rounded-t-3xl p-6 mx-0 space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-red-400" />
                <p className="font-bold text-white">
                  {reportPhase === "choose" ? "Safety & Emergency" : "What happened?"}
                </p>
              </div>
              <button
                onClick={() => { setReportOpen(false); setReportPhase("choose"); setReportMode(null); }}
                className="p-1.5 rounded-full bg-white/10"
              >
                <X className="w-4 h-4 text-white/70" />
              </button>
            </div>

            {reportPhase === "choose" && (
              <div className="space-y-3">
                <p className="text-sm text-white/60">Do you feel unsafe or want to report this listener?</p>
                <button
                  onClick={() => { setReportMode("end"); setReportPhase("category"); }}
                  className="w-full flex items-center justify-between p-4 rounded-2xl bg-red-500/15 border border-red-500/30 text-left"
                >
                  <div>
                    <p className="font-semibold text-red-300 text-sm">⛔ End Call &amp; Report</p>
                    <p className="text-xs text-white/50 mt-0.5">End immediately and file a report</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-red-400 shrink-0" />
                </button>
                <button
                  onClick={() => { setReportMode("continue"); setReportPhase("category"); }}
                  className="w-full flex items-center justify-between p-4 rounded-2xl bg-white/5 border border-white/10 text-left"
                >
                  <div>
                    <p className="font-semibold text-white/80 text-sm">🔇 Stay &amp; Report Quietly</p>
                    <p className="text-xs text-white/50 mt-0.5">Report without ending the call</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-white/40 shrink-0" />
                </button>
              </div>
            )}

            {reportPhase === "category" && (
              <div className="space-y-3">
                <p className="text-sm text-white/60">Select the reason for your report:</p>
                {REPORT_CATEGORIES.map(cat => (
                  <button
                    key={cat.id}
                    onClick={() => handleSubmitReport(cat.id)}
                    disabled={submittingReport}
                    className="w-full flex items-start gap-3 p-4 rounded-2xl bg-white/5 border border-white/10 text-left hover:bg-white/10 transition-colors disabled:opacity-50"
                  >
                    <span className="text-xl shrink-0">{cat.emoji}</span>
                    <div>
                      <p className="font-semibold text-sm text-white">{cat.label}</p>
                      <p className="text-xs text-white/50 mt-0.5">{cat.desc}</p>
                    </div>
                  </button>
                ))}
                {submittingReport && (
                  <p className="text-center text-xs text-white/50 animate-pulse">Submitting report…</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
