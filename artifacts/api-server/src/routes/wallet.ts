import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { profilesTable, transactionsTable, rechargeRequestsTable, usersTable } from "@workspace/db";
import { eq, desc, sql } from "@workspace/db";
import { ensureProfile } from "../lib/profile";
import { logger } from "../lib/logger";
import crypto from "crypto";

const router: IRouter = Router();

// ── Cashfree fetch with retry + timeout (resilient to network blips) ──────────
async function cfFetch(
  url: string,
  init: RequestInit & { timeoutMs?: number; retries?: number },
): Promise<Response> {
  const { timeoutMs = 12_000, retries = 2, ...fetchInit } = init;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...fetchInit, signal: ctrl.signal });
      clearTimeout(t);
      // Retry on 5xx server errors (transient). Don't retry on 4xx (client errors).
      if (res.status >= 500 && res.status < 600 && attempt < retries) {
        await new Promise(r => setTimeout(r, 300 * Math.pow(2, attempt)));
        continue;
      }
      return res;
    } catch (e) {
      clearTimeout(t);
      lastErr = e;
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 300 * Math.pow(2, attempt)));
        continue;
      }
    }
  }
  throw lastErr ?? new Error("Cashfree request failed after retries");
}

// ── Advisory lock helper — serialize concurrent webhook+polling for same order ─
async function withOrderLock<T>(orderId: string, fn: () => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    // PostgreSQL advisory lock keyed on hash(orderId). Held until transaction ends.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${orderId})::bigint)`);
    return fn();
  });
}

// ── Map Cashfree errors to user-friendly Hindi messages ──────────────────────
function friendlyCashfreeError(rawMsg: string, statusCode?: number): string {
  const m = rawMsg.toLowerCase();
  if (m.includes("invalid phone") || m.includes("customer_phone"))
    return "WhatsApp number sahi nahi hai. Profile mein update karein.";
  if (m.includes("invalid email") || m.includes("customer_email"))
    return "Email sahi nahi hai. Profile mein update karein.";
  if (m.includes("amount") && (m.includes("invalid") || m.includes("minimum")))
    return "Amount sahi nahi hai. Minimum ₹25 hai.";
  if (m.includes("unauthorized") || m.includes("authentication") || statusCode === 401)
    return "Payment gateway issue. Thodi der mein try karein.";
  if (m.includes("duplicate"))
    return "Yeh order pehle se bana hai. Refresh karein.";
  if (m.includes("rate limit") || statusCode === 429)
    return "Bahut requests aa rahi hain. 10 second baad try karein.";
  return rawMsg || "Payment create nahi hua. Dobara try karein.";
}

// ── GET /wallet ────────────────────────────────────────────────────────────────
router.get("/wallet", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const profile = await ensureProfile(req.user.id);
  const txs = await db
    .select()
    .from(transactionsTable)
    .where(eq(transactionsTable.userId, req.user.id))
    .orderBy(desc(transactionsTable.createdAt))
    .limit(40);
  res.json({
    balanceInRupees: profile.walletBalanceInRupees,
    transactions: txs.map((t) => ({
      id: String(t.id),
      userId: t.userId,
      userName: t.userName,
      kind: t.kind,
      amountInRupees: t.amountInRupees,
      balanceAfter: t.balanceAfter,
      description: t.description,
      createdAt: t.createdAt.toISOString(),
    })),
  });
});

// ── GET /wallet/recharge-requests — user's own requests (audit trail) ────────
router.get("/wallet/recharge-requests", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  const rows = await db
    .select()
    .from(rechargeRequestsTable)
    .where(eq(rechargeRequestsTable.userId, req.user.id))
    .orderBy(desc(rechargeRequestsTable.createdAt))
    .limit(20);

  res.json(rows.map(r => ({
    id: r.id,
    amountInRupees: r.amountInRupees,
    utrNumber: r.utrNumber,
    status: r.status,
    adminNote: r.adminNote,
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  })));
});

// ── helpers ──────────────────────────────────────────────────────────────────
function cashfreeBaseUrl() {
  const env = process.env["CASHFREE_ENV"] ?? "production";
  return env === "production"
    ? "https://api.cashfree.com/pg"
    : "https://sandbox.cashfree.com/pg";
}

function cashfreeHeaders() {
  return {
    "x-api-version": "2023-08-01",
    "x-client-id": process.env["CASHFREE_APP_ID"] ?? "",
    "x-client-secret": process.env["CASHFREE_SECRET_KEY"] ?? "",
    "Content-Type": "application/json",
  };
}

