// Theme toggle. The no-flash init runs from theme-init.js in <head>; this wires
// the button via delegation so no inline onclick is needed (keeps the CSP strict).
(function () {
  const KEY = 'fc-theme';
  function current() {
    return document.documentElement.getAttribute('data-theme') ||
      (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }
  window.fcToggleTheme = function () {
    const next = current() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem(KEY, next); } catch (e) { /* ignore */ }
  };
  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('.theme-toggle')) window.fcToggleTheme();
  });
})();
