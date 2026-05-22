/**
 * SunoSathi — Admin Audit Logger
 *
 * Records every admin action (approve/reject listener, pay/reject payout, etc.)
 * with timestamp, admin identity, target, and request IP.
 * Never throws — audit logging must not break the main operation.
 */

import type { Request } from "express";
import { db, sql } from "@workspace/db";
import { logger } from "./logger";

export type AuditAction =
  | "approve_listener"
  | "reject_listener"
  | "pay_withdrawal"
  | "reject_withdrawal"
  | "view_users"
  | "view_audit_log"
  | "mark_test_account"
  | "unmark_test_account"
  | "manual_credit"
  | "adjust_balance"
  | "manual_credit_listener"
  | "adjust_balance_listener"
  | "request_wallet_action"
  | "approve_wallet_action"
  | "reject_wallet_action"
  | "delete_listener"
  | "delete_user"
  | "unban_device"
  | "instant_payout";

export type AuditTargetType =
  | "listener_application"
  | "withdrawal_request"
  | "users_list"
  | "audit_log"
  | "user"
  | "wallet"
  | "listener_balance"
  | "listener"
  | "banned_device";

/**
 * Log an admin action to the audit table.
 * Safe to await — swallows all errors internally.
 */
export async function logAdminAction(
  req: Request,
  action: AuditAction,
  targetType: AuditTargetType,
  opts: {
    targetId?: string;
    details?: Record<string, unknown>;
  } = {},
): Promise<void> {
  try {
    const ip =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ??
      req.socket?.remoteAddress ??
      "unknown";

    const adminUserId = req.isAuthenticated() ? req.user.id : "unknown";
    // Some admins authenticate via phone OTP and have no email on the user
    // record; fall back to phone so the audit row always identifies a person,
    // not just a user-id. The admin_email column is the single identity field
    // we surface in the UI, so we pack email-or-phone into it.
    const adminEmail = req.isAuthenticated()
      ? ((req.user as any).email ?? (req.user as any).phone ?? "unknown")
      : "unknown";

    await db.execute(sql`
      INSERT INTO admin_audit_logs
        (admin_user_id, admin_email, action, target_type, target_id, details, ip_address, created_at)
      VALUES (
        ${adminUserId},
        ${adminEmail},
        ${action},
        ${targetType},
        ${opts.targetId ?? null},
        ${JSON.stringify(opts.details ?? {})}::jsonb,
        ${ip},
        NOW()
      )
    `);
  } catch (err) {
    // Audit logging must never break the main request
    logger.error({ err, action }, "Failed to write audit log — non-fatal");
  }
}
