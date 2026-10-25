// The Mandelbrot set with every hero on its real axis (the powers page and the leaderboards).
// <canvas class="mandel" data-heroes='[{"name": "Dana", "c": -0.52, "style": "steady", "me": true}, ...]'>
// A hero's fractal rhythm puts them at c on the real axis: steady gardeners sit in the calm main cardioid (on the
// right), irregular ones drift left through the period-doubling bulbs into the chaotic tail. Drawn once per size.
(function () {
  var REGIONS = [                              // the real axis, right to left (games.STYLES)
    { from: 0.25, to: -0.75, id: 'steady', name: 'Steady', color: '#7ee08a' },
    { from: -0.75, to: -1.25, id: 'two-beat', name: 'Two-beat', color: '#ffd166' },
    { from: -1.25, to: -1.4012, id: 'many-beat', name: 'Many', color: '#ff9f5a' },
    { from: -1.4012, to: -2.0, id: 'wild', name: 'Wild', color: '#ff6b8b' }
  ];
  var STYLE_COLOR = {};
  REGIONS.forEach(function (r) { STYLE_COLOR[r.id] = r.color; });

  function draw(cv) {
    var heroes = [];
    try { heroes = JSON.parse(cv.dataset.heroes || '[]'); } catch (e) { heroes = []; }
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var W = Math.max(280, cv.clientWidth), H = Math.round(W * (W < 520 ? 0.78 : 0.58));
    cv.style.height = H + 'px';
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    var g = cv.getContext('2d'), w = cv.width, h = cv.height;
    var x0 = -2.2, x1 = 0.62, sc = (x1 - x0) / w;          // complex units per pixel
    var midY = h * 0.47;
    var img = g.createImageData(w, h), d = img.data, maxIt = 80;
    var half = Math.ceil(midY);
    for (var py = 0; py <= half; py++) {                      // (the set is symmetric: draw the top half, mirror it)
      var cy = (midY - py) * sc;
      for (var px = 0; px < w; px++) {
        var cx = x0 + px * sc, zx = 0, zy = 0, it = 0, zx2 = 0, zy2 = 0;
        while (zx2 + zy2 < 16 && it < maxIt) {
          zy = 2 * zx * zy + cy; zx = zx2 - zy2 + cx;
          zx2 = zx * zx; zy2 = zy * zy; it++;
        }
        var r, gg, b;
        if (it >= maxIt) { r = 14; gg = 34; b = 26; }        // inside: deep garden green
        else {
          var t = (it + 1 - Math.log(Math.log(Math.sqrt(zx2 + zy2))) / Math.LN2) / maxIt;   // smooth escape time
          t = Math.max(0, Math.min(1, t));
          var u = Math.pow(t, 0.45);
          r = 10 + 245 * Math.pow(u, 2.2); gg = 18 + 220 * Math.pow(u, 1.25); b = 30 + 120 * u * (1 - u) + 60 * Math.pow(u, 3);
        }
        var y2 = Math.round(2 * midY - py);
        var i1 = (py * w + px) * 4;
        d[i1] = r; d[i1 + 1] = gg; d[i1 + 2] = b; d[i1 + 3] = 255;
        if (y2 < h && y2 !== py) { var i2 = (y2 * w + px) * 4; d[i2] = r; d[i2 + 1] = gg; d[i2 + 2] = b; d[i2 + 3] = 255; }
      }
    }
    g.putImageData(img, 0, 0);
    function X(c) { return (c - x0) / sc; }
    // the real axis, coloured by style
    var lw = 4 * dpr;
    REGIONS.forEach(function (rg) {
      g.strokeStyle = rg.color; g.lineWidth = lw; g.globalAlpha = 0.9;
      g.beginPath(); g.moveTo(X(rg.from), midY); g.lineTo(X(rg.to), midY); g.stroke();
    });
    g.globalAlpha = 1;
    var fs = Math.round(11 * dpr);
    g.font = '700 ' + fs + 'px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'top';
    REGIONS.forEach(function (rg) {
      var x = (X(rg.from) + X(rg.to)) / 2, wpx = Math.abs(X(rg.from) - X(rg.to));
      if (g.measureText(rg.name).width > wpx + 30 * dpr && rg.id === 'many-beat') return;
      g.fillStyle = 'rgba(0,0,0,0.55)';
      var tw = g.measureText(rg.name).width + 10 * dpr;
      g.fillRect(x - tw / 2, h - fs - 12 * dpr, tw, fs + 6 * dpr);
      g.fillStyle = rg.color; g.fillText(rg.name, x, h - fs - 9 * dpr);
    });
    // the heroes: dots on the axis, names stacked in lanes above and below so they don't overlap
    var lanes = [[], [], [], [], [], []];                 // even lanes above, odd below
    var laneY = function (k) { var step = (fs + 9 * dpr); return k % 2 === 0 ? midY - 18 * dpr - step * (k / 2) : midY + 18 * dpr + step * ((k - 1) / 2); };
    heroes.slice().sort(function (a, b) { return a.c - b.c; }).forEach(function (hh) {
      var x = X(hh.c), col = STYLE_COLOR[hh.style] || '#ffffff';
      g.beginPath(); g.arc(x, midY, (hh.me ? 7 : 5) * dpr, 0, Math.PI * 2);
      g.fillStyle = col; g.fill(); g.lineWidth = 2 * dpr; g.strokeStyle = hh.me ? '#ffffff' : '#10241a'; g.stroke();
      var name = hh.name.length > 12 ? hh.name.slice(0, 11) + '…' : hh.name;
      g.font = (hh.me ? '800 ' : '600 ') + fs + 'px system-ui, sans-serif';
      var tw = g.measureText(name).width + 10 * dpr;
      var k = 0;
      for (; k < lanes.length; k++) {
        if (!lanes[k].some(function (sp) { return x - tw / 2 < sp[1] + 4 * dpr && x + tw / 2 > sp[0] - 4 * dpr; })) break;
      }
      if (k >= lanes.length) return;                         // (crowded: the dot is enough)
      lanes[k].push([x - tw / 2, x + tw / 2]);
      var y = laneY(k);
      g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1 * dpr;
      g.beginPath(); g.moveTo(x, midY + (k % 2 ? 6 : -6) * dpr); g.lineTo(x, y + (k % 2 ? 0 : fs + 4 * dpr)); g.stroke();
      g.fillStyle = 'rgba(10,20,14,0.82)';
      g.fillRect(x - tw / 2, y - 2 * dpr, tw, fs + 6 * dpr);
      g.fillStyle = hh.me ? '#ffffff' : col; g.textBaseline = 'top';
      g.fillText(name, x, y + 1 * dpr);
    });
    // axis ticks: -2, -1, 0
    g.fillStyle = 'rgba(255,255,255,0.7)'; g.font = '600 ' + Math.round(10 * dpr) + 'px system-ui, sans-serif';
    [-2, -1.5, -1, -0.5, 0].forEach(function (c) { g.fillText(String(c), X(c), 6 * dpr); });
  }

  function all() { document.querySelectorAll('canvas.mandel').forEach(draw); }
  var timer = null, lastW = 0;
  window.addEventListener('resize', function () {
    clearTimeout(timer);
    timer = setTimeout(function () { if (Math.abs(window.innerWidth - lastW) > 30) { lastW = window.innerWidth; all(); } }, 250);
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { lastW = window.innerWidth; all(); });
  else { lastW = window.innerWidth; all(); }
  window.NevetMandel = { draw: draw, colors: STYLE_COLOR };
})();
