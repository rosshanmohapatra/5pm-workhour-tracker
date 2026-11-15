// 5pm page loader (#60, approved 2026-11-15): a clock in the icon runs from 9 to
// 5 as the app opens, one step per real loading step, then folds into the 5 PM
// logo and glides into the logo's place (the left rail on desktop, the top bar
// on phones). The title under it says what's happening:
//   Clocking In → Almost 5 (only if the last step takes a while) → It's 5pm.
// On a slow load the clock never stops: it creeps toward 4:59, and only reaches
// 5 when the app is really ready. "Taking longer than usual. Reload" after 6 s.
//
// Steps (minutes after 9:00): this script runs = 12:00 (180), the session is
// known = 2:00 (300, index-auth-gate.js), the app has started = 4:00 (420,
// index-app.js), revealed = 5:00 (window.__appLoader.done()).
(function () {
  var L = document.getElementById('appLoader');
  if (!L) return;
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var mk = L.querySelector('.al-mark'), hh = L.querySelector('.al-hh'), mh = L.querySelector('.al-mh'), cap = L.querySelector('.al-title');
  var m = 0, target = 0, ready = false, waiting = false, last = 0, raf = 0, finished = false, onDone = null;

  function title(text) {
    var cur = cap.querySelector('span:not(.out)');
    if (cur && cur.textContent === text) return;
    if (cur) { cur.className = 'out'; setTimeout(function () { cur.remove(); }, 360); }
    var n = document.createElement('span'); n.textContent = text; n.className = 'in'; cap.appendChild(n);
    void n.offsetWidth; n.className = '';
  }
  function draw() {
    var h = 9 + m / 60;
    hh.setAttribute('transform', 'rotate(' + ((h % 12) * 30) + ' 26 26)');
    mh.setAttribute('transform', 'rotate(' + ((m % 60) * 6) + ' 26 26)');
  }
  // Time-based, so a busy start never slows the clock down.
  function tick(now) {
    var f = Math.min(now - (last || now), 1000) / 16.67; last = now;
    var ease = function (r) { return 1 - Math.pow(1 - r, f); };
    if (!ready && waiting) target = Math.min(479.4, target + (479.5 - target) * ease(0.012));
    m += (target - m) * ease(ready ? 0.14 : 0.08);
    if (ready && 480 - m < 0.6) { m = 480; draw(); return finish(); }
    draw();
    raf = requestAnimationFrame(tick);
  }
  function step(v) {
    if (ready || v <= target) return;
    target = v;
    if (v >= 420) setTimeout(function () { if (!ready) { waiting = true; title('Almost 5'); } }, 700);
  }
  // Where the logo lives once the app is open: the rail on desktop, the top bar on phones.
  function slot() {
    var ids = ['navLogo', 'mobLogo'];
    for (var i = 0; i < ids.length; i++) { var e = document.getElementById(ids[i]); if (e && e.offsetWidth) return e; }
    return null;
  }
  function finish() {
    if (finished) return; finished = true;
    cancelAnimationFrame(raf);
    L.classList.remove('slow');
    L.classList.add('five');                                   // the face folds into "5"
    title('It’s 5pm');
    setTimeout(function () { L.classList.add('ready'); }, reduce ? 0 : 380);   // PM lands, the 5 slides left
    setTimeout(function () {
      var to = slot(), r = mk.getBoundingClientRect();
      if (to && !reduce) {
        var t = to.getBoundingClientRect();
        mk.style.transform = 'translate(' + (t.left - r.left) + 'px,' + (t.top - r.top) + 'px) scale(' + (t.height / r.height) + ')';
      }
      L.classList.add('app-loader-out');                       // the page fades in under it
      setTimeout(function () { L.remove(); if (onDone) onDone(); }, reduce ? 320 : 700);
    }, reduce ? 600 : 1300);
  }
  function done(cb) {
    onDone = cb || null;
    if (ready) return;
    ready = true; target = 480;
    if (reduce) { m = 480; draw(); finish(); return; }
    // Never hold the app behind the loader: if frames are slow (or the tab is
    // in the background), land on 5 anyway.
    setTimeout(function () { if (!finished) { m = 480; draw(); finish(); } }, 900);
  }
  window.__appLoader = { step: step, done: done };
  setTimeout(function () { L.classList.add('slow'); }, 6000);
  title('Clocking In');
  draw();
  if (reduce) { m = 0; } else raf = requestAnimationFrame(tick);
  step(180);
})();
