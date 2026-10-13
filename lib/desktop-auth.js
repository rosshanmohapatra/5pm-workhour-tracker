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

  // Emailed links (password reset) come back through the scheme, because a
  // temporary port no longer exists when the inbox is opened hours later.
  window.__DESKTOP_AUTH_REDIRECT = 'fivepm://auth';

  // OAuth comes back through a loopback port instead. Google will not complete
  // a web-application flow that carries a custom scheme.
  window.__DESKTOP_OAUTH_REDIRECT = 'http://localhost:47893';

  // Park the listener before the browser opens, so the callback cannot arrive
  // before anything is waiting for it.
  window.__desktopStartOAuth = async function (providerUrl) {
    await T.core.invoke('oauth_listen');
    await T.core.invoke('open_external', { url: providerUrl });
  };

  // Passkeys belong to whtracker.vercel.app, which this origin isn't, so the
  // browser signs in on passkey-desktop.html and sends the session back to the
  // loopback port. Only a hand-off carrying the state made here is accepted:
  // anything else could be a page or local process pushing someone else's
  // session in.
  let passkeyState = null;
  window.__desktopStartPasskey = async function () {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    passkeyState = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    await T.core.invoke('oauth_listen');
    await T.core.invoke('open_external', {
      url: 'https://whtracker.vercel.app/passkey-desktop.html?state=' + passkeyState
    });
  };

  let handled = false;

  function client() {
    return window._sbClient || null;
  }

  function done() {
    // Mirror what the web build does once a session exists: the login page
    // moves on to the app, the app reloads so every view re-reads the session.
    if (/login\.html$/i.test(window.location.pathname)) {
      window.location.href = 'index.html';
    } else {
      window.location.reload();
    }
  }

  async function handlePasskeyHandoff(url) {
    const p = url.searchParams;
    if (!passkeyState || p.get('state') !== passkeyState) {
      console.error('[desktop-auth] passkey hand-off with an unknown state, ignored');
      return;
    }
    passkeyState = null; // one use
    const sb = client();
    if (!sb) return;
    handled = true;
    try {
      const { error } = await sb.auth.setSession({
        access_token: p.get('access_token'), refresh_token: p.get('refresh_token')
      });
      if (error) throw error;
      // Rotate at once: the tokens also sit in the browser's history entry for
      // the loopback URL, and a used refresh token is worthless there.
      await sb.auth.refreshSession();
      done();
    } catch (e) {
      handled = false;
      console.error('[desktop-auth] passkey hand-off failed:', e);
    }
  }

  async function handleUrl(raw) {
    // A cold start and the live event can both deliver the same URL.
    if (handled) return;

    let code = null;
    let errorText = null;
    try {
      const url = new URL(raw);
      if (url.searchParams.has('refresh_token')) return handlePasskeyHandoff(url);
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
      done();
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

  // Browser hit the loopback port after an OAuth sign-in.
  T.event.listen('oauth://callback', ev => {
    if (ev && ev.payload) handleUrl(ev.payload);
  });
})();
