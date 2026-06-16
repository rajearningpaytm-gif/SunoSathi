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
    try { ac.close(); } catch { /* immediately stops all oscillators */ }
  };
}

/**
 * Outgoing ring — plays while the caller waits for the listener to pick up.
 * Returns a cleanup / stop function.
 */
export function startOutgoingRing(): () => void {
  let ac: AudioContext | null = null;
  try { ac = new AudioContext(); } catch { return () => {}; }
  const _ac = ac;
  if (_ac.state === "suspended") _ac.resume().catch(() => {});

  let active = true;
  let tid: ReturnType<typeof setTimeout> | null = null;

  function ring() {
    if (!active) return;
    const now = _ac.currentTime;
    const osc  = _ac.createOscillator();
    const gain = _ac.createGain();
    osc.type = "sine";
    osc.frequency.value = 440;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.22, now + 0.06);
    gain.gain.setValueAtTime(0.22, now + 0.85);
    gain.gain.linearRampToValueAtTime(0, now + 1.0);
    osc.connect(gain);
    gain.connect(_ac.destination);
    osc.start(now);
    osc.stop(now + 1.0);
    tid = setTimeout(() => { if (active) ring(); }, 3000);
  }

  ring();
  return () => {
    active = false;
    if (tid !== null) clearTimeout(tid);
    _ac.close().catch(() => {});
  };
}

/**
 * Three urgent beeps to warn user of low wallet balance (≤ 2 min left).
 * Fire-and-forget — no cleanup needed.
 */
export function playLowBalanceBeep(): void {
  let ac: AudioContext | null = null;
  try { ac = new AudioContext(); } catch { return; }
  const _ac = ac;
  if (_ac.state === "suspended") _ac.resume().catch(() => {});
  const now = _ac.currentTime;
  [0, 0.35, 0.7].forEach((offset) => {
    const osc  = _ac.createOscillator();
    const gain = _ac.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.4, now + offset);
    gain.gain.linearRampToValueAtTime(0, now + offset + 0.25);
    osc.connect(gain);
    gain.connect(_ac.destination);
    osc.start(now + offset);
    osc.stop(now + offset + 0.25);
  });
  setTimeout(() => _ac.close().catch(() => {}), 2000);
}
