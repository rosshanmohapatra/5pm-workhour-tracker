/**
 * Self-check for the Manage Devices helpers in index.html.
 *
 * These four functions decide what every device row shows, and two of them
 * (_devCode, _deviceKind) are pure logic that is easy to break silently.
 * Run with:  node scripts/test-device-helpers.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// Pull the real function bodies out of the page rather than duplicating them,
// so this test fails if the shipped implementation changes.
function grab(startMarker, endMarker) {
  const a = html.indexOf(startMarker);
  const b = html.indexOf(endMarker, a);
  assert.ok(a !== -1 && b !== -1, 'could not locate ' + startMarker.slice(0, 40));
  return html.slice(a, b);
}

const src = grab("const _DEV_ALPHABET", "function _devicePlatform()");

// _deviceKind reads navigator.maxTouchPoints; give it a controllable stub.
let navigator = { maxTouchPoints: 0 };
const { _devCode, _deviceKind, _devAgo, _DEV_ALPHABET } =
  new Function('navigator', src + '\n return { _devCode, _deviceKind, _devAgo, _DEV_ALPHABET };')(
    new Proxy({}, { get: () => navigator.maxTouchPoints })
  );

// ── _devCode ──────────────────────────────────────────────
const ID = '281205c0-171d-41e7-83ef-d78a00200fa6';

assert.strictEqual(_devCode(ID), _devCode(ID), 'must be deterministic');
assert.strictEqual(_devCode(ID).length, 6, 'must be 6 characters');

// The whole point: it must never look like a hex colour.
assert.ok(!/[ABCDEF]/i.test(_devCode(ID)), 'must contain no A-F');
assert.ok(!/^[0-9a-f]{6}$/i.test(_devCode(ID)), 'must not be valid hex');
assert.ok(!/[IOLU]/.test(_devCode(ID)), 'must avoid easily-misread letters');
assert.ok(!/#/.test(_devCode(ID)), 'must not carry a # prefix');

// Every character it can ever emit comes from the safe alphabet.
assert.ok(!/[ABCDEFIOLU]/.test(_DEV_ALPHABET), 'alphabet itself must be safe');

// Distribution. Zero collisions is the wrong bar: 24^6 is ~191M codes, so by
// the birthday bound 50k samples already expect ~6.5 of them. What matters is
// that the hash behaves like a good one, i.e. collisions track that expectation
// instead of clustering. (For the real case, one account with a handful of
// devices, collision odds are around 1 in 10^6.)
const N = 50000;
const seen = new Set();
let collisions = 0;
for (let i = 0; i < N; i++) {
  const code = _devCode('device-' + i + '-' + (i * 7919));
  assert.ok(/^[GHJKMNPQRSTVWXYZ23456789]{6}$/.test(code), 'bad code: ' + code);
  if (seen.has(code)) collisions++;
  seen.add(code);
}
const expected = (N * N) / (2 * Math.pow(24, 6));
assert.ok(collisions < expected * 5,
  'collisions ' + collisions + ' far exceed the expected ~' + expected.toFixed(1) + ' — hash is clustering');

// Avalanche: ids differing by one character must not produce similar codes.
for (const [x, y] of [['device-1', 'device-2'], ['aaaa', 'aaab']]) {
  const cx = _devCode(x), cy = _devCode(y);
  const shared = [...cx].filter((ch, i) => ch === cy[i]).length;
  assert.ok(shared <= 2, 'weak avalanche: ' + cx + ' vs ' + cy);
}

// ── _deviceKind ───────────────────────────────────────────
const UA = {
  win:     'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36',
  mac:     'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120 Safari/537.36',
  iphone:  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Mobile Safari/604.1',
  ipad:    'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Version/17.0 Safari/604.1',
  androidP:'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120 Mobile Safari/537.36',
  androidT:'Mozilla/5.0 (Linux; Android 14; SM-X200) Chrome/120 Safari/537.36',
};
navigator.maxTouchPoints = 0;
assert.strictEqual(_deviceKind(UA.win),      'desktop');
assert.strictEqual(_deviceKind(UA.mac),      'desktop');
assert.strictEqual(_deviceKind(UA.iphone),   'mobile');
assert.strictEqual(_deviceKind(UA.ipad),     'tablet');
assert.strictEqual(_deviceKind(UA.androidP), 'mobile',  'Android phone carries the Mobile token');
assert.strictEqual(_deviceKind(UA.androidT), 'tablet',  'Android tablet omits the Mobile token');
assert.strictEqual(_deviceKind(''),          'desktop', 'unknown UA falls back to desktop');

// iPadOS masquerades as a Mac; only the touch points give it away.
navigator.maxTouchPoints = 5;
assert.strictEqual(_deviceKind(UA.mac), 'tablet', 'touch-capable Mac UA is an iPad');
navigator.maxTouchPoints = 0;

// ── _devAgo ───────────────────────────────────────────────
const ago = s => new Date(Date.now() - s * 1000).toISOString();
assert.strictEqual(_devAgo(ago(5)),        'just now');
assert.strictEqual(_devAgo(ago(59)),       'just now');
assert.strictEqual(_devAgo(ago(60)),       '1 min ago',   'singular');
assert.strictEqual(_devAgo(ago(300)),      '5 mins ago',  'plural');
assert.strictEqual(_devAgo(ago(3600)),     '1 hr ago');
assert.strictEqual(_devAgo(ago(7200)),     '2 hrs ago');
assert.strictEqual(_devAgo(ago(86400)),    '1 day ago');
assert.strictEqual(_devAgo(ago(86400 * 3)),'3 days ago');
assert.strictEqual(_devAgo(null),          '',  'missing timestamp renders nothing');
assert.strictEqual(_devAgo('not a date'),  '',  'unparseable timestamp renders nothing');
assert.strictEqual(_devAgo(ago(-60)),      '',  'a clock-skewed future stamp renders nothing');

console.log('device helpers: all checks passed (' + seen.size + ' unique codes from ' + N + ' ids, ' + collisions + ' collisions, expected ~' + expected.toFixed(1) + ')');
