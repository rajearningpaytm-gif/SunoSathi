import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  chatSessionsTable,
  chatMessagesTable,
  listenersTable,
  profilesTable,
  transactionsTable,
  reviewsTable,
} from "@workspace/db";
import {
  StartChatSessionBody,
  GetChatSessionParams,
  ListChatMessagesParams,
  SendChatMessageBody,
  SendChatMessageParams,
  EndChatSessionParams,
} from "@workspace/api-zod";
import { and, asc, desc, eq, inArray, or } from "@workspace/db";
import { ensureProfile } from "../lib/profile";
import { newId } from "../lib/ids";
import { notifyUser } from "../lib/notifier";
import { sendCallFcm, syncListenerEarningsToRealtimeDB, syncCallStatusToRealtimeDB } from "../lib/firebaseAdmin";
import { logger } from "../lib/logger";

// Helper — non-blocking real-time push of updated listener earnings to Firebase RTDB.
// Used after every per-minute billing event so the Earnings dashboard updates LIVE.
function pushEarningsRealtime(opts: {
  listenerUserId: string;
  earningsBalancePaise: number;
  totalEarningsPaise: number;
  lastCreditPaise: number;
  sessionKind: string;
}): void {
  syncListenerEarningsToRealtimeDB({
    userId:                opts.listenerUserId,
    earningsBalancePaise:  opts.earningsBalancePaise,
    totalEarningsPaise:    opts.totalEarningsPaise,
    lastCreditPaise:       opts.lastCreditPaise,
    sessionKind:           opts.sessionKind,
  }).catch((err) =>
    logger.warn({ err: err?.message, listenerUserId: opts.listenerUserId }, "Listener earnings RTDB sync failed (non-fatal)"),
  );
}

function pushCallStatusRealtime(sessionId: string, status: string): void {
  syncCallStatusToRealtimeDB({ sessionId, status }).catch((err) =>
    logger.warn({ err: err?.message, sessionId }, "Call status RTDB sync failed (non-fatal)"),
  );
}

const router: IRouter = Router();

// ── FLAT PRODUCTION BILLING (locked rates — do NOT use per-listener pricing) ──
// Audio call: user pays ₹6/min  → listener ₹2/min (200p), platform ₹4/min (400p)
// Video call: user pays ₹12/min → listener ₹5/min (500p), platform ₹7/min (700p)
// Chat:       user pays ₹4/min  → listener ₹1.5/min (150p), platform ₹2.5/min (250p)
//   (chat path is currently disabled in the UI but billing kept for safety)
// Welcome bonus: new users start with ₹6 = exactly 1 audio-call minute free.
const AUDIO_CALL_PRICE_PER_MIN = 6;   // ₹6/min user deduction (audio)
const VIDEO_CALL_PRICE_PER_MIN = 12;  // ₹12/min user deduction (video)
const CHAT_PRICE_PER_MIN       = 4;   // ₹4/min user deduction (chat — disabled UI)

const LISTENER_EARN_PAISE = {
  call:       200,  // ₹2/min audio
  video_call: 500,  // ₹5/min video
  chat:       150,  // ₹1.5/min chat
} as const;

// A brand-new user's first minute is funded by their ₹6 welcome bonus.
// For that one free trial minute the listener earns a flat ₹1 (100p).
const WELCOME_MINUTE_EARN_PAISE = 100;

function isCallKind(kind: string): boolean {
  return kind === "call" || kind === "video_call";
}

/** Flat per-minute price in rupees by session kind. Source of truth — used by
 *  start, accept, and tick handlers so every minute charged is consistent. */
function priceForKind(kind: string): number {
  if (kind === "video_call") return VIDEO_CALL_PRICE_PER_MIN;
  if (kind === "call")       return AUDIO_CALL_PRICE_PER_MIN;
  return CHAT_PRICE_PER_MIN;
}

