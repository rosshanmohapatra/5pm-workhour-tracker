// Fails when inline JavaScript is back in any served page: an inline <script>
// block, an on*="" handler attribute (in HTML or in HTML built inside lib/pages
// scripts) or a javascript: URL. The Content Security Policy blocks all of
// those, so they would silently stop working in production.
// Run: node scripts/check-csp.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'public'); // the website lives in public/
const pages = ['index.html', 'login.html', 'about.html', 'privacy.html',
  'passkey-desktop.html', 'oauth/consent/index.html'];
const scripts = fs.readdirSync(path.join(root, 'lib/pages'))
  .filter(f => f.endsWith('.js') && !f.endsWith('-handlers.js'))
  .map(f => 'lib/pages/' + f);

let problems = 0;
for (const rel of [...pages, ...scripts]) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) continue;
  const text = fs.readFileSync(file, 'utf8');
  const checks = [
    [/\son[a-z]+="/g, 'inline on*="" handler'],
    [/javascript:/g, 'javascript: URL'],
  ];
  if (rel.endsWith('.html')) checks.push([/<script(?![^>]*\bsrc=)[^>]*>/g, 'inline <script> block']);
  for (const [re, what] of checks) {
    for (const m of text.matchAll(re)) {
      const line = text.slice(0, m.index).split('\n').length;
      console.error(`${rel}:${line}: ${what}`);
      problems++;
    }
  }
}
if (problems) {
  console.error(`\n${problems} inline script(s) found. Use data-on-<event>="<key>" with lib/pages/*-handlers.js, or addEventListener.`);
  process.exit(1);
}
console.log('No inline script found.');
