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

// Read source files with "\n" line endings, whatever the checkout uses. A Windows
// checkout (the desktop worktree, the Store build) has "\r\n", and the tests
// match source text line by line.
const _readFile = fs.readFileSync;
fs.readFileSync = (file, enc) => {
  const out = _readFile(file, enc);
  return typeof out === 'string' ? out.replace(/\r\n/g, '\n') : out;
};

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
    setBtn() {}, alert(k, m) { throw new Error(m || k); }, esc: s => s, _isOffline: () => false, cur: 'signin',
    localStorage: { setItem() {} }, Date, JSON,
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



test('Each notification has its own dismiss button that never opens the card', () => {
  const render = extract('function renderNotifs(');
  assert.match(render, /<button type="button" class="notif-dismiss" data-dismiss="\$\{safeId\}" aria-label="Dismiss notification">/);
  // Capture phase + stopPropagation: the card's own click handler must not run.
  assert.match(SRC, /const x = e\.target\.closest\('\.notif-dismiss, \[data-tap-dismiss\]'\); if \(!x\) return;\n\s*e\.stopPropagation\(\);\n\s*_dismissNotifItem\(x\.closest\('\.notif-item'\), x\.dataset\.dismiss \|\| x\.dataset\.tapDismiss, 1\);\n\s*\}, true\);/);
  const HTML = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  assert.match(HTML, /@media \(hover: hover\) and \(pointer: fine\) \{\n\s*\.notif-dismiss \{ display: grid;/);
});