function cfConfigured() {
  return !!(process.env["CASHFREE_APP_ID"] && process.env["CASHFREE_SECRET_KEY"]);
}

// ── POST /wallet/cashfree/order — create Cashfree payment session ─────────────
router.post("/wallet/cashfree/order", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  if (!cfConfigured()) {
    res.status(503).json({ error: "Payment gateway not configured. Please contact support." }); return;
  }

  const { amountInRupees } = req.body as { amountInRupees?: number };
  const MIN_RECHARGE = 25;
  if (!amountInRupees || amountInRupees < MIN_RECHARGE) {
    res.status(400).json({ error: `Minimum recharge amount is ₹${MIN_RECHARGE}.` }); return;
  }

  const orderId = `SS_${req.user.id.slice(-8)}_${Date.now()}`;
  const [profile, userRow] = await Promise.all([
    ensureProfile(req.user.id),
    db.select({ phone: usersTable.phone, firstName: usersTable.firstName })
      .from(usersTable).where(eq(usersTable.id, req.user.id)).limit(1)
      .then(r => r[0] ?? null),
  ]);

  // Cashfree customer_phone MUST be a valid 10-digit Indian mobile number
  const waDigits = (profile.whatsappNumber ?? userRow?.phone ?? "").replace(/\D/g, "");
  const customerPhone = waDigits.length >= 10 ? waDigits.slice(-10) : "9999999999";

  // Use SS-XXXXXX display ID as customer_id (Cashfree-compliant: alphanumeric + hyphen, 3-50 chars)
  const customerId = profile.anonymousUsername ?? `SS-${req.user.id.slice(-6).toUpperCase()}`;

  const body = {
    order_id: orderId,
    order_amount: amountInRupees,
    order_currency: "INR",
    customer_details: {
      customer_id: customerId,
      customer_name: profile.anonymousUsername ?? userRow?.firstName ?? "SunoSathi User",
      customer_email: req.user.email ?? "user@sunosathi.com",
      customer_phone: customerPhone,
    },
    order_meta: {
      notify_url: "https://sunosathi.replit.app/api/wallet/cashfree/webhook",
      return_url: "https://sunosathi.replit.app/wallet?cf_order_id={order_id}&cf_payment_id={payment_id}&cf_signature={signature}",
    },
  };

  let cfRes: Response;
  try {
    cfRes = await cfFetch(`${cashfreeBaseUrl()}/orders`, {
      method: "POST",
      headers: cashfreeHeaders(),
      body: JSON.stringify(body),
      timeoutMs: 15_000,
      retries: 2,
    });
  } catch (e) {
    logger.error({ err: e, orderId, userId: req.user.id }, "Cashfree order create network error");
    res.status(503).json({ error: "Payment gateway abhi reachable nahi. 10 second baad try karein." }); return;
  }

  if (!cfRes.ok) {
    const errBody = await cfRes.json().catch(() => ({})) as Record<string, unknown>;
    const rawMsg = (errBody["message"] as string) ?? (errBody["error"] as string) ?? "";
    const friendly = friendlyCashfreeError(rawMsg, cfRes.status);
    logger.error({ status: cfRes.status, errBody, orderId, userId: req.user.id }, "Cashfree order create failed");
    res.status(502).json({ error: friendly }); return;
  }

  const order = await cfRes.json() as { order_id: string; payment_session_id: string; payment_link?: string };
  const cfEnv = process.env["CASHFREE_ENV"] ?? "production";
  // Build a reliable checkout URL even if Cashfree doesn't return payment_link
  const checkoutBase = cfEnv === "production"
    ? "https://payments.cashfree.com/order/#"
    : "https://payments-test.cashfree.com/order/#";
  const paymentLink = order.payment_link ?? `${checkoutBase}${order.payment_session_id}`;

  res.json({
    orderId: order.order_id,
    paymentSessionId: order.payment_session_id,
    paymentLink,
    amountInRupees,
    env: cfEnv,
  });
});

