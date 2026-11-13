// Automated tests for 5pm's logic that runs without a browser or a sign-in.
// Run: npm test   (Node's built-in test runner, no packages to install)
//
// index-app.js is one big browser script, so each test lifts the real function
// out of it by name and runs it in a sandbox with small stand-ins for what it
// touches (the store, Supabase, timers). If a function is renamed or moved,
// the test fails with "Not found in index-app.js" instead of passing silently.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const WEB = path.join(ROOT, 'public'); // the website
const SRC = fs.readFileSync(path.join(WEB, 'lib', 'pages', 'index-app.js'), 'utf8');

// Source from `start` up to the first `end` after it (functions in index-app.js
// are indented four spaces, so their closing brace is "\n    }").
function extractFrom(src, name, start, end) {
  const i = src.indexOf(start);
  if (i < 0) throw new Error(`Not found in ${name}: ${start}`);
  const j = src.indexOf(end, i);
  if (j < 0) throw new Error('No end for: ' + start);
  return src.slice(i, j + end.length);
}
const extract = (start, end = '\n    }') => extractFrom(SRC, 'index-app.js', start, end);
const LOGIN = fs.readFileSync(path.join(WEB, 'login.js'), 'utf8');
// Runs code in a fresh sandbox and returns the value of `expr` afterwards.
function load(code, sandbox, expr) {
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return expr ? vm.runInContext(expr, sandbox) : sandbox;
}

const p2 = n => String(n).padStart(2, '0');
const short = d => { let h = d.getHours(); const m = d.getMinutes(), ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return `${p2(h)}:${p2(m)} ${ap}`; };

// ── Update Entry: punch-out placeholder ────────────────────────────────────
test('punch-out placeholder estimates when the day ended', () => {
  const est = load(extract('function _estimateDayEnd('), {}, '_estimateDayEnd');
  // Same rule as openDayEditModal: the estimate if it's after the start, else the shift end.
  const placeholder = (dk, log, shiftEnd = '06:15 PM') => {
    const g = log?.checkoutDisplay ? null : est(dk, log);
    return g && g.end > g.start ? short(g.end) : shiftEnd;
  };
  const day = '2026-11-09';
  const at = t => new Date(`${day}T${t}`).toISOString();
  assert.equal(placeholder(day, { loginTime: '11:45:00', hoursWorked: 8, lastUpdated: at('20:14:30') }), '08:14 PM', 'last seen running that day');
  assert.equal(placeholder(day, { loginTime: '11:45:00', hoursWorked: 7.5, lastUpdated: new Date('2026-11-10T10:00').toISOString() }), '07:15 PM', 'seen on a later day: start + hours');
  assert.equal(placeholder(day, { loginTime: '20:00:00', hoursWorked: 6 }), '11:59 PM', 'capped at the end of the day');
  assert.equal(placeholder(day, { loginTime: '10:00:00', hoursWorked: 0 }), '06:15 PM', 'nothing worked: shift end');
  assert.equal(placeholder(day, undefined), '06:15 PM', 'empty day: shift end');
  assert.equal(placeholder(day, { loginTime: '09:00:00', checkoutDisplay: '05:00 PM', hoursWorked: 8 }), '06:15 PM', 'has an end: shift end (the real value is shown)');
});

// ── Auto-stop, and Resume after an auto-stop ───────────────────────────────
test('auto-stop fires at target + buffer, and a resume gets a fresh buffer', () => {
  const sb = load(extract('function _autoStopAtSecs('), { cfg: () => sb.C, C: { dailyH: 9, autoStopBuf: 2 }, _sessionAccSecs: 0 });
  const stops = (acc, elapsed, C = { dailyH: 9, autoStopBuf: 2 }) => {
    sb.C = C; sb._sessionAccSecs = acc;
    return acc + elapsed >= vm.runInContext('_autoStopAtSecs()', sb);
  };
  const H = 3600;
  assert.equal(stops(0, 10 * H + 59 * 60), false, 'normal day, 10h59m');
  assert.equal(stops(0, 11 * H), true, 'normal day stops at 11h');
  assert.equal(stops(5 * H, 6 * H), true, 'paused at 5h, still stops at 11h total');
  assert.equal(stops(40500, 1), false, 'resumed after an auto-stop at 11h15m: keeps running');
  assert.equal(stops(40500, 2 * H - 60), false, 'resumed: still running at 1h59m');
  assert.equal(stops(40500, 2 * H), true, 'resumed and forgotten: stops after another 2h');
  assert.equal(stops(9 * H + 60, 1, { dailyH: 9, autoStopBuf: 0 }), false, 'buffer 0: resume still runs');
  assert.equal(stops(9 * H + 60, H, { dailyH: 9, autoStopBuf: 0 }), true, 'buffer 0: at least an hour');
});

test('a running session clears the auto-stopped mark on its day', () => {
  const days = { '2026-11-11': { loginTime: '10:45:0', loginDisplay: '10:45 AM', autostopped: true, sessionTag: 'autostopped', checkoutDisplay: '10:18 PM' } };
  const sb = load(extract('function _writeLiveLog('), {
    dayLog: k => days[k], todayKey: () => '2026-11-11', _sessionAccSecs: 40500, short,
    Store: { setDay: (k, v) => { days[k] = v; } }, persist() {}, _applyingRemote: false,
    _dirtyDays: new Set(), _liveLogSavedAt: 0,
  });
  vm.runInContext('_writeLiveLog(new Date(), 40600)', sb);
  const d = days['2026-11-11'];
  assert.equal(d.autostopped, false);
  assert.equal(d.sessionTag, 'realtime');
  assert.equal(d.checkoutDisplay, undefined, 'a running session has no end time');
  assert.equal(d.loginDisplay, '10:45 AM', 'keeps the day\'s first start');
  days['2026-11-11'] = { ...d, sessionTag: 'edited' };
  vm.runInContext('_writeLiveLog(new Date(), 40700)', sb);
  assert.equal(days['2026-11-11'].sessionTag, 'edited', 'other tags are kept');
});

// ── Sync: delta pull ───────────────────────────────────────────────────────
function syncSandbox() {
  const ls = new Map(), days = {}, calls = [], pushed = [];
  const state = { rows: [] };
  const builder = () => {
    const q = { filters: [], cols: null };
    const api = {
      select(c) { q.cols = c; return api; },
      eq(k, v) { q.filters.push(['eq', k, v]); return api; },
      gte(k, v) { q.filters.push(['gte', k, v]); return api; },
      upsert(r) { pushed.push(r.log_date); return api; },
      single: () => Promise.resolve({ data: { updated_at: '2026-11-11T10:00:00Z' }, error: null }),
      then(res, rej) { calls.push(q); return Promise.resolve({ data: state.rows, error: null }).then(res, rej); },
    };
    return api;
  };
  const sb = load(extract('const SbSync = {', '\n    };'), {
    localStorage: { getItem: k => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)) },
    Store: { getDay: k => days[k], setDay: (k, v) => { days[k] = v; }, allDays: () => ({ ...days }), remove: k => { delete days[k.replace('day_', '')]; } },
    KEY: { day: 'day_' }, DEV_SAMPLE: false, _isNoteDirty: () => false, _clearNoteDirty() {}, p2, short, todayKey: () => '2026-11-11',
    window: { crypto: { randomUUID: () => 'test' }, _sbClient: { auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) }, from: builder } },
    console: { warn() {} },
  });
  return { SbSync: vm.runInContext('SbSync', sb), ls, days, calls, pushed, state };
}
const row = (date, extra) => ({ log_date: date, login_time: `${date}T04:00:00Z`, logout_time: null, hours_worked: 3, status: 'completed', override_type: null, notes: null, ...extra });
const settle = () => new Promise(r => setTimeout(r, 5));

