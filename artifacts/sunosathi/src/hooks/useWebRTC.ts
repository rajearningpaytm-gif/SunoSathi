import { useRef, useState, useEffect, useCallback } from "react";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
import { API_ORIGIN } from "@/lib/apiBase";

// Base RTC config — TURN servers fetched dynamically from server at call start
// so the secret key is never bundled in the APK.
const RTC_BASE: Omit<RTCConfiguration, "iceServers"> = {
  bundlePolicy: "max-bundle",
  rtcpMuxPolicy: "require",
  iceCandidatePoolSize: 10,
};

const STUN_FALLBACK: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
];

// Fetch TURN + STUN credentials from our API server (secret key never in APK).
// Falls back to STUN-only in <4 s if the fetch fails.
async function fetchIceServers(): Promise<RTCIceServer[]> {
  try {
    const r = await fetch(`${API_ORIGIN}${BASE}/api/turn-credentials`, {
      credentials: "include",
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) return STUN_FALLBACK;
    const data = await r.json() as { iceServers: RTCIceServer[] };
    if (Array.isArray(data.iceServers) && data.iceServers.length > 0) return data.iceServers;
  } catch { /* timeout or network error */ }
  return STUN_FALLBACK;
}

// Opus codec tweaks for voice — 40 kbps, DTX OFF (smooth conversation),
// in-band FEC ON (recover from packet loss), minptime=10 (lower latency).
// DTX (Discontinuous Transmission) was causing audible "cuts" / brief silences
// during natural pauses in conversation — Opus would stop sending packets when
// it detected silence, and the remote side's jitter buffer would drain, causing
// the start of the next word to be clipped. Always-on transmission keeps the
// stream smooth even though it adds a tiny bit of bandwidth.
//
// IMPORTANT: SDP fmtp lines do NOT contain the codec name — only rtpmap lines
// do. So we must first parse `a=rtpmap:<pt> opus/48000[/2]` to discover Opus's
// payload type(s), then rewrite (or insert) the matching `a=fmtp:<pt>` line.
const OPUS_PARAMS = "maxaveragebitrate=40000;stereo=0;sprop-stereo=0;usedtx=0;useinbandfec=1;minptime=10;cbr=0";

function applyOpusParams(sdp: string): string {
  const lines = sdp.split(/\r?\n/);
  // Discover all payload types whose rtpmap is opus/48000
  const opusPts = new Set<string>();
  for (const line of lines) {
    const m = /^a=rtpmap:(\d+)\s+opus\/48000/i.exec(line);
    if (m) opusPts.add(m[1]);
  }
  if (opusPts.size === 0) return sdp; // no Opus offered — nothing to do

  const out: string[] = [];
  const handled = new Set<string>();
  for (const line of lines) {
    const f = /^a=fmtp:(\d+)\s+(.*)$/.exec(line);
    if (f && opusPts.has(f[1])) {
      // Merge existing params with our overrides (ours win on conflict)
      const existing = f[2]
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean);
      const ourKeys = new Set(
        OPUS_PARAMS.split(";").map((s) => s.split("=")[0].trim().toLowerCase())
      );
      const kept = existing.filter(
        (kv) => !ourKeys.has(kv.split("=")[0].trim().toLowerCase())
      );
      const merged = [...kept, ...OPUS_PARAMS.split(";")].join(";");
      out.push(`a=fmtp:${f[1]} ${merged}`);
      handled.add(f[1]);
      continue;
    }
    out.push(line);
  }
  // For Opus PTs that had no fmtp line, insert one right after the rtpmap
  for (const pt of opusPts) {
    if (handled.has(pt)) continue;
    const idx = out.findIndex((l) => new RegExp(`^a=rtpmap:${pt}\\s+opus/`, "i").test(l));
    if (idx >= 0) out.splice(idx + 1, 0, `a=fmtp:${pt} ${OPUS_PARAMS}`);
  }
  return out.join("\r\n");
}

