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

  var vineG = new THREE.Group(); scene.add(vineG);           // the story's vines (the tree view is an SVG over the sky)
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
  // A tree in the graph-theory sense: every hero is a node and every invite an edge from the hero who invited them
  // (each hero has one inviter at most and invites never go round in a loop: invites.tree() makes sure). The farm
  // itself is the root, and heroes who came on their own hang straight from it. It is drawn flat and tidy, as an
  // SVG over the sky: the root on the left, each generation a column further right, and every hero on a row of their
  // own next to their branch, so no two names or lines ever cross. It grows with the story: travel through time and
  // heroes join their branch on the day they joined. In the story view, golden arcs over the vine join each hero's
  // day to the day of the hero who invited them.
  var TREE = S.tree || { nodes: [] }, TN = TREE.nodes || [], byId = {};
  TN.forEach(function (n) { byId[n.id] = n; n.kids2 = []; });
  TN.forEach(function (n) { if (n.by && byId[n.by] && n.by !== n.id) byId[n.by].kids2.push(n); else n.by = null; });
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
  var NEW_MS = 14 * 86400000;                           // heroes who joined in the last two weeks are new joins
  function byJoin(x, y) { return (x.t || 0) - (y.t || 0) || x.id - y.id; }
  TN.forEach(function (n) { n.t = ms(n.joined) || t0; });
  var ROOT = { id: 0, root: true, name: S.garden || 'Nevet Farm', kids2: TN.filter(function (n) { return !n.by; }), t: -Infinity };
  (function () {                                        // (a loop the server missed: its heroes hang from the root too)
    var seen = {};
    (function walk(n) { n.kids2.forEach(function (k) { if (!seen[k.id]) { seen[k.id] = true; walk(k); } }); })(ROOT);
    TN.forEach(function (n) {
      if (seen[n.id]) return;
      if (n.by) byId[n.by].kids2 = byId[n.by].kids2.filter(function (k) { return k !== n; });
      n.by = null; ROOT.kids2.push(n); seen[n.id] = true;
    });
  })();
  ROOT.kids2.sort(byJoin); TN.forEach(function (n) { n.kids2.sort(byJoin); });
  (function depth(n, d) { n.depth = d; n.kids2.forEach(function (k) { depth(k, d + 1); }); })(ROOT, 0);   // the root is generation 0
  TN.forEach(function (n) { n.size = 0; });
  (function size(n) { n.size = 1 + n.kids2.reduce(function (a, k) { return a + size(k); }, 0); return n.size; })(ROOT);
  var maxDepth = TN.reduce(function (m, n) { return Math.max(m, n.depth); }, 0);
  function pathTo(n) { var out = []; for (var x = n; x; x = x.by ? byId[x.by] : (x.root ? null : ROOT)) out.unshift(x); return out; }

  var seedTex = (function () {                          // a golden seed of light (the arcs over the vine)
    var c = document.createElement('canvas'); c.width = c.height = 64;
    var g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,250,220,1)'); gr.addColorStop(0.35, 'rgba(255,214,107,0.9)'); gr.addColorStop(1, 'rgba(255,190,60,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
  })();

  // the drawing: one SVG, a group for the lines and one for the heroes, moved and zoomed as a whole
  var SVGNS = 'http://www.w3.org/2000/svg';
  function el(tag, attrs, parent) { var e = document.createElementNS(SVGNS, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
  var treeBox = document.createElement('div'); treeBox.className = 'time-tree'; treeBox.hidden = true;
  var svg = el('svg', { class: 'time-tree-svg', role: 'group', 'aria-label': 'The mother tree: who invited whom' }, treeBox);
  var view = el('g', {}, svg), edgeG = el('g', { class: 'tt-edges' }, view), nodeG = el('g', { class: 'tt-nodes' }, view);
  var fitBtn = document.createElement('button'); fitBtn.type = 'button'; fitBtn.className = 'time-btn tt-fit'; fitBtn.hidden = true;
  fitBtn.setAttribute('aria-label', 'Show the whole tree'); fitBtn.title = 'Show the whole tree'; fitBtn.textContent = '⤢';
  treeBox.appendChild(fitBtn);
  wrap.insertBefore(treeBox, canvas.nextSibling);
  var R0 = 13, RR = 21, ROW = 42, GAP = 54;            // a hero's dot, the root's, a row, the space between a name and the next generation
  var IND = 28, ROWC = 38, compact = false;            // a narrow screen: one hero a row, each generation indented (like a list of folders)
  var measure = document.createElement('canvas').getContext('2d');
  measure.font = '700 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  function nodeEl(n) {                                  // a hero: a dot in their outfit's colour with their initial, and their name
    var g = el('g', { class: 'tt-node' + (n.root ? ' root' : ''), tabindex: 0, role: 'button' }, nodeG);
    var r = n.root ? RR : R0;
    n.halo = el('circle', { class: 'tt-halo', r: r + 7 }, g);
    el('circle', { class: 'tt-dot', r: r, fill: n.root ? '#2e9e5b' : (n.color || '#ec407a') }, g);
    var ini = el('text', { class: 'tt-ini', 'text-anchor': 'middle', dy: '0.35em' }, g); ini.textContent = n.root ? '🌱' : (n.name || '?').charAt(0).toUpperCase();
    var lc = new THREE.Color(n.color || '#ec407a');
    if (!n.root && 0.2126 * lc.r + 0.7152 * lc.g + 0.0722 * lc.b > 0.62) ini.style.fill = '#5a1838';     // (a light outfit: a dark letter)
    var nm = el('text', { class: 'tt-name', x: r + 8, dy: '0.35em' }, g); nm.textContent = n.name;
    n.labelW = measure.measureText(n.name).width + (n.root ? 30 : 4);
    n.badge = el('g', { class: 'tt-new', transform: 'translate(' + (r + 14 + n.labelW) + ',0)' }, g);
    el('rect', { x: 0, y: -9, width: 34, height: 18, rx: 9 }, n.badge);
    var bt = el('text', { x: 17, dy: '0.35em', 'text-anchor': 'middle' }, n.badge); bt.textContent = 'NEW';
    g.setAttribute('aria-label', n.root ? n.name + ', the root of the tree' : n.name + (n.by ? ', invited by ' + byId[n.by].name : ', came on their own'));
    g.addEventListener('click', function (e) { e.stopPropagation(); if (!tapMoved) select(n.root ? null : n); });
    g.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(n.root ? null : n); } });
    n.g = g; n.x = n.y = 0; n.a = 0; n.tx = n.ty = 0; n.on = false; n.dim = 1;
  }
  nodeEl(ROOT); ROOT.on = true; ROOT.a = 1;
  TN.forEach(function (n) { nodeEl(n); n.edge = el('path', { class: 'tt-edge' }, edgeG); });
  // where everyone goes: generations in columns (each as wide as its longest name), every hero who invited nobody
  // (a leaf) on a row of their own, and every inviter level with the middle of the heroes they invited
  var shown = -1, colX = [];
  function layout(now) {
    var vis = function (n) { return n.t <= now; }, W = [];
    TN.forEach(function (n) { n.on = vis(n); });
    (function widest(n) { W[n.depth] = Math.max(W[n.depth] || 0, n.labelW + (n.root ? RR : R0)); n.kids2.forEach(function (k) { if (k.on) widest(k); }); })(ROOT);
    colX = [0];
    for (var d = 1; d <= maxDepth + 1; d++) colX[d] = colX[d - 1] + (W[d - 1] || 60) + R0 + GAP + 40;   // (room for a NEW badge)
    var row = 0;
    compact = (wrap.clientWidth || 1000) < 700;
    if (compact) (function list(n) {                   // a narrow screen: every hero a row, below the hero who invited them
      n.tx = n.depth * IND + (n.root ? 0 : RR - R0); n.ty = row * ROWC; row++;
      n.kids2.forEach(function (k) { if (k.on) list(k); });
    })(ROOT);
    else (function place(n) {
      var kids = n.kids2.filter(function (k) { return k.on; });
      n.tx = colX[n.depth];
      if (!kids.length) { n.ty = row * ROW; row++; return; }
      kids.forEach(place);
      n.ty = (kids[0].ty + kids[kids.length - 1].ty) / 2;
    })(ROOT);
    TN.forEach(function (n) { if (n.on && n.a === 0) { var p = byId[n.by] || ROOT; n.x = p.x; n.y = p.y; } });   // a new hero grows out of their inviter
    fitWanted = true;
  }
  // the view: x, y and zoom, easing towards where it should be (the whole tree, fitted to the space the card leaves)
  var vx = 0, vy = 0, vk = 1, wx = 0, wy = 0, wk = 1, manual = false, fitWanted = true, focusOn = null;
  function freeArea() {
    var w = wrap.clientWidth || 1, h = wrap.clientHeight || 1;
    if (w >= 900) { var cw = Math.min(380, w * 0.34) + 36; return { x: cw + 10, y: 76, w: w - cw - 30, h: h - 76 - 84 }; }
    var top = 70, bottom = (ui.card && !ui.card.hidden ? Math.min(ui.card.offsetHeight || 0, h * 0.34) : 0) + 92;
    return { x: 12, y: top, w: w - 24, h: Math.max(120, h - top - bottom) };
  }
  function bounds(onlyOn) {
    var b = { x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9 };
    [ROOT].concat(TN).forEach(function (n) {
      if (onlyOn && !n.on) return;
      var r = n.root ? RR : R0;
      b.x0 = Math.min(b.x0, n.tx - r - 8); b.x1 = Math.max(b.x1, n.tx + r + 14 + n.labelW + (n.isNew ? 40 : 0));
      b.y0 = Math.min(b.y0, n.ty - r - 8); b.y1 = Math.max(b.y1, n.ty + r + 8);
    });
    return b;
  }
  function fit() {                                      // the whole tree in view, as big as fits (and no bigger than life and a half)
    var A = freeArea(), b = bounds(true), bw = b.x1 - b.x0, bh = b.y1 - b.y0;
    wk = compact ? Math.max(0.8, Math.min(1.25, A.w / bw)) : Math.max(0.5, Math.min(1.5, A.w / bw, A.h / bh));
    wx = A.x + (A.w - bw * wk) / 2 - b.x0 * wk; wy = A.y + (A.h - bh * wk) / 2 - b.y0 * wk;
    if (bw * wk > A.w || compact) wx = A.x + (compact ? Math.max(4, (A.w - bw * wk) / 2) : 0) - b.x0 * wk;   // too wide even small: start from the root
    if (bh * wk > A.h) {                                // too tall: keep the newest hero in view
      var last = TN.filter(function (n) { return n.on; }).sort(byJoin).pop() || ROOT;
      wy = Math.min(A.y - b.y0 * wk, Math.max(A.y + A.h - b.y1 * wk, A.y + A.h / 2 - last.ty * wk));
    }
  }
  function lookAt(n) {                                  // centre on a hero (keeping the zoom, or a readable one)
    var A = freeArea(); wk = Math.max(wk, 0.9);
    wx = A.x + A.w / 2 - (n.tx + n.labelW / 2) * wk; wy = A.y + A.h / 2 - n.ty * wk;
  }
  function setManual(on) { manual = on; fitBtn.hidden = !on; if (!on) { focusOn = null; fitWanted = true; } }
  fitBtn.addEventListener('click', function () { select(null); setManual(false); });
  // moving round the tree: drag to move, pinch or scroll to zoom, tap a hero to meet them, tap the sky to let go
  var pts = {}, tapMoved = false, pinch = null, panFrom = null;
  svg.addEventListener('pointerdown', function (e) {
    pts[e.pointerId] = { x: e.clientX, y: e.clientY };
    var ids = Object.keys(pts);
    if (ids.length === 1) { tapMoved = false; panFrom = { x: e.clientX, y: e.clientY, vx: wx, vy: wy }; }
    if (ids.length === 2) { var a = pts[ids[0]], b = pts[ids[1]]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: wk, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, vx: wx, vy: wy }; }
  });
  svg.addEventListener('pointermove', function (e) {
    if (!pts[e.pointerId]) return;
    pts[e.pointerId] = { x: e.clientX, y: e.clientY };
    var ids = Object.keys(pts), r = svg.getBoundingClientRect();
    if (pinch && ids.length >= 2) {
      var a = pts[ids[0]], b = pts[ids[1]], k = Math.max(0.3, Math.min(3, pinch.k * Math.hypot(a.x - b.x, a.y - b.y) / (pinch.d || 1)));
      var cx = pinch.cx - r.left, cy = pinch.cy - r.top;
      wx = vx = cx - (cx - pinch.vx) * k / pinch.k + ((a.x + b.x) / 2 - pinch.cx); wy = vy = cy - (cy - pinch.vy) * k / pinch.k + ((a.y + b.y) / 2 - pinch.cy); wk = vk = k;
      tapMoved = true; setManual(true); return;
    }
    if (!panFrom) return;
    var dx = e.clientX - panFrom.x, dy = e.clientY - panFrom.y;
    if (!tapMoved && Math.hypot(dx, dy) < 6) return;
    if (!tapMoved) { try { svg.setPointerCapture(e.pointerId); } catch (err) { /* (an old browser) */ } }
    tapMoved = true; setManual(true);
    wx = vx = panFrom.vx + dx; wy = vy = panFrom.vy + dy;
  });
  function lift(e) {
    delete pts[e.pointerId];
    if (Object.keys(pts).length < 2) pinch = null;
    if (!Object.keys(pts).length) { panFrom = null; setTimeout(function () { tapMoved = false; }, 0); }
  }
  svg.addEventListener('pointerup', lift); svg.addEventListener('pointercancel', lift);
  svg.addEventListener('click', function () { if (!tapMoved) select(null); });
  svg.addEventListener('wheel', function (e) {
    e.preventDefault();
    var r = svg.getBoundingClientRect(), cx = e.clientX - r.left, cy = e.clientY - r.top;
    var k = Math.max(0.3, Math.min(3, wk * Math.exp(-e.deltaY * 0.0015)));
    wx = vx = cx - (cx - wx) * k / wk; wy = vy = cy - (cy - wy) * k / wk; wk = vk = k;
    setManual(true);
  }, { passive: false });
  function edgePath(p, n) {                             // from the end of the inviter's name to the new hero's dot
    if (compact) {                                      // (a narrow screen: down from the inviter's dot, then across)
      var px = p.x + (p.root ? 0 : 0), py = p.y + (p.root ? RR : R0) * Math.max(0.01, p.a), cy = n.y, cx = n.x - R0 - 2;
      if (cy - py < 10) return 'M' + px.toFixed(1) + ',' + py.toFixed(1) + 'L' + cx.toFixed(1) + ',' + cy.toFixed(1);
      return 'M' + px.toFixed(1) + ',' + py.toFixed(1) + 'V' + (cy - 9).toFixed(1) + 'Q' + px.toFixed(1) + ',' + cy.toFixed(1) + ' ' + (px + 9).toFixed(1) + ',' + cy.toFixed(1) + 'H' + Math.max(px + 9, cx).toFixed(1);
    }
    var x0 = p.x + ((p.root ? RR : R0) + 12 + p.labelW + (p.isNew ? 40 : 0)) * Math.max(0.01, p.a), y0 = p.y, x1 = n.x - R0 - 3, y1 = n.y;
    if (x1 < x0 + 4) x1 = x0 + 4;
    var mx = (x0 + x1) / 2;
    return 'M' + x0.toFixed(1) + ',' + y0.toFixed(1) + 'C' + mx.toFixed(1) + ',' + y0.toFixed(1) + ' ' + mx.toFixed(1) + ',' + y1.toFixed(1) + ' ' + x1.toFixed(1) + ',' + y1.toFixed(1);
  }
  var spotlight = false;                                // "Just the new joins": everyone else fades back
  function stepTree(now, t, dt) {                      // everyone who has joined by `now` is on the tree; the rest aren't yet
    var day = Math.round(pos * 4);
    if (day !== shown) { shown = day; layout(now); }
    var anyNew = false;
    TN.forEach(function (n) { n.isNew = n.on && now - n.t < NEW_MS; anyNew = anyNew || n.isNew; });
    var spot = spotlight && anyNew, path = selected ? pathTo(selected) : [], under = {};
    if (selected) (function mark(n) { under[n.id] = true; n.kids2.forEach(mark); })(selected);
    var k = Math.min(1, dt * 7);
    [ROOT].concat(TN).forEach(function (n) {
      n.x += (n.tx - n.x) * k; n.y += (n.ty - n.y) * k;
      n.a += ((n.on ? 1 : 0) - n.a) * Math.min(1, dt * (n.on ? 5 : 9));
      if (n.a < 0.01 && !n.on) n.a = 0;
      var lit = selected ? path.indexOf(n) >= 0 || under[n.id] : spot ? n.isNew || n.root || n.kids2.some(function (c) { return c.isNew; }) : true;
      n.dim += ((lit ? 1 : 0.22) - n.dim) * Math.min(1, dt * 6);
      var pop = n.isNew && !calm ? 1 + 0.06 * Math.sin(t * 3 + n.id) : 1;
      n.g.style.display = n.a > 0 ? '' : 'none';
      n.g.setAttribute('transform', 'translate(' + n.x.toFixed(1) + ',' + n.y.toFixed(1) + ') scale(' + (Math.max(0.01, n.a) * pop * (n === selected ? 1.15 : 1)).toFixed(3) + ')');
      n.g.style.opacity = (Math.min(1, n.a * 1.4) * n.dim).toFixed(3);
      n.g.classList.toggle('is-new', !!n.isNew); n.g.classList.toggle('is-sel', n === selected);
      if (n.root) return;
      var p = byId[n.by] || ROOT;
      n.edge.style.display = n.a > 0 ? '' : 'none';
      if (n.a > 0) {
        n.edge.setAttribute('d', edgePath(p, n));
        n.edge.style.opacity = (n.a * Math.min(n.dim, p.dim)).toFixed(3);
        n.edge.classList.toggle('is-new', !!n.isNew);
        n.edge.classList.toggle('is-path', !!selected && (path.indexOf(n) >= 0 || under[n.id]));
      }
    });
    if (!manual && focusOn && focusOn.on) lookAt(focusOn); else if (!manual && fitWanted) fit();
    var e = Math.min(1, dt * 5);
    vx += (wx - vx) * e; vy += (wy - vy) * e; vk += (wk - vk) * e;
    view.setAttribute('transform', 'translate(' + vx.toFixed(1) + ',' + vy.toFixed(1) + ') scale(' + vk.toFixed(4) + ')');
  }

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
  function growable(mesh) { mesh.userData.full = mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.attributes.position.count; mesh.geometry.setDrawRange(0, 0); mesh.userData.g = 0; return mesh; }
  function setGrowth(mesh, g) {
    if (Math.abs(mesh.userData.g - g) < 0.002) return;
    mesh.userData.g = g;
    var n = Math.floor(mesh.userData.full * g / 6) * 6;          // (whole triangles)
    mesh.geometry.setDrawRange(0, n); mesh.visible = n > 0;
  }

  // ---------------------------------------------------------------- travelling through time
  var pos = 0, target = 0, playing = false, lastShown = -1, userAt = 0;
  var mode = 'vine', selected = null;
  ui.range.max = Math.max(0, N - 1);
  function clampDay(x) { return Math.max(0, Math.min(N - 1, x)); }
  function go(x, byUser) { target = clampDay(x); if (byUser) { userAt = performance.now(); setPlaying(false); } }
  function setPlaying(on) { playing = on && N > 1; ui.play.classList.toggle('playing', playing); ui.play.setAttribute('aria-label', playing ? 'Pause' : 'Play the story'); if (playing && target >= N - 1.01) target = pos = 0; }
  ui.play.addEventListener('click', function () { setPlaying(!playing); });
  ui.range.addEventListener('input', function () { go(parseFloat(ui.range.value), true); });
  ui.prev.addEventListener('click', function () { go(Math.round(target) - 1, true); });
  ui.next.addEventListener('click', function () { go(Math.round(target) + 1, true); });
  window.addEventListener('keydown', function (e) {
    if (e.target && e.target.closest && e.target.closest('.tt-node') && (e.key === 'Enter' || e.key === ' ')) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') go(Math.round(target) + 1, true);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') go(Math.round(target) - 1, true);
    else if (e.key === ' ') { e.preventDefault(); setPlaying(!playing); }
    else if (e.key === 't' || e.key === 'T') setMode(mode === 'tree' ? 'vine' : 'tree');
    else if (e.key === 'Escape' && mode === 'tree') select(null);
  });
  canvas.addEventListener('wheel', function (e) { e.preventDefault(); go(target + e.deltaY * 0.004 + e.deltaX * 0.004, true); }, { passive: false });
  var drag = null;
  canvas.addEventListener('pointerdown', function (e) { drag = { x: e.clientX, y: e.clientY, t: target, moved: false }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var dx = drag.x - e.clientX, d = dx + (drag.y - e.clientY);         // left or up = forward in time
    if (Math.abs(d) > 6 || Math.abs(dx) > 6) drag.moved = true;
    if (drag.moved) go(drag.t + d / 90, true);
  });
  canvas.addEventListener('pointerup', function (e) {
    if (drag && !drag.moved) {                                     // a tap on a blossom: go to its day
      var hit = Nevet3D.pick(e, canvas, camera, proxies, 'day');
      if (hit) go(hit.userData.day, true);
    }
    if (drag && drag.moved) go(Math.round(target), true);         // settle on a day
    drag = null;
  });
  var modeBtn = document.getElementById('time-mode'), nameEl = document.getElementById('time-name'), subEl = document.getElementById('time-sub'), legend = document.getElementById('time-legend');
  function setMode(m) {
    mode = m;
    vineG.visible = m === 'vine'; treeBox.hidden = m !== 'tree';
    wrap.classList.toggle('tree-mode', m === 'tree');
    if (modeBtn) { modeBtn.setAttribute('aria-pressed', m === 'tree'); modeBtn.setAttribute('aria-label', m === 'tree' ? 'Back to the story vine' : 'Show the mother tree'); }
    if (nameEl) nameEl.textContent = m === 'tree' ? 'Our mother tree' : 'Our farm story';
    if (subEl) subEl.textContent = subEl.dataset[m] || '';
    if (legend) legend.hidden = m !== 'tree' || !TN.length;
    if (m === 'vine') select(null);
    first = true; lastShown = -1; shown = -1; setManual(false);
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
      line(n.by ? n.name + ' joined ' + when + ', invited by ' + byId[n.by].name + '.' : n.name + ' came to the farm ' + when + ', a new branch from the root.', 'tree new');
    });
    if (fresh.length > show) line('…and ' + (fresh.length - show) + ' more new hero' + (fresh.length - show !== 1 ? 'es' : '') + '.', 'tree');
    var inv = on.filter(function (n) { return n.by; }).length, gens = on.reduce(function (m, n) { return Math.max(m, n.depth); }, 0);
    line(on.length + ' hero' + (on.length !== 1 ? 'es' : '') + ' on the tree' + (inv ? ', ' + inv + ' invited by a friend' : '') +
         (gens ? ', ' + gens + ' generation' + (gens !== 1 ? 's' : '') : '') + '. Tap a hero to meet them.');
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
  function select(n) {                                  // a hero on the tree: their card, their path from the root and their branch
    selected = n && n.on ? n : null;
    if (selected) { userAt = performance.now(); focusOn = selected; manual = false; fitBtn.hidden = false; }
    else { focusOn = null; lastShown = -1; if (!manual) fitWanted = true; return; }
    var jd = ms(n.joined);
    ui.date.textContent = jd ? 'Joined ' + new Date(jd).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
    ui.count.textContent = 'generation ' + n.depth;
    ui.heading.innerHTML = '';
    var hd = document.createElement('span'); hd.className = 'time-hero';
    var dot = document.createElement('span'); dot.className = 'time-dot'; dot.style.background = n.color || '#ec407a';
    hd.appendChild(dot); hd.appendChild(document.createTextNode(n.name)); ui.heading.appendChild(hd);
    ui.lines.innerHTML = '';
    function line(t, cls) { var li = document.createElement('li'); li.textContent = t; if (cls) li.className = cls; ui.lines.appendChild(li); }
    if (n.isNew) line('✨ A new join, ' + ago(Math.floor((dateAt(pos) - n.t) / 86400000)) + '.', 'tree new');
    line(n.by ? 'Invited by ' + byId[n.by].name + (n.via ? ' (' + n.via + ').' : '.') : 'Came to the farm on their own: a branch straight from the root.', 'tree');
    var kids = n.kids2.filter(function (k) { return k.on; });
    if (kids.length) line('Invited ' + kids.map(function (k) { return k.name; }).join(', ') + '.', 'tree');
    var below = 0; (function count(x) { x.kids2.forEach(function (k) { if (k.on) { below++; count(k); } }); })(n);
    if (below > kids.length) line((below - kids.length) + ' more joined through them: ' + (below + 1) + ' heroes on their branch.', 'tree');
    if (n.depth > 1) line('From the root: ' + pathTo(n).map(function (x) { return x.name; }).join(' → ') + '.', 'tree');
    ui.chips.innerHTML = '';
    var a = document.createElement('a'); a.className = 'time-chip pink'; a.href = '/growers/' + n.id; a.textContent = 'Visit ' + n.name + ' →'; ui.chips.appendChild(a);
  }

  // ---------------------------------------------------------------- frame loop
  function resize() {
    var w = wrap.clientWidth, h = wrap.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h;
    camera.setViewOffset(w, h, 0, Math.round(h * (w / h < 0.8 ? 0.14 : 0.03)), w, h);     // the vine sits above the story card
    camera.updateProjectionMatrix();
    svg.setAttribute('width', w); svg.setAttribute('height', h);
    if (!manual) fitWanted = true;
    if (((w < 700) !== compact) && mode === 'tree') shown = -1;          // (turning a phone round: lay the tree out again)
  }
  window.addEventListener('resize', resize); resize();
  var clock = new THREE.Clock(), look = V(0, 0, 0), camPos = V(0, 0, 0), first = true;
  var startT = performance.now(), autoDone = false;
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
    var want = here.clone().add(V(5.4 * far, 2.8 * far, 4.0 * far)), wantLook = here.clone().lerp(next, 0.5).add(V(0, 0.55, 0));
    if (mode === 'tree') stepTree(dateAt(pos), t, dt);
    else arcs.forEach(function (a) {                   // an inviter's arc grows over the vine as the story reaches the new hero's day
      var g = Math.max(0, Math.min(1, (pos - (a.ib - 1.2)) / 1.2));
      a.grow += (g - a.grow) * Math.min(1, dt * 4);
      setGrowth(a.mesh, a.grow);
      a.seed.visible = a.grow > 0.02 && a.grow < 0.98 && !calm;
      if (a.seed.visible) a.seed.position.copy(a.curve.getPointAt(a.grow));
    });
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
    if (S.focus && byId[S.focus]) { layout(dateAt(pos)); shown = Math.round(pos * 4); TN.forEach(function (n) { n.x = n.tx; n.y = n.ty; n.a = n.on ? 1 : 0; }); select(byId[S.focus]); }
  }
  frame();
  window.NevetTime = { go: function (i) { go(i, true); }, mode: function (m) { if (m) setMode(m); return mode; }, select: function (id) { select(byId[id] || null); },
                       state: function () { return { pos: pos, target: target, playing: playing, days: N, shown: lastShown, mode: mode, heroes: TN.length,
                                                     grown: TN.filter(function (n) { return n.on && n.a > 0.9; }).length, generations: maxDepth, arcs: arcs.length,
                                                     selected: selected && selected.name, zoom: vk }; } };
})();
