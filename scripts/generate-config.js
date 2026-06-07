// scripts/generate-config.js
// Runs at Vercel build time — reads env vars and writes lib/config.js.
// This file is safe to commit; lib/config.js is not.
const fs   = require('fs');
const path = require('path');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error('[generate-config] ERROR: SUPABASE_URL or SUPABASE_ANON_KEY env var is missing.');
  process.exit(1);
}

const content =
  '// Auto-generated at build time — DO NOT COMMIT\n' +
  "window.__SB_URL      = '" + url + "';\n" +
  "window.__SB_ANON_KEY = '" + key + "';\n";

const outPath = path.join(__dirname, '..', 'lib', 'config.js');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, content, 'utf8');
console.log('[generate-config] lib/config.js generated ✓');