test('first pull is full: all rows, only used columns, uploads local-only days, sets the cursor', async () => {
  const s = syncSandbox();
  s.days['2026-11-01'] = { loginTime: '9:0:0', hoursWorked: 8, lastUpdated: '2026-11-01T18:00:00Z' };
  s.state.rows = [row('2026-11-09', { updated_at: '2026-11-09T14:44:10Z' }), row('2026-11-10', { updated_at: '2026-11-10T07:00:00Z' })];
  await s.SbSync.pullAll(); await settle();
  const q = s.calls.at(-1);
  assert.ok(!q.filters.some(f => f[0] === 'gte'), 'no updated_at filter');
  assert.equal(q.cols, 'log_date,login_time,logout_time,hours_worked,status,override_type,notes,updated_at');
  assert.ok(s.days['2026-11-09'] && s.days['2026-11-10'], 'cloud rows applied');
  assert.ok(s.pushed.includes('2026-11-01'), 'local-only day uploaded');
  assert.equal(s.ls.get('wh_pull_cursor_u1'), '2026-11-10T07:00:00Z', 'cursor = newest server time');
});

test('later pulls are deltas: since cursor − 60 s, no re-uploads, cursor moves on', async () => {
  const s = syncSandbox();
  s.ls.set('wh_pull_cursor_u1', '2026-11-10T07:00:00Z');
  s.days['2026-11-05'] = { loginTime: '9:0:0', hoursWorked: 7, lastUpdated: '2026-11-05T18:00:00Z' };
  s.state.rows = [row('2026-11-10', { logout_time: '2026-11-10T12:30:00Z', hours_worked: 8.5, updated_at: '2026-11-10T12:30:05Z' })];
  await s.SbSync.pullAll(); await settle();
  const g = s.calls.at(-1).filters.find(f => f[0] === 'gte');
  assert.equal(g?.[2], '2026-11-10T06:59:00.000Z');
  assert.equal(s.days['2026-11-10'].hoursWorked, 8.5, 'changed row applied');
  assert.equal(s.pushed.length, 0, 'days not in the delta are not re-uploaded');
  assert.equal(s.ls.get('wh_pull_cursor_u1'), '2026-11-10T12:30:05Z');
  s.state.rows = [];
  await s.SbSync.pullAll();
  assert.equal(s.ls.get('wh_pull_cursor_u1'), '2026-11-10T12:30:05Z', 'empty delta keeps the cursor');
});

test('a delta pull removes a day deleted on another device', async () => {
  const s = syncSandbox();
  s.ls.set('wh_pull_cursor_u1', '2026-11-10T07:00:00Z');
  s.days['2026-11-08'] = { loginTime: '9:0:0', hoursWorked: 8, lastUpdated: '2026-11-08T18:00:00Z' };
  s.state.rows = [{ log_date: '2026-11-08', login_time: null, logout_time: null, hours_worked: 0, status: 'completed', override_type: null, notes: null, updated_at: '2026-11-11T09:00:00Z' }];
  await s.SbSync.pullAll();
  assert.equal(s.days['2026-11-08'], undefined);
});

test('pullAll({ full: true }) ignores the cursor (launch, Sync button)', async () => {
  const s = syncSandbox();
  s.ls.set('wh_pull_cursor_u1', '2026-11-10T07:00:00Z');
  s.days['2026-11-05'] = { loginTime: '9:0:0', hoursWorked: 7, lastUpdated: '2026-11-05T18:00:00Z' };
  await s.SbSync.pullAll({ full: true }); await settle();
  assert.ok(!s.calls.at(-1).filters.some(f => f[0] === 'gte'));
  assert.ok(s.pushed.includes('2026-11-05'), 'local-only days caught again');
});

test('launch and the Sync button ask for a full pull', () => {
  assert.match(SRC, /_syncGlance\(_refreshFromCloud\(true, true\)\)/, 'launch');
  assert.match(SRC, /SbSync\.pullAll\(\{ full: true \}\)/, 'Sync button');
});

// ── Sync: 10-minute checkpoint ─────────────────────────────────────────────
test('checkpoint saves at most once per 10 min since the last save of any kind', () => {
  let tick, flushes = 0, now = 1_000_000_000;
  const sb = load(extract('const _CHECKPOINT_MS'), {
    _checkpointTimer: null, _lastPushAt: 0, pending: true,
    _hasPending: () => sb.pending, _flushSync: () => { flushes++; sb._lastPushAt = now; },
    setInterval: (fn, ms) => { tick = fn; sb.ms = ms; return 1; }, Date: { now: () => now },
  });
  vm.runInContext('_startCheckpoint()', sb);
  assert.equal(sb.ms, 60_000, 'checks once a minute');
  sb._lastPushAt = now - 2 * 60_000; tick();
  assert.equal(flushes, 0, 'a save 2 min ago (tab hide): skip');
  now += 8 * 60_000; tick();
  assert.equal(flushes, 1, '10 min after that save: save');
  now += 60_000; tick();
  assert.equal(flushes, 1, 'a minute later: skip');
  now += 20 * 60_000; sb.pending = false; tick();
  assert.equal(flushes, 1, 'nothing changed: skip');
});

// ── Google sign-in: always show the account picker ─────────────────────────
test('Continue with Google always asks Google for the account picker', async () => {
  let args;
  const sb = load(extractFrom(LOGIN, 'login.js', 'const GOOGLE_PICKER', ';') + '\n' +
                  extractFrom(LOGIN, 'login.js', 'async function handleOAuth(', '\n}'), {
    _sb: { auth: { signInWithOAuth: async a => { args = a; return { error: null }; } } },
    _clearAuthError() {}, showAuthError(m) { throw new Error(m); },
    window: { location: { origin: 'https://whtracker.vercel.app' } },
  });
  const btn = { disabled: false, style: {} };
  await vm.runInContext('handleOAuth', sb)('Google', { currentTarget: btn });
  assert.equal(args.provider, 'google');
  assert.deepEqual({ ...args.options.queryParams }, { prompt: 'select_account' });
  assert.equal(args.options.redirectTo, 'https://whtracker.vercel.app/index.html');
  assert.equal(vm.runInContext('GOOGLE_PICKER', sb)('GitHub'), undefined, 'other providers get nothing extra');
});

