import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  serial,
  bigserial,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./auth";

export const profilesTable = pgTable(
  "profiles",
  {
    userId: text("user_id")
      .notNull()
      .primaryKey()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("user"),
    isAdmin: boolean("is_admin").notNull().default(false),
    anonymousUsername: text("anonymous_username").notNull(),
    avatarSeed: text("avatar_seed").notNull().default("sun"),
    theme: text("theme").notNull().default("light"),
    hasOnboarded: boolean("has_onboarded").notNull().default(false),
    // Welcome bonus: every new seeker gets ₹6 (= 1 free minute trial call).
    // The default applies at the DB level too, so even direct INSERTs get it.
    // Listener earns ₹1 for that free welcome-bonus minute, ₹2/min afterwards.
    walletBalanceInRupees: integer("wallet_balance_in_rupees")
      .notNull()
      .default(6),
    bonusBalanceInRupees: integer("bonus_balance_in_rupees")
      .notNull()
      .default(0),
    // True once the new user's free welcome-bonus minute has been consumed.
    welcomeBonusUsed: boolean("welcome_bonus_used").notNull().default(false),
    // Abuse tracking
    suspendedUntil: timestamp("suspended_until", { withTimezone: true }),
    violationCount: integer("violation_count").notNull().default(0),
    // Age (collected during male user onboarding)
    age: integer("age"),
    // WhatsApp number collected at signup — used as customer_phone for Cashfree
    whatsappNumber: text("whatsapp_number"),
    // Interest (collected during male user onboarding) — e.g. "emotional_support", "friendship", "dating", "general_chat"
    interest: text("interest"),
    // Presence — updated by /api/me/heartbeat every 60s while tab is visible.
    // "Online" = lastActiveAt > now() - 2min.
    lastActiveAt: timestamp("last_active_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // FCM push token for user-side engagement notifications
    fcmToken: text("fcm_token"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    anonUsernameIdx: uniqueIndex("profiles_anon_username_idx").on(
      t.anonymousUsername,
    ),
  }),
);

// ── Abuse violations log ──────────────────────────────────────────────────────
export const abuseViolationsTable = pgTable(
  "abuse_violations",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: text("user_id"),
    ipAddress: text("ip_address"),
    route: text("route").notNull(),
    reason: text("reason").notNull(),
    hitCount: integer("hit_count").notNull().default(1),
    autoSuspended: boolean("auto_suspended").notNull().default(false),
    suspendedUntil: timestamp("suspended_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("abuse_v_user_idx").on(t.userId),
    ipIdx:   index("abuse_v_ip_idx").on(t.ipAddress),
    timeIdx: index("abuse_v_time_idx").on(t.createdAt),
  }),
);

export const listenersTable = pgTable(
  "listeners",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" })
      .unique(),
    displayName: text("display_name").notNull(),
    gender: text("gender").notNull(),
    bio: text("bio").notNull(),
    skills: jsonb("skills").$type<string[]>().notNull().default([]),
    photoUrl: text("photo_url").notNull(),
    applicationStatus: text("application_status").notNull().default("pending"),
    rejectionReason: text("rejection_reason"),
    isOnline: boolean("is_online").notNull().default(false),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    pricePerMinuteChat: integer("price_per_minute_chat").notNull().default(4),
    pricePerMinuteCall: integer("price_per_minute_call").notNull().default(6),
    ratingAverage: integer("rating_average_x100").notNull().default(0),
    ratingCount: integer("rating_count").notNull().default(0),
    // Earnings tracked in paise (1/100 rupee) for precision (e.g. ₹1.5 = 150 paise)
    earningsBalancePaise: integer("earnings_balance_paise").notNull().default(0),
    totalEarningsPaise: integer("total_earnings_paise").notNull().default(0),
    // NOTE: New user welcome bonus = ₹6 wallet (= 1 free call minute trial).
    // Default applied in profilesTable below. Listener earns ₹2/min regardless of
    // whether the user paid or used the bonus.
    fcmToken: text("fcm_token"),
    // Call type availability toggles (listener can disable individually)
    audioCallsEnabled: boolean("audio_calls_enabled").notNull().default(true),
    videoCallsEnabled: boolean("video_calls_enabled").notNull().default(true),
    // Contact number (WhatsApp) collected during female listener onboarding
    contactNumber: text("contact_number"),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => ({
    statusIdx: index("listeners_status_idx").on(t.applicationStatus),
  }),
);