async function buildSessionDto(s: typeof chatSessionsTable.$inferSelect) {
  const [listener] = await db
    .select()
    .from(listenersTable)
    .where(eq(listenersTable.id, s.listenerId))
    .limit(1);
  const [userProfile] = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.userId, s.userId))
    .limit(1);
  const lastMessages = await db
    .select()
    .from(chatMessagesTable)
    .where(eq(chatMessagesTable.sessionId, s.id))
    .orderBy(desc(chatMessagesTable.createdAt))
    .limit(1);
  const reviewRows = await db
    .select()
    .from(reviewsTable)
    .where(eq(reviewsTable.sessionId, s.id))
    .limit(1);
  return {
    id: s.id,
    listenerId: s.listenerId,
    listenerName: listener?.displayName ?? "Listener",
    listenerPhotoUrl: listener?.photoUrl ?? "",
    listenerIsOnline: listener?.isOnline ?? false,
    userId: s.userId,
    userName: userProfile?.anonymousUsername ?? "Friend",
    userAvatarSeed: userProfile?.avatarSeed ?? userProfile?.userId ?? "",
    status: s.status,
    kind: s.kind,
    startedAt: s.startedAt.toISOString(),
    endedAt: s.endedAt ? s.endedAt.toISOString() : null,
    billedMinutes: s.billedMinutes,
    totalCostInRupees: s.totalCostInRupees,
    lastMessagePreview: lastMessages[0]?.body ?? null,
    hasReview: reviewRows.length > 0,
  };
}

router.get("/chat/sessions", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const profile = await ensureProfile(req.user.id);
  let sessions: (typeof chatSessionsTable.$inferSelect)[];
  if (profile.role === "listener") {
    const [listener] = await db.select().from(listenersTable).where(eq(listenersTable.userId, req.user.id)).limit(1);
    if (!listener) { res.json([]); return; }
    sessions = await db.select().from(chatSessionsTable).where(eq(chatSessionsTable.listenerId, listener.id)).orderBy(desc(chatSessionsTable.startedAt)).limit(50);
  } else {
    sessions = await db.select().from(chatSessionsTable).where(eq(chatSessionsTable.userId, req.user.id)).orderBy(desc(chatSessionsTable.startedAt)).limit(50);
  }
  const dtos = await Promise.all(sessions.map(buildSessionDto));
  res.json(dtos);
});

// ── POST /chat/sessions — initiate a new session ──────────────────────────────
// • Chat sessions: activated immediately (no listener accept step needed).
//   First-minute billing happens at creation so messages flow without delay.
// • Call / Video-call sessions: start as "ringing"; billing starts when listener answers.
router.post("/chat/sessions", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = StartChatSessionBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid request" }); return; }

  const profile = await ensureProfile(req.user.id);
  const [listener] = await db.select().from(listenersTable).where(eq(listenersTable.id, parsed.data.listenerId)).limit(1);
  if (!listener || listener.applicationStatus !== "approved") {
    res.status(404).json({ error: "Listener not available" }); return;
  }

  const pricePerMin = priceForKind(parsed.data.kind);
  if (profile.walletBalanceInRupees < pricePerMin) {
    res.status(402).json({ error: `Need at least ₹${pricePerMin} in your wallet to start.` }); return;
  }

  const sessionId = newId("ses");
  const isChatKind = parsed.data.kind === "chat";

  // Chat: create directly as "active" + charge first minute immediately
  // Call/Video: create as "ringing" — billing deferred until listener answers
  const [created] = await db.insert(chatSessionsTable).values({
    id: sessionId,
    userId: req.user.id,
    listenerId: listener.id,
    kind: parsed.data.kind,
    status: isChatKind ? "active" : "ringing",
    billedMinutes: isChatKind ? 1 : 0,
    totalCostInRupees: isChatKind ? pricePerMin : 0,
    lastMessageAt: new Date(),
  }).returning();

  if (!created) { res.status(500).json({ error: "Failed" }); return; }

  if (isChatKind) {
    // Deduct wallet balance for minute 1
    const newBalance = profile.walletBalanceInRupees - pricePerMin;
    await db.update(profilesTable)
      .set({ walletBalanceInRupees: newBalance, updatedAt: new Date() })
      .where(eq(profilesTable.userId, req.user.id));
    await db.insert(transactionsTable).values({
      userId: req.user.id,
      userName: profile.anonymousUsername,
      kind: "chat_charge",
      amountInRupees: -pricePerMin,
      balanceAfter: newBalance,
      description: `Chat with ${listener.displayName} — minute 1`,
      sessionId,
    });
    // Credit listener earnings — happens for EVERY billed minute, including
    // when the user paid using their welcome bonus.
    const earnPaise = LISTENER_EARN_PAISE.chat;
    const newEarningsBalance = listener.earningsBalancePaise + earnPaise;
    const newTotalEarnings   = listener.totalEarningsPaise   + earnPaise;
    await db.update(listenersTable).set({
      earningsBalancePaise: newEarningsBalance,
      totalEarningsPaise:   newTotalEarnings,
    }).where(eq(listenersTable.id, listener.id));
    // Real-time push so listener's earnings dashboard updates immediately.
    pushEarningsRealtime({
      listenerUserId:        listener.userId,
      earningsBalancePaise:  newEarningsBalance,
      totalEarningsPaise:    newTotalEarnings,
      lastCreditPaise:       earnPaise,
      sessionKind:           "chat",
    });
    // System message
    await db.insert(chatMessagesTable).values({
      sessionId,
      senderRole: "system",
      body: `Chat started · ₹${pricePerMin}/min`,
    });
  }

  // Notify listener via SSE (immediate in-app) + FCM (background push)
  notifyUser(listener.userId, {
    type: "new_session",
    sessionId: created.id,
    kind: parsed.data.kind,
    userName: profile.anonymousUsername,
    userAvatarSeed: profile.avatarSeed ?? "",
  });

  if (!isChatKind) {
    pushCallStatusRealtime(created.id, "ringing");
  }

  const fcmToken = (listener as any).fcmToken as string | null | undefined;
  if (fcmToken) {
    sendCallFcm({
      fcmToken,
      sessionId: created.id,
      userName: profile.anonymousUsername,
      kind: parsed.data.kind,
    }).catch(() => {});
  }

  // For chat: also notify the user that chat is already active
  if (isChatKind) {
    notifyUser(req.user.id, { type: "call_accepted", sessionId: created.id });
  }

  res.json(await buildSessionDto(created));
});

