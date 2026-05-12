import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  callbackRequestsTable,
  listenersTable,
  profilesTable,
} from "@workspace/db";
import { eq, desc, or, isNull, and } from "@workspace/db";
import { z } from "zod";

const router: IRouter = Router();

const CreateCallbackBody = z.object({
  note: z.string().max(200).optional(),
  listenerId: z.string().optional(),
});

// ── POST /callback-request — user creates a callback request ─────────────────
router.post("/callback-request", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const parsed = CreateCallbackBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid request" }); return; }

  const [profile] = await db.select().from(profilesTable).where(eq(profilesTable.userId, req.user.id)).limit(1);
  if (!profile) { res.status(404).json({ error: "Profile not found" }); return; }
  if (profile.role !== "user") { res.status(403).json({ error: "Only users can request callbacks" }); return; }

  let listenerDisplayName: string | null = null;
  if (parsed.data.listenerId) {
    const [listener] = await db.select().from(listenersTable).where(eq(listenersTable.id, parsed.data.listenerId)).limit(1);
    if (listener) listenerDisplayName = listener.displayName;
  }

  const [created] = await db.insert(callbackRequestsTable).values({
    userId: req.user.id,
    userAnonymousName: profile.anonymousUsername,
    listenerId: parsed.data.listenerId ?? null,
    listenerDisplayName: listenerDisplayName ?? null,
    note: parsed.data.note ?? null,
    status: "pending",
  }).returning();

  res.status(201).json({ id: created.id, status: created.status, createdAt: created.createdAt.toISOString() });
});

// ── GET /callback-requests/mine — user views own requests ────────────────────
router.get("/callback-requests/mine", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const rows = await db.select().from(callbackRequestsTable)
    .where(eq(callbackRequestsTable.userId, req.user.id))
    .orderBy(desc(callbackRequestsTable.createdAt))
    .limit(20);
  res.json(rows.map(r => ({
    id: r.id,
    status: r.status,
    note: r.note,
    listenerDisplayName: r.listenerDisplayName,
    createdAt: r.createdAt.toISOString(),
    respondedAt: r.respondedAt ? r.respondedAt.toISOString() : null,
  })));
});

// ── GET /listener/callback-requests — listener sees pending requests ──────────
router.get("/listener/callback-requests", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const [listener] = await db.select().from(listenersTable).where(eq(listenersTable.userId, req.user.id)).limit(1);
  if (!listener) { res.status(404).json({ error: "No listener profile" }); return; }
  if (listener.applicationStatus !== "approved") { res.json([]); return; }

  const rows = await db.select().from(callbackRequestsTable)
    .where(
      and(
        eq(callbackRequestsTable.status, "pending"),
        or(
          eq(callbackRequestsTable.listenerId, listener.id),
          isNull(callbackRequestsTable.listenerId)
        )
      )
    )
    .orderBy(desc(callbackRequestsTable.createdAt))
    .limit(50);

  res.json(rows.map(r => ({
    id: r.id,
    userAnonymousName: r.userAnonymousName,
    note: r.note,
    listenerId: r.listenerId,
    listenerDisplayName: r.listenerDisplayName,
    createdAt: r.createdAt.toISOString(),
    status: r.status,
  })));
});

// ── POST /listener/callback-requests/:id/accept ───────────────────────────────
router.post("/listener/callback-requests/:id/accept", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const [listener] = await db.select().from(listenersTable).where(eq(listenersTable.userId, req.user.id)).limit(1);
  if (!listener) { res.status(404).json({ error: "No listener profile" }); return; }

  const [request] = await db.select().from(callbackRequestsTable).where(eq(callbackRequestsTable.id, req.params.id)).limit(1);
  if (!request) { res.status(404).json({ error: "Request not found" }); return; }
  if (request.status !== "pending") { res.status(400).json({ error: "Request is no longer pending" }); return; }

  const [updated] = await db.update(callbackRequestsTable)
    .set({ status: "accepted", respondedByListenerId: listener.id, respondedAt: new Date() })
    .where(eq(callbackRequestsTable.id, req.params.id))
    .returning();

  res.json({ id: updated.id, status: updated.status });
});

// ── POST /listener/callback-requests/:id/done ─────────────────────────────────
router.post("/listener/callback-requests/:id/done", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const [listener] = await db.select().from(listenersTable).where(eq(listenersTable.userId, req.user.id)).limit(1);
  if (!listener) { res.status(404).json({ error: "No listener profile" }); return; }

  const [updated] = await db.update(callbackRequestsTable)
    .set({ status: "done", respondedAt: new Date() })
    .where(and(
      eq(callbackRequestsTable.id, req.params.id),
      or(
        eq(callbackRequestsTable.respondedByListenerId, listener.id),
        isNull(callbackRequestsTable.respondedByListenerId)
      )
    ))
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found or unauthorized" }); return; }
  res.json({ id: updated.id, status: updated.status });
});

// ── POST /listener/callback-requests/:id/dismiss ──────────────────────────────
router.post("/listener/callback-requests/:id/dismiss", async (req, res) => {
  if (!req.isAuthenticated()) { res.status(401).json({ error: "Unauthorized" }); return; }
  const [listener] = await db.select().from(listenersTable).where(eq(listenersTable.userId, req.user.id)).limit(1);
  if (!listener) { res.status(404).json({ error: "No listener profile" }); return; }

  const [updated] = await db.update(callbackRequestsTable)
    .set({ status: "dismissed" })
    .where(eq(callbackRequestsTable.id, req.params.id))
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ id: updated.id, status: updated.status });
});

export default router;