export const chatSessionsTable = pgTable(
  "chat_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    listenerId: text("listener_id")
      .notNull()
      .references(() => listenersTable.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("chat"),
    status: text("status").notNull().default("active"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    billedMinutes: integer("billed_minutes").notNull().default(0),
    totalCostInRupees: integer("total_cost_in_rupees").notNull().default(0),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  },
  (t) => ({
    userIdx: index("sessions_user_idx").on(t.userId),
    listenerIdx: index("sessions_listener_idx").on(t.listenerId),
  }),
);

export const chatMessagesTable = pgTable(
  "chat_messages",
  {
    id: serial("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => chatSessionsTable.id, { onDelete: "cascade" }),
    senderRole: text("sender_role").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    sessionIdx: index("messages_session_idx").on(t.sessionId),
  }),
);

export const reviewsTable = pgTable(
  "reviews",
  {
    id: serial("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => chatSessionsTable.id, { onDelete: "cascade" })
      .unique(),
    listenerId: text("listener_id")
      .notNull()
      .references(() => listenersTable.id, { onDelete: "cascade" }),
    reviewerUserId: text("reviewer_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    reviewerName: text("reviewer_name").notNull(),
    rating: integer("rating").notNull(),
    comment: text("comment").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    listenerIdx: index("reviews_listener_idx").on(t.listenerId),
    sessionIdx: uniqueIndex("reviews_session_idx").on(t.sessionId),
  }),
);

export const rechargeRequestsTable = pgTable(
  "recharge_requests",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    amountInRupees: integer("amount_in_rupees").notNull(),
    utrNumber: text("utr_number").notNull(),
    status: text("status").notNull().default("pending"), // pending | approved | rejected
    adminNote: text("admin_note"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("recharge_requests_user_idx").on(t.userId),
    statusIdx: index("recharge_requests_status_idx").on(t.status),
  }),
);

export const transactionsTable = pgTable(
  "transactions",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    userName: text("user_name").notNull(),
    kind: text("kind").notNull(),
    amountInRupees: integer("amount_in_rupees").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    description: text("description").notNull(),
    sessionId: text("session_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdx: index("transactions_user_idx").on(t.userId),
    createdIdx: index("transactions_created_idx").on(t.createdAt),
  }),
);

// ── Listener withdrawal requests ─────────────────────────────────────────────
export const withdrawalRequestsTable = pgTable(
  "withdrawal_requests",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    listenerId: text("listener_id")
      .notNull()
      .references(() => listenersTable.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    amountPaise: integer("amount_paise").notNull(),
    upiId: text("upi_id").notNull(),
    status: text("status").notNull().default("pending"), // pending | paid | rejected
    adminNote: text("admin_note"),
    // Bank/UPI payment reference (UTR) captured by admin at payout time.
    // Required by /pay endpoint so every paid request has an audit-grade reference.
    paymentReference: text("payment_reference"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    listenerIdx: index("withdrawal_requests_listener_idx").on(t.listenerId),
    statusIdx: index("withdrawal_requests_status_idx").on(t.status),
  }),
);

// ── Safety Reports (Listener → User) ─────────────────────────────────────────
export const safetyReportsTable = pgTable(
  "safety_reports",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    reporterListenerId: text("reporter_listener_id")
      .notNull()
      .references(() => listenersTable.id, { onDelete: "cascade" }),
    reportedUserId: text("reported_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .references(() => chatSessionsTable.id, { onDelete: "set null" }),
    category: text("category").notNull(), // "rude_abusive" | "sexual_harassment" | "fake_caller"
    notes: text("notes"),
    autoBlocked: boolean("auto_blocked").notNull().default(false),
    autoSuspendedUser: boolean("auto_suspended_user").notNull().default(false),
    reviewedByAdmin: boolean("reviewed_by_admin").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    listenerIdx: index("sr_listener_idx").on(t.reporterListenerId),
    userIdx: index("sr_user_idx").on(t.reportedUserId),
    timeIdx: index("sr_time_idx").on(t.createdAt),
  }),
);

