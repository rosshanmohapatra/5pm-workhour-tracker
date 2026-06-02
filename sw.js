// 5pm Service Worker — enables native notifications when tab is backgrounded
self.addEventListener('install',  () => self.skipWaiting());
self.addEventListener('activate', e  => e.waitUntil(clients.claim()));

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const action = e.notification.tag; // 'target', 'overtime', 'forgotStop', etc.
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      let target = null;
      for (const c of list) {
        if (c.url.includes('/index') || c.url.endsWith('/')) { target = c; break; }
      }
      // Post message to page so it can end the session
      if (target) {
        target.postMessage({ type: 'notification_click', tag: action });
        return target.focus();
      }
      return clients.openWindow('/');
    })
  );
});
