import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  chatSessionsTable,
  listenersTable,
  profilesTable,
  transactionsTable,
} from "@workspace/db";
import { and, desc, eq, sql } from "@workspace/db";
import { ensureProfile, avg100ToFloat } from "../lib/profile";

const router: IRouter = Router();

router.get("/dashboard/summary", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const profile = await ensureProfile(req.user.id);
  if (profile.role === "listener") {
    const [listener] = await db
      .select()
      .from(listenersTable)
      .where(eq(listenersTable.userId, req.user.id))
      .limit(1);
    const sessions = listener
      ? await db
          .select()
          .from(chatSessionsTable)
          .where(eq(chatSessionsTable.listenerId, listener.id))
          .orderBy(desc(chatSessionsTable.startedAt))
          .limit(5)
      : [];
    const totalRow = listener
      ? await db.execute<{ c: string; e: string | null }>(
          sql`SELECT COUNT(*) AS c, COALESCE(SUM(total_cost_in_rupees), 0) AS e FROM chat_sessions WHERE listener_id = ${listener.id}`,
        )
      : null;
    const activeRow = listener
      ? await db.execute<{ c: string }>(
          sql`SELECT COUNT(*) AS c FROM chat_sessions WHERE listener_id = ${listener.id} AND status = 'active'`,
        )
      : null;
    // Today's earnings in IST (UTC+5:30) — sum actual listener payout per minute
    // Rates: call=₹2/min, video_call=₹5/min, chat=₹1.5/min (in paise: 200, 500, 150)
    const todayRow = listener
      ? await db.execute<{ p: string }>(
          sql`SELECT COALESCE(SUM(
            CASE kind
              WHEN 'call'       THEN billed_minutes * 200
              WHEN 'video_call' THEN billed_minutes * 500
              ELSE                   billed_minutes * 150
            END
          ), 0) AS p
          FROM chat_sessions
          WHERE listener_id = ${listener.id}
            AND billed_minutes > 0
            AND started_at >= (DATE_TRUNC('day', NOW() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')`,
        )
      : null;

    const dtoSessions = await Promise.all(
      sessions.map(async (s) => {
        const [user] = await db
          .select()
          .from(profilesTable)
          .where(eq(profilesTable.userId, s.userId))
          .limit(1);
        return {
          id: s.id,
          listenerId: s.listenerId,
          listenerName: listener?.displayName ?? "",
          listenerPhotoUrl: listener?.photoUrl ?? "",
          userId: s.userId,
          userName: user?.anonymousUsername ?? "Friend",
          status: s.status,
          kind: s.kind,
          startedAt: s.startedAt.toISOString(),
          endedAt: s.endedAt ? s.endedAt.toISOString() : null,
          billedMinutes: s.billedMinutes,
          totalCostInRupees: s.totalCostInRupees,
          lastMessagePreview: null,
        };
      }),
    );
    res.json({
      role: "listener",
      walletBalanceInRupees: profile.walletBalanceInRupees,
      totalSessions: Number(totalRow?.rows[0]?.c ?? 0),
      activeSessions: Number(activeRow?.rows[0]?.c ?? 0),
      totalEarningsInRupees: Math.floor(
        Number(totalRow?.rows[0]?.e ?? 0) * 0.7,
      ),
      todayEarningsInRupees: Math.floor(Number(todayRow?.rows[0]?.p ?? 0) / 100),
      averageRating: listener ? avg100ToFloat(listener.ratingAverage) : 0,
      isOnline: listener?.isOnline ?? false,
      recentSessions: dtoSessions,
    });
    return;
  }

  // user role
  const sessions = await db
    .select()
    .from(chatSessionsTable)
    .where(eq(chatSessionsTable.userId, req.user.id))
    .orderBy(desc(chatSessionsTable.startedAt))
    .limit(5);
  const totalRow = await db.execute<{ c: string }>(
    sql`SELECT COUNT(*) AS c FROM chat_sessions WHERE user_id = ${req.user.id}`,
  );
  const activeRow = await db.execute<{ c: string }>(
    sql`SELECT COUNT(*) AS c FROM chat_sessions WHERE user_id = ${req.user.id} AND status = 'active'`,
  );

  const dtoSessions = await Promise.all(
    sessions.map(async (s) => {
      const [listener] = await db
        .select()
        .from(listenersTable)
        .where(eq(listenersTable.id, s.listenerId))
        .limit(1);
      return {
        id: s.id,
        listenerId: s.listenerId,
        listenerName: listener?.displayName ?? "",
        listenerPhotoUrl: listener?.photoUrl ?? "",
        userId: s.userId,
        userName: profile.anonymousUsername,
        status: s.status,
        kind: s.kind,
        startedAt: s.startedAt.toISOString(),
        endedAt: s.endedAt ? s.endedAt.toISOString() : null,
        billedMinutes: s.billedMinutes,
        totalCostInRupees: s.totalCostInRupees,
        lastMessagePreview: null,
      };
    }),
  );
  res.json({
    role: "user",
    walletBalanceInRupees: profile.walletBalanceInRupees,
    totalSessions: Number(totalRow.rows[0]?.c ?? 0),
    activeSessions: Number(activeRow.rows[0]?.c ?? 0),
    recentSessions: dtoSessions,
  });
});

export default router;
