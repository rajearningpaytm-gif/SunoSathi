import { useRef, useState, useEffect, useCallback } from "react";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
const API_ORIGIN = (import.meta.env.VITE_API_ORIGIN ?? "").replace(/\/+$/, "");

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
    { urls: "stun:stun3.l.google.com:19302" },
    { urls: "stun:stun4.l.google.com:19302" },
  ],
  bundlePolicy: "max-bundle",
  rtcpMuxPolicy: "require",
  iceCandidatePoolSize: 10,
};

// Opus codec tweaks for voice — 32 kbps, DTX, in-band FEC
function applyOpusParams(sdp: string): string {
  return sdp.replace(/a=fmtp:(\d+) (.*opus.*)/gi, (_m, pt, rest) =>
    `a=fmtp:${pt} ${rest};maxaveragebitrate=32000;stereo=0;sprop-stereo=0;usedtx=1;useinbandfec=1`
  );
}

// Adaptive bitrate — 32 kbps ceiling, high priority for voice
async function applyAdaptiveBitrate(pc: RTCPeerConnection) {
  for (const sender of pc.getSenders()) {
    if (sender.track?.kind !== "audio") continue;
    try {
      const params = sender.getParameters();
      if (!params.encodings?.length) params.encodings = [{}];
      params.encodings[0].maxBitrate = 32_000;
      (params.encodings[0] as any).networkPriority = "high";
      (params.encodings[0] as any).priority = "high";
      await sender.setParameters(params);
    } catch { /* not supported on all browsers */ }
  }
}

// ── Speaker routing helper ────────────────────────────────────────────────────
// Strategy:
//   iOS Safari  — setSinkId not supported; <video playsInline> naturally uses earpiece.
//                 No action taken; hardware Speaker button still works for user.
//
//   Android Chrome — setSinkId IS supported.
//     • Earpiece    → Priority chain:
//                       1. setSinkId("communications") — VoIP earpiece path on Android
//                       2. setSinkId("earpiece")       — Chrome 120+ hint
//                       3. setSinkId("")               — OS default (earpiece on some builds)
//                       4. setSinkId("default")        — last resort
//     • Loudspeaker → setSinkId(speakerDeviceId) found via enumerateDevices()
//                     fallback: setSinkId("speaker") which Chrome recognises as hint
//
//   Future APK (Capacitor / WebView):
//     Use AudioManager.MODE_IN_COMMUNICATION + setWiredHeadsetOn(false) natively.
//     The Capacitor plugin bridge should call audioManager.setSpeakerphoneOn(false)
//     when earpiece is active and setSpeakerphoneOn(true) when loudspeaker is toggled.
async function applySinkId(el: HTMLMediaElement, loudspeaker: boolean) {
  // ── Native Android bridge (APK / Capacitor WebView) ─────────────────────────
  // window.SunoAudio is injected by MainActivity.java via addJavascriptInterface.
  // It directly controls AudioManager — works even when setSinkId is unavailable.
  const nativeAudio = (window as any).SunoAudio;
  if (nativeAudio?.setMode) {
    nativeAudio.setMode(loudspeaker ? "speaker" : "earpiece");
    // Still fall through to setSinkId so the Web API stays consistent on devices
    // where both paths work.
  }

  const target = el as HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> };
  if (typeof target.setSinkId !== "function") return; // iOS Safari — no-op

  try {
    if (loudspeaker) {
      // Try enumerateDevices first — find an output device that is the actual speaker
      const devices = await navigator.mediaDevices.enumerateDevices();
      const outputs = devices.filter((d) => d.kind === "audiooutput");
      // On Android Chrome, outputs may only contain {deviceId:"default",...}.
      // We look for a non-default, non-communications device OR one with "speaker" in label.
      const speakerDev =
        outputs.find((d) => d.label.toLowerCase().includes("speaker") && d.deviceId !== "default") ??
        outputs.find((d) =>
          d.deviceId !== "" && d.deviceId !== "default" && d.deviceId !== "communications"
        );
      if (speakerDev) {
        await target.setSinkId(speakerDev.deviceId);
      } else {
        // Fallback: Chrome treats the string "speaker" as a hint to speakerphone
        await target.setSinkId("speaker").catch(() => {});
      }
    } else {
      // Earpiece routing priority chain:
      // "communications" is the Android VoIP earpiece sink (receiver).
      // "earpiece" is a Chrome 120+ string hint for the phone earpiece.
      // "" / "default" are last-resort fallbacks.
      await target.setSinkId("communications").catch(() =>
        target.setSinkId!("earpiece").catch(() =>
          target.setSinkId!("").catch(() =>
            target.setSinkId!("default").catch(() => {})
          )
        )
      );
    }
  } catch { /* ignore — routing stays as-is */ }
}

