/* time3d.js - the Time page: the farm's story as two vines growing through a pink sky.
 *
 * A green vine (the garden) and a pink one (its people) twist around each
 * other from the first day to today. Each day with something in it is a
 * blossom on the vine, bigger on busier days; days with a big moment (a
 * hero joining, two heroes connecting, a first harvest, a new group...) also
 * get a floating heart. Drag, scroll, use the slider or the arrows to travel;
 * tap a blossom to jump to it; Play tells the story from wherever you are.
 * Data: window.NEVET_STORY from timeline.py.
 */
(function () {
  'use strict';
  var S = window.NEVET_STORY || { days: [] }, DAYS = S.days || [];
  var canvas = document.getElementById('time-canvas'), wrap = document.getElementById('time-wrap');
  var ui = {
    card: document.getElementById('time-card'), date: document.getElementById('time-date'), count: document.getElementById('time-count'),
    heading: document.getElementById('time-heading'), lines: document.getElementById('time-lines'), chips: document.getElementById('time-chips'),
    range: document.getElementById('time-range'), play: document.getElementById('time-play'),
    prev: document.getElementById('time-prev'), next: document.getElementById('time-next')
  };
  if (!DAYS.length) { ui.card.hidden = true; document.querySelector('.time-scrub').hidden = true; ui.play.hidden = true; }
  if (!window.THREE || !window.Nevet3D || !Nevet3D.supportsWebGL()) { canvas.style.display = 'none'; if (DAYS.length) showDay(DAYS.length - 1); return; }

  var V = function (x, y, z) { return new THREE.Vector3(x, y, z); }, PI = Math.PI, TAU = PI * 2;
  // the palette: garden greens and people pinks (time.css uses the same colours)
  var C = {
    forest: 0x1f6b3f, emerald: 0x2e9e5b, sage: 0x6cc28a, lime: 0xa6e36b, mint: 0xc6f1d8,
    magenta: 0xd81b60, rose: 0xec407a, hot: 0xff2d7a, petal: 0xff8fb8, blush: 0xffd6e7, cream: 0xfff3f7, gold: 0xffc94d
  };
  var PINK = C.rose;
  var calm = Nevet3D.reducedMotion();

  // ---------------------------------------------------------------- scene
  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  var scene = new THREE.Scene();
  scene.background = (function () {                    // sky: blush pink above, mint at the horizon
    var c = document.createElement('canvas'); c.width = 4; c.height = 256;
    var g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, '#ff9cc6'); gr.addColorStop(0.3, '#ffc4dc'); gr.addColorStop(0.58, '#ffe3ee');
    gr.addColorStop(0.8, '#e6f8ea'); gr.addColorStop(1, '#bfeccf');
    g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
    var t = new THREE.CanvasTexture(c); return t;
  })();
  scene.fog = new THREE.Fog(0xffe6ef, 14, 46);
  var camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
  // gentle light: brighter would clip the pinks towards violet and the greens towards neon
  scene.add(new THREE.HemisphereLight(0xfff0f5, 0xcdeed8, 0.62));
  var sun = new THREE.DirectionalLight(0xfff6ec, 0.5); sun.position.set(4, 10, 6); scene.add(sun);
  var rim = new THREE.DirectionalLight(0xffd0e0, 0.22); rim.position.set(-6, 3, -8); scene.add(rim);     // a soft pink glow from behind

  function toon(color, extra) { var m = new THREE.MeshToonMaterial(Object.assign({ color: color }, extra || {})); return m; }
  // paint a tube along its length: stops are [where 0..1, colour]; wave adds a gentle shimmer
  function paintAlong(geo, stops, wave) {
    var uv = geo.attributes.uv, n = uv.count, out = new Float32Array(n * 3), a = new THREE.Color(), b = new THREE.Color();
    for (var i = 0; i < n; i++) {
      var u = uv.getX(i), k = 0;
      while (k < stops.length - 2 && u > stops[k + 1][0]) k++;
      var t = Math.max(0, Math.min(1, (u - stops[k][0]) / ((stops[k + 1][0] - stops[k][0]) || 1)));
      a.setHex(stops[k][1]); b.setHex(stops[k + 1][1]); a.lerp(b, t);
      if (wave) a.offsetHSL(0, 0, Math.sin(u * wave) * 0.04);
      out[i * 3] = a.r; out[i * 3 + 1] = a.g; out[i * 3 + 2] = a.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(out, 3));
    return geo;
  }

  var vineG = new THREE.Group(); scene.add(vineG);           // the story's vines (the tree view has its own group)
  // ---------------------------------------------------------------- the vines
  var N = Math.max(1, DAYS.length), SP = 3.0;
  function base(i) { return V(Math.sin(i * 0.5) * 2.4, Math.cos(i * 0.33) * 1.1 + Math.sin(i * 1.1) * 0.25, -i * SP); }
  var pts = [];
  for (var i = -1; i <= N; i++) pts.push(base(i));
  var curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
  var span = function (d) { return (d + 1) / (N + 1); };          // day index -> curve parameter
  var segs = Math.min(1600, (N + 2) * 14);
  // the green vine: deep forest at the first day, growing brighter towards today
  vineG.add(new THREE.Mesh(paintAlong(new THREE.TubeGeometry(curve, segs, 0.14, 8, false),
    [[0, C.forest], [0.5, C.emerald], [1, 0x7ccf6a]], (N + 1) * 0.9), toon(0xffffff, { vertexColors: true })));
  // the pink vine winds around the green one: the garden and its people, together
  var frames = curve.computeFrenetFrames(segs, false), pinkPts = [];
  for (var k = 0; k <= segs; k++) {
    var u = k / segs, p = curve.getPointAt(u), a = u * (N + 1) * 2.2;
    var off = frames.normals[k].clone().multiplyScalar(Math.cos(a) * 0.32).add(frames.binormals[k].clone().multiplyScalar(Math.sin(a) * 0.32));
    pinkPts.push(p.add(off));
  }
  vineG.add(new THREE.Mesh(paintAlong(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pinkPts), segs, 0.07, 6, false),
    [[0, C.magenta], [0.5, C.rose], [1, C.petal]], (N + 1) * 2.2),
    toon(0xffffff, { vertexColors: true, emissive: new THREE.Color(0x5a0a2a), emissiveIntensity: 0.25 })));

  // leaves along the green vine
  var leafGeo = new THREE.SphereGeometry(0.22, 8, 6); leafGeo.scale(1, 0.25, 0.55); leafGeo.translate(0.22, 0, 0);
  var leafN = Math.min(1400, (N + 1) * 5), leaves = new THREE.InstancedMesh(leafGeo, toon(0xffffff), leafN);
  var leafTones = [C.emerald, C.sage, C.lime, C.emerald, 0x4fb36f];
  var m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), col = new THREE.Color();
  for (var l = 0; l < leafN; l++) {
    var lu = (l + 0.5) / leafN, lp = curve.getPointAt(lu);
    q.setFromEuler(new THREE.Euler((l * 2.4) % TAU, (l * 1.7) % TAU, 0.4));
    sc.setScalar(0.7 + ((l * 37) % 10) / 20);
    m4.compose(lp, q, sc); leaves.setMatrixAt(l, m4);
    leaves.setColorAt(l, col.setHex(leafTones[(l * 7) % leafTones.length]).offsetHSL(0, 0, (((l * 13) % 5) - 2) / 80));
  }
  vineG.add(leaves);

  // ---------------------------------------------------------------- the days: blossoms (and hearts)
  var dayPos = DAYS.map(function (d, i) { return curve.getPointAt(span(i)).add(V(0, 0.42, 0)); });
  var petalGeo = new THREE.SphereGeometry(0.2, 10, 8); petalGeo.scale(1, 0.32, 0.6); petalGeo.translate(0.2, 0, 0);
  var petals = new THREE.InstancedMesh(petalGeo, toon(0xffffff), N * 5);
  var hearts3 = new THREE.InstancedMesh(new THREE.SphereGeometry(0.11, 10, 8), toon(C.gold, { emissive: new THREE.Color(0x7a4a00), emissiveIntensity: 0.25 }), N);
  var petalTones = [C.petal, C.blush, C.rose, C.petal, C.cream], heartTones = [C.rose, C.hot, C.petal, C.magenta, C.rose];
  var busiest = DAYS.reduce(function (m, d) { return Math.max(m, d.n); }, 1);
  var blossomSize = DAYS.map(function (d) { return 0.75 + 0.9 * Math.sqrt(d.n / busiest) + (d.heart ? 0.25 : 0); });
  var proxies = [];
  DAYS.forEach(function (d, i) {
    var p = dayPos[i], s = blossomSize[i], tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.9, 0, 0.3 * Math.sin(i)));
    for (var j = 0; j < 5; j++) {
      var qq = tilt.clone().multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), j / 5 * TAU + i));
      m4.compose(p, qq, sc.setScalar(s)); petals.setMatrixAt(i * 5 + j, m4);
      petals.setColorAt(i * 5 + j, col.setHex((d.heart ? heartTones : petalTones)[(i * 3 + j) % 5]));
    }
    m4.compose(p, tilt, sc.setScalar(s)); hearts3.setMatrixAt(i, m4);
    var proxy = new THREE.Mesh(new THREE.SphereGeometry(0.6 * s, 6, 4), new THREE.MeshBasicMaterial({ visible: false }));
    proxy.position.copy(p); proxy.userData.day = i; vineG.add(proxy); proxies.push(proxy);
  });
  vineG.add(petals); vineG.add(hearts3);

  // hearts for the big moments: puffy, glowing, floating above their day
  var heartShape = new THREE.Shape();
  heartShape.moveTo(0, -0.5);
  heartShape.bezierCurveTo(-0.15, -0.35, -0.6, -0.1, -0.6, 0.2); heartShape.bezierCurveTo(-0.6, 0.55, -0.2, 0.62, 0, 0.35);
  heartShape.bezierCurveTo(0.2, 0.62, 0.6, 0.55, 0.6, 0.2); heartShape.bezierCurveTo(0.6, -0.1, 0.15, -0.35, 0, -0.5);
  var heartGeo = new THREE.ExtrudeGeometry(heartShape, { depth: 0.18, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.07, bevelSegments: 3, curveSegments: 14 });
  heartGeo.center();
  var heartMat = toon(0xf0508a, { emissive: new THREE.Color(0x7a0c35), emissiveIntensity: 0.3 });
  var loveMat = toon(0xff2d6a, { emissive: new THREE.Color(0x9c0f44), emissiveIntensity: 0.4 });
  var glowTex = (function () {
    var c = document.createElement('canvas'); c.width = c.height = 64;
    var g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,214,231,0.95)'); gr.addColorStop(0.45, 'rgba(255,170,205,0.45)'); gr.addColorStop(1, 'rgba(255,190,215,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
  })();
  var bigHearts = [];
  DAYS.forEach(function (d, i) {
    if (!d.heart) return;
    var love = d.moments.indexOf('love') >= 0, h = new THREE.Mesh(heartGeo, love ? loveMat : heartMat);
    var g = new THREE.Group(); g.add(h);
    var glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, opacity: 0.8 }));
    glow.scale.setScalar(love ? 2.4 : 1.8); g.add(glow);
    g.position.copy(dayPos[i]).add(V(0, love ? 1.25 : 1.0, 0));
    g.scale.setScalar(love ? 0.9 : 0.62);
    g.userData = { i: i, y: g.position.y, ph: i * 0.7 };
    vineG.add(g); bigHearts.push(g);
  });

  // date labels on chapter days, big moments and about every week
  var labels = [];
  DAYS.forEach(function (d, i) {
    if (!(d.heart || i % 6 === 0 || i === N - 1)) return;
    var lbl = Nevet3D.makeLabel(d.label, d.heart ? '#c2185b' : '#1f6b3f', 1.25);
    lbl.position.copy(dayPos[i]).add(V(0, d.heart ? (d.moments.indexOf('love') >= 0 ? 2.35 : 1.95) : 0.85, 0));
    vineG.add(lbl); labels.push(lbl);
  });

  // little hearts drifting up through the air, and pollen
  var tinyTex = (function () {
    var c = document.createElement('canvas'); c.width = c.height = 128;
    var g = c.getContext('2d'); g.fillStyle = '#fff'; g.font = 'bold 108px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('♥', 64, 72);
    return new THREE.CanvasTexture(c);
  })();
  var floaters = [];
  for (var f = 0; f < 46; f++) {
    var tone = f % 4 === 3 ? [C.sage, C.lime, C.mint][f % 3] : [C.petal, C.rose, C.blush, C.hot][f % 4];   // mostly pink hearts, a few green ones
    var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tinyTex, color: new THREE.Color(tone), transparent: true, depthWrite: false, opacity: 0.85, fog: f % 4 !== 3 }));   // green ones skip the pink fog, or they turn grey
    sp.scale.setScalar(0.22 + (f % 4) * 0.06);
    sp.userData = { ox: (Math.random() - 0.5) * 12, oz: -Math.random() * 12 + 1, ph: Math.random() * 6, sp: 0.25 + Math.random() * 0.35 };   // around and beyond the vine, never in the camera's face
    scene.add(sp); floaters.push(sp);
  }
  var pollenGeo = new THREE.BufferGeometry(), pp = new Float32Array(500 * 3);
  for (var pi = 0; pi < 500; pi++) { var pu = Math.random(); var ppos = curve.getPointAt(pu); pp[pi * 3] = ppos.x + (Math.random() - 0.5) * 12; pp[pi * 3 + 1] = ppos.y + (Math.random() - 0.3) * 6; pp[pi * 3 + 2] = ppos.z + (Math.random() - 0.5) * 6; }
  pollenGeo.setAttribute('position', new THREE.BufferAttribute(pp, 3));
  var pc = new Float32Array(500 * 3), pcol = new THREE.Color();
  for (var pk = 0; pk < 500; pk++) { pcol.setHex([0xffffff, C.blush, C.mint, 0xffffff, C.petal][pk % 5]); pc[pk * 3] = pcol.r; pc[pk * 3 + 1] = pcol.g; pc[pk * 3 + 2] = pcol.b; }
  pollenGeo.setAttribute('color', new THREE.BufferAttribute(pc, 3));
  var dotTex = (function () {
    var c = document.createElement('canvas'); c.width = c.height = 32;
    var g = c.getContext('2d'), gr = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 32, 32); return new THREE.CanvasTexture(c);
  })();
  vineG.add(new THREE.Points(pollenGeo, new THREE.PointsMaterial({ map: dotTex, vertexColors: true, size: 0.12, transparent: true, opacity: 0.9, depthWrite: false })));

  // ---------------------------------------------------------------- the mother tree: who invited whom
  // Every hero grows on the branch of the hero who invited them, as high up the trunk as the day they joined (time
  // runs up the tree, like it runs along the vine), in the colour of their outfit; heroes who came on their own grow
  // straight from the trunk. Ribbons join heroes who are family, partners, friends or teammates. The tree grows with
  // the story: travel through time and the branches grow as heroes join. In the story view, golden arcs over the
  // vine join each hero's day to the day of the hero who invited them, so the two stories wind together.
  var TREE = S.tree || { nodes: [], links: [] }, TN = TREE.nodes || [], byId = {};
  TN.forEach(function (n) { byId[n.id] = n; n.kids2 = []; });
  TN.forEach(function (n) { if (n.by && byId[n.by]) byId[n.by].kids2.push(n); else n.by = null; });
  var dayIndex = {};                                    // date -> the story's day for it
  DAYS.forEach(function (d, i) { dayIndex[d.date] = i; });
  function ms(dstr) { var t = Date.parse((dstr || '') + 'T12:00:00'); return isNaN(t) ? null : t; }
  var t0 = ms(S.first) || TN.reduce(function (m, n) { var t = ms(n.joined); return t && (!m || t < m) ? t : m; }, null) || Date.now();
  var t1 = Math.max(t0 + 86400000, ms(S.today) || Date.now());
  var TH = Math.max(9, Math.min(26, 7 + TN.length * 0.45));             // the tree's height (metres) for the whole story
  function yOf(t) { return 1.4 + TH * Math.max(0, Math.min(1, (t - t0) / (t1 - t0))); }
  function dateAt(p) {                                  // the story's date at a (fractional) day index
    if (!DAYS.length) return t1;
    var i = Math.max(0, Math.min(DAYS.length - 1, Math.floor(p))), j = Math.min(DAYS.length - 1, i + 1), f = Math.max(0, Math.min(1, p - i));
    var a = ms(DAYS[i].date), b = ms(DAYS[j].date);
    return a + (b - a) * f + 43200000 * (p >= DAYS.length - 1 ? 1 : 0);
  }
  // the radial layout: each root gets a share of the circle by the size of its family, children share their parent's
  function size(n) { n.size = 1 + n.kids2.reduce(function (a, c) { return a + size(c); }, 0); return n.size; }
  var roots = TN.filter(function (n) { return !n.by; }), totalSize = roots.reduce(function (a, r) { return a + size(r); }, 0) || 1;
  var sameDay = {}, maxR = 3;
  function place(n, lo, hi, depth) {
    n.ang = (lo + hi) / 2; n.depth = depth;
    n.r = 2.2 + depth * 2.1 + (n.id % 3) * 0.25;
    var t = ms(n.joined) || t0, k = sameDay[n.joined] = (sameDay[n.joined] || 0) + 1;
    n.t = t; n.pos = V(Math.cos(n.ang) * n.r, yOf(t) + (k - 1) * 0.32, Math.sin(n.ang) * n.r);
    maxR = Math.max(maxR, n.r);
    var a = lo, kids = n.kids2.slice().sort(function (x, y) { return (x.t || 0) - (y.t || 0) || x.id - y.id; });
    kids.forEach(function (c) { var w = (hi - lo) * c.size / Math.max(1, n.size - 1); place(c, a, a + w, depth + 1); a += w; });
  }
  var a0 = -PI / 2;
  roots.slice().sort(function (x, y) { return (ms(x.joined) || 0) - (ms(y.joined) || 0) || x.id - y.id; }).forEach(function (r) {
    var w = TAU * r.size / totalSize; place(r, a0, a0 + w, 0); a0 += w;
  });
  TN.forEach(function (n) {                            // (a loop in the data would leave heroes unplaced: they grow from the trunk)
    if (n.pos) return;
    n.by = null; n.kids2 = []; n.size = 1; place(n, a0 - 0.2, a0 + 0.2, 0); a0 += 0.5;
  });
  var treeG = new THREE.Group(); treeG.visible = false; scene.add(treeG);
  function growable(mesh) { mesh.userData.full = mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.attributes.position.count; mesh.geometry.setDrawRange(0, 0); mesh.userData.g = 0; return mesh; }
  function setGrowth(mesh, g) {
    if (Math.abs(mesh.userData.g - g) < 0.002) return;
    mesh.userData.g = g;
    var n = Math.floor(mesh.userData.full * g / 6) * 6;          // (whole triangles)
    mesh.geometry.setDrawRange(0, n); mesh.visible = n > 0;
  }
  // the trunk: the green vine and the pink one twisted together, rising through the story, with roots in the grass
  var trunkPts = [], trunkPink = [];
  for (var ti = 0; ti <= 60; ti++) {
    var ty = -0.3 + (TH + 2.2) * ti / 60;
    trunkPts.push(V(Math.sin(ti * 0.35) * 0.18, ty, Math.cos(ti * 0.29) * 0.18));
    trunkPink.push(V(Math.cos(ti * 0.9) * 0.42, ty, Math.sin(ti * 0.9) * 0.42));
  }
  var trunkCurve = new THREE.CatmullRomCurve3(trunkPts), trunk = growable(new THREE.Mesh(paintAlong(new THREE.TubeGeometry(trunkCurve, 120, 0.36, 10, false),
    [[0, 0x6b4a2b], [0.12, C.forest], [0.6, C.emerald], [1, 0x7ccf6a]], 30), toon(0xffffff, { vertexColors: true })));
  var trunkP = growable(new THREE.Mesh(paintAlong(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(trunkPink), 240, 0.13, 6, false),
    [[0, C.magenta], [0.5, C.rose], [1, C.petal]], 60), toon(0xffffff, { vertexColors: true, emissive: new THREE.Color(0x5a0a2a), emissiveIntensity: 0.25 })));
  treeG.add(trunk); treeG.add(trunkP);
  for (var rt = 0; rt < 7; rt++) {
    var ra = rt / 7 * TAU + 0.3, rlen = 2.2 + (rt % 3) * 0.7;
    var rc = new THREE.CatmullRomCurve3([V(0, 0.4, 0), V(Math.cos(ra) * rlen * 0.45, 0.05, Math.sin(ra) * rlen * 0.45), V(Math.cos(ra) * rlen, -0.25, Math.sin(ra) * rlen)]);
    treeG.add(new THREE.Mesh(new THREE.TubeGeometry(rc, 16, 0.16 - rt * 0.01, 6, false), toon(0x6b4a2b)));
  }
  var grass = new THREE.Mesh(new THREE.CircleGeometry(maxR + 7, 48), new THREE.MeshBasicMaterial({ map: (function () {
    var c = document.createElement('canvas'); c.width = c.height = 256;
    var g = c.getContext('2d'), gr = g.createRadialGradient(128, 128, 10, 128, 128, 128);
    gr.addColorStop(0, '#9fdcae'); gr.addColorStop(0.55, '#c9efd4'); gr.addColorStop(1, 'rgba(230,248,234,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256); return new THREE.CanvasTexture(c);
  })(), transparent: true, depthWrite: false }));
  grass.rotation.x = -PI / 2; grass.position.y = -0.02; treeG.add(grass);
  // a name tag: the hero's name on a little pill in their colour
  function nameTag(text, color) {
    var c = document.createElement('canvas'), g = c.getContext('2d'), px = 44;
    g.font = 'bold ' + px + 'px -apple-system, Segoe UI, Roboto, sans-serif';
    var w = Math.ceil(g.measureText(text).width) + 40, h = 70;
    c.width = w; c.height = h; g = c.getContext('2d');
    g.fillStyle = 'rgba(255,250,252,0.94)'; g.beginPath(); g.moveTo(35, 2); g.arcTo(w - 2, 2, w - 2, h - 2, 33); g.arcTo(w - 2, h - 2, 2, h - 2, 33); g.arcTo(2, h - 2, 2, 2, 33); g.arcTo(2, 2, w - 2, 2, 33); g.fill();
    g.lineWidth = 4; g.strokeStyle = color; g.stroke();
    g.font = 'bold ' + px + 'px -apple-system, Segoe UI, Roboto, sans-serif'; g.fillStyle = '#5a1838'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, h / 2 + 2);
    var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
    sp.scale.set(0.52 * w / h, 0.52, 1); sp.userData.w = 0.52 * w / h; sp.renderOrder = 8;
    return sp;
  }
  // heroes: a blossom in their outfit's colour (bigger for heroes who invited many), a glow, their name
  var treeProxies = [], seeds = [];
  var seedTex = (function () {
    var c = document.createElement('canvas'); c.width = c.height = 64;
    var g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,250,220,1)'); gr.addColorStop(0.35, 'rgba(255,214,107,0.9)'); gr.addColorStop(1, 'rgba(255,190,60,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
  })();
  TN.forEach(function (n) {
    var col = new THREE.Color(n.color || '#ec407a'), g = new THREE.Group(), s = 0.62 + 0.11 * Math.min(8, n.kids);
    for (var j = 0; j < 6; j++) {
      var pm = new THREE.Mesh(petalGeo, toon(col.clone().offsetHSL(0, 0, j % 2 ? 0.08 : 0)));
      pm.quaternion.setFromEuler(new THREE.Euler(0.9, j / 6 * TAU, 0)); pm.scale.setScalar(1.25); g.add(pm);
    }
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), toon(C.gold, { emissive: new THREE.Color(0x7a4a00), emissiveIntensity: 0.3 })));
    if (!n.by) g.add(new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.045, 6, 24), toon(C.gold)));     // a root of the tree: a little gold ring
    var glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, opacity: 0.75 }));
    glow.scale.setScalar(1.7); g.add(glow);
    g.position.copy(n.pos); g.scale.setScalar(0.001); g.userData = { s: s, k: 0 };
    treeG.add(g); n.mesh = g;
    n.tag = nameTag(n.name, '#' + col.getHexString()); n.tag.position.copy(n.pos).add(V(0, 0.95 * s + 0.35, 0)); n.tag.visible = false; treeG.add(n.tag);
    var proxy = new THREE.Mesh(new THREE.SphereGeometry(0.75 * s + 0.2, 6, 4), new THREE.MeshBasicMaterial({ visible: false }));
    proxy.position.copy(n.pos); proxy.userData.hero = n.id; treeG.add(proxy); treeProxies.push(proxy);
    // the branch from the hero who invited them (or from the trunk), green with their colour at the tip
    var from = n.by ? byId[n.by].pos : V(0, Math.max(0.6, n.pos.y - 1.3), 0), to = n.pos;
    var mid = from.clone().lerp(to, 0.5).add(V(0, 0.35 + from.distanceTo(to) * 0.1, 0));
    var bc = new THREE.CatmullRomCurve3([from.clone(), from.clone().lerp(mid, 0.6), mid, to.clone()]);
    var rad = Math.max(0.05, 0.13 - n.depth * 0.022) * (n.kids ? 1.15 : 1);
    n.branch = growable(new THREE.Mesh(paintAlong(new THREE.TubeGeometry(bc, 36, rad, 6, false), [[0, n.by ? 0x2e9e5b : C.forest], [0.75, 0x5fbf6a], [1, col.getHex()]]),
      toon(0xffffff, { vertexColors: true })));
    n.curve = bc; treeG.add(n.branch);
    n.leaves = [0.3, 0.52, 0.74].map(function (lu, li) {   // leaves along the branch, out once it has grown
      var lf = new THREE.Mesh(leafGeo, toon(leafTones[(n.id + li) % leafTones.length]));
      lf.position.copy(bc.getPointAt(lu)); lf.rotation.set((n.id * 1.7 + li * 2.1) % TAU, (n.id + li * 2.4) % TAU, 0.5);
      lf.userData.u = lu; lf.scale.setScalar(0.001); treeG.add(lf);
      return lf;
    });
    n.seed = new THREE.Sprite(new THREE.SpriteMaterial({ map: seedTex, transparent: true, depthWrite: false, opacity: 0 }));
    n.seed.scale.setScalar(0.7); n.seed.visible = false; treeG.add(n.seed);
    n.grow = 0;
  });
  // ribbons between connected heroes: partners, family, friends, teammates
  var RIB = { love: 0xff2d7a, family: 0xc2185b, friends: 0xff8fb8, team: 0x7fd6a8 };
  var ribbons = (TREE.links || []).map(function (l) {
    var a = byId[l.a], b = byId[l.b];
    if (!a || !b) return null;
    var mid = a.pos.clone().lerp(b.pos, 0.5), out = V(mid.x, 0, mid.z).normalize().multiplyScalar(0.8 + a.pos.distanceTo(b.pos) * 0.12);
    if (!isFinite(out.x)) out.set(0.8, 0, 0);
    mid.add(out).add(V(0, 0.7 + a.pos.distanceTo(b.pos) * 0.14, 0));
    var rc2 = new THREE.CatmullRomCurve3([a.pos.clone(), mid, b.pos.clone()]);
    var m = growable(new THREE.Mesh(new THREE.TubeGeometry(rc2, 40, l.group === 'love' ? 0.06 : 0.04, 6, false),
      toon(RIB[l.group] || RIB.team, { emissive: new THREE.Color(RIB[l.group] || RIB.team), emissiveIntensity: 0.18 })));
    treeG.add(m);
    var hs = null;
    if (l.group === 'love' || l.group === 'family') {
      hs = new THREE.Sprite(new THREE.SpriteMaterial({ map: tinyTex, color: new THREE.Color(RIB[l.group]), transparent: true, depthWrite: false }));
      hs.scale.setScalar(l.group === 'love' ? 0.55 : 0.4); hs.position.copy(rc2.getPointAt(0.5)).add(V(0, 0.2, 0)); hs.visible = false; treeG.add(hs);
    }
    return { mesh: m, heart: hs, a: a, b: b, t: Math.max(ms(l.date) || 0, a.t || 0, b.t || 0), l: l, grow: 0 };
  }).filter(Boolean);
  // in the story view: golden arcs over the vine from the day the inviter joined to the day the new hero did
  var arcs = [];
  TN.forEach(function (n) {
    if (!n.by) return;
    var ia = dayIndex[byId[n.by].joined], ib = dayIndex[n.joined];
    if (ia === undefined || ib === undefined || ia === ib) return;
    var A = dayPos[ia], B = dayPos[ib], top = A.clone().lerp(B, 0.5).add(V(0, 1.6 + Math.min(6, A.distanceTo(B) * 0.12), 0));
    var ac = new THREE.CatmullRomCurve3([A.clone().add(V(0, 0.2, 0)), top, B.clone().add(V(0, 0.2, 0))]);
    var m = growable(new THREE.Mesh(new THREE.TubeGeometry(ac, 48, 0.028, 5, false), toon(0xf2b84b, { emissive: new THREE.Color(0x6a3c00), emissiveIntensity: 0.2 })));
    vineG.add(m);
    var sd = new THREE.Sprite(new THREE.SpriteMaterial({ map: seedTex, transparent: true, depthWrite: false })); sd.scale.setScalar(0.55); sd.visible = false; vineG.add(sd);
    arcs.push({ mesh: m, seed: sd, curve: ac, ib: ib, grow: 0 });
  });

  // ---------------------------------------------------------------- travelling through time
  var pos = 0, target = 0, playing = false, lastShown = -1, userAt = 0;
  var mode = 'vine', orbit = 0.6, selected = null;
  ui.range.max = Math.max(0, N - 1);
  function clampDay(x) { return Math.max(0, Math.min(N - 1, x)); }
  function go(x, byUser) { target = clampDay(x); if (byUser) { userAt = performance.now(); setPlaying(false); } }
  function setPlaying(on) { playing = on && N > 1; ui.play.classList.toggle('playing', playing); ui.play.setAttribute('aria-label', playing ? 'Pause' : 'Play the story'); if (playing && target >= N - 1.01) target = pos = 0; }
  ui.play.addEventListener('click', function () { setPlaying(!playing); });
  ui.range.addEventListener('input', function () { go(parseFloat(ui.range.value), true); });
  ui.prev.addEventListener('click', function () { go(Math.round(target) - 1, true); });
  ui.next.addEventListener('click', function () { go(Math.round(target) + 1, true); });
  window.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') go(Math.round(target) + 1, true);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') go(Math.round(target) - 1, true);
    else if (e.key === ' ') { e.preventDefault(); setPlaying(!playing); }
    else if (e.key === 't' || e.key === 'T') setMode(mode === 'tree' ? 'vine' : 'tree');
  });
  canvas.addEventListener('wheel', function (e) { e.preventDefault(); go(target + e.deltaY * 0.004 + e.deltaX * 0.004, true); }, { passive: false });
  var drag = null;
  canvas.addEventListener('pointerdown', function (e) { drag = { x: e.clientX, y: e.clientY, t: target, o: orbit, moved: false }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var dx = drag.x - e.clientX, d = dx + (drag.y - e.clientY);         // left or up = forward in time
    if (Math.abs(d) > 6 || Math.abs(dx) > 6) drag.moved = true;
    if (!drag.moved) return;
    if (mode === 'tree') { orbit = drag.o + dx * 0.008; userAt = performance.now(); }   // the tree: drag to walk round it
    else go(drag.t + d / 90, true);
  });
  canvas.addEventListener('pointerup', function (e) {
    if (drag && !drag.moved) {                                     // a tap: a blossom on the vine, or a hero on the tree
      if (mode === 'tree') {
        var hit = Nevet3D.pick(e, canvas, camera, treeProxies.filter(function (p) { return byId[p.userData.hero].grow > 0.5; }), 'hero');
        select(hit ? byId[hit.userData.hero] : null);
      } else {
        var hit2 = Nevet3D.pick(e, canvas, camera, proxies, 'day');
        if (hit2) go(hit2.userData.day, true);
      }
    }
    if (drag && drag.moved && mode === 'vine') go(Math.round(target), true);          // settle on a day
    drag = null;
  });
  var modeBtn = document.getElementById('time-mode'), nameEl = document.getElementById('time-name'), subEl = document.getElementById('time-sub'), legend = document.getElementById('time-legend');
  function setMode(m) {
    mode = m;
    vineG.visible = m === 'vine'; treeG.visible = m === 'tree';
    scene.fog.near = m === 'tree' ? 30 : 14; scene.fog.far = m === 'tree' ? 120 : 46;
    if (modeBtn) { modeBtn.setAttribute('aria-pressed', m === 'tree'); modeBtn.setAttribute('aria-label', m === 'tree' ? 'Back to the story vine' : 'Show the mother tree'); }
    if (nameEl) nameEl.textContent = m === 'tree' ? 'Our mother tree' : 'Our farm story';
    if (subEl) subEl.textContent = subEl.dataset[m] || '';
    if (legend) legend.hidden = m !== 'tree' || !TN.length;
    if (m === 'vine') select(null);
    first = true; lastShown = -1;
  }
  if (modeBtn) modeBtn.addEventListener('click', function () { setMode(mode === 'tree' ? 'vine' : 'tree'); });

  function showDay(i) {
    var d = DAYS[i]; if (!d) return;
    ui.date.textContent = d.weekday + ' ' + d.label;
    ui.count.textContent = 'day ' + (i + 1) + ' of ' + DAYS.length;
    ui.heading.textContent = d.title || '';
    ui.lines.innerHTML = '';
    d.lines.forEach(function (t) {
      var li = document.createElement('li'); li.textContent = t;
      if (/ invited /.test(t)) li.className = 'tree';
      else if (/ are | is .*'s |together|joined/.test(t)) li.className = 'love';
      ui.lines.appendChild(li);
    });
    ui.chips.innerHTML = '';
    function chip(text, pink) { var c = document.createElement('span'); c.className = 'time-chip' + (pink ? ' pink' : ''); c.textContent = text; ui.chips.appendChild(c); }
    if (d.n) chip(d.n + ' action' + (d.n !== 1 ? 's' : ''));
    if (d.kg) chip(d.kg + ' kg picked');
    if (d.who.length) chip(d.who.length + ' hero' + (d.who.length !== 1 ? 'es' : ''), true);
    if (d.moments.indexOf('love') >= 0) chip('♥ love', true);
    if (d.moments.indexOf('invite') >= 0 || /invited by/.test(d.lines.join(' '))) chip('🌳 a new branch', true);
  }
  function select(n) {                                  // a hero on the tree: their card
    selected = n;
    TN.forEach(function (o) { if (o.tag) o.tag.scale.set(o.tag.userData.w * (o === n ? 1.5 : 1), 0.52 * (o === n ? 1.5 : 1), 1); });
    if (!n) { lastShown = -1; return; }
    var jd = ms(n.joined);
    ui.date.textContent = jd ? 'Joined ' + new Date(jd).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
    ui.count.textContent = n.depth ? 'generation ' + (n.depth + 1) : 'a root of the tree';
    ui.heading.innerHTML = '';
    var hd = document.createElement('span'); hd.className = 'time-hero';
    var dot = document.createElement('span'); dot.className = 'time-dot'; dot.style.background = n.color || '#ec407a';
    hd.appendChild(dot); hd.appendChild(document.createTextNode(n.name)); ui.heading.appendChild(hd);
    ui.lines.innerHTML = '';
    function line(t, cls) { var li = document.createElement('li'); li.textContent = t; if (cls) li.className = cls; ui.lines.appendChild(li); }
    line(n.by ? 'Invited by ' + byId[n.by].name + (n.via ? ' (' + n.via + ').' : '.') : 'Came to the farm on their own.', 'tree');
    if (n.kids2.length) line('Invited ' + n.kids2.map(function (k) { return k.name; }).join(', ') + '.', 'tree');
    var below = 0; (function count(x) { x.kids2.forEach(function (k) { below++; count(k); }); })(n);
    if (below > n.kids2.length) line((below - n.kids2.length) + ' more grew from them.', 'tree');
    ribbons.forEach(function (r) { if (r.a === n) line(r.b.name + ' is ' + n.name + '\'s ' + r.l.lb + '.', 'love'); else if (r.b === n) line(r.a.name + ' is ' + n.name + '\'s ' + r.l.la + '.', 'love'); });
    ui.chips.innerHTML = '';
    var a = document.createElement('a'); a.className = 'time-chip pink'; a.href = '/growers/' + n.id; a.textContent = 'Visit ' + n.name + ' →'; ui.chips.appendChild(a);
  }

  // ---------------------------------------------------------------- frame loop
  function resize() {
    var w = wrap.clientWidth, h = wrap.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h;
    camera.setViewOffset(w, h, 0, Math.round(h * (w / h < 0.8 ? 0.14 : 0.03)), w, h);     // the vine sits above the story card
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize); resize();
  var clock = new THREE.Clock(), look = V(0, 0, 0), camPos = V(0, 0, 0), first = true;
  var startT = performance.now(), autoDone = false;
  function growTree(now, t, dt) {                       // everything that has happened by `now` (a time) has grown
    var top = yOf(now), k = Math.min(1, dt * 2.2);
    setGrowth(trunk, Math.min(1, (top + 1.2) / (TH + 2.2)));
    setGrowth(trunkP, Math.min(1, (top + 1.2) / (TH + 2.2)));
    TN.forEach(function (n) {
      var want = n.t <= now ? 1 : 0;
      n.grow += (want - n.grow) * (want ? k : Math.min(1, dt * 5));
      if (n.grow < 0.003) n.grow = 0;
      setGrowth(n.branch, Math.min(1, n.grow * 1.35));
      var bloom = Math.max(0, (n.grow - 0.7) / 0.3), s = n.mesh.userData.s * (bloom > 0 ? bloom : 0.001);
      var beat = (n === selected ? 1 + Math.pow(Math.max(0, Math.sin(t * 5)), 6) * 0.25 : 1);
      n.mesh.scale.setScalar(Math.max(0.001, s * beat));
      n.mesh.visible = bloom > 0;
      n.mesh.children[n.mesh.children.length - 1].material.opacity = 0.55 + 0.2 * Math.sin(t * 2 + n.id);
      n.tag.visible = bloom > 0.6;
      n.leaves.forEach(function (lf) { var lk = Math.max(0, Math.min(1, (n.grow * 1.35 - lf.userData.u) * 4)); lf.scale.setScalar(Math.max(0.001, lk * 1.15)); lf.visible = lk > 0; });
      var riding = n.grow > 0.02 && n.grow < 0.72 && !calm;          // the invitation travels along the new branch
      n.seed.visible = riding;
      if (riding) { n.seed.position.copy(n.curve.getPointAt(Math.min(1, n.grow * 1.35))); n.seed.material.opacity = 1; }
    });
    ribbons.forEach(function (r) {
      var want = r.t <= now && r.a.grow > 0.9 && r.b.grow > 0.9 ? 1 : 0;
      r.grow += (want - r.grow) * Math.min(1, dt * (want ? 1.6 : 5));
      setGrowth(r.mesh, r.grow);
      if (r.heart) { r.heart.visible = r.grow > 0.95; r.heart.position.y = r.heart.userData.y || (r.heart.userData.y = r.heart.position.y); r.heart.position.y += Math.sin(t * 2 + r.a.id) * 0.08; }
    });
    return top;
  }
  function frame() {
    requestAnimationFrame(frame);
    if (document.hidden) return;
    var dt = Math.min(0.05, clock.getDelta()), t = clock.elapsedTime;
    if (!autoDone && performance.now() - startT > 1800) { autoDone = true; if (!userAt && !calm && N > 1 && mode === 'vine') setPlaying(true); }   // the story starts telling itself, once, unless you already moved
    if (playing) { target = clampDay(target + dt * (mode === 'tree' ? 0.8 : 0.55)); if (target >= N - 1) setPlaying(false); }
    pos += (target - pos) * Math.min(1, dt * (Math.abs(target - pos) > 4 ? 6 : 4));
    var u = span(pos), ahead = span(Math.min(N - 0.5, pos + 0.6));
    var here = curve.getPointAt(u), next = curve.getPointAt(Math.min(1, ahead));
    var far = camera.aspect < 0.8 ? 1.45 : 1;          // a phone held upright sees less sideways: step back
    var want, wantLook;
    if (mode === 'tree') {
      var top = growTree(dateAt(pos), t, dt);
      if (!calm && !drag && performance.now() - userAt > 4000) orbit += dt * 0.12;     // the camera walks slowly round the tree
      var R = (maxR + 6) * (camera.aspect < 0.8 ? 2.3 : 1.55), focus = selected && selected.grow > 0.5 ? selected.pos : null;
      wantLook = focus ? focus.clone() : V(0, Math.max(2.5, top * 0.55), 0);
      want = V(Math.cos(orbit) * R, Math.max(3.5, top * 0.62 + 3.5), Math.sin(orbit) * R);
      if (focus) want.lerp(focus.clone().add(V(Math.cos(orbit) * 11 * far, 3.4, Math.sin(orbit) * 11 * far)), 0.7);
      here = wantLook;
    } else {
      want = here.clone().add(V(5.4 * far, 2.8 * far, 4.0 * far));
      wantLook = here.clone().lerp(next, 0.5).add(V(0, 0.55, 0));
      arcs.forEach(function (a) {                     // an inviter's arc grows over the vine as the story reaches the new hero's day
        var g = Math.max(0, Math.min(1, (pos - (a.ib - 1.2)) / 1.2));
        a.grow += (g - a.grow) * Math.min(1, dt * 4);
        setGrowth(a.mesh, a.grow);
        a.seed.visible = a.grow > 0.02 && a.grow < 0.98 && !calm;
        if (a.seed.visible) a.seed.position.copy(a.curve.getPointAt(a.grow));
      });
    }
    if (first) { camPos.copy(want); look.copy(wantLook); first = false; }
    camPos.lerp(want, Math.min(1, dt * 3)); look.lerp(wantLook, Math.min(1, dt * 3));
    camera.position.copy(camPos); camera.lookAt(look);
    var day = Math.round(pos);
    if (day !== lastShown && !(mode === 'tree' && selected)) { lastShown = day; showDay(day); }
    if (!drag && document.activeElement !== ui.range) ui.range.value = pos.toFixed(2);
    bigHearts.forEach(function (g) {
      var near = Math.abs(g.userData.i - pos) < 0.5;
      g.position.y = g.userData.y + Math.sin(t * 1.6 + g.userData.ph) * 0.12;
      g.quaternion.copy(camera.quaternion);                        // hearts always face you, with a little sway
      g.rotateY(Math.sin(t * 0.9 + g.userData.ph) * 0.35);
      var s = (g.userData.base || (g.userData.base = g.scale.x)) * (near ? 1 + Math.pow(Math.max(0, Math.sin(t * 5)), 6) * 0.25 : 1);   // a heartbeat on the day you're at
      g.scale.setScalar(s);
    });
    floaters.forEach(function (f) {
      var ud = f.userData, h = ((t * ud.sp + ud.ph) % 6), spread = mode === 'tree' ? 1.6 : 1;
      f.position.set(here.x + ud.ox * spread + Math.sin(t + ud.ph) * 0.4, here.y - 1.5 + h * spread, here.z + ud.oz * spread);
      f.material.opacity = Math.min(1, h) * Math.min(1, 6 - h) * 0.8;
    });
    renderer.render(scene, camera);
  }
  // start at the very beginning: "Once upon a time…" (or with the whole tree grown, when the tree was asked for)
  showDay(0); lastShown = 0;
  if (S.view === 'tree') {
    setMode('tree'); pos = target = Math.max(0, N - 1);
    if (S.focus && byId[S.focus]) { TN.forEach(function (n) { n.grow = n.t <= dateAt(pos) ? 1 : 0; }); select(byId[S.focus]); }
  }
  frame();
  window.NevetTime = { go: function (i) { go(i, true); }, mode: function (m) { if (m) setMode(m); return mode; }, select: function (id) { select(byId[id] || null); },
                       state: function () { return { pos: pos, target: target, playing: playing, days: N, shown: lastShown, mode: mode, heroes: TN.length,
                                                     grown: TN.filter(function (n) { return n.grow > 0.9; }).length, ribbons: ribbons.length, arcs: arcs.length, selected: selected && selected.name }; } };
})();
