/**
 * login.js — 5pm auth page logic
 *
 * Supabase SDK is loaded via <script src="..."> in <head> before this file,
 * so window.supabase is always available when this runs.
 *
 * Structure:
 *  1. Supabase client init
 *  2. Theme helpers   (applyTheme, toggleTheme)
 *  3. UI helpers      ($, showView, showAuthError, …)
 *  4. Auth functions  (handleSubmit, handleOAuth, startEmailRecovery, …)
 *  5. Digit-input wiring
 *  6. Event listeners (google-btn, github-btn, etc.)
 */

// ── 1. Supabase client ────────────────────────────────────────────────────────
// SDK is already present (loaded statically in <head>).  We create one client
// instance and reuse it everywhere on this page.
// Named _sb (not supabase) so it never clashes with a `const supabase` that an
// old cached version of login.html may have already declared in global scope.
// Credentials come from lib/config.js (loaded via <script> in login.html before this file).
const _sb = window.supabase.createClient(
  window.__SB_URL,
  window.__SB_ANON_KEY,
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
);

// ── 2. Theme helpers ──────────────────────────────────────────────────────────
// isDark is the canonical theme state for this page.
// The <head> inline IIFE already applied the CSS class; here we just keep
// the JS state in sync and swap icons/logos when the user toggles.
const _savedTheme  = localStorage.getItem('wh_theme');
const _prefersDark = window.matchMedia('(prefers-color-scheme:dark)').matches;
let isDark = _savedTheme ? _savedTheme === 'dark' : _prefersDark;

function applyTheme() {
  document.documentElement.classList.toggle('dark', isDark);
  const sun  = document.getElementById('themeIconSun');
  const moon = document.getElementById('themeIconMoon');
  if (sun)  sun.style.display  = isDark ? '' : 'none';
  if (moon) moon.style.display = isDark ? 'none' : '';
  const fav = document.getElementById('favicon');
  if (fav) fav.href = isDark ? '/favicon-dark.svg' : '/favicon-light.svg';
  const logo = document.getElementById('loginLogo');
  if (logo) logo.src = isDark ? '/brand-dark.svg' : '/brand-light.svg';
}

function toggleTheme() {
  isDark = !isDark;
  localStorage.setItem('wh_theme', isDark ? 'dark' : 'light');
  applyTheme();
}

applyTheme(); // sync icons & logos with the class already applied in <head>

// ── 3. UI helpers ─────────────────────────────────────────────────────────────
// Shorthand so we don't type document.getElementById everywhere
const $ = id => document.getElementById(id);

// Inline error banner — dynamically inserted above the submit button
function showAuthError(msg) {
  let errEl = $('authError');
  if (!errEl) {
    errEl = document.createElement('div');
    errEl.id = 'authError';
    errEl.style.cssText =
      'font-size:12px;color:#dc2626;background:#fef2f2;border:1px solid #fecaca;' +
      'border-radius:8px;padding:10px 12px;margin-bottom:12px;line-height:1.45;display:none';
    $('submitBtn').insertAdjacentElement('beforebegin', errEl);
  }
  errEl.textContent = msg;
  errEl.style.display = '';
  clearTimeout(errEl._t);
  errEl._t = setTimeout(() => { errEl.style.display = 'none'; }, 7000);
}
function _clearAuthError() { const e = $('authError'); if (e) e.style.display = 'none'; }

// Show an error if we were redirected back from the OAuth consent page
// with ?error= in the URL (e.g. user cancelled the OAuth flow)
(function () {
  const p = new URLSearchParams(location.search);
  const e = p.get('error');
  if (e) setTimeout(() => showAuthError(
    e === 'oauth_failed'
      ? 'Sign-in was cancelled or failed. Please try again.'
      : decodeURIComponent(e)
  ), 50);
})();

// Hide all view panels except the one we want to show
function showView(id) {
  ['viewLogin', 'viewRecovery', 'viewOTP', 'viewAuth', 'authSuccess'].forEach(v => {
    const el = $(v);
    if (el) el.style.display = 'none';
  });
  // authSuccess uses display:flex — '' would revert to the default block
  $(id).style.display = id === 'authSuccess' ? 'flex' : '';
  $(id).style.animation = 'none';
  void $(id).offsetWidth; // force reflow so the CSS animation restarts
  $(id).style.animation  = '';
}

// ── 4. Auth functions ─────────────────────────────────────────────────────────

