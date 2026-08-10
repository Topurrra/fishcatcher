// Hero background: pixel-art fishes swim across the hero, blowing bubbles. They all
// look normal. Every few seconds a hook drops from a random spot above one of them
// and catches it. The instant it is caught the fish hard-glitches (RGB split, sliced
// rows, white flash) and reveals red, and the header wordmark glitches too. The
// allegory: a phishing site looks like any other until FishCatcher catches it.
// Colour lives only on this canvas; the CSS mask keeps it out from behind the text.
(function () {
  var cv = document.getElementById('hero-canvas');
  if (!cv) return;
  var ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var cssW = 0, cssH = 0;
  var wm = document.querySelector('.site-nav .wm-swap');

  // ── pixel sprites ─────────────────────────────────────
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
  var HOOK = ["..x", "..x", "..x", "..x", "x.x", "xx."];
  var FW = FISH[0].length, FH = FISH.length;

  // colourful, but deliberately NO red: red is reserved for the glitch reveal.
  var PALETTE = ["#ffd166", "#06d6a0", "#118ab2", "#f4a261", "#3a86ff", "#8ac926",
    "#ff924c", "#9b5de5", "#00bbf9", "#f9c74f", "#43aa8b", "#577590"];
  var GLITCH_PINK = "rgba(255,45,111,0.8)";

  function shade(hex, f) {
    var n = parseInt(hex.slice(1), 16);
    return "rgb(" + Math.min(255, (n >> 16 & 255) * f | 0) + "," +
      Math.min(255, (n >> 8 & 255) * f | 0) + "," + Math.min(255, (n & 255) * f | 0) + ")";
  }
  function isDark() {
    var a = document.documentElement.getAttribute("data-theme");
    return a ? a === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  }
  function rnd(a, b) { return a + Math.random() * (b - a); }

  function drawSprite(spr, ox, oy, u, mirror, colorOf, rowDx) {
    var rows = spr.length, cols = spr[0].length;
    oy = Math.round(oy);
    for (var r = 0; r < rows; r++) {
      var rx = Math.round(ox + (rowDx ? rowDx[r] : 0));
      for (var c = 0; c < cols; c++) {
        var ch = spr[r][mirror ? cols - 1 - c : c];
        if (ch === "." || ch === " ") continue;
        var col = colorOf(ch);
        if (!col) continue;
        ctx.fillStyle = col;
        ctx.fillRect(rx + c * u, oy + r * u, u, u);
      }
    }
  }

  // ── fishes ────────────────────────────────────────────
  var fishes = [], N = 14;
  function randY() { return rnd(cssH * 0.1, cssH * 0.9); }
  function randSpeed() { return rnd(15, 33); }
  function randScale() { return Math.round(rnd(3, 5)); }
  function makeFish(edge) {
    var dir = Math.random() < 0.5 ? 1 : -1;
    return {
      x: edge ? (dir > 0 ? -60 : cssW + 60) : rnd(0, cssW),
      y: randY(), dir: dir, speed: randSpeed(),
      bob: rnd(0, 6.283), amp: rnd(3, 8), scale: randScale(),
      color: PALETTE[(Math.random() * PALETTE.length) | 0]
    };
  }
  function palOf(f, red) {
    var base = red ? "#e5383b" : f.color;
    return { b: base, d: shade(base, 0.58), l: shade(base, 1.32), m: shade(base, 0.78) };
  }
  function bodyColorOf(C) {
    return function (ch) {
      return ch === "b" ? C.b : ch === "d" ? C.d : ch === "l" ? C.l
        : ch === "e" ? "#ffffff" : ch === "p" ? "#141414" : ch === "m" ? C.m : null;
    };
  }
  function slices(rows, gi) {
    var a = new Array(rows); for (var i = 0; i < rows; i++) a[i] = 0;
    var count = Math.round(2 + gi * 3);
    for (var k = 0; k < count; k++) a[(Math.random() * rows) | 0] = (Math.random() * 2 - 1) * (5 + gi * 12);
    return a;
  }

  function drawFish(f, tsec, g) {
    var u = f.scale;
    var bob = f.held ? 0 : Math.sin(tsec * 2 + f.bob) * f.amp;
    var bx = f.x - FW * u / 2, by = f.y + bob - FH * u / 2, mirror = f.dir < 0;
    if (!g) { drawSprite(FISH, bx, by, u, mirror, bodyColorOf(palOf(f, false))); return; }
    var gi = g.gi;
    if (g.flash) drawSprite(FISH, bx, by, u, mirror, function (ch) { return ch === "." ? null : "#ffffff"; });
    var s = (3 + Math.random() * 4) * (0.7 + gi);
    var jx = (Math.random() * 6 - 3) * gi, jy = (Math.random() * 5 - 2.5) * gi;
    var acc = isDark() ? "rgba(53,192,122,0.72)" : "rgba(18,137,79,0.72)";
    drawSprite(FISH, bx - s + jx, by + jy, u, mirror, function (ch) { return ch === "." ? null : GLITCH_PINK; });
    drawSprite(FISH, bx + s + jx, by - jy, u, mirror, function (ch) { return ch === "." ? null : acc; });
    drawSprite(FISH, bx + jx * 0.4, by + jy * 0.4, u, mirror, bodyColorOf(palOf(f, true)), slices(FH, gi));
  }

  // ── bubbles ───────────────────────────────────────────
  var bubbles = [];
  function spawnBubble(f) {
    if (bubbles.length > 70) return;
    var u = f.scale;
    bubbles.push({
      x: f.x + f.dir * (FW * u * 0.42), y: f.y - u * 1.5,
      r: rnd(1.2, 2.6) * (u / 3.5), vy: rnd(14, 30), ph: rnd(0, 6.283),
      life: rnd(1.2, 2.4), t: 0
    });
  }
  function updateBubbles(dt) {
    for (var i = bubbles.length - 1; i >= 0; i--) {
      var b = bubbles[i]; b.t += dt; b.y -= b.vy * dt; b.x += Math.sin(b.t * 4 + b.ph) * 8 * dt; b.r += 2 * dt;
      if (b.t > b.life || b.y < -12) bubbles.splice(i, 1);
    }
  }
  function drawBubbles() {
    var dark = isDark();
    for (var i = 0; i < bubbles.length; i++) {
      var b = bubbles[i], a = Math.max(0, 1 - b.t / b.life) * 0.42;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 6.283);
      ctx.strokeStyle = dark ? "rgba(190,214,232," + a + ")" : "rgba(70,100,130," + a + ")";
      ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = dark ? "rgba(232,242,250," + (a * 0.7) + ")" : "rgba(90,120,150," + (a * 0.7) + ")";
      ctx.fillRect(Math.round(b.x - b.r * 0.4), Math.round(b.y - b.r * 0.4), 1, 1);
    }
  }

  // ── hook state machine ────────────────────────────────
  var mode = "swim", hookX = 0, hookTipY = -70, target = null, catchT = 0;
  var swimT = 0, nextCatch = rnd(2, 4);
  var DROP = 215, REEL = 250, HOLD = 0.45;

  function glitchWordmark() {
    if (!wm) return;
    wm.classList.add("glitch");
    clearTimeout(wm._t); wm._t = setTimeout(function () { wm.classList.remove("glitch"); }, 600);
  }
  function startDrop() {
    var lo = cssW * 0.5, hi = cssW * 0.97, band = [];
    for (var i = 0; i < fishes.length; i++) if (fishes[i].x > lo && fishes[i].x < hi) band.push(fishes[i]);
    var pool = band.length ? band : fishes;
    target = pool[(Math.random() * pool.length) | 0];
    hookX = Math.max(lo, Math.min(hi, target.x));
    hookTipY = -70; catchT = 0; target.held = true; mode = "drop";
  }
  function finishCatch() {
    target.held = false;
    target.color = PALETTE[(Math.random() * PALETTE.length) | 0];
    target.dir = Math.random() < 0.5 ? 1 : -1;
    target.x = target.dir > 0 ? -60 : cssW + 60;
    target.y = randY(); target.speed = randSpeed();
    target = null;
    mode = "swim"; swimT = 0; nextCatch = rnd(3, 6);
  }
  function drawHook() {
    var col = isDark() ? "rgba(222,224,230,0.92)" : "rgba(38,40,46,0.92)";
    ctx.fillStyle = col;
    ctx.fillRect(Math.round(hookX) - 1, 0, 2, Math.max(0, hookTipY - HOOK.length * 3));
    drawSprite(HOOK, hookX - 3, hookTipY - HOOK.length * 3, 3, false, function () { return col; });
  }

  // ── loop ──────────────────────────────────────────────
  var raf = 0, running = false, last = 0;
  function step(ts) {
    var dt = last ? Math.min(0.05, (ts - last) / 1000) : 0; last = ts;
    var tsec = ts / 1000;
    ctx.clearRect(0, 0, cssW, cssH);

    for (var i = 0; i < fishes.length; i++) {
      var f = fishes[i];
      if (!f.held) {
        f.x += f.dir * f.speed * dt;
        if (f.dir > 0 && f.x > cssW + 70) { f.x = -70; f.y = randY(); }
        if (f.dir < 0 && f.x < -70) { f.x = cssW + 70; f.y = randY(); }
        if (Math.random() < 0.4 * dt) spawnBubble(f);
      }
    }
    updateBubbles(dt);

    if (mode === "swim") {
      swimT += dt;
      if (swimT > nextCatch) startDrop();
    } else if (mode === "drop") {
      target.x += (hookX - target.x) * Math.min(1, dt * 4);
      hookTipY += DROP * dt;
      if (hookTipY >= target.y) { mode = "catch"; catchT = 0; glitchWordmark(); }
    } else if (mode === "catch") {
      catchT += dt;
      target.x = hookX; target.y = hookTipY;
      if (Math.random() < 6 * dt) spawnBubble(target);   // it struggles
      if (catchT >= HOLD) mode = "reel";
    } else if (mode === "reel") {
      hookTipY -= REEL * dt;
      target.x = hookX; target.y = hookTipY;
      if (hookTipY < -80) finishCatch();
    }

    drawBubbles();
    var gInfo = mode === "catch" ? { gi: 1, flash: catchT < 0.1 } : mode === "reel" ? { gi: 0.62, flash: false } : null;
    var caught = (mode === "catch" || mode === "reel") ? target : null;
    for (i = 0; i < fishes.length; i++) drawFish(fishes[i], tsec, fishes[i] === caught ? gInfo : null);
    if (mode !== "swim") drawHook();

    raf = requestAnimationFrame(step);
  }
  function start() { if (!running && cssH > 10) { running = true; last = 0; raf = requestAnimationFrame(step); } }
  function stop() { running = false; cancelAnimationFrame(raf); }

  // ── setup, sizing, lifecycle ──────────────────────────
  function resize() {
    var b = cv.getBoundingClientRect();
    cssW = b.width; cssH = b.height;
    cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    for (var i = 0; i < fishes.length; i++) {
      if (fishes[i].x > cssW + 70 || fishes[i].x < -70) fishes[i].x = rnd(0, cssW);
      fishes[i].y = Math.min(fishes[i].y, cssH * 0.9);
    }
  }
  function build() {
    resize();
    if (cssH < 10) { requestAnimationFrame(build); return; }
    N = window.innerWidth < 820 ? 9 : 14;
    fishes = [];
    for (var i = 0; i < N; i++) fishes.push(makeFish(false));

    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      var still = function () { ctx.clearRect(0, 0, cssW, cssH); for (var j = 0; j < fishes.length; j++) drawFish(fishes[j], 0, null); };
      still();
      new MutationObserver(still).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
      return;
    }
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (es) {
        es.forEach(function (e) { e.isIntersecting && !document.hidden ? start() : stop(); });
      }, { threshold: 0 }).observe(cv);
    } else { start(); }
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) { stop(); return; }
      var r = cv.getBoundingClientRect();
      if (r.bottom > 0 && r.top < window.innerHeight) start();
    });
    var rt; window.addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(resize, 150); });
  }
  build();
}());
