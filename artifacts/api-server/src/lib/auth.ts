import * as client from "openid-client";
import crypto from "crypto";
import { type Request, type Response } from "express";
import { db, sessionsTable, sql } from "@workspace/db";
import { eq } from "@workspace/db";
import type { AuthUser } from "@workspace/api-zod";

export const ISSUER_URL = process.env.ISSUER_URL ?? "https://replit.com/oidc";
export const SESSION_COOKIE = "sid";

// Absolute session TTL — 7 days (max lifetime even with activity)
export const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;

// Inactivity TTL — session dies after 30 minutes with no requests
export const INACTIVITY_TTL = 30 * 60 * 1000;

export interface SessionData {
  user: AuthUser;
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
}

let oidcConfig: client.Configuration | null = null;

export async function getOidcConfig(): Promise<client.Configuration> {
  if (!oidcConfig) {
    oidcConfig = await client.discovery(
      new URL(ISSUER_URL),
      process.env.REPL_ID!,
    );
  }
  return oidcConfig;
}

/**
 * Create a new session. Optionally binds to a deviceId for device binding.
 */
export async function createSession(
  data: SessionData,
  deviceId?: string,
): Promise<string> {
  const sid = crypto.randomBytes(32).toString("hex");
  const now = new Date();
  await db.insert(sessionsTable).values({
    sid,
    sess: data as unknown as Record<string, unknown>,
    expire: new Date(Date.now() + SESSION_TTL),
    deviceId: deviceId ?? null,
    lastActiveAt: now,
  });
  return sid;
}

/**
 * Get a session by ID, checking both absolute expiry AND inactivity timeout.
 * Returns null (and deletes the row) if either check fails.
 */
export async function getSession(sid: string): Promise<SessionData | null> {
  const [row] = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.sid, sid));

  if (!row) return null;

  const now = new Date();

  // 1. Absolute expiry check
  if (row.expire < now) {
    await deleteSession(sid);
    return null;
  }

  // 2. Inactivity timeout check (30 minutes)
  const lastActive = row.lastActiveAt ?? row.expire;
  if (now.getTime() - lastActive.getTime() > INACTIVITY_TTL) {
    await deleteSession(sid);
    return null;
  }

  return row.sess as unknown as SessionData;
}

/**
 * Slide the inactivity window — called on every authenticated request.
 * Updates lastActiveAt to now without changing the absolute expire.
 */
export async function touchSession(sid: string): Promise<void> {
  await db
    .update(sessionsTable)
    .set({ lastActiveAt: new Date() })
    .where(eq(sessionsTable.sid, sid));
}

export async function updateSession(
  sid: string,
  data: SessionData,
): Promise<void> {
  await db
    .update(sessionsTable)
    .set({
      sess: data as unknown as Record<string, unknown>,
      expire: new Date(Date.now() + SESSION_TTL),
      lastActiveAt: new Date(),
    })
    .where(eq(sessionsTable.sid, sid));
}

/**
 * Delete all sessions belonging to a user (device binding: new login kills old sessions).
 * Uses a PostgreSQL JSON path query for efficiency.
 */
export async function deleteUserSessions(userId: string): Promise<void> {
  await db.execute(
    sql`DELETE FROM sessions WHERE sess->'user'->>'id' = ${userId}`,
  );
}

export async function deleteSession(sid: string): Promise<void> {
  await db.delete(sessionsTable).where(eq(sessionsTable.sid, sid));
}

export async function clearSession(
  res: Response,
  sid?: string,
): Promise<void> {
  if (sid) await deleteSession(sid);
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

export function getSessionId(req: Request): string | undefined {
  const authHeader = req.headers["authorization"];
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  return req.cookies?.[SESSION_COOKIE];
}