// ── Force VP8 video codec on every video transceiver ────────────────────────
// VP8 is the ONE codec every Android device supports in both software and
// hardware paths. H264 profile/level mismatches between OEMs (Xiaomi vs
// Realme vs Samsung etc.) silently fail decode → call connects but remote
// video is a black screen. VP9 has gaps on older Snapdragon SoCs. By
// reordering codec preferences so VP8 comes first, SDP negotiation picks
// VP8 and both phones decode reliably.
//
// Safe to call multiple times; setCodecPreferences is idempotent. No-op on
// browsers that don't support setCodecPreferences (older Safari).
function forceVideoCodecPreference(pc: RTCPeerConnection) {
  try {
    const caps = (RTCRtpReceiver as any).getCapabilities?.("video");
    if (!caps?.codecs) return;
    const vp8 = caps.codecs.filter((c: any) => /vp8/i.test(c.mimeType));
    const others = caps.codecs.filter((c: any) => !/vp8/i.test(c.mimeType));
    const preferred = [...vp8, ...others];
    if (preferred.length === 0) return;
    for (const t of pc.getTransceivers()) {
      const kind = t.sender.track?.kind || t.receiver.track?.kind;
      if (kind && kind !== "video") continue;
      if ((t as any).setCodecPreferences) {
        try { (t as any).setCodecPreferences(preferred); } catch { /* unsupported */ }
      }
    }
  } catch { /* getCapabilities or transceiver iteration failed — best effort */ }
}

