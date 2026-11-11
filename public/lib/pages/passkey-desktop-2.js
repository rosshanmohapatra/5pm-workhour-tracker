    if (document.documentElement.classList.contains('dark')) {
      document.getElementById('logo').src = '/icons/brand-dark.svg';
      document.getElementById('favicon').href = '/icons/favicon-dark.svg';
    }
    var state = new URLSearchParams(location.search).get('state') || '';
    var btn = document.getElementById('go'), msg = document.getElementById('msg');
    function say(text, err) { msg.textContent = text; msg.className = err ? 'err' : ''; }

    if (!/^[A-Za-z0-9_-]{32,128}$/.test(state)) {
      btn.disabled = true;
      say('Open this page from the 5pm app: choose Continue with Passkey on its sign-in screen.', true);
    }

    btn.addEventListener('click', async function () {
      btn.disabled = true;
      say('');
      // In memory only: this tab never keeps or refreshes the session, so the
      // app's copy is the only live one.
      var sb = window.supabase.createClient(window.__SB_URL, window.__SB_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false,
                experimental: { passkey: true } }
      });
      try {
        var res = await sb.auth.signInWithPasskey();
        if (res.error) throw res.error;
        var s = res.data.session;
        say('Signed in. Returning to 5pm…');
        // The port is fixed, never read from the URL, so the session can't be
        // sent anywhere but this computer's 5pm app.
        location.replace('http://localhost:47893/?' + new URLSearchParams({
          state: state, access_token: s.access_token, refresh_token: s.refresh_token
        }));
      } catch (e) {
        btn.disabled = false;
        var t = (e.name || '') + ' ' + (e.message || '') + ' ' + (e.code || '');
        if (/NotAllowed|cancel|abort/i.test(t)) return; // closed the prompt
        say(e.code === 'webauthn_credential_not_found'
          ? "That passkey isn't linked to a 5pm account."
          : 'Passkey sign-in failed: ' + (e.message || 'Please try again.'), true);
      }
    });
  
