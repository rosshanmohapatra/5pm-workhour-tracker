/**
 * Error monitoring with Sentry (errors only).
 *
 * What it sends: a crash report when 5pm hits an error it didn't expect
 * (message, where in the code, browser and OS, the app version, the last few
 * screen actions). What it never sends: your name, email, IP address, work
 * hours, typed text or screen recordings (no Session Replay, no tracing).
 * Email-like text and web address query strings are removed before sending.
 *
 * Loaded right after the pinned SDK (/lib/sentry.min.js) and before the app,
 * so errors during start-up are caught too.
 */
(function () {
  if (!window.Sentry) return;
  // Keep in step with APP_VERSION in lib/pages/index-app.js (a test checks it).
  var VERSION = '1.2.36';
  var host = location.hostname;
  var environment = window.__TAURI__
    ? 'desktop'
    : host === 'whtracker.vercel.app'
      ? 'production'
      : /\.vercel\.app$/.test(host)
        ? 'preview'
        : 'development';

  var EMAIL = /[^\s@"'<>]+@[^\s@"'<>]+\.[a-z]{2,}/gi;
  var scrub = function (s) {
    return typeof s === 'string' ? s.replace(EMAIL, '[email]') : s;
  };
  // host + path only: query strings can carry ids or tokens.
  var bareUrl = function (u) {
    if (typeof u !== 'string') return u;
    var i = u.search(/[?#]/);
    return i < 0 ? u : u.slice(0, i);
  };

  window.Sentry.init({
    dsn: 'https://b4341ee043adbd616073dead4fa7c444@o4512474129629184.ingest.us.sentry.io/4512474145816576',
    release: '5pm@' + VERSION,
    environment: environment,
    sendDefaultPii: false,
    // Only errors from 5pm's own files; browser extensions and other sites are ignored.
    allowUrls: [location.origin],
    maxBreadcrumbs: 30,
    beforeBreadcrumb: function (b) {
      if (b.data && b.data.url) b.data.url = bareUrl(b.data.url);
      if (b.message) b.message = scrub(b.message);
      return b;
    },
    beforeSend: function (event) {
      delete event.user;
      if (event.request) {
        if (event.request.url) event.request.url = bareUrl(event.request.url);
        delete event.request.cookies;
        delete event.request.headers;
        delete event.request.query_string;
      }
      if (event.message) event.message = scrub(event.message);
      ((event.exception && event.exception.values) || []).forEach(function (v) {
        v.value = scrub(v.value);
      });
      return event;
    }
  });
})();
