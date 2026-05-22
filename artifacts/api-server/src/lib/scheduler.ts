/**
 * Background scheduler — runs continuously inside the Express process.
 *
 * Jobs:
 *  1. Keep-alive heartbeat (every 4 min)   — prevents proxy/deployment sleep
 *  2. User engagement notifications         — sends FCM when real listeners online
 *  3. Listener activity reminders           — nudges online listeners to stay active
 */
import { db } from "@workspace/db";
import { listenersTable, profilesTable } from "@workspace/db";
import { and, eq, isNotNull } from "@workspace/db";
import { getFirebaseMessaging } from "./firebaseAdmin";
import { logger } from "./logger";

// ── In-memory cooldown map (userId → last notified ms) ───────────────────────
// 2 h minimum between engagement notifications per user
const USER_COOLDOWN_MS    = 2 * 60 * 60 * 1000;
const userCooldown        = new Map<string, number>();

// 30 min between listener reminder sends (global, not per-listener)
let lastListenerReminderMs = 0;

// ── Message pools ─────────────────────────────────────────────────────────────
const USER_MSG_WITH_LISTENERS = [
  { title: "💜 {name} abhi online hai",      body: "Apni baat share karo — koi sun raha hai." },
  { title: "🌸 Sunne wala mil gaya",          body: "{name} aapka intezaar kar rahi hai. Connect karo!" },
  { title: "💬 {count} listeners available",  body: "{name} aur {count-1} aur — abhi baat karo." },
  { title: "🌙 Raat ko baat karo",            body: "{name} online hai — judge nahi, sirf sunti hai." },
  { title: "🤝 Dil ki baat share karo",       body: "{name} aapke liye available hai abhi." },
];

const USER_MSG_GENERAL = [
  { title: "💜 Akela mat feel karo",     body: "SunoSathi par listeners hain — bina darr ke baat karo." },
  { title: "🌸 Kuch dil ki baat hai?",   body: "Anonymous raho, khulke bolo — koi sun raha hai." },
  { title: "😌 Aaj kaisa raha din?",     body: "Apni feelings share karo — SunoSathi par koi wait kar raha hai." },
  { title: "✨ Apna dil halka karo",     body: "Ek call ya chat — sab theek ho jaayega. Connect karo abhi." },
];

const LISTENER_MSG = [
  { title: "🟢 Online raho!",         body: "Users aapki raah dekh rahe hain. Active reh kar zyada earn karo." },
  { title: "💪 Aap important ho",     body: "Har minute online rehna kisi ki madad kar sakta hai. Stay active!" },
  { title: "🌟 Earning ka mauka",     body: "Abhi users aapko dhundh rahe hain — online raho." },
  { title: "🎯 Active listeners chaahiye", body: "Users wait kar rahe hain — aap online hain, great! Bane raho." },
];

// ── FCM multicast helper ──────────────────────────────────────────────────────
async function sendMulticast(
  tokens: string[],
  title: string,
  body: string,
  data: Record<string, string>,
) {
  if (tokens.length === 0) return;
  // Split into chunks of 500 (FCM limit)
  for (let i = 0; i < tokens.length; i += 500) {
    const chunk = tokens.slice(i, i + 500);
    try {
      const result = await getFirebaseMessaging().sendEachForMulticast({
        tokens: chunk,
        notification: { title, body },
        data,
        android: {
          priority: "normal",
          notification: { channelId: "engagement", priority: "default", sound: "default" },
        },
        apns: {
          payload: { aps: { sound: "default", badge: 1, contentAvailable: true } },
        },
        webpush: {
          notification: {
            icon: "/icon-192.png",
            badge: "/badge-72.png",
            requireInteraction: false,
          },
          headers: { Urgency: "normal", TTL: "3600" },
        },
      });
      const failed = result.responses.filter((r) => !r.success).length;
      logger.info({ sent: chunk.length, failed }, "FCM multicast batch sent");
    } catch (err: any) {
      logger.warn({ err: err?.message }, "FCM multicast batch failed (non-fatal)");
    }
  }
}

