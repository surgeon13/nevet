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
  var KINDS = ['lettuce', 'herb', 'tomato', 'root', 'strawberry', 'flower', 'pepper', 'corn', 'beans', 'pumpkin'];
  var PRODUCE = { tomato: '#e0402f', pepper: '#e8492f', herb: '#6cc24a', lettuce: '#a6d96a', root: '#f08a2c', strawberry: '#e5334b',
                  flower: '#f5c52b', pumpkin: '#ef8a24', beans: '#7bbf4a', corn: '#f2d04b', bush: '#7cc35a' };
  function plantModel(kind, r) {
    var g = group(), pg = group(), minScale = 0;
    g.add(pg);
    function add(o, isProduce) { (isProduce ? pg : g).add(o); return o; }
    switch (kind) {
      case 'tomato':
        add(cyl(0.025, 0.025, 1.15, '#c9a26b', [0.14, 0.57, 0], 6));
        for (var i = 0; i < 4; i++) add(sphere(0.2 + r() * 0.06, i % 2 ? LEAF : LEAF2, [(r() - 0.5) * 0.3, 0.28 + i * 0.2, (r() - 0.5) * 0.3]));
        for (var j = 0; j < 5; j++) add(sphere(0.08, '#e0402f', [Math.cos(j * 1.3) * 0.2, 0.32 + j * 0.13, Math.sin(j * 1.3) * 0.2], null, 8), true);
        break;
      case 'pepper':
        for (var a = 0; a < 3; a++) add(sphere(0.19, a % 2 ? LEAF : LEAF2, [(r() - 0.5) * 0.25, 0.25 + a * 0.13, (r() - 0.5) * 0.25]));
        for (var b = 0; b < 3; b++) add(sphere(0.06, b === 1 ? '#f2c230' : '#e8492f', [Math.cos(b * 2.1) * 0.2, 0.3, Math.sin(b * 2.1) * 0.2], [0.8, 1.6, 0.8], 8), true);
        break;
      case 'herb':
        for (var h = 0; h < 8; h++) add(sphere(0.11, h % 3 ? LEAF3 : LEAF, [Math.cos(h * 0.8) * 0.16 * (h % 2 + 0.5), 0.12 + (h % 4) * 0.07, Math.sin(h * 0.8) * 0.16]), true);
        minScale = 0.55;
        break;
      case 'lettuce':
        for (var l = 0; l < 7; l++) {
          var ang = l / 7 * TAU, rad = l ? 0.17 : 0;
          add(sphere(l ? 0.16 : 0.15, l ? '#a6d96a' : '#c7ea8c', [Math.cos(ang) * rad, 0.13 + (l ? 0 : 0.06), Math.sin(ang) * rad], [1, 0.62, 1]), true);
        }
        minScale = 0.45;
        break;
      case 'root':
        for (var c = 0; c < 5; c++) { var top = cone(0.05, 0.42, LEAF3, [Math.cos(c * 1.26) * 0.06, 0.32, Math.sin(c * 1.26) * 0.06], 5); top.rotation.set(Math.sin(c) * 0.35, 0, Math.cos(c) * 0.35); add(top, true); }
        add(cyl(0.08, 0.04, 0.14, '#f08a2c', [0, 0.06, 0], 8), true);
        minScale = 0.35;
        break;
      case 'strawberry':
        for (var s = 0; s < 5; s++) add(sphere(0.13, s % 2 ? LEAF2 : LEAF, [Math.cos(s * 1.25) * 0.15, 0.1, Math.sin(s * 1.25) * 0.15], [1, 0.5, 1]));
        for (var bb = 0; bb < 4; bb++) { var berry = cone(0.055, 0.12, '#e5334b', [Math.cos(bb * 1.6 + 0.4) * 0.23, 0.07, Math.sin(bb * 1.6 + 0.4) * 0.23], 8); berry.rotation.x = PI; add(berry, true); }
        break;
      case 'flower':
        add(cyl(0.035, 0.045, 1.3, '#5b9a3c', [0, 0.65, 0], 6));
        add(sphere(0.14, LEAF, [0.12, 0.55, 0], [1.4, 0.3, 0.8])); add(sphere(0.14, LEAF, [-0.12, 0.8, 0], [1.4, 0.3, 0.8]));
        var head = group([0, 1.33, 0.05]); head.rotation.x = 0.5;
        for (var p = 0; p < 12; p++) head.add(sphere(0.09, '#f5c52b', [Math.cos(p / 12 * TAU) * 0.2, Math.sin(p / 12 * TAU) * 0.2, 0], [1, 1, 0.3], 8));
        head.add(rot(cyl(0.14, 0.14, 0.06, '#6b4423', [0, 0, 0.02], 14), PI / 2));
        add(head, true);
        minScale = 0.4;
        break;
      case 'pumpkin':
        for (var v = 0; v < 4; v++) add(sphere(0.16, v % 2 ? LEAF : LEAF2, [Math.cos(v * 1.6) * 0.32, 0.1, Math.sin(v * 1.6) * 0.32], [1.3, 0.35, 1]));
        var pk = add(group([0.05, 0.17, 0.05]), true);
        for (var rb = 0; rb < 6; rb++) pk.add(sphere(0.12, '#ef8a24', [Math.cos(rb / 6 * TAU) * 0.1, 0, Math.sin(rb / 6 * TAU) * 0.1], [0.75, 1, 0.75], 10));
        pk.add(cyl(0.025, 0.03, 0.1, '#5d7a2e', [0, 0.15, 0], 6));
        break;
      case 'beans':
        add(cyl(0.025, 0.025, 1.5, '#c9a26b', [0, 0.75, 0], 6));
        var helix = [];
        for (var hx = 0; hx <= 30; hx++) { var u = hx / 30; helix.push(V(Math.cos(u * TAU * 2.5) * 0.09, 0.05 + u * 1.35, Math.sin(u * TAU * 2.5) * 0.09)); }
        add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(helix), 40, 0.02, 5, false), LEAF2));
        for (var lv = 0; lv < 6; lv++) add(sphere(0.09, LEAF, [Math.cos(lv * 2.4) * 0.14, 0.25 + lv * 0.2, Math.sin(lv * 2.4) * 0.14], [1, 0.5, 1]));
        for (var pd = 0; pd < 4; pd++) add(sphere(0.035, '#7bbf4a', [Math.cos(pd * 1.9 + 1) * 0.16, 0.45 + pd * 0.22, Math.sin(pd * 1.9 + 1) * 0.16], [1, 3.2, 1], 6), true);
        break;
      case 'corn':
        add(cyl(0.04, 0.05, 1.6, '#7aa63c', [0, 0.8, 0], 6));
        for (var cl = 0; cl < 4; cl++) { var lf = cone(0.06, 0.8, LEAF, [Math.cos(cl * 1.6) * 0.14, 0.5 + cl * 0.22, Math.sin(cl * 1.6) * 0.14], 4); lf.rotation.set(Math.sin(cl * 1.6) * 1.0, 0, -Math.cos(cl * 1.6) * 1.0); add(lf); }
        var cob = group([0.07, 1.0, 0.05]); cob.rotation.z = -0.3;
        cob.add(cyl(0.06, 0.05, 0.3, '#f2d04b', [0, 0, 0], 8)); cob.add(rot(cone(0.065, 0.2, '#9cc95a', [0, -0.12, 0], 6), PI));
        add(cob, true);
        break;
      default:                                         // a leafy bush
        for (var k = 0; k < 4; k++) add(sphere(0.2, k % 2 ? LEAF : LEAF3, [(r() - 0.5) * 0.3, 0.2 + k * 0.1, (r() - 0.5) * 0.3]), true);
        minScale = 0.6;
    }
    if (NevetHero.merge) NevetHero.merge(g, function (o) { return o === pg; });
    g.userData = { kind: kind, produce: [pg], minScale: minScale, color: PRODUCE[kind] || PRODUCE.bush };
    return g;
  }
  function sproutModel() {
    var g = group();
    g.add(cyl(0.015, 0.02, 0.16, '#6fb34e', [0, 0.08, 0], 5));
    g.add(sphere(0.06, LEAF3, [0.05, 0.17, 0], [1.4, 0.35, 0.8], 8));
    g.add(sphere(0.06, LEAF3, [-0.05, 0.17, 0], [1.4, 0.35, 0.8], 8));
    if (NevetHero.merge) NevetHero.merge(g, function () { return false; });
    return g;
  }
  function kindFor(name, type) {
    if (type === 'worm_bin') return 'worm_bin';
    var n = (name || '').toLowerCase();
    var map = [
      [/tomat|עגבני/, 'tomato'], [/pepper|chil|פלפל/, 'pepper'],
      [/basil|mint|parsley|coriander|cilantro|oregano|thyme|sage|rosemary|herb|dill|lavender|chive|bazil|נענע|בזיל|פטרוזיל|כוסבר/, 'herb'],
      [/lettuce|salad|spinach|kale|chard|cabbage|arugula|rocket|חסה|תרד|כרוב/, 'lettuce'],
      [/carrot|radish|beet|onion|garlic|leek|potato|turnip|גזר|צנון|בצל|שום|תפוח אדמה/, 'root'],
      [/strawberr|berry|תות/, 'strawberry'], [/sunflower|flower|rose|marigold|zinnia|daisy|חמני|פרח/, 'flower'],
      [/pumpkin|squash|zucchini|courgette|melon|cucumber|דלע|קישוא|מלפפון|אבטיח|מלון/, 'pumpkin'],
      [/bean|pea|שעועית|אפונה/, 'beans'], [/corn|maize|wheat|תירס|חיטה/, 'corn']
    ];
    for (var i = 0; i < map.length; i++) if (map[i][0].test(n)) return map[i][1];
    var h = 0; for (var c = 0; c < n.length; c++) h = (h * 31 + n.charCodeAt(c)) >>> 0;
    return ['lettuce', 'herb', 'bush', 'flower'][h % 4];
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
        var info = real[idx], kind = info ? info.kind || kindFor(info.name, info.type) : (KINDS[Math.floor(fill() * KINDS.length)]);
        var stage = info ? info.stage : (fill() < 0.25 ? 'mature' : 'growing');
        addPlant(kind, V(bx, 0.4, z), stage, info ? info.name : null, 'bed');
      }
    });
  })();
  function addPlant(kind, pos, stage, name, where) {
    var young = stage === 'seed' || stage === 'germination';
    var model = young ? sproutModel() : plantModel(kind, rng(Math.round(pos.x * 100 + pos.z * 7)));
    var base = young ? 1 : stage === 'seedling' ? 0.6 : stage === 'growing' ? 0.85 : 1;
    var holder = group([pos.x, pos.y, pos.z]);
    holder.add(model);
    model.scale.setScalar(base);
    holder.rotation.y = rr(0, TAU);
    scene.add(holder);
    var soil = mesh(new THREE.CircleGeometry(0.38, 14), new THREE.MeshBasicMaterial({ color: 0x3b2716, transparent: true, opacity: 0 }));
    soil.rotation.x = -PI / 2; soil.position.set(pos.x, pos.y + 0.011, pos.z);
    scene.add(soil);
    var p = { kind: kind, pos: pos, holder: holder, model: model, base: base, name: name, where: where,
              ripe: !young && stage !== 'seedling', ripeK: 1, regrowAt: 0, claimed: null, wateredAt: -999, perk: 0, soil: soil,
              color: model.userData.color || PRODUCE.bush };
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
      var pm = plantModel(['tomato', 'herb', 'pepper', 'herb', 'tomato'][i], rng(i + 5));
      pm.position.set(-1.7 + i * 0.85, 0.5, -0.6); pm.scale.setScalar(0.75);
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
    walkTo(h, [V(rr(-0.6, 0.6), 0, FARM.maxZ - 1.5), V(rr(-2, 2), 0, 7.5)], function () { assign(h, clockNow()); });
    if (current === 'campfire') heroes.forEach(function (o) {
      if (o !== h && o.act === 'dance') walkTo(o, ringSlot(o), function () { face(o, FIRE); doAct(o, 'dance', 9999, null, clockNow()); });
    });
  }

  var simNow = 0;
  function clockNow() { return simNow; }
  function walkTo(h, pts, then) {
    h.path = Array.isArray(pts) ? pts.slice() : [pts];
    h.onArrive = then || null;
    h.act = null;
  }
  // a route that stays in the aisles: leave the beds along the lane, then go in
  function inBeds(p) { return p.z < -4.9 && p.x > -8.6 && p.x < 16.2; }
  function route(from, to) {
    var pts = [];
    if (inBeds(from)) pts.push(V(from.x, 0, -4.2));
    if (inBeds(to)) pts.push(V(to.x, 0, -4.2));
    pts.push(to.clone().setY(0));
    return pts;
  }
  function goTo(h, to, then) { walkTo(h, route(h.root.position, to), then); }
  function doAct(h, kind, dur, then, now) {
    h.path = [];
    h.act = kind; h.actStart = now; h.actEnd = now + dur; h.onActDone = then;
  }
  function face(h, p) { h.wantFacing = Math.atan2(p.x - h.root.position.x, p.z - h.root.position.z); }
  function aisleSpot(p, h) {
    // stand in the nearer aisle beside a bed slot, facing it
    var side = (p.x + 0.001 > h.root.position.x) ? -1 : 1;
    if (p.where === 'bed') return V(p.pos.x + side * 1.25, 0, p.pos.z);
    return V(p.pos.x + side * 0.85, 0, p.pos.z);
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
    var a = R() * TAU, d = rr(0.5, radius);
    goTo(h, V(centre.x + Math.cos(a) * d, 0, centre.z + Math.sin(a) * d), function () {
      doAct(h, 'idle', rr(1.5, 3), then, clockNow());
    });
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
        var p = nearest(h, plants, function (q) { return q.ripe && !q.claimed && q.where === 'bed'; });
        if (!p) return wanderNear(h, V(0, 0, 1), 4, now, function () { harvestNext(h, clockNow()); });
        p.claimed = h;
        goTo(h, aisleSpot(p, h), function () {
          face(h, p.pos);
          doAct(h, 'pick', 1.7, function () {
            p.ripe = false; p.claimed = null; p.regrowAt = clockNow() + rr(16, 28);
            carryItem(h, p.color);
            var col = p.color;
            goTo(h, V(CART.x + (h.root.position.x < CART.x ? -1.25 : 1.25), 0, CART.z + rr(-0.6, 0.6)), function () {
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
          return goTo(h, V(PUMP.x + 0.9, 0, PUMP.z + rr(-0.5, 0.8)), function () {
            face(h, PUMP);
            doAct(h, 'refill', 1.6, function () { h.watered = 0; waterNext(h, clockNow()); }, clockNow());
          });
        }
        var p = nearest(h, plants, function (q) { return !q.claimed && clockNow() - q.wateredAt > 25 && q.where === 'bed'; });
        if (!p) return wanderNear(h, V(-2, 0, 0), 4, now, function () { waterNext(h, clockNow()); });
        p.claimed = h;
        goTo(h, aisleSpot(p, h), function () {
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
        var s = nearest(h, spots, function (q) { return q.state === 'empty' && !q.claimed; });
        if (!s) return wanderNear(h, V(11, 0, -2.6), 3, now, function () { plantNext(h, clockNow()); });
        s.claimed = h;
        goTo(h, V(s.pos.x + (h.root.position.x < s.pos.x ? -0.85 : 0.85), 0, s.pos.z), function () {
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
      name: 'Campfire dance', tool: null, night: 1, centre: V(FIRE.x, 0.8, FIRE.z),
      stat: function () { return heroes.length + ' dancing'; },
      next: function (h, now) {
        var slot = ringSlot(h);
        goTo(h, slot, function () { face(h, FIRE); doAct(h, 'dance', 9999, null, clockNow()); });
      }
    }
  };
  var ORDER = ['harvest', 'water', 'plant', 'campfire'];
  var current = D.start && ACTS[D.start] ? D.start : 'harvest';
  var ringTurn = 0;
  function ringRadius() { return Math.min(6.2, Math.max(2.6, heroes.length * 0.42)); }
  function ringSlot(h) {
    var n = Math.max(1, heroes.length), k = heroes.indexOf(h);
    var a = (k / n) * TAU + ringTurn;
    return V(FIRE.x + Math.cos(a) * ringRadius(), 0, FIRE.z + Math.sin(a) * ringRadius());
  }
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
    var kind = ['lettuce', 'root', 'herb', 'strawberry', 'lettuce'][Math.floor(R() * 5)];
    var holder = group([s.pos.x, s.pos.y, s.pos.z]);
    var sprout = sproutModel(), grown = plantModel(kind, rng(Math.round(now * 100)));
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
  var auto = !D.start, actStarted = 0, AUTO_DUR = { harvest: 50, water: 45, plant: 45, campfire: 40 };
  var nightTarget = 0, night = 0;
  function setActivity(name, now, byUser) {
    if (!ACTS[name]) return;
    current = name;
    actStarted = now;
    nightTarget = ACTS[name].night;
    if (byUser) auto = false;
    focusTarget = ACTS[name].centre.clone();
    focusUntil = now + 2.2;
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
      if (d <= step || d < 0.05) {
        root.position.x = target.x; root.position.z = target.z;
        h.path.shift();
        if (!h.path.length && h.onArrive) { var cb = h.onArrive; h.onArrive = null; cb(); }
      } else {
        tmp.multiplyScalar(step / d);
        root.position.add(tmp);
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
  function separate() {                       // heroes politely step around each other
    for (var i = 0; i < heroes.length; i++) {
      for (var j = i + 1; j < heroes.length; j++) {
        var A = heroes[i], B = heroes[j], a = A.root.position, b = B.root.position;
        var dx = b.x - a.x, dz = b.z - a.z, d2 = dx * dx + dz * dz;
        if (d2 >= 0.72 || d2 < 1e-6) continue;
        var d = Math.sqrt(d2), push = (0.85 - d) / d;
        var wa = A.path.length ? 1 : 0.25, wb = B.path.length ? 1 : 0.25, sum = wa + wb;
        a.x -= dx * push * wa / sum; a.z -= dz * push * wa / sum;
        b.x += dx * push * wb / sum; b.z += dz * push * wb / sum;
      }
    }
  }

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
    var fireOn = current === 'campfire' ? 1 : 0;
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
    follow: document.getElementById('farm-follow'), loading: document.getElementById('farm-loading')
  };
  function updateUI() {
    if (ui.name) ui.name.textContent = ACTS[current].name;
    ui.chips.forEach(function (c) { c.classList.toggle('active', c.dataset.act === current); c.setAttribute('aria-pressed', c.dataset.act === current); });
    if (ui.auto) { ui.auto.classList.toggle('active', auto); ui.auto.setAttribute('aria-pressed', auto); }
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
    if (k >= '1' && k <= '4') setActivity(ORDER[+k - 1], clockNow(), true);
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
    stepWorld(now, dt);
    stepParticles(dt);
  }
  updateUI();
  nightTarget = ACTS[current].night; night = nightTarget;
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
    simulate: function (sec) { for (var t = 0; t < sec; t += 0.05) step(0.05); }
  };
})();
