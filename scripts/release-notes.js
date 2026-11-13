// Prints a version's release notes from public/lib/whats-new.js, in the format used on
// GitHub releases (and pasted into the Microsoft Store's "What's new" field).
// Run:  node scripts/release-notes.js 1.2.28 > notes.md
// Also a self-check: fails if an entry is malformed or uses an em dash.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'lib', 'whats-new.js'), 'utf8');
const window = {};
new Function('window', src)(window);
const list = window.WHATS_NEW;

assert.ok(Array.isArray(list) && list.length, 'WHATS_NEW must list at least one release');
for (const e of list) {
  assert.ok(/^\d+\.\d+\.\d+$/.test(e.version), 'bad version: ' + e.version);
  // An improvement is a plain line or { icon, title, line }; GitHub and the
  // Store get the plain line.
  e.improvements = (e.improvements || []).map(x => {
    if (typeof x === 'string') return x;
    assert.ok(x.title && x.line, `${e.version}: an improvement needs a title and a line`);
    return x.line;
  });
  for (const line of [...(e.improvements || []), ...(e.fixes || [])]) {
    assert.ok(!/—/.test(line), `${e.version}: no em dashes: ${line}`);
  }
  for (const line of e.fixes || []) assert.ok(/^Fixed /.test(line), `${e.version}: fixes start with "Fixed": ${line}`);
}

const want = process.argv[2] || list[0].version;
const entry = list.find(e => e.version === want);
if (!entry) { console.error('No What\'s New entry for ' + want + '. Add one to public/lib/whats-new.js.'); process.exit(1); }

const out = [];
if (entry.improvements?.length) out.push('**Improvements**', '', ...entry.improvements, '');
if (entry.fixes?.length) out.push('**Bug Fixes**', '', ...entry.fixes, '');
process.stdout.write(out.join('\n'));
