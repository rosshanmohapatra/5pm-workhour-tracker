// One dropdown menu for every breakpoint, in place of the phone's own picker
// (which looks different on every device). Used by the day plan dropdowns
// (Plan Your Week, onboarding) and Email Draft's Writing Tone.
//
// The real <select> stays in the page, hidden, and keeps the value: picking an
// option sets select.value and fires 'change', so existing code is untouched.
// Positioning comes from Floating UI (lib/floating-ui.js): the menu's right
// edge sits under the button's right edge, flips above when there's no room
// below, and follows the button while it's open.
//
// MenuSelect.enhance(root)  turn every select.wp-select inside root into a menu button
// MenuSelect.sync(select)   refresh the button after code changed select.value
(function () {
  var CHECK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
  var open = null; // { select, btn, menu, cleanup }

  function label(select) {
    var o = select.options[select.selectedIndex];
    return o ? o.text : '';
  }

  function sync(select) {
    var btn = select && select._msBtn;
    if (btn) btn.querySelector('.ms-label').textContent = label(select);
  }

  function close(focusBtn) {
    if (!open) return;
    var o = open; open = null;
    o.cleanup();
    o.btn.setAttribute('aria-expanded', 'false');
    o.menu.classList.remove('open');
    setTimeout(function () { o.menu.remove(); }, 200);
    if (focusBtn) o.btn.focus();
  }

  function choose(select, value) {
    if (select.value !== value) {
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    sync(select);
    close(true);
  }

  function show(select, btn) {
    var F = window.FloatingUIDOM;
    if (!F) return;
    close(false);
    var menu = document.createElement('div');
    menu.className = 'ms-menu';
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-label', btn.getAttribute('aria-label') || '');
    menu.style.minWidth = Math.max(btn.offsetWidth, 168) + 'px';
    Array.prototype.forEach.call(select.options, function (o) {
      var item = document.createElement('div');
      item.className = 'ms-opt';
      item.setAttribute('role', 'option');
      item.tabIndex = -1;
      item.dataset.value = o.value;
      item.setAttribute('aria-selected', String(o.value === select.value));
      item.innerHTML = '<span></span>' + CHECK;
      item.firstChild.textContent = o.text;
      menu.appendChild(item);
    });
    document.body.appendChild(menu);

    // Close if the button goes away (its modal closed or was re-rendered).
    var place = function () {
      if (!btn.isConnected || !btn.getClientRects().length) { close(false); return; }
      F.computePosition(btn, menu, {
        placement: 'bottom-end', strategy: 'fixed',
        middleware: [F.offset(6), F.flip({ padding: 8 }), F.shift({ padding: 8 })]
      }).then(function (p) {
        menu.style.left = p.x + 'px';
        menu.style.top = p.y + 'px';
        menu.dataset.side = p.placement.split('-')[0]; // grows from the button's corner
      });
    };
    var stop = F.autoUpdate(btn, menu, place);
    open = { select: select, btn: btn, menu: menu, cleanup: stop };
    btn.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(function () { menu.classList.add('open'); });
    var current = menu.querySelector('[aria-selected="true"]') || menu.firstChild;
    current.focus({ preventScroll: true });

    menu.addEventListener('click', function (e) {
      var item = e.target.closest('.ms-opt');
      if (item) choose(select, item.dataset.value);
    });
    menu.addEventListener('keydown', function (e) {
      var items = Array.prototype.slice.call(menu.children);
      var i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); items[Math.min(i + 1, items.length - 1)].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); items[Math.max(i - 1, 0)].focus(); }
      else if (e.key === 'Home') { e.preventDefault(); items[0].focus(); }
      else if (e.key === 'End') { e.preventDefault(); items[items.length - 1].focus(); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (i >= 0) choose(select, items[i].dataset.value); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
      else if (e.key === 'Tab') close(false);
    });
  }

  function enhance(root) {
    (root || document).querySelectorAll('select.wp-select').forEach(function (select) {
      if (select._msBtn && select._msBtn.isConnected) { sync(select); return; }
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wp-select ms-trigger';
      btn.id = select.id ? select.id + '-btn' : '';
      btn.setAttribute('aria-haspopup', 'listbox');
      btn.setAttribute('aria-expanded', 'false');
      btn.innerHTML = '<span class="ms-label"></span>';
      // The visible label now names the button rather than the hidden select.
      var lab = select.id && document.querySelector('label[for="' + select.id + '"]');
      if (lab) { lab.htmlFor = btn.id; btn.setAttribute('aria-label', lab.textContent.trim()); }
      select.classList.add('ms-native');
      select.tabIndex = -1;
      select.setAttribute('aria-hidden', 'true');
      select.after(btn);
      select._msBtn = btn;
      sync(select);
      btn.addEventListener('click', function () {
        if (open && open.btn === btn) close(false); else show(select, btn);
      });
      btn.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); show(select, btn); }
      });
    });
  }

  // Tap or click anywhere else closes the menu; leaving the window does too.
  document.addEventListener('pointerdown', function (e) {
    if (!open || open.menu.contains(e.target) || open.btn.contains(e.target)) return;
    close(false);
  }, true);
  window.addEventListener('blur', function () { close(false); });

  window.MenuSelect = { enhance: enhance, sync: sync, close: close };
})();
