// Event handlers for login.html. Inline on*="" attributes are blocked by the
// Content Security Policy, so elements point here with data-on-<event>="<key>"
// and lib/csp-handlers.js attaches them. Everything else on the page binds its
// own listeners in login.js.
window.__H = Object.assign(window.__H || {}, {
  // onload: this.media='all'  (the web-font stylesheet)
  he403411552: function (event) { this.media='all' },
});
