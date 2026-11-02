// Event handlers for privacy.html. They used to be inline on*="" attributes;
// the Content Security Policy forbids those now. Elements point here with
// data-on-<event>="<key>", and lib/csp-handlers.js attaches them.
// To add one: give the element data-on-click="hYourKey" and add hYourKey
// below, or attach a listener in code instead.
window.__H = Object.assign(window.__H || {}, {
  // onload: this.media='all'
  he403411552: function (event) { this.media='all' },
});
