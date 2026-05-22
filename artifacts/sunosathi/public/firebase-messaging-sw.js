/* Firebase Messaging Service Worker
 * Handles background FCM push messages for incoming calls.
 * Config is injected via query-string when the app registers this SW.
 *
 * NOTE: The server sends data-only FCM messages (no `notification` field).
 * This handler is responsible for showing the system notification.
 */
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

const params = new URL(location.href).searchParams;

const firebaseConfig = {
  apiKey:            params.get('apiKey')            || '',
  authDomain:        params.get('authDomain')        || '',
  projectId:         params.get('projectId')         || '',
  messagingSenderId: params.get('messagingSenderId') || '',
  appId:             params.get('appId')             || '',
};

if (firebaseConfig.projectId && !firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const messaging = firebase.messaging();

// Base path of the React app (Vite BASE_URL = /sunosathi)
const APP_BASE = '/sunosathi';

messaging.onBackgroundMessage((payload) => {
  const data    = payload.data || {};
  const sessionId = data.sessionId || '';
  const userName  = data.userName  || 'Someone';
  const kind      = data.kind      || 'call';

  if (data.type !== 'incoming_call') return;

  const title = kind === 'video_call'
    ? `📹 Incoming video call from ${userName}`
    : kind === 'call'
    ? `📞 Incoming call from ${userName}`
    : `💬 ${userName} wants to chat`;

  const body = kind === 'call' || kind === 'video_call'
    ? 'Accept karo — aapke paas 20 second hain'
    : 'Chat kholne ke liye tap karo';

  const callPath = kind === 'chat'
    ? `${APP_BASE}/chat/${sessionId}`
    : kind === 'video_call'
    ? `${APP_BASE}/call/${sessionId}?video=1`
    : `${APP_BASE}/call/${sessionId}`;

  self.registration.showNotification(title, {
    body,
    icon:               '/icon-192.png',
    badge:              '/icon-72.png',
    tag:                `incoming-${sessionId}`,
    renotify:           true,
    requireInteraction: true,
    vibrate:            [400, 200, 400, 200, 400],
    silent:             false,
    actions: [
      { action: 'accept',  title: '✅ Accept' },
      { action: 'decline', title: '❌ Decline' },
    ],
    data: { sessionId, kind, url: `${self.location.origin}${callPath}` },
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const { sessionId, kind, url } = event.notification.data || {};

  if (event.action === 'decline') {
    if (sessionId) {
      event.waitUntil(
        fetch(`/api/chat/sessions/${sessionId}/decline`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        }).catch(() => {})
      );
    }
    return;
  }

  // "accept" action or plain tap: accept the session first, then open / focus app
  event.waitUntil(
    (sessionId
      ? fetch(`/api/chat/sessions/${sessionId}/accept`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        }).catch(() => {})
      : Promise.resolve()
    ).then(() =>
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        for (const client of clientList) {
          if ('focus' in client) {
            client.postMessage({ type: 'INCOMING_CALL_ACCEPT', sessionId, kind });
            return client.focus();
          }
        }
        // No open window — open the call page directly
        return clients.openWindow(url || `${self.location.origin}${APP_BASE}/`);
      })
    )
  );
});
