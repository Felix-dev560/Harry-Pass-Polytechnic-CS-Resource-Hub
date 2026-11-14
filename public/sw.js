// Service worker: receives push messages and shows them as device notifications, even when the site is closed.
// It lives at the site root so it covers both the student pages and /admin/.
'use strict';

// The school crest shown on every notification (replaces the grey letter Chrome draws when there is no picture).
const ICON = '/assets/notify-icon.png';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Harry Pass CS Hub';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: data.icon || ICON,
    tag: data.tag || undefined, // same tag replaces the older notification instead of stacking
    data: { url: data.url || '/' },
  }));
});

// Tapping the notification opens the exact page (course and year, or the admin photo list).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of open) {
      if (new URL(client.url).origin !== self.location.origin) continue;
      try {
        await client.focus();
        if ('navigate' in client) { await client.navigate(target); return; }
      } catch { /* fall through and open a new window */ }
    }
    await self.clients.openWindow(target);
  })());
});