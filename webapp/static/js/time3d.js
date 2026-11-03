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
  function dateAt(p) {                                  // the story's date at a (fractional) day index
    if (!DAYS.length) return t1;
    var i = Math.max(0, Math.min(DAYS.length - 1, Math.floor(p))), j = Math.min(DAYS.length - 1, i + 1), f = Math.max(0, Math.min(1, p - i));
    var a = ms(DAYS[i].date), b = ms(DAYS[j].date);
    return a + (b - a) * f + 43200000 * (p >= DAYS.length - 1 ? 1 : 0);
  }
  // The fan layout: the tree faces you, like a family tree drawn in a book. The roots of the family (heroes who came
  // on their own) branch straight off the top of the trunk; each generation is a ring further out, fanning up and
  // out like the crown of a big old tree. Families share the fan by their size, children share their parent's slice,
  // and each ring stands far enough out that the names beside each other never touch. The leaves sit behind the
  // heroes, so every blossom and name is in front and nothing hides another.
  // Heroes who joined in the last two weeks are new joins: a bigger blossom with a golden ring and glow, a golden
  // name tag, a branch that glows gold with a spark running along it from the hero who invited them, and they're
  // listed on the card, where "Just the new joins" fades everyone else back.
  var NEW_MS = 14 * 86400000;
  function size(n) { n.size = 1 + n.kids2.reduce(function (a, c) { return a + size(c); }, 0); return n.size; }
  var roots = TN.filter(function (n) { return !n.by; }), totalSize = roots.reduce(function (a, r) { return a + size(r); }, 0) || 1;
  var maxDepth = 0;
  function byJoin(x, y) { return (ms(x.joined) || 0) - (ms(y.joined) || 0) || x.id - y.id; }
  function slice(n, lo, hi, depth) {                   // each hero's slice of the fan (-1 left .. 1 right) and their generation
    n.lo = lo; n.hi = hi; n.ang = (lo + hi) / 2; n.depth = depth; n.t = ms(n.joined) || t0;
    maxDepth = Math.max(maxDepth, depth);
    var a = lo;
    n.kids2.slice().sort(byJoin).forEach(function (c, ci) { var w = (hi - lo) * c.size / Math.max(1, n.size - 1); c.sib = ci; slice(c, a, a + w, depth + 1); a += w; });
  }
  var a0 = -1;
  roots.slice().sort(byJoin).forEach(function (r, ri) { var w = 2 * r.size / totalSize; r.sib = ri; slice(r, a0, a0 + w, 0); a0 += w; });
  TN.forEach(function (n) {                            // (a loop in the data would leave heroes unplaced: they grow from the trunk, far right)
    if (n.lo !== undefined) return;
    n.by = null; n.kids2 = []; n.size = 1; n.sib = 0; slice(n, 0.97, 1, 0);
  });
  var TRUNK_TOP = 3.4;
  var treeG = new THREE.Group(); treeG.visible = false; scene.add(treeG);
  function growable(mesh) { mesh.userData.full = mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.attributes.position.count; mesh.geometry.setDrawRange(0, 0); mesh.userData.g = 0; return mesh; }
  function setGrowth(mesh, g) {
    if (Math.abs(mesh.userData.g - g) < 0.002) return;
    mesh.userData.g = g;
    var n = Math.floor(mesh.userData.full * g / 6) * 6;          // (whole triangles)
    mesh.geometry.setDrawRange(0, n); mesh.visible = n > 0;
  }
  // the trunk: thick at the foot and tapering up to where the branches fan out, with the pink vine of its people round it
  var trunkGeo = new THREE.CylinderGeometry(0.95, 0.5, TRUNK_TOP + 0.5, 14, 40, true);
  trunkGeo.rotateX(PI); trunkGeo.translate(0, (TRUNK_TOP + 0.5) / 2 - 0.3, 0);          // (upside down, so it grows from the ground up)
  (function () {                                        // bark: a little darker in the grooves
    var p = trunkGeo.attributes.position, cl = new Float32Array(p.count * 3), c1 = new THREE.Color(0x7a5232), c2 = new THREE.Color(0x8a6440), c = new THREE.Color();
    for (var i = 0; i < p.count; i++) {
      var y = p.getY(i), a = Math.atan2(p.getZ(i), p.getX(i));
      c.copy(c1).lerp(c2, Math.max(0, Math.min(1, y / TRUNK_TOP))).offsetHSL(0, 0, Math.sin(a * 7 + y * 1.3) * 0.035);
      cl[i * 3] = c.r; cl[i * 3 + 1] = c.g; cl[i * 3 + 2] = c.b;
    }
    trunkGeo.setAttribute('color', new THREE.BufferAttribute(cl, 3));
  })();
  var trunk = growable(new THREE.Mesh(trunkGeo, toon(0xffffff, { vertexColors: true })));
  var trunkPink = [];
  for (var ti = 0; ti <= 60; ti++) {
    var ty = -0.25 + (TRUNK_TOP + 0.2) * ti / 60, tr = 0.98 - 0.45 * (ty / TRUNK_TOP);
    trunkPink.push(V(Math.cos(ti * 0.42) * tr, ty, Math.sin(ti * 0.42) * tr));
  }
  var trunkP = growable(new THREE.Mesh(paintAlong(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(trunkPink), 180, 0.1, 6, false),
    [[0, C.magenta], [0.5, C.rose], [1, C.petal]], 60), toon(0xffffff, { vertexColors: true, emissive: new THREE.Color(0x5a0a2a), emissiveIntensity: 0.25 })));
  treeG.add(trunk); treeG.add(trunkP);
  for (var rt = 0; rt < 6; rt++) {                      // roots, low in the grass
    var ra = rt / 6 * TAU + 0.5, rlen = 1.5 + (rt % 3) * 0.4;
    var rc = new THREE.CatmullRomCurve3([V(0, 0.5, 0), V(Math.cos(ra) * rlen * 0.5, 0.08, Math.sin(ra) * rlen * 0.5), V(Math.cos(ra) * rlen, -0.1, Math.sin(ra) * rlen)]);
    treeG.add(new THREE.Mesh(new THREE.TubeGeometry(rc, 12, 0.26 - rt * 0.02, 6, false), toon(0x7a5232)));
  }
  var grassTex = (function () {
    var c = document.createElement('canvas'); c.width = c.height = 256;
    var g = c.getContext('2d'), gr = g.createRadialGradient(128, 128, 10, 128, 128, 128);
    gr.addColorStop(0, '#9fdcae'); gr.addColorStop(0.55, '#c9efd4'); gr.addColorStop(1, 'rgba(230,248,234,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256); return new THREE.CanvasTexture(c);
  })();
  var grass = new THREE.Mesh(new THREE.CircleGeometry(9, 48), new THREE.MeshBasicMaterial({ map: grassTex, transparent: true, depthWrite: false }));
  grass.rotation.x = -PI / 2; grass.position.y = -0.02; treeG.add(grass);
  // a name tag: the hero's name on a pill in their colour; new joins get a bigger golden one with a sparkle and NEW
  function nameTag(text, color, isNew) {
    var c = document.createElement('canvas'), g = c.getContext('2d'), px = 46, label = isNew ? '✨ ' + text : text;
    g.font = 'bold ' + px + 'px -apple-system, Segoe UI, Roboto, sans-serif';
    var w = Math.ceil(g.measureText(label).width) + (isNew ? 116 : 44), h = 74;
    c.width = w; c.height = h; g = c.getContext('2d');
    g.fillStyle = isNew ? 'rgba(255,246,214,0.98)' : 'rgba(255,250,252,0.95)';
    g.beginPath(); g.moveTo(37, 3); g.arcTo(w - 3, 3, w - 3, h - 3, 34); g.arcTo(w - 3, h - 3, 3, h - 3, 34); g.arcTo(3, h - 3, 3, 3, 34); g.arcTo(3, 3, w - 3, 3, 34); g.fill();
    g.lineWidth = isNew ? 6 : 4; g.strokeStyle = isNew ? '#e0a21b' : color; g.stroke();
    g.font = 'bold ' + px + 'px -apple-system, Segoe UI, Roboto, sans-serif'; g.fillStyle = isNew ? '#7a4a00' : '#5a1838'; g.textBaseline = 'middle';
    if (isNew) {
      g.textAlign = 'left'; g.fillText(label, 22, h / 2 + 2);
      var lw = g.measureText(label).width, bx = 22 + lw + 12;
      g.save(); g.fillStyle = '#e0a21b'; g.beginPath(); g.moveTo(bx + 12, 18); g.arcTo(bx + 66, 18, bx + 66, 56, 14); g.arcTo(bx + 66, 56, bx, 56, 14); g.arcTo(bx, 56, bx, 18, 14); g.arcTo(bx, 18, bx + 66, 18, 14); g.fill(); g.restore();
      g.font = '800 26px -apple-system, Segoe UI, Roboto, sans-serif'; g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.fillText('NEW', bx + 33, h / 2 + 1);
    } else { g.textAlign = 'center'; g.fillText(label, w / 2, h / 2 + 2); }
    var hh = isNew ? 0.74 : 0.56;
    var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, depthTest: false }));
    sp.scale.set(hh * w / h, hh, 1); sp.userData.w = hh * w / h; sp.userData.h = hh; sp.renderOrder = isNew ? 9 : 8;
    return sp;
  }
  var seedTex = (function () {
    var c = document.createElement('canvas'); c.width = c.height = 64;
    var g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,250,220,1)'); gr.addColorStop(0.35, 'rgba(255,214,107,0.9)'); gr.addColorStop(1, 'rgba(255,190,60,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
  })();
  TN.forEach(function (n) {                            // the name tags are drawn once (the layout needs their widths)
    var hexc = '#' + new THREE.Color(n.color || '#ec407a').getHexString();
    n.tag = nameTag(n.name, hexc, false); n.tagNew = nameTag(n.name, hexc, true);
    n.grow = 0; n.isNew = false; n.dim = 1;
  });
  // where everyone stands: `A` is how far the fan opens each side of straight up (narrower on a phone held upright)
  var heroG = null, treeProxies = [], ribbons = [], canopy = null, canopyBits = [], layoutA = 0;
  var B = { minX: -4, maxX: 4, maxY: 8, low: 0 };
  function placeHeroes(A) {
    var rows = [];
    TN.forEach(function (n) { (rows[n.depth] = rows[n.depth] || []).push(n); });
    var r = 0;
    for (var d = 0; d < rows.length; d++) {
      var row = (rows[d] || []).sort(function (x, y) { return x.ang - y.ang; });
      var base = d ? r + 2.9 : (roots.length === 1 ? 2.2 : 3.2);
      var need = function (step) {                     // how far out so names `step` apart along the ring don't touch
        var nd = base;
        for (var i = step; i < row.length; i++) {
          var dth = Math.max(0.004, (row[i].ang - row[i - step].ang) * A), mid = (row[i].ang + row[i - step].ang) / 2 * A;
          var wa = (row[i].tagNew.userData.w + row[i - step].tagNew.userData.w) / 2 + 0.3, ha = 1.6;
          nd = Math.max(nd, 1 / (dth * Math.max(Math.abs(Math.cos(mid)) / wa, Math.abs(Math.sin(mid)) / ha)));
        }
        return nd;
      };
      var one = need(1), two = row.length > 2 ? need(2) : one;
      var stagger = one > base + 2 && two + 1.8 < one;   // a crowded ring: every other hero a step further out, so it needn't go so far
      r = stagger ? two : one;
      var cap = d ? base + 9 : 9, crowded = r > cap; r = Math.min(r, cap);   // (a ring still too crowded: names take turns above and below)
      row.forEach(function (n, i) { n.r = r + (stagger && i % 2 ? 1.8 : 0); n.below = crowded && i % 2 === 1; });
      if (stagger) r += 1.8;
    }
    B = { minX: 1e9, maxX: -1e9, maxY: TRUNK_TOP, low: 1e9 };
    TN.forEach(function (n) {
      var th = n.ang * A;
      n.pos = V(Math.sin(th) * n.r, TRUNK_TOP + Math.cos(th) * n.r, (((n.id * 37) % 7) - 3) * 0.1);
      n.dir = V(Math.sin(th), Math.cos(th), 0);
      var hw = n.tagNew.userData.w / 2;
      B.minX = Math.min(B.minX, n.pos.x - hw); B.maxX = Math.max(B.maxX, n.pos.x + hw);
      B.maxY = Math.max(B.maxY, n.pos.y + 1.5); B.low = Math.min(B.low, n.pos.y - 1.1);
    });
    if (!TN.length) B = { minX: -4, maxX: 4, maxY: 8, low: 0 };
  }
  function disposeAll(o) { o.traverse(function (x) { if (x.geometry) x.geometry.dispose(); if (x.material && x.material.dispose && !x.material.userData.keep) x.material.dispose(); }); }
  function buildTree(A) {
    layoutA = A; placeHeroes(A);
    if (heroG) { TN.forEach(function (n) { heroG.remove(n.tag); heroG.remove(n.tagNew); }); treeG.remove(heroG); disposeAll(heroG); }   // (the name tags are kept)
    heroG = new THREE.Group(); treeG.add(heroG); treeProxies = []; canopyBits = [];
    TN.forEach(function (n) {
      var col = new THREE.Color(n.color || '#ec407a'), g = new THREE.Group(), s = 0.95 + 0.08 * Math.min(8, n.kids);
      n.mats = [];
      for (var j = 0; j < 6; j++) {
        var pmat = toon(col.clone().offsetHSL(0, 0, j % 2 ? 0.08 : 0), { transparent: true }); n.mats.push(pmat);
        var pm = new THREE.Mesh(petalGeo, pmat);
        pm.quaternion.setFromEuler(new THREE.Euler(PI / 2 - 0.3, j / 6 * TAU, 0, 'XYZ')); pm.scale.setScalar(1.55); g.add(pm);   // facing you, a little tilted up
      }
      var cmat = toon(C.gold, { emissive: new THREE.Color(0x7a4a00), emissiveIntensity: 0.3, transparent: true }); n.mats.push(cmat);
      g.add(new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), cmat));
      if (!n.by) { var rmat = toon(C.gold, { transparent: true }); n.mats.push(rmat); var rg = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.045, 6, 28), rmat); g.add(rg); }   // a root of the tree: a little gold ring
      n.ring = new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.07, 8, 36), toon(0xffc94d, { emissive: new THREE.Color(0xe0a21b), emissiveIntensity: 0.6 }));   // a new join: a big golden ring that pulses
      n.ring.visible = false; g.add(n.ring);
      var halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: seedTex, transparent: true, depthWrite: false, opacity: 0 }));
      halo.scale.setScalar(3.6); g.add(halo); n.halo = halo;
      var glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, opacity: 0.6 }));
      glow.scale.setScalar(1.9); g.add(glow); n.glow = glow;
      g.position.copy(n.pos); g.scale.setScalar(0.001); g.userData = { s: s };
      heroG.add(g); n.mesh = g;
      [n.tag, n.tagNew].forEach(function (tg, ti) {       // (a new join's blossom and ring are bigger: its tag stands higher)
        var up = ti ? 1.2 * s + 0.45 : 0.85 * s + 0.42;
        tg.position.copy(n.pos).add(V(0, n.below ? -up : up, 0.3)); tg.visible = false; heroG.add(tg);
      });
      var proxy = new THREE.Mesh(new THREE.SphereGeometry(0.75 * s + 0.4, 6, 4), new THREE.MeshBasicMaterial({ visible: false }));
      proxy.position.copy(n.pos); proxy.userData.hero = n.id; heroG.add(proxy); treeProxies.push(proxy);
      // the branch from the hero who invited them (or from the top of the trunk): out along the inviter's way, then
      // curving round to the new hero's, thicker the more heroes grew from it, their colour at the tip
      var from, fdir;
      if (n.by) { from = byId[n.by].pos.clone(); fdir = byId[n.by].dir; }
      else { from = V(n.dir.x * 0.35, TRUNK_TOP - 0.25, 0); fdir = V(0, 1, 0); }
      var to = n.pos.clone(), dist = from.distanceTo(to);
      var bc = new THREE.CubicBezierCurve3(from, from.clone().add(fdir.clone().multiplyScalar(dist * 0.45)), to.clone().sub(n.dir.clone().multiplyScalar(dist * 0.35)), to);
      var rad = Math.min(0.32, 0.07 + 0.045 * Math.sqrt(n.size));
      var bmat = toon(0xffffff, { vertexColors: true, transparent: true, emissive: new THREE.Color(0xffb020), emissiveIntensity: 0 }); n.mats.push(bmat); n.bmat = bmat;
      n.branch = growable(new THREE.Mesh(paintAlong(new THREE.TubeGeometry(bc, 40, rad, 7, false), [[0, n.by ? 0x6b8f3e : 0x7a5232], [0.6, 0x5fae5f], [1, col.getHex()]]), bmat));
      n.curve = bc; heroG.add(n.branch);
      n.leaves = [0.3, 0.55, 0.78].map(function (lu, li) {   // leaves along the branch, out once it has grown
        var lmat = toon(leafTones[(n.id + li) % leafTones.length], { transparent: true }); n.mats.push(lmat);
        var lf = new THREE.Mesh(leafGeo, lmat);
        lf.position.copy(bc.getPointAt(lu)); lf.rotation.set((n.id * 1.7 + li * 2.1) % TAU, (n.id + li * 2.4) % TAU, 0.5);
        lf.userData.u = lu; lf.scale.setScalar(0.001); heroG.add(lf);
        return lf;
      });
      n.seed = new THREE.Sprite(new THREE.SpriteMaterial({ map: seedTex, transparent: true, depthWrite: false, opacity: 1 }));
      n.seed.scale.setScalar(0.8); n.seed.visible = false; n.seed.renderOrder = 7; heroG.add(n.seed);
      // the leafy crown behind: a soft cloud of leaves behind each hero and halfway along their branch
      canopyBits.push({ n: n, p: V(n.pos.x * 1.02, n.pos.y + 0.2, -1.7), s: 1.75 + 0.14 * Math.min(6, n.kids) });
      for (var cm = Math.max(2, Math.ceil(dist / 2.2)), ck = 1; ck < cm; ck++) {   // and along their branch, so long branches stay leafy
        var mp = bc.getPointAt(ck / cm); canopyBits.push({ n: n, p: V(mp.x, mp.y + 0.3, -2.1), s: 1.35 + 0.1 * Math.min(6, n.size) });
      }
    });
    // the crown: one instanced cloud of leaves, in soft greens so the blossoms and golden new joins stand out
    var cg = new THREE.IcosahedronGeometry(1, 2); cg.scale(1, 0.85, 0.5);
    canopy = new THREE.InstancedMesh(cg, toon(0xffffff), Math.max(1, canopyBits.length));
    var cTones = [0x8fd19a, 0x7cc68a, 0xa6dcae, 0x6fbf80, 0x96d6a0];
    canopyBits.forEach(function (b, i) { canopy.setColorAt(i, col.setHex(cTones[(b.n.id + i) % cTones.length])); b.q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, (i * 1.3) % TAU)); });
    canopy.count = canopyBits.length; heroG.add(canopy);
    // ribbons between connected heroes: partners, family, friends, teammates (bowing out towards you, over the branches)
    ribbons = (TREE.links || []).map(function (l) {
      var a = byId[l.a], b = byId[l.b];
      if (!a || !b) return null;
      var d2 = a.pos.distanceTo(b.pos), mid = a.pos.clone().lerp(b.pos, 0.5).add(V(0, 0.5 + d2 * 0.1, 1.2 + d2 * 0.04));
      var rc2 = new THREE.CatmullRomCurve3([a.pos.clone().add(V(0, 0, 0.2)), mid, b.pos.clone().add(V(0, 0, 0.2))]);
      var rmat2 = toon(RIB[l.group] || RIB.team, { emissive: new THREE.Color(RIB[l.group] || RIB.team), emissiveIntensity: 0.18, transparent: true, opacity: 0.85 });
      var m = growable(new THREE.Mesh(new THREE.TubeGeometry(rc2, 40, l.group === 'love' ? 0.05 : 0.035, 6, false), rmat2));
      heroG.add(m);
      var hs = null;
      if (l.group === 'love' || l.group === 'family') {
        hs = new THREE.Sprite(new THREE.SpriteMaterial({ map: tinyTex, color: new THREE.Color(RIB[l.group]), transparent: true, depthWrite: false }));
        hs.scale.setScalar(l.group === 'love' ? 0.5 : 0.38); hs.position.copy(rc2.getPointAt(0.5)).add(V(0, 0.2, 0)); hs.userData.y = hs.position.y; hs.visible = false; heroG.add(hs);
      }
      return { mesh: m, mat: rmat2, heart: hs, a: a, b: b, t: Math.max(ms(l.date) || 0, a.t || 0, b.t || 0), l: l, grow: 0 };
    }).filter(Boolean);
    grass.scale.setScalar(Math.max(1, (B.maxX - B.minX) / 14));
  }
  var RIB = { love: 0xff2d7a, family: 0xc2185b, friends: 0xff8fb8, team: 0x7fd6a8 };
  var spotlight = false;                                // "Just the new joins": everyone else fades back
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
  var mode = 'vine', orbit = 0, panX = 0, selected = null;
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
  canvas.addEventListener('pointerdown', function (e) { drag = { x: e.clientX, y: e.clientY, t: target, o: orbit, p: panX, moved: false }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var dx = drag.x - e.clientX, d = dx + (drag.y - e.clientY);         // left or up = forward in time
    if (Math.abs(d) > 6 || Math.abs(dx) > 6) drag.moved = true;
    if (!drag.moved) return;
    if (mode === 'tree' && PHONE()) { panX = drag.p + dx * 0.03 * treeFit() / 20; userAt = performance.now(); }   // the tree on a phone: slide along it
    else if (mode === 'tree') { orbit = Math.max(-0.75, Math.min(0.75, drag.o + dx * 0.006)); userAt = performance.now(); }   // the tree: drag to look at it from the side
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
    wrap.classList.toggle('tree-mode', m === 'tree');
    scene.fog.near = m === 'tree' ? 60 : 14; scene.fog.far = m === 'tree' ? 180 : 46;
    if (modeBtn) { modeBtn.setAttribute('aria-pressed', m === 'tree'); modeBtn.setAttribute('aria-label', m === 'tree' ? 'Back to the story vine' : 'Show the mother tree'); }
    if (nameEl) nameEl.textContent = m === 'tree' ? 'Our mother tree' : 'Our farm story';
    if (subEl) subEl.textContent = subEl.dataset[m] || '';
    if (legend) legend.hidden = m !== 'tree' || !TN.length;
    if (m === 'vine') select(null);
    first = true; lastShown = -1;
    resize();
  }
  if (modeBtn) modeBtn.addEventListener('click', function () { setMode(mode === 'tree' ? 'vine' : 'tree'); });

  function ago(days) { return days <= 0 ? 'today' : days === 1 ? 'yesterday' : days + ' days ago'; }
  function showTree(i) {                                // the tree's card: who's new on the tree (as of the day you're at)
    var d = DAYS[i], now = dateAt(i);
    ui.date.textContent = d ? d.weekday + ' ' + d.label : '';
    ui.count.textContent = d ? 'day ' + (i + 1) + ' of ' + DAYS.length : '';
    var on = TN.filter(function (n) { return n.t <= now; }), fresh = on.filter(function (n) { return now - n.t < NEW_MS; });
    fresh.sort(function (a, b) { return b.t - a.t || b.id - a.id; });
    ui.heading.textContent = fresh.length ? '✨ New on the tree' : 'Our mother tree';
    ui.lines.innerHTML = '';
    function line(t, cls) { var li = document.createElement('li'); li.textContent = t; if (cls) li.className = cls; ui.lines.appendChild(li); }
    var show = (wrap.clientWidth || 1000) < 600 ? 3 : 6;
    fresh.slice(0, show).forEach(function (n) {
      var when = ago(Math.floor((now - n.t) / 86400000));
      line(n.by ? n.name + ' joined ' + when + ', on ' + byId[n.by].name + '\'s branch.' : n.name + ' came to the farm ' + when + ', a new root.', 'tree new');
    });
    if (fresh.length > show) line('…and ' + (fresh.length - show) + ' more new hero' + (fresh.length - show !== 1 ? 'es' : '') + '.', 'tree');
    var inv = on.filter(function (n) { return n.by; }).length;
    line(on.length + ' hero' + (on.length !== 1 ? 'es' : '') + ' on the tree' + (inv ? ', ' + inv + ' invited by a friend' : '') + '. Tap a blossom to meet them.');
    ui.chips.innerHTML = '';
    if (fresh.length) {                                 // fade everyone else back, so the new joins and who brought them stand out
      var sb = document.createElement('button'); sb.type = 'button'; sb.className = 'time-chip spot' + (spotlight ? ' on' : '');
      sb.setAttribute('aria-pressed', spotlight); sb.textContent = spotlight ? '🌳 Show everyone' : '🔦 Just the new joins';
      sb.addEventListener('click', function () { spotlight = !spotlight; select(null); showTree(Math.round(pos)); });
      ui.chips.appendChild(sb);
    } else spotlight = false;
    fresh.slice(0, 8).forEach(function (n) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'time-chip gold'; b.textContent = '✨ ' + n.name;
      b.addEventListener('click', function () { select(n); });
      ui.chips.appendChild(b);
    });
  }
  function showDay(i) {
    if (mode === 'tree') { showTree(i); return; }
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
    if (n) userAt = performance.now();
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
    if (n.isNew) line('✨ A new join, ' + ago(Math.floor((dateAt(pos) - n.t) / 86400000)) + '.', 'tree new');
    line(n.by ? 'Invited by ' + byId[n.by].name + (n.via ? ' (' + n.via + ').' : '.') : 'Came to the farm on their own.', 'tree');
    if (n.kids2.length) line('Invited ' + n.kids2.map(function (k) { return k.name; }).join(', ') + '.', 'tree');
    var below = 0; (function count(x) { x.kids2.forEach(function (k) { below++; count(k); }); })(n);
    if (below > n.kids2.length) line((below - n.kids2.length) + ' more grew from them.', 'tree');
    ribbons.forEach(function (r) { if (r.a === n) line(r.b.name + ' is ' + n.name + '\'s ' + r.l.lb + '.', 'love'); else if (r.b === n) line(r.a.name + ' is ' + n.name + '\'s ' + r.l.la + '.', 'love'); });
    ui.chips.innerHTML = '';
    var a = document.createElement('a'); a.className = 'time-chip pink'; a.href = '/growers/' + n.id; a.textContent = 'Visit ' + n.name + ' →'; ui.chips.appendChild(a);
  }

  // ---------------------------------------------------------------- frame loop
  // the tree view: the card docks on the left of a wide screen, or sits low on a phone; the tree is framed in the
  // space it leaves (fw, fh: the free share of the width and height; ox, oy: the shift that centres the tree there)
  function treeLayout() {
    var w = wrap.clientWidth || 1, h = wrap.clientHeight || 1;
    if (w >= 900) { var cw = Math.min(380, w * 0.34) + 36; return { ox: -cw / 2, oy: -10, fw: (w - cw) / w, fh: (h - 170) / h }; }
    var top = 104, bottom = Math.min(h * 0.3, 300) + 92;
    return { ox: 0, oy: h / 2 - (top + h - bottom) / 2, fw: 1, fh: (h - top - bottom) / h };
  }
  var PHONE = function () { return camera.aspect < 0.8; };
  function fanFor() { return PHONE() ? 1.05 : 1.4; }   // how far the fan opens each side of straight up (radians)
  function treeLow() { return PHONE() ? Math.max(-0.3, B.low) : -0.3; }   // a phone frames the heroes; a wide screen the whole tree
  function treeFit() {                                  // how far back to stand so the tree fits the space the card leaves
    var L = treeLayout(), vt = Math.tan(camera.fov * PI / 360);
    var halfH = (B.maxY - treeLow()) / 2 + 0.3, halfW = ((B.maxX - B.minX) / 2 + 0.6) * (PHONE() ? 0.6 : 1);   // a phone sees the middle: slide for the rest
    return Math.max(halfH / (vt * L.fh), halfW / (vt * L.fw * camera.aspect)) + 1.5;
  }
  function resize() {
    var w = wrap.clientWidth, h = wrap.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h;
    if (TN.length && Math.abs(fanFor() - layoutA) > 0.01) buildTree(fanFor());     // turning a phone round re-draws the fan
    if (mode === 'tree') { var L = treeLayout(); camera.setViewOffset(w, h, Math.round(L.ox), Math.round(L.oy), w, h); }
    else camera.setViewOffset(w, h, 0, Math.round(h * (w / h < 0.8 ? 0.14 : 0.03)), w, h);     // the vine sits above the story card
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize); resize();
  if (TN.length && !heroG) buildTree(fanFor());
  var clock = new THREE.Clock(), look = V(0, 0, 0), camPos = V(0, 0, 0), first = true;
  var startT = performance.now(), autoDone = false;
  var cm4 = new THREE.Matrix4(), cv3 = new THREE.Vector3();
  function growTree(now, t, dt) {                       // everything that has happened by `now` (a time) has grown
    var prog = Math.max(0, Math.min(1, (now - t0) / (t1 - t0))), k = Math.min(1, dt * 2.2);
    var tg = TN.length ? 0.45 + 0.55 * Math.min(1, prog * 2.5) : 1;          // the trunk is up by the first branches
    setGrowth(trunk, tg); setGrowth(trunkP, tg);
    var anyNew = false;
    TN.forEach(function (n) { var on = n.t <= now; n.isNew = on && now - n.t < NEW_MS; anyNew = anyNew || n.isNew; });
    var spot = spotlight && anyNew;
    TN.forEach(function (n) {
      var want = n.t <= now ? 1 : 0;
      n.grow += (want - n.grow) * (want ? k : Math.min(1, dt * 5));
      if (n.grow < 0.003) n.grow = 0;
      setGrowth(n.branch, Math.min(1, n.grow * 1.35));
      // in the spotlight the new joins stay bright, the heroes who invited them stay clear, everyone else fades back
      var inviter = spot && n.kids2.some(function (c) { return c.isNew; });
      var dimTo = !spot || n.isNew || n === selected ? 1 : inviter ? 0.7 : 0.16;
      n.dim += (dimTo - n.dim) * Math.min(1, dt * 5);
      n.mats.forEach(function (m) { m.opacity = n.dim; m.depthWrite = n.dim > 0.95; });
      var bloom = Math.max(0, (n.grow - 0.7) / 0.3), s = n.mesh.userData.s * (bloom > 0 ? bloom : 0.001) * (n.isNew ? 1.4 : 1);
      var beat = (n === selected || n.isNew ? 1 + Math.pow(Math.max(0, Math.sin(t * (n.isNew ? 3 : 5) + n.id)), 6) * 0.18 : 1);
      n.mesh.scale.setScalar(Math.max(0.001, s * beat));
      n.mesh.visible = bloom > 0;
      n.glow.material.opacity = (0.45 + 0.15 * Math.sin(t * 2 + n.id)) * n.dim;
      n.halo.material.opacity = n.isNew ? 0.6 + 0.3 * Math.sin(t * 2.4 + n.id) : 0;
      n.ring.visible = n.isNew;                       // a new join: the golden ring breathes in and out
      if (n.isNew) { var rp = calm ? 1 : 1 + 0.12 * Math.sin(t * 3 + n.id); n.ring.scale.setScalar(rp); n.ring.rotation.z = calm ? 0 : t * 0.6; }
      n.bmat.emissiveIntensity = n.isNew ? 0.45 + 0.2 * Math.sin(t * 3 + n.id) : 0;   // and the branch that joined them glows gold
      n.tag.visible = bloom > 0.6 && !n.isNew; n.tagNew.visible = bloom > 0.6 && n.isNew;
      n.leaves.forEach(function (lf) { var lk = Math.max(0, Math.min(1, (n.grow * 1.35 - lf.userData.u) * 4)); lf.scale.setScalar(Math.max(0.001, lk * 1.15)); lf.visible = lk > 0; });
      var riding = n.grow > 0.02 && n.grow < 0.72 && !calm;          // the invitation travels along the new branch
      var spark = !riding && n.isNew && bloom > 0.9 && !calm;        // and keeps running along it while they're new
      n.seed.visible = riding || spark;
      if (riding) { n.seed.position.copy(n.curve.getPointAt(Math.min(1, n.grow * 1.35))); n.seed.material.opacity = 1; n.seed.scale.setScalar(0.8); }
      else if (spark) { var su = ((t * 0.45 + n.id * 0.37) % 1); n.seed.position.copy(n.curve.getPointAt(su)); n.seed.material.opacity = Math.min(1, su * 5, (1 - su) * 5); n.seed.scale.setScalar(0.9); }
    });
    if (canopy) {                                      // the leafy crown fills in behind each hero as they grow
      canopyBits.forEach(function (b, i) {
        var g = Math.max(0, Math.min(1, (b.n.grow - 0.4) / 0.6)), cs = b.s * (0.15 + 0.85 * g) * (spot ? 0.92 : 1);
        cm4.compose(b.p, b.q, cv3.set(cs, cs, cs)); if (g <= 0) cm4.makeScale(0, 0, 0); canopy.setMatrixAt(i, cm4);
      });
      canopy.instanceMatrix.needsUpdate = true;
    }
    ribbons.forEach(function (r) {
      var want = r.t <= now && r.a.grow > 0.9 && r.b.grow > 0.9 ? 1 : 0;
      r.grow += (want - r.grow) * Math.min(1, dt * (want ? 1.6 : 5));
      setGrowth(r.mesh, r.grow);
      r.mat.opacity = 0.85 * Math.min(r.a.dim, r.b.dim);
      if (r.heart) { r.heart.visible = r.grow > 0.95; r.heart.material.opacity = Math.min(r.a.dim, r.b.dim); r.heart.position.y = r.heart.userData.y + Math.sin(t * 2 + r.a.id) * 0.08; }
    });
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
      growTree(dateAt(pos), t, dt);
      if (!calm && !drag && performance.now() - userAt > 4000) orbit += (0.16 * Math.sin(t * 0.13) - orbit) * Math.min(1, dt * 0.6);   // a gentle sway, back towards the front
      var D = treeFit(), focus = selected && selected.grow > 0.5 ? selected.pos : null;
      var slack = PHONE() ? (B.maxX - B.minX) * 0.2 : 0;
      panX = Math.max(-slack, Math.min(slack, panX)); if (!PHONE()) panX = 0;
      var cxm = (B.minX + B.maxX) / 2 + panX, midY = (B.maxY + treeLow()) / 2;
      wantLook = focus ? focus.clone() : V(cxm, midY, 0);
      want = V(cxm + Math.sin(orbit) * D, midY + D * 0.05, Math.cos(orbit) * D);
      if (focus) want.lerp(focus.clone().add(V(Math.sin(orbit) * 9 * far, 1.2, Math.cos(orbit) * 9 * far)), 0.7);
      here = wantLook;
      var tk = PHONE() ? 1.25 : 1;
      TN.forEach(function (n) {                       // names: the chosen hero's bigger; in the spotlight the rest fade with their blossom
        var sk = tk * (n === selected ? 1.35 : 1);
        n.tag.scale.set(n.tag.userData.w * sk, n.tag.userData.h * sk, 1); n.tagNew.scale.set(n.tagNew.userData.w * sk, n.tagNew.userData.h * sk, 1);
        n.tag.material.opacity = Math.max(0.12, n.dim); n.tagNew.material.opacity = 1;
      });
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