// ── Listener ↔ User Blocks ───────────────────────────────────────────────────
export const listenerBlocksTable = pgTable(
  "listener_blocks",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    listenerUserId: text("listener_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    blockedUserId: text("blocked_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    listenerIdx: index("lb_listener_idx").on(t.listenerUserId),
    blockedIdx: index("lb_blocked_idx").on(t.blockedUserId),
    uniqueIdx: uniqueIndex("lb_unique_idx").on(t.listenerUserId, t.blockedUserId),
  }),
);

// ── Callback Requests (users requesting a listener callback) ──────────────────
export const callbackRequestsTable = pgTable(
  "callback_requests",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    userAnonymousName: text("user_anonymous_name").notNull(),
    listenerId: text("listener_id").references(() => listenersTable.id, { onDelete: "set null" }),
    listenerDisplayName: text("listener_display_name"),
    status: text("status").notNull().default("pending"), // pending | accepted | done | dismissed
    note: text("note"),
    respondedByListenerId: text("responded_by_listener_id").references(() => listenersTable.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
  },
  (t) => ({
    userIdx: index("cr_user_idx").on(t.userId),
    statusIdx: index("cr_status_idx").on(t.status),
    listenerIdx: index("cr_listener_idx").on(t.listenerId),
  }),
);

// ── Pending Admin Actions (two-person approval for large wallet adjustments) ──
// When an admin requests a wallet credit/adjust above the configured threshold,
// the action is parked here in `pending` state instead of being executed.
// A second admin (different user) must approve before the money is moved.
// `payload` carries the original request (amount, note, target balance) so the
// approver can apply the exact same change atomically.
export const pendingAdminActionsTable = pgTable(
  "pending_admin_actions",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    actionType: text("action_type").notNull(), // user_credit | user_adjust | listener_credit | listener_adjust
    targetType: text("target_type").notNull(), // wallet | listener_balance
    targetId: text("target_id").notNull(),
    targetName: text("target_name").notNull(),
    amountRupees: integer("amount_rupees").notNull(), // signed delta in rupees (for credit) or new balance (for adjust)
    note: text("note").notNull().default(""),
    payload: jsonb("payload").notNull().default({}),
    status: text("status").notNull().default("pending"), // pending | approved | rejected | expired
    requestedByUserId: text("requested_by_user_id").notNull(),
    requestedByEmail: text("requested_by_email").notNull(),
    decidedByUserId: text("decided_by_user_id"),
    decidedByEmail: text("decided_by_email"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index("paa_status_idx").on(t.status),
    timeIdx:   index("paa_time_idx").on(t.createdAt),
  }),
);

// ── Admin Audit Log ───────────────────────────────────────────────────────────
export const adminAuditLogsTable = pgTable(
  "admin_audit_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    adminUserId: text("admin_user_id").notNull(),
    adminEmail: text("admin_email").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    details: jsonb("details").notNull().default({}),
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    adminIdx: index("audit_logs_admin_idx").on(t.adminUserId),
    actionIdx: index("audit_logs_action_idx").on(t.action),
    timeIdx: index("audit_logs_time_idx").on(t.createdAt),
  }),
);

// ── Banned Devices ────────────────────────────────────────────────────────────
// Permanent device-ID ban list. When a user is removed by admin with the
// "ban device" flag, the device's firebaseUid is inserted here. The
// device-login / device-signup endpoints reject any deviceId present in
// this table, blocking re-registration from the same handset.
export const bannedDevicesTable = pgTable(
  "banned_devices",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    deviceId: text("device_id").notNull().unique(),
    reason: text("reason"),
    bannedByEmail: text("banned_by_email"),
    bannedUserId: text("banned_user_id"),
    bannedUserName: text("banned_user_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    deviceIdx: uniqueIndex("banned_devices_device_idx").on(t.deviceId),
    timeIdx: index("banned_devices_time_idx").on(t.createdAt),
  }),
);
