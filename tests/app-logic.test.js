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
const SRC = fs.readFileSync(path.join(ROOT, 'lib', 'pages', 'index-app.js'), 'utf8');

// Source from `start` up to the first `end` after it (functions in index-app.js
// are indented four spaces, so their closing brace is "\n    }").
function extract(start, end = '\n    }') {
  const i = SRC.indexOf(start);
  if (i < 0) throw new Error('Not found in index-app.js: ' + start);
  const j = SRC.indexOf(end, i);
  if (j < 0) throw new Error('No end for: ' + start);
  return SRC.slice(i, j + end.length);
}
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

// ── Release checks ─────────────────────────────────────────────────────────
test('release notes are valid (lib/whats-new.js)', () => {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'release-notes.js')], { stdio: 'pipe' });
});

test('no inline script (Content Security Policy)', () => {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'check-csp.js')], { cwd: ROOT, stdio: 'pipe' });
});

test('every app script parses', () => {
  const files = ['login.js', 'sw.js', ...fs.readdirSync(path.join(ROOT, 'lib', 'pages')).map(f => path.join('lib', 'pages', f))]
    .filter(f => f.endsWith('.js'));
  for (const f of files) execFileSync(process.execPath, ['--check', path.join(ROOT, f)], { stdio: 'pipe' });
});
