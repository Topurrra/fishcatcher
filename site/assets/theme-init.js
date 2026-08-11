// Sets the theme before first paint (no flash), and marks JS available.
// External file so the page needs no inline script and can ship a strict CSP.
(function () {
  var r = document.documentElement;
  r.classList.add('js');
  try {
    var t = localStorage.getItem('fc-theme');
    if (!t) t = matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light';
    r.setAttribute('data-theme', t);
  } catch (e) { /* ignore */ }
})();
