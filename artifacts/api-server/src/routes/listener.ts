import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { listenersTable, profilesTable, withdrawalRequestsTable } from "@workspace/db";
import { eq, desc } from "@workspace/db";
import {
  ApplyAsListenerBody,
  SetOnlineStatusBody,
} from "@workspace/api-zod";
import { ensureProfile, avg100ToFloat } from "../lib/profile";
import { newId } from "../lib/ids";
import { z } from "zod";
import { sendListenerOnlineFcm } from "../lib/firebaseAdmin";
import { and, isNotNull, ne } from "drizzle-orm";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ── Broadcast cooldown ───────────────────────────────────────────────────────
// In-memory rate-limiter so a listener who flips their online toggle on/off
// rapidly does not spam every user with notifications. Window = 2 hours per
// listener. Memory-only is fine: even on a server restart the worst case is
// one extra notification, which is harmless.
const BROADCAST_COOLDOWN_MS = 2 * 60 * 60 * 1000;
const lastBroadcastByListener = new Map<string, number>();

async function broadcastListenerOnline(listener: typeof listenersTable.$inferSelect) {
  try {
    const now = Date.now();
    const last = lastBroadcastByListener.get(listener.id) ?? 0;
    if (now - last < BROADCAST_COOLDOWN_MS) {
      logger.info({ listenerId: listener.id, ageMs: now - last }, "listener_online broadcast skipped (cooldown)");
      return;
    }
    lastBroadcastByListener.set(listener.id, now);

    // Collect FCM tokens for everyone EXCEPT the listener themselves. We want
    // every user (and other listeners — they're potential callers too) to know
    // a new sathi is online.
    const rows = await db
      .select({ token: profilesTable.fcmToken, userId: profilesTable.userId })
      .from(profilesTable)
      .where(
        and(
          isNotNull(profilesTable.fcmToken),
          ne(profilesTable.userId, listener.userId),
        ),
      );
    const tokens = rows
      .map((r) => (r.token ?? "").trim())
      .filter((t) => t.length > 10);
    if (!tokens.length) {
      logger.info({ listenerId: listener.id }, "listener_online broadcast: no tokens");
      return;
    }

    const dead = await sendListenerOnlineFcm({
      tokens,
      listenerId: listener.id,
      listenerName: listener.displayName,
      listenerPhotoUrl: listener.photoUrl,
    });

    // Prune permanently-invalid tokens so future broadcasts shrink naturally.
    if (dead.length) {
      for (const t of dead) {
        await db.update(profilesTable)
          .set({ fcmToken: null })
          .where(eq(profilesTable.fcmToken, t))
          .catch(() => {});
      }
    }
  } catch (err: any) {
    logger.warn({ err: err?.message, listenerId: listener.id }, "broadcastListenerOnline failed");
  }
}

function myListenerDto(l: typeof listenersTable.$inferSelect) {
  return {
    id: l.id,
    userId: l.userId,
    displayName: l.displayName,
    gender: l.gender,
    bio: l.bio,
    skills: l.skills ?? [],
    photoUrl: l.photoUrl,
    applicationStatus: l.applicationStatus,
    rejectionReason: l.rejectionReason,
    isOnline: l.isOnline,
    lastSeenAt: l.lastSeenAt ? l.lastSeenAt.toISOString() : null,
    ratingAverage: avg100ToFloat(l.ratingAverage),
    ratingCount: l.ratingCount,
    audioCallsEnabled: l.audioCallsEnabled,
    videoCallsEnabled: l.videoCallsEnabled,
  };
}

router.get("/listener/me", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const rows = await db.select().from(listenersTable).where(eq(listenersTable.userId, req.user.id)).limit(1);
  if (!rows[0]) { res.status(404).json({ error: "No listener profile" }); return; }
  res.json(myListenerDto(rows[0]));
});

