import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { chatSessionsTable, listenersTable } from "@workspace/db";
import { eq } from "@workspace/db";

const router: IRouter = Router();

// ── In-memory WebRTC signaling store ─────────────────────────────────────────
// Ephemeral — signals only needed during call setup (offer/answer/ICE)
// Cleaned up after 10 minutes
interface Signal {
  type: string;
  data: unknown;
  ts: number;
}
interface Bucket {
  forUser: Signal[];
  forListener: Signal[];
  createdAt: number;
}
const store = new Map<string, Bucket>();

function getBucket(sessionId: string): Bucket {
  if (!store.has(sessionId)) {
    store.set(sessionId, { forUser: [], forListener: [], createdAt: Date.now() });
  }
  return store.get(sessionId)!;
}

// Cleanup stale buckets every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [key, bucket] of store.entries()) {
    if (bucket.createdAt < cutoff) store.delete(key);
  }
}, 5 * 60 * 1000);

// ── POST /api/webrtc/sessions/:id/signal ─────────────────────────────────────
// Push a WebRTC signal (offer / answer / ice-candidate) for the OTHER party.
router.post("/webrtc/sessions/:id/signal", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { id } = req.params as { id: string };
  const { type, data } = req.body as { type?: string; data?: unknown };
  if (!type || !data) { res.status(400).json({ error: "type and data are required" }); return; }

  const [session] = await db.select().from(chatSessionsTable).where(eq(chatSessionsTable.id, id)).limit(1);
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }

  const [listener] = await db.select().from(listenersTable).where(eq(listenersTable.id, session.listenerId)).limit(1);
  const isUser     = session.userId === req.user.id;
  const isListener = listener?.userId === req.user.id;
  if (!isUser && !isListener) { res.status(403).json({ error: "Forbidden" }); return; }

  const bucket = getBucket(id);
  const signal: Signal = { type, data, ts: Date.now() };

  // Store for the OTHER party
  if (isUser)     bucket.forListener.push(signal);
  else             bucket.forUser.push(signal);

  res.json({ ok: true });
});

// ── GET /api/webrtc/sessions/:id/signals ─────────────────────────────────────
// Poll pending signals for the requesting party — drains & returns them.
router.get("/webrtc/sessions/:id/signals", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { id } = req.params as { id: string };

  const [session] = await db.select().from(chatSessionsTable).where(eq(chatSessionsTable.id, id)).limit(1);
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }

  const [listener] = await db.select().from(listenersTable).where(eq(listenersTable.id, session.listenerId)).limit(1);
  const isUser     = session.userId === req.user.id;
  const isListener = listener?.userId === req.user.id;
  if (!isUser && !isListener) { res.status(403).json({ error: "Forbidden" }); return; }

  const bucket = getBucket(id);
  let signals: Signal[];

  if (isUser) {
    signals = [...bucket.forUser];
    bucket.forUser = [];
  } else {
    signals = [...bucket.forListener];
    bucket.forListener = [];
  }

  res.json(signals);
});

// ── DELETE /api/webrtc/sessions/:id/signals — cleanup on call end ─────────────
router.delete("/webrtc/sessions/:id/signals", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  store.delete(req.params.id as string);
  res.json({ ok: true });
});

// ── GET /api/turn-credentials — fetch ICE servers (STUN + TURN) ───────────────
// CRITICAL: Mobile carriers (Jio / Airtel / Vi) use Carrier-Grade NAT (CGNAT)
// where direct P2P with STUN-only typically FAILS — both peers exchange
// server-reflexive candidates but neither can reach the other. Calls get
// stuck on "Establishing P2P video connection…" forever.
//
// Solution: ALWAYS return TURN servers so packets can relay through them
// when direct P2P is blocked. We use Open Relay Project's free TURN
// (https://openrelayproject.org) as a baseline — works without any account.
// If METERED_SECRET_KEY is set, we PREFER Metered's short-lived creds (more
// reliable + per-call bandwidth) and concatenate with Open Relay as backup.

const TURN_HOST   = process.env.TURN_HOST   || "187.127.170.64";
const TURN_USER   = process.env.TURN_USER   || "sunosathi";
const TURN_SECRET = process.env.TURN_SECRET || "SunoSathi2026StrongPass";

const OPEN_RELAY_TURN: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: `stun:${TURN_HOST}:3478` },
  { urls: `turn:${TURN_HOST}:3478?transport=udp`, username: TURN_USER, credential: TURN_SECRET },
  { urls: `turn:${TURN_HOST}:3478?transport=tcp`, username: TURN_USER, credential: TURN_SECRET },
  { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
];

type RTCIceServer = { urls: string | string[]; username?: string; credential?: string };

router.get("/turn-credentials", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const apiKey = process.env.METERED_SECRET_KEY;
  const domain = process.env.METERED_DOMAIN || "sunosathi.metered.live";

  // No Metered key → return Open Relay only (still works for video/audio calls).
  if (!apiKey) {
    res.json({ iceServers: OPEN_RELAY_TURN });
    return;
  }

  // Metered key present → fetch dynamic creds, then ALSO append Open Relay as
  // backup so a Metered outage doesn't break calls.
  try {
    const r = await fetch(
      `https://${domain}/api/v1/turn/credentials?apiKey=${apiKey}`,
      { signal: AbortSignal.timeout(4000) }
    );
    if (!r.ok) throw new Error(`Metered ${r.status}`);
    const meteredServers = await r.json() as RTCIceServer[];
    res.json({ iceServers: [...meteredServers, ...OPEN_RELAY_TURN] });
  } catch {
    // Metered API failed — fall back to Open Relay (still has TURN for NAT).
    res.json({ iceServers: OPEN_RELAY_TURN });
  }
});

export default router;
