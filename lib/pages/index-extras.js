  // ── iOS Install Prompt ──────────────────────────────────────────
  (function () {
    // Only on iOS Safari (not Chrome/Firefox on iOS, not already standalone)
    var ua = window.navigator.userAgent;
    var isIOS = /iphone|ipad|ipod/i.test(ua);
    var isSafari = /safari/i.test(ua) && !/chrome|crios|fxios/i.test(ua);
    var isStandalone = ('standalone' in window.navigator) && window.navigator.standalone;
    var seen = localStorage.getItem('wh_ios_install_seen');

    if (isIOS && isSafari && !isStandalone && !seen) {
      // Delay slightly so page content renders first
      setTimeout(openIosInstall, 1200);
    }
  })();

  function openIosInstall() {
    var overlay = document.getElementById('iosInstallOverlay');
    var sheet   = document.getElementById('iosInstallSheet');
    overlay.style.display = 'block';
    sheet.style.display   = 'block';
    // Next frame, so the slide-up transition runs from the closed position
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        overlay.classList.add('open');
        sheet.classList.add('open');
      });
    });
  }

  function dismissIosInstall() {
    var overlay = document.getElementById('iosInstallOverlay');
    var sheet   = document.getElementById('iosInstallSheet');
    overlay.classList.remove('open');
    sheet.classList.remove('open');
    setTimeout(function () {
      if (sheet.classList.contains('open')) return; // reopened meanwhile
      overlay.style.display = 'none';
      sheet.style.display   = 'none';
    }, 500);
    localStorage.setItem('wh_ios_install_seen', '1');
  }

  function closeIosInstall(e) {
    if (e.target === document.getElementById('iosInstallOverlay')) {
      dismissIosInstall();
    }
  }

  // Drag down to close (shared iOS-style sheet drag), and the Share button.
  (function () {
    var sheet   = document.getElementById('iosInstallSheet');
    var overlay = document.getElementById('iosInstallOverlay');
    if (window.Sheet) window.Sheet.attach(sheet, {
      close: dismissIosInstall,
      isOpen: function () { return sheet.classList.contains('open'); },
      scrim: function (p) { overlay.style.opacity = p == null ? '' : String(p); }
    });
    // Opens the iPhone Share menu, where Add to Home Screen lives. Safari has
    // no way for a page to open Add to Home Screen itself.
    var share = document.getElementById('iosShareBtn');
    if (!navigator.share) { share.style.display = 'none'; return; }
    share.addEventListener('click', function () {
      navigator.share({ title: '5pm', url: location.origin + '/' }).catch(function () {});
    });
  })();

  /* ── Pull-to-refresh (Android + iOS PWA) ── */
  (function () {
    if (!('ontouchstart' in window)) return;

    // DAMP=0.5 → user drags 2px, content moves 1px (rubber-band resistance)
    var DAMP           = 0.5;
    var MAX_TRAVEL     = 80;   // max damped px content moves down
    var THRESHOLD      = 110;  // raw px of drag that arms the reload
    var HOLD_TRAVEL    = 52;   // damped px content rests at while "Refreshing…"
    var FADE_START     = 20;   // damped px at which pill starts fading in
    var FADE_END       = 42;   // damped px at which pill is fully visible
    // At THRESHOLD (110px raw) → 55px damped travel — comfortably past FADE_END

    var wrap       = document.getElementById('ptrWrap');
    var pill       = document.getElementById('ptrPill');
    var arrowIcon  = document.getElementById('ptrArrowIcon');
    var reloadIcon = document.getElementById('ptrReloadIcon');
    var label      = document.getElementById('ptrLabel');
    if (!wrap || !pill || !arrowIcon || !reloadIcon || !label) return;

    var startY     = 0;
    var pulling    = false;
    var triggered  = false;
    var atTop      = false;
    var activeView = null; // .view.active, cached at touchstart

    // Rate limiter: max 5 PTR reloads per 5-minute fixed window (persisted across reloads).
    // Uses a fixed-window counter (not sliding) so the count can't drain away between pulls.
    // NOTE: UX-only guard — clearable via DevTools. Not a quota-enforcement mechanism.
    var RATE_LIMIT  = 5;
    var RATE_WINDOW = 5 * 60 * 1000; // 5-minute fixed window
    var RATE_KEY    = 'wh_ptr_reload_times';
    function _reloadAllowed() {
      var now = Date.now();
      var data = { count: 0, windowStart: now };
      try {
        var stored = JSON.parse(localStorage.getItem(RATE_KEY) || 'null');
        if (stored && typeof stored.count === 'number') data = stored;
      } catch {}
      // Reset counter if the current window has expired
      if (now - data.windowStart > RATE_WINDOW) {
        data = { count: 0, windowStart: now };
      }
      // Already at or over the limit — stay blocked until the window expires
      if (data.count >= RATE_LIMIT) return false;
      // Allow and record this reload
      data.count++;
      try { localStorage.setItem(RATE_KEY, JSON.stringify(data)); } catch {}
      return true;
    }

    function getScrollTop() {
      return (document.scrollingElement || document.documentElement || document.body).scrollTop
        || window.pageYOffset || 0;
    }

    function setReady(state) {
      if (state === triggered) return;
      triggered = state;
      if (state) {
        arrowIcon.style.display  = 'none';
        reloadIcon.style.display = '';
        pill.classList.add('ptr-ready');
        label.textContent = 'Release to Refresh';
      } else {
        arrowIcon.style.display  = '';
        reloadIcon.style.display = 'none';
        pill.classList.remove('ptr-ready');
        label.textContent = 'Pull to Refresh';
      }
    }

    function applyDrag(dy) {
      var travel = Math.min(dy * DAMP, MAX_TRAVEL);
      // Push the active view DOWN — this creates the gap where the pill lives
      if (activeView) activeView.style.transform = 'translateY(' + travel.toFixed(1) + 'px)';
      // Pill fades in as content moves away, revealing it from behind
      var alpha = Math.max(0, Math.min((travel - FADE_START) / (FADE_END - FADE_START), 1));
      wrap.style.opacity = alpha.toFixed(3);
      setReady(dy >= THRESHOLD);
    }

    function clearView(animated) {
      var v = activeView;
      if (!v) return;
      if (animated) v.style.transition = 'transform .22s ease';
      v.style.transform = 'translateY(0)';
      setTimeout(function () { v.style.transition = ''; v.style.transform = ''; }, 260);
    }

    function snapBack() {
      clearView(true);
      wrap.classList.add('ptr-snapping');
      wrap.style.opacity = '0';
      var done = false;
      function cleanup() {
        if (done) return; done = true;
        wrap.classList.remove('ptr-snapping');
        wrap.removeEventListener('transitionend', cleanup);
        setReady(false);
      }
      wrap.addEventListener('transitionend', cleanup);
      setTimeout(cleanup, 400); // iOS Safari transitionend fallback
    }

    // Pull-to-refresh is a phone gesture, and its indicator is already gated to
    // @media (max-width: 640px). The handlers were not, so on any desktop that
    // reports touch — a touchscreen, or a touchpad whose driver sends touch
    // events — a downward swipe near the top called preventDefault on the scroll
    // and then reloaded the page. Scrolling looked broken and the position kept
    // snapping to the top.
    function ptrEnabled() {
      return window.matchMedia('(max-width: 640px)').matches;
    }

    document.addEventListener('touchstart', function (e) {
      if (!ptrEnabled()) { atTop = false; startY = 0; return; }
      // Off while any modal, overlay or bottom sheet is open, and for any touch
      // that starts inside one: dragging a sheet down must never reload the page.
      if (document.querySelector('.overlay.open, .wp-picker-overlay.open, .email-modal-overlay.open, .td-panel.open, .notif-panel.open')
          || document.documentElement.classList.contains('td-sheet-open')
          || e.target.closest('[role="dialog"], [aria-modal="true"], .td-panel, .td-scrim, #iosInstallSheet, #iosInstallOverlay, .ob-overlay')) {
        atTop = false; startY = 0; return;
      }
      atTop      = getScrollTop() <= 5; // 5px tolerance for iOS rubber-band
      startY     = atTop ? e.touches[0].pageY : 0;
      pulling    = false;
      triggered  = false;
      activeView = atTop ? document.querySelector('.view.active') : null;
    }, { passive: true });

    document.addEventListener('touchmove', function (e) {
      if (!atTop || !startY) return;
      if (getScrollTop() > 10) {
        if (pulling) { snapBack(); pulling = false; }
        atTop = false; return;
      }
      var dy = e.touches[0].pageY - startY;
      if (dy <= 0) {
        if (pulling) { snapBack(); pulling = false; }
        return;
      }
      e.preventDefault(); // suppress native overscroll / browser PTR
      pulling = true;
      applyDrag(dy);
    }, { passive: false });

    function onRelease() {
      if (!pulling) { startY = 0; atTop = false; return; }
      pulling = false;
      var wasTriggered = triggered;
      startY = 0; atTop = false;

      if (wasTriggered) {
        // Snap content to a tidy holding position, keep pill visible while reloading
        if (activeView) {
          activeView.style.transition = 'transform .15s ease';
          activeView.style.transform  = 'translateY(' + HOLD_TRAVEL + 'px)';
        }
        wrap.style.opacity = '1';
        arrowIcon.style.display  = 'none';
        reloadIcon.style.display = '';
        reloadIcon.classList.add('ptr-spinning');
        pill.classList.add('ptr-ready');
        label.textContent = 'Refreshing…';
        setTimeout(function () {
          if (_reloadAllowed()) {
            location.reload();
          } else {
            snapBack();
            if (typeof showToast === 'function') {
              showToast('Too many refreshes', 'info', 'You\'ve hit the refresh limit. Take a break.');
            }
          }
        }, 600);
      } else {
        snapBack();
      }
    }

    document.addEventListener('touchend',    onRelease, { passive: true });
    document.addEventListener('touchcancel', function () {
      if (pulling) { pulling = false; snapBack(); }
      startY = 0; atTop = false;
    }, { passive: true });
  })();

  // ── Desktop Update card ────────────────────────────
  // Only runs inside the Tauri desktop app. In the browser and the PWA there is
  // no window.__TAURI__, so the card stays display:none and nothing below binds.
  (function initDesktopUpdater() {
    const T = window.__TAURI__;
    if (!T) return;

    const byId     = id => document.getElementById(id);
    const card     = byId('updateCard');
    const titleEl  = byId('updateTitle');
    const statusEl = byId('updateStatus');
    const btn      = byId('updateBtn');
    const btnLabel = byId('updateBtnLabel');
    const spinner  = byId('updateSpinner');
    const track    = byId('updateProgressTrack');
    const fill     = byId('updateProgressFill');
    const notes = byId('updateNotes');
    if (!card) return;

    const RELEASES = 'https://github.com/rosshanmohapatra/5pm-workhour-tracker/releases/tag/v';
    let currentVersion = null;

    const LAST_UPDATED_KEY = '5pm.desktop.lastUpdated';
    const LAST_CHECKED_KEY = '5pm.desktop.lastChecked';

    // One click: Update downloads, then installs on its own as soon as the
    // download lands. Cancel stays available while downloading.
    let state   = 'idle';   // idle | checking | available | downloading | ready
    let pending = null;     // { version } of the update the backend is holding

    // Local to the desktop card: the shared timeAgo() tops out at days, and the
    // update card wants weeks/months for installs that are a while back.
    function ago(iso) {
      if (!iso) return null;
      const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
      if (s < 60) return 'just now';
      const unit = (n, word) => n + ' ' + word + (n === 1 ? '' : 's') + ' ago';
      if (s < 3600)    return unit(Math.floor(s / 60), 'minute');
      if (s < 86400)   return unit(Math.floor(s / 3600), 'hour');
      if (s < 604800)  return unit(Math.floor(s / 86400), 'day');
      if (s < 2592000) return unit(Math.floor(s / 604800), 'week');
      return unit(Math.floor(s / 2592000), 'month');
    }

    function idleStatus() {
      const updated = ago(localStorage.getItem(LAST_UPDATED_KEY));
      if (updated) return 'Last Updated ' + updated;
      const checked = ago(localStorage.getItem(LAST_CHECKED_KEY));
      return checked ? 'Last checked ' + checked : 'Not checked yet';
    }

    // The link always points at the version the card is talking about: the
    // installed one when nothing is pending, the offered one otherwise.
    function renderNotes() {
      const version = (state === 'idle' || state === 'checking')
        ? currentVersion
        : (pending && pending.version);
      if (!version) { notes.style.display = 'none'; return; }
      notes.style.display = '';
      notes.textContent = 'v' + version + ' release notes';
      notes.dataset.url = RELEASES + version;
    }

    function render() {
      const busy = state === 'checking';
      spinner.style.display = busy ? '' : 'none';
      btn.classList.toggle('busy', busy);
      btn.disabled = busy;
      track.style.display = state === 'downloading' ? '' : 'none';

      if (state === 'idle' || state === 'checking') {
        titleEl.textContent  = 'No Updates Available';
        statusEl.textContent = state === 'checking' ? 'Checking for updates…' : idleStatus();
        btnLabel.textContent = state === 'checking' ? 'Checking…' : 'Check for Update';
      } else if (state === 'available') {
        titleEl.textContent  = 'Update Is Available';
        statusEl.textContent = 'Version ' + pending.version + ' available';
        btnLabel.textContent = 'Update';
      } else if (state === 'downloading') {
        titleEl.textContent  = 'Updating';
        btnLabel.textContent = 'Cancel';
      } else if (state === 'ready') {
        titleEl.textContent  = 'Updating';
        statusEl.textContent = 'Installing, 5pm will reopen';
        btnLabel.textContent = 'Installing…';
        btn.disabled = true;
      }

      renderNotes();
    }

    function fail(message) {
      state = 'idle';
      render();
      statusEl.textContent = message;
    }

    // Windows, or the network it sits on, stopped the update. Not a 5pm bug,
    // so each case gets a calm explanation and a way forward instead of the
    // raw OS error. First match wins; no match keeps the raw message.
    const KEEPS = '5pm keeps working as it is, and the latest version is always on the web.';
    const WIN_ISSUES = [
      // UAC "No": the person chose this, so no modal.
      { re: /os error 1223\b|cancell?ed by the user/i, status: 'Update cancelled' },
      // App Control and Smart App Control (455x/458x), AppLocker or software
      // restriction (1260), antivirus (225/226).
      { re: /os error (45[5-8]\d|1260|225|226)\b|application control|smart app control|group policy|blocked by|virus|potentially unwanted/i,
        status: "Blocked by this PC's security settings", title: 'Windows Blocked This Update', icon: 'shield',
        desc: "This PC's security settings didn't let the new version install. " + KEEPS },
      { re: /signature|minisign/i,
        status: "Update couldn't be verified", title: "This Update Couldn't Be Verified", icon: 'shield',
        desc: "5pm only installs updates it can verify, and this one didn't check out. Networks that inspect downloads can cause this. " + KEEPS },
      { re: /os error (112|39)\b|not enough space|disk is full/i,
        status: 'Not enough disk space', title: 'Not Enough Disk Space',
        desc: 'Free up some space on this PC, then try the update again. ' + KEEPS },
      { re: /os error (5|32|33)\b|access is denied|used by another process/i,
        status: "Couldn't replace 5pm's files", title: "Windows Couldn't Replace 5pm",
        desc: "Another program, often antivirus, is holding 5pm's files. Restart the PC, then try the update again. " + KEEPS },
      { re: /os error (10051|10054|10060|10061|11001)\b|error sending request|dns|connect|timed out|certificate|tls|ssl|proxy|status code:? ?40[37]/i,
        status: "Can't reach the update server", title: "Can't Reach the Update Server",
        desc: "This network, often a work VPN or firewall, is blocking 5pm's updates. " + KEEPS },
    ];
    const winIssue = e => WIN_ISSUES.find(i => i.re.test(String(e)));
    const ICONS = {
      shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
      alert:  '<circle cx="12" cy="12" r="9"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
    };

    function showBlocked(issue) {
      let ov = document.getElementById('updBlockedOverlay');
      if (!ov) {
        const css = document.createElement('style');
        css.textContent = `
          .upd-blocked { max-width: 380px; min-width: 0; padding: 30px 24px 22px; text-align: center; }
          .upd-blocked-x { position: absolute; top: 10px; right: 10px; }
          .upd-blocked-icon { width: 54px; height: 54px; margin: 0 auto 14px; border-radius: 50%;
            display: grid; place-items: center; color: #f59e0b; background: rgba(245,158,11,.14);
            animation: upd-pop .5s cubic-bezier(.34,1.56,.64,1) .08s both; }
          @keyframes upd-pop { from { transform: scale(.55); opacity: 0; } }
          .upd-blocked-desc { font-size: 13px; line-height: 1.55; color: var(--muted-fg); margin: 6px 0 20px; }
          .upd-blocked-cta { gap: 8px; height: 42px; }
          @media (prefers-reduced-motion: reduce) { .upd-blocked-icon { animation: none; } }`;
        document.head.appendChild(css);
        ov = document.createElement('div');
        ov.className = 'overlay';
        ov.id = 'updBlockedOverlay';
        ov.innerHTML = `
          <div class="dialog upd-blocked" role="alertdialog" aria-modal="true" aria-labelledby="updBlockedTitle" aria-describedby="updBlockedDesc">
            <button class="btn-icon upd-blocked-x" title="Close" aria-label="Close">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
            <div class="upd-blocked-icon">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></svg>
            </div>
            <div class="dialog-title" id="updBlockedTitle"></div>
            <div class="upd-blocked-desc" id="updBlockedDesc"></div>
            <button class="btn btn-primary upd-blocked-cta">Open on Web
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
            </button>
          </div>`;
        document.body.appendChild(ov);
        const close = () => ov.classList.remove('open');
        ov.addEventListener('click', e => { if (e.target === ov) close(); });
        ov.querySelector('.upd-blocked-x').addEventListener('click', close);
        ov.querySelector('.upd-blocked-cta').addEventListener('click', () => {
          T.core.invoke('open_external', { url: 'https://whtracker.vercel.app/index.html' }).catch(() => {});
          close();
        });
        document.addEventListener('keydown', e => { if (e.key === 'Escape' && ov.classList.contains('open')) close(); });
      }
      ov.querySelector('.upd-blocked-icon svg').innerHTML = ICONS[issue.icon || 'alert'];
      ov.querySelector('#updBlockedTitle').textContent = issue.title;
      ov.querySelector('#updBlockedDesc').textContent = issue.desc;
      const icon = ov.querySelector('.upd-blocked-icon');
      icon.style.animation = 'none'; void icon.offsetWidth; icon.style.animation = ''; // pop again on a repeat
      void ov.offsetWidth; // let it open with the usual fade and spring
      ov.classList.add('open');
    }

    // A known Windows or network cause: the card says why in plain words and
    // the modal explains what to do. `next` is where the card lands, so a
    // found update stays offered (IT may allow it later). Quiet skips the
    // modal, for the launch check that nobody asked for.
    function explain(e, next, quiet) {
      const issue = winIssue(e);
      if (!issue) return false;
      state = next;
      render();
      statusEl.textContent = issue.status;
      if (issue.title && !quiet) showBlocked(issue);
      return true;
    }

    async function check(quiet) {
      state = 'checking';
      render();
      try {
        const found = await T.core.invoke('updater_check');
        localStorage.setItem(LAST_CHECKED_KEY, new Date().toISOString());
        if (found) { pending = found; state = 'available'; } else { state = 'idle'; }
        render();
      } catch (e) {
        if (!explain(e, 'idle', quiet)) fail('Update check failed. ' + e);
      }
    }

    async function download() {
      state = 'downloading';
      fill.style.width = '0%';
      statusEl.textContent = 'Downloading 0%';
      render();
      try {
        await T.core.invoke('updater_download');
      } catch (e) {
        if (!explain(e, 'available')) fail('Download failed. ' + e);
      }
    }

    async function cancel() {
      try { await T.core.invoke('updater_cancel'); } catch (e) { /* already gone */ }
      state = 'available';
      fill.style.width = '0%';
      render();
    }

    async function install() {
      btn.disabled = true;
      btnLabel.textContent = 'Installing…';
      // Record before handing off: install() restarts the app, so nothing runs after it.
      localStorage.setItem(LAST_UPDATED_KEY, new Date().toISOString());
      try {
        await T.core.invoke('updater_install');
      } catch (e) {
        localStorage.removeItem(LAST_UPDATED_KEY);
        btn.disabled = false;
        if (!explain(e, 'available')) fail('Install failed. ' + e);
      }
    }

    btn.addEventListener('click', () => {
      if (state === 'idle')             check();
      else if (state === 'available')   download();
      else if (state === 'downloading') cancel();
    });

    T.event.listen('updater://progress', ev => {
      if (state !== 'downloading') return;
      const { downloaded, total } = ev.payload;
      if (!total) { statusEl.textContent = 'Downloading…'; return; }
      const pct = Math.min(100, Math.round((downloaded / total) * 100));
      fill.style.width = pct + '%';
      statusEl.textContent = 'Downloading ' + pct + '%';
    });

    T.event.listen('updater://ready', () => {
      if (state !== 'downloading') return; // cancelled just as it finished
      state = 'ready';
      fill.style.width = '100%';
      render();
      install();
    });

    // The download runs in the background, so its failures (network, a
    // signature that doesn't check out) arrive here rather than in download().
    T.event.listen('updater://error', ev => {
      if (state !== 'downloading') return; // cancelled
      fill.style.width = '0%';
      if (!explain(ev.payload, 'available')) fail('Download failed. ' + ev.payload);
    });

    function openNotes() {
      if (notes.dataset.url) T.core.invoke('open_external', { url: notes.dataset.url });
    }
    notes.addEventListener('click', openNotes);
    notes.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openNotes(); }
    });

    T.app.getVersion().then(v => { currentVersion = v; renderNotes(); }).catch(() => {});

    // Check once at launch and once a day after that. The card updates itself;
    // the toast fires only the first time a given version shows up, so a
    // machine left running for a week is not nagged daily about the same one.
    const NOTIFIED_KEY = '5pm.desktop.updateNotified';
    async function autoCheck() {
      if (state !== 'idle') return;
      await check(true);
      if (state !== 'available') return;
      if (localStorage.getItem(NOTIFIED_KEY) === pending.version) return;
      localStorage.setItem(NOTIFIED_KEY, pending.version);
      new Notification('Update available', {
        body: 'Version ' + pending.version + ' is out. Update it from Settings.'
      });
    }
    setInterval(autoCheck, 24 * 60 * 60 * 1000);
    autoCheck();

    card.style.display = '';
    render();
  })();

  // ── Start the day on a boot launch ──────────────────
  // Only runs when Windows started 5pm at sign-in. A silent tray launch must
  // never invent hours, so every guard below has to pass, and a session that
  // does start always announces itself.
  // What a sign-in launch does: 'session' starts the day on working days,
  // 'app' only opens 5pm in the tray. Per PC, like autostart itself.
  const BOOT_MODE_KEY = 'wh_boot_mode';
  function bootMode() {
    try { return localStorage.getItem(BOOT_MODE_KEY) === 'app' ? 'app' : 'session'; } catch { return 'session'; }
  }

  (function initBootSession() {
    const T = window.__TAURI__;
    if (!T) return;

    function greeting(d) {
      const h = d.getHours();
      if (h < 12) return 'Good morning';
      if (h < 17) return 'Good afternoon';
      return 'Good evening';
    }

    // Reasons to do nothing at all, whatever kind of day it is.
    function blockedReason(now) {
      if (typeof loginDate !== 'undefined' && loginDate) return 'a session is already running';

      // Any finished or partial work today means the person has already been
      // here; starting again would double count.
      const log = todayPlanLog();
      if (log && (log.checkoutTime || log.hoursWorked > 0)) return 'today already has tracked time';

      // The app's own rule: logging in an hour or more before the shift.
      if (typeof isOutsideShift === 'function' && isOutsideShift(now)) return 'it is before the shift starts';

      // Booting late at night should not open a session that runs overnight.
      const end = (typeof cfg === 'function' && typeof parse === 'function')
        ? parse(cfg().shiftEnd || '') : null;
      if (end && (now.getHours() * 60 + now.getMinutes()) > (end.getHours() * 60 + end.getMinutes())) {
        return 'the shift has already ended for today';
      }
      return null;
    }

    function todayPlanLog() {
      return (typeof dayLog === 'function' && typeof todayKey === 'function')
        ? dayLog(todayKey()) : null;
    }

    // A day the person is expected to work: their week plan says so, including
    // the Saturday setting, and today is not booked as leave or a holiday.
    // Half days and working from home still count as working.
    function isExpectedToday() {
      if (typeof isWeekend === 'function' && isWeekend()) return false;
      const log = todayPlanLog();
      const plan = log && (log.override || log.futurePlan);
      return plan !== 'leave' && plan !== 'holiday';
    }

    // Asked rather than assumed. The native toast is the nudge; the offer to
    // start waits until the window is actually looked at, since a Windows toast
    // cannot carry the action itself.
    function offerToStart() {
      new Notification("We didn't expect you today", {
        body: 'Open 5pm if you are working.'
      });

      let offered = false;
      const ask = () => {
        if (offered || document.hidden) return;
        offered = true;
        document.removeEventListener('visibilitychange', ask);
        window.removeEventListener('focus', ask);
        if (blockedReason(new Date())) return; // they may have started it by hand
        showToast("We didn't expect you today", 'info', 'Start a session anyway?', {
          label: 'Start',
          onClick: () => _startSession(new Date())
        });
      };
      document.addEventListener('visibilitychange', ask);
      window.addEventListener('focus', ask);
      ask();
    }

    T.core.invoke('launched_at_boot').then(atBoot => {
      if (!atBoot) return;
      // "Start App" in Settings: open in the tray and do nothing else.
      if (bootMode() === 'app') { console.info('[boot] Start App mode, no session'); return; }
      // Let restore, recovery prompts and the cloud pull settle first, so the
      // guards run against the real state of today rather than an empty one.
      setTimeout(() => {
        const now = new Date();
        const blocked = blockedReason(now);
        if (blocked) { console.info('[boot] session not started:', blocked); return; }

        if (!isExpectedToday()) { offerToStart(); return; }

        _startSession(now);
        new Notification(greeting(now) + '!', { body: 'Session Started at ' + short(now) });
      }, 4000);
    }).catch(err => console.warn('[boot] could not tell how 5pm was launched:', err));
  })();

  // ── Tray tooltip ────────────────────────────────────
  // A Windows tooltip is plain text, so this is one short line: what is left of
  // the day, or how far past it you are. Refreshed each minute, which is the
  // finest granularity the text shows anyway.
  (function initTrayTooltip() {
    const T = window.__TAURI__;
    if (!T) return;

    function line() {
      if (typeof loginDate === 'undefined' || !loginDate) return 'Not Started';
      // Offline means changes are waiting to sync; the timer itself keeps running.
      const off = navigator.onLine ? '' : ' (offline)';
      const worked = _sessionAccSecs + Math.max(0, Math.floor((Date.now() - loginDate) / 1000));
      const target = effSecs();
      if (!target) return durWorked(worked) + ' worked' + off;
      const left = target - worked;
      return (left > 0
        ? durWorked(left) + ' left'
        : 'Overtime ' + durWorked(-left)) + off;
    }

    let last = null;
    function push() {
      const text = line();
      if (text === last) return; // nothing changed, leave the tray alone
      last = text;
      T.core.invoke('set_tray_tooltip', { text }).catch(() => {});
    }

    // 15s so a start or stop shows quickly; push() skips unchanged text.
    setInterval(push, 15000);
    addEventListener('online', push);
    addEventListener('offline', push);
    push();
  })();

  // ── Desktop settings ────────────────────────────────
  // Autostart is Windows state, not app config, so it is read from and written
  // to the OS rather than saved with the rest of Settings.
  (function initDesktopSettings() {
    const T = window.__TAURI__;
    if (!T) return;

    const section = document.getElementById('desktopSection');
    const input   = document.getElementById('inpAutostart');
    if (!section || !input) return;

    section.style.display = '';
    const modeRow = document.getElementById('bootModeRow');
    const modeTabs = [...document.querySelectorAll('#bootModeTabs .st-tab')];
    const extras = document.getElementById('bootExtras');
    const paintMode = () => {
      if (extras) {
        extras.style.maxHeight = input.checked ? '400px' : '0';
        extras.style.opacity   = input.checked ? '1' : '0';
      }
      modeTabs.forEach(b => b.classList.toggle('active', b.dataset.boot === bootMode()));
    };
    modeTabs.forEach(b => b.addEventListener('click', () => {
      try { localStorage.setItem(BOOT_MODE_KEY, b.dataset.boot); } catch {}
      paintMode();
    }));

    T.core.invoke('autostart_enabled')
      .then(on => { input.checked = !!on; paintMode(); })
      .catch(err => console.warn('[desktop] could not read autostart:', err));

    input.addEventListener('change', () => {
      const wanted = input.checked;
      paintMode();
      T.core.invoke('autostart_set', { enabled: wanted }).catch(err => {
        // Snap back to what Windows actually holds rather than lying to the user.
        input.checked = !wanted;
        paintMode();
        console.warn('[desktop] autostart change failed:', err);
        showToast("Windows Didn't Allow This", 'error',
          "This PC's settings stopped 5pm from changing whether it opens at sign-in.");
      });
    });
  })();