// --- Login / Signup mode toggle ---
let isSignup = false;
function toggleMode() {
  isSignup = !isSignup;
  $('authTitle').textContent   = isSignup ? 'Create an account' : 'Hey Hustler,';
  $('authSub').textContent     = isSignup ? 'Start tracking your work hours.' : 'Let us help you manage your time.';
  $('submitLabel').textContent = isSignup ? 'Create Account' : 'Sign In';
  $('footerText').textContent  = isSignup ? 'Already have an account?' : "Don't have an account?";
  $('toggleLink').textContent  = isSignup ? 'Log in' : 'Sign up';
  $('pwdInput').autocomplete   = isSignup ? 'new-password' : 'current-password';
  $('nameField').classList.toggle('show', isSignup);
  $('forgotLink').style.display = isSignup ? 'none' : '';
}

// --- Password visibility toggle ---
function togglePwd() {
  const input = $('pwdInput');
  const isText = input.type === 'text';
  input.type = isText ? 'password' : 'text';
  $('eyeOpen').style.display  = isText ? '' : 'none';
  $('eyeClose').style.display = isText ? 'none' : '';
}

// --- Email / password sign-in or sign-up ---
async function handleSubmit() {
  const email = $('emailInput').value.trim();
  const pwd   = $('pwdInput').value;
  const name  = $('nameInput').value.trim();
  if (!email || !pwd) { $('emailInput').focus(); return; }
  _clearAuthError();
  const btn = $('submitBtn');
  btn.classList.add('loading');
  btn.disabled = true;
  try {
    if (isSignup) {
      const { data, error } = await _sb.auth.signUp({
        email, password: pwd,
        options: { data: { display_name: name || email.split('@')[0] } }
      });
      if (error) throw error;
      if (data.session) {
        // Email confirmation is disabled in Supabase — signed in immediately
        showSuccess('Welcome to 5pm!');
      } else {
        // Supabase sent a confirmation email — wait for the user to click it
        showView('authSuccess');
        $('authFooter').style.display = 'none';
        $('successTitle').textContent = 'Check your inbox!';
        $('successSub').textContent   = `We sent a confirmation link to ${email}. Click it to activate your account.`;
      }
    } else {
      const { error } = await _sb.auth.signInWithPassword({ email, password: pwd });
      if (error) throw error;
      showSuccess('Welcome back!');
    }
  } catch (err) {
    btn.classList.remove('loading');
    btn.disabled = false;
    const m = err.message || 'Authentication failed.';
    showAuthError(
      (m.includes('Invalid login') || m.includes('invalid_credentials'))
        ? 'Incorrect email or password.'
        : m
    );
  }
}

// --- OAuth (Google / GitHub) ---
// provider: 'Google' or 'GitHub'
// evt:      the MouseEvent from addEventListener (used to disable the button)
async function handleOAuth(provider, evt) {
  const btn = evt.currentTarget;
  btn.disabled = true;
  btn.style.opacity = '.5';
  _clearAuthError();
  try {
    const { error } = await _sb.auth.signInWithOAuth({
      provider: provider.toLowerCase(),
      // After OAuth the provider redirects back here with ?code=
      // index.html picks up the code via detectSessionInUrl:true
      options: { redirectTo: window.location.origin + '/index.html' }
    });
    if (error) throw error;
    // Browser navigates away to the OAuth provider — nothing else to do
  } catch (err) {
    btn.disabled = false;
    btn.style.opacity = '';
    showAuthError(`${provider} sign-in failed: ${err.message}`);
  }
}

// --- Show success state and redirect ---
function showSuccess(msg) {
  if (_recTimer) { clearInterval(_recTimer); _recTimer = null; }
  $('authFooter').style.display = 'none';
  showView('authSuccess');
  $('successTitle').textContent = isSignup ? "You're all set!" : 'Signed in!';
  $('successSub').textContent   = msg || 'Taking you to your workspace…';
  localStorage.setItem('wh_auth', '1'); // keep the fast-path gate in sync
  setTimeout(() => { window.location.href = 'index.html'; }, 1400);
}

// ── Account Recovery ──────────────────────────────────────────────────────────
let _recTimer = null, recExpired = false;

function showRecovery() {
  if (_recTimer) { clearInterval(_recTimer); _recTimer = null; }
  $('authFooter').style.display = 'none';
  showView('viewRecovery');
  const btn = $('recoverEmailBtn');
  btn.classList.remove('loading');
  btn.disabled = false;
}

