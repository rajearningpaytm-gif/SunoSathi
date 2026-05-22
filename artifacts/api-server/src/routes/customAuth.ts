import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { db, usersTable, otpCodesTable } from "@workspace/db";
import { eq, and, gt, count } from "@workspace/db";
import { createSession, SESSION_COOKIE, SESSION_TTL } from "../lib/auth";
import type { SessionData } from "../lib/auth";
import { ensureProfile, grantAdminIfMasterEmail } from "../lib/profile";

const router: IRouter = Router();

function setSessionCookie(res: any, sid: string) {
  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/",
    maxAge: SESSION_TTL,
  });
}

function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function generateVerifyToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function buildSessionData(user: typeof usersTable.$inferSelect): SessionData {
  return {
    user: {
      id: user.id,
      email: user.email ?? null,
      firstName: user.firstName ?? null,
      lastName: user.lastName ?? null,
      profileImageUrl: user.profileImageUrl ?? null,
    },
    access_token: "custom",
  };
}

// ─── Email Register ───────────────────────────────────────────────────────────
router.post("/auth/email/register", async (req, res) => {
  const { email, password, displayName, role } = req.body as {
    email?: string;
    password?: string;
    displayName?: string;
    role?: "user" | "listener";
  };

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters." });
  }

  const normalizedEmail = email.toLowerCase().trim();

  const existing = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, normalizedEmail));

  if (existing.length > 0) {
    return res.status(409).json({ error: "An account with this email already exists." });
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const [user] = await db
    .insert(usersTable)
    .values({
      email: normalizedEmail,
      passwordHash,
      emailVerified: true,
    })
    .returning();

  const sid = await createSession(buildSessionData(user));
  setSessionCookie(res, sid);

  const profile = await ensureProfile(user.id, {
    role: role ?? "user",
    displayName: displayName?.trim() || undefined,
  });
  await grantAdminIfMasterEmail(user.id, normalizedEmail);

  req.log.info({ email: normalizedEmail, role: profile.role }, "Email registration");

  return res.status(201).json({
    ok: true,
    role: profile.role,
    hasOnboarded: profile.hasOnboarded ?? true,
    ...(req.headers['x-mobile'] ? { token: sid } : {}),
  });
});

// ─── Email Login ──────────────────────────────────────────────────────────────
router.post("/auth/email/login", async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  const normalizedEmail = email.toLowerCase().trim();

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, normalizedEmail));

  if (!user || !user.passwordHash) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  const sid = await createSession(buildSessionData(user));
  setSessionCookie(res, sid);

  const profile = await ensureProfile(user.id);
  await grantAdminIfMasterEmail(user.id, normalizedEmail);

  return res.json({
    ok: true,
    role: profile.role,
    hasOnboarded: profile.hasOnboarded ?? false,
    ...(req.headers['x-mobile'] ? { token: sid } : {}),
  });
});

// ─── Email Verify (link click) ────────────────────────────────────────────────
router.get("/auth/email/verify", async (req, res) => {
  const { token } = req.query as { token?: string };
  if (!token) {
    return res.status(400).send(`
      <html><body style="font-family:sans-serif;padding:2rem;text-align:center">
        <h2>❌ Invalid Link</h2><p>Missing verification token.</p>
        <a href="/">← Back to SunoSathi</a>
      </body></html>
    `);
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(
      and(
        eq(usersTable.emailVerifyToken, token),
        gt(usersTable.emailVerifyTokenExpiry!, new Date()),
      )
    )
    .limit(1);

  if (!user) {
    return res.status(400).send(`
      <html><body style="font-family:sans-serif;padding:2rem;text-align:center">
        <h2>❌ Link Expired</h2>
        <p>This verification link has expired or already been used.</p>
        <a href="/">← Back to SunoSathi</a>
      </body></html>
    `);
  }

  await db
    .update(usersTable)
    .set({ emailVerified: true, emailVerifyToken: null, emailVerifyTokenExpiry: null })
    .where(eq(usersTable.id, user.id));

  return res.send(`
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Email Verified — SunoSathi</title>
      <style>
        body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#fff8f7}
        .card{background:#fff;border-radius:24px;padding:2.5rem;text-align:center;box-shadow:0 4px 40px rgba(236,72,153,.15);max-width:360px;width:90%}
        .icon{font-size:3rem;margin-bottom:1rem}
        h2{margin:0 0 .5rem;font-size:1.5rem;color:#1a1a2e}
        p{color:#6b7280;margin-bottom:1.5rem}
        a{display:inline-block;padding:.75rem 2rem;background:linear-gradient(135deg,#ec4899,#f97316);color:#fff;text-decoration:none;border-radius:50px;font-weight:600;font-size:1rem}
      </style>
    </head>
    <body>
      <div class="card">
        <div class="icon">✅</div>
        <h2>Email Verified!</h2>
        <p>Your email has been confirmed. You can now use SunoSathi.</p>
        <a href="/">Continue to App →</a>
      </div>
    </body>
    </html>
  `);
});

// ─── Email Check Verified Status ──────────────────────────────────────────────
router.get("/auth/email/check-verified", async (req, res) => {
  const cookieSid = req.cookies?.sid;
  if (!cookieSid) return res.json({ verified: false });

  // Re-read from DB to get fresh status
  const { getSession } = await import("../lib/auth");
  const session = await getSession(cookieSid);
  if (!session) return res.json({ verified: false });

  const [user] = await db
    .select({ emailVerified: usersTable.emailVerified })
    .from(usersTable)
    .where(eq(usersTable.id, session.user.id));

  return res.json({ verified: user?.emailVerified ?? false });
});

// ─── Email Resend Verification ────────────────────────────────────────────────
router.post("/auth/email/resend-verify", async (req, res) => {
  const { email } = req.body as { email?: string };
  if (!email) return res.status(400).json({ error: "Email is required." });

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase().trim()));

  if (!user) return res.status(404).json({ error: "Account not found." });
  if (user.emailVerified) return res.json({ ok: true, alreadyVerified: true });

  const verifyToken = generateVerifyToken();
  const verifyTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await db
    .update(usersTable)
    .set({ emailVerifyToken: verifyToken, emailVerifyTokenExpiry: verifyTokenExpiry })
    .where(eq(usersTable.id, user.id));

  req.log.info({ email, verifyToken }, "Resend verify email (dev: token exposed)");

  return res.json({ ok: true, verifyToken });
});

