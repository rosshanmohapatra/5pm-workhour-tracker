/**
 * login.js — 5pm sign-in page (#8, approved 2026-11-15)
 *
 * One card whose steps morph into each other (uiarc login-centered + Button,
 * Input, PasswordField, OtpInput, Alert). Screens: Sign in, two-step code,
 * backup code, can't use two-step, create account, confirm email, reset
 * password by 6-digit email code, new password, "no 5pm account for this
 * Google account", and You're in.
 *
 * Kept for the Windows app (desktop branch): GOOGLE_PICKER, handleOAuth(provider,
 * evt), window.showAuthError(msg) and the window.__desktopStartPasskey hook.
 */

// ── 1. Supabase client ────────────────────────────────────────────────────────
// Credentials come from lib/config.js. Named _sb so it never clashes with a
// global `supabase` from an old cached page.
const _sb = window.supabase.createClient(
  window.__SB_URL,
  window.__SB_ANON_KEY,
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true,
            experimental: { passkey: true } } }
);

// ── 2. Theme: the saved 5pm theme, else the device. No toggle on this page. ──
function applyTheme() {
  let saved = null; try { saved = localStorage.getItem('wh_theme'); } catch (_) {}
  const dark = saved === 'dark' || ((!saved || saved === 'auto') && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.classList.toggle('dark', dark);
  const fav = document.getElementById('favicon');
  if (fav) fav.href = dark ? '/icons/favicon-dark.svg' : '/icons/favicon-light.svg';
}
applyTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);