// ── POST /chat/sessions/:id/accept — listener accepts the call ────────────────
// Triggers first-minute billing and moves session to "active".
router.post("/chat/sessions/:id/accept", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { id } = req.params as { id: string };
  const [session] = await db.select().from(chatSessionsTable).where(eq(chatSessionsTable.id, id)).limit(1);
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }
  if (session.status !== "ringing") { res.status(409).json({ error: `Session is already ${session.status}` }); return; }

  const [listener] = await db.select().from(listenersTable).where(eq(listenersTable.id, session.listenerId)).limit(1);
  if (!listener || listener.userId !== req.user.id) {
    res.status(403).json({ error: "Forbidden — only the listener can accept" }); return;
  }

  // A brand-new user's first AUDIO minute is their welcome-bonus minute, but we
  // DO NOT deduct anything at accept. Money is only charged once a FULL minute
  // has actually been talked (see the /tick route). Here we only verify the user
  // can afford to START the first minute (₹6, or the free welcome bonus).
  const userProfile = await ensureProfile(session.userId);
  const pricePerMin = priceForKind(session.kind);
  const welcomeAvailable = session.kind === "call" && !userProfile.welcomeBonusUsed;
  if (!welcomeAvailable && userProfile.walletBalanceInRupees < pricePerMin) {
    // Cancel session — user cannot afford even the first minute
    await db.update(chatSessionsTable).set({ status: "ended", endedAt: new Date() }).where(eq(chatSessionsTable.id, id));
    res.status(402).json({ error: "User has insufficient balance" }); return;
  }

  // Add system message only — no auto listener message
  await db.insert(chatMessagesTable).values({
    sessionId: id,
    senderRole: "system",
    body: isCallKind(session.kind)
      ? `${session.kind === "video_call" ? "Video" : "Audio"} call connected · ₹${pricePerMin}/min`
      : `Chat started · ₹${pricePerMin}/min`,
  });

  // Move session to active. billedMinutes stays 0 — no full minute has elapsed
  // yet, so nothing is charged until the first minute completes (in /tick).
  await db.update(chatSessionsTable).set({
    status: "active",
    billedMinutes: 0,
    totalCostInRupees: 0,
    lastMessageAt: new Date(),
  }).where(eq(chatSessionsTable.id, id));

  // Notify user that call was accepted (they can stop polling / proceed)
  notifyUser(session.userId, { type: "call_accepted", sessionId: id });
  pushCallStatusRealtime(id, "active");

  res.json({ ok: true });
});

