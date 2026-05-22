import { sql } from "drizzle-orm";
import { boolean, index, jsonb, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

// (IMPORTANT) This table is mandatory for Replit Auth, don't drop it.
export const sessionsTable = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
    // Device binding — one active session per device
    deviceId: varchar("device_id"),
    // Inactivity timeout — session dies after 30 min of no activity
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("IDX_session_expire").on(table.expire),
    index("idx_sessions_device").on(table.deviceId),
  ],
);

// (IMPORTANT) This table is mandatory for Replit Auth, don't drop it.
export const usersTable = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // Firebase UID — set when user logs in via Firebase Phone Auth
  firebaseUid: varchar("firebase_uid").unique(),
  email: varchar("email").unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  emailVerifyToken: varchar("email_verify_token"),
  emailVerifyTokenExpiry: timestamp("email_verify_token_expiry", { withTimezone: true }),
  passwordHash: varchar("password_hash"),
  phone: varchar("phone").unique(),
  phoneVerified: boolean("phone_verified").notNull().default(false),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  // Test account flag — bypasses intent enforcement in Firebase auth so the same
  // number can be re-registered during QA. Toggle via admin dashboard.
  isTestAccount: boolean("is_test_account").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const otpCodesTable = pgTable(
  "otp_codes",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    phone: varchar("phone").notNull(),
    code: varchar("code", { length: 6 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    used: boolean("used").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("IDX_otp_phone").on(table.phone)],
);

export type UpsertUser = typeof usersTable.$inferInsert;
export type User = typeof usersTable.$inferSelect;