// ── Job 1: User engagement notifications ─────────────────────────────────────
async function runEngagementJob() {
  try {
    // Online approved listeners
    const onlineListeners = await db
      .select({ displayName: listenersTable.displayName })
      .from(listenersTable)
      .where(
        and(
          eq(listenersTable.applicationStatus, "approved"),
          eq(listenersTable.isOnline, true),
        ),
      );

    // Users with FCM tokens
    const usersWithTokens = await db
      .select({ userId: profilesTable.userId, fcmToken: profilesTable.fcmToken })
      .from(profilesTable)
      .where(isNotNull(profilesTable.fcmToken));

    if (usersWithTokens.length === 0) {
      logger.debug("Engagement job: no users with FCM tokens yet");
      return;
    }

    // Cooldown filter
    const now = Date.now();
    const eligible = usersWithTokens.filter(
      (u) => now - (userCooldown.get(u.userId) ?? 0) > USER_COOLDOWN_MS,
    );
    if (eligible.length === 0) {
      logger.debug("Engagement job: all users in cooldown");
      return;
    }

    const tokens = eligible.map((u) => u.fcmToken!);

    // Build message
    let title: string;
    let body: string;
    if (onlineListeners.length > 0) {
      const listener = onlineListeners[Math.floor(Math.random() * onlineListeners.length)];
      const tpl = USER_MSG_WITH_LISTENERS[Math.floor(Math.random() * USER_MSG_WITH_LISTENERS.length)];
      title = tpl.title
        .replace("{name}", listener.displayName)
        .replace("{count}", String(onlineListeners.length));
      body = tpl.body
        .replace("{name}", listener.displayName)
        .replace("{count}", String(onlineListeners.length))
        .replace("{count-1}", String(Math.max(onlineListeners.length - 1, 0)));
    } else {
      const tpl = USER_MSG_GENERAL[Math.floor(Math.random() * USER_MSG_GENERAL.length)];
      title = tpl.title;
      body  = tpl.body;
    }

    await sendMulticast(tokens, title, body, {
      type: "engagement",
      onlineCount: String(onlineListeners.length),
    });

    // Update cooldowns
    for (const u of eligible) userCooldown.set(u.userId, now);

    logger.info(
      { eligible: eligible.length, onlineListeners: onlineListeners.length },
      "Engagement notifications sent",
    );
  } catch (err: any) {
    logger.warn({ err: err?.message }, "Engagement job error (non-fatal)");
  }
}

// ── Job 2: Listener activity reminders ───────────────────────────────────────
async function runListenerReminderJob() {
  try {
    const now = Date.now();
    if (now - lastListenerReminderMs < 25 * 60 * 1000) return; // guard double-fire
    lastListenerReminderMs = now;

    const onlineListeners = await db
      .select({ fcmToken: listenersTable.fcmToken })
      .from(listenersTable)
      .where(
        and(
          eq(listenersTable.applicationStatus, "approved"),
          eq(listenersTable.isOnline, true),
          isNotNull(listenersTable.fcmToken),
        ),
      );

    const tokens = onlineListeners.map((l) => l.fcmToken!).filter(Boolean);
    if (tokens.length === 0) {
      logger.debug("Listener reminder job: no online listeners with FCM token");
      return;
    }

    const tpl = LISTENER_MSG[Math.floor(Math.random() * LISTENER_MSG.length)];
    await sendMulticast(tokens, tpl.title, tpl.body, { type: "listener_reminder" });
    logger.info({ count: tokens.length }, "Listener reminder notifications sent");
  } catch (err: any) {
    logger.warn({ err: err?.message }, "Listener reminder job error (non-fatal)");
  }
}

// ── Job 3: Keep-alive heartbeat ───────────────────────────────────────────────
// Pings our own /api/health endpoint so Replit's deployment proxy never idles.
async function heartbeat() {
  const port = process.env["PORT"] ?? "3000";
  try {
    const res = await fetch(`http://localhost:${port}/api/health`);
    logger.debug({ status: res.status }, "💓 Self-ping heartbeat");
  } catch (err) {
    logger.warn({ err }, "💓 Heartbeat self-ping failed (non-fatal)");
  }
}

// ── Scheduler entry point ─────────────────────────────────────────────────────
export function startScheduler(): void {
  logger.info("Background scheduler started");

  // Heartbeat every 4 minutes — prevents deployment proxy from closing the process
  setInterval(heartbeat, 4 * 60 * 1000);

  // Listener reminders every 30 minutes
  setInterval(runListenerReminderJob, 30 * 60 * 1000);

  // User engagement — randomized between 9–13 minutes to avoid predictable patterns
  function scheduleEngagement() {
    const delayMs = (9 + Math.random() * 4) * 60 * 1000;
    setTimeout(async () => {
      await runEngagementJob();
      scheduleEngagement(); // reschedule with fresh random delay
    }, delayMs);
  }

  // First engagement run after 3 minutes (server warm-up)
  setTimeout(async () => {
    await runEngagementJob();
    scheduleEngagement();
  }, 3 * 60 * 1000);

  // First listener reminder after 5 minutes
  setTimeout(runListenerReminderJob, 5 * 60 * 1000);
}