// ── POST /chat/sessions/:id/decline — listener declines the call ──────────────
router.post("/chat/sessions/:id/decline", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { id } = req.params as { id: string };
  const [session] = await db.select().from(chatSessionsTable).where(eq(chatSessionsTable.id, id)).limit(1);
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }

  // Only decline a ringing session (idempotent if already ended)
  if (session.status !== "ringing") { res.json({ ok: true }); return; }

  const [listener] = await db.select().from(listenersTable).where(eq(listenersTable.id, session.listenerId)).limit(1);
  // Allow the listener OR the service worker (any authenticated user on listener device) to decline
  if (!listener || (listener.userId !== req.user.id && session.userId !== req.user.id)) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  await db.update(chatSessionsTable).set({ status: "declined", endedAt: new Date() }).where(eq(chatSessionsTable.id, id));
  notifyUser(session.userId, { type: "call_declined", sessionId: id });
  pushCallStatusRealtime(id, "declined");

  res.json({ ok: true });
});

// ── POST /chat/sessions/:id/ring-timeout — call unanswered after 20 seconds ──
router.post("/chat/sessions/:id/ring-timeout", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { id } = req.params as { id: string };
  const [session] = await db.select().from(chatSessionsTable).where(eq(chatSessionsTable.id, id)).limit(1);
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }

  // Only the user who initiated the call can trigger a ring-timeout
  if (session.userId !== req.user.id) { res.status(403).json({ error: "Forbidden" }); return; }

  if (session.status !== "ringing") { res.json({ ok: true }); return; }

  await db.update(chatSessionsTable).set({ status: "missed", endedAt: new Date() }).where(eq(chatSessionsTable.id, id));

  // Notify listener that call was missed
  const [listener] = await db.select().from(listenersTable).where(eq(listenersTable.id, session.listenerId)).limit(1);
  if (listener) {
    notifyUser(listener.userId, { type: "call_missed", sessionId: id });
    pushCallStatusRealtime(id, "missed");
  }

  res.json({ ok: true });
});

router.get("/chat/sessions/:id", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = GetChatSessionParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const [session] = await db.select().from(chatSessionsTable).where(eq(chatSessionsTable.id, parsed.data.id)).limit(1);
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }
  const [listener] = await db.select().from(listenersTable).where(eq(listenersTable.id, session.listenerId)).limit(1);
  if (session.userId !== req.user.id && listener?.userId !== req.user.id) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  res.json(await buildSessionDto(session));
});

router.get("/chat/sessions/:id/messages", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = ListChatMessagesParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const [session] = await db.select().from(chatSessionsTable).where(eq(chatSessionsTable.id, parsed.data.id)).limit(1);
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }
  const [listener] = await db.select().from(listenersTable).where(eq(listenersTable.id, session.listenerId)).limit(1);
  if (session.userId !== req.user.id && listener?.userId !== req.user.id) {
    res.status(403).json({ error: "Forbidden" }); return;
  }
  const msgs = await db.select().from(chatMessagesTable).where(eq(chatMessagesTable.sessionId, parsed.data.id)).orderBy(asc(chatMessagesTable.createdAt));
  res.json(msgs.map((m) => ({
    id: String(m.id),
    sessionId: m.sessionId,
    senderRole: m.senderRole,
    body: m.body,
    createdAt: m.createdAt.toISOString(),
  })));
});


router.post("/chat/sessions/:id/messages", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const params = SendChatMessageParams.safeParse(req.params);
  const body = SendChatMessageBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid request" }); return; }

  const [session] = await db.select().from(chatSessionsTable).where(eq(chatSessionsTable.id, params.data.id)).limit(1);
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }
  // Open chat — messaging allowed even after a session ends (e.g. post-call follow-up)

  const [listener] = await db.select().from(listenersTable).where(eq(listenersTable.id, session.listenerId)).limit(1);
  const isUser = session.userId === req.user.id;
  const isListener = listener?.userId === req.user.id;
  if (!isUser && !isListener) { res.status(403).json({ error: "Forbidden" }); return; }

  const senderRole = isUser ? "user" : "listener";
  const [senderProfile] = await db.select().from(profilesTable).where(eq(profilesTable.userId, req.user.id)).limit(1);

  const [created] = await db.insert(chatMessagesTable).values({
    sessionId: session.id,
    senderRole,
    body: body.data.body,
  }).returning();

  await db.update(chatSessionsTable).set({ lastMessageAt: new Date() }).where(eq(chatSessionsTable.id, session.id));

  if (isUser && listener) {
    notifyUser(listener.userId, { type: "new_message", sessionId: session.id, userName: senderProfile?.anonymousUsername ?? "Someone", preview: body.data.body.slice(0, 80) });
  } else if (isListener) {
    notifyUser(session.userId, { type: "new_message", sessionId: session.id, userName: listener?.displayName ?? "Listener", preview: body.data.body.slice(0, 80) });
  }

  if (!created) { res.status(500).json({ error: "Failed" }); return; }
  res.json({ id: String(created.id), sessionId: created.sessionId, senderRole: created.senderRole, body: created.body, createdAt: created.createdAt.toISOString() });
});

