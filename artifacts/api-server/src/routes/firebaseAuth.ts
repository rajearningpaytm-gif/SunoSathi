/**
 * Firebase Phone OTP Auth Routes
 *
 * POST /api/auth/firebase/verify-token
 *   - Accepts a Firebase ID token (obtained after phone OTP verification on client)
 *   - Verifies it server-side using Firebase Admin SDK
 *   - Creates or finds user by phone number in our DB
 *   - Enforces device binding: kills all other active sessions for this user
 *   - Issues a secure httpOnly session cookie
 *   - Returns { ok, isNewUser }
 *
 * POST /api/auth/firebase/logout
 *   - Revokes the Firebase session (prevents token reuse)
 *   - Clears the local session cookie
 */

import { Router, type IRouter } from "express";
import { db, usersTable, profilesTable } from "@workspace/db";
import { eq } from "@workspace/db";
import { verifyFirebaseToken, getFirebaseAuth } from "../lib/firebaseAdmin";
import { createSession, deleteUserSessions, clearSession, SESSION_COOKIE, SESSION_TTL } from "../lib/auth";
import { ensureProfile, grantAdminIfMasterEmail, grantAdminIfMasterPhone } from "../lib/profile";
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

// ── POST /api/auth/firebase/verify-token ────────────────────────────────────
router.post("/auth/firebase/verify-token", async (req, res) => {
  const {
    idToken,
    deviceId,
    intent = "signin",   // "signup" | "signin"
    role = "user",       // "user" | "listener"
    displayName,         // chosen username / listener display name
  } = req.body as {
    idToken?: string;
    deviceId?: string;
    intent?: "signup" | "signin";
    role?: "user" | "listener";
    displayName?: string;
  };

  if (!idToken) {
    return res.status(400).json({ error: "Firebase ID token is required." });
  }

  // 1. Verify token with Firebase Admin SDK
  let decoded: Awaited<ReturnType<typeof verifyFirebaseToken>>;
  try {
    decoded = await verifyFirebaseToken(idToken);
  } catch (err: any) {
    req.log.warn({ err: err.message }, "Firebase token verification failed");
    return res.status(401).json({
      error: "Invalid or expired verification. Please try again.",
    });
  }

  const firebaseUid = decoded.uid;
  const phone = decoded.phone_number;

  if (!phone) {
    return res.status(400).json({
      error: "This sign-in method does not provide a phone number.",
    });
  }

  // 2. Look up existing user (by firebase UID first, then by phone)
  let [existingUser] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.firebaseUid, firebaseUid));

  if (!existingUser) {
    [existingUser] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.phone, phone));
  }

  // 3. Enforce intent — sign-up vs sign-in (bypassed for test accounts)
  const isTestAccount = existingUser?.isTestAccount === true;
  if (!isTestAccount) {
    if (intent === "signup" && existingUser) {
      return res.status(409).json({
        error: "Account already exists. Please Sign In.",
      });
    }
    if (intent === "signin" && !existingUser) {
      return res.status(404).json({
        error: "Account not found. Please Sign Up first.",
      });
    }
  }

  // 4. Create new user or update existing
  let isNewUser = false;
  let user = existingUser;

  if (!user) {
    // New user — sign-up path
    isNewUser = true;
    [user] = await db
      .insert(usersTable)
      .values({ firebaseUid, phone, phoneVerified: true })
      .returning();
  } else {
    // Returning user — link Firebase UID if not already linked
    if (!user.firebaseUid || !user.phoneVerified) {
      await db
        .update(usersTable)
        .set({ firebaseUid, phoneVerified: true })
        .where(eq(usersTable.id, user.id));
    }
  }

  // 5. Create/ensure profile, passing role + displayName for new users
  const profile = await ensureProfile(
    user.id,
    isNewUser ? { role, displayName } : undefined,
  );

  // 6. For new sign-ups: mark onboarding complete (name + role were collected in auth screen)
  if (isNewUser) {
    await db
      .update(profilesTable)
      .set({ hasOnboarded: true })
      .where(eq(profilesTable.userId, user.id));
  }

  await grantAdminIfMasterEmail(user.id, user.email ?? "");
  await grantAdminIfMasterPhone(user.id, phone);

  // 7. Device binding — kill all previous sessions
  await deleteUserSessions(user.id).catch(() => {});

  // 8. Create new session
  const sessionData: SessionData = {
    user: {
      id: user.id,
      email: user.email ?? null,
      firstName: user.firstName ?? null,
      lastName: user.lastName ?? null,
      profileImageUrl: user.profileImageUrl ?? null,
    },
    access_token: "firebase",
  };

  const sid = await createSession(sessionData, deviceId ?? undefined);
  setSessionCookie(res, sid);

  req.log.info({ userId: user.id, phone, isNewUser, role: profile.role, deviceId }, "Firebase phone auth success");

  return res.json({
    ok: true,
    isNewUser,
    role: profile.role,
    hasOnboarded: true,
  });
});

// ── POST /api/auth/firebase/logout ───────────────────────────────────────────
router.post("/auth/firebase/logout", async (req, res) => {
  const sid = req.cookies?.[SESSION_COOKIE];

  // Revoke Firebase tokens for this user so they can't be reused
  if (req.isAuthenticated()) {
    try {
      const [user] = await db
        .select({ firebaseUid: usersTable.firebaseUid })
        .from(usersTable)
        .where(eq(usersTable.id, req.user.id));

      if (user?.firebaseUid) {
        await getFirebaseAuth().revokeRefreshTokens(user.firebaseUid);
      }
    } catch {
      // Non-fatal — still clear local session
    }
  }

  await clearSession(res, sid);
  return res.json({ ok: true });
});

export default router;
