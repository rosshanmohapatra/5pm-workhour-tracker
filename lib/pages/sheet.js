// iOS-style bottom sheet drag, shared by every sheet on phones (Plan Your Day,
// Email Draft, the iOS install prompt). The gesture comes from use-gesture
// (lib/use-gesture.js): finger velocity, tap filtering and rubber-banding are
// the library's. The open/close motion is each sheet's CSS transition, on the
// curve iOS sheets use, cubic-bezier(.32,.72,0,1).
//
// Sheet.attach(sheet, { close, scrim, scroller, isOpen })
//   close()      closes the sheet the usual way (removes its open class)
//   scrim(p)     shows the backdrop at progress p (1 = fully open); null resets it
//   scroller     element inside the sheet that scrolls, if any
//   isOpen()     true while the sheet is open
(function () {
  var PHONE = window.matchMedia('(max-width: 640px)');

  function attach(sheet, opts) {
    if (!sheet || !window.DragGesture) return;
    var scroller = opts.scroller || null;

    function settle() {
      sheet.classList.remove('sheet-dragging');
      sheet.style.transition = '';
      sheet.style.transform = '';
      if (opts.scrim) opts.scrim(null);
    }

    new window.DragGesture(sheet, function (s) {
      var y = s.offset[1];
      if (s.first) {
        // A drag that starts in scrolled content is a scroll, not a dismiss.
        if (!PHONE.matches || !opts.isOpen() || (scroller && scroller.contains(s.event.target) && scroller.scrollTop > 0)) {
          s.cancel(); return;
        }
      }
      if (s.tap) return;
      if (!s.last) {
        // Pushing up on content that can scroll is a scroll: hand it back
        // before claiming the touch, or the content could never scroll.
        if (s.movement[1] < 0 && scroller && scroller.scrollHeight > scroller.clientHeight) {
          settle(); s.cancel(); return;
        }
        if (s.event.cancelable) s.event.preventDefault(); // the sheet owns this gesture now
        sheet.classList.add('sheet-dragging');
        sheet.style.transition = 'none';
        sheet.style.transform = 'translateY(' + y + 'px)';
        if (opts.scrim) opts.scrim(1 - Math.max(0, y) / sheet.offsetHeight);
        return;
      }
      // Released: a quarter of the way down, or a downward flick, closes it.
      var flick = s.velocity[1] > 0.5 && s.direction[1] > 0;
      var far = y > sheet.offsetHeight * 0.25;
      settle();
      if (flick || far) opts.close();
    }, {
      axis: 'y',
      filterTaps: true,
      pointer: { touch: true },            // touch events keep coming while the page would scroll
      from: function () { return [0, 0]; },
      bounds: { top: 0 },
      rubberband: 0.15,                    // pulling up resists, like iOS
      eventOptions: { passive: false }
    });
  }

  window.Sheet = { attach: attach };
})();
