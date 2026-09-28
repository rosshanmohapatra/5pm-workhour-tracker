// Copies the web frontend into src-tauri/dist so the desktop build ships its own
// code offline. Data still comes from Supabase over the network.
// Whitelist, not a mirror: the repo root also holds reports, design files and the
// Vercel API functions, none of which belong inside the exe.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'src-tauri', 'dist');

const FILES = [
  'index.html',
  'login.html',
  'login.js',
  'sw.js',
  'manifest.json',
  'brand-dark.svg',
  'brand-light.svg',
  'favicon-dark.svg',
  'favicon-light.svg',
  'apple-touch-icon.png',
  'apple-touch-icon.svg',
];

const DIRS = ['lib'];

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

for (const file of FILES) {
  const from = path.join(root, file);
  if (!fs.existsSync(from)) throw new Error(`missing frontend file: ${file}`);
  fs.copyFileSync(from, path.join(dist, file));
}

for (const dir of DIRS) {
  fs.cpSync(path.join(root, dir), path.join(dist, dir), { recursive: true });
}

console.log(`desktop dist ready: ${FILES.length + DIRS.length} entries -> ${dist}`);
