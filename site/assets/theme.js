// Theme toggle. The no-flash init runs inline in <head>; this only wires the button.
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
})();
