// 5pm page loader (#63, user pick 2026-11-19: "A · 5pm + spinner"): the 5 PM
// logo from the very first frame with an Apple-style spinner under it. When the
// app is ready, the spinner fades, the logo glides into its place (the left rail
// on desktop, the top bar on phones) and the app fades in under it.
// No clock, no title. "Taking longer than usual. Reload" shows after 6 s.
//
// index-auth-gate.js and index-app.js still report their steps through
// window.__appLoader.step(); the spinner has no progress to show, so they're ignored.
(function () {
  var L = document.getElementById('appLoader');
  if (!L) return;
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var mk = L.querySelector('.al-mark');
  var finished = false;

  // Where the logo lives once the app is open: the rail on desktop, the top bar on phones.
  function slot() {
    var ids = ['navLogo', 'mobLogo'];
    for (var i = 0; i < ids.length; i++) {
      var e = document.getElementById(ids[i]);
      if (e && e.offsetWidth) return e;
    }
    return null;
  }
  function done(cb) {
    if (finished) return;
    finished = true;
    L.classList.remove('slow');
    L.classList.add('ready'); // the spinner fades
    setTimeout(
      function () {
        var to = slot();
        if (to && mk && !reduce) {
          var t = to.getBoundingClientRect(),
            r = mk.getBoundingClientRect();
          mk.style.transform =
            'translate(' + (t.left - r.left) + 'px,' + (t.top - r.top) + 'px) scale(' + t.height / r.height + ')';
        }
        L.classList.add('app-loader-out'); // the page fades in under it
        setTimeout(
          function () {
            L.remove();
            if (cb) cb();
          },
          reduce ? 200 : 700
        );
      },
      reduce ? 0 : 200
    );
  }
  window.__appLoader = { step: function () {}, done: done };
  setTimeout(function () {
    if (!finished) L.classList.add('slow');
  }, 6000);
})();
