/**
 * Firebase Admin SDK singleton.
 * Initialized lazily on first use so startup doesn't block if the secret
 * hasn't been set yet (will throw clearly on first call instead).
 */
import { type App, initializeApp, getApps, cert } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getMessaging, type Messaging } from "firebase-admin/messaging";
import { getDatabase, type Database } from "firebase-admin/database";
import { logger } from "./logger";

const FIREBASE_PROJECT_ID = "sunosathi-ef83d";
const REALTIME_DB_URL = `https://${FIREBASE_PROJECT_ID}-default-rtdb.firebaseio.com`;

let _app: App | null = null;
let _auth: Auth | null = null;
let _messaging: Messaging | null = null;
let _rtdb: Database | null = null;

function initFirebaseAdmin(): App {
  if (getApps().length > 0) return getApps()[0];

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT secret is not set. " +
      "Add the Firebase service account JSON as a Replit Secret.",
    );
  }

  let serviceAccount: object;
  try {
    serviceAccount = JSON.parse(raw);
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT is not valid JSON.");
  }

  const app = initializeApp({
    credential: cert(serviceAccount as any),
    databaseURL: REALTIME_DB_URL,
  });
  logger.info("Firebase Admin SDK initialized");
  return app;
}

export function getFirebaseAuth(): Auth {
  if (!_auth) {
    _app = initFirebaseAdmin();
    _auth = getAuth(_app);
  }
  return _auth;
}

export function getFirebaseMessaging(): Messaging {
  if (!_messaging) {
    _app = initFirebaseAdmin();
    _messaging = getMessaging(_app);
  }
  return _messaging;
}

export function getFirebaseRealtimeDB(): Database {
  if (!_rtdb) {
    _app = initFirebaseAdmin();
    _rtdb = getDatabase(_app);
  }
  return _rtdb;
}

/**
 * Sync a new user's profile to Firebase Realtime Database under users/{userId}.
 * This keeps the admin panel updated in real-time.
 * Non-blocking — caller should .catch() the returned promise.
 */
export async function syncUserToRealtimeDB(userData: {
  userId: string;
  internalId: string;
  name: string;
  age: number;
  gender: string;
  whatsappNumber: string;
  profilePic: string;
  deviceId: string;
  createdAt: string;
}): Promise<void> {
  const rtdb = getFirebaseRealtimeDB();
  await rtdb.ref(`users/${userData.userId}`).set(userData);
  logger.info({ userId: userData.userId }, "User synced to Firebase Realtime DB");
}

/**
 * Sync a listener's earnings to Firebase Realtime Database under
 * `listeners/{userId}/earnings` so the Earnings dashboard updates LIVE
 * (no polling, no refresh) the moment a per-minute billing tick credits
 * the listener's wallet.
 *
 * Listener earns ₹2/min for every call minute deducted from the user —
 * including the welcome-bonus minute that the user got for free.
 *
 * Non-blocking — caller should .catch() the returned promise.
 */
export async function syncListenerEarningsToRealtimeDB(opts: {
  userId: string;                // internal user id of the listener
  earningsBalancePaise: number;
  totalEarningsPaise: number;
  lastCreditPaise?: number;      // amount just credited (e.g. 200 = ₹2)
  sessionKind?: string;          // "call" | "video_call" | "chat"
}): Promise<void> {
  const rtdb = getFirebaseRealtimeDB();
  await rtdb.ref(`listeners/${opts.userId}/earnings`).set({
    earningsBalancePaise: opts.earningsBalancePaise,
    totalEarningsPaise:   opts.totalEarningsPaise,
    earningsBalanceRupees: opts.earningsBalancePaise / 100,
    totalEarningsRupees:   opts.totalEarningsPaise   / 100,
    lastCreditPaise:       opts.lastCreditPaise ?? 0,
    lastCreditRupees:     (opts.lastCreditPaise ?? 0) / 100,
    sessionKind:           opts.sessionKind ?? null,
    updatedAt:             Date.now(),
  });
}

/**
 * Verify a Firebase ID token and return the decoded token.
 * Throws if the token is invalid or expired.
 */
export async function verifyFirebaseToken(idToken: string) {
  const auth = getFirebaseAuth();
  return auth.verifyIdToken(idToken, true); // checkRevoked = true
}

/**
 * Send a high-priority FCM push notification to a listener's device
 * for an incoming call/chat. Gracefully swallows errors so the call
 * still proceeds even if FCM is misconfigured.
 */
export async function sendCallFcm(opts: {
  fcmToken: string;
  sessionId: string;
  userName: string;
  kind: "call" | "chat" | "video_call";
}): Promise<void> {
  const { fcmToken, sessionId, userName, kind } = opts;
  try {
    // Data-only message (no `notification` field) so that:
    //   Android APK: MyFirebaseMessagingService.onMessageReceived() is called in
    //                background/killed state → shows custom CallStyle notification
    //   Web PWA SW:  firebase-messaging-sw.js onBackgroundMessage() is called
    //                → service worker shows notification with Accept/Decline buttons
    const msg = await getFirebaseMessaging().send({
      token: fcmToken,
      data: {
        sessionId,
        kind,
        userName,
        type: "incoming_call",
      },
      android: {
        priority: "high",
        ttl: 20_000,
      },
      apns: {
        headers: {
          "apns-priority": "10",
          "apns-expiration": String(Math.floor(Date.now() / 1000) + 20),
          "apns-push-type": "background",
        },
        payload: { aps: { contentAvailable: true, sound: "default" } },
      },
      webpush: {
        headers: { Urgency: "high", TTL: "20" },
      },
    });
    logger.info({ msg, sessionId, kind }, "FCM call notification sent");
  } catch (err: any) {
    logger.warn({ err: err?.message, sessionId }, "FCM send failed (non-fatal)");
  }
}