// ── POST /chat/sessions/:id/typing — broadcast typing indicator ──────────────
router.post("/chat/sessions/:id/typing", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const { id } = req.params as { id: string };
  const [session] = await db.select().from(chatSessionsTable).where(eq(chatSessionsTable.id, id)).limit(1);
  if (!session) { res.status(404).json({ error: "Not found" }); return; }
  const [listener] = await db.select().from(listenersTable).where(eq(listenersTable.id, session.listenerId)).limit(1);
  const isUser = session.userId === req.user.id;
  const isListener = listener?.userId === req.user.id;
  if (!isUser && !isListener) { res.status(403).json({ error: "Forbidden" }); return; }
  const senderRole = isUser ? "user" : "listener";
  // Notify the other party
  if (isUser && listener) {
    notifyUser(listener.userId, { type: "typing", sessionId: id, senderRole });
  } else if (isListener) {
    notifyUser(session.userId, { type: "typing", sessionId: id, senderRole });
  }
  res.json({ ok: true });
});

// ── POST /chat/sessions/:id/tick — charge 1 more minute ──────────────────────
// Called by the client every 60 seconds while session is active.
router.post("/chat/sessions/:id/tick", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { id } = req.params as { id: string };
  const [session] = await db.select().from(chatSessionsTable).where(eq(chatSessionsTable.id, id)).limit(1);
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }
  if (session.status !== "active") { res.status(409).json({ error: "Session already ended" }); return; }
  if (session.userId !== req.user.id) { res.status(403).json({ error: "Forbidden" }); return; }

  const [listener] = await db.select().from(listenersTable).where(eq(listenersTable.id, session.listenerId)).limit(1);
  if (!listener) { res.status(404).json({ error: "Listener not found" }); return; }
    // Busy check
    // Note: exclude the CURRENT session from busy check (it is itself active)

  const pricePerMin = priceForKind(session.kind);
  const profile = await ensureProfile(req.user.id);

  // A full minute has just elapsed — charge for THAT completed minute now.
  // The new user's very first AUDIO minute is the welcome-bonus minute: it is
  // funded by the ₹6 seed and the listener earns a flat ₹1 for it.
  const isWelcomeMinute = session.kind === "call" && session.billedMinutes === 0 && !profile.welcomeBonusUsed;
  const isBonusMinute = !isWelcomeMinute && (profile.bonusBalanceInRupees ?? 0) >= pricePerMin;

  // Charge the completed minute. Never drive the wallet below zero (the welcome
  // minute is covered by the ₹6 seed; normal minutes were pre-gated already).
  let charge: number;
  let newBalance: number;
  let newBonusBalance: number;
  if (isBonusMinute) {
    charge = pricePerMin;
    newBalance = profile.walletBalanceInRupees;
    newBonusBalance = (profile.bonusBalanceInRupees ?? 0) - charge;
  } else {
    charge = Math.min(pricePerMin, profile.walletBalanceInRupees);
    newBalance = profile.walletBalanceInRupees - charge;
    newBonusBalance = profile.bonusBalanceInRupees ?? 0;
  }
  const newBilledMinutes = session.billedMinutes + 1;
  const newTotalCost = session.totalCostInRupees + charge;

  await db.update(profilesTable).set({ walletBalanceInRupees: newBalance, bonusBalanceInRupees: newBonusBalance, welcomeBonusUsed: profile.welcomeBonusUsed || isWelcomeMinute, updatedAt: new Date() }).where(eq(profilesTable.userId, req.user.id));
  await db.update(chatSessionsTable).set({ billedMinutes: newBilledMinutes, totalCostInRupees: newTotalCost }).where(eq(chatSessionsTable.id, session.id));
  await db.insert(transactionsTable).values({
    userId: req.user.id,
    userName: profile.anonymousUsername,
    kind: isCallKind(session.kind) ? "call_charge" : "chat_charge",
    amountInRupees: -charge,
    balanceAfter: newBalance,
    description: `${isCallKind(session.kind) ? "Call" : "Chat"} with ${listener.displayName} — minute ${newBilledMinutes}${isWelcomeMinute ? " (welcome bonus)" : ""}`,
    sessionId: session.id,
  });

  // Listener earnings for the completed minute: flat ₹1 for the welcome-bonus
  // minute, otherwise the normal flat rate (₹2/min audio).
  const earnPaise = isWelcomeMinute
    ? WELCOME_MINUTE_EARN_PAISE
    : isBonusMinute
      ? 100
      : (LISTENER_EARN_PAISE[session.kind as keyof typeof LISTENER_EARN_PAISE] ?? 150);
  const newEarningsBalance = listener.earningsBalancePaise + earnPaise;
  const newTotalEarnings   = listener.totalEarningsPaise   + earnPaise;
  await db.update(listenersTable).set({
    earningsBalancePaise: newEarningsBalance,
    totalEarningsPaise:   newTotalEarnings,
  }).where(eq(listenersTable.id, listener.id));
  pushEarningsRealtime({
    listenerUserId:        listener.userId,
    earningsBalancePaise:  newEarningsBalance,
    totalEarningsPaise:    newTotalEarnings,
    lastCreditPaise:       earnPaise,
    sessionKind:           session.kind,
  });

  // Gate the NEXT minute: if the user can no longer afford a full minute, end
  // the call now — right after the minute they just paid for. This guarantees a
  // partially-talked minute is never charged.
  if (newBalance < pricePerMin && newBonusBalance < pricePerMin) {
    await db.update(chatSessionsTable).set({ status: "ended", endedAt: new Date() }).where(eq(chatSessionsTable.id, session.id));
    await db.insert(chatMessagesTable).values({ sessionId: session.id, senderRole: "system", body: "Session ended — insufficient wallet balance." });
    pushCallStatusRealtime(session.id, "ended");
    res.status(402).json({ error: "Insufficient balance", autoEnded: true, balanceInRupees: newBalance, billedMinutes: newBilledMinutes, totalCostInRupees: newTotalCost });
    return;
  }

  res.json({
    ok: true,
    balanceInRupees: newBalance,
    billedMinutes: newBilledMinutes,
    totalCostInRupees: newTotalCost,
    listenerEarnedPaise: earnPaise,
  });
});

