import { Router, type IRouter, type Request } from "express";
import { db } from "@workspace/db";
import {
  listenersTable,
  profilesTable,
  transactionsTable,
  chatSessionsTable,
  chatMessagesTable,
  reviewsTable,
  usersTable,
  rechargeRequestsTable,
  withdrawalRequestsTable,
  adminAuditLogsTable,
  callbackRequestsTable,
  pendingAdminActionsTable,
  bannedDevicesTable,
  safetyReportsTable,
  listenerBlocksTable,
} from "@workspace/db";
import {
  DecideListenerApplicationBody,
  DecideListenerApplicationParams,
} from "@workspace/api-zod";
import { and, count, desc, eq, gte, inArray, lt, sql } from "@workspace/db";
import { requireAdmin } from "../lib/security";
import { logAdminAction } from "../lib/audit";

const router: IRouter = Router();

// ── Admin PIN verify endpoint ─────────────────────────────────────────────────
// FAILED-ONLY rate limit: 5 wrong PIN attempts per IP per 10 min trigger 429.
// Successful PIN entries clear the counter, so legitimate owners are never
// locked out by routine repeated unlocks.
const _pinFailures = new Map<string, { count: number; firstAt: number }>();
const PIN_WINDOW_MS = 10 * 60 * 1000;
const PIN_MAX_FAILURES = 5;

function pinClientIp(req: Request): string {
  const fwd = req.headers["x-forwarded-for"];
  const fromHeader = Array.isArray(fwd) ? fwd[0] : fwd?.split(",")[0]?.trim();
  return fromHeader ?? req.socket?.remoteAddress ?? "unknown";
}

router.post("/admin/verify-pin", async (req, res) => {
  const ok = await requireAdmin(req);
  if (!ok) { res.status(req.isAuthenticated() ? 403 : 401).json({ error: "Forbidden" }); return; }

  const ip = pinClientIp(req);
  const now = Date.now();
  const bucket = _pinFailures.get(ip);
  if (bucket && now - bucket.firstAt < PIN_WINDOW_MS && bucket.count >= PIN_MAX_FAILURES) {
    const retryAfter = Math.ceil((bucket.firstAt + PIN_WINDOW_MS - now) / 1000);
    res.setHeader("Retry-After", String(retryAfter));
    res.status(429).json({ error: `Too many failed PIN attempts. Try again in ${retryAfter}s.` });
    return;
  }

  const body = req.body as { pin?: string } | undefined;
  const pin = body?.pin;
  const masterPin = process.env.ADMIN_PIN?.trim();

  if (!masterPin) {
    _pinFailures.delete(ip);
    res.json({ ok: true });
    return;
  }
  if (!pin || pin.trim() !== masterPin) {
    if (!bucket || now - bucket.firstAt >= PIN_WINDOW_MS) {
      _pinFailures.set(ip, { count: 1, firstAt: now });
    } else {
      bucket.count += 1;
    }
    res.status(403).json({ error: "Incorrect PIN" });
    return;
  }
  _pinFailures.delete(ip);
  res.json({ ok: true });
});

// ── Shared guard ──────────────────────────────────────────────────────────────
async function adminGuard(req: Request, res: any): Promise<boolean> {
  const ok = await requireAdmin(req);
  if (!ok) {
    const code = req.isAuthenticated() ? 403 : 401;
    res.status(code).json({ error: code === 401 ? "Unauthorized" : "Forbidden — admin access only" });
    return false;
  }
  return true;
}

// ── Listener applications ─────────────────────────────────────────────────────
router.get("/admin/listeners/applications", async (req, res) => {
  if (!(await adminGuard(req, res))) return;
  const rows = await db
    .select({
      id: listenersTable.id,
      displayName: listenersTable.displayName,
      gender: listenersTable.gender,
      bio: listenersTable.bio,
      skills: listenersTable.skills,
      photoUrl: listenersTable.photoUrl,
      applicationStatus: listenersTable.applicationStatus,
      contactNumber: listenersTable.contactNumber,
      submittedAt: listenersTable.submittedAt,
      decidedAt: listenersTable.decidedAt,
      rejectionReason: listenersTable.rejectionReason,
      authPhone: usersTable.phone,
      authEmail: usersTable.email,
    })
    .from(listenersTable)
    .leftJoin(usersTable, eq(listenersTable.userId, usersTable.id))
    .orderBy(desc(listenersTable.submittedAt))
    .limit(100);

  res.json(rows.map((l) => {
    // Use the WhatsApp number they entered; fall back to their login phone
    const phoneRaw = l.contactNumber ?? l.authPhone ?? null;
    // Strip country code prefix (+91) for display — keep only digits
    const contactNumber = phoneRaw
      ? phoneRaw.replace(/^\+91/, "").replace(/\D/g, "")
      : null;
    return {
      id: l.id, listenerId: l.id, displayName: l.displayName, gender: l.gender, bio: l.bio,
      skills: l.skills ?? [], photoUrl: l.photoUrl, status: l.applicationStatus,
      contactNumber,
      authEmail: l.authEmail ?? null,
      submittedAt: l.submittedAt.toISOString(),
      decidedAt: l.decidedAt ? l.decidedAt.toISOString() : null,
      rejectionReason: l.rejectionReason,
    };
  }));
});

router.post("/admin/listeners/:id/decision", async (req, res) => {
  if (!(await adminGuard(req, res))) return;
  const params = DecideListenerApplicationParams.safeParse(req.params);
  const body = DecideListenerApplicationBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid request" }); return; }

  const status = body.data.decision === "approve" ? "approved" : "rejected";

  // Auto-assign realistic starting rating (4.0–4.8) for newly approved listeners
  // Uses listener id hash so the same listener always gets the same rating (deterministic)
  let autoRating: { ratingAverage: number; ratingCount: number } | undefined;
  if (status === "approved") {
    const [existing] = await db
      .select({ ratingAverage: listenersTable.ratingAverage, ratingCount: listenersTable.ratingCount })
      .from(listenersTable)
      .where(eq(listenersTable.id, params.data.id))
      .limit(1);
    // Only set if listener has no ratings yet
    if (!existing || existing.ratingCount === 0) {
      // Deterministic seed from id so re-approving gives same value
      const seed = params.data.id.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
      const ratingOptions = [400, 415, 420, 432, 438, 445, 450, 458, 462, 470, 475, 480];
      const countOptions  = [48, 63, 79, 94, 112, 128, 147, 163, 181, 204, 223, 251, 278, 312, 344];
      const avg   = ratingOptions[seed % ratingOptions.length];
      const count = countOptions[seed % countOptions.length];
      autoRating = { ratingAverage: avg, ratingCount: count };
    }
  }

  const [updated] = await db.update(listenersTable).set({
    applicationStatus: status,
    rejectionReason: status === "rejected" ? body.data.reason ?? null : null,
    decidedAt: new Date(),
    ...(autoRating ?? {}),
  }).where(eq(listenersTable.id, params.data.id)).returning();

  if (!updated) { res.status(404).json({ error: "Application not found" }); return; }

  // ── Audit log ──
  await logAdminAction(
    req,
    body.data.decision === "approve" ? "approve_listener" : "reject_listener",
    "listener_application",
    {
      targetId: params.data.id,
      details: {
        displayName: updated.displayName,
        decision: body.data.decision,
        reason: body.data.reason ?? null,
      },
    },
  );

  res.json({ id: updated.id, listenerId: updated.id, displayName: updated.displayName, status: updated.applicationStatus });
});

// ── Transactions ──────────────────────────────────────────────────────────────
// Paginated transaction history with optional filters (userId, kind list, date
// range). Server-side pagination keeps payloads light even when total volume
// grows. For admin-authored entries (`admin_credit` / `admin_adjust`), we look
// up the matching audit log row to surface the admin's email next to the row.
const ADMIN_KIND_TO_AUDIT_ACTION: Record<string, string> = {
  admin_credit: "manual_credit",
  admin_adjust: "adjust_balance",
};
const ADMIN_AUTHORED_KINDS = Object.keys(ADMIN_KIND_TO_AUDIT_ACTION);

