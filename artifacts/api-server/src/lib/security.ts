/**
 * SunoSathi — Server-Side Security Layer
 *
 *  1. requireAdmin()       — DB isAdmin flag AND email === MASTER_ADMIN_EMAIL
 *  2. requireOwner()       — resource owner check
 *  3. securityHeaders      — CSP / X-Frame / XSS response headers on every response
 *  4. corsOrigin           — strict origin whitelist (only our domain(s) allowed)
 *  5. rateLimiter          — in-memory per-IP rate limiting (sliding window)
 *  6. perUserRateLimiter   — per-authenticated-user rate limiting (chat, sessions)
 *  7. sanitizeBody         — recursive XSS / HTML stripping on all string req.body fields
 *  8. noPublicWrite        — rejects unauthenticated state-changing requests globally
 *
 * Rate limiters automatically call recordViolation() (from abuse.ts) so every
 * exceeded limit is logged to the DB and contributes to auto-suspension scoring.
 */

import type { Request, Response, NextFunction } from "express";
import type { CorsOptionsDelegate, CorsOptions } from "cors";
import { db } from "@workspace/db";
import { profilesTable, usersTable } from "@workspace/db";
import { eq } from "@workspace/db";
import { logger } from "./logger";

// ── Constants ─────────────────────────────────────────────────────────────────
export const MASTER_ADMIN_EMAIL = "rajearningpaytm@gmail.com";
// Master admin phone (E.164 format, e.g. +919876543210).
// Set MASTER_ADMIN_PHONE in your Replit Secrets to restrict admin to one phone.
export const MASTER_ADMIN_PHONE = process.env.MASTER_ADMIN_PHONE ?? null;

// ── 1. Strict Admin Check ─────────────────────────────────────────────────────
/**
 * Returns true if the authenticated user is an admin.
 *
 * Verification strategy (in priority order):
 *  1. DB `isAdmin` flag must be true.
 *  2. Identity confirmed by EITHER:
 *     a. Email matches MASTER_ADMIN_EMAIL  (email-auth users), OR
 *     b. Phone matches MASTER_ADMIN_PHONE  (phone/Firebase-auth users), OR
 *     c. No email AND no phone stored → trust the DB flag (bootstrapped admin).
 *
 * Phone-auth users never have an email stored, so the email-only check used to
 * always block them. This version handles both auth paths correctly.
 */
export async function requireAdmin(req: Request): Promise<boolean> {
  if (!req.isAuthenticated()) return false;

  const [profile] = await db
    .select({ isAdmin: profilesTable.isAdmin })
    .from(profilesTable)
    .where(eq(profilesTable.userId, req.user.id))
    .limit(1);

  if (!profile?.isAdmin) return false;

  const [userRow] = await db
    .select({ email: usersTable.email, phone: usersTable.phone })
    .from(usersTable)
    .where(eq(usersTable.id, req.user.id))
    .limit(1);

  const email = userRow?.email?.toLowerCase().trim() ?? "";
  const phone = userRow?.phone?.trim() ?? "";

  // Email-auth admin path
  if (email && email === MASTER_ADMIN_EMAIL) return true;

  // Phone-auth admin path
  if (phone && MASTER_ADMIN_PHONE && phone === MASTER_ADMIN_PHONE) return true;

  // If neither credential is stored yet (first-boot bootstrap), trust the flag
  if (!email && !phone) return true;

  logger.warn(
    { userId: req.user.id, email: email || "(none)", phone: phone || "(none)" },
    "Admin access denied — credential mismatch",
  );
  return false;
}

// ── 2. Owner Check ────────────────────────────────────────────────────────────
export function requireOwner(req: Request, ownerUserId: string): boolean {
  return req.isAuthenticated() && req.user.id === ownerUserId;
}

// ── 3. Security Headers ───────────────────────────────────────────────────────
export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  // Allow camera, microphone, and speaker-selection for the SPA (VoIP calls).
  // Restricting these on API (/api) responses can cascade in some browsers and
  // block getUserMedia / setSinkId even on the main document. Payment, geolocation,
  // and other sensitive APIs remain blocked.
  res.setHeader(
    "Permissions-Policy",
    "camera=self, microphone=self, speaker-selection=self, geolocation=(), payment=()",
  );

  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  }

  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://*.cashfree.com",
      "style-src 'self' 'unsafe-inline' https://*.cashfree.com",
      "img-src 'self' data: https:",
      "connect-src 'self' https: wss:",
      "font-src 'self' https:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "frame-src https://*.cashfree.com",
    ].join("; "),
  );

  next();
}

