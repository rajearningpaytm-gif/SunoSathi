import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  listenersTable,
  reviewsTable,
  profilesTable,
  chatSessionsTable,
} from "@workspace/db";
import {
  ListListenersQueryParams,
  GetListenerByIdParams,
  GetListenerReviewsParams,
  PostListenerReviewBody,
  PostListenerReviewParams,
} from "@workspace/api-zod";
import { and, eq, desc, sql } from "@workspace/db";
import { ensureProfile, avg100ToFloat, recomputeListenerRating } from "../lib/profile";

const router: IRouter = Router();

const MOOD_TO_SKILL: Record<string, string> = {
  sad: "Sadness",
  lonely: "Loneliness",
  stress: "Stress",
  anxiety: "Anxiety",
  breakup: "Breakup",
  motivation: "Motivation",
};

function listenerToDto(l: typeof listenersTable.$inferSelect) {
  return {
    id: l.id,
    displayName: l.displayName,
    gender: l.gender,
    bio: l.bio,
    skills: l.skills ?? [],
    photoUrl: l.photoUrl,
    ratingAverage: avg100ToFloat(l.ratingAverage),
    ratingCount: l.ratingCount,
    isOnline: l.isOnline,
    lastSeenAt: l.lastSeenAt ? l.lastSeenAt.toISOString() : null,
    pricePerMinuteChat: l.pricePerMinuteChat,
    pricePerMinuteCall: l.pricePerMinuteCall,
    audioCallsEnabled: l.audioCallsEnabled,
    videoCallsEnabled: l.videoCallsEnabled,
  };
}

router.get("/listeners", async (req, res) => {
  const parsed = ListListenersQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query" });
    return;
  }
  const { gender, mood, onlyOnline } = parsed.data;
  const all = await db
    .select()
    .from(listenersTable)
    .where(eq(listenersTable.applicationStatus, "approved"))
    .orderBy(desc(listenersTable.isOnline), desc(listenersTable.ratingAverage));
  let result = all;
  if (gender && gender !== "all") {
    result = result.filter((l) => l.gender === gender);
  }
  if (mood && mood !== "all") {
    const skill = MOOD_TO_SKILL[mood];
    if (skill) {
      result = result.filter((l) => (l.skills ?? []).includes(skill));
    }
  }
  if (onlyOnline) {
    result = result.filter((l) => l.isOnline);
  }
  res.json(result.map(listenerToDto));
});

router.get("/listeners/featured", async (_req, res) => {
  const rows = await db
    .select()
    .from(listenersTable)
    .where(eq(listenersTable.applicationStatus, "approved"))
    .orderBy(desc(listenersTable.ratingAverage), desc(listenersTable.ratingCount))
    .limit(6);
  res.json(rows.map(listenerToDto));
});

router.get("/listeners/moods", async (_req, res) => {
  const rows = await db
    .select()
    .from(listenersTable)
    .where(eq(listenersTable.applicationStatus, "approved"));
  const moods: { key: string; label: string; description: string }[] = [
    { key: "sad", label: "Feeling Sad", description: "Talk to someone who will sit with you in it." },
    { key: "lonely", label: "Lonely Tonight", description: "A little company can change everything." },
    { key: "stress", label: "Overwhelmed", description: "Slow down — it's okay to be tired." },
    { key: "anxiety", label: "Anxious", description: "Find a calm voice that helps you breathe." },
    { key: "breakup", label: "Heartbreak", description: "Heal one quiet conversation at a time." },
    { key: "motivation", label: "Need a Push", description: "A pep talk from someone who believes in you." },
  ];
  res.json(
    moods.map((m) => ({
      ...m,
      listenerCount: rows.filter((l) =>
        (l.skills ?? []).includes(MOOD_TO_SKILL[m.key] ?? ""),
      ).length,
    })),
  );
});

router.get("/listeners/:id", async (req, res) => {
  const parsed = GetListenerByIdParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const id = parsed.data.id;
  const rows = await db
    .select()
    .from(listenersTable)
    .where(eq(listenersTable.id, id))
    .limit(1);
  const listener = rows[0];
  if (!listener || listener.applicationStatus !== "approved") {
    res.status(404).json({ error: "Listener not found" });
    return;
  }
  const reviews = await db
    .select()
    .from(reviewsTable)
    .where(eq(reviewsTable.listenerId, id))
    .orderBy(desc(reviewsTable.createdAt))
    .limit(20);
  const sessionsCountRow = await db.execute<{ count: string }>(
    sql`SELECT COUNT(*) AS count FROM chat_sessions WHERE listener_id = ${id}`,
  );
  const totalSessions = sessionsCountRow.rows[0]
    ? Number(sessionsCountRow.rows[0].count)
    : 0;
  res.json({
    ...listenerToDto(listener),
    reviews: reviews.map((r) => ({
      id: String(r.id),
      listenerId: r.listenerId,
      reviewerName: r.reviewerName,
      rating: r.rating,
      comment: r.comment,
      createdAt: r.createdAt.toISOString(),
    })),
    totalSessions,
  });
});

router.get("/listeners/:id/reviews", async (req, res) => {
  const parsed = GetListenerReviewsParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const reviews = await db
    .select()
    .from(reviewsTable)
    .where(eq(reviewsTable.listenerId, parsed.data.id))
    .orderBy(desc(reviewsTable.createdAt));
  res.json(
    reviews.map((r) => ({
      id: String(r.id),
      listenerId: r.listenerId,
      reviewerName: r.reviewerName,
      rating: r.rating,
      comment: r.comment,
      createdAt: r.createdAt.toISOString(),
    })),
  );
});

router.post("/listeners/:id/reviews", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const params = PostListenerReviewParams.safeParse(req.params);
  const body = PostListenerReviewBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const profile = await ensureProfile(req.user.id);
  const listenerRows = await db
    .select()
    .from(listenersTable)
    .where(eq(listenersTable.id, params.data.id))
    .limit(1);
  if (!listenerRows[0]) {
    res.status(404).json({ error: "Listener not found" });
    return;
  }
  // Check the session belongs to this user
  const sessionRows = await db
    .select()
    .from(chatSessionsTable)
    .where(and(eq(chatSessionsTable.id, body.data.sessionId), eq(chatSessionsTable.userId, req.user.id)))
    .limit(1);
  if (!sessionRows[0]) {
    res.status(403).json({ error: "Session not found or not yours" });
    return;
  }
  // Prevent duplicate review for the same session
  const existing = await db
    .select()
    .from(reviewsTable)
    .where(eq(reviewsTable.sessionId, body.data.sessionId))
    .limit(1);
  if (existing[0]) {
    res.status(409).json({ error: "You have already reviewed this session" });
    return;
  }
  const [created] = await db
    .insert(reviewsTable)
    .values({
      sessionId: body.data.sessionId,
      listenerId: params.data.id,
      reviewerUserId: req.user.id,
      reviewerName: profile.anonymousUsername,
      rating: body.data.rating,
      comment: body.data.comment,
    })
    .returning();
  if (!created) {
    res.status(500).json({ error: "Failed" });
    return;
  }
  await recomputeListenerRating(params.data.id);
  res.json({
    id: String(created.id),
    listenerId: created.listenerId,
    reviewerName: created.reviewerName,
    rating: created.rating,
    comment: created.comment,
    createdAt: created.createdAt.toISOString(),
  });
});

export default router;