// ── POST /chat/sessions/:id/end ───────────────────────────────────────────────
router.post("/chat/sessions/:id/end", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = EndChatSessionParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: "Invalid id" }); return; }

  const [session] = await db.select().from(chatSessionsTable).where(eq(chatSessionsTable.id, parsed.data.id)).limit(1);
  if (!session) { res.status(404).json({ error: "Session not found" }); return; }
  const [listener] = await db.select().from(listenersTable).where(eq(listenersTable.id, session.listenerId)).limit(1);
  if (session.userId !== req.user.id && listener?.userId !== req.user.id) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  if (session.status === "ended" || session.status === "declined" || session.status === "missed") {
    res.json(await buildSessionDto(session)); return;
  }

  // If session is still ringing, mark as declined (listener hung up) or missed (user hung up)
  const finalStatus = session.status === "ringing"
    ? (listener?.userId === req.user.id ? "declined" : "missed")
    : "ended";

  const [updated] = await db.update(chatSessionsTable)
    .set({ status: finalStatus, endedAt: new Date() })
    .where(eq(chatSessionsTable.id, session.id))
    .returning();

  if (session.status === "active") {
    await db.insert(chatMessagesTable).values({ sessionId: session.id, senderRole: "system", body: "Session ended. Take care of yourself. 💙" });
  }

  // Notify the other party
  if (finalStatus === "declined" && listener) {
    notifyUser(session.userId, { type: "call_declined", sessionId: session.id });
  } else if (finalStatus === "missed" && listener) {
    notifyUser(listener.userId, { type: "call_missed", sessionId: session.id });
  } else if (finalStatus === "ended" && listener) {
    // Active call ended — notify BOTH parties so call screen closes immediately
    // (whoever didn't initiate the end also needs to know)
    notifyUser(session.userId,   { type: "session_ended", sessionId: session.id });
    notifyUser(listener.userId,  { type: "session_ended", sessionId: session.id });
  }

  pushCallStatusRealtime(session.id, finalStatus);
  res.json(await buildSessionDto(updated ?? session));
});

export default router;
