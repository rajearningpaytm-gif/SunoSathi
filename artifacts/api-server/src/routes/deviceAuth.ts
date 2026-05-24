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
    sameSite: "none",
    path: "/",
    maxAge: SESSION_TTL,
  });
}

function generateSsId(): string {
  const num = Math.floor(100000 + Math.random() * 900000);
  return `SS-${num}`;
}

/** Build a clean public display name from raw user input. */
function sanitizeName(raw: string): string {
  const cleaned = raw.trim().replace(/\s+/g, " ").slice(0, 24);
  if (cleaned.length < 2) return "User";
  // Capitalize first letter, leave the rest as-is so Hindi/regional names survive
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/** Try the candidate username; on unique-clash append 2-4 digit suffix and retry. */
async function pickUniqueUsername(base: string): Promise<string> {
  const safeBase = sanitizeName(base);
  // first attempt = bare name
  const [first] = await db
    .select({ c: count() })
    .from(profilesTable)
    .where(eq(profilesTable.anonymousUsername, safeBase));
  if ((first?.c ?? 0) === 0) return safeBase;
  // retries with numeric suffix
  for (let i = 0; i < 12; i++) {
    const suffix = Math.floor(10 + Math.random() * 9990);
    const candidate = `${safeBase}${suffix}`;
    const [clash] = await db
      .select({ c: count() })
      .from(profilesTable)
      .where(eq(profilesTable.anonymousUsername, candidate));
    if ((clash?.c ?? 0) === 0) return candidate;
  }
  // ultra-rare fallback
  return `${safeBase}${Date.now().toString().slice(-5)}`;
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
    const cleanDevice = deviceId.trim();

    // ── Ban check ────────────────────────────────────────────────────────────
    // If admin removed this user WITH banDevice=true, the deviceId is in the
    // banned_devices table and we must refuse login. The same handset can only
    // sign up again after the admin clears the ban.
    const [banned] = await db
      .select()
      .from(bannedDevicesTable)
      .where(eq(bannedDevicesTable.deviceId, cleanDevice))
      .limit(1);
    if (banned) {
      res.status(403).json({ found: false, error: "Yeh device block hai. Admin se contact karein." });
      return;
    }

    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.firebaseUid, cleanDevice))
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
    gender,
    whatsapp,
    avatarSeed,
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

  if (!deviceId || !name || !age || !gender || !whatsapp || !avatarSeed) {
    res.status(400).json({ error: "Sab fields bharein (name, age, gender, WhatsApp, avatar)" });
    return;
  }

  const cleanInterest = (interest ?? "").toString().trim().slice(0, 50) || null;

  const ageNum = parseInt(String(age), 10);
  if (isNaN(ageNum) || ageNum < 13 || ageNum > 100) {
    res.status(400).json({ error: "Age 13-100 ke beech hona chahiye" });
    return;
  }

  const cleanDevice = deviceId.trim();
  const cleanName   = name.trim().slice(0, 60);
  const cleanWA     = whatsapp.replace(/\D/g, "");

  if (cleanWA.length < 10) {
    res.status(400).json({ error: "WhatsApp number sahi nahi hai" });
    return;
  }

  try {
    // ── Ban check ────────────────────────────────────────────────────────────
    const [bannedDev] = await db
      .select()
      .from(bannedDevicesTable)
      .where(eq(bannedDevicesTable.deviceId, cleanDevice))
      .limit(1);
    if (bannedDev) {
      res.status(403).json({ error: "Yeh device block hai. Admin se contact karein." });
      return;
    }

    // ── 1. Check if THIS device is already registered (idempotent) ───────────
    let [existingByDevice] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.firebaseUid, cleanDevice))
      .limit(1);

    // ── 2. If no device match, check by WhatsApp number ──────────────────────
    // This is the KEY user-experience fix: when the user reinstalls the APK,
    // the Capacitor-generated deviceId changes (it lives in app-private storage
    // that gets wiped on uninstall). The same person re-entering their own
    // WhatsApp number must be recognized as the same account — wallet, role,
    // listener status, history all preserved. We simply rebind firebaseUid to
    // the fresh device on the existing user row.
    if (!existingByDevice) {
      const [existingByPhone] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.phone, cleanWA))
        .limit(1);
      if (existingByPhone) {
        await db.update(usersTable)
          .set({ firebaseUid: cleanDevice })
          .where(eq(usersTable.id, existingByPhone.id))
          .catch(() => {});
        existingByDevice = { ...existingByPhone, firebaseUid: cleanDevice };
      }
    }

    if (existingByDevice) {
      // Update profile with latest submitted details — also fixes legacy rows
      // where hasOnboarded was stuck on false from earlier signups.
      const roleX = gender === "female" ? "listener" : "user";
      const hasOnboardedX = roleX === "user";

      let [profileX] = await db
        .select()
        .from(profilesTable)
        .where(eq(profilesTable.userId, existingByDevice.id))
        .limit(1);

      if (profileX) {
        // If username is the legacy SS-XXXXXX placeholder, replace with the
        // name the user actually entered (Deepak, Rahul, etc.).
        const currentName = profileX.anonymousUsername ?? "";
        const isPlaceholder = /^SS-\d{6}$/.test(currentName);
        const newDisplayName = isPlaceholder
          ? await pickUniqueUsername(cleanName)
          : currentName;

        await db.update(profilesTable)
          .set({
            role: roleX,
            anonymousUsername: newDisplayName,
            avatarSeed,
            age: ageNum,
            whatsappNumber: cleanWA,
            interest: cleanInterest,
            // Never downgrade: if already onboarded, keep true.
            hasOnboarded: hasOnboardedX || profileX.hasOnboarded,
            updatedAt: new Date(),
          })
          .where(eq(profilesTable.userId, existingByDevice.id));
        [profileX] = await db
          .select()
          .from(profilesTable)
          .where(eq(profilesTable.userId, existingByDevice.id))
          .limit(1);
      }

      // Refresh name/phone on user row too
      await db.update(usersTable)
        .set({ firstName: cleanName, phone: cleanWA, phoneVerified: true })
        .where(eq(usersTable.id, existingByDevice.id))
        .catch(() => {});

      await deleteUserSessions(existingByDevice.id).catch(() => {});
      const sessionData = await buildSession(existingByDevice.id, cleanName);
      const sid = await createSession(sessionData, cleanDevice);
      setSessionCookie(res, sid);

      res.json({
        ok: true,
        userId: profileX?.anonymousUsername ?? generateSsId(),
        hasOnboarded: profileX?.hasOnboarded ?? hasOnboardedX,
        role: profileX?.role ?? roleX,
        applicationStatus: null,
      });
      return;
    }

    // Public display name = user-entered name (Deepak, Rahul, etc.), unique.
    // Keep ssId only for legacy Firebase-RTDB sync payload.
    const displayName = await pickUniqueUsername(cleanName);
    const ssId = generateSsId();

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
      anonymousUsername: displayName,
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
      hasOnboarded,
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
