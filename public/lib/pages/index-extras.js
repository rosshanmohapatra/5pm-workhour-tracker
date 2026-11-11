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
    if (window.Sheet) window.Sheet.attach(sheet, {
      close: dismissIosInstall,
      isOpen: function () { return sheet.classList.contains('open'); }
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
