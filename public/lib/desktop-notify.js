/**
 * lib/desktop-notify.js — native notifications for the Tauri desktop app.
 *
 * WebView2 ships no Web Notifications API, so window.Notification is undefined
 * and several call sites that read Notification.permission throw outright.
 * This defines a stand-in that forwards to a native Windows toast, which lets
 * every existing notification path (notify, _fireNotif, scheduleNotifications)
 * run unchanged.
 *
 * No-op in a browser or the PWA, where the real API already exists.
 */
(function () {
  const T = window.__TAURI__;
  if (!T) return;

  function DesktopNotification(title, options) {
    const opts = options || {};
    // Kept for call sites that assign one; a Windows toast click activates the
    // app itself rather than calling back into the page.
    this.onclick = null;
    this.title = title;
    this.body = opts.body || '';

    T.core
      .invoke('notify', { title: String(title || ''), body: String(this.body) })
      .catch(err => console.warn('[desktop-notify] toast failed:', err));
  }

  DesktopNotification.prototype.close = function () {};
  DesktopNotification.prototype.addEventListener = function () {};
  DesktopNotification.prototype.removeEventListener = function () {};

  // Windows has no per-site permission prompt; the OS owns that setting.
  DesktopNotification.permission = 'granted';
  DesktopNotification.requestPermission = function () {
    return Promise.resolve('granted');
  };

  window.Notification = DesktopNotification;
})();
