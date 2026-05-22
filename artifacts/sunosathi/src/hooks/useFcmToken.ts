/**
 * Requests notification permission, obtains the FCM token, and registers it
 * with the backend.
 *
 * - Native Android (APK): reads the native FCM token that
 *   MyFirebaseMessagingService stored in SharedPreferences via the
 *   window.SunoAudio.getNativeFcmToken() JS bridge. Retries up to 4×
 *   (every 3 s) to allow Firebase Android SDK time to call onNewToken().
 *
 * - Web / PWA: registers a service worker, obtains a web-push VAPID token
 *   via Firebase Web Messaging SDK.
 *
 * For ALL authenticated users → saves to /api/me/fcm-token (engagement push)
 * For listeners additionally  → saves to /api/listener/fcm-token (incoming calls)
 *
 * Gracefully skips if VITE_FIREBASE_VAPID_KEY is not set (web path only).
 */
import { useEffect, useRef } from 'react';
import { getMessaging, getToken } from 'firebase/messaging';
import { Capacitor } from '@capacitor/core';
import firebaseApp from '@/lib/firebase';
import { apiUrl } from '@/lib/apiBase';

// Pull config from the already-initialised Firebase app object so the
// service worker always uses the SAME Firebase project as the main app —
// even if VITE_FIREBASE_* env vars drift out of sync with firebase.ts.
const fbOpts = firebaseApp.options as Record<string, string>;

const IS_NATIVE  = Capacitor.isNativePlatform();
const VAPID_KEY  = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;

async function saveTokenToBackend(token: string, isListener: boolean) {
  await fetch(apiUrl('/api/me/fcm-token'), {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  if (isListener) {
    await fetch(apiUrl('/api/listener/fcm-token'), {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
  }
}

export function useFcmToken(enabled: boolean, isListener = false) {
  const doneRef = useRef(false);

  useEffect(() => {
    if (!enabled || doneRef.current) return;

    // ── Native Android: read token from SunoAudioBridge JS interface ──────────
    if (IS_NATIVE) {
      let attempts = 0;
      const MAX_ATTEMPTS = 5;
      const RETRY_MS     = 3_000;

      const tryNative = async () => {
        attempts++;
        try {
          const bridge = (window as any).SunoAudio;
          const token: string | null = bridge?.getNativeFcmToken?.() ?? null;

          if (!token) {
            if (attempts < MAX_ATTEMPTS) {
              setTimeout(tryNative, RETRY_MS);
            } else {
              console.warn('[FCM] Native token not available after', MAX_ATTEMPTS, 'attempts.');
            }
            return;
          }

          doneRef.current = true;
          await saveTokenToBackend(token, isListener);
          console.log('[FCM] Native token registered (listener=' + isListener + ')');
        } catch (err) {
          console.warn('[FCM] Native token registration failed:', err);
        }
      };

      tryNative();
      return;
    }

    // ── Web / PWA: service worker + VAPID ────────────────────────────────────
    if (!('serviceWorker' in navigator) || !('Notification' in window)) return;

    if (!VAPID_KEY) {
      console.warn('[FCM] VITE_FIREBASE_VAPID_KEY is not set. Add it in Replit Secrets.');
      return;
    }

    (async () => {
      try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          console.log('[FCM] Notification permission not granted.');
          return;
        }

        const params = new URLSearchParams({
          apiKey:            fbOpts['apiKey']            || '',
          authDomain:        fbOpts['authDomain']        || '',
          projectId:         fbOpts['projectId']         || '',
          messagingSenderId: fbOpts['messagingSenderId'] || '',
          appId:             fbOpts['appId']             || '',
        });

        const swReg = await navigator.serviceWorker.register(
          `/firebase-messaging-sw.js?${params.toString()}`,
          { scope: '/' }
        );
        await navigator.serviceWorker.ready;

        const messaging = getMessaging(firebaseApp);
        const token = await getToken(messaging, {
          vapidKey: VAPID_KEY,
          serviceWorkerRegistration: swReg,
        });

        if (!token) { console.warn('[FCM] Empty token received.'); return; }

        doneRef.current = true;
        await saveTokenToBackend(token, isListener);
        console.log('[FCM] Web token registered (listener=' + isListener + ')');
      } catch (err) {
        console.warn('[FCM] Token registration failed:', err);
      }
    })();
  }, [enabled, isListener]);
}
