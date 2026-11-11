// Bug report diagnostics: the last few errors and the last few things tapped,
// kept in memory only (never saved, never sent on their own). Report a Bug adds
// them to its email so a bug can be traced without asking the user for steps.
// Loaded first so errors during start-up are caught too.
(function () {
  const D = window.__diag = { errors: [], steps: [] };
  const time = () => new Date().toTimeString().slice(0, 8);
  const add = (list, text, max) => { list.push(time() + ' ' + text); if (list.length > max) list.shift(); };
  // No email addresses in anything kept here.
  const clean = s => String(s).replace(/\S+@\S+\.\S+/g, '[email]').replace(/\s+/g, ' ').trim();
  const file = (f, l) => f ? ' ' + String(f).split('?')[0].split('/').pop() + ':' + (l || '?') : '';

  addEventListener('error', e => {
    if (!e.message) return;   // a missing image or script, not a code error
    add(D.errors, clean(e.message).slice(0, 160) + file(e.filename, e.lineno), 6);
  });
  addEventListener('unhandledrejection', e => {
    const r = e.reason, at = r && r.stack && r.stack.match(/\/([\w.-]+\.js):(\d+)/);
    add(D.errors, 'Unhandled: ' + clean((r && r.message) || r).slice(0, 140) + (at ? ' ' + at[1] + ':' + at[2] : ''), 6);
  });
  // The app's own console errors and warnings ("[WH] ..."): only their text.
  ['error', 'warn'].forEach(k => {
    const orig = console[k];
    console[k] = function (...args) {
      try {
        const text = args.map(a => a && a.message ? a.message : typeof a === 'object' ? '' : String(a)).join(' ');
        if (text.trim()) add(D.errors, k + ': ' + clean(text).slice(0, 160), 6);
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
