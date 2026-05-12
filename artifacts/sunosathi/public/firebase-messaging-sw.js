/* Firebase Messaging Service Worker
 * Handles background FCM push messages for incoming calls.
 * Config is injected via query-string when the app registers this SW.
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

messaging.onBackgroundMessage((payload) => {
  const data     = payload.data    || {};
  const notif    = payload.notification || {};
  const sessionId = data.sessionId || '';
  const userName  = notif.title    || data.userName || 'Someone';
  const kind      = data.kind      || 'call';

  const title = kind === 'call'
    ? `📞 Incoming call from ${userName}`
    : `💬 ${userName} wants to chat`;

  self.registration.showNotification(title, {
    body:             kind === 'call' ? 'Tap "Accept" to answer' : 'Tap to open chat',
    icon:             '/icon-192.png',
    badge:            '/icon-72.png',
    tag:              `incoming-${sessionId}`,
    renotify:         true,
    requireInteraction: true,
    vibrate:          [300, 150, 300, 150, 300],
    silent:           false,
    actions: [
      { action: 'accept',  title: '✅ Accept' },
      { action: 'decline', title: '❌ Decline' },
    ],
    data: { sessionId, kind, url: `${self.location.origin}/chat/${sessionId}` },
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const { sessionId, url } = event.notification.data || {};

  if (event.action === 'decline' && sessionId) {
    event.waitUntil(
      fetch(`/api/chat/sessions/${sessionId}/decline`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      }).catch(() => {})
    );
    return;
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.postMessage({ type: 'INCOMING_CALL_ACCEPT', sessionId });
          return client.focus();
        }
      }
      return clients.openWindow(url || '/');
    })
  );
});
