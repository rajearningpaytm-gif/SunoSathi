import { db } from "@workspace/db";
import { profilesTable, listenersTable, usersTable } from "@workspace/db";
import { eq, sql, count } from "@workspace/db";

const MASTER_ADMIN_EMAIL = "rajsocialtalkk@gmail.com";
const MASTER_ADMIN_PHONE = process.env.MASTER_ADMIN_PHONE ?? null;

/** Call after email login/register to promote the master admin email automatically. */
export async function grantAdminIfMasterEmail(userId: string, email: string) {
  if (!email || email.toLowerCase().trim() !== MASTER_ADMIN_EMAIL) return;
  await db
    .update(profilesTable)
    .set({ isAdmin: true })
    .where(eq(profilesTable.userId, userId));
}

/**
 * Call after phone/Firebase login to promote the master admin phone automatically.
 * Set MASTER_ADMIN_PHONE secret (E.164 format, e.g. +919876543210) in Replit Secrets.
 */
export async function grantAdminIfMasterPhone(userId: string, phone: string) {
  if (!MASTER_ADMIN_PHONE || !phone) return;
  if (phone.trim() !== MASTER_ADMIN_PHONE.trim()) return;
  await db
    .update(profilesTable)
    .set({ isAdmin: true })
    .where(eq(profilesTable.userId, userId));
}

const ADJECTIVES = [
  "Quiet",
  "Gentle",
  "Bright",
  "Brave",
  "Kind",
  "Cosy",
  "Warm",
  "Calm",
  "Sunny",
  "Mellow",
  "Soft",
  "Hopeful",
];
const NOUNS = [
  "Lotus",
  "Sparrow",
  "Cloud",
  "River",
  "Dawn",
  "Dusk",
  "Star",
  "Moon",
  "Forest",
  "Meadow",
  "Lantern",
  "Sapling",
];

function randomUsername(): string {
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const n = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num = Math.floor(100 + Math.random() * 899);
  return `${a}${n}${num}`;
}

export async function ensureProfile(
  userId: string,
  opts?: { role?: string; displayName?: string },
) {
  const existing = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.userId, userId))
    .limit(1);
  if (existing[0]) return existing[0];

  // First profile in the system becomes admin automatically.
  const adminCheck = await db
    .select({ c: count() })
    .from(profilesTable)
    .where(eq(profilesTable.isAdmin, true));
  const isFirstAdmin = (adminCheck[0]?.c ?? 0) === 0;

  const baseUsername = opts?.displayName?.trim().slice(0, 24) || null;
  const role = opts?.role ?? "user";

  // Try provided displayName first, then fall back to random generation
  const candidates = baseUsername
    ? [baseUsername, ...Array.from({ length: 7 }, randomUsername)]
    : Array.from({ length: 8 }, randomUsername);

  for (const username of candidates) {
    try {
      const [created] = await db
        .insert(profilesTable)
        .values({
          userId,
          anonymousUsername: username,
          role,
          isAdmin: isFirstAdmin,
          avatarSeed: "sun",
          theme: "light",
          hasOnboarded: false,
          walletBalanceInRupees: 500,
        })
        .returning();
      if (created) return created;
    } catch {
      // username collision — try next
    }
  }
  throw new Error("Failed to create profile");
}

export async function getProfileWithListener(userId: string) {
  const profile = await ensureProfile(userId);
  const listenerRows = await db
    .select()
    .from(listenersTable)
    .where(eq(listenersTable.userId, userId))
    .limit(1);
  return { profile, listener: listenerRows[0] ?? null };
}

export function avg100ToFloat(x: number): number {
  return Math.round(x) / 100;
}

export async function recomputeListenerRating(listenerId: string) {
  const result = await db.execute<{ avg: string | null; cnt: string }>(
    sql`SELECT COALESCE(AVG(rating), 0) AS avg, COUNT(*) AS cnt FROM reviews WHERE listener_id = ${listenerId}`,
  );
  const row = result.rows[0];
  const avg = row ? Number(row.avg ?? 0) : 0;
  const cnt = row ? Number(row.cnt ?? 0) : 0;
  await db
    .update(listenersTable)
    .set({
      ratingAverage: Math.round(avg * 100),
      ratingCount: cnt,
    })
    .where(eq(listenersTable.id, listenerId));
}
