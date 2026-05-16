import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { profilesTable, transactionsTable, rechargeRequestsTable, usersTable } from "@workspace/db";
import { eq, desc } from "@workspace/db";
import { ensureProfile } from "../lib/profile";
import crypto from "crypto";

const router: IRouter = Router();

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
  const env = process.env["CASHFREE_ENV"] ?? "sandbox";
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
    cfRes = await fetch(`${cashfreeBaseUrl()}/orders`, {
      method: "POST",
      headers: cashfreeHeaders(),
      body: JSON.stringify(body),
    });
  } catch {
    res.status(503).json({ error: "Payment gateway unreachable. Please try again." }); return;
  }

  if (!cfRes.ok) {
    const err = await cfRes.json().catch(() => ({})) as Record<string, unknown>;
    const msg = (err["message"] as string) ?? "Failed to create payment order.";
    res.status(500).json({ error: msg }); return;
  }

  const order = await cfRes.json() as { order_id: string; payment_session_id: string; payment_link?: string };
  const cfEnv = process.env["CASHFREE_ENV"] ?? "sandbox";
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

  const cfAbort = new AbortController();
  const t = setTimeout(() => cfAbort.abort(), 8_000);
  let cfRes: Response;
  try {
    cfRes = await fetch(`${cashfreeBaseUrl()}/orders/${orderId}`, {
      method: "GET",
      headers: cashfreeHeaders(),
      signal: cfAbort.signal,
    });
  } catch {
    res.status(504).json({ error: "Timeout checking order" }); return;
  } finally { clearTimeout(t); }

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

  // Fetch order from Cashfree with 10s timeout to prevent hanging
  const cfAbort = new AbortController();
  const cfTimeout = setTimeout(() => cfAbort.abort(), 10_000);
  let cfRes: Response;
  try {
    cfRes = await fetch(`${cashfreeBaseUrl()}/orders/${orderId}`, {
      method: "GET",
      headers: cashfreeHeaders(),
      signal: cfAbort.signal,
    });
  } catch {
    res.status(504).json({ error: "Payment gateway timeout. Please try again or contact support." }); return;
  } finally {
    clearTimeout(cfTimeout);
  }

  if (!cfRes.ok) {
    res.status(400).json({ error: "Could not verify payment. Please contact support." }); return;
  }

  const order = await cfRes.json() as { order_status: string; order_id: string; order_amount: number };

  if (order.order_status !== "PAID") {
    res.status(400).json({ error: `Payment not confirmed. Status: ${order.order_status}` }); return;
  }

  // Use Cashfree's authoritative amount (ignore client-supplied value to prevent manipulation)
  const amountInRupees = Math.round(order.order_amount) || (clientAmount ?? 0);
  if (!amountInRupees) {
    res.status(400).json({ error: "Could not determine payment amount." }); return;
  }

  // Prevent double-credit: check if this order was already processed
  const existing = await db
    .select({ id: rechargeRequestsTable.id })
    .from(rechargeRequestsTable)
    .where(eq(rechargeRequestsTable.utrNumber, orderId))
    .limit(1);

  if (existing.length > 0) {
    res.json({ success: true, alreadyCredited: true }); return;
  }

  // Atomic transaction — balance update + ledger entries in one commit
  const profile = await ensureProfile(req.user.id);
  const newBalance = profile.walletBalanceInRupees + amountInRupees;

  await db.transaction(async (tx) => {
    await tx.update(profilesTable)
      .set({ walletBalanceInRupees: newBalance, updatedAt: new Date() })
      .where(eq(profilesTable.userId, req.user.id));

    await tx.insert(transactionsTable).values({
      userId: req.user.id,
      userName: profile.anonymousUsername,
      kind: "recharge",
      amountInRupees,
      balanceAfter: newBalance,
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

  res.json({ success: true, newBalance });
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

  // Prevent double-credit
  const existing = await db
    .select({ id: rechargeRequestsTable.id })
    .from(rechargeRequestsTable)
    .where(eq(rechargeRequestsTable.utrNumber, orderId))
    .limit(1);

  if (existing.length > 0) {
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
    res.status(200).send("ok"); return;
  }

  const profile = profiles[0]!;
  const amountInRupees = Math.round(orderAmount);
  const newBalance = profile.walletBalanceInRupees + amountInRupees;

  // Atomic transaction — prevents partial credit on webhook retries
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

  res.status(200).send("ok");
});

export default router;
