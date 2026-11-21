// Bug report diagnostics: the last few errors and the last few things tapped,
// kept in memory only (never saved, never sent on their own). Report a Bug adds
// them to its email so a bug can be traced without asking the user for steps.
// Loaded first so errors during start-up are caught too.
(function () {
  // net / cons: the same failures as structured rows for Report a Bug's "Recent errors"
  // (a page can't read DevTools, so 5pm records them itself from the moment it starts).
  const D = window.__diag = { errors: [], steps: [], net: [], cons: [] };
  const time = () => new Date().toTimeString().slice(0, 8);
  const add = (list, text, max) => { list.push(time() + ' ' + text); if (list.length > max) list.shift(); };
  // No email addresses in anything kept here.
  const clean = s => String(s).replace(/\S+@\S+\.\S+/g, '[email]').replace(/\s+/g, ' ').trim();
  // A web address without its query string, and with long tokens hidden.
  const url = u => { try { const x = new URL(u, location.href); return clean((x.host === location.host ? '' : x.host) + x.pathname).replace(/[A-Za-z0-9_-]{32,}/g, '[token]'); } catch { return '[address]'; } };
  // Keep a row, or count it again if it's the same as one already kept (newest last, max 20).
  const keep = (list, row) => {
    const k = row.kind + row.what + row.status;
    const had = list.find(r => r.kind + r.what + r.status === k);
    if (had) { had.n++; had.at = Date.now(); list.splice(list.indexOf(had), 1); list.push(had); return; }
    list.push({ ...row, n: 1, at: Date.now() }); if (list.length > 20) list.shift();
  };
  D.addNet = (method, u, status) => keep(D.net, { kind: 'net', what: (method || 'GET').toUpperCase() + ' ' + url(u), status: String(status) });
  if (window.fetch) {
    const f0 = window.fetch;
    window.fetch = function (input, init) {
      const u = typeof input === 'string' ? input : input && input.url, m = (init && init.method) || (input && input.method) || 'GET';
      return f0.apply(this, arguments).then(res => { if (!res.ok && res.status !== 0) D.addNet(m, u, res.status); return res; },
        err => { if (!(err && err.name === 'AbortError')) D.addNet(m, u, 'Failed'); throw err; });
    };
  }
  if (window.WebSocket) {
    const W0 = window.WebSocket;
    const W = function (u, pr) { const ws = pr === undefined ? new W0(u) : new W0(u, pr); ws.addEventListener('error', () => D.addNet('WS', u, 'Failed')); return ws; };
    W.prototype = W0.prototype; ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(k => { W[k] = W0[k]; });
    window.WebSocket = W;
  }
  // A file that failed to load (script, stylesheet, image).
  addEventListener('error', e => {
    const t = e.target;
    if (t && t !== window && t.tagName) D.addNet('GET', t.src || t.href || '', 'Failed');
  }, true);
  const file = (f, l) => f ? ' ' + String(f).split('?')[0].split('/').pop() + ':' + (l || '?') : '';

  addEventListener('error', e => {
    if (!e.message) return;   // a missing image or script, not a code error
    add(D.errors, clean(e.message).slice(0, 160) + file(e.filename, e.lineno), 6);
    keep(D.cons, { kind: 'con', what: clean(e.message).slice(0, 160), status: 'Error', where: file(e.filename, e.lineno).trim() });
  });
  addEventListener('unhandledrejection', e => {
    const r = e.reason, at = r && r.stack && r.stack.match(/\/([\w.-]+\.js):(\d+)/);
    add(D.errors, 'Unhandled: ' + clean((r && r.message) || r).slice(0, 140) + (at ? ' ' + at[1] + ':' + at[2] : ''), 6);
    keep(D.cons, { kind: 'con', what: clean((r && r.message) || r).slice(0, 160), status: 'Unhandled', where: at ? at[1] + ':' + at[2] : '' });
  });
  // The app's own console errors and warnings ("[WH] ..."): only their text.
  ['error', 'warn'].forEach(k => {
    const orig = console[k];
    console[k] = function (...args) {
      try {
        const text = args.map(a => a && a.message ? a.message : typeof a === 'object' ? '' : String(a)).join(' ');
        if (text.trim()) add(D.errors, k + ': ' + clean(text).slice(0, 160), 6);
        if (text.trim() && k === 'error') keep(D.cons, { kind: 'con', what: clean(text).slice(0, 160), status: 'Error', where: '' });
      } catch {}
      return orig.apply(this, args);
    };
  });

  // Steps: the name of each button, tab or row tapped (never what was typed).
  addEventListener('click', e => {
    const n = e.target.closest && e.target.closest(
      'button, a, label, select, [role="tab"], [role="option"], [role="switch"], [data-on-click]');
    if (!n) return;
    const name = n.getAttribute('aria-label') || n.querySelector('.form-label')?.textContent
      || n.textContent || n.id || n.tagName.toLowerCase();
    add(D.steps, clean(name).slice(0, 40) || n.tagName.toLowerCase(), 10);
  }, true);
})();