router.get("/admin/transactions", async (req, res) => {
  if (!(await adminGuard(req, res))) return;

  // ── Parse & validate query ─────────────────────────────────────────────
  const userId = String(req.query.userId ?? "").trim() || undefined;
  const kindParam = String(req.query.kind ?? "").trim();
  const kinds = kindParam
    ? kindParam.split(",").map(s => s.trim()).filter(Boolean).slice(0, 20)
    : [];

  const parseDate = (v: unknown): Date | undefined => {
    if (typeof v !== "string" || !v.trim()) return undefined;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d;
  };
  const startDate = parseDate(req.query.startDate);
  const endDate = parseDate(req.query.endDate);

  const rawPage = Number(req.query.page ?? 1);
  const page = Math.max(1, Number.isFinite(rawPage) ? Math.floor(rawPage) : 1);
  const rawPageSize = Number(req.query.pageSize ?? 50);
  const pageSize = Math.min(50, Math.max(1, Number.isFinite(rawPageSize) ? Math.floor(rawPageSize) : 50));

  // ── Compose WHERE ──────────────────────────────────────────────────────
  const conditions = [
    userId ? eq(transactionsTable.userId, userId) : undefined,
    kinds.length > 0 ? inArray(transactionsTable.kind, kinds) : undefined,
    startDate ? gte(transactionsTable.createdAt, startDate) : undefined,
    endDate ? lt(transactionsTable.createdAt, endDate) : undefined,
  ].filter(Boolean) as Exclude<ReturnType<typeof eq>, undefined>[];
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // ── Total count + page rows in parallel ────────────────────────────────
  const baseSelect = db.select().from(transactionsTable);
  const baseCount = db
    .select({ c: sql<number>`COUNT(*)::int` })
    .from(transactionsTable);

  const [rows, countRows] = await Promise.all([
    (whereClause ? baseSelect.where(whereClause) : baseSelect)
      .orderBy(desc(transactionsTable.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    whereClause ? baseCount.where(whereClause) : baseCount,
  ]);

  const totalCount = Number(countRows[0]?.c ?? 0);
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  // ── Resolve admin author email for admin-authored rows on this page ────
  // We match audit log entries by (action, target_id, |createdAt - txCreatedAt| ≤ 5s).
  // Both rows are written within the same request, so a tight window is safe.
  const adminRows = rows.filter(r => ADMIN_AUTHORED_KINDS.includes(r.kind));
  const adminEmailByTxId = new Map<number, string>();
  if (adminRows.length > 0) {
    const targetIds = Array.from(new Set(adminRows.map(r => r.userId)));
    const actions = Array.from(new Set(adminRows.map(r => ADMIN_KIND_TO_AUDIT_ACTION[r.kind]!).filter(Boolean)));
    // Bound the audit-log scan symmetrically around the page's admin rows so a
    // burst of historical audit entries can't crowd matches out via LIMIT.
    const WINDOW_MS = 5000;
    const earliest = adminRows.reduce(
      (acc, r) => (r.createdAt < acc ? r.createdAt : acc),
      adminRows[0]!.createdAt,
    );
    const latest = adminRows.reduce(
      (acc, r) => (r.createdAt > acc ? r.createdAt : acc),
      adminRows[0]!.createdAt,
    );
    const auditEntries = await db
      .select({
        action: adminAuditLogsTable.action,
        targetId: adminAuditLogsTable.targetId,
        adminEmail: adminAuditLogsTable.adminEmail,
        createdAt: adminAuditLogsTable.createdAt,
      })
      .from(adminAuditLogsTable)
      .where(and(
        inArray(adminAuditLogsTable.action, actions),
        inArray(adminAuditLogsTable.targetId, targetIds),
        gte(adminAuditLogsTable.createdAt, new Date(earliest.getTime() - WINDOW_MS)),
        lt(adminAuditLogsTable.createdAt, new Date(latest.getTime() + WINDOW_MS + 1)),
      ))
      .orderBy(desc(adminAuditLogsTable.createdAt));

    for (const tx of adminRows) {
      const expectedAction = ADMIN_KIND_TO_AUDIT_ACTION[tx.kind];
      const match = auditEntries
        .filter(a => a.action === expectedAction && a.targetId === tx.userId)
        .map(a => ({ a, dt: Math.abs(a.createdAt.getTime() - tx.createdAt.getTime()) }))
        .filter(x => x.dt <= WINDOW_MS)
        .sort((a, b) => a.dt - b.dt)[0];
      if (match) adminEmailByTxId.set(tx.id, match.a.adminEmail);
    }
  }

  res.json({
    transactions: rows.map((t) => ({
      id: String(t.id), userId: t.userId, userName: t.userName, kind: t.kind,
      amountInRupees: t.amountInRupees, balanceAfter: t.balanceAfter,
      description: t.description, createdAt: t.createdAt.toISOString(),
      adminEmail: adminEmailByTxId.get(t.id) ?? null,
    })),
    page,
    pageSize,
    totalCount,
    totalPages,
  });
});

// ── Admin summary ─────────────────────────────────────────────────────────────
router.get("/admin/summary", async (req, res) => {
  if (!(await adminGuard(req, res))) return;

  const [usersCount, listenersCount, pendingCount, onlineCount,
         revenueRow, sessionsTodayRow, activeSessions,
         listenerEarningsRow, totalSessionCostRow] = await Promise.all([
    db.execute<{ c: string }>(sql`SELECT COUNT(*) AS c FROM profiles WHERE role = 'user'`),
    db.execute<{ c: string }>(sql`SELECT COUNT(*) AS c FROM listeners WHERE application_status = 'approved'`),
    db.execute<{ c: string }>(sql`SELECT COUNT(*) AS c FROM listeners WHERE application_status = 'pending'`),
    db.execute<{ c: string }>(sql`SELECT COUNT(*) AS c FROM listeners WHERE is_online = true AND application_status = 'approved'`),
    db.execute<{ s: string | null }>(sql`SELECT COALESCE(SUM(amount_in_rupees), 0) AS s FROM transactions WHERE kind = 'recharge'`),
    db.execute<{ c: string }>(sql`SELECT COUNT(*) AS c FROM chat_sessions WHERE started_at >= CURRENT_DATE`),
    db.execute<{ c: string }>(sql`SELECT COUNT(*) AS c FROM chat_sessions WHERE status = 'active'`),
    db.execute<{ s: string | null }>(sql`SELECT COALESCE(SUM(total_earnings_paise), 0) AS s FROM listeners`),
    db.execute<{ s: string | null }>(sql`SELECT COALESCE(SUM(total_cost_in_rupees), 0) AS s FROM chat_sessions WHERE status = 'ended'`),
  ]);

  const totalRechargeRevenue = Number(revenueRow.rows[0]?.s ?? 0);
  const totalListenerEarningsRupees = Number(listenerEarningsRow.rows[0]?.s ?? 0) / 100;
  const totalSessionRevenue = Number(totalSessionCostRow.rows[0]?.s ?? 0);
  const adminProfitRupees = totalSessionRevenue - totalListenerEarningsRupees;

  res.json({
    totalUsers: Number(usersCount.rows[0]?.c ?? 0),
    totalListeners: Number(listenersCount.rows[0]?.c ?? 0),
    pendingApplications: Number(pendingCount.rows[0]?.c ?? 0),
    onlineListeners: Number(onlineCount.rows[0]?.c ?? 0),
    totalRevenueInRupees: totalRechargeRevenue,
    totalSessionRevenue,
    totalListenerEarningsRupees,
    adminProfitRupees: Math.max(0, adminProfitRupees),
    sessionsToday: Number(sessionsTodayRow.rows[0]?.c ?? 0),
    activeSessions: Number(activeSessions.rows[0]?.c ?? 0),
  });
});

// ── Live activity (3-second cache to absorb 10-second polling burst) ─────────
let _liveCache: { data: any; ts: number } | null = null;
const LIVE_CACHE_MS = 3000;

router.get("/admin/live-activity", async (req, res) => {
  if (!(await adminGuard(req, res))) return;

  if (_liveCache && Date.now() - _liveCache.ts < LIVE_CACHE_MS) {
    res.json(_liveCache.data);
    return;
  }

  const [activeSessions, onlineListeners, onlineUsersRows, recentSessions] = await Promise.all([
    db.select({
      id: chatSessionsTable.id, kind: chatSessionsTable.kind,
      startedAt: chatSessionsTable.startedAt, billedMinutes: chatSessionsTable.billedMinutes,
      totalCostInRupees: chatSessionsTable.totalCostInRupees,
      userId: chatSessionsTable.userId, listenerId: chatSessionsTable.listenerId,
    }).from(chatSessionsTable).where(eq(chatSessionsTable.status, "active")).orderBy(desc(chatSessionsTable.startedAt)).limit(20),
    db.select({
      id: listenersTable.id, displayName: listenersTable.displayName,
      photoUrl: listenersTable.photoUrl, gender: listenersTable.gender,
      ratingAverage: listenersTable.ratingAverage, earningsBalancePaise: listenersTable.earningsBalancePaise,
    }).from(listenersTable).where(eq(listenersTable.isOnline, true)).limit(20),
    // Online users — anyone with profiles.last_active_at within last 2 minutes.
    db.execute<{ user_id: string; anonymous_username: string; role: string; wallet_balance_in_rupees: number | string; last_active_at: Date | string }>(sql`
      SELECT user_id, anonymous_username, role, wallet_balance_in_rupees, last_active_at
      FROM profiles
      WHERE last_active_at > NOW() - INTERVAL '2 minutes' AND has_onboarded = true
      ORDER BY last_active_at DESC
      LIMIT 50
    `),
    db.select({
      id: chatSessionsTable.id, kind: chatSessionsTable.kind, status: chatSessionsTable.status,
      startedAt: chatSessionsTable.startedAt, endedAt: chatSessionsTable.endedAt,
      billedMinutes: chatSessionsTable.billedMinutes, totalCostInRupees: chatSessionsTable.totalCostInRupees,
      userId: chatSessionsTable.userId, listenerId: chatSessionsTable.listenerId,
    }).from(chatSessionsTable).orderBy(desc(chatSessionsTable.startedAt)).limit(10),
  ]);

  const enrich = async (s: { userId: string; listenerId: string }) => {
    const [userProfile] = await db.select({ anonymousUsername: profilesTable.anonymousUsername })
      .from(profilesTable).where(eq(profilesTable.userId, s.userId)).limit(1);
    const [listener] = await db.select({ displayName: listenersTable.displayName })
      .from(listenersTable).where(eq(listenersTable.id, s.listenerId)).limit(1);
    return { userName: userProfile?.anonymousUsername ?? "—", listenerName: listener?.displayName ?? "—" };
  };

  const nowMs = Date.now();
  const enriched = await Promise.all(activeSessions.map(async (s) => {
    const n = await enrich(s);
    const liveSeconds = Math.max(0, Math.floor((nowMs - s.startedAt.getTime()) / 1000));
    return {
      id: s.id, kind: s.kind, startedAt: s.startedAt.toISOString(),
      billedMinutes: s.billedMinutes, totalCostInRupees: s.totalCostInRupees,
      currentDurationMinutes: liveSeconds / 60,
      currentDurationSeconds: liveSeconds,
      currentCostPaise: s.totalCostInRupees * 100,
      ...n,
    };
  }));

  const recentEnriched = await Promise.all(recentSessions.map(async (s) => {
    const n = await enrich(s);
    return { id: s.id, kind: s.kind, status: s.status, startedAt: s.startedAt.toISOString(), endedAt: s.endedAt ? s.endedAt.toISOString() : null, billedMinutes: s.billedMinutes, totalCostInRupees: s.totalCostInRupees, ...n };
  }));

  const payload = {
    activeSessions: enriched,
    onlineListeners: onlineListeners.map(l => ({
      id: l.id, displayName: l.displayName, photoUrl: l.photoUrl, gender: l.gender,
      ratingAverage: l.ratingAverage / 100, earningsBalanceRupees: l.earningsBalancePaise / 100,
    })),
    onlineUsers: onlineUsersRows.rows.map((u) => ({
      userId: u.user_id,
      anonymousUsername: u.anonymous_username,
      role: u.role,
      walletBalanceInRupees: Number(u.wallet_balance_in_rupees),
      lastActiveAt: new Date(u.last_active_at).toISOString(),
    })),
    recentSessions: recentEnriched,
    serverTime: new Date().toISOString(),
  };
  _liveCache = { data: payload, ts: Date.now() };
  res.json(payload);
});

// ── Two-person approval threshold ─────────────────────────────────────────────
// Wallet actions whose absolute change exceeds this many rupees require a
// second admin to approve from the panel. Configurable via env so prod and dev
// can use different ceilings; defaults to ₹5,000 per the security spec.
function getApprovalThresholdRupees(): number {
  const raw = Number(process.env.LARGE_ADJUSTMENT_THRESHOLD_RUPEES ?? 5000);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 5000;
}

type PendingActionType = "user_credit" | "user_adjust" | "listener_credit" | "listener_adjust";

// Drizzle transaction handle type — derived from the actual db so we never drift
// from the runtime if the underlying driver changes.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// req.user is augmented by passport at runtime with email/phone from the
// providers (Replit OIDC + Firebase phone OTP), but the @types/passport union
// doesn't expose them. This helper centralizes the lookup so the rest of the
// admin code stays free of `as any` and we have one place to change if the
// shape evolves.
type AdminIdentity = { userId: string; identityLabel: string };
function getAdminIdentity(req: Request): AdminIdentity | null {
  if (!req.isAuthenticated()) return null;
  const u = req.user as { id: string; email?: string | null; phone?: string | null };
  return { userId: u.id, identityLabel: u.email ?? u.phone ?? "unknown" };
}

// Snake_case row shape returned by the FOR UPDATE SELECT against
// pending_admin_actions. Drizzle's $inferSelect uses camelCase column names,
// but raw `tx.execute(sql\`SELECT *\`)` gives us the underlying column names.
type PendingActionDbRow = {
  id: string;
  action_type: PendingActionType;
  target_type: "wallet" | "listener_balance";
  target_id: string;
  target_name: string;
  amount_rupees: number | string;
  note: string | null;
  payload: Record<string, unknown> | null;
  status: "pending" | "approved" | "rejected" | "expired";
  requested_by_user_id: string;
  requested_by_email: string;
  created_at: string | Date;
};

async function insertPendingAction(req: Request, args: {
  actionType: PendingActionType;
  targetType: "wallet" | "listener_balance";
  targetId: string;
  targetName: string;
  amountRupees: number;          // signed delta (credit) or new balance (adjust)
  note: string;
  payload: Record<string, unknown>;
}): Promise<string> {
  const ident = getAdminIdentity(req);
  const adminUserId = ident?.userId ?? "unknown";
  const adminEmail  = ident?.identityLabel ?? "unknown";
  const [row] = await db.insert(pendingAdminActionsTable).values({
    actionType: args.actionType,
    targetType: args.targetType,
    targetId: args.targetId,
    targetName: args.targetName,
    amountRupees: args.amountRupees,
    note: args.note,
    payload: args.payload,
    requestedByUserId: adminUserId,
    requestedByEmail: adminEmail,
  }).returning({ id: pendingAdminActionsTable.id });
  await logAdminAction(req, "request_wallet_action", args.targetType, {
    targetId: args.targetId,
    details: {
      pendingId: row!.id,
      actionType: args.actionType,
      amountRupees: args.amountRupees,
      displayName: args.targetName,
      note: args.note,
    },
  });
  return row!.id;
}

// HTTP-shaped failure raised from inside a DB transaction. Carrying the
// status code on the error lets the approve endpoint roll back the entire
// transaction (status flip + ledger writes) and still return a precise
// 4xx to the admin without resorting to error-message matching.
class ApplyActionError extends Error {
  constructor(public readonly code: number, message: string) {
    super(message);
    this.name = "ApplyActionError";
  }
}

// Apply an approved pending action against the supplied transaction. The
// caller MUST run this inside a `db.transaction(...)` so the wallet/ledger
// mutation and the surrounding pending-row status flip succeed or fail
// together — financial state and approval state can never diverge.
//
// Throws `ApplyActionError` for business errors (target gone, would go
// negative). Other thrown errors propagate normally and roll the txn back.
async function applyApprovedActionTx(tx: Tx, row: PendingActionRow): Promise<Record<string, unknown>> {
  const note = row.note;

  // ── USER WALLET — credit (signed) ─────────────────────────────────────
  if (row.actionType === "user_credit") {
    const amount = row.amountRupees;
    const locked = await tx.execute<{ wallet_balance_in_rupees: number; anonymous_username: string }>(sql`
      SELECT wallet_balance_in_rupees, anonymous_username
      FROM profiles WHERE user_id = ${row.targetId} FOR UPDATE
    `);
    const r = locked.rows[0];
    if (!r) throw new ApplyActionError(404, "User not found");
    const previousBalance = Number(r.wallet_balance_in_rupees);
    const newBalance = previousBalance + amount;
    if (newBalance < 0) throw new ApplyActionError(400, "Resulting balance would be negative.");
    await tx.update(profilesTable)
      .set({ walletBalanceInRupees: newBalance, updatedAt: new Date() })
      .where(eq(profilesTable.userId, row.targetId));
    await tx.insert(transactionsTable).values({
      userId: row.targetId, userName: r.anonymous_username, kind: "admin_credit",
      amountInRupees: amount, balanceAfter: newBalance,
      description: note || (amount > 0 ? "Admin manual credit (co-approved)" : "Admin manual debit (co-approved)"),
    });
    return { amountRupees: amount, previousBalance, newBalance, displayName: r.anonymous_username, note };
  }

  // ── USER WALLET — adjust (set balance) ────────────────────────────────
  if (row.actionType === "user_adjust") {
    const newBalance = row.amountRupees;
    const locked = await tx.execute<{ wallet_balance_in_rupees: number; anonymous_username: string }>(sql`
      SELECT wallet_balance_in_rupees, anonymous_username
      FROM profiles WHERE user_id = ${row.targetId} FOR UPDATE
    `);
    const r = locked.rows[0];
    if (!r) throw new ApplyActionError(404, "User not found");
    const previousBalance = Number(r.wallet_balance_in_rupees);
    const delta = newBalance - previousBalance;
    await tx.update(profilesTable)
      .set({ walletBalanceInRupees: newBalance, updatedAt: new Date() })
      .where(eq(profilesTable.userId, row.targetId));
    if (delta !== 0) {
      await tx.insert(transactionsTable).values({
        userId: row.targetId, userName: r.anonymous_username, kind: "admin_adjust",
        amountInRupees: delta, balanceAfter: newBalance,
        description: note || `Admin balance adjust (co-approved) → ₹${newBalance}`,
      });
    }
    return { previousBalance, newBalance, delta, displayName: r.anonymous_username, note };
  }

  // ── LISTENER EARNINGS — credit (signed) ───────────────────────────────
  if (row.actionType === "listener_credit") {
    const amountRupees = row.amountRupees;
    const amountPaise = amountRupees * 100;
    const locked = await tx.execute<{ earnings_balance_paise: number | string; display_name: string; user_id: string }>(sql`
      SELECT earnings_balance_paise, display_name, user_id FROM listeners WHERE id = ${row.targetId} FOR UPDATE
    `);
    const r = locked.rows[0];
    if (!r) throw new ApplyActionError(404, "Listener not found");
    const previousPaise = Number(r.earnings_balance_paise);
    const newBalancePaise = previousPaise + amountPaise;
    if (newBalancePaise < 0) throw new ApplyActionError(400, "Resulting balance would be negative.");
    await tx.update(listenersTable)
      .set({ earningsBalancePaise: newBalancePaise })
      .where(eq(listenersTable.id, row.targetId));
    await tx.execute(sql`
      INSERT INTO transactions (user_id, user_name, kind, amount_in_rupees, balance_after, description)
      VALUES (${r.user_id}, ${"Listener: " + r.display_name}, ${"listener_credit"},
              ${amountRupees}, ${Math.round(newBalancePaise / 100)},
              ${"Admin manual credit (listener earnings, co-approved)" + (note ? ` — ${note}` : "")})
    `);
    return { amountRupees, previousBalanceRupees: previousPaise / 100, newBalanceRupees: newBalancePaise / 100, displayName: r.display_name, note };
  }

  // ── LISTENER EARNINGS — adjust (set balance) ──────────────────────────
  if (row.actionType === "listener_adjust") {
    const newBalanceRupees = row.amountRupees;
    const newBalancePaise = newBalanceRupees * 100;
    const locked = await tx.execute<{ earnings_balance_paise: number | string; display_name: string; user_id: string }>(sql`
      SELECT earnings_balance_paise, display_name, user_id FROM listeners WHERE id = ${row.targetId} FOR UPDATE
    `);
    const r = locked.rows[0];
    if (!r) throw new ApplyActionError(404, "Listener not found");
    const previousPaise = Number(r.earnings_balance_paise);
    const deltaPaise = newBalancePaise - previousPaise;
    await tx.update(listenersTable)
      .set({ earningsBalancePaise: newBalancePaise })
      .where(eq(listenersTable.id, row.targetId));
    if (deltaPaise !== 0) {
      await tx.execute(sql`
        INSERT INTO transactions (user_id, user_name, kind, amount_in_rupees, balance_after, description)
        VALUES (${r.user_id}, ${"Listener: " + r.display_name}, ${"listener_adjust"},
                ${Math.round(deltaPaise / 100)}, ${newBalanceRupees},
                ${"Admin set listener earnings (co-approved) to ₹" + newBalanceRupees + (note ? ` — ${note}` : "")})
      `);
    }
    return { previousBalanceRupees: previousPaise / 100, newBalanceRupees, deltaRupees: deltaPaise / 100, displayName: r.display_name, note };
  }

  throw new ApplyActionError(400, "Unknown action type");
}

// Narrow shape of a pending action passed into `applyApprovedActionTx`.
// Mirrors the camelCase columns we read from `pendingAdminActionsTable`,
// without depending on $inferSelect (which carries optional/nullable
// fields we don't need here).
type PendingActionRow = {
  id: string;
  actionType: PendingActionType;
  targetType: "wallet" | "listener_balance";
  targetId: string;
  targetName: string;
  amountRupees: number;
  note: string;
  payload: Record<string, unknown>;
  requestedByUserId: string;
  requestedByEmail: string;
};

// ── Manual wallet credit / adjust ─────────────────────────────────────────────
// Owner-only money tools. Both write a transaction row + audit entry.
//   POST /admin/users/:userId/credit       { amountInRupees: 100, note?: string }
//   POST /admin/users/:userId/adjust       { newBalanceInRupees: 250, note?: string }
// All money mutations run inside a single DB transaction with row-level locking
// (`SELECT ... FOR UPDATE`) so concurrent admin actions cannot lose updates,
// and the wallet update + ledger insert succeed or fail together.
//
// Transaction `kind` uses dedicated admin tags (`admin_credit`, `admin_adjust`)
// so revenue queries (which sum `kind='recharge'`) are not polluted.
type CreditBody = { amountInRupees?: number; note?: string };
type AdjustBody = { newBalanceInRupees?: number; note?: string };

router.post("/admin/users/:userId/credit", async (req, res) => {
  if (!(await adminGuard(req, res))) return;
  const userId = String(req.params.userId);
  const body = (req.body ?? {}) as CreditBody;
  const amount = Math.round(Number(body.amountInRupees ?? 0));
  const note = String(body.note ?? "").slice(0, 200);
  if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 100000) {
    res.status(400).json({ error: "amountInRupees must be a non-zero integer ≤ ₹100,000" });
    return;
  }

  let result: { newBalance: number; username: string; previousBalance: number } | null = null;
  let errorOut: { code: number; msg: string } | null = null;

  await db.transaction(async (tx) => {
    const lockedRows = await tx.execute<{ wallet_balance_in_rupees: number; anonymous_username: string }>(sql`
      SELECT wallet_balance_in_rupees, anonymous_username
      FROM profiles WHERE user_id = ${userId} FOR UPDATE
    `);
    const row = lockedRows.rows[0];
    if (!row) { errorOut = { code: 404, msg: "User not found" }; return; }
    const previousBalance = Number(row.wallet_balance_in_rupees);
    const newBalance = previousBalance + amount;
    if (newBalance < 0) { errorOut = { code: 400, msg: "Resulting balance would be negative — use adjust instead." }; return; }

    await tx.update(profilesTable)
      .set({ walletBalanceInRupees: newBalance, updatedAt: new Date() })
      .where(eq(profilesTable.userId, userId));
    await tx.insert(transactionsTable).values({
      userId,
      userName: row.anonymous_username,
      kind: "admin_credit",
      amountInRupees: amount,
      balanceAfter: newBalance,
      description: note || (amount > 0 ? "Admin manual credit" : "Admin manual debit"),
    });
    result = { newBalance, username: row.anonymous_username, previousBalance };
  });

  if (errorOut) { const e = errorOut as { code: number; msg: string }; res.status(e.code).json({ error: e.msg }); return; }
  if (!result) { res.status(500).json({ error: "Transaction failed" }); return; }
  const r = result as { newBalance: number; username: string; previousBalance: number };

  // Audit outside the txn — its helper swallows errors and is non-blocking;
  // the financial mutation has already committed atomically above.
  await logAdminAction(req, "manual_credit", "wallet", {
    targetId: userId,
    details: { amountRupees: amount, previousBalance: r.previousBalance, newBalance: r.newBalance, displayName: r.username, note },
  });
  _liveCache = null;
  res.json({ ok: true, newBalanceInRupees: r.newBalance });
});

router.post("/admin/users/:userId/adjust", async (req, res) => {
  if (!(await adminGuard(req, res))) return;
  const userId = String(req.params.userId);
  const body = (req.body ?? {}) as AdjustBody;
  const newBalance = Math.round(Number(body.newBalanceInRupees ?? NaN));
  const note = String(body.note ?? "").slice(0, 200);
  if (!Number.isFinite(newBalance) || newBalance < 0 || newBalance > 1000000) {
    res.status(400).json({ error: "newBalanceInRupees must be ≥0 and ≤ ₹1,000,000" });
    return;
  }

  let result: { delta: number; previousBalance: number; username: string; unchanged?: boolean } | null = null;
  let errorOut: { code: number; msg: string } | null = null;

  await db.transaction(async (tx) => {
    const lockedRows = await tx.execute<{ wallet_balance_in_rupees: number; anonymous_username: string }>(sql`
      SELECT wallet_balance_in_rupees, anonymous_username
      FROM profiles WHERE user_id = ${userId} FOR UPDATE
    `);
    const row = lockedRows.rows[0];
    if (!row) { errorOut = { code: 404, msg: "User not found" }; return; }
    const previousBalance = Number(row.wallet_balance_in_rupees);
    const delta = newBalance - previousBalance;
    if (delta === 0) { result = { delta: 0, previousBalance, username: row.anonymous_username, unchanged: true }; return; }

    await tx.update(profilesTable)
      .set({ walletBalanceInRupees: newBalance, updatedAt: new Date() })
      .where(eq(profilesTable.userId, userId));
    await tx.insert(transactionsTable).values({
      userId,
      userName: row.anonymous_username,
      kind: "admin_adjust",
      amountInRupees: delta,
      balanceAfter: newBalance,
      description: note || `Admin balance adjust → ₹${newBalance}`,
    });
    result = { delta, previousBalance, username: row.anonymous_username };
  });

  if (errorOut) { const e = errorOut as { code: number; msg: string }; res.status(e.code).json({ error: e.msg }); return; }
  if (!result) { res.status(500).json({ error: "Transaction failed" }); return; }
  const r = result as { delta: number; previousBalance: number; username: string; unchanged?: boolean };

  if (!r.unchanged) {
    await logAdminAction(req, "adjust_balance", "wallet", {
      targetId: userId,
      details: { previousBalance: r.previousBalance, newBalance, delta: r.delta, displayName: r.username, note },
    });
  }
  _liveCache = null;
  res.json({ ok: true, newBalanceInRupees: newBalance, delta: r.delta, ...(r.unchanged ? { unchanged: true } : {}) });
});

// ── Listener payout balances ──────────────────────────────────────────────────
router.get("/admin/listener-balances", async (req, res) => {
  if (!(await adminGuard(req, res))) return;

  const rows = await db.select({
    id: listenersTable.id, displayName: listenersTable.displayName, photoUrl: listenersTable.photoUrl,
    gender: listenersTable.gender, applicationStatus: listenersTable.applicationStatus,
    isOnline: listenersTable.isOnline, earningsBalancePaise: listenersTable.earningsBalancePaise,
    totalEarningsPaise: listenersTable.totalEarningsPaise,
    ratingAverage: listenersTable.ratingAverage, ratingCount: listenersTable.ratingCount,
  })
    .from(listenersTable)
    .where(eq(listenersTable.applicationStatus, "approved"))
    .orderBy(desc(listenersTable.totalEarningsPaise))
    .limit(50);

  res.json(rows.map(l => ({
    id: l.id, displayName: l.displayName, photoUrl: l.photoUrl, gender: l.gender,
    isOnline: l.isOnline, earningsBalanceRupees: l.earningsBalancePaise / 100,
    totalEarningsRupees: l.totalEarningsPaise / 100, earningsBalancePaise: l.earningsBalancePaise,
  })));
});

// ── Withdrawal requests — list ────────────────────────────────────────────────
router.get("/admin/withdrawal-requests", async (req, res) => {
  if (!(await adminGuard(req, res))) return;

  const rows = await db.select({
    id: withdrawalRequestsTable.id, amountPaise: withdrawalRequestsTable.amountPaise,
    upiId: withdrawalRequestsTable.upiId, status: withdrawalRequestsTable.status,
    adminNote: withdrawalRequestsTable.adminNote,
    paymentReference: withdrawalRequestsTable.paymentReference,
    decidedAt: withdrawalRequestsTable.decidedAt,
    createdAt: withdrawalRequestsTable.createdAt, listenerId: withdrawalRequestsTable.listenerId,
    listenerName: listenersTable.displayName, listenerPhoto: listenersTable.photoUrl,
  })
    .from(withdrawalRequestsTable)
    .leftJoin(listenersTable, eq(withdrawalRequestsTable.listenerId, listenersTable.id))
    .orderBy(desc(withdrawalRequestsTable.createdAt))
    .limit(100);

  res.json(rows.map(r => ({
    id: r.id, amountPaise: r.amountPaise, amountRupees: r.amountPaise / 100,
    upiId: r.upiId, status: r.status, adminNote: r.adminNote,
    paymentReference: r.paymentReference,
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(), listenerId: r.listenerId,
    listenerName: r.listenerName ?? "—", listenerPhoto: r.listenerPhoto ?? "",
  })));
});

// ── Withdrawal requests — approve & pay (deducts listener balance here) ───────
// Requires `paymentReference` (UTR / bank reference) so every paid payout has
// a verifiable trail. Uses a DB transaction with row locks for atomicity.
type PayWithdrawalBody = { paymentReference?: string };
router.post("/admin/withdrawal-requests/:id/pay", async (req, res) => {
  if (!(await adminGuard(req, res))) return;

  const { id } = req.params as { id: string };
  const body = (req.body ?? {}) as PayWithdrawalBody;
  const paymentReference = String(body.paymentReference ?? "").trim();
  if (paymentReference.length < 6 || paymentReference.length > 64) {
    res.status(400).json({ error: "paymentReference (UTR) is required — 6–64 characters." });
    return;
  }

  let result: { commissionPaise: number; payoutPaise: number; amountPaise: number; upiId: string; listenerId: string } | null = null;
  let errorOut: { code: number; msg: string } | null = null;

  await db.transaction(async (tx) => {
    // Lock the withdrawal row first so two concurrent /pay calls on the same
    // ID cannot both pass the status check and double-deduct listener earnings.
    const lockedWr = await tx.execute<{
      id: string; listener_id: string; amount_paise: number | string; upi_id: string; status: string;
    }>(sql`
      SELECT id, listener_id, amount_paise, upi_id, status
      FROM withdrawal_requests WHERE id = ${id} FOR UPDATE
    `);
    const wrRow = lockedWr.rows[0];
    if (!wrRow) { errorOut = { code: 404, msg: "Not found" }; return; }
    if (wrRow.status !== "pending") { errorOut = { code: 400, msg: "Already decided" }; return; }
    const wr = {
      id: wrRow.id,
      listenerId: wrRow.listener_id,
      amountPaise: Number(wrRow.amount_paise),
      upiId: wrRow.upi_id,
    };

    const lockedListener = await tx.execute<{ earnings_balance_paise: number | string }>(sql`
      SELECT earnings_balance_paise FROM listeners WHERE id = ${wr.listenerId} FOR UPDATE
    `);
    const listenerRow = lockedListener.rows[0];
    if (!listenerRow) { errorOut = { code: 404, msg: "Listener not found" }; return; }
    const earnings = Number(listenerRow.earnings_balance_paise);
    if (earnings < wr.amountPaise) {
      errorOut = { code: 400, msg: `Listener has insufficient balance. Available: ₹${(earnings / 100).toFixed(2)}, Required: ₹${(wr.amountPaise / 100).toFixed(2)}` };
      return;
    }

    await tx.update(listenersTable)
      .set({ earningsBalancePaise: earnings - wr.amountPaise })
      .where(eq(listenersTable.id, wr.listenerId));

    // Defence-in-depth conditional update: even with row lock, double-checking
    // status='pending' on the WHERE makes accidental concurrent code paths
    // (e.g. another endpoint mutating this row) impossible to silently win.
    const updated = await tx.execute(sql`
      UPDATE withdrawal_requests
      SET status = 'paid', decided_at = NOW(), payment_reference = ${paymentReference}
      WHERE id = ${id} AND status = 'pending'
    `);
    if (updated.rowCount !== 1) {
      errorOut = { code: 409, msg: "Withdrawal state changed concurrently. Please retry." };
      return;
    }

    const commissionPaise = Math.round(wr.amountPaise * 0.1);
    result = {
      commissionPaise,
      payoutPaise: wr.amountPaise - commissionPaise,
      amountPaise: wr.amountPaise,
      upiId: wr.upiId,
      listenerId: wr.listenerId,
    };
  });

  if (errorOut) { const e = errorOut as { code: number; msg: string }; res.status(e.code).json({ error: e.msg }); return; }
  if (!result) { res.status(500).json({ error: "Transaction failed" }); return; }
  const r = result as { commissionPaise: number; payoutPaise: number; amountPaise: number; upiId: string; listenerId: string };

  await logAdminAction(req, "pay_withdrawal", "withdrawal_request", {
    targetId: id,
    details: {
      amountPaise: r.amountPaise, amountRupees: r.amountPaise / 100,
      payoutRupees: r.payoutPaise / 100, commissionRupees: r.commissionPaise / 100,
      upiId: r.upiId, listenerId: r.listenerId, paymentReference,
    },
  });

  res.json({ ok: true, payoutRupees: r.payoutPaise / 100, commissionRupees: r.commissionPaise / 100, paymentReference });
});

// ── Listener manual balance credit / adjust (owner-only money tools) ──────────
// Mirrors user money tools. Writes audit row only (listener earnings ledger
// is the audit log itself; no separate listener-side transaction table exists).
type ListenerCreditBody = { amountInRupees?: number; note?: string };
type ListenerAdjustBody = { newBalanceInRupees?: number; note?: string };

router.post("/admin/listeners/:listenerId/credit", async (req, res) => {
  if (!(await adminGuard(req, res))) return;
  const listenerId = String(req.params.listenerId);
  const body = (req.body ?? {}) as ListenerCreditBody;
  const amountRupees = Math.round(Number(body.amountInRupees ?? 0));
  const note = String(body.note ?? "").slice(0, 200);
  if (!Number.isFinite(amountRupees) || amountRupees === 0 || Math.abs(amountRupees) > 100000) {
    res.status(400).json({ error: "amountInRupees must be a non-zero integer ≤ ₹100,000" });
    return;
  }
  const amountPaise = amountRupees * 100;

  let result: { newBalancePaise: number; previousPaise: number; displayName: string } | null = null;
  let errorOut: { code: number; msg: string } | null = null;

  await db.transaction(async (tx) => {
    const locked = await tx.execute<{ earnings_balance_paise: number | string; display_name: string; user_id: string }>(sql`
      SELECT earnings_balance_paise, display_name, user_id FROM listeners WHERE id = ${listenerId} FOR UPDATE
    `);
    const row = locked.rows[0];
    if (!row) { errorOut = { code: 404, msg: "Listener not found" }; return; }
    const previousPaise = Number(row.earnings_balance_paise);
    const newBalancePaise = previousPaise + amountPaise;
    if (newBalancePaise < 0) { errorOut = { code: 400, msg: "Resulting balance would be negative — use adjust instead." }; return; }

    await tx.update(listenersTable)
      .set({ earningsBalancePaise: newBalancePaise })
      .where(eq(listenersTable.id, listenerId));

    // Ledger entry — listener-side financial actions show up in the
    // live transactions feed for full observability. Dedicated kind
    // `listener_credit` keeps this out of recharge revenue queries.
    await tx.execute(sql`
      INSERT INTO transactions (user_id, user_name, kind, amount_in_rupees, balance_after, description)
      VALUES (${row.user_id}, ${"Listener: " + row.display_name}, ${"listener_credit"},
              ${amountRupees}, ${Math.round(newBalancePaise / 100)},
              ${"Admin manual credit (listener earnings)" + (note ? ` — ${note}` : "")})
    `);
    result = { newBalancePaise, previousPaise, displayName: row.display_name };
  });

  if (errorOut) { const e = errorOut as { code: number; msg: string }; res.status(e.code).json({ error: e.msg }); return; }
  if (!result) { res.status(500).json({ error: "Transaction failed" }); return; }
  const r = result as { newBalancePaise: number; previousPaise: number; displayName: string };

  await logAdminAction(req, "manual_credit_listener", "listener_balance", {
    targetId: listenerId,
    details: {
      amountRupees,
      previousBalanceRupees: r.previousPaise / 100,
      newBalanceRupees: r.newBalancePaise / 100,
      displayName: r.displayName, note,
    },
  });
  _liveCache = null;
  res.json({ ok: true, newBalanceRupees: r.newBalancePaise / 100 });
});

router.post("/admin/listeners/:listenerId/adjust", async (req, res) => {
  if (!(await adminGuard(req, res))) return;
  const listenerId = String(req.params.listenerId);
  const body = (req.body ?? {}) as ListenerAdjustBody;
  const newBalanceRupees = Math.round(Number(body.newBalanceInRupees ?? NaN));
  const note = String(body.note ?? "").slice(0, 200);
  if (!Number.isFinite(newBalanceRupees) || newBalanceRupees < 0 || newBalanceRupees > 1000000) {
    res.status(400).json({ error: "newBalanceInRupees must be ≥0 and ≤ ₹1,000,000" });
    return;
  }
  const newBalancePaise = newBalanceRupees * 100;

  let result: { previousPaise: number; deltaPaise: number; displayName: string; unchanged?: boolean } | null = null;
  let errorOut: { code: number; msg: string } | null = null;

  await db.transaction(async (tx) => {
    const locked = await tx.execute<{ earnings_balance_paise: number | string; display_name: string; user_id: string }>(sql`
      SELECT earnings_balance_paise, display_name, user_id FROM listeners WHERE id = ${listenerId} FOR UPDATE
    `);
    const row = locked.rows[0];
    if (!row) { errorOut = { code: 404, msg: "Listener not found" }; return; }
    const previousPaise = Number(row.earnings_balance_paise);
    const deltaPaise = newBalancePaise - previousPaise;
    if (deltaPaise === 0) { result = { previousPaise, deltaPaise: 0, displayName: row.display_name, unchanged: true }; return; }

    await tx.update(listenersTable)
      .set({ earningsBalancePaise: newBalancePaise })
      .where(eq(listenersTable.id, listenerId));

    await tx.execute(sql`
      INSERT INTO transactions (user_id, user_name, kind, amount_in_rupees, balance_after, description)
      VALUES (${row.user_id}, ${"Listener: " + row.display_name}, ${"listener_adjust"},
              ${Math.round(deltaPaise / 100)}, ${newBalanceRupees},
              ${"Admin set listener earnings to ₹" + newBalanceRupees + (note ? ` — ${note}` : "")})
    `);
    result = { previousPaise, deltaPaise, displayName: row.display_name };
  });

  if (errorOut) { const e = errorOut as { code: number; msg: string }; res.status(e.code).json({ error: e.msg }); return; }
  if (!result) { res.status(500).json({ error: "Transaction failed" }); return; }
  const r = result as { previousPaise: number; deltaPaise: number; displayName: string; unchanged?: boolean };

  if (!r.unchanged) {
    await logAdminAction(req, "adjust_balance_listener", "listener_balance", {
      targetId: listenerId,
      details: {
        previousBalanceRupees: r.previousPaise / 100,
        newBalanceRupees,
        deltaRupees: r.deltaPaise / 100,
        displayName: r.displayName, note,
      },
    });
  }
  _liveCache = null;
  res.json({ ok: true, newBalanceRupees, deltaRupees: r.deltaPaise / 100, ...(r.unchanged ? { unchanged: true } : {}) });
});

// ── Pending admin actions (two-person approval) ──────────────────────────────
// List pending wallet adjustments awaiting a second admin's decision.
router.get("/admin/pending-actions", async (req, res) => {
  if (!(await adminGuard(req, res))) return;
  const statusParam = String(req.query.status ?? "pending").trim();
  const allowedStatus = new Set(["pending", "approved", "rejected", "all"]);
  const status = allowedStatus.has(statusParam) ? statusParam : "pending";

  const base = db.select().from(pendingAdminActionsTable);
  const rows = await (status === "all"
    ? base
    : base.where(eq(pendingAdminActionsTable.status, status))
  ).orderBy(desc(pendingAdminActionsTable.createdAt)).limit(200);

  const me = req.isAuthenticated() ? req.user.id : null;
  res.json({
    thresholdRupees: getApprovalThresholdRupees(),
    currentAdminUserId: me,
    actions: rows.map(r => ({
      id: r.id,
      actionType: r.actionType,
      targetType: r.targetType,
      targetId: r.targetId,
      targetName: r.targetName,
      amountRupees: r.amountRupees,
      note: r.note,
      payload: r.payload,
      status: r.status,
      requestedByUserId: r.requestedByUserId,
      requestedByEmail: r.requestedByEmail,
      decidedByUserId: r.decidedByUserId,
      decidedByEmail: r.decidedByEmail,
      decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
      decisionNote: r.decisionNote,
      createdAt: r.createdAt.toISOString(),
      // Convenience: can the current admin act on this row?
      canApprove: r.status === "pending" && me !== null && me !== r.requestedByUserId,
    })),
  });
});

router.post("/admin/pending-actions/:id/approve", async (req, res) => {
  if (!(await adminGuard(req, res))) return;
  const { id } = req.params as { id: string };
  const ident = getAdminIdentity(req);
  if (!ident) { res.status(401).json({ error: "Unauthorized" }); return; }
  const me = ident.userId;
  const decisionNote = String((req.body as { note?: unknown } | undefined)?.note ?? "").slice(0, 200) || null;

  // Single transaction: lock pending row → apply ledger mutation → flip
  // status. If anything fails, the whole transaction rolls back so the
  // pending row stays "pending" and no half-applied state is possible.
  // This is the financial integrity guarantee the two-person workflow
  // exists to provide; do not split this into multiple transactions.
  let appliedDetails: Record<string, unknown> | null = null;
  let pendingForAudit: PendingActionRow | null = null;
  let httpError: { code: number; msg: string } | null = null;

  try {
    await db.transaction(async (tx) => {
      const locked = await tx.execute<PendingActionDbRow>(sql`
        SELECT * FROM pending_admin_actions WHERE id = ${id} FOR UPDATE
      `);
      const row = locked.rows[0];
      if (!row) { httpError = { code: 404, msg: "Pending action not found" }; return; }
      if (row.status !== "pending") { httpError = { code: 400, msg: `Already ${row.status}` }; return; }
      if (row.requested_by_user_id === me) {
        httpError = { code: 403, msg: "A different admin must approve this action (two-person rule)." };
        return;
      }

      const pendingRow: PendingActionRow = {
        id: row.id,
        actionType: row.action_type,
        targetType: row.target_type,
        targetId: row.target_id,
        targetName: row.target_name,
        amountRupees: Number(row.amount_rupees),
        note: row.note ?? "",
        payload: row.payload ?? {},
        requestedByUserId: row.requested_by_user_id,
        requestedByEmail: row.requested_by_email,
      };

      // Apply the ledger mutation FIRST. If this throws, the pending row's
      // status flip below never runs and the surrounding transaction
      // rolls back — leaving the pending row untouched for retry.
      const details = await applyApprovedActionTx(tx, pendingRow);

      // Only after the money has moved (within this same tx) do we mark
      // the pending row as approved. Either both happen or neither does.
      const updated = await tx.execute(sql`
        UPDATE pending_admin_actions
        SET status = 'approved',
            decided_by_user_id = ${me},
            decided_by_email = ${ident.identityLabel},
            decided_at = NOW(),
            decision_note = ${decisionNote}
        WHERE id = ${id} AND status = 'pending'
      `);
      if (updated.rowCount !== 1) {
        // Concurrent decider already moved the row out of "pending". Roll
        // back the ledger mutation so it doesn't apply twice.
        throw new ApplyActionError(409, "Pending action changed concurrently. Retry.");
      }

      appliedDetails = details;
      pendingForAudit = pendingRow;
    });
  } catch (err) {
    if (err instanceof ApplyActionError) {
      res.status(err.code).json({ error: err.message });
      return;
    }
    throw err;
  }

  if (httpError) { const e = httpError as { code: number; msg: string }; res.status(e.code).json({ error: e.msg }); return; }
  if (!appliedDetails || !pendingForAudit) {
    res.status(500).json({ error: "Failed to apply pending action" });
    return;
  }
  const pending: PendingActionRow = pendingForAudit;
  const details: Record<string, unknown> = appliedDetails;

  // Audit log is best-effort and intentionally outside the financial txn:
  // a transient log failure must not unwind a successful money move.
  await logAdminAction(req, "approve_wallet_action", pending.targetType, {
    targetId: pending.targetId,
    details: {
      pendingId: id,
      actionType: pending.actionType,
      requestedByEmail: pending.requestedByEmail,
      ...details,
    },
  });
  _liveCache = null;
  res.json({ ok: true, applied: true, ...details });
});

router.post("/admin/pending-actions/:id/reject", async (req, res) => {
  if (!(await adminGuard(req, res))) return;
  const { id } = req.params as { id: string };
  const ident = getAdminIdentity(req);
  if (!ident) { res.status(401).json({ error: "Unauthorized" }); return; }
  const me = ident.userId;
  const reason = String((req.body as { note?: unknown } | undefined)?.note ?? "").slice(0, 200);

  const [existing] = await db.select().from(pendingAdminActionsTable).where(eq(pendingAdminActionsTable.id, id)).limit(1);
  if (!existing) { res.status(404).json({ error: "Pending action not found" }); return; }
  if (existing.status !== "pending") { res.status(400).json({ error: `Already ${existing.status}` }); return; }
  // Allow same admin to cancel their own request, but treat it as a self-cancel
  // (still recorded in audit).
  const updated = await db.execute(sql`
    UPDATE pending_admin_actions
    SET status = 'rejected',
        decided_by_user_id = ${me},
        decided_by_email = ${ident.identityLabel},
        decided_at = NOW(),
        decision_note = ${reason || null}
    WHERE id = ${id} AND status = 'pending'
  `);
  if (updated.rowCount !== 1) { res.status(409).json({ error: "Pending action changed concurrently. Retry." }); return; }

  // The DB column is a free-text string but we only ever insert one of two
  // wallet target types via insertPendingAction(); narrow back to the audit
  // union without `as any`.
  const targetType: "wallet" | "listener_balance" =
    existing.targetType === "listener_balance" ? "listener_balance" : "wallet";
  await logAdminAction(req, "reject_wallet_action", targetType, {
    targetId: existing.targetId,
    details: {
      pendingId: id,
      actionType: existing.actionType,
      amountRupees: existing.amountRupees,
      requestedByEmail: existing.requestedByEmail,
      displayName: existing.targetName,
      reason,
      selfCancel: existing.requestedByUserId === me,
    },
  });
  res.json({ ok: true, rejected: true });
});

// ── Withdrawal requests — reject (no balance change since balance not held) ────
router.post("/admin/withdrawal-requests/:id/reject", async (req, res) => {
  if (!(await adminGuard(req, res))) return;

  const { id } = req.params as { id: string };
  const { note } = req.body as { note?: string };
  const [wr] = await db.select().from(withdrawalRequestsTable).where(eq(withdrawalRequestsTable.id, id)).limit(1);
  if (!wr) { res.status(404).json({ error: "Not found" }); return; }
  if (wr.status !== "pending") { res.status(400).json({ error: "Already decided" }); return; }

  // No balance change needed — listener balance was not deducted at request time.
  await db.update(withdrawalRequestsTable)
    .set({ status: "rejected", adminNote: note ?? null, decidedAt: new Date() })
    .where(eq(withdrawalRequestsTable.id, id));

  // ── Audit log ──
  await logAdminAction(req, "reject_withdrawal", "withdrawal_request", {
    targetId: id,
    details: { amountPaise: wr.amountPaise, amountRupees: wr.amountPaise / 100, upiId: wr.upiId, listenerId: wr.listenerId, note: note ?? null },
  });

  res.json({ ok: true });
});

// ── Recharge requests (audit log) ────────────────────────────────────────────
router.get("/admin/recharge-requests", async (req, res) => {
  if (!(await adminGuard(req, res))) return;

  const rows = await db.select({
    id: rechargeRequestsTable.id, userId: rechargeRequestsTable.userId,
    amountInRupees: rechargeRequestsTable.amountInRupees,
    utrNumber: rechargeRequestsTable.utrNumber, status: rechargeRequestsTable.status,
    adminNote: rechargeRequestsTable.adminNote, decidedAt: rechargeRequestsTable.decidedAt,
    createdAt: rechargeRequestsTable.createdAt,
    username: profilesTable.anonymousUsername,
    email: usersTable.email,
  })
    .from(rechargeRequestsTable)
    .leftJoin(profilesTable, eq(rechargeRequestsTable.userId, profilesTable.userId))
    .leftJoin(usersTable, eq(rechargeRequestsTable.userId, usersTable.id))
    .orderBy(desc(rechargeRequestsTable.createdAt))
    .limit(100);

  res.json(rows.map(r => ({
    id: r.id, userId: r.userId, username: r.username ?? "unknown",
    email: r.email ?? null, amountInRupees: r.amountInRupees,
    utrNumber: r.utrNumber, status: r.status, adminNote: r.adminNote,
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  })));
});

// ── Revenue breakdown ─────────────────────────────────────────────────────────
router.get("/admin/revenue", async (req, res) => {
  if (!(await adminGuard(req, res))) return;

  const [todaySessions, todayRevenue, allTimeSessions, allTimeRevenue,
         allTimeListenerEarnings, paidWithdrawals] = await Promise.all([
    db.execute<{ c: string }>(sql`SELECT COUNT(*) AS c FROM chat_sessions WHERE started_at >= CURRENT_DATE`),
    db.execute<{ s: string | null }>(sql`SELECT COALESCE(SUM(total_cost_in_rupees), 0) AS s FROM chat_sessions WHERE status = 'ended' AND started_at >= CURRENT_DATE`),
    db.execute<{ c: string }>(sql`SELECT COUNT(*) AS c FROM chat_sessions WHERE status = 'ended'`),
    db.execute<{ s: string | null }>(sql`SELECT COALESCE(SUM(total_cost_in_rupees), 0) AS s FROM chat_sessions WHERE status = 'ended'`),
    db.execute<{ s: string | null }>(sql`SELECT COALESCE(SUM(total_earnings_paise), 0) AS s FROM listeners`),
    db.execute<{ s: string | null }>(sql`SELECT COALESCE(SUM(amount_paise), 0) AS s FROM withdrawal_requests WHERE status = 'paid'`),
  ]);

  const todayRev = Number(todayRevenue.rows[0]?.s ?? 0);
  // ₹2 listener out of ₹6 user pays = 1/3 ratio
  const todayListenerEarnings = Math.round(todayRev * 100 / 3) / 100;
  const todayAdminProfit = todayRev - todayListenerEarnings;

  const allTimeRev = Number(allTimeRevenue.rows[0]?.s ?? 0);
  const allTimeListenerEarningsRupees = Number(allTimeListenerEarnings.rows[0]?.s ?? 0) / 100;
  const allTimeAdminSessionProfit = allTimeRev - allTimeListenerEarningsRupees;
  const withdrawalCommission = Number(paidWithdrawals.rows[0]?.s ?? 0) * 0.1 / 100;

  res.json({
    today: {
      sessions: Number(todaySessions.rows[0]?.c ?? 0),
      revenueRupees: todayRev,
      adminProfitRupees: Math.max(0, todayAdminProfit),
      listenerEarningsRupees: todayListenerEarnings,
    },
    allTime: {
      sessions: Number(allTimeSessions.rows[0]?.c ?? 0),
      revenueRupees: allTimeRev,
      adminProfitRupees: Math.max(0, allTimeAdminSessionProfit),
      listenerEarningsRupees: allTimeListenerEarningsRupees,
      withdrawalCommissionRupees: withdrawalCommission,
      totalPlatformProfitRupees: Math.max(0, allTimeAdminSessionProfit) + withdrawalCommission,
    },
  });
});

// ── Admin users list ──────────────────────────────────────────────────────────
router.get("/admin/users", async (req, res) => {
  if (!(await adminGuard(req, res))) return;

  const rows = await db.select({
    userId: profilesTable.userId, anonymousUsername: profilesTable.anonymousUsername,
    role: profilesTable.role, isAdmin: profilesTable.isAdmin,
    walletBalanceInRupees: profilesTable.walletBalanceInRupees,
    hasOnboarded: profilesTable.hasOnboarded, createdAt: profilesTable.createdAt,
    age: profilesTable.age,
    avatarSeed: profilesTable.avatarSeed,
    email: usersTable.email, phone: usersTable.phone,
    firstName: usersTable.firstName,
    isTestAccount: usersTable.isTestAccount,
    deviceId: usersTable.firebaseUid,
    lastActiveAt: profilesTable.lastActiveAt,
    earningsBalancePaise: listenersTable.earningsBalancePaise,
    totalEarningsPaise: listenersTable.totalEarningsPaise,
    listenerDisplayName: listenersTable.displayName,
    listenerApplicationStatus: listenersTable.applicationStatus,
  })
    .from(profilesTable)
    .leftJoin(usersTable, eq(profilesTable.userId, usersTable.id))
    .leftJoin(listenersTable, eq(usersTable.id, listenersTable.userId))
    .orderBy(desc(profilesTable.createdAt))
    .limit(500);

  // Fetch spam counts for all users in one query
  const spamRows = await db
    .select({
      reportedUserId: safetyReportsTable.reportedUserId,
      count: count(),
    })
    .from(safetyReportsTable)
    .groupBy(safetyReportsTable.reportedUserId);

  const spamMap = new Map();
  for (const s of spamRows) spamMap.set(s.reportedUserId, s.count);

  await logAdminAction(req, "view_users", "users_list", { details: { count: rows.length } });

  res.json(rows.map(r => {
    const isApprovedListener = r.listenerApplicationStatus === "approved";
    return {
      userId: r.userId, anonymousUsername: r.anonymousUsername,
      role: isApprovedListener ? "listener" : r.role,
      isAdmin: r.isAdmin,
      walletBalanceInRupees: r.walletBalanceInRupees, hasOnboarded: r.hasOnboarded,
      createdAt: r.createdAt.toISOString(), email: r.email ?? null, phone: r.phone ?? null,
      firstName: r.listenerDisplayName ?? r.firstName ?? null,
      age: r.age ?? null, avatarSeed: r.avatarSeed ?? null,
      isTestAccount: r.isTestAccount ?? false,
      deviceId: r.deviceId ?? null,
      lastActiveAt: r.lastActiveAt ? r.lastActiveAt.toISOString() : null,
      spamCount: spamMap.get(r.userId) ?? 0,
      earningsBalanceRupees: r.earningsBalancePaise != null ? r.earningsBalancePaise / 100 : null,
      totalEarningsRupees: r.totalEarningsPaise != null ? r.totalEarningsPaise / 100 : null,
    };
  }));
});

// ── DELETE /admin/users/:userId — permanently remove a user (seeker or listener) ─
// Cascade-deletes everything tied to this user. Optional `banDevice=true` adds
// the user's deviceId to the banned_devices table so the same handset cannot
// re-register. Safe for both seekers (role=user) and listeners (role=listener).
router.delete("/admin/users/:userId", async (req, res) => {
  if (!(await adminGuard(req, res))) return;

  const { userId } = req.params as { userId: string };
  const banDevice = String(req.query.banDevice ?? "").toLowerCase() === "true";
  const reason = String(req.query.reason ?? "").slice(0, 200) || null;

  const [user] = await db.select({
    id: usersTable.id, firebaseUid: usersTable.firebaseUid, phone: usersTable.phone,
    firstName: usersTable.firstName, email: usersTable.email,
  }).from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const [profile] = await db.select({
    anonymousUsername: profilesTable.anonymousUsername, role: profilesTable.role,
    isAdmin: profilesTable.isAdmin,
  }).from(profilesTable).where(eq(profilesTable.userId, userId)).limit(1);

  // ── Safety: never allow deleting an admin account ─────────────────────────
  // Removing an admin from the UI must go through an explicit `isAdmin=false`
  // demotion first. This protects against accidentally orphaning the system.
  if (profile?.isAdmin) {
    res.status(403).json({ error: "Cannot delete an admin account. Demote them first." });
    return;
  }
  // Defense-in-depth: prevent self-deletion regardless of admin flag.
  // For device-auth users req.user.id is the userId directly (no claims object).
  const callerId = req.user?.id ?? null;
  const callerEmail = (req.user as { claims?: { email?: string } } | undefined)?.claims?.email
    ?? (req.user as { email?: string } | undefined)?.email ?? null;
  if (callerId && callerId === userId) {
    res.status(403).json({ error: "Aap apna khud ka account delete nahi kar sakte." });
    return;
  }
  if (callerEmail && user.email && callerEmail.toLowerCase() === user.email.toLowerCase()) {
    res.status(403).json({ error: "Aap apna khud ka account delete nahi kar sakte." });
    return;
  }

  const displayName = user.firstName ?? profile?.anonymousUsername ?? userId;

  // If this user is a listener, find the listener row and cascade-delete its
  // listener-specific data (sessions, messages, reviews, withdrawals).
  const [listener] = await db.select({ id: listenersTable.id, displayName: listenersTable.displayName })
    .from(listenersTable).where(eq(listenersTable.userId, userId)).limit(1);

  // ── Atomic delete: all cleanups happen inside a single transaction ────────
  // If any step fails we rollback completely — no partial state.
  let deviceBanned = false;
  await db.transaction(async (tx) => {
    if (listener) {
      const sessionIds = (await tx.select({ id: chatSessionsTable.id })
        .from(chatSessionsTable).where(eq(chatSessionsTable.listenerId, listener.id))).map(r => r.id);
      if (sessionIds.length > 0) {
        await tx.delete(chatMessagesTable).where(inArray(chatMessagesTable.sessionId, sessionIds));
      }
      await tx.delete(chatSessionsTable).where(eq(chatSessionsTable.listenerId, listener.id));
      await tx.delete(reviewsTable).where(eq(reviewsTable.listenerId, listener.id));
      await tx.delete(withdrawalRequestsTable).where(eq(withdrawalRequestsTable.listenerId, listener.id));
      await tx.delete(safetyReportsTable).where(eq(safetyReportsTable.reporterListenerId, listener.id));
      await tx.delete(listenersTable).where(eq(listenersTable.id, listener.id));
    }

    const userSessionIds = (await tx.select({ id: chatSessionsTable.id })
      .from(chatSessionsTable).where(eq(chatSessionsTable.userId, userId))).map(r => r.id);
    if (userSessionIds.length > 0) {
      await tx.delete(chatMessagesTable).where(inArray(chatMessagesTable.sessionId, userSessionIds));
    }
    await tx.delete(chatSessionsTable).where(eq(chatSessionsTable.userId, userId));
    await tx.delete(profilesTable).where(eq(profilesTable.userId, userId));
    await tx.delete(transactionsTable).where(eq(transactionsTable.userId, userId));
    await tx.delete(usersTable).where(eq(usersTable.id, userId));

    // Device-ban-on-delete intentionally disabled — deleting a user no longer
    // blacklists their device. They can reinstall and create a fresh ID.
    void banDevice; // (kept in signature for backwards-compat; not used)
  });

  await logAdminAction(req, "delete_user", "user", {
    targetId: userId,
    details: {
      displayName, phone: user.phone, role: profile?.role ?? "unknown",
      wasListener: !!listener, deviceBanned, deviceId: user.firebaseUid, reason,
    },
  });

  res.json({ ok: true, deviceBanned, displayName });
});

// ── Banned devices — list / unban ─────────────────────────────────────────────
router.get("/admin/banned-devices", async (req, res) => {
  if (!(await adminGuard(req, res))) return;
  const rows = await db.select().from(bannedDevicesTable)
    .orderBy(desc(bannedDevicesTable.createdAt)).limit(500);
  res.json(rows.map(r => ({
    id: r.id, deviceId: r.deviceId, reason: r.reason ?? null,
    bannedByEmail: r.bannedByEmail ?? null,
    bannedUserId: r.bannedUserId ?? null, bannedUserName: r.bannedUserName ?? null,
    createdAt: r.createdAt.toISOString(),
  })));
});

router.delete("/admin/banned-devices/:deviceId", async (req, res) => {
  if (!(await adminGuard(req, res))) return;
  const { deviceId } = req.params as { deviceId: string };
  await db.delete(bannedDevicesTable).where(eq(bannedDevicesTable.deviceId, deviceId));
  await logAdminAction(req, "unban_device", "banned_device", {
    targetId: deviceId, details: { deviceId },
  });
  res.json({ ok: true });
});

// ── POST /admin/listeners/:listenerId/instant-payout ──────────────────────────
// Admin creates AND pays a withdrawal request on behalf of the listener in one
// shot. Useful when listener doesn't have access to the app or owner wants to
// proactively settle a balance. Deducts listener earnings, records UTR.
type InstantPayoutBody = { amountInRupees?: number; upiId?: string; paymentReference?: string; note?: string };
router.post("/admin/listeners/:listenerId/instant-payout", async (req, res) => {
  if (!(await adminGuard(req, res))) return;

  const { listenerId } = req.params as { listenerId: string };
  const body = (req.body ?? {}) as InstantPayoutBody;
  const amountRupees = Math.round(Number(body.amountInRupees ?? 0));
  const upiId = String(body.upiId ?? "").trim();
  const paymentReference = String(body.paymentReference ?? "").trim();
  const note = String(body.note ?? "").slice(0, 200);

  if (!Number.isFinite(amountRupees) || amountRupees < 1 || amountRupees > 100000) {
    res.status(400).json({ error: "amountInRupees must be between ₹1 and ₹100,000" }); return;
  }
  if (upiId.length < 4 || upiId.length > 100 || !upiId.includes("@")) {
    res.status(400).json({ error: "Valid UPI ID required (e.g. name@bank)" }); return;
  }
  if (paymentReference.length < 6 || paymentReference.length > 64) {
    res.status(400).json({ error: "paymentReference (UTR) is required — 6–64 chars" }); return;
  }
  const amountPaise = amountRupees * 100;

  let result: { newBalanceRupees: number; commissionRupees: number; payoutRupees: number; displayName: string } | null = null;
  let errorOut: { code: number; msg: string } | null = null;

  await db.transaction(async (tx) => {
    const locked = await tx.execute<{ earnings_balance_paise: number | string; display_name: string; user_id: string }>(sql`
      SELECT earnings_balance_paise, display_name, user_id FROM listeners WHERE id = ${listenerId} FOR UPDATE
    `);
    const row = locked.rows[0];
    if (!row) { errorOut = { code: 404, msg: "Listener not found" }; return; }
    const earnings = Number(row.earnings_balance_paise);
    if (earnings < amountPaise) {
      errorOut = { code: 400, msg: `Insufficient earnings. Available: ₹${(earnings / 100).toFixed(2)}` }; return;
    }

    await tx.update(listenersTable)
      .set({ earningsBalancePaise: earnings - amountPaise })
      .where(eq(listenersTable.id, listenerId));

    // Create the withdrawal request already in 'paid' state — single atomic record.
    await tx.execute(sql`
      INSERT INTO withdrawal_requests (listener_id, user_id, amount_paise, upi_id, status, decided_at, payment_reference, admin_note)
      VALUES (${listenerId}, ${row.user_id}, ${amountPaise}, ${upiId}, 'paid', NOW(), ${paymentReference},
              ${"Admin instant payout" + (note ? ` — ${note}` : "")})
    `);

    const commissionPaise = Math.round(amountPaise * 0.1);
    result = {
      newBalanceRupees: (earnings - amountPaise) / 100,
      commissionRupees: commissionPaise / 100,
      payoutRupees: (amountPaise - commissionPaise) / 100,
      displayName: row.display_name,
    };
  });

  if (errorOut) { const e = errorOut as { code: number; msg: string }; res.status(e.code).json({ error: e.msg }); return; }
  if (!result) { res.status(500).json({ error: "Transaction failed" }); return; }
  const r = result as { newBalanceRupees: number; commissionRupees: number; payoutRupees: number; displayName: string };

  await logAdminAction(req, "instant_payout", "withdrawal_request", {
    targetId: listenerId,
    details: {
      amountRupees, payoutRupees: r.payoutRupees, commissionRupees: r.commissionRupees,
      upiId, paymentReference, displayName: r.displayName, note,
    },
  });

  res.json({ ok: true, ...r, paymentReference });
});

// ── Admin toggle test account ──────────────────────────────────────────────────
router.post("/admin/users/:userId/toggle-test", async (req, res) => {
  if (!(await adminGuard(req, res))) return;
  const { userId } = req.params;

  const [user] = await db.select({ id: usersTable.id, isTestAccount: usersTable.isTestAccount })
    .from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const newValue = !user.isTestAccount;
  await db.update(usersTable).set({ isTestAccount: newValue }).where(eq(usersTable.id, userId));

  await logAdminAction(req, newValue ? "mark_test_account" : "unmark_test_account", "user", { details: { userId } });

  res.json({ ok: true, isTestAccount: newValue });
});

// ── Admin callback requests ───────────────────────────────────────────────────
router.get("/admin/callback-requests", async (req, res) => {
  if (!(await adminGuard(req, res))) return;
  const rows = await db.select().from(callbackRequestsTable)
    .orderBy(desc(callbackRequestsTable.createdAt))
    .limit(200);
  res.json(rows.map(r => ({
    id: r.id,
    userAnonymousName: r.userAnonymousName,
    listenerId: r.listenerId,
    listenerDisplayName: r.listenerDisplayName,
    status: r.status,
    note: r.note,
    respondedByListenerId: r.respondedByListenerId,
    createdAt: r.createdAt.toISOString(),
    respondedAt: r.respondedAt ? r.respondedAt.toISOString() : null,
  })));
});

// Admin dismiss a callback request
router.post("/admin/callback-requests/:id/dismiss", async (req, res) => {
  if (!(await adminGuard(req, res))) return;
  const [updated] = await db.update(callbackRequestsTable)
    .set({ status: "dismissed" })
    .where(eq(callbackRequestsTable.id, req.params.id))
    .returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ok: true });
});