router.post("/listener/apply", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = ApplyAsListenerBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid request" }); return; }
  await ensureProfile(req.user.id);
  // Save display name + photo into profile so listener's ID shows their chosen name & avatar
  // (overwrites the SS-XXXXXX placeholder created at device-signup time).
  // anonymousUsername has a unique index — fall back to "<name>-<suffix>" on clash.
  try {
    await db.update(profilesTable).set({
      role: "listener",
      anonymousUsername: parsed.data.displayName,
      avatarSeed: parsed.data.photoUrl,
      updatedAt: new Date(),
    }).where(eq(profilesTable.userId, req.user.id));
  } catch (e: any) {
    if (e?.code === "23505" || String(e?.message ?? "").includes("unique")) {
      const suffix = req.user.id.slice(-4).toUpperCase();
      await db.update(profilesTable).set({
        role: "listener",
        anonymousUsername: `${parsed.data.displayName}-${suffix}`,
        avatarSeed: parsed.data.photoUrl,
        updatedAt: new Date(),
      }).where(eq(profilesTable.userId, req.user.id));
    } else {
      throw e;
    }
  }

  const existing = await db.select().from(listenersTable).where(eq(listenersTable.userId, req.user.id)).limit(1);
  if (existing[0]) {
    const [updated] = await db.update(listenersTable).set({
      displayName: parsed.data.displayName,
      gender: parsed.data.gender,
      bio: parsed.data.bio,
      skills: parsed.data.skills,
      photoUrl: parsed.data.photoUrl,
      contactNumber: parsed.data.contactNumber ?? null,
      applicationStatus: "pending",
      rejectionReason: null,
      decidedAt: null,
      submittedAt: new Date(),
    }).where(eq(listenersTable.id, existing[0].id)).returning();
    if (!updated) { res.status(500).json({ error: "Failed" }); return; }
    const profileUpdate: Partial<typeof profilesTable.$inferInsert> = { hasOnboarded: true, updatedAt: new Date() };
    if (parsed.data.age !== undefined) profileUpdate.age = parsed.data.age;
    await db.update(profilesTable).set(profileUpdate).where(eq(profilesTable.userId, req.user.id));
    res.json(myListenerDto(updated));
    return;
  }

  const [created] = await db.insert(listenersTable).values({
    id: newId("lst"),
    userId: req.user.id,
    displayName: parsed.data.displayName,
    gender: parsed.data.gender,
    bio: parsed.data.bio,
    skills: parsed.data.skills,
    photoUrl: parsed.data.photoUrl,
    contactNumber: parsed.data.contactNumber ?? null,
    applicationStatus: "pending",
    isOnline: false,
  }).returning();
  if (!created) { res.status(500).json({ error: "Failed" }); return; }
  const profileUpdate2: Partial<typeof profilesTable.$inferInsert> = { hasOnboarded: true, updatedAt: new Date() };
  if (parsed.data.age !== undefined) profileUpdate2.age = parsed.data.age;
  await db.update(profilesTable).set(profileUpdate2).where(eq(profilesTable.userId, req.user.id));
  res.json(myListenerDto(created));
});

router.post("/listener/online", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = SetOnlineStatusBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid request" }); return; }
  const rows = await db.select().from(listenersTable).where(eq(listenersTable.userId, req.user.id)).limit(1);
  const existing = rows[0];
  if (!existing) { res.status(404).json({ error: "No listener profile" }); return; }
  if (existing.applicationStatus !== "approved") { res.status(403).json({ error: "Listener not approved yet" }); return; }
  const [updated] = await db.update(listenersTable).set({ isOnline: parsed.data.isOnline, lastSeenAt: new Date() }).where(eq(listenersTable.id, existing.id)).returning();
  if (!updated) { res.status(500).json({ error: "Failed" }); return; }

  // ── Fire-and-forget broadcast on offline→online transition ─────────────
  // Sends a push to every other user/listener with an FCM token:
  //   "Riya abhi online hai! 💜  Aao baat karein…"
  // Cooldown of 2 hours per listener prevents toggle-spam.
  if (!existing.isOnline && parsed.data.isOnline) {
    void broadcastListenerOnline(updated);
  }

  res.json(myListenerDto(updated));
});

// ── GET /listener/earnings — get earnings balance ─────────────────────────────
router.get("/listener/earnings", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const [listener] = await db.select().from(listenersTable).where(eq(listenersTable.userId, req.user.id)).limit(1);
  if (!listener) { res.status(404).json({ error: "No listener profile" }); return; }
  res.json({
    earningsBalancePaise: listener.earningsBalancePaise,
    totalEarningsPaise: listener.totalEarningsPaise,
    earningsBalanceRupees: listener.earningsBalancePaise / 100,
    totalEarningsRupees: listener.totalEarningsPaise / 100,
  });
});

