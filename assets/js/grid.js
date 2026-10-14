// Hero background: a bird's-eye-view occupancy grid around an ego vehicle.
// One radar-style sweep reveals free space, obstacles, and the cells hidden
// behind them. With reduced motion, the finished grid is drawn immediately.
(function () {
  var canvas = document.querySelector(".hero-grid");
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext("2d");
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var CELL = 14;      // cell pitch in CSS pixels
  var GAP = 2;        // gap between cells
  var state = null;   // grid model, rebuilt on resize

  function colors() {
    var s = getComputedStyle(document.documentElement);
    return {
      unknown: s.getPropertyValue("--cell-unknown").trim() || "#e9edf1",
      free: s.getPropertyValue("--cell-free").trim() || "#dfe5ec",
      occ: s.getPropertyValue("--accent").trim() || "#1d4ed8",
      ink: s.getPropertyValue("--ink").trim() || "#18202b"
    };
  }

  // Small seeded random generator so the scene is the same on every visit.
  function rng(seed) {
    return function () {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
  }

  function build() {
    var w = canvas.clientWidth, h = canvas.clientHeight;
    var cols = Math.ceil(w / CELL), rows = Math.ceil(h / CELL);
    var occ = new Uint8Array(cols * rows);
    var rand = rng(7);

    // Ego vehicle sits near the bottom, toward the right of the hero.
    var narrow = w < 768;
    var ex = Math.floor(cols * (narrow ? 0.5 : 0.72));
    var ey = rows - 6;

    function mark(x, y, cw, ch) {
      for (var j = y; j < y + ch; j++)
        for (var i = x; i < x + cw; i++)
          if (i >= 0 && j >= 0 && i < cols && j < rows) occ[j * cols + i] = 1;
    }

    // Parked cars along both sides of a lane, a wall segment, and pedestrians.
    var lane = 5;
    for (var y = ey - 8; y > 4; y -= 8 + Math.floor(rand() * 4)) {
      if (rand() > 0.25) mark(ex - lane - 3, y - 6, 3, 6);
      if (rand() > 0.3) mark(ex + lane + 1, y - 6, 3, 6);
    }
    // A car ahead in the lane and a curb line on the far left.
    mark(ex - 1, Math.floor(rows * 0.3), 3, 5);
    mark(ex - lane - 6, Math.floor(rows * 0.45), 1, Math.floor(rows * 0.4));
    for (var k = 0; k < 7; k++) {
      var px = ex + Math.floor((rand() - 0.5) * cols * 0.7);
      var py = Math.floor(rand() * (ey - 8)) + 2;
      if (Math.abs(px - ex) > 2) mark(px, py, 1 + Math.floor(rand() * 2), 1 + Math.floor(rand() * 2));
    }

    // Visibility by ray marching from the sensor to each cell center.
    var range = Math.max(rows * 1.15, 24);
    var seen = new Uint8Array(cols * rows);
    var angle = new Float32Array(cols * rows);
    var inRange = new Uint8Array(cols * rows);
    for (var j = 0; j < rows; j++) {
      for (var i = 0; i < cols; i++) {
        var dx = i - ex, dy = ey - j;
        var d = Math.sqrt(dx * dx + dy * dy);
        var idx = j * cols + i;
        angle[idx] = Math.atan2(dy, dx); // 0 = right, PI = left
        if (dy < 0 || d > range) continue;
        inRange[idx] = 1;
        var steps = Math.ceil(d * 2), blocked = false;
        for (var s = 1; s < steps; s++) {
          var t = s / steps;
          var cx = Math.round(ex + dx * t), cy = Math.round(ey - dy * t);
          if (cx === i && cy === j) break;
          if (occ[cy * cols + cx]) { blocked = true; break; }
        }
        if (!blocked) seen[idx] = 1;
      }
    }

    return { w: w, h: h, cols: cols, rows: rows, occ: occ, seen: seen, angle: angle, inRange: inRange, ex: ex, ey: ey };
  }

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    state = build();
  }

  // Draw every cell; cells whose bearing has been swept show their state.
  function draw(sweep) {
    var c = colors(), g = state, size = CELL - GAP;
    ctx.clearRect(0, 0, g.w, g.h);
    for (var j = 0; j < g.rows; j++) {
      for (var i = 0; i < g.cols; i++) {
        var idx = j * g.cols + i;
        var swept = g.angle[idx] >= sweep && g.inRange[idx];
        // Obstacles show once swept; free space only where the sensor has line of sight.
        var revealed = swept && (g.occ[idx] || g.seen[idx]);
        if (revealed && g.occ[idx]) ctx.fillStyle = c.occ;
        else if (revealed) ctx.fillStyle = c.free;
        else ctx.fillStyle = c.unknown;
        ctx.fillRect(i * CELL, j * CELL, size, size);
      }
    }
    // Ego vehicle outline.
    ctx.fillStyle = c.ink;
    ctx.fillRect((g.ex - 1) * CELL, g.ey * CELL, CELL * 3 - GAP, CELL * 5 - GAP);
  }

  function animate() {
    var start = null, duration = 2200;
    function frame(ts) {
      if (start === null) start = ts;
      var p = Math.min((ts - start) / duration, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      // Sweep from the left horizon (PI) clockwise to the right (0).
      draw(Math.PI * (1 - eased) - 0.001);
      if (p < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  resize();
  if (reduceMotion) draw(-1); else animate();

  var timer;
  window.addEventListener("resize", function () {
    clearTimeout(timer);
    timer = setTimeout(function () { resize(); draw(-1); }, 150);
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () { draw(-1); });
  // While the page fades between themes, redraw each frame so the grid fades with it.
  document.addEventListener("themechange", function () {
    if (reduceMotion) { draw(-1); return; }
    var start = performance.now();
    (function frame(now) {
      draw(-1);
      if (now - start < 500) requestAnimationFrame(frame);
    })(start);
  });
})();
