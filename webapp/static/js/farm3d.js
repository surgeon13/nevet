/* farm3d.js - the Nevet farm: every hero together on a little farm, doing
 * group activities (harvest festival, watering round, planting day and a
 * campfire dance at night).
 *
 * Data comes from window.NEVET_FARM (see app.py farm_page):
 *   { heroes: [{id, name, level, appearance}], plants: [{name, type, kind, stage}],
 *     catalog, more }
 * Heroes are drawn by hero3d.js; everything else here is built from simple
 * toon-shaded shapes. Nothing in this scene writes to the garden's data.
 */
(function () {
  'use strict';
  var D = window.NEVET_FARM;
  if (!D || typeof THREE === 'undefined' || !window.NevetHero) return;
  var PI = Math.PI, TAU = PI * 2;
  var V = function (x, y, z) { return new THREE.Vector3(x, y || 0, z); };
  var canvas = document.getElementById('farm-canvas'), wrap = document.getElementById('farm-wrap');
  var calm = window.Nevet3D && Nevet3D.reducedMotion();

  // seeded random, so the farm looks the same on every visit
  function rng(seed) {
    var a = seed >>> 0;
    return function () { a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  var R = rng(1337);
  function rr(a, b) { return a + R() * (b - a); }

  // ---------------------------------------------------------------- renderer
  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(42, 1, 0.1, 420);
  camera.position.set(17, 15, 21);
  var controls = new THREE.OrbitControls(camera, canvas);
  controls.target.set(0, 0.5, -3);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 5;
  controls.maxDistance = 55;
  controls.maxPolarAngle = 1.36;
  controls.autoRotate = !calm;
  controls.autoRotateSpeed = 0.35;
  var userTouched = 0;
  controls.addEventListener('start', function () { controls.autoRotate = false; userTouched = clockNow(); });

  function resize() {
    var w = wrap.clientWidth, h = wrap.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------------------------------------------------------------- helpers
  var matCache = {};
  function mat(color, opts) {
    if (!opts) {
      if (!matCache[color]) matCache[color] = new THREE.MeshToonMaterial({ color: new THREE.Color(color) });
      return matCache[color];
    }
    var o = { color: new THREE.Color(color) };
    for (var k in opts) o[k] = opts[k];
    return new THREE.MeshToonMaterial(o);
  }
  function mesh(geo, m, pos) {
    var x = new THREE.Mesh(geo, typeof m === 'string' ? mat(m) : m);
    if (pos) x.position.set(pos[0], pos[1], pos[2]);
    return x;
  }
  function box(w, h, d, c, pos) { return mesh(new THREE.BoxGeometry(w, h, d), c, pos); }
  function cyl(rt, rb, h, c, pos, seg) { return mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 12), c, pos); }
  function sphere(r, c, pos, scale, seg) {
    var m = mesh(new THREE.SphereGeometry(r, seg || 12, Math.max(6, Math.round((seg || 12) * 0.7))), c, pos);
    if (scale) m.scale.set(scale[0], scale[1], scale[2]);
    return m;
  }
  function cone(r, h, c, pos, seg) { return mesh(new THREE.ConeGeometry(r, h, seg || 10), c, pos); }
  function rot(o, x, y, z) { o.rotation.set(x || 0, y || 0, z || 0); return o; }
  function group(pos, rotY) {
    var g = new THREE.Group();
    if (pos) g.position.set(pos[0], pos[1], pos[2]);
    if (rotY) g.rotation.y = rotY;
    return g;
  }
  var OUTLINE = new THREE.MeshBasicMaterial({ color: 0x1f2522, side: THREE.BackSide });
  function outline(obj, k) {              // ink outline for the big props, like the heroes have
    var list = [];
    obj.traverse(function (o) {
      if (!o.isMesh || o.material.transparent || o.material.side === THREE.DoubleSide || o.material === OUTLINE) return;
      var t = o.geometry.type;
      if (t === 'PlaneGeometry' || t === 'ShapeGeometry' || t === 'CircleGeometry') return;
      list.push(o);
    });
    list.forEach(function (o) {
      var l = new THREE.Mesh(o.geometry, OUTLINE);
      l.userData.isOutline = true;
      l.scale.setScalar(k || 1.03);
      o.add(l);
    });
    return obj;
  }
  function textCanvas(text, opts) {
    opts = opts || {};
    var c = document.createElement('canvas'), g = c.getContext('2d');
    var px = opts.px || 40, font = 'bold ' + px + 'px -apple-system, Segoe UI, Roboto, sans-serif';
    g.font = font;
    var w = Math.ceil(g.measureText(text).width) + (opts.pad || 28) * 2, h = Math.round(px * 1.7);
    c.width = w; c.height = h;
    g = c.getContext('2d');
    g.fillStyle = opts.bg || 'rgba(255,255,255,0.92)';
    var r = opts.radius === undefined ? h / 2 : opts.radius;
    g.beginPath();
    g.moveTo(r, 0); g.lineTo(w - r, 0); g.quadraticCurveTo(w, 0, w, r); g.lineTo(w, h - r); g.quadraticCurveTo(w, h, w - r, h);
    g.lineTo(r, h); g.quadraticCurveTo(0, h, 0, h - r); g.lineTo(0, r); g.quadraticCurveTo(0, 0, r, 0); g.closePath();
    g.fill();
    if (opts.stroke) { g.lineWidth = 4; g.strokeStyle = opts.stroke; g.stroke(); }
    g.font = font; g.fillStyle = opts.color || '#1e2a20'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 2);
    return c;
  }
  function blobShadow(r, x, z, y) {
    var m = new THREE.Mesh(SHADOW_GEO, SHADOW_MAT);
    m.scale.setScalar(r);
    m.rotation.x = -PI / 2;
    m.position.set(x || 0, (y || 0) + 0.025, z || 0);
    m.renderOrder = 1;
    return m;
  }
  var SHADOW_GEO = new THREE.CircleGeometry(1, 20);
  var SHADOW_MAT = new THREE.MeshBasicMaterial({ color: 0x1b2a14, transparent: true, opacity: 0.18, depthWrite: false });

  // ---------------------------------------------------------------- sky & light
  var SKY = {
    dayTop: new THREE.Color('#6fb8ec'), dayHorizon: new THREE.Color('#e4f4ff'),
    nightTop: new THREE.Color('#081430'), nightHorizon: new THREE.Color('#2b3764')
  };
  var skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { top: { value: SKY.dayTop.clone() }, bottom: { value: SKY.dayHorizon.clone() } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = clamp(vP.y * 1.6 + 0.08, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, pow(h, 0.8)), 1.0); }'
  });
  var sky = new THREE.Mesh(new THREE.SphereGeometry(300, 24, 16), skyMat);
  scene.add(sky);
  scene.fog = new THREE.Fog(SKY.dayHorizon.clone(), 70, 230);

  var hemi = new THREE.HemisphereLight(0xffffff, 0x6f8a5a, 0.62);
  scene.add(hemi);
  var sun = new THREE.DirectionalLight(0xffffff, 0.75);
  sun.position.set(30, 50, 20);
  scene.add(sun);
  var fireLight = new THREE.PointLight(0xff9a3c, 0, 16, 2);
  fireLight.position.set(0, 1.4, 1);
  scene.add(fireLight);

  var sunDisc = new THREE.Mesh(new THREE.SphereGeometry(7, 20, 14), new THREE.MeshBasicMaterial({ color: 0xfff1b0, fog: false }));
  sunDisc.position.set(90, 95, -170);
  scene.add(sunDisc);
  var moon = new THREE.Mesh(new THREE.SphereGeometry(5, 20, 14), new THREE.MeshBasicMaterial({ color: 0xe9efff, fog: false, transparent: true, opacity: 0 }));
  moon.position.set(-80, 85, -160);
  scene.add(moon);

  // stars (night)
  var starGeo = new THREE.BufferGeometry(), starPos = [];
  for (var si = 0; si < 600; si++) {
    var th = R() * TAU, ph = rr(0.08, 1.2), rad = 260;
    starPos.push(Math.cos(th) * Math.cos(ph) * rad, Math.sin(ph) * rad, Math.sin(th) * Math.cos(ph) * rad);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  var stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false }));
  scene.add(stars);

  // clouds (day)
  var clouds = [], cloudMat = new THREE.MeshToonMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 });
  for (var ci = 0; ci < 7; ci++) {
    var cg = group([rr(-120, 120), rr(42, 62), rr(-140, -40)]);
    var n = 4 + Math.floor(R() * 3);
    for (var cj = 0; cj < n; cj++) cg.add(mesh(new THREE.SphereGeometry(rr(4, 7), 12, 9), cloudMat, [cj * 5 - n * 2.5, rr(-1, 2), rr(-2, 2)]));
    cg.scale.set(1, 0.65, 1);
    if (NevetHero.merge) NevetHero.merge(cg, function () { return false; });
    cg.userData.speed = rr(0.6, 1.4);
    clouds.push(cg);
    scene.add(cg);
  }

  // Everything that never moves goes into `statics`; it is merged into a
  // handful of meshes once built (see the end of the world section).
  var statics = new THREE.Group(), movers = new Set();
  scene.add(statics);

  // ---------------------------------------------------------------- ground
  var FARM = { minX: -20, maxX: 20, minZ: -20, maxZ: 16 };
  function hillH(x, z) {
    var dx = Math.max(0, Math.abs(x) - 24), dz = Math.max(0, z < 0 ? -z - 24 : z - 20);
    var d = Math.sqrt(dx * dx + dz * dz);
    if (d <= 0) return 0;
    var k = Math.min(1, d / 30);
    return k * k * (6 + Math.sin(x * 0.07) * 4 + Math.cos(z * 0.06 + 1) * 4);
  }
  (function () {
    var geo = new THREE.PlaneGeometry(420, 420, 90, 90);
    geo.rotateX(-PI / 2);
    var pos = geo.attributes.position, cols = [], c = new THREE.Color();
    var g1 = new THREE.Color('#8cc76a'), g2 = new THREE.Color('#79b85a'), g3 = new THREE.Color('#a3d27a');
    for (var i = 0; i < pos.count; i++) {
      var x = pos.getX(i), z = pos.getZ(i);
      pos.setY(i, hillH(x, z) - 0.02);
      var n = Math.sin(x * 0.21) * Math.cos(z * 0.17) * 0.5 + 0.5;
      c.copy(g1).lerp(n > 0.5 ? g3 : g2, Math.abs(n - 0.5) * 1.2);
      cols.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    geo.computeVertexNormals();
    scene.add(new THREE.Mesh(geo, new THREE.MeshToonMaterial({ vertexColors: true })));
  })();
  // trodden yard and the path from the gate
  var yard = mesh(new THREE.CircleGeometry(6.5, 40), '#d8c497');
  yard.rotation.x = -PI / 2; yard.position.set(0, 0.012, 1);
  statics.add(yard);
  var pathM = mesh(new THREE.PlaneGeometry(3, 11.5), '#d2bb8c');
  pathM.rotation.x = -PI / 2; pathM.position.set(0, 0.01, 11.5);
  statics.add(pathM);
  var lane = mesh(new THREE.PlaneGeometry(26, 2.2), '#d2bb8c');        // the lane in front of the beds
  lane.rotation.x = -PI / 2; lane.position.set(3.5, 0.011, -4.1);
  statics.add(lane);

  // grass tufts and wild flowers (instanced: one draw call each)
  (function () {
    var tuftGeo = new THREE.ConeGeometry(0.09, 0.32, 5); tuftGeo.translate(0, 0.16, 0);
    var tufts = new THREE.InstancedMesh(tuftGeo, mat('#5f9e46'), 420);
    var flowerGeo = new THREE.SphereGeometry(0.11, 8, 6);
    var flowers = new THREE.InstancedMesh(flowerGeo, new THREE.MeshToonMaterial({ color: 0xffffff }), 260);
    var m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
    var PETALS = ['#ffffff', '#f6d743', '#f29bc0', '#c9a7f2', '#ff8a65', '#ffffff'];
    function freeSpot() {
      for (var tries = 0; tries < 20; tries++) {
        var x = rr(-34, 34), z = rr(-34, 30);
        var inYard = x > -9 && x < 17 && z > -13.5 && z < 9;
        var onPath = Math.abs(x) < 2 && z > 5 && z < 18;
        if (!inYard && !onPath) return [x, z];
      }
      return [rr(22, 34), rr(-30, 30)];
    }
    for (var i = 0; i < 420; i++) {
      var f = freeSpot();
      s.setScalar(rr(0.7, 1.5)); q.setFromAxisAngle(V(0, 1, 0), R() * TAU);
      m.compose(p.set(f[0], hillH(f[0], f[1]), f[1]), q, s); tufts.setMatrixAt(i, m);
    }
    for (var j = 0; j < 260; j++) {
      var g = freeSpot();
      s.set(1, 0.7, 1).multiplyScalar(rr(0.8, 1.3));
      m.compose(p.set(g[0], hillH(g[0], g[1]) + 0.12, g[1]), q, s); flowers.setMatrixAt(j, m);
      flowers.setColorAt(j, col.set(PETALS[j % PETALS.length]));
    }
    scene.add(tufts); scene.add(flowers);
  })();

  // ---------------------------------------------------------------- fence & gate
  (function () {
    var posts = [], rails = [];
    function edge(ax, az, bx, bz, gap) {
      var len = Math.hypot(bx - ax, bz - az), n = Math.round(len / 2.5);
      for (var i = 0; i <= n; i++) {
        var t = i / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
        if (gap && Math.abs(x) < 1.9 && Math.abs(z - FARM.maxZ) < 0.1) continue;
        posts.push([x, z]);
        if (i < n) {
          var t2 = (i + 0.5) / n, mx = ax + (bx - ax) * t2, mz = az + (bz - az) * t2;
          if (gap && Math.abs(mx) < 2.6 && Math.abs(mz - FARM.maxZ) < 0.1) continue;
          rails.push([mx, mz, Math.atan2(bz - az, bx - ax), len / n]);
        }
      }
    }
    edge(FARM.minX, FARM.minZ, FARM.maxX, FARM.minZ);
    edge(FARM.maxX, FARM.minZ, FARM.maxX, FARM.maxZ);
    edge(FARM.maxX, FARM.maxZ, FARM.minX, FARM.maxZ, true);
    edge(FARM.minX, FARM.maxZ, FARM.minX, FARM.minZ);
    var postGeo = new THREE.BoxGeometry(0.22, 1.2, 0.22); postGeo.translate(0, 0.6, 0);
    var railGeo = new THREE.BoxGeometry(1, 0.12, 0.08);
    var wood = mat('#b98b5a'), wood2 = mat('#a57849');
    var P = new THREE.InstancedMesh(postGeo, wood2, posts.length), Rl = new THREE.InstancedMesh(railGeo, wood, rails.length * 2);
    var m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    posts.forEach(function (pp, i) { m.compose(p.set(pp[0], 0, pp[1]), q.identity(), s.set(1, 1, 1)); P.setMatrixAt(i, m); });
    rails.forEach(function (r, i) {
      q.setFromAxisAngle(V(0, 1, 0), -r[2]);
      [0.45, 0.88].forEach(function (y, k) { m.compose(p.set(r[0], y, r[1]), q, s.set(r[3] + 0.1, 1, 1)); Rl.setMatrixAt(i * 2 + k, m); });
    });
    scene.add(P); scene.add(Rl);
    // gate posts with a little arch and a sign
    var gate = group([0, 0, FARM.maxZ]);
    [-1.9, 1.9].forEach(function (x) { gate.add(box(0.34, 2.9, 0.34, '#8a5f3a', [x, 1.45, 0])); });
    gate.add(box(4.3, 0.3, 0.36, '#8a5f3a', [0, 2.95, 0]));
    var sign = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.7), new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(textCanvas(D.gardenName || 'Nevet Farm', { px: 44, bg: '#f3e6c8', color: '#5a3d22', radius: 10, stroke: '#8a5f3a' })) }));
    sign.position.set(0, 2.45, 0.2);
    gate.add(sign);
    var signBack = sign.clone(); signBack.rotation.y = PI; signBack.position.z = -0.2; gate.add(signBack);
    statics.add(outline(gate));
  })();

  // ---------------------------------------------------------------- plants
  var LEAF = '#5fae48', LEAF2 = '#4c9a3c', LEAF3 = '#7cc35a';
  // Plant models come from plants3d.js (static/assets/plants/catalog.json).
  var NP = window.NevetPlants;
  if (NP && D.plantCatalog) NP.use(D.plantCatalog);
  var FILL = ['lettuce', 'basil', 'tomato', 'carrot', 'strawberry', 'sunflower', 'bell_pepper', 'corn', 'green_beans', 'pumpkin',
              'cherry_tomato', 'mint', 'chard', 'parsley', 'zucchini', 'radish'];
  // A plant model fitted to a bed spot (big plants like trees are scaled down to fit).
  function plantModel(species, stage, seed, fit) {
    var g;
    if (NP) g = NP.build(species, stage, { seed: seed });
    else {
      g = group(); var pg = group(); g.add(pg);
      pg.add(sphere(0.25, LEAF, [0, 0.25, 0]));
      g.userData = { produce: [pg], minScale: 0.5, color: LEAF3, height: 0.5, radius: 0.25 };
    }
    var u = g.userData, f = fit || { r: 0.5, h: 1.7 };
    var k = Math.min(1, f.r / Math.max(0.05, u.radius), f.h / Math.max(0.05, u.height));
    if (k < 1) { var w = group(); w.add(g); g.scale.multiplyScalar(k); w.userData = u; return w; }
    return g;
  }

  // ---------------------------------------------------------------- beds
  var BED_X = [-6, -2, 2, 6], BED_Z0 = -5.2, SLOTS = 7, SLOT_STEP = 1.0, BED_W = 1.7;
  var plants = [];                                     // every plant on the farm
  function signMesh(text) {
    var c = textCanvas(text.length > 14 ? text.slice(0, 13) + '…' : text, { px: 34, bg: '#f3e6c8', color: '#4a321c', radius: 8, pad: 16, stroke: '#8a5f3a' });
    var w = 0.24 * c.width / c.height;
    var g = group();
    g.add(cyl(0.025, 0.025, 0.55, '#8a5f3a', [0, 0.27, 0], 5));
    var board = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.24), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), side: THREE.DoubleSide }));
    board.position.set(0, 0.58, 0);
    g.add(board);
    return g;
  }
  (function () {
    var real = (D.plants || []).filter(function (p) { return p.type !== 'worm_bin'; });
    var fill = rng(77);
    BED_X.forEach(function (bx, bi) {
      var bed = group([bx, 0, BED_Z0 - (SLOTS - 1) * SLOT_STEP / 2 - 0.5]);
      var len = SLOTS * SLOT_STEP + 0.4;
      [-1, 1].forEach(function (s) { bed.add(box(0.14, 0.48, len, '#a8743f', [s * BED_W / 2, 0.24, 0])); });
      [-1, 1].forEach(function (s) { bed.add(box(BED_W + 0.14, 0.48, 0.14, '#a8743f', [0, 0.24, s * len / 2])); });
      bed.add(box(BED_W - 0.1, 0.4, len - 0.1, '#5b3d27', [0, 0.2, 0]));
      [-1, 1].forEach(function (s) { [-1, 1].forEach(function (e) { bed.add(box(0.2, 0.56, 0.2, '#8a5f3a', [s * BED_W / 2, 0.28, e * len / 2])); }); });
      statics.add(outline(bed));
      for (var k = 0; k < SLOTS; k++) {
        var z = BED_Z0 - k * SLOT_STEP - 0.3, idx = bi * SLOTS + k;
        var info = real[idx], species = info ? info.species || 'generic' : FILL[Math.floor(fill() * FILL.length)];
        var stage = info ? info.stage : (fill() < 0.35 ? 'growing' : 'mature');
        addPlant(species, V(bx, 0.4, z), stage, info ? info.name : null, 'bed');
      }
    });
  })();
  function addPlant(species, pos, stage, name, where) {
    var young = stage === 'seed' || stage === 'germination';
    var model = plantModel(species, stage, Math.round(pos.x * 100 + pos.z * 7 + 1000));
    var base = 1;
    var holder = group([pos.x, pos.y, pos.z]);
    holder.add(model);
    model.scale.setScalar(base);
    holder.rotation.y = rr(0, TAU);
    scene.add(holder);
    var soil = mesh(new THREE.CircleGeometry(0.38, 14), new THREE.MeshBasicMaterial({ color: 0x3b2716, transparent: true, opacity: 0 }));
    soil.rotation.x = -PI / 2; soil.position.set(pos.x, pos.y + 0.011, pos.z);
    scene.add(soil);
    var p = { species: species, pos: pos, holder: holder, model: model, base: base, name: name, where: where,
              ripe: !young && stage !== 'seedling' && stage !== 'harvested' && stage !== 'archived', ripeK: 1, regrowAt: 0, claimed: null,
              wateredAt: -999, perk: 0, soil: soil, color: model.userData.color || LEAF3 };
    if (name) {
      var sign = signMesh(name);
      sign.position.set(pos.x + 0.62, pos.y, pos.z + 0.28);
      sign.rotation.y = 0.25;
      scene.add(sign);
    }
    plants.push(p);
    return p;
  }

  // ---------------------------------------------------------------- planting field
  var FIELD = { xs: [10.4, 12.4, 14.4], z0: -5.4, n: 5, step: 1.45 };
  var spots = [];
  (function () {
    FIELD.xs.forEach(function (x) {
      var len = FIELD.n * FIELD.step + 0.6;
      var row = mesh(new THREE.CylinderGeometry(0.5, 0.5, len, 16, 1, false, -PI / 2, PI), '#6e4a2c', [x, 0, FIELD.z0 - (FIELD.n - 1) * FIELD.step / 2]);
      row.rotation.x = -PI / 2;
      row.scale.set(1, 1, 0.42);
      statics.add(row);
      for (var k = 0; k < FIELD.n; k++) spots.push({ pos: V(x, 0.19, FIELD.z0 - k * FIELD.step), state: 'empty', claimed: null, plant: null, t0: 0 });
    });
    var fs = signMesh('New field'); fs.position.set(16.2, 0, -4.8); statics.add(fs);
  })();

  // ---------------------------------------------------------------- buildings
  var BARN_WINDOW = null, PUMP_HANDLE = null, WORMS = [];
  // Barn
  (function () {
    var g = group([-15.5, 0, -9.5], PI / 2);
    var W = 7, Dp = 6, H = 3.6;
    g.add(box(W, H, Dp, '#b8423a', [0, H / 2, 0]));
    var prof = new THREE.Shape();
    prof.moveTo(-W / 2 - 0.3, 0); prof.lineTo(-W / 2 * 0.62, 1.35); prof.lineTo(0, 2.1); prof.lineTo(W / 2 * 0.62, 1.35); prof.lineTo(W / 2 + 0.3, 0); prof.lineTo(-W / 2 - 0.3, 0);
    var roofGeo = new THREE.ExtrudeGeometry(prof, { depth: Dp + 0.6, bevelEnabled: false });
    roofGeo.translate(0, 0, -(Dp + 0.6) / 2);
    g.add(mesh(roofGeo, '#6b3a2e', [0, H, 0]));
    var gable = new THREE.Shape();
    gable.moveTo(-W / 2, 0); gable.lineTo(-W / 2 * 0.62, 1.3); gable.lineTo(0, 2.0); gable.lineTo(W / 2 * 0.62, 1.3); gable.lineTo(W / 2, 0); gable.lineTo(-W / 2, 0);
    var gab = mesh(new THREE.ShapeGeometry(gable), mat('#b8423a', { side: THREE.DoubleSide }), [0, H, Dp / 2 + 0.01]);
    g.add(gab);
    var gab2 = gab.clone(); gab2.position.z = -Dp / 2 - 0.01; g.add(gab2);
    // big door with white X trim
    var door = group([0, 0, Dp / 2 + 0.02]);
    door.add(box(2.6, 2.6, 0.06, '#9c352f', [0, 1.3, 0]));
    door.add(box(2.8, 0.16, 0.08, '#f4efe4', [0, 2.62, 0.02])); door.add(box(0.16, 2.7, 0.08, '#f4efe4', [-1.32, 1.3, 0.02])); door.add(box(0.16, 2.7, 0.08, '#f4efe4', [1.32, 1.3, 0.02]));
    var x1 = box(3.5, 0.14, 0.06, '#f4efe4', [0, 1.3, 0.04]); x1.rotation.z = 0.78; door.add(x1);
    var x2 = box(3.5, 0.14, 0.06, '#f4efe4', [0, 1.3, 0.04]); x2.rotation.z = -0.78; door.add(x2);
    g.add(door);
    // hayloft window that glows at night
    var loft = box(1.1, 0.9, 0.06, '#3c2a1e', [0, H + 0.75, Dp / 2 + 0.04]);
    g.add(loft);
    BARN_WINDOW = loft; movers.add(loft);
    g.add(box(1.3, 0.12, 0.08, '#f4efe4', [0, H + 1.25, Dp / 2 + 0.06])); g.add(box(1.3, 0.12, 0.08, '#f4efe4', [0, H + 0.25, Dp / 2 + 0.06]));
    // white corner trim
    [-1, 1].forEach(function (sx) { [-1, 1].forEach(function (sz) { g.add(box(0.16, H, 0.16, '#f4efe4', [sx * W / 2, H / 2, sz * Dp / 2])); }); });
    statics.add(outline(g));
    statics.add(blobShadow(5.2, -15.5, -9.5));
  })();

  // Windmill with turning sails
  var sails;
  (function () {
    var g = group([13.5, 0, -17.5], -0.35);
    g.add(cyl(1.1, 1.7, 7.5, '#efe6d2', [0, 3.75, 0], 10));
    g.add(cone(1.5, 1.8, '#8a4b36', [0, 8.4, 0], 10));
    g.add(box(0.8, 1.4, 0.1, '#7a5233', [0, 0.7, 1.62]));
    g.add(box(0.5, 0.6, 0.1, '#5c8fb3', [0, 4.6, 1.33]));
    sails = group([0, 7.2, 1.55]);
    sails.add(rot(cyl(0.22, 0.22, 0.4, '#5a3d22', [0, 0, 0], 10), PI / 2));
    for (var i = 0; i < 4; i++) {
      var arm = group(); arm.rotation.z = i * PI / 2;
      arm.add(box(0.16, 4.2, 0.1, '#7a5233', [0, 2.15, 0.12]));
      arm.add(box(0.95, 3.2, 0.04, '#f4efe4', [0.55, 2.55, 0.16]));
      sails.add(arm);
    }
    g.add(sails); movers.add(sails);
    statics.add(outline(g));
    statics.add(blobShadow(2.6, 13.5, -17.5));
  })();

  // Greenhouse
  (function () {
    var g = group([-15, 0, 5.5], PI / 2);
    var W = 4.6, Dp = 3.2, H = 2.2;
    var frame = '#e9f0ec', glass = new THREE.MeshToonMaterial({ color: 0xbfe6f0, transparent: true, opacity: 0.32, depthWrite: false });
    g.add(mesh(new THREE.BoxGeometry(W, H, Dp), glass, [0, H / 2, 0]));
    var roof = new THREE.Shape(); roof.moveTo(-W / 2, 0); roof.lineTo(0, 1.1); roof.lineTo(W / 2, 0); roof.lineTo(-W / 2, 0);
    var rg = new THREE.ExtrudeGeometry(roof, { depth: Dp, bevelEnabled: false }); rg.translate(0, 0, -Dp / 2);
    g.add(mesh(rg, glass, [0, H, 0]));
    [-1, 0, 1].forEach(function (k) {
      g.add(box(0.08, H, 0.08, frame, [k * W / 2, H / 2, Dp / 2])); g.add(box(0.08, H, 0.08, frame, [k * W / 2, H / 2, -Dp / 2]));
    });
    g.add(box(W, 0.08, 0.08, frame, [0, H, Dp / 2])); g.add(box(W, 0.08, 0.08, frame, [0, H, -Dp / 2]));
    g.add(box(0.08, 0.08, Dp, frame, [0, H + 1.1, 0]));
    g.add(box(W - 0.4, 0.5, 1.1, '#a8743f', [0, 0.25, -0.6]));
    for (var i = 0; i < 5; i++) {
      var pm = plantModel(['tomato', 'basil', 'bell_pepper', 'mint', 'cherry_tomato'][i], 'mature', i + 5, { r: 0.4, h: 1.0 });
      pm.position.set(-1.7 + i * 0.85, 0.5, -0.6);
      g.add(pm);
    }
    statics.add(g);
  })();

  // Pond with lily pads, reeds and ducks
  var ducks = [];
  (function () {
    var cx = 12, cz = 8;
    var shore = mesh(new THREE.CircleGeometry(3.9, 36), '#d9c79a'); shore.rotation.x = -PI / 2; shore.position.set(cx, 0.013, cz); statics.add(shore);
    var water = mesh(new THREE.CircleGeometry(3.4, 36), new THREE.MeshToonMaterial({ color: 0x5fb3e0 })); water.rotation.x = -PI / 2; water.position.set(cx, 0.03, cz); statics.add(water);
    for (var i = 0; i < 6; i++) {
      var a = rr(0, TAU), d = rr(0.8, 2.6);
      var pad = mesh(new THREE.CircleGeometry(0.32, 12, 0.3, TAU - 0.6), mat('#5aa34a', { side: THREE.DoubleSide }));
      pad.rotation.x = -PI / 2; pad.position.set(cx + Math.cos(a) * d, 0.045, cz + Math.sin(a) * d);
      statics.add(pad);
      if (i % 2 === 0) statics.add(sphere(0.09, '#f7a8c8', [pad.position.x, 0.1, pad.position.z], [1, 0.6, 1], 8));
    }
    for (var r = 0; r < 14; r++) {
      var ra = rr(PI * 0.9, PI * 1.7), rd = rr(3.2, 3.7);
      var reed = cyl(0.03, 0.04, rr(0.8, 1.4), '#6d9a3c', [cx + Math.cos(ra) * rd, 0.5, cz + Math.sin(ra) * rd], 5);
      statics.add(reed);
      if (r % 3 === 0) statics.add(cyl(0.06, 0.06, 0.22, '#7a5233', [reed.position.x, reed.geometry.parameters.height + 0.05, reed.position.z], 6));
    }
    for (var dk = 0; dk < 2; dk++) {
      var duck = group();
      duck.add(sphere(0.32, '#fbfaf5', [0, 0.2, 0], [1, 0.75, 1.4]));
      duck.add(sphere(0.18, '#fbfaf5', [0, 0.52, 0.34]));
      duck.add(rot(cone(0.07, 0.2, '#f2a02c', [0, 0.5, 0.56], 6), PI / 2));
      duck.add(sphere(0.03, '#1f2522', [0.09, 0.57, 0.45], null, 6)); duck.add(sphere(0.03, '#1f2522', [-0.09, 0.57, 0.45], null, 6));
      duck.add(rot(cone(0.12, 0.25, '#fbfaf5', [0, 0.32, -0.5], 6), -1.1));
      outline(duck, 1.05);
      if (NevetHero.merge) NevetHero.merge(duck, function () { return false; });
      duck.userData = { cx: cx, cz: cz, r: 1.6 + dk * 0.9, speed: 0.22 + dk * 0.08, ph: dk * 2.4 };
      ducks.push(duck);
      scene.add(duck);
    }
  })();

  // Trees
  (function () {
    var spotsT = [[-26, -24], [-22, -27], [-28, -8], [-27, 6], [-25, 20], [-12, 23], [10, 22], [24, 21], [27, 6], [27, -9], [24, -26], [3, -28],
                  [-8, -26], [18, -25], [-18, -16], [17, -2], [-4, 21], [30, -18], [-31, -15], [6, 26]];
    spotsT.forEach(function (s, i) {
      var t = group([s[0], hillH(s[0], s[1]), s[1]]);
      var hgt = rr(1.6, 2.4), apple = i % 4 === 0;
      t.add(cyl(0.22, 0.32, hgt, '#7a5233', [0, hgt / 2, 0], 8));
      var cols = ['#4f9a3e', '#5fae48', '#3f8a34'];
      var crown = [[0, hgt + 1.1, 0, 1.45], [0.8, hgt + 0.6, 0.2, 1.0], [-0.7, hgt + 0.7, -0.3, 1.05], [0.1, hgt + 1.8, 0.1, 0.95]];
      crown.forEach(function (c, k) { t.add(sphere(c[3], cols[k % 3], [c[0], c[1], c[2]], null, 12)); });
      if (apple) for (var a = 0; a < 7; a++) { var an = a / 7 * TAU; t.add(sphere(0.12, '#e0402f', [Math.cos(an) * 1.3, hgt + 0.9 + Math.sin(a * 2) * 0.4, Math.sin(an) * 1.3], null, 8)); }
      t.scale.setScalar(rr(0.9, 1.35));
      statics.add(outline(t, 1.025));
      statics.add(blobShadow(1.8, s[0], s[1], hillH(s[0], s[1])));
    });
  })();

  // Harvest cart, hay bales, hand pump, scarecrow, compost / worm bins
  var CART = V(-6, 0, -1.2), cartPile = [], PUMP = V(-9.4, 0, -2.6);
  (function () {
    var g = group([CART.x, 0, CART.z], PI / 2);
    g.add(box(2.2, 0.7, 1.3, '#b07a44', [0, 0.95, 0]));
    g.add(box(2.0, 0.08, 1.1, '#6b4a2b', [0, 1.28, 0]));
    [-1, 1].forEach(function (s) {
      var wheel = cyl(0.55, 0.55, 0.12, '#7a5233', [0.3, 0.55, s * 0.72], 14); wheel.rotation.x = PI / 2; g.add(wheel);
      g.add(rot(cyl(0.12, 0.12, 0.16, '#5a3d22', [0.3, 0.55, s * 0.74], 8), PI / 2));
    });
    var handle = box(1.4, 0.08, 0.08, '#8a5f3a', [-1.7, 0.95, 0.4]); g.add(handle);
    var handle2 = handle.clone(); handle2.position.z = -0.4; g.add(handle2);
    g.add(box(0.12, 0.6, 0.12, '#8a5f3a', [-0.95, 0.3, 0]));
    statics.add(outline(g));
    statics.add(blobShadow(1.5, CART.x, CART.z));
    // produce piles up inside the cart as heroes harvest
    for (var i = 0; i < 24; i++) {
      var c = sphere(0.16, '#e0402f', [CART.x + rr(-0.42, 0.42), 1.35 + Math.floor(i / 8) * 0.17, CART.z + rr(-0.85, 0.85)], null, 8);
      c.visible = false;
      scene.add(c);
      cartPile.push(c);
    }
    // hay bales by the barn
    [[-11, -4.2, 0], [-11.4, -2.8, 0.3], [-11.2, -3.5, 0.1, 1.05]].forEach(function (h) {
      var bale = cyl(0.62, 0.62, 1.1, '#e1c25f', [h[0], h[3] || 0.62, h[1]], 14); bale.rotation.z = PI / 2; bale.rotation.y = h[2];
      statics.add(outline(bale));
    });
    // hand pump for refilling watering cans
    var p = group([PUMP.x, 0, PUMP.z]);
    p.add(box(0.5, 0.25, 0.5, '#8a8f94', [0, 0.12, 0]));
    p.add(cyl(0.13, 0.15, 1.2, '#5c7a8f', [0, 0.85, 0], 10));
    p.add(rot(cyl(0.05, 0.05, 0.5, '#5c7a8f', [0, 1.2, 0.3], 6), PI / 2.2));
    PUMP_HANDLE = box(0.7, 0.07, 0.07, '#3d4f5c', [-0.3, 1.45, 0]);
    p.add(PUMP_HANDLE); movers.add(PUMP_HANDLE);
    p.add(cyl(0.38, 0.32, 0.4, '#7a5233', [0, 0.2, 0.75], 12));
    statics.add(outline(p));
    // scarecrow behind the beds
    var sc = group([0, 0, -13.6]);
    sc.add(cyl(0.06, 0.06, 2.4, '#7a5233', [0, 1.2, 0], 6));
    sc.add(box(1.8, 0.1, 0.1, '#7a5233', [0, 1.75, 0]));
    sc.add(cyl(0.32, 0.38, 0.9, '#5d82b8', [0, 1.55, 0], 10));
    sc.add(sphere(0.3, '#e6cf8f', [0, 2.3, 0]));
    sc.add(cyl(0.6, 0.6, 0.05, '#dcb65e', [0, 2.5, 0], 16)); sc.add(cyl(0.28, 0.32, 0.3, '#dcb65e', [0, 2.65, 0], 12));
    [-0.85, 0.85].forEach(function (x) { sc.add(sphere(0.12, '#e1c25f', [x, 1.75, 0], [1.3, 0.8, 0.8])); });
    statics.add(outline(sc));
    // compost and the garden's worm bins
    var bins = (D.plants || []).filter(function (q) { return q.type === 'worm_bin'; });
    if (!bins.length) bins = [{ name: 'Compost' }];
    bins.slice(0, 4).forEach(function (b, i) {
      var bg = group([-11.2 + (i % 2) * 1.6, 0, 1.2 + Math.floor(i / 2) * 1.6]);
      bg.add(box(1.2, 0.8, 1.0, '#9c6b3c', [0, 0.4, 0]));
      bg.add(box(1.3, 0.1, 1.1, '#7a5233', [0, 0.85, 0]));
      bg.add(box(1.1, 0.06, 0.06, '#7a5233', [0, 0.5, 0.52]));
      var worm = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.035, 6, 12, PI), mat('#e58fa0'));
      worm.position.set(0.2, 0.92, 0.1); worm.userData.wiggle = i;
      bg.add(worm);
      WORMS.push(worm); movers.add(worm);
      statics.add(outline(bg));
      var sg = signMesh(b.name); sg.position.set(bg.position.x + 0.7, 0, bg.position.z + 0.6); statics.add(sg);
    });
  })();

  // Campfire in the middle of the yard
  var FIRE = V(0, 0, 1.4), flames = [], embers;
  (function () {
    var g = group([FIRE.x, 0, FIRE.z]);
    for (var i = 0; i < 9; i++) { var a = i / 9 * TAU; g.add(sphere(0.2, i % 2 ? '#9a9a96' : '#83837f', [Math.cos(a) * 0.75, 0.12, Math.sin(a) * 0.75], [1.2, 0.75, 1], 8)); }
    for (var l = 0; l < 4; l++) { var log = cyl(0.11, 0.11, 1.2, '#6b4423', [0, 0.25, 0], 8); log.rotation.set(PI / 2 - 0.45, l * PI / 4, 0); log.rotation.order = 'YXZ'; log.rotation.y = l * PI / 2; g.add(log); }
    [[0.36, 1.1, '#ff8a2c'], [0.24, 0.85, '#ffc23d'], [0.13, 0.55, '#fff2a8']].forEach(function (f, k) {
      var fl = mesh(new THREE.ConeGeometry(f[0], f[1], 8), new THREE.MeshBasicMaterial({ color: f[2], transparent: true, opacity: 0.92 }), [0, 0.3 + f[1] / 2, 0]);
      fl.userData.k = k; fl.visible = false;
      g.add(fl); flames.push(fl); movers.add(fl);
    });
    statics.add(g);
    // embers rising from the fire
    var eg = new THREE.BufferGeometry(), ep = new Float32Array(40 * 3);
    eg.setAttribute('position', new THREE.BufferAttribute(ep, 3));
    embers = new THREE.Points(eg, new THREE.PointsMaterial({ color: 0xffb347, size: 0.12, transparent: true, opacity: 0, depthWrite: false }));
    embers.userData.seeds = [];
    for (var e = 0; e < 40; e++) embers.userData.seeds.push([R(), R() * TAU, rr(0.2, 0.5)]);
    scene.add(embers);
  })();

  // Party: a pop-up dance floor with a DJ booth, string lights, a disco ball
  // with coloured beams, balloons and confetti (only shown in party mode)
  var PARTY = { c: V(4.6, 0, 5.4), half: 2.6, tiles: null, bulbs: null, beams: [], ball: null, confetti: null, notes: [],
                balloons: [], speakers: [], decks: [], group: null };
  var DJ_SPOT = V(8.7, 0, 5.4);
  (function () {
    var g = group(), c = PARTY.c, half = PARTY.half, n = 7, tile = half * 2 / n;
    PARTY.group = g;
    g.visible = false;
    scene.add(g);
    // dance floor: one instanced mesh, colours change on the beat
    var tGeo = new THREE.BoxGeometry(tile * 0.94, 0.08, tile * 0.94);
    var tiles = new THREE.InstancedMesh(tGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), n * n);
    var m = new THREE.Matrix4(), col = new THREE.Color();
    for (var i = 0; i < n; i++) for (var j = 0; j < n; j++) {
      m.makeTranslation(c.x - half + tile * (i + 0.5), 0.05, c.z - half + tile * (j + 0.5));
      tiles.setMatrixAt(i * n + j, m);
      tiles.setColorAt(i * n + j, col.set('#333'));
    }
    PARTY.tiles = tiles; PARTY.tileN = n;
    g.add(tiles);
    g.add(box(half * 2 + 0.3, 0.06, half * 2 + 0.3, '#2a2a33', [c.x, 0.03, c.z]));
    // DJ booth with two decks and speakers
    var booth = group([DJ_SPOT.x - 0.95, 0, DJ_SPOT.z]);
    booth.add(box(0.9, 1.0, 2.2, '#2d2d3a', [0, 0.5, 0]));
    booth.add(box(1.0, 0.08, 2.3, '#4a4a5c', [0, 1.04, 0]));
    var stripe = mesh(new THREE.BoxGeometry(0.02, 0.18, 2.0), new THREE.MeshBasicMaterial({ color: 0xff5ea8 }), [-0.46, 0.7, 0]);
    booth.add(stripe); PARTY.stripe = stripe;
    [-0.55, 0.55].forEach(function (z) {
      var deck = cyl(0.28, 0.28, 0.04, '#111', [0, 1.1, z], 20);
      deck.add(cyl(0.08, 0.08, 0.05, '#e3c16f', [0, 0.01, 0], 10));
      booth.add(deck); PARTY.decks.push(deck);
    });
    g.add(booth);
    [-1.8, 1.8].forEach(function (z) {
      var sp = group([DJ_SPOT.x - 0.9, 0, DJ_SPOT.z + z]);
      sp.add(box(0.8, 1.6, 0.8, '#22222b', [0, 0.8, 0]));
      var woof = cyl(0.27, 0.27, 0.05, '#555', [-0.41, 0.6, 0], 18); woof.rotation.z = PI / 2; sp.add(woof);
      var tw = cyl(0.12, 0.12, 0.05, '#777', [-0.41, 1.25, 0], 14); tw.rotation.z = PI / 2; sp.add(tw);
      PARTY.speakers.push(woof);
      g.add(sp);
    });
    // four poles with strings of coloured bulbs between them, and a disco ball in the middle
    var corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(function (k) { return V(c.x + k[0] * (half + 0.4), 0, c.z + k[1] * (half + 0.4)); });
    corners.forEach(function (p) { g.add(cyl(0.06, 0.07, 3.6, '#8a5f3a', [p.x, 1.8, p.z], 6)); });
    var bulbPos = [];
    function string(a, b, sag, count) {
      for (var k = 0; k <= count; k++) {
        var t = k / count;
        bulbPos.push(V(a.x + (b.x - a.x) * t, 3.5 - Math.sin(t * PI) * sag, a.z + (b.z - a.z) * t));
      }
    }
    for (var e = 0; e < 4; e++) string(corners[e], corners[(e + 1) % 4], 0.5, 9);
    string(corners[0], corners[2], 0.9, 12); string(corners[1], corners[3], 0.9, 12);
    var bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }), bulbPos.length);
    bulbPos.forEach(function (p, k) { m.makeTranslation(p.x, p.y, p.z); bulbs.setMatrixAt(k, m); bulbs.setColorAt(k, col.setHSL(k * 0.13 % 1, 0.9, 0.6)); });
    PARTY.bulbs = bulbs;
    g.add(bulbs);
    var ball = mesh(new THREE.IcosahedronGeometry(0.42, 1), mat('#d9dde3', { flatShading: true, emissive: new THREE.Color('#556'), emissiveIntensity: 0.6 }), [c.x, 2.9, c.z]);
    g.add(ball); PARTY.ball = ball;
    g.add(cyl(0.01, 0.01, 0.55, '#888', [c.x, 3.25, c.z], 4));
    ['#ff4fa3', '#3fd9ff', '#ffe14d', '#7dff6a', '#b06bff'].forEach(function (hex, k) {
      var beam = mesh(new THREE.ConeGeometry(0.7, 2.9, 16, 1, true), new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      beam.geometry.translate(0, -1.45, 0);
      beam.position.set(c.x, 2.9, c.z);
      beam.userData.k = k;
      g.add(beam); PARTY.beams.push(beam);
    });
    // balloons tied to the poles
    corners.forEach(function (p, k) {
      ['#ff5ea8', '#ffd84d', '#5ec8ff'].forEach(function (hex, j) {
        var b = group([p.x + (j - 1) * 0.35, 3.8 + j * 0.25, p.z]);
        b.add(sphere(0.32, hex, [0, 0, 0], [1, 1.2, 1], 12));
        b.add(cyl(0.006, 0.006, 0.9, '#eee', [0, -0.75, 0], 3));
        b.userData = { ph: k * 2 + j, y: b.position.y };
        g.add(b); PARTY.balloons.push(b);
      });
    });
    // confetti
    var cg = new THREE.BufferGeometry(), cp = new Float32Array(160 * 3), cc = new Float32Array(160 * 3);
    PARTY.confettiSeeds = [];
    for (var q = 0; q < 160; q++) {
      PARTY.confettiSeeds.push([rr(-half, half), rr(0, 1), rr(-half, half), rr(0.4, 0.9)]);
      col.setHSL(R(), 0.85, 0.6); cc[q * 3] = col.r; cc[q * 3 + 1] = col.g; cc[q * 3 + 2] = col.b;
    }
    cg.setAttribute('position', new THREE.BufferAttribute(cp, 3));
    cg.setAttribute('color', new THREE.BufferAttribute(cc, 3));
    PARTY.confetti = new THREE.Points(cg, new THREE.PointsMaterial({ size: 0.11, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false }));
    g.add(PARTY.confetti);
    // music notes rising from the speakers
    var noteTex = new THREE.CanvasTexture((function () {
      var cv = document.createElement('canvas'); cv.width = cv.height = 64;
      var x = cv.getContext('2d'); x.fillStyle = '#ffffff'; x.font = 'bold 54px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('♪', 32, 34);
      return cv;
    })());
    for (var nn = 0; nn < 8; nn++) {
      var sp2 = new THREE.Sprite(new THREE.SpriteMaterial({ map: noteTex, color: new THREE.Color().setHSL(nn / 8, 0.9, 0.65), transparent: true, depthWrite: false }));
      sp2.scale.setScalar(0.45);
      sp2.userData = { ph: nn / 8, side: nn % 2 ? 1 : -1 };
      g.add(sp2); PARTY.notes.push(sp2);
    }
  })();

  // Chickens pecking around the barn
  var chickens = [];
  (function () {
    for (var i = 0; i < 4; i++) {
      var c = group([rr(-12.5, -8.5), 0, rr(-7, -1)]);
      var body = group(); c.add(body);
      body.add(sphere(0.28, i === 3 ? '#b8743c' : '#fbfaf5', [0, 0.35, 0], [0.9, 0.8, 1.15]));
      var head = group([0, 0.62, 0.22]); body.add(head);
      head.add(sphere(0.14, i === 3 ? '#b8743c' : '#fbfaf5', [0, 0, 0]));
      head.add(sphere(0.06, '#e2463a', [0, 0.14, 0.02], [0.6, 1, 1.4], 8));
      head.add(rot(cone(0.05, 0.13, '#f2a02c', [0, -0.02, 0.17], 6), PI / 2));
      head.add(sphere(0.022, '#1f2522', [0.08, 0.04, 0.09], null, 6)); head.add(sphere(0.022, '#1f2522', [-0.08, 0.04, 0.09], null, 6));
      body.add(rot(cone(0.14, 0.28, i === 3 ? '#9c5f2c' : '#efeee8', [0, 0.5, -0.28], 6), -0.9));
      [-1, 1].forEach(function (s) { c.add(cyl(0.02, 0.02, 0.2, '#f2a02c', [s * 0.09, 0.1, 0], 5)); });
      outline(body, 1.05);
      if (NevetHero.merge) NevetHero.merge(c, function (o) { return o === head; });
      c.userData = { head: head, target: c.position.clone(), next: 0, peck: 0 };
      chickens.push(c);
      scene.add(c);
      scene.add(c.userData.shadow = blobShadow(0.3));
    }
  })();

  // Butterflies (day) and fireflies (night)
  var butterflies = [];
  (function () {
    var wingGeo = new THREE.CircleGeometry(0.13, 8);
    var colors = ['#f6b93b', '#ffffff', '#e77fbf', '#7fb8e2', '#f6b93b', '#c9a7f2'];
    for (var i = 0; i < 7; i++) {
      var b = group();
      var m = new THREE.MeshBasicMaterial({ color: colors[i % colors.length], side: THREE.DoubleSide });
      var l = new THREE.Mesh(wingGeo, m), r = new THREE.Mesh(wingGeo, m);
      l.position.x = -0.12; r.position.x = 0.12;
      var lw = group(), rw = group(); lw.add(l); rw.add(r);
      b.add(lw); b.add(rw);
      b.userData = { lw: lw, rw: rw, c: V(rr(-14, 16), 0, rr(-14, 12)), r: rr(1.2, 3), h: rr(0.8, 1.8), sp: rr(0.4, 0.9), ph: rr(0, TAU) };
      butterflies.push(b);
      scene.add(b);
    }
  })();
  var fireflyGeo = new THREE.BufferGeometry(), fireflyPos = new Float32Array(60 * 3), fireflySeeds = [];
  for (var fi = 0; fi < 60; fi++) fireflySeeds.push([rr(-18, 18), rr(0.5, 2.8), rr(-18, 14), rr(0, TAU)]);
  fireflyGeo.setAttribute('position', new THREE.BufferAttribute(fireflyPos, 3));
  var fireflies = new THREE.Points(fireflyGeo, new THREE.PointsMaterial({ color: 0xe8ff7a, size: 0.16, transparent: true, opacity: 0, depthWrite: false }));
  scene.add(fireflies);

  if (NevetHero.merge) NevetHero.merge(statics, function (o) { return movers.has(o); });

  // ---------------------------------------------------------------- navigation
  // Heroes walk on a grid (half-unit cells) that knows where the beds,
  // buildings, cart, campfire, pond and fence are. A* finds a route around
  // them and the route is straightened; heroes steer around each other.
  var NAV = { x0: -21, z0: -21, cell: 0.5, w: 84, h: 90 };
  var OBST = [], HERO_R = 0.42;
  function obstacleCircle(x, z, r) { OBST.push({ t: 'c', x: x, z: z, r: r }); }
  function obstacleRect(x, z, hw, hd, rotY) { OBST.push({ t: 'r', x: x, z: z, hw: hw, hd: hd, c: Math.cos(rotY || 0), s: Math.sin(rotY || 0) }); }
  function obstaclePoly(pts) { OBST.push({ t: 'p', pts: pts }); }
  function pointInPoly(x, z, pts) {
    var inside = false;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      var xi = pts[i][0], zi = pts[i][1], xj = pts[j][0], zj = pts[j][1];
      if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  }
  function segDist(x, z, ax, az, bx, bz) {
    var vx = bx - ax, vz = bz - az, L = vx * vx + vz * vz, t = L ? ((x - ax) * vx + (z - az) * vz) / L : 0;
    t = Math.max(0, Math.min(1, t));
    var px = ax + vx * t - x, pz = az + vz * t - z;
    return Math.sqrt(px * px + pz * pz);
  }
  function polyDist(x, z, pts) {
    var d = Infinity;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) d = Math.min(d, segDist(x, z, pts[j][0], pts[j][1], pts[i][0], pts[i][1]));
    return d;
  }
  function blockedAt(x, z, pad) {
    pad = pad === undefined ? HERO_R : pad;
    if (z > FARM.maxZ - 0.5) return Math.abs(x) > 1.35;        // only the gate opening leads out
    if (x < FARM.minX + 0.6 || x > FARM.maxX - 0.6 || z < FARM.minZ + 0.6) return true;
    for (var i = 0; i < OBST.length; i++) {
      var o = OBST[i];
      if (o.t === 'c') { var dx = x - o.x, dz = z - o.z, r = o.r + pad; if (dx * dx + dz * dz < r * r) return true; }
      else if (o.t === 'r') {
        var ex = x - o.x, ez = z - o.z, lx = ex * o.c - ez * o.s, lz = ex * o.s + ez * o.c;
        if (Math.abs(lx) < o.hw + pad && Math.abs(lz) < o.hd + pad) return true;
      } else if (pointInPoly(x, z, o.pts) || polyDist(x, z, o.pts) < pad) return true;
    }
    return false;
  }
  var NAVN = NAV.w * NAV.h, navBlocked = new Uint8Array(NAVN);
  function buildNav() {
    for (var j = 0; j < NAV.h; j++) for (var i = 0; i < NAV.w; i++)
      navBlocked[j * NAV.w + i] = blockedAt(NAV.x0 + (i + 0.5) * NAV.cell, NAV.z0 + (j + 0.5) * NAV.cell) ? 1 : 0;
  }
  function cellIdx(x, z) {
    var i = Math.floor((x - NAV.x0) / NAV.cell), j = Math.floor((z - NAV.z0) / NAV.cell);
    return (i < 0 || j < 0 || i >= NAV.w || j >= NAV.h) ? -1 : j * NAV.w + i;
  }
  function cellCentre(k) { return V(NAV.x0 + (k % NAV.w + 0.5) * NAV.cell, 0, NAV.z0 + (Math.floor(k / NAV.w) + 0.5) * NAV.cell); }
  function freeCell(k) { return k >= 0 && !navBlocked[k]; }
  function freeAt(x, z) { return freeCell(cellIdx(x, z)); }
  function nearestFree(k) {
    if (freeCell(k)) return k;
    if (k < 0) return -1;
    var ci = k % NAV.w, cj = Math.floor(k / NAV.w);
    for (var r = 1; r < 16; r++) {
      for (var dj = -r; dj <= r; dj++) for (var di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        var i = ci + di, j = cj + dj;
        if (i >= 0 && j >= 0 && i < NAV.w && j < NAV.h && !navBlocked[j * NAV.w + i]) return j * NAV.w + i;
      }
    }
    return -1;
  }
  var dyn = new Int32Array(NAVN), dynId = 0, useDyn = false;
  function openCell(k) { return k >= 0 && !navBlocked[k] && !(useDyn && dyn[k] === dynId); }
  function lineFree(a, b) {
    var d = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(d / 0.2));
    for (var k = 1; k < n; k++) { var t = k / n; if (!openCell(cellIdx(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t))) return false; }
    return true;
  }
  // mark cells around heroes who are standing still (working, dancing) so routes go around them
  function markStanding(self) {
    dynId++;
    heroes.forEach(function (o) {
      if (o === self || !o.root || o.path.length) return;
      var ci = Math.floor((o.root.position.x - NAV.x0) / NAV.cell), cj = Math.floor((o.root.position.z - NAV.z0) / NAV.cell);
      for (var dj = -2; dj <= 2; dj++) for (var di = -2; di <= 2; di++) {
        if (di * di + dj * dj > 5) continue;
        var i = ci + di, j = cj + dj;
        if (i >= 0 && j >= 0 && i < NAV.w && j < NAV.h) dyn[j * NAV.w + i] = dynId;
      }
    });
  }
  var gS = new Float32Array(NAVN), came = new Int32Array(NAVN), seen = new Int32Array(NAVN), shut = new Int32Array(NAVN), searchId = 0;
  var heapK = [], heapF = [];
  function hpush(k, f) {
    var i = heapK.length; heapK.push(k); heapF.push(f);
    while (i > 0) { var p = (i - 1) >> 1; if (heapF[p] <= f) break; heapK[i] = heapK[p]; heapF[i] = heapF[p]; i = p; }
    heapK[i] = k; heapF[i] = f;
  }
  function hpop() {
    var top = heapK[0], lk = heapK.pop(), lf = heapF.pop(), n = heapK.length;
    if (n) {
      var i = 0;
      while (true) {
        var l = 2 * i + 1, r = l + 1, m = i, mf = lf;
        if (l < n && heapF[l] < mf) { m = l; mf = heapF[l]; }
        if (r < n && heapF[r] < mf) { m = r; mf = heapF[r]; }
        if (m === i) break;
        heapK[i] = heapK[m]; heapF[i] = heapF[m]; i = m;
      }
      heapK[i] = lk; heapF[i] = lf;
    }
    return top;
  }
  var NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
  function spotOk(p) { return !blockedAt(p.x, p.z, 0.32); }    // exact check for standing spots (grid cells are coarser)
  function walkable(x, z) { return !blockedAt(x, z, 0.3); }
  function findPath(from, to, self) {
    if (self) {                                        // first try a route that keeps clear of standing heroes
      markStanding(self);
      useDyn = true;
      var sk = cellIdx(from.x, from.z), gk = cellIdx(to.x, to.z);
      if (sk >= 0) dyn[sk] = 0;
      if (gk >= 0) dyn[gk] = 0;
      var r = astar(from, to);
      useDyn = false;
      if (r) return r;
    }
    return astar(from, to) || [to.clone().setY(0)];
  }
  function astar(from, to) {
    var goalOk = spotOk(to);
    if (goalOk && lineFree(from, to)) return [to.clone().setY(0)];
    var s = nearestFree(cellIdx(from.x, from.z)), g = nearestFree(cellIdx(to.x, to.z));
    if (s < 0 || g < 0) return null;
    searchId++;
    heapK.length = 0; heapF.length = 0;
    var gi = g % NAV.w, gj = Math.floor(g / NAV.w);
    function hcost(k) { var di = Math.abs(k % NAV.w - gi), dj = Math.abs(Math.floor(k / NAV.w) - gj); return Math.max(di, dj) + 0.414 * Math.min(di, dj); }
    seen[s] = searchId; gS[s] = 0; came[s] = -1; hpush(s, hcost(s));
    var found = false, guard = 0;
    while (heapK.length && guard++ < 20000) {
      var k = hpop();
      if (shut[k] === searchId) continue;
      shut[k] = searchId;
      if (k === g) { found = true; break; }
      var ki = k % NAV.w, kj = Math.floor(k / NAV.w);
      for (var n = 0; n < 8; n++) {
        var ni = ki + NB[n][0], nj = kj + NB[n][1];
        if (ni < 0 || nj < 0 || ni >= NAV.w || nj >= NAV.h) continue;
        var nk = nj * NAV.w + ni;
        if (!openCell(nk) || shut[nk] === searchId) continue;
        if (NB[n][2] > 1 && (!openCell(kj * NAV.w + ni) || !openCell(nj * NAV.w + ki))) continue;   // no corner cutting
        var ng = gS[k] + NB[n][2];
        if (seen[nk] !== searchId || ng < gS[nk]) { seen[nk] = searchId; gS[nk] = ng; came[nk] = k; hpush(nk, ng + hcost(nk)); }
      }
    }
    if (!found) return null;
    var cells = [];
    for (var c = g; c !== -1; c = came[c]) cells.push(cellCentre(c));
    cells.reverse();
    if (goalOk) cells[cells.length - 1] = to.clone().setY(0);
    // straighten: from each point jump to the furthest one in plain sight
    var out = [], cur = from.clone().setY(0), idx = 0;
    while (idx < cells.length) {
      var far = idx;
      for (var t = cells.length - 1; t > idx; t--) if (lineFree(cur, cells[t])) { far = t; break; }
      out.push(cells[far]);
      cur = cells[far];
      idx = far + 1;
    }
    return out;
  }

  (function () {                                       // what heroes walk around
    BED_X.forEach(function (bx) { obstacleRect(bx, BED_Z0 - (SLOTS - 1) * SLOT_STEP / 2 - 0.5, BED_W / 2 + 0.05, (SLOTS * SLOT_STEP + 0.4) / 2); });
    obstacleRect(CART.x, CART.z + 0.35, 0.75, 1.65);
    obstacleCircle(PUMP.x, PUMP.z + 0.3, 0.55);
    obstacleCircle(FIRE.x, FIRE.z, 1.0);
    obstacleRect(-15.5, -9.5, 3.2, 3.7);                     // barn
    obstacleRect(-15, 5.5, 1.75, 2.45);                      // greenhouse
    obstacleCircle(13.5, -17.5, 1.9);                        // windmill
    obstacleCircle(12, 8, 3.55);                             // pond
    obstacleCircle(0, -13.6, 0.35);                          // scarecrow
    [[-11, -4.2], [-11.4, -2.8], [-11.2, -3.5]].forEach(function (b) { obstacleCircle(b[0], b[1], 0.75); });
    for (var i = 0; i < Math.min(4, Math.max(1, (D.plants || []).filter(function (q) { return q.type === 'worm_bin'; }).length)); i++)
      obstacleRect(-11.2 + (i % 2) * 1.6, 1.2 + Math.floor(i / 2) * 1.6, 0.65, 0.55);
    [[17, -2], [-18, -16]].forEach(function (t) { obstacleCircle(t[0], t[1], 0.9); });
    obstacleRect(DJ_SPOT.x - 0.95, DJ_SPOT.z, 0.5, 1.15);                               // DJ booth
    [-1.8, 1.8].forEach(function (z) { obstacleRect(DJ_SPOT.x - 0.9, DJ_SPOT.z + z, 0.45, 0.45); });
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (k) { obstacleCircle(PARTY.c.x + k[0] * (PARTY.half + 0.4), PARTY.c.z + k[1] * (PARTY.half + 0.4), 0.12); });
    buildNav();
  })();

  // ---------------------------------------------------------------- particles (water drops, dirt puffs, sparkles)
  var drops = [];
  var DROP_GEO = new THREE.SphereGeometry(0.045, 6, 4), DROP_MAT = new THREE.MeshBasicMaterial({ color: 0x6fc3ff });
  var DIRT_MAT = new THREE.MeshBasicMaterial({ color: 0x8a5f3a }), SPARK_MAT = new THREE.MeshBasicMaterial({ color: 0xfff2a8 });
  function emit(pos, vel, matl, life) {
    var m = drops.length > 160 ? drops.shift().m : new THREE.Mesh(DROP_GEO, matl);
    m.material = matl;
    m.position.copy(pos); m.visible = true; m.scale.setScalar(1);
    scene.add(m);
    drops.push({ m: m, v: vel, life: life, age: 0 });
  }
  function stepParticles(dt) {
    for (var i = drops.length - 1; i >= 0; i--) {
      var d = drops[i];
      d.age += dt;
      d.v.y -= 6 * dt;
      d.m.position.addScaledVector(d.v, dt);
      if (d.m.position.y < 0.05) { d.v.set(0, 0, 0); d.m.position.y = 0.05; }
      d.m.scale.setScalar(Math.max(0.01, 1 - d.age / d.life));
      if (d.age >= d.life) { scene.remove(d.m); drops.splice(i, 1); }
    }
  }

  // ---------------------------------------------------------------- heroes
  var ACTS;                                   // defined below
  var heroes = [], HERO_SPEED = 2.1;
  var outlines = (D.heroes || []).length <= 9;
  function heroLabel(h, selected) {
    var c = textCanvas(h.name, { px: 34, pad: 18, bg: selected ? '#4c9a5b' : 'rgba(255,255,255,0.92)', color: selected ? '#ffffff' : '#1e2a20' });
    if (h.label) { h.label.material.map.dispose(); h.label.material.map = new THREE.CanvasTexture(c); h.label.material.needsUpdate = true; }
    else h.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
    h.label.scale.set(0.55 * c.width / c.height, 0.55, 1);
    h.label.renderOrder = 20;
  }
  function buildHeroRoot(h, tool) {
    var a = {};
    for (var k in h.appearance) a[k] = h.appearance[k];
    if (tool !== undefined && tool !== null) a.hand = tool;
    a.pet = 'none';                                    // only the heroes come to the farm; companions stay home
    a.petAccessory = 'none';
    var root = NevetHero.build(a, D.catalog, { outlines: outlines, merge: true });
    root.userData.heroIndex = h.i;
    return root;
  }
  function setTool(h, tool) {
    var want = tool === null || tool === undefined ? h.appearance.hand : tool;
    if (h.tool === want && h.root) return;
    var old = h.root;
    h.root = buildHeroRoot(h, want);
    h.tool = want;
    if (old) {
      h.root.position.copy(old.position); h.root.rotation.copy(old.rotation);
      scene.remove(old);
      NevetHero.dispose(old);
    }
    scene.add(h.root);
    if (h.carry) h.root.add(h.carry);
  }
  var gateQueue = (D.heroes || []).map(function (info, i) {
    return { i: i, id: info.id, name: info.name, level: info.level, appearance: info.appearance || {},
             pos: V(0, 0, FARM.maxZ + 3 + i * 0.01), facing: PI, path: [], onArrive: null, act: null, actEnd: 0,
             actStart: 0, carry: null, watered: 0, emoteAt: 0, speedK: rr(0.9, 1.1), phase: rr(0, TAU) };
  });
  var arrivals = gateQueue.slice();
  function spawnNext(now) {
    var h = arrivals.shift();
    if (!h) return;
    heroes.push(h);
    setTool(h, ACTS[current].tool);
    h.root.position.copy(h.pos);
    h.root.rotation.y = PI;
    heroLabel(h, false);
    scene.add(h.label);
    h.shadow = blobShadow(0.55);
    scene.add(h.shadow);
    walkTo(h, [V(0, 0, FARM.maxZ - 1.2)], function () { assign(h, clockNow()); });
    if (ACTS[current].ring) heroes.forEach(function (o) {
      if (o !== h && o.act === 'dance') goTo(o, ringSlot(o), function () { face(o, ACTS[current].ringCentre); doAct(o, 'dance', 9999, null, clockNow()); });
    });
  }

  var simNow = 0;
  function clockNow() { return simNow; }
  function walkTo(h, pts, then) {
    h.path = Array.isArray(pts) ? pts.slice() : [pts];
    h.onArrive = then || null;
    h.act = null;
  }
  function goTo(h, to, then) {
    h.goal = to.clone().setY(0);
    walkTo(h, findPath(h.root.position, h.goal, h), then);
    h.stuckT = 0; h.stuckAt = h.root.position.clone();
  }
  // a spot is taken if another hero is heading there or standing near it
  var SPACING = 1.25;
  function spotTaken(p, h, minD) {
    var m2 = (minD || SPACING) * (minD || SPACING);
    for (var i = 0; i < heroes.length; i++) {
      var o = heroes[i];
      if (o === h || !o.root) continue;
      if (o.goal && (o.goal.x - p.x) * (o.goal.x - p.x) + (o.goal.z - p.z) * (o.goal.z - p.z) < m2) return true;
      var op = o.root.position;
      if (!o.path.length && (op.x - p.x) * (op.x - p.x) + (op.z - p.z) * (op.z - p.z) < m2) return true;
    }
    return false;
  }
  function freeSpot(p, h) { return spotOk(p) && !spotTaken(p, h); }
  // first free spot from a list of candidates (nearest first)
  function pickSpot(h, cands) {
    var hp = h.root.position;
    cands = cands.slice().sort(function (a, b) { return a.distanceToSquared(hp) - b.distanceToSquared(hp); });
    for (var i = 0; i < cands.length; i++) if (freeSpot(cands[i], h)) return cands[i];
    return null;
  }
  function doAct(h, kind, dur, then, now) {
    h.path = [];
    h.act = kind; h.actStart = now; h.actEnd = now + dur; h.onActDone = then;
  }
  function face(h, p) { h.wantFacing = Math.atan2(p.x - h.root.position.x, p.z - h.root.position.z); }
  function workSpot(p, h) {                           // where to stand to tend a plant (a free one, or null)
    return pickSpot(h, p.stands || [V(p.pos.x - 1.35, 0, p.pos.z), V(p.pos.x + 1.35, 0, p.pos.z)]);
  }
  function nearest(h, list, ok) {
    var best = null, bd = Infinity, hp = h.root.position;
    list.forEach(function (x) {
      if (!ok(x)) return;
      var d = x.pos.distanceToSquared(hp) + R() * 6;   // a little randomness spreads heroes out
      if (d < bd) { bd = d; best = x; }
    });
    return best;
  }
  function wanderNear(h, centre, radius, now, then) {
    var spot = null;
    for (var t = 0; t < 12 && !spot; t++) {
      var a = R() * TAU, d = rr(0.8, radius), c = V(centre.x + Math.cos(a) * d, 0, centre.z + Math.sin(a) * d);
      if (freeSpot(c, h)) spot = c;
    }
    if (!spot) return doAct(h, 'idle', rr(1, 2), then, clockNow());
    goTo(h, spot, function () { doAct(h, 'idle', rr(1.5, 3), then, clockNow()); });
  }
  function carryItem(h, color) {
    dropCarry(h);
    var it = sphere(0.17, color, [0, 0.8, 0.5], null, 10);
    h.carry = it;
    h.root.add(it);
  }
  function dropCarry(h) { if (h.carry) { h.carry.parent && h.carry.parent.remove(h.carry); h.carry = null; } }

  // ---------------------------------------------------------------- activities
  var stats = { harvest: 0, water: 0, plant: 0 };
  ACTS = {
    harvest: {
      name: 'Harvest festival', tool: 'none', night: 0, centre: V(0, 0.6, -5.5),
      stat: function () { return stats.harvest + ' picked'; },
      next: function harvestNext(h, now) {
        var stand = null;
        var p = nearest(h, plants, function (q) { return q.ripe && !q.claimed && q.where !== 'field' && (stand = workSpot(q, h)) && (q.stand = stand); });
        if (!p) return wanderNear(h, V(2, 0, 3), 4, now, function () { harvestNext(h, clockNow()); });
        p.claimed = h;
        goTo(h, p.stand, function () {
          face(h, p.pos);
          doAct(h, 'pick', 1.7, function () {
            p.ripe = false; p.claimed = null; p.regrowAt = clockNow() + rr(16, 28);
            carryItem(h, p.color);
            var col = p.color;
            var drop = pickSpot(h, CART_SPOTS);
            if (!drop) return wanderNear(h, CART, 3.5, clockNow(), function () { dropCarry(h); addToCart(col); stats.harvest++; harvestNext(h, clockNow()); });
            goTo(h, drop, function () {
              face(h, CART);
              doAct(h, 'drop', 0.7, function () {
                dropCarry(h);
                addToCart(col);
                stats.harvest++;
                harvestNext(h, clockNow());
              }, clockNow());
            });
          }, clockNow());
        });
      }
    },
    water: {
      name: 'Watering round', tool: 'watering_can', night: 0, centre: V(-1, 0.6, -6),
      stat: function () { return stats.water + ' watered'; },
      next: function waterNext(h, now) {
        if (h.watered >= 3) {                          // can's empty: refill at the pump
          var at = pickSpot(h, PUMP_SPOTS);
          if (!at) return wanderNear(h, PUMP, 3, now, function () { waterNext(h, clockNow()); });
          return goTo(h, at, function () {
            face(h, PUMP);
            doAct(h, 'refill', 1.6, function () { h.watered = 0; waterNext(h, clockNow()); }, clockNow());
          });
        }
        var p = nearest(h, plants, function (q) { return !q.claimed && clockNow() - q.wateredAt > 25 && q.where !== 'field' && (q.stand = workSpot(q, h)); });
        if (!p) return wanderNear(h, V(-2, 0, 2), 4, now, function () { waterNext(h, clockNow()); });
        p.claimed = h;
        goTo(h, p.stand, function () {
          face(h, p.pos);
          h.waterTarget = p;
          doAct(h, 'water', 2.4, function () {
            p.claimed = null; p.wateredAt = clockNow(); p.perk = 1;
            h.watered++; stats.water++; h.waterTarget = null;
            waterNext(h, clockNow());
          }, clockNow());
        });
      }
    },
    plant: {
      name: 'Planting day', tool: 'seed_bag', night: 0, centre: V(12.4, 0.5, -8),
      stat: function () { return stats.plant + ' planted'; },
      next: function plantNext(h, now) {
        var s = nearest(h, spots, function (q) { return q.state === 'empty' && !q.claimed && (q.stand = pickSpot(h, [V(q.pos.x - 0.95, 0, q.pos.z), V(q.pos.x + 0.95, 0, q.pos.z)])); });
        if (!s) return wanderNear(h, V(11, 0, -2.6), 3, now, function () { plantNext(h, clockNow()); });
        s.claimed = h;
        goTo(h, s.stand, function () {
          face(h, s.pos);
          doAct(h, 'plant', 1.6, function () {
            s.claimed = null;
            sow(s, clockNow());
            stats.plant++;
            plantNext(h, clockNow());
          }, clockNow());
        });
      }
    },
    campfire: {
      name: 'Campfire dance', tool: null, night: 1, centre: V(FIRE.x, 0.8, FIRE.z), ring: true, ringCentre: FIRE,
      stat: function () { return heroes.length + ' dancing'; },
      next: function (h, now) {
        var slot = ringSlot(h);
        goTo(h, slot, function () { face(h, FIRE); doAct(h, 'dance', 9999, null, clockNow()); });
      }
    },
    party: {
      name: 'Party!', tool: null, night: 1, centre: V(PARTY.c.x + 1, 0.9, PARTY.c.z),
      stat: function () {
        var who = heroes.filter(function (h) { return h.act === 'party' || h.act === 'conga'; }).length;
        return (conga.on ? 'Conga line! · ' : '') + who + ' dancing' + (heroes[0] && heroes[0].act === 'dj' ? ' · DJ ' + heroes[0].name : '');
      },
      next: function (h, now) {
        if (h === heroes[0]) {                         // whoever opened the farm spins the records
          return goTo(h, DJ_SPOT, function () { h.wantFacing = -PI / 2; doAct(h, 'dj', 9999, null, clockNow()); });
        }
        goTo(h, floorSlot(h), function () { face(h, V(DJ_SPOT.x, 0, DJ_SPOT.z)); h.style = h.i % 4; doAct(h, 'party', 9999, null, clockNow()); });
      }
    }
  };
  function floorSlot(h) {                             // a 4 x 4 grid of spots on the dance floor
    var dancers = heroes.filter(function (o) { return o !== heroes[0]; }), k = Math.max(0, dancers.indexOf(h));
    var cols = 4, sp = 1.3, i = k % cols, j = Math.floor(k / cols) % 4;
    return V(PARTY.c.x - 1.5 * sp + i * sp + (Math.floor(k / 16) * 0.5), 0, PARTY.c.z - 1.5 * sp + j * sp);
  }
  var ORDER = ['harvest', 'water', 'plant', 'campfire', 'party'];
  var current = D.start && ACTS[D.start] ? D.start : 'harvest';
  var ringTurn = 0;
  function ringRadius() { return Math.max(2.9, heroes.length * 1.5 / TAU); }   // about 1.5 units between neighbours
  function ringSlot(h) {
    var n = Math.max(1, heroes.length), k = heroes.indexOf(h);
    var a = (k / n) * TAU + ringTurn;
    return V(FIRE.x + Math.cos(a) * ringRadius(), 0, FIRE.z + Math.sin(a) * ringRadius());
  }
  var CART_SPOTS = [V(CART.x - 1.3, 0, CART.z - 0.4), V(CART.x + 1.3, 0, CART.z - 0.4), V(CART.x - 1.3, 0, CART.z + 1.0),
                    V(CART.x + 1.3, 0, CART.z + 1.0), V(CART.x, 0, CART.z - 1.75)];
  var PUMP_SPOTS = [V(PUMP.x + 1.05, 0, PUMP.z + 0.1), V(PUMP.x - 1.05, 0, PUMP.z + 0.1), V(PUMP.x, 0, PUMP.z - 1.05)];
  function assign(h, now) {
    plants.forEach(function (p) { if (p.claimed === h) p.claimed = null; });
    spots.forEach(function (s) { if (s.claimed === h) s.claimed = null; });
    dropCarry(h);
    ACTS[current].next(h, now);
  }
  function addToCart(color) {
    var hidden = cartPile.filter(function (c) { return !c.visible; });
    var c = hidden.length ? hidden[0] : cartPile[Math.floor(R() * cartPile.length)];
    c.material = mat(color);
    c.visible = true;
    c.scale.setScalar(0.01);
    c.userData.pop = clockNow();
  }
  function sow(s, now) {
    s.state = 'growing';
    s.t0 = now;
    var species = ['lettuce', 'carrot', 'basil', 'strawberry', 'radish', 'spinach', 'parsley'][Math.floor(R() * 7)];
    var holder = group([s.pos.x, s.pos.y, s.pos.z]);
    var sprout = plantModel(species, 'germination', Math.round(now * 100)), grown = plantModel(species, 'mature', Math.round(now * 100) + 1, { r: 0.55, h: 1 });
    grown.scale.setScalar(0.001);
    holder.add(sprout); holder.add(grown);
    holder.rotation.y = rr(0, TAU);
    scene.add(holder);
    s.plant = { holder: holder, sprout: sprout, grown: grown };
    for (var i = 0; i < 6; i++) emit(s.pos.clone().setY(0.25), V(rr(-0.8, 0.8), rr(1.2, 2), rr(-0.8, 0.8)), DIRT_MAT, 0.6);
  }
  function stepField(now, dt) {
    var allGrown = true;
    spots.forEach(function (s) {
      if (s.state === 'growing' && s.plant) {
        var k = Math.min(1, (now - s.t0) / 7);
        s.plant.sprout.scale.setScalar(Math.max(0.001, 1 - Math.max(0, k - 0.55) * 2.5));
        s.plant.grown.scale.setScalar(Math.max(0.001, Math.max(0, k - 0.4) / 0.6 * 0.8));
        if (k >= 1) s.state = 'grown';
      }
      if (s.state === 'clearing' && s.plant) {
        var c = Math.min(1, (now - s.t0) / 1.5);
        s.plant.holder.scale.setScalar(Math.max(0.001, 1 - c));
        if (c >= 1) { scene.remove(s.plant.holder); s.plant = null; s.state = 'empty'; }
      }
      if (s.state !== 'grown') allGrown = false;
    });
    if (allGrown && !stepField.wait) stepField.wait = now + 6;
    if (stepField.wait && now > stepField.wait) {            // the field is full: harvest it and start again
      stepField.wait = 0;
      spots.forEach(function (s, i) { s.state = 'clearing'; s.t0 = now + i * 0.08; });
    }
  }

  // ---------------------------------------------------------------- switching
  var auto = !D.start, actStarted = 0, AUTO_DUR = { harvest: 50, water: 45, plant: 45, campfire: 40, party: 45 };
  var nightTarget = 0, night = 0;
  function setActivity(name, now, byUser) {
    if (!ACTS[name]) return;
    current = name;
    actStarted = now;
    nightTarget = ACTS[name].night;
    if (byUser) auto = false;
    focusTarget = ACTS[name].centre.clone();
    focusUntil = now + 2.2;
    PARTY.group.visible = name === 'party';
    conga.on = false;
    if (name !== 'party') music.stop();
    heroes.forEach(function (h, idx) { h.switchAt = now + idx * 0.06; });     // swap tools one hero at a time
    updateUI();
  }

  // ---------------------------------------------------------------- per-frame hero motion
  var tmp = V(0, 0, 0);
  function stepHero(h, now, dt) {
    if (h.switchAt && now >= h.switchAt) {             // the activity changed: new tool, new job
      h.switchAt = 0;
      setTool(h, ACTS[current].tool);
      h.watered = 0;
      assign(h, now);
    }
    var root = h.root, u = root.userData;
    var moving = false;
    if (h.path.length) {
      var target = h.path[0];
      tmp.subVectors(target, root.position); tmp.y = 0;
      var d = tmp.length(), step = HERO_SPEED * h.speedK * dt;
      if (d <= Math.max(step, 0.06)) {
        root.position.x = target.x; root.position.z = target.z;
        h.path.shift();
        if (!h.path.length && h.onArrive) { var cb = h.onArrive; h.onArrive = null; cb(); }
      } else {
        tmp.divideScalar(d);
        steer(h, tmp);                                    // step around other heroes
        var nx = root.position.x + tmp.x * step * h.slow, nz = root.position.z + tmp.z * step * h.slow;
        if (!walkable(nx, nz) && walkable(root.position.x, root.position.z)) {   // never steer into a bed or wall
          tmp.subVectors(target, root.position); tmp.y = 0; tmp.normalize();
          nx = root.position.x + tmp.x * step; nz = root.position.z + tmp.z * step;
        }
        root.position.x = nx; root.position.z = nz;
        (h.moveDir || (h.moveDir = V(0, 0, 0))).copy(tmp);
        h.stuckT = (h.stuckT || 0) + dt;                   // hardly moving for a while? plan a new way round
        if (h.stuckT > 1.2) {
          if (h.stuckAt && h.stuckAt.distanceTo(root.position) < 0.35 && h.goal) {
            var then2 = h.onArrive;
            h.path = findPath(root.position, h.goal, h); h.onArrive = then2;
          }
          h.stuckT = 0; h.stuckAt = root.position.clone();
        }
        h.wantFacing = Math.atan2(tmp.x, tmp.z);
        moving = true;
      }
    } else if (h.act && now >= h.actEnd) {
      var done = h.onActDone; h.act = null; h.onActDone = null;
      if (done) done();
    }
    // turn smoothly towards where we're going / looking
    if (h.wantFacing !== undefined) {
      var diff = ((h.wantFacing - root.rotation.y + PI * 3) % TAU) - PI;
      root.rotation.y += diff * Math.min(1, dt * 9);
    }
    // base animation from hero3d (breathing, blinking; emotes only when dancing or idle)
    var free = (h.act === 'dance' || h.act === 'idle') && !moving;
    NevetHero.animate(root, now, { calm: calm || !free || h.act === 'dance' });
    var legs = u.legs || {}, arms = u.arms || {};
    [1, -1].forEach(function (s) { if (legs[s]) legs[s].rotation.x = 0; });
    if (moving) {
      var cyc = now * 9.5 * h.speedK + h.phase;
      [1, -1].forEach(function (s) {
        if (legs[s]) legs[s].rotation.x = Math.sin(cyc) * 0.55 * s;
        if (arms[s] && !h.carry) arms[s].rotation.x = -Math.sin(cyc) * 0.5 * s;
      });
      u.hero.position.y += Math.abs(Math.sin(cyc)) * 0.07;
      u.hero.rotation.z = Math.sin(cyc) * (legs[1] ? 0.03 : 0.08);      // robes waddle a bit more
    }
    if (h.carry) [1, -1].forEach(function (s) { if (arms[s]) { arms[s].rotation.x = -1.15; arms[s].rotation.z = arms[s].userData.rest - s * 0.25; } });
    if (h.act === 'conga') {
      var bc = beatPhase(now);
      [1, -1].forEach(function (s) { if (arms[s]) { arms[s].rotation.x = -1.35; arms[s].rotation.z = arms[s].userData.rest - s * 0.2; } if (legs[s]) legs[s].rotation.x = Math.sin(bc * PI * 2) * 0.5 * s; });
      u.hero.position.y += Math.abs(Math.sin(bc * PI * 2)) * 0.08;
      u.hero.rotation.z = Math.sin(bc * PI * 2) * 0.1;
    }
    var p = h.act ? (now - h.actStart) : 0;
    switch (h.act) {
      case 'pick':
        u.hero.position.y -= 0.12; u.hero.rotation.x = 0.32;
        [1, -1].forEach(function (s) { if (arms[s]) arms[s].rotation.x = -1.1 + Math.sin(p * 9 + s * 1.5) * 0.35; });
        if (p > 1.2 && h.pickPopped !== h.actStart) { h.pickPopped = h.actStart; }
        break;
      case 'drop':
        [1, -1].forEach(function (s) { if (arms[s]) arms[s].rotation.x = -1.3 - Math.sin(Math.min(1, p / 0.7) * PI) * 0.6; });
        break;
      case 'water':
        u.hero.rotation.x = 0.1;
        if (arms[1]) { arms[1].rotation.x = -0.95 + Math.sin(p * 3) * 0.06; arms[1].rotation.z = arms[1].userData.rest - 0.2; }
        if (Math.random() < dt * 22) {
          root.updateMatrixWorld(true);
          var spout = (u.tool || root).getWorldPosition(new THREE.Vector3());
          var fwd = V(Math.sin(root.rotation.y), 0, Math.cos(root.rotation.y));
          spout.addScaledVector(fwd, 0.45); spout.y = Math.max(spout.y, 0.75);
          emit(spout, V(fwd.x * 1.2 + rr(-0.3, 0.3), 0.2, fwd.z * 1.2 + rr(-0.3, 0.3)), DROP_MAT, 0.7);
        }
        break;
      case 'refill':
        if (arms[1]) arms[1].rotation.x = -0.6 + Math.sin(p * 8) * 0.5;
        if (PUMP_HANDLE) PUMP_HANDLE.rotation.z = Math.sin(p * 8) * 0.3;
        if (Math.random() < dt * 12) emit(PUMP.clone().add(V(0, 1.1, 0.5)), V(rr(-0.1, 0.1), -0.5, 0.3), DROP_MAT, 0.5);
        break;
      case 'plant':
        u.hero.position.y -= 0.18; u.hero.rotation.x = 0.4;
        [1, -1].forEach(function (s) { if (arms[s]) arms[s].rotation.x = -1.2 + Math.abs(Math.sin(p * 7 + s)) * 0.45; });
        break;
      case 'dance':
        if (now >= h.emoteAt && h.emoteAt) { NevetHero.emote(root, h.nextMove); h.emoteAt = 0; }
        break;
      case 'party':
        if (now >= h.emoteAt && h.emoteAt) { NevetHero.emote(root, h.nextMove); h.emoteAt = 0; }
        if (!u.emote) groove(h, u, arms, legs, now);
        break;
      case 'congaReady':
        if (!conga.on && h.backAt && now >= h.backAt) {
          h.backAt = 0;
          goTo(h, floorSlot(h), function () { face(h, V(DJ_SPOT.x, 0, DJ_SPOT.z)); doAct(h, 'party', 9999, null, clockNow()); });
        } else groove(h, u, arms, legs, now);
        break;
      case 'dj':
        if (arms[1]) arms[1].rotation.x = -1.0 + Math.sin(now * 14) * 0.18;        // scratching
        if (arms[-1]) { arms[-1].rotation.x = -0.9; arms[-1].rotation.z = arms[-1].userData.rest + 0.15; }
        u.headRig.rotation.x = Math.abs(Math.sin(beatPhase(now) * PI)) * 0.22;      // nodding on the beat
        u.hero.position.y += Math.abs(Math.sin(beatPhase(now) * PI)) * 0.04;
        break;
      case 'idle':
        break;
    }
    // feet on the ground and a soft shadow
    root.position.y = 0;
    if (h.shadow) h.shadow.position.set(root.position.x, 0.03, root.position.z);
    if (h.label) {
      h.label.position.set(root.position.x, 3.25, root.position.z);
      h.label.visible = showNames;
    }
  }
  // look ahead: if someone is in the way, veer to one side (and slow down if very close)
  var _av = V(0, 0, 0);
  function steer(h, dir) {
    _av.set(0, 0, 0);
    h.slow = 1;
    var p = h.root.position;
    for (var i = 0; i < heroes.length; i++) {
      var o = heroes[i];
      if (o === h || !o.root) continue;
      var dx = o.root.position.x - p.x, dz = o.root.position.z - p.z, d = Math.sqrt(dx * dx + dz * dz);
      if (d > 2.6 || d < 1e-4) continue;
      if (o.path.length && o.moveDir && o.moveDir.x * dir.x + o.moveDir.z * dir.z > 0.6 && d > 1.1) continue;   // walking the same way
      var ahead = (dx * dir.x + dz * dir.z) / d;
      if (ahead < 0.15) continue;
      var lat = dir.z * dx - dir.x * dz;                  // which side the other hero is on
      if (Math.abs(lat) > 1.3) continue;
      var side = lat > 0.04 ? -1 : lat < -0.04 ? 1 : (h.i < o.i ? 1 : -1);
      var w = (1 - d / 2.6) * (o.path.length ? 1.0 : 1.8) * ahead;
      _av.x += dir.z * side * w; _av.z += -dir.x * side * w;
      if (d < 1.1 && ahead > 0.7) h.slow = Math.min(h.slow, o.path.length && h.i > o.i ? 0.25 : 0.6);
    }
    if (_av.x || _av.z) { dir.add(_av); dir.normalize(); }
  }
  function separate() {                       // heroes politely step around each other
    for (var i = 0; i < heroes.length; i++) {
      for (var j = i + 1; j < heroes.length; j++) {
        var A = heroes[i], B = heroes[j], a = A.root.position, b = B.root.position;
        var dx = b.x - a.x, dz = b.z - a.z, d2 = dx * dx + dz * dz;
        var MIN = 1.05;
        if (d2 >= MIN * MIN || d2 < 1e-6) continue;
        var d = Math.sqrt(d2), push = (MIN - d) / d * 0.35;
        var wa = A.path.length || A.act === 'conga' ? 1 : 0.12, wb = B.path.length || B.act === 'conga' ? 1 : 0.12, sum = wa + wb;
        var ax = a.x - dx * push * wa / sum, az = a.z - dz * push * wa / sum;
        var bx = b.x + dx * push * wb / sum, bz = b.z + dz * push * wb / sum;
        if (walkable(ax, az) || !walkable(a.x, a.z)) { a.x = ax; a.z = az; }
        if (walkable(bx, bz) || !walkable(b.x, b.z)) { b.x = bx; b.z = bz; }
      }
    }
  }

  // ---------------------------------------------------------------- party choreography
  var BPM = 120;
  function beatPhase(now) { return (now * BPM / 60) % 1; }
  function groove(h, u, arms, legs, now) {             // dancing between the big moves, each hero in their own style
    var b = now * BPM / 60, ph = (b % 1), up = Math.abs(Math.sin(ph * PI));
    u.hero.position.y += up * 0.09;
    switch (h.style) {
      case 0:                                          // bounce and pump
        if (arms[1]) arms[1].rotation.x = -0.5 - 0.7 * up;
        if (arms[-1]) arms[-1].rotation.x = -0.5 - 0.7 * (1 - up);
        break;
      case 1:                                          // hands in the air, swaying
        [1, -1].forEach(function (s) { if (arms[s]) arms[s].rotation.z = arms[s].userData.rest + s * (2.0 + Math.sin(b * PI) * 0.3); });
        u.hero.rotation.z = Math.sin(b * PI) * 0.12;
        break;
      case 2:                                          // side step
        u.hero.position.x = Math.sin(b * PI) * 0.18;
        [1, -1].forEach(function (s) { if (legs[s]) legs[s].rotation.z = s * up * 0.25; if (arms[s]) arms[s].rotation.z = arms[s].userData.rest + s * up * 0.8; });
        break;
      default:                                         // the twist
        u.hero.rotation.y = Math.sin(b * PI) * 0.5;
        [1, -1].forEach(function (s) { if (arms[s]) arms[s].rotation.x = -0.8 + Math.sin(b * PI + s) * 0.3; });
        u.hero.position.y -= up * 0.05;
    }
  }
  var conga = { on: false, t0: 0, theta: 0 }, partyBeat = -1;
  function congaPoint(s) {                            // an oval loop around the dance floor
    var a = s / 2.75;
    return V(PARTY.c.x - 0.6 + Math.cos(a) * 2.75, 0, PARTY.c.z + Math.sin(a) * 2.65);
  }
  function stepParty(now, dt) {
    if (!PARTY.group.visible) return;
    var b = now * BPM / 60, beat = Math.floor(b), ph = b % 1, kick = Math.pow(1 - ph, 3);
    // floor tiles, bulbs, beams, ball, speakers, balloons
    var n = PARTY.tileN, col = new THREE.Color();
    if (beat !== partyBeat) {
      partyBeat = beat;
      var pattern = Math.floor(beat / 8) % 3;
      for (var i = 0; i < n; i++) for (var j = 0; j < n; j++) {
        var on = pattern === 0 ? (i + j + beat) % 2 === 0 : pattern === 1 ? Math.abs(i - 3) + Math.abs(j - 3) === beat % 4 : R() < 0.45;
        col.setHSL(((i * 7 + j * 3 + beat * 5) % 20) / 20, 0.85, on ? 0.6 : 0.16);
        PARTY.tiles.setColorAt(i * n + j, col);
      }
      PARTY.tiles.instanceColor.needsUpdate = true;
      // group moves on the beat (most of the time), sometimes a conga line
      var dancers = heroes.filter(function (h) { return h.act === 'party'; });
      var settled = heroes.every(function (h) { return h === heroes[0] || h.act === 'party'; });   // everyone in place
      if (beat % 40 === 32 && dancers.length > 2 && !conga.on && settled) startConga(now);
      else if (beat % 8 === 0 && !conga.on && R() < 0.75) {
        var move = ['cheer', 'hop', 'twirl', 'pump', 'wave', 'cheer'][Math.floor(beat / 8) % 6];
        dancers.forEach(function (h, k) { h.nextMove = move; h.emoteAt = now + k * 0.05; });
      }
      if (conga.on && conga.moving && now - conga.t1 > 9) endConga(now);
    }
    var bulbCount = PARTY.bulbs.count;
    for (var k = 0; k < bulbCount; k++) { col.setHSL((k * 0.13 + now * 0.25) % 1, 0.9, 0.45 + 0.25 * Math.max(0, Math.sin(now * 6 + k))); PARTY.bulbs.setColorAt(k, col); }
    PARTY.bulbs.instanceColor.needsUpdate = true;
    PARTY.ball.rotation.y = now * 1.2;
    PARTY.beams.forEach(function (bm) {
      var a = now * 0.9 + bm.userData.k * TAU / PARTY.beams.length;
      bm.rotation.set(Math.sin(a * 1.3) * 0.55, 0, Math.cos(a) * 0.55);
      bm.material.opacity = 0.1 + kick * 0.14;
    });
    PARTY.speakers.forEach(function (w) { w.scale.set(1, 1 + kick * 0.6, 1 + kick * 0.6); });
    PARTY.decks.forEach(function (d) { d.rotation.y = now * 3.5; });
    PARTY.stripe.material.color.setHSL((now * 0.2) % 1, 0.9, 0.6);
    PARTY.balloons.forEach(function (bl) { bl.position.y = bl.userData.y + Math.sin(now * 1.4 + bl.userData.ph) * 0.12; bl.rotation.z = Math.sin(now + bl.userData.ph) * 0.1; });
    var cp = PARTY.confetti.geometry.attributes.position;
    PARTY.confettiSeeds.forEach(function (sd, q) {
      var y = 4.2 - ((now * sd[3] + sd[1]) % 1) * 4.2;
      cp.setXYZ(q, PARTY.c.x + sd[0] + Math.sin(now * 2 + q) * 0.15, y, PARTY.c.z + sd[2] + Math.cos(now * 1.7 + q) * 0.15);
    });
    cp.needsUpdate = true;
    PARTY.notes.forEach(function (nt) {
      var u = (now * 0.35 + nt.userData.ph) % 1;
      nt.position.set(DJ_SPOT.x - 0.9 - u * 0.6, 1.7 + u * 2.4, DJ_SPOT.z + nt.userData.side * 1.8 + Math.sin(u * 9) * 0.25);
      nt.material.opacity = Math.sin(u * PI);
    });
    // conga line: everyone follows the leader around the floor
    if (conga.on && !conga.moving) {
      var ready = (conga.order || []).every(function (h) { return h.act === 'congaReady' || heroes.indexOf(h) < 0; });
      if (ready || now - conga.t0 > 7) {
        conga.moving = true; conga.t1 = now;
        conga.order.forEach(function (h) { h.path = []; h.act = 'conga'; h.goal = null; });
      }
    }
    if (conga.on && conga.moving) {
      conga.theta += dt * 1.25;
      var line = (conga.order || []).filter(function (h) { return h.act === 'conga'; });
      var gap = congaGap(conga.order.length);
      line.forEach(function (h, k) {
        var target = congaPoint(conga.theta - k * gap), r = h.root.position;
        var dx = target.x - r.x, dz = target.z - r.z, d = Math.hypot(dx, dz);
        var spd = Math.min(d, (1.25 + d) * dt * 1.6);
        if (d > 1e-3) { r.x += dx / d * spd; r.z += dz / d * spd; h.wantFacing = Math.atan2(dx, dz); }
      });
    }
  }
  function congaGap(n) { return Math.min(1.25, 16.9 / Math.max(1, n)); }   // the oval is about 17 units round
  function startConga(now) {
    // first everyone walks to their place in the line (in the order they stand around the floor),
    // then the whole line moves together, so nobody bumps into anybody
    var c = PARTY.c, line = heroes.filter(function (h) { return h.act === 'party'; });
    line.forEach(function (h) { h.ang = Math.atan2(h.root.position.z - c.z, h.root.position.x - (c.x - 0.6)); });
    line.sort(function (a, b) { return b.ang - a.ang; });
    conga.on = true; conga.moving = false; conga.t0 = now;
    conga.theta = line.length ? line[0].ang * 2.75 : 0;
    conga.order = line;
    var gap = congaGap(line.length);
    line.forEach(function (h, k) {
      goTo(h, congaPoint(conga.theta - k * gap), function () { h.wantFacing = undefined; doAct(h, 'congaReady', 9999, null, clockNow()); });
    });
  }
  function endConga(now) {
    conga.on = false;
    (conga.order || []).forEach(function (h, k) {      // back to the floor, the leader first
      if (h.act !== 'conga' && h.act !== 'congaReady') return;
      h.act = 'congaReady';
      h.backAt = now + k * 0.25;
    });
  }

  // ---------------------------------------------------------------- music (party mode, off until you switch it on)
  var music = (function () {
    var ctx = null, master = null, timer = null, step = 0, nextT = 0, on = false;
    var BASS = [45, 45, 57, 45, 48, 45, 55, 43, 45, 45, 57, 45, 52, 50, 48, 43];   // a little A-minor groove
    function hz(m) { return 440 * Math.pow(2, (m - 69) / 12); }
    function env(node, t, a, d, peak) { node.gain.setValueAtTime(0.0001, t); node.gain.exponentialRampToValueAtTime(peak, t + a); node.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
    function kick(t) { var o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12); env(g, t, 0.002, 0.28, 0.9); o.connect(g).connect(master); o.start(t); o.stop(t + 0.32); }
    var noiseBuf = null;
    function hat(t, open) {
      if (!noiseBuf) { noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate); var d = noiseBuf.getChannelData(0); for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
      var s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      s.buffer = noiseBuf; f.type = 'highpass'; f.frequency.value = 7000; env(g, t, 0.001, open ? 0.18 : 0.05, 0.22);
      s.connect(f).connect(g).connect(master); s.start(t); s.stop(t + 0.25);
    }
    function clap(t) {
      var s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      s.buffer = noiseBuf; f.type = 'bandpass'; f.frequency.value = 1500; env(g, t, 0.003, 0.14, 0.35);
      s.connect(f).connect(g).connect(master); s.start(t); s.stop(t + 0.2);
    }
    function bass(t, note, accent) {
      var o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      o.type = 'sawtooth'; o.frequency.value = hz(note);
      f.type = 'lowpass'; f.Q.value = 9; f.frequency.setValueAtTime(accent ? 1800 : 900, t); f.frequency.exponentialRampToValueAtTime(220, t + 0.16);
      env(g, t, 0.004, 0.17, accent ? 0.33 : 0.22);
      o.connect(f).connect(g).connect(master); o.start(t); o.stop(t + 0.22);
    }
    function tick() {
      var s16 = 60 / BPM / 4;
      while (nextT < ctx.currentTime + 0.12) {
        var k = step % 16;
        if (k % 4 === 0) kick(nextT);
        if (k % 4 === 2) hat(nextT, k === 14);
        if (k === 4 || k === 12) { hat(nextT); clap(nextT); }
        if (k % 2 === 0 || k === 7 || k === 15) bass(nextT, BASS[k], k % 4 === 2);
        nextT += s16; step++;
      }
    }
    return {
      toggle: function () {
        if (on) return this.stop(), false;
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        if (!ctx) { ctx = new AC(); master = ctx.createGain(); master.gain.value = 0.28; master.connect(ctx.destination); }
        ctx.resume();
        on = true; step = 0; nextT = ctx.currentTime + 0.05;
        hat(nextT);                                    // creates the noise buffer
        timer = setInterval(tick, 25);
        return true;
      },
      stop: function () { on = false; if (timer) clearInterval(timer); timer = null; if (ui && ui.sound) { ui.sound.classList.remove('active'); ui.sound.setAttribute('aria-pressed', 'false'); } },
      playing: function () { return on; }
    };
  })();

  // campfire: everyone does the same move, rippling around the ring
  var DANCE = ['cheer', 'hop', 'twirl', 'wave', 'pump', 'cheer', 'stretch', 'hop'];
  var danceAt = 0, danceK = 0;
  function stepDance(now) {
    if (current !== 'campfire' || now < danceAt) return;
    danceK++;
    var dancers = heroes.filter(function (h) { return h.act === 'dance'; });
    if (danceK % 4 === 0 && dancers.length > 1) {         // every fourth beat the ring turns
      ringTurn += TAU / Math.max(3, heroes.length) * (danceK % 8 === 0 ? -1 : 1);
      dancers.forEach(function (h) {
        var from = Math.atan2(h.root.position.z - FIRE.z, h.root.position.x - FIRE.x);
        var to = Math.atan2(ringSlot(h).z - FIRE.z, ringSlot(h).x - FIRE.x), diff = ((to - from + PI * 3) % TAU) - PI;
        var pts = [];
        for (var k = 1; k <= 4; k++) { var a = from + diff * k / 4; pts.push(V(FIRE.x + Math.cos(a) * ringRadius(), 0, FIRE.z + Math.sin(a) * ringRadius())); }
        walkTo(h, pts, function () { face(h, FIRE); doAct(h, 'dance', 9999, null, clockNow()); });
      });
      danceAt = now + 4;
      return;
    }
    var move = DANCE[danceK % DANCE.length];
    dancers.forEach(function (h, i) { h.nextMove = move; h.emoteAt = now + i * 0.12; });
    danceAt = now + 3.2;
  }

  // ---------------------------------------------------------------- world animation
  function stepWorld(now, dt) {
    // day / night
    night += (nightTarget - night) * Math.min(1, dt * 0.9);
    var n = night;
    skyMat.uniforms.top.value.copy(SKY.dayTop).lerp(SKY.nightTop, n);
    skyMat.uniforms.bottom.value.copy(SKY.dayHorizon).lerp(SKY.nightHorizon, n);
    scene.fog.color.copy(skyMat.uniforms.bottom.value);
    hemi.intensity = 0.62 - n * 0.4;
    hemi.color.setRGB(1 - n * 0.4, 1 - n * 0.3, 1);
    sun.intensity = 0.75 - n * 0.55;
    sun.color.setRGB(1 - n * 0.35, 1 - n * 0.25, 1);
    sunDisc.material.color.setRGB(1, 0.95 - n * 0.3, 0.7 - n * 0.3);
    sunDisc.position.y = 95 - n * 120;
    moon.material.opacity = n;
    stars.material.opacity = n * 0.9;
    cloudMat.opacity = 0.95 * (1 - n * 0.75);
    cloudMat.color.setRGB(1 - n * 0.55, 1 - n * 0.5, 1 - n * 0.35);
    var fireOn = current === 'campfire' || current === 'party' ? 1 : 0;
    flames.forEach(function (f) {
      f.visible = n > 0.15 && fireOn;
      var k = f.userData.k;
      f.scale.set(1 + Math.sin(now * 13 + k) * 0.08, 0.85 + Math.sin(now * 9 + k * 2) * 0.12 + Math.sin(now * 23) * 0.05, 1 + Math.cos(now * 11 + k) * 0.08);
      f.rotation.y = now * (k + 1) * 0.7;
    });
    fireLight.intensity = n * fireOn * (1.5 + Math.sin(now * 11) * 0.15 + Math.sin(now * 23) * 0.1);
    embers.material.opacity = n * fireOn * 0.9;
    if (embers.material.opacity > 0.01) {
      var ep = embers.geometry.attributes.position;
      embers.userData.seeds.forEach(function (s, i) {
        var k = (now * s[2] + s[0]) % 1;
        ep.setXYZ(i, FIRE.x + Math.cos(s[1] + k * 3) * 0.3 * k, 0.6 + k * 3.2, FIRE.z + Math.sin(s[1] + k * 3) * 0.3 * k);
      });
      ep.needsUpdate = true;
    }
    fireflies.material.opacity = n * 0.95;
    if (n > 0.05) {
      for (var i = 0; i < fireflySeeds.length; i++) {
        var f = fireflySeeds[i];
        fireflyPos[i * 3] = f[0] + Math.sin(now * 0.4 + f[3]) * 1.2;
        fireflyPos[i * 3 + 1] = f[1] + Math.sin(now * 1.3 + f[3] * 2) * 0.35;
        fireflyPos[i * 3 + 2] = f[2] + Math.cos(now * 0.33 + f[3]) * 1.2;
      }
      fireflyGeo.attributes.position.needsUpdate = true;
    }
    if (BARN_WINDOW) BARN_WINDOW.material = n > 0.4 ? mat('#f7d77a') : mat('#3c2a1e');
    // things that move
    if (sails) sails.rotation.z = -now * 0.6;
    clouds.forEach(function (c) { c.position.x += c.userData.speed * dt; if (c.position.x > 150) c.position.x = -150; });
    ducks.forEach(function (d) {
      var u = d.userData, a = now * u.speed + u.ph;
      d.position.set(u.cx + Math.cos(a) * u.r, 0.02 + Math.sin(now * 2 + u.ph) * 0.02, u.cz + Math.sin(a) * u.r);
      d.rotation.y = -a;
    });
    butterflies.forEach(function (b) {
      var u = b.userData, a = now * u.sp + u.ph;
      b.visible = n < 0.6;
      b.position.set(u.c.x + Math.cos(a) * u.r, u.h + Math.sin(now * 2.3 + u.ph) * 0.3, u.c.z + Math.sin(a * 1.3) * u.r);
      b.rotation.y = -a;
      var flap = Math.sin(now * 18 + u.ph) * 0.9;
      u.lw.rotation.z = flap; u.rw.rotation.z = -flap;
    });
    chickens.forEach(function (c) {
      var u = c.userData;
      if (now > u.next) { u.target.set(rr(-13, -8.2), 0, rr(-7.2, -0.6)); u.next = now + rr(3, 7); u.peck = now + rr(0.5, 2); }
      tmp.subVectors(u.target, c.position); tmp.y = 0;
      var d = tmp.length();
      if (d > 0.1) { c.position.addScaledVector(tmp, Math.min(1, 0.9 * dt / d)); c.rotation.y = Math.atan2(tmp.x, tmp.z); c.position.y = Math.abs(Math.sin(now * 12)) * 0.04; }
      var pk = now > u.peck && now < u.peck + 0.6 ? Math.sin((now - u.peck) / 0.6 * PI * 3) : 0;
      u.head.rotation.x = Math.abs(pk) * 0.9;
      u.shadow.position.set(c.position.x, 0.03, c.position.z);
    });
    WORMS.forEach(function (w) { w.rotation.z = Math.sin(now * 3 + w.userData.wiggle) * 0.4; w.position.y = 0.9 + Math.abs(Math.sin(now * 1.5 + w.userData.wiggle)) * 0.05; });
    // plants: fruit regrows, watered plants perk up and their soil darkens
    plants.forEach(function (p) {
      if (!p.ripe && p.regrowAt && now > p.regrowAt) { p.ripe = true; p.regrowAt = 0; }
      var want = p.ripe ? 1 : 0;
      p.ripeK += (want - p.ripeK) * Math.min(1, dt * 3);
      var ms = p.model.userData.minScale || 0;
      var sc = Math.max(0.001, ms + (1 - ms) * p.ripeK);
      (p.model.userData.produce || []).forEach(function (o) { if (!o.userData.s0) o.userData.s0 = o.scale.clone(); o.scale.copy(o.userData.s0).multiplyScalar(sc); });
      if (p.perk > 0) p.perk = Math.max(0, p.perk - dt * 0.8);
      p.holder.scale.set(1, 1 + Math.sin(p.perk * PI) * 0.18, 1);
      p.holder.rotation.z = calm ? 0 : Math.sin(now * 1.2 + p.pos.x + p.pos.z) * 0.03;
      var wet = Math.max(0, 1 - (now - p.wateredAt) / 40);
      p.soil.material.opacity = wet * 0.55;
      p.soil.visible = wet > 0.01;
    });
    cartPile.forEach(function (c) {
      if (c.userData.pop) { var k = Math.min(1, (now - c.userData.pop) / 0.35); c.scale.setScalar(Math.max(0.01, Math.sin(k * PI * 0.75) / 0.92)); if (k >= 1) { c.userData.pop = 0; c.scale.setScalar(1); } }
    });
    if (current === 'harvest' && now - actStarted < 0.5) cartPile.forEach(function (c) { if (!c.userData.pop) c.visible = false; });
    stepField(now, dt);
  }

  // ---------------------------------------------------------------- camera
  var focusTarget = null, focusUntil = 0, follow = null;
  function viewDistance() { return camera.aspect < 0.8 ? 27 : camera.aspect < 1.2 ? 22 : 17; }
  function stepCamera(now, dt) {
    var want = follow ? follow.root.position.clone().setY(1.2) : (focusTarget && now < focusUntil + 3 ? focusTarget : null);
    if (want) controls.target.lerp(want, Math.min(1, dt * (follow ? 3 : 1.6)));
    if (!follow && focusTarget && now < focusUntil + 3 && now - userTouched > 3) {     // glide to a comfortable distance
      var off = camera.position.clone().sub(controls.target), d = off.length();
      var goal = viewDistance();
      off.multiplyScalar(1 + (goal / d - 1) * Math.min(1, dt * 1.4));
      camera.position.copy(controls.target).add(off);
    }
    if (!controls.autoRotate && !calm && !follow && now - userTouched > 12) controls.autoRotate = true;
    controls.update();
  }

  // ---------------------------------------------------------------- UI
  var showNames = true;
  var ui = {
    name: document.getElementById('farm-act-name'), stat: document.getElementById('farm-act-stat'),
    chips: document.querySelectorAll('[data-act]'), auto: document.getElementById('farm-auto'),
    names: document.getElementById('farm-names'), photo: document.getElementById('farm-photo'),
    follow: document.getElementById('farm-follow'), loading: document.getElementById('farm-loading'),
    sound: document.getElementById('farm-sound')
  };
  if (ui.sound) ui.sound.addEventListener('click', function () {
    var on = music.toggle();
    ui.sound.classList.toggle('active', on); ui.sound.setAttribute('aria-pressed', on);
  });
  function updateUI() {
    if (ui.name) ui.name.textContent = ACTS[current].name;
    ui.chips.forEach(function (c) { c.classList.toggle('active', c.dataset.act === current); c.setAttribute('aria-pressed', c.dataset.act === current); });
    if (ui.auto) { ui.auto.classList.toggle('active', auto); ui.auto.setAttribute('aria-pressed', auto); }
    if (ui.sound) ui.sound.hidden = current !== 'party';
  }
  ui.chips.forEach(function (c) { c.addEventListener('click', function () { setActivity(c.dataset.act, clockNow(), true); }); });
  if (ui.auto) ui.auto.addEventListener('click', function () { auto = !auto; if (auto) actStarted = clockNow(); updateUI(); });
  if (ui.names) ui.names.addEventListener('click', function () { showNames = !showNames; ui.names.classList.toggle('active', showNames); ui.names.setAttribute('aria-pressed', showNames); });
  if (ui.photo) ui.photo.addEventListener('click', function () {
    renderer.render(scene, camera);
    var a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = 'nevet-farm-' + new Date().toISOString().slice(0, 10) + '.png';
    document.body.appendChild(a); a.click(); a.remove();
  });
  function setFollow(h) {
    if (follow) heroLabel(follow, false);
    follow = h;
    if (h) {
      heroLabel(h, true);
      NevetHero.emote(h.root, 'wave');
      controls.autoRotate = false;
      userTouched = clockNow();
      if (ui.follow) { ui.follow.hidden = false; ui.follow.textContent = h.name + (h.level ? ' · Lv ' + h.level : '') + ' — tap the ground to let go'; }
    } else if (ui.follow) ui.follow.hidden = true;
  }
  // keyboard / USB button boxes: 1-4 pick an activity, A toggles auto, Esc goes back
  document.addEventListener('keydown', function (e) {
    var k = e.key;
    if (k >= '1' && k <= '5') setActivity(ORDER[+k - 1], clockNow(), true);
    else if (k === 'a' || k === 'A') { auto = !auto; if (auto) actStarted = clockNow(); updateUI(); }
    else if (k === 'Escape') { var back = document.querySelector('.farm-close'); if (back) location.href = back.href; }
  });
  var down = null;
  canvas.addEventListener('pointerdown', function (e) { down = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener('pointerup', function (e) {
    if (!down || Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y) > 8) { down = null; return; }
    down = null;
    var hit = Nevet3D.pick(e, canvas, camera, heroes.map(function (h) { return h.root; }), 'heroIndex');
    setFollow(hit ? heroes.filter(function (h) { return h.root === hit; })[0] || null : null);
  });

  // ---------------------------------------------------------------- loop
  var clock = new THREE.Clock(), last = 0, nextSpawn = 0.4, running = true;
  document.addEventListener('visibilitychange', function () { running = !document.hidden; if (running) { last = clock.getElapsedTime(); loop(); } });
  function step(dt) {
    simNow += dt;
    var now = simNow;
    if (arrivals.length && now >= nextSpawn) { spawnNext(now); nextSpawn = now + 0.7; }
    if (auto && now - actStarted > AUTO_DUR[current] && !arrivals.length) setActivity(ORDER[(ORDER.indexOf(current) + 1) % ORDER.length], now, false);
    heroes.forEach(function (h) { stepHero(h, now, dt); });
    separate();
    stepDance(now);
    stepParty(now, dt);
    stepWorld(now, dt);
    stepParticles(dt);
  }
  updateUI();
  nightTarget = ACTS[current].night; night = nightTarget;
  PARTY.group.visible = current === 'party';
  (function () {                                       // first view: the gate and the activity behind it
    var c = ACTS[current].centre, dir = V(0.55, 0.6, 0.85).normalize();
    controls.target.copy(c).lerp(V(0, 0.8, 8), 0.45);
    camera.position.copy(controls.target).addScaledVector(dir, viewDistance() * 1.1);
    focusTarget = c.clone(); focusUntil = 6;
  })();
  function loop() {
    if (!running) return;
    requestAnimationFrame(loop);
    var real = clock.getElapsedTime(), dt = Math.min(0.05, real - last);
    last = real;
    step(dt);
    if (ui.stat) ui.stat.textContent = ACTS[current].stat();
    stepCamera(simNow, dt);
    renderer.render(scene, camera);
    if (ui.loading && !ui.loading.hidden && simNow > 0.3) ui.loading.hidden = true;
  }
  loop();
  // handy in the browser console (and for tests): NevetFarm.simulate(20) skips 20 seconds ahead
  window.NevetFarm = {
    scene: scene, heroes: heroes, camera: camera, controls: controls, renderer: renderer, stats: stats,
    setActivity: function (n) { setActivity(n, clockNow(), true); },
    simulate: function (sec) { for (var t = 0; t < sec; t += 0.05) step(0.05); },
    closest: function () {
      var best = Infinity;
      for (var i = 0; i < heroes.length; i++) for (var j = i + 1; j < heroes.length; j++)
        best = Math.min(best, Math.hypot(heroes[i].root.position.x - heroes[j].root.position.x, heroes[i].root.position.z - heroes[j].root.position.z));
      return best;
    },
    free: function (x, z) { return freeAt(x, z); }, path: function (a, b) { return findPath(V(a[0], 0, a[1]), V(b[0], 0, b[1])).map(function (v) { return [+v.x.toFixed(1), +v.z.toFixed(1)]; }); },
    plants: plants,
    blockedHeroes: function () { return heroes.filter(function (h) { return blockedAt(h.root.position.x, h.root.position.z, 0.2); }).length; }
  };
})();
