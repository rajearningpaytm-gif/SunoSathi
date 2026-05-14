/**
 * Requests notification permission, obtains the FCM token via the service
 * worker, and registers it with the backend.
 *
 * - For ALL authenticated users → saves to /api/me/fcm-token (engagement push)
 * - For listeners additionally   → saves to /api/listener/fcm-token (incoming calls)
 *
 * Gracefully skips if VITE_FIREBASE_VAPID_KEY is not set.
 */
import { useEffect, useRef } from 'react';
import { getMessaging, getToken } from 'firebase/messaging';
import firebaseApp from '@/lib/firebase';

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;
const BASE = import.meta.env.BASE_URL?.replace(/\/$/, '') || '';

export function useFcmToken(enabled: boolean, isListener = false) {
  const doneRef = useRef(false);

  useEffect(() => {
    if (!enabled || doneRef.current) return;
    if (!('serviceWorker' in navigator) || !('Notification' in window)) return;

    if (!VAPID_KEY) {
      console.warn(
        '[FCM] VITE_FIREBASE_VAPID_KEY is not set. Add it in Replit Secrets.'
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

        // Always save to user profile (engagement notifications for all users)
        await fetch(`${BASE}/api/me/fcm-token`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });

        // Also save to listener record for incoming call/chat notifications
        if (isListener) {
          await fetch(`${BASE}/api/listener/fcm-token`, {
            method: 'PUT',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token }),
          });
        }

        console.log(`[FCM] Token registered (listener=${isListener}).`);
      } catch (err) {
        console.warn('[FCM] Token registration failed:', err);
      }
    })();
  }, [enabled, isListener]);
}
