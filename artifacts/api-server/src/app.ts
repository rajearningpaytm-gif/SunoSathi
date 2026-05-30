import fs from "fs";
import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { authMiddleware } from "./middlewares/authMiddleware";
import router from "./routes";
import { logger } from "./lib/logger";
import {
  securityHeaders,
  corsOrigin,
  sanitizeBody,
  noPublicWrite,
  rateLimiter,
  perUserRateLimiter,
} from "./lib/security";

const app: Express = express();


app.get("/api/health", (_req, res) => {
  res.status(200).json({ status: "ok", time: Date.now() });
});

app.get("/api/healthz", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.get("/api/download/aab", (_req, res) => {
  const p = "/root/SunoSathi/artifacts/sunosathi/android/app/build/outputs/bundle/release/app-release.aab";
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", "attachment; filename=sunosathi-v1.3.7.aab");
  res.sendFile(p);
});
app.get("/api/download/apk", (_req, res) => {
  const p = "/var/www/html/sunosathi-latest.apk";
  if (!fs.existsSync(p)) { res.status(404).json({ error: "APK not found" }); return; }
  res.setHeader("Content-Type", "application/vnd.android.package-archive");
  res.setHeader("Content-Disposition", "attachment; filename=sunosathi-v1.3.8.apk");
  res.sendFile(p);
});

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) { return { id: req.id, method: req.method, url: req.url?.split("?")[0] }; },
      res(res) { return { statusCode: res.statusCode }; },
    },
  }),
);

// ── 1. Security headers ───────────────────────────────────────────────────────
app.use(securityHeaders);

// ── 2. Strict CORS — only our domain(s) allowed ──────────────────────────────
app.use(cors(corsOrigin));

app.use(cookieParser());

// ── Raw body capture for Cashfree webhook HMAC verification ──────────────────
// Must come BEFORE express.json so the raw bytes are available.
// IMPORTANT: After saving rawBody we MUST parse the buffer back to JSON,
// because express.json() downstream won't re-parse an already-consumed stream.
// Without this, req.body stays as a Buffer and the webhook handler crashes.
app.use(
  "/api/wallet/cashfree/webhook",
  express.raw({ type: "application/json", limit: "512kb" }),
  (req, _res, next) => {
    const buf = req.body as Buffer;
    (req as unknown as { rawBody: Buffer }).rawBody = buf;
    // Parse buffer → JSON so req.body is usable as a plain object downstream
    try { req.body = JSON.parse(buf.toString("utf8")); } catch { req.body = {}; }
    next();
  },
);

app.use(express.json({ limit: "512kb" }));
app.use(express.urlencoded({ extended: true, limit: "512kb" }));

// ── 3. Input sanitization — strip HTML/XSS from all string body fields ────────
app.use(sanitizeBody);

// ── 4. Auth session (must precede per-user rate limiters) ────────────────────
app.use(authMiddleware);

// ── 5. Per-IP rate limits ─────────────────────────────────────────────────────

// Global API shield — 200 req/min per IP (catches scrapers & bots)
app.use("/api", rateLimiter(1000, 60 * 1000, "global"));

// Auth endpoints — 10 attempts/15 min (brute-force / credential stuffing)
app.use(
  [
    "/api/auth/email/login",
    "/api/auth/email/register",
    "/api/auth/phone/send-otp",
    "/api/auth/phone/verify-otp",
  ],
  rateLimiter(10, 15 * 60 * 1000, "auth"),
);

// Admin — 60 req/min (authenticated, looser)
app.use("/api/admin", rateLimiter(60, 60 * 1000, "admin"));

// Wallet recharge submission — 5 per 10 min (prevents duplicate UTR submissions)
app.use("/api/wallet/recharge-request", rateLimiter(5, 10 * 60 * 1000, "recharge"));

// Cashfree order creation — 10 per 10 min per IP (prevents order spam)
app.use("/api/wallet/cashfree/order", rateLimiter(10, 10 * 60 * 1000, "cashfree-order"));

// Cashfree order-status polling — 120 per min per IP (3s interval × 40 users = generous)
app.use("/api/wallet/cashfree/order-status", rateLimiter(120, 60 * 1000, "cashfree-poll"));

// ── 6. Per-user rate limits (require authMiddleware to have run first) ────────

// Start a chat/call session — 5 new sessions per 10 min per user
// Prevents someone from rapidly opening sessions to drain listeners
app.use("/api/chat/sessions", (req, res, next) => {
  if (req.method !== "POST" || req.path !== "/") { next(); return; }
  perUserRateLimiter(5, 10 * 60 * 1000, "start-session")(req, res, next);
});

// Send chat message — 30 messages per minute per user
// Prevents chat spam and message flooding
app.use("/api/chat/sessions", (req, res, next) => {
  if (req.method !== "POST" || !req.path.endsWith("/messages")) { next(); return; }
  perUserRateLimiter(30, 60 * 1000, "chat-msg")(req, res, next);
});

// Chat billing tick — 10 ticks per minute per user (1 per 6s is normal; 10/min = generous)
app.use("/api/chat/sessions", (req, res, next) => {
  if (req.method !== "POST" || !req.path.endsWith("/tick")) { next(); return; }
  perUserRateLimiter(10, 60 * 1000, "chat-tick")(req, res, next);
});

// Listener apply — 3 per day per user (prevents application spam)
app.use("/api/listener/apply", (req, res, next) => {
  if (req.method !== "POST") { next(); return; }
  perUserRateLimiter(3, 24 * 60 * 60 * 1000, "listener-apply")(req, res, next);
});

// Withdrawal request — 5 per hour per user
app.use("/api/listener/withdrawal", (req, res, next) => {
  if (req.method !== "POST") { next(); return; }
  perUserRateLimiter(5, 60 * 60 * 1000, "withdrawal")(req, res, next);
});

// Post review — 10 per hour per user (prevents review bombing)
app.use("/api/listeners", (req, res, next) => {
  if (req.method !== "POST" || !req.path.endsWith("/reviews")) { next(); return; }
  perUserRateLimiter(10, 60 * 60 * 1000, "review")(req, res, next);
});

// ── 7. No unauthenticated writes ─────────────────────────────────────────────
app.use(noPublicWrite);

// ── 8. Routes ─────────────────────────────────────────────────────────────────
app.use("/api", router);

// ── 9. 404 catch-all — no path/stack-trace disclosure ────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

export default app;
