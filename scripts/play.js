// Local playground: serves the app at http://localhost:3000 and reloads the
// page whenever a file is saved. Run with: npm run play
//
// Safe by design:
//  - answers only on this computer (127.0.0.1), not on the network;
//  - built-in Node only, no packages downloaded;
//  - read-only: it never writes files, commits or pushes;
//  - hidden files and folders (.git, .env, .claude...) are never served.
// The app still talks to the live Supabase project, so sign in with the test
// account. Passkeys and push notifications only work on the live site.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 3000;
const HOST = '127.0.0.1';
const IGNORE = /(^|[\\/])(\.|node_modules|src-tauri)/;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon',
  '.webp': 'image/webp', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};
// External file, not inline, so it follows the same CSP rule as the app.
const RELOAD_JS = "new EventSource('/__play/events').onmessage = () => location.reload();\n";
const TAG = '<script src="/__play/reload.js"></script>';

const clients = new Set();

// The repo folder with any shortcuts (symlinks) followed, so a link that
// points outside the repo can't be used to read other files.
const ROOT_REAL = fs.realpathSync(ROOT);

// Request path to a file inside the repo, or null (outside, hidden, missing).
// Each candidate ("/about" and "/about.html") is checked on its own, after
// the final path is built, so nothing outside the repo can slip through.
function resolveFile(urlPath) {
  let p;
  try { p = decodeURIComponent(urlPath.split('?')[0]); } catch { return null; }
  if (p.includes('\0')) return null;
  if (p.endsWith('/')) p += 'index.html';
  for (const candidate of [p, p + '.html']) {
    const file = path.resolve(ROOT, '.' + candidate);
    if (!file.startsWith(ROOT + path.sep)) continue;
    let real;
    try { real = fs.realpathSync(file); } catch { continue; }
    if (!real.startsWith(ROOT_REAL + path.sep)) continue;
    if (path.relative(ROOT_REAL, real).split(path.sep).some(s => s.startsWith('.'))) continue;
    try { if (fs.statSync(real).isFile()) return real; } catch {}
  }
  return null;
}

const server = http.createServer((req, res) => {
  if (req.url === '/__play/reload.js') {
    res.writeHead(200, { 'Content-Type': TYPES['.js'], 'Cache-Control': 'no-store' });
    return res.end(RELOAD_JS);
  }
  if (req.url === '/__play/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
    res.write(': connected\n\n');
    clients.add(res);
    return req.on('close', () => clients.delete(res));
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  const file = resolveFile(req.url);
  if (!file) { res.writeHead(404, { 'Content-Type': TYPES['.txt'] }); return res.end('Not found'); }
  const ext = path.extname(file).toLowerCase();
  let body = fs.readFileSync(file);
  if (ext === '.html') {
    const html = body.toString('utf8');
    body = html.includes('</body>') ? html.replace('</body>', TAG + '</body>') : html + TAG;
  }
  res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(req.method === 'HEAD' ? undefined : body);
});

// Reload every open tab shortly after a save (editors write in bursts).
let timer = null;
fs.watch(ROOT, { recursive: true }, (_, name) => {
  if (!name || IGNORE.test(name)) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    console.log('changed: ' + name);
    for (const c of clients) c.write('data: reload\n\n');
  }, 150);
});

server.listen(PORT, HOST, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`5pm playground: ${url}  (this computer only, Ctrl+C to stop)`);
  // Open it in Chrome (skip with --no-open).
  if (process.argv.includes('--no-open')) return;
  const { spawn } = require('child_process');
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', 'chrome', url]]
    : process.platform === 'darwin' ? ['open', ['-a', 'Google Chrome', url]] : null;
  if (cmd) spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
});
