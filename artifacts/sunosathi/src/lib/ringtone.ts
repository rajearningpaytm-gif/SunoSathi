/**
 * Soothing synthesised ringtone using the Web Audio API.
 * Produces a repeating lavender-themed bell pattern: A4 → E5 → A5
 * No external audio file required.
 */
let _ctx: AudioContext | null = null;

function ctx(): AudioContext {
  if (!_ctx || _ctx.state === 'closed') {
    _ctx = new AudioContext();
  }
  return _ctx;
}

function bell(ac: AudioContext, freq: number, startTime: number, peakGain = 0.28) {
  const osc  = ac.createOscillator();
  const gain = ac.createGain();
  osc.connect(gain);
  gain.connect(ac.destination);

  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, startTime);

  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + 1.4);

  osc.start(startTime);
  osc.stop(startTime + 1.4);
}

/**
 * Start the ringtone. Returns a cleanup function that stops it.
 */
export function startRingtone(): () => void {
  const ac = ctx();
  if (ac.state === 'suspended') ac.resume().catch(() => {});

  let active = true;
  let tid: ReturnType<typeof setTimeout> | null = null;

  function ring() {
    if (!active) return;
    const now = ac.currentTime;
    bell(ac, 440,  now,        0.25);   // A4
    bell(ac, 659,  now + 0.35, 0.20);   // E5
    bell(ac, 880,  now + 0.65, 0.15);   // A5
    tid = setTimeout(() => { if (active) ring(); }, 2600);
  }

  ring();

  return () => {
    active = false;
    if (tid !== null) clearTimeout(tid);
  };
}
