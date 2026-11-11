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
    KEY: { day: 'day_' }, _isNoteDirty: () => false, _clearNoteDirty() {}, p2, short, todayKey: () => '2026-11-11',
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
  for (const id of ['notifPermBar', 'stayHint', 'otBanner', 'doneBanner', 'autostopBanner', 'endSessionHalfDayNote']) {
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
