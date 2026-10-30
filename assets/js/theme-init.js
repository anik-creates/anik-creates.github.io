// Runs before first paint (loaded synchronously in <head>) so the page never flashes the
// wrong theme or accent colour. Values are cached by app.js from the published content.
(function () {
  var t = null, d = 'dark', c = {};
  try {
    t = localStorage.getItem('theme');
    d = localStorage.getItem('theme.default') || 'dark';
    c = JSON.parse(localStorage.getItem('site.cache') || '{}');
  } catch (e) {}
  if (t !== 'light' && t !== 'dark') {
    t = d === 'light' || d === 'dark' ? d : (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  }
  var root = document.documentElement;
  root.setAttribute('data-theme', t);
  ['a1', 'a2', 'a3'].forEach(function (k) {
    if (/^#[0-9a-f]{6}$/i.test(c[k] || '')) root.style.setProperty('--' + k, c[k]);
  });
})();
