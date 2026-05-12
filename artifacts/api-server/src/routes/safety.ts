import { Router, type IRouter } from "express";
import { db, listenersTable, profilesTable, usersTable } from "@workspace/db";
import { safetyReportsTable, listenerBlocksTable } from "@workspace/db";
import { eq, and, desc, sql, countDistinct } from "@workspace/db";
import { requireAdmin } from "../lib/security";
import { ensureProfile } from "../lib/profile";

const router: IRouter = Router();

const VALID_CATEGORIES = new Set(["rude_abusive", "sexual_harassment", "fake_caller"]);

async function adminGuard(req: any, res: any): Promise<boolean> {
  const ok = await requireAdmin(req);
  if (!ok) {
    res.status(req.isAuthenticated() ? 403 : 401).json({ error: "Forbidden" });
    return false;
  }
  return true;
}

// ── POST /api/safety/report — listener files a report against a user ──────────
router.post("/safety/report", async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: "Unauthorized" });

  const profile = await ensureProfile(req.user.id);
  if (profile.role !== "listener") {
    return res.status(403).json({ error: "Only listeners can file safety reports." });
  }

  const [listener] = await db
    .select()
    .from(listenersTable)
    .where(eq(listenersTable.userId, req.user.id))
    .limit(1);

  if (!listener) return res.status(404).json({ error: "Listener profile not found." });

  const { sessionId, reportedUserId, category, notes } = req.body as {
    sessionId?: string;
    reportedUserId?: string;
    category?: string;
    notes?: string;
  };

  if (!reportedUserId) return res.status(400).json({ error: "reportedUserId is required." });
  if (!category || !VALID_CATEGORIES.has(category)) {
    return res.status(400).json({ error: "Invalid category. Must be: rude_abusive, sexual_harassment, or fake_caller." });
  }

  // Prevent duplicate reports for the same session
  if (sessionId) {
    const existing = await db
      .select({ id: safetyReportsTable.id })
      .from(safetyReportsTable)
      .where(
        and(
          eq(safetyReportsTable.reporterListenerId, listener.id),
          eq(safetyReportsTable.sessionId, sessionId),
        )
      )
      .limit(1);
    if (existing.length > 0) {
      return res.status(409).json({ error: "You have already reported this session." });
    }
  }

  // Auto-block: prevent this user from calling this listener again
  let autoBlocked = false;
  try {
    await db.insert(listenerBlocksTable).values({
      listenerUserId: req.user.id,
      blockedUserId: reportedUserId,
    });
    autoBlocked = true;
  } catch {
    // Already blocked — fine, continue
    autoBlocked = true;
  }

  // Persist the report — admin will review and decide on any action
  await db.insert(safetyReportsTable).values({
    reporterListenerId: listener.id,
    reportedUserId,
    sessionId: sessionId || null,
    category,
    notes: notes?.trim() || null,
    autoBlocked,
    autoSuspendedUser: false,
  });

  req.log.warn(
    { listenerId: listener.id, reportedUserId, category, autoBlocked },
    "Listener safety report filed — pending admin review",
  );

  return res.json({ ok: true, autoBlocked, autoSuspendedUser: false });
});

// ── GET /api/admin/safety-alerts — all reports for admin review ───────────────
router.get("/admin/safety-alerts", async (req, res) => {
  if (!(await adminGuard(req, res))) return;

  const rows = await db
    .select({
      id: safetyReportsTable.id,
      category: safetyReportsTable.category,
      notes: safetyReportsTable.notes,
      autoBlocked: safetyReportsTable.autoBlocked,
      autoSuspendedUser: safetyReportsTable.autoSuspendedUser,
      reviewedByAdmin: safetyReportsTable.reviewedByAdmin,
      sessionId: safetyReportsTable.sessionId,
      reportedUserId: safetyReportsTable.reportedUserId,
      createdAt: safetyReportsTable.createdAt,
      listenerDisplayName: listenersTable.displayName,
      reportedUserName: profilesTable.anonymousUsername,
    })
    .from(safetyReportsTable)
    .leftJoin(listenersTable, eq(safetyReportsTable.reporterListenerId, listenersTable.id))
    .leftJoin(profilesTable, eq(safetyReportsTable.reportedUserId, profilesTable.userId))
    .orderBy(desc(safetyReportsTable.createdAt))
    .limit(300);

  return res.json(rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })));
});

// ── GET /api/admin/safety-stats — aggregate counts ───────────────────────────
router.get("/admin/safety-stats", async (req, res) => {
  if (!(await adminGuard(req, res))) return;

  const [total, today, autoSuspended, uniqueReported] = await Promise.all([
    db.execute<{ c: string }>(sql`SELECT COUNT(*) AS c FROM safety_reports`),
    db.execute<{ c: string }>(sql`SELECT COUNT(*) AS c FROM safety_reports WHERE created_at >= CURRENT_DATE`),
    db.execute<{ c: string }>(sql`SELECT COUNT(*) AS c FROM safety_reports WHERE auto_suspended_user = true`),
    db.execute<{ c: string }>(sql`SELECT COUNT(DISTINCT reported_user_id) AS c FROM safety_reports`),
  ]);

  return res.json({
    totalReports: Number(total.rows[0]?.c ?? 0),
    reportsToday: Number(today.rows[0]?.c ?? 0),
    autoSuspended: Number(autoSuspended.rows[0]?.c ?? 0),
    uniqueUsersReported: Number(uniqueReported.rows[0]?.c ?? 0),
  });
});

// ── POST /api/admin/safety-alerts/:id/review — mark report as reviewed ────────
router.post("/admin/safety-alerts/:id/review", async (req, res) => {
  if (!(await adminGuard(req, res))) return;
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  await db
    .update(safetyReportsTable)
    .set({ reviewedByAdmin: true })
    .where(eq(safetyReportsTable.id, id));
  return res.json({ ok: true });
});

export default router;