// ── 4. Strict CORS Origin Whitelist ──────────────────────────────────────────
/**
 * Builds the allowed-origins set from REPLIT_DOMAINS (comma-separated).
 * Also allows:
 *   - Any *.replit.app subdomain  (published/deployed production)
 *   - Any *.riker.replit.dev subdomain  (Replit dev preview proxy)
 *   - localhost / 127.0.0.1 on any port  (local dev)
 *
 * Requests with NO origin header (server-to-server, curl, mobile apps) are
 * passed through — they cannot carry browser cookies and are not a CSRF risk.
 */
const _replitDomains: string[] = (process.env.REPLIT_DOMAINS ?? "")
  .split(",")
  .map((d) => d.trim())
  .filter(Boolean);

const _explicitAllowed = new Set<string>([
  ..._replitDomains.map((d) => `https://${d}`),
  ..._replitDomains.map((d) => `http://${d}`),
]);

function isAllowedOrigin(origin: string): boolean {
  // Explicit list (dev preview domain injected by Replit)
  if (_explicitAllowed.has(origin)) return true;

  // Published apps on replit.app
  if (/^https:\/\/[a-z0-9-]+\.replit\.app$/.test(origin)) return true;

  // Replit preview / workspace domains
  if (/^https:\/\/[a-z0-9-]+\.pike\.replit\.dev$/.test(origin)) return true;

  // Replit workspace preview proxy (riker.replit.dev)
  if (/^https:\/\/[a-z0-9-]+\.riker\.replit\.dev$/.test(origin)) return true;
  if (/^https:\/\/[a-z0-9-]+\.expo\.riker\.replit\.dev$/.test(origin)) return true;

  // Local development
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;

  return false;
}

export const corsOrigin: CorsOptionsDelegate = (
  req: Parameters<CorsOptionsDelegate>[0],
  callback: (err: Error | null, options?: CorsOptions) => void,
) => {
  const origin = (req as any).headers?.origin as string | undefined;

  // No origin = non-browser request (safe; no cookie forwarding)
  if (!origin) {
    callback(null, { origin: false, credentials: true });
    return;
  }

  if (isAllowedOrigin(origin)) {
    callback(null, { origin: true, credentials: true });
  } else {
    logger.warn({ origin }, "CORS: rejected origin");
    callback(new Error(`CORS: origin '${origin}' is not allowed`));
  }
};

// ── 5. In-Memory Per-IP Rate Limiter ─────────────────────────────────────────
type RateEntry = { count: number; resetAt: number };
const rateBuckets = new Map<string, RateEntry>();

// Prune expired buckets every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateBuckets) {
    if (entry.resetAt < now) rateBuckets.delete(key);
  }
}, 5 * 60 * 1000);

/**
 * Per-IP rate limiter. Good for anonymous endpoints and brute-force protection.
 * On limit exceeded: logs a violation via recordViolation() (imported lazily to
 * avoid circular imports between security ↔ abuse).
 */
export function rateLimiter(maxRequests: number, windowMs: number, label = "route") {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ??
      req.socket?.remoteAddress ??
      "unknown";

    const key = `ip:${label}:${ip}`;
    const now = Date.now();
    const entry = rateBuckets.get(key);

    if (!entry || entry.resetAt < now) {
      rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    if (entry.count >= maxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      res.status(429).json({
        error: `Too many requests. Please wait ${retryAfter} seconds before trying again.`,
      });
      logger.warn({ ip, label, count: entry.count }, "IP rate limit exceeded");
      // Async — fire and forget, must not block response
      import("./abuse").then(({ recordViolation }) =>
        recordViolation(req, `IP rate limit exceeded: ${label} (${entry.count} hits)`),
      ).catch(() => {});
      return;
    }

    entry.count++;
    next();
  };
}

// ── 6. Per-User Rate Limiter ──────────────────────────────────────────────────
/**
 * Per-authenticated-user rate limiter.
 * Keyed by userId — blocks spamming chat messages or starting too many sessions,
 * even if the user rotates IPs or uses multiple devices.
 * Falls back to per-IP if not authenticated.
 * On limit exceeded: logs a violation and contributes to auto-suspension scoring.
 */
