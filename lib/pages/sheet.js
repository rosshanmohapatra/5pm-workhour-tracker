// iOS-style bottom sheet drag, shared by every sheet on phones (Plan Your Day,
// Email Draft, the iOS install prompt). The gesture comes from use-gesture
// (lib/use-gesture.js): finger velocity, tap filtering and rubber-banding are
// the library's. The open/close motion is each sheet's CSS transition, on the
// curve iOS sheets use, cubic-bezier(.32,.72,0,1).
//
// Sheet.attach(sheet, { close, scroller, isOpen })
//   close()      closes the sheet the usual way (removes its open class)
//   scroller     element inside the sheet that scrolls, if any
//   isOpen()     true while the sheet is open
//
// Smoothness: touch events arrive faster than the screen draws (120 Hz
// iPhones), so moves only record the position and one requestAnimationFrame
// writes it per frame, as a GPU-only translate3d. The sheet's height is read
// once when the drag starts. Only the sheet moves: the backdrop stays as it is
// until the sheet closes (fading a blurred backdrop every frame flickers on
// iOS, and restyling the email backdrop made the scroll lock re-measure).
(function () {
  var PHONE = window.matchMedia('(max-width: 640px)');

  function attach(sheet, opts) {
    if (!sheet || !window.DragGesture) return;
    var scroller = opts.scroller || null;
    var dragging = false, height = 1, pendingY = null, frame = 0;

    function paint() {
      frame = 0;
      if (pendingY !== null) sheet.style.transform = 'translate3d(0,' + pendingY + 'px,0)';
    }

    function settle() {
      if (frame) { cancelAnimationFrame(frame); frame = 0; }
      pendingY = null;
      dragging = false;
      sheet.classList.remove('sheet-dragging');
      sheet.style.transform = '';
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
        if (!dragging && s.movement[1] < 0 && scroller && scroller.scrollHeight > scroller.clientHeight) {
          s.cancel(); return;
        }
        if (s.event.cancelable) s.event.preventDefault(); // the sheet owns this gesture now
        if (!dragging) {                                  // once per drag
          dragging = true;
          height = sheet.offsetHeight || 1;
          sheet.classList.add('sheet-dragging');          // CSS turns the transition off
        }
        pendingY = y;
        if (!frame) frame = requestAnimationFrame(paint);
        return;
      }
      // Released: a quarter of the way down, or a downward flick, closes it.
      var flick = s.velocity[1] > 0.5 && s.direction[1] > 0;
      var far = dragging && y > height * 0.25;
      var wasDragging = dragging;
      settle();
      if (wasDragging && (flick || far)) opts.close();
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
