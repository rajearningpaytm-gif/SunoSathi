/**
 * Device-based Auth Routes (No OTP / No Google)
 *
 * POST /api/auth/device-login
 *   - Accepts a deviceId, checks if it's registered
 *   - If found: creates session and returns profile routing info
 *   - If not found: returns { found: false }
 *
 * POST /api/auth/device-signup
 *   - Accepts { deviceId, name, age, gender, whatsapp, avatarSeed }
 *   - Creates user in PostgreSQL + syncs to Firebase Realtime DB
 *   - Generates SS-XXXXXX unique display ID
 *   - Issues session cookie
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, usersTable, profilesTable, bannedDevicesTable } from "@workspace/db";
import { eq, count } from "@workspace/db";
import {
  createSession,
  deleteUserSessions,
  SESSION_COOKIE,
  SESSION_TTL,
  type SessionData,
} from "../lib/auth";
import { syncUserToRealtimeDB } from "../lib/firebaseAdmin";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function setSessionCookie(res: Response, sid: string) {
  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL,
  });
}

function generateSsId(): string {
  const num = Math.floor(100000 + Math.random() * 900000);
  return `SS-${num}`;
}

async function buildSession(userId: string, name: string): Promise<SessionData> {
  return {
    user: {
      id: userId,
      email: null,
      firstName: name,
      lastName: null,
      profileImageUrl: null,
    },
    access_token: "device",
  };
}

// ── POST /api/auth/device-login ──────────────────────────────────────────────
router.post("/auth/device-login", async (req: Request, res: Response) => {
  const { deviceId } = req.body as { deviceId?: string };

  if (!deviceId || typeof deviceId !== "string" || deviceId.trim().length < 4) {
    res.status(400).json({ found: false, error: "deviceId required" });
    return;
  }

  try {
    // Device-ban check intentionally removed — users get a fresh ID on each
    // install. If they uninstall and reinstall they will create a new account.
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.firebaseUid, deviceId.trim()))
      .limit(1);

    if (!user) {
      res.json({ found: false });
      return;
    }

    const [profile] = await db
      .select()
      .from(profilesTable)
      .where(eq(profilesTable.userId, user.id))
      .limit(1);

    if (!profile) {
      res.json({ found: false });
      return;
    }

    const sessionData = await buildSession(user.id, user.firstName ?? "User");
    const sid = await createSession(sessionData, deviceId.trim());
    setSessionCookie(res, sid);

    const appStatus =
      profile.role === "listener"
        ? ((profile as any).applicationStatus ?? null)
        : null;

    res.json({
      found: true,
      hasOnboarded: profile.hasOnboarded,
      role: profile.role,
      applicationStatus: appStatus,
    });
  } catch (err) {
    logger.error({ err }, "Device login error");
    res.status(500).json({ found: false, error: "Login check failed" });
  }
});

// ── POST /api/auth/device-signup ─────────────────────────────────────────────
router.post("/auth/device-signup", async (req: Request, res: Response) => {
  const {
    deviceId,
    name,
    age,
    gender = "male",
    whatsapp = "0000000000",
    avatarSeed = "default",
    interest,
} = req.body as {
    deviceId?: string;
    name?: string;
    age?: number | string;
    gender?: string;
    whatsapp?: string;
    avatarSeed?: string;
    interest?: string;
};

  if (!name) {
    res.status(400).json({ error: "Name aur DeviceId zaroori hai" });
    return;
}

  const cleanInterest = (interest ?? "").toString().trim().slice(0, 50) || null;

  const ageNum = 18;
  if (isNaN(ageNum) || ageNum < 13 || ageNum > 100) {
    res.status(400).json({ error: "Age 13-100 ke beech hona chahiye" });
    return;
  }

  const cleanDevice = deviceId ? deviceId.trim() : "device_" + Math.floor(Math.random() * 100000);
  const cleanName   = name.trim().slice(0, 60);
  const cleanWA     = whatsapp.replace(/\D/g, "");

  if (cleanWA.length < 10) {
    res.status(400).json({ error: "WhatsApp number sahi nahi hai" });
    return;
  }

  try {
    // Device-ban check intentionally removed.
    // Check if device already registered — idempotent
    const [existingByDevice] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.firebaseUid, cleanDevice))
      .limit(1);

    if (existingByDevice) {
      const [profile] = await db
        .select()
        .from(profilesTable)
        .where(eq(profilesTable.userId, existingByDevice.id))
        .limit(1);

      await deleteUserSessions(existingByDevice.id).catch(() => {});
      const sessionData = await buildSession(existingByDevice.id, existingByDevice.firstName ?? cleanName);
      const sid = await createSession(sessionData, cleanDevice);
      setSessionCookie(res, sid);

      res.json({
        ok: true,
        userId: profile?.anonymousUsername ?? generateSsId(),
        hasOnboarded: profile?.hasOnboarded ?? false,
        role: profile?.role ?? "user",
        applicationStatus: null,
      });
      return;
    }

    // Generate a unique SS-XXXXXX — retry until unique
    let ssId = generateSsId();
    for (let i = 0; i < 5; i++) {
      const [clash] = await db
        .select({ c: count() })
        .from(profilesTable)
        .where(eq(profilesTable.anonymousUsername, ssId));
      if ((clash?.c ?? 0) === 0) break;
      ssId = generateSsId();
    }

    // First profile ever → auto-admin
    const [adminCount] = await db
      .select({ c: count() })
      .from(profilesTable)
      .where(eq(profilesTable.isAdmin, true));
    const isFirstAdmin = (adminCount?.c ?? 0) === 0;

    // Create user row
    const [user] = await db
      .insert(usersTable)
      .values({
        firebaseUid: cleanDevice,
        firstName:   cleanName,
        phone:       cleanWA,
        phoneVerified: true,
      })
      .returning();

    // Create profile row
    const role = gender === "female" ? "listener" : "user";
    // Seekers (guys) are fully onboarded right at signup — go straight to /home.
    // Listeners (girls) still need to fill the application form (approval flow).
    const hasOnboarded = role === "user";

    await db.insert(profilesTable).values({
      userId:            user.id,
      anonymousUsername: ssId,
      role,
      avatarSeed,
      age:               ageNum,
      whatsappNumber:    cleanWA,
      interest:          cleanInterest,
      isAdmin:           isFirstAdmin,
      hasOnboarded,
      // Welcome bonus: ₹6 (= 1 free minute trial call). Applies to seekers only.
      // Listeners don't get a bonus; their wallet is unused for incoming calls.
      walletBalanceInRupees: role === "user" ? 6 : 0,
      theme:             "light",
    });

    // Sync to Firebase Realtime DB (non-blocking)
    syncUserToRealtimeDB({
      userId:        ssId,
      internalId:    user.id,
      name:          cleanName,
      age:           ageNum,
      gender,
      whatsappNumber: cleanWA,
      profilePic:    avatarSeed,
      deviceId:      cleanDevice,
      createdAt:     new Date().toISOString(),
    }).catch((err) =>
      logger.warn({ err }, "Firebase Realtime DB sync failed (non-fatal)"),
    );

    const sessionData = await buildSession(user.id, cleanName);
    const sid = await createSession(sessionData, cleanDevice);
    setSessionCookie(res, sid);

    res.json({
      ok: true,
      userId: ssId,
      hasOnboarded: false,
      role,
      applicationStatus: null,
    });
  } catch (err: any) {
    logger.error({ err }, "Device signup error");

    const msg = String(err?.message ?? "");
    if (err?.code === "23505" || msg.includes("unique") || msg.includes("duplicate")) {
      res.status(409).json({ error: "Yeh WhatsApp number pehle se registered hai. Doosra try karein." });
    } else {
      res.status(500).json({ error: "Signup fail hua. Dobara try karein." });
    }
  }
});

export default router;
