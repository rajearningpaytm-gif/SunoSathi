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

// ── GET /api/turn-credentials — fetch short-lived TURN credentials ────────────
// Secret key stays on server — never exposed to frontend.
// Metered returns short-lived username/credential pairs (~24h TTL) so even if
// a client captures them, they expire quickly.
router.get("/turn-credentials", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const apiKey = process.env.METERED_SECRET_KEY;
  const domain = process.env.METERED_DOMAIN || "sunosathi.metered.live";

  if (!apiKey) {
    // Fallback: only STUN — calls still work on most networks
    res.json({ iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
    ]});
    return;
  }

  try {
    const r = await fetch(
      `https://${domain}/api/v1/turn/credentials?apiKey=${apiKey}`,
      { signal: AbortSignal.timeout(4000) }
    );
    if (!r.ok) throw new Error(`Metered ${r.status}`);
    const iceServers = await r.json();
    res.json({ iceServers });
  } catch {
    // Network hiccup — return STUN-only fallback so call can still attempt
    res.json({ iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun2.l.google.com:19302" },
    ]});
  }
});

export default router;