// ── 3. Building blocks (from the approved design page) ───────────────────────
const ic = {
  g: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.6 12.2c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2.1-1.9 3.3-4.8 3.3-8z"/><path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.7c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.8A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.8 14.2a6.6 6.6 0 0 1 0-4.3V7.1H2.1a11 11 0 0 0 0 9.9z"/><path fill="#EA4335" d="M12 5.4c1.6 0 3 .6 4.2 1.6l3.1-3.1A11 11 0 0 0 2.1 7.1l3.7 2.8C6.7 7.3 9.1 5.4 12 5.4z"/></svg>',
  gh: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 1a11 11 0 0 0-3.5 21.4c.6.1.8-.2.8-.5v-2c-3.1.7-3.8-1.3-3.8-1.3-.5-1.3-1.2-1.6-1.2-1.6-1-.7.1-.7.1-.7 1.1.1 1.7 1.1 1.7 1.1 1 1.7 2.6 1.2 3.2.9.1-.7.4-1.2.7-1.5-2.5-.3-5.1-1.2-5.1-5.4 0-1.2.4-2.2 1.1-3-.1-.3-.5-1.4.1-2.9 0 0 .9-.3 3 1.1a10.4 10.4 0 0 1 5.5 0c2.1-1.4 3-1.1 3-1.1.6 1.5.2 2.6.1 2.9.7.8 1.1 1.8 1.1 3 0 4.2-2.6 5.1-5.1 5.4.4.3.8 1 .8 2v3c0 .3.2.6.8.5A11 11 0 0 0 12 1z"/></svg>',
};
const L = (d, w = 1.75) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const I = {
  pk: L('<path d="M2 12C2 6.5 6.5 2 12 2a10 10 0 0 1 8 4"/><path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2"/><path d="M17.29 21.02c.12-.6.43-2.3.5-3.02"/><path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4"/><path d="M8.65 22c.21-.66.45-1.32.57-2"/><path d="M14 13.12c0 2.38 0 6.38-1 8.88"/><path d="M2 16h.01"/><path d="M21.8 16c.2-2 .131-5.354 0-6"/><path d="M9 6.8a6 6 0 0 1 9 5.2c0 .47 0 1.17-.02 2"/>'),
  mail: L('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>'),
  back: L('<path d="m15 18-6-6 6-6"/>'),
  eye: L('<path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: L('<path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><path d="M14.08 14.16a3 3 0 1 1-4.24-4.24"/><path d="m2 2 20 20"/>'),
  info: L('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>'),
  warn: L('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>'),
  clock: L('<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>'),
  wifi: L('<path d="M12 20h.01M8.5 16.43a5 5 0 0 1 7 0M2 8.82a15 15 0 0 1 4.18-2.65M19 12.86a10 10 0 0 0-2.01-1.48M22 8.82a15 15 0 0 0-11.29-3.76M5 12.86a10 10 0 0 1 5.17-2.69M2 2l20 20"/>'),
  out: L('<path d="m16 17 5-5-5-5M21 12H9M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>'),
};
const big = {
  ok: '<svg class="icon48 ok" viewBox="0 0 48 48" aria-hidden="true"><g transform="rotate(-90 24 24)"><circle class="draw" cx="24" cy="24" r="22.25" fill="none" stroke="currentColor" stroke-width="1.5"/></g><path class="draw" d="M15.5 24.5l5.5 5.5 11.5-12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  ring: inner => `<svg class="icon48" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="22.25" fill="none" stroke="var(--border)" stroke-width="1.5"/><g transform="translate(14 14) scale(.8333)" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${inner}</g></svg>`,
};
// Text that came from a person or a server is escaped before it goes into HTML.
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Page state: the last sign-in method on this device, the email being used, etc.
const S = { last: null, provider: 'Google', email: '', pkOn: false, pkAuto: false, pendingPw: null, signupName: '' };
try { S.last = localStorage.getItem('5pm_login_last'); } catch (_) {}

const tagHtml = '<span class="tag">Last used</span>';
const btn = (cls, label, attrs = '') => `<button type="button" class="btn ${cls}" ${attrs}><span class="lbl">${label}</span><span class="spin" aria-hidden="true"></span></button>`;
const providers = (withTag = true) => `<div class="actions">
  ${btn('secondary provider', `${ic.g}Continue with Google`, 'data-act="oauth-google" id="google-btn"').replace('</button>', withTag && S.last === 'google' ? tagHtml + '</button>' : '</button>')}
  ${btn('secondary provider', `${ic.gh}Continue with GitHub`, 'data-act="oauth-github" id="github-btn"').replace('</button>', withTag && S.last === 'github' ? tagHtml + '</button>' : '</button>')}</div>`;
const heading = (h, p) => `<div class="heading"><h2>${h}</h2>${p ? `<p>${p}</p>` : ''}</div>`;
const alslot = '<div class="alslot" data-al><div></div></div>';
const backBtn = to => `<div class="top"><button type="button" class="back" data-go="${to}">${I.back}Back</button></div>`;
const field = (id, label, opts = {}) => `<div class="field">
  <div class="labelRow"><label class="label" for="${id}">${label}</label>${opts.right || ''}</div>
  ${opts.pw ? `<div class="shell" data-shell="${id}"><input id="${id}" name="${opts.name || id}" type="password" autocomplete="${opts.ac || 'current-password'}" placeholder="${opts.ph || ''}"><button type="button" class="eye" data-eye="${id}" aria-label="Show password" aria-pressed="false">${I.eye}</button></div>`
    : `<div class="fieldWrap"><input class="input${opts.mono ? ' mono' : ''}" id="${id}" name="${opts.name || id}" type="${opts.type || 'text'}" autocomplete="${opts.ac || 'off'}" placeholder="${opts.ph || ''}" value="${esc(opts.value || '')}" ${opts.attrs || ''}>${opts.tag ? tagHtml : ''}</div>`}
  <div class="slot${opts.hint ? ' open' : ''}" data-msg="${id}"${opts.rule ? ' data-rule' : ''}><div><span class="msg">${opts.hint ? `<span>${opts.hint}</span>` : ''}</span></div></div></div>`;
const RULE = '<span class="rule"><svg viewBox="0 0 16 16" aria-hidden="true"><circle class="rc" cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.5"/><path class="rk" d="M5.2 8.3l1.9 1.9 3.8-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg><span class="rt">At least 8 characters</span></span>';
const otp = () => `<div class="field"><label class="label" style="margin-bottom:var(--space-2)">Code</label><div class="otp" data-otp>${[0, 1, 2, 3, 4, 5].map(i => `<div class="cell"><input inputmode="numeric" maxlength="1" aria-label="Digit ${i + 1}" ${i === 0 ? 'autocomplete="one-time-code"' : ''}><span class="glyph"></span></div>`).join('')}<span class="ring"></span></div><div class="slot" data-msg="otp"><div><span class="msg"></span></div></div></div>`;
const pkButton = () => S.pkOn && !S.pkAuto ? `<button type="button" class="textButton" data-act="passkey" id="passkey-btn">${I.pk}Sign in with a passkey</button>` : '';
const toSignin = 'New to 5pm? <button type="button" class="inlineButton" data-go="signup">Create an account</button>';

// ── 4. Screens ────────────────────────────────────────────────────────────────
const SCREENS = {
  signin: { h: () => heading('Sign in to 5pm', 'Welcome back.') + alslot + providers() + '<div class="divider">or</div>' +
    `<form class="form" data-form="signin" novalidate>${field('em', 'Email', { type: 'email', ac: 'username webauthn', name: 'email', value: S.email, ph: 'name@company.com', tag: S.last === 'email' })}${field('pw', 'Password', { pw: true, name: 'password', right: '<button type="button" class="inlineButton" data-go="reset">Forgot password?</button>' })}
     ${btn('primary lg', 'Sign In', 'data-act="signin" id="submitBtn"')}</form>` + pkButton(),
    below: toSignin },
  twostep: { h: () => backBtn('signout') + heading('Enter your code', 'Open your authenticator app and enter the 6-digit code for 5pm.') + `<div class="form">${otp()}${btn('primary lg', 'Verify', 'data-act="verify2fa"')}</div><button type="button" class="textButton" data-go="backup">Use a backup code</button>` },
  backup: { h: () => backBtn('twostep') + heading('Enter a backup code', 'Use one of the codes you saved when you turned on two-step. Each code works once.') + `<div class="form">${field('bk', 'Backup code', { mono: true, ph: 'xxxx-xxxx', attrs: 'maxlength="9" spellcheck="false" autocapitalize="none" data-backup' })}${btn('primary lg', 'Verify', 'data-act="verifyBackup"')}</div><button type="button" class="textButton" data-go="twostep">Use authentication code</button><p class="note">Lost access to both? <button type="button" class="inlineButton" data-go="lost">Get help</button></p>` },
  // Two-step applies to every sign-in except a passkey, so a passkey is the way back in.
  lost: { h: () => backBtn('backup') + heading('Can’t use two-step?', S.pkOn ? 'A passkey on this device signs you in without a code.' : 'We can help you back in.') +
    (S.pkOn ? `<div class="actions">${btn('secondary', `${I.pk}Use a passkey`, 'data-act="passkey"')}</div>` : '') +
    `<p class="note">Nothing works? Email support from ${esc(S.email || 'your account’s email')} and we’ll help you back in.</p>` },
  done: { h: () => big.ok + heading('You’re in', 'Letting you in...') },
  signup: { h: () => heading('Create your account', 'Set up 5pm in a minute.') + alslot + providers(false) + '<div class="divider">or</div>' +
    `<form class="form" data-form="signup" novalidate>${field('nm', 'Name', { ph: 'Your name', ac: 'name', value: S.signupName })}${field('sem', 'Email', { type: 'email', ph: 'name@company.com', ac: 'email', name: 'email', value: S.email })}${field('spw', 'Password', { pw: true, ac: 'new-password', name: 'new-password', hint: RULE, rule: true })}${btn('primary lg', 'Create Account', 'data-act="signup"')}</form><p class="note">By continuing you agree to the <a class="inlineButton" href="/privacy.html">Privacy Policy</a>.</p>`,
    below: 'Already have an account? <button type="button" class="inlineButton" data-go="signin">Sign in</button>' },
  confirm: { h: () => big.ring('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>') + heading('Confirm your email', `We sent a link to <span class="address">${esc(S.email)}</span>. Open it to finish setting up.`) + alslot + `<div class="actions">${btn('secondary', 'Use a different email', 'data-go="signup"')}</div><button type="button" class="textButton" data-resend="signup" aria-disabled="true">Resend email in <span class="t" data-t>1:00</span></button>` },
  reset: { h: () => backBtn('signin') + heading('Reset your password', 'We’ll email you a 6-digit code.') + alslot + `<form class="form" data-form="reset" novalidate>${field('rem', 'Email', { type: 'email', value: S.email, ac: 'email', name: 'email', ph: 'name@company.com' })}${btn('primary lg', `${I.mail}Email me a code`, 'data-act="sendcode"')}</form><button type="button" class="textButton" data-go="other">Try another way</button>` },
  other: { h: () => backBtn('reset') + heading('Try another way', 'Sign in without your password. You can set a new one later in Settings.') + `<div class="actions">${S.pkOn ? btn('secondary', `${I.pk}Use a passkey`, 'data-act="passkey"') : ''}${btn('secondary', `${ic.g}Continue with Google`, 'data-act="oauth-google"')}${btn('secondary', `${ic.gh}Continue with GitHub`, 'data-act="oauth-github"')}</div>` },
  code: { h: () => backBtn('reset') + heading('Check your email', `Enter the code sent to <span class="address">${esc(S.email)}</span>.`) + alslot + `<div class="form">${otp()}${btn('primary lg', 'Continue', 'data-act="verifyCode"')}</div><button type="button" class="textButton" data-resend="code" aria-disabled="true">Resend code in <span class="t" data-t>1:00</span></button>` },
  newpw: { h: () => heading('Choose a new password', 'You’ll use it to sign in from now on.') + alslot + `<form class="form" data-form="newpw" novalidate><input type="email" name="email" autocomplete="username" value="${esc(S.email)}" hidden>${field('npw', 'New password', { pw: true, ac: 'new-password', name: 'new-password', hint: RULE, rule: true })}${btn('primary lg', 'Save and Sign In', 'data-act="savepw"')}</form>` },
  noAccount: { h: () => heading(`No 5pm account for this ${S.provider} account`, `<span class="address">${esc(S.email)}</span> isn’t linked to 5pm yet. Create an account with it?`) + alslot +
    `<div class="actions">${btn('primary lg', 'Create Account', 'data-act="keepNew"')}${btn('secondary', `Use a different ${S.provider} account`, 'data-act="dropNew"')}</div><p class="note">Already use 5pm with another email? Sign in with it, then connect ${S.provider} in Settings.</p>` },
};
const ORDER = ['signin', 'twostep', 'backup', 'lost', 'noAccount', 'signup', 'confirm', 'reset', 'other', 'code', 'newpw', 'done'];

// Info cards: { icon, tone, title, text }. Page-level notes sit at the top of
// the card, under the title; field errors sit under their field (setMsg).
const ALERTS = {
  rate: { tone: 'warning', icon: I.clock, title: 'Too many attempts', text: 'Try again in a few minutes. You can still reset your password.' },
  offline: { tone: 'info', icon: I.wifi, title: 'You’re offline', text: 'We’ll sign you in as soon as you’re back.' },
  oauthCancel: { tone: 'info', icon: I.info, title: 'Sign-in was cancelled' },
  oauthFailed: { tone: 'danger', icon: I.warn, title: 'Sign-in didn’t finish', text: 'Try again, or sign in another way.' },
  session: { tone: 'info', icon: I.out, title: 'You’ve been signed out', text: 'Sign in to pick up where you left off.' },
  elsewhere: { tone: 'info', icon: I.out, title: 'You were signed out from another device' },
  linkExpired: { tone: 'warning', icon: I.clock, title: 'This link has expired', text: 'Reset your password again to get a new code.' },
  exists: { tone: 'info', icon: I.info, title: 'This email already has a 5pm account', text: 'Sign in instead, or reset your password.' },
  pkNotLinked: { tone: 'danger', icon: I.warn, title: 'This passkey isn’t linked to 5pm', text: 'Try another passkey, or sign in another way.' },
  sent: { tone: 'success', icon: I.mail, title: 'We sent another email' },
  dropped: { tone: 'info', icon: I.info, title: 'That account wasn’t kept', text: 'Pick another account, or sign in with your email.' },
};

// ── 5. The card: steps, info cards, field messages, buttons ───────────────────
const vp = document.getElementById('vp'), below = document.getElementById('below');
let cur = null, timers = [], tick = null, curAlert = null;
const later = (fn, ms) => timers.push(setTimeout(fn, ms));
const clearTimers = () => { timers.forEach(clearTimeout); timers = []; clearInterval(tick); tick = null; };
const step = () => vp.querySelector('.step:not(.leaving)');
const $ = s => step()?.querySelector(s);
const val = s => ($(s)?.value || '').trim();

function countdown(secs, done) {
  const set = () => step()?.querySelectorAll('[data-t]').forEach(t => { t.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`; });
  set(); clearInterval(tick);
  tick = setInterval(() => { secs = Math.max(0, secs - 1); set(); if (!secs) { clearInterval(tick); tick = null; done && done(); } }, 1000);
}
// Resend buttons wait 60 s, then read "Resend email" / "Resend code".
function startResend() {
  const r = $('[data-resend]'); if (!r) return;
  r.setAttribute('aria-disabled', 'true');
  r.innerHTML = `Resend ${r.dataset.resend === 'code' ? 'code' : 'email'} in <span class="t" data-t>1:00</span>`;
  countdown(60, () => { const b = $('[data-resend]'); if (b) { b.removeAttribute('aria-disabled'); b.textContent = `Resend ${b.dataset.resend === 'code' ? 'code' : 'email'}`; } });
}

/* Step morph: the old step pops out of flow and fades up with a little blur,
   the height glides, the new step rises in. */
function go(id, opts = {}) {
  if (id === 'signout') { _sb.auth.signOut().catch(() => {}); id = 'signin'; }
  clearTimers();
  const dir = ORDER.indexOf(id) >= ORDER.indexOf(cur) ? 1 : -1;
  const old = step(); const from = vp.offsetHeight;
  const el = document.createElement('div'); el.className = 'step'; el.style.setProperty('--dir', dir); el.innerHTML = SCREENS[id].h();
  if (old && !old.classList.contains('boot') && !opts.instant) {
    vp.style.height = from + 'px';
    old.style.setProperty('--dir', dir); old.classList.add('leaving');
    el.classList.add('entering'); vp.appendChild(el);
    const to = el.offsetHeight;
    requestAnimationFrame(() => { vp.style.transition = 'height var(--duration-smooth) var(--ease-standard)'; vp.style.height = to + 'px'; el.classList.add('in'); el.classList.remove('entering'); });
    later(() => { old.remove(); vp.style.transition = ''; vp.style.height = ''; el.classList.remove('in'); }, 380);
  } else { vp.innerHTML = ''; vp.appendChild(el); }
  below.innerHTML = SCREENS[id].below || ''; below.hidden = !SCREENS[id].below;
  cur = id; curAlert = null; wire(el);
  if (id === 'confirm' || id === 'code') startResend();
  if (id === 'signin') _pkStartAutofill();
  else _pkStopAutofill();
  if (opts.alert) later(() => alert(opts.alert, opts.text), old ? 200 : 60);
  if (opts.then) later(opts.then, old && !opts.instant ? 380 : 30);
  const focus = el.querySelector('input:not([type=hidden]):not([hidden])');
  if (focus && !el.querySelector('[data-otp]') && id !== 'signin') later(() => focus.focus({ preventScroll: true }), 400);
}

/* Info card presence: height opens from zero with the fade, so nothing below
   jumps. A second card swaps its words in place. `text` overrides the line. */
function alert(key, text) {
  const slot = step()?.querySelector('[data-al]'); if (!slot) return;
  const inner = slot.firstElementChild;
  const a = key && ALERTS[key];
  const paint = () => {
    const t = text !== undefined ? text : a.text;
    inner.innerHTML = `<div class="alert ${a.tone}" role="${a.tone === 'danger' ? 'alert' : 'status'}"><span class="al-icon">${a.icon}</span><div class="al-copy"><strong>${a.title}</strong>${t ? `<p>${t}</p>` : ''}</div></div>`;
  };
  if (!a) { slot.classList.add('closing'); slot.classList.remove('open'); curAlert = null; return; }
  if (slot.classList.contains('open')) {
    slot.classList.remove('open'); slot.classList.add('closing');
    later(() => { slot.classList.remove('closing'); paint(); void slot.offsetWidth; slot.classList.add('open'); }, 200);
  } else { slot.classList.remove('closing'); paint(); void slot.offsetWidth; slot.classList.add('open'); }
  curAlert = key;
}
// Field message under its field; plain text only.
function setMsg(id, text, err = true) {
  const s = step()?.querySelector(`[data-msg="${id}"]`); if (!s) return;
  const m = s.querySelector('.msg');
  if (!text) { s.classList.remove('open'); return; }
  m.className = 'msg' + (err ? ' err' : ''); m.innerHTML = `<span>${esc(text)}</span>`; s.classList.remove('open'); void s.offsetWidth; s.classList.add('open');
}
function setBtn(b, label, busy) {
  if (!b) return; const l = b.querySelector('.lbl');
  if (label !== undefined && l.innerHTML !== label) { l.innerHTML = label; l.classList.remove('swapIn'); void l.offsetWidth; l.classList.add('swapIn'); }
  if (busy === true) { b.setAttribute('aria-busy', 'true'); b.setAttribute('aria-disabled', 'true'); }
  if (busy === false) { b.removeAttribute('aria-busy'); b.removeAttribute('aria-disabled'); }
  if (busy === 'off') { b.removeAttribute('aria-busy'); b.setAttribute('aria-disabled', 'true'); }
}
const lockForm = on => step()?.querySelectorAll('input').forEach(i => { i.readOnly = on; });
function otpCode() { return [...(step()?.querySelectorAll('[data-otp] input') || [])].map(i => i.value).join(''); }
function otpError(text) {
  const o = $('[data-otp]'); if (!o) return;
  o.dataset.invalid = 'true';
  o.querySelectorAll('input').forEach(i => { i.value = ''; i.dataset.filled = 'false'; });
  o.querySelectorAll('.glyph').forEach(g => { g.innerHTML = ''; });
  setMsg('otp', text);
  o.querySelector('input')?.focus();
}
// The password rule turns red ("3 more characters") after a too-short submit.
function shortPw(p) {
  p.closest('.shell').dataset.invalid = 'true';
  const el = p.closest('.field').querySelector('.rule');
  const n = 8 - p.value.length;
  el.dataset.state = 'short'; el.querySelector('.rt').textContent = `${n} more character${n === 1 ? '' : 's'}`;
  el.classList.remove('swapIn'); void el.offsetWidth; el.classList.add('swapIn'); p.focus();
}

function wire(root) {
  root.querySelectorAll('[data-eye]').forEach(b => b.addEventListener('click', () => {
    const i = root.querySelector('#' + b.dataset.eye); const show = i.type === 'password';
    i.type = show ? 'text' : 'password'; b.setAttribute('aria-pressed', show); b.setAttribute('aria-label', show ? 'Hide password' : 'Show password'); b.innerHTML = show ? I.eyeOff : I.eye;
    i.classList.remove('reveal'); void i.offsetWidth; i.classList.add('reveal');
  }));
  /* Typing clears an error the moment the person starts fixing it. */
  root.querySelectorAll('.input, .shell input').forEach(i => i.addEventListener('input', () => {
    i.removeAttribute('aria-invalid'); const sh = i.closest('.shell'); if (sh) delete sh.dataset.invalid;
    if (cur === 'signin') { root.querySelector('#em')?.removeAttribute('aria-invalid'); const s2 = root.querySelector('[data-shell="pw"]'); if (s2) delete s2.dataset.invalid; setMsg('pw', ''); if (curAlert === 'pkNotLinked' || curAlert === 'oauthCancel') alert(null); }
    if (i.type === 'email') setMsg(i.id, '');
  }));
  root.querySelectorAll('[data-rule]').forEach(slot => {
    const inp = slot.parentElement.querySelector('input'); const r = () => slot.querySelector('.rule');
    inp.addEventListener('input', () => {
      const el = r(); if (!el) return; const ok = inp.value.length >= 8;
      if (ok) el.dataset.state = 'ok'; else if (el.dataset.state === 'ok' || el.dataset.state === 'short') el.dataset.state = inp.value ? (el.dataset.state === 'short' ? 'short' : '') : '';
      el.querySelector('.rt').textContent = ok ? 'At least 8 characters' : (inp.value && el.dataset.state === 'short' ? `${8 - inp.value.length} more character${8 - inp.value.length === 1 ? '' : 's'}` : 'At least 8 characters');
    });
  });
  // Caps Lock note on password fields.
  root.querySelectorAll('.shell input').forEach(inp => {
    const capsCheck = e => {
      if (!e.getModifierState) return; const on = e.getModifierState('CapsLock'); const slot = root.querySelector(`[data-msg="${inp.id}"]`);
      if (!slot || slot.hasAttribute('data-rule')) { const rl = slot?.querySelector('.rule .rt'); if (rl && on) rl.textContent = 'Caps Lock is on'; return; }
      const m = slot.querySelector('.msg'); const isCaps = m.querySelector('.caps');
      if (on && !slot.classList.contains('open')) { m.className = 'msg'; m.innerHTML = '<span class="caps">' + I.warn + 'Caps Lock is on</span>'; slot.classList.add('open'); }
      if (!on && isCaps) slot.classList.remove('open');
    };
    inp.addEventListener('keydown', capsCheck); inp.addEventListener('keyup', capsCheck);
  });
  const bk = root.querySelector('[data-backup]');
  if (bk) bk.addEventListener('input', () => { const v = bk.value.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8); bk.value = v.length > 4 ? v.slice(0, 4) + '-' + v.slice(4) : v; setMsg('bk', ''); });
  const o = root.querySelector('[data-otp]'); if (o) wireOtp(o);
}
function wireOtp(o) {
  const ins = [...o.querySelectorAll('input')], ring = o.querySelector('.ring');
  const place = i => { ring.style.transform = `translateX(${ins[i].parentElement.offsetLeft}px)`; ring.style.width = ins[i].parentElement.offsetWidth + 'px'; ring.style.height = ins[i].parentElement.offsetHeight + 'px'; };
  const put = (i, v) => { ins[i].value = v; ins[i].dataset.filled = v ? 'true' : 'false'; ins[i].nextElementSibling.innerHTML = v ? `<span>${v}</span>` : ''; };
  const done = () => { if (ins.every(i => i.value)) $('[data-act="verify2fa"], [data-act="verifyCode"]')?.click(); };
  ins.forEach((inp, i) => {
    inp.addEventListener('focus', () => place(i));
    inp.addEventListener('input', () => { delete o.dataset.invalid; setMsg('otp', ''); const v = inp.value.replace(/\D/g, '').slice(-1); put(i, v); if (v && i < 5) ins[i + 1].focus(); done(); });
    inp.addEventListener('keydown', e => { if (e.key === 'Backspace' && !inp.value && i > 0) { put(i - 1, ''); ins[i - 1].focus(); e.preventDefault(); } if (e.key === 'ArrowLeft' && i) ins[i - 1].focus(); if (e.key === 'ArrowRight' && i < 5) ins[i + 1].focus(); });
    inp.addEventListener('paste', e => { const d = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6); if (!d) return; e.preventDefault(); [...d].forEach((c, k) => put(k, c)); ins[Math.min(d.length, 5)].focus(); done(); });
  });
  place(0);
  later(() => ins[0].focus({ preventScroll: true }), 400);
}

// ── 6. Errors: what Supabase says, in the page's words ────────────────────────
const _isOffline = err => navigator.onLine === false || /Failed to fetch|NetworkError|Load failed|network/i.test(String(err?.message || '')) || err?.name === 'AuthRetryableFetchError';
const _isRate = err => err?.status === 429 || /rate limit|too many/i.test(String(err?.message || ''));
// "Try again in 4:52" only when Supabase says how long; else "a few minutes".
function _retrySecs(err) { const m = /(\d+)\s*seconds?/i.exec(String(err?.message || '')); return m ? +m[1] : 0; }
function _showRate(err, b) {
  const secs = _retrySecs(err);
  alert('rate', secs ? 'Try again in <span class="t" data-t></span>. You can still reset your password.' : undefined);
  setBtn(b, secs ? 'Try again in <span class="t" data-t></span>' : 'Try again in a few minutes', 'off');
  const restore = () => { const x = $('[data-act="signin"]'); if (x) setBtn(x, 'Sign In', false); alert(null); };
  if (secs) countdown(secs, restore); else later(restore, 60000);
}
// Offline: the button waits, and the attempt runs again by itself once the
// browser is back online. No extra network probing.
function _waitOnline(b, retry) {
  alert('offline'); setBtn(b, '<span class="spinIn"></span>Waiting for connection', 'off');
  window.addEventListener('online', function again() { window.removeEventListener('online', again); alert(null); setBtn(b, undefined, false); retry(); }, { once: true });
}
// Desktop app (desktop-auth.js) and older callers report problems through this.
window.showAuthError = function (msg) {
  if (cur !== 'signin') go('signin', { then: () => alert('oauthFailed', esc(msg)) });
  else alert('oauthFailed', esc(msg));
};

// ── 7. Signing in ─────────────────────────────────────────────────────────────
// The method tried on this page becomes "Last used" once the app opens
// (index-auth-gate.js). Keys don't start with wh_, so signing out keeps them.
function _markLoginPending(method) { try { localStorage.setItem('5pm_login_pending', method); } catch (_) {} }

// True when the signed-in account has an authenticator that this session
// still has to pass (aal1 → aal2), unless a passkey or a backup code did.
async function _mfaRequired() {
  try {
    const { data, error } = await _sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error) return false;
    const viaPasskey = (data?.currentAuthenticationMethods || []).some(m => /passkey|webauthn/i.test(m?.method));
    const need = !!data && data.nextLevel === 'aal2' && data.currentLevel === 'aal1' && !viaPasskey;
    if (!need) return false;
    // A session that passed with a backup code stays aal1 but counts as done
    // in the database (public.mfa_satisfied), so don't ask for a code again.
    const { data: ok } = await _sb.rpc('mfa_satisfied');
    return ok !== true;
  } catch (_) { return false; }
}

// Signed in: You're in, then the app.
function finish() {
  _pkStopAutofill();
  try { localStorage.removeItem('5pm_oauth_intent'); } catch (_) {}
  go('done');
  setTimeout(() => { window.location.href = 'index.html'; }, 1400);
}
async function afterSignIn() {
  if (await _mfaRequired()) { go('twostep'); return; }
  finish();
}

async function signInWithPassword(b) {
  const em = $('#em'), pw = $('#pw');
  const email = (em.value || '').trim();
  if (!email) { em.setAttribute('aria-invalid', 'true'); setMsg('em', 'Enter your email.'); em.focus(); return; }
  if (!pw.value) { $('[data-shell="pw"]').dataset.invalid = 'true'; setMsg('pw', 'Enter your password.'); pw.focus(); return; }
  S.email = email;
  if (curAlert) alert(null);
  setBtn(b, undefined, true); lockForm(true); _markLoginPending('email');
  const { error } = await _sb.auth.signInWithPassword({ email, password: pw.value });
  lockForm(false);
  if (!error) { setBtn(b, undefined, false); try { localStorage.setItem('5pm_login_email', email); } catch (_) {} return afterSignIn(); }
  setBtn(b, undefined, false);
  if (_isOffline(error)) return _waitOnline(b, () => signInWithPassword($('[data-act="signin"]')));
  if (_isRate(error)) return _showRate(error, b);
  if (/not confirmed/i.test(error.message || '')) { go('confirm'); return; }
  // One message for both fields: it never says which emails exist.
  em.setAttribute('aria-invalid', 'true'); $('[data-shell="pw"]').dataset.invalid = 'true';
  pw.value = ''; pw.focus();
  setMsg('pw', /invalid/i.test(error.message || '') ? 'That email and password don’t match.' : (error.message || 'Sign-in failed. Try again.'));
}

// --- OAuth (Google / GitHub) ---
// Google's "always let me choose" setting; other providers get nothing extra.
const GOOGLE_PICKER = provider =>
  String(provider).toLowerCase() === 'google' ? { prompt: 'select_account' } : undefined;

async function handleOAuth(provider, evt) {
  const btn = evt.currentTarget;
  setBtn(btn, undefined, true);
  // Remembered so the app can tell a brand-new account made from Sign in
  // ("No 5pm account for this Google account").
  try { localStorage.setItem('5pm_oauth_intent', JSON.stringify({ mode: cur === 'signup' ? 'signup' : 'signin', provider, at: Date.now() })); } catch (_) {}
  try {
    const { error } = await _sb.auth.signInWithOAuth({
      provider: provider.toLowerCase(),
      // After OAuth the provider redirects back with ?code=; index.html picks
      // the code up via detectSessionInUrl:true.
      options: {
        redirectTo: window.location.origin + '/index.html',
        // Always show Google's account picker, even with one account signed in.
        queryParams: GOOGLE_PICKER(provider)
      }
    });
    if (error) throw error;
    // The browser navigates away to the provider: nothing else to do.
  } catch (err) {
    setBtn(btn, undefined, false);
    if (_isOffline(err)) return alert('offline');
    alert('oauthFailed', esc(`${provider}: ${err.message || 'Please try again.'}`));
  }
}

// --- Passkeys ---
// Autofill first: the browser offers the passkey in the Email box (WebAuthn
// conditional mediation). Browsers without it get a quiet "Sign in with a
// passkey" button instead. A passkey skips the authenticator code.
let _pkAbort = null;
function _pkCanAutofill() {
  return !window.__TAURI__ && !!window.PublicKeyCredential && typeof PublicKeyCredential.parseRequestOptionsFromJSON === 'function'
    && typeof PublicKeyCredential.isConditionalMediationAvailable === 'function';
}
function _pkStopAutofill() { if (_pkAbort) { try { _pkAbort.abort(); } catch (_) {} _pkAbort = null; } }
async function _pkStartAutofill() {
  if (!S.pkOn || !S.pkAuto || _pkAbort) return;
  try {
    const { data, error } = await _sb.auth._startPasskeyAuthentication({ options: {} });
    if (error || !data || cur !== 'signin') return;
    _pkAbort = new AbortController();
    const cred = await navigator.credentials.get({ mediation: 'conditional', publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(data.options), signal: _pkAbort.signal });
    _pkAbort = null;
    if (!cred) return;
    _markLoginPending('passkey');
    setBtn($('[data-act="signin"]'), undefined, true);
    const { error: vErr } = await _sb.auth._verifyPasskeyAuthentication({ challengeId: data.challenge_id, credential: cred.toJSON() });
    if (vErr) throw vErr;
    try { sessionStorage.setItem('wh_mfa_ok', '1'); } catch (_) {}
    finish();
  } catch (err) {
    _pkAbort = null;
    setBtn($('[data-act="signin"]'), undefined, false);
    const text = (err?.name || '') + ' ' + (err?.message || '') + ' ' + (err?.code || '');
    if (/Abort|NotAllowed|cancel/i.test(text)) return;   // closed the prompt or left the screen: no error
    if (/credential_not_found|not found/i.test(text)) alert('pkNotLinked');
  }
}
async function handlePasskey(b) {
  _pkStopAutofill();
  _markLoginPending('passkey');
  // Windows app: a passkey belongs to the website, so it signs in in the
  // browser and lib/desktop-auth.js receives the session.
  if (window.__desktopStartPasskey) {
    try { await window.__desktopStartPasskey(); } catch (err) { window.showAuthError('Could not open your browser: ' + (err.message || err)); }
    return;
  }
  setBtn(b, undefined, true);
  try {
    const { error } = await _sb.auth.signInWithPasskey();
    if (error) throw error;
    try { sessionStorage.setItem('wh_mfa_ok', '1'); } catch (_) {}
    finish();
  } catch (err) {
    setBtn(b, undefined, false);
    const text = (err.name || '') + ' ' + (err.message || '') + ' ' + (err.code || '');
    if (/NotAllowed|cancel|abort/i.test(text)) return;   // closed the prompt: back to Sign in, no error
    if (cur !== 'signin') go('signin', { alert: 'pkNotLinked' });
    else alert(err.code === 'webauthn_credential_not_found' ? 'pkNotLinked' : 'oauthFailed', err.code === 'webauthn_credential_not_found' ? undefined : esc(err.message || 'Please try again.'));
  }
}

// --- Two-step: authenticator code, then a backup code ---
async function verifyTotp(b) {
  const code = otpCode(); if (code.length < 6) return;
  setBtn(b, undefined, true);
  try {
    const { data: f } = await _sb.auth.mfa.listFactors();
    const factor = (f?.totp || []).find(x => x.status === 'verified');
    if (!factor) throw new Error('No authenticator is set up on this account.');
    const { error } = await _sb.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
    if (error) throw error;
    try { sessionStorage.setItem('wh_mfa_ok', '1'); } catch (_) {}
    await _afterSecondStep();
  } catch (err) {
    setBtn(b, undefined, false);
    if (_isRate(err)) return otpError('Too many tries. Wait a few minutes, then try again.');
    otpError(/invalid|incorrect/i.test(err.message || '') ? 'That code didn’t work. Check your app and try again.' : (err.message || 'Verification failed.'));
  }
}
// A backup code is checked by the database (public.use_backup_code): a valid
// one is marked used, two-step stays on, and this session counts as passed.
function _normalizeBackupCode(c) { return (c || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
async function verifyBackup(b) {
  const inp = $('#bk'), norm = _normalizeBackupCode(inp.value);
  if (norm.length < 8) { inp.setAttribute('aria-invalid', 'true'); setMsg('bk', 'Enter the 8 letters and numbers of a backup code.'); return; }
  setBtn(b, undefined, true);
  try {
    const { data: ok, error } = await _sb.rpc('use_backup_code', { code: norm });
    if (error) throw error;
    if (!ok) throw new Error('bad');
    try { sessionStorage.setItem('wh_mfa_ok', '1'); } catch (_) {}
    await _afterSecondStep();
  } catch (err) {
    setBtn(b, undefined, false);
    inp.setAttribute('aria-invalid', 'true');
    setMsg('bk', /too many|rate/i.test(err.message || '') ? 'Too many tries. Wait a few minutes, then try again.' : 'That code didn’t work. Check it, or try another one.');
  }
}
// A new password chosen before two-step was passed is saved now.
async function _afterSecondStep() {
  if (S.pendingPw) {
    const { error } = await _sb.auth.updateUser({ password: S.pendingPw });
    S.pendingPw = null;
    if (error) { go('newpw', { alert: 'oauthFailed', text: esc(error.message) }); return; }
  }
  finish();
}

// --- Create account ---
async function signUp(b) {
  const name = val('#nm'), email = val('#sem'), p = $('#spw');
  S.signupName = name; S.email = email;
  if (!email || !/.+@.+\..+/.test(email)) { $('#sem').setAttribute('aria-invalid', 'true'); setMsg('sem', 'Enter your email.'); $('#sem').focus(); return; }
  if (p.value.length < 8) return shortPw(p);
  setBtn(b, undefined, true); lockForm(true); _markLoginPending('email');
  const { data, error } = await _sb.auth.signUp({ email, password: p.value, options: { data: { display_name: name || email.split('@')[0] } } });
  lockForm(false); setBtn(b, undefined, false);
  if (error) {
    if (_isOffline(error)) return _waitOnline(b, () => signUp($('[data-act="signup"]')));
    if (_isRate(error)) return alert('rate', 'Try again in a few minutes.');
    if (/already|registered|exists/i.test(error.message || '')) return alert('exists');
    if (/password/i.test(error.message || '')) { p.closest('.shell').dataset.invalid = 'true'; setMsg('spw', error.message); return; }
    return alert('oauthFailed', esc(error.message || 'Please try again.'));
  }
  // Supabase hides an existing email by returning a user with no identities.
  if (data?.user && Array.isArray(data.user.identities) && !data.user.identities.length) return alert('exists');
  if (data?.session) return finish();
  go('confirm');
}
async function resendSignup() {
  const { error } = await _sb.auth.resend({ type: 'signup', email: S.email });
  if (error) return alert(_isRate(error) ? 'rate' : 'oauthFailed', _isRate(error) ? 'Try again in a few minutes.' : esc(error.message));
  alert('sent'); startResend();
}

// --- Reset password with a 6-digit email code ---
// The Recovery email template sends {{ .Token }}; verifyOtp turns it into a
// session, then the new password is saved. The code works on any device.
async function sendResetCode(b) {
  const inp = $('#rem'), email = (inp?.value || S.email || '').trim();
  if (!email || !/.+@.+\..+/.test(email)) { inp?.setAttribute('aria-invalid', 'true'); setMsg('rem', 'Enter your email.'); inp?.focus(); return; }
  S.email = email;
  if (b) setBtn(b, undefined, true);
  const { error } = await _sb.auth.resetPasswordForEmail(email);
  if (b) setBtn(b, undefined, false);
  if (error) {
    if (_isOffline(error)) return alert('offline');
    if (_isRate(error)) return alert('rate', 'Try again in a few minutes.');
    return alert('oauthFailed', esc(error.message || 'Please try again.'));
  }
  if (cur !== 'code') go('code'); else { alert('sent'); startResend(); }
}
async function verifyResetCode(b) {
  const token = otpCode(); if (token.length < 6) return;
  setBtn(b, undefined, true);
  const { error } = await _sb.auth.verifyOtp({ email: S.email, token, type: 'recovery' });
  if (!error) { setBtn(b, undefined, false); go('newpw'); return; }
  setBtn(b, undefined, false);
  if (_isOffline(error)) return alert('offline');
  if (_isRate(error)) return otpError('Too many tries. Wait a few minutes, then try again.');
  // Expired or wrong: the digits clear, and the button sends a new code.
  otpError(/expired/i.test(error.message || '') ? 'That code has expired.' : 'That code didn’t work. Check your email and try again.');
  if (/expired/i.test(error.message || '')) {
    setBtn(b, `${I.mail}Send a new code`); b.dataset.act = 'resendNow';
    const r = $('[data-resend]'); if (r) r.hidden = true; clearInterval(tick);
  }
}
async function saveNewPassword(b) {
  const p = $('#npw'); if (p.value.length < 8) return shortPw(p);
  setBtn(b, undefined, true);
  const { error } = await _sb.auth.updateUser({ password: p.value });
  setBtn(b, undefined, false);
  if (!error) { _markLoginPending('email'); return afterSignIn(); }
  // An account with two-step needs the code before the password can change:
  // ask for it, then save the password.
  if (/aal2|mfa|assurance/i.test(error.message || '')) { S.pendingPw = p.value; go('twostep'); return; }
  if (/different from the old|same/i.test(error.message || '')) { p.closest('.shell').dataset.invalid = 'true'; setMsg('npw', 'Choose a password you haven’t used here before.'); return; }
  alert('oauthFailed', esc(error.message || 'Please try again.'));
}

// --- A new Google/GitHub account made from Sign in (index-auth-gate.js sends
// it here): keep it, or remove it and pick another account. ---
async function dropNewAccount(b) {
  setBtn(b, undefined, true);
  try { await _sb.rpc('delete_new_account'); } catch (_) {}
  try { await _sb.auth.signOut(); } catch (_) {}
  try { localStorage.removeItem('5pm_oauth_intent'); } catch (_) {}
  history.replaceState(null, '', location.pathname);
  go('signin', { alert: 'dropped' });
}

// ── 8. Clicks, Enter, submit ─────────────────────────────────────────────────
vp.parentElement.parentElement.addEventListener('click', e => {
  const g = e.target.closest('[data-go]');
  if (g) { e.preventDefault(); if (g.dataset.go === 'reset') S.email = val('#em') || S.email; return go(g.dataset.go); }
  const r = e.target.closest('[data-resend]');
  if (r && r.getAttribute('aria-disabled') !== 'true') return r.dataset.resend === 'code' ? sendResetCode() : resendSignup();
  const a = e.target.closest('[data-act]'); if (!a) return;
  if (a.getAttribute('aria-disabled') === 'true') return;
  const act = a.dataset.act;
  if (act === 'signin') return signInWithPassword(a);
  if (act === 'passkey') return handlePasskey(a);
  if (act === 'oauth-google' || act === 'oauth-github') {
    const provider = act === 'oauth-github' ? 'GitHub' : 'Google';
    _markLoginPending(provider.toLowerCase());
    return handleOAuth(provider, { currentTarget: a });
  }
  if (act === 'verify2fa') return verifyTotp(a);
  if (act === 'verifyBackup') return verifyBackup(a);
  if (act === 'signup') return signUp(a);
  if (act === 'sendcode') return sendResetCode(a);
  if (act === 'resendNow') { a.dataset.act = 'verifyCode'; setBtn(a, 'Continue'); const rr = $('[data-resend]'); if (rr) rr.hidden = false; return sendResetCode(); }
  if (act === 'verifyCode') return verifyResetCode(a);
  if (act === 'savepw') return saveNewPassword(a);
  if (act === 'keepNew') { _markLoginPending(S.provider.toLowerCase()); return finish(); }
  if (act === 'dropNew') return dropNewAccount(a);
});
vp.addEventListener('submit', e => {
  e.preventDefault();
  const f = e.target.dataset.form;
  $({ signin: '[data-act="signin"]', signup: '[data-act="signup"]', reset: '[data-act="sendcode"]', newpw: '[data-act="savepw"]' }[f])?.click();
});
vp.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
  if (e.target.matches('#bk')) { e.preventDefault(); $('[data-act="verifyBackup"]')?.click(); return; }
  const form = e.target.closest('form');
  if (form) { e.preventDefault(); form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })); }
});

// ── 9. Start: what brought us here decides the first screen ───────────────────
(async function start() {
  const p = new URLSearchParams(location.search);
  let linkError = null;
  try { linkError = sessionStorage.getItem('wh_link_error'); sessionStorage.removeItem('wh_link_error'); } catch (_) {}
  // Passkeys: shown only once the project reports them on, so a tap never
  // meets "Passkeys are disabled". Autofill when the browser supports it.
  const pkCheck = (window.PublicKeyCredential || window.__TAURI__)
    ? fetch(window.__SB_URL + '/auth/v1/settings', { headers: { apikey: window.__SB_ANON_KEY } }).then(r => r.json())
        .then(async s => { S.pkOn = !!s.passkeys_enabled; S.pkAuto = S.pkOn && _pkCanAutofill() && await PublicKeyCredential.isConditionalMediationAvailable(); })
        .catch(() => {})
    : Promise.resolve();
  let session = null;
  try { session = (await _sb.auth.getSession()).data.session; } catch (_) {}
  await Promise.race([pkCheck, new Promise(r => setTimeout(r, 1500))]);

  // A new Google/GitHub account made from Sign in.
  const na = p.get('noaccount');
  if (na && session) {
    S.provider = na === 'github' ? 'GitHub' : 'Google';
    S.email = session.user?.email || '';
    return go('noAccount', { instant: true });
  }
  if (session) {
    S.email = session.user?.email || '';
    // Signed in but two-step still due (bounced here by the app's gate, or an
    // OAuth sign-in): ask for the code. Fully signed in: straight to the app.
    if (await _mfaRequired()) return go('twostep', { instant: true });
    if (!p.get('reason')) { window.location.replace('index.html'); return; }
  }
  if (p.get('mode') === 'signup') return go('signup', { instant: true });
  const e = p.get('error'), reason = p.get('reason');
  let al = null, text;
  if (e) al = /cancel|access_denied/i.test(e) ? 'oauthCancel' : 'oauthFailed';
  else if (linkError) al = 'linkExpired';
  else if (reason === 'elsewhere') al = 'elsewhere';
  else if (reason === 'session') al = 'session';
  if (al === 'oauthFailed' && e && e !== 'oauth_failed') text = esc(decodeURIComponent(e));
  if (e || reason) history.replaceState(null, '', location.pathname);
  // Session ran out / signed out elsewhere: the email used last on this device is filled in.
  if (reason && !S.email) { try { S.email = localStorage.getItem('5pm_login_email') || ''; } catch (_) {} }
  go('signin', { instant: true, alert: al, text });
  // Session ran out / signed out elsewhere: the email is filled and the
  // password box is ready.
  if (reason) later(() => $(S.email ? '#pw' : '#em')?.focus(), 450);
  if (!navigator.onLine) later(() => alert('offline'), 300);
})();
// Coming Back to this page (bfcache) re-enables buttons left busy by a
// provider redirect.
window.addEventListener('pageshow', ev => { if (ev.persisted) document.querySelectorAll('[aria-busy="true"]').forEach(b => setBtn(b, undefined, false)); });
