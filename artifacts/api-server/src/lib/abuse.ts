/**
 * SunoSathi — Violation Logging (audit trail only)
 *
 * Auto-suspension has been REMOVED by design.
 * Violations are logged to the DB so admin can review them in the dashboard.
 * Only the admin can manually suspend / unsuspend accounts.
 */

import type { Request } from "express";
import { db, profilesTable, abuseViolationsTable, sql } from "@workspace/db";
import { eq } from "@workspace/db";
import { logger } from "./logger";

// ── In-memory violation counter (per userId or IP) — for logging only ─────────
type ViolationEntry = { count: number; firstAt: number };
const violationCounters = new Map<string, ViolationEntry>();
const WINDOW_MS = 60 * 60 * 1000; // 1-hour sliding window

// Prune stale entries every 10 minutes
setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS;
  for (const [key, entry] of violationCounters) {
    if (entry.firstAt < cutoff) violationCounters.delete(key);
  }
}, 10 * 60 * 1000);

// ── Record a rate-limit violation (logs to DB for admin — no auto-suspend) ────
export async function recordViolation(
  req: Request,
  reason: string,
): Promise<void> {
  try {
    const userId = req.isAuthenticated() ? req.user.id : null;
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()
      ?? req.socket?.remoteAddress
      ?? "unknown";
    const route = `${req.method} ${req.path}`;

    const counterKey = userId ?? `ip:${ip}`;
    const now = Date.now();
    const existing = violationCounters.get(counterKey);

    let windowCount = 1;
    if (existing && existing.firstAt > now - WINDOW_MS) {
      existing.count++;
      windowCount = existing.count;
    } else {
      violationCounters.set(counterKey, { count: 1, firstAt: now });
    }

    logger.warn({ userId, ip, route, reason, windowCount }, "Rate-limit violation logged (no auto-suspend)");

    // Log to DB for admin audit trail only — no suspension applied
    await db.insert(abuseViolationsTable).values({
      userId,
      ipAddress: ip,
      route,
      reason,
      hitCount: windowCount,
      autoSuspended: false,
      suspendedUntil: null,
    });

  } catch (err) {
    logger.error({ err }, "Failed to record violation — non-fatal");
  }
}

// ── Manual admin suspend / unsuspend (admin-only, no auto trigger) ────────────
export async function suspendUser(userId: string, durationMs: number): Promise<void> {
  const suspendedUntil = new Date(Date.now() + durationMs);
  await db.update(profilesTable)
    .set({ suspendedUntil, violationCount: sql`${profilesTable.violationCount} + 1` })
    .where(eq(profilesTable.userId, userId));

  await db.insert(abuseViolationsTable).values({
    userId,
    ipAddress: "admin-action",
    route: "MANUAL",
    reason: "Manual suspension by admin",
    hitCount: 0,
    autoSuspended: false,
    suspendedUntil,
  });
}

export async function unsuspendUser(userId: string): Promise<void> {
  await db.update(profilesTable)
    .set({ suspendedUntil: null })
    .where(eq(profilesTable.userId, userId));
}
