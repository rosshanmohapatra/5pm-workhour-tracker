/**
 * Self-check for the email draft templates in public/lib/pages/index-app.js
 * (shortfalls, disputes, bug reports).
 * _fillTpl fills {tokens} and drops any line whose token has no value.
 * Run with:  node scripts/test-email-templates.js
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'lib', 'pages', 'index-app.js'), 'utf8');
const a = src.indexOf('const EMAIL_TPL = {');
const b = src.indexOf('// One line per weekday', a);
assert.ok(a !== -1 && b !== -1, 'could not locate the email templates');
const { EMAIL_TPL, _fillTpl, DISPUTE_REASONS } =
  new Function(src.slice(a, b) + '\n return { EMAIL_TPL, _fillTpl, DISPUTE_REASONS };')();

const full = { hi: 'Hi Asha,', dear: 'Dear Asha,', date: 'Monday, Nov 3', range: 'Nov 3–7',
  start: '11:05 AM', end: '06:10 PM', worked: '7h 05m', target: '9h 00m', short: '1h 55m',
  reason: "a doctor's appointment", days: 'Mon 3 Nov: 7h 05m', name: 'Roshan', position: 'Designer',
  description: 'The timer stopped when I locked my phone.', version: '1.2.27', surface: 'website',
  platform: 'Chrome on Windows', details: 'Diagnostics\n\nApp: 5pm 1.2.27, Website' };

// Every format fills every token it uses.
for (const type of ['daily', 'weekly', 'dispute', 'bug']) {
  for (const fmt of Object.keys(EMAIL_TPL[type])) {
    const t = EMAIL_TPL[type][fmt];
    for (const out of [_fillTpl(t.subject, full), _fillTpl(t.body, full)]) {
      assert.ok(!/\{\w+\}/.test(out), `${type}/${fmt} left a token unfilled`);
      assert.ok(!/—/.test(out), `${type}/${fmt} contains an em dash`);
    }
  }
}

// No reason typed: the reason line disappears, and no blank-line pile-up is left.
const noReason = _fillTpl(EMAIL_TPL.daily.formal.body, { ...full, reason: '' });
assert.ok(!/due to/.test(noReason));
assert.ok(!/\n{3,}/.test(noReason));
assert.ok(_fillTpl(EMAIL_TPL.daily.concise.body, full).includes("Reason: a doctor's appointment"));

// Disputes: three formats, each with a Reason line; reasons read after "Reason:".
assert.deepStrictEqual(Object.keys(EMAIL_TPL.dispute).sort(), ['concise', 'detailed', 'formal']);
for (const r of Object.values(DISPUTE_REASONS)) assert.ok(r && !/[.]$/.test(r), 'reason reads after "Reason:", no full stop: ' + r);
for (const fmt of ['concise', 'detailed', 'formal']) assert.ok(_fillTpl(EMAIL_TPL.dispute[fmt].body, full).includes('Reason: ' + full.reason), fmt + ' must state the reason');
// A day with no recorded end drops the End line instead of printing an empty one.
assert.ok(!/End:/.test(_fillTpl(EMAIL_TPL.dispute.concise.body, { ...full, end: '' })));

// Bug report keeps the description and the details block.
const bug = _fillTpl(EMAIL_TPL.bug.concise.body, full);
assert.ok(bug.includes(full.description) && bug.includes(full.description + '\n\n' + full.details));

console.log('email templates: all checks passed');