// Adaptive bitrate — 40 kbps ceiling (was 32 — bump for smoother voice on
// flaky networks; Opus VBR will use less when conditions are good), high
// priority for voice. Setting contentHint="speech" on the track tells the
// browser to use voice-optimised AGC/AEC tuning.
async function applyAdaptiveBitrate(pc: RTCPeerConnection) {
  for (const sender of pc.getSenders()) {
    if (sender.track?.kind !== "audio") continue;
    try {
      // Voice-tuned content hint — improves automatic gain control & echo
      // cancellation for human speech (vs. music/generic audio).
      (sender.track as MediaStreamTrack & { contentHint?: string }).contentHint = "speech";
    } catch { /* not supported */ }
    try {
      const params = sender.getParameters();
      if (!params.encodings?.length) params.encodings = [{}];
      params.encodings[0].maxBitrate = 40_000;
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

          // For video_call sessions, both peers already acquired their camera
          // in start() and addTrack'd it before signalling — so the answer SDP
          // generated here naturally carries the video m-line back. No manual
          // offerToReceiveVideo flag is needed; createAnswer() reflects the
          // remote SDP's m-lines and our own local tracks.
          //
          // Perfect-negotiation pattern: the answerer is "polite" — if we
          // already have a local offer in flight (collision / glare), we roll
          // back our offer and accept the remote one. The initiator is
          // "impolite" — it ignores incoming offers when its own offer is in
          // flight (the polite peer will adopt ours). This keeps ICE restarts
          // working on flaky networks where both sides may restartIce at once.
          const polite = role === "answerer";
          const offerCollision = pc.signalingState !== "stable";
          if (offerCollision) {
            if (!polite) continue; // impolite peer ignores
            try {
              await pc.setLocalDescription({ type: "rollback" });
            } catch { /* rollback unsupported — best effort */ }
          }

          await pc.setRemoteDescription(new RTCSessionDescription(offerData));
          // Force VP8 BEFORE createAnswer — at this point transceivers from
          // the remote offer exist and can be reordered. This guarantees the
          // answer SDP lists VP8 first, so both peers converge on VP8.
          forceVideoCodecPreference(pc);
          const answer = await pc.createAnswer();
          // Apply Opus tweaks (DTX off, FEC on, 40kbps, minptime=10) to the
          // answer too — without this, the answerer's outbound stream would
          // still have DTX on (default), so the OTHER side hears the cuts.
          if (answer.sdp) answer.sdp = applyOpusParams(answer.sdp);
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

    // ── CRITICAL: lock audio routing to VOIP earpiece BEFORE getUserMedia ──────
    // On Android WebView, if MODE_NORMAL is active when the mic stream starts,
    // the WebRTC remote audio binds to STREAM_MUSIC (loudspeaker) and later
    // setMode("earpiece") calls are silently ignored on many OEM ROMs
    // (Xiaomi/Realme/Vivo). Requesting MODE_IN_COMMUNICATION + audio focus
    // up-front forces the stream onto STREAM_VOICE_CALL = earpiece.
    // This was the root cause of earpiece failing on the seeker (user) side.
    try {
      const nativeAudio = (window as any).SunoAudio;
      if (nativeAudio?.setMode) nativeAudio.setMode("earpiece");
    } catch { /* not on native, ignore */ }

    // ── Acquire audio + (optional) video UP FRONT ─────────────────────────────
    // For video_call sessions we MUST request the camera before signalling so the
    // initial offer/answer SDP carries both m=audio AND m=video lines. If we
    // instead added the video track later via renegotiation, the initiator AND
    // answerer would both try to renegotiate simultaneously after `connected`
    // (CallScreen's auto-enableCamera + ListenerCallPage's auto-enableCamera),
    // hitting an SDP "glare" collision where both peers are in have-local-offer
    // and incoming offers get rejected — net result: video never reaches the
    // other side. Acquiring video at start() avoids the renegotiation entirely.
    //
    // For audio-only sessions, video stays false and camera is never accessed.
    const audioConstraints: MediaTrackConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      sampleRate: 48000,
      channelCount: 1,
      sampleSize: 16,
    };
    const VIDEO_CONSTRAINTS_CHAIN = video
      ? [
          { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 } },
          { facingMode: { ideal: "user" }, width: { ideal: 640 }, height: { ideal: 480 } },
          { width: { ideal: 640 }, height: { ideal: 480 } },
          true,
        ]
      : [false];

    let stream: MediaStream | null = null;
    let lastVideoErr: DOMException | null = null;

    for (const vc of VIDEO_CONSTRAINTS_CHAIN) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: vc as any });
        break;
      } catch (err: unknown) {
        const e = err as DOMException;
        lastVideoErr = e;
        if (e?.name === "NotAllowedError" || e?.name === "SecurityError") break;
        if (e?.name === "NotFoundError") break;
      }
    }

    if (!stream) {
      if (video && lastVideoErr) {
        const n = lastVideoErr.name;
        if (n === "NotAllowedError" || n === "SecurityError") {
          try { window.dispatchEvent(new CustomEvent("webrtc:camera-denied")); } catch { }
        }
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
      } catch (err2: unknown) {
        const name = (err2 as DOMException)?.name;
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
    }

    localRef.current = stream;
    setLocalStream(stream);
    // Mark camera-enabled state for UI (self-view pip, cam toggle button) if
    // a video track was acquired at start. enableCamera() becomes a no-op below.
    if (stream.getVideoTracks().length > 0) {
      setIsCameraEnabled(true);
      setIsVideoOff(false);
    }
    setStatus("connecting");

    // Fetch TURN credentials from server (secret key stays on backend).
    // This runs after mic/camera is ready so there's no extra delay perceived
    // by the user — the spinner is already showing "connecting".
    const iceServers = await fetchIceServers();
    const pc = new RTCPeerConnection({ ...RTC_BASE, iceServers });
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
      if (ev.track.kind === "video") {
        setHasRemoteVideo(true);
        let muteTimer = null;
        ev.track.addEventListener("mute", () => {
          muteTimer = setTimeout(() => {
            if (ev.track.muted) setHasRemoteVideo(false);
          }, 4000);
        });
        ev.track.addEventListener("unmute", () => {
          if (muteTimer) { clearTimeout(muteTimer); muteTimer = null; }
          setHasRemoteVideo(true);
        });
        ev.track.addEventListener("ended", () => {
          if (muteTimer) { clearTimeout(muteTimer); muteTimer = null; }
          setHasRemoteVideo(false);
        });
      }
      // Tune jitter buffer for smoother playback. Slight extra delay (100ms)
      // gives Opus + the jitter buffer time to recover from packet reordering
      // and loss without audible glitches — a much better trade-off for voice
      // calls than minimum-latency playback (which causes choppy audio on
      // mobile networks).
      if (ev.track.kind === "audio") {
        const receiver = ev.receiver as RTCRtpReceiver & { playoutDelayHint?: number };
        try { receiver.playoutDelayHint = 0.1; } catch { /* not supported */ }
      }
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
        // Fire a custom event so pages can re-call .play() on their <video>
        // elements when the peer-connection finishes. Android WebView's
        // autoplay block sometimes only releases after the connection is
        // actually established, so the initial .play() at srcObject-assign
        // time silently fails. This second trigger handles that case.
        try {
          window.dispatchEvent(new CustomEvent("webrtc:connected", {
            detail: { sessionId: sidRef.current },
          }));
        } catch { /* CustomEvent unsupported — ignore */ }
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

    // ── CRITICAL: Force VP8 codec for video transceivers ──────────────────────
    // VP8 is supported by EVERY Android device (software + hardware decoder).
    // H264 hardware profiles vary across OEMs (Xiaomi/Realme/Vivo/Oppo) and
    // cause silent decode failures where the call connects but the remote
    // video is a black screen. VP9 has similar compatibility gaps on older
    // Snapdragon SoCs. Forcing VP8 first eliminates these mismatches at the
    // SDP negotiation level — both peers will agree on VP8 if either one
    // applies this preference.
    forceVideoCodecPreference(pc);

    pollRef.current = setInterval(drainSignals, 400);
    // onnegotiationneeded handles all offer creation — no manual createOffer here.
  }, [role, video, pushSignal, drainSignals, tryIceRestart]);

  // ── Enable camera (user-triggered, first time) ───────────────────────────────
  // Throws a human-readable Error on failure so the caller can show a toast.
  const enableCamera = useCallback(async () => {
    if (isCameraEnabled) return;
    if (!localRef.current || !pcRef.current) {
      throw new Error("Call abhi ready nahi hai — thoda ruko phir try karo.");
    }
    let camStream: MediaStream | null = null;
    let lastErr: any = null;
    for (const vc of [
      { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      { facingMode: { ideal: "user" } },
      { width: { ideal: 640 }, height: { ideal: 480 } },
      true,
    ]) {
      try {
        camStream = await navigator.mediaDevices.getUserMedia({ video: vc as any });
        break;
      } catch (err: any) {
        lastErr = err;
        if (err?.name === "NotAllowedError" || err?.name === "SecurityError") break;
        if (err?.name === "NotFoundError") break;
      }
    }
    if (!camStream) {
      const name = lastErr?.name || "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        throw new Error("Camera block hai. Chrome address bar → Lock icon → Camera → Allow. Realme: Settings → Apps → Chrome → Permissions → Camera → Allow.");
      }
      if (name === "NotFoundError" || name === "OverconstrainedError") {
        throw new Error("Camera nahi mila is device pe.");
      }
      if (name === "NotReadableError") {
        throw new Error("Camera kisi aur app me use ho raha hai — band karo phir try karo.");
      }
      throw new Error("Camera start nahi ho saka (" + (name || "unknown") + ").");
    }
    const videoTrack = camStream.getVideoTracks()[0];
    if (!videoTrack || !pcRef.current || !localRef.current) {
      camStream.getTracks().forEach((t) => t.stop());
      throw new Error("Camera track nahi mila.");
    }

    localRef.current.addTrack(videoTrack);
    pcRef.current.addTrack(videoTrack, localRef.current);
    // Force VP8 on the newly-created video transceiver too, so the
    // renegotiation offer carries VP8-first preference.
    forceVideoCodecPreference(pcRef.current);
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
    //
    // Glare-safe: we wait briefly for signalingState to become "stable" (it may
    // be have-local-offer / have-remote-offer mid-flight). If still unstable
    // after the retry budget, we THROW so the caller can show a real toast
    // (and the user can press the Cam button again to retry manually).
    if (role === "answerer") {
      const pc = pcRef.current;
      // Wait up to ~2 s for signaling to settle into stable, polling 200 ms.
      let waited = 0;
      while (pc && pc.signalingState !== "stable" && waited < 2000) {
        await new Promise((r) => setTimeout(r, 200));
        waited += 200;
      }
      if (!pc || pc.signalingState !== "stable") {
        // Roll back local camera state so UI doesn't lie about being on
        for (const t of localRef.current!.getVideoTracks()) {
          localRef.current!.removeTrack(t);
          t.stop();
        }
        setIsCameraEnabled(false);
        throw new Error("Connection busy — Cam button dabake retry karo.");
      }
      try {
        const reOffer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true,
        });
        if (reOffer.sdp) reOffer.sdp = applyOpusParams(reOffer.sdp);
        await pc.setLocalDescription(reOffer);
        await pushSignal("offer", reOffer);
      } catch (err) {
        // Renegotiation failed — surface a real error so the caller shows a toast.
        // Don't roll back the local track (caller's UI shows their camera on;
        // a retry of enableCamera() will reuse the existing track and retry the
        // renegotiation cleanly).
        throw new Error("Video signal nahi bhej saka — retry karo: " + ((err as Error).message || "unknown"));
      }
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
    // Release VOIP audio focus and restore MODE_NORMAL so the ringer/media
    // streams behave correctly outside the call.
    try {
      const nativeAudio = (window as any).SunoAudio;
      if (nativeAudio?.setMode) nativeAudio.setMode("default");
    } catch { /* ignore */ }
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
