/**
 * lib/desktop-auth.js — auth bridge for the Tauri desktop app.
 *
 * The desktop app runs on the tauri.localhost origin, which Supabase cannot
 * redirect back to. So OAuth sign-in and emailed links redirect to the
 * fivepm:// scheme instead; Windows hands that URL to the app, and this file
 * completes the exchange that detectSessionInUrl would normally do in a browser.
 *
 * In a browser or the PWA there is no window.__TAURI__, so every branch below
 * is skipped and the pages keep their existing web redirects.
 */
(function () {
  const T = window.__TAURI__;
  if (!T) return;

  // Read by the auth call sites in index.html and login.js.
  window.__DESKTOP_AUTH_REDIRECT = 'fivepm://auth';

  let handled = false;

  function client() {
    return window._sbClient || null;
  }

  async function handleUrl(raw) {
    // A cold start and the live event can both deliver the same URL.
    if (handled) return;

    let code = null;
    let errorText = null;
    try {
      const url = new URL(raw);
      // PKCE puts ?code= on the query; older implicit links use a #fragment.
      const hash = new URLSearchParams((url.hash || '').replace(/^#/, ''));
      code = url.searchParams.get('code') || hash.get('code');
      errorText = url.searchParams.get('error_description') || hash.get('error_description');
    } catch (e) {
      return;
    }

    if (errorText) { console.error('[desktop-auth] provider returned:', errorText); return; }
    if (!code) return;

    const sb = client();
    if (!sb) { console.error('[desktop-auth] no Supabase client on this page'); return; }

    handled = true;
    try {
      const { error } = await sb.auth.exchangeCodeForSession(code);
      if (error) throw error;
      // Mirror what the web build does once a session exists: the login page
      // moves on to the app, the app reloads so every view re-reads the session.
      if (/login\.html$/i.test(window.location.pathname)) {
        window.location.href = 'index.html';
      } else {
        window.location.reload();
      }
    } catch (e) {
      handled = false;
      console.error('[desktop-auth] code exchange failed:', e);
    }
  }

  // Launched by clicking the link while the app was closed.
  T.core.invoke('plugin:deep-link|get_current')
    .then(urls => { if (urls && urls[0]) handleUrl(urls[0]); })
    .catch(() => {});

  // Link opened while the app was already running.
  T.event.listen('deep-link://new-url', ev => {
    const urls = ev && ev.payload;
    if (urls && urls[0]) handleUrl(urls[0]);
  });
})();