test('Settings › Connect Google also shows the account picker', async () => {
  let args;
  const sb = load(extract('async function _connectProvider('), {
    window: { location: { origin: 'https://whtracker.vercel.app', pathname: '/index.html' },
              _sbClient: { auth: { linkIdentity: async a => { args = a; return { error: null }; } } } },
    showToast(t, k, m) { throw new Error(m); },
  });
  await vm.runInContext('_connectProvider', sb)('google');
  assert.deepEqual({ ...args.options.queryParams }, { prompt: 'select_account' });
});

test('Supabase puts prompt=select_account on the Google sign-in URL', async () => {
  // The real bundled Supabase client, run offline: it only builds the URL.
  const ctx = { console, setTimeout, clearTimeout, setInterval, clearInterval, URL, URLSearchParams,
    TextEncoder, TextDecoder, crypto: globalThis.crypto, Headers, Request, Response, AbortController, atob, btoa,
    // Node 20 (CI) has no WebSocket; the client only checks one exists and never connects.
    WebSocket: globalThis.WebSocket || class WebSocket {},
    fetch: async () => { throw new Error('no network in tests'); } };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  load(fs.readFileSync(path.join(WEB, 'lib', 'supabase.umd.js'), 'utf8'), ctx);
  const client = ctx.supabase.createClient('https://example.supabase.co', 'anon',
    { auth: { persistSession: false, detectSessionInUrl: false, autoRefreshToken: false, flowType: 'implicit' } });
  const { data, error } = await client.auth.signInWithOAuth({ provider: 'google',
    options: { skipBrowserRedirect: true, redirectTo: 'https://whtracker.vercel.app/index.html', queryParams: { prompt: 'select_account' } } });
  assert.equal(error, null);
  assert.equal(new URL(data.url).searchParams.get('prompt'), 'select_account');
});

// ── Release checks ─────────────────────────────────────────────────────────
test('release notes are valid (lib/whats-new.js)', () => {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'release-notes.js')], { stdio: 'pipe' });
});

test('no inline script (Content Security Policy)', () => {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'check-csp.js')], { cwd: ROOT, stdio: 'pipe' });
});

test('every app script parses', () => {
  const files = ['login.js', 'sw.js', ...fs.readdirSync(path.join(WEB, 'lib', 'pages')).map(f => path.join('lib', 'pages', f))]
    .filter(f => f.endsWith('.js'));
  for (const f of files) execFileSync(process.execPath, ['--check', path.join(WEB, f)], { stdio: 'pipe' });
});

// ── Week card: ± chips, day types, footer ──────────────────────────────────
const wkSandbox = (today = '2026-11-05') => {
  const durWorked = secs => { const s = Math.max(0, secs), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h === 0 ? `${m}m` : `${h}h ${p2(m)}m`; };
  const dateKey = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  const sb = { p2, durWorked, dateKey, short, todayKey: () => today };
  load([extract('function wkSigned('), extract('function wkSpoken('), extract('function wkDayModel('), extract('function wkFooterModel(')].join('\n'), sb);
  return sb;
};

test('± chips read +2mins, −30mins, +2h 30mins, +1h 15mins', () => {
  const { wkSigned, wkSpoken } = wkSandbox();
  assert.equal(wkSigned(120), '+2mins');
  assert.equal(wkSigned(-1800), '−30mins');
  assert.equal(wkSigned(9000), '+2h 30mins');
  assert.equal(wkSigned(4500), '+1h 15mins');
  assert.equal(wkSigned(-4500), '−1h 15mins');
  assert.equal(wkSigned(7500), '+2h 05mins');
  assert.equal(wkSigned(7200), '+2h');
  assert.equal(wkSigned(60), '+1min');
  assert.equal(wkSpoken(9000), '2 hours 30 minutes overtime');
  assert.equal(wkSpoken(-60), '1 minute remaining');
});

test('week rows pick the right day type', () => {
  const { wkDayModel } = wkSandbox();
  const D = 9 * 3600, past = { isPast: true, dailySecs: D }, fut = { isFuture: true, dailySecs: D }, today = { isToday: true, dailySecs: D };
  assert.equal(wkDayModel({ override: 'holiday' }, past).kind, 'holiday');
  assert.equal(wkDayModel({ override: 'leave' }, past).label, 'On leave');
  assert.equal(wkDayModel({ override: 'halfday', hoursWorked: 4.5, checkoutDisplay: '01:30 PM' }, past).line, 'Done by 01:30 PM');
  assert.equal(wkDayModel(undefined, past).kind, 'missing');
  assert.equal(wkDayModel({ hoursWorked: 9 + 2 / 60 }, past).diffSecs, 120);
  assert.equal(wkDayModel({ autostopped: true, hoursWorked: 11, checkoutDisplay: '08:15 PM' }, past).line, 'Stopped for you at 08:15 PM');
  assert.equal(wkDayModel({ futurePlan: 'late', planEndTime: '7:30 PM' }, fut).label, 'Staying late');
  assert.equal(wkDayModel({ futurePlan: 'early', planEndTime: '4:00 PM' }, fut).line, 'Planned · out at 4:00 PM');
  assert.equal(wkDayModel(undefined, fut).kind, 'future');
  // Today: no ± chip while running or paused, only once the day has ended.
  const run = wkDayModel({}, { ...today, live: true, liveSecs: 4 * 3600 });
  assert.equal(run.kind, 'running'); assert.equal(run.diffSecs, undefined);
  const paused = wkDayModel({ sessionDate: '2026-11-05', hoursWorked: 4.2, checkoutDisplay: '01:12 PM' }, today);
  assert.equal(paused.kind, 'paused'); assert.equal(paused.line, 'Paused at 01:12 PM'); assert.equal(paused.diffSecs, undefined);
  const left = wkDayModel({ sessionDate: '2026-11-05', checkoutTime: 'x', hoursWorked: 7.5, checkoutDisplay: '04:30 PM' }, today);
  assert.equal(left.kind, 'left'); assert.equal(left.line, 'Left at 04:30 PM'); assert.equal(left.diffSecs, -5400);
  const done = wkDayModel({ sessionDate: '2026-11-05', checkoutTime: 'x', hoursWorked: 9.25, checkoutDisplay: '06:15 PM' }, today);
  assert.equal(done.kind, 'done'); assert.equal(done.diffSecs, 900);
});

