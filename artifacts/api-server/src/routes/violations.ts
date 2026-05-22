import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { abuseViolationsTable, profilesTable, usersTable } from "@workspace/db";
import { desc, eq, and, isNotNull, gt, sql } from "@workspace/db";
import { requireAdmin } from "../lib/security";
import { suspendUser, unsuspendUser } from "../lib/abuse";
import { logAdminAction } from "../lib/audit";

const router: IRouter = Router();

async function adminGuard(req: any, res: any): Promise<boolean> {
  const ok = await requireAdmin(req);
  if (!ok) {
    res.status(req.isAuthenticated() ? 403 : 401).json({ error: "Forbidden" });
    return false;
  }
  return true;
}

// ── GET /admin/violations — recent violation log ───────────────────────────────
router.get("/admin/violations", async (req, res) => {
  if (!(await adminGuard(req, res))) return;

  const rows = await db
    .select()
    .from(abuseViolationsTable)
    .orderBy(desc(abuseViolationsTable.createdAt))
    .limit(200);

  res.json(rows.map(r => ({
    id: r.id,
    userId: r.userId,
    ipAddress: r.ipAddress,
    route: r.route,
    reason: r.reason,
    hitCount: r.hitCount,
    autoSuspended: r.autoSuspended,
    suspendedUntil: r.suspendedUntil ? r.suspendedUntil.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  })));
});

// ── GET /admin/suspended — currently suspended accounts ───────────────────────
router.get("/admin/suspended", async (req, res) => {
  if (!(await adminGuard(req, res))) return;

  const now = new Date();
  const rows = await db
    .select({
      userId: profilesTable.userId,
      anonymousUsername: profilesTable.anonymousUsername,
      suspendedUntil: profilesTable.suspendedUntil,
      violationCount: profilesTable.violationCount,
      email: usersTable.email,
    })
    .from(profilesTable)
    .leftJoin(usersTable, eq(profilesTable.userId, usersTable.id))
    .where(and(isNotNull(profilesTable.suspendedUntil), gt(profilesTable.suspendedUntil, now)))
    .orderBy(desc(profilesTable.suspendedUntil))
    .limit(100);

  res.json(rows.map(r => ({
    userId: r.userId,
    anonymousUsername: r.anonymousUsername,
    suspendedUntil: r.suspendedUntil!.toISOString(),
    violationCount: r.violationCount,
    email: r.email ?? null,
    minutesRemaining: Math.ceil((r.suspendedUntil!.getTime() - now.getTime()) / 60000),
  })));
});

// ── POST /admin/users/:userId/suspend ─────────────────────────────────────────
router.post("/admin/users/:userId/suspend", async (req, res) => {
  if (!(await adminGuard(req, res))) return;

  const { userId } = req.params as { userId: string };
  const { hours = 24 } = req.body as { hours?: number };
  const clampedHours = Math.min(Math.max(Number(hours) || 24, 1), 24 * 30); // 1h–30d

  await suspendUser(userId, clampedHours * 60 * 60 * 1000);
  await logAdminAction(req, "view_users" as any, "users_list" as any, {
    targetId: userId,
    details: { action: "manual_suspend", hours: clampedHours },
  });

  res.json({ ok: true, suspendedHours: clampedHours });
});

// ── POST /admin/users/:userId/unsuspend ───────────────────────────────────────
router.post("/admin/users/:userId/unsuspend", async (req, res) => {
  if (!(await adminGuard(req, res))) return;

  const { userId } = req.params as { userId: string };
  await unsuspendUser(userId);
  await logAdminAction(req, "view_users" as any, "users_list" as any, {
    targetId: userId,
    details: { action: "manual_unsuspend" },
  });

  res.json({ ok: true });
});

// ── GET /admin/abuse-stats — summary counts ───────────────────────────────────
router.get("/admin/abuse-stats", async (req, res) => {
  if (!(await adminGuard(req, res))) return;

  const [totalViolations, totalSuspended, autoSuspended, todayViolations] = await Promise.all([
    db.execute<{ c: string }>(sql`SELECT COUNT(*) AS c FROM abuse_violations`),
    db.execute<{ c: string }>(sql`SELECT COUNT(*) AS c FROM profiles WHERE suspended_until > NOW()`),
    db.execute<{ c: string }>(sql`SELECT COUNT(*) AS c FROM abuse_violations WHERE auto_suspended = true`),
    db.execute<{ c: string }>(sql`SELECT COUNT(*) AS c FROM abuse_violations WHERE created_at >= CURRENT_DATE`),
  ]);

  res.json({
    totalViolations: Number(totalViolations.rows[0]?.c ?? 0),
    currentlySuspended: Number(totalSuspended.rows[0]?.c ?? 0),
    autoSuspensions: Number(autoSuspended.rows[0]?.c ?? 0),
    violationsToday: Number(todayViolations.rows[0]?.c ?? 0),
  });
});

export default router;
