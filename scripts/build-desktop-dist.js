// Copies the web frontend into src-tauri/dist so the desktop build ships its own
// code offline. Data still comes from Supabase over the network.
// Whitelist, not a mirror: the website lives in public/ (the same folder Vercel
// serves), but pages the desktop app never opens (About, Privacy, OAuth
// consent, Google's verification file) stay out of the exe.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const web  = path.join(root, 'public');
const dist = path.join(root, 'src-tauri', 'dist');

const FILES = [
  'index.html',
  'login.html',
  'login.js',
  'sw.js',
  'manifest.json',
  'apple-touch-icon.png',
];

// icons/: favicons, brand logos, social preview. lib/: scripts and styles.
const DIRS = ['icons', 'lib'];

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

for (const file of FILES) {
  const from = path.join(web, file);
  if (!fs.existsSync(from)) throw new Error(`missing frontend file: public/${file}`);
  fs.copyFileSync(from, path.join(dist, file));
}

for (const dir of DIRS) {
  const from = path.join(web, dir);
  if (!fs.existsSync(from)) throw new Error(`missing frontend folder: public/${dir}`);
  fs.cpSync(from, path.join(dist, dir), { recursive: true });
}

console.log(`desktop dist ready: ${FILES.length + DIRS.length} entries -> ${dist}`);
