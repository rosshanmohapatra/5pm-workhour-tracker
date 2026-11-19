// 5pm page loader (#63, user pick 2026-11-19: "B · Apple standard"): only a
// system-style spinner in the middle of the screen while the app opens, then
// the app fades in under it. No logo, no clock, no title.
// "Taking longer than usual. Reload" shows after 6 s.
//
// index-auth-gate.js and index-app.js still report their steps through
// window.__appLoader.step(); the spinner has no progress to show, so they're ignored.
(function () {
  var L = document.getElementById('appLoader');
  if (!L) return;
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finished = false;

  function done(cb) {
    if (finished) return;
    finished = true;
    L.classList.remove('slow');
    L.classList.add('app-loader-out');                         // the page fades in under it
    setTimeout(function () { L.remove(); if (cb) cb(); }, reduce ? 200 : 450);
  }
  window.__appLoader = { step: function () {}, done: done };
  setTimeout(function () { if (!finished) L.classList.add('slow'); }, 6000);
})();