function backToLogin() {
  if (_recTimer) { clearInterval(_recTimer); _recTimer = null; }
  $('authFooter').style.display = '';
  showView('viewLogin');
}

// Sends a Supabase password-reset magic link (not a 6-digit code)
async function startEmailRecovery() {
  const email = $('emailInput').value.trim();
  if (!email) { backToLogin(); $('emailInput').focus(); return; }
  const btn = $('recoverEmailBtn');
  btn.classList.add('loading');
  btn.disabled = true;
  try {
    await _sb.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/login.html'
    });
    $('authFooter').style.display = 'none';
    showView('authSuccess');
    $('successTitle').textContent = 'Email sent!';
    $('successSub').textContent   = `A password reset link was sent to ${email}. Check your inbox.`;
  } catch (err) {
    btn.classList.remove('loading');
    btn.disabled = false;
    showAuthError(err.message || 'Failed to send reset email. Try again.');
  }
}

function startRecTimer(secs) {
  if (_recTimer) clearInterval(_recTimer);
  let rem = secs;
  const fmt = s => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  $('timerDisplay').textContent = fmt(rem);
  _recTimer = setInterval(() => {
    rem--;
    if (rem <= 0) {
      clearInterval(_recTimer); _recTimer = null;
      recExpired = true;
      $('timerRow').style.display    = 'none';
      $('expiredRow').style.display  = '';
      $('verifyOTPBtn').disabled     = true;
      $('recoveryCode').disabled     = true;
    } else {
      $('timerDisplay').textContent = fmt(rem);
    }
  }, 1000);
}

function resendCode() {
  recExpired = false;
  $('recoveryCode').disabled = false;
  $('recoveryCode').value    = '';
  $('verifyOTPBtn').disabled = true;
  $('expiredRow').style.display = 'none';
  $('timerRow').style.display   = '';
  startRecTimer(60);
}

function showAuthDigits() {
  showView('viewAuth');
  const digits = ['rd0','rd1','rd2','rd3','rd4','rd5'].map(id => $(id));
  digits.forEach(d => { d.value = ''; d.disabled = false; });
  $('authDigitVerify').disabled = true;
  digits[0].focus();
}

function completeRecovery() {
  showSuccess('Access restored');
}

// ── 5. Digit-input wiring ─────────────────────────────────────────────────────
// Handles the 6-box authenticator code entry: auto-advance, backspace, paste
function initDigits() {
  const ids    = ['rd0','rd1','rd2','rd3','rd4','rd5'];
  const digits = ids.map(id => $(id));
  const update = () => { $('authDigitVerify').disabled = !digits.every(d => /^\d$/.test(d.value)); };
  digits.forEach((inp, i) => {
    inp.addEventListener('input', () => {
      inp.value = inp.value.replace(/\D/g, '').slice(-1);
      if (inp.value && i < 5) digits[i + 1].focus();
      update();
    });
    inp.addEventListener('keydown', e => {
      if (e.key === 'Backspace') {
        if (!inp.value && i > 0) { digits[i - 1].focus(); digits[i - 1].value = ''; e.preventDefault(); }
        else if (inp.value) { inp.value = ''; e.preventDefault(); }
        update();
      } else if (e.key === 'ArrowLeft'  && i > 0) digits[i - 1].focus();
        else if (e.key === 'ArrowRight' && i < 5) digits[i + 1].focus();
    });
    inp.addEventListener('paste', e => {
      e.preventDefault();
      const txt = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
      digits.forEach((d, j) => { d.value = txt[j] || ''; });
      digits[Math.min(txt.length - 1, 5)].focus();
      update();
    });
    inp.addEventListener('click', () => inp.select());
  });
}
initDigits();

// ── 6. Event listeners ────────────────────────────────────────────────────────
// OAuth buttons — main login view
document.getElementById('google-btn').addEventListener('click', e => handleOAuth('Google', e));
document.getElementById('github-btn').addEventListener('click', e => handleOAuth('GitHub', e));

// OAuth buttons — account recovery view
document.getElementById('google-recovery-btn').addEventListener('click', e => handleOAuth('Google', e));
document.getElementById('github-recovery-btn').addEventListener('click', e => handleOAuth('GitHub', e));

// Submit on Enter key (when the login/signup view is visible)
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  if ($('viewLogin').style.display !== 'none') handleSubmit();
});