test('week footer: In hand and On track for', () => {
  const sb = wkSandbox();
  const D = 9 * 3600;
  const mk = (iso, m, loginMin = 9 * 60) => ({ day: { key: iso, name: new Date(iso + 'T12:00').toLocaleDateString('en-US', { weekday: 'long' }), date: new Date(iso + 'T12:00') }, m, loginMin });
  const ctx = days => ({ days, dailySecs: D, weekTarget: 45 * 3600, offset: 0 });
  const now = new Date('2026-11-05T10:00');
  // Two long days bank 2h; today not started; the forecast runs at that pace.
  const week = [
    mk('2026-11-02', { kind: 'worked', hrsSecs: D + 3600 }),
    mk('2026-11-03', { kind: 'worked', hrsSecs: D + 3600 }),
    mk('2026-11-04', { kind: 'worked', hrsSecs: D }),
    mk('2026-11-05', { kind: 'empty', today: true }),
    mk('2026-11-06', { kind: 'future', future: true }),
  ];
  let f = sb.wkFooterModel(ctx(week), 0, now);
  assert.equal(f.left.k, 'In hand'); assert.equal(f.left.v, '+2h 00m'); assert.equal(f.left.tone, 'over');
  assert.equal(f.right.k, 'On track for'); assert.match(f.right.v, /^Fri, /);
  // Behind.
  f = sb.wkFooterModel(ctx([mk('2026-11-02', { kind: 'worked', hrsSecs: D - 5280 }), mk('2026-11-05', { kind: 'empty', today: true })]), 0, now);
  assert.equal(f.left.k, 'Behind by'); assert.equal(f.left.v, '1h 28m');
  // A missing day counts as 0 hours: it owes its target and never hides the forecast.
  // (The user's real week: Mon + Tue missing, Wed 13h 05m, Thu not started.)
  f = sb.wkFooterModel(ctx([mk('2026-11-09', { kind: 'missing' }), mk('2026-11-10', { kind: 'missing' }),
    mk('2026-11-11', { kind: 'worked', hrsSecs: 13 * 3600 + 300 }), mk('2026-11-12', { kind: 'empty', today: true }),
    mk('2026-11-13', { kind: 'future', future: true })]), 0, new Date('2026-11-12T04:55'));
  assert.equal(f.left.k, 'Behind by'); assert.equal(f.left.v, '13h 55m');
  assert.equal(f.right.k, 'On track for'); assert.equal(f.right.v, 'Not this week');
  assert.doesNotMatch(f.right.v, /Add .*'s hours/);
  // One missing day, and the rest of the week can still make it: a real forecast shows.
  f = sb.wkFooterModel(ctx([mk('2026-11-02', { kind: 'missing' }), mk('2026-11-03', { kind: 'worked', hrsSecs: 12 * 3600 }),
    mk('2026-11-04', { kind: 'empty', today: true }), mk('2026-11-05', { kind: 'future', future: true }), mk('2026-11-06', { kind: 'future', future: true })]),
    0, new Date('2026-11-04T09:00'));
  assert.equal(f.left.v, '6h 00m'); assert.equal(f.left.k, 'Behind by');
  assert.match(f.right.v, /^Fri, /, 'pace of 12h a day reaches 45h on Friday');
  // Not enough days left at this pace.
  f = sb.wkFooterModel(ctx([mk('2026-11-05', { kind: 'empty', today: true })]), 0, now);
  assert.equal(f.right.v, 'Not this week');
  // Target met, and past weeks.
  f = sb.wkFooterModel({ ...ctx(week), weekTarget: 27 * 3600 }, 0, now);
  assert.equal(f.right.k, 'Target met');
  f = sb.wkFooterModel({ ...ctx(week), offset: -1 }, 0, now);
  assert.equal(f.right.k, 'Week total'); assert.equal(f.right.v, '29h 00m');
});

test('info bars share one component and auto-stop has a Resume button', () => {
  const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  // (The half-day note moved into the End early sheet as a soft note, 2026-11-13.)
  for (const id of ['notifPermBar', 'stayHint', 'otBanner', 'doneBanner', 'autostopBanner']) {
    assert.match(html, new RegExp(`<div class="ib"[^>]*id="${id}"`), id + ' uses the .ib component');
  }
  assert.doesNotMatch(html, /class="banner\b|notif-perm-bar|stay-hint/, 'old banner styles are gone');
  assert.match(html, /id="autostopResumeBtn"/);
  assert.match(SRC, /autostopResumeBtn'\)\?\.addEventListener\('click', \(\) => el\('calcBtn'\)\.click\(\)\)/, 'Resume does what the main button does');
  const sb = { cfg: () => ({ autoStopBuf: 2 }), durWorked: s => `${Math.floor(s / 3600)}h 00m`, nodes: {} };
  sb.el = id => (sb.nodes[id] ||= { textContent: '', classList: { add() { sb.shown = true; } } });
  load(extract('function _showAutostopBar('), sb, '_showAutostopBar("08:15 PM")');
  assert.equal(sb.nodes.autostopTitle.textContent, 'Stopped at 08:15 PM');
  assert.equal(sb.nodes.autostopMsg.textContent, 'You reached your target plus the 2h buffer.');
  assert.ok(sb.shown);
});

// ── Stats table: sorting and chip colours ──────────────────────────────────
test('Stats table sorts: numbers largest first, text A→Z, third click clears', () => {
  const sb = load([
    "const _RPT_COLS=[];", extract('const _rptFirstDir', ';'),
    extract('function rptNextSort('), extract('function rptAttendance('), extract('function _rptTimeMins('), extract('function rptOrder('),
  ].join('\n'), {});
  const next = (c, k) => vm.runInContext(`rptNextSort(${JSON.stringify(c)}, ${JSON.stringify(k)})`, sb);
  let s = { key: null, dir: 'asc' };
  s = next(s, 'hrs'); assert.deepEqual({ ...s }, { key: 'hrs', dir: 'desc' });
  s = next(s, 'hrs'); assert.deepEqual({ ...s }, { key: 'hrs', dir: 'asc' });
  s = next(s, 'hrs'); assert.equal(s.key, null);
  s = next(s, 'att'); assert.equal(s.dir, 'asc');
  s = next(s, 'att'); assert.equal(s.dir, 'desc');
  s = next(s, 'att'); assert.equal(s.key, null);
  const rows = [
    { entry: '9:02 AM', worked: 9 * 3600, surplusSecs: 120, isPenalty: false, diffSecs: 120, attendance: 'Full Day' },
    { entry: '—', worked: 0, surplusSecs: 0, isPenalty: false, diffSecs: 0, attendance: 'Holiday' },
    { entry: '9:40 AM', worked: 7.5 * 3600, surplusSecs: 0, isPenalty: true, diffSecs: -5400, attendance: 'Full Day' },
    { entry: '8:55 AM', worked: 11 * 3600, surplusSecs: 7200, isPenalty: false, diffSecs: 7200, attendance: 'Full Day', autostopped: true },
    { entry: '—', worked: 0, surplusSecs: 0, isPenalty: false, diffSecs: 0, attendance: '—', missing: true },
  ];
  const order = sort => [...vm.runInContext(`rptOrder(${JSON.stringify(rows)}, ${JSON.stringify(sort)})`, sb)];
  assert.deepEqual(order({ key: null }), [0, 1, 2, 3, 4], 'unsorted = date order');
  assert.deepEqual(order({ key: 'hrs', dir: 'desc' }), [3, 0, 2, 1, 4], 'longest day first; equal days stay in date order');
  assert.equal(order({ key: 'pen', dir: 'desc' })[0], 2, 'biggest shortfall first');
  assert.equal(order({ key: 'sur', dir: 'desc' })[0], 3, 'biggest surplus first');
  assert.deepEqual(order({ key: 'time', dir: 'asc' }).slice(0, 3), [3, 0, 2], 'earliest start first, empty days last');
  // Attendance tones match the week card's day types.
  const att = r => [...vm.runInContext(`rptAttendance(${JSON.stringify(r)})`, sb)];
  assert.deepEqual(att(rows[1]), ['Holiday', 'orchid']);
  assert.deepEqual(att({ attendance: 'Leave' }), ['On leave', 'blue']);
  assert.deepEqual(att({ attendance: 'Half Day' }), ['Half day', 'teal']);
  assert.deepEqual(att(rows[3]), ['Auto-stopped', 'warning']);
  assert.deepEqual(att(rows[4]), ['Missing', 'destructive']);
  assert.deepEqual(att(rows[0]), ['Full day', 'muted-fg']);
  // Penalty and surplus reuse the week card's chip classes.
  assert.match(SRC, /<span class="wk-chip is-short">\$\{wkSigned\(r\.diffSecs\)\}/);
  assert.match(SRC, /<span class="wk-chip is-over">\$\{wkSigned\(r\.surplusSecs\)\}/);
});

test('Stats table escapes saved login and logout times', () => {
  assert.match(SRC, /`\$\{_escHtml\(r\.entry\)\} – \$\{r\.exit && r\.exit !== '—' \? _escHtml\(r\.exit\) : 'now'\}`/);
});

test('Stats Day column names the weekday from the date (30-day names are "14 Tue")', () => {
  assert.match(SRC, /<b>\$\{dDate \? _DAY_ABBR\[dDate\.getDay\(\)\] : r\.day\.slice\(0, 3\)\}<\/b>/);
  const abbr = load(extract('const _DAY_ABBR', ';'), {}, '_DAY_ABBR');
  assert.equal(abbr[new Date('2026-10-14T12:00').getDay()], 'Wed');
});

test('No looping animation runs where nobody can see it', () => {
  const HTML = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  // The progress shine moves with transform (GPU only), never left (re-layout every frame).
  const shimmer = HTML.match(/@keyframes rc-shimmer \{[^\n]*\}/)[0];
  assert.match(shimmer, /transform: translateX/);
  assert.doesNotMatch(shimmer, /left:/);
  // Spinners inside panels that fade to opacity 0 stop while those panels are closed.
  assert.match(HTML, /\.sync-pill:not\(\.show\) \.sync-pill-spin, \.overlay:not\(\.open\) \.leaving-spinner \{ animation-play-state: paused; \}/);
  // The desktop app pauses every animation while hidden in the tray (idle.rs adds the class).
  assert.match(HTML, /html\.app-hidden \*, html\.app-hidden \*::before, html\.app-hidden \*::after \{ animation-play-state: paused !important; \}/);
  assert.doesNotMatch(HTML, /will-change: contents/);
});

// ── Developer Mode › Sample Data ──
const devSample = load(extract('function devSampleData('), {}, 'devSampleData');
const fmtT = d => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
const SAMPLE_CFG = { dailyH: 9, weeklyH: 45, workDays: 5, shiftStart: '09:00 AM', autoStopBuf: 2 };

test('Sample data: five weeks of a regular user, before today, work days only', () => {
  const now = new Date('2026-11-12T14:00'); // a Thursday
  const { days } = devSample(SAMPLE_CFG, now, fmtT);
  const keys = Object.keys(days).sort();
  assert.ok(keys.length >= 20 && keys.length <= 25, `got ${keys.length} days`);
  assert.ok(keys.every(k => k < '2026-11-12'), 'nothing on or after today');
  assert.ok(keys.every(k => { const w = new Date(k + 'T12:00').getDay(); return w >= 1 && w <= 5; }), 'no weekends');
  const logs = Object.values(days);
  assert.equal(logs.filter(l => l.override === 'holiday').length, 1);
  assert.equal(logs.filter(l => l.override === 'leave').length, 1);
  assert.equal(logs.filter(l => l.override === 'halfday').length, 1);
  assert.equal(logs.filter(l => l.autostopped).length, 1);
  for (const [k, l] of Object.entries(days)) {
    if (l.override === 'holiday' || l.override === 'leave') continue;
    assert.match(l.loginTime, /^\d{1,2}:\d{1,2}:\d{1,2}$/);
    assert.match(l.checkoutTime, /^\d{2}:\d{2}:\d{2}$/);
    const [h, m] = l.loginTime.split(':').map(Number);
    assert.ok(h * 60 + m >= 9 * 60 - 15 && h * 60 + m <= 9 * 60 + 35, `${k} starts ${l.loginTime}`);
    if (l.override || l.autostopped) continue;
    const diff = l.hoursWorked * 60 - 9 * 60, fri = new Date(k + 'T12:00').getDay() === 5;
    assert.ok(fri ? diff >= -30 && diff <= 10 : diff >= -40 && diff <= 40, `${k} worked ${l.hoursWorked}h`);
  }
});

test('Sample data is the same every time, so screenshots are repeatable', () => {
  const now = new Date('2026-11-12T14:00');
  assert.deepEqual(devSample(SAMPLE_CFG, now, fmtT).days, devSample(SAMPLE_CFG, new Date('2026-11-12T16:30'), fmtT).days);
});

test('Sample data: today is always a running session, never auto-stopped', () => {
  for (const t of ['08:00', '09:30', '14:00', '19:00', '23:30', '00:20']) {
    const now = new Date('2026-11-12T' + t);
    const { session } = devSample(SAMPLE_CFG, now, fmtT);
    assert.ok(session, `session at ${t}`);
    assert.equal(session.sessionDate, '2026-11-12');
    assert.equal(session.autoStopped, false);
    const start = new Date(session.loginISO), mins = (now - start) / 60000;
    assert.equal(start.getDate(), 12, `starts today at ${t}`);
    assert.ok(mins >= 10 && mins < (9 + 2) * 60, `${t}: ${mins} min in`);
  }
  assert.equal(devSample(SAMPLE_CFG, new Date('2026-11-15T14:00'), fmtT).session, null, 'no session on a Sunday');
});

test('Sample data never syncs and never touches saved data', () => {
  // Every saved-data read/write goes to the in-memory sandbox while it's on.
  const store = extract('const Store = {', '\n    };');
  for (const fn of ['get(key, fb=null) {', 'set(key, val) {', 'remove(key) {', 'keys(prefix) {']) {
    const i = store.indexOf(fn);
    assert.ok(i >= 0, fn);
    assert.ok(store.slice(i, i + 60).includes('if (_inSandbox('), `Store.${fn} checks the sandbox first`);
  }
  // Every network method of SbSync and the realtime channel stop first.
  const sync = extract('const SbSync = {', '\n    };');
  for (const m of ['pushDay', 'pushAll', 'pullAll', 'pushSettings', 'pullSettings']) {
    const i = sync.indexOf(`async ${m}(`);
    assert.ok(i >= 0, m);
    const firstLine = sync.slice(i).split('\n')[1].trim();
    assert.ok(firstLine.startsWith('if (DEV_SAMPLE) return'), `SbSync.${m} stops first: ${firstLine}`);
  }
  assert.match(SRC, /function initRealtimeSync\(\) \{\n\s*if \(DEV_SAMPLE\) return;/);
  // Only on while Developer Mode is on too.
  assert.match(SRC, /localStorage\.getItem\('wh_dev_on'\) === '1' && localStorage\.getItem\('wh_dev_sample'\) === '1'/);
});

test('Raise Dispute: Draft Email works every time, and the desktop sheet never resizes', () => {
  // The draft's content moves into the Update Entry sheet after the first draft,
  // so nothing in _openEmailFor may look it up inside #emailModalOverlay.
  const open = extract('function _openEmailFor(');
  assert.doesNotMatch(open, /el\('emailModalOverlay'\)\.querySelector\('\.email-pv-scroll'\)/);
  assert.match(open, /document\.querySelector\('\.email-pv-scroll'\)\.scrollTop = 0/);
  // On desktop (rail-on) the page slide keeps the sheet's height.
  assert.match(extract('function _dePageTo('), /const h1 = document\.body\.classList\.contains\('rail-on'\) \? h0 : to\.offsetHeight;/);
});

test('Notifications panel has a close button on desktop', () => {
  const HTML = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  assert.match(HTML, /class="sheet-close" id="notifCloseBtn" aria-label="Close notifications"/);
  assert.match(HTML, /body\.rail-on \.notif-panel \.sheet-close \{ display: grid;/);
  assert.match(SRC, /el\('notifCloseBtn'\)\?\.addEventListener\('click', closeNotifPanel\);/);
});

test('Today card: numbers state facts (Clock / Hours), advice only in chip or banner', () => {
  const paint = extract('function _rcPaintKpis(');
  // Clock: Started | Now (live). Hours: Worked (live) | Target.
  assert.match(paint, /el\('rcWorkedCap'\)\.textContent = 'Started';/);
  assert.match(paint, /el\('rcTargetCap'\)\.innerHTML = live \+ 'Now';/);
  assert.match(paint, /el\('rcWorkedCap'\)\.innerHTML = live \+ 'Worked';/);
  assert.match(paint, /el\('rcTargetCap'\)\.textContent = 'Target';/);
  // No leave / done / overtime words on the numbers themselves.
  assert.doesNotMatch(paint, /leave|overtime|done/i);
  // The chip is for the session only; after the target it's empty and the banner speaks.
  assert.match(SRC, /_descRightTimes    = 'You can leave at ' \+ _logoutStr;/);
  assert.match(SRC, /_descRightTimes = _descRightProgress = '';   \/\/ the banner takes over after the target/);
  // Tabs read Clock / Hours, and the day-type switcher stays neutral.
  const HTML = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  assert.match(HTML, />Clock<\/button>/); assert.match(HTML, />Hours<\/button>/);
  assert.doesNotMatch(HTML, /\.rc-info-btn\[data-plan=/);
});

test('Done banner: one per moment, dismissable, swipe hint once', () => {
  assert.match(SRC, /_showDoneBanner\('done', 'success', 'check', "You're done\. Head out!"/);
  assert.match(SRC, /_showDoneBanner\('late', 'warning', 'clock', `Should've left at/);
  assert.match(SRC, /_showDoneBanner\('over', 'warning', 'clock', `\$\{_rcRemainingFmt\(ot\)\} overtime`/);
  assert.match(SRC, /_showDoneBanner\('ended', 'violet', 'moon', 'Done for today'/);
  // Dismissed stays away until the next moment; the hint shows once per device.
  assert.match(extract('function _showDoneBanner('), /_doneDismissed === todayKey\(\) \+ '\|' \+ moment/);
  assert.match(extract('function _doneHint('), /wh_swipe_hint/);
});

test('Each notification has its own dismiss button that never opens the card', () => {
  const render = extract('function renderNotifs(');
  assert.match(render, /<button type="button" class="notif-dismiss" data-dismiss="\$\{safeId\}" aria-label="Dismiss notification">/);
  // Capture phase + stopPropagation: the card's own click handler must not run.
  assert.match(SRC, /const x = e\.target\.closest\('\.notif-dismiss'\); if \(!x\) return;\n\s*e\.stopPropagation\(\);\n\s*_dismissNotifItem\(x\.closest\('\.notif-item'\), x\.dataset\.dismiss, 1\);\n\s*\}, true\);/);
  const HTML = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  assert.match(HTML, /@media \(hover: hover\) and \(pointer: fine\) \{\n\s*\.notif-dismiss \{ display: grid;/);
});

// ── Correcting today's start while a session runs ──
function moveStartSandbox({ login, acc, logged, now }) {
  const st = { loginDate: new Date(login), _sessionAccSecs: acc, wasDone: true, notifSent: true, scheduled: null };
  const ctx = {
    Date: class extends Date { constructor(...a) { if (a.length) super(...a); else super(now); } static now() { return +new Date(now); } },
    Math, isNaN, String, todayKey: () => '2026-11-13', dayLog: () => (logged ? { loginTime: logged } : null),
    persistSession() {}, scheduleNotifications(iso) { st.scheduled = iso; },
  };
  Object.defineProperties(ctx, Object.fromEntries(['loginDate', '_sessionAccSecs', 'wasDone', 'notifSent']
    .map(k => [k, { get: () => st[k], set: v => { st[k] = v; }, enumerable: true }])));
  const move = load(extract('function _moveDayStart('), ctx, '_moveDayStart');
  const worked = () => Math.floor((+new Date(now) - +st.loginDate) / 1000) + st._sessionAccSecs;
  return { st, move, worked };
}

test('A corrected start time moves the hours (no pause yet)', () => {
  const now = '2026-11-13T14:00:00';
  const s = moveStartSandbox({ login: '2026-11-13T10:00:00', acc: 0, now });
  assert.equal(s.worked(), 4 * 3600);
  s.move(new Date('2026-11-13T09:00:00'));               // started an hour earlier
  assert.equal(s.worked(), 5 * 3600, 'an hour more worked');
  assert.equal(s.st.wasDone, false);
  assert.ok(s.st.scheduled, 'alerts rescheduled');
  s.move(new Date('2026-11-13T15:00:00'));               // a start in the future is capped at now
  assert.equal(s.worked(), 0);
});

test('A corrected start time moves the hours after a pause too', () => {
  // Started 9:00, worked to 12:00 (3h banked), resumed 13:00, now 14:00 → 4h.
  const now = '2026-11-13T14:00:00';
  const s = moveStartSandbox({ login: '2026-11-13T13:00:00', acc: 3 * 3600, logged: '9:0:0', now });
  assert.equal(s.worked(), 4 * 3600);
  s.move(new Date('2026-11-13T08:00:00'));               // really started at 8:00
  assert.equal(s.worked(), 5 * 3600);
  assert.equal(new Date(s.st.loginDate).getHours(), 13, 'the running segment is untouched');
  s.move(new Date('2026-11-13T13:30:00'));               // later than all the banked time
  assert.equal(s.st._sessionAccSecs, 0);
  assert.equal(s.worked(), 30 * 60);
});

test('Login picker: anchored to the field and starts on today\'s start', () => {
  const open = extract('function openTpModal(');
  assert.match(open, /parse\(typed \|\| \(targetInputId === 'tc-r7m2' && loginDate \? _dayStartDisplay\(\) : ''\)\)/);
  assert.match(open, /let left = _isLoginInput \? refRect\.left : refRect\.left \+ refRect\.width \/ 2 - mW \/ 2;/);
  // Both "corrected start" paths use the helper instead of keeping the hours fixed.
  assert.equal((SRC.match(/_moveDayStart\((s|newLogin|parsed)\);/g) || []).length, 3);
  assert.doesNotMatch(SRC, /_sessionAccSecs = Math\.max\(0, oldWorked - newCurrentSecs\)/);
});

test('Update Entry sheet: square close button, and no Delete on a missing entry', () => {
  const HTML = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  assert.match(HTML, /body\.rail-on #dayEditOverlay \.sheet-close \{[^}]*width: 32px; height: 32px;[^}]*border-radius: 8px;/);
  const open = extract('function openDayEditModal(');
  assert.match(open, /_deCanDelete = !!\(log && \(log\.loginTime/);
  assert.match(SRC, /el\('dayEditDeleteBtn'\)\.style\.visibility = which === 'edit' && _deCanDelete \? '' : 'hidden';/);
});

test('Today panel no longer shows "Overtime Required"', () => {
  // It was today's recommended hours minus the daily target, so missed days earlier in
  // the week made it huge (18h+) on every work day. Removed (user, 2026-11-13).
  assert.doesNotMatch(SRC, /Overtime Required|overtimeReq/);
});

// ── Recommended hours: spread over the week, capped per day ──
function weeklyEff({ today, logs, weeklyH = 45, dailyH = 9, buf = 2 }) {
  const days = ['2026-11-09','2026-11-10','2026-11-11','2026-11-12','2026-11-13'].map(key => ({ key }));
  const f = load(extract('function _weeklyEffSecs('), {
    cfg: () => ({ dailyH, weeklyH, weeklyOn: true, recommendTimings: true, autoStopBuf: buf }),
    week: () => days, todayKey: () => today, dayLog: k => logs[k] || null,
    adjustedWeeklyTarget: () => weeklyH * 3600, Math,
  }, '_weeklyEffSecs');
  return f() / 3600;
}

test('Recommended hours never ask for more than a day plus the auto-stop buffer', () => {
  // Friday, with Mon, Tue and Thu missed and 13h on Wednesday: 32h owed in one day.
  const fri = weeklyEff({ today: '2026-11-13', logs: { '2026-11-11': { hoursWorked: 13.0872 } } });
  assert.equal(fri, 11, 'capped at 9h + 2h');
  // A different buffer moves the cap with it.
  assert.equal(weeklyEff({ today: '2026-11-13', logs: {}, buf: 1 }), 10);
});

test('Recommended hours still spread a small shortfall over the days left', () => {
  // Wednesday after a 7h Monday and 9h Tuesday: 29h left over 3 days ≈ 9h 40m.
  const wed = weeklyEff({ today: '2026-11-11', logs: { '2026-11-09': { hoursWorked: 7 }, '2026-11-10': { hoursWorked: 9 } } });
  assert.ok(Math.abs(wed - 29 / 3) < 1e-9, String(wed));
  // Ahead of the week: nothing more needed today.
  assert.equal(weeklyEff({ today: '2026-11-13', logs: Object.fromEntries(['09','10','11','12'].map(d => [`2026-11-${d}`, { hoursWorked: 12 }])) }), 0);
});

test('Daily modals: Done for everyone, End only asks early, auto-stop wheel opens on last active', () => {
  // End early: no question once the target is in.
  assert.match(extract('function openEndSessionModal('), /if \(remSecs <= 0\) \{ confirmEndSession\(\); return; \}/);
  // The end-of-day summary shows for everyone (no Recommend Timings condition) and
  // is skipped when Done for the day already ended the session.
  assert.doesNotMatch(SRC, /if \(cfg\(\)\.recommendTimings !== false\) \{\n\s*showCheckoutModal/);
  assert.match(extract('function showCheckoutModal('), /if \(_skipDaySummary\)/);
  // Done for the day opens at the target for everyone; it pauses only with Recommend Timings off.
  assert.match(SRC, /_openDayDone\(_workedNow\);/);
  // Auto-stopped: the wheel starts on the last-active estimate when it's earlier than the stop.
  assert.match(extract('function openAutoStopRecovery('), /_estimateDayEnd\(dayKey,[^)]*\)\?\.end;\n\s*if \(est && stop && est < stop\) start = est;/);
});

test("What's New: titled items get an icon and title; plain lines still work; fixes fold", () => {
  const html = load(extract("    const WN_ICONS = {", '\n    };') + '\n' + extract('function wnBodyHtml('), { _escHtml: s => String(s) }, 'wnBodyHtml')({
    version: '9.9.9',
    improvements: [{ icon: 'clock', title: 'Fix your start time', line: 'Changing it updates your hours.' }, 'A plain line.'],
    fixes: ['Fixed one.', 'Fixed two.'],
  });
  assert.match(html, /<div class="wn-ft">Fix your start time<\/div>/);
  assert.match(html, /A plain line\./);
  assert.match(html, /<span>2 fixes<\/span>/);
  // GitHub / Store notes get the plain line for titled items.
  const out = execFileSync(process.execPath, ['-e', `
    const fs=require('fs'),path=require('path');const src=fs.readFileSync(path.join(${JSON.stringify(WEB)},'lib','whats-new.js'),'utf8');
    const w={};new Function('window',src)(w);process.stdout.write(String(Array.isArray(w.WHATS_NEW)))`]).toString();
  assert.equal(out, 'true');
});

test('Onboarding saves the same settings as before (shift, hours, week, days)', () => {
  const saved = {};
  const ctx = { _ob2: { start: 540, hours: 540, days: 5, name: 'Roshan' }, cfg: () => ({ weeklyOn: false }),
    saveCfg: v => Object.assign(saved, v), deriveShiftType: s => 'morning', short: d => `${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`, Date };
  load('const _ob2Time = m => { const d = new Date(); d.setHours(Math.floor(m / 60) % 24, m % 60, 0, 0); return short(d); };\n' + extract('function _ob2Save('), ctx, '_ob2Save()');
  assert.equal(saved.shiftStart, '9:00'); assert.equal(saved.shiftEnd, '18:00');
  assert.equal(saved.dailyH, 9); assert.equal(saved.weeklyH, 45); assert.equal(saved.workDays, 5);
  assert.equal(saved.name, 'Roshan'); assert.equal(saved.weeklyOn, false);
});

test('Ending a session keeps its end time (the live-log rewrite waits)', () => {
  // A running day's live rewrite must not run while End / auto-stop saves the finished day.
  let wrote = 0;
  const ctx = { loginDate: new Date(), _sessionAccSecs: 0, _dropStaleLive: () => false, _writeLiveLog: () => { wrote++; } };
  const f = load(extract('    let _sessionEnding = false;', '\n    }\n'), ctx, '({ run: () => _flushLiveLog(), set: v => { _sessionEnding = v; } })');
  f.set(true); f.run(); assert.equal(wrote, 0);
  f.set(false); f.run(); assert.equal(wrote, 1);
  // Both End and auto-stop raise the flag around their save.
  for (const fn of ['function checkout(', 'function doAutoStop(']) {
    assert.match(extract(fn), /_sessionEnding = true;\n\s*saveDayLogAndSync\(tk,[\s\S]*?\}\);\n\s*_sessionEnding = false;/, fn);
  }
});

test('Onboarding buttons are wired when it opens (its markup comes after the app script)', () => {
  const HTML = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  assert.ok(HTML.indexOf('id="ob2Pri"') > HTML.indexOf('/lib/pages/index-app.js'), 'markup is after the script');
  assert.match(extract('function openOnboarding('), /el\('ob2Pri'\)\.onclick = _ob2PriClick; el\('ob2Sec'\)\.onclick = _ob2SecClick;/);
  assert.doesNotMatch(SRC, /el\('ob2(Pri|Sec)'\)\?\.addEventListener/);
});

test('End early uses the Today card target, and "early" + worked add up to it', () => {
  const T = { endSessionTitle: {}, endSessionDesc: {}, endSessionHalfDayNote: { style: {} }, endSessionConfirmBtn: {}, endSessionOverlay: { classList: { add() {} } } };
  const ctx = { cfg: () => ({ dailyH: 9 }), effSecs: () => 9 * 3600 + 43 * 60 + 3, _sessionAccSecs: 5 * 3600 + 40 * 60 + 40, loginDate: null,
    el: id => T[id], confirmEndSession: () => {}, Math, Date,
    durWorked: s => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return `${h}h ${String(m).padStart(2, '0')}m`; } };
  load(extract('function openEndSessionModal('), ctx, 'openEndSessionModal()');
  assert.equal(T.endSessionTitle.textContent, 'Leave 4h 03m early?');
  assert.match(T.endSessionDesc.textContent, /You've worked 5h 40m of your 9h 43m\./);
});

test('Countdowns round up so Worked + to go / short = Target', () => {
  assert.match(SRC, /_rcRemainingFmt\(rem >= 60 \? Math\.ceil\(rem \/ 60\) \* 60 : rem\) \+ ' to go'/);
  assert.match(SRC, /durWorked\(Math\.ceil\(\(eff - workedSecs\) \/ 60\) \* 60\)\} short\./);
  assert.match(SRC, /durWorked\(Math\.ceil\(left \/ 60\) \* 60\)\} to go/);
});

test('Override outside your shift still asks to continue an ended day (never wipes its hours)', () => {
  let opened = null, started = null;
  const ctx = { el: () => ({ classList: { remove() {} } }), _pendingLoginP: 'P', _sessionAccSecs: 0, loginDate: null,
    dayLog: () => ({ hoursWorked: 5.5 }), todayKey: () => 't', Math,
    openContinueWorkingModal: (p, s) => { opened = [p, s]; }, _startSession: p => { started = p; } };
  load(extract('function overrideOutsideShift(') + '\n' + extract('function _startOrContinue('), ctx, 'overrideOutsideShift()');
  assert.deepEqual(opened, ['P', 19800]); assert.equal(started, null);
  // A fresh day starts straight away.
  load('', Object.assign(ctx, { dayLog: () => null, _pendingLoginP: 'Q' }), 'overrideOutsideShift()');
  assert.equal(started, 'Q');
});

test('Sign-In Methods: a disabled menu item builds, says why, and does nothing', () => {
  // Stand-in DOM, just enough for _simBuildRow.
  class N { constructor(tag) { this.tag = tag; this.children = []; this.classList = { _s: new Set(), add: c => this.classList._s.add(c), toggle() {}, contains: () => false }; this.attrs = {}; this.style = {}; this.l = {}; }
    set innerHTML(h) { this._h = h; this.children = []; } get innerHTML() { return this._h; }
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
    insertAdjacentHTML(pos, h) { if (pos === 'afterend' && !this.parentNode) throw new Error('The element has no parent.'); this.children.push(new N('html')); }
    querySelector(sel) { const n = new N(sel); this._q = this._q || {}; return (this._q[sel] = this._q[sel] || n); }
    addEventListener(t, f) { this.l[t] = f; } setAttribute(k, v) { this.attrs[k] = v; } }
  const doc = { createElement: t => new N(t) };
  const row = load(extract('    const _SIM_MENU_ICONS = {', '\n    };') + '\n' + extract('function _simBuildRow('), { document: doc, _simCloseMenus() {} },
    `_simBuildRow({ icon: '', name: 'Google', status: 'a', badge: 'Connected', menu: [
      { label: 'Disconnect', icon: 'unlink', danger: true, disabled: true, why: 'Add another way to sign in first.', onClick: () => { throw new Error('fired'); } }] })`);
  const all = []; (function walk(n) { all.push(n); (n.children || []).forEach(walk); Object.values(n._q || {}).forEach(walk); })(row);
  const item = all.find(n => n.className === 'sim-mi danger');
  assert.ok(item && item.disabled, 'item is disabled');
  assert.equal(item.l.click, undefined, 'no click handler');
  assert.ok(all.some(n => n.className === 'sim-why' && n.textContent === 'Add another way to sign in first.'));
});

test('Filling the Settings form never saves halfway (onboarding answers survive)', () => {
  assert.match(extract('function populateSettings('), /_populatingSettings = true;\n\s*try \{ _populateSettingsForm\(\); \} finally \{ _populatingSettings = false; \}/);
  assert.match(extract('function autoSaveSettings('), /^function autoSaveSettings\(\) \{\n\s*if \(_populatingSettings\) return;/);
});