// ── Audit log — last N entries, optional action filter ───────────────────────
// Query params:
//   ?action=manual_credit,adjust_balance   (comma-separated whitelist)
//   ?limit=200                             (1..500, default 200)
// ── DELETE /admin/listeners/:id — permanently remove a listener + cascade ─────
router.delete("/admin/listeners/:id", async (req, res) => {
  if (!(await adminGuard(req, res))) return;

  const { id } = req.params as { id: string };

  const [listener] = await db.select({ id: listenersTable.id, userId: listenersTable.userId, displayName: listenersTable.displayName })
    .from(listenersTable).where(eq(listenersTable.id, id)).limit(1);

  if (!listener) { res.status(404).json({ error: "Listener not found" }); return; }

  // Block deleting admin accounts (defense-in-depth, also enforced on user delete)
  const [lProfile] = await db.select({ isAdmin: profilesTable.isAdmin })
    .from(profilesTable).where(eq(profilesTable.userId, listener.userId)).limit(1);
  if (lProfile?.isAdmin) {
    res.status(403).json({ error: "Cannot delete an admin account. Demote first." }); return;
  }

  // Atomic cascade — rollback completely on any failure
  await db.transaction(async (tx) => {
    const sessionIds = (await tx.select({ id: chatSessionsTable.id })
      .from(chatSessionsTable).where(eq(chatSessionsTable.listenerId, id))).map(r => r.id);
    if (sessionIds.length > 0) {
      await tx.delete(chatMessagesTable).where(inArray(chatMessagesTable.sessionId, sessionIds));
    }
    await tx.delete(chatSessionsTable).where(eq(chatSessionsTable.listenerId, id));
    await tx.delete(reviewsTable).where(eq(reviewsTable.listenerId, id));
    await tx.delete(withdrawalRequestsTable).where(eq(withdrawalRequestsTable.listenerId, id));
    await tx.delete(safetyReportsTable).where(eq(safetyReportsTable.reporterListenerId, id));
    await tx.delete(listenersTable).where(eq(listenersTable.id, id));
    await tx.delete(profilesTable).where(eq(profilesTable.userId, listener.userId));
    await tx.delete(transactionsTable).where(eq(transactionsTable.userId, listener.userId));
    await tx.delete(usersTable).where(eq(usersTable.id, listener.userId));
  });

  await logAdminAction(req, "delete_listener", "listener", {
    targetId: id,
    details: { displayName: listener.displayName, userId: listener.userId },
  });

  res.json({ ok: true });
});

router.get("/admin/audit-log", async (req, res) => {
  if (!(await adminGuard(req, res))) return;

  const actionParam = String(req.query.action ?? "").trim();
  const actions = actionParam
    ? actionParam.split(",").map(s => s.trim()).filter(Boolean).slice(0, 20)
    : [];

  const rawLimit = Number(req.query.limit ?? 200);
  const limit = Math.min(500, Math.max(1, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 200));

  const baseQuery = db.select().from(adminAuditLogsTable);
  const rows = await (actions.length > 0
    ? baseQuery.where(inArray(adminAuditLogsTable.action, actions))
    : baseQuery
  ).orderBy(desc(adminAuditLogsTable.createdAt)).limit(limit);

  // Log that the admin viewed the audit log itself
  await logAdminAction(req, "view_audit_log", "audit_log", {
    details: { entries: rows.length, actions: actions.length ? actions : "all" },
  });

  res.json(rows.map(r => ({
    id: r.id,
    adminEmail: r.adminEmail,
    action: r.action,
    targetType: r.targetType,
    targetId: r.targetId ?? null,
    details: r.details,
    ipAddress: r.ipAddress ?? null,
    createdAt: r.createdAt.toISOString(),
  })));
});

export default router;
