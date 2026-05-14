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

const router: IRouter = Router();

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
  await db.update(profilesTable).set({ role: "listener", updatedAt: new Date() }).where(eq(profilesTable.userId, req.user.id));

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

  const commissionPaise = Math.round(requestedPaise * 0.1);
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
