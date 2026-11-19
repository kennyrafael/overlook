// Applies a saved light/dark choice before first paint, so the page never flashes the other theme.
// A classic blocking script in <head> because the CSP allows no inline scripts. See src/theme.ts.
try {
  var t = localStorage.getItem('overlook-theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch (e) { /* storage blocked: follow the system theme */ }
