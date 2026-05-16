/**
 * Google OAuth via Firebase Auth Routes
 *
 * POST /api/auth/google/verify-token
 *   - Accepts a Firebase ID token from Google Sign-In (signInWithPopup)
 *   - Verifies server-side with Firebase Admin SDK
 *   - Creates or finds user by firebaseUid / email
 *   - Issues secure httpOnly session cookie
 *   - Returns { ok, role, hasOnboarded }
 */

import { Router, type IRouter } from "express";
import { db, usersTable, profilesTable, listenersTable } from "@workspace/db";
import { eq } from "@workspace/db";
import { verifyFirebaseToken } from "../lib/firebaseAdmin";
import { createSession, clearSession, SESSION_COOKIE, SESSION_TTL } from "../lib/auth";
import { ensureProfile, grantAdminIfMasterEmail } from "../lib/profile";
import type { SessionData } from "../lib/auth";

const router: IRouter = Router();

function setSessionCookie(res: any, sid: string) {
  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL,
  });
}

// ── POST /api/auth/google/verify-token ──────────────────────────────────────
router.post("/auth/google/verify-token", async (req, res) => {
  const { idToken } = req.body as { idToken?: string };

  if (!idToken) {
    return res.status(400).json({ error: "Firebase ID token is required." });
  }

  // 1. Verify token with Firebase Admin SDK
  let decoded: Awaited<ReturnType<typeof verifyFirebaseToken>>;
  try {
    decoded = await verifyFirebaseToken(idToken);
  } catch (err: any) {
    req.log.warn({ err: err.message }, "Google token verification failed");
    return res.status(401).json({ error: "Invalid or expired Google sign-in. Please try again." });
  }

  const firebaseUid = decoded.uid;
  const email = decoded.email ?? null;
  const displayName = decoded.name ?? null;
  const photoUrl = decoded.picture ?? null;

  // 2. Look up existing user by firebaseUid first, then email
  let existingUser: typeof usersTable.$inferSelect | undefined;

  if (firebaseUid) {
    const rows = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.firebaseUid, firebaseUid))
      .limit(1);
    existingUser = rows[0];
  }

  if (!existingUser && email) {
    const rows = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email.toLowerCase().trim()))
      .limit(1);
    existingUser = rows[0];
  }

  // 3. Create new user or update existing
  let isNewUser = false;
  let user: typeof usersTable.$inferSelect;

  if (!existingUser) {
    isNewUser = true;
    const [created] = await db
      .insert(usersTable)
      .values({
        firebaseUid,
        email: email ? email.toLowerCase().trim() : null,
        emailVerified: !!email,
        firstName: displayName?.split(" ")[0] ?? null,
        lastName: displayName?.split(" ").slice(1).join(" ") || null,
        profileImageUrl: photoUrl,
      })
      .returning();
    user = created;
  } else {
    // Link firebaseUid if missing, update profile photo
    const updates: Partial<typeof usersTable.$inferInsert> = {};
    if (!existingUser.firebaseUid) updates.firebaseUid = firebaseUid;
    if (!existingUser.profileImageUrl && photoUrl) updates.profileImageUrl = photoUrl;
    if (Object.keys(updates).length > 0) {
      await db.update(usersTable).set(updates).where(eq(usersTable.id, existingUser.id));
    }
    user = { ...existingUser, ...updates };
  }

  // 4. Ensure profile exists
  const profile = await ensureProfile(user.id, isNewUser ? { displayName: displayName ?? undefined } : undefined);

  // 5. Grant admin if master email
  if (email) {
    await grantAdminIfMasterEmail(user.id, email);
  }

  // 6. Create session
  const sessionData: SessionData = {
    user: {
      id: user.id,
      email: user.email ?? null,
      firstName: user.firstName ?? null,
      lastName: user.lastName ?? null,
      profileImageUrl: user.profileImageUrl ?? null,
    },
    access_token: "google",
  };

  const sid = await createSession(sessionData);
  setSessionCookie(res, sid);

  const listenerRow = (
    await db.select().from(listenersTable).where(eq(listenersTable.userId, user.id)).limit(1)
  )[0];

  req.log.info({ userId: user.id, email, isNewUser, role: profile.role }, "Google auth success");

  return res.json({
    ok: true,
    isNewUser,
    role: profile.role,
    hasOnboarded: profile.hasOnboarded,
    applicationStatus: listenerRow?.applicationStatus ?? null,
    ...(req.headers['x-mobile'] ? { token: sid } : {}),
  });
});

// ── POST /api/auth/google/logout ─────────────────────────────────────────────
router.post("/auth/google/logout", async (req, res) => {
  const sid = req.cookies?.[SESSION_COOKIE];
  await clearSession(res, sid);
  return res.json({ ok: true });
});

// ── POST /api/auth/admin-login — email + PIN, no Firebase needed ─────────────
router.post("/auth/admin-login", async (req, res) => {
  const { email, pin } = req.body as { email?: string; pin?: string };

  if (!email || !pin) {
    return res.status(400).json({ error: "Email aur PIN dono required hain." });
  }

  const { MASTER_ADMIN_EMAIL } = await import("../lib/security");
  const masterPin = process.env.ADMIN_PIN?.trim();

  if (email.toLowerCase().trim() !== MASTER_ADMIN_EMAIL) {
    return res.status(403).json({ error: "Yeh email admin nahi hai." });
  }

  if (masterPin && pin.trim() !== masterPin) {
    return res.status(403).json({ error: "Wrong PIN. Dobara try karein." });
  }

  // Find or create admin user by email
  let user: typeof usersTable.$inferSelect | undefined;
  const rows = await db.select().from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase().trim())).limit(1);
  user = rows[0];

  if (!user) {
    const [created] = await db.insert(usersTable).values({
      email: email.toLowerCase().trim(),
      emailVerified: true,
      firstName: "Admin",
    }).returning();
    user = created;
  }

  // Ensure profile + grant admin
  await ensureProfile(user.id);
  const { grantAdminIfMasterEmail } = await import("../lib/profile");
  await grantAdminIfMasterEmail(user.id, email);

  // Create session
  const sessionData: SessionData = {
    user: {
      id: user.id,
      email: user.email ?? null,
      firstName: user.firstName ?? null,
      lastName: user.lastName ?? null,
      profileImageUrl: user.profileImageUrl ?? null,
    },
    access_token: "admin-pin",
  };

  const sid = await createSession(sessionData);
  setSessionCookie(res, sid);

  req.log.info({ userId: user.id, email }, "Admin login via email+PIN");
  return res.json({ ok: true });
});

export default router;
