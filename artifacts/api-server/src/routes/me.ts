import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { profilesTable, listenersTable, usersTable } from "@workspace/db";
import {
  CompleteOnboardingBody,
  GetMyProfileResponse,
  SetThemePreferenceBody,
} from "@workspace/api-zod";
import { eq } from "@workspace/db";
import { ensureProfile, avg100ToFloat } from "../lib/profile";
import { z } from "zod";

const router: IRouter = Router();

// Allowed avatar seed prefixes / values
const AVATAR_PRESETS = [
  "av_leo", "av_alex", "av_kai", "av_max",
  "av_sam", "av_noah", "av_ryan", "av_jay",
];

async function buildProfileResponse(userId: string) {
  const profile = await ensureProfile(userId);
  const listenerRow = (
    await db.select().from(listenersTable).where(eq(listenersTable.userId, userId)).limit(1)
  )[0];

  const out = {
    id: profile.userId,
    email: null as string | null,
    role: profile.role,
    isAdmin: profile.isAdmin,
    anonymousUsername: profile.anonymousUsername,
    avatarSeed: profile.avatarSeed,
    theme: profile.theme,
    hasOnboarded: profile.hasOnboarded,
    listenerProfile: listenerRow
      ? {
          id: listenerRow.id,
          userId: listenerRow.userId,
          displayName: listenerRow.displayName,
          gender: listenerRow.gender,
          bio: listenerRow.bio,
          skills: listenerRow.skills ?? [],
          photoUrl: listenerRow.photoUrl,
          applicationStatus: listenerRow.applicationStatus,
          rejectionReason: listenerRow.rejectionReason,
          isOnline: listenerRow.isOnline,
          lastSeenAt: listenerRow.lastSeenAt ? listenerRow.lastSeenAt.toISOString() : null,
          ratingAverage: avg100ToFloat(listenerRow.ratingAverage),
          ratingCount: listenerRow.ratingCount,
        }
      : null,
    createdAt: profile.createdAt.toISOString(),
  };
  return GetMyProfileResponse.parse(out);
}

router.get("/me", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const out = await buildProfileResponse(req.user.id);
  out.email = req.user.email ?? null;
  const [userRow] = await db.select({ phone: usersTable.phone }).from(usersTable).where(eq(usersTable.id, req.user.id)).limit(1);
  (out as any).phone = userRow?.phone ?? null;
  res.json(out);
});

router.post("/me/onboarding", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = CompleteOnboardingBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid request" }); return; }
  await ensureProfile(req.user.id);
  const updateData: Partial<typeof profilesTable.$inferInsert> = {
    role: parsed.data.role,
    anonymousUsername: parsed.data.anonymousUsername,
    avatarSeed: parsed.data.avatarSeed ?? "sun",
    hasOnboarded: true,
    updatedAt: new Date(),
  };
  if (parsed.data.age !== undefined) {
    updateData.age = parsed.data.age;
  }
  await db.update(profilesTable).set(updateData).where(eq(profilesTable.userId, req.user.id));
  const out = await buildProfileResponse(req.user.id);
  out.email = req.user.email ?? null;
  res.json(out);
});

router.post("/me/theme", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = SetThemePreferenceBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid request" }); return; }
  await ensureProfile(req.user.id);
  await db.update(profilesTable).set({ theme: parsed.data.theme, updatedAt: new Date() }).where(eq(profilesTable.userId, req.user.id));
  const out = await buildProfileResponse(req.user.id);
  out.email = req.user.email ?? null;
  res.json(out);
});

// ── PATCH /me/avatar — update profile avatar seed ────────────────────────────
const AvatarBody = z.object({ seed: z.string().min(1).max(50) });

router.patch("/me/avatar", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = AvatarBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid seed" }); return; }

  const { seed } = parsed.data;
  // Allow preset avatar seeds or arbitrary string seeds (for future customization)
  if (seed.startsWith("av_") && !AVATAR_PRESETS.includes(seed)) {
    res.status(400).json({ error: "Invalid avatar preset" }); return;
  }

  await ensureProfile(req.user.id);
  await db.update(profilesTable).set({ avatarSeed: seed, updatedAt: new Date() }).where(eq(profilesTable.userId, req.user.id));

  const out = await buildProfileResponse(req.user.id);
  out.email = req.user.email ?? null;
  res.json(out);
});

// ── POST /me/heartbeat — presence ping (called every 60s by frontend) ────────
// Updates `profiles.last_active_at`. The admin live-activity endpoint then
// considers a user "online" when last_active_at > now() - 2 minutes.
router.post("/me/heartbeat", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  await db.update(profilesTable)
    .set({ lastActiveAt: new Date() })
    .where(eq(profilesTable.userId, req.user.id));
  res.json({ ok: true });
});

export default router;
