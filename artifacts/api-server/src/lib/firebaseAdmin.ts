/**
 * Firebase Admin SDK singleton.
 * Initialized lazily on first use so startup doesn't block if the secret
 * hasn't been set yet (will throw clearly on first call instead).
 */
import { type App, initializeApp, getApps, cert } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getMessaging, type Messaging } from "firebase-admin/messaging";
import { logger } from "./logger";

let _app: App | null = null;
let _auth: Auth | null = null;
let _messaging: Messaging | null = null;

function initFirebaseAdmin(): App {
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

  if (getApps().length > 0) return getApps()[0];

  const app = initializeApp({ credential: cert(serviceAccount as any) });
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
