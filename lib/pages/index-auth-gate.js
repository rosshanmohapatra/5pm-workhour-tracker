    // Initialise the Supabase client right away (SDK is already available above).
    // We store it on window so the rest of the page script can reuse it.
    window._sbClient = window.supabase.createClient(
      window.__SB_URL,
      window.__SB_ANON_KEY,
      { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true,
                experimental: { passkey: true } } }
    );
    // Replace the localStorage gate with Supabase's real session check.
    // onAuthStateChange fires immediately on load with the INITIAL_SESSION event.
    // Guard against the OAuth PKCE race: if ?code= is present in the URL, Supabase
    // is still exchanging it — don't redirect yet; wait for the SIGNED_IN event.
    // Tell credential managers: do NOT proactively offer to fill credentials on this page.
    // Suppresses the "Sign in to vercel.app" bottom sheet on iOS for already-authenticated users.
    if (navigator.credentials && navigator.credentials.preventSilentAccess) {
      navigator.credentials.preventSilentAccess();
    }

    // Guard against stale localStorage from a DIFFERENT Supabase account on this
    // device — every wh_* key (day logs, session, config) is cached with no
    // per-user scoping, so switching accounts on the same browser without this
    // check inherits the previous account's active session, day logs, etc.
    //
    // wh_localwipe_v1 forces exactly one unconditional wipe per browser the
    // first time this code runs, regardless of which account is signed in.
    // Without it, a browser that was ALREADY contaminated before this fix
    // shipped has no historical owner stamp to compare against, so the
    // mismatch check below would never fire — it would silently adopt the
    // wrong account's data as if it were the current user's own. After this
    // one-time reset, the ongoing owner-mismatch check keeps things clean.
    function _guardAccountLocalData(session) {
      try {
        var uid = session && session.user && session.user.id;
        if (!uid) return;
        var ownerKey = 'wh_owner_uid';
        var migrationKey = 'wh_localwipe_v1';
        var cachedOwner = localStorage.getItem(ownerKey);
        var mismatch = cachedOwner && cachedOwner !== uid;
        var firstRun = localStorage.getItem(migrationKey) !== '1';
        if (mismatch || firstRun) {
          Object.keys(localStorage)
            .filter(function(k) { return k.indexOf('wh_') === 0 && k !== 'wh_theme' && k !== 'wh_ios_install_seen' && k !== migrationKey; })
            .forEach(function(k) { localStorage.removeItem(k); });
        }
        localStorage.setItem(migrationKey, '1');
        localStorage.setItem(ownerKey, uid);
      } catch (e) {}
    }

    // ── Start-up safety net ──
    // The splash used to wait forever when sign-in never reported back. Now:
    // a login saved on this device opens the app from its own data when the
    // network is down (offline, or a network that blocks Supabase), and after
    // 8 s the splash says what went wrong and offers Try Again.
    var _bootDone = false;
    var _SB_KEY = 'sb-' + new URL(window.__SB_URL).hostname.split('.')[0] + '-auth-token';
    function _storedSession() {
      try { var s = JSON.parse(localStorage.getItem(_SB_KEY) || 'null'); return s && s.user && s.user.id ? s : null; }
      catch (e) { return null; }
    }
    function _jwtClaims(t) {
      try { return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch (e) { return {}; }
    }
    // Opens the app from this device's copy when the saved login belongs to
    // the account whose data is cached here. Two-factor still applies: an
    // account with an authenticator opens only if this login already passed
    // it (aal2), came from a passkey, or this tab cleared it.
    function _offlineOpen() {
      if (_bootDone) return true;
      var s = _storedSession();
      if (!s || localStorage.getItem('wh_owner_uid') !== s.user.id) return false;
      var c = _jwtClaims(s.access_token || '');
      var hasTotp = (s.user.factors || []).some(function (f) { return f.status === 'verified'; });
      var viaPasskey = (c.amr || []).some(function (m) { return /passkey|webauthn/i.test(m && m.method); });
      var mfaOk = false; try { mfaOk = sessionStorage.getItem('wh_mfa_ok') === '1'; } catch (e) {}
      if (hasTotp && c.aal !== 'aal2' && !viaPasskey && !mfaOk) return false;
      _revealApp(s);
      return true;
    }
    function _bootGiveUp() {
      if (_bootDone || _offlineOpen()) return;
      var h = document.getElementById('appLoaderHint');
      if (!h) return;
      h.style.animation = 'none'; h.style.opacity = '1';
      h.innerHTML = "5pm couldn't finish opening. Check your connection, then <button type=\"button\">Try Again</button>";
      h.querySelector('button').onclick = function () { window.location.replace(location.pathname); };
    }
    setTimeout(function () { if (!_bootDone) _offlineOpen(); }, navigator.onLine === false ? 300 : 4000);
    setTimeout(_bootGiveUp, 8000);

    // Reveal the app + dismiss the loader. Split out so the MFA step-up gate
    // can run an async check first and only reveal once the account is cleared.
    function _revealApp(session) {
      _bootDone = true;
      _guardAccountLocalData(session);
      document.documentElement.style.visibility = '';   // reveal page
      if (location.search.includes('code=')) {
        history.replaceState(null, '', location.pathname); // clean up URL bar
        // Returned from OAuth linking flow — refresh sign-in methods once functions are ready
        setTimeout(function() { if (typeof hydrateSignInMethods === 'function') hydrateSignInMethods(); }, 500);
      }
      // Dismiss loader after at least 1 s from page load (smooth, no flash)
      var _elapsed = Date.now() - (window._loaderStart || Date.now());
      var _wait = Math.max(0, 1000 - _elapsed);
      setTimeout(function() {
        var _l = document.getElementById('appLoader');
        if (_l) { _l.classList.add('app-loader-out'); setTimeout(function(){ _l.remove(); }, 320); }
      }, _wait);
    }

    window._sbClient.auth.onAuthStateChange(function(event, session) {
      if (session) {
        // ── Two-factor step-up gate ──
        // If the account has a verified authenticator (nextLevel aal2) but this
        // session is still aal1 and hasn't satisfied MFA this tab, force the
        // login challenge. Skip during the OAuth code exchange. Fail-safe: any
        // error in the check reveals the app rather than locking the user out.
        var _mfaOk = false;
        try { _mfaOk = sessionStorage.getItem('wh_mfa_ok') === '1'; } catch (e) {}
        if (!_mfaOk && !location.search.includes('code=')) {
          window._sbClient.auth.mfa.getAuthenticatorAssuranceLevel().then(function(res) {
            var d = res && res.data;
            // A passkey already proves the device and the person, so a passkey
            // sign-in skips the authenticator code, in every tab.
            var viaPasskey = d && (d.currentAuthenticationMethods || []).some(function(m) {
              return /passkey|webauthn/i.test(m && m.method);
            });
            if (d && d.nextLevel === 'aal2' && d.currentLevel === 'aal1' && !viaPasskey) {
              _bootDone = true;
              window.location.replace('/login.html');
            } else {
              _revealApp(session);
            }
          }).catch(function() { _revealApp(session); });
          return;
        }
        _revealApp(session);
      } else if (event === 'INITIAL_SESSION' && location.search.includes('code=')) {
        // Back from Google or GitHub. If the code didn't turn into a session
        // (used, expired, or opened in another browser), nothing else will come:
        // the splash used to wait forever, and Force Reload brought the same
        // dead code back. getSession() waits for the exchange to finish.
        window._sbClient.auth.getSession().then(function (r) {
          if (_bootDone || (r && r.data && r.data.session)) return;
          _bootDone = true;
          window.location.replace('/login.html?error=oauth_failed');
        });
      } else if (event === 'INITIAL_SESSION' && _storedSession()) {
        // No session, yet the saved login is still on the device. Supabase only
        // deletes it when the server rejects it, so this is the network failing
        // to refresh an expired login, not a sign-out. It used to take the
        // sign-out path below, wiping this device's data (unsynced changes
        // included) and sending you to a sign-in page that couldn't load.
        _offlineOpen();
      } else if (event === 'INITIAL_SESSION') {
        // No valid session. This is also the only signal a device gets when it
        // was signed out from elsewhere: "Log out others" kills the refresh
        // token server-side, so this page can never read the devices map to
        // find its own revoke flag, and _kickThisDevice() never runs. Clear the
        // cached account data here instead, or a full copy of the user's hours
        // sits in localStorage in plain text on a device they already cut off.
        // NOTE: 'wh_device_id' must stay in step with DEV_ID_KEY in the main
        // script. It identifies the browser rather than the account, so like
        // wh_theme it survives sign-out.
        try {
          Object.keys(localStorage)
            .filter(function(k) { return k.indexOf('wh_') === 0 && k !== 'wh_theme' && k !== 'wh_device_id' && k !== 'wh_ios_install_seen'; })
            .forEach(function(k) { localStorage.removeItem(k); });
        } catch (e) {}
        _bootDone = true;
        window.location.replace('/login.html');
      } else if (event === 'SIGNED_OUT') {
        try { sessionStorage.removeItem('wh_mfa_ok'); } catch (e) {}
      }
      // SIGNED_OUT is handled by confirmLogout() / confirmDeleteProfile() below
    });
  
