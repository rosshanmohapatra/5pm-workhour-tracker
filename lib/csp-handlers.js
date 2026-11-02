// Attaches the event handlers that used to be inline on*="" attributes.
// The Content Security Policy forbids inline script, so elements carry
// data-on-<event>="<key>" instead and the code lives in lib/pages/*-handlers.js
// (window.__H). Loaded first in <head>, it binds elements as the page is parsed
// and any that scripts add later (innerHTML), with a MutationObserver.
(function () {
  var EVENTS = ['blur', 'change', 'click', 'input', 'keydown', 'load',
                'mouseenter', 'mouseleave', 'mouseout', 'mouseover'];
  var SELECTOR = EVENTS.map(function (e) { return '[data-on-' + e + ']'; }).join(',');
  var bound = new WeakSet();

  function bind(el) {
    if (bound.has(el)) return;
    bound.add(el);
    EVENTS.forEach(function (type) {
      var key = el.getAttribute('data-on-' + type);
      if (!key) return;
      var run = function (event) {
        var fn = window.__H && window.__H[key];
        if (fn) return fn.call(el, event);
        console.warn('[csp-handlers] no handler for', key);
      };
      el.addEventListener(type, run);
      // A stylesheet that finished loading before it was bound still gets its load handler.
      if (type === 'load' && el.tagName === 'LINK' && el.sheet) run(new Event('load'));
    });
  }

  function scan(node) {
    if (node.nodeType !== 1) return;
    if (node.matches(SELECTOR)) bind(node);
    node.querySelectorAll(SELECTOR).forEach(bind);
  }

  new MutationObserver(function (records) {
    records.forEach(function (r) { r.addedNodes.forEach(scan); });
  }).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', function () { scan(document.documentElement); });
})();