// ── GET /wallet/cashfree/order-status/:orderId — read-only status poll ────────
// Used by APK to poll order status without crediting the wallet.
// Wallet credit only happens in /verify (called once polling detects PAID).
router.get("/wallet/cashfree/order-status/:orderId", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  if (!cfConfigured()) { res.status(503).json({ error: "Not configured" }); return; }

  const { orderId } = req.params as { orderId: string };
  // Sanity check — only allow order IDs belonging to this user
  if (!orderId || !orderId.startsWith("SS_")) {
    res.status(400).json({ error: "Invalid order ID" }); return;
  }

  let cfRes: Response;
  try {
    cfRes = await cfFetch(`${cashfreeBaseUrl()}/orders/${orderId}`, {
      method: "GET",
      headers: cashfreeHeaders(),
      timeoutMs: 8_000,
      retries: 1, // poll is called every 3s, don't over-retry
    });
  } catch {
    res.status(504).json({ error: "Timeout checking order" }); return;
  }

  if (!cfRes.ok) { res.status(400).json({ error: "Could not fetch order" }); return; }

  const order = await cfRes.json() as { order_status: string; order_id: string };
  res.json({ status: order.order_status }); // ACTIVE | PAID | EXPIRED | CANCELLED
});

// ── POST /wallet/cashfree/verify — verify payment after checkout ──────────────
// Called by frontend after Cashfree SDK returns success.
// We re-verify with Cashfree API (don't trust client alone).
router.post("/wallet/cashfree/verify", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }

  if (!cfConfigured()) {
    res.status(503).json({ error: "Payment gateway not configured." }); return;
  }

  const { orderId, amountInRupees: clientAmount } = req.body as { orderId?: string; amountInRupees?: number };
  if (!orderId) {
    res.status(400).json({ error: "Missing order ID." }); return;
  }

  let cfRes: Response;
  try {
    cfRes = await cfFetch(`${cashfreeBaseUrl()}/orders/${orderId}`, {
      method: "GET",
      headers: cashfreeHeaders(),
      timeoutMs: 10_000,
      retries: 2,
    });
  } catch (e) {
    logger.error({ err: e, orderId, userId: req.user.id }, "Verify network error");
    res.status(504).json({ error: "Payment gateway timeout. Thodi der mein dobara try karein." }); return;
  }

  if (!cfRes.ok) {
    res.status(400).json({ error: "Payment verify nahi ho saka. Support se contact karein." }); return;
  }

  const order = await cfRes.json() as { order_status: string; order_id: string; order_amount: number };

  if (order.order_status !== "PAID") {
    res.status(400).json({ error: `Payment abhi confirm nahi. Status: ${order.order_status}` }); return;
  }

  // Use Cashfree's authoritative amount (ignore client-supplied value to prevent manipulation)
  const amountInRupees = Math.round(order.order_amount) || (clientAmount ?? 0);
  if (!amountInRupees) {
    res.status(400).json({ error: "Payment amount nahi mil saka." }); return;
  }

  // Race-safe credit: advisory lock per-orderId serializes concurrent webhook+polling
  let alreadyCredited = false;
  let newBalance = 0;
  try {
    newBalance = await withOrderLock(orderId, async () => {
      // Re-check inside lock — only one caller will pass through
      const existingRows = await db
        .select({ id: rechargeRequestsTable.id })
        .from(rechargeRequestsTable)
        .where(eq(rechargeRequestsTable.utrNumber, orderId))
        .limit(1);

      if (existingRows.length > 0) {
        alreadyCredited = true;
        const p = await ensureProfile(req.user.id);
        return p.walletBalanceInRupees;
      }

      const profile = await ensureProfile(req.user.id);
      const next = profile.walletBalanceInRupees + amountInRupees;

      await db.transaction(async (tx) => {
        await tx.update(profilesTable)
          .set({ walletBalanceInRupees: next, updatedAt: new Date() })
          .where(eq(profilesTable.userId, req.user.id));

        await tx.insert(transactionsTable).values({
          userId: req.user.id,
          userName: profile.anonymousUsername,
          kind: "recharge",
          amountInRupees,
          balanceAfter: next,
          description: `Cashfree Recharge ₹${amountInRupees} (Order: ${orderId})`,
        });

        await tx.insert(rechargeRequestsTable).values({
          userId: req.user.id,
          amountInRupees,
          utrNumber: orderId,
          status: "approved",
          decidedAt: new Date(),
        });
      });

      logger.info({ orderId, userId: req.user.id, amountInRupees, newBalance: next }, "Wallet credited via verify");
      return next;
    });
  } catch (e) {
    logger.error({ err: e, orderId, userId: req.user.id }, "Verify credit failed");
    res.status(500).json({ error: "Credit fail hua. Webhook se 1 minute mein auto-credit ho jayega." }); return;
  }

  res.json({ success: true, newBalance, alreadyCredited });
});

