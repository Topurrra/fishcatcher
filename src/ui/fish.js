// FishCatcher verdict mascot. A single pixel fish that mirrors the current risk:
// it swims calmly and turns green when the page is safe, and hard-glitches into
// red when FishCatcher catches something. Driven entirely by the `level-*` class
// the panel/popup already sets on <body>; it never touches detection logic.
(function () {
  var cv = document.getElementById('fc-fish');
  if (!cv) return;
  var ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var W = 0, H = 0;

  var FISH = [
    "......dd......",
    ".....ddddd....",
    ".d..dbbbbbd...",
    "dddbbbbbbbdm..",
    "dddbbbbbeebdm.",
    "ddbbbbbbepbbdm",
    "dddbbbllllbbdm",
    "dddbbbllllbdm.",
    ".d..dbbbbbd...",
    ".....ddddd....",
    "......dd......"
  ];
  var FW = FISH[0].length, FH = FISH.length;

  var COLORVAR = { low: '--risk-low', elevated: '--risk-elevated', high: '--risk-high', critical: '--risk-critical', idle: '--muted' };

  function readColor(v) {
    return getComputedStyle(document.documentElement).getPropertyValue(v).trim() || '#888888';
  }
  function toRGB(c) {
    c = c.trim();
    if (c[0] === '#') {
      if (c.length === 4) c = '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
      var n = parseInt(c.slice(1), 16);
      return [n >> 16 & 255, n >> 8 & 255, n & 255];
    }
    var m = c.match(/\d+/g);
    return m ? [+m[0], +m[1], +m[2]] : [136, 136, 136];
  }
  function mul(a, f) { return 'rgb(' + Math.min(255, a[0] * f | 0) + ',' + Math.min(255, a[1] * f | 0) + ',' + Math.min(255, a[2] * f | 0) + ')'; }

  function level() {
    var lvl = (document.body.className.match(/level-(\w+)/) || [])[1] || 'idle';
    return { lvl: lvl, rgb: toRGB(readColor(COLORVAR[lvl] || '--muted')), glitch: lvl === 'critical' ? 1 : lvl === 'high' ? 0.45 : 0 };
  }

  function unit() { return Math.max(2, Math.round(Math.min(H / (FH + 3), 4))); }

  function drawSprite(ox, oy, u, colorOf, rowDx) {
    oy = Math.round(oy);
    for (var r = 0; r < FH; r++) {
      var rx = Math.round(ox + (rowDx ? rowDx[r] : 0));
      for (var c = 0; c < FW; c++) {
        var ch = FISH[r][c];
        if (ch === '.') continue;
        var col = colorOf(ch);
        if (!col) continue;
        ctx.fillStyle = col;
        ctx.fillRect(rx + c * u, oy + r * u, u, u);
      }
    }
  }
  function slices(gi) {
    var a = new Array(FH); for (var i = 0; i < FH; i++) a[i] = 0;
    var n = Math.round(2 + gi * 3);
    for (var k = 0; k < n; k++) a[(Math.random() * FH) | 0] = (Math.random() * 2 - 1) * (4 + gi * 9);
    return a;
  }

  function draw(t) {
    ctx.clearRect(0, 0, W, H);
    var L = level();
    var u = unit();
    var body = mul(L.rgb, 1), dk = mul(L.rgb, 0.6), lt = mul(L.rgb, 1.32);
    var bob = Math.sin(t * 2.2) * (H * 0.08);
    var sway = Math.sin(t * 0.9) * (W * 0.03);
    var bx = W / 2 - FW * u / 2 + sway, by = H / 2 - FH * u / 2 + bob;
    var normal = function (ch) { return ch === 'b' ? body : ch === 'd' ? dk : ch === 'l' ? lt : ch === 'e' ? '#ffffff' : ch === 'p' ? '#141414' : ch === 'm' ? dk : null; };

    if (L.glitch > 0) {
      var gi = L.glitch, s = (2 + Math.random() * 3) * (0.7 + gi);
      var jx = (Math.random() * 5 - 2.5) * gi, jy = (Math.random() * 4 - 2) * gi;
      drawSprite(bx - s + jx, by + jy, u, function (ch) { return ch === '.' ? null : 'rgba(34,211,238,0.7)'; });
      drawSprite(bx + s + jx, by - jy, u, function (ch) { return ch === '.' ? null : 'rgba(255,45,111,0.72)'; });
      drawSprite(bx + jx * 0.4, by + jy * 0.4, u, normal, slices(gi));
    } else {
      drawSprite(bx, by, u, normal);
    }
  }

  function resize() {
    var b = cv.getBoundingClientRect();
    W = b.width; H = b.height;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
  }
  resize();

  var reduce = matchMedia('(prefers-reduced-motion: reduce)');
  if (reduce.matches) {
    var still = function () { draw(0.4); };
    still();
    new MutationObserver(still).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', function () { resize(); still(); });
    return;
  }

  var raf = 0, t0 = null;
  function loop(ts) {
    if (t0 == null) t0 = ts;
    draw((ts - t0) / 1000);
    raf = requestAnimationFrame(loop);
  }
  function start() { if (!raf) raf = requestAnimationFrame(loop); }
  function stop() { cancelAnimationFrame(raf); raf = 0; }
  document.addEventListener('visibilitychange', function () { document.hidden ? stop() : start(); });
  window.addEventListener('resize', resize);
  start();
})();
