// Theme before first paint: the saved 5pm theme (wh_theme), else the device.
(function () {
  var s = localStorage.getItem('wh_theme');
  var p = window.matchMedia('(prefers-color-scheme:dark)').matches;
  var d = s === 'dark' || ((!s || s === 'auto') && p);
  document.documentElement.classList.toggle('dark', d);
  document.documentElement.dataset.theme = d ? 'dark' : 'light';
})();