// ── POST /wallet/cashfree/webhook — Cashfree server-to-server webhook ─────────
// Cashfree sends this even if the user closes the app mid-payment.
// Signature: base64(HMAC-SHA256(timestamp + rawBody, secretKey))
router.post("/wallet/cashfree/webhook", async (req, res) => {
  const secret = process.env["CASHFREE_SECRET_KEY"];
  if (!secret) { res.status(503).send("Not configured"); return; }

  const timestamp = req.headers["x-webhook-timestamp"] as string;
  const receivedSig = req.headers["x-webhook-signature"] as string;

  if (!timestamp || !receivedSig) {
    res.status(400).send("Missing signature headers"); return;
  }

  // rawBody is populated by express.raw() middleware registered before this route
  const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
  const bodyStr = rawBody ? rawBody.toString("utf8") : JSON.stringify(req.body);

  const expectedSig = crypto
    .createHmac("sha256", secret)
    .update(timestamp + bodyStr)
    .digest("base64");

  if (expectedSig !== receivedSig) {
    res.status(400).send("Invalid signature"); return;
  }

  type WebhookData = {
    type: string;
    data?: {
      order?: { order_id?: string; order_amount?: number; order_status?: string };
      customer_details?: { customer_id?: string };
    };
  };
  const payload = req.body as WebhookData;

  if (payload.type !== "PAYMENT_SUCCESS_WEBHOOK") {
    res.status(200).send("ok"); return;
  }

  const orderId = payload.data?.order?.order_id;
  const orderAmount = payload.data?.order?.order_amount;
  const customerId = payload.data?.customer_details?.customer_id;

  if (!orderId || !orderAmount || !customerId) {
    res.status(200).send("ok"); return;
  }

  // customer_id is the SS-XXXXXX display id (anonymousUsername). Fall back to userId
  // lookup for any legacy in-flight orders created before this mapping change.
  let profiles = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.anonymousUsername, customerId))
    .limit(1);

  if (profiles.length === 0) {
    profiles = await db
      .select()
      .from(profilesTable)
      .where(eq(profilesTable.userId, customerId))
      .limit(1);
  }

  if (profiles.length === 0) {
    logger.warn({ orderId, customerId }, "Webhook profile not found");
    res.status(200).send("ok"); return;
  }

  const profile = profiles[0]!;
  const amountInRupees = Math.round(orderAmount);

  // Race-safe credit: advisory lock per-orderId serializes concurrent webhook+polling
  try {
    await withOrderLock(orderId, async () => {
      const existingRows = await db
        .select({ id: rechargeRequestsTable.id })
        .from(rechargeRequestsTable)
        .where(eq(rechargeRequestsTable.utrNumber, orderId))
        .limit(1);
      if (existingRows.length > 0) {
        logger.info({ orderId }, "Webhook: already credited, skipping");
        return;
      }

      // Re-read profile to get fresh balance under lock (verify might have credited)
      const [freshProfile] = await db
        .select()
        .from(profilesTable)
        .where(eq(profilesTable.userId, profile.userId))
        .limit(1);
      const baseBalance = freshProfile?.walletBalanceInRupees ?? profile.walletBalanceInRupees;
      const newBalance = baseBalance + amountInRupees;

      await db.transaction(async (tx) => {
        await tx.update(profilesTable)
          .set({ walletBalanceInRupees: newBalance, updatedAt: new Date() })
          .where(eq(profilesTable.userId, profile.userId));

        await tx.insert(transactionsTable).values({
          userId: profile.userId,
          userName: profile.anonymousUsername,
          kind: "recharge",
          amountInRupees,
          balanceAfter: newBalance,
          description: `Cashfree Recharge ₹${amountInRupees} (Webhook: ${orderId})`,
        });

        await tx.insert(rechargeRequestsTable).values({
          userId: profile.userId,
          amountInRupees,
          utrNumber: orderId,
          status: "approved",
          decidedAt: new Date(),
        });
      });

      logger.info({ orderId, userId: profile.userId, amountInRupees, newBalance }, "Wallet credited via webhook");
    });
  } catch (e) {
    logger.error({ err: e, orderId }, "Webhook credit failed");
    // Return 200 anyway — Cashfree will not retry if we return 4xx/5xx, but we want them to retry
    // Actually, return 500 so Cashfree retries the webhook
    res.status(500).send("Internal error, please retry"); return;
  }

  res.status(200).send("ok");
});

export default router;