// ── POST /listener/withdrawal — request a payout ─────────────────────────────
const WithdrawalBody = z.object({
  amountRupees: z.number().int()
    .min(200, "Minimum withdrawal is ₹200")
    .max(2000, "Maximum withdrawal per request is ₹2000"),
  upiId: z.string().min(3).max(100),
});

router.post("/listener/withdrawal", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = WithdrawalBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid request" }); return; }

  const [listener] = await db.select().from(listenersTable).where(eq(listenersTable.userId, req.user.id)).limit(1);
  if (!listener) { res.status(404).json({ error: "No listener profile" }); return; }
  if (listener.applicationStatus !== "approved") { res.status(403).json({ error: "Only approved listeners can withdraw" }); return; }

  const requestedPaise = parsed.data.amountRupees * 100;
  if (requestedPaise > listener.earningsBalancePaise) {
    res.status(400).json({ error: `Insufficient earnings. Available: ₹${(listener.earningsBalancePaise / 100).toFixed(2)}` }); return;
  }

  // Balance is NOT deducted here — it will be deducted when admin approves the payout.
  // This ensures listeners can see their full balance until admin decides.
  const [created] = await db.insert(withdrawalRequestsTable).values({
    listenerId: listener.id,
    userId: req.user.id,
    amountPaise: requestedPaise,
    upiId: parsed.data.upiId,
    status: "pending",
  }).returning();

  const commissionPaise = Math.round(requestedPaise * 0.2);
  const payoutPaise = requestedPaise - commissionPaise;

  res.status(201).json({
    id: created.id,
    amountPaise: created.amountPaise,
    amountRupees: created.amountPaise / 100,
    payoutRupees: payoutPaise / 100,
    commissionRupees: commissionPaise / 100,
    upiId: created.upiId,
    status: created.status,
    createdAt: created.createdAt.toISOString(),
  });
});

// ── GET /listener/withdrawals — list withdrawal requests ──────────────────────
router.get("/listener/withdrawals", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const [listener] = await db.select().from(listenersTable).where(eq(listenersTable.userId, req.user.id)).limit(1);
  if (!listener) { res.json([]); return; }
  const rows = await db.select().from(withdrawalRequestsTable).where(eq(withdrawalRequestsTable.listenerId, listener.id)).orderBy(desc(withdrawalRequestsTable.createdAt)).limit(20);
  res.json(rows.map(r => ({
    id: r.id,
    amountPaise: r.amountPaise,
    amountRupees: r.amountPaise / 100,
    upiId: r.upiId,
    status: r.status,
    adminNote: r.adminNote,
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  })));
});

// ── PATCH /listener/call-settings — toggle audio/video call availability ─────
const CallSettingsBody = z.object({
  audioCallsEnabled: z.boolean().optional(),
  videoCallsEnabled: z.boolean().optional(),
});

router.patch("/listener/call-settings", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = CallSettingsBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid request" }); return; }

  const [listener] = await db.select().from(listenersTable).where(eq(listenersTable.userId, req.user.id)).limit(1);
  if (!listener) { res.status(404).json({ error: "No listener profile" }); return; }
  if (listener.applicationStatus !== "approved") { res.status(403).json({ error: "Only approved listeners can update settings" }); return; }

  const update: Partial<typeof listenersTable.$inferInsert> = {};
  if (parsed.data.audioCallsEnabled !== undefined) update.audioCallsEnabled = parsed.data.audioCallsEnabled;
  if (parsed.data.videoCallsEnabled !== undefined) update.videoCallsEnabled = parsed.data.videoCallsEnabled;

  const [updated] = await db.update(listenersTable).set(update).where(eq(listenersTable.id, listener.id)).returning();
  if (!updated) { res.status(500).json({ error: "Failed" }); return; }
  res.json(myListenerDto(updated));
});

// ── PUT /listener/fcm-token — store FCM push token for background notifications
const FcmTokenBody = z.object({ token: z.string().min(10) });

router.put("/listener/fcm-token", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = FcmTokenBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid token" }); return; }

  const [listener] = await db.select().from(listenersTable).where(eq(listenersTable.userId, req.user.id)).limit(1);
  if (!listener) { res.status(404).json({ error: "No listener profile" }); return; }

  await db.update(listenersTable)
    .set({ fcmToken: parsed.data.token })
    .where(eq(listenersTable.id, listener.id));

  res.json({ ok: true });
});

export default router;
