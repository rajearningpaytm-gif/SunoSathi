import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { profilesTable, listenersTable, usersTable } from "@workspace/db";
import {
  CompleteOnboardingBody,
  GetMyProfileResponse,
  SetThemePreferenceBody,
} from "@workspace/api-zod";
import { eq, sql } from "@workspace/db";
import { ensureProfile, avg100ToFloat } from "../lib/profile";
import { z } from "zod";

const router: IRouter = Router();

// Allowed avatar seed prefixes / values
const AVATAR_PRESETS = [
  "av_leo", "av_alex", "av_kai", "av_max",
  "av_sam", "av_noah", "av_ryan", "av_jay",
];

// ── Auto-heal legacy SS-XXXXXX usernames ─────────────────────────────────────
function sanitizeDisplayName(raw: string): string {
  const cleaned = (raw ?? "").trim().replace(/\s+/g, " ").slice(0, 24);
  if (cleaned.length < 2) return "User";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

async function pickUniqueDisplayName(base: string, currentUserId: string): Promise<string> {
  const { count } = await import("@workspace/db");
  const safeBase = sanitizeDisplayName(base);
  const [first] = await db
    .select({ c: count() })
    .from(profilesTable)
    .where(eq(profilesTable.anonymousUsername, safeBase));
  if ((first?.c ?? 0) === 0) return safeBase;
  for (let i = 0; i < 12; i++) {
    const suffix = Math.floor(10 + Math.random() * 9990);
    const candidate = `${safeBase}${suffix}`;
    const [clash] = await db
      .select({ c: count() })
      .from(profilesTable)
      .where(eq(profilesTable.anonymousUsername, candidate));
    if ((clash?.c ?? 0) === 0) return candidate;
  }
  return `${safeBase}${currentUserId.slice(0, 4)}`;
}

/**
 * If the user's anonymousUsername is still the legacy SS-XXXXXX placeholder,
 * replace it with their actual entered name (from usersTable.firstName).
 * Returns the (possibly new) username.
 */
async function healLegacyUsername(userId: string, currentUsername: string | null): Promise<void> {
  if (!currentUsername || !/^SS-\d{6}$/.test(currentUsername)) return;
  const [userRow] = await db
    .select({ firstName: usersTable.firstName })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  const realName = (userRow?.firstName ?? "").trim();
  if (realName.length < 2) return;
  const newName = await pickUniqueDisplayName(realName, userId);
  try {
    await db.update(profilesTable)
      .set({ anonymousUsername: newName, updatedAt: new Date() })
      .where(eq(profilesTable.userId, userId));
  } catch {
    // unique clash race — leave as-is; next /me call will retry
  }
}

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
          audioCallsEnabled: listenerRow.audioCallsEnabled ?? true,
          videoCallsEnabled: listenerRow.videoCallsEnabled ?? true,
        }
      : null,
    createdAt: profile.createdAt.toISOString(),
  };
  return GetMyProfileResponse.parse(out);
}

router.get("/me", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  // Auto-heal legacy SS-XXXXXX usernames before responding
  const profileBefore = await ensureProfile(req.user.id);
  await healLegacyUsername(req.user.id, profileBefore.anonymousUsername);
  const out = await buildProfileResponse(req.user.id);
  out.email = req.user.email ?? null;
  const [userRow] = await db.select({ phone: usersTable.phone, firstName: usersTable.firstName }).from(usersTable).where(eq(usersTable.id, req.user.id)).limit(1);
  (out as any).phone = userRow?.phone ?? null;
  (out as any).firstName = userRow?.firstName ?? null;
  res.json(out);
});

router.post("/me/onboarding", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = CompleteOnboardingBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid request" }); return; }

  try {
    await ensureProfile(req.user.id);

    // Always save the nickname the user picked during onboarding —
    // overwrite the SS-XXXXXX placeholder created at device-signup time.
    const updateData: Partial<typeof profilesTable.$inferInsert> = {
      role: parsed.data.role,
      anonymousUsername: parsed.data.anonymousUsername,
      avatarSeed: parsed.data.avatarSeed ?? "av_arjun",
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
  } catch (err: unknown) {
    const msg = String((err as any)?.message ?? "");
    if (msg.includes("unique") || msg.includes("duplicate") || (err as any)?.code === "23505") {
      // anonymousUsername clash — append random suffix and retry until unique
      const base = (parsed.data.anonymousUsername ?? "User").slice(0, 18);
      let saved = false;
      for (let i = 0; i < 10; i++) {
        const suffix = Math.floor(100 + Math.random() * 9000);
        const candidate = `${base}${suffix}`;
        try {
          await db.update(profilesTable)
            .set({ role: parsed.data.role, anonymousUsername: candidate, avatarSeed: parsed.data.avatarSeed ?? "av_arjun", hasOnboarded: true, updatedAt: new Date() })
            .where(eq(profilesTable.userId, req.user.id));
          saved = true;
          break;
        } catch { continue; }
      }
      if (!saved) {
        await db.update(profilesTable)
          .set({ hasOnboarded: true, updatedAt: new Date() })
          .where(eq(profilesTable.userId, req.user.id));
      }
      const out = await buildProfileResponse(req.user.id);
      out.email = req.user.email ?? null;
      res.json(out);
    } else {
      res.status(500).json({ error: "Onboarding failed. Please try again." });
    }
  }
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

// ── PUT /me/fcm-token — save user FCM push token for engagement notifications ─
router.put("/me/fcm-token", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = z.object({ token: z.string().min(1).max(512) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid token" }); return; }
  await db.update(profilesTable)
    .set({ fcmToken: parsed.data.token, updatedAt: new Date() })
    .where(eq(profilesTable.userId, req.user.id));
  res.json({ ok: true });
});

// ── POST /me/heartbeat — presence ping (called every 60s by frontend) ────────
// Updates `profiles.last_active_at`. The admin live-activity endpoint then
// considers a user "online" when last_active_at > now() - 2 minutes.
router.post("/me/heartbeat", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const now = new Date();
  await db.update(profilesTable)
    .set({ lastActiveAt: now })
    .where(eq(profilesTable.userId, req.user.id));

  // Track listener online sessions for Work Hours in admin panel
  try {
    const listenerRows = await db.select({ id: listenersTable.id })
      .from(listenersTable)
      .where(eq(listenersTable.userId, req.user.id))
      .limit(1);
    if (listenerRows.length > 0) {
      const lid = listenerRows[0].id;
      const open = await db.execute(sql`
        SELECT id FROM listener_online_sessions
        WHERE listener_id = ${lid} AND went_offline_at IS NULL
        LIMIT 1
      `);
      if ((open as any).rows.length === 0) {
        await db.execute(sql`
          INSERT INTO listener_online_sessions (listener_id, came_online_at)
          VALUES (${lid}, ${now})
        `);
      }
    }
  } catch (_) {}

  res.json({ ok: true });
});

export default router;
