// Docs: scrollspy on the current area's section links, plus a working Filter box.
(function () {
  // scrollspy
  var subLinks = {};
  document.querySelectorAll('.tree .sub a[href^="#"]').forEach(function (a) {
    subLinks[a.getAttribute('href').slice(1)] = a;
  });
  var ids = Object.keys(subLinks);
  if (ids.length && 'IntersectionObserver' in window) {
    var heads = ids.map(function (id) { return document.getElementById(id); }).filter(Boolean);
    var io = new IntersectionObserver(function (entries) {
      var vis = entries.filter(function (e) { return e.isIntersecting; });
      if (!vis.length) return;
      vis.sort(function (a, b) { return a.boundingClientRect.top - b.boundingClientRect.top; });
      var id = vis[0].target.id;
      for (var k in subLinks) subLinks[k].classList.toggle('active', k === id);
    }, { rootMargin: '-76px 0px -68% 0px', threshold: 0 });
    heads.forEach(function (h) { io.observe(h); });
  }

  // filter
  var input = document.getElementById('docFilter');
  if (input) {
    var items = [].slice.call(document.querySelectorAll('.tree .area, .tree .sub a'));
    input.addEventListener('input', function () {
      var q = input.value.trim().toLowerCase();
      items.forEach(function (el) {
        el.classList.toggle('filtered-out', !!q && el.textContent.toLowerCase().indexOf(q) === -1);
      });
    });
    document.addEventListener('keydown', function (e) {
      var tag = (document.activeElement && document.activeElement.tagName || '').toLowerCase();
      if (e.key === '/' && tag !== 'input' && tag !== 'textarea') { e.preventDefault(); input.focus(); }
    });
  }
})();
