// Product Tour (first-time users) and one-time tips, built on Driver.js
// (lib/driver.js, MIT). Style A: the page dims, the card is cut out and a
// popover points at it. Sizes follow 5pm's popover standards (index.html,
// ".fivepm-pop").
//
// Once per account: the flags live in the synced settings, cfg().tourDone and
// cfg().tipsSeen, so a new device doesn't replay them. The tour starts by
// itself only after onboarding (index-app.js obFinish), so existing users are
// never interrupted; anyone can replay it from Settings › About.
(function () {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const touch = () => matchMedia('(pointer: coarse)').matches;
  const make = opts => window.driver?.js?.driver?.(opts);

  // A step points at one control or one piece of information, never a whole
  // card. A step whose control isn't on screen (a weekend has no Quick Start,
  // no timer, no day type) is left out, and "1 of N" counts what's left.
  function shown(sels) {
    for (const sel of [].concat(sels)) {
      const n = document.querySelector(sel), r = n?.getBoundingClientRect();
      if (r && r.width && r.height) return n;
    }
    return null;
  }
  // The button reads "Quick Start" or "Start" depending on the day; use its own words.
  const startLabel = () => el('calcBtn')?.textContent.trim() || 'Start';

  const STEPS = [
    { el: '#calcBtn', title: 'Start Your Day',
      text: v => `${v} ${startLabel()} when you begin work. 5pm keeps time from there.` },
    // Only when there's no Quick Start today (a weekend or a day off).
    { el: '#daySelectorRow', onlyWithout: '#calcBtn', title: 'Pick a Day',
      text: v => `${v} a day to see its hours, or plan one ahead.` },
    // Before you start: the "leave by" line. Once started: hours and target.
    { el: ['#rcKpiGroup', '#rcEmptyState .rc-empty-text'], title: 'Know When to Leave',
      text: () => "See the hours you've worked and the time you can head out." },
    { el: '#rcInfoBtn', title: 'Set the Day',
      text: () => 'Half day or on leave? Change it here so your targets stay right.' },
    { el: '#wkRows > :first-child', title: 'Track Your Week',
      text: v => `Your week fills in as you work. ${v} a day to fix its times or raise a dispute.` },
  ];

  const busy = () => document.body.classList.contains('driver-active')
    || document.querySelector('.overlay.open, .email-modal-overlay.open, .td-panel.open, .ios-install-sheet.open')
    || el('obOverlay')?.style.display === 'flex';

  function markTourDone() { if (!cfg().tourDone) saveCfg({ ...cfg(), tourDone: true }); }

  // While the tour is open the person can't scroll the page (wheel, touch or
  // keys); the tour scrolls each card to the middle itself. The scrollbar
  // stays, so the page doesn't shift sideways. Esc, Skip, Done or a tap
  // outside end the tour and give scrolling back.
  const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);
  const stopScroll = e => { if (e.cancelable) e.preventDefault(); };
  const stopKeys = e => {
    if (SCROLL_KEYS.has(e.key) && !e.target.closest?.('input, textarea, select, button, [contenteditable]')) e.preventDefault();
  };
  function lockScroll(on) {
    const fn = on ? 'addEventListener' : 'removeEventListener';
    window[fn]('wheel', stopScroll, { passive: false, capture: true });
    window[fn]('touchmove', stopScroll, { passive: false, capture: true });
    window[fn]('keydown', stopKeys, { capture: true });
  }

  // Settings or another tab: go Home first and wait for its slide-in, so the
  // cards have a size when each step looks for them (otherwise every step
  // found nothing and the popovers sat in the middle of the screen).
  function start() {
    if (document.body.classList.contains('driver-active')) return;
    if (typeof activeView !== 'undefined' && activeView !== 'home') {
      switchTab('home');
      setTimeout(run, 350);
    } else run();
  }

  // Each step's control is scrolled into view first (to the middle), and only
  // then highlighted, so the popover is placed against where the control ends
  // up (Driver.js placed it before its own smooth scroll finished, which left
  // the popover behind). The popover also follows any later movement.
  const settle = () => new Promise(res => {
    let done = false; const end = () => { if (!done) { done = true; res(); } };
    window.addEventListener('scrollend', end, { once: true });
    setTimeout(end, 600);                   // no scroll needed, or no scrollend
  });
  async function bringIntoView(node) {
    if (!node) return;
    const r = node.getBoundingClientRect();
    if (r.top >= 0 && r.bottom <= window.innerHeight) return;   // already on screen
    node.scrollIntoView({ block: 'center', behavior: reduce.matches ? 'auto' : 'smooth' });
    if (!reduce.matches) await settle();
  }

  // ── The day the tour shows ──
  // 5pm is about workdays. On a day off (a weekend, or a holiday or leave
  // logged for today) the tour quietly shows the next workday instead, the
  // same way Developer Mode's test date does, and puts today back after.
  const dayOff = key => isWeekendKey(key) || ['holiday', 'leave'].includes(dayLog(key)?.override);
  function nextWorkday() {
    const d = nowTz();
    for (let i = 1; i <= 14; i++) {
      d.setDate(d.getDate() + 1);
      if (!dayOff(dateKey(d))) return new Date(d);
    }
    return null;
  }
  const dayWord = d => {
    const t = nowTz(); t.setHours(0, 0, 0, 0);
    const x = new Date(d); x.setHours(0, 0, 0, 0);
    return Math.round((x - t) / 86400000) === 1 ? 'tomorrow' : FULL_DAYS_EN[x.getDay()];
  };
  const shiftStart = () => { const s = cfg().shiftStart; const d = s && parse(s); return d || null; };

  // The last step depends on where the person's shift is:
  //  - not begun (a day off, or before the start time): explore Settings until then;
  //  - begun and the timer isn't running: start now;
  //  - timer running: nothing more to say.
  function closingStep(previewWhen, verb) {
    const start = shiftStart(), at = start ? ` at ${short(start)}` : '';
    const settings = shown(['#hdrSettings', '#tabSettings', '#mobTabSettings']);
    if (previewWhen) {
      return settings && { element: settings, popover: { title: 'Until Your Shift',
        description: `Your shift starts ${previewWhen}${at}. Until then, explore Settings to make 5pm yours.` } };
    }
    if (loginDate) return null;
    if (start && new Date() < start) {
      return settings && { element: settings, popover: { title: 'Until Your Shift',
        description: `Your shift starts today${at}. Until then, explore Settings to make 5pm yours.` } };
    }
    const btn = shown('#calcBtn');
    return btn && { element: btn, popover: { title: 'Your Shift Has Begun',
      description: `${verb} ${startLabel()} to begin tracking today.` } };
  }

  async function run() {
    const verb = touch() ? 'Tap' : 'Click';
    // Day off: preview the next workday.
    const realOverride = _devDateOverride;
    let preview = null, when = '';
    if (dayOff(todayKey())) {
      preview = nextWorkday();
      if (preview) {
        when = dayWord(preview);   // before the date changes: tomorrow, or a weekday
        // "Leave by" as it will read that morning: from the shift start, not the current clock.
        const s = shiftStart(); if (s) { s.setSeconds(0, 0); _previewStartAt = s; }
        _devDateOverride = dateKey(preview);
        _applyDevDateOverride();
        await new Promise(r => setTimeout(r, 250));
      }
    }
    const restoreDay = () => {
      if (!preview) return;
      _previewStartAt = null;
      _devDateOverride = realOverride;
      _applyDevDateOverride();
    };

    const steps = STEPS
      .filter(s => !(s.onlyWithout && shown(s.onlyWithout)))
      .map(s => ({ node: shown(s.el), s }))
      .filter(x => x.node)
      .map(({ node, s }) => ({ element: node, popover: { title: s.title, description: s.text(verb) } }));
    if (preview && steps[0]) {
      steps[0].popover.description = `Here's how ${when} will look. ` + steps[0].popover.description;
    }
    const last = closingStep(when, verb);
    if (last) steps.push(last);
    if (!steps.length) { restoreDay(); return; }

    let tour, moving = false;
    // Scroll, then show step `to`. `moving` stays on until Driver.js has
    // finished highlighting it: a refresh in the middle of its transition
    // left the popover behind with the old step's text.
    const go = async to => {
      if (moving) return; moving = true;
      await bringIntoView(steps[to].element);
      tour.moveTo(to);
    };
    const follow = () => { if (!moving) requestAnimationFrame(() => !moving && tour?.isActive() && tour.refresh()); };
    tour = make({
      steps,
      popoverClass: 'fivepm-pop',
      showProgress: steps.length > 1, progressText: '{{current}} of {{total}}',
      showButtons: ['next', 'previous'], nextBtnText: 'Next', prevBtnText: 'Back', doneBtnText: 'Done',
      // 50% dims a light page clearly; a dark page needs 65% to read as dimmed.
      overlayColor: '#000', overlayOpacity: dark ? 0.65 : 0.5,
      stagePadding: 6, stageRadius: 10, popoverOffset: 8,
      smoothScroll: false, animate: !reduce.matches,
      allowClose: true, disableActiveInteraction: true,
      onHighlighted: () => { moving = false; },
      onNextClick: () => {
        const i = tour.getActiveIndex();
        if (i >= steps.length - 1) tour.destroy(); else go(i + 1);
      },
      onPrevClick: () => { const i = tour.getActiveIndex(); if (i > 0) go(i - 1); },
      // Layout: title with "2 of 4" on its right; Skip on the far left of the
      // footer; Back and Next (Done on the last step) on the right. No Back on
      // the first step, no Skip on the last.
      onPopoverRender: popover => {
        const head = document.createElement('div');
        head.className = 'fivepm-pop-head';
        popover.title.before(head);
        head.append(popover.title);
        if (popover.progress && steps.length > 1) head.append(popover.progress);
        if (tour.isFirstStep()) popover.previousButton.remove();
        if (!tour.isLastStep()) {
          const skip = document.createElement('button');
          skip.type = 'button'; skip.className = 'fivepm-pop-skip'; skip.textContent = 'Skip';
          skip.addEventListener('click', () => tour.destroy());
          popover.footer.prepend(skip);
        }
      },
      onDestroyed: () => {
        lockScroll(false); window.removeEventListener('scroll', follow);
        restoreDay(); markTourDone();
      },
    });
    if (!tour) { restoreDay(); return; }
    lockScroll(true);
    window.addEventListener('scroll', follow, { passive: true });
    await bringIntoView(steps[0].element);
    tour.drive();
  }

  // After onboarding: once per account, and never on top of another modal.
  function afterOnboarding() {
    if (cfg().tourDone) return;
    setTimeout(() => { if (!busy()) start(); }, 500);
  }

  // ── Tips ───────────────────────────────────────────────────────────────
  // Apple TipKit-style inline tips: a small card inside the feature's own
  // card, shown until it's closed or the feature is used. Rules:
  //  - one tip on screen at a time (the first eligible one, in this order);
  //  - at most one NEW tip a day (a tip already met on an earlier day can come back);
  //  - page tips never appear during the tour or while a modal is open;
  //  - each tip waits for its trigger, and using the feature retires it;
  //  - all of it is synced per account (cfg().tipsSeen / tipsIntroduced / tipIntro).
  const seen = id => (cfg().tipsSeen || []).includes(id);
  function markSeen(id) { if (!seen(id)) saveCfg({ ...cfg(), tipsSeen: [...(cfg().tipsSeen || []), id] }); }

  const BULB = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>';
  const CLOSE = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

  // Per-device counters for the "3rd time" style triggers.
  const count = k => { try { return +localStorage.getItem('wh_tipc_' + k) || 0; } catch { return 0; } };
  const bump = k => { try { localStorage.setItem('wh_tipc_' + k, count(k) + 1); } catch {} };

  const shortcutLabel = () => {
    const sc = cfg().qsShortcut;
    if (!sc || !sc.key) return null;
    const mod = sc.mod === 'cmd' ? 'Cmd' : sc.mod === 'alt' ? 'Alt' : 'Ctrl';
    return [mod, sc.shift && 'Shift', sc.key.length === 1 ? sc.key.toUpperCase() : sc.key].filter(Boolean).join('+');
  };
  const daysLogged = () => Object.values(Store.allDays()).filter(d => d?.hoursWorked > 0).length;
  const emailOpen = () => el('emailModalOverlay')?.classList.contains('open');
  const emailType = () => typeof _emailP !== 'undefined' ? _emailP?.type : null;

  // Where each tip goes, when it shows, and its words. `place(tip)` puts the
  // card in its spot; `when()` is the trigger; `modal` tips live in a sheet.
  const TIPS = [
    { id: 'penalties', name: 'Short on Hours?', where: 'Home › Your Penalties',
      title: () => 'Short on Hours?',
      text: v => `${v} a penalty to draft an email to your manager.`,
      when: () => !!el('penaltiesList')?.querySelector('.penalty-row'),
      place: t => el('penaltiesList')?.before(t) },
    { id: 'missedDay', name: 'Missed a Day?', where: 'Home › This Week',
      title: () => 'Missed a Day?',
      text: v => `${v} a day to add the hours you worked.`,
      when: () => !!document.querySelector('#wkRows .wk-row.is-missing'),
      place: t => el('wkRows')?.before(t) },
    { id: 'startFaster', name: 'Start Faster', where: 'Home › today, under Start', desktopOnly: true,
      title: () => 'Start Faster',
      text: () => shortcutLabel() ? `Press ${shortcutLabel()} anywhere in 5pm to start your day.`
        : 'Set a keyboard shortcut in Settings to start your day from anywhere in 5pm.',
      when: () => !touch() && !!shortcutLabel() && count('mouseStarts') >= 3 && !!shown('#shiftInputRow'),
      place: t => el('shiftInputRow')?.after(t) },
    { id: 'notifications', name: 'Never Miss 5pm', where: 'Settings › Notifications',
      title: () => 'Never Miss 5pm',
      text: () => "Turn on notifications to hear when it's time to head out.",
      when: () => !cfg().notifOn && daysLogged() >= 2,
      place: t => { t.classList.add('is-panel'); el('setPanelNotifications')?.prepend(t); } },
    { id: 'saveRecipient', name: 'Save Recipient', where: 'Email Draft sheet', modal: true,
      title: () => 'Save Recipient',
      text: () => 'Customise once and the address is filled in every time.',
      when: () => emailOpen() && ['daily', 'weekly'].includes(emailType()) && !el('emailTo')?.value.trim()
        && count('drafts') >= 2,
      place: t => document.querySelector('#emailPreviewPane .email-actions')?.before(t) },
  ];
  const tipById = id => TIPS.find(t => t.id === id);
  const verb = () => touch() ? 'Tap' : 'Click';

  function card(tip, onClose) {
    const n = document.createElement('div');
    n.className = 'fivepm-inline-tip'; n.setAttribute('role', 'note'); n.dataset.tip = tip.id;
    n.innerHTML = `<span class="fivepm-tip-icon">${BULB}</span>
      <div class="fivepm-inline-tip-text"><div class="fivepm-inline-tip-title"></div><div class="fivepm-inline-tip-body"></div></div>
      <button type="button" class="fivepm-inline-tip-close" aria-label="Close tip">${CLOSE}</button>`;
    n.querySelector('.fivepm-inline-tip-title').textContent = tip.title();
    n.querySelector('.fivepm-inline-tip-body').textContent = tip.text(verb());
    n.querySelector('button').addEventListener('click', () => { n.remove(); onClose(); });
    return n;
  }
  const onScreen = () => document.querySelector('.fivepm-inline-tip');

  let previewing = false;
  function evaluate() {
    if (previewing || document.body.classList.contains('driver-active')) return;
    const current = onScreen();
    const today = todayKey(), c = cfg();
    const pageBlocked = busy();
    // The tip to show: first eligible one that the daily rule allows.
    const pick = TIPS.find(t => {
      if (seen(t.id) || !t.when()) return false;
      if (!t.modal && pageBlocked && current?.dataset.tip !== t.id) return false;
      const met = (c.tipsIntroduced || []).includes(t.id);
      return met || !(c.tipIntro?.day === today && c.tipIntro?.id !== t.id);
    });
    if (current && current.dataset.tip !== pick?.id) current.remove();
    if (!pick || onScreen()) return;
    pick.place(card(pick, () => markSeen(pick.id)));
    if (!(c.tipsIntroduced || []).includes(pick.id)) {
      saveCfg({ ...cfg(), tipsIntroduced: [...(cfg().tipsIntroduced || []), pick.id], tipIntro: { day: today, id: pick.id } });
    }
  }

  // Using a feature retires its tip.
  function watchUse() {
    document.addEventListener('click', e => {
      if (previewing) return;              // a Developer Mode preview isn't real use
      const t = e.target;
      if (t.closest?.('#penaltiesList .penalty-row') && !t.closest('.penalty-discard-btn')) markSeen('penalties');
      const row = t.closest?.('#wkRows .wk-row');
      if (row && row.classList.contains('is-missing')) markSeen('missedDay');
      // A real mouse click on Start (not the shortcut, which clicks it for you).
      if (t.closest?.('#calcBtn') && e.detail > 0 && el('calcBtn').dataset.state === 'start' && !touch()) bump('mouseStarts');
      if (t.closest?.('#emailEditSave')) markSeen('saveRecipient');
      setTimeout(evaluate, 300);
    }, true);
    document.addEventListener('keydown', e => {
      const sc = cfg().qsShortcut;
      if (!sc?.key || e.key.toLowerCase() !== sc.key.toLowerCase()) return;
      const mod = sc.mod || 'ctrl';
      const ok = mod === 'alt' ? e.altKey : (e.ctrlKey || e.metaKey);
      if (ok && (!sc.shift || e.shiftKey)) markSeen('startFaster');
    }, true);
    // Each time an email draft opens (not a bug report), for "the 2nd draft".
    const ov = el('emailModalOverlay');
    if (ov) new MutationObserver(() => {
      const open = ov.classList.contains('open');
      if (open && !ov._tipWasOpen && !previewing && ['daily', 'weekly'].includes(emailType())) bump('drafts');
      ov._tipWasOpen = open;
      setTimeout(evaluate, 350);
    }).observe(ov, { attributes: true, attributeFilter: ['class'] });
    // Notifications switched on: that tip is done.
    setInterval(() => { if (cfg().notifOn && !seen('notifications')) markSeen('notifications'); evaluate(); }, 1500);
  }

  // ── Developer Mode: preview any tip in its place ──
  // Shows the tip now, ignoring its trigger and the rules, without marking it
  // seen. Closing it brings you back to Developer Mode.
  function openSettingsTab(name) {
    switchTab('settings');
    return new Promise(res => setTimeout(() => {
      [...document.querySelectorAll('#viewSettings .set-tab')].find(b => b.textContent.trim() === name)?.click();
      setTimeout(res, 300);
    }, 300));
  }
  async function backToDev() {
    await openSettingsTab('About');
    el('devTourSection')?.scrollIntoView({ block: 'center', behavior: reduce.matches ? 'auto' : 'smooth' });
  }
  async function previewTip(id) {
    const tip = tipById(id);
    if (!tip || previewing) return;
    previewing = true;
    onScreen()?.remove();
    let restore = () => {};
    if (id === 'notifications') {
      await openSettingsTab('Notifications');
    } else if (id === 'saveRecipient') {
      switchTab('home');
      await new Promise(r => setTimeout(r, 350));
      if (!el('penaltiesList')?.querySelector('.penalty-row') && el('devSamplePenalties') && !el('devSamplePenalties').checked) {
        el('devSamplePenalties').click();
        await new Promise(r => setTimeout(r, 300));
      }
      el('penaltiesList')?.querySelector('.penalty-row')?.click();
      await new Promise(r => setTimeout(r, 450));
      restore = () => { if (emailOpen()) closeEmailModal(); };
    } else {
      switchTab('home');
      await new Promise(r => setTimeout(r, 350));
      // Start Faster lives under Start, which a day off doesn't have.
      if (id === 'startFaster' && dayOff(todayKey())) {
        const real = _devDateOverride, day = nextWorkday();
        if (day) {
          _devDateOverride = dateKey(day); _applyDevDateOverride();
          await new Promise(r => setTimeout(r, 250));
          restore = () => { _devDateOverride = real; _applyDevDateOverride(); };
        }
      }
    }
    const n = card(tip, () => { previewing = false; restore(); backToDev(); });
    n.classList.add('is-preview');
    tip.place(n);
    if (!n.isConnected) { previewing = false; restore(); return; }
    n.scrollIntoView({ block: 'center', behavior: reduce.matches ? 'auto' : 'smooth' });
  }

  // One row per tip in Developer Mode › Product Tour and Tips.
  let devRowsDone = false;
  function devRows() {
    const reset = el('devResetTipsRow');
    if (!reset || devRowsDone) return;
    devRowsDone = true;
    TIPS.forEach(t => {
      const row = document.createElement('div');
      row.className = 'dev-tip-row';
      row.innerHTML = `<div style="min-width:0"><div class="form-label"></div><div class="form-sub"></div></div>
        <button type="button" class="btn-secondary" style="flex-shrink:0;font-size:12px;height:32px;padding:0 10px">Preview</button>`;
      row.querySelector('.form-label').textContent = t.name;
      row.querySelector('.form-sub').textContent = t.where + (t.desktopOnly ? ' (desktop)' : '');
      row.querySelector('button').addEventListener('click', () => previewTip(t.id));
      reset.before(row);
    });
    el('devResetTips')?.addEventListener('click', () => {
      saveCfg({ ...cfg(), tipsSeen: [], tipsIntroduced: [], tipIntro: null });
      ['mouseStarts', 'drafts'].forEach(k => { try { localStorage.removeItem('wh_tipc_' + k); } catch {} });
      showToast?.('Tips reset. Each shows again when its moment comes.', 'none');
    });
  }

  window.Tour = { start, afterOnboarding, previewTip };
  document.addEventListener('DOMContentLoaded', () => {
    el('tourBtn')?.addEventListener('click', start);
    el('devPreviewTour')?.addEventListener('click', start);
    devRows();
    watchUse();
    setTimeout(evaluate, 1500);
  });
})();
