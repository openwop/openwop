/**
 * Web Push service worker for openwop notifications.
 *
 * Handles two events:
 *   - `push`           — incoming push from the BE; render an OS toast
 *   - `notificationclick` — user clicked the toast; focus the tab
 *                            (opening one if none exists) and route
 *                            to `data.actionUrl`
 *
 * Lifecycle:
 *   - registered by the FE at `/sw-push.js` when the user grants
 *     Notifications permission AND clicks "Enable push" in the panel
 *   - the BE sends payloads of the shape
 *       { title, body, tag, type, priority, actionUrl }
 *     mirroring the in-tab toast we already render via the Web
 *     Notifications API
 *
 * Hosted at the FE origin (app.openwop.dev), scope `/` so the
 * notification click can navigate anywhere in the SPA.
 */

self.addEventListener('install', () => {
  // Activate immediately so the first push delivery after subscribe
  // doesn't wait for a tab refresh.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Claim every open tab so they all start using this SW version.
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    // Malformed payload — log via the SW console and bail.
    return;
  }
  const title = String(payload.title ?? 'OpenWOP');
  const body = String(payload.body ?? '');
  const tag = String(payload.tag ?? '');
  const actionUrl = typeof payload.actionUrl === 'string' ? payload.actionUrl : '/';
  const priority = String(payload.priority ?? 'normal');

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      // Dedupes — same notificationId tag replaces a prior toast
      // instead of stacking two of the same row.
      tag,
      // Stays on screen until dismissed for urgent rows.
      requireInteraction: priority === 'urgent',
      icon: '/OpenWOP.svg',
      badge: '/OpenWOP.svg',
      // Click handler reads this to know where to navigate.
      data: { actionUrl },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.actionUrl) || '/';
  event.waitUntil((async () => {
    // Reuse the open tab when one exists rather than spawning a new
    // one — better UX for users who already have the app open.
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const tab of tabs) {
      // Same-origin tab — focus + navigate via the History API by
      // posting a message the SPA can pick up. Falls back to a hard
      // navigation when the SPA isn't running (rare — tab closed).
      const url = new URL(tab.url);
      if (url.origin === self.location.origin) {
        await tab.focus();
        try {
          tab.postMessage({ type: 'openwop:navigate', actionUrl: targetUrl });
        } catch { /* tab lost focus / closed during postMessage */ }
        return;
      }
    }
    // No open tab — open a new window.
    if (self.clients.openWindow) {
      await self.clients.openWindow(targetUrl);
    }
  })());
});