export type WebRTCStatus =
  | "idle"
  | "requesting-permissions"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "failed"
  | "ended";

interface UseWebRTCOptions {
  sessionId: string | null;
  role: "initiator" | "answerer";
  /** Whether this session supports video. Camera is NOT enabled automatically —
   *  call enableCamera() when the user explicitly turns it on. */
  video?: boolean;
}

export function useWebRTC({ sessionId, role, video = false }: UseWebRTCOptions) {
  const [status, setStatus]               = useState<WebRTCStatus>("idle");
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [localStream, setLocalStream]     = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream]   = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted]             = useState(false);
  const [isVideoOff, setIsVideoOff]       = useState(false);
  const [isLoudspeaker, setIsLoudspeaker] = useState(false);
  const [hasRemoteVideo, setHasRemoteVideo] = useState(false);
  // Camera starts OFF even for video sessions — user must call enableCamera()
  const [isCameraEnabled, setIsCameraEnabled] = useState(false);

  const pcRef             = useRef<RTCPeerConnection | null>(null);
  const localRef          = useRef<MediaStream | null>(null);
  const remoteRef         = useRef<MediaStream | null>(null);
  const pollRef           = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedRef        = useRef(false);
  const stoppedRef        = useRef(false);
  const sidRef            = useRef(sessionId);
  const reconnectCount    = useRef(0);
  // Ref-tracked loudspeaker state so async callbacks always see current value
  const loudspeakerRef    = useRef(false);

  const MAX_RECONNECT = 3;

  useEffect(() => { sidRef.current = sessionId; }, [sessionId]);

  // ── Signal helpers ──────────────────────────────────────────────────────────
  const pushSignal = useCallback(async (type: string, data: unknown) => {
    if (!sidRef.current) return;
    try {
      await fetch(`${API_ORIGIN}${BASE}/api/webrtc/sessions/${sidRef.current}/signal`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, data }),
      });
    } catch { /* best effort */ }
  }, []);

  const drainSignals = useCallback(async () => {
    if (!sidRef.current || stoppedRef.current) return;
    try {
      const res = await fetch(`${API_ORIGIN}${BASE}/api/webrtc/sessions/${sidRef.current}/signals`, {
        credentials: "include",
      });
      if (!res.ok) return;
      const signals = (await res.json()) as Array<{ type: string; data: unknown }>;

      for (const sig of signals) {
        if (stoppedRef.current) break;
        const pc = pcRef.current;
        if (!pc) continue;

        if (sig.type === "offer") {
          const offerData = sig.data as RTCSessionDescriptionInit;

          // Camera is ALWAYS opt-in — even for video call sessions.
          // The listener (answerer) must tap the camera button explicitly.
          // We never call getUserMedia({video:true}) automatically here.

          await pc.setRemoteDescription(new RTCSessionDescription(offerData));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await pushSignal("answer", answer);

        } else if (sig.type === "answer") {
          if (pc.signalingState === "have-local-offer") {
            await pc.setRemoteDescription(new RTCSessionDescription(sig.data as RTCSessionDescriptionInit));
          }

        } else if (sig.type === "ice-candidate") {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(sig.data as RTCIceCandidateInit));
          } catch { /* stale candidate — ignore */ }
        }
      }
    } catch { /* ignore network errors */ }
  }, [role, pushSignal]);

  // ── ICE restart ─────────────────────────────────────────────────────────────
  const tryIceRestart = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc || stoppedRef.current) return;
    if (reconnectCount.current >= MAX_RECONNECT) { setStatus("failed"); return; }
    reconnectCount.current++;
    setStatus("reconnecting");
    try {
      await pc.restartIce();
      if (role === "initiator") {
        const offer = await pc.createOffer({ iceRestart: true });
        if (offer.sdp) offer.sdp = applyOpusParams(offer.sdp);
        await pc.setLocalDescription(offer);
        await pushSignal("offer", offer);
      }
    } catch { setStatus("failed"); }
  }, [role, pushSignal]);

  // ── Start call ──────────────────────────────────────────────────────────────
  const start = useCallback(async () => {
    if (!sidRef.current || startedRef.current || stoppedRef.current) return;
    startedRef.current = true;
    stoppedRef.current = false;
    reconnectCount.current = 0;
    setStatus("requesting-permissions");
    setPermissionError(null);

    // PRIVACY: Always request AUDIO ONLY at start, regardless of video prop.
    // Camera is only activated when the user explicitly calls enableCamera().
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000,
          channelCount: 1,
          sampleSize: 16,
        },
        video: false, // ← always false; camera = opt-in via enableCamera()
      });
    } catch (err: unknown) {
      const name = (err as DOMException)?.name;
      const msg =
        name === "NotAllowedError"
          ? "Microphone access was denied. Please allow mic access in browser settings."
          : name === "NotFoundError"
          ? "No microphone found. Please connect a mic and try again."
          : "Could not access microphone. Check device settings.";
      setPermissionError(msg);
      setStatus("failed");
      return;
    }

    localRef.current = stream;
    setLocalStream(stream);
    setStatus("connecting");

    const pc = new RTCPeerConnection(RTC_CONFIG);
    pcRef.current = pc;

    // Remote stream (must exist before ontrack is attached)
    const remote = new MediaStream();
    remoteRef.current = remote;
    setRemoteStream(remote);

    // ── ALL event handlers set BEFORE addTrack ─────────────────────────────────
    // onnegotiationneeded fires asynchronously when tracks are added. Setting the
    // handler first guarantees it is attached when the browser fires the event.
    pc.ontrack = (ev) => {
      remote.addTrack(ev.track);
      if (ev.track.kind === "video") setHasRemoteVideo(true);
      setRemoteStream(new MediaStream(remote.getTracks()));
    };

    pc.onicecandidate = (ev) => {
      if (ev.candidate) pushSignal("ice-candidate", ev.candidate.toJSON());
    };

    // Handles the INITIAL offer (initiator) AND renegotiation when enableCamera()
    // adds a video track. Answerer renegotiation is handled explicitly in enableCamera().
    pc.onnegotiationneeded = async () => {
      if (stoppedRef.current || role !== "initiator") return;
      try {
        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: video,
        });
        if (offer.sdp) offer.sdp = applyOpusParams(offer.sdp);
        await pc.setLocalDescription(offer);
        await pushSignal("offer", offer);
      } catch { /* ignore */ }
    };

    pc.onconnectionstatechange = async () => {
      const s = pc.connectionState;
      if (s === "connected") {
        setStatus("connected");
        reconnectCount.current = 0;
        await applyAdaptiveBitrate(pc);
      }
      if (s === "disconnected") {
        if (!stoppedRef.current) {
          setStatus("reconnecting");
          reconnectTimerRef.current = setTimeout(() => {
            if (!stoppedRef.current && pc.connectionState !== "connected") tryIceRestart();
          }, 2000);
        }
      }
      if (s === "failed") {
        if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
        tryIceRestart();
      }
      if (s === "closed") setStatus("ended");
    };

    // Add audio tracks AFTER all handlers are set.
    // For the initiator, this triggers onnegotiationneeded (async) which creates
    // and sends the initial offer — no separate manual createOffer needed.
    // For the answerer, onnegotiationneeded fires but is a no-op (role check);
    // it waits for the initiator's offer via drainSignals.
    for (const track of stream.getTracks()) {
      pc.addTrack(track, stream);
    }

    pollRef.current = setInterval(drainSignals, 400);
    // onnegotiationneeded handles all offer creation — no manual createOffer here.
  }, [role, video, pushSignal, drainSignals, tryIceRestart]);

  // ── Enable camera (user-triggered, first time) ───────────────────────────────
  const enableCamera = useCallback(async () => {
    if (isCameraEnabled || !localRef.current || !pcRef.current) return;
    try {
      const camStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      });
      const videoTrack = camStream.getVideoTracks()[0];
      if (!videoTrack || !pcRef.current || !localRef.current) return;

      localRef.current.addTrack(videoTrack);
      pcRef.current.addTrack(videoTrack, localRef.current);
      // New reference triggers React re-render + localStream useEffects
      const updated = new MediaStream(localRef.current.getTracks());
      localRef.current = updated;
      setLocalStream(updated);
      setIsCameraEnabled(true);
      setIsVideoOff(false);

      // INITIATOR: onnegotiationneeded fires automatically after pcRef.current.addTrack
      // above, triggering a renegotiation offer that carries the new video track.
      //
      // ANSWERER: the onnegotiationneeded handler blocks answerer events (role check)
      // to avoid conflicting with the initiator during initial signaling.
      // We explicitly create a renegotiation offer here so the caller receives our video.
      if (role === "answerer") {
        const pc = pcRef.current;
        if (pc?.signalingState === "stable") {
          try {
            const reOffer = await pc.createOffer({
              offerToReceiveAudio: true,
              offerToReceiveVideo: true,
            });
            if (reOffer.sdp) reOffer.sdp = applyOpusParams(reOffer.sdp);
            await pc.setLocalDescription(reOffer);
            await pushSignal("offer", reOffer);
          } catch { /* renegotiation failed — video won't reach the caller */ }
        }
      }
    } catch {
      // User denied camera or camera unavailable — call continues audio-only
    }
  }, [isCameraEnabled, role, pushSignal]);

  // ── Stop call ───────────────────────────────────────────────────────────────
  const stop = useCallback(() => {
    stoppedRef.current = true;
    if (pollRef.current) clearInterval(pollRef.current);
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    if (pcRef.current) { pcRef.current.close(); pcRef.current = null; }
    if (localRef.current) {
      localRef.current.getTracks().forEach((t) => t.stop());
      localRef.current = null;
    }
    remoteRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setHasRemoteVideo(false);
    setIsCameraEnabled(false);
    setStatus("ended");
    if (sidRef.current) {
      fetch(`${API_ORIGIN}${BASE}/api/webrtc/sessions/${sidRef.current}/signals`, {
        method: "DELETE",
        credentials: "include",
      }).catch(() => {});
    }
  }, []);

  // ── Speaker routing — earpiece ↔ loudspeaker ─────────────────────────────────
  // Uses ref to avoid stale closure in async flow

  /** Re-apply current routing (earpiece or loudspeaker) without toggling.
   *  Call this after attaching srcObject or on devicechange to ensure the
   *  correct sink is active. Safe to call multiple times. */
  const reapplySink = useCallback(async (el: HTMLMediaElement | null) => {
    if (!el) return;
    await applySinkId(el, loudspeakerRef.current);
  }, []); // stable — reads from ref

  const toggleSpeaker = useCallback(async (el: HTMLMediaElement | null) => {
    const next = !loudspeakerRef.current;
    loudspeakerRef.current = next;
    setIsLoudspeaker(next);
    if (el) await applySinkId(el, next);
  }, []); // stable — reads from ref

  // ── Mute / unmute ───────────────────────────────────────────────────────────
  const toggleMute = useCallback(() => {
    if (!localRef.current) return;
    for (const track of localRef.current.getAudioTracks()) {
      track.enabled = !track.enabled;
    }
    setIsMuted((m) => !m);
  }, []);

  // ── Toggle video (requires enableCamera to have been called first) ───────────
  const toggleVideo = useCallback(() => {
    if (!localRef.current) return;
    for (const track of localRef.current.getVideoTracks()) {
      track.enabled = !track.enabled;
    }
    setIsVideoOff((v) => !v);
  }, []);

  useEffect(() => { return () => { stop(); }; }, [stop]);

  return {
    start,
    stop,
    status,
    permissionError,
    localStream,
    remoteStream,
    hasRemoteVideo,
    isMuted,
    isVideoOff,
    isLoudspeaker,
    isCameraEnabled,
    toggleMute,
    toggleVideo,
    toggleSpeaker,
    reapplySink,
    enableCamera,
  };
}
