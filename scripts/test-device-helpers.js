/**
 * Self-check for the Manage Devices helpers in index.html.
 *
 * These two functions decide what every device row shows, and both are pure
 * logic that is easy to break silently.
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

const src = grab("function _deviceKind(", "function _devicePlatform()");

// _deviceKind reads navigator.maxTouchPoints; give it a controllable stub.
let navigator = { maxTouchPoints: 0 };
const { _deviceKind, _devAgo } =
  new Function('navigator', src + '\n return { _deviceKind, _devAgo };')(
    new Proxy({}, { get: () => navigator.maxTouchPoints })
  );

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

console.log('device helpers: all checks passed');