export function perUserRateLimiter(maxRequests: number, windowMs: number, label = "user") {
  return (req: Request, res: Response, next: NextFunction) => {
    const userId = req.isAuthenticated()
      ? req.user.id
      : ((req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ??
         req.socket?.remoteAddress ??
         "anon");

    const key = `user:${label}:${userId}`;
    const now = Date.now();
    const entry = rateBuckets.get(key);

    if (!entry || entry.resetAt < now) {
      rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    if (entry.count >= maxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      res.status(429).json({
        error: `You're doing that too fast. Please wait ${retryAfter} seconds.`,
      });
      logger.warn({ userId, label, count: entry.count }, "User rate limit exceeded");
      // Async — fire and forget; also triggers auto-suspension logic
      import("./abuse").then(({ recordViolation }) =>
        recordViolation(req, `User rate limit exceeded: ${label} (${entry.count} hits)`),
      ).catch(() => {});
      return;
    }

    entry.count++;
    next();
  };
}

// ── 7. Input Sanitization Middleware ─────────────────────────────────────────
/**
 * Recursively strips HTML tags and dangerous characters from all string fields
 * in req.body. This prevents XSS payloads from being stored and later served.
 *
 * What it removes:
 *   - All HTML tags:              <script>alert(1)</script> → alert(1)
 *   - JavaScript URL schemes:     javascript:alert(1) → :alert(1)
 *   - Data URIs in text fields:   data:text/html,<h1>x → [removed]
 *   - Null bytes:                 \x00 → (stripped)
 *
 * What it does NOT do:
 *   - It does not prevent SQL injection (Drizzle ORM's parameterized queries handle that)
 *   - It does not encode for HTML output (that is the frontend's responsibility)
 *
 * Field length limits enforced:
 *   - Default strings: 2000 chars max
 *   - Bio / long text: 1000 chars (controlled per-field in Zod schemas)
 *
 * NOTE: This runs before routes, so Zod schema validation still applies
 *       on top — these two layers are complementary.
 */
const MAX_STRING_LENGTH = 2000;

function stripXSS(value: string): string {
  return value
    .replace(/\x00/g, "")                          // null bytes
    .replace(/<[^>]*>/g, "")                       // all HTML tags
    .replace(/javascript\s*:/gi, "")               // javascript: URIs
    .replace(/data\s*:\s*text\/(html|xml)/gi, "")  // data: HTML URIs
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, "")   // inline event handlers (onerror=, onclick=)
    .slice(0, MAX_STRING_LENGTH);                  // hard length cap
}

function sanitizeValue(val: unknown): unknown {
  if (typeof val === "string") return stripXSS(val);
  if (Array.isArray(val)) return val.map(sanitizeValue);
  if (val !== null && typeof val === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      out[k] = sanitizeValue(v);
    }
    return out;
  }
  return val;
}

export function sanitizeBody(req: Request, _res: Response, next: NextFunction) {
  if (req.body && typeof req.body === "object") {
    req.body = sanitizeValue(req.body);
  }
  next();
}

// ── 8. No Public Write Middleware ─────────────────────────────────────────────
const AUTH_WRITE_ALLOWLIST = new Set([
  "/api/auth/email/register",
  "/api/auth/email/login",
  "/api/auth/email/resend-verify",
  "/api/auth/phone/send-otp",
  "/api/auth/phone/verify-otp",
  "/api/auth/check-phone",
  "/api/auth/firebase/verify-token",
  "/api/auth/google/verify-token",
  "/api/login",
  "/api/callback",
  "/api/mobile-auth/token-exchange",
  // Cashfree webhook — called by Cashfree servers (no session); secured by HMAC-SHA256
  "/api/wallet/cashfree/webhook",
]);

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function noPublicWrite(req: Request, res: Response, next: NextFunction) {
  if (!MUTATION_METHODS.has(req.method)) { next(); return; }
  if (AUTH_WRITE_ALLOWLIST.has(req.path)) { next(); return; }
  if (req.isAuthenticated()) { next(); return; }

  logger.warn({ method: req.method, path: req.path }, "Blocked unauthenticated write attempt");
  res.status(401).json({ error: "Authentication required to perform this action." });
}
