/**
 * Requests notification permission, obtains the FCM token via the service
 * worker (which receives background push messages), and registers it with
 * the backend so the server can address FCM pushes to this device.
 *
 * Only runs when `enabled` is true (i.e., the listener is approved + online).
 * Gracefully skips if VITE_FIREBASE_VAPID_KEY is not set.
 */
import { useEffect, useRef } from 'react';
import { getMessaging, getToken } from 'firebase/messaging';
import firebaseApp from '@/lib/firebase';

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;
const BASE = import.meta.env.BASE_URL?.replace(/\/$/, '') || '';

export function useFcmToken(enabled: boolean) {
  const doneRef = useRef(false);

  useEffect(() => {
    if (!enabled || doneRef.current) return;
    if (!('serviceWorker' in navigator) || !('Notification' in window)) return;

    if (!VAPID_KEY) {
      console.warn(
        '[FCM] VITE_FIREBASE_VAPID_KEY is not set.\n' +
        'Go to Firebase Console → Project Settings → Cloud Messaging → ' +
        'Web configuration → Generate key pair, then add it as ' +
        'VITE_FIREBASE_VAPID_KEY in your Replit Secrets.'
      );
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
          apiKey:            import.meta.env.VITE_FIREBASE_API_KEY            || '',
          authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN        || '',
          projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID         || '',
          messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
          appId:             import.meta.env.VITE_FIREBASE_APP_ID             || '',
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

        await fetch(`${BASE}/api/listener/fcm-token`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });

        console.log('[FCM] Token registered with server.');
      } catch (err) {
        console.warn('[FCM] Token registration failed:', err);
      }
    })();
  }, [enabled]);
}
