// Theme toggle for the static pages (privacy). The landing page uses src/theme.ts; both save the
// choice under the same key, and theme-init.js applies it before first paint.
(function () {
  var root = document.documentElement;
  var dark = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  var current = function () {
    var t = root.dataset.theme;
    return t === 'light' || t === 'dark' ? t : dark && dark.matches ? 'dark' : 'light';
  };
  var buttons = document.querySelectorAll('.theme-toggle');
  var sync = function () {
    var t = current();
    var label = t === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].dataset.showing = t;
      buttons[i].setAttribute('aria-label', label);
      buttons[i].title = label;
    }
  };
  for (var i = 0; i < buttons.length; i++) {
    buttons[i].addEventListener('click', function () {
      var next = current() === 'dark' ? 'light' : 'dark';
      root.dataset.theme = next;
      try { localStorage.setItem('overlook-theme', next); } catch (e) { /* applies to this visit only */ }
      sync();
    });
  }
  if (dark && dark.addEventListener) dark.addEventListener('change', function () { if (!root.dataset.theme) sync(); });
  sync();
})();