test('A notification with nowhere to go dismisses on tap and says so', () => {
  const render = extract('function renderNotifs(');
  // No CTA: the card is a button that dismisses, with a hint for touch.
  assert.match(render, /: ` data-tap-dismiss="\$\{safeId\}" role="button" tabindex="0"/);
  assert.match(render, /const hint = n\.cta \? '' : `<div class="notif-hint">Tap to dismiss<\/div>`;/);
  assert.match(render, /\$\{n\.cta \? 'notif-tappable' : 'notif-info-only'\}/);
  // Keyboard: Enter / Space dismiss it too.
  assert.match(SRC, /const x = e\.target\.closest\('\[data-tap-dismiss\]'\); if \(!x \|\| e\.target !== x\) return;/);
  const HTML = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  assert.match(HTML, /\.notif-info-only \{ cursor: pointer; \}/);
  assert.match(HTML, /@media \(hover: hover\) and \(pointer: fine\) \{ \.notif-hint \{ display: none; \} \}/);
});

test('Card dismissals reach the notification; a notification dismiss never clears the card', () => {
  const build = extract('function buildNotifs(');
  // A day dismissed on the card leaves the notification (sample ones too).
  // The notification lists exactly the card's penalties (daily or weekly mode).
  assert.match(build, /const penVisible = _penaltyData\.filter\(p => !p\.sample && !_discardedPenalties\.has\(p\.key\)\);/);
  assert.doesNotMatch(build, /penaltyDays/);
  assert.match(build, /_sampleNotifDismissed\.has\(id\) \|\| _discardedPenalties\.has\(p\.key\)/);
  assert.match(build, /_notifPenKeys\.set\(id, keys\);/);
  // A card re-render that changes the list refreshes the notifications.
  assert.match(extract('function renderPenalties('), /if \(sig\(\) !== before && typeof renderNotifs === 'function'\) renderNotifs\(\);/);
  // Dismissing the notification only hides the notification (user 2026-11-14).
  const add = extract('function addDismissed(');
  assert.doesNotMatch(add, /_discardedPenalties|renderPenalties/);
  // Dismissing on the card (one row or Clear All) refreshes the notifications.
  assert.match(extract('function discardPenalty('), /renderNotifs\(\);/);
  assert.match(extract('function _acMarkAllRead('), /_savePenDiscards\(\);\n\s*renderNotifs\(\);/);
  // The store sits above buildNotifs, so the notifications can read it at launch.
  assert.ok(SRC.indexOf('let _discardedPenalties') < SRC.indexOf('function buildNotifs('));
});

test('Weekend card: label-style day type, 32px total, chip right below', () => {
  const HTML = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  const pill = HTML.match(/\.dt-pill \{[^}]*\}/)[0];
  assert.match(pill, /background: none;/);
  assert.match(pill, /padding: 0;/);
  assert.match(HTML, /\.ws-total \{ font-size: 32px;[^}]*--number-flow-mask-height: \.1em;/);
  assert.match(HTML, /@media \(max-width: 640px\) \{ \.ws-total \{ font-size: 28px; \} \}/);
  assert.match(HTML, /\.ws-vary \{[^}]*margin-top: 6px;/);
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

test("What's New: titled items get an icon and title; plain lines still work; fixes are plain text", () => {
  const html = load(extract("    const WN_ICONS = {", '\n    };') + '\n' + extract('function wnBodyHtml('), { _escHtml: s => String(s) }, 'wnBodyHtml')({
    version: '9.9.9',
    improvements: [{ icon: 'clock', title: 'Fix your start time', line: 'Changing it updates your hours.' }, 'A plain line.'],
    fixes: ['Fixed one.', 'Fixed two.'],
  });
  assert.match(html, /<div class="wn-ft">Fix your start time<\/div>/);
  assert.match(html, /A plain line\./);
  assert.match(html, /<p class="wn-fixes-k">Bug fixes<\/p><ul><li>Fixed one\.<\/li><li>Fixed two\.<\/li><\/ul>/);
  assert.doesNotMatch(html, /wn-fixes-head|aria-expanded/);   // no dropdown
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
    el: id => T[id], confirmEndSession: () => {}, Math, Date, _minsGap: (a, b) => Math.max(0, Math.floor(a / 60) - Math.floor(b / 60)) * 60,
    durWorked: s => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return `${h}h ${String(m).padStart(2, '0')}m`; } };
  load(extract('function openEndSessionModal('), ctx, 'openEndSessionModal()');
  assert.equal(T.endSessionTitle.textContent, 'Leave 4h 03m early?');
  assert.match(T.endSessionDesc.textContent, /You've worked 5h 40m of your 9h 43m\./);
});


test('Override outside your shift still asks to continue an ended day (never wipes its hours)', () => {
  let opened = null, started = null;
  const ctx = { el: () => ({ classList: { remove() {} } }), _pendingLoginP: 'P', _sessionAccSecs: 0, loginDate: null,
    dayLog: () => ({ hoursWorked: 5.5 }), todayKey: () => 't', Math,
    openContinueWorkingModal: (p, s) => { opened = [p, s]; }, _startSession: p => { started = p; } };
  load(extract('function overrideOutsideShift(') + '\n' + extract('function _todayEndedSecs(') + '\n' + extract('function _startOrContinue('), ctx, 'overrideOutsideShift()');
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

test('Settings changes go up fast and survive closing the app before they do', () => {
  // A change marks itself unsent on the device and syncs within ~1.5 s.
  const ls = new Map(), timers = [];
  const ctx = { _applyingRemote: false, _dirtyCfg: false, DEV_SAMPLE: false, Date, String,
    localStorage: { setItem: (k, v) => ls.set(k, v), getItem: k => ls.get(k) ?? null, removeItem: k => ls.delete(k) },
    setTimeout: (f, ms) => { timers.push(ms); return 1; }, clearTimeout() {}, _flushSync() {}, _scheduleIdleSync() {} };
  load(extract("    const CFG_UNSENT_KEY = 'wh_cfg_unsent';", '_scheduleIdleSync();\n    }'), ctx, '_markCfgDirty()');
  assert.equal(ctx._dirtyCfg, true);
  assert.ok(ls.has('wh_cfg_unsent'), 'marked unsent on this device');
  assert.ok(timers.includes(1500), 'syncs within 1.5 s');
  // Sample Data never marks anything.
  ls.clear(); load('', Object.assign(ctx, { DEV_SAMPLE: true }), '_markCfgDirty()'); assert.equal(ls.size, 0);
  // Launch: an unsent change is pushed, not overwritten by the cloud copy.
  assert.match(SRC, /SbSync\.pullSettings\(\)\.then\(remoteCfg => \{\n(\s*\/\/.*\n)*\s*if \(_cfgUnsent\(\) && Store\.getCfg\(\)\) \{\n\s*_dirtyCfg = true;\n\s*_flushSync\(\{ silent: true \}\);\n\s*\} else if \(remoteCfg/);
  // The marker is cleared only after a successful push with nothing newer.
  assert.match(SRC, /else if \(unsentAt && _cfgUnsent\(\) === unsentAt\) \{ try \{ localStorage\.removeItem\(CFG_UNSENT_KEY\); \} catch \{\} \}/);
});

test('Smart Timings off: today\'s target is the plain daily hours', () => {
  const src = extract('function _weeklyEffSecs(');
  assert.match(src, /if \(!c\.weeklyOn \|\| c\.recommendTimings === false\) return daily;/);
});

test('Today card: Clock = Started | Done at, Hours = Worked | Target, one chip on both tabs', () => {
  const paint = extract('function _rcPaintKpis(');
  assert.match(paint, /el\('rcWorkedCap'\)\.textContent = 'Started';/);
  assert.match(paint, /el\('rcTargetCap'\)\.textContent = c\.doneAtTomorrow \? 'Done at · tomorrow' : 'Done at';/);
  assert.match(paint, /el\('rcWorkedCap'\)\.innerHTML = live \+ 'Worked';/);
  assert.match(paint, /el\('rcTargetCap'\)\.textContent = c\.targetCap \|\| 'Target';/);
  assert.doesNotMatch(paint, /'Now'/);                 // the header clock already shows the time
  // The chip is painted once, outside the tab branches, so both tabs show the same thing.
  assert.equal((paint.match(/_rcSetDesc\(/g) || []).length, 1);
  assert.doesNotMatch(SRC, /'You can leave at ' \+ _logoutStr/);
  assert.doesNotMatch(SRC, /el\('rcTarget'\)\.title = eff > 0/);   // no tooltip repeating the chip
  const HTML = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  assert.match(HTML, />Clock<\/button>/); assert.match(HTML, />Hours<\/button>/);
  assert.match(HTML, /#rcKpiGroup\.rc-finished\.rc-over \.rc-desc-row \{ padding: 32px 0;/);
});

test('Centre chip: "left" before the target, hidden at it, "over" after (rounded so it adds up)', () => {
  const chip = load(extract('function _rcRemainingFmt(') + '\n' + extract('function _minsGap(', '}') + '\n' + extract('function _rcChip('), { Math }, '_rcChip');
  const H = 3600, M = 60, T = 8 * H + 30 * M;
  assert.deepEqual({ ...chip(5 * H + 18 * M, T) }, { text: '3h 12m left', over: false });
  assert.equal(chip(5 * H + 17 * M + 50, T).text, '3h 13m left');     // Worked shows 5h 17m: 8h 30m - 5h 17m
  // A Smart Timings target with stray seconds still adds up on screen: 22m + 9h 48m = 10h 10m.
  assert.equal(chip(22 * M + 40, 10 * H + 10 * M + 50).text, '9h 48m left');
  assert.equal(chip(5 * H + 30 * M, T).text, '3h left');
  assert.equal(chip(T - 42 * M, T).text, '42m left');
  assert.equal(chip(T - 45, T).text, '45s left');
  assert.equal(chip(T, T), null);                                      // at the target: hidden
  assert.equal(chip(T + 30, T), null);                                 // under a minute over: hidden
  assert.deepEqual({ ...chip(T + 41 * M, T) }, { text: '41m over', over: true });
  assert.equal(chip(T + H + 5 * M, T).text, '1h 5m over');
  assert.equal(chip(100, 0), null);                                    // no target today
});

test('Done at says "tomorrow" past midnight; Target says when Smart Timings changed it', () => {
  const doneAt = load(extract('function _rcDoneAt('), { short: d => `${d.getHours()}:${d.getMinutes()}` }, '_rcDoneAt');
  const now = new Date(2026, 10, 13, 23, 30);
  assert.deepEqual({ ...doneAt(new Date(2026, 10, 13, 19, 30), now) }, { str: '19:30', tomorrow: false });
  assert.deepEqual({ ...doneAt(new Date(2026, 10, 14, 10, 29), now) }, { str: '10:29', tomorrow: true });
  assert.equal(doneAt(new Date(2026, 10, 12, 23, 44), now).tomorrow, false);   // a past time is never "tomorrow"
  const cap = (log, eff) => load(extract('function _rcTargetCap('), { Math, cfg: () => ({ dailyH: 8.5 }), dayLog: () => log, todayKey: () => 't' }, '_rcTargetCap')(eff);
  assert.equal(cap({}, 8.5 * 3600), 'Target');
  assert.equal(cap({}, 11 * 3600), "Today's target");
  assert.equal(cap({ override: 'halfday' }, 4.25 * 3600), 'Target');
  assert.equal(cap({ todayTargetH: 6 }, 6 * 3600), 'Target');
});

test('Banner: one moment each, no numbers the card already shows', () => {
  assert.match(SRC, /_showDoneBanner\('done', 'success', 'check', "You're done\. Head out!", 'Nicely on time'\);/);
  assert.match(SRC, /_showDoneBanner\('late', 'warning', 'clock', 'Time to head out', ''\);/);
  assert.doesNotMatch(SRC, /_showDoneBanner\('over'/);                 // the chip carries the overtime number
  assert.equal((SRC.match(/_showDoneBanner\('ended', 'violet', 'moon', 'Done for today', 'See you tomorrow'\);/g) || []).length, 2);
  assert.match(extract('function _showDoneBanner('), /_doneDismissed === todayKey\(\) \+ '\|' \+ moment/);
  assert.match(extract('function _doneHint('), /wh_swipe_hint/);
});

test('Paused keeps the card, frozen, instead of the ended summary', () => {
  const src = extract('function renderEmptyState(', '\n    }\n\n');
  assert.match(src, /if \(endedSecs > 0 && !loginDate && _logE\.checkoutDisplay && !_logE\.checkoutTime && !_logE\.autostopped\) \{/);
  const paused = src.slice(src.indexOf('&& !_logE.autostopped) {'), src.indexOf("el('rcKpiGroup')?.classList.remove('rc-paused');"));
  assert.match(paused, /paused: true/);
  assert.match(paused, /_hideDoneBanner\(\);/);
  assert.doesNotMatch(paused, /_endedDayCardHtml/);
  // Countdown elsewhere still rounds up so worked + short / to go = target.
  assert.match(SRC, /durWorked\(_minsGap\(eff, workedSecs\) \|\| 60\)\} short\./);
  assert.match(SRC, /durWorked\(_minsGap\(effSecs\(\), existingSecs\) \|\| 60\)\} to go/);
});

test('Pause saves the real hours (the live rewrite waits while it saves)', () => {
  assert.match(extract('function endSession('), /_sessionEnding = true;\n\s*try \{ saveDayLogAndSync\(tk, _esEntry\); \} finally \{ _sessionEnding = false; \}/);
});

test('Daily modals show today only: Started · Done at / Left at · Total (no week figure)', () => {
  const HTML = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  assert.match(HTML, /<div class="am-k">Started<\/div><div class="am-v" id="dtrStart">—<\/div><\/div><div><div class="am-k">Done at<\/div><div class="am-v" id="dtrDoneAt">—<\/div><\/div><div><div class="am-k">Total<\/div><div class="am-v" id="dailyTargetHours">/);
  assert.match(HTML, /<div class="am-k">Left at<\/div><div class="am-v" id="coLeft">—<\/div><\/div><div><div class="am-k">Total<\/div><div class="am-v" id="coTotal">/);
  assert.doesNotMatch(HTML, /This week<\/div><div class="am-v"/);
  assert.match(extract('function _openDayDone('), /el\('dtrDoneAt'\)\.textContent = loginDate \? short\(_leaveAt\(effSecs\(\)\)\)/);
  assert.match(extract('function showCheckoutModal('), /el\('coTotal'\)\.textContent = durWorked\(workedSecs\);/);
});

test('Onboarding: intro, one question per screen with back, outro; no preview card', () => {
  const draw = extract('function _ob2Draw(');
  assert.match(draw, /<h2>Welcome to 5pm<\/h2><p>5pm tracks your work hours and shows when your day is done\. Set up your workday to get started\.<\/p>/);
  assert.match(draw, /data-back aria-label="Back"/);
  assert.match(draw, /addEventListener\('click', \(\) => _ob2Go\(S\.at - 1, -1\)\)/);
  assert.doesNotMatch(SRC, /YOUR DAY|You can leave<\/div>|_ob2Preview|Leave on time, every time/);
  const Q = load(extract('    const _OB2_Q = [', '\n    ];'), {}, '_OB2_Q');
  assert.deepEqual([...Q].map(q => q.key), ['start', 'hours', 'days', 'name']);
  // Phones: a bottom sheet sized to its content, not a full-screen page.
  const HTML = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  assert.match(HTML, /\.ob-overlay\.ob2-overlay \{ align-items: flex-end; padding: 0; \}/);
  assert.match(HTML, /\.ob2 \{ width: 100%; max-width: none; min-height: 0; max-height: 92dvh;/);
});

test('Start before your shift? names both times; Start runs the normal start path', () => {
  const T = { osDesc: {}, osStart: {}, outsideShiftOverlay: { classList: { add() { T.opened = true; } } } };
  const ctx = { cfg: () => ({ shiftStart: '09:00 AM' }), el: id => T[id], short: d => '06:30 AM', _pendingLoginP: null };
  load(extract('function showOutsideShiftModal('), ctx, 'showOutsideShiftModal(new Date())');
  assert.equal(T.osDesc.textContent, 'Your shift starts at 09:00 AM. Your day will count from 06:30 AM.');
  assert.equal(T.osStart.textContent, 'Start at 06:30 AM');
  assert.ok(T.opened);
  const HTML = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  assert.match(HTML, /<div class="overlay am-host" id="outsideShiftOverlay" data-dismiss="osNotNow">/);
  assert.match(HTML, /<p class="am-t" id="osTitle">Start before your shift\?<\/p>/);
  assert.doesNotMatch(HTML, />Override</);
  assert.match(extract('function overrideOutsideShift('), /_startOrContinue\(p\)/);
});

test('Store rating: try 1 at "Almost done", try 2 on the next open, never after a rating or two tries', async () => {
  const ls = new Map(); let shown = 0, result = 'canceled', store = true, pending = null;
  const ctx = { JSON, DEV_SAMPLE: false, document: { visibilityState: 'visible' }, _queueModal: f => { pending = f(); },
    localStorage: { getItem: k => ls.get(k) ?? null, setItem: (k, v) => ls.set(k, v) },
    window: { __TAURI__: { core: { invoke: async cmd => cmd === 'is_store_app' ? store : (shown++, result) } } } };
  const code = "    const RATE_KEY = 'wh_store_rate';\n"
    + extract('function _rateState(', '\n') + extract('function _rateSave(', '\n')
    + extract('function _rateDue(') + '\n' + extract('async function _rateAsk(');
  const raw = load(code, ctx, '_rateAsk');
  const ask = async at => { pending = null; await raw(at); await pending; };   // the dialog waits its turn in the modal queue
  await ask('open');    assert.equal(shown, 0, 'never on open before the first try');
  await ask('session'); assert.equal(shown, 1, 'try 1 at Almost done');
  await ask('session'); assert.equal(shown, 1, 'try 1 happens once');
  await ask('open');    assert.equal(shown, 2, 'try 2 on the next open after a cancel');
  await ask('open');    assert.equal(shown, 2, 'never a third time');
  // A rating on try 1 ends it.
  ls.clear(); shown = 0; result = 'succeeded';
  await ask('session'); await ask('open'); assert.equal(shown, 1);
  // Not the Store package (web, standalone installer): never asks.
  ls.clear(); shown = 0; store = false;
  await ask('session'); assert.equal(shown, 0);
  // Fires even with the Wrap-Up Reminder off: scheduled before the notifications check.
  assert.match(extract('function scheduleNotifications('), /_rateSchedule\(loginTimestamp\);  \/\/ its own timer[^\n]*\n\s*if \(!c\.notifOn/);
  assert.match(extract('function _rateSchedule('), /\(targetSecs - 300\) \* 1000/);
});

test('Modals: Start-early on a day with hours asks once; Leave early skips the summary', () => {
  assert.match(extract('function calculate('), /if \(isOutsideShift\(p\) && !isSmallCorrection && !_todayEndedSecs\(\)\) \{ showOutsideShiftModal\(p\); return; \}/);
  assert.match(extract('function openContinueWorkingModal('), /el\('cwNote'\)\.textContent = early \? `Your shift starts at \$\{cfg\(\)\.shiftStart/);
  assert.match(SRC, /el\('endSessionConfirmBtn'\)\.addEventListener\('click', \(\) => \{ _skipDaySummary = true; confirmEndSession\(\); \}\);/);
  // After the target, End still goes straight to the summary (openEndSessionModal calls confirmEndSession itself).
  assert.match(extract('function openEndSessionModal('), /if \(remSecs <= 0\) \{ confirmEndSession\(\); return; \}/);
});

test('Modals: automatic ones wait until nothing else is open, oldest first', () => {
  const opened = [], open = new Set(), timers = [];
  const ctx = { opened, _nativeModalOpen: false,
    document: { body: { classList: { contains: () => false } }, querySelectorAll: () => [...open].map(() => ({})) },
    getComputedStyle: () => ({ display: 'flex' }), el: () => null,
    setTimeout: f => { timers.push(f); return timers.length; } };
  const code = 'const _modalQueue = [];\nlet _modalPump = null, _nativeModalOpen = false;\n'
    + extract('function _anyModalOpen(') + '\n' + extract('function _queueModal(') + '\n' + extract('function _pumpModals(');
  const q = load(code, ctx, '_queueModal');
  const run = () => { while (timers.length) timers.shift()(); };
  open.add('today panel');
  q(() => opened.push('done')); q(() => opened.push('whats new'));
  for (let i = 0; i < 3; i++) if (timers.length) timers.shift()();   // keeps waiting while something is open
  assert.deepEqual([...opened], []);
  open.clear(); timers.shift()();                                    // panel closed: the oldest opens
  assert.deepEqual([...opened], ['done']);
  open.add('done'); timers.shift()(); assert.deepEqual([...opened], ['done']);   // the next waits for it
  open.clear(); run(); assert.deepEqual([...opened], ['done', 'whats new']);
  // Wired in: Done for the Day, Auto-Stopped, week plan, What's New, Store rating.
  assert.match(SRC, /_queueModal\(\(\) => \{ if \(!dayLog\(todayKey\(\)\)\?\.checkoutTime && !autoStopped\) _openDayDone\(_workedNow\); \}\);/);
  assert.match(SRC, /setTimeout\(\(\) => _queueModal\(checkAutoStopRecovery\), 800\);/);
  assert.match(SRC, /setTimeout\(\(\) => _queueModal\(openWeekPlanModal\), 1200\);/);
  assert.match(extract('function _wnMaybeShow('), /_queueModal\(\(\) => \{ openWhatsNew\(APP_VERSION\); markSeen\(\); \}\);/);
  assert.match(extract('async function _rateAsk('), /_queueModal\(async \(\) => \{[\s\S]*_nativeModalOpen = true;/);
});

test('Ended summary line: "short of your 9h" / "over your 9h" / "Right on target"', () => {
  const v = load(extract('function _rcRemainingFmt(') + '\n' + extract('function _minsGap(', '}') + '\n' + extract('function _dayVerdictText('), { Math }, '_dayVerdictText');
  const H = 3600, M = 60;
  assert.deepEqual({ ...v(6 * H + 45 * M, 9 * H) }, { text: '2h 15m short of your 9h', tone: 'short' });
  assert.deepEqual({ ...v(9 * H + 41 * M, 9 * H) }, { text: '41m over your 9h', tone: 'over' });
  assert.equal(v(5 * H + 40 * M + 40, 9 * H + 43 * M + 3).text, '4h 3m short of your 9h 43m');   // whole minutes, adds up
  assert.equal(v(9 * H + 4 * M, 9 * H).text, 'Right on target');
  assert.equal(v(8 * H + 56 * M, 9 * H).text, 'Right on target');
  assert.equal(v(9 * H, 0), null);
  assert.doesNotMatch(SRC, /Overtime!|You missed the target by/);
});

test('Ended summary line uses the centre chip (pill), amber when over, green when on target', () => {
  const html = load(extract('function _rcRemainingFmt(') + '\n' + extract('function _minsGap(', '}') + '\n' + extract('function _dayVerdictText(') + '\n' + extract('function _dayVerdictHtml('), { Math }, '_dayVerdictHtml');
  assert.match(html(6 * 3600, 9 * 3600), /^<span class="rc-desc-chip pill" style="gap:4px">3h short of your 9h<\/span>$/);
  assert.match(html(9.7 * 3600, 9 * 3600), /class="rc-desc-chip pill warn"/);
  assert.match(html(9 * 3600, 9 * 3600), /class="rc-desc-chip pill ok"[^>]*><svg[\s\S]*Right on target/);
});

test('Starting with a time already past auto-stop does not crash', () => {
  assert.match(extract('function _startSession('), /render\(\);\n(\s*\/\/.*\n)*\s*if \(!loginDate\) return;\n\s*if \(ticker\) clearInterval\(ticker\);/);
});

test('Weekend card: week total chip, tiny bars, note box; View Stats keeps its button', () => {
  const chip = load(extract('function wkSigned(') + '\nconst _wsGap = secs => wkSigned(secs).slice(1);\n' + extract('function _minsGap(', '}') + '\n' + extract('function _wkndWeekChip('), { Math, p2: n => String(n).padStart(2, '0') }, '_wkndWeekChip');
  const H = 3600, M = 60;
  assert.deepEqual({ ...chip(43 * H + 47 * M, 45 * H) }, { text: '1h 13mins short', tone: '' });
  assert.deepEqual({ ...chip(45 * H + 2 * M, 45 * H) }, { text: 'On target', tone: 'ok' });
  assert.deepEqual({ ...chip(45 * H + 32 * M, 45 * H) }, { text: '32mins over', tone: 'ok' });
  const r = extract('function _renderWkndSummary(');
  assert.match(r, /d\.key > tk \? 0 :/);                                  // days still ahead never count
  assert.doesNotMatch(r, /selectDay\(/);                                // bars don't navigate (user, 2026-11-14)
  assert.match(r, /saveWkndNote\(ta\.value\)/);                          // the same note the old field saved
  assert.match(SRC, /if \(_isWeekendType\) \{\n\s*if \(_infoCard\) _infoCard\.style\.display = 'none';/);
  const HTML = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  assert.match(HTML, /<div id="wkndSum" style="display:none"><\/div>/);
  assert.match(HTML, /data-on-click="ha2992aba2f"/);                      // View Stats → openWeekReport(), unchanged
});

test('Weekend card: no icons on bars, chart container with target line, one variable chip row', () => {
  const r = extract('function _renderWkndSummary(');
  assert.doesNotMatch(r, /wkSvg\(|ws-ic/);                                // no icons on the bars
  assert.match(r, /<div class="ws-chart">[\s\S]*<span class="ws-target"/);  // its own container, the target dashed
  assert.doesNotMatch(r, /This week, \$\{first\}|ws-cap/);                // no date line
  assert.match(r, /'Half Day': \['Half Day', 'teal'\], 'Leave': \['On Leave', 'blue'\], 'Holiday': \['Holiday', 'orchid'\]/);
  assert.match(r, /vary\.innerHTML = typeChip \+ times \+ verdict;/);              // type · start–end · verdict
  assert.match(r, /const rest = \(\) => \{ vary\.innerHTML = weekRow;/);
  assert.match(r, /verdict = chipHtml\('No hours', ''\)/);                       // no "your week adjusts"
  assert.match(r, /if \(dn\) paintNote\(dn, true\);/);                            // that day's note on hover
  const HTML = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  assert.match(HTML, /\.ws-bar i \{[^}]*background: var\(--chart-bar\);/);  // solid, the cool chart grey
  assert.match(HTML, /\.ws-bar\.hot i \{ background: var\(--foreground\); \}/);                                    // white on hover
  assert.doesNotMatch(HTML, /\.ws-bars\.scrub \.ws-bar i \{ opacity/);
});

test("Weekend bars: Leave and Holiday are thin striped bars at a half day's height", () => {
  const r = extract('function _renderWkndSummary(');
  assert.match(r, /const cls = rest \? 'rest' : off \? 'off' : '';/);
  assert.match(r, /const h = rest \? Math\.min\(100, Math\.round\(daily \/ 2 \/ top \* 100\)\)/);
  const HTML = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  assert.match(HTML, /#wsHatch path \{ stroke:/);   // thin lines from one SVG tile: every line the same weight
  assert.match(HTML, /<pattern id="wsHatch" width="6" height="6" patternUnits="userSpaceOnUse">/);   // shared defs on Home (weekend + Statistics)
});

test('Weekend total rolls (NumberFlow) to the hovered day and back', () => {
  assert.equal((SRC.match(/function _odoSet\(/g) || []).length, 1);                    // one rolling-number helper, the existing one
  const r = extract('function _renderWkndSummary(');
  assert.match(r, /const rollTo = v => \{ if \(v === hero\._secs\) return; hero\._secs = v; _odoSet\(hero, heroText\(v\)\); \};/);
  const heroText = load('const p2 = n => String(n).padStart(2, "0");\n' + r.match(/const heroText = v => \{[^\n]*\};/)[0], { Math }, 'heroText');
  assert.equal(heroText(0), '0h 00m'); assert.equal(heroText(45 * 60), '0h 45m'); assert.equal(heroText(77520), '21h 32m');   // one shape, so it always rolls
  assert.match(r, /_loadLib\('numberflow'\)/);
  assert.match(r, /vary\.innerHTML = typeChip \+ times \+ verdict;\n\s*rollTo\(secs\[i\]\);/);  // hover → that day's hours
  assert.match(r, /rollTo\(heroSecs\);/);                                               // leave → the week again
});

test('NumberFlow matches its integrity hash byte for byte (no CRLF on Windows)', () => {
  const crypto = require('node:crypto');
  const bytes = fs.readFileSync(path.join(WEB, 'lib', 'number-flow.js'));          // a Buffer: raw bytes
  const hash = 'sha384-' + crypto.createHash('sha384').update(bytes).digest('base64');
  assert.ok(SRC.includes(hash), `index-app.js must load number-flow.js with ${hash}`);
  assert.match(fs.readFileSync(path.join(ROOT, '.gitattributes'), 'utf8'), /^public\/lib\/number-flow\.js -text$/m);
});

test("Weekend chart: the dashed line is this week's longest day, not a fixed 9h", () => {
  const r = extract('function _renderWkndSummary(');
  assert.match(r, /const best = Math\.max\(0, \.\.\.secs\);\n\s*const top = best > 0 \? best \* 1\.12 : daily;/);
  assert.match(r, /best > 0 \? `<span class="ws-target" style="bottom:\$\{Math\.round\(best \/ top \* 100\)\}%"><em>\$\{_rcRemainingFmt\(best\)\}<\/em><\/span>` : ''/);
  assert.doesNotMatch(r, /<em>\$\{_rcRemainingFmt\(daily\)\}<\/em>/);
});

test('Surfaces use Cool graphite in light and dark, on every page', () => {
  const HTML = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  assert.match(HTML, /--background: #eef0f4; --foreground: #0c0e13; --card: #ffffff;\n\s*--surface-raised: #f6f7fa;\n\s*--muted: #e7eaf0;/);
  assert.match(HTML, /--background: #08090c; --foreground: #eef1f6; --card: #13151a;\n\s*--surface-raised: #1c1f26;\n\s*--muted: #2a2e38;/);
  for (const f of ['index.html', 'login.html', 'about.html', 'privacy.html', 'passkey-desktop.html']) {
    const src = fs.readFileSync(path.join(WEB, f), 'utf8');
    assert.doesNotMatch(src, /#141414|#191919/, `${f} still has the old greys`);
    assert.match(src, /#08090c/, `${f} has the new dark page`);
  }
});

test('Cool greys: text and chart greys share the blue tint; chart text is at least 12px', () => {
  const HTML = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  assert.match(HTML, /--muted-fg: #545b69; --text-muted: #747c8a;/);          // light
  assert.match(HTML, /--muted-fg: #a9b0bd; --text-muted: #828a98;/);          // dark
  assert.match(HTML, /--border: #22262f; --border-subtle: #1a1d24;/);         // quieter dark strokes
  assert.match(HTML, /\.ws-target em \{[^}]*font: 500 12px/);
  assert.match(HTML, /\.ws-l \{[^}]*font-size: 12px/);
});

test('No text under 12px anywhere in 5pm (user rule, 2026-11-14)', () => {
  const tooSmall = /font-size:\s?(?:[0-9]|1[01])(?:\.[0-9]+)?px|font:\s?[0-9]{3}\s(?:[0-9]|1[01])(?:\.[0-9]+)?px/g;
  for (const f of ['index.html', 'login.html', 'about.html', 'privacy.html', 'passkey-desktop.html', 'lib/pages/index-app.js', 'lib/pages/tour.js', 'lib/pages/index-extras.js']) {
    const p = path.join(WEB, f); if (!fs.existsSync(p)) continue;
    const hits = fs.readFileSync(p, 'utf8').match(tooSmall) || [];
    assert.deepEqual(hits, [], `${f} has text under 12px: ${hits.join(', ')}`);
  }
});

test('Dark status colours are the soft set, and day types use theme tokens', () => {
  const HTML = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  const dark = HTML.match(/\n    \.dark \{[\s\S]*?\n    \}/)[0];
  for (const tok of ['--success: #74c7a0', '--warning: #deb97f', '--destructive: #d57c8e', '--blue: #89bad9',
    '--violet: #a39bd9', '--orchid: #ca93d2', '--teal: #68c6b8', '--success-bg: #1f2a2a', '--warning-bg: #2b2926'])
    assert.ok(dark.includes(tok), tok);
  // No bright hard-coded day-type / status colours left in the app script.
  assert.doesNotMatch(SRC, /#0ea5e9|#a855f7|#3b82f6|#22c55e|rgba\(168,85,247|rgba\(14,165,233|rgba\(59,130,246|rgba\(34,197,94/);
  assert.match(extract('function _attChip('), /'Half Day': \{ bg: 'color-mix\(in srgb, var\(--teal\) 14%, transparent\)'/);
});

test('Appearance cards: the selected card is filled, never ringed', () => {
  const HTML = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  const ring = HTML.match(/\.rc-ring \{[^}]*\}/)[0];
  assert.match(ring, /background: var\(--muted\)/);
  assert.doesNotMatch(ring, /border:/);
  assert.match(HTML, /\.rc-cards\.ringed \.rc-card\.active \{ border-color: transparent; \}/);
  const place = extract('function _placeThemeRing(');
  assert.match(place, /translate\(\$\{on\.offsetLeft\}px, \$\{on\.offsetTop\}px\)/);
});

test('Appearance cards: the active card shows a filled icon', () => {
  const HTML = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  assert.match(HTML, /\.rc-card\.active \.rc-ic svg > \* \{ fill: currentColor; \}/);
  assert.doesNotMatch(HTML, /class="rc-dot"|class="rc-d"/);
});

test('Backup codes keep two-step on, and new passwords need 8 characters', () => {
  const MIG = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261115120000_backup_codes_keep_two_step.sql'), 'utf8');
  // The code is marked used and the session is remembered; factors are never deleted.
  assert.match(MIG, /update public\.mfa_backup_codes set used_at = now\(\)/);
  assert.match(MIG, /insert into public\.mfa_backup_sessions/);
  assert.doesNotMatch(MIG, /delete from auth\.mfa_factors/);
  assert.match(MIG, /references auth\.sessions \(id\) on delete cascade/);
  assert.match(MIG, />= 10 then/);
  // Login page and the app's gate ask the database before asking for a code again.
  assert.match(LOGIN, /rpc\('mfa_satisfied'\)/);
  const GATE = fs.readFileSync(path.join(WEB, 'lib', 'pages', 'index-auth-gate.js'), 'utf8');
  assert.match(GATE, /rpc\('mfa_satisfied'\)/);
  assert.doesNotMatch(LOGIN, /Two-factor is off/);
  // 8-character minimum for new passwords, in both places.
  assert.match(LOGIN, /if \(p\.value\.length < 8\) return shortPw\(p\);/);
  assert.match(SRC, /pwd\.length < 8\) \{ showErr\('Use at least 8 characters/);
  assert.doesNotMatch(SRC, /pwd\.length < 6/);
});

test('Note editor: Cancel and Save sit inside the note box, on their own row (#49)', () => {
  const HTML = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  const r = extract('function _renderWkndSummary(');
  // One box: the text area, then a row that holds only the two buttons.
  assert.match(r, /<div class="ws-edit"><textarea class="ws-ta"[^>]*><\/textarea><div class="ws-acts"><button[^>]*data-ws="cancel">Cancel<\/button><button[^>]*data-ws="save">Save<\/button><\/div><\/div>/);
  assert.doesNotMatch(r, /ws-nb/);
  assert.match(HTML, /\.ws-edit \{ display: flex; flex-direction: column;/);
  assert.match(HTML, /\.ws-ta \{[^}]*border: 0;/);   // the box draws the border, not the text area
  assert.doesNotMatch(HTML, /\.ws-nb \{/);
});

test('Weekend card is flat, View Stats sits below the Home card (#50)', () => {
  const HTML = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  assert.match(HTML, /\.ws-card \{ margin-bottom: 4px; text-align: left; \}/);       // no inner card surface
  assert.doesNotMatch(HTML, /\.ws-card \{[^}]*(background|border):/);
  // The button lives after the Home card, shown only while the weekend summary is on.
  const after = HTML.slice(HTML.indexOf('<!-- /homeCard -->'));
  assert.match(after.slice(0, 600), /<div id="wkndStatsOut">[\s\S]*data-on-click="ha2992aba2f"[\s\S]*View Stats/);
  const inside = HTML.slice(HTML.indexOf('id="wkndStatsSection"'), HTML.indexOf('<!-- /homeCard -->'));
  assert.doesNotMatch(inside, /View Stats/);
  assert.match(HTML, /#homeMain:has\(#rcBody\.weekend-mode #weekendView\.ws-on\) #wkndStatsOut \{ display: block; \}/);
  assert.match(SRC, /el\('weekendView'\)\?\.classList\.toggle\('ws-on', _isWeekendType\)/);
});

test('Weekend chart: day letters inside the bars, no letter row, 112px plot (#48)', () => {
  const HTML = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  const r = extract('function _renderWkndSummary(');
  assert.match(r, /<i>\$\{hatch\}<\/i><b class="ws-l" aria-hidden="true">\$\{FULL\[wk\[i\]\.date\.getDay\(\)\]\[0\]\}<\/b><\/span>/);
  assert.doesNotMatch(r, /ws-letters/);
  assert.doesNotMatch(HTML, /\.ws-letters/);
  assert.match(HTML, /\.ws-plot \{ position: relative; height: 112px; \}/);
  assert.match(HTML, /\.ws-bar\.hot \.ws-l \{ color: var\(--card\); \}/);   // dark on the white bar
});

test('Destructive button: one red component, Primary / Secondary / Tertiary (#43)', () => {
  const HTML = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  const all = [HTML, SRC, LOGIN, fs.readFileSync(path.join(WEB, 'login.html'), 'utf8')].join('\n');
  assert.doesNotMatch(all, /btn-ghost-destructive|btn-ghost-danger/);              // the old outlined styles are gone
  assert.match(HTML, /--danger-solid: #c42b33; --danger-solid-hover: #b4232b; --danger-solid-press: #9f1f26;/);   // light
  assert.match(HTML, /--danger-solid: #d2373d; --danger-solid-hover: #c9323a; --danger-solid-press: #b4232b;/);   // dark
  assert.match(HTML, /\.btn-danger \{ background: var\(--danger-solid\); color: #fff; \}/);
  assert.match(HTML, /\.btn-danger-2 \{ background: var\(--btn-secondary-bg\); color: var\(--danger-text\); \}/);
  assert.match(HTML, /\.btn-danger-2:hover:not\(:disabled\) \{ background: var\(--danger-solid-hover\); color: #fff; \}/);
  assert.match(HTML, /\.btn-danger-3:hover:not\(:disabled\) \{ background: var\(--danger-tint\); \}/);
  assert.doesNotMatch(HTML.slice(HTML.indexOf('.btn-danger, .btn-danger-2, .btn-danger-3 {'), HTML.indexOf('@keyframes btn-danger-spin')), /border: 1px/);  // borderless
  // Confirms in destructive dialogs are solid red; the loading state keeps the label.
  for (const id of ['pkRemoveBtn', 'delPwdContinueBtn', 'mfaDisableBtn', 'cancelPlanConfirmBtn']) assert.match(HTML, new RegExp(`class="btn-danger"[^>]*id="${id}"|id="${id}"[^>]*class="btn-danger"`));
  const busy = load(extract('function _btnBusy(', '}') + '\n' + extract('function _btnIdle(', '}'), {}, '({ _btnBusy, _btnIdle })');
  const btn = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; } };
  busy._btnBusy(btn, 'Logging Out');
  assert.equal(btn.disabled, true); assert.equal(btn.attrs['aria-busy'], 'true'); assert.equal(btn.textContent, 'Logging Out');
  busy._btnIdle(btn, 'Log Out');
  assert.equal(btn.disabled, false); assert.equal(btn.attrs['aria-busy'], undefined);
});

test('Progress bar: slim 12px track, lines + target line, minute steps, hover time (#44)', () => {
  const HTML = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  assert.match(HTML, /\.rc-progress-track \{ --h: 12px; height: var\(--h\);[^}]*clip-path: inset\(0 round calc\(var\(--h\) \/ 2\)\);[^}]*cursor: default;/);
  assert.match(HTML, /repeating-linear-gradient\(90deg, var\(--pb-line\) 0 2px, transparent 2px 7px\)/);   // one gradient, not a node per line
  assert.match(HTML, /<div class="pb-tip" id="pbTip" aria-hidden="true"><\/div>/);
  assert.doesNotMatch(HTML, /\.pb-[a-z]+ \{[^}]*cursor: (pointer|crosshair)/);
  const fns = load(extract('function _pbWidth(') + '\n' + extract('function _pbTipText('), {
    Math, p2: n => String(n).padStart(2, '0'),
    short: d => `${d.getUTCHours() % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, '0')} ${d.getUTCHours() >= 12 ? 'PM' : 'AM'}`,
  }, '({ _pbWidth, _pbTipText })');
  // Whole minutes only: 9h target, 1h 00m 50s worked → exactly 60 of 540 minutes.
  assert.equal(fns._pbWidth(3650 / 32400, 32400), fns._pbWidth(3600 / 32400, 32400));
  assert.equal(fns._pbWidth(2, 32400), '100%');
  // Started 9:05 AM (UTC in the stand-in), 9h target, 2h worked.
  const start = Date.UTC(2026, 10, 16, 9, 5);
  const ahead = fns._pbTipText(7 / 9, 32400, 7200, start);
  assert.deepEqual([ahead.title, ahead.sub], ['By 4:05 PM', '7h 00m done · 78%']);
  const behind = fns._pbTipText(0.1, 32400, 7200, start);     // 54 min → snapped to 55
  assert.deepEqual([behind.title, behind.sub], ['10:00 AM', '0h 55m done · 10%']);
});

test('Day types share one icon + colour set across the app (#32)', () => {
  const HTML = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  const T = load(extract('const WK_ICON = {', '\n    };') + '\n' + extract('const DAY_TYPES = {', '\n    };'), {}, '({ WK_ICON, DAY_TYPES })');
  assert.deepEqual(Object.fromEntries(Object.entries(T.DAY_TYPES).map(([k, v]) => [k, v.tone])),
    { fullday: '', halfday: 'teal', leave: 'blue', holiday: 'orchid', weekend: '' });
  // Today panel draws the very same icons (uncoloured).
  for (const plan of ['fullday', 'halfday', 'leave', 'holiday']) {
    const btn = HTML.match(new RegExp(String.raw`data-plan="${plan}"[^>]*><svg[^>]*>([\s\S]*?)</svg>`));
    assert.equal(btn[1], T.WK_ICON[T.DAY_TYPES[plan].icon], plan);
  }
  // The week card's tones match the table.
  const meta = extract('function wkDayModel(');
  assert.match(meta, /label: 'Holiday'[^\n]*tone: 'orchid', icon: 'holiday'/);
  assert.match(meta, /label: 'On leave'[^\n]*tone: 'blue', icon: 'leave'/);
  assert.match(meta, /label: 'Half day'[^\n]*tone: 'teal', icon: 'halfday'/);
});

test('Ended-day card: type label, pencil, total, verdict, times, note (#31)', () => {
  const HTML = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  const code = [extract('const WK_ICON = {', '\n    };'), extract('const DAY_TYPES = {', '\n    };'),
    'const wkSvg = n => `<svg>${WK_ICON[n] ? n : "?"}</svg>`;', extract('function _rcRemainingFmt('), extract('function _minsGap(', '}'),
    extract('function _dayVerdictText('), extract('function _dayVerdictHtml('), extract('function _endedDayCardHtml(')].join('\n');
  const f = load(code, { Math, p2: n => String(n).padStart(2, '0'), todayKey: () => '2026-11-16', _escHtml: s => String(s) }, '_endedDayCardHtml');
  const full = f({ key: '2026-11-13', type: 'fullday', worked: 8 * 3600 + 24 * 60, target: 9 * 3600, login: '10:20 AM', out: '06:44 PM' });
  assert.match(full, /<span class="dt-pill ed-pill"><svg>fullday<\/svg>Full Day<\/span>/);
  assert.match(full, /data-ed="edit" aria-label="Edit day"[^>]*><svg>pencil<\/svg>/);
  assert.match(full, /<div class="ed-total">8h 24m<\/div>/);
  assert.match(full, /36m short of your 9h/);
  assert.match(full, /<svg>sunrise<\/svg><span>Started<\/span><b>10:20 AM<\/b>[\s\S]*<span>Left at<\/span><b>06:44 PM<\/b>/);
  assert.doesNotMatch(full, /ed-note/);                         // full days: no note box
  const leave = f({ key: '2026-11-16', type: 'leave', worked: 0 });
  assert.match(leave, /style="--dt:var\(--blue\)"><svg>leave<\/svg>On Leave/);
  assert.match(leave, /<div class="ed-title">Day off<\/div><p class="ed-sub">No hours today\. Your week adjusts\.<\/p>/);
  assert.match(leave, /class="ed-note" data-ed="note"><svg>plus<\/svg><span>Add a note<\/span>/);
  const hol = f({ key: '2026-11-11', type: 'holiday', worked: 3600, login: '9:00 AM', out: '10:00 AM', note: 'Diwali' });
  assert.match(hol, /All extra, on top of your week/);
  assert.match(hol, /class="ed-note has" data-ed="note"><svg>note<\/svg><span>Diwali<\/span>/);
  const none = f({ key: '2026-11-10', type: 'noentry' });
  assert.match(none, /<svg>noentry<\/svg>No entry[\s\S]*aria-label="Add entry"[\s\S]*Nothing was logged on this day\./);
  assert.match(HTML, /\.ed-total \{ font-size: 36px;/);
  assert.match(HTML, /@media \(max-width: 640px\) \{ \.ed-total \{ font-size: 32px; \} \}/);
  assert.doesNotMatch(SRC, /_pastDayKpiHtml|_updateEntryBtnHtml/);
});

// ── Statistics card (#7) ───────────────────────────────────────────────────
function statsSandbox() {
  const code = [extract("const _SX_MON = [", "];"), extract("const _sxMd = ", ";"), extract('function _statsPeriod('), extract('function _statsSummary('),
    extract('function _statsDateLabels('), extract('function wkSigned('), extract('const _wsGap = ', ';'), extract('function _minsGap(', '}'), extract('function _statsVerdict(')].join('\n');
  return load(code + '\nthis.out = { _statsPeriod, _statsSummary, _statsDateLabels, _statsVerdict };', { Math, p2 }, 'out');
}
test('Statistics: Month periods (salary cycle, last 30 days, this month)', () => {
  const { _statsPeriod } = statsSandbox();
  const now = new Date(2026, 10, 13);
  assert.equal(_statsPeriod('cycle', now, 26).sub, 'Oct 26 – Nov 25');
  assert.equal(_statsPeriod('cycle', new Date(2026, 10, 27), 26).sub, 'Nov 26 – Dec 25');
  assert.equal(_statsPeriod('cycle', now, 1).sub, 'Nov 1 – Nov 30', 'day 1 = calendar month');
  assert.equal(_statsPeriod('last30', now, 26).sub, 'Oct 15 – Nov 13');
  assert.equal(_statsPeriod('month', now, 26).sub, 'Nov 1 – Nov 30');
  assert.equal(_statsPeriod('cycle', new Date(2027, 0, 5), 26).sub, 'Dec 26 – Jan 25', 'crosses the year');
});
test('Statistics: longest / average / shortest skip leave, holiday and empty days', () => {
  const { _statsSummary } = statsSandbox();
  const H = 3600, row = (kind, secs, tgt = 9 * H) => ({ kind, secs, tgt });
  const s = _statsSummary([row('work', 8.5 * H), row('leave', 0, 0), row('work', 9.5 * H), row('none', 0), row('half', 4 * H, 4.5 * H), row('later', 0)]);
  assert.equal(s.n, 3); assert.equal(s.max, 9.5 * H); assert.equal(s.iMax, 2); assert.equal(s.min, 4 * H); assert.equal(s.iMin, 4);
  assert.equal(s.avg, Math.round(22 * H / 3)); assert.equal(s.avgTgt, Math.round(22.5 * H / 3));
  assert.equal(_statsSummary([row('holiday', 3 * H, 0), row('none', 0)]), null);
});
test('Statistics: month date labels keep 52px apart, first > month change > last > Monday', () => {
  const { _statsDateLabels } = statsSandbox();
  const dates = []; for (let d = new Date(2026, 9, 26); d <= new Date(2026, 10, 13); d.setDate(d.getDate() + 1)) if (d.getDay() % 6) dates.push(new Date(d));
  const L = _statsDateLabels(dates, 400);
  assert.equal(L[0].i, 0); assert.equal(L[0].mo, true);
  assert.ok(L.some(c => c.mo && dates[c.i].getDate() === 2 && dates[c.i].getMonth() === 10), 'Nov 2 is a month change');
  assert.equal(L[L.length - 1].i, dates.length - 1, 'last bar labelled');
  for (let k = 1; k < L.length; k++) assert.ok(L[k].cx - L[k - 1].cx >= 52);
  assert.equal(_statsDateLabels(dates, 120).length, 2, 'narrow: only the first and the month change fit');
});
test('Statistics: verdict uses the week card words', () => {
  const { _statsVerdict } = statsSandbox();
  assert.deepEqual({ ..._statsVerdict(8 * 3600 + 2 * 60, 9 * 3600) }, { text: '58mins short', tone: '' });
  assert.deepEqual({ ..._statsVerdict(9 * 3600 + 120, 9 * 3600) }, { text: 'On target', tone: 'ok' });
  assert.deepEqual({ ..._statsVerdict(10 * 3600 + 5 * 60, 9 * 3600) }, { text: '1h 05mins over', tone: 'warn' });
  const HTML = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  assert.match(HTML, /<section class="sx-card" id="sxCard"/);
  assert.equal((HTML.match(/id="wsHatch"/g) || []).length, 1, 'one shared hatch pattern');
  assert.doesNotMatch(SRC, /<pattern id="wsHatch"/);
});

// ── Saved Logins (#42) ─────────────────────────────────────────────────────
test('Saved Logins: count line, hold label, short times; tall cards + Hold to Log Out', () => {
  const ago = load(extract('function _devAgo(') + '\n' + extract('function _devAgoShort('), { Math, Date, isFinite }, '_devAgoShort');
  const iso = s => new Date(Date.now() - s * 1000).toISOString();
  assert.equal(ago(iso(5 * 3600 + 10)), '5h ago'); assert.equal(ago(iso(12 * 60 + 5)), '12m ago');
  assert.equal(ago(iso(3 * 86400 + 5)), '3d ago'); assert.equal(ago(iso(10)), 'just now');
  const f = load(extract('function _devCountLine(', '; }') + '\n' + extract('function _devHoldLabel(', '; }') + '\nthis.o={_devCountLine,_devHoldLabel}', {}, 'o');
  assert.equal(f._devCountLine(7), "You're signed in on 7 devices."); assert.equal(f._devCountLine(1), "You're signed in on 1 device.");
  assert.equal(f._devHoldLabel(6), 'Hold to Log Out 6 Devices'); assert.equal(f._devHoldLabel(1), 'Hold to Log Out 1 Device');
  const HTML = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  assert.match(HTML, /<button type="button" class="sl-hold" id="devRevokeOthersBtn">/);
  assert.match(HTML, /You stay signed in on this device\./);
  assert.match(HTML, /\.sl-grid \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  // Touch: Log Out always visible (only the mouse hides it until hover).
  assert.match(HTML, /@media \(hover: hover\) and \(pointer: fine\) \{\n\s+\.sl-out \{ opacity: 0;/);
  assert.match(extract('function _slHoldInit('), /ms = 1200/);
});

// ── Update Entry sheet (#34) ───────────────────────────────────────────────
test('Update Entry: live line, recorded card, synced day-type control, pinned footer', () => {
  const f = load(extract('function _deLiveLine(') + '\n' + extract('function _deRecordedText(') + '\nthis.o={_deLiveLine,_deRecordedText}', { Math, p2 }, 'o');
  assert.equal(f._deLiveLine('Monday', 'fullday', 8 * 3600 + 24 * 60, 9 * 3600), 'That makes Monday 8h 24m');
  assert.equal(f._deLiveLine('Monday', 'leave', 0, 9 * 3600), 'No hours for a day off. Your week adjusts.');
  assert.equal(f._deLiveLine('Friday', 'holiday', 3600, 9 * 3600), 'No hours for a day off. Your week adjusts.');
  assert.equal(f._deLiveLine('Monday', 'halfday', 0, 9 * 3600), 'Counts as 4h 30m toward your week.');
  assert.equal(f._deLiveLine('Monday', 'fullday', 0, 9 * 3600), '');
  assert.equal(f._deRecordedText('10:20 AM', '06:44 PM', 8 * 3600 + 24 * 60), '10:20 AM – 06:44 PM · 8h 24m');
  assert.equal(f._deRecordedText('', '—', 0), 'No times for this day');
  const HTML = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  for (const t of ['fullday', 'halfday', 'leave', 'holiday']) assert.match(HTML, new RegExp(`role="radio" data-type="${t}"`));
  assert.match(extract('function _deTypeInit('), /DAY_TYPES\[b\.dataset\.type\][\s\S]*wkSvg\(t\.icon\)/);
  assert.match(HTML, /#deMainPage \.de-body \{ flex: 1 1 auto; min-height: 0; overflow-y: auto;/);
  assert.match(HTML, /#deMainPage \.de-foot \{ flex: none;/);
  assert.match(HTML, /<button class="btn btn-primary" id="deDisputeNext">Draft email<\/button>/);
});

// ── Action Center (#39) ────────────────────────────────────────────────────
test('Action Center: rows are single short days; weekly mode lists the short days of short finished weeks', () => {
  const p2_ = n => String(n).padStart(2, '0');
  const sb = { Math, Date, Map, Array, dateKey: d => `${d.getFullYear()}-${p2_(d.getMonth() + 1)}-${p2_(d.getDate())}` };
  const f = load(extract('function _acDur(', '; }') + '\n' + extract('function _acShortDays(') + '\nthis.o={_acDur,_acShortDays}', sb, 'o');
  assert.equal(f._acDur(95 * 60), '1h 35m'); assert.equal(f._acDur(7200), '2h'); assert.equal(f._acDur(45 * 60), '45m');
  const H = 3600, logs = {
    '2026-11-02': { hoursWorked: 9 }, '2026-11-03': { hoursWorked: 7.5 }, '2026-11-04': { hoursWorked: 9.5 }, '2026-11-05': { hoursWorked: 0, override: 'leave' }, '2026-11-06': { hoursWorked: 4, override: 'halfday' },
    '2026-11-09': { hoursWorked: 8 }, '2026-11-10': { hoursWorked: 10 }, '2026-11-11': { hoursWorked: 10 }, '2026-11-12': { hoursWorked: 10 }, '2026-11-13': { hoursWorked: 10 },
  };
  const dates = []; for (let d = new Date(2026, 10, 2); d <= new Date(2026, 10, 13); d.setDate(d.getDate() + 1)) if (d.getDay() % 6) dates.push(new Date(d));
  const daily = f._acShortDays(dates, k => logs[k], { dailyH: 9, weeklyOn: false, workDays: 5 }, '2026-11-15', () => 0);
  assert.deepEqual(Array.from(daily, r => r.key), ['2026-11-03', '2026-11-06', '2026-11-09'], 'leave skipped; half day vs 4h 30m');
  assert.equal(daily[1].half, true); assert.equal(daily[1].tgt, 4.5 * H);
  // Weekly: week of Nov 2 = 30h vs 45h - 9h leave = 36h → short; week of Nov 9 = 48h → fine.
  const wt = days => days.reduce((a, x) => a + (logs[x.key]?.override === 'leave' ? 0 : logs[x.key]?.override === 'halfday' ? 4.5 * H : 9 * H), 0);
  const weekly = f._acShortDays(dates, k => logs[k], { dailyH: 9, weeklyOn: true, workDays: 5 }, '2026-11-15', wt);
  assert.deepEqual(Array.from(weekly, r => r.key), ['2026-11-03', '2026-11-06']);
  // An unfinished week never lists its days.
  assert.equal(f._acShortDays(dates, k => logs[k], { dailyH: 9, weeklyOn: true, workDays: 5 }, '2026-11-05', wt).length, 0);
});
test('Action Center: card copy, read filter, clear confirm, empty state', () => {
  const r = extract('function _renderPenaltyCard(');
  assert.match(r, /Action Center/); assert.match(r, /Mark all as read/); assert.match(r, /Show read penalties/); assert.match(r, /Clear all penalties/);
  assert.match(r, /This Week' : 'This Month'/); assert.match(r, /Salary cycle · \$\{data\.cycle\.sub\}/);
  assert.match(r, /Yay, nothing to resolve/); assert.match(r, /All caught up/);
  assert.match(r, /Clear all \$\{rows\.length\}/);
  const m = extract('function _acOpenRowMenu(');
  assert.match(m, /Draft email to manager/); assert.match(m, /Fix my hours/); assert.match(m, /Mark as unread' : 'Mark as read/);
  assert.match(extract('function _acMarkAllRead('), /label: 'Undo'/);
  const HTML = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  assert.doesNotMatch(HTML, /Your Penalties/);
});

// ── Salary Cycle + Penalty Reminders (#41) ─────────────────────────────────
function paySandbox() {
  const code = [extract('const _SX_MON = [', '];'), extract('const _sxMd = ', ';'), extract('function _statsPeriod('), extract('const _ord = ', ';'),
    extract('function _cycleValue(', '; }'), extract('function _cycleRepeats('), extract('function _cycleSuggestTo(', '; }'), extract('const _scDays = ', ';'),
    extract('function _scProblem('), extract('function _payrollNudge(')].join('\n');
  return load(code + '\nthis.o = { _statsPeriod, _cycleValue, _cycleRepeats, _cycleSuggestTo, _scProblem, _payrollNudge };',
    { Math, Date, FULL_DAYS_EN: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] }, 'o');
}
test('Salary Cycle: start and end days, the suggested To, the row value and summary', () => {
  const f = paySandbox(), now = new Date(2026, 10, 13);
  assert.equal(f._statsPeriod('cycle', now, 26, 25).sub, 'Oct 26 – Nov 25');
  assert.equal(f._statsPeriod('cycle', now, 26, 24).sub, 'Oct 26 – Nov 24', 'a custom last day');
  assert.equal(f._statsPeriod('cycle', new Date(2027, 0, 30), 1, 31).sub, 'Jan 1 – Jan 31');
  assert.equal(f._statsPeriod('cycle', new Date(2027, 1, 10), 1, 31).sub, 'Feb 1 – Feb 28', 'clamped to the month');
  assert.equal(f._statsPeriod('cycle', new Date(2027, 1, 10), 28, 27).sub, 'Jan 28 – Feb 27');
  const to = f._cycleSuggestTo(new Date(2026, 9, 26)); assert.equal(`${to.getMonth()}-${to.getDate()}`, '10-25', 'Oct 26 → Nov 25');
  assert.equal(f._cycleValue(26, 25), '26th – 25th'); assert.equal(f._cycleValue(1, 31), '1st – last day'); assert.equal(f._cycleValue(22, 21), '22nd – 21st');
  assert.equal(f._cycleRepeats(26, 25), 'Repeats every month, the 26th to the 25th of the next month.');
  assert.equal(f._scProblem(new Date(2026, 9, 26), new Date(2026, 10, 25)), null);
  assert.match(f._scProblem(new Date(2026, 9, 30), new Date(2026, 10, 29)), /1st to the 28th/);
  assert.match(f._scProblem(new Date(2026, 9, 26), new Date(2026, 10, 5)), /28 to 31 days/);
});
test('Penalty Reminders: gates, then the first matching rung of the ladder', () => {
  const f = paySandbox();
  const base = { on: true, open: 2, today: new Date(2026, 10, 19), close: new Date(2026, 10, 25), sentToday: false, weekday: true };
  const N = (ev, x) => f._payrollNudge(ev, { ...base, ...x });
  // Rung 1: a future day saved as leave/holiday, right after saving.
  assert.deepEqual({ ...N('dayoff', { offDate: new Date(2026, 10, 20) }) }, { rung: 1, title: 'Before Your Day Off', body: 'Resolve 2 penalties before Friday. Salary cycle closes Nov 25.' });
  assert.equal(N('dayoff', { offDate: new Date(2026, 10, 19) }), null, 'not a future day');
  assert.equal(N('dayoff', { tomorrowOff: true }), null, 'never outside its moments');
  assert.equal(N('target', { tomorrowOff: true }).title, 'Off Tomorrow');
  assert.equal(N('end', { tomorrowOff: true }).body, 'Resolve 2 penalties before you go.');
  assert.equal(N('end', { halfDay: true }).title, 'Half Day Done');
  assert.equal(N('target', { shortDay: true }).body, 'Use the extra time to resolve 2 penalties.');
  assert.equal(N('end', { shortDay: true }), null, 'short day only at its shorter target');
  assert.equal(N('end', { lastWeekday: true, today: new Date(2026, 10, 24) }).title, 'Salary Cycle Closes Tomorrow');
  assert.equal(N('end', { lastWeekday: true, today: new Date(2026, 10, 20), close: new Date(2026, 10, 23) }).title, 'Salary Cycle Closes Monday');
  assert.equal(N('target', { lastWeekday: true, open: 1, today: new Date(2026, 10, 24) }).body, 'Resolve 1 penalty so your attendance is right.');
  // Gates
  for (const x of [{ on: false }, { open: 0 }, { sentToday: true }, { weekday: false }, { today: new Date(2026, 10, 17) }, { today: new Date(2026, 10, 26) }])
    assert.equal(N('target', { ...x, tomorrowOff: true }), null, JSON.stringify(x));
  assert.equal(N('target', {}), null, 'no rung matches: nothing');
  // Wiring: the moments, one a day in synced settings, the panel's Review.
  assert.match(extract('function endSession('), /_payrollCheck\('end'\)/);
  assert.match(SRC, /_payrollCheck\('dayoff', key\)/);
  assert.match(extract('function _payrollSchedule('), /_payrollCheck\('target'\)/);
  assert.match(extract('function buildNotifs('), /cta: 'Review', ctaWeekKey: ''/);
  const HTML = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  assert.match(HTML, /<div class="settings-section-header">Payroll<\/div>/);
  assert.match(HTML, /Pick the first and last day your company counts for one month's pay\./);
});
test('Action Center: marking as read keeps the row in place, muted and labelled Read', () => {
  const m = extract('function _acOpenRowMenu(');
  assert.doesNotMatch(m, /_dismissPenaltyRow/);
  assert.match(m, /_acKeepRead\.add\(key\)/);
  const all = extract('function _acMarkAllRead(');
  assert.doesNotMatch(all, /_dismissPenaltyRow/);
  assert.match(all, /_acKeepRead\.add\(r\.key\)/);
  assert.match(extract('function _acRowHtml('), /\$\{read \? ' · Read' : ''\}/);
  assert.match(extract('function _renderPenaltyCard('), /!_discardedPenalties\.has\(r\.key\) \|\| _acKeepRead\.has\(r\.key\)/);
});

// ── Geist headings (#52) ───────────────────────────────────────────────────
test('Geist: titles and big numbers use the display font, body text stays on --font', () => {
  const HTML = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  assert.match(HTML, /fonts\.googleapis\.com\/css2\?family=Geist:wght@400\.\.700&family=Inter/);
  assert.match(HTML, /--font-display: 'Geist',/);
  const rule = HTML.match(/\n([^\n]*\n){0,3}[^\n]*\{ font-family: var\(--font-display\); \}/)[0];
  for (const c of ['.dialog-title', '.settings-title', '.sx-title', '.ac-title', '.ws-total', '.ed-total', '.sx-total', '.rc-worked', '.am-v'])
    assert.ok(rule.includes(c), c);
  assert.match(HTML, /--font: -apple-system/);   // body font unchanged
});

// ── Login flow (#8) ────────────────────────────────────────────────────────
test('Login: screens, copy and the signed-in page', () => {
  const LHTML = fs.readFileSync(path.join(WEB, 'login.html'), 'utf8');
  for (const id of ['signin', 'twostep', 'backup', 'lost', 'done', 'signup', 'confirm', 'reset', 'other', 'code', 'newpw', 'noAccount'])
    assert.match(LOGIN, new RegExp(`\n  ${id}: \{ h: `), id);
  assert.match(LOGIN, /done: \{ h: \(\) => big\.ok \+ heading\('You’re in', 'Letting you in\.\.\.'\) \}/);   // user, 2026-11-15
  assert.match(LOGIN, /'That email and password don’t match\.'/);                  // one message, never says which emails exist
  assert.match(LOGIN, /resetPasswordForEmail\(email\)/);                            // code, not a link
  assert.match(LOGIN, /verifyOtp\(\{ email: S\.email, token, type: 'recovery' \}\)/);
  assert.match(LOGIN, /mediation: 'conditional'/);                                  // passkey autofill…
  assert.match(LOGIN, /Sign in with a passkey/);                                    // …with a quiet button where it's missing
  assert.match(LOGIN, /window\.showAuthError = function/);                          // the Windows app reports through this
  assert.match(LOGIN, /window\.__desktopStartPasskey/);
  assert.doesNotMatch(LHTML, /theme-btn|toggleTheme/);                              // no theme toggle
  assert.match(LHTML, /family=Geist/);
  assert.match(LHTML, /<div class="viewport" id="vp"/);
  const GATE = fs.readFileSync(path.join(WEB, 'lib', 'pages', 'index-auth-gate.js'), 'utf8');
  assert.match(GATE, /login\.html\?noaccount=/);
  assert.match(GATE, /'\/login\.html\?reason=session'/);
  assert.match(SRC, /login\.html\?reason=elsewhere/);
});
test('Login: errors come back in the page’s words', () => {
  const f = load([extractFrom(LOGIN, 'login.js', 'const _isOffline = ', ';'), extractFrom(LOGIN, 'login.js', 'const _isRate = ', ';'),
    extractFrom(LOGIN, 'login.js', 'function _retrySecs(', '\n}'), extractFrom(LOGIN, 'login.js', 'const esc = ', '[c]));')].join('\n') + '\nthis.o={_isOffline,_isRate,_retrySecs,esc}',
    { navigator: { onLine: true }, String, RegExp }, 'o');
  assert.equal(f._isRate({ status: 429 }), true);
  assert.equal(f._isRate({ message: 'Email rate limit exceeded' }), true);
  assert.equal(f._isOffline({ message: 'Failed to fetch' }), true);
  assert.equal(f._isOffline({ message: 'Invalid login credentials' }), false);
  assert.equal(f._retrySecs({ message: 'For security purposes, you can only request this after 42 seconds.' }), 42);
  assert.equal(f._retrySecs({ message: 'Too many requests' }), 0);
  assert.equal(f.esc('<b>"x"</b>'), '&lt;b&gt;&quot;x&quot;&lt;/b&gt;');
});
test('Backup codes: save screen, running low, make new codes, Home notice, 404', () => {
  const HTML = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  for (const id of ['mfaViewBackup', 'mfaViewLow', 'mfaViewRegen']) assert.match(HTML, new RegExp(`id="${id}"`));
  assert.match(HTML, /Save your backup codes/); assert.match(HTML, /You won’t see these again/);
  assert.match(HTML, /<button type="button" class="ob-btn-primary bk-done" id="bkDoneBtn" disabled>Done<\/button>/);   // ticked box unlocks it
  assert.match(HTML, /class="btn-danger bk-done" id="bkRegenBtn">Make New Codes/);
  const f = load(extract('function _bkFile(') + '\n' + extract('function _bkLeftText(', '; }') + '\n' + extract('function _bkNotice(') + '\nthis.o={_bkFile,_bkLeftText,_bkNotice}', { Date, String }, 'o');
  const file = f._bkFile(['aaaa-bbbb', 'cccc-dddd', 'eeee-ffff'], 'you@company.com');
  assert.match(file, /^5pm backup codes\r\n/); assert.match(file, /Account {3}you@company\.com\r\n/);
  assert.match(file, / {3}1\. {2}aaaa-bbbb {6} 2\. {2}cccc-dddd\r\n/); assert.match(file, /Used some\? Make new codes in 5pm › Settings › Security\./);
  assert.equal(f._bkNotice(2).text, 'You have 2 backup codes left. Make new ones in Settings › Security.');
  assert.equal(f._bkNotice(7).text, 'You have 7 backup codes left.');
  assert.equal(f._bkNotice(1).text, 'You have 1 backup code left. Make new ones in Settings › Security.');
  assert.equal(f._bkNotice(5).ctaWeekKey, 'mfa:low');
  assert.match(LOGIN, /localStorage\.setItem\('5pm_backup_used', '1'\)/);
  const NF = fs.readFileSync(path.join(WEB, '404.html'), 'utf8');
  assert.match(NF, /This page doesn’t exist/); assert.match(NF, /<a class="btn" href="\/">Go to 5pm<\/a>/);
});
