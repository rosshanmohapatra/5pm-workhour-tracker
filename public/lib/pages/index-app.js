    const APP_VERSION = '1.2.29';
    localStorage.setItem('wh_ver', APP_VERSION);

    // ── HELPERS ─────────────────────────────────────────
    const el = id => document.getElementById(id);

    // ── SECURITY HELPERS ───────────────────────────────────
    // Escape user-supplied text before inserting into innerHTML contexts.
    function _escHtml(s) {
      if (!s && s !== 0) return '';
      return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    // ── STORAGE KEYS ───────────────────────────────────
    const KEY = {
      cfg:       'wh_cfg',
      day:       'wh_day_',
      dismissed: 'wh_dismissed',
      session:   'wh_session',
      meta:      'wh_meta',
    };

    // ── STATE ──────────────────────────────────────────
    let loginDate = null, ticker = null;
    let dark = false, wasDone = false, notifSent = false;
    let _devDateOverride = null; // dev mode: 'YYYY-MM-DD' string or null
    let _previewStartAt = null;  // Product Tour day-off preview: "leave by" counts from the shift start, not now
    let wkMinimized = false, notifOpen = false;
    let activeView = 'home';
    let selectedDayKey = null;      // null = today; or a date key for past days
    let analyticsWeekOffset = 0;   // 0 = current week, -1 = last week, …
    let daySelectorWeekOffset = 0; // 0 = current week, -1 = last week, …
    let autoStopped = false;        // true after auto-stop fires
    let _dayEditKey = null;         // key being edited in day-edit modal
    let _isWkndNoteModal = false;   // true when day-edit modal is open in weekend-note variant
    let _sessionAccSecs = 0;        // accumulated seconds from previous sessions today (for resume)
    let _sessionCheckoutTime = null;// timestamp of last End Session (for resume label)

    // ── RELATIVE TIME ──────────────────────────────────
    function timeAgo(date) {
      if (!date) return '';
      const s = Math.floor((Date.now() - date.getTime()) / 1000);
      if (s < 60)   return 'just now';
      if (s < 3600) { const m = Math.floor(s / 60);    return `${m}m ago`; }
      if (s < 86400){ const h = Math.floor(s / 3600);  return `${h}h ago`; }
      const d = Math.floor(s / 86400); return `${d} day${d > 1 ? 's' : ''} ago`;
    }

    // ── CONFIG ─────────────────────────────────────────
    const CFG_DEF = { dailyH:9, weeklyH:45, weeklyOn:true, lateDays:[], earlyLeaveEntries:[], lateEntries:[], notifOn:false, notifTarget:true, notifKickstart:true, notifOvertime:true, name:'', position:'', targetDay:null, autoStopBuf:2, tzOffset:330, shiftType:'morning', workDays:5, recommendTimings:true, breakTime:true, use24h:false, tzName:'', dismissed:[], qsShortcut:{ mod:'ctrl', key:'s' } };
    function cfg() { const r=Store.getCfg(); return r?{...CFG_DEF,...r}:{...CFG_DEF}; }

    // ── PUSH USER ID ───────────────────────────────────
    // Returns the authenticated Supabase user ID for keying push subscriptions.
    // Must be called after onAuthStateChange has fired (i.e. inside an async flow).
    async function getPushUserId() {
      const { data: { session } } = await window._sbClient.auth.getSession();
      return session?.user?.id ?? null;
    }
    // saveCfg defined in persistence layer

    function nowTz() {
      if (_devDateOverride) {
        const real = new Date();
        const [y, m, d] = _devDateOverride.split('-').map(Number);
        return new Date(y, m - 1, d, real.getHours(), real.getMinutes(), real.getSeconds(), real.getMilliseconds());
      }
      return new Date();
    }

    // ── DISMISSED NOTIFICATIONS ────────────────────────
    // Dismissed IDs live inside cfg() and sync across devices via user_kv.
    function getDismissed() {
      return cfg().dismissed ?? [];
    }

    // Migrate legacy wh_dismissed key (pre-sync era) into cfg() once, then delete it.
    // Called once from init(); safe to call multiple times (no-op after first run).
    function _migrateLegacyDismissed() {
      const legacy = Store.get(KEY.dismissed, null);
      if (!Array.isArray(legacy) || legacy.length === 0) return;
      const current = cfg().dismissed ?? [];
      const merged  = pruneDismissed([...new Set([...current, ...legacy])]);
      saveCfg({ ...cfg(), dismissed: merged });
      localStorage.removeItem(KEY.dismissed); // wh_dismissed no longer needed
    }
    // Drop IDs whose date suffix is older than 14 days — keeps cfg blob small
    function pruneDismissed(ids) {
      const cutoff = Date.now() - 14 * 86400000;
      return ids.filter(id => {
        const m = id.match(/(\d{4}-\d{2}-\d{2})$/);
        return !m || new Date(m[1]).getTime() >= cutoff;
      });
    }
    // Swiping away a sample notification is kept in memory, never in the synced settings.
    let _devSamplePenalties = false; // Developer Mode › Sample Penalties (memory only)
    const _sampleNotifDismissed = new Set();
    function addDismissed(id) {
      if (id.startsWith('sample-notif-')) { _sampleNotifDismissed.add(id); return; }
      const d = getDismissed();
      if (d.includes(id)) return;
      saveCfg({ ...cfg(), dismissed: pruneDismissed([...d, id]) });
    }

    // ── DAY LOG ────────────────────────────────────────
    const dateKey  = d => `${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}`;
    const todayKey = () => dateKey(nowTz());
    function dayLog(k) { return Store.getDay(k); }
    // saveDayLog defined in persistence layer

    // ── WEEK DAYS ──────────────────────────────────────
    const ALL_DAY_NAMES = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    function workDayNames() {
      return cfg().workDays === 6 ? ALL_DAY_NAMES : ALL_DAY_NAMES.slice(0, 5);
    }
    // Keep FULL_DAY_NAMES as a backward-compat alias (static 5-day — use workDayNames() for dynamic)
    const FULL_DAY_NAMES = ALL_DAY_NAMES.slice(0, 5);
    function week(offset) {
      offset = offset || 0;
      const t = new Date();
      t.setDate(t.getDate() + offset * 7);
      const dow = t.getDay();
      const mon = new Date(t);
      mon.setDate(t.getDate() + (dow === 0 ? -6 : 1 - dow));
      mon.setHours(0,0,0,0);
      return workDayNames().map((n, i) => {
        const d = new Date(mon); d.setDate(mon.getDate() + i);
        return { key: dateKey(d), name: n, date: d };
      });
    }
    function weekRangeLabel(offset) {
      const wk = week(offset);
      const mon = wk[0].date, last = wk[wk.length - 1].date;
      return mon.getMonth() === last.getMonth()
        ? `${MONTHS[mon.getMonth()]} ${mon.getDate()} – ${last.getDate()}`
        : `${MONTHS[mon.getMonth()]} ${mon.getDate()} – ${MONTHS[last.getMonth()]} ${last.getDate()}`;
    }
    // True if a given date key falls on a non-working day (weekend).
    function isWeekendKey(key) {
      const dow = new Date(key + 'T12:00').getDay(); // 0=Sun … 6=Sat
      if (dow === 0) return true;                       // Sunday is always off
      if (dow === 6 && (cfg().workDays || 5) < 6) return true; // Saturday off unless 6-day week
      return false;
    }
    // Full Monday–Sunday strip (7 days) with an isWeekend flag on each day.
    // Used only by the day selector strip — week() stays work-days-only so all
    // the weekly target / report math is unaffected.
    const ALL7_DAY_NAMES = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
    function weekStrip(offset) {
      offset = offset || 0;
      const t = new Date();
      t.setDate(t.getDate() + offset * 7);
      const dow = t.getDay();
      const mon = new Date(t);
      mon.setDate(t.getDate() + (dow === 0 ? -6 : 1 - dow));
      mon.setHours(0,0,0,0);
      const workCount = cfg().workDays === 6 ? 6 : 5; // index >= workCount is a weekend day
      return ALL7_DAY_NAMES.map((n, i) => {
        const d = new Date(mon); d.setDate(mon.getDate() + i);
        return { key: dateKey(d), name: n, date: d, isWeekend: i >= workCount };
      });
    }

    // ── EFFECTIVE TARGET (carry-over) ──────────────────
    // ── OVERRIDE-AWARE WEEKLY TARGET ───────────────────
    // Returns the effective weekly target in seconds after deducting
    // Holiday, On Leave (full day) and Half Day (half day) overrides.
    function adjustedWeeklyTarget(wk) {
      const c = cfg();
      let deduct = 0;
      for (const d of wk) {
        const l = dayLog(d.key);
        if (!l?.override) continue;
        if (l.override === 'holiday' || l.override === 'leave') {
          deduct += c.dailyH * 3600;          // full day removed
        } else if (l.override === 'halfday') {
          deduct += (c.dailyH * 3600) / 2;   // half day removed
        }
      }
      return Math.max(0, c.weeklyH * 3600 - deduct);
    }

    function effSecs() {
      // Per-day override — set from the Target chip on the Today card (or Half Day)
      const _tk = todayKey(), _log = dayLog(_tk) || {};
      if (_log.todayTargetH != null) return _log.todayTargetH * 3600;
      return _weeklyEffSecs();
    }

    // Today's target from the week alone, ignoring a per-day override. The gap to
    // the daily hours is banked overtime (Available Surplus), which a Half Day
    // must not change.
    function _weeklyEffSecs() {
      const c = cfg(), daily = c.dailyH * 3600;
      if (!c.weeklyOn || c.recommendTimings === false) return daily;
      const wk = week(), tk = todayKey();
      const target = adjustedWeeklyTarget(wk);
      let before = 0, rem = 0, pastToday = false;
      for (const d of wk) {
        const l = dayLog(d.key);
        if (d.key === tk) { pastToday = true; }
        if (!pastToday) {
          // Override days contributed their actual hoursWorked (0 or half) to 'before'
          if (l?.hoursWorked != null) before += l.hoursWorked * 3600;
        } else if (d.key !== tk) {
          // Future days: only count as remaining if not a full override (holiday/leave)
          const ov = l?.override;
          if (ov !== 'holiday' && ov !== 'leave') rem++;
        }
      }
      rem++; // include today itself
      if (!rem) return daily;
      const left = target - before;
      if (left <= 0) return 0;
      return Math.max(0, left / rem);
    }

    // ── FORMAT UTILS ───────────────────────────────────
    const p2 = n => String(n).padStart(2, '0');
    function clock(d) {
      let h = d.getHours(), m = d.getMinutes(), s = d.getSeconds();
      if (cfg().use24h) return `${p2(h)}:${p2(m)}:${p2(s)}`;
      const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
      return `${p2(h)}:${p2(m)}:${p2(s)} ${ap}`;
    }
    function short(d) {
      let h = d.getHours(), m = d.getMinutes();
      if (cfg().use24h) return `${p2(h)}:${p2(m)}`;
      const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
      return `${p2(h)}:${p2(m)} ${ap}`;
    }
    function dur(secs) {
      const s = Math.abs(secs), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
      return `${h}h ${p2(m)}m`;
    }
    // Like dur() but omits the hours component when h === 0 (e.g. "23m" instead of "0h 23m")
    function durWorked(secs) {
      const s = Math.max(0, secs), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
      return h === 0 ? `${m}m` : `${h}h ${p2(m)}m`;
    }
    // Fills the auto-stop info bar: "Stopped at 8:15 PM" over a line that
    // names the buffer, e.g. "You reached your target plus the 2h buffer."
    function _showAutostopBar(timeText) {
      const bufH = cfg().autoStopBuf ?? 2;
      const buf = durWorked(bufH * 3600).replace(' 00m', '');
      el('autostopTitle').textContent = timeText ? `Stopped at ${timeText}` : 'Stopped automatically';
      el('autostopMsg').textContent = `You reached your target plus the ${buf} buffer.`;
      el('autostopBanner').classList.add('show');
    }
    // Compact surplus/deficit: "+12m" instead of "+0h 12m". Uses Math.round for sub-hour values.
    function durShort(secs) {
      const sign = secs < 0 ? '-' : '+';
      const abs  = Math.abs(secs);
      if (abs < 60) return `${sign}0m`;
      if (abs < 3600) { return `${sign}${Math.round(abs / 60)}m`; }
      const h = Math.floor(abs / 3600), m = Math.round((abs % 3600) / 60);
      return m > 0 ? `${sign}${h}h ${m}m` : `${sign}${h}h`;
    }
    // Returns "Overtime" in daily mode, "Surplus" in weekly/recommend-timings mode
    function _surplusLabel() { return cfg().weeklyOn ? 'Surplus' : 'Overtime'; }
    function durLong(secs) {
      const s = Math.abs(secs), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
      if (h === 0) return `${m} min`;
      if (m === 0) return `${h} hr`;
      return `${h} hr ${m} min`;
    }
    // Returns HTML with grey unit suffixes (h / m) for the stats card
    function durHtml(secs) {
      const s = Math.abs(secs), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
      const sf = (u) => `<span class="co-val-suf">${u}</span>`;
      if (h === 0) return `${m}${sf('m')}`;
      if (m === 0) return `${h}${sf('h')}`;
      return `${h}${sf('h')} ${m}${sf('m')}`;
    }
    // Daily Report variant: "12Hrs 29Mins" with grey long-form suffixes
    function durHtmlLong(secs) {
      const s = Math.abs(secs), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
      const sf = (u) => `<span class="co-val-suf">${u}</span>`;
      if (h === 0) return `${m}${sf('Mins')}`;
      if (m === 0) return `${h}${sf('Hrs')}`;
      return `${h}${sf('Hrs')} ${m}${sf('Mins')}`;
    }
    // Returns HTML with grey AM/PM for a "H:MM AM" string.
    // In 24h mode, reformat any stored 12h string and drop the AM/PM entirely.
    function timeHtml(t) {
      if (cfg().use24h) { const p = parse(t); return p ? short(p) : t.replace(/\s*(AM|PM)\s*$/i, ''); }
      const i = t.lastIndexOf(' ');
      if (i < 0) return t;
      return `${t.slice(0, i)}<span class="co-val-suf"> ${t.slice(i + 1)}</span>`;
    }

    // ── TIME PARSER ────────────────────────────────────
    function parse(raw) {
      const s = raw.trim().toUpperCase().replace(/\s+/g, ' ');
      let m;
      m = s.match(/^(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)?$/); if (m) return bld(m[1],m[2],m[3],m[4]);
      m = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/);         if (m) return bld(m[1],m[2],'0',m[3]);
      m = s.match(/^(\d{2})(\d{2})\s*(AM|PM)?$/);            if (m) return bld(m[1],m[2],'0',m[3]);
      m = s.match(/^(\d)(\d{2})\s*(AM|PM)?$/);               if (m) return bld(m[1],m[2],'0',m[3]);
      m = s.match(/^(\d{1,2})\s*(AM|PM)?$/);                 if (m) return bld(m[1],'0','0',m[2]);
      return null;
    }
    function bld(H, M, S, ap) {
      let h = +H, m = +M, s = +(S || 0);
      if (isNaN(h) || isNaN(m) || isNaN(s)) return null;
      if (ap) { if (ap === 'PM' && h !== 12) h += 12; if (ap === 'AM' && h === 12) h = 0; }
      if (h > 23 || m > 59 || s > 59) return null;
      const d = new Date(); d.setHours(h, m, s, 0); return d;
    }
    function shiftDefaultAP() {
      const p = parse(cfg().shiftStart || '09:00 AM');
      return (p && p.getHours() >= 12) ? 'PM' : 'AM';
    }
    function parseLogin(raw) {
      const s = raw.trim().toUpperCase().replace(/\s+/g, ' ');
      if (s.includes('AM') || s.includes('PM')) return parse(raw);
      const dNoAP = parse(raw);
      if (!dNoAP) return null;
      const h = dNoAP.getHours(), m = dNoAP.getMinutes();
      if (h === 0 || h > 12) return dNoAP; // midnight or unambiguous 24h
      // Build AM and PM candidates and pick the one in the past closest to now
      const now = new Date();
      const dAM = new Date(); dAM.setHours(h === 12 ? 0 : h, m, 0, 0);
      const dPM = new Date(); dPM.setHours(h === 12 ? 12 : h + 12, m, 0, 0);
      const amPast = dAM <= now, pmPast = dPM <= now;
      if (amPast && pmPast) return dAM > dPM ? dAM : dPM; // both past → more recent
      if (amPast) return dAM;
      if (pmPast) return dPM;
      return shiftDefaultAP() === 'PM' ? dPM : dAM; // both future → fall back to shift
    }

    // ── NOTIFY (in-tab fallback) ────────────────────────
    function notify(s) {
      if (!cfg().notifOn) return;
      // Web Push handles the real notification via service worker.
      // This fallback fires only if the tab is open and SW isn't active.
      if ('Notification' in window && Notification.permission === 'granted' && !notifSent) {
        const _isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
        const _title = _isIOS ? '' : 'Time to go!';
        const _body  = _isIOS ? `Time to go! — ${dur(s)} logged. Tap to check out.` : `${dur(s)} logged. Tap to check out.`;
        const n = new Notification(_title, { body: _body });
        n.onclick = () => { window.focus(); if (loginDate) checkout(); };
        notifSent = true;
      }
    }

    // ── NOTIFICATION ENGINE (browser-native, no external scheduler) ───
    // Scheduling uses client-side setTimeout + SW showNotification().
    // Works globally — no QStash/region dependency.
    // Notifications fire as long as the browser is open (which it must
    // be anyway for tracking). SW keeps them native even when tab is hidden.

    let _swReg        = null;
    let _notifTimers  = [];   // active setTimeout IDs

    const _NOTIF_MSGS = {
      kickstart: {
        title: 'Almost done',
        body:  'Start wrapping up.',
        tag:   'kickstart',
      },
      target: {
        title: 'Done for today',
        body:  'You can leave now.',
        tag:   'target',
      },
      overtime: {
        title: 'Still working',
        body:  'Your hours are complete.',
        tag:   'overtime',
        requireInteraction: true,
      },
      forgotStop: {
        title: 'Still there?',
        body:  'Time to head out.',
        tag:   'forgotStop',
        requireInteraction: true,
      },
      earlyLeave: {
        title: 'Done early',
        body:  'You can leave anytime.',
        tag:   'earlyLeave',
      },
      morningReminder: {
        title: 'Good morning',
        body:  "Start when you're ready.",
        tag:   'morningReminder',
      },
    };

    async function initServiceWorker() {
      if (!('serviceWorker' in navigator)) return;
      try {
        _swReg = await navigator.serviceWorker.register('/sw.js');
      } catch (e) { console.warn('[5pm] SW register failed:', e); }
    }

    async function requestPushPermission() {
      if (!('Notification' in window)) return false;
      if (Notification.permission === 'denied') return false;
      const perm = await Notification.requestPermission();
      return perm === 'granted';
    }

    async function _fireNotif(type) {
      const msg = _NOTIF_MSGS[type]; if (!msg) return;
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      // On iOS, Safari appends "from [App]" as a subtitle under the title, creating
      // a 3-line notification. Fold the title into the body so iOS stays at 2 lines.
      const _isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      const displayTitle = _isIOS ? '' : msg.title;
      const displayBody  = _isIOS ? `${msg.title} — ${msg.body}` : msg.body;
      const opts = {
        body:               displayBody,
        tag:                msg.tag,
        icon:               '/apple-touch-icon.png',
        requireInteraction: !!msg.requireInteraction,
      };
      // Path 1 — Notification constructor.
      // Instant and reliable on Chrome/Firefox/Safari desktop (both browser tab
      // and PWA). Chrome Android doesn't support it at all (throws TypeError),
      // which lets us fall through to the SW path below.
      try {
        const n = new Notification(displayTitle, opts);
        n.onclick = () => window.focus();
        return;
      } catch (err1) {
        // Expected on Chrome Android — fall through to SW path.
        // On desktop this should never fire; log it so we can debug if it does.
        if (!(err1 instanceof TypeError)) {
          console.warn('[notif] Notification constructor failed unexpectedly:', err1);
        }
      }
      // Path 2 — SW showNotification.
      // Required on Chrome Android (new Notification() unavailable there).
      // Also acts as fallback on any desktop browser that rejects the constructor.
      // serviceWorker.ready waits for the SW to fully activate on first visit.
      if ('serviceWorker' in navigator) {
        try {
          const reg = await Promise.race([
            navigator.serviceWorker.ready,
            new Promise((_, rej) => setTimeout(() => rej(new Error('sw timeout')), 4000)),
          ]);
          await reg.showNotification(displayTitle, opts);
        } catch (err2) {
          // Both paths failed — nothing we can do silently, but log it so issues
          // are visible in DevTools rather than disappearing without a trace.
          console.warn('[notif] SW showNotification failed:', err2);
        }
      }
    }

    function scheduleNotifications(loginTimestamp) {
      const c = cfg();
      cancelScheduledNotifications(); // clear any previous timers
      if (!c.notifOn || Notification.permission !== 'granted') return;

      const targetSecs = effSecs();
      // Time already worked today (before a pause) counts toward the target, so
      // the reminders count from where the day effectively began.
      const baseMs     = new Date(loginTimestamp).getTime() - _sessionAccSecs * 1000;
      const now        = Date.now();

      const jobs = [
        { type: 'kickstart',      offsetSecs: targetSecs - 300,  enabled: c.notifKickstart !== false },
        { type: 'target',         offsetSecs: targetSecs,         enabled: c.notifTarget    !== false },
        { type: 'overtime',       offsetSecs: targetSecs + 300,   enabled: c.notifOvertime  !== false },
        // 90 min past target — nudge to log out if still tracking
        { type: 'forgotStop',     offsetSecs: targetSecs + 5400,  enabled: true },
      ];

      for (const job of jobs) {
        if (!job.enabled) continue;
        const delay = baseMs + job.offsetSecs * 1000 - now;
        if (delay < 0) continue; // already passed
        _notifTimers.push(setTimeout(() => _fireNotif(job.type), delay));
      }
    }

    function cancelScheduledNotifications() {
      _notifTimers.forEach(id => clearTimeout(id));
      _notifTimers = [];
    }

    // ── SLEEP / WAKE ──────────────────────────────────────────────────────────
    // Worked time is always recomputed from timestamps, so sleeping cannot make
    // it drift. Scheduled alerts are the exception: a setTimeout sleeps with the
    // machine and then fires late. Detect the jump and rebuild the schedule from
    // the login time, which drops any alert whose moment has already passed.
    (function watchForWake() {
      const TICK = 30000;
      const DRIFT_LIMIT = 120000; // treat a two minute gap as a sleep, not lag
      let expected = Date.now() + TICK;

      setInterval(() => {
        const now = Date.now();
        const drift = now - expected;
        expected = now + TICK;
        if (drift < DRIFT_LIMIT) return;
        if (!loginDate) return;

        cancelScheduledNotifications();
        scheduleNotifications(loginDate.toISOString());
        render();
      }, TICK);
    })();

    // ── MORNING REMINDER ───────────────────────────────────────────────────────
    // Fires once per day at 9am if the user hasn't logged in yet that day.
    // Skips weekends and respects notification permission.
    function testNotif(type) {
      if (Notification.permission !== 'granted') {
        document.getElementById('notifTestPermWarn').style.display = '';
        return;
      }
      document.getElementById('notifTestPermWarn').style.display = 'none';
      _fireNotif(type);
    }

    function scheduleMorningReminder() {
      if (!cfg().notifOn || Notification.permission !== 'granted') return;
      const c        = cfg();
      const todayStr = todayKey();
      const sentKey  = 'wh_morning_sent_' + todayStr;
      if (localStorage.getItem(sentKey)) return;   // already sent today
      if (dayLog(todayStr)?.loginTime) return;      // already logged in today
      const now = new Date();
      const dow = now.getDay();
      if (dow === 0 || dow === 6) return;           // skip weekends
      // Fire 30 min after shift start (fallback: 9:00 AM → fires at 9:30 AM)
      const shiftStr = c.shiftStart || '09:00 AM';
      const sm = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(shiftStr);
      const shiftDate = new Date(now);
      if (sm) {
        let h = parseInt(sm[1], 10);
        const m = parseInt(sm[2], 10);
        if (sm[3].toUpperCase() === 'PM' && h !== 12) h += 12;
        if (sm[3].toUpperCase() === 'AM' && h === 12) h = 0;
        shiftDate.setHours(h, m, 0, 0);
      } else {
        shiftDate.setHours(9, 0, 0, 0);
      }
      const triggerAt = new Date(shiftDate.getTime() + 30 * 60 * 1000);
      const delay = triggerAt.getTime() - now.getTime();
      if (delay <= 0) return;                       // window already passed
      const id = setTimeout(() => {
        // Re-check at fire time — user may have logged in since scheduling
        if (!dayLog(todayKey())?.loginTime && Notification.permission === 'granted') {
          _fireNotif('morningReminder');
          localStorage.setItem(sentKey, '1');
        }
      }, delay);
      _notifTimers.push(id);
    }

    // Toggle visibility of the inline remaining time display (next to elapsed label)
    function showRem(show) {
      const d = show ? '' : 'none';
      ['rcRemSep','rcRemaining','rcRemText'].forEach(id => { const e = el(id); if (e) e.style.display = d; });
    }

    async function onNotifToggleChange() {
      autoSaveSettings();
      const sub = el('notifSubGroup');
      const isOn = el('inpNotifOn').checked;
      if (sub) {
        if (isOn) {
          sub.style.pointerEvents = '';
          sub.style.maxHeight = sub.scrollHeight + 200 + 'px';
          sub.style.opacity   = '1';
          sub.style.marginTop = '16px';
        } else {
          sub.style.pointerEvents = 'none';
          sub.style.maxHeight = '0';
          sub.style.opacity   = '0';
          sub.style.marginTop = '0';
        }
      }
      if (isOn) {
        const granted = await requestPushPermission();
        if (granted && loginDate) scheduleNotifications(loginDate.toISOString());
      } else {
        cancelScheduledNotifications();
      }
    }

    // ── CHECKOUT ───────────────────────────────────────
    function tomorrowInsight() {
      const c = cfg();
      if (!c.weeklyOn) return null;
      const wk = week(), tk = todayKey();
      const todayIdx = wk.findIndex(d => d.key === tk);
      if (todayIdx < 0 || todayIdx >= wk.length - 1) return null;
      const daysLeft = wk.length - todayIdx - 1;
      let totalWorked = 0;
      for (const d of wk) {
        const l = dayLog(d.key);
        if (l?.hoursWorked != null) totalWorked += l.hoursWorked * 3600;
      }
      const weeklyTarget = adjustedWeeklyTarget(wk);
      const remaining = weeklyTarget - totalWorked;
      if (remaining <= 0) {
        return `You've already hit your weekly target! Feel free to leave early ${daysLeft === 1 ? 'tomorrow' : 'this week'}.`;
      }
      const perDay = remaining / daysLeft;
      const savings = c.dailyH * 3600 - perDay;
      if (savings >= 1800) {
        const label = daysLeft === 1 ? 'tomorrow' : 'each remaining day';
        return `Only ${dur(perDay)} needed ${label} — ${dur(savings)} less than usual. You're ahead of schedule.`;
      }
      return null;
    }

    function showCheckoutModal(punchInStr, checkoutTime, workedSecs) {
      const checkInStr  = typeof punchInStr === 'string' ? punchInStr : short(punchInStr);
      const checkOutStr = short(checkoutTime);
      el('coWorked').innerHTML    = durHtmlLong(workedSecs);
      el('coTimeRange').innerHTML = `${timeHtml(checkInStr)} – ${timeHtml(checkOutStr)}`;
      // Should've left note
      const eff = effSecs();
      const firstLoginLog = dayLog(todayKey());
      const coShouldLeave    = el('coShouldLeave');
      const coShouldLeaveWrap = el('coShouldLeaveWrap');
      if (firstLoginLog?.loginDisplay && eff > 0) {
        const firstLogin  = parse(firstLoginLog.loginDisplay) || checkoutTime;
        const shouldLeave = new Date(firstLogin.getTime() + eff * 1000);
        const diff    = workedSecs - eff;
        const absDiff = Math.abs(diff);
        if (diff >= 0) {
          coShouldLeave.textContent = `Could've left ${dur(absDiff)} earlier — at ${short(shouldLeave)}.`;
        } else {
          coShouldLeave.textContent = `Left ${dur(absDiff)} short — target was ${short(shouldLeave)}.`;
        }
        coShouldLeaveWrap.style.display = 'block';
      } else {
        coShouldLeaveWrap.style.display = 'none';
      }
      const insight = tomorrowInsight();
      el('coInsight').style.display = insight ? 'block' : 'none';
      if (insight) el('coInsightText').textContent = insight;
      el('checkoutOverlay').classList.add('open');
    }

    function closeCheckoutModal() {
      el('checkoutOverlay').classList.remove('open');
      clearLogin();
    }

    // ── END SHIFT: finalises the day, shows insights modal ──────────────────
    function checkout() {
      if (!loginDate) return;
      cancelScheduledNotifications(); // cancel pending push notifications
      if (ticker) { clearInterval(ticker); ticker = null; }
      const now = new Date();
      const tk = todayKey(), ex = dayLog(tk) || {};
      const sessionSecs = Math.floor((now - loginDate) / 1000);
      const totalSecs   = _sessionAccSecs + sessionSecs;  // all sessions today
      // Fire "early leave" notification if target met before 4pm
      const targetSecs = effSecs();
      if (totalSecs >= targetSecs && now.getHours() < 16
          && cfg().notifOn && Notification.permission === 'granted') {
        _fireNotif('earlyLeave');
      }
      // Priority push — bypass dirty queue so other devices see the session end immediately.
      // Fire-and-forget: if it fails, _markDirty ensures a retry via the normal queue.
      { const _pk = tk; const _pe_snap = { ...ex,
          checkoutTime:    `${p2(now.getHours())}:${p2(now.getMinutes())}:${p2(now.getSeconds())}`,
          checkoutDisplay: short(now),
          hoursWorked:     (_sessionAccSecs + sessionSecs) / 3600,
          lastUpdated:     now.toISOString(),
          sessionTag:      ex.sessionTag || 'realtime',
        };
        SbSync.pushDay(_pk, _pe_snap).then(ok => { if (!ok) _markDirty(_pk); });
      }
      const punchInDisplay = ex.loginDisplay || short(loginDate); // first login of the day
      saveDayLogAndSync(tk, { ...ex,
        loginTime:       `${loginDate.getHours()}:${loginDate.getMinutes()}:${loginDate.getSeconds()}`,
        loginDisplay:    ex.loginDisplay || short(loginDate),
        checkoutTime:    `${p2(now.getHours())}:${p2(now.getMinutes())}:${p2(now.getSeconds())}`,
        checkoutDisplay: short(now),
        hoursWorked:     totalSecs / 3600,
        lastUpdated:     now.toISOString(),
        sessionTag:      ex.sessionTag || 'realtime'
      });
      persist();
      // Daily Report only when Recommend Timings is ON — rec-off users see the
      // Daily Target Reached modal instead (which already has the key info).
      const firstLoginStr = ex.loginDisplay || short(loginDate);
      if (cfg().recommendTimings !== false) {
        showCheckoutModal(firstLoginStr, now, totalSecs);
      }
      // Friday nudge — remind to check weekly report (once per week)
      const _dow = new Date().getDay();
      const _isFriday = _dow === 5 || (cfg().workDays >= 6 && _dow === 6);
      if (_isFriday) {
        const _fKey = 'wh_report_nudge_' + currentWeekId();
        if (!localStorage.getItem(_fKey)) {
          localStorage.setItem(_fKey, '1');
          setTimeout(() => showToast('Check your weekly report', 'info', '', { label: 'Check', onClick: () => openWeekReport() }), 2500);
        }
      }
      // Reset state — clearLogin() is called inside closeCheckoutModal (rec-on),
      // or directly here (rec-off, no modal).
      if (cfg().recommendTimings === false) {
        _sessionAccSecs = 0; _sessionCheckoutTime = null;
        loginDate = null; autoStopped = false;
        setCalcBtnState('start');
        el('shiftInputRow').classList.remove('active-state', 'hidden');
        el('shiftActiveLabel').textContent = '—';
        renderDaySelector();
        renderEmptyState();
      } else {
        // clearLogin() called inside closeCheckoutModal
        _sessionAccSecs = 0; _sessionCheckoutTime = null;
        loginDate = null; autoStopped = false;
        setCalcBtnState('start');
        el('shiftInputRow').classList.remove('active-state', 'hidden');
      }
    }

    // ── END SESSION: pauses mid-day, keeps hours, shows Resume ───────────────
    function endSession() {
      if (!loginDate) return;
      if (ticker) { clearInterval(ticker); ticker = null; }
      _stopCheckpoint();
      const now = new Date();
      const tk = todayKey(), ex = dayLog(tk) || {};
      const sessionSecs = Math.floor((now - loginDate) / 1000);
      _sessionAccSecs   += sessionSecs;
      _sessionCheckoutTime = now;
      const _esEntry = { ...ex,
        loginTime:       ex.loginTime || `${loginDate.getHours()}:${loginDate.getMinutes()}:${loginDate.getSeconds()}`,
        loginDisplay:    ex.loginDisplay || short(loginDate),
        checkoutDisplay: short(now),
        hoursWorked:     _sessionAccSecs / 3600,
        lastUpdated:     now.toISOString(),
        sessionTag:      ex.sessionTag || 'realtime',
        sessionDate:     tk
      };
      saveDayLogAndSync(tk, _esEntry);
      // Priority push — bypass dirty queue so other devices see the end immediately.
      { const _pk = tk, _pe = _esEntry;
        SbSync.pushDay(_pk, _pe).then(ok => { if (!ok) _markDirty(_pk); });
      }
      Store.clearSession();
      loginDate = null; autoStopped = false;
      setCalcBtnState('start');
      el('shiftInputRow').classList.remove('active-state', 'hidden');
      el('shiftActiveLabel').textContent = '—';
      el('autostopBanner').classList.remove('show');
      renderDaySelector();
      renderEmptyState();
    }

    // ── HEADER CLOCK ───────────────────────────────────
    const FULL_DAYS_EN = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

    // ── Clock timezone ────────────────────────────────
    // Returns a Date whose LOCAL fields read as the wall-clock time in `tzName`.
    // Everything downstream uses getHours()/getMinutes(), so shifting the fields is
    // all that's needed — no instant is being changed, only how it's read.
    function _tzNow(tzName, base) {
      const now = base || new Date();
      if (!tzName) return now;
      try {
        const p = new Intl.DateTimeFormat('en-US', {
          timeZone: tzName, hour12: false,
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit'
        }).formatToParts(now).reduce((a, x) => (a[x.type] = x.value, a), {});
        // hour12:false yields "24" for midnight in some engines — normalise to 0.
        return new Date(+p.year, +p.month - 1, +p.day, (+p.hour) % 24, +p.minute, +p.second, now.getMilliseconds());
      } catch { return now; } // unknown/unsupported zone — fall back to device time
    }

    function _clockNow() { return _tzNow((cfg().tzName || '').trim(), nowTz()); }

    function tickHeader() {
      const n = nowTz();
      const timeStr = clock(n);
      el('dayName').textContent  = FULL_DAYS_EN[n.getDay()];
      el('dayDate').textContent  = `${MONTHS[n.getMonth()]} ${n.getDate()}`;
      el('dayClock').textContent = timeStr;
      const clkEl = el('selDayClock');
      if (clkEl) clkEl.textContent = clock(_clockNow());
      _setTodayDateChip();
    }

    // ── WEEK MINIMIZE (no-op — week card now always visible in analytics) ──
    function setMinimized(min) { wkMinimized = min; /* no-op: week card in analytics */ }

    // ── ICON CONSTANTS ─────────────────────────────────
    const ICON_RABBIT = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><path d="M13 16a3 3 0 0 1 2.24 5"/><path d="M18 12h.01"/><path d="M18 21h-8a4 4 0 0 1-4-4 7 7 0 0 1 7-7h.2L9.6 6.4a1 1 0 1 1 3.448-1.206 1 1 0 0 1-.948 1.206"/><path d="M6.67 15.3A.944.944 0 0 0 6 16a1 1 0 0 0 1 1"/></svg>`;
    const ICON_SNAIL = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><path d="M2 13a6 6 0 1 0 12 0 4 4 0 1 0-8 0 2 2 0 0 0 4 0"/><circle cx="10" cy="13" r="8"/><path d="M2 21h12c4.4 0 8-3.6 8-8V7l-4-4H6L2 7v10"/><path d="M6 12h4"/></svg>`;

    // ── NOTIFICATION SYSTEM ────────────────────────────
    function buildNotifs() {
      const c = cfg(), wk = week(), tk = todayKey();
      const dismissed = getDismissed();
      const notifs = [];
      const dow = new Date().getDay();
      const eff = effSecs();
      const diff = eff - c.dailyH * 3600;

      const penaltyDays = [];
      for (const day of wk) {
        if (day.key >= tk) continue; // skip today and all future days
        const log = dayLog(day.key);
        if (!log?.hoursWorked) continue;
        const ov = log.override;
        if (ov === 'holiday' || ov === 'leave') continue; // no penalty on off days
        const dayTarget = ov === 'halfday' ? (c.dailyH * 3600) / 2 : c.dailyH * 3600;
        const deficit = dayTarget - log.hoursWorked * 3600;
        if (deficit > 300) penaltyDays.push({ day, deficit });
      }
      if (penaltyDays.length > 0) {
        const id = `penalty-${wk[0].key}`;
        if (!dismissed.includes(id)) {
          let text;
          if (penaltyDays.length === 1) {
            const pd = penaltyDays[0];
            text = `1 Penalty Found on ${pd.day.name} ${pd.day.date.getDate()} ${MONTHS[pd.day.date.getMonth()]}`;
          } else if (penaltyDays.length === 2) {
            text = `2 Penalties Found — ${penaltyDays[0].day.name} ${penaltyDays[0].day.date.getDate()} & ${penaltyDays[1].day.name} ${penaltyDays[1].day.date.getDate()} ${MONTHS[penaltyDays[1].day.date.getMonth()]}`;
          } else {
            text = `${penaltyDays.length} Penalties Found This Week`;
          }
          notifs.push({ id, type: 'warn', text, cta: 'Check', ctaWeekKey: wk[0].key });
        }
      }

      // Developer Mode › Sample Penalties: one notification per sample penalty,
      // each opening its own Email Draft. Memory only, like the samples.
      for (const p of _samplePenalties()) {
        const id = `sample-notif-${p.key}`;
        if (_sampleNotifDismissed.has(id)) continue;
        const text = p.type === 'weekly'
          ? `Weekly Penalty Found: ${p.rangeStr} · Sample`
          : `1 Penalty Found on ${FULL_DAYS_EN[p.date.getDay()]} ${p.date.getDate()} ${MONTHS[p.date.getMonth()]} · Sample`;
        notifs.push({ id, type: 'warn', text, cta: 'Check', ctaWeekKey: 'pen:' + p.key });
      }

      if (c.weeklyOn && diff < -300) {
        const id = `surplus-${tk}`;
        if (!dismissed.includes(id)) {
          notifs.push({ id, type: 'ok', text: 'You can leave early today.', surplus: dur(Math.abs(diff)) });
        }
      }

      if (dow === 4 && c.weeklyOn) {
        const id = `thu-${tk}`;
        if (!dismissed.includes(id)) {
          if (diff <= 0) notifs.push({ id, type: 'ok', text: "You're on track — you can leave early tomorrow." });
          else if (diff > 300) notifs.push({ id, type: 'info', text: "Stick it out today! Finish strong so you can leave early tomorrow." });
        }
      }

      return notifs;
    }

    function renderNotifs() {
      const notifs = buildNotifs();
      const list = el('notifList');
      // P1 badge: animate in/out using spring slide instead of display toggle
      const hasBadge = notifs.length > 0;
      const _setBadge = (id) => {
        const b = el(id); if (!b) return;
        const wasShown = b.classList.contains('badge-show');
        if (hasBadge && !wasShown) {
          b.classList.remove('badge-hide');
          b.classList.add('badge-show');
        } else if (!hasBadge && wasShown) {
          b.classList.remove('badge-show');
          b.classList.add('badge-hide');
          b.addEventListener('animationend', () => b.classList.remove('badge-hide'), { once: true });
        }
      };
      _setBadge('notifBadge');
      _setBadge('mobNotifBadge');
      el('notifBtn').classList.toggle('has-notifs', hasBadge);
      el('mobNotifBtn')?.classList.toggle('has-notifs', hasBadge);

      if (!notifs.length) { list.innerHTML = `<div class="notif-empty">No notifications right now.</div>`; return; }

      const warnSvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M12 5.5C12.5523 5.5 13 5.94772 13 6.5L13 13.5C13 14.0523 12.5523 14.5 12 14.5C11.4477 14.5 11 14.0523 11 13.5L11 6.5C11 5.94772 11.4477 5.5 12 5.5Z" fill="currentColor"/><path d="M12 18.5C12.8284 18.5 13.5 17.8284 13.5 17C13.5 16.1716 12.8284 15.5 12 15.5C11.1716 15.5 10.5 16.1716 10.5 17C10.5 17.8284 11.1716 18.5 12 18.5Z" fill="currentColor"/><path fill-rule="evenodd" clip-rule="evenodd" d="M1 12C1 5.92487 5.92487 1 12 1C18.0751 1 23 5.92487 23 12C23 18.0751 18.0751 23 12 23C5.92487 23 1 18.0751 1 12ZM12 3C7.02944 3 3 7.02944 3 12C3 16.9706 7.02944 21 12 21C16.9706 21 21 16.9706 21 12C21 7.02944 16.9706 3 12 3Z" fill="currentColor"/></svg>`;
      const okSvg   = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path fill-rule="evenodd" clip-rule="evenodd" d="M21.2285 6.60358C21.619 6.9941 21.619 7.62726 21.2285 8.01779L10.2557 18.9906C9.86764 19.3786 9.23938 19.3815 8.84786 18.997L2.66233 12.9219C2.2683 12.5349 2.2626 11.9017 2.64959 11.5077L3.3503 10.7943C3.73729 10.4002 4.37043 10.3945 4.76445 10.7815L9.53589 15.4678L19.1072 5.89647C19.4977 5.50595 20.1309 5.50595 20.5214 5.89647L21.2285 6.60358Z" fill="currentColor"/></svg>`;
      const infoSvg = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M12 18.5C12.5523 18.5 13 18.0523 13 17.5L13 10.5C13 9.94772 12.5523 9.5 12 9.5C11.4477 9.5 11 9.94772 11 10.5L11 17.5C11 18.0523 11.4477 18.5 12 18.5Z" fill="currentColor"/><path d="M12 8.5C12.8284 8.5 13.5 7.82843 13.5 7C13.5 6.17157 12.8284 5.5 12 5.5C11.1716 5.5 10.5 6.17157 10.5 7C10.5 7.82843 11.1716 8.5 12 8.5Z" fill="currentColor"/><path fill-rule="evenodd" clip-rule="evenodd" d="M1 12C1 18.0751 5.92487 23 12 23C18.0751 23 23 18.0751 23 12C23 5.92487 18.0751 1 12 1C5.92487 1 1 5.92487 1 12ZM12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12C21 16.9706 16.9706 21 12 21Z" fill="currentColor"/></svg>`;

      list.innerHTML = notifs.map(n => {
        const icon = n.type === 'warn' ? warnSvg : n.type === 'ok' ? okSvg : infoSvg;
        // n.id and n.ctaWeekKey are internal keys (no user input), but escape defensively
        const safeId  = _escHtml(n.id || '');
        const safeCta = _escHtml(n.ctaWeekKey || '');
        // Surplus is information, not an action, so it stays inline. The CTA is
        // gone: the card itself carries the tap target now.
        const actions = n.surplus
          ? `<div class="notif-actions"><span class="notif-surplus">${_escHtml(n.surplus)} saved</span></div>`
          : '';
        const tap = n.cta
          ? ` data-on-click="h837093f811" data-click-a0="${safeId}" data-click-a1="${safeCta}" role="button" tabindex="0"`
          : '';
        return `<div class="notif-item${n.cta ? ' notif-tappable' : ''}" id="ni-${safeId}"${tap}>
          <div class="notif-icon ${n.type}">${icon}</div>
          <div class="notif-body"><div class="notif-text">${_escHtml(n.text)}</div>${actions}</div>
        </div>`;
      }).join('');
    }

    // Shared exit animation, used by the swipe and by Clear All so every
    // dismissal looks the same. dir is -1 or 1 so the card leaves the way the
    // finger sent it. Animates from wherever it currently sits, so a
    // half-finished drag continues rather than snapping back to 0 first.
    function _dismissNotifItem(item, id, dir) {
      if (!item || item.dataset.dismissing) return;
      item.dataset.dismissing = '1';
      item.classList.remove('swiping');   // re-enable the eased transition
      item.classList.add('dismissing');   // stop it swallowing further taps
      void item.offsetWidth;              // lock in the current position first
      item.style.transform = `translateX(${dir < 0 ? -110 : 110}%)`;
      item.style.opacity = '0';
      let fired = false;
      const finish = () => { if (fired) return; fired = true; addDismissed(id); renderNotifs(); };
      item.addEventListener('transitionend', finish, { once: true });
      setTimeout(finish, 420);            // fallback if transitionend never lands
    }

    function dismissNotif(id, dir) {
      const item = el('ni-' + id);
      if (item) { _dismissNotifItem(item, id, dir || 1); return; }
      addDismissed(id);
      renderNotifs();
    }

    // Swipe either direction to dismiss. Touch only, so it simply never engages
    // on a desktop pointer — there, Clear All is the way.
    let _notifSwipe = null;
    function _initNotifSwipe() {
      const list = el('notifList');
      if (!list || list.dataset.swipeInit) return;
      list.dataset.swipeInit = '1'; // delegated once — survives list re-renders

      list.addEventListener('touchstart', e => {
        const item = e.target.closest('.notif-item');
        if (!item || item.dataset.dismissing || e.touches.length !== 1) return;
        const t = e.touches[0];
        _notifSwipe = { item, x0: t.clientX, y0: t.clientY, dx: 0, axis: null };
      }, { passive: true });

      list.addEventListener('touchmove', e => {
        if (!_notifSwipe) return;
        const t = e.touches[0];
        const dx = t.clientX - _notifSwipe.x0, dy = t.clientY - _notifSwipe.y0;
        // Decide once whether this is a horizontal swipe or a vertical scroll,
        // then stick with it, otherwise the card jitters mid-scroll.
        if (!_notifSwipe.axis) {
          if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
          if (Math.abs(dy) >= Math.abs(dx)) { _notifSwipe = null; return; } // let the page scroll
          _notifSwipe.axis = 'x';
          _notifSwipe.item.classList.add('swiping');
        }
        _notifSwipe.dx = dx; // either direction, unlike the right-only penalty rows
        const w = _notifSwipe.item.offsetWidth || 320;
        _notifSwipe.item.style.transform = `translateX(${dx}px)`;
        _notifSwipe.item.style.opacity = String(Math.max(0.15, 1 - Math.abs(dx) / w));
        e.preventDefault(); // we own this gesture now
      }, { passive: false });

      const endSwipe = () => {
        if (!_notifSwipe) return;
        const { item, dx, axis } = _notifSwipe;
        _notifSwipe = null;
        if (axis !== 'x') return;
        const w = item.offsetWidth || 320;
        if (Math.abs(dx) > Math.min(120, w * 0.3)) {
          _dismissNotifItem(item, item.id.replace(/^ni-/, ''), dx < 0 ? -1 : 1);
        } else {
          item.classList.remove('swiping'); // spring back under the eased transition
          item.style.transform = '';
          item.style.opacity = '';
        }
      };
      list.addEventListener('touchend', endSwipe);
      list.addEventListener('touchcancel', endSwipe);
    }

    // Penalty notification tapped: open the email draft when the week has one
    // penalty, otherwise bring Your Penalties into view to pick one. The
    // notification stays until it's swiped away.
    function handleNotifCta(id, weekKey) {
      closeNotifPanel();
      switchTab('analytics'); // one-page layout: Home, with Penalties freshly rendered
      // A sample notification names its penalty directly.
      if (weekKey.startsWith('pen:')) { openEmailModal(weekKey.slice(4)); return; }
      const end = new Date(weekKey + 'T00:00'); end.setDate(end.getDate() + 6);
      const endKey = dateKey(end);
      const hits = _penaltyData.filter(p => !_discardedPenalties.has(p.key) &&
        (p.type === 'weekly' ? p.key === weekKey : p.key >= weekKey && p.key <= endKey));
      if (hits.length === 1) { openEmailModal(hits[0].key); return; }
      el('penaltiesList')?.closest('.analytics-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function toggleNotifPanel() {
      notifOpen = !notifOpen;
      el('notifPanel').className = 'notif-panel ' + (notifOpen ? 'open' : 'hidden');
      el('notifBtn').classList.toggle('notif-active', notifOpen);
      el('notifScrim')?.classList.toggle('open', notifOpen);
      if (notifOpen) { renderNotifs(); _initNotifSwipe(); }
    }

    // Outside click (the scrim) and Escape both dismiss the panel.
    function closeNotifPanel() {
      if (!notifOpen) return;
      notifOpen = false;
      el('notifPanel').className = 'notif-panel hidden';
      el('notifBtn').classList.remove('notif-active');
      el('notifScrim')?.classList.remove('open');
    }
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeNotifPanel(); });

    // ── TARGET HTML ────────────────────────────────────
    // Derive a human-readable login time from a stored day log (works even when
    // loginDate is null — e.g. after session ends and loginDate is cleared).
    function _loginDisplayFromLog(log) {
      if (!log) return '—';
      if (log.loginDisplay) return log.loginDisplay;          // already formatted
      if (!log.loginTime)   return '—';                       // no data
      const p = log.loginTime.split(':').map(Number);         // "H:M:S" → [H, M, S]
      const d = new Date();
      d.setHours(p[0] || 0, p[1] || 0, p[2] || 0, 0);
      return short(d);
    }

    // The exit-side mirror of _loginDisplayFromLog. Days synced before the exit
    // time was stored properly can arrive with no checkoutDisplay at all. Rather
    // than render a bare dash, fall back to the stored checkoutTime, and failing
    // that to login + hoursWorked, which is what the server row was derived from
    // anyway. Login already had this fallback; exit never did, which is why a day
    // could show its start but not its end.
    function _checkoutDisplayFromLog(log) {
      if (!log) return '—';
      if (log.checkoutDisplay) return log.checkoutDisplay;
      const atToday = (hms) => {
        const p = String(hms).split(':').map(Number);
        const d = new Date();
        d.setHours(p[0] || 0, p[1] || 0, p[2] || 0, 0);
        return d;
      };
      if (log.checkoutTime) return short(atToday(log.checkoutTime));
      if (log.loginTime && log.hoursWorked) {
        return short(new Date(atToday(log.loginTime).getTime() + Math.round(log.hoursWorked * 3600000)));
      }
      return '—';
    }

    function buildTargetHtml(eff, isDone) {
      const tk = todayKey();
      const log = dayLog(tk) || {};
      const hasCustomTarget = log.todayTargetH != null;
      // Use stored login time when session is ended (loginDate is null after checkout).
      const inVal = loginDate ? _dayStartDisplay() : _loginDisplayFromLog(log);

      // Duration card (active session) — shows "LoginTime → LogoutTime", opens tab picker
      let leftCardHtml;
      if (loginDate) {
        const logoutDate = _leaveAt(eff);
        const outVal = short(logoutDate);
        leftCardHtml = `
        <div class="rc-io-box editable" id="inTimeBox" data-on-click="hcf7f64465c">
          <div class="rc-io-label">Duration</div>
          <div class="rc-io-val-row">
            <div class="rc-io-duration">
              <span class="rc-io-val" id="metaLogin">${inVal}</span>
              <span class="rc-io-duration-arrow">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </span>
              <span class="rc-io-val" id="metaLogout">${outVal}</span>
            </div>
          </div>
          <input type="hidden" id="inTimeEditInput" value="${inVal}">
        </div>`;
      } else {
        // Session ended — show Duration card with actual login → logout times
        const outVal = _checkoutDisplayFromLog(log);
        leftCardHtml = `
        <div class="rc-io-box" id="inTimeBox">
          <div class="rc-io-label">Duration</div>
          <div class="rc-io-val-row">
            <div class="rc-io-duration">
              <span class="rc-io-val" id="metaLogin">${inVal}</span>
              <span class="rc-io-duration-arrow">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </span>
              <span class="rc-io-val" id="metaLogout">${outVal}</span>
            </div>
          </div>
          <input type="hidden" id="inTimeEditInput" value="${inVal}">
        </div>`;
      }

      const ioHtml = `<div class="rc-io-row">
        ${leftCardHtml}
        <div class="rc-io-box editable" id="outTimeBox" data-on-click="hd664c7b280">
          <div class="rc-io-label">${isDone ? 'Target Reached' : 'Target'}</div>
          <div class="rc-io-val-row">
            <span class="rc-io-val" id="metaTarget">${dur(eff)}</span>
            ${!isDone && hasCustomTarget ? `<button class="rc-io-edit-btn" title="Reset to recommended" data-on-click="h77514bfee8" style="color:var(--muted-fg)">✕</button>` : ''}
          </div>
        </div>
      </div>`;
      return ioHtml;
    }

    function ackRec(answer) {
      localStorage.setItem('wh_rec_ack_' + todayKey(), answer);
      const row = el('recAckRow');
      if (!row) return;
      row.style.maxHeight = row.offsetHeight + 'px';
      row.style.overflow = 'hidden';
      requestAnimationFrame(() => {
        row.style.transition = 'max-height .35s ease, opacity .3s ease, padding .35s ease';
        row.style.maxHeight = '0';
        row.style.opacity = '0';
        row.style.paddingTop = '0';
        row.style.paddingBottom = '0';
      });
      setTimeout(() => { if (row.parentNode) row.parentNode.removeChild(row); }, 380);
    }

    // ── TIME PICKER HELPER ────────────────────────────
    function openTimePicker(pickerId, textId) {
      const picker = el(pickerId), txtEl = el(textId);
      if (!picker) return;
      // Pre-fill picker from text field
      const parsed = parse(txtEl.value.trim());
      if (parsed) {
        picker.value = `${p2(parsed.getHours())}:${p2(parsed.getMinutes())}`;
      }
      picker.style.pointerEvents = 'all';
      picker.showPicker ? picker.showPicker() : picker.click();
      picker.oninput = picker.onchange = () => {
        if (!picker.value) return;
        const [hh, mm] = picker.value.split(':').map(Number);
        const d = new Date(); d.setHours(hh, mm, 0, 0);
        txtEl.value = short(d);
        picker.style.pointerEvents = 'none';
        // Fire change event so settings auto-save if needed
        txtEl.dispatchEvent(new Event('change', {bubbles:true}));
      };
    }

    // ── WHEEL TIME PICKER ────────────────────────────────
    let _tpTargetId = null, _tpCallback = null, _tpClearFn = null;
    let _tpDurationMode = false; // true when picker is collecting a duration (h + m), not a clock time
    let _tpTabMode = false;      // true when picker has Login/Logout tabs
    let _tpActiveTab = 'login';  // 'login' | 'logout'
    let _tpLoginState  = { h: 11, m: 0, ap: 0 };
    let _tpLogoutState = { h: 11, m: 0, ap: 1 };
    let _tpHIdx = 11, _tpMIdx = 0, _tpApIdx = 0;
    let _tp24Active = false;      // true when the open picker is a 24h clock-time picker
    const TP_HOURS   = ['01','02','03','04','05','06','07','08','09','10','11','12'];
    const TP_HOURS24 = Array.from({length:24}, (_, i) => String(i).padStart(2, '0')); // '00'..'23'
    const TP_MINS  = Array.from({length:60}, (_, i) => String(i).padStart(2, '0'));
    const TP_AMPM  = ['AM', 'PM'];
    const TP_ITEM_H = 34; // must match .tp-wheel-item height in CSS

    // Hours array for the current picker — 00–23 in active 24h clock mode, else 01–12
    function _tpHoursArr() { return _tp24Active ? TP_HOURS24 : TP_HOURS; }
    function _tpUse24() { return cfg().use24h === true; }

    function _tpWheelItems(wheelId) {
      return wheelId === 'tpWheelH' ? _tpHoursArr() : wheelId === 'tpWheelM' ? TP_MINS : TP_AMPM;
    }

    function _tpPopulateWheel(id, items, selectedIdx) {
      const wheel = el(id);
      if (!wheel) return;
      wheel.innerHTML = items.map((it, i) =>
        `<div class="tp-wheel-item${i === selectedIdx ? ' active' : ''}" data-idx="${i}">${it}</div>`
      ).join('');
      // Center the selected item once the modal is laid out
      requestAnimationFrame(() => { wheel.scrollTop = selectedIdx * TP_ITEM_H; });
    }

    // ── Week picker ──────────────────────────────────────────────────────────
    let _wpYear = 0, _wpMonth = 0, _wpContext = null; // null = overview, 'analytics' = dashboard

    function openWeekPicker(triggerEl) {
      if (triggerEl?.classList.contains('picker-open')) { closeWeekPicker(); return; }
      // Opening from another picker's trigger never passes through closeWeekPicker, so
      // the previous context (e.g. 'analytics') leaked in and drove this calendar.
      el('wkNavLabelBtn')?.classList.remove('picker-open');
      _wpContext = null;
      triggerEl?.classList.add('picker-open');
      // Open at the month of the currently selected day
      const refDate = selectedDayKey && selectedDayKey !== '__wknd__'
        ? new Date(selectedDayKey + 'T12:00')
        : new Date();
      _wpYear  = refDate.getFullYear();
      _wpMonth = refDate.getMonth();
      _wpRenderCal();
      const overlay = el('wpPickerOverlay');
      overlay.classList.add('open');
      // Position below the trigger button (fall back to thisWeekLabel if not passed)
      _wpPlace(triggerEl || el('thisWeekLabel'));
      // Close on outside click
      setTimeout(() => {
        document.addEventListener('click', _wpOutsideClick, { once: true, capture: true });
      }, 0);
    }
    // Calendar popover: anchored under its trigger and kept on screen with
    // Floating UI's flip and shift, so a trigger near the edge of a phone
    // can't push it off. Shared by every place that opens the calendar.
    function _wpPlace(btn) {
      const overlay = el('wpPickerOverlay'), F = window.FloatingUIDOM;
      if (!btn) return;
      if (!F) {
        const r = btn.getBoundingClientRect();
        overlay.style.top = (r.bottom + 6) + 'px';
        overlay.style.left = Math.max(8, Math.min(r.left, innerWidth - overlay.offsetWidth - 8)) + 'px';
        return;
      }
      F.computePosition(btn, overlay, { placement: 'bottom-start', strategy: 'fixed',
        middleware: [F.offset(6), F.flip({ padding: 8 }), F.shift({ padding: 8 })] })
        .then(p => { overlay.style.left = p.x + 'px'; overlay.style.top = p.y + 'px'; });
    }
    function _wpOutsideClick(e) {
      const overlay = el('wpPickerOverlay');
      const isTrigger = el('thisWeekLabel')?.contains(e.target) || el('wkNavLabelBtn')?.contains(e.target) || el('devDatePickerBtn')?.contains(e.target);
      if (overlay && !overlay.contains(e.target) && !isTrigger) {
        closeWeekPicker();
      } else if (overlay && overlay.classList.contains('open')) {
        // Re-register for next click outside
        setTimeout(() => {
          document.addEventListener('click', _wpOutsideClick, { once: true, capture: true });
        }, 0);
      }
    }
    function closeWeekPicker() {
      el('wpPickerOverlay').classList.remove('open');
      el('thisWeekLabel')?.classList.remove('picker-open');
      el('wkNavLabelBtn')?.classList.remove('picker-open');
      el('devDatePickerBtn')?.classList.remove('picker-open');
      _wpContext = null;
    }

    function openAnalyticsWeekPicker(triggerEl) {
      if (triggerEl?.classList.contains('picker-open')) { closeWeekPicker(); return; }
      el('thisWeekLabel')?.classList.remove('picker-open');
      triggerEl?.classList.add('picker-open');
      _wpContext = 'analytics';
      const refKey = week(analyticsWeekOffset)[0]?.key;
      const refDate = refKey ? new Date(refKey + 'T12:00') : new Date();
      _wpYear  = refDate.getFullYear();
      _wpMonth = refDate.getMonth();
      _wpRenderCal();
      const overlay = el('wpPickerOverlay');
      overlay.classList.add('open');
      _wpPlace(triggerEl);
      setTimeout(() => {
        document.addEventListener('click', _wpOutsideClick, { once: true, capture: true });
      }, 0);
    }
    function _wpPrevMonth() {
      _wpMonth--; if (_wpMonth < 0) { _wpMonth = 11; _wpYear--; }
      _wpRenderCal();
    }
    function _wpNextMonth() {
      _wpMonth++; if (_wpMonth > 11) { _wpMonth = 0; _wpYear++; }
      _wpRenderCal();
    }

    function _wpRenderCal() {
      el('wpPickerMonth').textContent = `${MONTHS[_wpMonth]} ${_wpYear}`;
      const _jtBtn = el('wpJumpTodayBtn');
      if (_jtBtn) _jtBtn.disabled = _wpContext === 'devDate'
        ? !_devDateOverride
        : _wpContext === 'analytics'
          // The week card is browsing by week, so "Today" is only pointless on the current week
          // (it used to read the day selector's selection and stay disabled in past weeks).
          ? analyticsWeekOffset === 0
          : (!selectedDayKey || selectedDayKey === '__wknd__' || (selectedDayKey === todayKey() && daySelectorWeekOffset === 0));
      const grid = el('wpPickerGrid');
      if (!grid) return;
      grid.innerHTML = '';

      const today = todayKey();
      // Monday of currently selected week
      const selMonKey = _wpContext === 'analytics' ? week(analyticsWeekOffset)[0]?.key : week(daySelectorWeekOffset)[0]?.key;

      // Find the Monday on or before the 1st of the month
      const firstOfMonth = new Date(_wpYear, _wpMonth, 1);
      const dow = firstOfMonth.getDay(); // 0=Sun
      const startMon = new Date(firstOfMonth);
      startMon.setDate(1 - ((dow + 6) % 7));

      for (let w = 0; w < 6; w++) {
        const monDate = new Date(startMon);
        monDate.setDate(startMon.getDate() + w * 7);

        // Skip rows entirely outside the month (check full Mon–Sun span)
        const sunDate = new Date(monDate); sunDate.setDate(monDate.getDate() + 6);
        if (w > 0 && monDate.getMonth() !== _wpMonth && sunDate.getMonth() !== _wpMonth) break;

        const row = document.createElement('div');
        row.className = 'wp-picker-week';

        for (let d = 0; d < 7; d++) {
          const cellDate = new Date(monDate); cellDate.setDate(monDate.getDate() + d);
          const cellKey  = `${cellDate.getFullYear()}-${p2(cellDate.getMonth()+1)}-${p2(cellDate.getDate())}`;
          const inMonth  = cellDate.getMonth() === _wpMonth;
          const isSel    = _wpContext === 'devDate'
            ? cellKey === (_devDateOverride || todayKey())
            : cellKey === (selectedDayKey || todayKey());
          const log      = dayLog(cellKey);
          const isOffDay = isWeekendKey(cellKey)
                        || log?.override === 'holiday'
                        || log?.override === 'leave';

          const cell = document.createElement('div');
          cell.className = 'wp-picker-day'
            + (inMonth  ? '' : ' wp-out')
            + (isOffDay ? ' wp-wknd' : '')
            + (isSel    ? ' wp-sel'  : '');
          cell.textContent = cellDate.getDate();
          cell.onclick = (e) => { e.stopPropagation(); _wpSelectDay(cellKey); };
          row.appendChild(cell);
        }
        grid.appendChild(row);
      }
    }

    function _wpJumpToday() {
      if (_wpContext === 'devDate') { clearDevDateOverride(); closeWeekPicker(); return; }
      _wpSelectDay(todayKey());
    }

    function _wpSelectDay(dayKey) {
      if (!dayKey) return;
      if (_wpContext === 'devDate') {
        setDevDateOverride(dayKey);
        closeWeekPicker();
        return;
      }
      if (_wpContext === 'analytics') {
        const todayDate = new Date(todayKey() + 'T12:00');
        const selDate   = new Date(dayKey + 'T12:00');
        const todayMon  = todayDate.getTime() - ((todayDate.getDay() + 6) % 7) * 86400000;
        const selMon    = selDate.getTime()   - ((selDate.getDay()   + 6) % 7) * 86400000;
        analyticsWeekOffset = Math.min(0, Math.round((selMon - todayMon) / (7 * 86400000)));
        renderAnalytics();
        closeWeekPicker();
        requestAnimationFrame(() => {
          const flashRow = document.querySelector(`.wk-row[data-day-key="${dayKey}"]`);
          if (flashRow) { flashRow.classList.remove('wk-row-flash'); void flashRow.offsetWidth; flashRow.classList.add('wk-row-flash'); }
        });
        return;
      }
      _dsUserNav = true;
      const isFuture = new Date(dayKey + 'T12:00') > new Date() && dayKey !== todayKey();
      const log = dayLog(dayKey);
      const isOff = isWeekendKey(dayKey) || log?.override === 'holiday' || log?.override === 'leave';
      // Weekends and off-days always route through selectDay (handles weekend/holiday card);
      // future work days go through selectFutureDay (shows planning UI).
      if (isFuture && !isOff) selectFutureDay(dayKey);
      else selectDay(dayKey);
      _syncOffsetFromKey(dayKey);
      closeWeekPicker();
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── Segmented time input logic ────────────────────────────────────────────
    let _tpSegSyncing = false;

    function _tpSegFromDate(d) {
      const input = el('tpFreeInput');
      if (!input) return;
      input.value = short(d); // honors the 24h setting
    }

    function _tpSegClear() {
      const input = el('tpFreeInput'), inp = el('tc-r7m2');
      if (input) input.value = '';
      if (inp)   inp.value = '';
    }
    function _tpSegInit() {
      const input = el('tpFreeInput'), hidden = el('tc-r7m2');
      if (!input) return;

      function _syncHidden() {
        hidden.value = input.value;
        hidden.dispatchEvent(new Event('input', { bubbles: true }));
      }

      input.addEventListener('input', () => {
        // Collapse any newlines/tabs from a pasted timestamp (e.g. Keka) into one clean line
        if (/[\n\r\t]/.test(input.value)) {
          input.value = input.value.replace(/[\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim();
        }
        _syncHidden();
      });

      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { calculate(); }
      });

      // Wheel picker result → fill input (AM/PM already resolved by the picker)
      if (hidden) {
        hidden.addEventListener('change', () => {
          if (!hidden.value) return;
          const p = parse(hidden.value.trim());
          if (p) input.value = short(p); // short() honors the 24h setting
        });
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    function _tpStoreIdx(wheelId, idx) {
      if (wheelId === 'tpWheelH')       _tpHIdx  = idx;
      else if (wheelId === 'tpWheelM')  _tpMIdx  = idx;
      else if (wheelId === 'tpWheelAp') _tpApIdx = idx;
    }

    // Reliable wheel scroller. Mouse/trackpad: intercept the wheel and move
    // exactly ONE item per notch (native wheel delta is ~100px ≈ 3 items, which
    // is what caused the "scrolls 3 at a time" jump). Touch/drag: let native CSS
    // scroll-snap stop on each item, then read the nearest index once it settles.
    function _tpInitWheels() {
      ['tpWheelH', 'tpWheelM', 'tpWheelAp'].forEach(wheelId => {
        const wheel = el(wheelId);
        if (!wheel) return;
        let _settleTimer, _targetIdx = 0, _lastWheel = 0, _cooldown = false;

        const itemCount = () => _tpWheelItems(wheelId).length;
        const clampIdx  = i => Math.max(0, Math.min(itemCount() - 1, i));
        const nearestIdx = () => clampIdx(Math.round(wheel.scrollTop / TP_ITEM_H));
        const highlight = idx => {
          wheel.querySelectorAll('.tp-wheel-item').forEach(item =>
            item.classList.toggle('active', +item.dataset.idx === idx));
        };
        const apply = (idx, smooth) => {
          idx = clampIdx(idx);
          _targetIdx = idx;
          highlight(idx);
          wheel.scrollTo({ top: idx * TP_ITEM_H, behavior: smooth ? 'smooth' : 'auto' });
          _tpStoreIdx(wheelId, idx);
        };

        // Mouse / trackpad — one item per notch, with a short cooldown so a fast
        // trackpad flick steps at a controlled pace instead of flying past values.
        wheel.addEventListener('wheel', e => {
          e.preventDefault();
          if (_cooldown) return;
          const now = Date.now();
          // Resync to actual position when starting a fresh gesture (e.g. after a
          // tap-scroll or re-opening the picker repositioned the wheel).
          if (now - _lastWheel > 200) _targetIdx = nearestIdx();
          _lastWheel = now;
          apply(_targetIdx + (e.deltaY > 0 ? 1 : -1), true);
          _cooldown = true;
          setTimeout(() => { _cooldown = false; }, 60);
        }, { passive: false });

        // Touch / native scroll — snap handles stepping; read & store on settle.
        wheel.addEventListener('scroll', () => {
          highlight(nearestIdx());
          clearTimeout(_settleTimer);
          _settleTimer = setTimeout(() => {
            const idx = nearestIdx();
            _targetIdx = idx;
            highlight(idx);
            if (Math.abs(wheel.scrollTop - idx * TP_ITEM_H) > 1) {
              wheel.scrollTo({ top: idx * TP_ITEM_H, behavior: 'smooth' });
            }
            _tpStoreIdx(wheelId, idx);
          }, 90);
        }, { passive: true });

        // Tap a value to select it directly
        wheel.addEventListener('click', e => {
          const item = e.target.closest('.tp-wheel-item');
          if (!item) return;
          apply(+item.dataset.idx, true);
        });
      });
    }

    function openTpModal(targetInputId, event, title, onConfirm, onClear) {
      if (event) { event.stopPropagation(); event.preventDefault(); }
      _tpTargetId = targetInputId;
      _tpCallback = onConfirm || null;
      _tpClearFn  = onClear  || null;
      const cancelBtn = el('tpCancelBtn');
      if (cancelBtn) cancelBtn.textContent = onClear ? 'Clear' : 'Cancel';
      const modal = el('tpModal');
      if (!modal) return;

      const titleEl = el('tpModalTitle');
      if (titleEl) titleEl.textContent = title || 'Set Time';

      // 24h clock mode → 00–23 hours, AM/PM wheel hidden
      _tp24Active = _tpUse24();
      modal.classList.toggle('tp-24h', _tp24Active);

      // Pre-fill from current field value
      const inp = el(targetInputId);
      if (inp) {
        const parsed = parse((inp.value || '').trim());
        if (parsed) {
          const h = parsed.getHours(), m = parsed.getMinutes();
          if (_tp24Active) { _tpHIdx = h; _tpApIdx = 0; }
          else { _tpApIdx = h >= 12 ? 1 : 0; _tpHIdx = (h % 12 || 12) - 1; }
          _tpMIdx  = m;
        } else { _tpHIdx = _tp24Active ? 9 : 11; _tpMIdx = 0; _tpApIdx = 0; }
      }

      // Position
      const _isLoginInput = targetInputId === 'tc-r7m2';
      const refEl = _isLoginInput
        ? (el('shiftInputRow') || event?.target?.closest('button,.rc-io-box,[data-tpid]') || event?.target)
        : (event?.target?.closest('button,.rc-io-box,[data-tpid]') || event?.target || el(targetInputId));
      const refRect = refEl?.getBoundingClientRect();
      if (refRect) {
        const GAP = 12, mW = 216, mH = 200, pad = 8;
        // Login input: prefer above; everything else: prefer below
        let top = _isLoginInput
          ? refRect.top - mH - GAP
          : refRect.bottom + GAP;
        let left = refRect.left + refRect.width / 2 - mW / 2;
        if (top < pad) top = refRect.bottom + GAP;          // fallback below if above clips
        if (top + mH > window.innerHeight - pad) top = Math.max(pad, refRect.top - mH - GAP);
        if (left + mW > window.innerWidth - pad) left = window.innerWidth - mW - pad;
        if (left < pad) left = pad;
        modal.style.top = top + 'px'; modal.style.left = left + 'px';
      }
      modal.classList.add('open');

      // Populate wheels after modal is visible
      _tpPopulateWheel('tpWheelH',  _tpHoursArr(), _tpHIdx);
      _tpPopulateWheel('tpWheelM',  TP_MINS,  _tpMIdx);
      _tpPopulateWheel('tpWheelAp', TP_AMPM,  _tpApIdx);

      setTimeout(() => document.addEventListener('mousedown', _tpOutsideClick), 10);
    }

    // Opens the wheel picker in duration mode — user picks H + M for today's target
    function openDailyTargetPicker(event) {
      if (event) { event.stopPropagation(); event.preventDefault(); }
      _tpDurationMode = true;
      _tp24Active = false; // duration uses 1–12 hours regardless of clock format
      // Pre-fill wheels from the current effective target
      const eff = effSecs();
      const totalMins = Math.round(eff / 60);
      const h = Math.max(1, Math.min(12, Math.floor(totalMins / 60)));
      const m = Math.min(59, totalMins % 60);
      _tpHIdx  = h - 1;   // TP_HOURS is ['01'..'12'], index 0='01'
      _tpMIdx  = m;
      _tpApIdx = 0;
      _tpTargetId = null;
      _tpCallback = null;
      const tk = todayKey(), log = dayLog(tk) || {};
      _tpClearFn = log.todayTargetH != null ? clearTodayTarget : null;
      const cancelBtn = el('tpCancelBtn');
      if (cancelBtn) cancelBtn.textContent = _tpClearFn ? 'Reset' : 'Cancel';
      const modal = el('tpModal');
      if (!modal) return;
      modal.classList.add('tp-duration-mode');
      const titleEl = el('tpModalTitle');
      if (titleEl) titleEl.textContent = 'Target';
      // Position centered below the tapped element
      const refEl = event?.target?.closest('button,.rc-io-box,[data-tpid]') || event?.target;
      const refRect = refEl?.getBoundingClientRect();
      if (refRect) {
        const GAP = 8, mW = 256, mH = 280, pad = 8;
        let top = refRect.bottom + GAP;
        let left = refRect.left + refRect.width / 2 - mW / 2;
        if (left + mW > window.innerWidth - pad) left = window.innerWidth - mW - pad;
        if (left < pad) left = pad;
        if (top + mH > window.innerHeight - pad) top = Math.max(pad, refRect.top - mH - GAP);
        if (top < pad) top = pad;
        modal.style.top = top + 'px'; modal.style.left = left + 'px';
      }
      _tpPopulateWheel('tpWheelH',  _tpHoursArr(), _tpHIdx);
      _tpPopulateWheel('tpWheelM',  TP_MINS,  _tpMIdx);
      _tpPopulateWheel('tpWheelAp', TP_AMPM,  _tpApIdx);
      modal.classList.add('open');
      setTimeout(() => document.addEventListener('mousedown', _tpOutsideClick), 10);
    }

    // Opens tpModal with Login/Logout tabs for the Duration card
    function openLoginLogoutPicker(event) {
      if (!loginDate) return;
      if (event) { event.stopPropagation(); event.preventDefault(); }
      _tpTabMode = true;
      _tpDurationMode = false;
      _tpActiveTab = 'login';
      _tpTargetId = null; _tpCallback = null; _tpClearFn = null;
      _tp24Active = _tpUse24();

      // Pre-fill login wheels
      const lH = loginDate.getHours(), lM = loginDate.getMinutes();
      _tpLoginState = _tp24Active
        ? { h: lH, m: lM, ap: 0 }
        : { h: (lH % 12 || 12) - 1, m: lM, ap: lH >= 12 ? 1 : 0 };

      // Pre-fill logout wheels (login + today's effective target)
      const logoutDate = new Date(loginDate.getTime() + effSecs() * 1000);
      const loH = logoutDate.getHours(), loM = logoutDate.getMinutes();
      _tpLogoutState = _tp24Active
        ? { h: loH, m: loM, ap: 0 }
        : { h: (loH % 12 || 12) - 1, m: loM, ap: loH >= 12 ? 1 : 0 };

      // Start on login tab
      _tpHIdx = _tpLoginState.h; _tpMIdx = _tpLoginState.m; _tpApIdx = _tpLoginState.ap;

      // Show tab bar, mark login active
      const tabBar = el('tpTabBar');
      if (tabBar) tabBar.style.display = 'flex';
      el('tpTabLogin')?.classList.add('active');
      el('tpTabLogout')?.classList.remove('active');

      const modal = el('tpModal');
      if (!modal) return;
      modal.classList.toggle('tp-24h', _tp24Active);
      const titleEl = el('tpModalTitle');
      if (titleEl) titleEl.textContent = 'Log In';
      const cancelBtn = el('tpCancelBtn');
      if (cancelBtn) cancelBtn.textContent = 'Cancel';

      const refEl = event?.target?.closest('button,.rc-io-box,[data-tpid]') || event?.target;
      const refRect = refEl?.getBoundingClientRect();
      if (refRect) {
        const GAP = 8, mW = 256, mH = 330, pad = 8;
        let top = refRect.bottom + GAP;
        let left = refRect.left + refRect.width / 2 - mW / 2;
        if (left + mW > window.innerWidth - pad) left = window.innerWidth - mW - pad;
        if (left < pad) left = pad;
        if (top + mH > window.innerHeight - pad) top = Math.max(pad, refRect.top - mH - GAP);
        if (top < pad) top = pad;
        modal.style.top = top + 'px'; modal.style.left = left + 'px';
      }
      _tpPopulateWheel('tpWheelH',  _tpHoursArr(), _tpHIdx);
      _tpPopulateWheel('tpWheelM',  TP_MINS,  _tpMIdx);
      _tpPopulateWheel('tpWheelAp', TP_AMPM,  _tpApIdx);
      modal.classList.add('open', 'tab-mode');
      setTimeout(() => document.addEventListener('mousedown', _tpOutsideClick), 10);
    }

    // Switches between Login and Logout tabs in tab-mode picker
    function _tpSwitchTab(tab) {
      if (!_tpTabMode || _tpActiveTab === tab) return;
      // Save current tab's wheel state
      if (_tpActiveTab === 'login') {
        _tpLoginState = { h: _tpHIdx, m: _tpMIdx, ap: _tpApIdx };
      } else {
        _tpLogoutState = { h: _tpHIdx, m: _tpMIdx, ap: _tpApIdx };
      }
      _tpActiveTab = tab;
      // Load the other tab's state
      const st = tab === 'login' ? _tpLoginState : _tpLogoutState;
      _tpHIdx = st.h; _tpMIdx = st.m; _tpApIdx = st.ap;
      // Update tab buttons + title
      el('tpTabLogin')?.classList.toggle('active',  tab === 'login');
      el('tpTabLogout')?.classList.toggle('active', tab === 'logout');
      const titleEl = el('tpModalTitle');
      if (titleEl) titleEl.textContent = tab === 'login' ? 'Log In' : 'Log Out';
      // Re-populate wheels
      _tpPopulateWheel('tpWheelH',  _tpHoursArr(), _tpHIdx);
      _tpPopulateWheel('tpWheelM',  TP_MINS,  _tpMIdx);
      _tpPopulateWheel('tpWheelAp', TP_AMPM,  _tpApIdx);
    }

    // Removes the per-day target override, reverting to the weekly calc
    function clearTodayTarget() {
      const tk = todayKey(), ex = dayLog(tk) || {};
      const updated = { ...ex };
      delete updated.todayTargetH;
      saveDayLog(tk, updated);
      if (loginDate) render(); else renderEmptyState();
    }

    // ── TODAY'S DETAILS (info popover / mobile modal) ──────────────────
    // Small circular progress indicator for rows that count toward a fixed end —
    // an empty ring filling in as pct climbs, swapping to a solid checkmark once
    // it's reached. Not used for rows with no end to count toward (Worked Duration).
    function _tdProgressIcon(pct) {
      const p = Math.max(0, Math.min(1, pct));
      if (p >= 1) {
        return `<svg class="td-ring" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="7" fill="var(--success)"/><path d="M4 7.3l2 2 4-4.6" stroke="var(--card)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`;
      }
      const r = 5.5, C = 2 * Math.PI * r, dash = p * C;
      return `<svg class="td-ring" viewBox="0 0 14 14" fill="none">
        <circle cx="7" cy="7" r="${r}" stroke="var(--border)" stroke-width="2"/>
        <circle class="td-ring-fill" cx="7" cy="7" r="${r}" stroke="var(--foreground)" stroke-width="2" stroke-linecap="round"
          style="stroke-dasharray:${dash.toFixed(2)} ${C.toFixed(2)}" transform="rotate(-90 7 7)"/>
      </svg>`;
    }

    // Today's numbers. Fixed rows lead (Recommended, Worked Duration) and the
    // ones that come and go sit last (Remaining, Available Surplus, then any
    // extras), so switching Full Day and Half Day changes values, never positions.
    // Leave and Holiday have no target, so only Worked Duration shows.
    // `plan` previews a type picked but not yet confirmed.
    function _tdBuildContent(plan = _tdCurrentPlan()) {
      const c = cfg(), daily = c.dailyH * 3600;
      const eff = plan === _tdCurrentPlan() ? effSecs()
        : plan === 'halfday' ? daily / 2
        : plan === 'fullday' ? _weeklyEffSecs() : 0;
      const worked = loginDate
        ? Math.max(0, Math.floor((new Date() - loginDate) / 1000)) + _sessionAccSecs
        : _sessionAccSecs;
      const off = plan === 'leave' || plan === 'holiday';
      const recOn = c.recommendTimings !== false;
      const weekly = _weeklyEffSecs();
      const surplus = recOn ? Math.max(0, daily - weekly) : 0;      // banked overtime
      const overtimeReq = recOn ? Math.max(0, weekly - daily) : 0;
      const onBreak = c.breakTime !== false && !loginDate && _sessionAccSecs > 0;
      const customTarget = plan === _tdCurrentPlan() && (dayLog(todayKey()) || {}).todayTargetH != null && plan !== 'halfday';
      const row = (label, val, cls) =>
        `<div class="td-row"><span class="td-row-label">${label}</span><span class="td-row-val${cls ? ' ' + cls : ''}">${val}</span></div>`;

      let html = '';
      if (!off && eff > 0) html += row(recOn && !customTarget ? 'Recommended' : 'Target', dur(eff));
      html += row('Worked Duration', durWorked(worked));
      if (off) return html;

      if (eff > 0) {
        // Remaining is a plain number, 0 once overtime begins; overtime is its own row.
        html += row(_tdProgressIcon(worked / eff) + 'Remaining', durWorked(Math.max(0, eff - worked)));
      }
      if (surplus > 60) html += row('Available Surplus', dur(surplus), 'success');
      const ot = eff > 0 ? Math.max(0, worked - eff) : 0;
      if (ot >= 60) html += row('Overtime', durWorked(ot), 'warn');
      if (overtimeReq > 60) html += row('Overtime Required', dur(overtimeReq), 'warn');
      if (onBreak) html += row('On Break', 'Yes');
      return html;
    }

    // The day-type button opens the Today panel, a centred modal over a blurred page.
    let _tdPicked = null;
    function _tdToggle(event) {
      if (event) { event.stopPropagation(); event.preventDefault(); }
      const panel = el('tdPanel');
      if (panel.classList.contains('open')) { closeTodayDetails(); return; }
      _tdPicked = _tdCurrentPlan();
      _tdSyncPlan();
      el('tdKpis').style.height = '';
      el('tdKpis').innerHTML = _tdBuildContent();
      // Values become NumberFlow at once (no roll), so the first pick animates.
      // Plain text until the library arrives, then upgraded in place.
      const upgrade = () => el('tdKpis').querySelectorAll('.td-row-val').forEach(v => { if (!v._nf) _odoSet(v, v.dataset.odo ?? v.textContent); });
      upgrade();
      _loadLib('numberflow').then(upgrade, () => {});
      el('tdScrim').classList.add('open');
      document.documentElement.classList.add('td-sheet-open'); // no page scroll or pull-to-refresh behind it
      panel.classList.add('open');
    }

    function closeTodayDetails() {
      const panel = el('tdPanel');
      if (panel) { panel.classList.remove('open', 'dragging'); panel.style.transform = ''; }
      el('tdScrim')?.classList.remove('open');
      document.documentElement.classList.remove('td-sheet-open');
    }
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && el('tdPanel')?.classList.contains('open')) closeTodayDetails();
    });

    // Phones: drag down to close (shared iOS-style sheet drag, lib/pages/sheet.js).
    window.Sheet?.attach(el('tdPanel'), {
      close: closeTodayDetails,
      isOpen: () => el('tdPanel').classList.contains('open'),
    });

    // ── Day type (Full Day / Half Day / On Leave / Holiday) ──
    const _TD_PLAN_LABELS = { fullday: 'Full Day', halfday: 'Half Day', leave: 'On Leave', holiday: 'Holiday' };

    function _tdCurrentPlan() {
      const ov = dayLog(todayKey())?.override;
      return ov === 'halfday' || ov === 'leave' || ov === 'holiday' ? ov : 'fullday';
    }

    // The button shows today's type in its colour; the panel marks the picked one.
    function _tdSyncPlan() {
      const plan = _tdCurrentPlan(), btn = el('rcInfoBtn');
      if (btn && btn.dataset.plan !== plan) {
        btn.dataset.plan = plan;
        el('rcDayTypeLabel').textContent = _TD_PLAN_LABELS[plan];
        btn.setAttribute('aria-label', 'Day type: ' + _TD_PLAN_LABELS[plan]);
      }
      const picked = el('tdPanel')?.classList.contains('open') && _tdPicked ? _tdPicked : plan;
      el('tdTypes')?.querySelectorAll('.td-type').forEach(t => {
        t.classList.toggle('active', t.dataset.plan === picked);
        t.setAttribute('aria-checked', String(t.dataset.plan === picked));
      });
      const ok = el('tdConfirm'); if (ok) ok.disabled = picked === plan;
    }

    // Rebuild the numbers in the open panel; render()/renderEmptyState() only
    // refresh the card behind it.
    function _tdRefreshBody() {
      if (el('tdPanel')?.classList.contains('open')) _tdSetKpis(_tdBuildContent(_tdPicked || undefined));
    }

    // Swap the numbers and glide the card to its new height (rows hide on Leave
    // and Holiday), so the modal resizes smoothly instead of jumping.
    function _tdSetKpis(html) {
      const box = el('tdKpis');
      const from = box.offsetHeight;
      box.style.height = '';
      // Rows that stay (matched by label) are kept, so their values can roll;
      // rows that come or go are swapped in.
      const tpl = document.createElement('div');
      tpl.innerHTML = html;
      const label = r => r.querySelector('.td-row-label').textContent.trim();
      const kept = new Map([...box.querySelectorAll('.td-row')].map(r => [label(r), r]));
      const rolls = [], rings = [];
      const rows = [...tpl.children].map(r => {
        const k = kept.get(label(r));
        if (!k) return r;
        const v = k.querySelector('.td-row-val'), nv = r.querySelector('.td-row-val');
        const ring = k.querySelector('.td-ring-fill'), nring = r.querySelector('.td-ring-fill');
        if (ring && nring) {
          // Fills in step with the numbers beside it: same duration and curve.
          const ms = 900, dash = nring.style.strokeDasharray; // NumberFlow's own duration
          rings.push(() => {
            ring.style.transition = `stroke-dasharray ${ms}ms cubic-bezier(.65,0,.35,1)`;
            getComputedStyle(ring).strokeDasharray; // register the transition before the change
            ring.style.strokeDasharray = dash;
          });
        } else {
          k.querySelector('.td-row-label').innerHTML = r.querySelector('.td-row-label').innerHTML;
        }
        v.className = nv.className;
        rolls.push([v, nv.textContent]);
        return k;
      });
      box.replaceChildren(...rows);
      // Roll only once the rows are back in place: moving a node cancels its transitions.
      rolls.forEach(([v, text]) => _odoSet(v, text));
      rings.forEach(f => f());
      const to = box.offsetHeight;
      if (!from || from === to || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      box.style.height = from + 'px';
      void box.offsetHeight; // start from the old height
      box.style.height = to + 'px';
      clearTimeout(box._tdT);
      box._tdT = setTimeout(() => { box.style.height = ''; }, 300);
    }

    // Animated times ("8h 25m", "25m") use NumberFlow, a library built for
    // this: digits roll, the width eases, and a group keeps hours and minutes
    // moving together. Minutes' tens digit tops out at 5, so they roll like a
    // clock. Anything that isn't a time ("Yes"), or before the library has
    // loaded, is plain text.
    const _odoMin = t => {
      const m = /^(?:(\d+)h)?\s*(?:(\d+)m)?$/.exec((t || '').trim());
      return m && (m[1] || m[2]) ? (+(m[1] || 0)) * 60 + (+(m[2] || 0)) : null;
    };

    function _odoSet(elm, text) {
      elm.dataset.odo = text;
      const min = _odoMin(text);
      if (min == null || !customElements.get('number-flow')) { elm.textContent = text; elm._nf = null; return; }
      const withH = /h/.test(text);
      if (!elm._nf || elm._nf.withH !== withH) {
        elm.innerHTML = '<number-flow-group>' + (withH ? '<number-flow></number-flow>' : '') + '<number-flow></number-flow></number-flow-group>';
        const flows = elm.querySelectorAll('number-flow'), m = flows[flows.length - 1];
        m.numberSuffix = 'm';
        if (withH) {
          flows[0].numberSuffix = 'h';
          m.format = { minimumIntegerDigits: 2 };
          m.digits = { 1: { max: 5 } };
        }
        elm._nf = { withH, h: withH ? flows[0] : null, m };
      }
      if (withH) { elm._nf.h.update(Math.floor(min / 60)); elm._nf.m.update(min % 60); }
      else elm._nf.m.update(min);
    }

    // Picking a type only previews it: the dot moves and the numbers show that
    // day. Confirm applies it.
    function _tdPick(type) {
      _tdPicked = type;
      _tdSyncPlan();
      _tdRefreshBody();
    }

    // Half Day halves today's effective target (todayTargetH) and Full Day clears
    // it, taking effect at once whether a session is running or not. Leave and
    // Holiday go on to the Day Edit screen for a note before they apply.
    function _tdConfirm() {
      const type = _tdPicked, tk = todayKey(), ex = dayLog(tk) || {};
      if (!type || type === _tdCurrentPlan()) return;
      closeTodayDetails();
      if (type === 'fullday' || type === 'halfday') {
        const u = { ...ex };
        if (type === 'fullday') { delete u.override; delete u.todayTargetH; }
        else { u.override = 'halfday'; u.todayTargetH = cfg().dailyH / 2; }
        saveDayLogAndSync(tk, u);
        if (loginDate) render(); else renderEmptyState();
        _tdSyncPlan();
        return;
      }
      openDayEditModal(null, true);
      setDeOverride(type);
    }

    function _tpOutsideClick(e) {
      const modal = el('tpModal');
      if (modal && modal.classList.contains('open') && !modal.contains(e.target)) {
        closeTpModal();
      } else if (modal?.contains(e.target)) {
        setTimeout(() => document.addEventListener('mousedown', _tpOutsideClick), 10);
      }
      document.removeEventListener('mousedown', _tpOutsideClick);
    }

    function closeTpModal() {
      _tpDurationMode = false;
      _tpTabMode = false;
      _tp24Active = false;
      _tpActiveTab = 'login';
      el('tpModal')?.classList.remove('open', 'tp-duration-mode', 'tab-mode', 'tp-24h');
      document.removeEventListener('mousedown', _tpOutsideClick);
      _tpTargetId = null; _tpCallback = null; _tpClearFn = null;
      const cancelBtn = el('tpCancelBtn');
      if (cancelBtn) cancelBtn.textContent = 'Cancel';
      const tabBar = el('tpTabBar');
      if (tabBar) tabBar.style.display = 'none';
      el('tpTabLogin')?.classList.remove('active');
      el('tpTabLogout')?.classList.remove('active');
    }

    function cancelOrClearTpModal() {
      if (_tpClearFn) { const fn = _tpClearFn; closeTpModal(); fn(); }
      else closeTpModal();
    }

    function confirmTpModal() {
      // Tab mode: Login + Logout tabs → update login time + derive new target
      if (_tpTabMode) {
        // Flush current tab's wheel state
        if (_tpActiveTab === 'login') _tpLoginState  = { h: _tpHIdx, m: _tpMIdx, ap: _tpApIdx };
        else                          _tpLogoutState = { h: _tpHIdx, m: _tpMIdx, ap: _tpApIdx };

        function _stateToDate(st) {
          let h24;
          if (_tp24Active) { h24 = st.h; }
          else { const h = st.h + 1, ap = TP_AMPM[st.ap]; h24 = ap === 'PM' ? (h === 12 ? 12 : h + 12) : (h === 12 ? 0 : h); }
          const d = new Date(); d.setHours(h24, st.m, 0, 0); return d;
        }
        const newLogin  = _stateToDate(_tpLoginState);
        const newLogout = _stateToDate(_tpLogoutState);

        // Handle overnight (logout < login → add one day to logout)
        if (newLogout <= newLogin) newLogout.setDate(newLogout.getDate() + 1);

        const diffSecs = (newLogout - newLogin) / 1000;
        const tk = todayKey(), ex = dayLog(tk) || {};

        if (loginDate) {
          // Adjust accumulated time to keep total worked consistent
          const now = new Date();
          const oldWorked = Math.max(0, Math.floor((now - loginDate) / 1000)) + _sessionAccSecs;
          loginDate = newLogin;
          const newCurrentSecs = Math.max(0, Math.floor((now - loginDate) / 1000));
          _sessionAccSecs = Math.max(0, oldWorked - newCurrentSecs);
          saveDayLog(tk, { ...ex,
            todayTargetH: diffSecs / 3600,
            loginTime: `${newLogin.getHours()}:${newLogin.getMinutes()}:${newLogin.getSeconds()}`,
            loginDisplay: short(newLogin),
            sessionTag: 'edited',
            lastUpdated: new Date().toISOString()
          });
          const lbl = el('shiftActiveLabel');
          if (lbl) lbl.textContent = `Started at ${short(newLogin)}`;
          persistSession();
        }
        closeTpModal();
        if (loginDate) render(); else renderEmptyState();
        return;
      }

      // Duration mode: save H + M as today's target hours, skip clock-time logic
      if (_tpDurationMode) {
        const h = _tpHIdx + 1;   // 1–12 hours
        const m = _tpMIdx;       // 0–59 minutes
        const tk = todayKey(), ex = dayLog(tk) || {};
        saveDayLog(tk, { ...ex, todayTargetH: h + m / 60 });
        closeTpModal();
        if (loginDate) render(); else renderEmptyState();
        return;
      }
      if (!_tpTargetId) { closeTpModal(); return; }
      const inp = el(_tpTargetId);
      if (inp) {
        let h24;
        if (_tp24Active) { h24 = _tpHIdx; }
        else { const h = _tpHIdx + 1, ap = TP_AMPM[_tpApIdx]; h24 = ap === 'PM' ? (h === 12 ? 12 : h + 12) : (h === 12 ? 0 : h); }
        const d = new Date(); d.setHours(h24, _tpMIdx, 0, 0);
        inp.value = short(d);
        inp.dispatchEvent(new Event('input',  { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const cb = _tpCallback;
      closeTpModal();
      if (cb) cb();
    }

    // ── EDITABLE IN TIME (today, active session) ──────
    function toggleInTimeEdit() {
      if (!loginDate) return;
      const wrap = el('inTimeEditWrap');
      if (!wrap) return;
      const isOpen = wrap.classList.contains('open');
      // Close out-target edit if open
      const outWrap = el('outTargetEditWrap');
      if (outWrap) outWrap.classList.remove('open');
      if (isOpen) { wrap.classList.remove('open'); return; }
      const inp = el('inTimeEditInput');
      if (inp) { inp.value = short(loginDate); inp.focus(); }
      // Wire native time picker
      const picker = el('inTimeEditPicker');
      if (picker) {
        picker.value = `${p2(loginDate.getHours())}:${p2(loginDate.getMinutes())}`;
        picker.oninput = picker.onchange = () => {
          if (!picker.value) return;
          const [hh, mm] = picker.value.split(':').map(Number);
          const d = new Date(); d.setHours(hh, mm, 0, 0);
          if (inp) inp.value = short(d);
        };
      }
      wrap.classList.add('open');
    }

    function saveInTimeEdit() {
      const inp = el('inTimeEditInput');
      if (!inp) return;
      const parsed = parse(inp.value.trim());
      if (!parsed) { inp.style.borderColor = 'var(--destructive)'; return; }
      if (parsed > new Date()) { inp.style.borderColor = 'var(--destructive)'; return; }
      inp.style.borderColor = '';
      // Adjust accumulated time: shift loginDate, keep total worked consistent
      const now = new Date();
      const oldWorked = Math.max(0, Math.floor((now - loginDate) / 1000)) + _sessionAccSecs;
      loginDate = parsed;
      const newCurrentSecs = Math.max(0, Math.floor((now - loginDate) / 1000));
      _sessionAccSecs = Math.max(0, oldWorked - newCurrentSecs);
      // Save to day log with Edited tag
      const tk = todayKey(), ex = dayLog(tk) || {};
      saveDayLog(tk, { ...ex,
        loginTime: `${parsed.getHours()}:${parsed.getMinutes()}:${parsed.getSeconds()}`,
        loginDisplay: short(parsed),
        sessionTag: 'edited',
        lastUpdated: now.toISOString()
      });
      el('shiftActiveLabel').textContent = `Started at ${short(parsed)}`;
      persistSession();
      const wrap = el('inTimeEditWrap');
      if (wrap) wrap.classList.remove('open');
      render();
    }

    // ── OUT TIME TARGET (personal early leave target) ─
    function toggleOutTargetEdit() {
      const wrap = el('outTargetEditWrap');
      if (!wrap) return;
      const isOpen = wrap.classList.contains('open');
      // Close in-time edit if open
      const inWrap = el('inTimeEditWrap');
      if (inWrap) inWrap.classList.remove('open');
      if (isOpen) { wrap.classList.remove('open'); return; }
      const inp = el('outTargetEditInput');
      const tk = todayKey(), log = dayLog(tk) || {};
      if (inp) { inp.value = log.earlyLeaveTarget || ''; inp.focus(); }
      wrap.classList.add('open');
    }

    function saveOutTargetEdit() {
      const inp = el('outTargetEditInput');
      if (!inp) return;
      const raw = inp.value.trim();
      if (!raw) { clearOutTarget(); return; }
      const parsed = parse(raw);
      if (!parsed) { inp.style.borderColor = 'var(--destructive)'; return; }
      inp.style.borderColor = '';
      const tk = todayKey(), ex = dayLog(tk) || {};
      saveDayLog(tk, { ...ex, earlyLeaveTarget: short(parsed) });
      const wrap = el('outTargetEditWrap');
      if (wrap) wrap.classList.remove('open');
      if (loginDate) render(); else renderEmptyState();
    }

    function clearOutTarget() {
      const tk = todayKey(), ex = dayLog(tk) || {};
      const updated = { ...ex }; delete updated.earlyLeaveTarget;
      saveDayLog(tk, updated);
      const wrap = el('outTargetEditWrap');
      if (wrap) wrap.classList.remove('open');
      if (loginDate) render(); else renderEmptyState();
    }

    // ── TOAST ─────────────────────────────────────────
    let _toastTimer = null, _toastUndoFn = null;
    const _toastIcons = {
      success: '<polyline points="20 6 9 17 4 12"/>',
      error:   '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
      info:    '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
    };
    const _toastColors = { success: 'var(--success)', error: 'var(--destructive)', info: 'var(--blue)' };
    // showToast(title, type, desc, action)
    //   action: undefined → default "Close" button
    //           null       → no button
    //           {label, onClick} → labeled action button (runs onClick, then dismisses)
    function showToast(title, type = 'info', desc = '', action) {
      const t = el('ieToast'); if (!t) return;
      t.className = `wh-toast ${type}`;
      el('toastTitle').textContent = title;
      const d = el('toastDesc');
      d.textContent = desc;
      d.classList.toggle('visible', !!desc);
      const icon = el('toastIcon');
      if (type === 'none') {
        icon.style.display = 'none';
      } else {
        icon.style.display = '';
        icon.innerHTML = _toastIcons[type] || _toastIcons.info;
        icon.style.color = _toastColors[type] || _toastColors.info;
      }

      const dismiss = () => t.classList.remove('show');
      const btn = el('toastActionBtn');
      if (btn) {
        if (action === null) {
          btn.style.display = 'none';
        } else {
          btn.style.display = '';
          btn.textContent = action?.label || 'Close';
          btn.onclick = () => { try { action?.onClick?.(); } finally { dismiss(); } };
        }
      }

      t.classList.add('show');
      if (_toastTimer) clearTimeout(_toastTimer);
      _toastTimer = setTimeout(dismiss, 3800);
    }

    // ── STAY HINT (Recommended action for target day) ──
    function buildStayHint() {
      const c = cfg();
      if (!c.recommendTimings) return null;
      if (!c.weeklyOn || !loginDate) return null;
      const wk = week(), tk = todayKey();
      const todayIdx = wk.findIndex(d => d.key === tk);
      if (c.targetDay == null) return null; // no early leave day set
      const targetIdx = c.targetDay - 1; // targetDay 1=Mon … 5=Fri → index 0-4
      if (todayIdx < 0 || todayIdx >= targetIdx) return null;

      // How many days between today and targetDay (inclusive of targetDay but not today)
      const daysToTarget = targetIdx - todayIdx;
      // Total worked so far this week (excluding today)
      let workedBefore = 0;
      for (let i = 0; i < todayIdx; i++) {
        const l = dayLog(wk[i].key);
        if (l?.hoursWorked != null) workedBefore += l.hoursWorked * 3600;
      }
      const weeklyTarget = adjustedWeeklyTarget(wk);
      // If you stay till X today, tomorrow through (targetDay - 1) you need Y each day, and targetDay you need Z (ideal: dailyH or less)
      // Simplest: what do you need to work today so that targetDay requires only c.dailyH * 3600 * 0.5 (half day)?
      // Actually: recommend how long to stay today so that you can leave at a good time on targetDay
      // "You should stay till X today to leave early on {targetDay}"
      // If you work `eff` today, the remaining for next (daysToTarget) days = weeklyTarget - workedBefore - eff*today
      // For simplicity, compute what "leave time" today gives you a surplus that reduces targetDay to half-day:
      const targetDayTarget = c.dailyH * 3600 * 0.5; // target to leave by noon on targetDay
      // Required total for today + days between = weeklyTarget - workedBefore - targetDayTarget
      const requiredTotal = weeklyTarget - workedBefore - targetDayTarget;
      const daysInBetween = daysToTarget - 1; // days between today and targetDay
      const todayRequired = requiredTotal - (daysInBetween * c.dailyH * 3600);
      if (todayRequired <= 0 || todayRequired > 24 * 3600) return null;
      // Only show hint if required stay is within dailyH + 1h
      if (todayRequired > (c.dailyH + 1) * 3600) return null;

      const leaveTimeToday = _leaveAt(todayRequired);
      if (leaveTimeToday < new Date()) return null; // already past that time

      const targetDayName = wk[targetIdx]?.name || 'your target day';
      // Compute what time they'd leave on targetDay if they stay till leaveTimeToday today
      const targetDayLeaveTime = new Date(loginDate.getTime() + targetDayTarget + (daysInBetween * c.dailyH * 3600 * 0 ));
      // Simpler: if you leave at leaveTimeToday, on targetDay you need targetDayTarget from their normal start
      const normalStart = new Date(loginDate); normalStart.setHours(9,0,0,0); // assume 9 AM start on target day
      const targetDayLeave = new Date(normalStart.getTime() + targetDayTarget);
      return `Stay till ${short(leaveTimeToday)} today · leave at ${short(targetDayLeave)} on ${targetDayName}.`;
    }

    // ── TODAY DATE CHIP ───────────────────────────────
    function _setTodayDateChip() {
      const chip = el('leaveAt');
      if (chip) chip.textContent = _fmtDayHeading(nowTz()); // "Tuesday, 9th June" → uppercased by CSS
    }

    // Dismisses the skeleton shimmer the first time real content is available.
    function _hideSkeleton() {
      const skel = el('resultSkeleton');
      if (skel && !skel.classList.contains('hidden')) skel.classList.add('hidden');
    }

    // ── ONGOING SESSION ELSEWHERE BANNER ──────────────
    // Dismissing silences the banner globally, not per-day — it only re-arms once the
    // user is back on Today (see the reset below), matching "won't pop up again until
    // you're back on today; leaving today again after that shows it again".
    let _runningElsewhereDismissed = false;

    function _updateRunningElsewhereBanner() {
      const wrap = el('rcRunningElsewhere');
      if (!wrap) return;
      if (selectedDayKey === todayKey()) _runningElsewhereDismissed = false;
      const show = !!loginDate && !!selectedDayKey && selectedDayKey !== todayKey()
        && !_runningElsewhereDismissed;
      wrap.style.display = show ? '' : 'none';
      if (show) {
        const lbl = el('rcRunningElsewhereLabel');
        if (lbl) {
          const leaveDate = _leaveAt();
          lbl.textContent = 'Session running · Leave by ' + short(leaveDate);
        }
      }
    }

    function _dismissRunningElsewhereBanner() {
      _runningElsewhereDismissed = true;
      _updateRunningElsewhereBanner();
    }

    // ── TODAY CARD: PAIR TABS + PROGRESS BAR ──────────
    let _rcCurrentPair = 'times';
    // Overtime overlay reveal — armed becomes true ~650ms after the target is first
    // reached, on its own timer rather than the 1s render tick, so the pause before
    // it appears feels deliberate. Resets whenever the day isn't in the done state.
    let _otOverlayArmed = false;
    let _otOverlayTimer = null;
    function _otOverlayReset() {
      _otOverlayArmed = false;
      if (_otOverlayTimer) { clearTimeout(_otOverlayTimer); _otOverlayTimer = null; }
    }
    // Cached values set each render so pair-switch can re-display without a full re-render
    let _rcCache = { loginStr:'—', logoutStr:'—', elapsedStr:'0m', rightStr:'—', rightClass:'', pct:0, barClass:'', descLeft:'', descRightTimes:'', descRightProgress:'' };

    function _rcSwitchPair(pair, btn) {
      _rcCurrentPair = pair;
      document.querySelectorAll('.rc-pair-tab').forEach(t => t.classList.remove('rc-pair-tab-active'));
      if (btn) btn.classList.add('rc-pair-tab-active');
      const c = _rcCache;
      const _body = el('rcBody');
      if (pair === 'times') {
        if (c.notStarted) {
          if (_body) { _body.classList.remove('ns-progress'); _body.classList.add('ns-times'); }
        } else {
          el('rcWorked').textContent = c.loginStr;
          el('rcWorked').style.color = (c.rightClass === 'muted' || c.rightClass === 'warn') ? 'var(--muted-fg)' : 'var(--foreground)';
        }
        el('rcTarget').textContent = c.isDone ? c.rightStr : c.logoutStr;
        el('rcTarget').style.color = c.isDone ? (c.rightClass === 'warn' ? 'var(--warning)' : 'var(--muted-fg)') : '';
        _rcSetDesc(c.descRightTimes);
      } else {
        if (c.notStarted) {
          if (_body) { _body.classList.remove('ns-times'); _body.classList.add('ns-progress'); }
          el('rcWorked').textContent = c.elapsedStr;
          el('rcWorked').style.color = 'var(--muted-fg)';
        } else {
          el('rcWorked').textContent = c.elapsedStr;
          el('rcWorked').style.color = (c.rightClass === 'muted' || c.rightClass === 'warn') ? 'var(--muted-fg)' : 'var(--foreground)';
        }
        el('rcTarget').textContent = c.rightStr;
        el('rcTarget').style.color = c.rightClass === 'ok' ? 'var(--success)' : c.rightClass === 'warn' ? 'var(--warning)' : c.rightClass === 'muted' ? 'var(--muted-fg)' : '';
        _rcSetDesc(c.descRightProgress);
      }
    }

    function _rcKpiTap(side, event) {
      if (side === 'left') {
        if (loginDate || _sessionAccSecs > 0) openLoginLogoutPicker(event);
      } else {
        // Target tap: open logout time picker on Times tab, duration picker on Progress tab
        if (_currentPairIs('times') && loginDate) {
          openLoginLogoutPicker(event);
          _tpSwitchTab('logout');
        } else {
          openDailyTargetPicker(event);
        }
      }
    }

    // otFrac: overtime progress toward Auto Stop (0..1), rendered as a translucent
    // overlay INSIDE the existing bar — the base fill/color is untouched by it.
    function _rcSetProgress(pct, barClass, otFrac) {
      const fill = el('rcProgressFill');
      const otFill = el('rcProgressFillOt');
      if (!fill) return;
      fill.style.width = Math.min(pct * 100, 100) + '%';
      fill.className = 'rc-progress-fill' + (barClass ? ' ' + barClass : '');
      if (otFill) otFill.style.width = Math.min(Math.max(otFrac || 0, 0), 1) * 100 + '%';
    }

    function _rcSetDesc(rightHtml) {
      const r = el('rcDescRight');
      if (r) r.innerHTML = rightHtml || '';
    }

    // "9h remaining" / "4h 12m remaining" / "48m remaining" — no leading 0h, no trailing 00m.
    // Uses floor (not round) throughout so the minute component can never carry to 60.
    function _rcRemainingFmt(secs) {
      const s = Math.max(0, Math.floor(secs));
      if (s < 60) return `${s}s`;
      const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
      if (h === 0) return `${m}m`;
      if (m === 0) return `${h}h`;
      return `${h}h ${m}m`;
    }

    function _rcTransitionToActive() {
      const body = el('rcBody');
      if (!body) return;
      // Apply transition first, then on next frame remove the ns-* class so the
      // browser has a "before" value to animate from.
      body.classList.add('rc-starting');
      requestAnimationFrame(() => {
        body.classList.remove('ns-times', 'ns-progress');
        setTimeout(() => body.classList.remove('rc-starting'), 420);
      });
    }

    function _rcShowPastMode(show) {
      if (show) {
        el('rcBody')?.classList.remove('ns-times', 'ns-progress', 'rc-starting');
        el('rcBody')?.classList.add('past-day');
        const _es = el('rcEmptyState'); if (_es) _es.style.display = 'none';
      } else {
        el('rcBody')?.classList.remove('past-day');
        const _kg = el('rcKpiGroup'); if (_kg) _kg.style.display = '';
        const _es = el('rcEmptyState'); if (_es) _es.style.display = 'none';
      }
      ['rcPairTabsRow','rcProgressTrack','rcDescRow'].forEach(id => {
        const e = el(id); if (e) e.style.display = show ? 'none' : '';
      });
      const _pt = el('rcPairTabs'); if (_pt) _pt.style.visibility = '';
    }

    // Not started, or the day is over: Time/Progress has nothing to switch, so
    // only the tabs hide. The row stays for the day-type button (Plan Your Day).
    function _rcHidePairTabs() {
      const row = el('rcPairTabsRow'); if (row) row.style.display = '';
      const tabs = el('rcPairTabs'); if (tabs) tabs.style.visibility = 'hidden';
    }

    // ── EMPTY STATE ────────────────────────────────────
    function renderEmptyState() {
      _tdSyncPlan(); // the day-type button follows today's type
      // Async sync callbacks (pullAll / pullSettings) fire regardless of which day is
      // selected — bail out when the user is browsing a past or future day so we don't
      // clobber their view or reset selectedDayKey back to today.
      if (selectedDayKey && selectedDayKey !== todayKey()) return;
      _hideSkeleton();
      // Weekend override — show last-week summary card instead of the normal empty state
      const wknd = isWeekend() && !loginDate;
      // Weekday Holiday / Leave / Half Day override — show planned-day UI instead of tracking UI
      const _todayOv = !loginDate && !wknd ? (dayLog(todayKey())?.override || null) : null;
      const _isPlannedDay = _todayOv === 'holiday' || _todayOv === 'leave' || _todayOv === 'halfday';
      el('rcBody')?.classList.toggle('weekend-mode', wknd || _isPlannedDay);
      if (wknd) {
        // Coming back from a past/future day leaves #rcBody.past-day set, which forces
        // align-items:center — that shrinks #weekendView to its content width and
        // centers it instead of stretching full-width, squeezing the card from both
        // sides. Must be cleared here since this branch returns before the shared
        // _rcShowPastMode(false) call below ever runs.
        _rcShowPastMode(false);
        selectedDayKey = todayKey();
        renderWeekendState(todayKey(), 'weekend');
        _updateDayNavBtns();
        return;
      }
      if (_isPlannedDay) {
        _rcShowPastMode(false); // same past-day-class leak as the weekend branch above
        selectedDayKey = todayKey();
        _setShiftCtaVisible(_todayOv === 'halfday');
        el('resultCard').style.display = '';
        renderWeekendState(todayKey(), _todayOv);
        _updateDayNavBtns();
        return;
      }
      _rcShowPastMode(false);
      el('rcBody')?.classList.remove('ns-times', 'ns-progress', 'rc-starting');
      const eff = effSecs();
      const _tkE = todayKey(), _logE = dayLog(_tkE) || {};

      // If session was ended today (no active session but hours logged), show them
      const endedSecs = _sessionAccSecs > 0
        ? _sessionAccSecs
        : (_logE.hoursWorked && _logE.checkoutDisplay ? Math.round(_logE.hoursWorked * 3600) : 0);

      if (endedSecs > 0) {
        // The day is over — target reached or not, and however it ended (user hit End,
        // checked out, paused, or auto-stopped). Live KPIs and a progress bar describe
        // an in-flight session, so none of that is actionable any more. Replace the
        // whole tracker with the same static summary a past day shows: times worked,
        // duration, how it landed against target, and a way to correct it.
        const _loginStr  = _loginDisplayFromLog(_logE) || '—';
        const _logoutStr = _checkoutDisplayFromLog(_logE);
        _rcHidePairTabs();
        const _kpiGroupE = el('rcKpiGroup');    if (_kpiGroupE) _kpiGroupE.style.display = 'none';
        // eff === 0 means the weekly target was already met, so there's no meaningful
        // per-day target to compare against — pass null to suppress the verdict line.
        el('rcToday').style.display = '';
        el('rcToday').innerHTML = _pastDayKpiHtml(_loginStr, _logoutStr, endedSecs, eff > 0 ? eff : null);
        el('stayHint').style.display = 'none';
        el('otBanner').classList.remove('show');
        el('doneBanner').classList.remove('show');
        // Keep the auto-stop banner up — it's the only thing explaining why the day
        // ended on its own. (Previously cleared unconditionally here, which meant the
        // banner init/doAutoStop had just shown was wiped on the very next render.)
        if (!autoStopped) el('autostopBanner').classList.remove('show');
        return;
      }

      // Not started — calm empty state instead of KPIs/progress bar. Current Time now
      // lives in the persistent header clock, so no in-card clock is needed here.
      const _projFrom = _previewStartAt ? _previewStartAt.getTime() : Date.now();
      const _projLogout = eff > 0 ? short(new Date(_projFrom + eff * 1000)) : '—';
      _rcCache = { loginStr: '—', logoutStr: _projLogout, elapsedStr: '0m',
        rightStr: dur(eff), rightClass: 'muted', pct: 0, barClass: '',
        descLeft: '', descRightTimes: '', descRightProgress: '', notStarted: true };
      const _body = el('rcBody');
      if (_body) _body.classList.remove('ns-times', 'ns-progress', 'rc-starting');
      _rcHidePairTabs();
      const _kpiGroup = el('rcKpiGroup'); if (_kpiGroup) _kpiGroup.style.display = 'none';
      const _emptyEl = el('rcEmptyState');
      if (_emptyEl) {
        _emptyEl.style.display = 'flex';
        const _leaveTimeEl = el('rcEmptyLeaveTime');
        if (_leaveTimeEl) _leaveTimeEl.textContent = _projLogout;
      }
      _setTodayDateChip();
      el('rcToday').innerHTML = ''; el('rcToday').style.display = 'none';
      el('stayHint').style.display = 'none';
      el('otBanner').classList.remove('show');
      el('doneBanner').classList.remove('show');
      el('autostopBanner').classList.remove('show');
    }

    function _currentPairIs(pair) { return _rcCurrentPair === pair; }

    // ── WEEKEND STATE ─────────────────────────────────
    function isWeekend() {
      const dow = nowTz().getDay(); // 0=Sun, 6=Sat
      if (dow === 0) return true;
      if (dow === 6 && (cfg().workDays || 5) < 6) return true;
      return false;
    }

    function _wkndDayData(lastWk) {
      const c = cfg(), dailySecs = c.dailyH * 3600, tk = todayKey();
      return lastWk.map(d => {
        // Future days and today-before-any-work must read as empty — never show stale Supabase data
        const isFuture        = d.key > tk;
        const isUnworkedToday = d.key === tk && !loginDate && !dayLog(tk)?.checkoutDisplay;
        const log = (isFuture || isUnworkedToday) ? {} : (dayLog(d.key) || {});
        const ov = log.override;
        const worked = (log.hoursWorked || 0) * 3600;
        const target = ov === 'halfday' ? dailySecs / 2 : dailySecs;
        const diff   = worked - target;
        const hasLog = log.hoursWorked != null && (log.hoursWorked > 0 || ov === 'holiday' || ov === 'leave');

        let attendance = '—';
        if (ov === 'leave')    attendance = 'Leave';
        else if (ov === 'holiday') attendance = 'Holiday';
        else if (ov === 'halfday') attendance = 'Half Day';
        else if (hasLog)       attendance = 'Full Day';

        const skipPenalty = ov === 'holiday' || ov === 'leave';
        let penalty = '—';
        if (!skipPenalty && hasLog) penalty = diff < -300 ? '−' + dur(Math.abs(diff)) : '—';

        let surplus = '—';
        if (!skipPenalty && hasLog && diff > 60) surplus = '+' + dur(diff);

        return {
          day:        d.name,
          entry:      log.loginDisplay    || '—',
          exit:       _checkoutDisplayFromLog(log),
          attendance,
          penalty,
          totalHours: (hasLog && !skipPenalty) ? dur(worked) : '—',
          surplus,
          worked:     (!skipPenalty && hasLog) ? worked : 0,
          surplusSecs:(!skipPenalty && hasLog && diff > 60) ? diff : 0,
          isPenalty:  (!skipPenalty && hasLog && diff < -300),
          // Raw values for the Stats table (sorting, chips). The text fields above stay as they were.
          date:       d.date,
          diffSecs:   (!skipPenalty && hasLog) ? diff : 0,
          autostopped: !!log.autostopped && hasLog,
          missing:    !isFuture && d.key < tk && !hasLog && !ov,
        };
      });
    }

    // ── Badge helpers ────────────────────────────────────────────────────────
    // SVG icons for each badge type (22×22, using design token colours)
    const _BADGE_ICONS = {
      shield:   `<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 3L4 7v5c0 5.25 3.5 9.74 8 10.74C16.5 21.74 20 17.25 20 12V7L12 3z" fill="var(--blue-bg)" stroke="var(--blue)" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
      lock:     `<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="5" y="11" width="14" height="10" rx="2" fill="var(--success-bg)" stroke="var(--success)" stroke-width="1.8"/><path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="var(--success)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
      sparkle:  `<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><polygon points="12,2 14.4,8.8 21,9.3 16.2,13.7 17.6,20.3 12,16.9 6.4,20.3 7.8,13.7 3,9.3 9.6,8.8" fill="var(--warning-bg)" stroke="var(--warning)" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
      zap:      `<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><polygon points="13,2 4,14 11,14 10,22 20,10 13,10" fill="var(--warning-bg)" stroke="var(--warning)" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
      target:   `<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" fill="var(--blue-bg)" stroke="var(--blue)" stroke-width="1.8"/><circle cx="12" cy="12" r="4.5" stroke="var(--blue)" stroke-width="1.5" fill="none"/><circle cx="12" cy="12" r="1.5" fill="var(--blue)"/></svg>`,
      droplet:  `<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 2C8.5 7.5 5 11 5 15a7 7 0 0 0 14 0c0-4-3.5-7.5-7-13z" fill="var(--blue-bg)" stroke="var(--blue)" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
      scale:    `<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><line x1="12" y1="3" x2="12" y2="21" stroke="var(--muted-fg)" stroke-width="1.8" stroke-linecap="round"/><path d="M5 7l4 9H1L5 7z" fill="var(--muted)" stroke="var(--muted-fg)" stroke-width="1.6" stroke-linejoin="round"/><path d="M19 7l4 9h-8l4-9z" fill="var(--muted)" stroke="var(--muted-fg)" stroke-width="1.6" stroke-linejoin="round"/><line x1="3" y1="7" x2="21" y2="7" stroke="var(--muted-fg)" stroke-width="1.6" stroke-linecap="round"/></svg>`,
      trending: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><polyline points="22,6 13,15 8.5,10.5 2,17" stroke="var(--success)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><polyline points="17,6 22,6 22,11" stroke="var(--success)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    };

    function _computeWeekBadge(rows, totalSurplusSecs) {
      const penaltyDays = rows.filter(r => r.isPenalty).length;
      const daysWorked  = rows.filter(r => r.worked > 0).length;
      const fri         = rows[4];
      const friFree     = fri && (fri.attendance === 'Leave' || fri.attendance === 'Holiday');

      if (friFree && penaltyDays === 0 && daysWorked >= 3)
        return { icon: _BADGE_ICONS.shield, title: 'Friday Saver',
                 subtitle: 'Protected your Friday leave' };
      if (daysWorked >= 4 && penaltyDays === 0 && totalSurplusSecs > 900)
        return { icon: _BADGE_ICONS.lock, title: 'Locked In',
                 subtitle: 'Hit targets every day this week' };
      if (penaltyDays === 0 && daysWorked >= 3)
        return { icon: _BADGE_ICONS.sparkle, title: 'Clean Week',
                 subtitle: 'No penalties this week' };
      if (totalSurplusSecs > 5400 && penaltyDays <= 1)
        return { icon: _BADGE_ICONS.zap, title: 'Early Exit',
                 subtitle: 'Surplus hours banked smartly' };
      if (penaltyDays === 0 && daysWorked >= 2)
        return { icon: _BADGE_ICONS.target, title: 'On Time',
                 subtitle: 'Consistent schedule this week' };
      if (totalSurplusSecs === 0 && daysWorked >= 3)
        return { icon: _BADGE_ICONS.droplet, title: 'Zero Spill',
                 subtitle: 'No overtime this week' };
      if (daysWorked >= 3 && penaltyDays <= 1)
        return { icon: _BADGE_ICONS.scale, title: 'Balanced',
                 subtitle: 'Stable hours across the week' };
      if (daysWorked > 0)
        return { icon: _BADGE_ICONS.trending, title: 'Recovering',
                 subtitle: 'Getting back on track' };
      return null; // no data — hide card
    }

    function _badgeDayCircle(row, dailySecs) {
      const { day, worked, isPenalty, attendance, totalHours } = row;
      const isLeave   = attendance === 'Leave' || attendance === 'Holiday';
      const isHalfDay = attendance === 'Half Day';
      const hasWork   = worked > 0;
      const CX = 16, CY = 16, R = 12, SW = 2.5;
      const circ = 2 * Math.PI * R; // ~75.4

      let inner = '';
      if (isLeave) {
        inner = `<circle cx="${CX}" cy="${CY}" r="${R}" fill="var(--blue-bg)" stroke="var(--blue)" stroke-width="1.5"/>` +
                `<path d="M${CX-4} ${CY}h8" stroke="var(--blue)" stroke-width="1.8" stroke-linecap="round"/>`;
      } else if (hasWork && !isPenalty) {
        inner = `<circle cx="${CX}" cy="${CY}" r="${R}" fill="var(--success-bg)" stroke="var(--success)" stroke-width="1.5"/>` +
                `<path d="M11 16.5l3 3 7-7" stroke="var(--success)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
      } else if (hasWork && isPenalty) {
        const pct = Math.min(0.97, worked / dailySecs);
        inner = `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="var(--border)" stroke-width="${SW}"/>` +
                `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="var(--warning)" stroke-width="${SW}"` +
                ` stroke-dasharray="${(pct * circ).toFixed(1)} ${circ.toFixed(1)}" stroke-linecap="round"` +
                ` transform="rotate(-90 ${CX} ${CY})"/>`;
      } else if (isHalfDay) {
        inner = `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="var(--border)" stroke-width="${SW}"/>` +
                `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="var(--muted-fg)" stroke-width="${SW}"` +
                ` stroke-dasharray="${(0.5 * circ).toFixed(1)} ${circ.toFixed(1)}" stroke-linecap="round"` +
                ` transform="rotate(-90 ${CX} ${CY})"/>`;
      } else {
        inner = `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="var(--border)" stroke-width="${SW}"/>`;
      }
      const hrs = (totalHours && totalHours !== '—') ? totalHours : '–';
      return `<div class="badge-day">` +
               `<div class="badge-day-name">${day.slice(0,3)}</div>` +
               `<svg width="32" height="32" viewBox="0 0 32 32" fill="none">${inner}</svg>` +
               `<div class="badge-day-hrs">${hrs}</div>` +
             `</div>`;
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Note-field title per info type (Weekend / Holiday / Leave).
    function _infoNoteTitle(type) {
      if (type === 'holiday') return 'What was it?';
      if (type === 'leave')   return 'What made you take a leave?';
      if (type === 'halfday') return 'Any notes?';
      return 'What did you do?'; // weekend
    }
    // Auto-grow the note field: one line by default, up to 5 lines, then scroll.
    function _wkndNoteAutoGrow(ta) {
      if (!ta) return;
      const cs = getComputedStyle(ta);
      const lh = parseFloat(cs.lineHeight) || (parseFloat(cs.fontSize) * 1.4);
      const padV  = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      const bordV = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
      const maxH  = Math.round(lh * 5 + padV + bordV); // cap at ~5 lines
      ta.style.height = 'auto';
      const needed = ta.scrollHeight + bordV; // scrollHeight is content+padding; add border (border-box)
      ta.style.height = Math.min(needed, maxH) + 'px';
      ta.style.overflowY = needed > maxH ? 'auto' : 'hidden';
    }
    // Enter submits the note; Shift+Enter inserts a line break.
    function _wkndNoteKey(e, ta) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        _submitWkndNote();
      }
    }
    function _submitWkndNote() {
      const noteEl = el('wkndNote');
      if (!noteEl) return;
      const val = noteEl.value.trim();
      if (!val) { noteEl.focus(); return; }
      const key = noteEl.dataset.key;
      saveWkndNote(val);
      // Fade the input out, then render the dashed card with a fade-in
      const noteWrap = el('wkndNoteWrap');
      const showCard = () => {
        renderWeekendState(key, 'weekend');
        const card = el('wkndOverrideInfoCard');
        if (card) { card.classList.remove('wknd-swap-in'); void card.offsetWidth; card.classList.add('wknd-swap-in'); }
      };
      if (noteWrap) {
        noteWrap.classList.add('wknd-swap-out');
        setTimeout(() => { noteWrap.classList.remove('wknd-swap-out'); showCard(); }, 160);
      } else { showCard(); }
    }
    function _editWkndNote(key) {
      openDayEditModal(key, true, true);
    }
    // Week offset of a date key relative to the current week (0 = this week).
    function _weekOffsetForKey(key) {
      const d = new Date(key + 'T12:00');
      const dow = d.getDay();
      const mon = new Date(d); mon.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow)); mon.setHours(0,0,0,0);
      const today = new Date(); today.setHours(0,0,0,0);
      const todayDow = today.getDay();
      const thisMon = new Date(today); thisMon.setDate(today.getDate() + (todayDow === 0 ? -6 : 1 - todayDow));
      return Math.round((mon - thisMon) / (7 * 86400000));
    }
    // Title + subtitle per info type and tense (past / present / future).
    function _infoTitles(type, when) {
      const sunday = (cfg().workDays || 5) >= 6; // 6-day week → only Sunday is off
      if (type === 'holiday') {
        return { title: 'Holiday', sub: 'No work on this day.' };
      }
      if (type === 'leave') {
        return { title: 'On Leave', sub: 'A full day off.' };
      }
      if (type === 'halfday') {
        return { title: 'Half Day', sub: 'Working a partial day.' };
      }
      // weekend
      return { title: sunday ? 'Sunday' : 'Weekend', sub: "You're done with the week." };
    }
    function saveWkndNote(val) {
      const k = el('wkndNote')?.dataset.key;
      if (!k) return;
      const log = dayLog(k) || {};
      const v = (val || '').trim();
      if (v === (log.note || '')) return; // no change → skip write/sync
      const ts = new Date().toISOString();
      _setNoteDirty(k); // guard against pullAll race before push lands
      if (v) { saveDayLogAndSync(k, { ...log, note: v, lastUpdated: ts }); }
      else { const u = { ...log }; delete u.note; u.lastUpdated = ts; saveDayLogAndSync(k, u); }
    }


    function renderWeekendState(key, type) {
      type = type || 'weekend';
      const tk = todayKey();
      const isWkndSlot = !key || key === '__wknd__';
      const noteKey = isWkndSlot ? tk : key;
      // Tense: a whole weekend (both Sat & Sun) shares the current week's tense, so
      // "tomorrow's Sunday" reads as the current weekend, not an upcoming one. Holiday
      // and Leave stay day-based (each is a single specific day).
      let when;
      if (isWkndSlot) {
        when = 'present';
      } else if (type === 'weekend') {
        const woff = _weekOffsetForKey(key);
        when = woff < 0 ? 'past' : woff > 0 ? 'future' : 'present';
      } else {
        when = key < tk ? 'past' : key > tk ? 'future' : 'present';
      }

      // ── Title / subtitle / note (varies by Weekend vs Holiday vs Leave) ──
      const ti = _infoTitles(type, when);
      if (el('wkndPageTitle'))    el('wkndPageTitle').textContent = ti.title;
      if (el('wkndPageSubtitle')) el('wkndPageSubtitle').textContent = ti.sub;
      if (el('wkndNoteTitle'))    el('wkndNoteTitle').textContent = _infoNoteTitle(type);
      // ── Info card + note ────────────────────────────────────────────────
      const _infoCard    = el('wkndOverrideInfoCard');
      const _isOverride  = type !== 'weekend';
      // Weekend with a saved note shows a dashed card like holiday/leave
      const _hasWkndNote = !_isOverride && !!(dayLog(noteKey)?.note?.trim());

      // Note textarea: hidden for overrides or when weekend note already saved
      const _noteWrap = el('wkndNoteWrap');
      if (_noteWrap) _noteWrap.style.display = (_isOverride || _hasWkndNote) ? 'none' : '';

      // Override mode: note textarea fills remaining card height — skip auto-grow
      const _wkndView = el('weekendView');
      if (_wkndView) _wkndView.classList.toggle('override-mode', type !== 'weekend');
      const noteEl = el('wkndNote');
      if (noteEl) {
        noteEl.dataset.key = noteKey;
        noteEl.value = dayLog(noteKey)?.note || '';
        if (type === 'weekend') _wkndNoteAutoGrow(noteEl);
        else noteEl.style.height = ''; // let flex handle height
      }

      // Subtitle: hidden for overrides and for weekends with a saved note
      const _subtitleEl = el('wkndPageSubtitle');
      if (_subtitleEl) _subtitleEl.style.display = (_isOverride || _hasWkndNote) ? 'none' : '';

      // Title: "Weekend" when note card is showing, otherwise normal greeting
      if (el('wkndPageTitle')) el('wkndPageTitle').textContent = _hasWkndNote ? 'Weekend' : ti.title;

      // Timing line (halfday only)
      const _timingEl = el('wkndCardTiming');
      if (_timingEl) {
        if (_isOverride && type === 'halfday') {
          const _ld = dayLog(key);
          const _sd = getShiftDefaults();
          const _login  = _ld?.loginDisplay    || _sd.start || '';
          const _logout = _ld?.checkoutDisplay || _sd.end   || '';
          const _t = [_login, _logout].filter(Boolean).join(' → ');
          _timingEl.textContent = _t;
          _timingEl.style.display = _t ? '' : 'none';
        } else {
          _timingEl.style.display = 'none';
        }
      }

      // Note text inside card (for override types and weekends with a saved note)
      const _cardNoteEl = el('wkndCardNote');
      if (_cardNoteEl) {
        const _noteText = _isOverride ? (dayLog(key)?.note || '') : (dayLog(noteKey)?.note?.trim() || '');
        if (_hasWkndNote) {
          _cardNoteEl.textContent = _noteText;
          _cardNoteEl.style.display = '';
        } else if (_isOverride && _noteText) {
          _cardNoteEl.textContent = _noteText;
          _cardNoteEl.style.color = '';
          _cardNoteEl.style.opacity = '';
          _cardNoteEl.style.display = '';
        } else if (_isOverride) {
          _cardNoteEl.innerHTML = `<span style="display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--muted-fg);opacity:.55;cursor:pointer" data-on-mouseover="h745d1ed038" data-on-mouseout="h9ca1463baf"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>add description</span>`;
          const _ph = _cardNoteEl.querySelector('span');
          if (_ph) _ph.onclick = (e) => { e.stopPropagation(); openDayEditModal(key, true); };
          _cardNoteEl.style.color = '';
          _cardNoteEl.style.opacity = '';
          _cardNoteEl.style.display = '';
        } else {
          _cardNoteEl.style.display = 'none';
        }
      }

      // Dashed + clickable for overrides and weekends with a saved note
      const _showDashedCard = _isOverride || _hasWkndNote;
      if (_infoCard) {
        _infoCard.classList.toggle('override-info-editable', _showDashedCard);
        _infoCard.style.padding = _showDashedCard ? '' : '8px 0 18px';
        _infoCard.onclick = _isOverride ? () => openDayEditModal(key) : (_hasWkndNote ? () => _editWkndNote(noteKey) : null);
      }

      // Stats + badge only shown on actual weekend days, not on weekday overrides
      const _isWeekendType = type === 'weekend';
      const statsSection = el('wkndStatsSection');
      if (statsSection) statsSection.style.display = _isWeekendType ? '' : 'none';

      // For Holiday / Leave: hide WH stat rows (rc-numbers, progress bar, IO cards).
      // Half Day keeps them visible — user may still work a partial day.
      const _hideStats = type === 'holiday' || type === 'leave';
      ['rcNumbers', 'rcToday', 'stayHint', 'otBanner', 'doneBanner', 'autostopBanner'].forEach(id => {
        const _e = el(id);
        if (_e) _e.style.display = _hideStats ? 'none' : '';
      });
      // Also hide the rc-numbers wrapper (uses class, not id)
      const _rcNum = document.querySelector('.rc-numbers');
      if (_rcNum) _rcNum.style.display = _hideStats ? 'none' : '';

      const badgeCard = el('wkndBadgeCard');
      if (!_isWeekendType) {
        if (badgeCard) badgeCard.style.display = 'none';
      } else {
        const wk = week(daySelectorWeekOffset);
        const mon = wk[0].date, fri = wk[wk.length - 1].date;
        const rows = _wkndDayData(wk);
        const totalSurplus = rows.reduce((s, r) => s + r.surplusSecs, 0);

        const badge = _computeWeekBadge(rows, totalSurplus);
        if (badge && badgeCard) {
          el('wkndBadgeIcon').innerHTML      = badge.icon;
          el('wkndBadgeTitle').textContent   = badge.title;
          el('wkndBadgeSubtitle').textContent= badge.subtitle;
          const c = cfg(), dailySecs = c.dailyH * 3600;
          const daysEl = el('wkndBadgeDays');
          if (daysEl) daysEl.innerHTML = rows.map(r => _badgeDayCircle(r, dailySecs)).join('');
          badgeCard.style.display = '';
        } else if (badgeCard) {
          badgeCard.style.display = 'none';
        }
      }
    }

    // Renders an inline attendance chip for the weekly report table
    function _attChip(att) {
      const MAP = {
        'Full Day': { bg: 'var(--muted)',              fg: 'var(--muted-fg)', label: 'Full Day'  },
        'Half Day': { bg: 'rgba(14,165,233,.12)',       fg: '#0ea5e9',         label: 'Half Day'  },
        'Leave':    { bg: 'rgba(59,130,246,.12)',       fg: '#3b82f6',         label: 'On Leave'  },
        'Holiday':  { bg: 'rgba(168,85,247,.12)',       fg: '#a855f7',         label: 'Holiday'   },
      };
      const c = MAP[att];
      if (!c) return `<span style="color:var(--muted-fg)">—</span>`;
      return `<span style="display:inline-flex;align-items:center;height:20px;padding:0 8px;` +
             `border-radius:100px;font-size:10px;font-weight:600;letter-spacing:.02em;` +
             `background:${c.bg};color:${c.fg};white-space:nowrap">${c.label}</span>`;
    }

    // ── REPORT (Weekly / Monthly) ────────────────────────────────────────────
    let _reportMode = 'week';        // 'week' | 'month'
    let _reportWeekOffset = 0;
    let _reportMonthOffset = 0;

    const _DAY_ABBR = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

    // Working days in the last 30 calendar days, ending today (inclusive).
    // Date numbers are zero-padded so they line up in the same column.
    function last30WorkDays() {
      const now = new Date();
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const start = new Date(end); start.setDate(end.getDate() - 29); // 30 days inclusive
      const workCount = cfg().workDays === 6 ? 6 : 5;
      const out = [];
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dow = d.getDay();
        if (dow < 1 || dow > workCount) continue; // skip weekends / off-days
        const date = new Date(d);
        // Number first + zero-padded → dates line up in one column when scanning
        out.push({ key: dateKey(date), name: `${String(date.getDate()).padStart(2,'0')} ${_DAY_ABBR[dow]}`, date });
      }
      return out;
    }

    // Split a chronological day list into per-calendar-month groups (order preserved).
    function _groupByMonth(daysArr) {
      const groups = [];
      let cur = null;
      for (const d of daysArr) {
        const y = d.date.getFullYear(), m = d.date.getMonth();
        if (!cur || cur.year !== y || cur.month !== m) {
          cur = { year: y, month: m, label: `${MONTHS[m]} ${y}`, days: [] };
          groups.push(cur);
        }
        cur.days.push(d);
      }
      return groups;
    }

    // Build report rows for any list of days; future days are blanked out.
    function _buildReportRows(daysArr) {
      const tk = todayKey();
      const raw = _wkndDayData(daysArr);
      return raw.map((r, i) => {
        if (daysArr[i] && daysArr[i].key > tk) {
          return { ...r, entry:'—', exit:'—', attendance:'—', penalty:'—',
                   totalHours:'—', surplus:'—', worked:0, surplusSecs:0, isPenalty:false };
        }
        return r;
      });
    }

    // Resolve the current report context (days, labels, file name) for the active mode.
    function _reportContext() {
      if (_reportMode === 'month') {
        const daysArr = last30WorkDays();
        const now = new Date();
        const start = daysArr.length ? daysArr[0].date : now;
        const end   = daysArr.length ? daysArr[daysArr.length - 1].date : now;
        const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
        const label = sameMonth
          ? `${MONTHS[start.getMonth()]} ${start.getDate()} – ${end.getDate()}, ${end.getFullYear()}`
          : `${MONTHS[start.getMonth()]} ${start.getDate()} – ${MONTHS[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
        return { daysArr, grouped: true, label, pdfRange: label, pdfPeriod: '30 DAYS',
                 totalLabel: 'Total Work Hours',
                 fileBase: `30day-report-${dateKey(end)}` };
      }
      const wk = week(_reportWeekOffset);
      const mon = wk[0].date, fri = wk[wk.length - 1].date;
      return { daysArr: wk, grouped: false,
               label: `${MONTHS[mon.getMonth()]} ${mon.getDate()} to ${MONTHS[fri.getMonth()]} ${fri.getDate()}, ${fri.getFullYear()}`,
               pdfRange: `${MONTHS[mon.getMonth()]} ${mon.getDate()} – ${MONTHS[fri.getMonth()]} ${fri.getDate()}, ${fri.getFullYear()}`,
               pdfPeriod: '7 DAYS', totalLabel: 'Weekly Work Hours',
               fileBase: `week-report-${mon.getFullYear()}-${String(mon.getMonth()+1).padStart(2,'0')}-${String(mon.getDate()).padStart(2,'0')}` };
    }

    // ── Stats table (uiarc sortable data table) ───────────────────────────────
    // Click a header to sort: numbers go largest first → smallest first → off,
    // text A→Z → Z→A → off. Chips use the week card's colours.
    let _rptSort = { key: null, dir: 'asc' };
    const _RPT_COLS = [
      { key: 'day',  label: 'Day' },
      { key: 'time', label: 'Time' },
      { key: 'att',  label: 'Attendance' },
      { key: 'pen',  label: 'Penalty', num: true },
      { key: 'hrs',  label: 'Hours',   num: true },
      { key: 'sur',  label: null,      num: true },   // "Surplus" or "Overtime"
    ];
    const _rptFirstDir = key => (key === 'pen' || key === 'hrs' || key === 'sur') ? 'desc' : 'asc';
    // One header click: first press sorts, second flips, third clears.
    function rptNextSort(cur, key) {
      if (cur.key !== key) return { key, dir: _rptFirstDir(key) };
      if (cur.dir === _rptFirstDir(key)) return { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' };
      return { key: null, dir: 'asc' };
    }
    // Attendance label + tone, matching the week card's day types.
    function rptAttendance(r) {
      if (r.attendance === 'Holiday')  return ['Holiday', 'orchid'];
      if (r.attendance === 'Leave')    return ['On leave', 'blue'];
      if (r.attendance === 'Half Day') return ['Half day', 'teal'];
      if (r.autostopped)               return ['Auto-stopped', 'warning'];
      if (r.attendance === 'Full Day') return ['Full day', 'muted-fg'];
      if (r.missing)                   return ['Missing', 'destructive'];
      return null;
    }
    function _rptTimeMins(t) {
      const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)?/i.exec(t || '');
      if (!m) return Infinity;
      let h = +m[1] % 12; if ((m[3] || '').toUpperCase() === 'PM') h += 12;
      return h * 60 + (+m[2]);
    }
    // Returns row indexes in display order for the given sort.
    function rptOrder(rows, sort) {
      const idx = rows.map((_, i) => i);
      if (!sort.key) return idx;
      const val = i => {
        const r = rows[i];
        switch (sort.key) {
          case 'day':  return i;
          case 'time': return r.entry && r.entry !== '—' ? _rptTimeMins(r.entry) : Infinity;
          case 'att':  { const a = rptAttendance(r); return a ? a[0] : '\uffff'; }
          case 'pen':  return r.isPenalty ? -r.diffSecs : 0;
          case 'hrs':  return r.worked || 0;
          case 'sur':  return r.surplusSecs || 0;
        }
        return 0;
      };
      const sign = sort.dir === 'asc' ? 1 : -1;
      return idx.sort((a, b) => {
        const x = val(a), y = val(b);
        return x < y ? -sign : x > y ? sign : a - b; // ties stay in date order
      });
    }

    function _renderReport(animate) {
      const ctx = _reportContext();
      const daysArr = ctx.daysArr, tk = todayKey();
      el('weekReportRange').textContent = ctx.label;
      const rows = _buildReportRows(daysArr);
      const totalWorked  = rows.reduce((s, r) => s + r.worked, 0);
      const totalSurplus = rows.reduce((s, r) => s + r.surplusSecs, 0);
      const totalPenalty = rows.reduce((s, r) => s + (r.isPenalty ? -r.diffSecs : 0), 0);
      const sort = _rptSort, sorted = k => sort.key === k ? ' data-sorted' : '';
      const arrow = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg>';

      let html = '<thead><tr>' + _RPT_COLS.map(c => {
        const label = c.label || _surplusLabel();
        const on = sort.key === c.key;
        return `<th${c.num ? ' data-num' : ''}${on ? ` data-sorted data-dir="${sort.dir}"` : ''} aria-sort="${on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}">`
             + `<button type="button" class="rpt-sort" data-key="${c.key}">${label}<span class="rpt-arrow">${arrow}</span></button></th>`;
      }).join('') + '</tr></thead><tbody>';

      let curMonthKey = null, n = 0;
      for (const i of rptOrder(rows, sort)) {
        const r = rows[i];
        const dDate = r.date || daysArr[i]?.date;
        // Month sub-headings only in the 30-day view, and only in date order.
        if (ctx.grouped && !sort.key && dDate) {
          const mk = `${dDate.getFullYear()}-${dDate.getMonth()}`;
          if (mk !== curMonthKey) {
            curMonthKey = mk;
            html += `<tr class="rpt-sub"><td colspan="6">${MONTHS[dDate.getMonth()]} ${dDate.getFullYear()}</td></tr>`;
          }
        }
        const isFuture = daysArr[i] && daysArr[i].key > tk;
        const att = isFuture ? null : rptAttendance(r);
        // Times come from saved entries (also from restored backups), so escape them.
        const time = r.entry && r.entry !== '—' ? `${_escHtml(r.entry)} – ${r.exit && r.exit !== '—' ? _escHtml(r.exit) : 'now'}` : '—';
        const none = '<span class="rpt-none">—</span>';
        html += `<tr class="${isFuture ? 'is-future' : ''}" style="--n:${Math.min(n++, 14)}">`
          + `<td class="rpt-day"${sorted('day')}><b>${dDate ? _DAY_ABBR[dDate.getDay()] : r.day.slice(0, 3)}</b>${dDate ? `<span>${MONTHS[dDate.getMonth()].slice(0, 3)} ${dDate.getDate()}</span>` : ''}</td>`
          + `<td class="rpt-dim"${sorted('time')}>${time}</td>`
          + `<td${sorted('att')}>${att ? `<span class="rpt-att" style="--k:var(--${att[1]})">${att[0]}</span>` : none}</td>`
          + `<td data-num${sorted('pen')}>${r.isPenalty ? `<span class="wk-chip is-short">${wkSigned(r.diffSecs)}</span>` : none}</td>`
          + `<td data-num${sorted('hrs')}>${r.worked ? r.totalHours : none}</td>`
          + `<td data-num${sorted('sur')}>${r.surplusSecs > 0 ? `<span class="wk-chip is-over">${wkSigned(r.surplusSecs)}</span>` : none}</td></tr>`;
      }
      html += `</tbody><tfoot><tr><td colspan="3">${ctx.grouped ? '30-day total' : 'Week total'}</td>`
        + `<td data-num>${totalPenalty ? `<span class="rpt-tot-short">${wkSigned(-totalPenalty)}</span>` : '<span class="rpt-none">—</span>'}</td>`
        + `<td data-num>${totalWorked > 0 ? dur(totalWorked) : '—'}</td>`
        + `<td data-num>${totalSurplus > 0 ? `<span class="rpt-tot-over">${wkSigned(totalSurplus)}</span>` : '<span class="rpt-none">—</span>'}</td></tr></tfoot>`;

      const table = el('weekReportTable');
      table.innerHTML = html;
      table.classList.remove('is-anim');
      if (animate) { void table.offsetWidth; table.classList.add('is-anim'); }
      const count = el('wrCount');
      if (count) {
        const col = _RPT_COLS.find(c => c.key === sort.key);
        count.textContent = `${rows.length} days` + (col ? ` · sorted by ${(col.label || _surplusLabel()).toLowerCase()}` : '');
      }
    }

    // Animate the report dialog's height between the old and new content sizes.
    function _animateReportResize(renderFn) {
      const dialog = el('weekReportOverlay')?.querySelector('.dialog');
      if (!dialog || !dialog.offsetHeight) { renderFn(); return; } // hidden → no animation
      const startH = dialog.offsetHeight;
      renderFn();
      const endH = dialog.offsetHeight;
      if (startH === endH) return;
      dialog.style.height = startH + 'px';
      dialog.getBoundingClientRect();              // force reflow before transition
      dialog.style.transition = 'height .3s cubic-bezier(.4,0,.2,1)';
      dialog.style.height = endH + 'px';
      const done = () => { dialog.style.height = ''; dialog.style.transition = ''; dialog.removeEventListener('transitionend', done); };
      dialog.addEventListener('transitionend', done);
      setTimeout(done, 360);                       // fallback if transitionend doesn't fire
    }

    function _reportSetMode(mode) {
      _reportMode = mode;
      _rptSort = { key: null, dir: 'asc' }; // each tab opens in date order
      el('reportTabWeek')?.classList.toggle('active', mode === 'week');
      el('reportTabMonth')?.classList.toggle('active', mode === 'month');
      _animateReportResize(_renderReport);
    }

    function openWeekReport(weekOffset) {
      _flushLiveLog(); // today's row reads the saved entry
      _rptSort = { key: null, dir: 'asc' };
      _reportWeekOffset = typeof weekOffset === 'number' ? weekOffset : daySelectorWeekOffset;
      // Default the Monthly tab to the month containing this week's Monday.
      const wkMon = week(_reportWeekOffset)[0].date, now = new Date();
      _reportMonthOffset = (wkMon.getFullYear() - now.getFullYear()) * 12 + (wkMon.getMonth() - now.getMonth());
      _reportSetMode('week');
      el('weekReportOverlay').classList.add('open');
    }

    // Header clicks sort the Stats table (one listener; the table is re-rendered).
    el('weekReportTable')?.addEventListener('click', e => {
      const b = e.target.closest('.rpt-sort');
      if (!b) return;
      _rptSort = rptNextSort(_rptSort, b.dataset.key);
      _renderReport(true);
      el('weekReportTable').querySelector(`.rpt-sort[data-key="${b.dataset.key}"]`)?.focus();
    });

    function closeWeekReport() {
      el('weekReportOverlay').classList.remove('open');
    }

    // Helper: load the app logo as a PNG data-URL for jsPDF.
    // Draws /icons/brand-light.svg onto an offscreen canvas; calls back with data-URL or null.
    function _loadLogoDataUrl(cb) {
      try {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          try {
            const SIZE = 96; // render 2× for crispness
            const cvs = document.createElement('canvas');
            cvs.width = SIZE; cvs.height = SIZE;
            cvs.getContext('2d').drawImage(img, 0, 0, SIZE, SIZE);
            cb(cvs.toDataURL('image/png'));
          } catch(e) { cb(null); }
        };
        img.onerror = () => cb(null);
        img.src = window.location.origin + '/icons/brand-light.svg';
      } catch(e) { cb(null); }
    }

    // Export shows its state: "Exporting…" with the button disabled (no
    // duplicate files from repeat clicks), then where the file went, or an error
    // with Try Again.
    function _wrExportBusy(on) {
      const b = el('wrExportBtn'), l = el('wrExportLabel');
      if (b) b.disabled = on;
      if (l) l.textContent = on ? 'Exporting…' : 'Export';
    }
    // Libraries only some screens need load the first time they're used, not
    // at every launch (PDF export ~400 KB, the QR code for Contribute).
    const _LIBS = {
      jspdf:     ['https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
                  'sha384-JcnsjUPPylna1s1fvi1u12X5qjY5OL56iySh75FdtrwhO/SWXgMjoVqcKyIIWOLk'],
      autotable: ['https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js',
                  'sha384-fCAW/rDWORTbQXSiB7mOg0QtQ5c+r0f544y6XoKjuVva0nMBlCpNUjiFeG5iMdS3'],
      qrcode:    ['https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
                  'sha384-3zSEDfvllQohrq0PHL1fOXJuC/jSOO34H46t6UQfobFOmxE5BpjjaIJY5F2/bMnU'],
      // Animated numbers in the Today panel. Self-hosted: not on cdnjs.
      numberflow: ['/lib/number-flow.js',
                  'sha384-d4/hV2Pkt2cXP6Fyw/mOb61kYflG2P8BKKaVCQQUt7AS20L71HVbcHmbN2sJxJld'],
    };
    const _libLoads = {};
    function _loadLib(name) {
      return _libLoads[name] || (_libLoads[name] = new Promise((resolve, reject) => {
        const [src, integrity] = _LIBS[name], sc = document.createElement('script');
        sc.src = src; sc.integrity = integrity; sc.crossOrigin = 'anonymous';
        sc.onload = resolve;
        sc.onerror = () => { delete _libLoads[name]; sc.remove(); reject(new Error("Couldn't load the export tools. Check your connection.")); };
        document.head.appendChild(sc);
      }));
    }

    function downloadWeekReport() {
      if (el('wrExportBtn')?.disabled) return;
      _wrExportBusy(true);
      const failed = e => {
        _wrExportBusy(false);
        showToast("Couldn't Export Report", 'error', (e && e.message) || 'Please try again.',
                  { label: 'Try Again', onClick: downloadWeekReport });
      };
      // AutoTable extends jsPDF, so it loads second.
      _loadLib('jspdf').then(() => _loadLib('autotable'))
        .then(() => { try { _downloadWeekReport(failed); } catch (e) { failed(e); } }, failed);
    }
    function _downloadWeekReport(failed) {
      const ctx = _reportContext();
      const c = cfg();
      const showSurplus = c.recommendTimings !== false;   // Surplus column only when Recommend Timings on
      const surplusColIdx = showSurplus ? 6 : -1;
      const pdfSurpHdr = c.weeklyOn ? 'Surplus' : 'Over Time';

      const head = ['Day', 'Login', 'Logout', 'Attendance', 'Penalty', 'Total Hours'];
      if (showSurplus) head.push(pdfSurpHdr);

      // One consistent dash for every empty cell; also swap the U+2212 minus
      // (which the PDF's Helvetica can't render) for a plain hyphen.
      const DASH = '–';
      const norm = v => {
        if (v == null || v === '' || v === '—' || v === '–' || v === '-' || v === '−' || v === 'None') return DASH;
        return String(v).replace(/−/g, '-');
      };

      // Tables: 30-day → one per month (title = month, no year); week → single table.
      const tables = ctx.grouped
        ? _groupByMonth(ctx.daysArr).map(g => ({ title: MONTHS[g.month], count: g.days.length, rows: _buildReportRows(g.days) }))
        : (() => {
            const d0 = ctx.daysArr[0]?.date, dN = ctx.daysArr[ctx.daysArr.length - 1]?.date;
            let title = d0 ? MONTHS[d0.getMonth()] : '';
            if (d0 && dN && d0.getMonth() !== dN.getMonth()) title = `${MONTHS[d0.getMonth()]} – ${MONTHS[dN.getMonth()]}`;
            return [{ title, count: ctx.daysArr.length, rows: _buildReportRows(ctx.daysArr) }];
          })();

      _loadLogoDataUrl((logoDataUrl) => { try {
        const { jsPDF } = window.jspdf;
        const doc    = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        const pageW  = doc.internal.pageSize.getWidth();  // 210 mm
        const pageH  = doc.internal.pageSize.getHeight(); // 297 mm
        const margin = 18;

        // ════ PAGE HEADER — Logo (left) · Duration (right) ════
        const LOGO_SIZE = 13, logoY = 15;
        if (logoDataUrl) {
          doc.addImage(logoDataUrl, 'PNG', margin, logoY, LOGO_SIZE, LOGO_SIZE);
        } else {
          doc.setFontSize(18); doc.setFont('helvetica', 'bold'); doc.setTextColor(17, 24, 39);
          doc.text('5pm', margin, logoY + 10);
        }
        doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(156, 163, 175);
        doc.text('DURATION', pageW - margin, logoY + 4, { align: 'right' });
        doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(17, 24, 39);
        doc.text(ctx.pdfRange, pageW - margin, logoY + 11, { align: 'right' });

        // Divider under the page header
        const divY = logoY + LOGO_SIZE + 4;
        doc.setDrawColor(229, 231, 235); doc.setLineWidth(0.4);
        doc.line(margin, divY, pageW - margin, divY);

        let cursorY = divY + 9;

        tables.forEach((t, ti) => {
          if (ti > 0) cursorY += 5;
          // Keep the table header with its table — start a new page if it would
          // be orphaned near the bottom (heading + column row + a couple rows).
          if (cursorY + 34 > pageH - margin) { doc.addPage(); cursorY = margin + 2; }

          // ════ TABLE HEADER — Month/Week (left) · Days Count (right) ════
          doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(17, 24, 39);
          doc.text(t.title, margin, cursorY);
          doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(107, 114, 128);
          doc.text(`${t.count} ${t.count === 1 ? 'Day' : 'Days'}`, pageW - margin, cursorY, { align: 'right' });
          cursorY += 3;

          // ════ TABLE — all dates data ════
          const gRows = t.rows;
          const gWorked  = gRows.reduce((s, r) => s + r.worked, 0);
          const gSurplus = gRows.reduce((s, r) => s + r.surplusSecs, 0);

          const body = gRows.map(r => {
            const row = [norm(r.day), norm(r.entry), norm(r.exit), norm(r.attendance), norm(r.penalty), norm(r.totalHours)];
            if (showSurplus) row.push(norm(r.surplus));
            return row;
          });
          const totRow = ['Total', '', '', '', '', gWorked > 0 ? dur(gWorked) : DASH];
          if (showSurplus) totRow.push(gSurplus > 0 ? '+' + dur(gSurplus) : DASH);
          body.push(totRow);
          const tIdx = body.length - 1;

          doc.autoTable({
            startY: cursorY,
            margin: { left: margin, right: margin },
            theme: 'grid',
            head: [head],
            body,
            styles: {
              font: 'helvetica', fontSize: 10,
              cellPadding: { top: 4, bottom: 4, left: 5, right: 5 },
              valign: 'middle', textColor: [17, 24, 39],
              lineColor: [226, 232, 240], lineWidth: 0.2,
            },
            headStyles: {
              fillColor: [249, 250, 251], textColor: [107, 114, 128],
              fontStyle: 'normal', fontSize: 8, lineColor: [226, 232, 240], lineWidth: 0.2,
            },
            alternateRowStyles: { fillColor: [252, 252, 253] },
            didParseCell(data) {
              if (data.section !== 'body') return;
              if (data.row.index === tIdx) {
                data.cell.styles.fontStyle = 'bold';
                data.cell.styles.fontSize = 10;
                data.cell.styles.fillColor = [249, 250, 251];
                data.cell.styles.textColor = [17, 24, 39];
                if (data.column.index === surplusColIdx && gSurplus > 0)
                  data.cell.styles.textColor = [22, 163, 74];
              } else {
                const r = gRows[data.row.index];
                if (data.column.index === 0)
                  data.cell.styles.textColor = [17, 24, 39];
                if (data.column.index === 4 && r?.isPenalty)
                  data.cell.styles.textColor = [220, 38, 38];
                if (data.column.index === surplusColIdx && r?.surplusSecs > 0)
                  data.cell.styles.textColor = [22, 163, 74];
              }
            },
          });
          cursorY = doc.lastAutoTable.finalY + 6;
        });

        doc.save(`${ctx.fileBase}.pdf`);
        _wrExportBusy(false);
        showToast('Report Exported', 'success', `Saved to your Downloads folder as ${ctx.fileBase}.pdf.`);
      } catch (e) { failed(e); } });
    }

    // Navigate to the weekend view slot for the current daySelectorWeekOffset strip
    function selectWeekendView() {
      selectedDayKey = '__wknd__';
      renderDaySelector();
      _updateRunningElsewhereBanner();
      // Header
      const wk = week(daySelectorWeekOffset);
      const mon = wk[0].date, fri = wk[wk.length - 1].date;
      const name = cfg().name?.trim();
      const h = nowTz().getHours();
      const greeting = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
      el('selDayRel').textContent = name ? `${greeting}, ${name.split(' ')[0]}` : greeting;
      const _isSundayOnly = cfg().workDays >= 6;
      el('rcDayLabel').textContent = _isSundayOnly ? 'Sunday' : 'Weekend';
      const wkndTitle = el('wkndPageTitle');
      if (wkndTitle) wkndTitle.textContent = _isSundayOnly ? 'Sunday' : 'Weekend';
      // Nudge user to check weekly report (once per week)
      const _nudgeKey = 'wh_report_nudge_' + currentWeekId();
      if (!localStorage.getItem(_nudgeKey)) {
        localStorage.setItem(_nudgeKey, '1');
        setTimeout(() => showToast('Check your weekly report', 'info', '', { label: 'Check', onClick: () => openWeekReport() }), 800);
      }
      const hd = el('rcHeadDate'); if (hd) { hd.textContent = ''; hd.classList.remove('visible'); }
      // Show card, hide session-only elements
      el('futureDayPlan').style.display = 'none';
      el('resultCard').style.display = '';
      _setShiftCtaVisible(false);
      el('rcUpdateEntryBtn')?.classList.remove('visible');
      el('leaveChip').style.display = 'none';
      // Activate weekend mode — clear any leftover past-day state first (same
      // align-items:center leak fixed in selectDay()/renderEmptyState()).
      _rcShowPastMode(false);
      el('rcBody')?.classList.add('weekend-mode');
      _hideSkeleton();
      renderWeekendState();
      _updateDayNavBtns();
    }

    // ── AUTO-STOP ─────────────────────────────────────
    // Worked seconds at which the running session auto-stops: the daily target
    // plus the buffer. A session resumed after already passing that (the user
    // chose to carry on after an auto-stop) gets a fresh buffer counted from the
    // resume instead. Without it, Resume re-stopped the session a second later,
    // so it looked like the button did nothing. _sessionAccSecs is the time
    // before the running segment; it survives a reload (persistSession) and other
    // devices rebuild it from the day's log (_resumeFromLog).
    function _autoStopAtSecs() {
      const c = cfg(), buf = (c.autoStopBuf ?? 2) * 3600, base = c.dailyH * 3600 + buf;
      // At least an hour after a resume, even if the buffer is set to 0.
      return _sessionAccSecs >= base ? _sessionAccSecs + Math.max(buf, 3600) : base;
    }

    function doAutoStop() {
      if (!loginDate || autoStopped) return;
      autoStopped = true;
      if (ticker) { clearInterval(ticker); ticker = null; }
      _stopCheckpoint();
      const now = new Date();
      const tk = todayKey(), ex = dayLog(tk) || {};
      const sessionSecs = Math.floor((now - loginDate) / 1000);
      const worked = _sessionAccSecs + sessionSecs;
      saveDayLogAndSync(tk, { ...ex,
        loginTime:    ex.loginTime || `${loginDate.getHours()}:${loginDate.getMinutes()}:${loginDate.getSeconds()}`,
        loginDisplay: ex.loginDisplay || short(loginDate),
        checkoutDisplay: short(now),
        hoursWorked:  worked / 3600,
        autostopped:  true,
        lastUpdated:  now.toISOString(),
        sessionTag:   'autostopped'
      });
      // The session is genuinely over, so settle the bookkeeping the same way
      // endSession() does: park the full total in _sessionAccSecs and drop loginDate.
      // Without this a later render() would add elapsed-since-login on top of the
      // accumulated total and double-count the day.
      _sessionAccSecs = worked;
      Store.clearSession();
      loginDate = null;
      setCalcBtnState('ended');
      el('shiftInputRow').classList.remove('active-state');
      _showAutostopBar(short(now));
      renderDaySelector();
      renderEmptyState(); // swap the live tracker for the day summary right away
    }

    // ── ANIMATED NUMBER TICKER (react-animated-numbers style, 1.5× speed) ──
    const _animState = {};
    function animateNum(elId, newText) {
      const elem = el(elId);
      if (!elem) return;
      const old = elem.dataset.animVal;
      if (old === newText) return; // no change
      elem.dataset.animVal = newText;

      // Extract numeric part to animate; fall back to instant swap for non-numeric
      const newNum = parseFloat(newText);
      const oldNum = parseFloat(old || '0');
      if (isNaN(newNum) || isNaN(oldNum) || old == null) { elem.textContent = newText; return; }

      const DURATION = 200; // ms — 1.5× faster than typical 300ms
      const start = performance.now();
      if (_animState[elId]) cancelAnimationFrame(_animState[elId]);
      function tick(now) {
        const t = Math.min((now - start) / DURATION, 1);
        const ease = 1 - Math.pow(1 - t, 3); // cubic ease-out
        const cur = oldNum + (newNum - oldNum) * ease;
        // Preserve non-numeric suffix (e.g. "h 05m")
        elem.textContent = newText.replace(/[\d.]+/, () => {
          // Format integer-like numbers without decimals
          return Number.isInteger(newNum) ? Math.round(cur) : cur.toFixed(1);
        });
        if (t < 1) _animState[elId] = requestAnimationFrame(tick);
        else elem.textContent = newText;
      }
      _animState[elId] = requestAnimationFrame(tick);
    }

    // ── P6 Text swap (blur + translateY exit → enter) ───────
    function swapText(elId, newText, styleObj) {
      const elem = typeof elId === 'string' ? el(elId) : elId;
      if (!elem) return;
      if (elem.textContent === newText) {
        if (styleObj) Object.assign(elem.style, styleObj);
        return;
      }
      elem.classList.add('p6-text', 'is-exit');
      setTimeout(() => {
        elem.textContent = newText;
        if (styleObj) Object.assign(elem.style, styleObj);
        elem.classList.remove('is-exit');
        elem.classList.add('is-enter-start');
        requestAnimationFrame(() => requestAnimationFrame(() => {
          elem.classList.remove('is-enter-start');
        }));
      }, 150);
    }

    // ── P9 Number pop-in (first-time value reveal) ──────────
    function _p9Pop(elId) {
      const elem = typeof elId === 'string' ? el(elId) : elId;
      if (!elem) return;
      elem.classList.remove('p9-popping');
      void elem.offsetWidth; // reflow to restart animation
      elem.classList.add('p9-popping');
      elem.addEventListener('animationend', () => elem.classList.remove('p9-popping'), { once: true });
    }

    // Animate the big hour display (parses "Xh YYm" format)
    function animateDuration(elId, newText) {
      const elem = el(elId);
      if (!elem) return;
      const old = elem.dataset.animVal;
      if (old === newText) return;
      // P9 pop-in: trigger when transitioning from a blank/dash state to a real value
      const wasBlank = !old || old === '—' || old === '';
      elem.dataset.animVal = newText;
      if (wasBlank) { _p9Pop(elem); }
      const parseHM = s => { const m = s.match(/(\d+)h\s*(\d+)m/); return m ? parseInt(m[1])*60+parseInt(m[2]) : null; };
      const newMins = parseHM(newText), oldMins = parseHM(old || '0h 00m');
      if (newMins === null || oldMins === null) { elem.textContent = newText; return; }
      const DURATION = 200;
      const start = performance.now();
      if (_animState[elId]) cancelAnimationFrame(_animState[elId]);
      function tick(now) {
        const t = Math.min((now - start) / DURATION, 1);
        const ease = 1 - Math.pow(1 - t, 3);
        const cur = Math.round(oldMins + (newMins - oldMins) * ease);
        const h = Math.floor(cur / 60), m = cur % 60;
        elem.textContent = `${h}h ${String(m).padStart(2,'0')}m`;
        if (t < 1) _animState[elId] = requestAnimationFrame(tick);
        else elem.textContent = newText;
      }
      _animState[elId] = requestAnimationFrame(tick);
    }

    // ── MAIN DISPLAY LOOP ──────────────────────────────
    // When today's work is done: the running segment's start plus what is left
    // of the target. Time from earlier segments (pause/resume parks it in
    // _sessionAccSecs) already counts, so it is not loginDate + the full target.
    function _leaveAt(target = effSecs()) {
      return new Date(loginDate.getTime() + (target - _sessionAccSecs) * 1000);
    }
    // Start of the day as shown: the first start, not the latest resume.
    function _dayStartDisplay() {
      const ex = dayLog(todayKey());
      return _sessionAccSecs > 0 && ex?.loginDisplay ? ex.loginDisplay : short(loginDate);
    }

    // Today's running entry. render() writes it every 30s; _flushLiveLog()
    // writes it now, before anything reads or sends it (View Stats, a cloud
    // flush, the window hiding or closing). Marked dirty without starting the
    // idle-sync timer, so it goes up with the 10-minute checkpoint and the
    // hide/close flushes, as it did when it was written every second.
    let _liveLogSavedAt = 0;
    function _writeLiveLog(snapshot, worked) {
      // A running session has no end yet: drop any end time left by an earlier
      // pause. Kept, it read as "ended on another device" on the next refresh
      // (a relaunch after an update, a tab switch) and stopped the session.
      const now = new Date(), tk = todayKey();
      const { checkoutDisplay: _oldEnd, checkoutTime: _oldEndTime, ...ex } = dayLog(tk) || {};
      // After a resume, keep the day's first start; only a fresh day takes this segment's.
      const keepStart = _sessionAccSecs > 0 && ex.loginDisplay;
      Store.setDay(tk, { ...ex,
        loginTime:    keepStart && ex.loginTime ? ex.loginTime : `${snapshot.getHours()}:${snapshot.getMinutes()}:${snapshot.getSeconds()}`,
        loginDisplay: keepStart ? ex.loginDisplay : short(snapshot),
        hoursWorked:  worked / 3600,
        lastUpdated:  now.toISOString(),
        // A running session is never auto-stopped. Resuming after an auto-stop
        // left these set, and other devices refuse to pick up an auto-stopped day.
        autostopped:  false,
        sessionTag:   ex.sessionTag && ex.sessionTag !== 'autostopped' ? ex.sessionTag : 'realtime'
      });
      persist();
      if (!_applyingRemote) _dirtyDays.add(tk);
      _liveLogSavedAt = now.getTime();
    }
    // A session never runs past its own day. A device that kept yesterday's
    // session in memory (phone app in the background, a tab left open, a PC
    // woken from sleep) used to carry on ticking after midnight and write it
    // into today's row, so every other device resumed it as today's session.
    // Drops that live session here; _closeStaleDays() then gives its day an end.
    function _dropStaleLive() {
      if (!loginDate || _devDateOverride || dateKey(loginDate) >= todayKey()) return false;
      const wasViewing = selectedDayKey === dateKey(loginDate);
      cancelScheduledNotifications();
      if (ticker) { clearInterval(ticker); ticker = null; }
      _stopCheckpoint();
      loginDate = null; autoStopped = false; wasDone = false; notifSent = false;
      _sessionAccSecs = 0;
      Store.clearSession();
      setCalcBtnState('start');
      el('shiftInputRow').classList.remove('active-state', 'hidden');
      el('shiftActiveLabel').textContent = '—';
      el('autostopBanner').classList.remove('show');
      if (wasViewing) selectDay(todayKey()); else renderEmptyState();
      return true;
    }

    // Best guess at when a day's work stopped, for a day with a start and no end:
    // the last moment its session was seen running (lastUpdated, if it falls on
    // that day), else start + hours worked. null when the day has no start.
    function _estimateDayEnd(dk, log) {
      if (!log?.loginTime) return null;
      const pts = log.loginTime.split(':').map(Number);
      const start = new Date(dk + 'T00:00:00'); start.setHours(pts[0] || 0, pts[1] || 0, pts[2] || 0, 0);
      const dayEnd = new Date(dk + 'T23:59:59');
      const seen = log.lastUpdated ? new Date(log.lastUpdated) : null;
      const end = seen && seen >= start && seen <= dayEnd ? seen
        : new Date(Math.min(start.getTime() + (log.hoursWorked || 0) * 3600000, dayEnd.getTime()));
      return { start, end };
    }

    // Past days that still have a start and no end: a session left running
    // when the PC shut down, or ended on a device that never synced it. Close
    // each at the last moment it was seen running, on every device, so none of
    // them can pick it up again. Runs after a pull so it works on merged data.
    function _closeStaleDays() {
      const tk = todayKey();
      let closed = false;
      for (const [dk, log] of Object.entries(Store.allDays())) {
        if (dk >= tk || !log?.loginTime || log.checkoutDisplay || log.checkoutTime || log.autostopped) continue;
        const { end } = _estimateDayEnd(dk, log);
        saveDayLog(dk, { ...log,
          checkoutDisplay: short(end),
          checkoutTime: `${p2(end.getHours())}:${p2(end.getMinutes())}:${p2(end.getSeconds())}`,
          lastUpdated: new Date().toISOString()
        });
        closed = true;
      }
      if (closed) { _syncNow(); renderHistory(); renderDaySelector(); }
    }

    function _flushLiveLog() {
      if (loginDate && !_dropStaleLive()) _writeLiveLog(loginDate, Math.max(0, Math.floor((Date.now() - loginDate) / 1000)) + _sessionAccSecs);
    }

    function render() {
      if (!loginDate) return;
      if (_dropStaleLive()) { _refreshFromCloud(true); return; }
      _tdSyncPlan();
      _hideSkeleton();
      // The Dashboard's live row ticks regardless of which day Home is showing,
      // so this sits above the past/future early-return below.
      if (el('wkRows')?.offsetParent) _tickWkLiveRow(); // the week card is on screen (Home in the new shell)
      // When browsing a past/future day, only refresh the day-selector dots silently.
      // Without this guard the live ticker overwrites past-day content every second.
      if (selectedDayKey && selectedDayKey !== todayKey()) {
        renderDaySelector();
        _updateRunningElsewhereBanner();
        return;
      }
      el('rcBody')?.classList.remove('weekend-mode', 'ns-times', 'ns-progress', 'past-day');
      const c = cfg();
      const now = new Date(), eff = effSecs();
      const _loginSnapshot = loginDate; // survives the target-reached pause nulling loginDate mid-tick
      const worked  = Math.max(0, Math.floor((now - loginDate) / 1000)) + _sessionAccSecs;
      swapText('rcElapsedLabel', 'Elapsed');
      if (Math.floor(Date.now()/1000) % 30 === 0) persistSession(); // every 30s
      const isDone  = eff > 0 && worked >= eff;
      const leaveDate = _leaveAt(eff);
      const OT_QUIPS = ['ARE YOU INSANE!', 'WHY? GOD WHY!', 'GO HOME!!', 'SIR, PLEASE.', 'LEAVE. NOW.', 'SERIOUSLY??', 'IT\'S OVER!!'];

      el('autostopBanner').classList.remove('show');
      // ── Auto-stop check ──
      const autoStopAt = _autoStopAtSecs();
      if (!autoStopped && worked >= autoStopAt) { doAutoStop(); return; }

      _rcShowPastMode(false);
      const _loginStr  = _dayStartDisplay();
      const _logoutStr = short(leaveDate);
      const _elapsedStr = durWorked(worked);
      let _rightStr, _rightClass, _barClass, _descRightTimes, _descRightProgress;

      el('otBanner').classList.remove('show'); // never show — overtime shown inline
      let _otFrac = 0;
      if (!isDone && eff > 0) {
        const rem = eff - worked;
        const remText = rem < 60 ? `${Math.max(0, rem)}s` : dur(rem);
        _rightStr   = remText;
        _rightClass = '';
        _barClass   = 'running';
        // Time tab keeps the countdown chip; Progress tab shows the leave-by clock time
        // instead, since the leave time is already the Time tab's own right KPI.
        _descRightTimes    = '<span class="rc-desc-chip">' + _rcRemainingFmt(rem) + ' remaining</span>';
        _descRightProgress = '<span class="rc-desc-chip">leave by ' + _logoutStr + '</span>';
        _otOverlayReset();
      } else if (isDone) {
        const ot = worked - eff;
        _rightStr   = ot < 60 ? '+0m' : '+' + dur(ot);
        _rightClass = ot < 60 ? 'muted' : 'warn';
        // Bar keeps its existing color/appearance at 100% — the overtime overlay
        // (rendered separately below) is what signals "target reached", not a
        // base-color change.
        _barClass   = 'running';
        // No "Done for today" chip here — the doneBanner below the input ("You're
        // done. Head out!") already says that; this row only earns its keep once
        // there's a number worth reporting.
        _descRightTimes = _descRightProgress =
          ot > 60 ? '<span class="rc-desc-chip warn">' + _rcRemainingFmt(ot) + ' overtime</span>' : '';
        // Delay the overlay's first appearance ~650ms so it reads as a deliberate
        // reveal rather than snapping in the instant the target's crossed.
        if (!_otOverlayArmed && !_otOverlayTimer) {
          _otOverlayTimer = setTimeout(() => { _otOverlayArmed = true; _otOverlayTimer = null; if (loginDate) render(); }, 650);
        }
        if (_otOverlayArmed) {
          // Overtime's share of the Auto Stop window — 0 the instant target is hit,
          // 1 exactly at Auto Stop (autoStopAt - eff is that window's length).
          const _otWindow = autoStopAt - eff;
          _otFrac = _otWindow > 0 ? ot / _otWindow : 1;
        }
      } else {
        _rightStr   = '—';
        _rightClass = 'muted';
        _barClass   = 'running';
        _descRightTimes = _descRightProgress = '';
        _otOverlayReset();
      }

      // Cache for pair-switching without full re-render
      _rcCache = { loginStr: _loginStr, logoutStr: _logoutStr, elapsedStr: _elapsedStr,
        rightStr: _rightStr, rightClass: _rightClass, pct: eff > 0 ? worked / eff : 1,
        barClass: _barClass, descLeft: _loginStr + ' → ' + _logoutStr,
        descRightTimes: _descRightTimes, descRightProgress: _descRightProgress,
        isDone: isDone };

      // Hover tooltip on the right KPI — Remaining time, same on both Time/Progress tabs
      const _remSecs = eff > 0 ? Math.max(0, eff - worked) : 0;
      el('rcTarget').title = eff > 0 ? 'Remaining ' + (worked >= eff ? '0m' : dur(_remSecs)) : '';

      if (_currentPairIs('times')) {
        el('rcWorked').textContent = _loginStr;
        el('rcWorked').style.color = isDone ? 'var(--muted-fg)' : 'var(--foreground)';
        // Once the target's hit, "Leave by" is stale info (that time already passed) —
        // show overtime worked instead, same as the Progress tab's right KPI.
        el('rcTarget').textContent = isDone ? _rightStr : _logoutStr;
        el('rcTarget').style.color = isDone ? (_rightClass === 'warn' ? 'var(--warning)' : 'var(--muted-fg)') : '';
      } else {
        animateDuration('rcWorked', _elapsedStr);
        el('rcWorked').style.color = isDone ? 'var(--muted-fg)' : 'var(--foreground)';
        el('rcTarget').style.color = _rightClass === 'warn' ? 'var(--warning)' : _rightClass === 'muted' ? 'var(--muted-fg)' : '';
        if (eff > 0) animateDuration('rcTarget', _rightStr); else el('rcTarget').textContent = _rightStr;
      }
      _rcSetDesc(_currentPairIs('times') ? _descRightTimes : _descRightProgress);

      _rcSetProgress(eff > 0 ? worked / eff : 1, _barClass, _otFrac);
      // "Leave at" badge: prefer personal Out Time target if set
      const _tkNow = todayKey(), _logNow = dayLog(_tkNow) || {};
      const _earlyTarget = _logNow.earlyLeaveTarget;
      _setTodayDateChip();

      el('rcToday').innerHTML = ''; el('rcToday').style.display = 'none';

      // Stay hint
      const hint = buildStayHint();
      if (hint) { el('stayHintText').textContent = hint; el('stayHint').style.display = 'flex'; }
      else { el('stayHint').style.display = 'none'; }

      if (eff === 0) {
        el('doneMsg').textContent = 'Weekly target already met — bonus hours!';
        el('doneBanner').classList.add('show');
      } else if (isDone) {
        const ago = Math.floor((now - leaveDate) / 1000);
        el('doneMsg').textContent = ago > 60 ? `Should've left at ${short(leaveDate)}` : "You're done. Head out!";
        el('doneBanner').classList.add('show');
        notify(eff);
        // Switch button to End once target is reached (only when still tracking)
        const _cbtn = el('calcBtn');
        if (_cbtn && _cbtn.dataset.state === 'running') setCalcBtnState('done');
      } else {
        el('doneBanner').classList.remove('show');
      }

      // Split button stays in its current running/ended state — End Session is in the dropdown
      // Guard: never show the target modal for an auto-stopped session — the ASR modal
      // already handles it, and render() is still called while loginDate is set for display.
      if (isDone && !wasDone && !autoStopped && !_dtrSeen(todayKey())) {
        wasDone = true;
        _dtrMarkSeen(todayKey());
        // When Recommend Timings is OFF, pause the session and show the target modal.
        // The counter stops — gap while modal is open is not counted as work time.
        if (cfg().recommendTimings === false) {
          if (ticker) { clearInterval(ticker); ticker = null; }
          // Freeze accumulated seconds at the exact moment target was reached
          _sessionAccSecs += Math.floor((now - loginDate) / 1000);
          loginDate = null; // session paused
          persistSession(); // clears the stored session so a reload can't resurrect the pre-pause loginDate
          el('dailyTargetHours').textContent = dur(_sessionAccSecs);
          el('dailyTargetReachedOverlay').classList.add('open');
        }
      } else if (!isDone) wasDone = false;

      // Saved every 30s, not every second (the screen still ticks from
      // loginDate); at once if the target-reached pause just stopped the clock.
      if (!loginDate || now - _liveLogSavedAt >= 30000) _writeLiveLog(_loginSnapshot, worked);

      // Update day-selector dots live (week card is in analytics)
      renderDaySelector();
    }

    // ── DAY SELECTOR (Home) ────────────────────────────
    let _dsSel = null;      // last key scrolled-to — prevents redundant scrolls on every tick
    let _dsUserNav = false; // true when a click/nav triggered the render (forces re-centre)

    // Desktop (rail on) shows the strip as a segmented control, one week per view.
    const _dsDesk = () => document.body.classList.contains('rail-on');
    const _DS_GAP = 2; // px between day columns on desktop (matches the CSS)
    function _dsWeekStep(container) { return container.clientWidth + _DS_GAP; }
    // Moves the raised pill under the selected day.
    function _dsPlaceGlide() {
      const c = el('daySelectorRow');
      if (!c) return;
      let g = c.querySelector('.ds-glide');
      if (!g) { g = document.createElement('span'); g.className = 'ds-glide'; g.setAttribute('aria-hidden', 'true'); c.prepend(g); }
      const a = c.querySelector('.day-sel-btn.active');
      if (!a || !_dsDesk()) { g.style.opacity = '0'; return; }
      g.style.opacity = '1';
      g.style.width = a.offsetWidth + 'px';
      g.style.transform = `translateX(${a.offsetLeft}px)`;
    }
    function _dsScrollTo(container, btn, behavior) {
      const cw = container.getBoundingClientRect().width;
      if (!cw) return; // layout not ready
      if (_dsDesk()) {
        const btns = Array.from(container.querySelectorAll('.day-sel-btn[data-key]'));
        const page = Math.floor(Math.max(0, btns.indexOf(btn)) / 7);
        const left = page * _dsWeekStep(container);
        if (behavior === 'smooth' && !matchMedia('(prefers-reduced-motion: reduce)').matches) container.scrollTo({ left, behavior: 'smooth' });
        else container.scrollLeft = left;
        return;
      }
      // Absolute position of button centre within the scroll content
      const btnAbs = btn.getBoundingClientRect().left - container.getBoundingClientRect().left + container.scrollLeft + btn.offsetWidth / 2;
      const target  = Math.max(0, btnAbs - cw / 2);
      if (behavior === 'smooth') container.scrollTo({ left: target, behavior: 'smooth' });
      else container.scrollLeft = target;
    }

    // Returns the week label for any date key — O(1) date math, no loop.
    function _weekLabelForKey(key) {
      const d = new Date(key + 'T12:00');
      const dow = d.getDay();
      const mon = new Date(d); mon.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow)); mon.setHours(0,0,0,0);
      const today = new Date(); today.setHours(0,0,0,0);
      const todayDow = today.getDay();
      const thisMon = new Date(today); thisMon.setDate(today.getDate() + (todayDow === 0 ? -6 : 1 - todayDow));
      const off = Math.round((mon - thisMon) / (7 * 86400000));
      return off === 0 ? 'This Week' : weekRangeLabel(off);
    }

    function _updateWeekLabel() {
      const span = el('thisWeekLabelText'), container = el('daySelectorRow');
      if (!span || !container) return;
      // Track the centre-most visible card (the crosshair card).
      const midX = container.scrollLeft + container.clientWidth / 2;
      let centreBtn = null;
      container.querySelectorAll('.day-sel-btn[data-key]').forEach(btn => {
        const btnMid = btn.offsetLeft + btn.offsetWidth / 2;
        if (!centreBtn || Math.abs(btnMid - midX) < Math.abs(centreBtn.offsetLeft + centreBtn.offsetWidth / 2 - midX)) {
          centreBtn = btn;
        }
      });
      if (centreBtn) span.textContent = _weekLabelForKey(centreBtn.dataset.key);
    }

    function _syncOffsetFromKey(key) {
      const d = new Date(key + 'T12:00');
      const dow = d.getDay();
      const mon = new Date(d); mon.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow)); mon.setHours(0,0,0,0);
      const today = new Date(); today.setHours(0,0,0,0);
      const todayDow = today.getDay();
      const thisMon = new Date(today); thisMon.setDate(today.getDate() + (todayDow === 0 ? -6 : 1 - todayDow));
      daySelectorWeekOffset = Math.round((mon - thisMon) / (7 * 86400000));
    }

    // Scroll the strip so today's card is centred (Filmstrip view).
    // Retries via rAF until the container has a real width (layout settled).
    function _dsResetScroll() {
      const container = el('daySelectorRow');
      if (!container) return;
      const tk = todayKey();
      let targetBtn = container.querySelector(`.day-sel-btn[data-key="${tk}"]`);
      // On weekends today's card isn't in a Mon–Fri strip — fall back to the
      // nearest work day of the current week so the strip still lands there
      // (otherwise it stays scrolled all the way back to the earliest week).
      if (!targetBtn) {
        const wk = week(0);
        for (let i = wk.length - 1; i >= 0 && !targetBtn; i--) {
          targetBtn = container.querySelector(`.day-sel-btn[data-key="${wk[i].key}"]`);
        }
      }
      if (!targetBtn) return;
      if (!container.getBoundingClientRect().width) {
        requestAnimationFrame(() => _dsResetScroll());
        return;
      }
      _dsScrollTo(container, targetBtn);
    }

    // ── Lazy-load helpers ──
    let _dsEarliestOffset = -2; // tracks how far back we've rendered

    function _dsMakeBtn(day, now, tk, selKey, c) {
      const btn = document.createElement('button');
      const log = dayLog(day.key);
      const isFuture = day.date > now && day.key !== tk;
      btn.className = 'day-sel-btn';
      btn.dataset.key = day.key;
      if (day.isWeekend) btn.classList.add('wkd-btn');
      if (selKey && day.key === selKey) btn.classList.add('active');
      // Penalty dot: only past/today with actual hours (> 0 guards realtime echo noise)
      if (!isFuture && log?.hoursWorked > 0 && log?.override !== 'leave' && log?.override !== 'holiday') {
        const t = c.dailyH * 3600, dt = log?.override === 'halfday' ? t / 2 : t;
        if ((dt - log.hoursWorked * 3600) > 300) btn.classList.add('has-penalty');
      }
      // Plan dot: future plans AND past days where a plan was set (futurePlan persists in log)
      if (!day.isWeekend && log?.futurePlan) btn.classList.add('has-plan');
      if (!day.isWeekend && day.key < tk && !(log?.hoursWorked > 0) && !log?.override) btn.classList.add('has-missing');
      if (isFuture) btn.classList.add('future');
      btn.innerHTML = `<span class="dsel-name">${day.name.slice(0,3)}</span>`
                    + `<span class="dsel-num">${day.date.getDate()}</span>`;
      btn.addEventListener('click', () => {
        _dsUserNav = true;
        _animateCardHeight(() => {
          if (isFuture) selectFutureDay(day.key);
          else selectDay(day.key);
        });
        _syncOffsetFromKey(day.key);
      });
      return btn;
    }

    function _dsLoadMorePast() {
      const newEarliest = _dsEarliestOffset - 2;
      if (newEarliest < -52) return; // cap at ~1 year back
      const container = el('daySelectorRow');
      const now = new Date(), tk = todayKey(), c = cfg();
      const selKey = selectedDayKey === '__wknd__' ? null : (selectedDayKey || tk);
      const days = [];
      for (let off = newEarliest; off < _dsEarliestOffset; off++) weekStrip(off).forEach(d => days.push(d));
      const frag = document.createDocumentFragment();
      days.forEach(day => frag.appendChild(_dsMakeBtn(day, now, tk, selKey, c)));
      const widthBefore = container.scrollWidth;
      const scrollBefore = container.scrollLeft;
      container.insertBefore(frag, container.firstChild);
      // Preserve viewport: shift scroll by however much width was prepended (card widths are flexible)
      container.scrollLeft = scrollBefore + (container.scrollWidth - widthBefore);
      _dsEarliestOffset = newEarliest;
    }

    function renderDaySelector() {
      const tk = todayKey(), now = new Date(), c = cfg();
      const selKey = selectedDayKey === '__wknd__' ? null : (selectedDayKey || tk);
      const container = el('daySelectorRow');

      // ── Soft update: just toggle classes, never reset scroll ──
      const existing = container.querySelectorAll('.day-sel-btn[data-key]');
      if (existing.length > 0) {
        let selFound = false;
        existing.forEach(btn => {
          const key = btn.dataset.key;
          const isActive = !!(selKey && key === selKey);
          btn.classList.toggle('active', isActive);
          if (isActive) selFound = true;
          const log = dayLog(key);
          btn.classList.toggle('future', new Date(key + 'T12:00') > now && key !== tk);
          btn.classList.remove('has-penalty', 'has-plan');
          const _isFutureKey = new Date(key + 'T12:00') > now && key !== tk;
          const _isWkd = btn.classList.contains('wkd-btn');
          if (!_isFutureKey && log?.hoursWorked > 0 && log?.override !== 'leave' && log?.override !== 'holiday') {
            const t = c.dailyH * 3600, dt = log?.override === 'halfday' ? t / 2 : t;
            if ((dt - log.hoursWorked * 3600) > 300) btn.classList.add('has-penalty');
          }
          if (!_isWkd && log?.futurePlan) btn.classList.add('has-plan');
          btn.classList.toggle('has-missing', !_isWkd && key < tk && !(log?.hoursWorked > 0) && !log?.override);
        });
        if (!selKey || selFound) {
          if (selKey && (selKey !== _dsSel || _dsUserNav)) {
            const activeBtn = container.querySelector('.day-sel-btn.active');
            if (activeBtn) _dsScrollTo(container, activeBtn, 'smooth');
            _dsSel = selKey;
          }
          _dsUserNav = false;
          _updateDayNavBtns();
          _dsPlaceGlide();
          return;
        }
      }

      // ── Full render: 2 past weeks + current week + next week (lazy: more loaded on demand) ──
      _dsEarliestOffset = -2;
      const days = [];
      for (let off = -2; off <= 1; off++) weekStrip(off).forEach(d => days.push(d));

      container.innerHTML = '';
      _dsSel = null;
      let activeBtn = null, todayBtn = null;

      days.forEach(day => {
        const btn = _dsMakeBtn(day, now, tk, selKey, c);
        if (selKey && day.key === selKey) { btn.classList.add('active'); activeBtn = btn; }
        if (day.key === tk) todayBtn = btn;
        container.appendChild(btn);
      });

      // On load, always show Monday of current week first — user swipes left for history.
      if (activeBtn) _dsSel = selKey;
      requestAnimationFrame(() => { _dsResetScroll(); _dsPlaceGlide(); _updateDayNavBtns(); });
      _updateDayNavBtns();
      _updateWeekLabel();
    }

    function navDaySelectorDay(dir) {
      const container = el('daySelectorRow');
      if (container && _dsDesk()) {
        const max = container.scrollWidth - container.clientWidth;
        const left = Math.max(0, Math.min(max, container.scrollLeft + dir * _dsWeekStep(container)));
        container.scrollTo({ left, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        setTimeout(() => { _updateWeekLabel(); _updateDayNavBtns(); }, 450);
        return;
      }
      const btns = Array.from(container.querySelectorAll('.day-sel-btn[data-key]'));
      if (!btns.length) return;
      const selKey = selectedDayKey === '__wknd__' ? null : (selectedDayKey || todayKey());
      const curIdx = selKey ? btns.findIndex(b => b.dataset.key === selKey) : -1;
      const targetIdx = Math.max(0, Math.min(btns.length - 1, curIdx + dir));
      if (targetIdx === curIdx) return;
      const targetBtn = btns[targetIdx];
      const targetKey = targetBtn.dataset.key;
      const now = new Date();
      const dayDate = new Date(targetKey + 'T12:00');
      _dsUserNav = true;
      _animateCardHeight(() => {
        if (dayDate > now && targetKey !== todayKey()) selectFutureDay(targetKey);
        else selectDay(targetKey);
      });
      _syncOffsetFromKey(targetKey);
    }

    function _updateDayNavBtns() {
      const container = el('daySelectorRow');
      const btns = container ? Array.from(container.querySelectorAll('.day-sel-btn[data-key]')) : [];
      const selKey = selectedDayKey === '__wknd__' ? null : (selectedDayKey || todayKey());
      const curIdx = selKey ? btns.findIndex(b => b.dataset.key === selKey) : -1;
      const prevBtn = el('weekPrevBtn'), nextBtn = el('weekNextBtn');
      if (container && _dsDesk()) {
        // Desktop arrows page whole weeks, so they stop at the first and last week.
        const max = container.scrollWidth - container.clientWidth;
        if (prevBtn) { prevBtn.disabled = container.scrollLeft <= 1; prevBtn.title = 'Previous week'; }
        if (nextBtn) { nextBtn.disabled = container.scrollLeft >= max - 1; nextBtn.title = 'Next week'; }
        return;
      }
      if (prevBtn) prevBtn.disabled = curIdx <= 0;
      if (nextBtn) nextBtn.disabled = curIdx >= btns.length - 1;
    }

    function _ordinal(n) {
      const s = n % 100;
      if (s >= 11 && s <= 13) return n + 'th';
      return n + (['st','nd','rd'][n % 10 - 1] || 'th');
    }
    function _fmtDayHeading(dateObj) {
      return `${FULL_DAYS_EN[dateObj.getDay()]}, ${_ordinal(dateObj.getDate())} ${MONTHS[dateObj.getMonth()]}`;
    }

    function updateSelDayHeader(key) {
      const tk = todayKey(), wk = week(daySelectorWeekOffset);
      const now = nowTz();
      const day = wk.find(d => d.key === key);
      const dayDate = day ? day.date : now;
      const dateStrEl = el('selDayDateStr');
      if (dateStrEl) dateStrEl.textContent = `${MONTHS[dayDate.getMonth()]} ${dayDate.getDate()}, ${dayDate.getFullYear()}`;
      // Always show time-based greeting regardless of selected day
      const h = now.getHours();
      const greeting = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
      const name = (cfg().name || '').trim();
      el('selDayRel').textContent = name ? `${greeting}, ${name.split(' ')[0]}` : greeting;
      // rcDayLabel: relative label for adjacent days, formatted date for everything else
      const _yd = new Date(nowTz()); _yd.setDate(_yd.getDate() - 1);
      const _tm = new Date(nowTz()); _tm.setDate(_tm.getDate() + 1);
      const ydKey = dateKey(_yd), tmKey = dateKey(_tm);
      const _labelDate = day ? day.date : new Date(key + 'T12:00');
      if      (key === tk)    el('rcDayLabel').textContent = 'Today';
      else if (key === ydKey) el('rcDayLabel').textContent = 'Yesterday';
      else if (key === tmKey) el('rcDayLabel').textContent = 'Tomorrow';
      else                    el('rcDayLabel').textContent = _fmtDayHeading(_labelDate);
    }

    function _setShiftCtaVisible(v) {
      const s = el('todayLoginSection'); if (!s) return;
      s.classList.toggle('cta-hidden', !v);
    }

    function _animateCardHeight(fn) {
      const card = el('homeCard');
      const main = el('homeMain');
      if (!card) { fn(); return; }
      const prevH = card.offsetHeight;
      // Pin BEFORE content change so the swap is invisible
      card.style.height = prevH + 'px';
      if (main) main.style.overflowY = 'hidden'; // prevent scroll jump during animation
      fn();
      // For growing: scrollHeight gives natural content height while card is pinned
      // For shrinking: scrollHeight = prevH (clipped), so briefly go auto to measure
      let newH = card.scrollHeight;
      if (newH <= prevH) {
        card.style.height = 'auto';
        newH = card.offsetHeight; // forced sync reflow, no paint yet
        card.style.height = prevH + 'px';
      }
      const _restore = () => {
        card.style.height = '';
        card.style.transition = '';
        card.classList.remove('card-animating');
        if (main) main.style.overflowY = '';
      };
      if (Math.abs(newH - prevH) < 4) { _restore(); return; }
      card.classList.add('card-animating'); // suppresses wknd-fade-in during height anim
      requestAnimationFrame(() => {
        card.style.transition = 'height 0.32s cubic-bezier(0.4,0,0.2,1)';
        card.style.height = newH + 'px';
        card.addEventListener('transitionend', function _cleanup() {
          _restore();
          card.removeEventListener('transitionend', _cleanup);
        }, { once: true });
      });
    }

    function selectDay(key) {
      const tk = todayKey();
      selectedDayKey = key;
      try { sessionStorage.setItem('wh_sel_day', key); } catch {}
      _updateRunningElsewhereBanner();
      el('rcBody')?.classList.remove('weekend-mode');
      el('weekendView')?.classList.remove('override-mode');
      // renderWeekendState sets inline display:none on these elements for holiday/leave;
      // clear them here so renderPastDay (and render/renderEmptyState) start from clean state
      const _rcNumEl = document.querySelector('.rc-numbers');
      if (_rcNumEl) _rcNumEl.style.display = '';
      ['rcToday', 'stayHint', 'otBanner', 'doneBanner', 'autostopBanner'].forEach(id => {
        const _e = el(id); if (_e) _e.style.display = '';
      });
      renderDaySelector();
      updateSelDayHeader(key);
      el('futureDayPlan').style.display = 'none';
      el('wkndBadgeCard').style.display = 'none';
      el('resultCard').style.display = '';
      _hideSkeleton();

      // Weekend day, or a day marked Holiday / Full Day Leave → unified info card
      const _ovSel = dayLog(key)?.override;
      // A running session always gets the tracking view, weekend or not:
      // the info card hides the controls, leaving no way to stop it.
      const _infoType = (key === tk && loginDate) ? null
        : isWeekendKey(key) ? 'weekend'
        : _ovSel === 'holiday' ? 'holiday'
        : _ovSel === 'leave'   ? 'leave'
        : _ovSel === 'halfday' ? 'halfday' : null;
      if (_infoType) {
        // A previously-selected past/future day leaves #rcBody.past-day set (align-
        // items:center), which shrinks #weekendView to its content width instead of
        // stretching full-width — must clear it before rendering this weekend/override
        // card, same leak as the renderEmptyState() branches above.
        _rcShowPastMode(false);
        _syncOffsetFromKey(key);
        _setShiftCtaVisible(false);
        // Past _infoType days get Update Entry; today doesn't need it (editable inline)
        if (key < tk) { el('rcUpdateEntryBtn')?.classList.add('visible'); }
        else           { el('rcUpdateEntryBtn')?.classList.remove('visible'); }
        el('leaveChip').style.display = 'none';
        el('rcHeadDate')?.classList.remove('visible'); // date already on left — never duplicate on right
        el('rcBody')?.classList.add('weekend-mode');
        renderWeekendState(key, _infoType);
        return;
      }

      const headDateEl = el('rcHeadDate');
      if (key === tk) {
        // Today — clear past-day state before re-rendering so nothing flickers in
        _rcShowPastMode(false);
        _setShiftCtaVisible(true);
        el('rcUpdateEntryBtn')?.classList.remove('visible');
        el('leaveChip').style.display = '';
        if (headDateEl) { headDateEl.classList.remove('visible'); }
        if (loginDate) render(); else renderEmptyState();
      } else if (key < tk) {
        // Past day: show Update Entry button
        _setShiftCtaVisible(false);
        el('rcUpdateEntryBtn')?.classList.add('visible');
        el('leaveChip').style.display = 'none';
        if (headDateEl) { headDateEl.classList.remove('visible'); }
        renderPastDay(key);
      } else {
        // Future day: day selector already shows the date — nothing needed on right
        _setShiftCtaVisible(false);
        el('rcUpdateEntryBtn')?.classList.remove('visible');
        el('leaveChip').style.display = 'none';
        if (headDateEl) headDateEl.classList.remove('visible');
        renderPastDay(key);
      }
    }

    function _renderFutureDayBadge() {
      // The week-progress card belongs only to the Weekend view (a recap of the
      // last 7 days). Weekday future-day plan views never show it.
      const badgeCard = el('wkndBadgeCard');
      if (badgeCard) badgeCard.style.display = 'none';
    }

    function selectFutureDay(key) {
      selectedDayKey = key;
      try { sessionStorage.setItem('wh_sel_day', key); } catch {}
      _updateRunningElsewhereBanner();
      el('rcBody')?.classList.remove('weekend-mode');
      const _rcNumElF = document.querySelector('.rc-numbers');
      if (_rcNumElF) _rcNumElF.style.display = '';
      ['rcToday', 'stayHint', 'otBanner', 'doneBanner', 'autostopBanner'].forEach(id => {
        const _e = el(id); if (_e) _e.style.display = '';
      });
      renderDaySelector();

      // Future weekend day → weekend info card (not the work-day planner)
      if (isWeekendKey(key)) {
        // Same past-day-class leak as selectDay()/selectWeekendView() — clear before render.
        _rcShowPastMode(false);
        _syncOffsetFromKey(key);
        updateSelDayHeader(key); // sets rcDayLabel to day name ("Saturday") — not "Today"
        _setShiftCtaVisible(false);
        el('rcUpdateEntryBtn')?.classList.remove('visible');
        el('leaveChip').style.display = 'none';
        el('futureDayPlan').style.display = 'none';
        el('resultCard').style.display = '';
        el('rcHeadDate')?.classList.remove('visible'); // date already on left
        el('rcBody')?.classList.add('weekend-mode');
        renderWeekendState(key, 'weekend');
        return;
      }

      const wk = week(daySelectorWeekOffset), day = wk.find(d => d.key === key);
      const log = dayLog(key);

      _setShiftCtaVisible(false);
      el('rcUpdateEntryBtn')?.classList.remove('visible');
      el('leaveChip').style.display = 'none';
      el('rcHeadDate')?.classList.remove('visible'); // date already in day selector
      el('resultCard').style.display = 'none';
      el('futureDayPlan').style.display = '';
      el('futureDayQuestion').textContent = `Any plans for ${day?.name || 'this day'}?`;

      _renderFutureDayInline(key, log, day);
      _renderFutureDayBadge();
    }

    function _renderFutureDayInline(key, log, day) {
      const hasPlan   = !!(log?.futurePlan);
      const planKey   = log?.futurePlan;
      const isFresh   = _freshlySelectedPlanKeys.has(key); // picked this session, not yet confirmed
      const isConfirmed = hasPlan && !isFresh;
      const _OV_PLANS = new Set(['holiday', 'leave', 'halfday']);

      const planTypes = [
        { key: 'halfday', label: 'Half Day' },
        { key: 'leave',   label: 'Full Day Leave' },
        { key: 'holiday', label: 'Holiday' },
      ];

      // ── Chips area ──────────────────────────────────────────────────
      const chipsEl = el('futureDayChips');
      if (isConfirmed && _OV_PLANS.has(planKey)) {
        // Confirmed override → dashed info card, clicking opens Update Entry
        const _ovLabel = { holiday: 'Holiday', leave: 'Full Day Leave', halfday: 'Half Day' }[planKey];
        // Timing first (halfday only)
        let _timingLine = '';
        if (planKey === 'halfday') {
          const _sd = getShiftDefaults();
          const _login  = log?.loginDisplay    || _sd.start || '';
          const _logout = log?.checkoutDisplay || _sd.end   || '';
          const _t = [_login, _logout].filter(Boolean).join(' → ');
          if (_t) _timingLine = `<div style="font-size:13px;color:var(--muted-fg);margin-top:6px">${_escHtml(_t)}</div>`;
        }
        // Note below timing
        const _ovNote = log?.futureReason
          ? `<div style="font-size:13px;color:var(--muted-fg);margin-top:6px;line-height:1.5;white-space:pre-wrap">${_escHtml(log.futureReason)}</div>`
          : `<div style="margin-top:8px"><span data-on-click="h27129cfe3c" data-click-a0="${key}" style="display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--muted-fg);opacity:.55;cursor:pointer;text-decoration:none" data-on-mouseover="h745d1ed038" data-on-mouseout="h9ca1463baf"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>add description</span></div>`;
        chipsEl.innerHTML = `<div class="override-info-editable" style="width:100%;box-sizing:border-box;text-align:center" data-on-click="hd2a73229c7" data-click-a0="${key}">
          <div style="font-size:15px;font-weight:700;color:var(--foreground);margin-bottom:4px">${_ovLabel}</div>
          ${_timingLine}${_ovNote}
        </div>`;
      } else {
        // Normal chip buttons
        chipsEl.innerHTML = planTypes.map(p =>
          `<button class="modal-override-btn${planKey === p.key ? ' active' : ''}"
            data-on-click="hf0bed0e243" data-click-a0="${key}" data-click-a1="${p.key}">${p.label}</button>`
        ).join('');
      }

      // ── Reason field ─────────────────────────────────────────────────
      const reasonWrap = el('futureDayReasonWrap');
      if (reasonWrap) {
        // Hide reason for confirmed overrides (card replaces it), show for fresh picks
        const showReason = hasPlan && !(isConfirmed && _OV_PLANS.has(planKey));
        reasonWrap.style.display = showReason ? '' : 'none';
        const ta = el('futureDayReason');
        if (ta) ta.value = log?.futureReason || '';
      }

      // ── Question heading — hide once confirmed ───────────────────────
      const questionEl = el('futureDayQuestion');
      if (questionEl) questionEl.style.display = isConfirmed ? 'none' : '';

      // ── CTA buttons — hidden when confirmed, shown only for fresh picks ──
      const btnWrap    = el('futurePlanBtnWrap');
      const actionsDiv = el('futurePlanActions');
      if (btnWrap) btnWrap.classList.toggle('visible', hasPlan && !isConfirmed);

      if (hasPlan && !isConfirmed && actionsDiv) {
        actionsDiv.innerHTML = `
          <button class="btn-secondary" id="futurePlanDiscardBtn" style="height:36px;padding:0 16px;border-radius:10px;font-size:13px">Discard</button>
          <button class="shift-start-btn" id="futurePlanBtn" style="font-size:13px;height:36px;border-radius:10px;padding:0 20px;width:auto">Looks Good</button>`;
        const btn        = el('futurePlanBtn');
        const discardBtn = el('futurePlanDiscardBtn');
        if (btn)        btn.onclick        = () => toggleFuturePlanMode(key);
        if (discardBtn) discardBtn.onclick = () => _openCancelPlanModal(key);
      }
    }

    function _selectFuturePlanType(key, planKey, btn) {
      const log = dayLog(key) || {};
      const wasActive = btn.classList.contains('active');

      // Toggle selection
      el('futureDayChips').querySelectorAll('.modal-override-btn').forEach(b => b.classList.remove('active'));
      if (wasActive) return; // already selected — only Cancel Plan button can remove it
      btn.classList.add('active');
      saveDayLog(key, { ...log, futurePlan: planKey });
      _freshlySelectedPlanKeys.add(key); // fresh pick — not yet confirmed
      _renderFutureDayInline(key, dayLog(key), week(daySelectorWeekOffset).find(d => d.key === key));
      _renderFutureDayBadge();
    }

    let _futurePlanKey = null; // tracks which day the cancel modal targets
    // Day keys where chip was just picked this session but "Looks Good" not yet clicked.
    // Any key NOT in this set that already has a plan shows "Cancel Plan" on render.
    const _freshlySelectedPlanKeys = new Set();

    function toggleFuturePlanMode(key) {
      _freshlySelectedPlanKeys.delete(key);
      saveDayLogAndSync(key, dayLog(key)); // commit chip + reason together as one push
      _renderFutureDayInline(key, dayLog(key), week(daySelectorWeekOffset).find(d => d.key === key));
      _renderFutureDayBadge();
    }

    function _openCancelPlanModal(key) {
      const log = dayLog(key) || {};
      // No note written — discard directly without confirmation
      if (!log.futureReason?.trim()) {
        _futurePlanKey = key;
        _confirmCancelPlan();
        return;
      }
      _futurePlanKey = key;
      const day = week(daySelectorWeekOffset).find(d => d.key === key);
      const desc = el('cancelPlanDesc');
      if (desc) desc.textContent = `You want to cancel your plan for ${day?.name || 'this day'}.`;
      const confirmBtn = el('cancelPlanConfirmBtn');
      if (confirmBtn) confirmBtn.onclick = () => _confirmCancelPlan();
      el('cancelPlanOverlay').classList.add('open');
    }

    function _confirmCancelPlan() {
      const key = _futurePlanKey;
      if (!key) return;
      el('cancelPlanOverlay').classList.remove('open');
      const log = dayLog(key) || {};
      const updated = { ...log }; delete updated.futurePlan; delete updated.futureReason;
      saveDayLogAndSync(key, updated);
      _freshlySelectedPlanKeys.delete(key);
      _futurePlanKey = null;
      _renderFutureDayInline(key, dayLog(key), week(daySelectorWeekOffset).find(d => d.key === key));
      _renderFutureDayBadge();
    }

    function saveFutureDayReason(val) {
      const log = dayLog(selectedDayKey) || {};
      if (!log.futurePlan) return;
      saveDayLog(selectedDayKey, { ...log, futureReason: val });
    }


    // Override label helper used in past-day view
    function overrideLabel(ov) {
      if (ov === 'holiday') return '<span style="font-size:12px;font-weight:600;color:#a855f7;background:rgba(168,85,247,.12);padding:2px 8px;border-radius:6px;border:1px solid rgba(168,85,247,.3)">Holiday</span>';
      if (ov === 'leave')   return '<span style="font-size:12px;font-weight:600;color:#3b82f6;background:rgba(59,130,246,.12);padding:2px 8px;border-radius:6px;border:1px solid rgba(59,130,246,.3)">Full Day Leave</span>';
      if (ov === 'halfday') return '<span style="font-size:12px;font-weight:600;color:#0ea5e9;background:rgba(14,165,233,.12);padding:2px 8px;border-radius:6px;border:1px solid rgba(14,165,233,.3)">Half Day</span>';
      return '';
    }

    // Builds the two bottom KPI cards for past/future days.
    // Shows Duration (loginTime → logoutTime with arrow) + Surplus card.
    // Shared "Update Entry" button markup. Used by past days and by today once the
    // session has ended — in that state the shift CTA resets to "Start" (which would
    // begin a NEW session), so this is the only way to correct the day's times.
    function _updateEntryBtnHtml() {
      const pencil = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      return `<button data-on-click="hf5017a9390" style="display:inline-flex;align-items:center;gap:6px;padding:7px 16px;border-radius:8px;border:1.5px solid var(--border);background:var(--muted);color:var(--foreground);font-family:var(--font);font-size:13px;font-weight:500;cursor:pointer;transition:background .15s">${pencil}Update Entry</button>`;
    }

    function _pastDayKpiHtml(loginDisp, outDisp, workedSecs, targetSecs) {
      const arrow = `<span style="display:inline-flex;align-items:center;color:var(--muted-fg);margin:0 6px"><svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M5 12H19M19 12L13 6M19 12L13 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;
      // Duration alongside the times — "how long" is the thing you actually judge
      // the day by, and deriving it from two clock times in your head is friction.
      const durPart = workedSecs != null
        ? `<span style="color:var(--muted-fg);font-weight:500;margin-left:8px">(${durWorked(workedSecs)})</span>`
        : '';
      const ioLine = `<div style="display:inline-flex;align-items:center;font-size:16px;font-weight:600;letter-spacing:-.3px;line-height:1.2">${loginDisp}${arrow}${outDisp}${durPart}</div>`;
      let msgLine = '';
      if (workedSecs != null && targetSecs != null) {
        const diff = workedSecs - targetSecs;
        if (diff < -300) {
          msgLine = `<span style="font-size:12px;color:var(--muted-fg)">You missed the target by ${dur(Math.abs(diff))}</span>`;
        } else if (diff > 300) {
          msgLine = `<span style="font-size:12px;color:var(--success)">You worked ${dur(diff)} more. Overtime!</span>`;
        }
      }
      return `<div style="display:flex;flex-direction:column;align-items:center;gap:10px;padding:4px 0">${ioLine}${msgLine}${_updateEntryBtnHtml()}</div>`;
    }

    function renderPastDay(key) {
      _hideSkeleton();
      _rcShowPastMode(true); // hide tabs, progress bar, desc row for past/future days
      const c = cfg(), log = dayLog(key);
      const target = c.dailyH * 3600;
      const _pastDay = week(daySelectorWeekOffset).find(d => d.key === key);
      const _dayName = _pastDay?.name || 'Day';
      const _targetLabel = _dayName + "'s Target";

      // Helper: reset all card state cleanly (no session data)
      function _clearCardState() {
        swapText('rcElapsedLabel', '', { color: '' });
        showRem(false);
        if (el('rcTargetLabel')) swapText('rcTargetLabel', 'Remaining');
        el('stayHint').style.display = 'none';
        el('otBanner').classList.remove('show');
        el('doneBanner').classList.remove('show');
        el('autostopBanner')?.classList.remove('show');
      }
      // holiday / leave / halfday are routed through weekendView by selectDay — dead path

      const isFutureDay = key > todayKey();
      const targetRow = isFutureDay
        ? `<div class="wk-target-row"><span class="section-label">Recommended</span><div class="wk-target-right"><span class="wk-target-val">${dur(target)}</span></div></div>`
        : '';

      // Clear the big-number right column — surplus shown in KPI box below
      if (el('rcTarget')) { el('rcTarget').textContent = ''; el('rcTarget').style.color = ''; }
      if (el('rcTargetLabel')) el('rcTargetLabel').textContent = '';

      if (!log || log.hoursWorked == null) {
        const _rcNumEl = document.querySelector('.rc-numbers');
        if (_rcNumEl) _rcNumEl.style.display = 'none';
        el('rcKpiGroup').style.display = 'none';
        _setTodayDateChip();
        el('stayHint').style.display = 'none';
        el('otBanner').classList.remove('show'); el('doneBanner').classList.remove('show');
        const _emptyMsg = isFutureDay ? '' : `<div style="display:flex;flex-direction:column;align-items:center;gap:14px;padding:8px 0">
          <span style="font-size:13px;color:var(--muted-fg)">No logs recorded</span>
          <button data-on-click="hf5017a9390" style="display:inline-flex;align-items:center;gap:6px;padding:7px 16px;border-radius:8px;border:1.5px solid var(--border);background:var(--muted);color:var(--foreground);font-family:var(--font);font-size:13px;font-weight:500;cursor:pointer;transition:background .15s"><svg width="13" height="13" viewBox="0 0 13 13" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6.5 1v11M1 6.5h11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>Add Entry</button>
        </div>`;
        const _noDataContent = _emptyMsg + targetRow;
        el('rcToday').innerHTML = _noDataContent;
        el('rcToday').style.display = _noDataContent ? '' : 'none';
        return;
      }
      // Past day with data: all display lives in rcToday, hide the KPI group
      el('rcKpiGroup').style.display = 'none';
      el('rcWorked').textContent = ''; el('rcWorked').style.color = '';
      swapText('rcElapsedLabel', '', { color: '' });
      const worked = Math.round(log.hoursWorked * 3600);
      el('otBanner').classList.remove('show');
      el('doneBanner').classList.remove('show');
      _setTodayDateChip();
      el('stayHint').style.display = 'none';
      const loginDisp = log.loginDisplay || _loginDisplayFromLog(log);
      const outDisp   = _checkoutDisplayFromLog(log);
      el('rcToday').style.display = '';
      el('rcToday').innerHTML = targetRow + _pastDayKpiHtml(loginDisp, outDisp, worked, target);
    }

    // ── HISTORY CARD ───────────────────────────────────
    function isEarlyLogin(log) {
      if (!log?.loginTime) return false;
      const parts = log.loginTime.split(':').map(Number);
      return parts[0] < 9; // before 9 AM
    }

    function isLateLogin(log) {
      if (!log?.loginTime) return false;
      const parts = log.loginTime.split(':').map(Number);
      return parts[0] >= 10; // after 10 AM considered late
    }

    // ── WEEK CARD ───────────────────────────────────────
    // One row per work day: date tile · what kind of day it was · ± vs target · hours.
    // The footer shows time "In hand" (banked from finished days) and when the
    // weekly target will be reached at the current pace ("On track for").

    // Signed difference for the ± chips: "+2mins", "−30mins", "+2h 05mins", "+1min".
    function wkSigned(secs) {
      const sign = secs >= 0 ? '+' : '−';
      const totalMin = Math.round(Math.abs(secs) / 60);
      const h = Math.floor(totalMin / 60), m = totalMin % 60;
      const mins = m === 1 ? '1min' : `${h ? p2(m) : m}mins`;
      return sign + (h ? `${h}h${m ? ' ' + mins : ''}` : mins);
    }
    // The same difference in words, for screen readers.
    function wkSpoken(secs) {
      const totalMin = Math.round(Math.abs(secs) / 60);
      const h = Math.floor(totalMin / 60), m = totalMin % 60;
      const parts = [];
      if (h) parts.push(h + (h === 1 ? ' hour' : ' hours'));
      if (m) parts.push(m + (m === 1 ? ' minute' : ' minutes'));
      return parts.join(' ') + (secs >= 0 ? ' overtime' : ' remaining');
    }

    // Lucide icons (MIT) used by the week card. Size comes from CSS.
    const WK_ICON = {
      holiday: '<path d="M5.8 11.3 2 22l10.7-3.79"/><path d="M4 3h.01"/><path d="M22 8h.01"/><path d="M15 2h.01"/><path d="M22 20h.01"/><path d="m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10"/><path d="m22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11c-.11.7-.72 1.22-1.43 1.22H17"/><path d="m11 2 .33.82c.34.86-.2 1.82-1.11 1.98C9.52 4.9 9 5.52 9 6.23V7"/><path d="M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2Z"/>',
      leave:   '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
      halfday: '<path d="M12 10V2"/><path d="m4.93 10.93 1.41 1.41"/><path d="M2 18h2"/><path d="M20 18h2"/><path d="m19.07 10.93-1.41 1.41"/><path d="M22 22H2"/><path d="m16 6-4 4-4-4"/><path d="M16 18a4 4 0 0 0-8 0"/>',
      missing: '<path d="M12 6v6l4 2"/><path d="M16 21.16a10 10 0 1 1 5-13.516"/><path d="M20 11.5v6"/><path d="M20 21.5h.01"/>',
      auto:    '<path d="M10 2h4"/><path d="M4.6 11a8 8 0 0 0 1.7 8.7 8 8 0 0 0 8.7 1.7"/><path d="M7.4 7.4a8 8 0 0 1 10.3 1 8 8 0 0 1 .9 10.2"/><path d="m2 2 20 20"/><path d="M12 12v-2"/>',
      early:   '<path d="M13 4h3a2 2 0 0 1 2 2v14"/><path d="M2 20h3"/><path d="M13 20h9"/><path d="M10 12v.01"/><path d="M13 4.562v16.157a1 1 0 0 1-1.242.97L5 20V5.562a2 2 0 0 1 1.515-1.94l4-1A2 2 0 0 1 13 4.561Z"/>',
      late:    '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
      plus:    '<path d="M5 12h14"/><path d="M12 5v14"/>',
      pause:   '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
      check:   '<path d="M20 6 9 17l-5-5"/>',
    };
    const wkSvg = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${WK_ICON[name]}</svg>`;

    // Everything the footer needs, kept so the live tick can redo just the footer.
    let _wkCtx = null;

    // How a day reads in the week card. Pure: depends only on the log and flags.
    // Returns { kind, label, line, hrsSecs, diffSecs, tone, icon, today }.
    function wkDayModel(log, { isToday, isPast, isFuture, live, liveSecs, dailySecs }) {
      const ov = log?.override || (isFuture ? log?.futurePlan : null);
      const worked = log?.hoursWorked != null ? Math.round(log.hoursWorked * 3600) : 0;
      if (ov === 'holiday') return { kind: 'holiday', label: 'Holiday', line: log?.futureReason ? `${log.futureReason} · enjoy the day off` : 'Enjoy the day off', tone: 'orchid', icon: 'holiday' };
      if (ov === 'leave')   return { kind: 'leave', label: 'On leave', line: 'Out of office · recharge', tone: 'blue', icon: 'leave' };
      if (ov === 'halfday') return { kind: 'halfday', label: 'Half day', line: log?.checkoutDisplay ? `Done by ${log.checkoutDisplay}` : 'Half the hours today', tone: 'teal', icon: 'halfday', hrsSecs: worked || null };
      if (isFuture) {
        if (log?.futurePlan === 'early') return { kind: 'early', label: 'Leaving early', line: log.planEndTime ? `Planned · out at ${log.planEndTime}` : 'Planned', tone: 'blue', icon: 'early', future: true };
        if (log?.futurePlan === 'late')  return { kind: 'late', label: 'Staying late', line: log.planEndTime ? `Planned · till ${log.planEndTime}` : 'Planned', tone: 'violet', icon: 'late', future: true };
        return { kind: 'future', future: true };
      }
      if (isToday) {
        if (live) return { kind: 'running', hrsSecs: liveSecs, today: true };
        const paused = log && log.sessionDate === todayKey() && !log.checkoutTime && worked > 0 && !log.autostopped;
        if (paused) return { kind: 'paused', line: log.checkoutDisplay ? `Paused at ${log.checkoutDisplay}` : 'Paused', hrsSecs: worked, today: true };
      }
      if (log?.autostopped && worked > 0) return { kind: 'auto', label: 'Auto-stopped', line: log.checkoutDisplay ? `Stopped for you at ${log.checkoutDisplay}` : 'Stopped for you', tone: 'warning', icon: 'auto', hrsSecs: worked, diffSecs: worked - dailySecs, today: isToday };
      if (worked > 0) {
        if (isToday) {
          const over = worked >= dailySecs;
          return { kind: over ? 'done' : 'left', line: log?.checkoutDisplay ? `${over ? 'Done' : 'Left'} at ${log.checkoutDisplay}` : (over ? 'Done' : 'Ended'), hrsSecs: worked, diffSecs: worked - dailySecs, today: true };
        }
        return { kind: 'worked', hrsSecs: worked, diffSecs: worked - dailySecs };
      }
      if (isPast) return { kind: 'missing', label: 'Missing entry', line: 'No hours logged yet', tone: 'destructive', icon: 'missing' };
      return { kind: 'empty', today: isToday };
    }

    function _wkRowHTML(day, m, isToday) {
      const d = day.date;
      const tile = `<span class="wk-tile" aria-hidden="true"><span class="wk-tile-n">${day.name.slice(0, 3)}</span><span class="wk-tile-d">${d.getDate()}</span></span>`;
      let mid = '';
      if (m.icon) {
        mid = `<span class="wk-type" style="--k:var(--${m.tone})"><span class="wk-type-ic">${wkSvg(m.icon)}</span>`
            + `<span class="wk-type-txt"><span class="wk-type-lbl">${m.label}</span><span class="wk-type-line">${_escHtml(m.line || '')}</span></span></span>`;
      } else if (m.kind === 'running') {
        mid = '<span class="wk-now is-run"><span class="wk-live-dot"></span><span class="wk-now-t">Running</span></span>';
      } else if (m.kind === 'paused') {
        mid = `<span class="wk-now is-pause">${wkSvg('pause')}<span class="wk-now-t">${_escHtml(m.line)}</span></span>`;
      } else if (m.kind === 'done' || m.kind === 'left') {
        mid = `<span class="wk-now ${m.kind === 'done' ? 'is-done' : 'is-left'}">${wkSvg(m.kind === 'done' ? 'check' : 'early')}<span class="wk-now-t">${_escHtml(m.line)}</span></span>`;
      }
      // ± chip only for finished days (a running or paused day has nothing to settle yet).
      const showDiff = m.diffSecs != null && Math.abs(m.diffSecs) >= 60;
      const chip = showDiff
        ? `<span class="wk-chip ${m.diffSecs > 0 ? 'is-over' : 'is-short'}" aria-label="${wkSpoken(m.diffSecs)}">${wkSigned(m.diffSecs)}</span>`
        : '';
      const end = m.kind === 'missing'
        ? `<button type="button" class="btn-secondary wk-add">${wkSvg('plus')}Add hours</button>`
        : (m.hrsSecs ? `<span class="wk-hrs${m.kind === 'running' ? ' is-live' : ''}">${durWorked(m.hrsSecs)}</span>` : '<span class="wk-hrs is-none">–</span>');
      const cls = ['wk-row', isToday ? 'today' : '', m.future ? 'is-future' : '', m.kind === 'missing' ? 'is-missing' : ''].filter(Boolean).join(' ');
      return `<div class="${cls}" role="button" tabindex="0" data-day-key="${day.key}"${isToday ? ' aria-current="date"' : ''}>`
           + `${tile}<span class="wk-mid">${mid}</span><span class="wk-end">${chip}${end}</span></div>`;
    }

    // Footer: "In hand" (net banked time from finished days) and "On track for"
    // (when the weekly target is reached at the average pace of finished days).
    // A missing day counts as 0 hours worked: it owes its target (so it pulls
    // "In hand" down) but it never hides the forecast and doesn't drag the pace.
    function wkFooterModel(ctx, liveSecs, now) {
      const { days, dailySecs, weekTarget, offset } = ctx;
      let banked = 0, finishedSecs = 0, finishedCount = 0, total = 0;
      const loginMins = [];
      for (const x of days) {
        const target = x.m.kind === 'halfday' ? dailySecs / 2 : (x.m.kind === 'holiday' || x.m.kind === 'leave') ? 0 : dailySecs;
        const secs = x.m.kind === 'running' ? liveSecs : (x.m.hrsSecs || 0);
        total += secs;
        const finished = !x.m.future && x.m.kind !== 'running' && x.m.kind !== 'paused' && x.m.kind !== 'empty' && x.m.kind !== 'missing' && target > 0 && secs > 0;
        if (x.m.kind === 'missing') banked -= target; // nothing logged: the whole target is owed
        if (finished) {
          banked += secs - target;
          finishedSecs += secs * (dailySecs / target); finishedCount++;
          if (x.loginMin != null) loginMins.push(x.loginMin);
        }
      }
      const left = banked >= 60 ? { k: 'In hand', v: '+' + durWorked(banked), tone: 'over' }
                 : banked <= -60 ? { k: 'Behind by', v: durWorked(-banked), tone: 'short' }
                 : { k: 'In hand', v: 'None', tone: 'none' };
      let right;
      if (offset < 0) right = { k: 'Week total', v: durWorked(total) };
      else if (weekTarget > 0 && total >= weekTarget) right = { k: 'Target met', v: durWorked(total) };
      else {
        // Simulate the rest of the week at the current pace.
        const pace = finishedCount ? finishedSecs / finishedCount : dailySecs;
        const startMin = loginMins.length ? Math.round(loginMins.reduce((a, b) => a + b, 0) / loginMins.length) : 9 * 60;
        let need = weekTarget - total, when = null;
        for (const x of days) {
          if (need <= 0 || when) break;
          const isToday = x.m.today;
          if (!isToday && !x.m.future) continue;
          const kindTarget = (x.m.kind === 'holiday' || x.m.kind === 'leave') ? 0 : (x.m.kind === 'halfday' ? pace / 2 : pace);
          if (kindTarget <= 0) continue;
          let start, done = 0;
          if (isToday) {
            if (x.m.kind === 'done' || x.m.kind === 'left' || x.m.kind === 'auto') continue;
            start = now.getTime(); done = x.m.kind === 'running' ? liveSecs : (x.m.hrsSecs || 0);
          } else {
            const d = new Date(x.day.date); d.setHours(0, startMin, 0, 0); start = d.getTime();
          }
          const room = Math.max(0, kindTarget - done);
          if (room >= need) when = new Date(start + need * 1000);
          else need -= room;
        }
        right = when
          ? { k: 'On track for', v: `${dateKey(when) === todayKey() ? 'Today' : when.toLocaleDateString('en-US', { weekday: 'short' })}, ${short(when)}` }
          : { k: 'On track for', v: 'Not this week', tone: 'none' };
      }
      return { left, right };
    }

    function _renderWkFooter(liveSecs) {
      const f = el('wkFooter');
      if (!f || !_wkCtx) return;
      const { left, right } = wkFooterModel(_wkCtx, liveSecs || 0, new Date());
      const lk = el('wkHandLabel'), lv = el('wkHandVal'), rk = el('wkTrackLabel'), rv = el('wkTrackVal');
      if (!lk) return;
      lk.textContent = left.k; lv.textContent = left.v; lv.dataset.tone = left.tone || '';
      rk.textContent = right.k; rv.textContent = right.v; rv.dataset.tone = right.tone || '';
    }

    // Live-tick the week card while a session runs: only today's hours and the
    // footer change, so rewrite just those instead of rebuilding every row.
    function _tickWkLiveRow() {
      if (!loginDate) return;
      const hrs = document.querySelector('#wkRows .wk-row.today .wk-hrs.is-live');
      if (!hrs) return; // today isn't in the week being viewed
      const worked = _sessionAccSecs + Math.max(0, Math.floor((new Date() - loginDate) / 1000));
      hrs.textContent = durWorked(worked);
      _renderWkFooter(worked);
    }

    function renderHistory() {
      const c = cfg(), wk = week(analyticsWeekOffset), tk = todayKey();
      const rows = el('wkRows');
      if (!rows) return;
      // The card's title lives here, not only in renderAnalytics(): on Home the
      // Dashboard tab no longer exists, and the HTML placeholder showed instead.
      el('wkNavLabel').textContent = analyticsWeekOffset === 0 ? 'This Week' : weekRangeLabel(analyticsWeekOffset);
      el('wkNextBtn').disabled = analyticsWeekOffset >= 0;
      const dailySecs = c.dailyH * 3600;
      const live = !!loginDate;
      const liveSecs = live ? _sessionAccSecs + Math.max(0, Math.floor((new Date() - loginDate) / 1000)) : 0;
      const days = wk.map(day => {
        const log = dayLog(day.key);
        const isToday = day.key === tk && analyticsWeekOffset === 0;
        const isPast = !isToday && day.key < tk;
        const isFuture = !isToday && day.key > tk;
        const m = wkDayModel(log, { isToday, isPast, isFuture, live: isToday && live, liveSecs, dailySecs });
        const lt = (log?.loginTime || '').split(':').map(Number);
        const loginMin = lt.length >= 2 && !isNaN(lt[0]) ? lt[0] * 60 + (lt[1] || 0) : null;
        return { day, log, m, isToday, loginMin };
      });
      rows.innerHTML = days.map(x => _wkRowHTML(x.day, x.m, x.isToday)).join('');
      rows.querySelectorAll('.wk-row').forEach(r => {
        const open = () => openDayEditModal(r.dataset.dayKey);
        r.addEventListener('click', open);
        r.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
      });
      _wkCtx = { days, dailySecs, weekTarget: c.weeklyOn ? adjustedWeeklyTarget(wk) : dailySecs * wk.length, offset: analyticsWeekOffset };
      _renderWkFooter(liveSecs);

      renderNotifs();
      // Refresh day-selector dots when history changes
      if (analyticsWeekOffset === 0) renderDaySelector();
    }


    function setDayOverride(key, type) {
      const c = cfg();
      const ex = dayLog(key) || {};
      if (type === 'halfday') {
        saveDayLogAndSync(key, { ...ex, hoursWorked: c.dailyH / 2, override: type });
      } else if (type === 'holiday' || type === 'leave') {
        saveDayLogAndSync(key, { ...ex, hoursWorked: 0, override: type });
      }
      renderHistory();
      document.querySelectorAll('.wk-dropdown.open').forEach(d => d.classList.remove('open'));
    }

    function saveDayEdit(key) {
      const startEl = el('dStart-' + key), endEl = el('dEnd-' + key);
      const s = parse(startEl.value), e = parse(endEl.value);
      if (!s || !e || e <= s) { startEl.style.borderColor = 'var(--destructive)'; return; }
      startEl.style.borderColor = '';
      const workedSecs = Math.floor((e - s) / 1000);
      const ex = dayLog(key) || {};
      saveDayLogAndSync(key, { ...ex,
        loginTime: `${s.getHours()}:${s.getMinutes()}:${s.getSeconds()}`,
        loginDisplay: short(s),
        checkoutDisplay: short(e),
        hoursWorked: workedSecs / 3600,
        lastUpdated: new Date().toISOString()
      });
      renderHistory();
      document.querySelectorAll('.wk-dropdown.open').forEach(d => d.classList.remove('open'));
    }

    // ── CALCULATE ──────────────────────────────────────
    function showErr(msg) {
      el('errMsg').textContent = msg;
      el('errMsg').classList.add('show');
      // P12 — shake the input row
      const row = el('shiftInputRow');
      if (row) {
        row.classList.remove('p12-shaking');
        void row.offsetWidth;
        row.classList.add('p12-shaking');
        row.addEventListener('animationend', () => row.classList.remove('p12-shaking'), { once: true });
      }
      loginDate = null; wasDone = false; notifSent = false;
      if (ticker) { clearInterval(ticker); ticker = null; }
      renderEmptyState();
    }

    // ── SPLIT BUTTON STATE ────────────────────────────
    function setCalcBtnState(state) {
      const btn = el('calcBtn'), chev = el('calcBtnChevron'),
            dd  = el('calcBtnDropdown'), wrap = el('calcBtnWrap');
      if (!btn) return;
      // Every session start/pause/end path calls this to update the button, so it's
      // the one reliable choke point for keeping the "session running elsewhere"
      // banner in sync too — without it, ending a session while browsing a past/
      // future day left the banner stuck showing "Session running" forever, since
      // none of checkout()/doAutoStop()/endSession() refreshed it themselves.
      _updateRunningElsewhereBanner();
      // Same reasoning for the Dashboard's week card: starting/pausing/ending a
      // session changes today's row, but none of those paths rebuild it, so it
      // kept a stale live pill and Total Hours. Only when the week card is
      // actually on screen (Home, since the new shell folded Dashboard into it).
      if (el('wkRows')?.offsetParent) renderHistory();
      btn.classList.remove('end-shift', 'pause-shift', 'resume-shift');
      btn.disabled = false;
      btn.dataset.state = state;
      if (dd) dd.style.display = 'none';
      const _svgPlay = '<svg width="12" height="12" viewBox="0 0 24 24" style="flex-shrink:0"><path fill="currentColor" d="M7 4v16l13-8z"/></svg>';
      const _svgPause = '<svg width="12" height="12" viewBox="0 0 24 24" style="flex-shrink:0"><rect fill="currentColor" x="6" y="5" width="4" height="14" rx="1"/><rect fill="currentColor" x="14" y="5" width="4" height="14" rx="1"/></svg>';
      const _svgStop = '<svg width="12" height="12" viewBox="0 0 24 24" style="flex-shrink:0"><rect fill="currentColor" x="5" y="5" width="14" height="14" rx="2"/></svg>';
      if (state === 'done') {
        btn.innerHTML = '<span style="display:flex;align-items:center;gap:6px;justify-content:center">' + _svgStop + 'End</span>';
        btn.classList.add('end-shift');
        wrap?.classList.remove('split-btn-wrap');
        if (chev) chev.style.display = 'none';
      } else if (state === 'running') {
        const breakOn = cfg().breakTime !== false;
        if (breakOn) {
          btn.innerHTML = '<span style="display:flex;align-items:center;gap:6px;justify-content:center">' + _svgPause + 'Pause</span>';
          btn.classList.add('pause-shift');
          wrap?.classList.add('split-btn-wrap');
          if (chev) { chev.style.display = ''; chev.className = 'split-chevron-btn pause-shift-chev'; }
        } else {
          btn.innerHTML = '<span style="display:flex;align-items:center;gap:6px;justify-content:center">' + _svgStop + 'End</span>';
          btn.classList.add('end-shift');
          wrap?.classList.remove('split-btn-wrap');
          if (chev) chev.style.display = 'none';
        }
        const loginInpR = el('tc-r7m2');
        if (loginInpR) { loginInpR.value = ''; }
        _tpSegClear();
        _tcSetLabel('Update Login Time');
      } else if (state === 'ended') {
        btn.innerHTML = '<span style="display:flex;align-items:center;gap:6px;justify-content:center">' + _svgPlay + 'Resume</span>';
        btn.classList.add('resume-shift');
        wrap?.classList.add('split-btn-wrap');
        if (chev) { chev.style.display = ''; chev.className = 'split-chevron-btn resume-shift-chev'; }
        _tcSetLabel('Update Login Time');
      } else { // 'start' — plain full-width button, no split styling
        btn.innerHTML = '<span style="display:flex;align-items:center;gap:6px;justify-content:center">' + _svgPlay + 'Start</span>';
        wrap?.classList.remove('split-btn-wrap');
        if (chev) chev.style.display = 'none';
        _tcSetLabel('Enter Login Time');
      }
    }

    let _pendingLoginP = null;
    function _startSession(p) {
      el('tc-r7m2').classList.remove('err');
      el('errMsg').classList.remove('show');
      const hint = el('loginApHint'); if (hint) hint.style.display = 'none';
      loginDate = p; wasDone = false; notifSent = false; autoStopped = false;
      if (el('metaLogin')) el('metaLogin').textContent = short(p);
      setCalcBtnState('running');
      el('shiftInputRow').classList.add('active-state');
      el('shiftActiveLabel').textContent = `Started at ${short(p)}`;
      el('autostopBanner').classList.remove('show');
      persistSession();
      selectDay(todayKey());
      _rcTransitionToActive();
      render();
      if (ticker) clearInterval(ticker);
      ticker = setInterval(render, 1000);
      scheduleNotifications(loginDate.toISOString());
      _startCheckpoint(); // periodic sync while session active
      _syncNow();         // immediately push the start event
    }
    function isOutsideShift(p) {
      const c = cfg();
      const s = parse(c.shiftStart || '09:00 AM');
      if (!s) return false;
      const pM = p.getHours() * 60 + p.getMinutes();
      const sM = s.getHours() * 60 + s.getMinutes();
      // Block only when logging in 60+ minutes before shift start
      return sM - pM >= 60;
    }
    function showOutsideShiftModal(p) {
      _pendingLoginP = p;
      const c = cfg();
      const r = el('outsideShiftRange');
      if (r) r.textContent = `${c.shiftStart || '09:00 AM'} – ${c.shiftEnd || '06:00 PM'}`;
      el('outsideShiftOverlay')?.classList.add('open');
    }
    function closeOutsideShiftModal() {
      _pendingLoginP = null;
      el('outsideShiftOverlay')?.classList.remove('open');
    }
    function overrideOutsideShift() {
      const p = _pendingLoginP;
      el('outsideShiftOverlay')?.classList.remove('open');
      _pendingLoginP = null;
      if (p) _startSession(p);
    }
    function calculate() {
      const raw = el('tc-r7m2').value.trim();
      let p;
      if (raw) {
        p = parseLogin(raw);
        if (!p) { showErr("Couldn't parse that. Try: 11:30, 1130, 11:30 AM, or 13:30"); return; }
      } else {
        p = new Date();
      }
      // If there's already an active session and the new time is within 1 hour
      // of the current login, it's a small correction — skip the outside-shift warning.
      const isSmallCorrection = loginDate && Math.abs(p - loginDate) <= 3600000;
      if (isOutsideShift(p) && !isSmallCorrection) { showOutsideShiftModal(p); return; }

      // If hours already exist for today (ended session), show "Continue?" modal
      const todayLog = dayLog(todayKey());
      const existingSecs = _sessionAccSecs > 0
        ? _sessionAccSecs
        : (todayLog?.hoursWorked ? Math.round(todayLog.hoursWorked * 3600) : 0);
      if (existingSecs > 0 && !loginDate) {
        openContinueWorkingModal(p, existingSecs);
        return;
      }
      _startSession(p);
    }

    // ── CONTINUE WORKING MODAL ────────────────────────
    let _cwPendingLogin = null;
    function openContinueWorkingModal(pendingLogin, existingSecs) {
      _cwPendingLogin = pendingLogin;
      el('continueWorkingHours').textContent = dur(existingSecs);
      el('continueWorkingDesc').textContent =
        `You've already logged ${dur(existingSecs)} today. New hours will be added on top.`;
      el('continueWorkingOverlay').classList.add('open');
    }

    function clearLogin() {
      cancelScheduledNotifications(); // cancel any pending push notifications
      loginDate = null; wasDone = false; notifSent = false; autoStopped = false;
      _sessionAccSecs = 0; _sessionCheckoutTime = null;
      Store.clearSession();
      if (ticker) { clearInterval(ticker); ticker = null; }
      el('tc-r7m2').value = '';
      el('tc-r7m2').classList.remove('err');
      el('errMsg').classList.remove('show');
      // Restore CTA to Quick Start (sets _tcLabel to 'Enter Login Time' first)
      setCalcBtnState('start');
      _tcDeactivate();
      el('shiftInputRow').classList.remove('active-state', 'hidden');
      el('autostopBanner').classList.remove('show');
      selectedDayKey = todayKey();
      _setShiftCtaVisible(true);
      el('rcUpdateEntryBtn')?.classList.remove('visible');
      updateSelDayHeader(selectedDayKey);
      renderEmptyState();
      renderDaySelector();
    }

    // ── SETTINGS ───────────────────────────────────────
    // Make each labeled settings section collapsible (chevron toggle, state
    // persisted). Idempotent — safe to call every time settings opens.
    function initCollapsibleSettings() {
      document.querySelectorAll('.settings-card-merged .settings-section').forEach(section => {
        const header = section.querySelector('.settings-section-header');
        if (!header || header.dataset.collapsible) return;
        header.dataset.collapsible = '1';
        const key = header.textContent.trim();
        const chev = document.createElement('span');
        chev.className = 'settings-chevron';
        chev.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
        header.appendChild(chev);
        // Wrap everything after the header so it can be smoothly slid open/closed.
        const inner = document.createElement('div');
        inner.className = 'settings-section-body-inner';
        while (header.nextSibling) inner.appendChild(header.nextSibling);
        section.appendChild(inner);
        // All sections start expanded; no state persisted to localStorage.
        header.addEventListener('click', () => {
          const willCollapse = !section.classList.contains('collapsed');
          if (willCollapse) {
            inner.style.maxHeight = inner.scrollHeight + 'px';
            requestAnimationFrame(() => {
              section.classList.add('collapsed');
              inner.style.maxHeight = '0px';
            });
          } else {
            section.classList.remove('collapsed');
            inner.style.maxHeight = inner.scrollHeight + 'px';
            const done = () => { if (!section.classList.contains('collapsed')) inner.style.maxHeight = ''; inner.removeEventListener('transitionend', done); };
            inner.addEventListener('transitionend', done);
          }
        });
      });
    }

    function populateSettings() {
      const c = cfg();
      initCollapsibleSettings();
      el('inpDisplay').value   = c.name || '';
      el('inpCompany').value   = c.company || '';
      el('inpPosition').value  = c.position || '';
      const _dh = Math.floor(c.dailyH || 9);
      const _dm = Math.round(((c.dailyH || 9) - _dh) * 60);
      el('inpDailyH').value = _dh;
      el('inpDailyM').value = _dm;
      const _wh = Math.floor(c.weeklyH || 45);
      const _wm = Math.round(((c.weeklyH || 45) - _wh) * 60);
      el('inpWeeklyH').value    = _wh;
      el('inpWeeklyM').value    = _wm;
      el('inpWeeklyOn').checked = c.weeklyOn;
      el('inpNotifOn').checked  = c.notifOn;
      if (el('inpNotifTarget'))    el('inpNotifTarget').checked    = c.notifTarget    !== false;
      if (el('inpNotifKickstart')) el('inpNotifKickstart').checked = c.notifKickstart !== false;
      if (el('inpNotifOvertime'))  el('inpNotifOvertime').checked  = c.notifOvertime  !== false;
      // Restore sub-toggle visibility if notifications are already on
      const _nsg = el('notifSubGroup');
      if (_nsg && c.notifOn) { _nsg.style.maxHeight = '400px'; _nsg.style.opacity = '1'; _nsg.style.pointerEvents = ''; _nsg.style.marginTop = '16px'; }
      const satToggle = el('inpIncludeSat'); if (satToggle) satToggle.checked = (c.workDays === 6);
      const recToggle = el('inpRecommendTimings');
      if (recToggle) { recToggle.checked = c.recommendTimings !== false; }
      const btToggle = el('inpBreakTime');
      if (btToggle) { btToggle.checked = c.breakTime !== false; }
      const h24Toggle = el('inp24h');
      if (h24Toggle) { h24Toggle.checked = c.use24h === true; }
      // Clock timezone (Advanced)
      _populateTimezoneSelect();
      const recBlock = el('recommendTimingsBlock');
      if (recBlock) {
        const recOn = c.recommendTimings !== false;
        recBlock.style.maxHeight  = recOn ? '500px' : '0';
        recBlock.style.opacity    = recOn ? '1' : '0';
      }
      switchStTab(c.weeklyOn ? 'weekly' : 'daily');
      document.querySelectorAll('.plan-btn[data-sday]').forEach(btn => {
        btn.classList.toggle('selected', (c.lateDays || []).includes(+btn.dataset.sday));
      });
      // Multi-select early leave days
      const earlyDays = c.earlyLeaveDays || (c.targetDay != null ? [c.targetDay] : []);
      document.querySelectorAll('.plan-btn[data-tday]').forEach(btn => {
        btn.classList.toggle('selected', earlyDays.includes(+btn.dataset.tday));
      });
      el('inpShiftStart').value = c.shiftStart || '09:00 AM';
      el('inpShiftEnd').value   = c.shiftEnd   || '06:00 PM';
      switchWorkDays(c.workDays || 5);
      // Re-render day pickers with correct day count
      const wdays = workDayNames();
      const earlyPicker = el('targetDayPicker');
      if (earlyPicker) {
        const earlyDays = c.earlyLeaveDays || (c.targetDay != null ? [c.targetDay] : []);
        earlyPicker.innerHTML = wdays.map((n, i) =>
          `<button type="button" class="plan-btn${earlyDays.includes(i+1)?' selected':''}" data-tday="${i+1}">${n}</button>`
        ).join('');
      }
      const latePicker = el('dayPicker');
      if (latePicker) {
        latePicker.innerHTML = wdays.map((n, i) =>
          `<button type="button" class="plan-btn${(c.lateDays||[]).includes(i)?' selected':''}" data-sday="${i}">${n}</button>`
        ).join('');
      }
      _setDaysSummary();
      updateWeeklyCalc();
      // Restore shortcut config
      _renderQsDisplay(c.qsShortcut);
      const _ls = Store.getLastSaved();
      if (_ls) _refreshLastSaved();
    }

    // ── Profile Card hydration ────────────────────────────
    // _profileAuthData caches auth so we don't need to re-fetch on every settings change
    let _profileAuthData = null;

    function hydrateProfileCard() {
      window._sbClient.auth.getUser().then(({ data }) => {
        const user = data?.user;
        if (!user) return;
        _profileAuthData = user;
        _renderProfileCard(user);
      });
    }

    // Re-renders the name/position/email parts from current cfg() + cached auth.
    // Call this whenever cfg changes so the card stays in sync.
    function refreshProfileCard() {
      if (_profileAuthData) _renderProfileCard(_profileAuthData);
    }

    function _renderProfileCard(user) {
      const email = user.email || '—';
      const meta  = user.user_metadata || {};
      const c     = cfg();

      // Avatar (element may not exist if avatar UI is hidden)
      const avatarUrl = meta.avatar_url || meta.picture || null;
      const avatarEl  = el('profileAvatar');
      if (avatarEl) {
        if (avatarUrl) {
          const avatarImg = document.createElement('img');
          avatarImg.alt = '';
          avatarImg.referrerPolicy = 'no-referrer';
          avatarImg.src = avatarUrl; // setAttribute handles encoding; avoids innerHTML injection
          avatarEl.textContent = '';
          avatarEl.appendChild(avatarImg);
        } else {
          avatarEl.textContent = (email[0] || '?').toUpperCase();
        }
      }

      // Name + email on one line
      const displayName = c.name?.trim() || meta.full_name || meta.name || '';
      const profileNameEl = el('profileName');
      profileNameEl.textContent = '';
      if (displayName) {
        profileNameEl.appendChild(document.createTextNode(displayName + ' '));
        const posSpan = document.createElement('span');
        posSpan.className = 'profile-position';
        posSpan.textContent = '(' + email + ')';
        profileNameEl.appendChild(posSpan);
      } else {
        profileNameEl.textContent = email;
      }

      // Position — shown below name line
      const position = c.position?.trim() || '';
      const titleRow = el('profileTitleRow');
      if (position) {
        el('profilePosition').textContent = position;
        titleRow.style.display = '';
      } else {
        titleRow.style.display = 'none';
      }

      // Email row hidden — email is now inline in the name line
      const emailRow = el('profileEmailRow');
      if (emailRow) emailRow.style.display = 'none';

      // User ID — stored in data attribute, shown only in dev mode
      const uid   = user.id || '';
      const uidEl = el('profileUid');
      if (uidEl) {
        uidEl.dataset.uid = uid;
        const uidText = el('profileUidText');
        if (uidText) uidText.textContent = uid;
      }
    }

    // ── Sync Diagnostic ─────────────────────────────────
    function _copyDiagLog() {
      const txt = el('syncDiagResult')?.textContent || '';
      navigator.clipboard?.writeText(txt);
      const btn = el('syncDiagCopy');
      if (btn) { const o = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => btn.textContent = o, 1500); }
    }
    function _toggleDiagLog() {
      const out = el('syncDiagResult'), chev = el('syncDiagChevron'), btn = el('syncDiagToggle');
      if (!out) return;
      const collapsed = out.style.display === 'none';
      out.style.display = collapsed ? '' : 'none';
      if (btn) btn.title = collapsed ? 'Collapse' : 'Expand';
      // Chevron points up when expanded, down when collapsed
      if (chev) chev.innerHTML = collapsed ? '<polyline points="18 15 12 9 6 15"/>' : '<polyline points="6 9 12 15 18 9"/>';
    }
    // Priority colour map for the code interface:
    //   red = errors · white = success · purple = headers · gray = normal/detail
    function _diagColor(line) {
      const t = line.trim();
      // App colours, so the log reads in light and dark mode alike.
      if (/^\/{2,}.*\/{2,}$/.test(t)) return 'var(--foreground)';   // header
      if (line.includes('❌')) return 'var(--destructive)';          // error
      if (line.includes('✅')) return 'var(--foreground)';           // success
      return 'var(--muted-fg)';                                      // detail
    }
    function _diagEsc(s) {
      return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    async function runSyncDiagnostic() {
      const wrap = el('syncDiagWrap'); if (wrap) wrap.style.display = 'block';
      const out = el('syncDiagResult');
      out.style.display = ''; // ensure expanded on a fresh run
      const lines = [];
      const log = (msg) => {
        lines.push(msg);
        out.innerHTML = lines.map(l => `<span style="color:${_diagColor(l)}">${_diagEsc(l)}</span>`).join('\n');
      };

      log('//////Sync Diagnostic//////');

      // 1. Session check
      try {
        const { data: { session } } = await window._sbClient.auth.getSession();
        if (!session) { log('❌ STEP 1: No session — user not authenticated'); return; }
        log('✅ STEP 1: Session exists');
        log('   uid: ' + session.user.id);
        log('   email: ' + session.user.email);
        log('   token expires: ' + new Date(session.expires_at * 1000).toISOString());
        const now = Date.now() / 1000;
        if (session.expires_at < now) { log('❌ TOKEN EXPIRED! Refresh needed.'); }
        else log('   token valid for: ' + Math.round((session.expires_at - now) / 60) + ' min');
        var uid = session.user.id;
      } catch (e) { log('❌ STEP 1 EXCEPTION: ' + e.message); return; }

      // 2. Local data check
      const localDays = Object.entries(Store.allDays());
      log('\n✅ STEP 2: Local data');
      log('   ' + localDays.length + ' days in localStorage');
      if (localDays.length > 0) {
        const sample = localDays[localDays.length - 1];
        log('   latest: ' + sample[0] + ' → ' + JSON.stringify(sample[1]).slice(0, 100));
      }

      // 3. SELECT from work_logs
      log('\n⏳ STEP 3: SELECT from work_logs...');
      try {
        const { data, error, status, statusText } = await window._sbClient
          .from('work_logs').select('log_date, hours_worked, updated_at').eq('user_id', uid);
        if (error) {
          log('❌ STEP 3 ERROR: ' + error.code + ' — ' + error.message);
          if (error.hint) log('   hint: ' + error.hint);
          return;
        }
        log('✅ STEP 3: SELECT OK — ' + (data||[]).length + ' rows in Supabase');
        if (data?.length) log('   latest: ' + data[data.length - 1].log_date);
      } catch (e) { log('❌ STEP 3 EXCEPTION: ' + e.message); return; }

      // 4. Test UPSERT (insert + update in one)
      log('\n⏳ STEP 4: Test UPSERT...');
      const testDate = '1999-12-31';
      try {
        const { data, error } = await window._sbClient.from('work_logs')
          .upsert({ user_id: uid, log_date: testDate, hours_worked: 0.01, status: 'completed' },
                   { onConflict: 'user_id,log_date' })
          .select('id, updated_at')
          .single();
        if (error) {
          log('❌ STEP 4 UPSERT ERROR: ' + error.code + ' — ' + error.message);
          if (error.hint) log('   hint: ' + error.hint);
          if (error.details) log('   details: ' + error.details);
        } else {
          log('✅ STEP 4: UPSERT OK — id: ' + data.id);

          // 5. Cleanup
          const { error: delErr } = await window._sbClient.from('work_logs')
            .delete().eq('user_id', uid).eq('log_date', testDate);
          if (delErr) log('⚠️  STEP 5: Cleanup failed — ' + delErr.message);
          else log('✅ STEP 5: Cleanup OK — test row deleted');
        }
      } catch (e) { log('❌ STEP 4 EXCEPTION: ' + e.message); }

      // 6. Test pushDay with real data
      if (localDays.length > 0) {
        const [dk, entry] = localDays[localDays.length - 1];
        log('\n⏳ STEP 6: pushDay("' + dk + '")...');
        const row = SbSync._toRow(uid, dk, entry);
        log('   payload: ' + JSON.stringify(row).slice(0, 200));
        try {
          const { data, error } = await window._sbClient.from('work_logs')
            .upsert(row, { onConflict: 'user_id,log_date' })
            .select('updated_at')
            .single();
          if (error) {
            log('❌ STEP 6 ERROR: ' + error.code + ' — ' + error.message);
            if (error.hint) log('   hint: ' + error.hint);
            if (error.details) log('   details: ' + error.details);
          } else {
            log('✅ STEP 6: pushDay OK — updated_at: ' + data.updated_at);
          }
        } catch (e) { log('❌ STEP 6 EXCEPTION: ' + e.message); }
      }

      log('\n//////Done//////');
    }

    function toggleCard(id) {
      el(id).classList.toggle('collapsed');
    }

    function toggleSetTargetTooltip(e) {
      e.stopPropagation();
      const tip = el('setTargetTooltip');
      const isVisible = tip.classList.contains('visible');
      tip.classList.toggle('visible', !isVisible);
      if (!isVisible) {
        const hide = () => { tip.classList.remove('visible'); document.removeEventListener('click', hide); };
        setTimeout(() => document.addEventListener('click', hide), 0);
      }
    }

    // ── Clock settings (Advanced) ──────────────────────
    // Classic UTC-offset + region-name list (the same set most OS/scheduling apps
    // use) instead of raw IANA ids like "Asia/Kolkata" — matches the reference the
    // feature was requested against. `offset` is each zone's STANDARD (non-DST)
    // UTC offset in hours, shown in the label; `iana` is what actually gets passed
    // to Intl for rendering the clock and for matching the device's real zone.
    const TZ_LIST = [
      { offset: -12,   label: 'International Date Line West', iana: 'Etc/GMT+12' },
      { offset: -11,   label: 'Coordinated Universal Time-11', iana: 'Etc/GMT+11' },
      { offset: -10,   label: 'Aleutian Islands', iana: 'America/Adak' },
      { offset: -10,   label: 'Hawaii', iana: 'Pacific/Honolulu' },
      { offset: -9.5,  label: 'Marquesas Islands', iana: 'Pacific/Marquesas' },
      { offset: -9,    label: 'Alaska', iana: 'America/Anchorage' },
      { offset: -9,    label: 'Coordinated Universal Time-09', iana: 'Etc/GMT+9' },
      { offset: -8,    label: 'Baja California', iana: 'America/Tijuana' },
      { offset: -8,    label: 'Coordinated Universal Time-08', iana: 'Etc/GMT+8' },
      { offset: -8,    label: 'Pacific Time (US & Canada)', iana: 'America/Los_Angeles' },
      { offset: -7,    label: 'Arizona', iana: 'America/Phoenix' },
      { offset: -7,    label: 'La Paz, Mazatlan', iana: 'America/Mazatlan' },
      { offset: -7,    label: 'Mountain Time (US & Canada)', iana: 'America/Denver' },
      { offset: -6,    label: 'Central America', iana: 'America/Guatemala' },
      { offset: -6,    label: 'Central Time (US & Canada)', iana: 'America/Chicago' },
      { offset: -6,    label: 'Guadalajara, Mexico City, Monterrey', iana: 'America/Mexico_City' },
      { offset: -6,    label: 'Saskatchewan', iana: 'America/Regina' },
      { offset: -5,    label: 'Bogota, Lima, Quito, Rio Branco', iana: 'America/Bogota' },
      { offset: -5,    label: 'Chetumal', iana: 'America/Cancun' },
      { offset: -5,    label: 'Eastern Time (US & Canada)', iana: 'America/New_York' },
      { offset: -5,    label: 'Indiana (East)', iana: 'America/Indiana/Indianapolis' },
      { offset: -4,    label: 'Asuncion', iana: 'America/Asuncion' },
      { offset: -4,    label: 'Atlantic Time (Canada)', iana: 'America/Halifax' },
      { offset: -4,    label: 'Caracas', iana: 'America/Caracas' },
      { offset: -4,    label: 'Cuiaba', iana: 'America/Cuiaba' },
      { offset: -4,    label: 'Georgetown, La Paz, Manaus, San Juan', iana: 'America/La_Paz' },
      { offset: -4,    label: 'Santiago', iana: 'America/Santiago' },
      { offset: -3.5,  label: 'Newfoundland', iana: 'America/St_Johns' },
      { offset: -3,    label: 'Brasilia', iana: 'America/Sao_Paulo' },
      { offset: -3,    label: 'Buenos Aires', iana: 'America/Argentina/Buenos_Aires' },
      { offset: -3,    label: 'Cayenne, Fortaleza', iana: 'America/Cayenne' },
      { offset: -3,    label: 'Greenland', iana: 'America/Godthab' },
      { offset: -3,    label: 'Montevideo', iana: 'America/Montevideo' },
      { offset: -3,    label: 'Salvador', iana: 'America/Bahia' },
      { offset: -2,    label: 'Coordinated Universal Time-02', iana: 'Etc/GMT+2' },
      { offset: -1,    label: 'Azores', iana: 'Atlantic/Azores' },
      { offset: -1,    label: 'Cabo Verde Is.', iana: 'Atlantic/Cape_Verde' },
      { offset: 0,     label: 'Casablanca', iana: 'Africa/Casablanca' },
      { offset: 0,     label: 'Coordinated Universal Time', iana: 'Etc/UTC' },
      { offset: 0,     label: 'Dublin, Edinburgh, Lisbon, London', iana: 'Europe/London' },
      { offset: 0,     label: 'Monrovia, Reykjavik', iana: 'Africa/Monrovia' },
      { offset: 1,     label: 'Amsterdam, Berlin, Bern, Rome, Stockholm, Vienna', iana: 'Europe/Berlin' },
      { offset: 1,     label: 'Belgrade, Bratislava, Budapest, Ljubljana, Prague', iana: 'Europe/Budapest' },
      { offset: 1,     label: 'Brussels, Copenhagen, Madrid, Paris', iana: 'Europe/Paris' },
      { offset: 1,     label: 'Sarajevo, Skopje, Warsaw, Zagreb', iana: 'Europe/Warsaw' },
      { offset: 1,     label: 'West Central Africa', iana: 'Africa/Lagos' },
      { offset: 2,     label: 'Amman', iana: 'Asia/Amman' },
      { offset: 2,     label: 'Athens, Bucharest', iana: 'Europe/Bucharest' },
      { offset: 2,     label: 'Beirut', iana: 'Asia/Beirut' },
      { offset: 2,     label: 'Cairo', iana: 'Africa/Cairo' },
      { offset: 2,     label: 'Damascus', iana: 'Asia/Damascus' },
      { offset: 2,     label: 'Harare, Pretoria', iana: 'Africa/Johannesburg' },
      { offset: 2,     label: 'Helsinki, Kyiv, Riga, Sofia, Tallinn, Vilnius', iana: 'Europe/Kiev' },
      { offset: 2,     label: 'Jerusalem', iana: 'Asia/Jerusalem' },
      { offset: 2,     label: 'Kaliningrad', iana: 'Europe/Kaliningrad' },
      { offset: 3,     label: 'Baghdad', iana: 'Asia/Baghdad' },
      { offset: 3,     label: 'Istanbul', iana: 'Europe/Istanbul' },
      { offset: 3,     label: 'Kuwait, Riyadh', iana: 'Asia/Riyadh' },
      { offset: 3,     label: 'Minsk', iana: 'Europe/Minsk' },
      { offset: 3,     label: 'Moscow, St. Petersburg', iana: 'Europe/Moscow' },
      { offset: 3,     label: 'Nairobi', iana: 'Africa/Nairobi' },
      { offset: 3.5,   label: 'Tehran', iana: 'Asia/Tehran' },
      { offset: 4,     label: 'Abu Dhabi, Muscat', iana: 'Asia/Dubai' },
      { offset: 4,     label: 'Baku', iana: 'Asia/Baku' },
      { offset: 4,     label: 'Port Louis', iana: 'Indian/Mauritius' },
      { offset: 4,     label: 'Tbilisi', iana: 'Asia/Tbilisi' },
      { offset: 4,     label: 'Yerevan', iana: 'Asia/Yerevan' },
      { offset: 4.5,   label: 'Kabul', iana: 'Asia/Kabul' },
      { offset: 5,     label: 'Ashgabat, Tashkent', iana: 'Asia/Tashkent' },
      { offset: 5,     label: 'Ekaterinburg', iana: 'Asia/Yekaterinburg' },
      { offset: 5,     label: 'Islamabad, Karachi', iana: 'Asia/Karachi' },
      { offset: 5.5,   label: 'Chennai, Kolkata, Mumbai, New Delhi', iana: 'Asia/Kolkata' },
      { offset: 5.5,   label: 'Sri Jayawardenepura', iana: 'Asia/Colombo' },
      { offset: 5.75,  label: 'Kathmandu', iana: 'Asia/Kathmandu' },
      { offset: 6,     label: 'Astana', iana: 'Asia/Almaty' },
      { offset: 6,     label: 'Dhaka', iana: 'Asia/Dhaka' },
      { offset: 6.5,   label: 'Yangon (Rangoon)', iana: 'Asia/Yangon' },
      { offset: 7,     label: 'Bangkok, Hanoi, Jakarta', iana: 'Asia/Bangkok' },
      { offset: 7,     label: 'Novosibirsk', iana: 'Asia/Novosibirsk' },
      { offset: 8,     label: 'Beijing, Chongqing, Hong Kong, Urumqi', iana: 'Asia/Shanghai' },
      { offset: 8,     label: 'Krasnoyarsk', iana: 'Asia/Krasnoyarsk' },
      { offset: 8,     label: 'Kuala Lumpur, Singapore', iana: 'Asia/Singapore' },
      { offset: 8,     label: 'Perth', iana: 'Australia/Perth' },
      { offset: 8,     label: 'Taipei', iana: 'Asia/Taipei' },
      { offset: 8,     label: 'Ulaanbaatar', iana: 'Asia/Ulaanbaatar' },
      { offset: 9,     label: 'Irkutsk', iana: 'Asia/Irkutsk' },
      { offset: 9,     label: 'Osaka, Sapporo, Tokyo', iana: 'Asia/Tokyo' },
      { offset: 9,     label: 'Seoul', iana: 'Asia/Seoul' },
      { offset: 9.5,   label: 'Adelaide', iana: 'Australia/Adelaide' },
      { offset: 9.5,   label: 'Darwin', iana: 'Australia/Darwin' },
      { offset: 10,    label: 'Brisbane', iana: 'Australia/Brisbane' },
      { offset: 10,    label: 'Canberra, Melbourne, Sydney', iana: 'Australia/Sydney' },
      { offset: 10,    label: 'Guam, Port Moresby', iana: 'Pacific/Guam' },
      { offset: 10,    label: 'Hobart', iana: 'Australia/Hobart' },
      { offset: 10,    label: 'Yakutsk', iana: 'Asia/Yakutsk' },
      { offset: 11,    label: 'Solomon Is., New Caledonia', iana: 'Pacific/Guadalcanal' },
      { offset: 11,    label: 'Vladivostok', iana: 'Asia/Vladivostok' },
      { offset: 12,    label: 'Auckland, Wellington', iana: 'Pacific/Auckland' },
      { offset: 12,    label: 'Coordinated Universal Time+12', iana: 'Etc/GMT-12' },
      { offset: 12,    label: 'Fiji', iana: 'Pacific/Fiji' },
      { offset: 12,    label: 'Magadan', iana: 'Asia/Magadan' },
      { offset: 13,    label: "Nuku'alofa", iana: 'Pacific/Tongatapu' },
      { offset: 13,    label: 'Samoa', iana: 'Pacific/Apia' },
      { offset: 14,    label: 'Kiritimati Island', iana: 'Pacific/Kiritimati' },
    ];

    function _tzOffsetLabel(offsetHours) {
      if (offsetHours === 0) return '(UTC)';
      const sign = offsetHours < 0 ? '-' : '+';
      const abs = Math.abs(offsetHours);
      const h = Math.floor(abs);
      const m = Math.round((abs - h) * 60);
      return `(UTC${sign}${p2(h)}:${p2(m)})`;
    }

    function _tzEntryLabel(entry) { return `${_tzOffsetLabel(entry.offset)} ${entry.label}`; }

    // Finds which TZ_LIST entry represents this device's real zone — exact IANA
    // match first, falling back to a live (DST-aware) UTC-offset match since the
    // curated list can't cover every IANA id a browser might report.
    function _tzDeviceEntry() {
      let sysTz = '';
      try { sysTz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch {}
      if (!sysTz) return null;
      const exact = TZ_LIST.find(e => e.iana === sysTz);
      if (exact) return exact;
      const deviceOffsetMin = -new Date().getTimezoneOffset();
      const liveOffsetMin = (iana) => {
        try {
          const part = new Intl.DateTimeFormat('en-US', { timeZone: iana, timeZoneName: 'shortOffset' })
            .formatToParts(new Date()).find(p => p.type === 'timeZoneName')?.value || '';
          const m = part.match(/GMT([+-]\d+)(?::(\d+))?/);
          if (!m) return null;
          const sign = m[1].startsWith('-') ? -1 : 1;
          return parseInt(m[1], 10) * 60 + sign * parseInt(m[2] || '0', 10);
        } catch { return null; }
      };
      return TZ_LIST.find(e => liveOffsetMin(e.iana) === deviceOffsetMin) || null;
    }

    function _tzCurrentEntry() {
      const tzName = (cfg().tzName || '').trim();
      if (!tzName) return _tzDeviceEntry();
      return TZ_LIST.find(e => e.iana === tzName) || null;
    }

    function _tzSyncTrigger() {
      const lbl = el('tzSelectLabel');
      if (!lbl) return;
      const entry = _tzCurrentEntry();
      lbl.textContent = entry ? _tzEntryLabel(entry) : 'Device timezone';
    }

    function _populateTimezoneSelect() {
      const menu = el('tzSelectMenu');
      if (!menu) return;
      const deviceEntry = _tzDeviceEntry();
      const tzName = (cfg().tzName || '').trim();
      menu.innerHTML = TZ_LIST.map(e => {
        const isAuto = deviceEntry && e.iana === deviceEntry.iana;
        const isActive = tzName ? e.iana === tzName : !!isAuto;
        return `<button type="button" class="tz-item${isActive ? ' active' : ''}" data-on-click="h2620a6c9a8" data-click-a0="${e.iana}" data-click-a1="${isAuto ? 'true' : 'false'}">
          <span class="tz-item-label">${_tzEntryLabel(e)}</span>
          <span class="tz-item-right">${isAuto ? '<span class="tz-item-auto" title="Auto Detect"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>' : ''}</span>
        </button>`;
      }).join('');
      _tzSyncTrigger();
    }

    // Fixed positioning computed from the trigger's own rect. Right-aligned to
    // the trigger (menu's top-right corner sits 8px below the trigger's
    // bottom-right when there's room; otherwise its bottom-right corner sits
    // 8px above the trigger's top-right) and re-run on scroll/resize while
    // open (see _tzClose/_tzToggle) so it stays anchored as the page scrolls.
    function _tzPositionMenu() {
      const menu = el('tzSelectMenu'), trigger = el('tzSelectTrigger');
      if (!menu || !trigger) return;
      const GAP = 8, mW = 320, pad = 16;
      const r = trigger.getBoundingClientRect();
      let left = r.right - mW;
      if (left < pad) left = pad;
      if (left + mW > window.innerWidth - pad) left = window.innerWidth - mW - pad;
      const spaceBelow = window.innerHeight - r.bottom - GAP - pad;
      const spaceAbove = r.top - GAP - pad;
      let top, maxH;
      if (spaceBelow >= 160 || spaceBelow >= spaceAbove) {
        top = r.bottom + GAP;               // bottom-right of trigger
        maxH = Math.max(120, Math.min(320, spaceBelow));
      } else {
        maxH = Math.max(120, Math.min(320, spaceAbove));
        top = r.top - GAP - maxH;           // top-right of trigger
      }
      menu.style.left = left + 'px';
      menu.style.top = top + 'px';
      menu.style.maxHeight = maxH + 'px';
    }

    function _tzClose() {
      el('tzSelect')?.classList.remove('open');
      el('tzSelectMenu')?.classList.remove('open');
      window.removeEventListener('scroll', _tzPositionMenu, true);
      window.removeEventListener('resize', _tzPositionMenu);
    }

    function _tzToggle(event) {
      event?.stopPropagation();
      const wrap = el('tzSelect'), menu = el('tzSelectMenu');
      if (!wrap || !menu) return;
      _populateTimezoneSelect();
      const willOpen = !menu.classList.contains('open');
      if (!willOpen) { _tzClose(); return; }
      wrap.classList.add('open');
      menu.classList.add('open');
      _tzPositionMenu();
      // capture:true so scrolling on any scrollable ancestor (not just window)
      // still re-anchors the menu, since scroll events don't bubble to window.
      window.addEventListener('scroll', _tzPositionMenu, true);
      window.addEventListener('resize', _tzPositionMenu);
      // Open with the current selection as the first visible row, not centred —
      // set the menu's own scrollTop directly (never scrollIntoView(), which can
      // walk up past a position:fixed element and drag the page's own scroll
      // along with it — the exact "modal moves the page" bug being fixed here).
      const active = menu.querySelector('.tz-item.active');
      if (active) menu.scrollTop = Math.max(0, active.offsetTop - 6);
    }

    // isAuto: true when the clicked entry is also the device's real zone — picking
    // it stores '' (follow device) rather than pinning its iana, so the clock keeps
    // tracking the device if the user's actual timezone ever changes (e.g. travel).
    function _tzSelectEntry(iana, isAuto) {
      saveCfg({ ...cfg(), tzName: isAuto ? '' : iana });
      _populateTimezoneSelect();
      _tzClose();
      tickHeader();
    }

    document.addEventListener('click', e => {
      if (e.target.closest('#tzSelect')) return;
      _tzClose();
    });

    function switchStTab(tab) {
      const isWeekly = tab === 'weekly';
      el('stTabDaily').classList.toggle('active', !isWeekly);
      el('stTabWeekly').classList.toggle('active', isWeekly);
      const lbl = el('stTargetLabel');
      if (lbl) lbl.textContent = 'Work Hours';
      const sub = el('stTargetSub');
      if (sub) sub.textContent = isWeekly
        ? 'Weekly lets a long day make up for a short one.'
        : 'How long you work each day or week. 5pm counts down to it.';
      // Penalty mode follows target mode — weekly target ↔ weekly penalty calc
      const wOff = el('inpWeeklyOn'); if (wOff) wOff.checked = isWeekly;
      updateWeeklyCalc();
      autoSaveSettings();
    }

    function updateWeeklyCalc() {
      const dh = parseFloat(el('inpDailyH')?.value) || 0;
      const dm = parseFloat(el('inpDailyM')?.value) || 0;
      const daily = dh + dm / 60;
      const days = (cfg().workDays || 5);
      const weekly = daily * days;
      const wh = Math.floor(weekly), wm = Math.round((weekly - wh) * 60);
      // Sync hidden weekly inputs so calculations still work
      const whi = el('inpWeeklyH'); if (whi) whi.value = wh;
      const wmi = el('inpWeeklyM'); if (wmi) wmi.value = wm;
      // Keep shift end time in sync when daily hours change
      syncHoursToShiftEnd();
    }

    // Shift timing ↔ Daily hours two-way sync
    // Direction 1: shift start/end → compute duration → update daily hours
    function syncShiftTimesToHours() {
      const s = parse(el('inpShiftStart')?.value);
      const e = parse(el('inpShiftEnd')?.value);
      if (!s || !e) return;
      let diffMins = (e - s) / 60000;
      if (diffMins <= 0) diffMins += 24 * 60; // overnight shift
      if (diffMins <= 0 || diffMins > 24 * 60) return;
      el('inpDailyH').value = Math.floor(diffMins / 60);
      el('inpDailyM').value = Math.round(diffMins % 60);
      updateWeeklyCalc();
    }

    // Direction 2: daily hours + shift start → compute end time → update shift end
    function syncHoursToShiftEnd() {
      const s = parse(el('inpShiftStart')?.value);
      if (!s) return;
      const h = parseInt(el('inpDailyH')?.value || '0');
      const m = parseInt(el('inpDailyM')?.value || '0');
      if (h === 0 && m === 0) return;
      const end = new Date(s.getTime() + (h * 60 + m) * 60000);
      const endStr = short(end);
      if (endStr !== el('inpShiftEnd')?.value) {
        el('inpShiftEnd').value = endStr;
        renderShiftPresets();
      }
    }

    function onRecommendTimingsChange(checked) {
      autoSaveSettings();
      const recBlock = el('recommendTimingsBlock');
      if (recBlock) {
        recBlock.style.maxHeight = checked ? '500px' : '0';
        recBlock.style.opacity   = checked ? '1' : '0';
      }
      const wpBlock = el('wpRecommendBlock');
      if (wpBlock) wpBlock.style.display = checked ? '' : 'none';
      const npLate = el('npStayLate');
      if (npLate) npLate.style.display = checked ? '' : 'none';
      const npEarly = el('npEarlyLeave');
      if (npEarly) npEarly.style.display = checked ? '' : 'none';
      // Re-render to hide/show stayHint
      if (loginDate) render(); else renderEmptyState();
    }

    function onUse24hChange() {
      autoSaveSettings(); // persist the new use24h flag first so short() formats correctly
      // Reformat the Shift Type start/end fields to match the chosen clock format
      ['inpShiftStart', 'inpShiftEnd'].forEach(id => {
        const e = el(id);
        if (e && e.value) { const p = parse(e.value); if (p) e.value = short(p); }
      });
      autoSaveSettings(); // re-save the reformatted shift strings
      // Immediately refresh visible time displays (header clock + cards)
      if (typeof tickHeader === 'function') tickHeader();
      const lbl = el('shiftActiveLabel');
      if (loginDate && lbl) lbl.textContent = `Started at ${short(loginDate)}`;
      if (loginDate) render(); else renderEmptyState();
    }

    function toggleIncludeSaturday(checked) {
      const n = checked ? 6 : 5;
      const inp = el('inpWorkDays'); if (inp) inp.value = n;
      switchWorkDays(n);
    }

    function obToggleIncludeSaturday(checked) {
      const n = checked ? 6 : 5;
      const inp = el('obWorkDays'); if (inp) inp.value = n;
      const dialog = document.querySelector('.ob-dialog');
      const curH = dialog ? dialog.offsetHeight : 0;
      updateObWeeklyCalc();
      obBuildStep3Pickers(); // rebuild pickers so Saturday appears/disappears
      if (dialog && curH > 0) {
        requestAnimationFrame(() => {
          const newH = dialog.scrollHeight;
          if (Math.abs(newH - curH) > 2) {
            dialog.style.height = curH + 'px';
            dialog.style.overflow = 'hidden';
            dialog.style.transition = 'height .3s cubic-bezier(0.4,0,0.2,1)';
            requestAnimationFrame(() => {
              dialog.style.height = newH + 'px';
              setTimeout(() => { dialog.style.height = ''; dialog.style.overflow = ''; dialog.style.transition = ''; }, 320);
            });
          }
        });
      }
    }

    function autoSaveSettings() {
      const _dailyHVal = parseInt(el('inpDailyH').value, 10) || 0;
      const _dailyMVal = parseInt(el('inpDailyM').value, 10) || 0;
      const daily = _dailyHVal + (_dailyMVal / 60);
      const _wHVal = parseInt(el('inpWeeklyH')?.value, 10) || 0;
      const _wMVal = parseInt(el('inpWeeklyM')?.value, 10) || 0;
      const on     = el('inpWeeklyOn').checked;
      const tzOffset = -new Date().getTimezoneOffset();
      if (isNaN(daily) || daily <= 0 || daily > 24) return;
      const lateDays       = [...document.querySelectorAll('.plan-btn[data-sday].selected')].map(b => +b.dataset.sday);
      const earlyLeaveDays = [...document.querySelectorAll('.plan-btn[data-tday].selected')].map(b => +b.dataset.tday);
      const targetDay      = earlyLeaveDays.length > 0 ? earlyLeaveDays[0] : null;
      const notifOn        = el('inpNotifOn').checked;
      const notifTarget    = el('inpNotifTarget')?.checked ?? true;
      const notifKickstart = el('inpNotifKickstart')?.checked ?? true;
      const notifOvertime  = el('inpNotifOvertime')?.checked ?? true;
      const name       = el('inpDisplay').value.trim();
      const company    = el('inpCompany')?.value.trim() || '';
      const position   = el('inpPosition')?.value.trim() || '';
      const weeklyH    = (_wHVal > 0 || _wMVal > 0) ? _wHVal + _wMVal / 60 : cfg().weeklyH;
      const shiftStart = el('inpShiftStart')?.value.trim() || '09:00 AM';
      const shiftEnd   = el('inpShiftEnd')?.value.trim()   || '06:00 PM';
      const shiftType  = deriveShiftType(shiftStart);
      const now = nowTz();
      const workDays = parseInt(el('inpWorkDays')?.value || '5', 10) || 5;
      const recommendTimings = el('inpRecommendTimings')?.checked ?? true;
      const breakTime = el('inpBreakTime')?.checked ?? true;
      const use24h = el('inp24h')?.checked ?? false;
      const _qsShortcut = cfg().qsShortcut || { mod: 'ctrl', key: 's' };
      saveCfg({ dailyH: daily, weeklyH, weeklyOn: on, lateDays, earlyLeaveDays, notifOn, notifTarget, notifKickstart, notifOvertime, name, company, position,
                targetDay, shiftType, shiftStart, shiftEnd, tzOffset, workDays, recommendTimings, breakTime, use24h,
                autoStopBuf: cfg().autoStopBuf ?? 2, dismissed: cfg().dismissed ?? [],
                // Clock timezone persists via its own handler — carry it through,
                // otherwise saving any unrelated setting would silently reset it.
                tzName: cfg().tzName || '',
                qsShortcut: _qsShortcut });
      // If session is running, refresh button state to reflect break-time change
      if (loginDate) setCalcBtnState('running');
      renderDaySelector(); // refresh strip in case work-days changed
      updateWeeklyCalc();
      _refreshLastSaved();
      refreshProfileCard(); // keep name/position in sync with inputs
      if (notifOn && 'Notification' in window) {
        if (Notification.permission === 'default') {
          Notification.requestPermission().then(p => {
            if (p === 'granted' && loginDate) scheduleNotifications(loginDate.toISOString());
          });
        } else if (Notification.permission === 'granted' && loginDate) {
          scheduleNotifications(loginDate.toISOString());
        }
      }
      if (loginDate) render(); else renderEmptyState();
    }

    // ── WORK DAYS SELECTOR ─────────────────────────────
    function switchWorkDays(n) {
      const inp = el('inpWorkDays'); if (inp) inp.value = n;
      const satToggle = el('inpIncludeSat'); if (satToggle) satToggle.checked = (n === 6);
      // Immediately save & re-render pickers so Saturday appears/disappears live
      autoSaveSettings();
      // Re-render day pickers with updated day list
      const wdays = workDayNames();
      const c = cfg();
      const prevWdays = n === 6 ? 5 : 6; // what was before this call
      const earlyPicker = el('targetDayPicker');
      if (earlyPicker) {
        const earlyDays = c.earlyLeaveDays || [];
        earlyPicker.innerHTML = wdays.map((name, i) =>
          `<button type="button" class="plan-btn${earlyDays.includes(i+1)?' selected':''}${n===6&&i===5?' sat-appear':''}" data-tday="${i+1}">${name}</button>`
        ).join('');
      }
      const latePicker = el('dayPicker');
      if (latePicker) {
        latePicker.innerHTML = wdays.map((name, i) =>
          `<button type="button" class="plan-btn${(c.lateDays||[]).includes(i)?' selected':''}${n===6&&i===5?' sat-appear':''}" data-sday="${i}">${name}</button>`
        ).join('');
      }
      _setDaysSummary();
      renderDaySelector();
    }

    // ── SHIFT PRESET HELPERS ───────────────────────────
    function deriveShiftType(startStr) {
      const d = parse(startStr); if (!d) return 'custom';
      const h = d.getHours();
      if (h >= 5  && h < 11) return 'morning';
      if (h >= 11 && h < 15) return 'afternoon';
      return 'evening';
    }
    function renderShiftPresets() {
      const c = el('shiftPresetPicker'); if (!c) return;
      const cfg2 = cfg(), dh = cfg2.dailyH || 9;
      const cur  = (cfg2.shiftStart || '09:00 AM').trim();
      c.innerHTML = [7,8,9,10,11,12].map(h => {
        const s = new Date(); s.setHours(h,0,0,0);
        const re = h + dh, e = new Date(); e.setHours(Math.floor(re)%24, Math.round((re%1)*60),0,0);
        const ss=short(s), es=short(e);
        return `<button type="button" class="plan-btn${ss===cur?' selected':''}" data-on-click="h3e4f8c7bd2" data-click-a0="${ss}" data-click-a1="${es}" style="font-size:11px;white-space:nowrap">${ss} – ${es}</button>`;
      }).join('');
    }
    function applyShiftPreset(s, e) {
      el('inpShiftStart').value=s; el('inpShiftEnd').value=e;
      syncShiftTimesToHours();
      renderShiftPresets(); autoSaveSettings();
    }
    // ── TAB SWITCHING ──────────────────────────────────
    function _updatePillIndicator() {
      var nav = document.getElementById('mobBottomNav');
      var indicator = document.getElementById('mobPillIndicator');
      if (!nav || !indicator || !nav.offsetWidth) return;
      var activeTab = nav.querySelector('.mob-tab.active');
      if (!activeTab) return;
      indicator.style.left = activeTab.offsetLeft + 'px';
      indicator.style.width = activeTab.offsetWidth + 'px';
    }
    const VIEW_ORDER = ['home', 'analytics', 'settings'];
    function switchTab(name) {
      // The new shell folds Dashboard into Home and removes its view, so anything
      // still asking for 'analytics' (toasts, notification CTAs, a saved tab)
      // used to land on a page with no view at all: a blank screen.
      if (name === 'analytics' && !el('viewAnalytics')) { switchTab('home'); renderAnalytics(); return; }
      const oldIdx = VIEW_ORDER.indexOf(activeView);
      const newIdx = VIEW_ORDER.indexOf(name);
      // Leaving Settings closes any nested page, so it reopens on its tabs.
      if (activeView === 'settings' && name !== 'settings') {
        document.querySelector('#viewSettings .settings-panel')?.classList.remove('page-open');
      }
      activeView = name;
      el('railProfile')?.classList.toggle('active', name === 'settings');
      try { sessionStorage.setItem('wh_active_tab', name); } catch {}
      document.querySelectorAll('.nav-tab').forEach(t => {
        const isActive = t.dataset.view === name;
        t.classList.toggle('active', isActive);
        const icon = t.querySelector('.tab-icon');
        if (icon) icon.style.display = isActive ? 'inline-flex' : 'none';
      });
      document.querySelectorAll('.mob-tab').forEach(t => t.classList.toggle('active', t.dataset.view === name));
      _updatePillIndicator();
      document.querySelectorAll('.view').forEach(v => {
        const isActive = v.id === `view${name.charAt(0).toUpperCase() + name.slice(1)}`;
        v.classList.remove('slide-from-right', 'slide-from-left');
        v.classList.toggle('active', isActive);
        if (isActive && oldIdx !== newIdx) {
          const slideClass = newIdx > oldIdx ? 'slide-from-right' : 'slide-from-left';
          v.classList.add(slideClass);
          // .slide-from-right/left use animation-fill-mode:both, which keeps
          // `transform` applied at rest even once the .22s animation finishes
          // (translateX(0) still counts as a set transform, not none). That
          // silently creates a new containing block for every position:fixed
          // descendant of this view — any popover/dropdown opened afterward
          // (e.g. the timezone dropdown) renders relative to this view's box
          // instead of the real viewport. Strip the class once the animation
          // ends so transform reverts to none and stops intercepting them.
          v.addEventListener('animationend', function _cleanup(e) {
            if (e.target !== v) return;
            v.classList.remove(slideClass);
            v.removeEventListener('animationend', _cleanup);
          });
        }
      });
      // scrollTo(0,0) is universally supported and instant (no scroll-behavior:smooth set).
      // The options-object form with behavior:'instant' silently fails on Safari < 15.4.
      window.scrollTo(0, 0);
      if (name === 'settings') populateSettings();
      if (name === 'analytics') renderAnalytics();
      if (name === 'home') { if (loginDate) render(); else renderEmptyState(); }
    }

    // ── ANALYTICS ──────────────────────────────────────
    function renderAnalytics() {
      el('wkNavLabel').textContent = analyticsWeekOffset === 0 ? 'This Week' : weekRangeLabel(analyticsWeekOffset);
      el('wkNextBtn').disabled = analyticsWeekOffset >= 0;
      renderHistory();
      renderPenalties();
    }

    function renderSurplusCircles() {
      const c = cfg(), wk = week(analyticsWeekOffset), tk = todayKey();
      const container = el('surplusCircles');
      // The card left with the old Dashboard. Without this, every caller after
      // it stopped short (deleting an entry never redrew the day or offered Undo).
      if (!container) return;
      let totalExtraSecs = 0;
      const CIRC = 125.66; // 2π × r=20

      // Pizza icon (Lucide) for holiday
      const pizzaSvg = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 11h.01"/><path d="M11 15h.01"/><path d="M16 16h.01"/><path d="m2 16 20 6-6-20A20 20 0 0 0 2 16"/><path d="M5.71 17.11a17.04 17.04 0 0 1 11.4-11.4"/></svg>`;

      function ringItem(dayName, pct, strokeColor, trackColor, labelHtml, extraStyle='', tip='') {
        const dash   = CIRC * Math.max(0, Math.min(1, pct));
        const offset = CIRC - dash;
        return `<div class="sc-item"${tip ? ` data-tip="${tip}"` : ''}>
          <div style="position:relative;width:52px;height:52px${extraStyle}">
            <svg width="52" height="52" viewBox="0 0 44 44" style="position:absolute;inset:0;overflow:visible">
              <circle cx="22" cy="22" r="20" fill="none" stroke="${trackColor}" stroke-width="3"/>
              <circle cx="22" cy="22" r="20" fill="none" stroke="${strokeColor}" stroke-width="3"
                stroke-dasharray="${CIRC}" stroke-dashoffset="${offset.toFixed(2)}"
                stroke-linecap="round" transform="rotate(-90 22 22)"/>
            </svg>
            <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center">${labelHtml}</div>
          </div>
          <div class="sc-day-label">${dayName.slice(0,3)}</div>
        </div>`;
      }

      const items = wk.map(day => {
        const log    = dayLog(day.key);
        const isToday = day.key === tk;
        const dName  = day.name;

        // Live tracking
        if (isToday && loginDate) {
          const worked = Math.max(0, Math.floor((new Date() - loginDate) / 1000)) + _sessionAccSecs;
          const pct    = c.dailyH > 0 ? worked / (c.dailyH * 3600) : 0;
          return ringItem(dName, pct, 'var(--success)', 'var(--success-border)',
            `<div class="dot-live"></div>`,
            ';animation:blink 1.6s ease-in-out infinite',
            `Live · ${dur(worked)}`);
        }

        // Holiday → pizza icon, no ring
        if (log?.override === 'holiday') {
          return `<div class="sc-item" data-tip="Holiday">
            <div style="width:52px;height:52px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(34,197,94,.1);border:1.5px solid rgba(34,197,94,.3);color:#22c55e">${pizzaSvg}</div>
            <div class="sc-day-label">${dName.slice(0,3)}</div>
          </div>`;
        }

        // Full Day Leave → flat blue-tinted circle with "Leave" label
        if (log?.override === 'leave') {
          return `<div class="sc-item" data-tip="On Leave">
            <div style="width:52px;height:52px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(59,130,246,.1);border:1.5px solid rgba(59,130,246,.3);font-size:9px;font-weight:700;color:#3b82f6;letter-spacing:.04em;text-align:center">Leave</div>
            <div class="sc-day-label">${dName.slice(0,3)}</div>
          </div>`;
        }

        // Half Day → half-circle, purple
        if (log?.override === 'halfday') {
          const halfDash   = CIRC / 2;
          const halfOffset = CIRC - halfDash;
          const hdWorked   = log?.hoursWorked ? dur(log.hoursWorked * 3600) : 'Half day';
          return `<div class="sc-item" data-tip="Half Day · ${hdWorked}">
            <div style="position:relative;width:52px;height:52px">
              <svg width="52" height="52" viewBox="0 0 44 44" style="position:absolute;inset:0;overflow:visible">
                <circle cx="22" cy="22" r="20" fill="none" stroke="rgba(168,85,247,.2)" stroke-width="3"/>
                <circle cx="22" cy="22" r="20" fill="none" stroke="#a855f7" stroke-width="3"
                  stroke-dasharray="${CIRC}" stroke-dashoffset="${halfOffset.toFixed(2)}"
                  stroke-linecap="round" transform="rotate(-90 22 22)"/>
              </svg>
              <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#a855f7">½</div>
            </div>
            <div class="sc-day-label">${dName.slice(0,3)}</div>
          </div>`;
        }

        // Has worked hours
        if (log?.hoursWorked != null && log.hoursWorked > 0) {
          const diff = log.hoursWorked * 3600 - c.dailyH * 3600;
          const pct  = Math.min(1, log.hoursWorked * 3600 / (c.dailyH * 3600));
          if (diff > 120) {
            totalExtraSecs += diff;
            const extra = diff / 3600;
            const whole = Math.floor(extra);
            const half  = (extra - whole) >= 0.4 && (extra - whole) < 0.9;
            const lbl   = half ? `+${whole}.5H` : `+${whole}H`;
            return ringItem(dName, 1, 'var(--success)', 'var(--success-border)',
              `<span style="font-size:9px;font-weight:700;color:var(--success);letter-spacing:-.2px">${lbl}</span>`,
              '', `${dur(log.hoursWorked * 3600)} logged · +${dur(diff)} surplus`);
          } else if (diff < -300) {
            return ringItem(dName, pct, 'var(--destructive)', 'var(--destructive-bg)',
              `<span style="font-size:10px;font-weight:700;color:var(--destructive)">!</span>`,
              '', `${dur(log.hoursWorked * 3600)} logged · ${dur(Math.abs(diff))} short`);
          } else {
            return ringItem(dName, pct, 'var(--foreground)', 'var(--border)',
              `<span style="font-size:12px;font-weight:700;color:var(--foreground)">✓</span>`,
              '', `${dur(log.hoursWorked * 3600)} logged`);
          }
        }

        // No data
        return `<div class="sc-item" data-tip="No entry">
          <div style="position:relative;width:52px;height:52px">
            <svg width="52" height="52" viewBox="0 0 44 44" style="position:absolute;inset:0">
              <circle cx="22" cy="22" r="20" fill="none" stroke="var(--border)" stroke-width="3"/>
            </svg>
            <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;color:var(--muted-fg)">–</div>
          </div>
          <div class="sc-day-label">${dName.slice(0,3)}</div>
        </div>`;
      });

      container.innerHTML = items.join('');

      const totalEl = el('scTotalVal');
      if (totalEl) {
        if (totalExtraSecs > 60) {
          const th = Math.floor(totalExtraSecs / 3600);
          const tm = Math.floor((totalExtraSecs % 3600) / 60);
          totalEl.textContent = tm > 0 ? `+${th}h ${tm}m` : `+${th}h`;
          totalEl.style.color = 'var(--success)';
        } else {
          totalEl.textContent = '+0h';
          totalEl.style.color = 'var(--muted-fg)';
        }
      }
    }

    let _penaltyData = [];
    let _discardedPenalties = new Set(JSON.parse(localStorage.getItem('wh_discarded_penalties') || '[]'));
    function discardPenalty(key) {
      _discardedPenalties.add(key);
      localStorage.setItem('wh_discarded_penalties', JSON.stringify([..._discardedPenalties]));
      renderPenalties();
    }

    // Fly a penalty row off to the right, then clear it. Shared by the X button,
    // the touch swipe and Clear All so every dismissal looks the same. Animates
    // from wherever the row currently sits, so a half-finished drag continues
    // from the finger's position instead of snapping back to 0 first.
    // `settle` runs once the row is gone — Clear All passes a no-op because it
    // persists and re-renders the whole list itself.
    function _dismissPenaltyRow(row, settle) {
      if (!row || row.dataset.dismissing) return;
      row.dataset.dismissing = '1';
      const key = row.dataset.penaltyKey;
      row.classList.remove('swiping');   // re-enable the eased transition
      row.classList.add('dismissing');   // stop it swallowing further taps
      void row.offsetWidth;              // lock in the current position first
      row.style.transform = 'translateX(110%)';
      row.style.opacity = '0';
      let fired = false;
      const finish = () => {
        if (fired) return;
        fired = true;
        if (settle) settle(); else discardPenalty(key);
      };
      row.addEventListener('transitionend', finish, { once: true });
      setTimeout(finish, 420); // fallback if transitionend never lands
    }

    // Swipe-right-to-dismiss on touch devices (phone + tablet). Mouse users have
    // the X button; this listens for touch only, so it simply never engages on
    // a desktop pointer.
    let _penSwipe = null;
    function _initPenaltySwipe() {
      const list = el('penaltiesList');
      if (!list || list.dataset.swipeInit) return;
      list.dataset.swipeInit = '1'; // delegated once — survives list re-renders

      list.addEventListener('touchstart', e => {
        const row = e.target.closest('.penalty-row');
        if (!row || row.dataset.dismissing || e.touches.length !== 1) return;
        const t = e.touches[0];
        _penSwipe = { row, x0: t.clientX, y0: t.clientY, dx: 0, axis: null };
      }, { passive: true });

      list.addEventListener('touchmove', e => {
        if (!_penSwipe) return;
        const t = e.touches[0];
        const dx = t.clientX - _penSwipe.x0, dy = t.clientY - _penSwipe.y0;
        // Decide once whether this gesture is a horizontal swipe or a vertical
        // scroll, then stick with it — otherwise the row jitters mid-scroll.
        if (!_penSwipe.axis) {
          if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
          if (Math.abs(dy) >= Math.abs(dx)) { _penSwipe = null; return; } // let the page scroll
          _penSwipe.axis = 'x';
          _penSwipe.row.classList.add('swiping');
        }
        _penSwipe.dx = Math.max(0, dx); // right-only, like a notification shade
        const w = _penSwipe.row.offsetWidth || 320;
        _penSwipe.row.style.transform = `translateX(${_penSwipe.dx}px)`;
        _penSwipe.row.style.opacity = String(Math.max(0.15, 1 - _penSwipe.dx / w));
        e.preventDefault(); // we own this gesture now
      }, { passive: false });

      const endSwipe = () => {
        if (!_penSwipe) return;
        const { row, dx, axis } = _penSwipe;
        _penSwipe = null;
        if (axis !== 'x') return;
        const w = row.offsetWidth || 320;
        if (dx > Math.min(120, w * 0.3)) {
          _dismissPenaltyRow(row);
        } else {
          row.classList.remove('swiping'); // spring back under the eased transition
          row.style.transform = '';
          row.style.opacity = '';
        }
      };
      list.addEventListener('touchend', endSwipe);
      list.addEventListener('touchcancel', endSwipe);
    }

    function clearAllPenalties() {
      const visible = _penaltyData.filter(p => !_discardedPenalties.has(p.key));
      if (!visible.length) {
        const btn = el('penaltyClearAll');
        btn.classList.remove('ios-shake');
        void btn.offsetWidth;
        btn.classList.add('ios-shake');
        btn.addEventListener('animationend', () => btn.classList.remove('ios-shake'), { once: true });
        return;
      }
      // Persist up front so a re-render mid-animation can't resurrect the rows.
      visible.forEach(p => _discardedPenalties.add(p.key));
      localStorage.setItem('wh_discarded_penalties', JSON.stringify([..._discardedPenalties]));
      const rows = [...document.querySelectorAll('#penaltiesList .penalty-row')];
      if (!rows.length) { renderPenalties(); return; }
      // Stagger so they cascade off rather than leaving in one block.
      const STEP = 60;
      rows.forEach((row, i) => setTimeout(() => _dismissPenaltyRow(row, () => {}), i * STEP));
      setTimeout(renderPenalties, rows.length * STEP + 340);
    }

    // ── Helper: get all Mon–Fri days in a given month up to today ──
    function getWeekdaysInMonth(year, month) {
      const days = [], now = new Date();
      for (let d = new Date(year, month, 1); d.getMonth() === month && d <= now; d.setDate(d.getDate() + 1)) {
        const dow = d.getDay();
        if (dow !== 0 && dow !== 6) days.push(new Date(d));
      }
      return days;
    }

    // ── Helper: get all Mon–Fri weeks (arrays of 5 days) in a month up to today ──
    function getWeeksInMonth(year, month) {
      const days = getWeekdaysInMonth(year, month);
      const weeks = [], seen = new Set();
      for (const d of days) {
        // Monday of this week
        const dow = d.getDay();
        const mon = new Date(d); mon.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1)); mon.setHours(0,0,0,0);
        const monKey = dateKey(mon);
        if (!seen.has(monKey)) {
          seen.add(monKey);
          // Build 5-day week from Monday
          const wkDays = [];
          for (let i = 0; i < 5; i++) {
            const wd = new Date(mon); wd.setDate(mon.getDate() + i);
            if (wd.getMonth() === month || true) wkDays.push(wd); // include cross-month
          }
          weeks.push({ monKey, days: wkDays });
        }
      }
      return weeks;
    }

    function renderPenalties() {
      const c = cfg();
      const now = new Date();
      const container = el('penaltiesList');
      // Delegated + idempotent, so binding it once here (rather than after every
      // return path below) covers the whole function regardless of which branch
      // returns early, and survives innerHTML rebuilds since it's on the container.
      _initPenaltySwipe();

      const tenDaysAgo = new Date(now); tenDaysAgo.setDate(tenDaysAgo.getDate() - 10); tenDaysAgo.setHours(0,0,0,0);

      if (!c.weeklyOn) {
        // ── DAILY MODE: flag each weekday below dailyH ──────────────────
        const penalties = [];
        const days = getWeekdaysInMonth(now.getFullYear(), now.getMonth());
        for (const d of days) {
          if (new Date(d) < tenDaysAgo) continue; // discard items older than 10 days
          const key = dateKey(d);
          if (key >= todayKey()) continue; // never flag today or future days
          const log = dayLog(key);
          // Skip override days — holiday/leave reduce weekly target, not penalised
          if (log?.override === 'holiday' || log?.override === 'leave') continue;
          if (log?.hoursWorked != null) {
            // Half-day: compare against half-target, not full
            const dayTarget = log?.override === 'halfday'
              ? (c.dailyH * 3600) / 2
              : c.dailyH * 3600;
            const deficit = dayTarget - log.hoursWorked * 3600;
            if (deficit > 300) penalties.push({ date: new Date(d), key, deficit, log, type: 'daily' });
          }
        }
        penalties.push(..._samplePenalties());
        _penaltyData = penalties;
        const visibleDaily = penalties.filter(p => !_discardedPenalties.has(p.key));

        if (!visibleDaily.length) {
          container.innerHTML = '<div class="penalty-empty">No daily penalties this month.</div>';
          return;
        }
        container.innerHTML = visibleDaily.map(_penRow).join('');

      } else {
        // ── WEEKLY MODE: report per week, flag on Monday if weekly total < weeklyH ──
        const now = new Date();
        const thisMonday = (() => {
          const d = new Date(now); const dow = d.getDay();
          d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1)); d.setHours(0,0,0,0); return d;
        })();

        // Collect past complete weeks (Mon–Fri finished) + current partial week
        const weeks = getWeeksInMonth(now.getFullYear(), now.getMonth());
        const penalties = [];

        for (const wk of weeks) {
          const monDate = new Date(wk.monKey + 'T00:00');
          const isCurrentWeek = monDate >= thisMonday;
          // Only report on completed weeks; discard weeks older than 10 days
          if (isCurrentWeek) continue;
          // Ensure Friday of the week is fully in the past (don't flag incomplete weeks)
          const fri = new Date(monDate); fri.setDate(monDate.getDate() + 4);
          if (dateKey(fri) >= todayKey()) continue;
          if (monDate < tenDaysAgo) continue;

          // Sum all logged hours in this week
          let totalSecs = 0, hasAnyData = false;
          for (const d of wk.days) {
            const log = dayLog(dateKey(d));
            if (log?.hoursWorked != null) { totalSecs += log.hoursWorked * 3600; hasAnyData = true; }
          }
          if (!hasAnyData) continue;

          // Adjust target for override days in this week
          const wkAdj = adjustedWeeklyTarget(wk.days.map(d => ({ key: dateKey(d), date: d })));
          const deficit = wkAdj - totalSecs;
          if (deficit > 300) {
            const fri = wk.days[4];
            const rangeStr = `${MONTHS[monDate.getMonth()]} ${monDate.getDate()}–${fri.getDate()}`;
            penalties.push({
              date:     monDate,
              key:      wk.monKey,
              deficit,
              totalSecs,
              rangeStr,
              log:      {},
              type:     'weekly',
              wkDays:   wk.days
            });
          }
        }

        // Also surface current week's running deficit as a warning (not a penalty yet)
        let currentWkSecs = 0;
        const currentWk = getWeeksInMonth(now.getFullYear(), now.getMonth()).find(wk => {
          const monDate = new Date(wk.monKey + 'T00:00');
          return monDate >= thisMonday;
        });
        if (currentWk) {
          for (const d of currentWk.days) {
            const log = dayLog(dateKey(d));
            if (log?.hoursWorked != null) currentWkSecs += log.hoursWorked * 3600;
          }
        }

        penalties.push(..._samplePenalties());
        _penaltyData = penalties;
        const visibleWeekly = penalties.filter(p => !_discardedPenalties.has(p.key));

        if (!visibleWeekly.length) {
          container.innerHTML = '<div class="penalty-empty">No weekly penalties this month.</div>';
          return;
        }

        container.innerHTML = visibleWeekly.map(_penRow).join('');
      }
    }

    // One penalty row; samples can be either type in either mode.
    function _penRow(p) {
      const label = p.type === 'weekly' ? `Week of ${p.rangeStr}`
        : `${FULL_DAYS_EN[p.date.getDay()]}, ${MONTHS[p.date.getMonth()]} ${p.date.getDate()}`;
      return penaltyRowHtml(p, label + (p.sample ? ' · Sample' : ''), `−${durWorked(p.deficit)}`);
    }

    // Developer Mode: two short days and one short week for trying Email Draft.
    // In memory only, never saved or synced; cleared when Developer Mode is off.
    function _samplePenalties() {
      if (!_devSamplePenalties) return [];
      const c = cfg(), day = c.dailyH * 3600;
      const ago = n => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - n); return d; };
      const at = (h, m) => { const d = new Date(); d.setHours(h, m, 0, 0); return d; };
      const log = (start, end, secs, override) => ({
        loginTime: `${start.getHours()}:${start.getMinutes()}:0`, loginDisplay: short(start),
        checkoutTime: `${p2(end.getHours())}:${p2(end.getMinutes())}:00`, checkoutDisplay: short(end),
        hoursWorked: secs / 3600, override: override || null });
      const d1 = day - 95 * 60, d2 = day / 2 - 50 * 60;
      const mon = ago(7); mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7));
      const wkDays = [0, 1, 2, 3, 4].map(i => { const d = new Date(mon); d.setDate(mon.getDate() + i); return d; });
      const perDay = [day, day - 80 * 60, day, day - 4 * 3600, day];
      const dayLogs = Object.fromEntries(wkDays.map((d, i) => [dateKey(d), { hoursWorked: perDay[i] / 3600 }]));
      const total = perDay.reduce((a, b) => a + b, 0);
      const fri = wkDays[4];
      return [
        { key: 'sample-d1', sample: true, type: 'daily', date: ago(1), deficit: 95 * 60, log: log(at(10, 12), at(17, 5), d1) },
        { key: 'sample-d2', sample: true, type: 'daily', date: ago(2), deficit: 50 * 60, log: log(at(9, 40), at(13, 20), d2, 'halfday') },
        { key: 'sample-w1', sample: true, type: 'weekly', date: mon, deficit: Math.max(c.weeklyH * 3600 - total, 320 * 60),
          totalSecs: total, rangeStr: `${MONTHS[mon.getMonth()]} ${mon.getDate()}–${fri.getDate()}`, log: {}, wkDays, dayLogs },
      ];
    }

    function penaltyRowHtml(p, dateStr, shortDesc, isWeekly) {
      return `<div class="penalty-row" data-penalty-key="${p.key}" data-on-click="h76411799e3" data-click-a0="${p.key}">
        <div class="penalty-row-main">
          <div class="penalty-info">
            <span class="penalty-date">${dateStr}</span>
            ${shortDesc ? `<span class="penalty-delta">${shortDesc}</span>` : ''}
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0">
            <button class="btn-sm penalty-discard-btn" title="Dismiss" aria-label="Dismiss"
              data-on-click="h61f06aeef3">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>
      </div>`;
    }

    // ── EMAIL DRAFT ────────────────────────────────────
    // Three hand-written formats per shortfall type. {name} tokens are filled
    // from the day's data and the inputs; a line whose token has no value is
    // left out (no reason typed, no reason line). No generated text.
    const EMAIL_TPL = {
      daily: {
        concise: { subject: 'Short day on {date}', body:
`{hi}

I worked {worked} on {date}, {short} under the {target} target.
Reason: {reason}
I'll make up the time this week.

{name}` },
        detailed: { subject: 'Hours for {date}', body:
`{hi}

Here are my hours for {date}:

Start: {start}
End: {end}
Worked: {worked}
Target: {target}
Short by: {short}

Reason: {reason}

I'll make up the difference over the next few days.

Thanks,
{name}
{position}` },
        formal: { subject: 'Attendance note: {date}', body:
`{dear}

I am writing to let you know that on {date} I worked {worked} against the standard {target}, which is {short} short.
This was due to {reason}.

I will make up the remaining time in the coming days. Please let me know if you need anything else from me.

Kind regards,
{name}
{position}` },
      },
      weekly: {
        concise: { subject: 'Short week: {range}', body:
`{hi}

I logged {worked} for the week of {range}, {short} under the {target} target.
Reason: {reason}
I'll make it up next week.

{name}` },
        detailed: { subject: 'Weekly hours: {range}', body:
`{hi}

Here are my hours for the week of {range}:

{days}

Total: {worked}
Target: {target}
Short by: {short}

Reason: {reason}

I'll make up the difference next week.

Thanks,
{name}
{position}` },
        formal: { subject: 'Weekly attendance note: {range}', body:
`{dear}

I am writing to let you know that for the week of {range} I logged {worked} against the weekly target of {target}, which is {short} short.
This was due to {reason}.

I will make up the remaining time next week. Please let me know if you need anything else from me.

Kind regards,
{name}
{position}` },
      },
    };

    // Raise Dispute (Update Entry › Raise Dispute): ask HR to correct a day the
    // attendance system got wrong, with 5pm's own timings for it.
    EMAIL_TPL.dispute = {
      concise: { subject: 'Attendance correction for {date}', body:
`{hi}

Please correct my attendance for {date}.
Reason: {reason}
Start: {start}
End: {end}

Thanks,
{name}` },
      detailed: { subject: 'Request to correct my attendance for {date}', body:
`{hi}

My attendance record for {date} doesn't match the hours I worked.
Reason: {reason}

My actual timings were:

Start: {start}
End: {end}
Worked: {worked}

Could you please update the record in the system?

Thanks,
{name}
{position}` },
      formal: { subject: 'Attendance record correction request: {date}', body:
`{dear}

I am writing to request a correction to my attendance record for {date}.
Reason: {reason}

My actual timings were {start} to {end}, a total of {worked}.

I would be grateful if you could update the record accordingly. Please let me know if you need anything else from me.

Kind regards,
{name}
{position}` },
    };
    // Report a Bug (Settings › About): the user's description plus what's
    // needed to reproduce it. One format; the Writing Tone menu is hidden.
    EMAIL_TPL.bug = {
      concise: { subject: '5pm bug report (v{version}, {platform})', body:
`Hi Roshan,

{description}

{details}` },
    };
    const BUG_REPORT_TO = 'roshanmohapatra.2001@gmail.com';
    const BUG_MIN_CHARS = 30;   // a bug report's description must be at least this long

    // Why the attendance system has the day wrong, as it reads after "Reason:".
    const DISPUTE_REASONS = {
      missed:     'Missed punch out',
      glitch:     "Technical glitch, the machine didn't record my timings",
      notupdated: "My timings weren't updated in the system",
    };

    function _fillTpl(tpl, v) {
      return tpl.split('\n')
        .filter(line => !(line.match(/\{\w+\}/g) || []).some(t => !v[t.slice(1, -1)]))
        .map(line => line.replace(/\{(\w+)\}/g, (_, k) => v[k]))
        .join('\n').replace(/\n{3,}/g, '\n\n').trim();
    }

    // One line per weekday for the Detailed weekly format.
    function _emailDayLines(days, logs) {
      return (days || []).map(d => {
        const log = logs?.[dateKey(d)] || dayLog(dateKey(d)) || {};
        const label = `${FULL_DAYS_EN[d.getDay()].slice(0, 3)} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`;
        const ov = log.override;
        if (ov === 'leave') return `${label}: On Leave`;
        if (ov === 'holiday') return `${label}: Holiday`;
        const hrs = log.hoursWorked ? durWorked(log.hoursWorked * 3600) : 'No hours logged';
        return `${label}: ${hrs}${ov === 'halfday' ? ' (Half Day)' : ''}`;
      }).join('\n');
    }

    let _emailP = null, _emailDateStr = '';

    // Who each kind of email goes to, and where its recipients are saved.
    // Shortfalls go to a manager, disputes to HR (saved separately, since it's
    // usually someone else), bug reports to the developer.
    const EMAIL_RECIPIENTS = {
      daily:   { to: 'emailTo',   cc: 'emailCc',   name: 'emailManager', nameLabel: "Manager's name" },
      weekly:  { to: 'emailTo',   cc: 'emailCc',   name: 'emailManager', nameLabel: "Manager's name" },
      dispute: { to: 'emailHrTo', cc: 'emailHrCc', name: 'emailHrName',  nameLabel: "HR contact's name" },
    };

    // Details for a bug report: what's needed to find and reproduce a bug
    // without asking. No name, emails or past days. Slow lookups (exact OS and
    // browser versions, push, sign-in) are fetched when the sheet opens.
    let _diagAsync = {};
    let _diagStepsAtOpen = null;
    async function _diagRefresh() {
      const a = {};
      try { a.ua = await navigator.userAgentData?.getHighEntropyValues(['platformVersion', 'fullVersionList', 'bitness', 'model']); } catch {}
      try { a.push = _swReg ? !!(await _swReg.pushManager.getSubscription()) : null; } catch {}
      try {
        const { data: { session } } = await window._sbClient.auth.getSession();
        a.signedIn = !!session; a.provider = session?.user?.app_metadata?.provider || '';
      } catch {}
      if (window.__TAURI__) try { a.autostart = await window.__TAURI__.core.invoke('autostart_enabled'); } catch {}
      _diagAsync = a;
    }

    const _gmt = mins => { const m = Math.abs(mins || 0);
      return `GMT${mins < 0 ? '-' : '+'}${Math.floor(m / 60)}${m % 60 ? ':' + p2(m % 60) : ''}`; };
    const _TZ_ALIAS = { 'Asia/Calcutta': 'Asia/Kolkata', 'Asia/Saigon': 'Asia/Ho_Chi_Minh', 'Asia/Katmandu': 'Asia/Kathmandu',
      'Asia/Rangoon': 'Asia/Yangon', 'Europe/Kiev': 'Europe/Kyiv' };

    // ["Windows 11 (64-bit)", "Chrome 156.0.7690.50"]: exact where the browser
    // tells us, otherwise read from the user agent.
    function _diagSystem() {
      const ua = navigator.userAgent || '', h = _diagAsync.ua || {}, pv = h.platformVersion || '';
      const [browser, osName] = _devicePlatform().split(' on ');
      let os = osName;
      if (os === 'Windows') os = pv ? (parseInt(pv) >= 13 ? 'Windows 11' : 'Windows 10') : 'Windows 10 or 11';
      else if (os === 'macOS') os += ' ' + (pv || (ua.match(/Mac OS X ([\d_.]+)/)?.[1] || '').replace(/_/g, '.'));
      else if (os === 'Android') os += ' ' + (pv || ua.match(/Android ([\d.]+)/)?.[1] || '') + (h.model ? ', ' + h.model : '');
      else if (os === 'iOS') os += ' ' + (ua.match(/OS ([\d_]+) like/)?.[1] || '').replace(/_/g, '.');
      if (h.bitness) os += ` (${h.bitness}-bit)`;
      const brand = { Chrome: 'Google Chrome', Edge: 'Microsoft Edge', Opera: 'Opera' }[browser];
      const re = { Edge: /Edg\/([\d.]+)/, Opera: /OPR\/([\d.]+)/, Firefox: /Firefox\/([\d.]+)/, Safari: /Version\/([\d.]+)/ }[browser] || /Chrome\/([\d.]+)/;
      const ver = (h.fullVersionList || []).find(b => b.brand === brand)?.version || ua.match(re)?.[1] || '';
      return [os.trim(), `${browser} ${ver}`.trim()];
    }

    // Diagnostics: short labelled lines in groups, like Apple's system reports.
    function _diagLines() {
      const c = cfg(), A = _diagAsync, now = new Date(), D = window.__diag || { errors: [], steps: [] };
      const installed = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
      const days = list => (list || []).map(d => FULL_DAYS_EN[d]?.slice(0, 3)).filter(Boolean).join(', ') || 'None';
      const onOff = v => v ? 'On' : 'Off';
      const cap = s => String(s || '').replace(/\b\w/g, m => m.toUpperCase());
      const sysTz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      const [os, browser] = _diagSystem();
      const tk = todayKey(), log = dayLog(tk) || {};
      const type = { halfday: 'Half Day', holiday: 'Holiday', leave: 'Leave' }[log.override] || (isWeekendKey(tk) ? 'Weekend' : 'Full Day');
      const target = log.todayTargetH ?? (log.override === 'halfday' ? c.dailyH / 2 : c.dailyH);
      const onBreak = c.breakTime !== false && !loginDate && _sessionAccSecs > 0;
      const alerts = [c.notifTarget && 'Target', c.notifKickstart && 'Kickstart', c.notifOvertime && 'Overtime'].filter(Boolean).join(', ');
      const saved = Store.getLastSaved();
      const devOn = !!el('notifTestCard') && el('notifTestCard').style.display !== 'none';
      // The steps before Report a Bug was opened; the sheet's own taps are left out.
      const steps = D.steps.slice(0, _diagStepsAtOpen ?? D.steps.length).slice(-8);
      const groups = [
        [
          `App: 5pm ${APP_VERSION}, ${window.__TAURI__ ? 'Windows App' : installed ? 'Web App' : 'Website'}`,
          window.__TAURI__ && A.autostart != null && `Open at Login: ${onOff(A.autostart)}`,
          `OS: ${os}`,
          `Browser: ${browser}`,
          `Device: ${cap(({ mobile: 'phone' })[_deviceKind(navigator.userAgent)] || _deviceKind(navigator.userAgent))}, ${matchMedia('(pointer: coarse)').matches ? 'Touch' : 'Mouse'}`,
          `Display: ${screen.width} × ${screen.height} at ${Math.round(devicePixelRatio * 100)}%, Window ${innerWidth} × ${innerHeight}`,
          `Appearance: ${document.documentElement.classList.contains('dark') ? 'Dark' : 'Light'}`,
          `Language: ${navigator.language || 'Unknown'}`,
        ],
        [
          `Date: ${now.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })} ${_gmt(-now.getTimezoneOffset())}`,
          `UTC: ${now.toISOString().slice(0, 19).replace('T', ' ')}`,
          `Time Zone: ${_TZ_ALIAS[sysTz] || sysTz || 'Unknown'}`,
          `App Time Zone: ${_TZ_ALIAS[c.tzName] || c.tzName || 'Not Set'}, ${_gmt(c.tzOffset)}`,
        ],
        [
          `Today: ${type}, ${durWorked((log.hoursWorked || 0) * 3600)} of ${durWorked(target * 3600)}`,
          log.loginTime && `Started: ${_loginDisplayFromLog(log)}`,
          log.checkoutTime && `Ended: ${_checkoutDisplayFromLog(log)}`,
          `Timer: ${loginDate ? 'Running since ' + short(loginDate) : onBreak ? 'On Break' : 'Stopped'}`,
          _sessionAccSecs > 0 && `Earlier Sessions: ${durWorked(_sessionAccSecs)}`,
          autoStopped && 'Auto-Stopped: Yes',
        ],
        [
          `Daily Target: ${durWorked(c.dailyH * 3600)}`,
          `Weekly Target: ${c.weeklyOn !== false ? durWorked(c.weeklyH * 3600) : 'Off'}`,
          `Work Week: ${c.workDays} Days`,
          `Shift: ${cap(c.shiftType)}${c.shiftStart ? ', ' + c.shiftStart + (c.shiftEnd ? ' to ' + c.shiftEnd : '') : ''}`,
          `Clock: ${c.use24h ? '24' : '12'}-Hour`,
          `Breaks: ${onOff(c.breakTime !== false)}`,
          `Smart Timings: ${onOff(c.recommendTimings !== false)}`,
          `Auto-Stop: After ${durWorked(c.autoStopBuf * 3600)}`,
          `Short Days: ${days(c.earlyLeaveDays || (c.targetDay != null ? [c.targetDay] : []))}`,
          `Long Days: ${days(c.lateDays)}`,
        ],
        [
          `Notifications: ${c.notifOn ? 'On' + (alerts ? ` (${alerts})` : '') : 'Off'}`,
          `Permission: ${'Notification' in window ? cap(Notification.permission) : 'Unsupported'}`,
          `Push: ${A.push == null ? 'Unknown' : onOff(A.push)}`,
          `Service Worker: ${navigator.serviceWorker?.controller ? 'Active' : 'Inactive'}`,
        ],
        [
          `Account: ${A.signedIn == null ? 'Unknown' : A.signedIn ? 'Signed In' + (A.provider ? ` (${cap(A.provider)})` : '') : 'Signed Out'}`,
          `Network: ${navigator.onLine ? 'Online' : 'Offline'}`,
          `Last Sync: ${_syncLast ? cap(_syncLast.state) + ', ' + timeAgo(new Date(_syncLast.at)) : 'None This Session'}`,
          saved && `Last Saved: ${timeAgo(saved)}`,
        ],
        [
          `Developer Mode: ${onOff(devOn)}`,
          _devDateOverride && `Test Date: ${_devDateOverride}`,
          _devSamplePenalties && 'Sample Penalties: On',
        ],
        ['Errors', ...(D.errors.length ? D.errors : ['None'])],
        ['Steps', ...(steps.length ? steps : ['None'])],
        [`User Agent: ${navigator.userAgent}`],
      ];
      return 'Diagnostics\n\n' + groups.map(g => g.filter(Boolean).join('\n')).join('\n\n');
    }

    function _bugDevice() {
      return { version: APP_VERSION, platform: _devicePlatform(), details: _diagLines() };
    }

    function _emailVars() {
      const c = cfg(), p = _emailP;
      if (p.type === 'bug') return { ..._bugDevice(), description: el('emailBugDesc').value.trim() };
      const manager = el('emailManager').value.trim();
      const worked = p.type === 'weekly' ? (p.totalSecs || 0) : (p.log?.hoursWorked || 0) * 3600;
      const dispute = p.type === 'dispute';
      return {
        hi: manager ? `Hi ${manager},` : 'Hi,',
        dear: manager ? `Dear ${manager},` : 'Hello,',
        date: _emailDateStr,
        range: p.rangeStr || _emailDateStr,
        start: p.type !== 'weekly' && p.log?.loginTime ? _loginDisplayFromLog(p.log) : '',
        end: p.type !== 'weekly' && (p.log?.checkoutDisplay || p.log?.checkoutTime) ? _checkoutDisplayFromLog(p.log) : '',
        worked: worked ? durWorked(worked) : '',
        target: dispute ? '' : durWorked(worked + p.deficit),
        short: dispute ? '' : durWorked(p.deficit),
        reason: dispute ? el('emailBugDesc').value.trim().replace(/\.$/, '') : el('emailReason').value.trim().replace(/\.$/, ''),
        days: p.type === 'weekly' ? _emailDayLines(p.wkDays, p.dayLogs) : '',
        name: (c.name || '').trim(),
        position: (c.position || '').trim(),
      };
    }

    // Re-render the preview and the mail link from the current format and inputs.
    function _emailUpdate() {
      if (!_emailP) return;
      const fmt = cfg().emailFormat || 'concise';
      const tpl = EMAIL_TPL[_emailP.type][fmt] || EMAIL_TPL[_emailP.type].concise;
      const v = _emailVars();
      const subject = _fillTpl(tpl.subject, v), body = _fillTpl(tpl.body, v);
      const list = id => el(id).value.split(/[,;\s]+/).filter(Boolean);
      const bug = _emailP.type === 'bug';
      const to = bug ? [BUG_REPORT_TO] : list('emailTo'), cc = bug ? [] : list('emailCc');
      // A bug report needs a description of BUG_MIN_CHARS or more, a dispute
      // any reason, before it can go.
      const textLen = el('emailBugDesc').value.trim().length;
      const tooShort = bug ? textLen < BUG_MIN_CHARS : _emailP.type === 'dispute' && !textLen;
      el('emailSendBtn').setAttribute('aria-disabled', String(tooShort));
      el('emailBugCount').hidden = !bug || textLen >= BUG_MIN_CHARS;
      el('emailBugCount').textContent = `${textLen} / ${BUG_MIN_CHARS} characters minimum`;
      el('emailTone').value = fmt;
      window.MenuSelect?.sync(el('emailTone'));
      el('emailPvMeta').textContent = `To: ${to.join(', ') || 'Not set'}` + (cc.length ? `  ·  CC: ${cc.join(', ')}` : '');
      el('emailPvSubject').textContent = subject;
      el('emailPvBody').textContent = body;
      const enc = encodeURIComponent, btn = el('emailSendBtn');
      // Desktop: Gmail's compose window in a new tab. A mailto: link depends on
      // the computer having an email app set, and many Windows PCs hand it to
      // the browser with nothing set up, so the button did nothing. Phones keep
      // mailto:, which opens the mail app.
      const desktop = matchMedia('(hover: hover) and (pointer: fine)').matches;
      if (desktop) {
        btn.href = 'https://mail.google.com/mail/?view=cm&fs=1' + (to.length ? `&to=${to.map(enc).join(',')}` : '') +
          (cc.length ? `&cc=${cc.map(enc).join(',')}` : '') + `&su=${enc(subject)}&body=${enc(body)}`;
        btn.target = '_blank'; btn.rel = 'noopener';
      } else {
        const q = [`subject=${enc(subject)}`, `body=${enc(body.replace(/\n/g, '\r\n'))}`];
        if (cc.length) q.unshift(`cc=${cc.map(enc).join(',')}`);
        btn.href = `mailto:${to.map(enc).join(',')}?${q.join('&')}`;
        btn.removeAttribute('target'); btn.removeAttribute('rel');
      }
      el('emailSendLabel').textContent = desktop ? 'Open Gmail' : 'Open Mail';
      el('emailToneInfo').dataset.tipDesc = desktop
        ? 'Opens Gmail in a new tab with this email filled in. You can still edit it before sending.'
        : 'Opens your mail app with this email filled in. You can still edit it before sending.';
    }

    // Changing tone: a skeleton for a second, then the new email. The preview's
    // height glides between each step (a CSS transition on a measured height),
    // so the sheet grows or shrinks smoothly. The mail link is updated at once.
    let _emailSwapTimer = 0;
    function _emailPreviewBox() { return document.querySelector('#emailPreviewPane .email-preview'); }
    function _emailGlide(change) {
      const box = _emailPreviewBox(), from = box.offsetHeight;
      change();
      box.style.height = '';
      const to = box.offsetHeight;
      box.style.height = from + 'px';
      void box.offsetHeight;              // start from the old height
      box.style.height = to + 'px';
    }
    function _emailToneSwap() {
      clearTimeout(_emailSwapTimer);
      _emailGlide(() => { _emailUpdate(); _emailPreviewBox().classList.add('loading'); });
      _emailSwapTimer = setTimeout(() => {
        _emailGlide(() => _emailPreviewBox().classList.remove('loading'));
        // Then back to its natural height (a timer, not transitionend, which
        // never fires when Reduce Motion turns the transition off).
        _emailSwapTimer = setTimeout(() => { _emailPreviewBox().style.height = ''; }, 400);
      }, 1000);
    }
    function _emailSwapReset() {
      clearTimeout(_emailSwapTimer);
      const box = _emailPreviewBox();
      box.classList.remove('loading');
      box.style.height = '';
    }

    function openEmailModal(key) {
      const p = _penaltyData.find(x => x.key === key);
      if (p) _openEmailFor(p);
    }

    // p: a penalty (daily/weekly), { type: 'dispute', date, log, reasonText }
    // or { type: 'bug' }. The same sheet, titled and fitted to each. A dispute
    // shows as the next page of the Update Entry modal instead of its own sheet.
    function _openEmailFor(p) {
      _emailP = p;
      const bug = p.type === 'bug';
      if (p.date) _emailDateStr = `${FULL_DAYS_EN[p.date.getDay()]}, ${MONTHS[p.date.getMonth()]} ${p.date.getDate()}`;
      // By id: during a dispute this title lives in the Update Entry modal, not the sheet.
      el('emailModalTitle').textContent =
        bug ? 'Report a Bug' : p.type === 'dispute' ? 'Raise Dispute' : 'Email Draft';
      el('emailModalDate').textContent = bug ? 'Goes to the developer, with your device details'
        : p.type === 'weekly' ? `Week of ${p.rangeStr}` : _emailDateStr;
      // The text box: a bug's description, or a dispute's reason (prefilled
      // from the chip or what was written, and still editable here).
      const dispute = p.type === 'dispute';
      el('emailBugWrap').hidden = !(bug || dispute);
      el('emailBugLabel').textContent = dispute ? 'Reason' : 'Description';
      el('emailBugDesc').placeholder = dispute ? 'Write a reason for mismatched timings'
        : 'Describe what happened, what you expected to happen';
      el('emailBackBtn').hidden = !dispute;
      document.querySelector('#emailPreviewPane .email-tone').hidden = bug;
      el('emailCustomiseBtn').hidden = bug;
      el('emailModalOverlay').classList.toggle('is-bug', bug);
      el('emailModalOverlay').querySelector('.email-pv-scroll').scrollTop = 0;
      el('emailCustomiseBtn').closest('.email-actions').classList.toggle('single', bug);
      // The per-email reason only fits shortfalls; a dispute picked its reason already.
      const shortfall = p.type === 'daily' || p.type === 'weekly';
      el('emailReason').hidden = el('emailReason').previousElementSibling.hidden = !shortfall;
      el('emailReason').value = '';
      el('emailBugDesc').value = dispute ? p.reasonText : '';
      _emailSwapReset();
      _emailFillSaved();
      _emailPane('preview');
      _emailUpdate();
      if (dispute) { _dePageTo('email'); return; }
      el('emailModalOverlay').classList.add('open');
      if (bug) setTimeout(() => el('emailBugDesc').focus(), 350);
    }

    // ── Update Entry pages ──
    // The email sheet's content moves into the day modal's second page while a
    // dispute is being drafted, and goes back when the day modal closes.
    let _deEmailInline = false;
    function _deEmailMoveIn() {
      if (_deEmailInline) return;
      const src = document.querySelector('#emailModalOverlay .email-modal');
      el('deEmailPage').append(...src.childNodes);
      _deEmailInline = true;
    }
    function _deEmailMoveOut() {
      if (!_deEmailInline) return;
      document.querySelector('#emailModalOverlay .email-modal').append(...el('deEmailPage').childNodes);
      _deEmailInline = false;
    }
    // Slide to 'email' (forward: it comes in from the right) or back to 'main'.
    let _deSlideTimer = 0;
    function _dePageTo(which) {
      const dlg = el('deMainPage').parentElement, main = el('deMainPage'), mail = el('deEmailPage');
      if (which === 'email') _deEmailMoveIn();
      const from = which === 'email' ? main : mail, to = which === 'email' ? mail : main;
      const dir = which === 'email' ? 1 : -1;
      clearTimeout(_deSlideTimer);
      const h0 = dlg.offsetHeight;
      // The new page sits beside the old one, off to the side, to be measured.
      to.hidden = false;
      to.classList.add('de-abs');
      to.style.transform = `translateX(${dir * 100}%)`;
      const h1 = to.offsetHeight;
      dlg.style.height = h0 + 'px';
      dlg.classList.add('de-sliding');
      void dlg.offsetHeight;                       // start from where things are now
      [from, to].forEach(p => p.classList.add('de-moving'));
      dlg.style.height = h1 + 'px';
      from.style.transform = `translateX(${-dir * 100}%)`;
      from.style.opacity = '0';
      to.style.transform = 'translateX(0)';
      _deSlideTimer = setTimeout(() => {
        from.hidden = true;
        [from, to].forEach(p => { p.classList.remove('de-moving', 'de-abs'); p.style.transform = ''; p.style.opacity = ''; });
        dlg.classList.remove('de-sliding');
        dlg.style.height = '';
        dlg.scrollTop = 0;
      }, 340);
    }
    function _dePageReset() {
      clearTimeout(_deSlideTimer);
      const dlg = el('deMainPage').parentElement;
      el('deMainPage').hidden = false;
      el('deEmailPage').hidden = true;
      [el('deMainPage'), el('deEmailPage')].forEach(p => { p.classList.remove('de-moving', 'de-abs'); p.style.transform = ''; p.style.opacity = ''; });
      dlg.classList.remove('de-sliding');
      dlg.style.height = '';
      _deEmailMoveOut();
    }

    function openBugReport() {
      _diagStepsAtOpen = (window.__diag?.steps.length || 1) - 1;   // minus the Report tap itself
      _openEmailFor({ type: 'bug' });
      _diagRefresh().then(() => { if (_emailP?.type === 'bug') _emailUpdate(); });
    }

    // ── What's New ──
    // The notes live in lib/whats-new.js (also the source for the GitHub and
    // Microsoft Store release notes). Shown once per device after it moves to a
    // new version; reopened any time from Settings › About.
    const WN_SEEN_KEY = 'wh_whats_new_seen';
    function _wnEntry(v) { return (window.WHATS_NEW || []).find(e => e.version === v) || null; }
    function openWhatsNew(version) {
      const e = _wnEntry(version || APP_VERSION) || (window.WHATS_NEW || [])[0];
      if (!e) return;
      el('wnVersion').textContent = 'Version ' + e.version;
      const section = (title, items) => items?.length
        ? `<div class="wn-section"><div class="email-label">${title}</div><ul class="wn-list">${
            items.map(t => `<li>${_escHtml(t)}</li>`).join('')}</ul></div>` : '';
      el('wnBody').innerHTML = section('Improvements', e.improvements) + section('Bug Fixes', e.fixes);
      el('whatsNewOverlay').classList.add('open');
    }
    function closeWhatsNew() { el('whatsNewOverlay').classList.remove('open'); }

    // After an update only: a brand-new user (nothing set up yet) gets the
    // version marked as seen instead. If another modal is up, it waits for the
    // next launch rather than stacking on top.
    function _wnMaybeShow() {
      let seen = null;
      try { seen = localStorage.getItem(WN_SEEN_KEY); } catch {}
      if (seen === APP_VERSION) return;
      const markSeen = () => { try { localStorage.setItem(WN_SEEN_KEY, APP_VERSION); } catch {} };
      // New user: the same test that opens onboarding (no settings saved yet).
      // The onboarding flag alone isn't enough: accounts set up before it existed lack it.
      if (!seen && !localStorage.getItem(OB_DONE_KEY) && !Store.getCfg()) { markSeen(); return; }
      if (!_wnEntry(APP_VERSION)) { markSeen(); return; }                       // nothing to tell
      if (document.querySelector('.overlay.open, .email-modal-overlay.open, .td-panel.open, .ios-install-sheet.open')
          || el('obOverlay')?.style.display === 'flex') return;
      openWhatsNew(APP_VERSION);
      markSeen();
    }

    // Recipients and the contact's name come from the synced settings, saved
    // per kind (manager for shortfalls, HR for disputes).
    function _emailFillSaved() {
      const c = cfg(), r = EMAIL_RECIPIENTS[_emailP?.type] || EMAIL_RECIPIENTS.daily;
      el('emailTo').value = c[r.to] || '';
      el('emailCc').value = c[r.cc] || '';
      el('emailManager').value = c[r.name] || '';
      el('emailManager').previousElementSibling.textContent = r.nameLabel;
    }
    // glide: Customise and back. The box holding both panes moves from the old
    // pane's height to the new one's (a CSS transition), and the new pane fades
    // in. Its inline height is cleared by a timer, not transitionend, which
    // never fires under Reduce Motion. Works in the sheet and in the dispute page.
    let _emailPaneTimer = 0;
    function _emailPane(which, glide) {
      const box = el('emailPreviewPane').parentElement, from = box.offsetHeight;
      el('emailPreviewPane').hidden = which !== 'preview';
      el('emailEditPane').hidden = which === 'preview';
      if (!glide) return;
      const pane = which === 'preview' ? el('emailPreviewPane') : el('emailEditPane');
      clearTimeout(_emailPaneTimer);
      box.classList.remove('pane-gliding');
      box.style.height = '';
      const to = box.offsetHeight;
      box.style.height = from + 'px';
      void box.offsetHeight;                // start from the old height
      box.classList.add('pane-gliding');
      box.style.height = to + 'px';
      pane.classList.remove('pane-in');
      void pane.offsetWidth;                // restart the fade
      pane.classList.add('pane-in');
      _emailPaneTimer = setTimeout(() => { box.classList.remove('pane-gliding'); box.style.height = ''; }, 340);
    }

    // Customise: edit the inputs, then Save (to the account, every device) or
    // Cancel (back to what was there). The reason stays with this email only.
    let _emailReasonBefore = '';
    function _emailCustomise() {
      _emailReasonBefore = el('emailReason').value;
      _emailPane('edit', true);
      el('emailTo').focus({ preventScroll: true });
    }
    function _emailCancel() { _emailFillSaved(); el('emailReason').value = _emailReasonBefore; _emailPane('preview', true); }
    function _emailSave() {
      const r = EMAIL_RECIPIENTS[_emailP?.type] || EMAIL_RECIPIENTS.daily;
      saveCfgAndSync({ ...cfg(), [r.to]: el('emailTo').value.trim(), [r.cc]: el('emailCc').value.trim(),
                       [r.name]: el('emailManager').value.trim() });
      _emailUpdate();
      _emailPane('preview', true);
      showToast('Email details saved', 'success');
    }

    function openDevicesModal() {
      _setPage('pageDevices', 'Saved Logins', "Devices where you're signed in to 5pm.", page => {
        const list = el('devList');
        list.classList.add('tile-list');
        page.append(list, el('devOthersWrap'));
        el('devModalOverlay')?.remove();
      });
      renderDevices();   // always a fresh read when it opens
    }
    function closeDevicesModal() { closeSetPage(); }

    function closeEmailModal() {
      if (_deEmailInline) { closeDayEditModal(); return; }   // a dispute page in the day modal
      el('emailModalOverlay').classList.remove('open');
    }

    // ── DAY EDIT MODAL ─────────────────────────────────
    function getShiftDefaults() {
      const c = cfg();
      if (c.shiftStart && c.shiftEnd) return { start: c.shiftStart, end: c.shiftEnd };
      return { morning:{start:'09:00 AM',end:'06:00 PM'}, afternoon:{start:'02:00 PM',end:'11:00 PM'}, evening:{start:'06:00 PM',end:'02:00 AM'} }[c.shiftType||'morning'] || {start:'09:00 AM',end:'06:00 PM'};
    }

    // Auto-format time input with shift-aware AM/PM on blur
    // Reads an hour and minute out of whatever was typed, as long as the user
    // did not name a meridiem themselves. "9", "903" and "9:03" all work.
    function _looseTime(raw) {
      const s = raw.trim().toUpperCase();
      if (!s || /(AM|PM)/.test(s)) return null; // explicit wins, leave it alone
      const colon = s.match(/^(\d{1,2}):(\d{1,2})$/);
      if (colon) return { h: +colon[1], m: +colon[2] };
      const digits = s.replace(/\D/g, '');
      if (!digits) return null;
      if (digits.length <= 2)  return { h: +digits, m: 0 };
      if (digits.length === 3) return { h: +digits[0], m: +digits.slice(1) };
      return { h: +digits.slice(0, 2), m: +digits.slice(2, 4) };
    }

    // An end time is only ambiguous relative to its start. Of the two readings,
    // the right one is whichever lands soonest after the start, wrapping past
    // midnight for night shifts. Clock in at 11:10 AM and type 9:03 and you
    // meant the evening, never twelve hours before you arrived.
    function _endMeridiem(h, m, start) {
      const startMin = start.getHours() * 60 + start.getMinutes();
      let best = null, bestGap = Infinity;
      [h % 12, (h % 12) + 12].forEach(H => {
        let gap = (H * 60 + m) - startMin;
        if (gap <= 0) gap += 1440; // next day
        if (gap < bestGap) { bestGap = gap; best = H; }
      });
      return best >= 12 ? 'PM' : 'AM';
    }

    function applyShiftAmPm(input, field) {
      const t = _looseTime(input.value);
      if (!t) return;
      const { h, m } = t;
      if (h > 23 || m > 59) return;

      let ap;
      const start = field === 'end' ? parse(el('deStart')?.value || '') : null;
      if (h > 12) {
        ap = 'PM'; // 13-23 was never ambiguous
      } else if (start && h >= 1) {
        ap = _endMeridiem(h, m, start);
      } else {
        // No reference to work from, so fall back to the shape of the shift.
        const st = deriveShiftType(cfg().shiftStart || '09:00 AM');
        if      (st==='morning')   { ap = h>=12?'PM':'AM'; }
        else if (st==='afternoon') { ap = (h>=1&&h<=8)?'PM':'AM'; }
        else if (st==='evening')   { ap = (h>=1&&h<=5)?'AM':'PM'; }
        else                       { ap = h>=12?'PM':'AM'; }
      }
      input.value = `${p2(h > 12 ? h - 12 : h || 12)}:${p2(m)} ${ap}`;
    }

    // ── END SESSION MODAL ─────────────────────────────
    function openEndSessionModal() {
      const c = cfg();
      const dailySecs = c.dailyH * 3600;
      const halfSecs  = dailySecs / 2;
      // Compute how much has been worked so far
      let workedSecs = _sessionAccSecs;
      if (loginDate) workedSecs += Math.max(0, Math.floor((new Date() - loginDate) / 1000));
      const remSecs = Math.max(0, dailySecs - workedSecs);
      const isHalfDay = workedSecs <= halfSecs;
      const desc = el('endSessionDesc');
      const note = el('endSessionHalfDayNote');
      const confirmBtn = el('endSessionConfirmBtn');
      if (remSecs > 0) {
        desc.textContent = `You still have ${dur(remSecs)} remaining until your daily target.`;
      } else {
        desc.textContent = "You've hit your daily target. Great work today!";
      }
      if (isHalfDay && workedSecs > 0) {
        note.style.display = '';
        confirmBtn.textContent = 'End Session';
      } else {
        note.style.display = 'none';
        confirmBtn.textContent = 'End Session';
      }
      el('endSessionOverlay').classList.add('open');
    }

    function confirmEndSession() {
      const c = cfg();
      const dailySecs = c.dailyH * 3600;
      const halfSecs  = dailySecs / 2;
      let workedSecs = _sessionAccSecs;
      if (loginDate) workedSecs += Math.max(0, Math.floor((new Date() - loginDate) / 1000));
      const isHalfDay = workedSecs > 0 && workedSecs <= halfSecs;
      el('endSessionOverlay').classList.remove('open');
      // Mark half day in log before checkout
      if (isHalfDay) {
        const tk = todayKey(), ex = dayLog(tk) || {};
        saveDayLog(tk, { ...ex, override: 'halfday' });
      }
      checkout();
    }

    // ── UNDO TOAST SYSTEM ─────────────────────────────
    function showUndoToast(msg, undoFn, durationMs = 4000) {
      const toast = el('appToast');
      const msgEl = el('appToastMsg');
      const undoBtn = el('appToastUndo');
      if (!toast) return;
      if (_toastTimer) { clearTimeout(_toastTimer); toast.classList.remove('toast-show'); }
      msgEl.textContent = msg;
      _toastUndoFn = undoFn || null;
      undoBtn.style.display = undoFn ? '' : 'none';
      requestAnimationFrame(() => {
        toast.classList.add('toast-show');
        _toastTimer = setTimeout(() => {
          toast.classList.remove('toast-show');
          _toastTimer = null; _toastUndoFn = null;
        }, durationMs);
      });
    }

    // ── DELETE DAY ENTRY ───────────────────────────────
    let _deletedEntryKey = null, _deletedEntryData = null;
    function deleteDayEntry() {
      if (!_dayEditKey) return;
      // Weekend note modal: clearing just the note — don't nuke the full entry
      if (_isWkndNoteModal) {
        const key = _dayEditKey;
        const ex = dayLog(key) || {};
        const ts = new Date().toISOString();
        _setNoteDirty(key);
        const u = { ...ex }; delete u.note; u.lastUpdated = ts;
        saveDayLogAndSync(key, u);
        closeDayEditModal();
        renderWeekendState(key, 'weekend');
        renderDaySelector();
        return;
      }
      const key = _dayEditKey;
      const backup = dayLog(key);
      _deletedEntryKey = key; _deletedEntryData = backup || null;

      // If deleting today's entry while a session is active or saved:
      // 1. Stop the ticker immediately — otherwise render() re-writes the
      //    deleted log every second, making the deletion appear to not work.
      // 2. Clear the session store — otherwise a reload restores the ghost
      //    session via restoreSession() even though the log is gone.
      if (key === todayKey()) {
        cancelScheduledNotifications();
        if (ticker) { clearInterval(ticker); ticker = null; }
        _stopCheckpoint();
        loginDate = null; _sessionAccSecs = 0; _sessionCheckoutTime = null;
        autoStopped = false; wasDone = false; notifSent = false;
        Store.clearSession();
        setCalcBtnState('start');
        el('shiftInputRow').classList.remove('active-state', 'hidden');
        el('shiftActiveLabel').textContent = '—';
        el('autostopBanner').classList.remove('show');
      }

      // Remove from localStorage + queue Supabase sync
      _setNoteDirty(key); // guard: prevents pullAll restoring stale remote on reload
      Store.remove(KEY.day + key);
      _markDirty(key); _syncNow();
      // For future plan days: clear the inline view immediately before closing the modal
      // so the empty state is visible the moment the overlay animates out
      if (new Date(key + 'T12:00') > new Date() && key !== todayKey()) {
        _freshlySelectedPlanKeys.delete(key);
        _renderFutureDayInline(key, null, week(daySelectorWeekOffset).find(d => d.key === key));
        _renderFutureDayBadge();
      }
      closeDayEditModal();
      renderDaySelector();
      renderHistory();
      renderPenalties();
      renderSurplusCircles();
      if (key === todayKey()) {
        // Deleting today's entry while it's rendered as a Holiday/Leave/Half Day
        // override card (a completely different sub-view) needs its leftover
        // classes and any pinned card height cleared explicitly — otherwise the
        // override card can stick around visually until the next full reload.
        el('rcBody')?.classList.remove('weekend-mode');
        el('weekendView')?.classList.remove('override-mode');
        const _card = el('homeCard'); if (_card) _card.style.height = '';
        renderEmptyState();
      } else if (new Date(key + 'T12:00') > new Date()) {
        selectFutureDay(key);
      } else if (key === selectedDayKey) {
        selectDay(key);
      }
      showUndoToast('Entry Deleted', () => {
        if (_deletedEntryKey && _deletedEntryData) {
          saveDayLogAndSync(_deletedEntryKey, _deletedEntryData);
          renderDaySelector();
          renderHistory();
          renderPenalties();
          renderSurplusCircles();
          if (_deletedEntryKey === todayKey()) {
            renderEmptyState();
          } else if (_deletedEntryKey === selectedDayKey) {
            if (new Date(_deletedEntryKey + 'T12:00') > new Date()) {
              selectFutureDay(_deletedEntryKey);
            } else {
              selectDay(_deletedEntryKey);
            }
          }
        }
        _deletedEntryKey = null; _deletedEntryData = null;
      });
    }

    function openDayEditModal(key, focusNote = false, wkndNote = false) {
      _dayEditKey = key || todayKey(); // null means today throughout the app
      _isWkndNoteModal = wkndNote;
      const wk = week(0), allWk = week(analyticsWeekOffset);
      const dayInfo = [...wk, ...allWk].find(d => d.key === (key || todayKey()));
      const log = dayLog(key);
      const d = new Date(key + 'T12:00');
      const _isFuturePlanModal = new Date(key + 'T12:00') > new Date() && key !== todayKey() && !!(log?.futurePlan);
      el('dayEditTitle').textContent = _isFuturePlanModal ? 'Update Plan' : 'Update Entry';
      el('dayEditTitle').dataset.editTitle = el('dayEditTitle').textContent; // what the first tab is called
      // Raise Dispute only makes sense for a day that has happened.
      const _canDispute = !wkndNote && (key || todayKey()) <= todayKey();
      el('deTabs').hidden = !_canDispute;
      _dePageReset();
      _deTab('edit');
      _deChip('missed');
      el('deDisputeOther').value = '';
      el('dayEditDesc').textContent = `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
      el('deStart').value = log?.loginDisplay || '';
      el('deEnd').value   = log?.checkoutDisplay || '';
      el('deErr').classList.remove('show');
      // Placeholders. Start: the shift's usual start. End: when this day's work
      // was last seen running, so an empty end suggests a real time; the shift's
      // usual end only when the day has nothing to go on (no start, no time worked).
      const sd = getShiftDefaults();
      const _guess = log?.checkoutDisplay ? null : _estimateDayEnd(_dayEditKey, log);
      el('deStart').placeholder = sd.start || 'Start time';
      el('deEnd').placeholder   = _guess && _guess.end > _guess.start ? short(_guess.end)
                                : (sd.end || 'End time');
      // For future plan days, futurePlan/futureReason are the source of truth
      const _effectiveOverride = log?.override || log?.futurePlan || null;
      const _effectiveNote     = log?.note || log?.futureReason || '';
      // Highlight active override; hide time row instantly (no transition on open)
      ['deHalfDay','deHoliday','deLeave'].forEach(id => el(id)?.classList.remove('active'));
      const _deTimeWrap = el('deTimeWrap');
      if (_deTimeWrap) { _deTimeWrap.style.transition = 'none'; _deTimeWrap.classList.remove('hidden'); }
      if (_effectiveOverride === 'halfday') {
        el('deHalfDay').classList.add('active');
      } else if (_effectiveOverride === 'holiday') {
        el('deHoliday').classList.add('active');
        if (_deTimeWrap) _deTimeWrap.classList.add('hidden');
      } else if (_effectiveOverride === 'leave') {
        el('deLeave').classList.add('active');
        if (_deTimeWrap) _deTimeWrap.classList.add('hidden');
      }
      // Re-enable transition after the instant open state is set
      requestAnimationFrame(() => { if (_deTimeWrap) _deTimeWrap.style.transition = ''; });
      // Note field — populate and show if there's an active override
      const _deNoteWrap = el('deNoteWrap');
      const _deNote     = el('deNote');
      if (_deNote) _deNote.value = _effectiveNote;
      // Optional note is always available (entry + plan modes), matching the time-input states
      if (_deNoteWrap) _deNoteWrap.classList.add('visible');
      // Shift-aware blur handlers (fresh each open)
      const startBlur = () => applyShiftAmPm(el('deStart'), 'start');
      const endBlur   = () => applyShiftAmPm(el('deEnd'),   'end');
      el('deStart').removeEventListener('blur', el('deStart')._blurFn || (()=>{}));
      el('deEnd').removeEventListener('blur',   el('deEnd')._blurFn   || (()=>{}));
      el('deStart')._blurFn = startBlur; el('deStart').addEventListener('blur', startBlur);
      el('deEnd')._blurFn   = endBlur;   el('deEnd').addEventListener('blur', endBlur);
      // Weekend-note variant: hide chips + time, show note-only layout
      const _overrideRow = el('dayEditOverlay')?.querySelector('.modal-override-row');
      const _deNoteLabel = el('deNoteLabel');
      if (_isWkndNoteModal) {
        el('dayEditTitle').textContent = 'Update Note';
        if (_overrideRow) _overrideRow.style.display = 'none';
        if (_deTimeWrap) { _deTimeWrap.style.transition = 'none'; _deTimeWrap.style.display = 'none'; }
        if (_deNote) { _deNote.placeholder = 'write a short note'; _deNote.value = log?.note || ''; }
        if (_deNoteWrap) _deNoteWrap.classList.add('visible');
        if (_deNoteLabel) { _deNoteLabel.textContent = 'What did you do?'; _deNoteLabel.style.display = ''; }
      } else {
        if (_overrideRow) _overrideRow.style.display = '';
        if (_deTimeWrap) _deTimeWrap.style.display = '';
        if (_deNote) _deNote.placeholder = 'Add a note (optional)';
        if (_deNoteLabel) _deNoteLabel.style.display = 'none';
      }
      el('dayEditOverlay').classList.add('open');
      if (focusNote) requestAnimationFrame(() => el('deNote')?.focus());
    }

    // ── NEW PLAN MODAL ─────────────────────────────────
    let _newPlanKey = null;
    let _newPlanType = null;

    function npSetType(type) {
      // Toggle: clicking the already-active type deactivates it
      if (_newPlanType === type) {
        _newPlanType = null;
        ['npEarlyLeave','npStayLate','npHalfDay','npAllDay'].forEach(id => el(id)?.classList.remove('active'));
        el('npTimeRow').style.display = 'none';
        el('npExtraRow').style.display = 'none';
        el('npCalcBlock').style.opacity = '0.4';
        el('npLeaveAt').textContent  = '—';
        el('npHoursLeft').textContent = '—';
        return;
      }
      _newPlanType = type;
      ['npEarlyLeave','npStayLate','npHalfDay','npAllDay'].forEach(id => el(id)?.classList.remove('active'));
      const map = { early:'npEarlyLeave', late:'npStayLate', half:'npHalfDay', allday:'npAllDay' };
      if (map[type]) el(map[type]).classList.add('active');
      el('npCalcBlock').style.opacity = '1';
      // Show/hide time row
      const showTime = type === 'early' || type === 'late';
      el('npTimeRow').style.display = showTime ? 'block' : 'none';
      updateNpCalc();
    }

    function updateNpCalc() {
      if (!_newPlanKey || !_newPlanType) return;
      const c = cfg(), daily = c.dailyH * 3600;
      const wk = week(0), tk = todayKey();
      const dayIdx   = wk.findIndex(d => d.key === _newPlanKey);
      const todayIdx = wk.findIndex(d => d.key === tk);
      const type     = _newPlanType;
      // Surplus banked before target day
      let surplus = 0;
      for (let i = 0; i < dayIdx; i++) {
        const l = dayLog(wk[i].key);
        if (l?.hoursWorked != null) surplus += Math.max(0, Math.round(l.hoursWorked*3600) - daily);
      }
      const daysToFund = Math.max(1, dayIdx - Math.max(todayIdx, 0));
      // Resolve inputs
      const typedStart = parse(el('npStartTime')?.value || '');
      const typedEnd   = parse(el('npEndTime')?.value   || '');
      const defStart   = (() => { const c2=cfg(); const p=c2.shiftStart?parse(c2.shiftStart):null; if(p) return p; const d=new Date(); d.setHours(9,0,0,0); return d; })();
      const startBase  = typedStart || defStart;
      let targetSecs, leaveStr;
      if (type === 'allday') {
        targetSecs = 0; leaveStr = 'All day off';
      } else if (typedEnd) {
        let eAdj = new Date(typedEnd);
        if (eAdj <= startBase) eAdj = new Date(eAdj.getTime() + 86400000);
        targetSecs = Math.floor((eAdj - startBase) / 1000);
        leaveStr = short(eAdj);
      } else if (type === 'half') {
        targetSecs = Math.round(daily/2);
        leaveStr = short(new Date(startBase.getTime() + targetSecs*1000));
      } else if (type === 'late') {
        targetSecs = daily + 3600;
        leaveStr = short(new Date(startBase.getTime() + targetSecs*1000));
      } else {
        targetSecs = Math.round(daily*0.5);
        leaveStr = short(new Date(startBase.getTime() + targetSecs*1000));
      }
      el('npLeaveAt').textContent   = leaveStr;
      el('npHoursLeft').textContent = type==='allday' ? '—' : dur(targetSecs);
      const extraEl = el('npExtraRow');
      if (type === 'allday' || dayIdx < 0) { extraEl.style.display='none'; return; }
      const deficit    = Math.max(0, daily - targetSecs);
      const defLeft    = Math.max(0, deficit - surplus);
      const perDay     = daysToFund > 0 ? Math.round(defLeft/daysToFund) : 0;
      const dayName    = wk[dayIdx]?.name || 'that day';
      if (defLeft <= 60) {
        el('npExtraText').textContent = `You've already banked enough to leave early on ${dayName}! 🎉`;
        extraEl.style.display = 'block';
      } else if (perDay > 0) {
        el('npExtraText').textContent = `Stay ${dur(perDay)} extra each of the next ${daysToFund} day${daysToFund>1?'s':''} to leave at ${leaveStr} on ${dayName}.`;
        extraEl.style.display = 'block';
      } else { extraEl.style.display = 'none'; }
    }

    function openNewPlanModal(key) {
      _newPlanKey  = key;
      _newPlanType = null; // nothing selected by default
      const wk = week(0), day = wk.find(d => d.key === key);
      const d  = day ? day.date : new Date(key + 'T00:00');
      el('newPlanDesc').textContent = `${FULL_DAYS_EN[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
      // Clear all chip selections
      ['npEarlyLeave','npStayLate','npHalfDay','npAllDay'].forEach(id => el(id)?.classList.remove('active'));
      // Reset fields
      el('npStartTime').value = '';
      el('npEndTime').value   = '';
      el('npNotes').value     = '';
      el('npExtraRow').style.display  = 'none';
      el('npTimeRow').style.display   = 'none';
      el('npCalcBlock').style.opacity = '0.4';
      el('npLeaveAt').textContent     = '—';
      el('npHoursLeft').textContent   = '—';
      el('npErr').classList.remove('show');
      // Apply recommend timings: hide Early Leave + Stay Late chips when disabled
      const rec = cfg().recommendTimings !== false;
      el('npEarlyLeave').style.display = rec ? '' : 'none';
      el('npStayLate').style.display   = rec ? '' : 'none';
      el('newPlanOverlay').classList.add('open');
    }

    function closeNewPlanModal() {
      el('newPlanOverlay').classList.remove('open');
      _newPlanKey = null;
    }

    function saveNewPlan() {
      if (!_newPlanKey || !_newPlanType) { el('npErr').textContent = 'Select a plan type first.'; el('npErr').classList.add('show'); return; }
      el('npErr').classList.remove('show');
      const key = _newPlanKey;
      const ex = dayLog(key) || {};
      const notes = el('npNotes').value.trim();
      const startTime = el('npStartTime').value.trim();
      const endTime = el('npEndTime').value.trim();
      const planMap = { early: 'early', late: 'late', half: 'halfday', allday: 'leave' };
      const plan = {
        futurePlan: planMap[_newPlanType] || 'early',
        scheduled: true,
        planNotes: notes || null,
        planStartTime: startTime || null,
        planEndTime: endTime || null,
        planType: _newPlanType
      };
      saveDayLog(key, { ...ex, ...plan });
      persist();
      closeNewPlanModal();
      renderDaySelector();
      if (key === selectedDayKey) selectFutureDay(key);
    }

        function closeDayEditModal() {
      el('dayEditOverlay').classList.remove('open');
      // Back to the first page, and the email content home, once it has faded.
      if (_deEmailInline) setTimeout(() => { if (!el('dayEditOverlay').classList.contains('open')) _dePageReset(); }, 250);
      _dayEditKey = null;
      _isWkndNoteModal = false;
    }

    function setDeOverride(type) {
      const map = { halfday:'deHalfDay', holiday:'deHoliday', leave:'deLeave' };
      const btnId = map[type];
      if (!btnId) return;
      const btn = el(btnId);
      if (!btn) return;
      const wasActive = btn.classList.contains('active');
      ['deHalfDay','deHoliday','deLeave'].forEach(id => el(id)?.classList.remove('active'));
      if (!wasActive) btn.classList.add('active'); // toggle off if same clicked
      // Hide time row entirely for full-day overrides; show for halfday/none
      const activeNow = wasActive ? null : type;
      const hideTime = activeNow === 'holiday' || activeNow === 'leave';
      el('deTimeWrap')?.classList.toggle('hidden', hideTime);
      // Show/hide optional note field
      el('deNoteWrap')?.classList.toggle('visible', !!activeNow);
    }

    // ── Export all logs as a local JSON file ───────────
    // ════════════════════════════════════════════════════
    // PERSISTENCE LAYER  (localStorage-only, modular)
    // Swap Store.* methods for IndexedDB/cloud in future.
    // ════════════════════════════════════════════════════
    const Store = {
      get(key, fb=null) {
        try { const r=localStorage.getItem(key); return r?JSON.parse(r):fb; } catch { return fb; }
      },
      set(key, val) {
        try { localStorage.setItem(key, JSON.stringify(val)); return true; }
        catch(e) { console.warn('[WH] Store.set failed:',key,e); return false; }
      },
      remove(key) { try { localStorage.removeItem(key); } catch {} },
      keys(prefix) {
        try { return Object.keys(localStorage).filter(k=>k.startsWith(prefix)); } catch { return []; }
      },

      // day logs
      getDay(dk)     { return this.get(KEY.day+dk); },
      setDay(dk,val) { this.set(KEY.day+dk,val); this._touch(); },
      allDays() {
        const out={};
        this.keys(KEY.day).forEach(k=>{ const v=this.get(k); if(v) out[k.slice(KEY.day.length)]=v; });
        return out;
      },

      // config
      getCfg()    { return this.get(KEY.cfg); },
      setCfg(val) { this.set(KEY.cfg,val); this._touch(); },

      // active session  { loginISO, accSecs, sessionDate, autoStopped }
      getSession()    { return this.get(KEY.session); },
      setSession(val) { this.set(KEY.session,val); },
      clearSession()  { this.remove(KEY.session); },

      // meta / debug
      _touch() { this.set(KEY.meta,{ lastSaved:new Date().toISOString(), v:APP_VERSION }); },
      getLastSaved() { const m=this.get(KEY.meta); return m?.lastSaved?new Date(m.lastSaved):null; },

      // full snapshot for export — structured v2 schema
      snapshot() {
        const c = this.getCfg() || {};
        const sysTzOff = -new Date().getTimezoneOffset();
        const sign = sysTzOff >= 0 ? '+' : '-';
        const absOff = Math.abs(sysTzOff);
        const tzLabel = `UTC${sign}${String(Math.floor(absOff/60)).padStart(2,'0')}:${String(absOff%60).padStart(2,'0')}`;
        const tzName = Intl.DateTimeFormat().resolvedOptions().timeZone || tzLabel;
        return {
          schema: 'wh_backup_v2',
          appVersion: APP_VERSION,
          exportedAt: new Date().toISOString(),
          user: {
            name:     c.name || '',
            timezone: tzName,
            tzOffset: sysTzOff,
          },
          workConfig: {
            dailyTargetHours:    Math.floor(c.dailyH || 9),
            dailyTargetMinutes:  Math.round(((c.dailyH || 9) % 1) * 60),
            weeklyTargetHours:   c.weeklyH || 45,
            weeklyTargetEnabled: c.weeklyOn !== false,
            shiftType:           c.shiftType || 'morning',
            shiftStart:          c.shiftStart || '09:00 AM',
            shiftEnd:            c.shiftEnd   || '06:00 PM',
            earlyLeaveDay:       c.targetDay  || null,
            earlyLeaveDays:      c.earlyLeaveDays || (c.targetDay != null ? [c.targetDay] : []),
            stayLateDays:        c.lateDays   || [],
            autoStopBufferHours: c.autoStopBuf ?? 2,
            notificationsEnabled: c.notifOn   || false,
          },
          tracking: {
            days:    this.allDays(),
            session: this.getSession(),
          },
          meta: {
            exportedAt:  new Date().toISOString(),
            lastSaved:   this.get(KEY.meta)?.lastSaved || null,
            schemaVersion: 2,
          },
          // keep legacy flat fields for backwards compatibility
          cfg:  c,
          days: this.allDays(),
        };
      },

      // import: validate schema, replace everything
      importSnap(snap) {
        // Accept both v2 structured and legacy flat formats
        const days = snap.tracking?.days || snap.days || snap;
        if (typeof days !== 'object' || Array.isArray(days)) return false;
        // Keep only well-formed entries. Previously just the FIRST value was
        // sampled and everything else written raw, so a hand-edited backup could
        // put arbitrary junk into storage and pushAll() would sync it to
        // Supabase. Filtering rather than rejecting keeps legacy flat exports
        // working, where day keys sit alongside metadata keys like "meta" and
        // "workConfig". It also drops __proto__-style keys.
        const entries = Object.entries(days).filter(([k, v]) =>
          /^\d{4}-\d{2}-\d{2}$/.test(k) && v && typeof v === 'object' && !Array.isArray(v));
        // No recognisable days means this is not a backup we should act on. The
        // old code fell through here and wiped every existing log.
        if (!entries.length) return false;
        // Wipe existing day logs
        this.keys(KEY.day).forEach(k => this.remove(k));
        entries.forEach(([dk, v]) => this.set(KEY.day + dk, v));
        // Restore config — prefer structured workConfig, fallback to cfg
        const wc = snap.workConfig;
        const legacyCfg = snap.cfg;
        if (wc) {
          const restoredCfg = {
            dailyH:       wc.dailyTargetHours + (wc.dailyTargetMinutes || 0) / 60,
            weeklyH:      wc.weeklyTargetHours,
            weeklyOn:     wc.weeklyTargetEnabled,
            shiftType:    wc.shiftType,
            shiftStart:   wc.shiftStart,
            shiftEnd:     wc.shiftEnd,
            targetDay:       wc.earlyLeaveDay,
            earlyLeaveDays:  wc.earlyLeaveDays || (wc.earlyLeaveDay != null ? [wc.earlyLeaveDay] : []),
            lateDays:        wc.stayLateDays || [],
            autoStopBuf:  wc.autoStopBufferHours,
            notifOn:      wc.notificationsEnabled,
            name:         snap.user?.name || legacyCfg?.name || '',
            position:     snap.user?.position || legacyCfg?.position || '',
            tzOffset:     snap.user?.tzOffset !== undefined ? snap.user.tzOffset : (legacyCfg?.tzOffset || 330),
          };
          this.setCfg({ ...(legacyCfg || {}), ...restoredCfg });
        } else if (legacyCfg) {
          this.setCfg(legacyCfg);
        }
        this._touch(); return true;
      },
    };

    // ── SUPABASE SYNC ─────────────────────────────────────────────────────────
    // Bridges localStorage ↔ work_logs table. All methods are fire-and-forget —
    // they never block the UI. Silently no-ops when the user is not signed in.
    const SbSync = {
      // Valid override values in the DB CHECK constraint
      _OVERRIDES: new Set(['leave', 'holiday', 'wfh', 'halfday']),

      // Map a localStorage day entry → work_logs row
      // A row with no times, hours, type or note is a deleted day.
      _isBlank(row) {
        return !row.login_time && !row.logout_time && !(parseFloat(row.hours_worked) > 0)
          && !row.override_type && !row.notes;
      },

      _toRow(userId, dk, entry) {
        const statusMap = {
          realtime: 'completed', edited: 'completed',
          autostopped: 'auto_stopped', auto_stopped: 'auto_stopped'
        };
        // Build login_time TIMESTAMPTZ from local date + HH:MM:SS string
        let loginTimestamp = null;
        if (entry.loginTime) {
          const pts = entry.loginTime.split(':').map(Number);
          const ld = new Date(dk + 'T00:00:00');
          ld.setHours(pts[0]||0, pts[1]||0, pts[2]||0, 0);
          loginTimestamp = ld.toISOString();
        }
        // Send the REAL exit time when we have it.
        //
        // This used to derive logout_time as login + hoursWorked, which is wrong
        // twice over. On any day with a pause the gaps are excluded from
        // hoursWorked, so the derived exit lands earlier than it happened. And
        // the whole expression collapsed to null whenever checkoutDisplay was
        // absent, which a pull then wrote back as "no logout", erasing the exit
        // time locally. Once erased it could never come back, because the next
        // push had nothing left to send. That is how days end up showing a bare
        // dash forever.
        let logoutTimestamp = null;
        if (entry.checkoutTime) {
          const cp = entry.checkoutTime.split(':').map(Number);
          const cd = new Date(dk + 'T00:00:00');
          cd.setHours(cp[0] || 0, cp[1] || 0, cp[2] || 0, 0);
          logoutTimestamp = cd.toISOString();
        } else if (loginTimestamp && entry.hoursWorked && entry.checkoutDisplay) {
          // Legacy entries recorded before checkoutTime survived a sync.
          logoutTimestamp = new Date(
            new Date(loginTimestamp).getTime() + Math.round(entry.hoursWorked * 3600000)
          ).toISOString();
        }
        return {
          user_id:          userId,
          log_date:         dk,
          login_time:       loginTimestamp,
          logout_time:      logoutTimestamp,
          hours_worked:     Math.min(Math.max(parseFloat(entry.hoursWorked) || 0, 0), 24),
          accumulated_secs: Math.min(Math.round((parseFloat(entry.hoursWorked) || 0) * 3600), 86400),
          status:           statusMap[entry.sessionTag] || 'completed',
          // override (past/today confirmed) takes priority; futurePlan (intent) is the fallback
          override_type:    this._OVERRIDES.has(entry.override)     ? entry.override     :
                            (this._OVERRIDES.has(entry.futurePlan)  ? entry.futurePlan   : null),
          // note (weekend/past note) takes priority; futureReason (plan description) is the fallback
          notes:            entry.note        ? String(entry.note).slice(0, 1000)        :
                            (entry.futureReason ? String(entry.futureReason).slice(0, 1000) : null),
          // NOTE: updated_at is intentionally OMITTED.
          // The DB trigger (private.set_updated_at) auto-stamps it on every UPDATE.
          // Sending it from the client causes a 42501 because updated_at has no
          // UPDATE column grant (it's server-managed). On INSERT, the column default
          // (now()) handles it.
        };
      },

      async _uid() {
        try {
          const { data: { session } } = await window._sbClient.auth.getSession();
          return session?.user?.id ?? null;
        } catch { return null; }
      },

      _lastErr: '', // last sync error code/message, surfaced in the failure toast

      // Push a single day. Returns true on success, false on failure.
      async pushDay(dk, entry) {
        try {
          const uid = await this._uid();
          if (!uid) { this._lastErr = 'No active session'; return false; }
          const row = this._toRow(uid, dk, entry);
          const { data, error } = await window._sbClient.from('work_logs')
            .upsert(row, { onConflict: 'user_id,log_date' })
            .select('updated_at')
            .single();
          if (error) { this._lastErr = error.code || error.message; console.warn('[SbSync] pushDay:', dk, error.message); return false; }
          if (data?.updated_at) {
            const local = Store.getDay(dk);
            if (local) Store.setDay(dk, { ...local, lastUpdated: data.updated_at });
          }
          _clearNoteDirty(dk); // push confirmed — local-write guard no longer needed
          return true;
        } catch (e) { this._lastErr = e.message || 'Network error'; console.warn('[SbSync] pushDay failed:', e); return false; }
      },

      // Push all localStorage days — called after a bulk import
      async pushAll() {
        try {
          const uid = await this._uid();
          if (!uid) return;
          const entries = Object.entries(Store.allDays());
          if (!entries.length) return;
          const rows = entries.map(([dk, v]) => this._toRow(uid, dk, v));
          // Batch in chunks of 100 to stay within request limits
          for (let i = 0; i < rows.length; i += 100) {
            await window._sbClient.from('work_logs')
              .upsert(rows.slice(i, i + 100), { onConflict: 'user_id,log_date' });
          }
        } catch (e) { console.warn('[SbSync] pushAll failed:', e); }
      },

      // Only the columns the merge below reads (and _isBlank checks).
      _PULL_COLS: 'log_date,login_time,logout_time,hours_worked,status,override_type,notes,updated_at',

      // Two-way sync: pull Supabase → local, then push any local entries
      // that Supabase doesn't have yet. Merge rule: newer updated_at wins.
      //
      // Full pull ({ full: true }: launch, the Sync button, or no cursor yet):
      // every row, and local days the cloud has never seen are pushed up.
      // Delta pull (everything else, e.g. coming back to the tab): only rows
      // changed since the last pull, so it stays small however long the history
      // gets. The cursor is the newest server updated_at seen (the server's
      // clock, not this device's), re-read with a 60 s overlap so a row stamped
      // just before a slow commit isn't missed; rows seen twice are skipped as
      // identical. It's per account and starts with wh_, so sign-out wipes it.
      async pullAll(opts) {
        try {
          const uid = await this._uid();
          if (!uid) return;
          const cursorKey = 'wh_pull_cursor_' + uid;
          const cursor = opts?.full ? null : localStorage.getItem(cursorKey);
          let q = window._sbClient.from('work_logs').select(this._PULL_COLS).eq('user_id', uid);
          if (cursor) q = q.gte('updated_at', new Date(Date.parse(cursor) - 60000).toISOString());
          const { data, error } = await q;
          if (error) { console.warn('[SbSync] pullAll:', error.message); return; }

          const toPush  = [];
          const inCloud = new Set(); // dates that exist in Supabase (complete on a full pull only)
          let newest = cursor;

          (data || []).forEach(row => {
            inCloud.add(row.log_date);
            if (row.updated_at && (!newest || Date.parse(row.updated_at) > Date.parse(newest))) newest = row.updated_at;
            const local = Store.getDay(row.log_date);
            // Local-write guard: if this day has an unsent save/delete, never let
            // stale remote data overwrite it — push local up instead.
            // If local was fully removed (Store.remove), push a blank record so
            // Supabase is also cleared rather than restoring the old note.
            if (_isNoteDirty(row.log_date)) {
              toPush.push([row.log_date, local || { lastUpdated: new Date().toISOString() }]);
              return;
            }
            // A blank row is a deleted day: remove it here too, instead of
            // storing it as an empty logged day. A newer local edit still wins.
            if (this._isBlank(row) && !(local?.lastUpdated && row.updated_at && Date.parse(local.lastUpdated) > Date.parse(row.updated_at))) {
              if (local) Store.remove(KEY.day + row.log_date);
              return;
            }
            if (local?.lastUpdated && row.updated_at) {
              const localTs  = new Date(local.lastUpdated).getTime();
              const remoteTs = new Date(row.updated_at).getTime();
              if (localTs > remoteTs) { toPush.push([row.log_date, local]); return; }
              if (localTs === remoteTs) return; // identical — skip
            }
            // Remote is newer (or local has no timestamp) — apply it
            const loginDt  = row.login_time  ? new Date(row.login_time)  : null;
            const logoutDt = row.logout_time ? new Date(row.logout_time) : null;
            // Future days carry futurePlan/futureReason; past/today carry override/note
            const _isFutureDay = new Date(row.log_date + 'T12:00') > new Date() && row.log_date !== todayKey();
            Store.setDay(row.log_date, {
              ...(loginDt  ? { loginTime: `${loginDt.getHours()}:${loginDt.getMinutes()}:${loginDt.getSeconds()}`,
                               loginDisplay: short(loginDt) } : {}),
              ...(logoutDt ? { checkoutDisplay: short(logoutDt),
                               checkoutTime: `${p2(logoutDt.getHours())}:${p2(logoutDt.getMinutes())}:${p2(logoutDt.getSeconds())}` } : {}),
              hoursWorked: parseFloat(row.hours_worked) || 0,
              sessionTag:  row.status === 'auto_stopped' ? 'autostopped' : 'realtime',
              ...(_isFutureDay
                ? (this._OVERRIDES.has(row.override_type) ? { futurePlan: row.override_type } : {})
                : { override: this._OVERRIDES.has(row.override_type) ? row.override_type : null }),
              ...(row.notes
                ? (_isFutureDay ? { futureReason: row.notes } : { note: row.notes })
                : {}),
              lastUpdated: row.updated_at,
            });
          });

          // Push every local entry that Supabase has never seen
          // This is the missing piece: historical desktop data, offline edits, etc.
          // Full pulls only: a delta pull doesn't list unchanged days, so every
          // local day would look "missing" and be pushed again.
          if (!cursor) {
            Object.entries(Store.allDays()).forEach(([dk, entry]) => {
              if (!inCloud.has(dk)) toPush.push([dk, entry]);
            });
          }

          if (newest) localStorage.setItem(cursorKey, newest);
          if (toPush.length) toPush.forEach(([dk, entry]) => this.pushDay(dk, entry));
          return true; // pulled: local now holds the merged data
        } catch (e) { console.warn('[SbSync] pullAll failed:', e); }
      },

      // ── Settings sync (key-value JSONB) ──────────────────────────────
      // A nonce identifies writes made by THIS tab, so realtime echoes of our
      // own changes can be ignored (prevents update loops / edit clobbering).
      _clientId: (window.crypto?.randomUUID?.() || ('c' + Math.random().toString(36).slice(2))),

      // Immediate upsert of the whole config blob under key='config'. Returns true/false.
      async pushSettings(cfgObj) {
        try {
          const uid = await this._uid();
          if (!uid) { this._lastErr = 'No active session'; return false; }
          const { error } = await window._sbClient.from('user_kv').upsert(
            { user_id: uid, key: 'config', value: { cfg: cfgObj, src: this._clientId }, updated_at: new Date().toISOString() },
            { onConflict: 'user_id,key' }
          );
          if (error) { this._lastErr = error.code || error.message; console.warn('[SbSync] pushSettings:', error.message); return false; }
          return true;
        } catch (e) { this._lastErr = e.message || 'Network error'; console.warn('[SbSync] pushSettings failed:', e); return false; }
      },

      // Fetch the stored config blob (or null if none yet)
      async pullSettings() {
        try {
          const uid = await this._uid();
          if (!uid) return null;
          const { data, error } = await window._sbClient
            .from('user_kv').select('value').eq('user_id', uid).eq('key', 'config').maybeSingle();
          if (error || !data?.value) return null;
          return data.value.cfg || null;
        } catch (e) { console.warn('[SbSync] pullSettings failed:', e); return null; }
      },
    };

    // Debounced persist hook — stamps lastSaved, refreshes UI label
    let _persistTimer=null;
    function persist() {
      if (_persistTimer) clearTimeout(_persistTimer);
      _persistTimer = setTimeout(()=>{
        Store._touch();
        _persistTimer=null;
        _refreshLastSaved();
      }, 400);
    }
    // Live-update the "Last updated X ago" label every 30s
    function _refreshLastSaved() {
      const lsEl=el('settingsLastSaved');
      if (lsEl) { const ls=Store.getLastSaved(); if(ls) lsEl.textContent=timeAgo(ls); }
    }
    setInterval(_refreshLastSaved, 30000);

    // Drive the sync button icon + label
    let _syncResetTimer = null;
    const _isNetErr = m => /failed to fetch|networkerror|load failed|network request failed|timed? ?out/i.test(m || '');
    let _netToastShown = false;
    let _syncLast = null;   // last sync result, for bug reports
    function _setSyncStatus(state) {
      if (state !== 'syncing' && state !== 'default') _syncLast = { state, at: Date.now() };
      const btn = el('syncBtn'), label = el('syncBtnLabel');
      if (!btn) return;
      if (_syncResetTimer) { clearTimeout(_syncResetTimer); _syncResetTimer = null; }

      // Hide all icons first
      el('syncIconDefault').style.display = 'none';
      el('syncIconSpinner').style.display = 'none';
      el('syncIconCheck').style.display   = 'none';
      el('syncIconError').style.display   = 'none';
      btn.classList.remove('syncing', 'synced', 'error');

      if (state === 'syncing') {
        el('syncIconSpinner').style.display = '';
        btn.classList.add('syncing');
        label.textContent = 'Syncing';
      } else if (state === 'failed') {
        el('syncIconError').style.display = '';
        btn.classList.add('error');
        label.textContent = 'Sync Error';
        // Return to default after 2s — but keep error state in backend
        _syncResetTimer = setTimeout(() => _setSyncStatus('default'), 2000);
      } else if (state === 'synced') {
        el('syncIconCheck').style.display = '';
        btn.classList.add('synced');
        label.textContent = 'Synced';
        _netToastShown = false;
        // Return to default after 2s
        _syncResetTimer = setTimeout(() => _setSyncStatus('default'), 2000);
      } else if (state === 'blocked') {
        // The network drops 5pm's requests. Stays until a sync goes through.
        el('syncIconError').style.display = '';
        btn.classList.add('error');
        label.textContent = 'Not Synced';
      } else {
        // default — idle state
        el('syncIconDefault').style.display = '';
        label.textContent = 'Sync';
      }
    }

    // Click handler: in error state → retry; in default → manual sync
    function _onSyncBtnClick() {
      if (_lastFailedDays.length || _lastFailedCfg) {
        retrySyncNow();
      } else if (_hasPending()) {
        _syncNow();
      } else {
        // Nothing dirty — force a full pull+push cycle; reset cooldown timer
        _setSyncStatus('syncing');
        SbSync.pullAll({ full: true }).then(() => {
          localStorage.setItem('wh_last_pull', String(Date.now()));
          _setSyncStatus('synced');
          showToast('Synced', 'success');
        });
      }
    }

    // ══════════════════════════════════════════════════════
    // SYNC ENGINE — dirty-state tracking + batched writes
    // ══════════════════════════════════════════════════════
    //
    // Strategy:
    //   Immediate  → start/end/pause/resume shift, edit/delete session
    //   Debounced  → 20s idle after any change (safety net)
    //   Lifecycle  → visibilitychange, pagehide, beforeunload
    //   Reconnect  → online event flushes pending
    //   Checkpoint → every 10 min while session active + dirty
    //
    // Local-first: UI updates localStorage instantly. Cloud is the
    // backup + multi-device sync layer, never the source of truth
    // for the active device.

    let _applyingRemote = false;

    // ── Local-write guard (survives reloads) ──────────────
    // Marks a day key as having an unsent local write so pullAll never
    // overwrites it with stale remote data. Cleared only after a
    // successful Supabase push.
    const _ND_KEY = 'wh_note_dirty'; // { dateKey: timestamp }
    function _setNoteDirty(dk) {
      try {
        const d = JSON.parse(localStorage.getItem(_ND_KEY) || '{}');
        d[dk] = Date.now();
        localStorage.setItem(_ND_KEY, JSON.stringify(d));
      } catch {}
    }
    function _clearNoteDirty(dk) {
      try {
        const d = JSON.parse(localStorage.getItem(_ND_KEY) || '{}');
        if (!(dk in d)) return;
        delete d[dk];
        if (Object.keys(d).length) localStorage.setItem(_ND_KEY, JSON.stringify(d));
        else localStorage.removeItem(_ND_KEY);
      } catch {}
    }
    function _isNoteDirty(dk) {
      try {
        const d = JSON.parse(localStorage.getItem(_ND_KEY) || '{}');
        const ts = d[dk];
        return !!ts && (Date.now() - ts < 300000); // 5-min guard window
      } catch { return false; }
    }

    // ── Dirty-state tracking ──────────────────────────────
    const _dirtyDays = new Set();   // date keys with unsynced changes
    let _dirtyCfg = false;          // cfg changed since last push
    let _idleSyncTimer = null;      // 20s idle debounce
    let _checkpointTimer = null;    // 10 min periodic checkpoint
    let _lastPushAt = 0;            // last successful save (any trigger), for the checkpoint

    function _markDirty(dk) {
      if (_applyingRemote) return;
      _dirtyDays.add(dk);
      _scheduleIdleSync();
    }

    function _markCfgDirty() {
      if (_applyingRemote) return;
      _dirtyCfg = true;
      _scheduleIdleSync();
    }

    function _hasPending() {
      return _dirtyDays.size > 0 || _dirtyCfg;
    }

    // ── Flush: batch-push all dirty state ─────────────────
    let _syncInFlight = false;
    let _lastFailedDays = [];
    let _lastFailedCfg  = false;

    async function _flushSync(opts) {
      _flushLiveLog();
      const silent = opts?.silent || false; // silent = no toasts (lifecycle flushes)
      if (!_hasPending() && !_lastFailedDays.length && !_lastFailedCfg) return;

      // Snapshot and clear before async — new mutations go into next batch
      const days = _lastFailedDays.length ? _lastFailedDays : [..._dirtyDays];
      const cfgDirty = _lastFailedCfg || _dirtyCfg;
      _dirtyDays.clear();
      _dirtyCfg = false;
      _lastFailedDays = [];
      _lastFailedCfg  = false;

      if (!days.length && !cfgDirty) return;
      _syncInFlight = true;
      _setSyncStatus('syncing');
      SbSync._lastErr = '';

      let failed = false;
      const failedDays = [];

      // Batch day pushes — includes future dates (plans and notes on upcoming days)
      for (const dk of days) {
        const entry = Store.getDay(dk);
        // A deleted day goes up at once as a blank row, which every device
        // reads as "deleted" (see pullAll). One request per delete.
        const ok = await SbSync.pushDay(dk, entry || { lastUpdated: new Date().toISOString() });
        if (!ok) { failed = true; failedDays.push(dk); }
      }
      // Settings push
      if (cfgDirty) {
        const ok = await SbSync.pushSettings(cfg());
        if (!ok) { failed = true; _lastFailedCfg = true; }
      }

      _syncInFlight = false;

      if (failed && _isNetErr(SbSync._lastErr)) {
        // Offline, or a network (often a work VPN or firewall) that drops 5pm's
        // requests. Nothing to fix from here, so explain once, not every retry.
        _lastFailedDays = failedDays;
        _setSyncStatus('blocked');
        if (!silent && !_netToastShown) {
          _netToastShown = true;
          const online = navigator.onLine;
          showToast(online ? 'Not Syncing on This Network' : "You're Offline", 'info',
            "Your hours are saved on this device and will sync once " + (online ? 'this network lets 5pm through.' : "you're back online."),
            { label: 'Retry', onClick: retrySyncNow });
        }
      } else if (failed) {
        _lastFailedDays = failedDays;
        _setSyncStatus('failed');
        // The sync chip already conveys success/in-progress; only surface failures,
        // with the error code and a one-tap retry.
        if (!silent) showToast('Sync failed', 'error', SbSync._lastErr || 'Please try again', { label: 'Retry', onClick: retrySyncNow });
      } else {
        _lastPushAt = Date.now();
        _setSyncStatus('synced');
        // Success / in-progress are shown via the sync chip — no toast (per design).
      }
    }

    // ── Retry (called from UI) ─────────────────────────────
    function retrySyncNow() {
      // Re-mark anything that failed so _flushSync picks it up
      _flushSync();
    }

    // ── Immediate sync (important actions) ─────────────────
    function _syncNow() {
      if (_idleSyncTimer) { clearTimeout(_idleSyncTimer); _idleSyncTimer = null; }
      _flushSync();
    }

    // ── Debounced idle sync (20s safety net) ───────────────
    function _scheduleIdleSync() {
      if (_idleSyncTimer) clearTimeout(_idleSyncTimer);
      _idleSyncTimer = setTimeout(() => { _idleSyncTimer = null; _flushSync(); }, 20000);
    }

    // ── Periodic checkpoint (while active + dirty) ──
    // At most one save per 10 minutes, counted from the last successful save of
    // any kind. A tab-hide or Pause save resets the clock, so the checkpoint
    // never sends a second copy minutes later. Checks once a minute, so the
    // cloud copy of a running session is never more than ~10 min behind.
    const _CHECKPOINT_MS = 10 * 60 * 1000;
    function _startCheckpoint() {
      if (_checkpointTimer) return;
      _checkpointTimer = setInterval(() => {
        if (_hasPending() && Date.now() - _lastPushAt >= _CHECKPOINT_MS) _flushSync({ silent: true });
      }, 60 * 1000);
    }
    function _stopCheckpoint() {
      if (_checkpointTimer) { clearInterval(_checkpointTimer); _checkpointTimer = null; }
    }

    // ── Lifecycle hooks ────────────────────────────────────
    // visibilitychange: tab hidden / app minimized → flush silently
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') _flushSync({ silent: true });
      else _refreshFromCloud();
    });
    // pagehide: PWA close, navigation away
    window.addEventListener('pagehide', () => {
      _flushSync({ silent: true });
    });
    // beforeunload: flush silently if dirty. Never block the unload. An active
    // session already survives a reload (restoreSession + _startCheckpoint in
    // init), so the "Leave site?" prompt only ever cost the user a click.
    window.addEventListener('beforeunload', () => {
      if (_hasPending() || _syncInFlight) _flushSync({ silent: true });
    });
    // online: network reconnect → flush queued mutations
    window.addEventListener('online', () => {
      if (_hasPending() || _lastFailedDays.length || _lastFailedCfg) {
        showToast('Back Online', 'info', '', null);
        _flushSync();
      }
    });
    // pageshow: bfcache restore (back/forward). init() does NOT re-run on a
    // bfcache restore, so without this the app returns showing whatever was on
    // screen when it was backgrounded.
    window.addEventListener('pageshow', e => { if (e.persisted) _refreshFromCloud(true); });

    // ── Refresh from cloud ────────────────────────────────
    // Pull latest, reconcile a session ended on another device, then re-render.
    // Called on launch (force) and on every resume: tab refocus, PWA foreground,
    // bfcache restore. Pulling only at launch left resumed tabs showing stale data.
    // When today's log says the session ended, as a time today. checkoutTime has
    // seconds; a pause only stores the display string.
    function _logEndAt(log) {
      if (log?.checkoutTime) {
        const p = log.checkoutTime.split(':').map(Number);
        const d = new Date(); d.setHours(p[0] || 0, p[1] || 0, p[2] || 0, 0);
        return d;
      }
      return log?.checkoutDisplay ? parse(log.checkoutDisplay) : null;
    }

    let _lastPullAt = 0;
    // full: download every row (launch). Otherwise only rows changed since the
    // last pull (see SbSync.pullAll).
    function _refreshFromCloud(force, full) {
      // ponytail: 30s throttle so ordinary tab-switching does not hammer Supabase.
      // Lower it if cross-device lag matters more than request volume.
      if (_dropStaleLive()) force = true;
      if (!force && Date.now() - _lastPullAt < 30000) return;
      _lastPullAt = Date.now();
      return SbSync.pullAll({ full }).then(pulled => {
        localStorage.setItem('wh_last_pull', String(Date.now()));
        // Only on merged data: closing a stale local copy offline would stamp it
        // newer than the other device's real hours and overwrite them.
        if (pulled) _closeStaleDays();

        // ── Cross-device session reconciliation ──────────────────────────────
        // If Supabase says today's session is ended (another device checked out)
        // but we still have a live local ticker running, force-stop silently —
        // no modals, no prompts. Whichever device has the latest timestamp wins.
        //
        // checkoutDisplay alone is NOT enough to conclude that. endSession()
        // (Pause) writes it too, and Resume does not clear it, so a paused-then-
        // resumed session sits there with a live loginDate AND a checkoutDisplay
        // left over from the pause. This used to force-stop that session on the
        // next resume-driven pull, which is every tab switch past the 30s
        // throttle: the session appeared to pause itself a few seconds after
        // being resumed, over and over.
        //
        // The discriminator is the end time itself: a genuine remote end is
        // after our current session began; a stale pause end is before it.
        // It used to compare lastUpdated, but a running session rewrites that
        // every 30s, so after any pause and resume the next refresh (a relaunch
        // after an update, showing the window) "ended" the session at a random
        // hour. (Relies on the two devices' clocks being roughly in step, which
        // is already true for everything else here.)
        const _pulled = Store.getDay(todayKey());
        const _endAt = _logEndAt(_pulled);
        const _endedRemotely = !!loginDate && !!_endAt && _endAt.getTime() > loginDate.getTime();
        if (_endedRemotely) {
          cancelScheduledNotifications();
          if (ticker) { clearInterval(ticker); ticker = null; }
          _stopCheckpoint();
          loginDate = null; autoStopped = false; wasDone = false; notifSent = false;
          _sessionAccSecs = _pulled.hoursWorked ? Math.round(_pulled.hoursWorked * 3600) : 0;
          Store.clearSession();
          setCalcBtnState('start'); // session ended on another device — show Quick Start, not Resume
          el('shiftInputRow').classList.remove('active-state', 'hidden');
          el('shiftActiveLabel').textContent = '—';
          el('autostopBanner').classList.remove('show');
          // Close any modals that fired from stale local state before the pull landed
          el('dailyTargetReachedOverlay')?.classList.remove('open');
          el('endSessionOverlay')?.classList.remove('open');
        }

        // And the other way round: a session started on another device since
        // this one last looked. Pick it up instead of showing an empty day.
        else if (!loginDate && !autoStopped && _resumeFromLog(_pulled)) _startCheckpoint();

        // Penalties live on the one-page layout now; nothing else renders them at launch.
        renderHistory(); renderDaySelector(); renderPenalties();
        // Don't call render() for auto-stopped sessions — the ticker is dead and
        // render() would incorrectly fire the Daily Target modal.
        if (!loginDate || autoStopped) renderEmptyState(); else render();
      });
    }

    // Launch glance: the pill shows once the splash is gone and stays until the
    // first pull is done, at least half a second so it reads as a glance, not a
    // flicker. Capped at 8 s so a slow network can't leave it up.
    function _syncGlance(pull) {
      const pill = el('syncPill');
      if (!pill || !pull || !navigator.onLine) return;
      const splashGone = new Promise(r => {
        const t = setInterval(() => {
          const l = el('appLoader');
          if (!l || l.classList.contains('app-loader-out')) { clearInterval(t); r(); }
        }, 50);
      });
      splashGone.then(() => {
        pill.classList.add('show');
        const minShown = new Promise(r => setTimeout(r, 500));
        const done = Promise.race([pull.catch(() => {}), new Promise(r => setTimeout(r, 8000))]);
        Promise.all([minShown, done]).then(() => pill.classList.remove('show'));
      });
    }

    // ── saveDayLog / saveCfg — local-first, dirty-tracked ──
    function saveDayLog(k, v) {
      Store.setDay(k, v);
      persist();
      _markDirty(k);
    }

    // Immediate sync variant — for important user actions
    function saveDayLogAndSync(k, v) {
      Store.setDay(k, v);
      persist();
      _markDirty(k);
      _syncNow();
    }

    const saveCfg = v => {
      Store.setCfg(v); persist();
      _markCfgDirty();
    };

    // Immediate settings sync — for important changes
    const saveCfgAndSync = v => {
      Store.setCfg(v); persist();
      _markCfgDirty();
      _syncNow();
    };

    // ── REAL-TIME SYNC ────────────────────────────────────────────────────────
    // Streams this user's setting & work-log changes from Supabase to all their
    // open devices using Postgres Changes, filtered to their own user_id (privacy
    // + free-tier bandwidth). Incoming data is piped straight into local state.
    let _sbRealtimeCh = null;
    function initRealtimeSync() {
      SbSync._uid().then(uid => {
        if (!uid || _sbRealtimeCh) return;
        _sbRealtimeCh = window._sbClient
          .channel('user-sync-' + uid)
          .on('postgres_changes',
              { event: '*', schema: 'public', table: 'user_kv', filter: 'user_id=eq.' + uid },
              _onRemoteSettings)
          .on('postgres_changes',
              { event: '*', schema: 'public', table: 'work_logs', filter: 'user_id=eq.' + uid },
              _onRemoteWorkLog)
          .subscribe();
      });
    }

    // Apply a settings change pushed from another device into UI state
    function _onRemoteSettings(payload) {
      const row = payload.new || {};
      // user_kv carries both the config blob and the devices map.
      if (row.key === 'devices') { _onRemoteDevices(row); return; }
      if (row.key !== 'config' || !row.value) return;
      if (row.value.src === SbSync._clientId) return;       // ignore our own echo
      const remoteCfg = row.value.cfg;
      if (!remoteCfg || typeof remoteCfg !== 'object') return;
      _applyingRemote = true;
      try {
        Store.setCfg(remoteCfg);
        populateSettings();
        renderDaySelector();
        renderNotifs(); // update dismissed state immediately on this device
        if (loginDate) render(); else renderEmptyState();
        showToast('Settings updated', 'info', 'Changes from another device were synced.');
      } finally { _applyingRemote = false; }
    }

    // Apply a work-log change pushed from another device into UI state
    function _onRemoteWorkLog(payload) {
      const newRow = payload.new || {};
      const oldRow = payload.old || {};
      const dk = newRow.log_date || oldRow.log_date;
      if (!dk) return;
      _applyingRemote = true;
      try {
        if (payload.eventType === 'DELETE') {
          Store.remove(KEY.day + dk);
        } else {
          // Skip if our local copy is already as new (avoids overwriting fresh edits / own echo)
          const local = Store.getDay(dk);
          const blank = SbSync._isBlank(newRow);
          if (local?.lastUpdated && newRow.updated_at &&
              new Date(local.lastUpdated) >= new Date(newRow.updated_at) && !(blank && local.lastUpdated === newRow.updated_at)) return;
          // Blanked by a delete on another device.
          if (blank) Store.remove(KEY.day + dk);
          const loginDt  = newRow.login_time  ? new Date(newRow.login_time)  : null;
          const logoutDt = newRow.logout_time ? new Date(newRow.logout_time) : null;
          // Future days carry futurePlan/futureReason; past/today carry override/note
          const _isFutureDay = new Date(dk + 'T12:00') > new Date() && dk !== todayKey();
          if (!blank) Store.setDay(dk, {
            ...(loginDt  ? { loginTime: `${loginDt.getHours()}:${loginDt.getMinutes()}:${loginDt.getSeconds()}`,
                             loginDisplay: short(loginDt) } : {}),
            ...(logoutDt ? { checkoutDisplay: short(logoutDt),
                             checkoutTime: `${p2(logoutDt.getHours())}:${p2(logoutDt.getMinutes())}:${p2(logoutDt.getSeconds())}` } : {}),
            hoursWorked: parseFloat(newRow.hours_worked) || 0,
            sessionTag:  newRow.status === 'auto_stopped' ? 'autostopped' : 'realtime',
            ...(_isFutureDay
              ? (SbSync._OVERRIDES.has(newRow.override_type) ? { futurePlan: newRow.override_type } : {})
              : { override: SbSync._OVERRIDES.has(newRow.override_type) ? newRow.override_type : null }),
            ...(newRow.notes
              ? (_isFutureDay ? { futureReason: newRow.notes } : { note: newRow.notes })
              : {}),
            lastUpdated: newRow.updated_at,
          });
        }
        // A session just started on another device: run it here too.
        if (dk === todayKey() && !loginDate && !autoStopped && _resumeFromLog(Store.getDay(dk))) _startCheckpoint();
        renderDaySelector();
        renderHistory();
        // Don't collapse future-day plan view on realtime echo
        const _onFuturePlanView = el('futureDayPlan')?.style.display !== 'none';
        if (_onFuturePlanView) {
          const _log = Store.getDay(selectedDayKey);
          const _day = week(daySelectorWeekOffset).find(d => d.key === selectedDayKey);
          _renderFutureDayInline(selectedDayKey, _log, _day);
          _renderFutureDayBadge();
        } else if (!loginDate) {
          renderEmptyState();
        }
      } finally { _applyingRemote = false; }
    }

    // Today's log has a start and no end: a session is running, here or on
    // another device. Run its timer on this one. Launch, the pull when the app
    // comes back to the foreground, and live updates all come through here, so
    // a phone shows the desktop's session without a reload. False when the
    // start time is still in the future.
    function _resumeFromLog(tl) {
      if (!tl?.loginTime || tl.autostopped || tl.checkoutDisplay) return false;
      const pts = tl.loginTime.split(':').map(Number);
      const d = new Date(); d.setHours(pts[0] || 0, pts[1] || 0, pts[2] || 0, 0);
      if (d <= new Date()) {
        // loginTime is the day's first start, so after a pause it doesn't
        // mark the running segment. The log's hours were current as of
        // lastUpdated, so carry on from there instead of counting the pause.
        const at = tl.lastUpdated ? new Date(tl.lastUpdated) : null;
        if (tl.hoursWorked != null && at && !isNaN(at) && at >= d && at <= new Date()) {
          _sessionAccSecs = Math.round(tl.hoursWorked * 3600);
          loginDate = at;
        } else {
          loginDate = d;
        }
        setCalcBtnState('running');
        el('shiftInputRow').classList.add('active-state');
        el('shiftActiveLabel').textContent = `Started at ${short(d)}`;
        render();
        if (ticker) clearInterval(ticker);
        ticker = setInterval(render, 1000);
        return true;
      }
      return false;
    }

    // Session state persistence
    function persistSession() {
      if (!loginDate) { Store.clearSession(); return; }
      Store.setSession({ loginISO:loginDate.toISOString(), accSecs:_sessionAccSecs,
                         sessionDate:todayKey(), autoStopped, sessionTag:'realtime' });
    }

    function restoreSession() {
      const s=Store.getSession();
      if (!s||s.sessionDate!==todayKey()) { Store.clearSession(); return; }
      _sessionAccSecs = s.accSecs||0;
      if (s.loginISO && !s.autoStopped) {
        const d=new Date(s.loginISO);
        if (isNaN(d.getTime())||d>new Date()) { Store.clearSession(); return; }
        loginDate=d;
        setCalcBtnState('running');
        el('shiftInputRow').classList.add('active-state');
        el('shiftActiveLabel').textContent=`Started at ${short(loginDate)}`;
        el('autostopBanner').classList.remove('show');
        if (ticker) clearInterval(ticker);
        ticker=setInterval(render,1000);
      } else if (_sessionAccSecs>0) {
        setCalcBtnState('ended');
      }
    }

    // ── Import Modal (Settings) ───────────────────────
    function openImportModal() {
      _setPage('pageImport', 'Import Backup', 'Restore your data from a .json backup file.', page => {
        const card = document.createElement('div');
        card.className = 'set-card';
        card.append(...el('importModal').querySelector('.dialog-body').children);
        page.appendChild(card);
        el('importModal').remove();
      });
      const zoneText = el('importModalZoneText');
      if (zoneText) zoneText.innerHTML = '<strong>Choose a file or drag &amp; drop here</strong><br>Supports .json files';
      const status = el('importModalStatus');
      if (status) { status.style.display = 'none'; status.textContent = ''; }
      const fileInp = el('importModalFile'); if (fileInp) fileInp.value = '';
    }
    function closeImportModal() { closeSetPage(); }

    // Export Backup — structured v2 JSON with user-friendly filename
    function exportBackup() {
      const snap = Store.snapshot();
      const c    = cfg();
      const name = (c.name || '').trim().replace(/\s+/g, '_') || 'log';
      const date = new Date().toISOString().slice(0, 10);
      const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `wh_${name}_${date}.json`;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
      showToast('Exporting', 'success', 'Your data is ready to download.');
    }

    function importLogFile(file) {
      if (!file) return;
      const r = new FileReader();
      r.onload = ev => {
        try {
          const raw  = ev.target.result;
          const snap = JSON.parse(raw);

          // ── Structural validation ──
          if (typeof snap !== 'object' || Array.isArray(snap) || snap === null)
            throw new Error('Root must be a JSON object');

          const days = snap.tracking?.days || snap.days || snap;
          if (typeof days !== 'object' || Array.isArray(days))
            throw new Error('No valid day-log data found');

          // Warn if schema version is newer than we know about
          const schemaVer = snap.meta?.schemaVersion || snap.schema || 1;

          // Count restorable days for the confirmation dialog
          const dayCount = Object.keys(days).length;
          const userName = snap.user?.name || snap.cfg?.name || '';
          const exportedAt = snap.exportedAt
            ? new Date(snap.exportedAt).toLocaleDateString(undefined, { year:'numeric', month:'short', day:'numeric' })
            : null;

          // Populate info card
          const infoUser = el('importInfoUser');
          const infoMeta = el('importInfoMeta');
          if (infoUser) infoUser.textContent = userName || 'Unknown user';
          if (infoMeta) {
            const parts = [];
            if (exportedAt) parts.push(`Exported ${exportedAt}`);
            parts.push(`${dayCount} day${dayCount !== 1 ? 's' : ''} of data`);
            infoMeta.textContent = parts.join(' · ');
          }

          // The Import Backup page stays behind the confirm; Cancel returns to it.
          el('importConfirmOverlay').classList.add('open');
          el('importConfirmOverlay')._pendingSnap = snap;
        } catch (err) {
          showToast(`Import failed: ${err.message || 'Invalid backup file'}`, 'error');
          ['logFileInput', 'importModalFile'].forEach(id => { const inp = el(id); if (inp) inp.value = ''; });
        }
      };
      r.onerror = () => {
        showToast('Could not read file', 'error', 'Upload in json format');
        ['logFileInput', 'importModalFile'].forEach(id => { const inp = el(id); if (inp) inp.value = ''; });
      };
      r.readAsText(file);
    }

    function confirmImport() {
      const snap = el('importConfirmOverlay')._pendingSnap;
      if (!snap) return;

      const ok = Store.importSnap(snap);
      if (!ok) {
        showToast('Import Failed', 'error', "Couldn't merge data");
        el('importConfirmOverlay').classList.remove('open');
        ['logFileInput','importModalFile'].forEach(id=>{const inp=el(id);if(inp)inp.value=''});
        return;
      }

      SbSync.pushAll(); // sync imported history to Supabase (fire-and-forget)
      Store.clearSession();
      loginDate = null; _sessionAccSecs = 0; _sessionCheckoutTime = null;
      autoStopped = false; wasDone = false; notifSent = false;
      if (ticker) { clearInterval(ticker); ticker = null; }

      el('importConfirmOverlay').classList.remove('open');
      ['logFileInput','importModalFile'].forEach(id=>{const inp=el(id);if(inp)inp.value=''});
      closeImportModal(); // done: back to Settings

      // Full UI refresh
      selectedDayKey = todayKey();
      renderDaySelector();
      renderEmptyState();
      populateSettings();

      // Navigate analytics to the most recent week with data
      const days  = snap.tracking?.days || snap.days || {};
      const count = Object.keys(days).length;
      if (count > 0) {
        const latestKey = Object.keys(days).sort().pop();
        const latestDate = new Date(latestKey + 'T12:00:00');
        const today = new Date();
        const msPerWeek = 7 * 24 * 60 * 60 * 1000;
        const weeksDiff = Math.round((today - latestDate) / msPerWeek);
        analyticsWeekOffset = -Math.max(0, weeksDiff);
      }
      renderAnalytics();

      const name  = snap.user?.name || snap.cfg?.name || '';
      showToast('Import Successful', 'success', `${count} day${count !== 1 ? 's' : ''} restored${name ? ` · Welcome back, ${name}!` : '.'}`);
    }

    function saveDayEditModal() {
      const key = _dayEditKey; if (!key) return;
      if (_isWkndNoteModal) {
        const ex = dayLog(key) || {};
        const noteVal = el('deNote')?.value.trim() || '';
        const ts = new Date().toISOString();
        _setNoteDirty(key); // guard against pullAll race before push lands
        if (noteVal) { saveDayLogAndSync(key, { ...ex, note: noteVal, lastUpdated: ts }); }
        else { const u = { ...ex }; delete u.note; u.lastUpdated = ts; saveDayLogAndSync(key, u); }
        closeDayEditModal();
        renderWeekendState(key, 'weekend');
        renderDaySelector();
        return;
      }
      const s = parse(el('deStart').value), e = parse(el('deEnd').value);
      const c = cfg();
      const ex = dayLog(key) || {};
      const isToday = key === todayKey();

      // Check active override button
      let activeOverride = el('deHalfDay').classList.contains('active') ? 'halfday'
        : el('deHoliday').classList.contains('active') ? 'holiday'
        : el('deLeave').classList.contains('active') ? 'leave' : null;
      const _deNoteVal = el('deNote')?.value.trim() || '';

      // Half-day demotion: if the half-day layout is active but the user has entered real
      // login + logout times that exceed half the daily target, treat it as a normal entry
      // (switch back to the default duration/target layout instead of the half-day card).
      if (activeOverride === 'halfday' && s && e) {
        const _eHd = e <= s ? new Date(e.getTime() + 24 * 3600 * 1000) : e;
        if (Math.floor((_eHd - s) / 1000) > (c.dailyH * 3600) / 2) activeOverride = null;
      }

      const _isFutureDay = new Date(key + 'T12:00') > new Date() && key !== todayKey();
      if (activeOverride === 'halfday') {
        if (_isFutureDay) {
          saveDayLogAndSync(key, { ...ex, futurePlan: 'halfday', ...(_deNoteVal ? { futureReason: _deNoteVal } : { futureReason: null }) });
        } else {
          saveDayLogAndSync(key, { ...ex, hoursWorked: c.dailyH / 2, override: 'halfday', sessionTag: 'edited', ...(_deNoteVal ? { note: _deNoteVal } : { note: null }) });
        }
      } else if (activeOverride === 'holiday' || activeOverride === 'leave') {
        if (_isFutureDay) {
          saveDayLogAndSync(key, { ...ex, futurePlan: activeOverride, ...(_deNoteVal ? { futureReason: _deNoteVal } : { futureReason: null }) });
        } else {
          saveDayLogAndSync(key, { ...ex, hoursWorked: 0, override: activeOverride, sessionTag: 'edited', ...(_deNoteVal ? { note: _deNoteVal } : { note: null }) });
        }
      } else if (s && !e && isToday) {
        // Today — end time is optional (session may not be done yet)
        if (loginDate) {
          // Session active — update login time, preserve accumulated work
          const oldWorked = Math.max(0, Math.floor((new Date() - loginDate) / 1000)) + _sessionAccSecs;
          loginDate = s;
          const newCurrentSecs = Math.max(0, Math.floor((new Date() - loginDate) / 1000));
          _sessionAccSecs = Math.max(0, oldWorked - newCurrentSecs);
          el('shiftActiveLabel').textContent = `Started at ${short(s)}`;
          persistSession();
        } else {
          // No active session — start one from the given time
          loginDate = s; wasDone = false; notifSent = false; autoStopped = false;
          setCalcBtnState('running');
          el('shiftInputRow').classList.add('active-state');
          el('shiftActiveLabel').textContent = `Started at ${short(s)}`;
          persistSession();
          if (ticker) clearInterval(ticker);
          ticker = setInterval(render, 1000);
        }
        saveDayLogAndSync(key, { ...ex,
          loginTime: `${s.getHours()}:${s.getMinutes()}:${s.getSeconds()}`,
          loginDisplay: short(s), sessionTag: 'edited',
          lastUpdated: new Date().toISOString(), override: null,
          ...(_deNoteVal ? { note: _deNoteVal } : { note: null })
        });
        el('deErr').classList.remove('show');
        persist();
        closeDayEditModal();
        renderHistory(); renderDaySelector(); renderPenalties(); renderSurplusCircles();
        selectDay(key);
        return;
      } else {
        if (!s) { el('deErr').textContent = 'Enter a start time.'; el('deErr').classList.add('show'); return; }
        if (!e) { el('deErr').textContent = 'Enter an end time.'; el('deErr').classList.add('show'); return; }
        // Overnight shift: if end <= start, treat end as next day
        const eAdj = e <= s ? new Date(e.getTime() + 24 * 3600 * 1000) : e;
        el('deErr').classList.remove('show');
        const worked = Math.floor((eAdj - s) / 1000);
        saveDayLogAndSync(key, { ...ex,
          loginTime:      `${s.getHours()}:${s.getMinutes()}:${s.getSeconds()}`,
          loginDisplay:   short(s),
          checkoutDisplay: short(eAdj),
          hoursWorked:    worked / 3600,
          lastUpdated:    new Date().toISOString(),
          sessionTag:     'edited',
          override:       null,
          ...(_deNoteVal ? { note: _deNoteVal } : { note: null })
        });
        // Exit time was explicitly set for today → end any active session.
        // Also covers a *paused* day (loginDate already null, but _sessionAccSecs
        // still holds the accumulated time): renderEmptyState reads _sessionAccSecs
        // in preference to the saved log, so leaving it stale here would make the
        // edit appear to do nothing.
        if (isToday && (loginDate || _sessionAccSecs > 0)) {
          if (ticker) { clearInterval(ticker); ticker = null; }
          _stopCheckpoint();
          loginDate = null; autoStopped = false; _sessionAccSecs = 0;
          Store.clearSession();
          setCalcBtnState('ended');
          el('shiftInputRow').classList.remove('active-state', 'hidden');
          el('shiftActiveLabel').textContent = '—';
          el('autostopBanner').classList.remove('show');
        }
      }

      persist();
      closeDayEditModal();
      renderHistory();
      renderDaySelector();
      renderPenalties();
      renderSurplusCircles();
      // Always refresh the overview when editing today, regardless of session state
      if (key === todayKey()) {
        selectDay(key); // also removes weekend-mode if override was cleared
      } else if (key === selectedDayKey) {
        const _isFutureSave = new Date(key + 'T12:00') > new Date() && key !== todayKey();
        if (_isFutureSave) selectFutureDay(key);
        else selectDay(key);
      }
    }

    // ── WEEK PLAN MODAL ────────────────────────────────
    const WP_DISMISSED_KEY = 'wh_wp_dismissed';
    function getWpDismissedWeek() {
      try { return localStorage.getItem(WP_DISMISSED_KEY) || ''; } catch { return ''; }
    }
    function currentWeekId() {
      const wk = week(0); return wk[0].key;
    }
    function shouldShowWeekPlan() {
      if (new Date().getDay() !== 1) return false; // only on Mondays
      if (getWpDismissedWeek() === currentWeekId()) return false;
      return true;
    }
    function openWeekPlanModal() {
      const c = cfg(), wk = week(0), tk = todayKey();
      const mon = wk[0].date, fri = wk[4].date;
      el('wpWeekRange').textContent = `${MONTHS[mon.getMonth()]} ${mon.getDate()}–${fri.getDate()} · Confirm your schedule`;

      // One dropdown per day. A change saves straight away, as before.
      const rows = el('wpDayRows');
      rows.innerHTML = _wpDayRowsHtml(wk, tk, 'wpSel');
      rows.onchange = _wpOnChange;
      window.MenuSelect?.enhance(rows); // same menu on every device

      // Early Leave and Stay Late: any number of days each, as in Settings.
      // To-do lists in two collapsible sections, both collapsed on open.
      const row = (name, value, on, label) =>
        `<label class="wp-todo-row"><input type="checkbox" name="${name}" value="${value}"${on ? ' checked' : ''}><span class="wp-todo-box" aria-hidden="true"></span>${label}</label>`;
      const earlyDays = c.earlyLeaveDays || (c.targetDay != null ? [c.targetDay] : []);
      el('wpTargetDay').innerHTML = FULL_DAY_NAMES.map((n, i) => row('wpEarly', i + 1, earlyDays.includes(i + 1), n)).join('');
      el('wpLateDays').innerHTML = FULL_DAY_NAMES.map((n, i) => row('wpLate', i, (c.lateDays || []).includes(i), n)).join('');
      el('wpTargetDay').onchange = _wpMoreSummary;
      el('wpLateDays').onchange = _wpMoreSummary;
      ['wpEarlyAcc', 'wpLateAcc'].forEach(id => {
        const acc = el(id), head = acc.querySelector('.wp-acc-head'), body = acc.querySelector('.wp-acc-body');
        const set = open => { acc.classList.toggle('open', open); head.setAttribute('aria-expanded', String(open)); body.inert = !open; };
        set(false);
        head.onclick = () => set(!acc.classList.contains('open'));
      });
      _wpMoreSummary();

      // Apply recommend timings visibility
      const rec = cfg().recommendTimings !== false;
      const wpBlock = el('wpRecommendBlock');
      if (wpBlock) wpBlock.style.display = rec ? '' : 'none';
      el('weekPlanOverlay').classList.add('open');
    }

    // Day plan rows (Plan Your Week and onboarding): a label and a dropdown per day.
    function _wpDayRowsHtml(wk, tk, idPrefix) {
      const opts = [['fullday', 'Full Day'], ['halfday', 'Half Day'], ['leave', 'Leave'], ['holiday', 'Holiday']];
      return wk.map(day => {
        const log = dayLog(day.key);
        // futurePlan is set by Future Days page; override by confirmed entries — read both
        const ov = log?.futurePlan || log?.override || 'fullday';
        const isToday = day.key === tk, id = `${idPrefix}-${day.key}`;
        return `<div class="wp-day-row">
          <label class="wp-day-name${isToday ? ' today' : ''}" for="${id}">${day.name}${isToday ? ' (Today)' : ''}</label>
          <select class="wp-select" id="${id}" data-wp-key="${day.key}">
            ${opts.map(([v, l]) => `<option value="${v}"${v === ov ? ' selected' : ''}>${l}</option>`).join('')}
          </select>
        </div>`;
      }).join('');
    }
    function _wpOnChange(e) { const s = e.target.closest('[data-wp-key]'); if (s) wpSetOverride(s.dataset.wpKey, s.value); }

    // Settings › Advanced: each collapsed header shows its picked days.
    function _setDaysSummary() {
      const pick = id => [...(el(id)?.querySelectorAll('.plan-btn.selected') || [])].map(b => b.textContent.trim().slice(0, 3));
      if (el('setShortSum')) el('setShortSum').textContent = pick('targetDayPicker').join(', ') || 'None';
      if (el('setLongSum')) el('setLongSum').textContent = pick('dayPicker').join(', ') || 'None';
    }

    // Each collapsed header shows its pick, e.g. "Fri" or "Tue, Thu".
    function _wpMoreSummary() {
      const short3 = i => FULL_DAY_NAMES[i].slice(0, 3);
      const early = [...el('wpTargetDay').querySelectorAll('input:checked')].map(x => short3(+x.value - 1));
      const late = [...el('wpLateDays').querySelectorAll('input:checked')].map(x => short3(+x.value));
      el('wpEarlySum').textContent = early.join(', ') || 'None';
      el('wpLateSum').textContent = late.join(', ') || 'None';
    }

    function wpSetOverride(key, type) {
      const c = cfg(), ex = dayLog(key) || {};
      if (type === 'fullday') {
        if (ex.override) { delete ex.override; saveDayLogAndSync(key, ex); }
      } else if (type === 'halfday') {
        saveDayLogAndSync(key, { ...ex, hoursWorked: c.dailyH / 2, override: 'halfday', sessionTag: 'edited' });
      } else {
        saveDayLogAndSync(key, { ...ex, hoursWorked: 0, override: type, sessionTag: 'edited' });
      }
    }

    function saveWeekPlan() {
      const c = cfg();
      // Saved the way Settings saves it: the list, plus the first day as targetDay
      // (the leave-time hint reads that one).
      const earlyLeaveDays = [...el('wpTargetDay').querySelectorAll('input:checked')].map(b => +b.value);
      const targetDay = earlyLeaveDays.length ? earlyLeaveDays[0] : null;
      const lateDays = [...el('wpLateDays').querySelectorAll('input:checked')].map(b => +b.value);
      saveCfg({ ...c, earlyLeaveDays, targetDay, lateDays });
      localStorage.setItem(WP_DISMISSED_KEY, currentWeekId());
      el('weekPlanOverlay').classList.remove('open');
      if (loginDate) render(); else renderEmptyState();
    }

    function dismissWeekPlan() {
      localStorage.setItem(WP_DISMISSED_KEY, currentWeekId());
      el('weekPlanOverlay').classList.remove('open');
    }

    // ── AUTO-STOP RECOVERY ─────────────────────────────
    // Offers a one-tap end-time correction for a session that was
    // automatically stopped after exceeding the daily limit.
    let _asrDayKey = null;       // day being corrected (null = demo/dev)
    let _asrOriginal = '';       // prefilled value; Update enabled only when changed

    // Scan recent days for an auto-stopped session not yet acknowledged.
    function checkAutoStopRecovery() {
      const candidate = Object.entries(Store.allDays())
        .filter(([k, v]) => v && v.autostopped && !_asrSeen(k))
        .sort((a, b) => (a[0] < b[0] ? 1 : -1))[0]; // newest first
      if (candidate) { openAutoStopRecovery(candidate[0]); return true; }
      return false;
    }
    function _asrSeen(k)    { try { return localStorage.getItem('wh_asr_seen_' + k); } catch { return false; } }
    function _asrMarkSeen(k){ if (k) { try { localStorage.setItem('wh_asr_seen_' + k, '1'); } catch {} } }

    // Daily Target Reached modal — persisted per-day, separate from the in-memory
    // `wasDone` flag. `wasDone` resets to false on every script reload (module load),
    // but on mobile a PWA gets backgrounded/killed and reopened constantly. Once the
    // user has resolved the modal (Keep Going or End Session) for a day, `worked` stays
    // >= target for the rest of that day's overtime — so on the next reload `isDone`
    // is true again with a fresh `wasDone === false`, and without this flag the modal
    // (and its ticker-pausing side effect) would re-fire every single reopen.
    function _dtrSeen(k)    { try { return localStorage.getItem('wh_dtr_seen_' + k) === '1'; } catch { return false; } }
    function _dtrMarkSeen(k){ if (k) { try { localStorage.setItem('wh_dtr_seen_' + k, '1'); } catch {} } }

    // Open the recovery modal. dayKey omitted → demo mode (dev trigger).
    function openAutoStopRecovery(dayKey) {
      _asrDayKey = dayKey || null;
      const log = dayKey ? (dayLog(dayKey) || {}) : null;
      const prefill = (log && log.checkoutDisplay) ? log.checkoutDisplay : '10:00 PM';
      const inp = el('asrEndTime');
      inp.value = prefill;
      _asrOriginal = prefill;
      el('asrErr').classList.remove('show');
      el('asrUpdateBtn').disabled = true;
      // Show which day was auto-stopped (e.g. "Your Monday shift was auto-stopped")
      if (dayKey) {
        const d = new Date(dayKey + 'T12:00');
        const dayName = FULL_DAYS_EN[d.getDay()];
        el('asrDesc').textContent = `Your ${dayName} session was automatically stopped after your daily target + buffer.`;
      } else {
        el('asrDesc').textContent = 'It automatically ended after your daily target + buffer.';
      }
      _asrMarkSeen(dayKey); // shows once per auto-stopped session
      el('autoStopRecoveryOverlay').classList.add('open');
    }
    function closeAutoStopRecovery() {
      el('autoStopRecoveryOverlay').classList.remove('open');
    }
    // Enable Update only when the value is a valid time AND differs from prefill
    function _asrOnTimeChange() {
      const v = el('asrEndTime').value.trim();
      const ok = parse(v) !== null && v !== _asrOriginal;
      el('asrUpdateBtn').disabled = !ok;
      el('asrErr').classList.remove('show');
    }
    function _asrUpdate() {
      const e = parse(el('asrEndTime').value);
      if (!e) { el('asrErr').classList.add('show'); return; }
      const dk = _asrDayKey;
      if (!dk) { closeAutoStopRecovery(); showToast('Timer Auto Ended', 'success'); return; } // demo

      const log = dayLog(dk) || {};
      // Reconstruct login datetime from the day key + stored loginTime
      let s = null;
      if (log.loginTime) {
        const pts = log.loginTime.split(':').map(Number);
        s = new Date(dk + 'T00:00:00'); s.setHours(pts[0] || 0, pts[1] || 0, pts[2] || 0, 0);
      }
      // End datetime on the same calendar day (handle overnight)
      let end = new Date(dk + 'T00:00:00'); end.setHours(e.getHours(), e.getMinutes(), e.getSeconds(), 0);
      if (s && end <= s) end = new Date(end.getTime() + 86400000);
      const worked = s ? Math.max(0, Math.floor((end - s) / 1000)) : Math.round((log.hoursWorked || 0) * 3600);

      saveDayLogAndSync(dk, { ...log,
        checkoutDisplay: short(end),
        hoursWorked: worked / 3600,
        autostopped: false,       // user corrected it — no longer an auto-stop
        sessionTag: 'edited',
        lastUpdated: new Date().toISOString()
      });

      // If correcting today's session, fully clear the live auto-stop state so
      // subsequent render() calls don't re-trigger the Daily Target modal.
      if (dk === todayKey()) {
        autoStopped = false; wasDone = false;
        if (ticker) { clearInterval(ticker); ticker = null; }
        loginDate = null; // session is over — prevent render() from running again
        Store.clearSession();
        el('autostopBanner').classList.remove('show');
        setCalcBtnState('ended');
        renderEmptyState();
      }
      renderDaySelector(); renderHistory();
      closeAutoStopRecovery();
      showToast('Timer Auto Ended', 'success');
    }


    // ── RESUME SHIFT ────────────────────────────────────
    function resumeShift() {
      const now = new Date();
      const tk  = todayKey();
      const prevLog = dayLog(tk);
      // Guard: only resume if the paused session belongs to today
      if (!prevLog || prevLog.sessionDate !== tk) {
        return;
      }
      const midnight = new Date(); midnight.setHours(23,59,59,999);
      if (now >= midnight) return;
      // Restore accumulated hours — don't restart from zero
      if (_sessionAccSecs === 0 && prevLog.hoursWorked != null) {
        _sessionAccSecs = Math.round(prevLog.hoursWorked * 3600);
      }
      loginDate = now; wasDone = false; notifSent = false; autoStopped = false;
      setCalcBtnState('running');
      el('shiftInputRow').classList.add('active-state');
      el('shiftActiveLabel').textContent = `Resumed · ${dur(_sessionAccSecs)} prior`;
      el('autostopBanner').classList.remove('show');
      // Running again, so the pause's end time goes (see _writeLiveLog).
      const { checkoutDisplay: _pauseEnd, checkoutTime: _pauseEndTime, ...resumed } = prevLog;
      saveDayLogAndSync(tk, { ...resumed, sessionTag: 'realtime', autostopped: false, lastUpdated: now.toISOString() });
      persistSession();
      scheduleNotifications(loginDate.toISOString()); // reschedule on resume
      _startCheckpoint(); // periodic sync while session active
      selectDay(tk); render();
      if (ticker) clearInterval(ticker);
      ticker = setInterval(render, 1000);
    }

    // ── THEME ──────────────────────────────────────────
    const _faviconLight = '/icons/favicon-light.svg';
    const _faviconDark  = '/icons/favicon-dark.svg';
    // pref is what gets remembered: 'auto', 'light' or 'dark'. It is passed
    // explicitly when following the system, so a system-driven switch to dark
    // is not recorded as the user choosing dark.
    function applyTheme(d, pref) {
      dark = d;
      document.documentElement.classList.toggle('dark', d);
      localStorage.setItem('wh_theme', pref || (d ? 'dark' : 'light'));
      _renderThemeTabs();
      const fav = document.getElementById('favicon');
      if (fav) fav.href = d ? _faviconDark : _faviconLight;
      const logoSrc = d ? '/icons/brand-dark.svg' : '/icons/brand-light.svg';
      const mobLogo = document.getElementById('mobLogo');
      if (mobLogo) mobLogo.src = logoSrc;
      const navLogo = document.getElementById('navLogo');
      if (navLogo) navLogo.src = logoSrc;
      const installLogo = document.getElementById('installPromptLogo');
      if (installLogo) installLogo.src = logoSrc;
    }
    // ── MagicUI Animated Theme Toggler (verbatim port) ─────────────────────────
    // Source: https://magicui.design/r/animated-theme-toggler
    function _mgPolygonCollapsed(cx, cy, vertexCount) {
      const pairs = Array.from({ length: vertexCount }, () => `${cx}px ${cy}px`).join(', ');
      return `polygon(${pairs})`;
    }
    function _mgGetClipPaths(variant, cx, cy, maxRadius, vw, vh) {
      switch (variant) {
        case 'circle':
          return [`circle(0px at ${cx}px ${cy}px)`, `circle(${maxRadius}px at ${cx}px ${cy}px)`];
        case 'square': {
          const halfW = Math.max(cx, vw - cx), halfH = Math.max(cy, vh - cy);
          const halfSide = Math.max(halfW, halfH) * 1.05;
          const end = [`${cx-halfSide}px ${cy-halfSide}px`,`${cx+halfSide}px ${cy-halfSide}px`,
                       `${cx+halfSide}px ${cy+halfSide}px`,`${cx-halfSide}px ${cy+halfSide}px`].join(', ');
          return [_mgPolygonCollapsed(cx, cy, 4), `polygon(${end})`];
        }
        case 'triangle': {
          const scale = maxRadius * 2.2, dx = (Math.sqrt(3) / 2) * scale;
          const verts = [`${cx}px ${cy-scale}px`,`${cx+dx}px ${cy+0.5*scale}px`,`${cx-dx}px ${cy+0.5*scale}px`].join(', ');
          return [_mgPolygonCollapsed(cx, cy, 3), `polygon(${verts})`];
        }
        case 'diamond': {
          const R = maxRadius * Math.SQRT2;
          const end = [`${cx}px ${cy-R}px`,`${cx+R}px ${cy}px`,`${cx}px ${cy+R}px`,`${cx-R}px ${cy}px`].join(', ');
          return [_mgPolygonCollapsed(cx, cy, 4), `polygon(${end})`];
        }
        case 'hexagon': {
          const R = maxRadius * Math.SQRT2, verts = [];
          for (let i = 0; i < 6; i++) {
            const a = -Math.PI / 2 + (i * Math.PI) / 3;
            verts.push(`${cx + R * Math.cos(a)}px ${cy + R * Math.sin(a)}px`);
          }
          return [_mgPolygonCollapsed(cx, cy, 6), `polygon(${verts.join(', ')})`];
        }
        case 'rectangle': {
          const halfW = Math.max(cx, vw - cx), halfH = Math.max(cy, vh - cy);
          const end = [`${cx-halfW}px ${cy-halfH}px`,`${cx+halfW}px ${cy-halfH}px`,
                       `${cx+halfW}px ${cy+halfH}px`,`${cx-halfW}px ${cy+halfH}px`].join(', ');
          return [_mgPolygonCollapsed(cx, cy, 4), `polygon(${end})`];
        }
        case 'star': {
          const R = maxRadius * Math.SQRT2 * 1.03, innerRatio = 0.42;
          const starPolygon = (radius) => {
            const v = [];
            for (let i = 0; i < 5; i++) {
              const outerA = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
              v.push(`${cx + radius * Math.cos(outerA)}px ${cy + radius * Math.sin(outerA)}px`);
              const innerA = outerA + Math.PI / 5;
              v.push(`${cx + radius * innerRatio * Math.cos(innerA)}px ${cy + radius * innerRatio * Math.sin(innerA)}px`);
            }
            return `polygon(${v.join(', ')})`;
          };
          return [starPolygon(Math.max(2, R * 0.025)), starPolygon(R)];
        }
        default:
          return [`circle(0px at ${cx}px ${cy}px)`, `circle(${maxRadius}px at ${cx}px ${cy}px)`];
      }
    }
    // originEl is what the reveal expands from, so the animation reads as coming
    // out of the control the user actually pressed.
    function _applyThemeAnimated(nextDark, pref, originEl) {
      const DURATION = 260;
      const VARIANT  = 'circle'; // circle | square | triangle | diamond | hexagon | rectangle | star

      if (typeof document.startViewTransition !== 'function') {
        applyTheme(nextDark, pref);
        return;
      }

      const btn = originEl;
      const vw  = window.visualViewport?.width  ?? window.innerWidth;
      const vh  = window.visualViewport?.height ?? window.innerHeight;
      let cx, cy;
      if (btn) {
        const r = btn.getBoundingClientRect();
        cx = r.left + r.width  / 2;
        cy = r.top  + r.height / 2;
      } else {
        cx = vw / 2; cy = vh / 2;
      }
      const maxRadius = Math.hypot(Math.max(cx, vw - cx), Math.max(cy, vh - cy));
      const clipPath  = _mgGetClipPaths(VARIANT, cx, cy, maxRadius, vw, vh);

      const root = document.documentElement;
      root.dataset.magicuiThemeVt = 'active';
      root.style.setProperty('--magicui-theme-toggle-vt-duration', `${DURATION}ms`);
      root.style.setProperty('--magicui-theme-vt-clip-from', clipPath[0]);

      const transition = document.startViewTransition(() => { applyTheme(nextDark, pref); });

      const cleanup = () => {
        delete root.dataset.magicuiThemeVt;
        root.style.removeProperty('--magicui-theme-toggle-vt-duration');
        root.style.removeProperty('--magicui-theme-vt-clip-from');
      };
      if (typeof transition?.finished?.finally === 'function') {
        transition.finished.finally(cleanup);
      } else {
        cleanup();
      }

      if (transition?.ready && typeof transition.ready.then === 'function') {
        transition.ready.then(() => {
          document.documentElement.animate(
            { clipPath },
            { duration: DURATION, easing: VARIANT === 'star' ? 'linear' : 'ease-in-out',
              fill: 'forwards', pseudoElement: '::view-transition-new(root)' }
          );
        });
      }
    }

    const _systemDark = window.matchMedia('(prefers-color-scheme:dark)');

    function themePref() {
      const stored = localStorage.getItem('wh_theme');
      return stored === 'light' || stored === 'dark' ? stored : 'auto';
    }

    function _renderThemeTabs() {
      const pref = themePref();
      ['auto', 'light', 'dark'].forEach(p => {
        const tab = el('themeTab' + p[0].toUpperCase() + p.slice(1));
        if (tab) tab.classList.toggle('active', p === pref);
      });
    }

    function setAppTheme(pref, originEl) {
      const nextDark = pref === 'auto' ? _systemDark.matches : pref === 'dark';
      // Only animate a real change, and only when a control was pressed. The
      // call on load has neither.
      if (originEl && nextDark !== dark) _applyThemeAnimated(nextDark, pref, originEl);
      else applyTheme(nextDark, pref);
    }

    // Auto keeps tracking the OS while the app is open, not only at load.
    _systemDark.addEventListener('change', ev => {
      if (themePref() === 'auto') applyTheme(ev.matches, 'auto');
    });

    setAppTheme(themePref());
    initServiceWorker(); // register service worker for Web Push
    scheduleMorningReminder();  // schedule next-day 9am nudge if not yet logged in

    // SW postMessage → end session when a push notification is clicked
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', e => {
        if (e.data?.type !== 'notification_click') return;
        window.focus();
        if (loginDate) {
          // End the active session — confirms checkout on notification tap
          switchTab('home');
          openEndSessionModal();
        } else {
          // Session already ended — navigate home so the user sees the completed record
          switchTab('home');
        }
      });
    }

    // ── EVENTS ─────────────────────────────────────────
    document.querySelectorAll('.nav-tab').forEach(tab => {
      tab.addEventListener('click', () => switchTab(tab.dataset.view));
    });
    // Mobile nav tabs
    document.querySelectorAll('.mob-tab').forEach(tab => {
      tab.addEventListener('click', () => switchTab(tab.dataset.view));
    });
    requestAnimationFrame(_updatePillIndicator);
    // Mobile theme + notif
    el('mobNotifBtn')?.addEventListener('click', toggleNotifPanel);
    el('notifBtn').addEventListener('click', toggleNotifPanel);
    el('notifClearAll').addEventListener('click', () => {
      const pending = buildNotifs();
      if (!pending.length) {
        // Nothing to clear — iOS-style shake to say "stop clicking"
        const btn = el('notifClearAll');
        btn.classList.remove('ios-shake');
        void btn.offsetWidth; // reflow so the animation can re-trigger
        btn.classList.add('ios-shake');
        btn.addEventListener('animationend', () => btn.classList.remove('ios-shake'), { once: true });
        return;
      }
      pending.forEach(n => addDismissed(n.id));
      renderNotifs();
    });
    el('penaltyClearAll').addEventListener('click', clearAllPenalties);
    ['inpDailyH','inpDailyM'].forEach(id => {
      el(id)?.addEventListener('change', autoSaveSettings);
      el(id)?.addEventListener('input', autoSaveSettings);
    });
    ['inpShiftStart','inpShiftEnd'].forEach(id => { el(id)?.addEventListener('change', autoSaveSettings); });
    ['inpDisplay', 'inpCompany', 'inpPosition'].forEach(id => {
      el(id)?.addEventListener('input', autoSaveSettings);
      el(id)?.addEventListener('change', autoSaveSettings);
    });
    ['inpWeeklyH','inpWeeklyM'].forEach(id => {
      el(id)?.addEventListener('change', autoSaveSettings);
      el(id)?.addEventListener('input', autoSaveSettings);
    });
    /* inpWeeklyOn is a hidden checkbox now toggled via switchStTab — no direct listener needed */
    // inpNotifOn change handled by onNotifToggleChange() inline
    // Short Days / Long Days: one handler per list. The lists are re-drawn when
    // Settings opens and when the work week changes; per-button listeners were
    // lost on each re-draw (and the re-drawn ones didn't save).
    ['targetDayPicker', 'dayPicker'].forEach(id => el(id)?.addEventListener('click', e => {
      const btn = e.target.closest('.plan-btn'); if (!btn) return;
      btn.classList.toggle('selected');
      _setDaysSummary();
      autoSaveSettings();
    }));
    // Their sections open and close like Plan Your Week's.
    document.querySelectorAll('.set-acc').forEach(acc => {
      const head = acc.querySelector('.wp-acc-head'), body = acc.querySelector('.wp-acc-body');
      head.addEventListener('click', () => {
        const open = !acc.classList.contains('open');
        acc.classList.toggle('open', open); head.setAttribute('aria-expanded', String(open)); body.inert = !open;
      });
    });
    // Shift presets handled by renderShiftPresets() / applyShiftPreset()
    // The info bar's Resume does exactly what the main Resume button does
    // (including the "Continue working?" check).
    el('autostopResumeBtn')?.addEventListener('click', () => el('calcBtn').click());
    el('calcBtn').addEventListener('click', () => {
      const state = el('calcBtn').dataset.state || 'start';
      if (state === 'running') {
        if (cfg().breakTime !== false) endSession();  // Pause mode
        else confirmEndSession();                      // Direct End Session (no break time)
      } else if (state === 'done') {
        confirmEndSession();                           // Target done — End ends the session
      } else calculate();
    });

    // Split button: chevron toggles End Session dropdown
    el('calcBtnChevron').addEventListener('click', e => {
      e.stopPropagation();
      const dd = el('calcBtnDropdown');
      if (!dd) return;
      const willOpen = dd.style.display === 'none';
      if (willOpen) {
        const rect = el('calcBtnWrap').getBoundingClientRect();
        dd.style.top = (rect.bottom + 6) + 'px';
        dd.style.right = (window.innerWidth - rect.right) + 'px';
      }
      dd.style.display = willOpen ? '' : 'none';
    });
    document.addEventListener('click', () => {
      const dd = el('calcBtnDropdown');
      if (dd) dd.style.display = 'none';
    });
    el('endSessionBtn').addEventListener('click', e => {
      e.stopPropagation();
      const dd = el('calcBtnDropdown'); if (dd) dd.style.display = 'none';
      confirmEndSession(); // no confirmation step — End Session is never accidental enough to warrant it
    });
    el('coDone').addEventListener('click', closeCheckoutModal);
    el('checkoutOverlay').addEventListener('click', e => { if (e.target === el('checkoutOverlay')) closeCheckoutModal(); });
    // Week nav (Analytics)
    el('wkPrevBtn').addEventListener('click', () => {
      analyticsWeekOffset--;
      renderAnalytics();
    });
    el('wkNextBtn').addEventListener('click', () => {
      if (analyticsWeekOffset < 0) { analyticsWeekOffset++; renderAnalytics(); }
    });

    el('emailModalClose').addEventListener('click', closeEmailModal);
    el('emailModalOverlay').addEventListener('click', e => { if (e.target === el('emailModalOverlay')) closeEmailModal(); });
    window.MenuSelect?.enhance(el('emailPreviewPane'));
    el('emailTone').addEventListener('change', e => {
      saveCfg({ ...cfg(), emailFormat: e.target.value });
      _emailToneSwap();
    });
    // Phones: the Email Draft sheet drags down to close, like the other sheets.
    {
      const ov = el('emailModalOverlay'), sheet = ov.querySelector('.email-modal');
      window.Sheet?.attach(sheet, {
        close: closeEmailModal,
        isOpen: () => ov.classList.contains('open'),
        // Report a Bug scrolls only its preview; email drafts scroll the sheet.
        scroller: () => ov.classList.contains('is-bug') ? sheet.querySelector('.email-pv-scroll') : sheet,
      });
    }
    el('emailCustomiseBtn').addEventListener('click', _emailCustomise);
    // Copy the email (subject and body), like a code block's copy button.
    el('emailCopyBtn').addEventListener('click', () => {
      const btn = el('emailCopyBtn');
      navigator.clipboard?.writeText(`Subject: ${el('emailPvSubject').textContent}\n\n${el('emailPvBody').textContent}`).then(() => {
        btn.classList.add('copied'); btn.setAttribute('aria-label', 'Copied'); btn.title = 'Copied';
        clearTimeout(btn._t);
        btn._t = setTimeout(() => { btn.classList.remove('copied'); btn.setAttribute('aria-label', 'Copy email'); btn.title = 'Copy'; }, 1600);
      }).catch(() => {});
    });
    el('emailBugDesc').addEventListener('input', _emailUpdate);
    // Back: the day's Raise Dispute tab slides back in, as it was left.
    el('emailBackBtn').addEventListener('click', () => { if (_deEmailInline) _dePageTo('main'); });
    el('reportBugBtn')?.addEventListener('click', openBugReport);
    // What's New: Settings › About card, the modal's own controls, phone drag.
    el('whatsNewBtn')?.addEventListener('click', () => openWhatsNew());
    {
      if (el('whatsNewTitle')) el('whatsNewTitle').textContent = 'Version ' + APP_VERSION;
      const ov = el('whatsNewOverlay');
      el('wnContinue').addEventListener('click', closeWhatsNew);
      el('wnClose').addEventListener('click', closeWhatsNew);
      ov.addEventListener('click', e => { if (e.target === ov) closeWhatsNew(); });
      document.addEventListener('keydown', e => { if (e.key === 'Escape' && ov.classList.contains('open')) closeWhatsNew(); });
      window.Sheet?.attach(ov.querySelector('.email-modal'), {
        close: closeWhatsNew,
        isOpen: () => ov.classList.contains('open'),
        scroller: ov.querySelector('.email-modal'),
      });
      // After launch modals (recovery, week plan) have had their turn.
      setTimeout(_wnMaybeShow, 2500);
    }

    // Update Entry modal: Update Entry | Raise Dispute tabs.
    function _deTab(which) {
      el('deTabs').querySelectorAll('[data-de-tab]').forEach(b => {
        const on = b.dataset.deTab === which;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', String(on));
      });
      // The underline slides to the active tab, as in Settings.
      const active = el('deTabs').querySelector('.set-tab.active'), ind = el('deTabs').querySelector('.set-tab-ind');
      if (active && ind) { ind.style.left = active.offsetLeft + 'px'; ind.style.width = active.offsetWidth + 'px'; }
      el('deEditPane').hidden = which !== 'edit';
      el('deDisputePane').hidden = which !== 'dispute';
      // The title names the tab you're on.
      const t = el('dayEditTitle');
      t.textContent = which === 'dispute' ? 'Raise Dispute' : (t.dataset.editTitle || 'Update Entry');
      el('dayEditDeleteBtn').style.visibility = which === 'edit' ? '' : 'hidden';
    }
    el('deTabs').addEventListener('click', e => { const b = e.target.closest('[data-de-tab]'); if (b) _deTab(b.dataset.deTab); });
    // One chip at a time; writing your own reason clears the chips, and
    // picking a chip clears what was written.
    function _deChip(reason) {
      el('deDisputeReasons').querySelectorAll('.de-chip').forEach(c =>
        c.setAttribute('aria-checked', String(c.dataset.reason === reason)));
    }
    el('deDisputeReasons').addEventListener('click', e => {
      const chip = e.target.closest('.de-chip'); if (!chip) return;
      _deChip(chip.dataset.reason);
      el('deDisputeOther').value = '';
    });
    el('deDisputeOther').addEventListener('input', () => { if (el('deDisputeOther').value.trim()) _deChip(null); });
    el('deDisputeCancel').addEventListener('click', closeDayEditModal);
    el('deDisputeNext').addEventListener('click', () => {
      const key = _dayEditKey || todayKey();
      const pick = el('deDisputeReasons').querySelector('[aria-checked="true"]')?.dataset.reason;
      const own = el('deDisputeOther').value.trim().replace(/[.]$/, '');
      if (!pick && !own) { el('deDisputeOther').focus(); return; }
      const reasonText = own || DISPUTE_REASONS[pick];
      _openEmailFor({ type: 'dispute', key, date: new Date(key + 'T12:00'), log: dayLog(key) || {}, reasonText });
    });
    el('emailEditCancel').addEventListener('click', _emailCancel);
    el('emailEditSave').addEventListener('click', _emailSave);
    // Developer Mode: sample penalties on/off, and Plan Your Week on demand.
    el('devSamplePenalties').addEventListener('change', e => {
      _devSamplePenalties = e.target.checked;
      ['sample-d1', 'sample-d2', 'sample-w1'].forEach(k => _discardedPenalties.delete(k));
      _sampleNotifDismissed.clear();
      renderPenalties(); renderNotifs();
      showToast(_devSamplePenalties ? 'Sample penalties added' : 'Sample penalties removed', 'info');
    });
    el('devPreviewWeekPlan').addEventListener('click', openWeekPlanModal);
    el('devPreviewWhatsNew').addEventListener('click', () => openWhatsNew());
    // The desktop app's webview doesn't hand mailto: links to Windows; its shell does.
    el('emailSendBtn').addEventListener('click', e => {
      // Not ready yet (e.g. a bug report under the minimum): a link still opens on Enter.
      if (el('emailSendBtn').getAttribute('aria-disabled') === 'true') { e.preventDefault(); return; }
      if (!window.__TAURI__) return;
      e.preventDefault();
      window.__TAURI__.core.invoke('open_external', { url: el('emailSendBtn').href }).catch(() => {});
    });
    el('outsideShiftOverlay').addEventListener('click', e => { if (e.target === el('outsideShiftOverlay')) closeOutsideShiftModal(); });

    // ── Dev mode unlock: 5 taps on the Version row in Settings › About, like
    // Android's build number. The What's New button keeps its own action.
    (function() {
      let _devTaps = 0, _devTimer = null;
      const devCard = el('versionRow');
      if (!devCard) return;
      devCard.addEventListener('click', (e) => {
        // Buttons and links have their own actions — don't count those
        if (e.target.closest('button, a')) return;
        _devTaps++;
        if (_devTimer) clearTimeout(_devTimer);
        _devTimer = setTimeout(() => { _devTaps = 0; }, 2000);
        const left = 5 - _devTaps;
        if (_devTaps >= 1 && _devTaps < 5) {
          showToast(`${left} more tap${left === 1 ? '' : 's'} to unlock Developer Mode`, 'none');
        } else if (_devTaps >= 5) {
          _devTaps = 0;
          const testCard = el('notifTestCard');
          if (testCard) {
            // Open the same way disableDevMode closes: height + opacity.
            testCard.style.transition = '';
            testCard.style.overflow = 'hidden';
            testCard.style.maxHeight = '0';
            testCard.style.opacity = '0';
            testCard.style.display = '';
            requestAnimationFrame(() => {
              testCard.style.transition = 'max-height .35s cubic-bezier(.4,0,.2,1), opacity .25s ease';
              testCard.style.maxHeight = testCard.scrollHeight + 'px';
              testCard.style.opacity = '1';
            });
            setTimeout(() => {
              testCard.style.maxHeight = ''; testCard.style.overflow = ''; testCard.style.transition = '';
            }, 400);
            const tgl = el('devModeToggle'); if (tgl) tgl.checked = true;
            // Show User ID on profile card in dev mode
            const uidRow = el('profileUidRow');
            if (uidRow) uidRow.style.display = '';
            try { localStorage.setItem('wh_dev_on', '1'); } catch {}
            showToast('Welcome, Developer', 'none');
            testCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        }
      });
    })();

    // ── Dev Mode: Date Override ──────────────────────────
    const _DEV_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    function _devDateLabel(val) {
      const [y, m, d] = val.split('-').map(Number);
      return `${d} ${_DEV_MONTHS[m - 1]} ${y}`;
    }
    function setDevDateOverride(val) {
      if (!val) { clearDevDateOverride(); return; }
      _devDateOverride = val;
      const lbl = el('devDatePickerLabel'); if (lbl) lbl.textContent = _devDateLabel(val);
      _applyDevDateOverride();
      showToast(`Date set to ${_devDateLabel(val)}`, 'none');
    }
    function clearDevDateOverride() {
      _devDateOverride = null;
      const lbl = el('devDatePickerLabel'); if (lbl) lbl.textContent = 'Pick a Date';
      _applyDevDateOverride();
      showToast('Date reset to today', 'info');
    }
    function _applyDevDateOverride() {
      daySelectorWeekOffset = 0;
      selectDay(todayKey());
    }
    function openDevDatePicker(triggerEl) {
      if (triggerEl?.classList.contains('picker-open')) { closeWeekPicker(); return; }
      triggerEl?.classList.add('picker-open');
      _wpContext = 'devDate';
      const refDate = _devDateOverride ? new Date(_devDateOverride + 'T12:00') : new Date();
      _wpYear  = refDate.getFullYear();
      _wpMonth = refDate.getMonth();
      _wpRenderCal();
      const overlay = el('wpPickerOverlay');
      overlay.classList.add('open');
      _wpPlace(triggerEl);
      setTimeout(() => {
        document.addEventListener('click', _wpOutsideClick, { once: true, capture: true });
      }, 0);
    }

    // ── Developer Mode extras ──
    // Stays unlocked on this device; an "Active Overrides" row while a test
    // date or sample penalties are on, with Reset All; Replay as New User;
    // Build Info with a copy button.
    (function devExtras() {
      const card = el('notifTestCard');
      if (!card) return;
      try {
        if (localStorage.getItem('wh_dev_on') === '1') {
          card.style.display = '';
          const tgl = el('devModeToggle'); if (tgl) tgl.checked = true;
          const uidRow = el('profileUidRow'); if (uidRow) uidRow.style.display = '';
        }
      } catch {}

      const paint = () => {
        const parts = [];
        if (_devDateOverride) parts.push('Test date ' + _devDateLabel(_devDateOverride));
        if (_devSamplePenalties) parts.push('Sample penalties on');
        const row = el('devOverridesRow');
        if (row) row.hidden = !parts.length;
        if (el('devOverridesText')) el('devOverridesText').textContent = parts.join(' · ');
      };
      setInterval(() => { if (card.offsetParent) paint(); }, 800);
      el('devResetAll')?.addEventListener('click', () => {
        if (_devDateOverride) clearDevDateOverride();
        if (_devSamplePenalties) el('devSamplePenalties')?.click();
        paint();
      });

      el('devReplayBtn')?.addEventListener('click', () => {
        try {
          localStorage.removeItem(OB_DONE_KEY);
          ['mouseStarts', 'drafts'].forEach(k => localStorage.removeItem('wh_tipc_' + k));
        } catch {}
        saveCfg({ ...cfg(), tourDone: false, tipsSeen: [], tipsIntroduced: [], tipIntro: null });
        switchTab('home');
        setTimeout(openOnboarding, 350);
      });

      let buildText = '';
      (async () => {
        let uid = '';
        try { uid = (await window._sbClient.auth.getSession()).data.session?.user?.id || ''; } catch {}
        const installed = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
        let device = '';
        try { device = localStorage.getItem('wh_device_id') || ''; } catch {}
        const project = (window.__SB_URL || '').replace(/^https?:\/\//, '').split('.')[0];
        buildText = [
          `App: 5pm ${APP_VERSION}, ${window.__TAURI__ ? 'Windows App' : installed ? 'Web App' : 'Website'}`,
          `User ID: ${uid || 'Signed out'}`,
          device && `Device ID: ${device}`,
          project && `Supabase: ${project}`,
        ].filter(Boolean).join('\n');
        if (el('devBuildText')) el('devBuildText').textContent = buildText;
      })();
      el('devBuildCopy')?.addEventListener('click', e => {
        const btn = e.currentTarget;
        navigator.clipboard?.writeText(buildText).then(() => {
          btn.textContent = 'Copied';
          setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
        }).catch(() => {});
      });
    })();

    // Toggle off Developer Mode — collapse the panel away smoothly, then hide it.
    function disableDevMode() {
      const card = el('notifTestCard');
      if (!card) return;
      try { localStorage.removeItem('wh_dev_on'); } catch {}
      // Reset date override when leaving dev mode
      if (_devDateOverride) { _devDateOverride = null; _applyDevDateOverride(); }
      if (_devSamplePenalties) { _devSamplePenalties = false; el('devSamplePenalties').checked = false; renderPenalties(); renderNotifs(); }
      const lbl = el('devDatePickerLabel'); if (lbl) lbl.textContent = 'Pick a Date';
      // Hide the dev-only User ID row immediately
      const uidRow = el('profileUidRow'); if (uidRow) uidRow.style.display = 'none';
      // Animate height + opacity from current size → 0
      card.style.overflow = 'hidden';
      card.style.maxHeight = card.scrollHeight + 'px';
      requestAnimationFrame(() => {
        card.style.transition = 'max-height .35s cubic-bezier(.4,0,.2,1), opacity .25s ease, margin .35s ease';
        card.style.maxHeight = '0';
        card.style.opacity = '0';
        card.style.marginTop = '0';
        card.style.marginBottom = '0';
      });
      const done = () => {
        card.style.display = 'none';
        // Reset so a future unlock starts clean
        card.style.maxHeight = ''; card.style.opacity = '';
        card.style.overflow = ''; card.style.transition = '';
        card.style.marginTop = ''; card.style.marginBottom = '';
        card.removeEventListener('transitionend', done);
      };
      card.addEventListener('transitionend', done, { once: true });
      setTimeout(done, 450); // fallback if transitionend doesn't fire
      showToast('Developer Mode off', 'info');
    }
    // Auto-stop recovery: live-validate the end-time input
    el('asrEndTime')?.addEventListener('input', _asrOnTimeChange);

    // Day edit modal
    el('dayEditSave').addEventListener('click', saveDayEditModal);
    el('dayEditCancel').addEventListener('click', closeDayEditModal);
    el('dayEditOverlay').addEventListener('click', e => { if (e.target === el('dayEditOverlay')) closeDayEditModal(); });
    // Desktop sheet: a round close button (Cancel is hidden there) and Esc.
    (() => {
      const head = el('dayEditOverlay')?.querySelector('#deMainPage .dialog-head');
      if (!head) return;
      const x = document.createElement('button');
      x.type = 'button'; x.className = 'sheet-close'; x.setAttribute('aria-label', 'Close');
      x.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
      x.addEventListener('click', () => closeDayEditModal());
      head.appendChild(x);
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && el('dayEditOverlay').classList.contains('open')) closeDayEditModal();
      });
    })();
    el('dayEditDeleteBtn').addEventListener('click', deleteDayEntry);

    // End Session modal
    el('endSessionCancelBtn').addEventListener('click', () => el('endSessionOverlay').classList.remove('open'));
    el('endSessionConfirmBtn').addEventListener('click', confirmEndSession);
    el('endSessionOverlay').addEventListener('click', e => { if (e.target === el('endSessionOverlay')) el('endSessionOverlay').classList.remove('open'); });

    // Toast undo button
    el('appToastUndo').addEventListener('click', () => {
      if (_toastUndoFn) { const fn = _toastUndoFn; _toastUndoFn = null; fn(); }
      if (_toastTimer) { clearTimeout(_toastTimer); _toastTimer = null; }
      el('appToast').classList.remove('toast-show');
    });

    // Week plan modal
    el('weekPlanSave').addEventListener('click', saveWeekPlan);
    el('weekPlanSkip').addEventListener('click', dismissWeekPlan);
    el('weekPlanOverlay').addEventListener('click', e => { if (e.target === el('weekPlanOverlay')) dismissWeekPlan(); });

    // Continue Working modal
    el('continueWorkingCancelBtn').addEventListener('click', () => {
      el('continueWorkingOverlay').classList.remove('open');
      _cwPendingLogin = null;
    });
    el('continueWorkingProceedBtn').addEventListener('click', () => {
      el('continueWorkingOverlay').classList.remove('open');
      const p = _cwPendingLogin || new Date();
      _cwPendingLogin = null;
      // Restore accumulated hours from today's log if not already set
      const todayLog = dayLog(todayKey());
      if (_sessionAccSecs === 0 && todayLog?.hoursWorked) {
        _sessionAccSecs = Math.round(todayLog.hoursWorked * 3600);
      }
      _startSession(p);
    });

    // Daily Target Reached modal (Recommend Timings OFF)
    el('dailyTargetCancelBtn').addEventListener('click', () => {
      // "Keep Going" — resume session from this moment; gap while modal was open is not counted
      el('dailyTargetReachedOverlay').classList.remove('open');
      loginDate = new Date();
      persistSession(); // save the new post-pause loginDate so a reload restores overtime, not the stale pre-pause session
      if (ticker) clearInterval(ticker);
      ticker = setInterval(render, 1000);
    });
    el('dailyTargetEndBtn').addEventListener('click', () => {
      // "End Session" — session already paused; save log silently (no Daily Report)
      el('dailyTargetReachedOverlay').classList.remove('open');
      cancelScheduledNotifications();
      const now = new Date();
      const tk = todayKey(), ex = dayLog(tk) || {};
      saveDayLogAndSync(tk, {
        ...ex,
        checkoutDisplay: short(now),
        checkoutTime:    `${p2(now.getHours())}:${p2(now.getMinutes())}:${p2(now.getSeconds())}`,
        hoursWorked:     _sessionAccSecs / 3600,
        lastUpdated:     now.toISOString(),
        sessionTag:      ex.sessionTag || 'realtime'
      });
      persist();
      _sessionAccSecs = 0; _sessionCheckoutTime = null;
      loginDate = null; autoStopped = false; wasDone = false;
      persistSession(); // clears the stored session — otherwise a reload restores the ended session as still running
      setCalcBtnState('start');
      el('shiftInputRow').classList.remove('active-state', 'hidden');
      el('shiftActiveLabel').textContent = '—';
      el('autostopBanner').classList.remove('show');
      renderDaySelector();
      renderEmptyState();
    });

    el('npSave').addEventListener('click', saveNewPlan);
    el('npCancel').addEventListener('click', closeNewPlanModal);
    el('newPlanOverlay').addEventListener('click', e => { if (e.target === el('newPlanOverlay')) closeNewPlanModal(); });
    el('npStartTime').addEventListener('input', updateNpCalc);
    el('npEndTime').addEventListener('input', updateNpCalc);
    el('manualExportBtn').addEventListener('click', exportBackup);
    el('logFileInput').addEventListener('change', ev=>importLogFile(ev.target.files[0]));
    el('importConfirmBtn').addEventListener('click', confirmImport);
    el('importCancelBtn').addEventListener('click', ()=>{ el('importConfirmOverlay').classList.remove('open'); ['logFileInput','importModalFile'].forEach(id=>{const inp=el(id);if(inp)inp.value='';}); });
    el('importSaveLogBtn').addEventListener('click', exportBackup);
    el('importConfirmOverlay').addEventListener('click', ev=>{if(ev.target===el('importConfirmOverlay')){ el('importConfirmOverlay').classList.remove('open'); ['logFileInput','importModalFile'].forEach(id=>{const inp=el(id);if(inp)inp.value='';}); }});

    // Import Modal — file input + drag & drop
    el('importModalFile').addEventListener('change', ev => importLogFile(ev.target.files[0]));
    (function _initImportModalDnd() {
      const zone = el('importModalZone'); if (!zone) return;
      let _dc = 0;
      const _setActive = active => {
        zone.classList.toggle('drag-over', active);
        const txt = el('importModalZoneText');
        if (txt) txt.innerHTML = active
          ? '<strong>Release to import</strong><br>Drop your .json backup here'
          : '<strong>Choose a file or drag &amp; drop here</strong><br>Supports .json files';
      };
      zone.addEventListener('dragenter', e => { e.preventDefault(); _dc++; _setActive(true); });
      zone.addEventListener('dragleave', () => { if (--_dc <= 0) { _dc = 0; _setActive(false); } });
      zone.addEventListener('dragover', e => e.preventDefault());
      zone.addEventListener('drop', e => {
        e.preventDefault(); _dc = 0; _setActive(false);
        const file = e.dataTransfer?.files?.[0];
        if (file) importLogFile(file);
      });
    })();

    // ── Continuous day strip — manual touch scroll + label sync + lazy loading ──
    // Uses a manual touchmove handler (non-passive, calls preventDefault) so that
    // a horizontal swipe on the strip never triggers iOS pull-to-refresh, regardless
    // of the vertical component. Native overflow scroll handles mouse/trackpad.
    (function _initDayStripScroll() {
      const container = el('daySelectorRow');
      if (!container) return;

      let _sx = 0, _sy = 0, _lx = 0, _horiz = null, _vx = 0, _lt = 0, _mid = null;

      container.addEventListener('touchstart', e => {
        if (e.touches.length !== 1) return;
        _sx = _lx = e.touches[0].clientX;
        _sy = e.touches[0].clientY;
        _horiz = null; _vx = 0; _lt = Date.now();
        if (_mid) { cancelAnimationFrame(_mid); _mid = null; }
      }, { passive: true });

      container.addEventListener('touchmove', e => {
        if (e.touches.length !== 1) return;
        const cx = e.touches[0].clientX, cy = e.touches[0].clientY;
        if (_horiz === null) {
          const adx = Math.abs(cx - _sx), ady = Math.abs(cy - _sy);
          if (adx < 4 && ady < 4) return; // wait for intent
          _horiz = adx >= ady;
        }
        if (_horiz) {
          e.preventDefault(); // block pull-to-refresh for horizontal gestures
          const dx = _lx - cx;
          container.scrollLeft = Math.max(0, container.scrollLeft + dx);
          const now = Date.now();
          _vx = dx / Math.max(now - _lt, 1); // px/ms
          _lt = now;
        }
        _lx = cx;
      }, { passive: false });

      container.addEventListener('touchend', () => {
        if (!_horiz || Math.abs(_vx) < 0.05) return;
        let v = _vx;
        (function step() {
          if (Math.abs(v) < 0.05) return;
          container.scrollLeft = Math.max(0, container.scrollLeft + v * 16);
          v *= 0.94;
          _mid = requestAnimationFrame(step);
        })();
      }, { passive: true });

      // Label + lazy-load on any scroll (manual drag, momentum, or programmatic)
      let _raf = null;
      container.addEventListener('scroll', () => {
        if (_raf) return;
        _raf = requestAnimationFrame(() => {
          _raf = null;
          _updateWeekLabel();
          if (container.scrollLeft < 150) _dsLoadMorePast();
        });
      }, { passive: true });
    })();

    // Inline edit Enter-key handlers (delegated — elements are created dynamically)
    document.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') {
        if (document.activeElement?.id === 'inTimeEditInput')  { ev.preventDefault(); saveInTimeEdit(); }
        if (document.activeElement?.id === 'outTargetEditInput') { ev.preventDefault(); saveOutTargetEdit(); }
      }
    });

    // Shift time picker → text field sync (already handled in openTimePicker via oninput,
    // but ensure Settings auto-save fires when picker values are committed via direct input)
    // Sync daily hours when shift times are manually typed and committed
    ['inpShiftStart', 'inpShiftEnd'].forEach(id => {
      el(id)?.addEventListener('blur', () => { syncShiftTimesToHours(); autoSaveSettings(); });
    });

    ['inpShiftStartPicker','inpShiftEndPicker'].forEach(id => {
      el(id)?.addEventListener('change', () => {
        const textId = id === 'inpShiftStartPicker' ? 'inpShiftStart' : 'inpShiftEnd';
        const picker = el(id), txt = el(textId);
        if (!picker?.value || !txt) return;
        const [hh, mm] = picker.value.split(':').map(Number);
        const d = new Date(); d.setHours(hh, mm, 0, 0);
        txt.value = short(d);
        autoSaveSettings();
      });
    });

    // Clear button (removed in combo design — no longer needed)

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        closeTpModal();
        closeDayEditModal();
        closeEmailModal();
        closeWeekReport();
        closeDeleteModal();
        closeUpwdModal?.();
        closeFpModal?.();
        closeSupportModal?.();
        closeImportModal?.();
        closeAutoStopRecovery?.();
        el('weekPlanOverlay')?.classList.remove('open');
        el('endSessionOverlay')?.classList.remove('open');
        el('logoutOverlay')?.classList.remove('open');
        el('newPlanOverlay')?.classList.remove('open');
        el('importConfirmOverlay')?.classList.remove('open');
        el('inTimeEditWrap')?.classList.remove('open');
        el('outTargetEditWrap')?.classList.remove('open');
      }
    });
    // ── Quick Start shortcut recorder (Settings Advanced) ────────────────────
    let _qsRecording = false;

    function _updateQsResetBtn(hasShortcut) {
      const btn = el('qsShortcutResetBtn');
      if (!btn) return;
      if (hasShortcut) {
        btn.style.maxWidth = '28px'; btn.style.opacity = '1'; btn.style.pointerEvents = '';
      } else {
        btn.style.maxWidth = '0'; btn.style.opacity = '0'; btn.style.pointerEvents = 'none';
      }
    }

    function _renderQsDisplay(sc) {
      const disp = el('qsShortcutDisplay');
      if (!disp) return;
      if (!sc || !sc.key) {
        disp.innerHTML = '<span style="color:var(--muted-fg)">Type a shortcut</span>';
        _updateQsResetBtn(false);
        return;
      }
      const modLabel = sc.mod === 'cmd' ? 'Cmd' : sc.mod === 'alt' ? 'Alt' : 'Ctrl';
      const keyLabel = sc.key.length === 1 ? sc.key.toUpperCase() : sc.key;
      const parts = ['<span class="qs-capsule">' + modLabel + '</span>'];
      if (sc.shift) parts.push('<span class="qs-capsule">Shift</span>');
      parts.push('<span class="qs-capsule">' + keyLabel + '</span>');
      const sep = '<span style="color:var(--muted-fg);font-size:11px;font-weight:400;padding:0 1px">+</span>';
      disp.innerHTML = '<span style="display:inline-flex;align-items:center;gap:3px">' + parts.join(sep) + '</span>';
      _updateQsResetBtn(true);
    }

    function startQsRecording() {
      _qsRecording = true;
      const inp = el('qsShortcutInput');
      if (!inp) return;
      const disp = el('qsShortcutDisplay');
      if (disp) disp.innerHTML = '<span style="color:var(--muted-fg);font-style:italic">Press your shortcut</span>';
      inp.classList.add('recording');
      inp.focus();
      inp.onkeydown = _qsRecordKeydown;
    }

    function _qsRecordKeydown(e) {
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      if (['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)) {
        const disp = el('qsShortcutDisplay');
        if (disp) disp.innerHTML = '<span style="color:var(--muted-fg);font-size:11px">Press Ctrl, Cmd, or Alt, then type a key.</span>';
        return;
      }
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const errEl = el('qsShortcutError');
        if (errEl) { errEl.style.maxHeight = '40px'; errEl.style.marginTop = '6px'; errEl.textContent = 'Shortcut must begin with Ctrl, Cmd, or Alt.'; }
        return;
      }
      if (el('qsShortcutError')) { el('qsShortcutError').style.maxHeight = '0'; el('qsShortcutError').style.marginTop = '0'; }
      const mod = e.metaKey ? 'cmd' : e.ctrlKey ? 'ctrl' : 'alt';
      const key = e.key.toLowerCase();
      const shift = e.shiftKey;
      const sc = { mod, key, shift };
      saveCfg({ ...cfg(), qsShortcut: sc });
      _renderQsDisplay(sc);
      _qsRecording = false;
      const inp = el('qsShortcutInput');
      if (inp) { inp.classList.remove('recording'); inp.onkeydown = null; }
    }

    function _qsOnBlur() {
      if (!_qsRecording) return;
      _qsRecording = false;
      const inp = el('qsShortcutInput');
      if (inp) { inp.classList.remove('recording'); inp.onkeydown = null; }
      _renderQsDisplay(cfg().qsShortcut);
    }

    function resetQsShortcut() {
      saveCfg({ ...cfg(), qsShortcut: {} });
      _renderQsDisplay(null);
      if (el('qsShortcutError')) { el('qsShortcutError').style.maxHeight = '0'; el('qsShortcutError').style.marginTop = '0'; }
      _qsRecording = false;
      const inp = el('qsShortcutInput');
      if (inp) { inp.classList.remove('recording'); inp.onkeydown = null; }
    }

    // ── Quick Start keyboard shortcut ────────────────────────────────────────
    document.addEventListener('keydown', function _qsShortcutHandler(e) {
      if (_qsRecording) return;
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
      const sc = cfg().qsShortcut;
      if (!sc || !sc.key) return;
      const mod = sc.mod || 'ctrl';
      const key = sc.key.toLowerCase();
      const modMatch = (mod === 'ctrl' && (e.ctrlKey || e.metaKey)) ||
                       (mod === 'cmd'  && (e.ctrlKey || e.metaKey)) ||
                       (mod === 'alt'  && e.altKey);
      if (!modMatch || e.key.toLowerCase() !== key) return;
      if (sc.shift && !e.shiftKey) return;
      const btn = el('calcBtn');
      if (!btn || btn.dataset.state !== 'start' || btn.disabled) return;
      e.preventDefault();
      btn.click();
    });

    // ── tc-r7m2 activate/deactivate (autofill shield) ──────────────────────────
    // Safari autofill scanner only attaches to rendered, interactive inputs.
    // We keep the real input display:none at rest; only swap it in on explicit tap.
    let _tcLabel = 'Enter Login Time';
    function _tcSetLabel(label) {
      _tcLabel = label;
      // The field beside Start / End: "Enter Login Time", or "Update Login
      // Time" once a session is running or paused.
      const free = el('tpFreeInput');
      if (free) free.placeholder = label;
      const ph = el('tc-r7m2-ph');
      if (ph && !ph.classList.contains('tc-ph-has-val')) ph.textContent = label;
    }
    function _tcActivate() {
      const ph = el('tc-r7m2-ph'), inp = el('tc-r7m2');
      if (!ph || !inp) return;
      ph.style.display = 'none';
      inp.style.display = '';
      inp.focus();
    }
    function _tcDeactivate() {
      const ph = el('tc-r7m2-ph'), inp = el('tc-r7m2');
      if (!ph || !inp) return;
      // Keep input visible while there's an active error state
      if (inp.classList.contains('err')) return;
      const val = inp.value.trim();
      inp.style.display = 'none';
      ph.style.display = '';
      // Show entered value in foreground colour, otherwise show the contextual label
      ph.textContent = val || _tcLabel;
      ph.classList.toggle('tc-ph-has-val', !!val);
    }

    el('tc-r7m2').addEventListener('keydown', e => { if (e.key === 'Enter') calculate(); });
    el('tc-r7m2').addEventListener('input', () => {
      el('tc-r7m2').classList.remove('err');
      el('errMsg').classList.remove('show');
      // Show hint if entered AP conflicts with shift default
      const raw = el('tc-r7m2').value.trim().toUpperCase();
      const hint = el('loginApHint');
      if (hint) {
        const defAP = shiftDefaultAP();
        const enteredAP = raw.includes('PM') ? 'PM' : raw.includes('AM') ? 'AM' : null;
        if (enteredAP && enteredAP !== defAP) {
          hint.textContent = `Your shift begins at ${cfg().shiftStart || '09:00 AM'}`;
          hint.style.display = '';
        } else {
          hint.style.display = 'none';
        }
      }
    });
    el('tc-r7m2').addEventListener('blur', () => {
      el('tc-r7m2').classList.remove('err');
      el('errMsg').classList.remove('show');
      const raw = el('tc-r7m2').value.trim();
      // Auto-format bare digits before deactivating
      if (raw && !raw.includes(':')) {
        const digits = raw.replace(/\D/g, '');
        if (digits) {
          let h, m;
          if      (digits.length === 1) { h = +digits;              m = 0; }
          else if (digits.length === 2) { h = +digits;              m = 0; }
          else if (digits.length === 3) { h = +digits[0];           m = +digits.slice(1); }
          else                          { h = +digits.slice(0, 2);  m = +digits.slice(2, 4); }
          if (h <= 23 && m <= 59) {
            const suffix = h >= 13 ? '' : h === 12 ? ' PM' : ' AM';
            el('tc-r7m2').value = `${p2(h)}:${p2(m)}${suffix}`;
          }
        }
      }
      // Swap input back to invisible placeholder div
      setTimeout(_tcDeactivate, 80);
    });

    // ── TAB TITLE COUNTDOWN / OVERTIME ALERT ─────────
    // While the tab is hidden and a session is running, show a live countdown in the
    // browser tab title. Once the target's reached, alternate the title between an
    // alert ("Target Reached!" / "Overtime 5mins") and the base title every tick —
    // the same flashing-title technique chat/mail apps use for unread messages, so
    // it catches the eye of someone who's tabbed away. Only ever runs while hidden;
    // a visible tab already shows this live on the card, no need to flash it too.
    // Uses Date.now() to stay accurate even when the interval is throttled.
    const _baseTitle = '5pm - Work Hour Tracker';
    let _tabTitleTimer = null;
    let _tabFlashPhase = false;

    function _formatTabTitle() {
      if (!loginDate) { _stopTitleFlash(); return; }
      const nowMs   = Date.now();
      const worked  = _sessionAccSecs + Math.floor((nowMs - loginDate.getTime()) / 1000);
      const target  = effSecs();
      const remSecs = target - worked; // unclamped — negative once overtime begins
      if (remSecs > 0) {
        _tabFlashPhase = false; // so a later "done" phase always starts on the alert
        const h = Math.floor(remSecs / 3600), m = Math.floor((remSecs % 3600) / 60);
        document.title = h > 0 ? `${h}hr ${m}mins left` : `${m}mins left`;
        return;
      }
      // durWorked() rounds to the minute, so this only visibly changes about once a
      // minute even though it's recomputed every tick — no separate refresh timer needed.
      const otSecs = -remSecs;
      _tabFlashPhase = !_tabFlashPhase;
      document.title = _tabFlashPhase
        ? (otSecs < 60 ? 'Target Reached!' : 'Overtime ' + durWorked(otSecs))
        : _baseTitle;
    }

    function _stopTitleFlash() {
      if (_tabTitleTimer) { clearInterval(_tabTitleTimer); _tabTitleTimer = null; }
      _tabFlashPhase = false;
      document.title = _baseTitle;
    }

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (loginDate) { // only show countdown when a session is active
          _tabFlashPhase = false;
          _formatTabTitle();
          _tabTitleTimer = setInterval(_formatTabTitle, 1000);
        }
      } else {
        _stopTitleFlash();
      }
    });

    // ── ONBOARDING ──────────────────────────────────
    const OB_DONE_KEY = 'wh_ob_done';
    let _obStep = 1;
    let _obIsWeekly = false;

    function obSwitchTab(tab) {
      _obIsWeekly = tab === 'weekly';
      el('obTabDaily').classList.toggle('active', !_obIsWeekly);
      el('obTabWeekly').classList.toggle('active', _obIsWeekly);
      const lbl = el('obTargetLabel');
      if (lbl) lbl.textContent = _obIsWeekly ? 'Weekly Target' : 'Daily Target';
      updateObWeeklyCalc();
    }

    function updateObWeeklyCalc() {
      const info = el('obWeeklyCalcInfo'); if (!info) return;
      const dh = parseFloat(el('obDailyH')?.value) || 0;
      const dm = parseFloat(el('obDailyM')?.value) || 0;
      const days = parseInt(el('obWorkDays')?.value || '5', 10) || 5;
      const isWeekly = _obIsWeekly;
      const totalMins = (dh * 60 + dm) * days;
      const wh = Math.floor(totalMins / 60);
      const wm = totalMins % 60;
      if (isWeekly) {
        info.textContent = `Based on ${dh}h${dm ? ' ' + dm + 'm' : ''} daily × ${days} days, that's ${wh}h${wm ? ' ' + wm + 'm' : ''} weekly.`;
      } else {
        info.textContent = `That's ${wh}h${wm ? ' ' + wm + 'm' : ''} weekly (${days} working days).`;
      }
      // Sync hidden weekly fields so obSaveStep3 can read them
      const whi = el('obWeeklyH'); if (whi) whi.value = wh;
      const wmi = el('obWeeklyM'); if (wmi) wmi.value = wm;
    }

    function obAnimateTo(step, dir) {
      const dialog = document.querySelector('.ob-dialog');
      const currentH = dialog ? dialog.offsetHeight : 0;

      // Deactivate all panels
      [1,2,3,4].forEach(s => {
        const p = el('obPanel' + s);
        if (p) p.classList.remove('active', 'dir-back');
      });

      // Activate target panel
      const incoming = el('obPanel' + step);
      if (!incoming) return;
      if (dir < 0) incoming.classList.add('dir-back');
      incoming.classList.add('active');

      // Animate dialog height
      if (dialog) {
        const newH = dialog.offsetHeight;
        if (newH !== currentH && currentH > 0) {
          dialog.style.height = currentH + 'px';
          dialog.style.overflow = 'hidden';
          dialog.style.transition = 'height .3s ease';
          requestAnimationFrame(() => {
            dialog.style.height = newH + 'px';
            setTimeout(() => {
              dialog.style.height = '';
              dialog.style.overflow = '';
              dialog.style.transition = '';
            }, 320);
          });
        }
      }
    }

    function obUpdateSteps(step, dir) {
      // Instagram Stories stepper
      for (let i = 1; i <= 4; i++) {
        const seg = el('obSeg' + i);
        if (!seg) continue;
        seg.classList.remove('done', 'current');
        if (i < step) seg.classList.add('done');
        else if (i === step) seg.classList.add('current');
      }
      el('obBackBtn').style.visibility = step > 1 ? 'visible' : 'hidden';
      const nextBtn = el('obNextBtn');
      if (step === 4) nextBtn.textContent = 'Done';
      else nextBtn.textContent = 'Next Step';
      el('obSkipBtn').style.display = step === 4 ? 'none' : '';
      obAnimateTo(step, dir != null ? dir : 1);
    }

    function obSaveStep2() {
      const name = (el('obDisplay')?.value || '').trim();
      const company = (el('obCompany')?.value || '').trim();
      const position = (el('obPosition')?.value || '').trim();
      const c = cfg();
      saveCfg({ ...c, name, company, position });
    }

    function obBuildStep3Pickers() {
      const days = parseInt(el('obWorkDays')?.value || '5', 10) || 5;
      const names = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].slice(0, days);
      const earlyPicker = el('obEarlyPicker');
      if (earlyPicker) {
        const prev = [...earlyPicker.querySelectorAll('.plan-btn.selected')].map(b => +b.dataset.oday);
        earlyPicker.innerHTML = names.map((n,i) =>
          `<button type="button" class="plan-btn${prev.includes(i+1)?' selected':''}" data-oday="${i+1}">${n}</button>`
        ).join('');
        earlyPicker.querySelectorAll('[data-oday]').forEach(b => b.addEventListener('click', () => b.classList.toggle('selected')));
      }
      const latePicker = el('obLatePicker');
      if (latePicker) {
        const prev = [...latePicker.querySelectorAll('.plan-btn.selected')].map(b => +b.dataset.lday);
        latePicker.innerHTML = names.map((n,i) =>
          `<button type="button" class="plan-btn${prev.includes(i+1)?' selected':''}" data-lday="${i+1}">${n}</button>`
        ).join('');
        latePicker.querySelectorAll('[data-lday]').forEach(b => b.addEventListener('click', () => b.classList.toggle('selected')));
      }
    }

    function obPopulateStep3Days() {
      updateObWeeklyCalc();
    }

    function obSaveStep3() {
      const c = cfg();
      const shiftStart = (el('obShiftStart')?.value || '09:00 AM').trim();
      const shiftEnd = (el('obShiftEnd')?.value || '06:00 PM').trim();
      const shiftType = deriveShiftType(shiftStart);
      const dh = parseInt(el('obDailyH')?.value, 10) || 9;
      const dm = parseInt(el('obDailyM')?.value, 10) || 0;
      const dailyH = dh + dm / 60;
      const wh = parseInt(el('obWeeklyH')?.value, 10) || 45;
      const wm = parseInt(el('obWeeklyM')?.value, 10) || 0;
      const weeklyH = wh + wm / 60;
      const weeklyOn = _obIsWeekly;
      const workDays = parseInt(el('obWorkDays')?.value || '5', 10) || 5;
      saveCfg({ ...c, shiftStart, shiftEnd, shiftType, dailyH, weeklyH, weeklyOn, workDays });
    }

    function obPopulateWeekPanel() {
      const wk = week(0), tk = todayKey();
      const rows = el('obWpDayRows');
      if (rows) { rows.innerHTML = _wpDayRowsHtml(wk, tk, 'obWpSel'); rows.onchange = _wpOnChange; window.MenuSelect?.enhance(rows); }
    }

    function obSaveWeekPanel() {
      // Day overrides are saved live via wpSetOverride; nothing extra to save here
    }

    function obStep(dir) {
      if (_obStep === 2 && dir === 1) obSaveStep2();
      if (_obStep === 3 && dir === 1) obSaveStep3();
      if (_obStep === 4 && dir === 1) { obFinish(); return; }
      const prev = _obStep;
      _obStep = Math.max(1, Math.min(4, _obStep + dir));
      if (_obStep !== prev) {
        if (_obStep === 3) obPopulateStep3Days();
        obUpdateSteps(_obStep, dir);
      }
    }

    function obSkip() {
      obFinish();
    }

    // ── Forgot Password ──────────────────────────────────────────────────────
    let _fpTimer = null, fpExpired = false;
    function openFpModal() {
      el('fpOverlay').classList.add('open');
      el('fpViewEmail').style.display = '';
      el('fpViewOTP').style.display = 'none';
      el('fpEntry').value = '';
      el('fpEntry').setAttribute('inputmode', 'email'); // set only when modal opens — not on page load
      el('fpEmailErr').classList.remove('show');
    }
    function closeFpModal() {
      el('fpOverlay').classList.remove('open');
      if (_fpTimer) { clearInterval(_fpTimer); _fpTimer = null; }
    }
    function fpSendEmail() {
      const email = el('fpEntry').value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        el('fpEmailErr').classList.add('show'); return;
      }
      el('fpEmailErr').classList.remove('show');
      // Loading state on button during simulated send
      const btn = el('fpSendEmailBtn');
      const origText = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Sending…';
      btn.style.opacity = '0.7';
      // Simulate async email send — timer starts ONLY after this resolves
      setTimeout(() => {
        btn.disabled = false;
        btn.textContent = origText;
        btn.style.opacity = '';
        el('fpEmailDisplay').textContent = email;
        el('fpViewEmail').style.display = 'none';
        el('fpViewOTP').style.display = '';
        el('fpOtpInput').value = '';
        el('fpOtpInput').disabled = false;
        el('fpVerifyBtn').disabled = true;
        el('fpExpiredMsg').style.display = 'none';
        el('fpTimerWrap').style.display = '';
        fpExpired = false;
        fpStartTimer(60);
      }, 800);
    }
    function fpStartTimer(secs) {
      if (_fpTimer) clearInterval(_fpTimer);
      let remaining = secs;
      const fmt = s => Math.floor(s/60)+':'+(String(s%60).padStart(2,'0'));
      el('fpTimerDisplay').textContent = fmt(remaining);
      _fpTimer = setInterval(() => {
        remaining--;
        if (remaining <= 0) {
          clearInterval(_fpTimer); _fpTimer = null;
          fpExpired = true;
          el('fpTimerWrap').style.display = 'none';
          el('fpExpiredMsg').style.display = '';
          el('fpVerifyBtn').disabled = true;
          el('fpOtpInput').disabled = true;
        } else {
          el('fpTimerDisplay').textContent = fmt(remaining);
        }
      }, 1000);
    }
    function fpResend() {
      fpExpired = false;
      el('fpOtpInput').disabled = false;
      el('fpOtpInput').value = '';
      el('fpVerifyBtn').disabled = true;
      el('fpExpiredMsg').style.display = 'none';
      el('fpTimerWrap').style.display = '';
      fpStartTimer(60);
    }
    function fpBackToEmail() {
      if (_fpTimer) { clearInterval(_fpTimer); _fpTimer = null; }
      el('fpViewEmail').style.display = '';
      el('fpViewOTP').style.display = 'none';
      el('fpViewAuth').style.display = 'none';
    }
    function fpVerify() {
      closeFpModal();
      showToast('Verification pending', 'info', 'Integration Error');
    }
    function openAuthView() {
      el('fpViewEmail').style.display = 'none';
      el('fpViewOTP').style.display = 'none';
      el('fpViewAuth').style.display = '';
      const digits = ['authD0','authD1','authD2','authD3','authD4','authD5'].map(id => el(id));
      digits.forEach(d => { d.value = ''; d.disabled = false; });
      el('authVerifyBtn').disabled = true;
      digits[0].focus();
    }
    function authVerify() {
      closeFpModal();
      showToast('Authenticator pending', 'info', 'Integration Error');
    }
    function _initAuthDigits() {
      const ids = ['authD0','authD1','authD2','authD3','authD4','authD5'];
      const digits = ids.map(id => el(id));
      const update = () => { el('authVerifyBtn').disabled = !digits.every(d => /^\d$/.test(d.value)); };
      digits.forEach((inp, i) => {
        inp.addEventListener('input', () => {
          inp.value = inp.value.replace(/\D/g,'').slice(-1);
          if (inp.value && i < 5) digits[i+1].focus();
          update();
        });
        inp.addEventListener('keydown', e => {
          if (e.key === 'Backspace') {
            if (!inp.value && i > 0) { digits[i-1].focus(); digits[i-1].value = ''; e.preventDefault(); }
            else if (inp.value) { inp.value = ''; e.preventDefault(); }
            update();
          } else if (e.key === 'ArrowLeft' && i > 0) digits[i-1].focus();
          else if (e.key === 'ArrowRight' && i < 5) digits[i+1].focus();
        });
        inp.addEventListener('paste', e => {
          e.preventDefault();
          const txt = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g,'');
          digits.forEach((d, j) => { d.value = txt[j] || ''; });
          digits[Math.min(txt.length - 1, 5)].focus();
          update();
        });
        inp.addEventListener('click', () => inp.select());
      });
    }
    _initAuthDigits();

    // ── Sign-In Methods ──────────────────────────────────────────────────────
    // Everything Security shows is fetched at once and swapped in one step, and
    // the current rows stay up until then, so returning from a nested page
    // doesn't blank the list and refill it a card at a time.
    let _simRun = 0;
    async function hydrateSignInMethods() {
      const list = el('simList');
      if (!list) return;
      const run = ++_simRun;
      if (!list.children.length) list.innerHTML = '<div style="font-size:13px;color:var(--muted-fg)">Loading…</div>';
      try {
        const sb = window._sbClient.auth;
        const [{ data: { user } }, pkRes, mfaRes, devRows] = await Promise.all([
          sb.getUser(),
          sb.passkey.list().catch(() => ({})),
          sb.mfa.listFactors().catch(() => ({})),
          Devices.list().catch(() => null),
        ]);
        if (run !== _simRun) return; // a newer refresh is already on its way
        if (!user) { list.innerHTML = ''; return; }
        const identities = user.identities || [];
        const emailId  = identities.find(i => i.provider === 'email');
        const googleId = identities.find(i => i.provider === 'google');
        const githubId = identities.find(i => i.provider === 'github');
        const connectedCount = [emailId, googleId, githubId].filter(Boolean).length;
        const rows = [];
        // Saved Logins row (Account): how many devices, e.g. "3 Devices".
        const devN = devRows ? devRows.filter(r => !r.revoked_at).length : 0, devSub = el('devCountSub');
        if (devSub && devN) devSub.textContent = devN + (devN === 1 ? ' Device' : ' Devices');

        // Password
        rows.push(_simBuildRow({
          icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
          name: 'Password',
          status: emailId ? (_simRelativeTime(emailId.updated_at) || 'Connected') : (user.email || 'Not set'),
          statusClass: 'muted',
          connected: !!emailId,
          action: emailId ? 'Update Password' : 'Set Password',
          onAction: emailId ? openUpwdModal : openCreatePwdModal,
          destructive: false,
        }));

        // Google
        rows.push(_simBuildRow({
          icon: `<svg width="15" height="15" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>`,
          name: 'Google',
          // Which account, not just that there is one.
          status: googleId ? (googleId.identity_data?.email || 'Connected') : 'Not Connected',
          statusClass: googleId && googleId.identity_data?.email ? 'muted' : undefined,
          connected: !!googleId,
          action: googleId ? 'Disconnect' : 'Connect',
          onAction: googleId
            ? () => _disconnectProvider('google', googleId, connectedCount)
            : () => _connectProvider('google'),
          destructive: !!googleId,
        }));

        // GitHub
        rows.push(_simBuildRow({
          icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/></svg>`,
          name: 'GitHub',
          status: githubId
            ? (() => {
                const handle = githubId.identity_data?.user_name || githubId.identity_data?.preferred_username;
                return handle ? '@' + handle : 'Connected';
              })()
            : 'Not Connected',
          statusClass: githubId ? 'muted' : undefined,
          connected: !!githubId,
          action: githubId ? 'Disconnect' : 'Connect',
          onAction: githubId
            ? () => _disconnectProvider('github', githubId, connectedCount)
            : () => _connectProvider('github'),
          destructive: !!githubId,
        }));

        // Passkeys: opens its own page. A passkey never counts toward
        // connectedCount, so removing one can't leave you without a way in.
        const pkOff = pkRes.error?.code === 'passkey_disabled'; // switched off for the project: no row
        const pkCount = (pkRes.data || []).length;
        if (!pkOff) rows.push(_simBuildRow({
          icon: _PK_ICON,
          name: 'Passkeys',
          status: pkCount ? pkCount + (pkCount === 1 ? ' Passkey' : ' Passkeys') : 'Not set',
          statusClass: 'muted',
          onRow: openPasskeysPage,
        }));

        // Authenticator App (TOTP 2FA) — second factor, not a sign-in provider
        const totpFactor = (mfaRes.data?.totp || []).find(x => x.status === 'verified') || null;
        rows.push(_simBuildRow({
          icon: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l8 4v5c0 5-3.4 8.5-8 11-4.6-2.5-8-6-8-11V6l8-4z"/><path d="M9 12l2 2 4-4"/></svg>`,
          name: 'Authenticator App',
          status: totpFactor ? 'Enabled' : 'Not set',
          connected: !!totpFactor,
          action: totpFactor ? 'Manage' : 'Set Up',
          onAction: totpFactor ? () => openMfaManage(totpFactor) : openMfaSetup,
          destructive: false,
        }));
        list.replaceChildren(...rows);
      } catch(e) {
        if (run !== _simRun) return;
        // Keep rows already on screen; only an empty list shows the error.
        if (!list.querySelector('.sim-row')) list.innerHTML = '<div style="font-size:13px;color:var(--muted-fg)">Failed to load sign-in methods.</div>';
      }
    }

    function _simRelativeTime(dateStr) {
      if (!dateStr) return null;
      var diff = Math.floor((Date.now() - new Date(dateStr)) / 1000);
      if (diff < 60) return 'just now';
      if (diff < 3600) return 'updated ' + Math.floor(diff / 60) + 'm ago';
      if (diff < 86400) return 'updated ' + Math.floor(diff / 3600) + 'h ago';
      var days = Math.floor(diff / 86400);
      return 'last updated ' + days + ' day' + (days === 1 ? '' : 's') + ' ago';
    }

    function _simBuildRow({ icon, name, status, statusClass, connected, action, onAction, destructive, onRow }) {
      const row = document.createElement('div');
      row.className = 'sim-row';

      const left = document.createElement('div');
      left.className = 'sim-provider';
      const iconWrap = document.createElement('div');
      iconWrap.className = 'sim-icon';
      iconWrap.innerHTML = icon;
      const info = document.createElement('div');
      const nameEl = document.createElement('div');
      nameEl.className = 'sim-name';
      nameEl.textContent = name;
      const statusEl = document.createElement('div');
      statusEl.className = 'sim-status ' + (statusClass || (connected ? 'connected' : (status === 'Not Set' ? 'not-set' : 'not-connected')));
      statusEl.textContent = status;
      info.appendChild(nameEl);
      info.appendChild(statusEl);
      left.appendChild(iconWrap);
      left.appendChild(info);
      row.appendChild(left);

      if (onRow) {
        row.classList.add('link');
        row.addEventListener('click', onRow);
        row.insertAdjacentHTML('beforeend', '<svg class="sim-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>');
        return row;
      }

      const btn = document.createElement('button');
      btn.className = destructive ? 'btn-ghost-destructive' : 'btn-secondary';
      btn.style.cssText = 'flex-shrink:0;font-size:12px;height:30px;padding:0 12px';
      btn.textContent = action;
      if (onAction) btn.addEventListener('click', onAction);
      row.appendChild(btn);
      return row;
    }

    async function _connectProvider(provider) {
      try {
        const { error } = await window._sbClient.auth.linkIdentity({
          provider,
          options: {
            redirectTo: window.location.origin + window.location.pathname,
            // Always show Google's account picker so the right account gets
            // linked, even when only one is signed in to the browser.
            queryParams: String(provider).toLowerCase() === 'google' ? { prompt: 'select_account' } : undefined
          }
        });
        if (error) throw error;
        // Page navigates away to OAuth provider — nothing else to do here
      } catch(e) {
        showToast('Connection Failed', 'error', e.message || 'Could not connect ' + provider + '. Please try again.');
      }
    }

    async function _disconnectProvider(provider, identity, connectedCount) {
      if (connectedCount <= 1) {
        showToast("Can't Disconnect", 'error', 'You need at least one sign-in method to access your account.');
        return;
      }
      try {
        const { error } = await window._sbClient.auth.unlinkIdentity(identity);
        if (error) throw error;
        showToast(provider.charAt(0).toUpperCase() + provider.slice(1) + ' Disconnected', 'success', 'Sign-in method removed from your account.');
        hydrateSignInMethods();
      } catch(e) {
        showToast('Disconnect Failed', 'error', e.message || 'Could not disconnect. Please try again.');
      }
    }

    // ── Passkeys page ────────────────────────────────────────────────────────
    // Supabase stores them (auth.passkey, experimental). A passkey is bound to
    // whtracker.vercel.app, so the desktop app (another origin) can list,
    // rename and remove them but not create one.
    const _PK_ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="4.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/></svg>';
    let _pkRemoving = null;

    // ── Nested Settings pages ────────────────────────────────────────────────
    // A page replaces the tabs: back button, title, description, content.
    // build() runs once and may move an old modal's markup in, so every id and
    // handler that markup had keeps working.
    function _setPage(id, title, desc, build) {
      const wrap = document.querySelector('#viewSettings .settings-panel');
      if (!wrap) return null;
      let page = el(id);
      if (!page) {
        page = document.createElement('div');
        page.id = id;
        page.className = 'set-page';
        page.innerHTML =
          '<div class="set-page-head">' +
            '<button class="back-btn" title="Back" aria-label="Back"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></button>' +
            '<div><div class="settings-title"></div><div class="form-sub"></div></div>' +
          '</div>';
        page.querySelector('.back-btn').onclick = closeSetPage;
        build(page);
        wrap.appendChild(page);
      }
      _setPageHead(page, title, desc);
      wrap.querySelectorAll('.set-page').forEach(p => p.classList.toggle('on', p === page));
      wrap.classList.add('page-open');
      window.scrollTo(0, 0);
      return page;
    }
    function _setPageHead(page, title, desc) {
      page.querySelector('.settings-title').textContent = title;
      const sub = page.querySelector('.set-page-head .form-sub');
      sub.textContent = desc || '';
      sub.style.display = desc ? '' : 'none';
    }
    function closeSetPage() {
      const wrap = document.querySelector('#viewSettings .settings-panel');
      if (!wrap || !wrap.classList.contains('page-open')) return;
      wrap.classList.remove('page-open');
      hydrateSignInMethods(); // counts on the rows that open pages
    }

    function openPasskeysPage() {
      _setPage('pkPage', 'Passkeys', 'Sign in with your face, fingerprint or device PIN.', page => {
        page.insertAdjacentHTML('beforeend',
          '<div id="pkList" class="settings-group tile-list"></div>' +
          '<div id="pkEmpty" class="pk-empty" style="display:none">No passkeys added yet</div>' +
          '<button class="btn btn-primary" id="pkAddBtn" data-on-click="hb85c95a0ae"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>Add Passkey</button>' +
          (window.__TAURI__ ? '<div class="set-note">Opens 5pm in your browser, where passkeys are added.</div>' : ''));
      });
      renderPasskeys();
    }

    async function renderPasskeys() {
      const list = el('pkList'), empty = el('pkEmpty');
      if (!list) return;
      if (!list.children.length) {
        list.style.display = '';
        list.innerHTML = '<div style="font-size:13px;color:var(--muted-fg)">Loading…</div>';
      }
      try {
        const { data, error } = await window._sbClient.auth.passkey.list();
        if (error) throw error;
        const keys = (data || []).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        list.innerHTML = '';
        keys.forEach(k => list.appendChild(_pkBuildRow(k)));
        list.style.display = keys.length ? '' : 'none';
        empty.style.display = keys.length ? 'none' : '';
      } catch (e) {
        list.style.display = '';
        list.innerHTML = '<div style="font-size:13px;color:var(--muted-fg)">Couldn\'t load passkeys.</div>';
        empty.style.display = 'none';
      }
    }

    function _pkBuildRow(k) {
      const row = document.createElement('div');
      row.className = 'dev-row';
      row.innerHTML =
        '<div class="dev-left"><div class="dev-icon">' + _PK_ICON + '</div><div class="dev-info">' +
          '<input class="dev-name" type="text" maxlength="60" spellcheck="false" autocomplete="off" data-lpignore="true" data-1p-ignore="true" aria-label="Passkey name">' +
          '<div class="dev-sub"></div></div></div>' +
        '<button class="btn-ghost-destructive" style="flex-shrink:0;font-size:12px;height:30px;padding:0 12px">Remove</button>';
      const name = row.querySelector('.dev-name');
      name.value = k.friendly_name || 'Passkey';
      const d = new Date(k.created_at);
      const added = d.toLocaleDateString(undefined, d.getFullYear() === new Date().getFullYear()
        ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
      row.querySelector('.dev-sub').textContent =
        'Added ' + added + ' · ' + (k.last_used_at ? 'Used ' + _devAgo(k.last_used_at) : 'Not used yet');

      // Rename in place: Enter or leaving the field saves, Esc restores.
      let last = name.value;
      name.addEventListener('blur', async () => {
        const v = name.value.trim().slice(0, 60);
        if (!v || v === last) { name.value = last; return; }
        name.value = v;
        try {
          const { error } = await window._sbClient.auth.passkey.update({ passkeyId: k.id, friendlyName: v });
          if (error) throw error;
          last = v;
          showToast('Passkey Renamed', 'success');
        } catch (e) {
          name.value = last;
          showToast("Couldn't Rename Passkey", 'error', e.message || 'Please try again.');
        }
      });
      name.addEventListener('keydown', e => {
        if (e.key === 'Enter')  { e.preventDefault(); name.blur(); }
        if (e.key === 'Escape') { name.value = last; name.blur(); }
      });

      row.querySelector('button').addEventListener('click', () => {
        _pkRemoving = k;
        el('pkRemoveName').textContent = name.value;
        el('pkRemoveOverlay').classList.add('open');
      });
      return row;
    }

    async function confirmRemovePasskey() {
      if (!_pkRemoving) return;
      const btn = el('pkRemoveBtn');
      btn.disabled = true; btn.textContent = 'Removing…';
      try {
        const { error } = await window._sbClient.auth.passkey.delete({ passkeyId: _pkRemoving.id });
        if (error) throw error;
        el('pkRemoveOverlay').classList.remove('open');
        showToast('Passkey Removed', 'success');
        renderPasskeys();
      } catch (e) {
        showToast("Couldn't Remove Passkey", 'error', e.message || 'Please try again.');
      }
      btn.disabled = false; btn.textContent = 'Remove';
    }

    async function addPasskey() {
      // Desktop: a passkey belongs to whtracker.vercel.app, so it's added there.
      if (window.__TAURI__) {
        window.__TAURI__.core.invoke('open_external', { url: 'https://whtracker.vercel.app/index.html#passkeys' })
          .catch(e => showToast("Couldn't Open Browser", 'error', String(e)));
        return;
      }
      const btn = el('pkAddBtn');
      btn.disabled = true;
      try {
        const { error } = await window._sbClient.auth.registerPasskey();
        if (error) throw error;
        showToast('Passkey Added', 'success', 'Next time, sign in with your face, fingerprint or device PIN.');
        renderPasskeys();
      } catch (e) {
        const code = e.code || '', text = (e.name || '') + ' ' + (e.message || '') + ' ' + code;
        // Closing the system prompt is a choice, not an error.
        if (!/NotAllowed|cancel|abort/i.test(text)) {
          showToast("Couldn't Add Passkey", 'error',
            code === 'webauthn_credential_exists' ? 'This device already has a passkey for 5pm.'
            : code === 'too_many_passkeys' ? 'You can save up to 10 passkeys. Remove one first.'
            : (e.message || 'Please try again.'));
        }
      }
      btn.disabled = false;
    }

    // Password reset links. The email opens in a browser, so the Windows app
    // points them at the website, and asks without PKCE: the browser can't
    // finish a sign-in that the app started. login.js does the same.
    const RESET_TO = (window.__TAURI__ ? 'https://whtracker.vercel.app' : location.origin) + '/index.html';
    const resetClient = () => window.supabase.createClient(window.__SB_URL, window.__SB_ANON_KEY,
      { auth: { flowType: 'implicit', persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

    // Called once the app is up (index-auth-gate.js): a working reset link
    // opens Set New Password; a used or expired one says so.
    window._afterAuthLink = () => {
      let recovery = false, linkError = null;
      try {
        recovery = sessionStorage.getItem('wh_pw_recovery') === '1';
        linkError = sessionStorage.getItem('wh_link_error');
        sessionStorage.removeItem('wh_pw_recovery');
        sessionStorage.removeItem('wh_link_error');
      } catch {}
      if (location.hash.includes('error_code=')) history.replaceState(null, '', location.pathname);
      if (recovery) openCreatePwdModal(true);
      else if (linkError) showToast('This Link Has Expired', 'error', 'Reset links work once, for an hour. Request a new one from Settings.');
    };

    function openCreatePwdModal(reset = false) {
      const inp = el('createPwdInput'), conf = el('createPwdConfirm');
      if (inp) inp.value = '';
      if (conf) conf.value = '';
      const err = el('createPwdErr');
      if (err) { err.textContent = ''; err.style.display = 'none'; }
      const btn = el('createPwdBtn');
      if (btn) { btn.disabled = false; btn.textContent = 'Set Password'; btn.style.opacity = ''; }
      // Same window for a first password and for a reset link.
      const [title, desc] = el('createPwdViewForm').querySelectorAll('.dialog-title, .dialog-desc');
      const [doneTitle, doneDesc] = el('createPwdViewDone').querySelectorAll('.dialog-title, .dialog-desc');
      title.textContent = reset ? 'Set New Password' : 'Create Password';
      desc.textContent = reset ? 'Choose a new password for your account.' : 'Add email & password sign-in to your account.';
      doneTitle.textContent = reset ? 'Password Updated' : 'Password Created';
      doneDesc.textContent = reset ? 'Use your new password next time you sign in.' : 'You can now sign in with your email and password.';
      el('createPwdViewForm').style.display = '';
      el('createPwdViewDone').style.display = 'none';
      el('createPwdOverlay').classList.add('open');
    }
    function closeCreatePwdModal() {
      el('createPwdOverlay').classList.remove('open');
    }
    async function submitCreatePwd() {
      const pwd  = el('createPwdInput')?.value?.trim() || '';
      const conf = el('createPwdConfirm')?.value?.trim() || '';
      const err  = el('createPwdErr');
      const btn  = el('createPwdBtn');
      const showErr = (msg) => { if (err) { err.textContent = msg; err.style.display = ''; } };
      if (pwd.length < 6) { showErr('Password must be at least 6 characters.'); return; }
      if (pwd !== conf)   { showErr('Passwords do not match.'); return; }
      if (err) { err.style.display = 'none'; }
      btn.disabled = true; btn.textContent = 'Setting…'; btn.style.opacity = '.7';
      try {
        const { error } = await window._sbClient.auth.updateUser({ password: pwd });
        if (error) throw error;
        el('createPwdViewForm').style.display = 'none';
        el('createPwdViewDone').style.display = '';
        hydrateSignInMethods();
      } catch(e) {
        btn.disabled = false; btn.textContent = 'Set Password'; btn.style.opacity = '';
        showErr(e.message || 'Failed to set password. Please try again.');
      }
    }

    // ── Authenticator (TOTP 2FA) ─────────────────────────────────────────────
    let _mfaFactorId = null, _mfaBackupCodes = [], _mfaManageFactor = null;

    // The old modal's views live in one card on the Authenticator App page. The
    // page header takes each view's own title and description.
    function _mfaOpenPage() {
      _setPage('pageMfa', 'Authenticator App', '', page => {
        const card = document.createElement('div');
        card.className = 'set-card';
        card.append(...el('mfaOverlay').querySelector('.dialog').children);
        page.appendChild(card);
        el('mfaOverlay').remove();
      });
    }
    function _mfaShowView(id) {
      ['mfaViewSetup','mfaViewVerifying','mfaViewBackup','mfaViewSuccess','mfaViewManage','mfaViewDisable']
        .forEach(v => { const e = el(v); if (e) e.style.display = v === id ? '' : 'none'; });
      const head = el(id)?.querySelector('.dialog-head'), page = el('pageMfa');
      if (!page) return;
      if (head) _setPageHead(page, head.querySelector('.dialog-title').textContent,
                             head.querySelector('.dialog-desc')?.textContent);
      else _setPageHead(page, 'Authenticator App', ''); // Verifying / Success carry their own text
    }
    function closeMfaModal() {
      closeSetPage();
      const db = el('mfaDisableBtn'); if (db) { db.disabled = false; db.textContent = 'Disable'; }
    }
    function _mfaSetupError(msg) {
      const e = el('mfaSetupErr'); if (e) { e.textContent = msg; e.style.display = ''; }
    }

    // Normalize + hash a backup code (shared shape with login.js verification)
    function _normalizeBackupCode(c) { return (c || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
    async function _sha256Hex(str) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
      return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
    }
    function _genBackupCodes() {
      const alphabet = '23456789abcdefghjkmnpqrstuvwxyz'; // no ambiguous 0/1/i/l/o
      const codes = [];
      for (let n = 0; n < 10; n++) {
        const buf = new Uint8Array(8); crypto.getRandomValues(buf);
        let s = ''; for (let i = 0; i < 8; i++) s += alphabet[buf[i] % alphabet.length];
        codes.push(s.slice(0, 4) + '-' + s.slice(4));
      }
      return codes;
    }
    async function _storeBackupCodes(codes) {
      const { data: { user } } = await window._sbClient.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const hashes = await Promise.all(codes.map(c => _sha256Hex(_normalizeBackupCode(c))));
      await window._sbClient.from('mfa_backup_codes').delete().eq('user_id', user.id);
      const rows = hashes.map(h => ({ user_id: user.id, code_hash: h }));
      const { error } = await window._sbClient.from('mfa_backup_codes').insert(rows);
      if (error) throw error;
    }
    function _renderBackupCodes(codes) {
      const grid = el('mfaCodesGrid'); if (!grid) return;
      grid.innerHTML = '';
      codes.forEach(c => { const d = document.createElement('div'); d.className = 'mfa-code'; d.textContent = c; grid.appendChild(d); });
    }

    async function openMfaSetup() {
      _mfaOpenPage();
      _mfaShowView('mfaViewSetup');
      el('mfaQrImg').removeAttribute('src');
      el('mfaSecret').textContent = '…';
      el('mfaCodeInput').value = '';
      el('mfaVerifyBtn').disabled = true;
      _mfaSetupError(''); el('mfaSetupErr').style.display = 'none';
      try {
        const mfa = window._sbClient.auth.mfa;
        // Clean up any stale unverified TOTP factors so enroll doesn't conflict
        const { data: f } = await mfa.listFactors();
        const stale = (f?.all || []).filter(x => x.factor_type === 'totp' && x.status !== 'verified');
        for (const s of stale) { try { await mfa.unenroll({ factorId: s.id }); } catch(_) {} }
        const { data, error } = await mfa.enroll({ factorType: 'totp' });
        if (error) throw error;
        _mfaFactorId = data.id;
        el('mfaQrImg').src = data.totp.qr_code;
        el('mfaSecret').textContent = data.totp.secret;
      } catch(e) {
        const m = e.message || '';
        _mfaSetupError(/disabled|not enabled/i.test(m)
          ? 'TOTP is disabled for this project. Enable it in Supabase → Authentication → MFA.'
          : (m || 'Could not start setup. Please try again.'));
      }
    }

    async function mfaVerifyEnroll() {
      const code = (el('mfaCodeInput').value || '').replace(/\D/g, '');
      if (code.length < 6 || !_mfaFactorId) return;
      _mfaShowView('mfaViewVerifying');
      try {
        const { error } = await window._sbClient.auth.mfa.challengeAndVerify({ factorId: _mfaFactorId, code });
        if (error) throw error;
        try { sessionStorage.setItem('wh_mfa_ok', '1'); } catch(_) {}
        // Verified — now generate and store backup codes
        try {
          _mfaBackupCodes = _genBackupCodes();
          await _storeBackupCodes(_mfaBackupCodes);
          _renderBackupCodes(_mfaBackupCodes);
          _mfaShowView('mfaViewBackup');
        } catch(storeErr) {
          // Factor is live, but codes failed to save — warn and continue
          showToast("Backup codes not saved", 'error', 'Two-factor is on, but save backup codes failed. Regenerate later.');
          mfaShowSuccess();
        }
        hydrateSignInMethods();
      } catch(e) {
        _mfaShowView('mfaViewSetup');
        el('mfaCodeInput').value = ''; el('mfaVerifyBtn').disabled = true;
        _mfaSetupError(/invalid|incorrect/i.test(e.message || '') ? 'Incorrect code. Try again.' : (e.message || 'Verification failed.'));
      }
    }

    function mfaShowSuccess() { _mfaShowView('mfaViewSuccess'); }

    function _copyBackupCodes() {
      navigator.clipboard?.writeText(_mfaBackupCodes.join('\n'));
      const lbl = el('mfaCopyLabel');
      if (lbl) { lbl.textContent = 'Copied'; setTimeout(() => lbl.textContent = 'Copy', 1600); }
    }
    function _downloadBackupCodes() {
      const body = '5pm — Two-Factor Backup Codes\nSaved ' + new Date().toLocaleString() +
        '\n\nEach code works once. Keep them somewhere safe.\n\n' + _mfaBackupCodes.join('\n') + '\n';
      const blob = new Blob([body], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = '5pm-backup-codes.txt';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    let _mfaSecretResetTimer = null;
    function _copyMfaSecret() {
      navigator.clipboard?.writeText(el('mfaSecret').textContent || '');
      el('mfaSecretCopyIcon').style.display = 'none';
      el('mfaSecretCheckIcon').style.display = '';
      if (_mfaSecretResetTimer) clearTimeout(_mfaSecretResetTimer);
      _mfaSecretResetTimer = setTimeout(() => {
        el('mfaSecretCopyIcon').style.display = '';
        el('mfaSecretCheckIcon').style.display = 'none';
      }, 1600);
    }

    function openMfaManage(factor) {
      _mfaManageFactor = factor;
      _mfaOpenPage();
      _mfaShowView('mfaViewManage');
    }
    function mfaShowManage() { _mfaShowView('mfaViewManage'); }
    function mfaShowDisable() { _mfaShowView('mfaViewDisable'); }
    async function mfaConfirmDisable() {
      const btn = el('mfaDisableBtn'); btn.disabled = true; btn.textContent = 'Disabling…';
      try {
        const fid = _mfaManageFactor?.id;
        if (fid) { const { error } = await window._sbClient.auth.mfa.unenroll({ factorId: fid }); if (error) throw error; }
        const { data: { user } } = await window._sbClient.auth.getUser();
        if (user) await window._sbClient.from('mfa_backup_codes').delete().eq('user_id', user.id);
        try { sessionStorage.removeItem('wh_mfa_ok'); } catch(_) {}
        closeMfaModal();
        showToast('Two-Factor Disabled', 'success', 'Authenticator app removed from your account.');
        hydrateSignInMethods();
      } catch(e) {
        btn.disabled = false; btn.textContent = 'Disable';
        showToast('Could not disable', 'error', e.message || 'Please try again.');
      }
    }

    // ── Update Password ──────────────────────────────────────────────────────
    function openUpwdModal() {
      // Populate email from current session
      window._sbClient.auth.getUser().then(({ data }) => {
        const email = data?.user?.email || '—';
        el('upwdUserEmail').textContent = email;
      });
      el('upwdViewSend').style.display = '';
      el('upwdViewSent').style.display = 'none';
      const btn = el('upwdSendLinkBtn');
      if (btn) { btn.disabled = false; btn.textContent = 'Send Reset Link'; btn.style.opacity = ''; }
      el('upwdOverlay').classList.add('open');
    }
    // "5pm for Windows" promo card under About Developer: only in a browser on a
    // Windows computer with a mouse or trackpad (not the desktop app, phones,
    // tablets or Macs). Added after the shell has arranged Settings, so it
    // lands in the About tab right below the developer card.
    // Windows can switch alerts off for an app, or hold them all with Do Not
    // Disturb, and neither shows up to the page. So Windows users get a tip.
    document.addEventListener('DOMContentLoaded', () => {
      const tip = el('notifWinTip');
      if (!tip || !(window.__TAURI__ || /Windows NT/.test(navigator.userAgent))) return;
      tip.textContent = 'Not seeing alerts? In Windows Settings › System › Notifications, make sure '
        + (window.__TAURI__ ? '5pm' : 'your browser') + ' is on and Do Not Disturb is off.';
      tip.style.display = '';
    });

    document.addEventListener('DOMContentLoaded', () => {
      const dev = el('devAboutCard');
      if (!dev || window.__TAURI__ || !/Windows NT/.test(navigator.userAgent) || !matchMedia('(pointer: fine)').matches) return;
      const card = document.createElement('div');
      card.className = 'win-promo';
      card.innerHTML = `
        <div class="win-promo-icon" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M3 5.5 10.5 4.5v7H3zM11.5 4.4 21 3v8.5h-9.5zM3 12.5h7.5v7L3 18.5zM11.5 12.5H21V21l-9.5-1.4z"/></svg>
        </div>
        <div class="win-promo-text">
          <div class="form-label" style="font-size:13px;font-weight:600;color:var(--foreground);line-height:1.2">5pm for Windows</div>
          <div class="form-sub" style="margin-top:1px">Get the most out of 5pm with the app for Windows.</div>
        </div>
        <button class="btn btn-primary win-promo-cta" data-on-click="hcc56d74386">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/></svg>
          Download
        </button>`;
      // Last row of the About tiles, under Report a Bug.
      el('aboutTiles').querySelector('.settings-group').appendChild(card);
    });
    async function downloadForWindows(btn) {
      const page = 'https://github.com/rosshanmohapatra/5pm-workhour-tracker/releases/latest';
      btn.disabled = true;
      let url = page;
      try {
        const r = await fetch('https://api.github.com/repos/rosshanmohapatra/5pm-workhour-tracker/releases/latest');
        const asset = r.ok && ((await r.json()).assets || []).find(a => /^5pm-Standalone-.*\.exe$/.test(a.name));
        if (asset) url = asset.browser_download_url;
      } catch (_) { /* offline or rate-limited: the releases page still works */ }
      btn.disabled = false;
      if (url === page) window.open(page, '_blank', 'noopener');
      else window.location.href = url; // starts the download, stays on 5pm
      showToast('Downloading 5pm for Windows', 'success',
        'Windows may ask you to confirm the first install. Choose More info, then Run anyway.');
    }

    // The policy lives on the website; the desktop app opens it in the browser.
    // The desktop app opens it in the browser, which has its own Back. On the
    // web it's a Settings page with the usual back button: a new tab from an
    // installed phone app opened full screen with no way back. privacy.html
    // stays the one copy of the text; this page shows its <main>.
    function openPrivacyPolicy() {
      const url = 'https://whtracker.vercel.app/privacy.html';
      if (window.__TAURI__) { window.__TAURI__.core.invoke('open_external', { url }).catch(() => {}); return; }
      const page = _setPage('pagePrivacy', 'Privacy Policy', '', pg => {
        pg.insertAdjacentHTML('beforeend', '<div class="settings-section privacy-body" id="privacyBody"><div class="form-sub">Loading…</div></div>');
      });
      if (!page) { window.open(url, '_blank', 'noopener'); return; }
      const body = el('privacyBody');
      if (body.dataset.loaded) return;
      fetch('/privacy.html').then(r => { if (!r.ok) throw new Error(r.status); return r.text(); }).then(html => {
        const main = new DOMParser().parseFromString(html, 'text/html').querySelector('main');
        if (!main) throw new Error('no content');
        const updated = main.querySelector('.updated')?.textContent || '';
        main.querySelector('header')?.remove();
        body.replaceChildren(...main.childNodes);
        body.dataset.loaded = '1';
        _setPageHead(page, 'Privacy Policy', updated);
      }).catch(() => {
        body.innerHTML = '<div class="form-sub">Couldn’t load the policy. <a href="' + url + '" target="_blank" rel="noopener">Open it in a new tab</a>.</div>';
      });
    }

    // ── Support Development Modal ─────────────────────────────────────────
    function openSupportModal() {
      el('supportOverlay').classList.add('open');
      var wrap = el('supportQrWrap');
      if (wrap && !wrap.firstChild) _loadLib('qrcode').then(function () {
        if (wrap.firstChild) return;
        new QRCode(wrap, {
          text: 'upi://pay?pa=roshan.394@superyes&pn=Roshan%20Mohapatra&cu=INR',
          width: 256, height: 256,
          colorDark: '#000000', colorLight: '#ffffff',
          correctLevel: QRCode.CorrectLevel.M
        });
      }).catch(function () {});
    }
    function closeSupportModal() { el('supportOverlay').classList.remove('open'); }
    let _upiResetTimer = null;
    function _copyUpi() {
      navigator.clipboard?.writeText('roshan.394@superyes');
      // Copied state: swap icon only, no color change
      el('upiCopyIcon').style.display = 'none';
      el('upiCheckIcon').style.display = '';
      if (_upiResetTimer) clearTimeout(_upiResetTimer);
      _upiResetTimer = setTimeout(() => {
        el('upiCopyIcon').style.display = '';
        el('upiCheckIcon').style.display = 'none';
      }, 2000);
    }

    function closeUpwdModal() {
      el('upwdOverlay').classList.remove('open');
    }
    // Real Supabase password-reset flow
    async function upwdSendResetLink() {
      const btn = el('upwdSendLinkBtn');
      btn.disabled = true; btn.textContent = 'Sending…'; btn.style.opacity = '.7';
      try {
        const { data: userData } = await window._sbClient.auth.getUser();
        const email = userData?.user?.email;
        if (!email) throw new Error('Could not determine account email.');
        const { error } = await resetClient().auth.resetPasswordForEmail(email, { redirectTo: RESET_TO });
        if (error) throw error;
        el('upwdSentEmail').textContent = email;
        el('upwdViewSend').style.display = 'none';
        el('upwdViewSent').style.display = '';
      } catch(e) {
        btn.disabled = false; btn.textContent = 'Send Reset Link'; btn.style.opacity = '';
        showToast("Couldn't Send Reset Link", 'error', e.message || 'Please try again.');
      }
    }
    // ══════════════════════════════════════════════════════
    // MANAGE DEVICES
    // ══════════════════════════════════════════════════════
    //
    // Stored in the existing user_kv table under key='devices' as one JSONB
    // map { deviceId: { n, p, r, s } }. No new table, so no migration: user_kv
    // already carries own-rows-only RLS, the right grants, Realtime and
    // REPLICA IDENTITY FULL.
    //
    // Each device carries two identities on purpose:
    //   n (name)     — user-facing, renameable, seeded from DEVICE_NAMES
    //   p (platform) — "Chrome on Windows", never editable, so a renamed
    //                  device stays recognisable
    //   r (revoked)  — ISO timestamp, or null while active
    //   s (seen)     — last launch/resume
    //
    // Revoking another device sets r; that device signs itself out over
    // Realtime, or on its next launch if it was offline. The client SDK has no
    // API to kill one specific remote session, so a closed device stays
    // technically signed in until it next opens. "Log out others" is the
    // exception — auth.signOut({ scope: 'others' }) revokes those refresh
    // tokens server-side, immediately.

    const DEVICE_NAMES = ['Orange Cat', 'Little Peanut', 'Lemon Squeezy', 'Cozy Couch',
      'Work Bunny', 'Nerdy Glasses', 'Sleepy Owl', 'Water Baby', 'Coffee Bean',
      'Desk Potato', 'Sleepy Bunny', 'Tiny Intern', 'Busy Baddie'];

    const DEV_KV_KEY    = 'devices';
    const DEV_ID_KEY    = 'wh_device_id';   // survives logout — identifies the browser, not the account
    const IOS_SEEN_KEY  = 'wh_ios_install_seen'; // likewise: a choice about this browser, not the account
    const DEV_SINCE_KEY = 'wh_dev_since';   // when this browser last signed in

    function _deviceId() {
      let id = null;
      try { id = localStorage.getItem(DEV_ID_KEY); } catch {}
      if (!id) {
        id = window.crypto?.randomUUID?.() || ('d' + Math.random().toString(36).slice(2) + Date.now().toString(36));
        try { localStorage.setItem(DEV_ID_KEY, id); } catch {}
      }
      return id;
    }

    // Form factor, stored per device so other devices render the right icon.
    // iPadOS reports itself as Macintosh, hence the touch-point check.
    function _deviceKind(ua) {
      ua = ua || '';
      if (/iPad/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua))) return 'tablet';
      if (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1)   return 'tablet';
      if (/iPhone|iPod|Android|Mobile/.test(ua))                         return 'mobile';
      return 'desktop';
    }

    function _devAgo(iso) {
      if (!iso) return '';
      const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
      if (!isFinite(secs) || secs < 0) return '';
      const unit = (n, word) => n + ' ' + word + (n === 1 ? '' : 's') + ' ago';
      if (secs < 60)    return 'just now';
      if (secs < 3600)  return unit(Math.floor(secs / 60), 'min');
      if (secs < 86400) return unit(Math.floor(secs / 3600), 'hr');
      return unit(Math.floor(secs / 86400), 'day');
    }

    // Supabase puts a session_id claim in every access token. It identifies the
    // login, not the browser, so it changes on each fresh sign-in and is what
    // public.revoke_session() needs in order to end one specific session.
    async function _sessionId() {
      try {
        const { data: { session } } = await window._sbClient.auth.getSession();
        const jwt = session?.access_token;
        if (!jwt) return null;
        const body = jwt.split('.')[1];
        if (!body) return null;
        const claims = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/')));
        return claims.session_id || null;
      } catch { return null; }
    }

    function _devicePlatform() {
      const ua = navigator.userAgent || '';
      const browser = /Edg\//.test(ua)        ? 'Edge'
                    : /OPR\/|Opera/.test(ua)  ? 'Opera'
                    : /Firefox\//.test(ua)    ? 'Firefox'
                    : /Chrome\//.test(ua)     ? 'Chrome'
                    : /Safari\//.test(ua)     ? 'Safari'
                    : 'Browser';
      const os      = /Windows/.test(ua)              ? 'Windows'
                    : /iPhone|iPad|iPod/.test(ua)     ? 'iOS'
                    : /Android/.test(ua)              ? 'Android'
                    : /Mac OS X|Macintosh/.test(ua)   ? 'macOS'
                    : /Linux/.test(ua)                ? 'Linux'
                    : 'Unknown OS';
      return browser + ' on ' + os;
    }

    // Prefer a name this account isn't already using.
    function _pickDeviceName(taken) {
      const free = DEVICE_NAMES.filter(n => !taken.has(n));
      const pool = free.length ? free : DEVICE_NAMES;
      return pool[Math.floor(Math.random() * pool.length)];
    }

    const Devices = {
      async _read() {
        const uid = await SbSync._uid();
        if (!uid) return { uid: null, map: {} };
        const { data, error } = await window._sbClient
          .from('user_kv').select('value').eq('user_id', uid).eq('key', DEV_KV_KEY).maybeSingle();
        if (error) throw error;
        return { uid, map: data?.value?.d || {} };
      },

      // ponytail: read-modify-write of a single JSONB blob, so two devices
      // writing at the same instant is last-write-wins. Fine for a handful of
      // devices doing occasional heartbeats; give each device its own row if
      // that stops being true.
      async _write(uid, map) {
        const { error } = await window._sbClient.from('user_kv').upsert(
          { user_id: uid, key: DEV_KV_KEY, value: { d: map, src: SbSync._clientId },
            updated_at: new Date().toISOString() },
          { onConflict: 'user_id,key' }
        );
        if (error) throw error;
      },

      // Fresh read immediately before the write narrows the clobber window.
      async _mutate(fn) {
        const { uid, map } = await this._read();
        if (!uid) throw new Error('Not signed in.');
        fn(map);
        await this._write(uid, map);
        return map;
      },

      // Record this device, and decide whether it has been kicked.
      async register() {
        try {
          const { uid, map } = await this._read();
          if (!uid) return;
          const id    = _deviceId();
          const mine  = map[id];
          const since = Number(localStorage.getItem(DEV_SINCE_KEY) || 0);

          // Revoked after this session began → this device has been pulled.
          if (since && mine?.r && Date.parse(mine.r) > since) { _kickThisDevice(); return; }

          // No local session stamp means a fresh sign-in on this browser: adopt
          // now as the start, which also clears any stale revocation below.
          if (!since) localStorage.setItem(DEV_SINCE_KEY, String(Date.now()));

          map[id] = {
            n: mine?.n || _pickDeviceName(new Set(Object.values(map).map(d => d.n))),
            p: _devicePlatform(),
            k: _deviceKind(navigator.userAgent),
            // Refreshed on every launch: a new sign-in on this browser mints a
            // new session, and a stale id would revoke nothing.
            sid: (await _sessionId()) || mine?.sid || null,
            r: null,
            s: new Date().toISOString(),
          };
          await this._write(uid, map);
        } catch (e) { console.warn('[Devices] register failed:', e); }
      },

      async list() {
        const { map } = await this._read();
        return Object.entries(map)
          .map(([device_id, d]) => ({ device_id, name: d.n, platform: d.p, kind: d.k, revoked_at: d.r, last_seen_at: d.s }))
          .sort((a, b) => String(b.last_seen_at || '').localeCompare(String(a.last_seen_at || '')));
      },

      // Clamp here, not just in the input: user_kv has no CHECK constraint, so
      // this method is the only thing standing between any caller and a stored
      // name that breaks the row layout.
      rename(deviceId, name) {
        const n = String(name ?? '').trim().slice(0, 40);
        if (!n) throw new Error('Device name cannot be empty.');
        return this._mutate(m => { if (m[deviceId]) m[deviceId].n = n; });
      },

      // Two halves, and both are needed.
      //   1. public.revoke_session() deletes that device's row from
      //      auth.sessions, which kills its refresh token for real.
      //   2. The revoked flag, because deleting a session cannot reach into
      //      that device's localStorage to clear the cached hours.
      // Devices registered before session ids were recorded have no sid, and
      // fall back to half 2 alone, exactly as before.
      async revoke(deviceId) {
        const { uid, map } = await this._read();
        if (!uid) throw new Error('Not signed in.');
        const sid = map[deviceId]?.sid;
        if (sid) {
          const { error } = await window._sbClient.rpc('revoke_session', { target_session: sid });
          // PGRST202 means the function is not in the schema yet. Degrade to the
          // cooperative flag rather than failing the whole action, so this works
          // both before and after the migration is applied.
          if (error && error.code !== 'PGRST202' && !/not find the function|does not exist/i.test(error.message || '')) {
            throw error;
          }
          if (error) console.warn('[Devices] revoke_session unavailable, using flag only:', error.message);
        }
        map[deviceId] = { ...(map[deviceId] || {}), r: new Date().toISOString() };
        await this._write(uid, map);
      },

      // True server-side revocation. The map update is so those devices also
      // wipe their local cache when they next open.
      async revokeOthers() {
        const { error } = await window._sbClient.auth.signOut({ scope: 'others' });
        if (error) throw error;
        const me = _deviceId(), now = new Date().toISOString();
        await this._mutate(m => { Object.keys(m).forEach(k => { if (k !== me) m[k].r = now; }); });
      },

      // Explicit logout on this device: hide it from the list without losing
      // the user's rename. register() clears this on the next sign-in.
      async markSignedOut() {
        try {
          const me = _deviceId();
          await this._mutate(m => { if (m[me]) m[me].r = new Date().toISOString(); });
        } catch (_) { /* best-effort — never block sign-out */ }
      },
    };

    // Local sign-out forced by a revoke. Mirrors confirmLogout's wipe so no
    // cached work data is left on a device the user has cut off.
    let _kicking = false;
    function _kickThisDevice() {
      if (_kicking) return;
      _kicking = true;
      if (ticker) { clearInterval(ticker); ticker = null; }
      const t = el('signingOutTitle'); if (t) t.textContent = 'Signed Out';
      el('signingOutOverlay')?.classList.add('open');
      const delay = new Promise(r => setTimeout(r, 1200));
      // Same rule as confirmLogout: flush while the session still works, then
      // sign out, then wipe.
      const work = _flushSync({ silent: true }).catch(() => {}).then(_sbSignOut);
      Promise.all([work, delay]).finally(() => {
        localStorage.removeItem('wh_auth');
        Object.keys(localStorage)
          .filter(k => k.startsWith('wh_') && k !== 'wh_theme' && k !== DEV_ID_KEY && k !== IOS_SEEN_KEY)
          .forEach(k => localStorage.removeItem(k));
        window.location.href = 'login.html';
      });
    }

    const _DEV_ICONS = {
      // monitor
      desktop: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
      // tablet — wider body than the phone, same proportions otherwise
      tablet:  '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>',
      // phone
      mobile:  '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
    };
    // kind is stored per device; entries written before that existed fall back
    // to a guess from the platform string.
    const _devIcon = (kind, platform) => {
      const k = _DEV_ICONS[kind] ? kind : (/iOS|Android/.test(platform || '') ? 'mobile' : 'desktop');
      return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
           + 'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + _DEV_ICONS[k] + '</svg>';
    };

    async function renderDevices() {
      const list = el('devList');
      if (!list) return;
      const othersWrap = el('devOthersWrap');
      // The last list stays up while the fresh one loads, then swaps in whole.
      if (!list.children.length) list.innerHTML = '<div style="font-size:13px;color:var(--muted-fg)">Loading…</div>';
      try {
        // Revoked entries stay in the map (so a rename survives) but are hidden —
        // they come back when that device signs in again.
        const rows = (await Devices.list()).filter(r => !r.revoked_at);
        const me = _deviceId();
        if (!rows.length) {
          list.innerHTML = '<div style="font-size:13px;color:var(--muted-fg)">No devices yet.</div>';
          if (othersWrap) othersWrap.style.display = 'none';
          return;
        }
        rows.sort((a, b) => (b.device_id === me) - (a.device_id === me)); // current device first
        list.replaceChildren(...rows.map(r => _devBuildRow(r, r.device_id === me)));
        if (othersWrap) othersWrap.style.display = rows.some(r => r.device_id !== me) ? '' : 'none';
      } catch (e) {
        list.innerHTML = '<div style="font-size:13px;color:var(--muted-fg)">Couldn\'t load devices.</div>';
        if (othersWrap) othersWrap.style.display = 'none';
      }
    }

    function _devBuildRow(row, isCurrent) {
      const rowEl = document.createElement('div');
      rowEl.className = 'dev-row';

      const left = document.createElement('div');
      left.className = 'dev-left';
      const icon = document.createElement('div');
      icon.className = 'dev-icon';
      icon.innerHTML = _devIcon(row.kind, row.platform);
      const info = document.createElement('div');
      info.className = 'dev-info';

      // Primary title — editable in place.
      const nameInput = document.createElement('input');
      nameInput.className = 'dev-name';
      nameInput.type = 'text';
      nameInput.value = row.name || 'Device';
      nameInput.maxLength = 40;
      nameInput.spellcheck = false;
      nameInput.setAttribute('aria-label', 'Device name');
      nameInput.setAttribute('autocomplete', 'off');
      nameInput.setAttribute('data-lpignore', 'true');
      nameInput.setAttribute('data-1p-ignore', 'true');
      let last = nameInput.value;
      const save = async () => {
        const v = nameInput.value.trim().slice(0, 40);
        if (!v) { nameInput.value = last; return; }
        if (v === last) { nameInput.value = v; return; }
        nameInput.value = v;
        try {
          await Devices.rename(row.device_id, v);
          last = v;
          showToast('Device Renamed', 'success');
        } catch (e) {
          nameInput.value = last;
          showToast("Couldn't Rename Device", 'error', e.message || 'Please try again.');
        }
      };
      nameInput.addEventListener('blur', save);
      nameInput.addEventListener('keydown', e => {
        if (e.key === 'Enter')  { e.preventDefault(); nameInput.blur(); }
        if (e.key === 'Escape') { nameInput.value = last; nameInput.blur(); }
      });

      // Secondary title — the platform's view. Not editable.
      const sub = document.createElement('div');
      sub.className = 'dev-sub';
      sub.textContent = row.platform || 'Unknown device';

      info.appendChild(nameInput);
      info.appendChild(sub);
      // Last activity sits under the platform line. Only for other devices:
      // on the one you are using it is self-evident.
      if (!isCurrent) {
        const seen = document.createElement('div');
        seen.className = 'dev-seen';
        seen.textContent = _devAgo(row.last_seen_at);
        if (seen.textContent) info.appendChild(seen);
      }
      left.appendChild(icon);
      left.appendChild(info);
      rowEl.appendChild(left);

      const actions = document.createElement('div');
      actions.className = 'dev-actions';
      if (isCurrent) {
        const chip = document.createElement('span');
        chip.className = 'dev-chip';
        chip.textContent = 'This Device';
        actions.appendChild(chip);
      } else {
        const btn = document.createElement('button');
        btn.className = 'btn-ghost-destructive';
        btn.style.cssText = 'flex-shrink:0;font-size:12px;height:30px;padding:0 12px';
        btn.textContent = 'Log Out';
        btn.addEventListener('click', () => devRevoke(row.device_id, row.name, btn));
        actions.appendChild(btn);
      }
      rowEl.appendChild(actions);
      return rowEl;
    }

    async function devRevoke(deviceId, name, btn) {
      if (btn) { btn.disabled = true; btn.textContent = 'Logging Out…'; btn.style.opacity = '.7'; }
      try {
        await Devices.revoke(deviceId);
        showToast('Device Logged Out', 'success',
          (name || 'That device') + ' will sign out and clear its local data.');
        renderDevices();
      } catch (e) {
        if (btn) { btn.disabled = false; btn.textContent = 'Log Out'; btn.style.opacity = ''; }
        showToast("Couldn't Log Out Device", 'error', e.message || 'Please try again.');
      }
    }

    async function devRevokeOthers() {
      const btn = el('devRevokeOthersBtn');
      if (btn) { btn.disabled = true; btn.textContent = 'Logging Out…'; btn.style.opacity = '.7'; }
      try {
        await Devices.revokeOthers();
        showToast('Other Devices Logged Out', 'success', 'Every session except this one has ended.');
        renderDevices();
      } catch (e) {
        showToast("Couldn't Log Out Others", 'error', e.message || 'Please try again.');
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Log Out Others'; btn.style.opacity = ''; }
      }
    }

    // The devices map changing elsewhere: sign out immediately if this device
    // was revoked, otherwise just keep the Settings list honest. Absence is not
    // treated as a revoke — a device simply may not have registered yet.
    function _onRemoteDevices(row) {
      const mine  = row?.value?.d?.[_deviceId()];
      const since = Number(localStorage.getItem(DEV_SINCE_KEY) || 0);
      if (since && mine?.r && Date.parse(mine.r) > since) { _kickThisDevice(); return; }
      if (el('devList')?.offsetParent) renderDevices(); // Saved Logins is on screen
    }

    // ── Supabase sign-out (window._sbClient is always ready — init'd in <head>) ──
    async function _sbSignOut() {
      try { await window._sbClient.auth.signOut(); } catch (_) { /* best-effort */ }
    }

    // ── Danger Zone ─────────────────────────────────────────────────────────
    function openLogoutModal() {
      el('logoutOverlay').classList.add('open');
    }
    function confirmLogout() {
      el('logoutOverlay').classList.remove('open');
      if (ticker) { clearInterval(ticker); ticker = null; }
      el('signingOutTitle').textContent = 'Logging Out';
      el('signingOutOverlay').classList.add('open');
      // Run sign-out and the 2 s animation delay in parallel; navigate when both finish
      const delay = new Promise(r => setTimeout(r, 2000));
      // Ordering matters and every step needs the session to still be valid:
      // push anything unsynced FIRST, because the wipe below clears the very
      // localStorage entries _flushSync reads from (it skips any day whose
      // Store.getDay() comes back empty), then mark this device signed out,
      // then end the session.
      const work = _flushSync({ silent: true })
        .catch(() => {})   // a failed push must not strand the user mid-logout
        .then(() => Devices.markSignedOut())
        .then(_sbSignOut);
      Promise.all([work, delay]).finally(() => {
        localStorage.removeItem('wh_auth');
        // Clear cached account data (day logs, session, config) so whoever signs
        // in next on this device — even the same person — starts from a clean
        // pull instead of silently inheriting this account's local cache.
        // wh_device_id is kept: it identifies the browser, not the account, so
        // signing back in reuses the same entry (and its rename).
        Object.keys(localStorage)
          .filter(k => k.startsWith('wh_') && k !== 'wh_theme' && k !== DEV_ID_KEY && k !== IOS_SEEN_KEY)
          .forEach(k => localStorage.removeItem(k));
        window.location.href = 'login.html';
      });
    }

    function openDeleteModal() {
      el('delViewFeedback').style.display = '';
      el('delViewPassword').style.display = 'none';
      el('delChips')?.querySelectorAll('.del-chip').forEach(c => c.classList.remove('selected'));
      const txt = el('delFeedbackText');
      if (txt) { txt.value = ''; txt.style.height = ''; }
      el('deleteProfileOverlay').classList.add('open');
    }
    function closeDeleteModal() {
      el('deleteProfileOverlay').classList.remove('open');
    }
    function toggleDelChip(chip) {
      chip.classList.toggle('selected');
    }
    function autoExpandTa(ta) {
      ta.style.height = 'auto';
      ta.style.height = ta.scrollHeight + 'px';
    }
    function goToDeletePwd() {
      // Collect feedback and email it before proceeding
      const chips = [...(el('delChips')?.querySelectorAll('.del-chip.selected') || [])].map(c => c.textContent.trim()).join(', ');
      const details = el('delFeedbackText')?.value?.trim() || '';
      // Saved to Supabase (deletion_feedback: insert-only, read in the
      // dashboard). Fire-and-forget: feedback never blocks the deletion.
      if (chips || details) {
        Promise.resolve(window._sbClient.from('deletion_feedback')
          .insert({ reasons: chips || null, details: details || null }))
          .then(r => { if (r && r.error) console.warn('[delete] feedback not saved:', r.error.message); })
          .catch(() => {});
      }

      el('delViewFeedback').style.display = 'none';
      el('delViewPassword').style.display = '';
      const inp = el('deleteConfirmInput');
      if (inp) { inp.value = ''; inp.classList.remove('unmasked'); }
      el('delEyeOpen') && (el('delEyeOpen').style.display = '');
      el('delEyeClose') && (el('delEyeClose').style.display = 'none');
      el('delPwdContinueBtn').disabled = true;
      setTimeout(() => inp?.focus(), 50);
    }
    function backToDeleteFeedback() {
      el('delViewPassword').style.display = 'none';
      el('delViewFeedback').style.display = '';
    }
    function toggleDeletePwd() {
      const inp = el('deleteConfirmInput');
      const isUnmasked = inp.classList.toggle('unmasked');
      el('delEyeOpen').style.display  = isUnmasked ? 'none' : '';
      el('delEyeClose').style.display = isUnmasked ? '' : 'none';
    }
    function confirmDeleteProfile() {
      closeDeleteModal();
      el('signingOutTitle').textContent = 'Deleting Account';
      el('signingOutOverlay').classList.add('open');
      const delay = new Promise(r => setTimeout(r, 2000));
      Promise.all([_sbSignOut(), delay]).finally(() => {
        localStorage.clear();
        window.location.href = 'login.html';
      });
    }

    // Close modals on backdrop click
    el('logoutOverlay')?.addEventListener('click', ev => { if (ev.target === el('logoutOverlay')) el('logoutOverlay').classList.remove('open'); });
    el('deleteProfileOverlay')?.addEventListener('click', ev => { if (ev.target === el('deleteProfileOverlay')) closeDeleteModal(); });

    function obFinish() {
      localStorage.setItem(OB_DONE_KEY, '1');
      el('obOverlay').style.display = 'none';
      populateSettings();
      renderEmptyState();
      renderHistory();
      window.Tour?.afterOnboarding();   // the Product Tour, once per account (lib/pages/tour.js)
    }

    function openOnboarding() {
      _obStep = 1;
      obSwitchTab('daily');
      obUpdateSteps(1);
      el('obOverlay').style.display = 'flex';
      _sizeObIntroLogo();
    }

    // ── INIT ───────────────────────────────────────────
    (function init() {
      _migrateLegacyDismissed(); // one-time migration from legacy wh_dismissed key

      // ── Sticky navbar: toggle .stuck when sentinel scrolls out of view ──
      (function() {
        const sentinel = el('navSentinel');
        const navbar   = sentinel?.nextElementSibling;
        if (sentinel && navbar && 'IntersectionObserver' in window) {
          new IntersectionObserver(
            ([entry]) => navbar.classList.toggle('stuck', !entry.isIntersecting),
            { threshold: 0 }
          ).observe(sentinel);
        }
      })();

      _tpInitWheels();
      _tpSegInit();
      _setTodayDateChip();
      // The day-selector used to cancel every wheel event here so its crosshair
      // stayed the only way to move it. That also cancelled page scrolling
      // whenever the pointer sat over the row, and narrowing it to sideways
      // gestures still caught trackpad swipes with any drift. Letting the row
      // scroll sideways on a wheel is ordinary behaviour and costs nothing.
      setInterval(tickHeader, 1000);
      tickHeader();

      const tk = todayKey();
      // sessionStorage survives a reload of this tab but is empty on a fresh open
      // (new tab/window, or the browser session ending) — a reliable signal for
      // "reload" vs "open" with no arbitrary time window. Opening the site always
      // lands on Today; reloading keeps whichever day (past, present, or future)
      // was being viewed.
      let _sessionDay = null;
      try { _sessionDay = sessionStorage.getItem('wh_sel_day'); } catch {}
      selectedDayKey = (_sessionDay && /^\d{4}-\d{2}-\d{2}$/.test(_sessionDay)) ? _sessionDay : tk;
      daySelectorWeekOffset = 0;
      updateSelDayHeader(selectedDayKey);

      // Notification permission warning
      if ('Notification' in window && Notification.permission === 'denied') {
        el('notifPermBar').classList.add('show');
      }

      let tl = dayLog(tk);

      // ── Feature: Future Day Plans Auto-Activate ──────────────────────────────
      // If today has a futurePlan (Holiday / Leave / Half Day) set ahead of time
      // but no confirmed override yet, promote it to override so the planned-day
      // UI shows immediately without prompting the user to start tracking.
      if (tl?.futurePlan && !tl?.override) {
        const _promoted = { ...tl, override: tl.futurePlan };
        if (tl.futureReason) _promoted.note = _promoted.note || tl.futureReason;
        saveDayLog(tk, _promoted);
        tl = dayLog(tk); // re-read after promotion
      }

      if (tl?.loginTime && !tl?.autostopped && !tl?.checkoutDisplay) {
        // Active session: has a start time, no exit time, not auto-stopped — resume timer
        if (!_resumeFromLog(tl)) renderEmptyState();
      } else if (tl?.loginTime && !tl?.autostopped && tl?.checkoutDisplay) {
        // Session has an exit time. Distinguish true checkout from a mid-day pause:
        // checkout() saves checkoutTime; endSession() saves sessionDate instead.
        // If neither is present (cross-device pull), default to 'start' — safer.
        el('shiftInputRow').classList.remove('active-state', 'hidden');
        el('autostopBanner').classList.remove('show');
        const _isPaused = !tl.checkoutTime && tl.sessionDate === tk;
        if (_isPaused) {
          setCalcBtnState('ended'); // paused mid-day — Resume makes sense
          const _pausedDur = dur(Math.round((tl.hoursWorked || 0) * 3600));
          el('shiftActiveLabel').textContent = `Paused · ${_pausedDur}`;
        } else {
          setCalcBtnState('start'); // true checkout or cross-device end — Quick Start
          el('shiftActiveLabel').textContent = '—';
        }
        renderEmptyState();
      } else if (tl?.autostopped) {
        // Restore auto-stopped state
        autoStopped = true;
        const pts = tl.loginTime.split(':').map(Number);
        const d = new Date(); d.setHours(pts[0] || 0, pts[1] || 0, pts[2] || 0, 0);
        loginDate = d;
        setCalcBtnState('ended');
        _showAutostopBar(tl.checkoutDisplay);
        renderEmptyState(); // show card in read mode
      } else { setCalcBtnState('start'); renderEmptyState(); }

      // If selected day is not today, render appropriately; on weekends route
      // through selectDay so the strip card gets the active class.
      if (selectedDayKey === '__wknd__') selectWeekendView();
      else if (selectedDayKey !== tk) selectDay(selectedDayKey);
      else if (isWeekend() || tl?.override) selectDay(tk);
      else renderDaySelector();

      restoreSession();
      // The weekend/off-day card above was chosen before the session was
      // restored; a running session needs the tracking view and its End button.
      if (loginDate && (isWeekend() || tl?.override) && (selectedDayKey === tk || selectedDayKey === '__wknd__')) selectDay(tk);
      // Start checkpoint timer if session is active (survives reload)
      if (loginDate) _startCheckpoint();
      // Recovery prompts. Auto-stop recovery runs even when loginDate is set
      // (an auto-stopped session restores loginDate for display). Forgot-to-logout
      // only applies when there's no active/ended session today.
      setTimeout(() => { checkAutoStopRecovery(); }, 800);

      // Always pull from Supabase on launch — cross-device accuracy requires
      // fresh data regardless of when the last pull happened.
      _syncGlance(_refreshFromCloud(true, true));

      // Pull settings + wire up realtime — always, regardless of pull cooldown.
      SbSync.pullSettings().then(remoteCfg => {
        if (remoteCfg && typeof remoteCfg === 'object') {
          _applyingRemote = true;
          try {
            Store.setCfg(remoteCfg);
            populateSettings();
            renderDaySelector();
            renderNotifs(); // apply synced dismissed state on load
            refreshProfileCard(); // re-render card with pulled name/position
            if (loginDate) render(); else renderEmptyState();
          } finally { _applyingRemote = false; }
        }
        initRealtimeSync();
      });

      // Hydrate the profile card and sign-in methods — auth data first, then cfg overlay when pullSettings resolves
      hydrateProfileCard();
      hydrateSignInMethods();
      // Register this device. The list paints when the modal is opened.
      Devices.register();

      // Restore last active tab (persisted in sessionStorage across reloads)
      const savedTab = (function(){ try { return sessionStorage.getItem('wh_active_tab'); } catch { return null; } })();
      if (savedTab && VIEW_ORDER.includes(savedTab) && savedTab !== 'home') {
        switchTab(savedTab);
      }

      // Show onboarding on first launch
      if (!localStorage.getItem(OB_DONE_KEY) && !Store.getCfg()) {
        setTimeout(openOnboarding, 300);
      }

      // Show week plan modal if needed (only after onboarding is complete)
      if (localStorage.getItem(OB_DONE_KEY) && shouldShowWeekPlan()) setTimeout(() => {
        // Don't open Week Plan if a higher-priority recovery modal is already visible
        const recoveryOpen = el('autoStopRecoveryOverlay')?.classList.contains('open');
        if (!recoveryOpen) openWeekPlanModal();
      }, 1200);

      // ── Background scroll lock: the one place it happens ──
      // Phones and tablets: while any modal, bottom sheet or panel is open, the
      // page behind can't scroll. Desktop is never locked, so its scrollbar
      // never disappears and the page width never shifts.
      // The body is pinned with position:fixed at its current offset (the only
      // lock iOS Safari always honours) and put back exactly there on close.
      // One observer watches every class/style change, so any modal that opens
      // the usual way (an .open class or display) is covered without its own code.
      const MODAL_OPEN = '.overlay.open, .wp-picker-overlay.open, .email-modal-overlay.open, .td-panel.open, ' +
                         '.ios-install-sheet.open, .notif-panel.open, .ob-overlay';
      const TOUCH = matchMedia('(hover: none) and (pointer: coarse)');
      const _shown = n => {
        const s = getComputedStyle(n);
        return s.display !== 'none' && s.visibility !== 'hidden' && n.getBoundingClientRect().height > 0;
      };
      let _lockedY = null;
      const _syncScrollLock = () => {
        const lock = TOUCH.matches && [...document.querySelectorAll(MODAL_OPEN)].some(_shown);
        const html = document.documentElement, body = document.body;
        if (lock && _lockedY === null) {
          _lockedY = window.scrollY;
          body.style.top = `-${_lockedY}px`;
          html.classList.add('scroll-locked');
        } else if (!lock && _lockedY !== null) {
          html.classList.remove('scroll-locked');
          body.style.top = '';
          window.scrollTo(0, _lockedY);
          _lockedY = null;
        }
      };
      // The observer batches a burst of changes into one call and runs before the
      // next paint, so the lock is in place before the sheet shows. It only
      // re-checks when a modal itself changes, and never mid-drag: a sheet being
      // dragged rewrites its style every frame, and measuring the page each time
      // made dragging stutter.
      const MODAL_ROOTS = '.overlay, .wp-picker-overlay, .email-modal-overlay, .td-panel, ' +
                          '.ios-install-sheet, .notif-panel, .ob-overlay';
      new MutationObserver(records => {
        if (records.some(r => r.target.matches?.(MODAL_ROOTS) && !r.target.classList.contains('sheet-dragging'))) _syncScrollLock();
      }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
      TOUCH.addEventListener?.('change', _syncScrollLock);
      _syncScrollLock();
    })();

    // Modal section — info tooltip portal (appended to body to escape overflow clipping)
    var _modalTip = (function() {
      var el = document.createElement('div');
      el.className = 'info-tooltip';
      el.innerHTML = '<div class="info-tooltip-title">Info</div><div class="info-tooltip-desc"></div>';
      document.body.appendChild(el);
      return el;
    })();
    function _positionAndShowTip(btn) {
      var title = btn.getAttribute('data-tip-title') || '';
      var desc = btn.getAttribute('data-tip-desc') || '';
      var titleEl = _modalTip.querySelector('.info-tooltip-title');
      titleEl.textContent = title;
      titleEl.style.display = title ? '' : 'none';
      var descEl = _modalTip.querySelector('.info-tooltip-desc');
      descEl.textContent = desc;
      descEl.style.color = title ? '' : 'var(--foreground)';
      _modalTip.style.width = ''; // reset to measure natural width
      _modalTip.classList.add('visible');
      var r = btn.getBoundingClientRect();
      var vw = window.innerWidth;
      var vh = window.innerHeight;
      var gap = 8;
      var tipW = Math.min(220, vw - gap * 2);
      var left = r.left + r.width / 2 - tipW / 2;
      left = Math.max(gap, Math.min(vw - tipW - gap, left));
      _modalTip.style.left = left + 'px';
      _modalTip.style.width = tipW + 'px';
      var tipH = _modalTip.offsetHeight;
      var spaceBelow = vh - r.bottom;
      if (spaceBelow >= tipH + gap) {
        _modalTip.style.top = (r.bottom + gap) + 'px';
      } else {
        _modalTip.style.top = Math.max(gap, r.top - tipH - gap) + 'px';
      }
    }
    function _hideModalTip() { _modalTip.classList.remove('visible'); }
    function _showModalTip(btn) {
      if (window.matchMedia('(hover: hover)').matches) _positionAndShowTip(btn);
    }
    function _toggleModalTip(btn) {
      if (_modalTip.classList.contains('visible')) {
        _hideModalTip();
      } else {
        _positionAndShowTip(btn);
      }
    }
    document.addEventListener('click', function(e) {
      if (!e.target.closest('.info-icon-btn')) _hideModalTip();
    });
    // Tooltips are position:fixed, so a scroll would leave one floating over
    // content it no longer describes. Capture catches modal and panel scrollers too.
    document.addEventListener('scroll', function() {
      document.querySelectorAll('.info-tooltip.visible').forEach(function(t) { t.classList.remove('visible'); });
    }, { capture: true, passive: true });

    // Onboarding intro — keep the logo a perfect square equal to the title + description block height.
    // The logo is square (width follows height via aspect-ratio), so its height feeds back into the
    // text's available width. To avoid settling at a too-large equilibrium, shrink to 0 first so the text
    // measures at its FULL width (fewest lines), then grow to match, settling in a few bounded passes.
    function _sizeObIntroLogo() {
      var text = document.querySelector('.ob-intro-text');
      var logos = document.querySelectorAll('.ob-intro-logo');
      if (!text || !logos.length) return;
      logos.forEach(function(l) { l.style.height = '0px'; });
      var passes = 0;
      (function settle() {
        var h = Math.round(text.getBoundingClientRect().height);
        var cur = Math.round(parseFloat(logos[0].style.height) || 0);
        if (h && h !== cur) {
          logos.forEach(function(l) { l.style.height = h + 'px'; });
          if (passes++ < 4) requestAnimationFrame(settle);
        }
      })();
    }
    // Re-sync when the viewport (and therefore the text wrap) changes.
    window.addEventListener('resize', function() {
      if (el('obOverlay') && el('obOverlay').style.display !== 'none') _sizeObIntroLogo();
    });

    // ══ NEW SHELL (opt-in) ══════════════════════════════════════════════════
    // Home, Notifications and Settings live in the floating header. Overview and
    // Dashboard become one scrolling page. Settings gains tabs, built by moving
    // nodes that are already on the page, so ids and handlers survive.
    //
    // On by default. ?shell=old falls back to the previous layout and is
    // remembered, because signing in bounces through login.html and would drop
    // the query; ?shell=new returns. The desktop app has no address bar, so a
    // default-on shell is the only way it ever sees this.
    (function newShell() {
      const param = new URLSearchParams(location.search).get('shell');
      if (param === 'old') localStorage.setItem('wh_shell_off', '1');
      if (param === 'new') localStorage.removeItem('wh_shell_off');
      if (localStorage.getItem('wh_shell_off') === '1') return;

      document.body.classList.add('shell-new');
      // The viewport scrollbar belongs to <html>, so the class goes there too.
      document.documentElement.classList.add('shell-new');

      const svg = d => '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>';
      const I = {
        home:  '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
        gear:  '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6h.09A1.65 1.65 0 0 0 10.6 3V3a2 2 0 0 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
        back:  '<path d="M15 18l-6-6 6-6"/>',
        sliders: '<line x1="21" y1="4" x2="14" y2="4"/><line x1="10" y1="4" x2="3" y2="4"/><line x1="21" y1="12" x2="12" y2="12"/><line x1="8" y1="12" x2="3" y2="12"/><line x1="21" y1="20" x2="16" y2="20"/><line x1="12" y1="20" x2="3" y2="20"/><line x1="14" y1="2" x2="14" y2="6"/><line x1="8" y1="10" x2="8" y2="14"/><line x1="16" y1="18" x2="16" y2="22"/>',
        bell:  '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
        shield:'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
        info:  '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>'
      };

      // ── One scrolling page ────────────────────────────
      // Dashboard's content moves under Overview's, so there is nothing left to
      // navigate between.
      const home = el('viewHome'), analytics = el('viewAnalytics');
      if (home && analytics) {
        const target = home.querySelector('.page') || home;
        const source = analytics.querySelector('.page') || analytics;
        while (source.firstChild) {
          const node = source.firstChild;
          // Overview's stack sets gap:0, so each moved card brings its own.
          if (node.nodeType === 1) node.classList.add('merged-block');
          target.appendChild(node);
        }
        analytics.remove();
        renderPenalties(); // from local data now; the launch pull renders it again
        // Its tabs too: on phones the bottom bar still offered an empty Dashboard.
        el('mobTabAnalytics')?.remove();
        el('tabAnalytics')?.remove();
        // init() runs first and may have restored a saved 'analytics' tab.
        if (activeView === 'analytics') switchTab('analytics');
      }

      // ── Floating controls ─────────────────────────────
      // The navbar is gone; notifications and settings sit top right and both
      // toggle. The real notification button is moved rather than rebuilt so it
      // keeps its badge and handler.
      const cluster = document.createElement('div');
      cluster.className = 'hdr-cluster';
      // Lives in the day-context header, so it scrolls with the page.
      (document.querySelector('.sel-day-ctx') || document.body).appendChild(cluster);

      const realNotif = el('notifBtn');
      if (realNotif) cluster.appendChild(realNotif);

      const bSet = document.createElement('button');
      bSet.className = 'hdr-icon'; bSet.id = 'hdrSettings';
      bSet.title = 'Settings'; bSet.setAttribute('aria-label', 'Settings');
      bSet.innerHTML = svg(I.gear);
      cluster.appendChild(bSet);

      // Phones: the same toggle, right of Notifications in the top bar.
      const mSet = document.createElement('button');
      mSet.className = 'btn-icon hdr-icon'; mSet.id = 'mobSettingsBtn';
      mSet.title = 'Settings'; mSet.setAttribute('aria-label', 'Settings');
      mSet.innerHTML = svg(I.gear);
      el('mobNotifBtn')?.after(mSet);

      const syncHeader = () => [bSet, mSet, el('railProfile')].forEach(b => b?.classList.toggle('active', activeView === 'settings'));
      // Toggling: pressing Settings again returns to the page you came from.
      bSet.onclick = mSet.onclick = () => { switchTab(activeView === 'settings' ? 'home' : 'settings'); syncHeader(); };
      syncHeader();


      // ── Desktop rail ──────────────────────────────────
      // Desktop (a mouse and a wide window, web or Windows app): an icon-only
      // panel on the left. Logo at the top; the theme switch and Settings at
      // the bottom. Notifications stays on the page (top right). Narrower
      // windows and touch keep the floating buttons as they were.
      const RAIL_MQ = matchMedia('(min-width: 1024px) and (hover: hover) and (pointer: fine)');
      const rail = document.createElement('aside');
      rail.className = 'app-rail'; rail.id = 'appRail'; rail.setAttribute('aria-label', 'App');
      const railTop = document.createElement('div'); railTop.className = 'app-rail-top';
      const railBottom = document.createElement('div'); railBottom.className = 'app-rail-bottom';
      rail.append(railTop, railBottom);
      document.body.appendChild(rail);
      const brand = document.querySelector('.page-brand');

      const SUN = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>';
      const MOON = '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>';
      const USER = '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>';
      const railBtn = (id, label) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'rail-btn'; b.id = id;
        b.title = label; b.setAttribute('aria-label', label);
        return b;
      };

      // Settings (gear): opens Settings; pressing again goes back.
      const railProfile = railBtn('railProfile', 'Settings');
      railProfile.innerHTML = svg(I.gear);
      railProfile.onclick = () => { switchTab(activeView === 'settings' ? 'home' : 'settings'); syncHeader(); };

      // Theme: one press flips light and dark, with the same circular reveal,
      // starting from this button.
      const railTheme = railBtn('railTheme', 'Switch Theme');
      const paintTheme = () => {
        railTheme.innerHTML = svg(dark ? SUN : MOON);
        railTheme.title = dark ? 'Switch to Light' : 'Switch to Dark';
        railTheme.setAttribute('aria-label', railTheme.title);
      };
      railTheme.onclick = () => setAppTheme(dark ? 'light' : 'dark', railTheme);
      new MutationObserver(paintTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

      const placeForMode = () => {
        const on = RAIL_MQ.matches;
        document.body.classList.toggle('rail-on', on);
        const permBar = el('notifPermBar'), notifList = el('notifList');
        if (on) {
          if (brand) railTop.appendChild(brand);
          // Rail bottom, top to bottom: Notifications, Settings. The bell sits
          // where Theme was; Theme takes the bell's place top right.
          if (realNotif) { realNotif.classList.add('rail-btn'); railBottom.append(realNotif, railProfile); }
          else railBottom.append(railProfile);
          railTheme.classList.remove('rail-btn'); railTheme.classList.add('hdr-icon');
          cluster.prepend(railTheme);
          // "Notifications are off" lives at the top of the notifications drawer.
          if (permBar && notifList && permBar.parentElement !== notifList.parentElement) {
            if (!permBar._home) permBar._home = { parent: permBar.parentElement, next: permBar.nextSibling };
            notifList.before(permBar);
          }
        } else {
          if (brand) document.body.appendChild(brand);
          if (realNotif) { realNotif.classList.remove('rail-btn'); cluster.prepend(realNotif); }
          railTheme.classList.add('rail-btn'); railTheme.classList.remove('hdr-icon');
          railBottom.prepend(railTheme);
          if (permBar && permBar._home) permBar._home.parent.insertBefore(permBar, permBar._home.next);
        }
        paintTheme();
      };
      RAIL_MQ.addEventListener('change', placeForMode);
      placeForMode();
      // The day selector switches between swiping (touch) and one-week pages (desktop).
      const _dsRelayout = () => requestAnimationFrame(() => { _dsResetScroll(); _dsPlaceGlide(); _updateDayNavBtns(); });
      RAIL_MQ.addEventListener('change', _dsRelayout);
      addEventListener('resize', _dsRelayout, { passive: true });

      // The notification panel hangs below its button instead of centre screen.
      // With the desktop rail it's a centred modal instead (CSS), so no placing.
      const panel = el('notifPanel');
      function placePanel() {
        if (panel && document.body.classList.contains('rail-on')) {
          ['left', 'top', 'right', 'width', 'transform'].forEach(p => panel.style.removeProperty(p));
          return;
        }
        if (!panel || !realNotif || innerWidth <= 640) return;
        const b = realNotif.getBoundingClientRect();
        panel.style.left = 'auto';
        panel.style.transform = 'none';
        panel.style.top = (b.bottom + 8) + 'px';
        panel.style.right = Math.max(8, innerWidth - b.right) + 'px';
        panel.style.width = '380px';
      }
      if (realNotif) realNotif.addEventListener('click', () => requestAnimationFrame(placePanel));
      addEventListener('resize', () => { if (panel && panel.classList.contains('open')) placePanel(); });

      // ── Scrollbar that fades when idle ────────────────
      let idle;
      addEventListener('scroll', () => {
        document.documentElement.classList.add('scrolling');
        clearTimeout(idle);
        idle = setTimeout(() => document.documentElement.classList.remove('scrolling'), 900);
      }, { passive: true });

      // ── Settings ──────────────────────────────────────
      const wrap = document.querySelector('#viewSettings .settings-panel');
      if (!wrap) return;

      // Back button, to the left of the Settings title.
      const header = wrap.querySelector('.settings-header');
      const title = header && header.querySelector('.settings-title');
      if (title) {
        const back = document.createElement('button');
        back.className = 'back-btn'; back.title = 'Back'; back.setAttribute('aria-label', 'Back');
        back.innerHTML = svg(I.back);
        back.onclick = () => { switchTab('home'); syncHeader(); };
        title.parentElement.insertBefore(back, title);
      }

      const sectionByName = name => [...wrap.querySelectorAll('.settings-section')].find(s => {
        const h = s.querySelector('.settings-section-header');
        return h && h.textContent.trim() === name;
      });
      const rowOf = node => {
        let n = node;
        while (n && n.parentElement && !n.parentElement.classList.contains('settings-group')) n = n.parentElement;
        return n;
      };
      const rowByLabel = (section, text) => {
        const labels = section ? [...section.querySelectorAll('.form-label')] : [];
        const label = labels.find(l => l.textContent.trim() === text);
        return label ? rowOf(label) : null;
      };

      const TABS = [['General', I.gear], ['Advanced', I.sliders], ['Notifications', I.bell],
                    ['Security', I.shield], ['About', I.info]];
      const bar = document.createElement('div'); bar.className = 'set-tabs';
      bar.setAttribute('role', 'tablist'); bar.setAttribute('aria-label', 'Settings sections');
      const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
      // Arrows show only on the side that has more tabs to scroll to.
      const arrow = (side, label, d, dir) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'set-tabs-arrow ' + side; b.tabIndex = -1; b.hidden = true;
        b.setAttribute('aria-label', label); b.innerHTML = svg(d);
        b.onclick = () => bar.scrollBy({ left: dir * bar.clientWidth * .75, behavior: reduced() ? 'auto' : 'smooth' });
        return b;
      };
      const arrL = arrow('l', 'Scroll tabs left', I.back, -1);
      const arrR = arrow('r', 'Scroll tabs right', '<path d="m9 18 6-6-6-6"/>', 1);
      const tabShell = document.createElement('div'); tabShell.className = 'set-tabs-shell';
      tabShell.append(arrL, bar, arrR);
      function edges() {
        const max = bar.scrollWidth - bar.clientWidth;
        const l = bar.scrollLeft > 1, r = bar.scrollLeft < max - 1;
        tabShell.dataset.left = l; tabShell.dataset.right = r;
        arrL.hidden = !l; arrR.hidden = !r;
      }
      bar.addEventListener('scroll', edges, { passive: true });
      // The open tab sits in the middle of the row, so the previous and next
      // tabs are both in reach. How many fit is up to the screen. The first and
      // last tabs stop at the row's ends rather than leaving a gap.
      function pin(t) {
        const max = bar.scrollWidth - bar.clientWidth;
        const x = t.offsetLeft + t.offsetWidth / 2 - bar.clientWidth / 2;
        bar.scrollTo({ left: Math.max(0, Math.min(max, x)), behavior: reduced() ? 'auto' : 'smooth' });
      }
      const panels = {};
      const tabBtns = [];
      let current = 0;

      const ind = document.createElement('div');
      ind.className = 'set-tab-ind';

      function moveIndicator() {
        const t = tabBtns[current];
        if (!t || !t.offsetWidth) return; // hidden panel has no geometry yet
        ind.style.left = t.offsetLeft + 'px';
        ind.style.width = t.offsetWidth + 'px';
        edges();
      }

      function show(index) {
        if (index === current) return;
        const name = TABS[index][0];
        const dir = index > current ? 'slide-right' : 'slide-left';
        current = index;
        tabBtns.forEach((b, i) => {
          b.classList.toggle('active', i === index);
          b.setAttribute('aria-selected', i === index);
          b.tabIndex = i === index ? 0 : -1;
        });
        Object.keys(panels).forEach(n => {
          const p = panels[n];
          p.classList.remove('slide-right', 'slide-left');
          const on = n === name;
          p.classList.toggle('active', on);
          if (on) { void p.offsetWidth; p.classList.add(dir); } // restart the animation
        });
        moveIndicator();
        pin(tabBtns[index]);
      }

      TABS.forEach(([name, glyph], i) => {
        const t = document.createElement('button');
        t.type = 'button';
        t.className = 'set-tab' + (i === 0 ? ' active' : '');
        t.id = 'setTab' + name; t.setAttribute('role', 'tab');
        t.setAttribute('aria-controls', 'setPanel' + name);
        t.setAttribute('aria-selected', i === 0); t.tabIndex = i === 0 ? 0 : -1;
        t.innerHTML = svg(glyph).replace('width="17" height="17"', 'width="15" height="15" aria-hidden="true"') + name;
        t.onclick = () => show(i);
        bar.appendChild(t);
        tabBtns.push(t);
        const p = document.createElement('div');
        p.className = 'set-panel' + (i === 0 ? ' active' : '');
        p.dataset.panel = name;
        p.id = 'setPanel' + name; p.setAttribute('role', 'tabpanel');
        p.setAttribute('aria-labelledby', t.id);
        panels[name] = p;
      });
      // Arrow keys, Home and End move between tabs, and moving selects.
      bar.addEventListener('keydown', e => {
        const k = { ArrowRight: current + 1, ArrowLeft: current - 1, Home: 0, End: TABS.length - 1 }[e.key];
        if (k === undefined) return;
        e.preventDefault();
        const next = (k + TABS.length) % TABS.length;
        show(next);
        tabBtns[next].focus();
      });
      bar.appendChild(ind);
      header.after(tabShell);

      // Phones: swipe sideways on Settings to move between tabs. Fields keep
      // their own gestures (text selection, sliders).
      let swX = 0, swY = 0, swOn = false;
      // On the document, so the page background counts too, not just the cards.
      document.addEventListener('touchstart', e => {
        swOn = activeView === 'settings' && e.touches.length === 1 &&
          matchMedia('(max-width: 640px)').matches &&
          !e.target.closest('input, textarea, select, [contenteditable], nav, .overlay, .notif-panel, .wp-picker-overlay, .set-tabs-shell');
        if (swOn) { swX = e.touches[0].clientX; swY = e.touches[0].clientY; }
      }, { passive: true });
      document.addEventListener('touchend', e => {
        if (!swOn) return;
        swOn = false;
        const t = e.changedTouches[0], dx = t.clientX - swX, dy = t.clientY - swY;
        if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return; // mostly vertical: a scroll
        const next = current + (dx < 0 ? 1 : -1);
        if (next >= 0 && next < TABS.length) show(next);
      }, { passive: true });
      Object.keys(panels).forEach(n => wrap.appendChild(panels[n]));
      // Settings starts hidden, so the indicator is placed once the row has a
      // size, and again whenever that size changes.
      new ResizeObserver(moveIndicator).observe(bar);

      const prefs = sectionByName('Preferences');
      const account = sectionByName('Account');
      const about = sectionByName('About Developer');

      // Update card (desktop only, hidden on web) first, then Profile. Both are
      // .settings-card-merged, so picking "the first one" left Profile to fall
      // through to About.
      const updateCard = el('updateCard');
      if (updateCard) panels.General.appendChild(updateCard);
      const profile = el('profileCard')?.closest('.settings-card-merged');
      if (profile) panels.General.appendChild(profile);
      const basic = sectionByName('Basic');
      if (basic) panels.General.appendChild(basic);

      const moved = document.createElement('div');
      moved.className = 'settings-section';
      const movedGroup = document.createElement('div');
      movedGroup.className = 'settings-group';
      moved.appendChild(movedGroup);
      ['Appearance', '24-Hour Time', 'Time Zone'].forEach(name => {
        const row = rowByLabel(prefs, name);
        if (row) movedGroup.appendChild(row);
      });
      // No manual sync: changes already sync on their own. The button stays in
      // the DOM, hidden, because the sync status code still updates its icons.
      const syncBtn = el('syncBtn');
      if (syncBtn) syncBtn.style.display = 'none';
      const logoutRow = rowByLabel(account, 'Log Out');
      if (logoutRow) movedGroup.appendChild(logoutRow);
      // Profile stays its own card; the targets and the app rows become one.
      const basicGroup = basic && basic.querySelector('.settings-group');
      if (basicGroup && movedGroup.children.length) {
        // App Theme leads the card; the other app rows follow the targets.
        const themeRow = rowByLabel(moved, 'Appearance');
        if (themeRow) basicGroup.prepend(themeRow);
        while (movedGroup.firstChild) basicGroup.appendChild(movedGroup.firstChild);
        basic.querySelector('.settings-section-header')?.remove();
      } else if (movedGroup.children.length) {
        panels.General.appendChild(moved);
      }

      if (prefs) {
        const h = prefs.querySelector('.settings-section-header');
        if (h) h.textContent = 'Advanced';
        panels.Advanced.appendChild(prefs);
      }
      const notifs = sectionByName('Notifications');
      if (notifs) panels.Notifications.appendChild(notifs);
      const signin = sectionByName('Sign-In Methods');
      if (signin) panels.Security.appendChild(signin);
      if (account) panels.Security.appendChild(account);
      if (about) panels.About.appendChild(about);
      // Version / Report a Bug / Windows: straight under the tab (not inside the
      // old merged wrapper), so the tile styles give it 2px gaps like Account.
      const aboutTiles = el('aboutTiles');
      if (aboutTiles) panels.About.appendChild(aboutTiles);

      // Dividers and collapsing belonged to the single long scroll.
      wrap.querySelectorAll('.settings-section-divider').forEach(d => d.remove());
      wrap.querySelectorAll('.settings-section.collapsed, .settings-card.collapsed')
        .forEach(s => s.classList.remove('collapsed'));

      // Anything still sitting directly under the panel would render between the
      // tabs and the tab content: wrappers left hollow once their sections moved
      // out, and loose cards like the developer one.
      [...wrap.children].forEach(node => {
        if (node === header || node === tabShell || node.classList.contains('set-panel')) return;
        if (!node.querySelector('*') && !node.textContent.trim()) { node.remove(); return; }
        panels.About.appendChild(node);
      });

      // ── Developer Mode, shaped like the other tabs ────
      // Its header becomes the first tile, the Modals list becomes its own
      // titled group, and each info button's tip becomes the row's description.
      const dev = el('notifTestCard');
      const devGroup = dev && dev.querySelector('.settings-card-body > .settings-group');
      if (devGroup) {
        dev.classList.add('dev-tiles');
        devGroup.removeAttribute('style');
        const devHead = dev.querySelector('.settings-card-head');
        if (devHead) {
          devHead.querySelector('.section-label')?.classList.replace('section-label', 'form-label');
          devGroup.prepend(devHead);
        }
        dev.querySelectorAll('.info-icon-btn').forEach(btn => {
          const titleRow = btn.closest('div[style*="gap:5px"]');
          const name = titleRow && titleRow.firstElementChild;
          if (!name) return;
          name.className = 'form-label'; name.removeAttribute('style');
          const sub = document.createElement('div');
          sub.className = 'form-sub';
          sub.textContent = btn.dataset.tipDesc || '';
          btn.parentElement.replaceWith(sub);
          titleRow.removeAttribute('style');
        });
        const modals = [...devGroup.children].find(c => c.firstElementChild && c.firstElementChild.textContent.trim() === 'Modals');
        if (modals) {
          const title = modals.firstElementChild, rows = modals.lastElementChild;
          title.className = 'settings-section-header'; title.removeAttribute('style');
          rows.className = 'settings-group'; rows.removeAttribute('style');
          devGroup.after(title, rows);
          modals.remove();
        }

        // ── Developer Mode sections ──
        // The switch stays on its own; everything else sits in collapsible
        // groups: Testing, Alert Previews, Modals, Product Tour and Tips. Open
        // or closed is remembered on this device.
        const body = dev.querySelector('.settings-card-body');
        let openState = {};
        try { openState = JSON.parse(localStorage.getItem('wh_dev_sections') || '{}'); } catch {}
        const CHEV = '<svg class="dev-sec-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
        const section = (key, title, defaultOpen) => {
          const wrap = document.createElement('div');
          wrap.className = 'dev-sec';
          wrap.id = 'dev' + key + 'Section';
          const open = openState[key] ?? defaultOpen;
          if (!open) wrap.classList.add('closed');
          wrap.innerHTML = '<button type="button" class="dev-sec-head"><span class="dev-sec-title"></span>'
            + '<span class="dev-sec-count"></span>' + CHEV + '</button>'
            + '<div class="dev-sec-body"><div class="dev-sec-inner"><div class="settings-group"></div></div></div>';
          const head = wrap.querySelector('.dev-sec-head');
          head.querySelector('.dev-sec-title').textContent = title;
          head.setAttribute('aria-expanded', String(open));
          head.addEventListener('click', () => {
            const closed = wrap.classList.toggle('closed');
            head.setAttribute('aria-expanded', String(!closed));
            openState[key] = !closed;
            try { localStorage.setItem('wh_dev_sections', JSON.stringify(openState)); } catch {}
          });
          body.appendChild(wrap);
          return wrap.querySelector('.settings-group');
        };
        const child = test => [...devGroup.children].find(test);
        const has = sel => n => n.matches(sel) || !!n.querySelector(sel);
        const labelled = text => n => [...n.querySelectorAll('.form-label')].some(l => l.textContent.trim() === text);
        const move = (list, nodes) => nodes.filter(Boolean).forEach(n => list.appendChild(n));

        const testing = section('Testing', 'Testing', true);
        move(testing, [child(has('#devDatePickerBtn')), child(has('#devSamplePenalties')), el('devReplayRow'),
          child(has('[data-on-click="h9dee7dcd2e"]')), el('syncDiagWrap')]);
        const alerts = section('Alerts', 'Alert Previews', true);
        move(alerts, [child(labelled('Preview Alerts'))]);
        const modalsTitle = body.querySelector(':scope > .settings-section-header');
        const modalRows = modalsTitle?.nextElementSibling;
        const modalsList = section('Modals', 'Modals', false);
        const tourList = section('Tour', 'Product Tour and Tips', true);
        move(section('Build', 'Build', true), [el('devBuildRow')]);
        if (modalRows) {
          move(tourList, [el('devTourRow'), el('devResetTipsRow')]);
          move(modalsList, [...modalRows.children]);
          modalRows.remove(); modalsTitle.remove();
        }
        // The Modals header says how many it hides while closed.
        const mc = el('devModalsSection');
        if (mc) mc.querySelector('.dev-sec-count').textContent = String(modalsList.children.length);
      }

      // ── Tiles ─────────────────────────────────────────
      Object.values(panels).forEach(p => p.querySelectorAll('.settings-group').forEach(g => {
        g.classList.add('tile-list');
        g.closest('.settings-section')?.classList.add('tile-host');
      }));

      // ── Search ────────────────────────────────────────
      // Built from the rows themselves, so renamed or desktop-only settings are
      // found without a separate list. Old names stay searchable as keywords.
      const KEYWORDS = {
        'Appearance': 'theme dark light mode', 'Work Hours': 'daily weekly target hours',
        'Shift Hours': 'shift start end', '24-Hour Time': 'clock format', 'Time Zone': 'timezone',
        'Log Out': 'sign out logout', 'Work Saturdays': 'saturday weekend include',
        'Breaks': 'pause break time', 'Smart Timings': 'recommend timings', 'Quick Start': 'shortcut keyboard',
        'Short Days': 'leave early', 'Long Days': 'stay late', 'Notifications': 'alerts push allow',
        'Target Reached': 'daily target alert', 'Wrap-Up Reminder': 'kickstart', 'Overtime Alert': 'overtime',
        'Saved Logins': 'devices manage sessions','Backup & Restore': 'import export manage data', 'Delete Account': 'remove',
        'Open at Login': 'autostart startup windows', 'When 5pm Opens': 'start app start session startup'
      };
      const TAB_INDEX = Object.fromEntries(TABS.map(([n], i) => [n, i]));
      const entries = [];
      Object.entries(panels).forEach(([tab, p]) => p.querySelectorAll('.form-label').forEach(l => {
        if (l.closest('#notifTestCard')) return; // developer tools stay hidden
        const label = l.textContent.trim();
        if (!label) return;
        const row = l.closest('.tile-sub > div, .tile-list > div, #notifSubGroup > div > div, .settings-card-merged') || l;
        const sub = l.parentElement.querySelector('.form-sub')?.textContent.trim() || '';
        entries.push({ label, sub, tab, row, hay: (label + ' ' + sub + ' ' + (KEYWORDS[label] || '')).toLowerCase() });
      }));

      const box = document.createElement('div');
      box.className = 'set-search';
      box.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>' +
        '<input type="search" placeholder="Search settings" aria-label="Search settings" autocomplete="off">' +
        '<div class="set-results" role="listbox"></div>';
      tabShell.before(box);
      const q = box.querySelector('input'), list = box.querySelector('.set-results');
      let hits = [], cur = 0;

      function paint() {
        list.innerHTML = hits.length ? '' : '<div class="set-empty">No settings match.</div>';
        hits.forEach((h, i) => {
          const b = document.createElement('button');
          b.type = 'button'; b.className = 'set-result' + (i === cur ? ' on' : '');
          b.innerHTML = '<div class="set-result-title"></div><div class="set-result-meta"></div>';
          b.firstChild.textContent = h.label;
          b.lastChild.textContent = h.tab + (h.sub ? ' · ' + h.sub : '');
          b.onmousedown = e => { e.preventDefault(); go(h); };
          list.appendChild(b);
        });
        list.classList.add('open');
      }
      function close() { list.classList.remove('open'); }
      function go(h) {
        q.value = ''; close(); q.blur();
        show(TAB_INDEX[h.tab]);
        // A row inside a collapsed group (alerts off, Smart Timings off) has no
        // height; point at the switch that opens it instead.
        let target = h.row;
        if (!target.offsetHeight) target = target.closest('.tile-list > div') || target;
        if (!target.offsetHeight && target.closest('#recommendTimingsBlock')) target = rowByLabel(prefs, 'Smart Timings') || target;
        setTimeout(() => {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          target.classList.remove('set-hit'); void target.offsetWidth; target.classList.add('set-hit');
        }, 260); // after the tab's slide-in
      }
      q.addEventListener('input', () => {
        const words = q.value.toLowerCase().split(/\s+/).filter(Boolean);
        if (!words.length) { close(); return; }
        hits = entries.filter(e => words.every(w => e.hay.includes(w))).slice(0, 8);
        cur = 0; paint();
      });
      q.addEventListener('keydown', e => {
        if (e.key === 'Escape') { q.value = ''; close(); q.blur(); return; }
        if (!list.classList.contains('open') || !hits.length) return;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          cur = (cur + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length; paint();
        } else if (e.key === 'Enter') { e.preventDefault(); go(hits[cur]); }
      });
      q.addEventListener('blur', () => setTimeout(close, 120));
    })();

    // The desktop app's Add Passkey opens the web app here, on Settings › Passkeys.
    if (location.hash === '#passkeys') {
      history.replaceState(null, '', location.pathname + location.search);
      const s = el('hdrSettings');
      if (s) s.click(); else switchTab('settings');
      openPasskeysPage();
    }

  