// ─── Check Phone Exists (pre-OTP validation) ─────────────────────────────────
router.post("/auth/check-phone", async (req, res) => {
  const { phone, intent } = req.body as { phone?: string; intent?: "signup" | "signin" };
  if (!phone) return res.status(400).json({ error: "Phone is required." });

  const normalized = `+91${phone.replace(/\D/g, "")}`;
  const [user] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.phone, normalized));

  if (intent === "signup" && user) {
    return res.status(409).json({ exists: true, error: "Account already exists. Please Sign In." });
  }
  if (intent === "signin" && !user) {
    return res.status(404).json({ exists: false, error: "Account not found. Please Sign Up first." });
  }
  return res.json({ exists: !!user });
});

// ─── Phone Send OTP (with rate limiting) ─────────────────────────────────────
router.post("/auth/phone/send-otp", async (req, res) => {
  const { phone } = req.body as { phone?: string };
  if (!phone || phone.length < 8) {
    return res.status(400).json({ error: "A valid phone number is required." });
  }

  // Rate limit: max 5 OTPs per phone per hour
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const [{ value: recentCount }] = await db
    .select({ value: count() })
    .from(otpCodesTable)
    .where(
      and(
        eq(otpCodesTable.phone, phone),
        gt(otpCodesTable.createdAt, oneHourAgo),
      )
    );

  if (Number(recentCount) >= 5) {
    return res.status(429).json({ error: "Too many OTP requests. Please wait an hour before trying again." });
  }

  const code = generateOtp();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

  // Invalidate old active codes for this phone
  await db
    .update(otpCodesTable)
    .set({ used: true })
    .where(and(eq(otpCodesTable.phone, phone), eq(otpCodesTable.used, false)));

  await db.insert(otpCodesTable).values({ phone, code, expiresAt });

  req.log.info({ phone, code }, "OTP generated (dev mode — production needs SMS provider)");

  // In production: integrate Twilio / Firebase Auth / MSG91 for real SMS delivery
  return res.json({ ok: true, devOtp: code, expiresInSeconds: 600 });
});

// ─── Phone Verify OTP ─────────────────────────────────────────────────────────
router.post("/auth/phone/verify-otp", async (req, res) => {
  const { phone, otp } = req.body as { phone?: string; otp?: string };
  if (!phone || !otp) {
    return res.status(400).json({ error: "Phone and OTP are required." });
  }

  const [record] = await db
    .select()
    .from(otpCodesTable)
    .where(
      and(
        eq(otpCodesTable.phone, phone),
        eq(otpCodesTable.code, otp),
        eq(otpCodesTable.used, false),
        gt(otpCodesTable.expiresAt, new Date()),
      )
    )
    .limit(1);

  if (!record) {
    return res.status(401).json({ error: "Invalid or expired OTP. Please try again." });
  }

  await db
    .update(otpCodesTable)
    .set({ used: true })
    .where(eq(otpCodesTable.id, record.id));

  // Read optional sign-in-only mode flag from body
  const { isSignup } = req.body as { isSignup?: boolean };

  // Find existing user by phone
  let [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.phone, phone));

  if (!user) {
    if (isSignup === false) {
      // Login mode — do not create a new account
      return res.status(404).json({ error: "Account not found. Please sign up first." });
    }
    // Sign-up mode — create new account
    [user] = await db
      .insert(usersTable)
      .values({ phone, phoneVerified: true })
      .returning();
  } else if (!user.phoneVerified) {
    await db
      .update(usersTable)
      .set({ phoneVerified: true })
      .where(eq(usersTable.id, user.id));
    user.phoneVerified = true;
  }

  const sid = await createSession(buildSessionData(user));
  setSessionCookie(res, sid);

  return res.json({ ok: true, phoneVerified: true, ...(req.headers['x-mobile'] ? { token: sid } : {}) });
});

export default router;
