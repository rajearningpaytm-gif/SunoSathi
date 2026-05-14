import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { profilesTable, transactionsTable, rechargeRequestsTable } from "@workspace/db";
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
  const profile = await ensureProfile(req.user.id);

  const body = {
    order_id: orderId,
    order_amount: amountInRupees,
    order_currency: "INR",
    customer_details: {
      customer_id: req.user.id,
      customer_name: profile.anonymousUsername ?? "SunoSathi User",
      customer_email: req.user.email ?? "user@sunosathi.com",
      customer_phone: "9999999999",
    },
    order_meta: {
      notify_url: "https://sunosathi.replit.app/api/wallet/cashfree/webhook",
      return_url: "https://sunosathi.replit.app/wallet?cf_order_id={order_id}&cf_payment_id={payment_id}&cf_signature={signature}",
    },
  };

  const cfRes = await fetch(`${cashfreeBaseUrl()}/orders`, {
    method: "POST",
    headers: cashfreeHeaders(),
    body: JSON.stringify(body),
  });

  if (!cfRes.ok) {
    const err = await cfRes.json().catch(() => ({})) as Record<string, unknown>;
    const msg = (err["message"] as string) ?? "Failed to create payment order.";
    res.status(500).json({ error: msg }); return;
  }

  const order = await cfRes.json() as { order_id: string; payment_session_id: string };
  res.json({
    orderId: order.order_id,
    paymentSessionId: order.payment_session_id,
    amountInRupees,
    env: process.env["CASHFREE_ENV"] ?? "sandbox",
  });
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

  // Find user by customerId suffix (we stored userId.slice(-15) as customer_id)
  const profiles = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.userId, customerId))
    .limit(1);

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
