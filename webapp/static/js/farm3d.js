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
  // the garden map (/map) in metres; with areas drawn, the bed area is built from it
  var MAPG = D.map && (D.map.features || []).some(function (f) { return f.kind === 'area'; }) ? D.map : null;
  var CHALK = null;
  // The farm's setting, chosen on the farm page (the same for everyone on this Nevet): the classic green
  // valley, a desert oasis, the seaside or a deep forest. It changes the ground, the sky, the trees and
  // what lies around the farm; the farm itself (beds, barn, pond, stage, play park) stays where it is.
  var WORLDS = window.NevetWorlds ? NevetWorlds.CONFIG : {
    classic: { ground: ['#8cc76a', '#79b85a', '#a3d27a'], sky: ['#6fb8ec', '#e4f4ff'], hemi: 0x6f8a5a, fog: [85, 260], tuft: '#5f9e46',
               petals: ['#ffffff', '#f6d743', '#f29bc0'], yard: '#d8c497', path: '#d2bb8c', pitch: '#7cc25c', border: '#4f9a3e', borderStyle: 'hedge' }
  };                                                   // (the settings live in farm-worlds.js)
  var WORLD = WORLDS[D.world] ? D.world : 'classic', WD = WORLDS[WORLD];
  // The farm is open: no fences round it, and its areas are divided by nature (hedges and rows of trees, with gaps
  // where the paths go through). The mud pit is its heart: the arena stands in the very middle of the farm with the
  // rave's dance field round it and the stage to the north. All round it lie the farming lands: the big farmyard
  // (beds, garden, barn, pond, windmill) to the north, with the orchard and the mother tree west of it and the market
  // garden east; the big wheel and a sunflower field west of the dance field, the gladiators' tents and the vineyard
  // east; the play park south, with the beehives and the pumpkin patch beside it; and wheat, corn and the hay barn
  // furthest south. When the party starts, the arena folds itself up into a fire tower in the middle of the dance field.
  // (metres, x to the east, z to the south)
  var PLAY = { minX: -19.6, maxX: 19.6, minZ: 60, maxZ: 78.4 };      // the play park, south of the dance field
  var PDZ = PLAY.minZ - 16;                                         // (how far south the park moved; its pieces are placed from the old spots)
  var LAND = { minX: -62, maxX: 62, minZ: -40, maxZ: 115 };          // where heroes go (no fence: just the farm's edge), centred on the mud pit
  var HEDGE_X = 20.5;                                  // the rows of hedges and trees between the dance field and the meadows
  var YARD_X = 31;                                     // ... and between the big farmyard and the orchard and market garden
  var FIRE = V(0, 0, 37.5);                           // the fire pit in the middle of the farm (the mud arena is built round it)
  var FIRE_K = 1.6;                                   // the fire pit, its flames and its glow, bigger than the old yard fire
  var ARENA_N = (D.heroes || []).length;
  var ARENA_W = Math.max(7.4, Math.min(9.8, 6.2 + 0.17 * ARENA_N));    // the arena wall's radius grows with the crowd
  var CAMP_R = ARENA_W + 1.8;                          // the dance ring round the arena
  var STAGE_HX = 14.5, STAGE_HZ = 14;                  // the rave's dance field round the arena (29 x 28 m)
  var PARTY_C = V(FIRE.x, 0, FIRE.z), STAGE_N = PARTY_C.z - STAGE_HZ;  // the field's middle (the fire) and its north edge (the stage)
  var WHEEL = { x: -34, z: 24, r: 6.2 };               // the big wheel in the west meadow, beside the stage
  // The farmyard is built at its first size (FARM, in yard metres) and then scaled up YS times round the middle of its
  // south side, where the arch is: the beds, the garden, the barn, the pond and everything in it are YS times bigger and
  // further apart. Anything heroes walk to is turned into farm metres with yx / yz / YV.
  var FARM = { minX: -20, maxX: 20, minZ: -20, maxZ: 16 };     // the farmyard (a hedge along its south side, with the arch, faces the stage)
  var YS = 1.5, YO = FARM.maxZ;
  function yx(x) { return x * YS; }
  function yz(z) { return YO + (z - YO) * YS; }
  function YV(v) { return V(yx(v.x), (v.y || 0) * YS, yz(v.z)); }
  var FARM_W = { minX: yx(FARM.minX), maxX: yx(FARM.maxX), minZ: yz(FARM.minZ), maxZ: FARM.maxZ };   // the yard on the farm (-30..30, -38..16)
  var PATH_E = yz(4.5), PATH_W = yz(10);               // the tracks from the yard out to the market garden and the orchard
  var PATHS = [                                        // every path: [x0, x1, z0, z1]
    [-1.5 * YS, 1.5 * YS, yz(5.75), 18.7],             // from the yard's middle through the arch
    [-18.4, 18.4, 16.7, 18.7],                         // the lane behind the stage
    [-18.4, -16.4, 16.7, 53.5], [16.4, 18.4, 16.7, 53.5],    // down both sides of the dance field
    [-1.3, 1.3, STAGE_N + 2 * STAGE_HZ, LAND.maxZ - 1],      // from the dance field on through the play park to the wheat and the corn
    [LAND.minX + 1.5, -1.4 * YS, PATH_W - 1.6, PATH_W + 1.6], [5.4 * YS, LAND.maxX - 1.5, PATH_E - 1.6, PATH_E + 1.6],   // the yard's tracks east and west
    [-29.5, -18.4, WHEEL.z - 1, WHEEL.z + 1],          // to the big wheel
    [18.4, 23.6, FIRE.z - 1, FIRE.z + 1],              // to the gladiators' tents
    [-60.5, 60.5, 80.6, 82.6]                          // the farm track past the beehives and the pumpkins, between the park and the far fields
  ];
  function onPath(x, z, m) { m = m || 0; return PATHS.some(function (p) { return x > p[0] - m && x < p[1] + m && z > p[2] - m && z < p[3] + m; }); }
  // The farm blooms with its people (invites.community on the station): the more heroes join, invite friends and
  // connect, the taller the plants, the more flowers, the bigger the mother tree, and wonders appear one by one.
  var BLOOM = D.community || { level: 0, unlocked: [] }, BL = Math.max(0, Math.min(1, +BLOOM.level || 0));
  function blooms(k) { return (BLOOM.unlocked || []).indexOf(k) >= 0; }
  var PG = { x: 1 + 0.1 * BL, y: 1 + 0.45 * BL };      // how much taller (and a little wider) the plants grow
  var MOTHER = { x: -46, z: -15 };                     // the farm's mother tree, in a clearing in the orchard west of the yard (never in the way)
  // The farming lands round the middle (see 'the farming lands' below): [kind, x0, x1, z0, z1]. Heroes walk round the
  // crops (each field is an obstacle, the orchard's trees one by one).
  var FIELDS = [
    ['orchard', -60, -33.5, -38, 3.4], ['market', 33.5, 60, -38, -4.8], ['tunnels', 33.5, 60, 2.4, 13.8],
    ['sunflowers', -60, -24, 33, 56.6], ['vineyard', 33, 60, 18.6, 56.6],
    ['hives', -60, -23, 61.5, 78], ['pumpkins', 23, 60, 61.5, 78],
    ['wheat', -60, -3.4, 84.6, 113], ['corn', 3.4, 34, 84.6, 113], ['haybarn', 37.5, 60, 84.6, 113]
  ];
  function inField(x, z, m) { m = m || 0; return FIELDS.some(function (f) { return x > f[1] - m && x < f[2] + m && z > f[3] - m && z < f[4] + m; }); }

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
  var camera = new THREE.PerspectiveCamera(42, 1, 0.1, 460);
  camera.position.set(17, 15, 21);
  var controls = new THREE.OrbitControls(camera, canvas);
  controls.target.set(0, 0.5, -3);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 5;
  controls.maxDistance = 165;                          // (far enough to see the whole farm, its fields and all)
  controls.maxPolarAngle = 1.36;
  controls.autoRotate = !calm;
  controls.autoRotateSpeed = 0.35;
  var userTouched = 0;
  controls.addEventListener('start', function () { controls.autoRotate = false; userTouched = clockNow(); });

  var viewShift = 0;                                   // px the picture is lifted (the party synth is open below)
  function resize() {
    var w = wrap.clientWidth, h = wrap.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    if (viewShift) camera.setViewOffset(w, h, 0, viewShift * 0.5, w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }
  function setViewShift(px) { viewShift = px; resize(); }
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
    dayTop: new THREE.Color(WD.sky[0]), dayHorizon: new THREE.Color(WD.sky[1]),
    nightTop: new THREE.Color('#081430'), nightHorizon: new THREE.Color('#2b3764'),
    dusk: new THREE.Color('#ff9560'), duskTop: new THREE.Color('#4b3c7e')
  };
  var skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { top: { value: SKY.dayTop.clone() }, bottom: { value: SKY.dayHorizon.clone() } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = clamp(vP.y * 1.6 + 0.08, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, pow(h, 0.8)), 1.0); }'
  });
  var sky = new THREE.Mesh(new THREE.SphereGeometry(300, 24, 16), skyMat);
  scene.add(sky);
  scene.fog = new THREE.Fog(SKY.dayHorizon.clone(), WD.fog[0] + 50, WD.fog[1] + 70);   // (the farm is wide: the far fields stay clear)

  var hemi = new THREE.HemisphereLight(0xffffff, WD.hemi, 0.62);
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
  // The farmyard's things are built in yard metres into YARD, which scales them up (see FARM above). While the yard is
  // built, `statics` is YARD; the farm's own statics are FARM_STATICS.
  var FARM_STATICS = statics, YARD = group([0, 0, YO * (1 - YS)]);
  YARD.scale.setScalar(YS);
  statics.add(YARD);

  // ---------------------------------------------------------------- ground
  var POND = { x: 15.6, z: 10.5 };                    // out east in the yard, by the track to the market garden (yard metres)
  var ANIMALS = [];                                   // worm bins & beds, hives, the chickens, the ducks: 'Animal care' visits them all
  var SEA_Y = -0.38;                                  // the sea's level (the seaside's beach and the island's lagoon)
  // the box the land around the farm is built round (1 m beyond the farm's edge; farm-worlds.js gets it too)
  var BOX = { x0: LAND.minX - 1, x1: LAND.maxX + 1, z0: LAND.minZ - 1, z1: LAND.maxZ + 0.2 };
  function boxDist(x, z, m) {                          // how far beyond the farm (plus a margin m)
    var dx = Math.max(0, x < 0 ? BOX.x0 - x - m : x - BOX.x1 - m), dz = Math.max(0, z < 0 ? BOX.z0 - z - m : z - BOX.z1 - m);
    return Math.sqrt(dx * dx + dz * dz);
  }
  function hillH(x, z) {
    if (WORLD === 'city') return 0;
    if (WORLD === 'island') {                          // a beach, the shallow lagoon, the reef just under the surface, then the deep
      var bd = boxDist(x, z, 0.5);
      return -Math.min(1.8, Math.max(0, bd - 3.5) * 0.09) + 1.3 * Math.exp(-Math.pow((bd - 43) / 3.2, 2)) - Math.min(12, Math.max(0, bd - 47) * 0.35);
    }
    var dx = Math.max(0, Math.abs(x) - BOX.x1 - 5), dz = Math.max(0, z < 0 ? BOX.z0 - 5 - z : z - BOX.z1 - 2.8);
    var d = Math.sqrt(dx * dx + dz * dz), h = 0;
    if (d > 0) {
      var k = Math.min(1, d / 30);
      if (WORLD === 'desert') h = Math.min(1, d / 22) * (2.6 + Math.sin(x * 0.12 + z * 0.05) * 2.2 + Math.sin(z * 0.1 - x * 0.04 + 1) * 1.7) * (0.7 + k);   // dunes
      else h = k * k * (6 + Math.sin(x * 0.07) * 4 + Math.cos(z * 0.06 + 1) * 4) * (WORLD === 'forest' ? 1.25 : WD.hills || 1)
             + (WORLD === 'snow' ? k * k * k * Math.max(0, Math.sin(x * 0.11 + 2) * Math.cos(z * 0.09)) * 9 : 0);
    }
    var sz = BOX.z0 - 2 - z;                           // (the seaside: the beach north of the farm, then the sea)
    if (WORLD === 'seaside' && sz > 0) { var b = Math.min(1, sz / 4); h = h * (1 - b) - Math.min(3.2, sz * 0.075); }
    return h;
  }
  (function () {
    var geo = new THREE.PlaneGeometry(440, 440, 110, 110);
    geo.rotateX(-PI / 2); geo.translate(0, 0, FIRE.z);   // (centred on the mud pit, like the farm)
    var pos = geo.attributes.position, cols = [], c = new THREE.Color();
    var g1 = new THREE.Color(WD.ground[0]), g2 = new THREE.Color(WD.ground[1]), g3 = new THREE.Color(WD.ground[2]);
    var sand = new THREE.Color('#f0dcaa'), wet = new THREE.Color('#c9ad78'), dune = new THREE.Color('#e6b878'), sea1 = new THREE.Color('#e9dcae'),
        sea2 = new THREE.Color('#2a6d96'), soil = new THREE.Color('#c98f5a'), rockC = new THREE.Color('#8d97a3');
    for (var i = 0; i < pos.count; i++) {
      var x = pos.getX(i), z = pos.getZ(i), y = hillH(x, z);
      pos.setY(i, y - 0.02);
      var n = Math.sin(x * 0.21) * Math.cos(z * 0.17) * 0.5 + 0.5;
      c.copy(g1).lerp(n > 0.5 ? g3 : g2, Math.abs(n - 0.5) * 1.2);
      if (WORLD === 'seaside' && z < BOX.z0 + 1) { c.lerp(sand, Math.min(1, (BOX.z0 + 1 - z) / 2.5)); if (y < SEA_Y + 0.2) c.lerp(wet, 0.7); }
      if (WORLD === 'desert' && y > 1) c.lerp(dune, Math.min(0.55, (y - 1) / 9));
      if (WORLD === 'island') {
        var bd = boxDist(x, z, 0.5);
        if (bd > 0.4) c.lerp(sand, Math.min(1, (bd - 0.4) / 1.6));
        if (y < SEA_Y + 0.15) c.lerp(sea1, 0.5);
        if (y < -2.2) c.lerp(sea2, Math.min(1, (-2.2 - y) / 5));
      }
      if (WORLD === 'city' && boxDist(x, z, 0.3) > 0) c.set('#b9b5ad');
      if (WORLD === 'savanna') c.lerp(soil, Math.max(0, Math.sin(x * 0.13 + 1) * Math.sin(z * 0.11) - 0.4) * 0.8);
      if (WORLD === 'snow' && y > 4) c.lerp(rockC, Math.min(0.35, (y - 4) / 20) * (Math.sin(x * 0.3) * Math.cos(z * 0.27) > 0.2 ? 1 : 0));
      cols.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    geo.computeVertexNormals();
    scene.add(new THREE.Mesh(geo, new THREE.MeshToonMaterial({ vertexColors: true })));
  })();
  // trodden yard and the path from the gate
  var yard = mesh(new THREE.CircleGeometry(6.5, 40), WD.yard);
  yard.rotation.x = -PI / 2; yard.position.set(0, 0.012 / YS, 1);
  YARD.add(yard);
  PATHS.forEach(function (p, k) {                      // the paths (a hair apart in height where they cross)
    var pm = mesh(new THREE.PlaneGeometry(p[1] - p[0], p[3] - p[2]), WD.path);
    pm.rotation.x = -PI / 2; pm.position.set((p[0] + p[1]) / 2, 0.008 + k * 0.0004, (p[2] + p[3]) / 2);
    statics.add(pm);
  });
  var lane = mesh(new THREE.PlaneGeometry(30, 2.2), WD.path);        // the lane in front of the beds
  lane.rotation.x = -PI / 2; lane.position.set(2.5, 0.011 / YS, -4.1);
  YARD.add(lane);

  // grass tufts and wild flowers (instanced: one draw call each); by setting: desert shrubs, dune grass
  // by the sea, ferns and toadstools in the forest
  function parkBusy(x, z) {                            // the play park's pitch, playground and path
    if (z < PLAY.minZ - 0.5 || z > PLAY.maxZ + 0.6) return false;
    z -= PDZ;                                          // (the park's pieces, from where they first stood)
    return (x > -19 && x < -2 && z > 20.4 && z < 31) || (x > 2.6 && x < 19 && z > 17.6 && z < 33.6) || Math.abs(x) < 2;
  }
  (function () {
    var tuftGeo, tuftN = 760, flowerN = 470, cover = WD.cover || 'tuft';
    if (cover === 'snow') { tuftGeo = new THREE.SphereGeometry(0.3, 8, 5); tuftGeo.scale(1, 0.35, 1); tuftN = 470; flowerN = 0; }
    else if (cover === 'leaf') { tuftGeo = new THREE.ConeGeometry(0.42, 0.6, 5); tuftGeo.translate(0, 0.3, 0); tuftN = 1100; flowerN = 400; }
    else if (cover === 'tallgrass') { tuftGeo = new THREE.ConeGeometry(0.08, 0.95, 4); tuftGeo.translate(0, 0.47, 0); tuftN = 1350; flowerN = 110; }
    else if (WORLD === 'desert') { tuftGeo = new THREE.SphereGeometry(0.22, 7, 5); tuftGeo.scale(1, 0.55, 1); tuftGeo.translate(0, 0.07, 0); tuftN = 300; flowerN = 125; }
    else if (WORLD === 'forest') { tuftGeo = new THREE.ConeGeometry(0.3, 0.45, 6); tuftGeo.translate(0, 0.22, 0); tuftN = 1000; flowerN = 270; }
    else if (WORLD === 'seaside') { tuftGeo = new THREE.ConeGeometry(0.055, 0.6, 4); tuftGeo.translate(0, 0.3, 0); tuftN = 930; }
    else { tuftGeo = new THREE.ConeGeometry(0.09, 0.32, 5); tuftGeo.translate(0, 0.16, 0); }
    if (WD.sparse) { tuftN = 290; flowerN = 160; }
    tuftN = Math.round(tuftN * 1.3); flowerN = Math.round(flowerN * 1.3);        // (a bigger farm)
    flowerN = Math.round(flowerN * (1 + 1.6 * BL));                 // the community's bloom: more wild flowers
    if (WD.flowers === false) flowerN = 0;
    var tufts = new THREE.InstancedMesh(tuftGeo, mat(WD.tuft), tuftN);
    var shroom = WORLD === 'forest';
    var flowerGeo = shroom ? new THREE.SphereGeometry(0.14, 9, 5, 0, TAU, 0, PI / 2) : new THREE.SphereGeometry(0.11, 8, 6);
    if (shroom) flowerGeo.translate(0, 0.17, 0);
    var flowers = new THREE.InstancedMesh(flowerGeo, new THREE.MeshToonMaterial({ color: 0xffffff }), Math.max(1, flowerN));
    var stems = shroom ? new THREE.InstancedMesh((function () { var g = new THREE.CylinderGeometry(0.04, 0.055, 0.19, 6); g.translate(0, 0.09, 0); return g; })(), mat('#f4ecd8'), Math.max(1, flowerN)) : null;
    var m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
    var PETALS = WD.petals;
    function freeSpot() {
      for (var tries = 0; tries < 30; tries++) {
        var x = rr(LAND.minX - 22, LAND.maxX + 22), z = rr(LAND.minZ - 24, LAND.maxZ + 12);
        var inYard = x > yx(-12) && x < yx(19.5) && z > yz(MAPG ? -20 : -16) && z < yz(9);         // (the beds, the garden and the planting field)
        var onAPath = onPath(x, z, 0.4);
        var onStage = x > PARTY_C.x - STAGE_HX - 1.6 && x < PARTY_C.x + STAGE_HX + 1.6 && z > STAGE_N - 4.6 && z < PARTY_C.z + STAGE_HZ + 5.4;   // the dance field, its stage, towers and sound desk
        var byTents = x > 22 && x < 30 && Math.abs(z - FIRE.z) < 11;
        var inArena = Math.hypot(x - FIRE.x, z - FIRE.z) < CAMP_R + 1.4 || Math.hypot(x - WHEEL.x, z - WHEEL.z) < 3.2 || Math.hypot(x - MOTHER.x, z - MOTHER.z) < 2.2;
        var inPond = Math.hypot(x - yx(POND.x), z - yz(POND.z)) < 4.3 * YS;
        var wet = (WORLD === 'seaside' && z < BOX.z0 - 0.5) || (WORLD === 'island' && hillH(x, z) < 0.02) || (WORLD === 'city' && boxDist(x, z, 0) > 0);
        if (!inYard && !onAPath && !onStage && !byTents && !inArena && !inPond && !wet && !parkBusy(x, z) && !inField(x, z, 0.3)) return [x, z];
      }
      return WORLD === 'city' || WORLD === 'island' ? [rr(-58, -40), rr(17, 30)] : [rr(LAND.maxX + 3, LAND.maxX + 20), rr(-18, 30)];
    }
    for (var i = 0; i < tuftN; i++) {
      var f = freeSpot();
      s.setScalar(rr(0.7, 1.5)); q.setFromAxisAngle(V(0, 1, 0), R() * TAU);
      m.compose(p.set(f[0], hillH(f[0], f[1]), f[1]), q, s); tufts.setMatrixAt(i, m);
    }
    for (var j = 0; j < flowerN; j++) {
      var g = freeSpot();
      if (shroom) s.setScalar(rr(0.7, 1.5)); else s.set(1, 0.7, 1).multiplyScalar(rr(0.8, 1.3));
      m.compose(p.set(g[0], hillH(g[0], g[1]) + (shroom ? 0 : 0.12), g[1]), q, s); flowers.setMatrixAt(j, m);
      if (stems) stems.setMatrixAt(j, m);
      flowers.setColorAt(j, col.set(PETALS[j % PETALS.length]));
    }
    scene.add(tufts); if (flowerN) scene.add(flowers);
    if (stems) scene.add(stems);
  })();

  // ---------------------------------------------------------------- hedges and trees between the areas
  // No fences: the farm is open to everyone (and to the animals and plants round it). Its areas are divided by nature:
  // low hedges dotted with flowers, and rows of trees (in the farm's setting: palms by the sea, pines in the snow...),
  // with gaps where the paths go through. The yard's way south is a wooden arch with the farm's name, in the hedge.
  var PARK_N = PLAY.minZ - 0.6;                         // the hedge between the dance field and the play park
  var DIVIDE_OBST = [], DIVIDE_TREES = [];
  (function () {
    var SIDE_S = 79.6;                                 // the hedge south of the park and the fields beside it
    var rows = [                                       // [x0, z0, x1, z1, gaps: [from, to] along the row]
      [-YARD_X, LAND.minZ + 0.8, -YARD_X, FARM.maxZ - 0.6, [[PATH_W - 2.1, PATH_W + 2.1]]],     // the yard's west side (the orchard beyond)
      [YARD_X, LAND.minZ + 0.8, YARD_X, FARM.maxZ - 0.6, [[PATH_E - 2.1, PATH_E + 2.1]]],       // its east side (the market garden)
      [-YARD_X + 0.9, FARM.maxZ, YARD_X - 0.9, FARM.maxZ, [[-2.5, 2.5]]],                         // its south side (the arch in the gap)
      [LAND.minX + 1, FARM.maxZ, -YARD_X - 0.9, FARM.maxZ, [[-47.7, -44.3]]],                      // the orchard / the big wheel's meadow
      [YARD_X + 0.9, FARM.maxZ, LAND.maxX - 1, FARM.maxZ, [[44.3, 47.7]]],                         // the market garden / the vineyard
      [-HEDGE_X, FARM.maxZ + 0.6, -HEDGE_X, SIDE_S - 0.6, [[WHEEL.z - 1.7, WHEEL.z + 1.7], [68, 71.4]]],   // the dance field and the park, west
      [HEDGE_X, FARM.maxZ + 0.6, HEDGE_X, SIDE_S - 0.6, [[FIRE.z - 1.7, FIRE.z + 1.7], [68, 71.4]]],       // ... and east
      [-HEDGE_X + 0.9, PARK_N, HEDGE_X - 0.9, PARK_N, [[-2.0, 2.0]]],                                   // between the dance field and the play park
      [LAND.minX + 1, 58.9, -HEDGE_X - 0.9, 58.9, [[-41.7, -38.3]]], [HEDGE_X + 0.9, 58.9, LAND.maxX - 1, 58.9, [[38.3, 41.7]]],   // the sunflowers / the beehives, the vineyard / the pumpkins
      [LAND.minX + 1, SIDE_S, LAND.maxX - 1, SIDE_S, [[-41.7, -38.3], [-2.0, 2.0], [38.3, 41.7]]]       // the park and the beehives and pumpkins / the farm track and the far fields
    ];
    var bushes = [], blooms2 = [];
    rows.forEach(function (row, ri) {
      var alongZ = row[0] === row[2], a0 = alongZ ? row[1] : row[0], a1 = alongZ ? row[3] : row[2], fixed = alongZ ? row[0] : row[1];
      function gapAt(t) { return row[4].some(function (g) { return t > g[0] && t < g[1]; }); }
      var trees = [];
      if (alongZ) for (var t = a0 + 3; t < a1 - 1; t += 9) {        // a tree every 9 m on the long rows (not by the barn, the gaps or the tents)
        var nearGap = row[4].some(function (g) { return t > g[0] - 2.6 && t < g[1] + 2.6; });
        var byBarn = fixed < 0 && t > yz(-15) && t < yz(-4), byTents = fixed > 0 && Math.abs(t - FIRE.z) < 9;
        if (!nearGap && !byBarn && !byTents) { trees.push(t); DIVIDE_TREES.push([fixed, t]); }
      }
      var seg0 = null;
      function closeSeg(t) {
        if (seg0 === null) return;
        var mid = (seg0 + t) / 2, half = (t - seg0) / 2 + 0.35;
        DIVIDE_OBST.push(alongZ ? [fixed, mid, 0.55, half] : [mid, fixed, half, 0.55]);
        seg0 = null;
      }
      for (var u = a0; u <= a1; u += 1.15) {
        if (gapAt(u)) { closeSeg(u - 1.15); continue; }
        if (seg0 === null) seg0 = u;
        if (trees.some(function (tt) { return Math.abs(tt - u) < 1.5; })) continue;   // (under the trees)
        var j = R(), x = alongZ ? fixed + (j - 0.5) * 0.3 : u, z = alongZ ? u : fixed + (j - 0.5) * 0.3, sc = 0.8 + R() * 0.45;
        bushes.push([x, z, sc, R()]);
        if (R() < 0.45) for (var f = 0; f < 3; f++) {
          var fa = R() * TAU;
          blooms2.push([x + Math.cos(fa) * 0.42 * sc, 0.55 * sc + R() * 0.25, z + Math.sin(fa) * 0.42 * sc, ri + f]);
        }
      }
      closeSeg(a1);
    });
    var bushGeo = new THREE.IcosahedronGeometry(0.62, 1); bushGeo.scale(1, 0.78, 1); bushGeo.translate(0, 0.4, 0);
    var bushM = new THREE.InstancedMesh(bushGeo, new THREE.MeshToonMaterial({ color: 0xffffff }), bushes.length);
    var m = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3(), col = new THREE.Color();
    var base = new THREE.Color(WD.bush || WD.border && WD.borderStyle === 'hedge' && WD.border || WD.tuft || '#4f9a3e');
    bushes.forEach(function (bsh, i) {
      q.setFromAxisAngle(V(0, 1, 0), bsh[3] * TAU);
      m.compose(pv.set(bsh[0], hillH(bsh[0], bsh[1]), bsh[1]), q, sv.set(bsh[2], bsh[2] * (0.85 + bsh[3] * 0.3), bsh[2]));
      bushM.setMatrixAt(i, m);
      bushM.setColorAt(i, col.copy(base).multiplyScalar(0.82 + bsh[3] * 0.3));
    });
    scene.add(bushM);
    if (blooms2.length && WD.flowers !== false) {
      var bl = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 7, 5), new THREE.MeshToonMaterial({ color: 0xffffff }), blooms2.length);
      blooms2.forEach(function (b2, i) { m.makeTranslation(b2[0], b2[1] + hillH(b2[0], b2[2]), b2[2]); bl.setMatrixAt(i, m); bl.setColorAt(i, col.set(WD.petals[b2[3] % WD.petals.length])); });
      scene.add(bl);
    }
    // the wooden arch over the way from the yard, with the farm's name and roses climbing it
    var gate = group([0, 0, FARM.maxZ]);
    [-1.9, 1.9].forEach(function (x) { gate.add(box(0.34, 2.9, 0.34, '#8a5f3a', [x, 1.45, 0])); });
    gate.add(box(4.3, 0.3, 0.36, '#8a5f3a', [0, 2.95, 0]));
    var sign = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.7), new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(textCanvas(D.gardenName || 'Nevet Farm', { px: 44, bg: '#f3e6c8', color: '#5a3d22', radius: 10, stroke: '#8a5f3a' })) }));
    sign.position.set(0, 2.45, 0.2);
    gate.add(sign);
    var signBack = sign.clone(); signBack.rotation.y = PI; signBack.position.z = -0.2; gate.add(signBack);
    [-1.9, 1.9].forEach(function (x, k) {                // leaves and roses up the posts and along the top
      for (var lf = 0; lf < 7; lf++) gate.add(sphere(0.22, '#4f8f3e', [x + Math.sin(lf * 2.1 + k) * 0.2, 0.3 + lf * 0.42, Math.cos(lf * 1.7) * 0.2], [1, 0.8, 1], 6));
      for (var rs2 = 0; rs2 < 4; rs2++) gate.add(sphere(0.09, WD.petals[(rs2 + k) % WD.petals.length], [x + Math.sin(rs2 * 2.7) * 0.25, 0.6 + rs2 * 0.65, 0.22], null, 6));
    });
    for (var tl = 0; tl < 9; tl++) gate.add(sphere(0.2, '#4f8f3e', [-2 + tl * 0.5, 3.12, Math.sin(tl * 1.3) * 0.12], [1, 0.7, 1], 6));
    statics.add(outline(gate));
  })();

  // ---------------------------------------------------------------- plants
  statics = YARD;                                      // (from here to the barn's worm bins: the farmyard, in yard metres)
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

  var BARN_WINDOW = null, PUMP_HANDLE = null, WORMS = [];
  var DROP_ICON = new THREE.SpriteMaterial({ depthWrite: false, map: new THREE.CanvasTexture((function () {
    var c = document.createElement('canvas'); c.width = c.height = 64;
    var g = c.getContext('2d');
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(32, 32, 30, 0, TAU); g.fill();
    g.fillStyle = '#3d9be0'; g.beginPath(); g.moveTo(32, 10); g.bezierCurveTo(44, 26, 48, 34, 48, 40); g.arc(32, 40, 16, 0, PI); g.bezierCurveTo(16, 34, 20, 26, 32, 10); g.fill();
    return c;
  })()) });

  // ---------------------------------------------------------------- beds
  var BED_X = [-9, -5, -1, 3, 7], BED_Z0 = -5.2, SLOTS = 8, SLOT_STEP = 1.0, BED_W = 1.7;
  var plants = [];                                     // every plant on the farm
  function signMesh(text, max) {
    max = max || 14;
    var c = textCanvas(text.length > max ? text.slice(0, max - 1) + '…' : text, { px: 34, bg: '#f3e6c8', color: '#4a321c', radius: 8, pad: 16, stroke: '#8a5f3a' });
    var w = 0.24 * c.width / c.height;
    var g = group();
    g.add(cyl(0.025, 0.025, 0.55, '#8a5f3a', [0, 0.27, 0], 5));
    var board = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.24), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), side: THREE.DoubleSide }));
    board.position.set(0, 0.58, 0);
    g.add(board);
    return g;
  }
  if (!MAPG) (function () {                            // the default beds (no garden map drawn yet)
    var real = (D.plants || []).filter(function (p) { return p.type !== 'worm_bin'; });
    var COLS = real.length > BED_X.length * SLOTS * 2 ? 3 : real.length > BED_X.length * SLOTS ? 2 : 1;
    var fill = rng(77);
    BED_X.forEach(function (bx, bi) {
      var bed = group([bx, 0, BED_Z0 - (SLOTS - 1) * SLOT_STEP / 2 - 0.5]);
      var len = SLOTS * SLOT_STEP + 0.4;
      [-1, 1].forEach(function (s) { bed.add(box(0.14, 0.48, len, '#a8743f', [s * BED_W / 2, 0.24, 0])); });
      [-1, 1].forEach(function (s) { bed.add(box(BED_W + 0.14, 0.48, 0.14, '#a8743f', [0, 0.24, s * len / 2])); });
      bed.add(box(BED_W - 0.1, 0.4, len - 0.1, '#5b3d27', [0, 0.2, 0]));
      [-1, 1].forEach(function (s) { [-1, 1].forEach(function (e) { bed.add(box(0.2, 0.56, 0.2, '#8a5f3a', [s * BED_W / 2, 0.28, e * len / 2])); }); });
      statics.add(outline(bed));
      // a bed holds one row of plants, or two or three narrower rows when there are many
      for (var k = 0; k < SLOTS; k++) for (var c = 0; c < COLS; c++) {
        var z = BED_Z0 - k * SLOT_STEP - 0.3, idx = COLS > 1 ? (k * COLS + c) * BED_X.length + bi : bi * SLOTS + k;   // crowded: deal plants out over all beds
        var info = real[idx];
        if (!info && COLS > 1) continue;                 // a crowded farm: no filler plants between real ones
        var species = info ? info.species || 'generic' : FILL[Math.floor(fill() * FILL.length)];
        var stage = info ? info.stage : (fill() < 0.35 ? 'growing' : 'mature');
        addPlant(species, V(bx + (c - (COLS - 1) / 2) * (BED_W - 0.5) / Math.max(1, COLS - 1), 0.4, z), stage, info && COLS === 1 ? info.name : null, 'bed',
          COLS > 1 ? { fit: { r: COLS === 2 ? 0.36 : 0.26, h: COLS === 2 ? 1.5 : 1.25 }, info: info } : { info: info });
      }
    });
  })();
  function addPlant(species, pos, stage, name, where, opts) {
    opts = opts || {};
    var young = stage === 'seed' || stage === 'germination';
    var model = plantModel(species, stage, Math.round(pos.x * 100 + pos.z * 7 + 1000), opts.fit);
    var base = 1;
    var holder = group([pos.x, pos.y, pos.z]);         // (in the yard, in yard metres: p.pos is where it stands on the farm)
    holder.add(model);
    model.scale.setScalar(base);
    holder.rotation.y = rr(0, TAU);
    YARD.add(holder);
    var soil = mesh(new THREE.CircleGeometry(0.38, 14), new THREE.MeshBasicMaterial({ color: 0x3b2716, transparent: true, opacity: 0 }));
    soil.rotation.x = -PI / 2; soil.position.set(pos.x, pos.y + 0.011, pos.z);
    YARD.add(soil);
    var p = { species: species, pos: YV(pos), lpos: pos, holder: holder, model: model, base: base, name: name, where: where,
              ripe: !young && stage !== 'seedling' && stage !== 'harvested' && stage !== 'archived', ripeK: 1, regrowAt: 0, claimed: null,
              wateredAt: -999, perk: 0, soil: soil, color: model.userData.color || LEAF3, height: (model.userData.height || 0.6) * YS };
    // not watered for 3+ days (a whole-garden watering counts): droops, and gets watered first
    var info = opts.info;
    if (info && info.dry >= 3 && !young && stage !== 'harvested' && stage !== 'archived' && where !== 'greenhouse') {
      p.thirsty = true;
      p.drop = new THREE.Sprite(DROP_ICON);
      p.drop.scale.setScalar(0.42 * 1.3);
      p.drop.position.set(p.pos.x, p.pos.y + Math.min(2.2 * YS, p.height) + 0.45, p.pos.z);
      scene.add(p.drop);
    }
    if (name) {
      var sign = signMesh(name);
      sign.position.set(pos.x + 0.62, pos.y, pos.z + 0.28);
      sign.rotation.y = 0.25;
      YARD.add(sign);
    }
    plants.push(p);
    return p;
  }

  // ---------------------------------------------------------------- planting field
  var FIELD = { xs: [12.2, 14.2, 16.2, 18.2], z0: -5.4, n: 6, step: 1.45 };
  var spots = [];
  (function () {
    FIELD.xs.forEach(function (x) {
      var len = FIELD.n * FIELD.step + 0.6;
      var row = mesh(new THREE.CylinderGeometry(0.5, 0.5, len, 16, 1, false, -PI / 2, PI), '#6e4a2c', [x, 0, FIELD.z0 - (FIELD.n - 1) * FIELD.step / 2]);
      row.rotation.x = -PI / 2;
      row.scale.set(1, 1, 0.42);
      statics.add(row);
      for (var k = 0; k < FIELD.n; k++) spots.push({ pos: YV(V(x, 0.19, FIELD.z0 - k * FIELD.step)), state: 'empty', claimed: null, plant: null, t0: 0 });
    });
    var fs = signMesh('Planting field'); fs.position.set(15.2, 0, -4.1); statics.add(fs);
  })();

  // ---------------------------------------------------------------- the garden from the map
  // When the garden map (/map) has areas drawn, the bed area behind the lane
  // is built from it instead of the default beds: beds in their real shapes
  // with each plant where it was pinned, worm beds (busier the more they were
  // fed this month), compost, greenhouse, pond, orchard, lawn, wildflowers,
  // walkways, fences, irrigation lines, taps, hives, trees, the Nevet node...
  // all turned and scaled to fit. Unpinned plants fill the beds, then pots.
  var MAP_OBST = [], MAP_TAPS = [], mapWorms = [], mapBees = [], mapLeds = [], PINNED = {};
  var REGION = { x0: -11, x1: 10, z0: -19.6, z1: -6.6 };
  var GARDEN_CENTRE = MAPG ? V((REGION.x0 + REGION.x1) / 2, 0.6, (REGION.z0 + REGION.z1) / 2 + 1.5) : V(-1, 0.6, -7);
  function shapeOf(pts) {
    var sh = new THREE.Shape();
    pts.forEach(function (p, i) { if (i) sh.lineTo(p[0], -p[1]); else sh.moveTo(p[0], -p[1]); });
    return sh;
  }
  function flatPoly(pts, color, y) {                   // a coloured patch of ground
    var g = new THREE.ShapeGeometry(shapeOf(pts)); g.rotateX(-PI / 2);
    var m = mesh(g, color); m.position.y = y; statics.add(m); return m;
  }
  function slabPoly(pts, h, color, y0) {               // the polygon raised into a block (bed soil, compost)
    var g = new THREE.ExtrudeGeometry(shapeOf(pts), { depth: h, bevelEnabled: false }); g.rotateX(-PI / 2);
    var m = mesh(g, color); m.position.y = y0 || 0; statics.add(m); return m;
  }
  function polyEdges(pts, h, t, color, y0) {           // a wall along every edge (bed boards, stone edging)
    for (var i = 0; i < pts.length; i++) {
      var a = pts[i], b = pts[(i + 1) % pts.length], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
      if (L < 0.05) continue;
      var w = box(L + t, h, t, color, [(a[0] + b[0]) / 2, (y0 || 0) + h / 2, (a[1] + b[1]) / 2]);
      w.rotation.y = -Math.atan2(dz, dx);
      statics.add(outline(w));
    }
  }
  function polyCentre(pts) {
    var a = 0, cx = 0, cz = 0;
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i], q = pts[(i + 1) % pts.length], k = p[0] * q[1] - q[0] * p[1];
      a += k; cx += (p[0] + q[0]) * k; cz += (p[1] + q[1]) * k;
    }
    if (Math.abs(a) < 1e-6) return pts.reduce(function (s, p) { return [s[0] + p[0] / pts.length, s[1] + p[1] / pts.length]; }, [0, 0]);
    return [cx / (3 * a), cz / (3 * a)];
  }
  function polyBox(pts) {
    var b = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
    pts.forEach(function (p) { b.x0 = Math.min(b.x0, p[0]); b.x1 = Math.max(b.x1, p[0]); b.z0 = Math.min(b.z0, p[1]); b.z1 = Math.max(b.z1, p[1]); });
    return b;
  }
  function randomIn(pts, rnd, margin) {                // a random point inside the polygon (keeping off its edges)
    var b = polyBox(pts);
    for (var t = 0; t < 40; t++) {
      var x = b.x0 + rnd() * (b.x1 - b.x0), z = b.z0 + rnd() * (b.z1 - b.z0);
      if (pointInPoly(x, z, pts) && polyDist(x, z, pts) >= (margin || 0)) return [x, z];
    }
    return null;
  }
  function minRect(pts) {                              // smallest rectangle around the polygon (greenhouses)
    var best = null;
    for (var i = 0; i < pts.length; i++) {
      var a = pts[i], b = pts[(i + 1) % pts.length], ang = Math.atan2(b[1] - a[1], b[0] - a[0]), c = Math.cos(ang), s = Math.sin(ang);
      var u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
      pts.forEach(function (p) { var u = p[0] * c + p[1] * s, v = -p[0] * s + p[1] * c; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); });
      var area = (u1 - u0) * (v1 - v0);
      if (!best || area < best.area) {
        var cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
        best = { area: area, x: cu * c - cv * s, z: cu * s + cv * c, w: u1 - u0, d: v1 - v0, ang: ang };
      }
    }
    return best;
  }
  function areaSign(text, pts) {                       // a name sign at the front of an area
    var front = pts.reduce(function (m, p) { return p[1] > m[1] ? p : m; }, pts[0]), c = polyCentre(pts);
    var sg = signMesh(text, 24);
    sg.position.set(front[0] + (c[0] - front[0]) * 0.15, 0, front[1] + 0.35);
    statics.add(sg);
  }
  function wormMesh(rnd) {                             // a little wiggly worm
    var pts = [], a = rnd() * TAU;
    for (var k = 0; k < 5; k++) pts.push(V(Math.cos(a) * k * 0.07 + Math.sin(k * 1.9) * 0.03, 0, Math.sin(a) * k * 0.07 + Math.cos(k * 1.7) * 0.03));
    return mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, 0.028, 5, false), rnd() < 0.5 ? '#e58fa0' : '#d77a8c');
  }
  function treeAt(x, z, k) {
    var t = group([x, 0, z]), hgt = 1.6 * k;
    t.add(cyl(0.16 * k, 0.24 * k, hgt, '#7a5233', [0, hgt / 2, 0], 8));
    [[0, hgt + 0.8 * k, 0, 1.05], [0.6, hgt + 0.45 * k, 0.15, 0.75], [-0.55, hgt + 0.5 * k, -0.2, 0.8], [0.05, hgt + 1.35 * k, 0.1, 0.7]].forEach(function (c, i) {
      t.add(sphere(c[3] * k, ['#4f9a3e', '#5fae48', '#3f8a34'][i % 3], [c[0] * k, c[1], c[2] * k], null, 10));
    });
    statics.add(outline(t, 1.025));
    statics.add(blobShadow(1.3 * k, x, z));
    MAP_OBST.push(['c', x, z, 0.35 * k]);
  }
  function wormBinAt(x, z, info) {
    ANIMALS.push({ kind: 'worms', pos: YV(V(x, 0, z)), name: info.name || 'Worm bin', r: 1.2 * YS });
    var bg = group([x, 0, z]);
    bg.add(box(1.2, 0.8, 1.0, '#9c6b3c', [0, 0.4, 0]));
    bg.add(box(1.3, 0.1, 1.1, '#7a5233', [0, 0.85, 0]));
    bg.add(box(1.1, 0.06, 0.06, '#7a5233', [0, 0.5, 0.52]));
    var n = Math.min(5, 1 + (info.fed || 0)), r = rng(info.id || 7);
    for (var i = 0; i < n; i++) {
      var worm = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.035, 6, 12, PI), mat('#e58fa0'));
      worm.position.set(-0.35 + r() * 0.7, 0.92, -0.3 + r() * 0.6); worm.rotation.y = r() * TAU; worm.userData.wiggle = i + (info.id || 0);
      bg.add(worm);
      WORMS.push(worm); movers.add(worm);
    }
    statics.add(outline(bg));
    var sg = signMesh(info.name); sg.position.set(x + 0.7, 0, z + 0.6); statics.add(sg);
    MAP_OBST.push(['r', x, z, 0.65, 0.55, 0]);
  }
  function buildMapGarden() {
    var feats = (MAPG.features || []).filter(function (f) {
      return f.pts && f.pts.length >= (f.kind === 'area' ? 3 : f.kind === 'path' ? 2 : 1);
    });
    // fit: turn the garden a quarter if its long side then runs along the farm
    var xs = [], zs = [];
    feats.forEach(function (f) { f.pts.forEach(function (p) { xs.push(p[0]); zs.push(p[1]); }); });
    var mx0 = Math.min.apply(null, xs), mx1 = Math.max.apply(null, xs), mz0 = Math.min.apply(null, zs), mz1 = Math.max.apply(null, zs);
    var w = Math.max(1, mx1 - mx0), d = Math.max(1, mz1 - mz0), RW = REGION.x1 - REGION.x0, RD = REGION.z1 - REGION.z0;
    var s0 = Math.min(RW / w, RD / d), s1 = Math.min(RW / d, RD / w), turn = s1 > s0 * 1.15;
    var s = Math.min(1.6, turn ? s1 : s0), cx = (mx0 + mx1) / 2, cz = (mz0 + mz1) / 2;
    var rx = (REGION.x0 + REGION.x1) / 2, rz = (REGION.z0 + REGION.z1) / 2;
    function T(p) { var x = p[0] - cx, z = p[1] - cz; if (turn) { var t = x; x = -z; z = t; } return [rx + x * s, rz + z * s]; }
    var plantK = Math.max(0.55, Math.min(1, s));        // plants shrink a little in a big garden squeezed onto the farm
    var rnd = rng(4242), beds = [], houses = [];
    var areas = feats.filter(function (f) { return f.kind === 'area'; }).sort(function (a, b) { return (b.area_m2 || 0) - (a.area_m2 || 0); });
    areas.forEach(function (f, i) {
      var pts = f.pts.map(T), y = 0.014 + i * 0.0015, c = polyCentre(pts), k;
      switch (f.category) {
        case 'bed': case 'herbs': {
          var herbs = f.category === 'herbs', top = herbs ? 0.26 : 0.42;
          slabPoly(pts, top - 0.02, '#5b3d27');
          polyEdges(pts, top + 0.04, 0.14, herbs ? '#a3a39b' : '#a8743f');
          if (!herbs) pts.forEach(function (p) { statics.add(outline(box(0.2, top + 0.12, 0.2, '#8a5f3a', [p[0], (top + 0.12) / 2, p[1]]))); });
          beds.push({ pts: pts, y: top });
          MAP_OBST.push(['p', pts]);
          if (f.name) areaSign(f.name, pts);
          break;
        }
        case 'worm_bed': {                              // a long worm trough: the more feedings this month, the busier
          (function () {
            var cc = polyCentre(pts);
            ANIMALS.push({ kind: 'worms', pos: YV(V(cc[0], 0, cc[1])), name: f.name || 'Worm bed', r: 1.0 * YS, around: pts.map(function (q) { return [yx(q[0]), yz(q[1])]; }) });
          })();
          slabPoly(pts, 0.36, '#3b2a1e');
          polyEdges(pts, 0.44, 0.16, '#8a5f3a');
          var nw = Math.min(28, 6 + 2 * (D.monthFeedings || 0));
          for (k = 0; k < nw; k++) {
            var at = randomIn(pts, rnd, 0.2); if (!at) continue;
            var wm = wormMesh(rnd); wm.position.set(at[0], 0.37, at[1]); wm.userData.ph = rnd() * TAU;
            YARD.add(wm); mapWorms.push(wm);
          }
          for (k = 0; k < 10; k++) {
            var sc = randomIn(pts, rnd, 0.15); if (!sc) continue;
            var bit = box(0.14, 0.03, 0.1, ['#f08a24', '#7cc35a', '#f3ecdf', '#c9a26b', '#e8d04a'][k % 5], [sc[0], 0.375, sc[1]]); bit.rotation.y = rnd() * 3;
            statics.add(bit);
          }
          MAP_OBST.push(['p', pts]);
          var fed = D.monthFeedings || 0;
          areaSign((f.name || 'Worm bed') + (fed ? ' · fed ' + fed + '×' : ''), pts);
          break;
        }
        case 'greenhouse': {
          var r = minRect(pts), gw = Math.max(1.6, r.w), gd = Math.max(1.4, r.d), H = 2.1;
          var g = group([r.x, 0, r.z], -r.ang);
          var glass = new THREE.MeshToonMaterial({ color: 0xbfe6f0, transparent: true, opacity: 0.3, depthWrite: false });
          g.add(mesh(new THREE.BoxGeometry(gw, H, gd), glass, [0, H / 2, 0]));
          var roof = new THREE.Shape(); roof.moveTo(-gd / 2, 0); roof.lineTo(0, 0.9); roof.lineTo(gd / 2, 0); roof.lineTo(-gd / 2, 0);
          var rg = new THREE.ExtrudeGeometry(roof, { depth: gw, bevelEnabled: false }); rg.translate(0, 0, -gw / 2); rg.rotateY(PI / 2);
          g.add(mesh(rg, glass, [0, H, 0]));
          [-1, 1].forEach(function (sx) { [-1, 1].forEach(function (sz) { g.add(box(0.08, H, 0.08, '#e9f0ec', [sx * gw / 2, H / 2, sz * gd / 2])); }); });
          g.add(box(gw, 0.08, 0.08, '#e9f0ec', [0, H + 0.9, 0]));
          [-1, 1].forEach(function (sz) { g.add(box(gw, 0.08, 0.08, '#e9f0ec', [0, H, sz * gd / 2])); });
          statics.add(g);
          houses.push(pts);
          MAP_OBST.push(['r', r.x, r.z, gw / 2, gd / 2, -r.ang]);
          if (f.name) areaSign(f.name, pts);
          break;
        }
        case 'water': {
          var rim = pts.map(function (p) { var dx = p[0] - c[0], dz = p[1] - c[1], L = Math.hypot(dx, dz) || 1; return [p[0] + dx / L * 0.25, p[1] + dz / L * 0.25]; });
          flatPoly(rim, '#a19a8a', 0.02);
          flatPoly(pts, '#6fb3e0', 0.035);
          for (k = 0; k < 5; k++) { var lp = randomIn(pts, rnd, 0.4); if (lp) { var pad = mesh(new THREE.CircleGeometry(0.22, 10), '#5c9e48', [lp[0], 0.045, lp[1]]); pad.rotation.x = -PI / 2; statics.add(pad); } }
          pts.forEach(function (p, j) { if (j % 2) return; for (var q = 0; q < 3; q++) statics.add(cone(0.035, 0.7 + q * 0.15, '#6f9a3c', [p[0] + (q - 1) * 0.12, 0.38 + q * 0.07, p[1]], 5)); });
          MAP_OBST.push(['p', pts]);
          if (f.name) areaSign(f.name, rim);
          break;
        }
        case 'compost':
          flatPoly(pts, '#8a6a4a', y);
          for (k = 0; k < Math.max(1, Math.min(3, Math.round((f.area_m2 || 4) / 6))); k++) {
            var hp = k ? randomIn(pts, rnd, 0.6) : c; if (!hp) continue;
            statics.add(outline(sphere(0.7, '#6b4a2f', [hp[0], 0.05, hp[1]], [1, 0.55, 1], 10)));
            statics.add(sphere(0.12, '#7cc35a', [hp[0] + 0.2, 0.38, hp[1] + 0.1], null, 6));
            MAP_OBST.push(['c', hp[0], hp[1], 0.7]);
          }
          if (f.name) areaSign(f.name, pts);
          break;
        case 'orchard': flatPoly(pts, '#7fb35e', y); houses.orchards = (houses.orchards || []).concat([pts]); if (f.name) areaSign(f.name, pts); break;
        case 'lawn': flatPoly(pts, '#a9d684', y); break;
        case 'wild':
          flatPoly(pts, '#93c26b', y);
          for (k = 0; k < Math.min(60, 8 + (f.area_m2 || 4) * 2); k++) {
            var wp = randomIn(pts, rnd, 0.1); if (!wp) continue;
            statics.add(cone(0.05, 0.3 + rnd() * 0.2, '#5f9e46', [wp[0], 0.18, wp[1]], 4));
            if (k % 2) statics.add(sphere(0.07, ['#f29bc0', '#f6d743', '#c9a7f2', '#ffffff', '#ff8a65'][k % 5], [wp[0] + 0.05, 0.42, wp[1]], null, 6));
          }
          break;
        case 'seating':
          flatPoly(pts, '#d8c497', y);
          var bench = group([c[0], 0, c[1]]);
          bench.add(box(1.4, 0.08, 0.45, '#a8743f', [0, 0.45, 0])); bench.add(box(1.4, 0.4, 0.08, '#a8743f', [0, 0.7, -0.22]));
          [-0.6, 0.6].forEach(function (bx) { bench.add(box(0.08, 0.45, 0.4, '#7a5233', [bx, 0.22, 0])); });
          statics.add(outline(bench));
          statics.add(cyl(0.04, 0.04, 2.2, '#eee', [c[0] + 1.0, 1.1, c[1] + 0.5], 6));
          statics.add(cone(1.1, 0.5, '#e8664a', [c[0] + 1.0, 2.25, c[1] + 0.5], 8));
          MAP_OBST.push(['r', c[0], c[1], 0.75, 0.3, 0]);
          if (f.name) areaSign(f.name, pts);
          break;
        default:
          flatPoly(pts, new THREE.Color(f.color || '#8fbf6a').lerp(new THREE.Color('#8cc76a'), 0.5).getStyle(), y);
          if (f.name) areaSign(f.name, pts);
      }
    });
    // lines: walkways, fences, irrigation
    feats.filter(function (f) { return f.kind === 'path'; }).forEach(function (f) {
      var pts = f.pts.map(T), i, a, b, L, ang;
      if (f.category === 'fence') {
        for (i = 0; i < pts.length - 1; i++) {
          a = pts[i]; b = pts[i + 1]; L = Math.hypot(b[0] - a[0], b[1] - a[1]); ang = -Math.atan2(b[1] - a[1], b[0] - a[0]);
          var n = Math.max(1, Math.ceil(L / 1.3));
          for (var k = 0; k <= n; k++) statics.add(box(0.14, 1.0, 0.14, '#8a5f3a', [a[0] + (b[0] - a[0]) * k / n, 0.5, a[1] + (b[1] - a[1]) * k / n]));
          [0.4, 0.78].forEach(function (y) { var rl = box(L, 0.09, 0.06, '#b98b5a', [(a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2]); rl.rotation.y = ang; statics.add(rl); });
          MAP_OBST.push(['r', (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, L / 2, 0.08, ang]);
        }
      } else if (f.category === 'irrigation') {
        var curve = pts.map(function (p) { return V(p[0], 0.06, p[1]); });
        for (i = 0; i < curve.length - 1; i++) {
          var seg = cyl(0.035, 0.035, curve[i].distanceTo(curve[i + 1]), '#2f3b45', [(curve[i].x + curve[i + 1].x) / 2, 0.06, (curve[i].z + curve[i + 1].z) / 2], 6);
          seg.rotation.order = 'YXZ'; seg.rotation.set(PI / 2, -Math.atan2(curve[i + 1].z - curve[i].z, curve[i + 1].x - curve[i].x) + PI / 2, 0);
          statics.add(seg);
          var segL = curve[i].distanceTo(curve[i + 1]);
          for (var e = 0.35; e < segL; e += 0.7) statics.add(sphere(0.05, '#3d85c6', [curve[i].x + (curve[i + 1].x - curve[i].x) * e / segL, 0.1, curve[i].z + (curve[i + 1].z - curve[i].z) * e / segL], null, 6));
        }
      } else {
        var width = f.category === 'path' ? 1.0 : 0.35, col = f.category === 'path' ? '#d2bb8c' : '#bfae8a';
        for (i = 0; i < pts.length - 1; i++) {
          a = pts[i]; b = pts[i + 1]; L = Math.hypot(b[0] - a[0], b[1] - a[1]);
          var strip = mesh(new THREE.PlaneGeometry(L, width), col, [(a[0] + b[0]) / 2, 0.03, (a[1] + b[1]) / 2]);
          strip.rotation.order = 'YXZ'; strip.rotation.set(-PI / 2, -Math.atan2(b[1] - a[1], b[0] - a[0]), 0);
          statics.add(strip);
        }
        pts.forEach(function (p) { var dot = mesh(new THREE.CircleGeometry(width / 2, 12), col, [p[0], 0.03, p[1]]); dot.rotation.x = -PI / 2; statics.add(dot); });
      }
    });
    // points: taps, hives, trees, the Nevet node...
    feats.filter(function (f) { return f.kind === 'point'; }).forEach(function (f) {
      var p = T(f.pts[0]), x = p[0], z = p[1], g = group([x, 0, z]);
      switch (f.category) {
        case 'tap':
          g.add(box(0.12, 0.9, 0.12, '#8a8f94', [0, 0.45, 0]));
          g.add(rot(cyl(0.04, 0.04, 0.22, '#c0c4c8', [0, 0.8, 0.1], 6), PI / 2));
          g.add(cyl(0.07, 0.07, 0.04, '#d9534f', [0, 0.9, 0.12], 8));
          g.add(cyl(0.3, 0.26, 0.12, '#9a9a96', [0, 0.06, 0.25], 12));
          MAP_TAPS.push(YV(V(x, 0, z)));
          MAP_OBST.push(['c', x, z + 0.15, 0.3]);
          break;
        case 'compost':
          g.add(sphere(0.55, '#6b4a2f', [0, 0.05, 0], [1, 0.6, 1], 10)); g.add(sphere(0.1, '#7cc35a', [0.15, 0.33, 0.1], null, 6));
          MAP_OBST.push(['c', x, z, 0.55]);
          break;
        case 'tree': treeAt(x, z, 0.85); return;
        case 'tools':
          g.add(box(1.1, 1.25, 0.9, '#9c6b3c', [0, 0.62, 0]));
          g.add(rot(box(1.3, 0.08, 1.1, '#6b3a2e', [0, 1.33, 0]), 0.18));
          g.add(box(0.5, 0.95, 0.04, '#7a5233', [0, 0.48, 0.46]));
          MAP_OBST.push(['r', x, z, 0.6, 0.5, 0]);
          break;
        case 'seat':
          g.add(box(1.3, 0.08, 0.42, '#a8743f', [0, 0.45, 0])); g.add(box(1.3, 0.36, 0.07, '#a8743f', [0, 0.7, -0.2]));
          [-0.55, 0.55].forEach(function (bx) { g.add(box(0.08, 0.45, 0.38, '#7a5233', [bx, 0.22, 0])); });
          MAP_OBST.push(['r', x, z, 0.7, 0.25, 0]);
          break;
        case 'hive':
          ANIMALS.push({ kind: 'bees', pos: YV(V(x, 0, z)), name: f.name || 'Beehive', r: 1.5 * YS });
          if (NP) { var hv = NP.build('bees', 'mature'); hv.scale.setScalar(1.8); g.add(hv); }
          else g.add(box(0.7, 0.9, 0.6, '#f2c94c', [0, 0.45, 0]));
          for (var b = 0; b < 5; b++) { var bee = sphere(0.05, '#f2c230', [0, 0, 0], [1.4, 1, 1], 6); bee.userData = { c: V(x, 0.9, z), ph: b * 1.3, r: 0.5 + b * 0.12 }; YARD.add(bee); mapBees.push(bee); }
          MAP_OBST.push(['c', x, z, 0.5]);
          break;
        case 'rain':
          g.add(cyl(0.36, 0.36, 0.9, '#3d6f9e', [0, 0.45, 0], 14)); g.add(cyl(0.38, 0.38, 0.05, '#2f5577', [0, 0.92, 0], 14));
          g.add(cyl(0.05, 0.05, 1.4, '#8a8f94', [0.3, 1.4, 0], 6));
          MAP_OBST.push(['c', x, z, 0.4]);
          break;
        case 'gate':
          [-0.9, 0.9].forEach(function (gx) { g.add(box(0.18, 2.2, 0.18, '#8a5f3a', [gx, 1.1, 0])); });
          g.add(box(2.1, 0.18, 0.2, '#8a5f3a', [0, 2.2, 0]));
          MAP_OBST.push(['c', x - 0.9, z, 0.12]); MAP_OBST.push(['c', x + 0.9, z, 0.12]);
          break;
        case 'node': {                                  // the Nevet node: a Pi in a box on a pole, with its camera
          g.add(cyl(0.05, 0.06, 1.7, '#8a8f94', [0, 0.85, 0], 8));
          g.add(box(0.36, 0.26, 0.18, '#f4f6f2', [0, 1.55, 0.06]));
          g.add(box(0.37, 0.05, 0.19, '#4c9a5b', [0, 1.7, 0.06]));
          var lens = rot(cyl(0.06, 0.07, 0.12, '#1f2522', [0.08, 1.52, 0.2], 10), PI / 2); g.add(lens);
          g.add(cyl(0.012, 0.012, 0.4, '#555', [-0.14, 1.9, 0.02], 4));
          var panel = box(0.6, 0.03, 0.4, '#2c4a7a', [0, 1.95, -0.15]); panel.rotation.x = 0.5; g.add(panel);
          var led = sphere(0.025, '#7dff6a', [-0.1, 1.6, 0.16], null, 6); led.material = new THREE.MeshBasicMaterial({ color: 0x7dff6a }); g.add(led);
          movers.add(led); mapLeds.push(led);
          g.rotation.y = Math.atan2(GARDEN_CENTRE.x - x, GARDEN_CENTRE.z - z);       // the camera looks over the garden
          var ns = signMesh(f.name || 'Nevet node'); ns.position.set(x + 0.5, 0, z + 0.4); statics.add(ns);
          MAP_OBST.push(['c', x, z, 0.25]);
          break;
        }
        default: { var sn = signMesh(f.name || 'Note'); sn.position.set(x, 0, z); statics.add(sn); return; }
      }
      statics.add(outline(g));
      if (f.name && f.category !== 'node') { var lb = signMesh(f.name); lb.position.set(x + 0.6, 0, z + 0.5); statics.add(lb); }
    });
    // pinned plants and worm bins where they grow
    var byId = {};
    (D.plants || []).forEach(function (q) { byId[q.id] = q; });
    function bedAt(x, z) { for (var i = 0; i < beds.length; i++) if (pointInPoly(x, z, beds[i].pts)) return beds[i]; return null; }
    function inside(list, x, z) { return (list || []).some(function (pts) { return pointInPoly(x, z, pts); }); }
    feats.filter(function (f) { return f.kind === 'asset'; }).forEach(function (f) {
      var info = byId[f.asset_id];
      if (!info || PINNED[info.id]) return;
      var p = T(f.pts[0]);
      PINNED[info.id] = true;
      if (info.type === 'worm_bin') return wormBinAt(p[0], p[1], info);
      var bed = bedAt(p[0], p[1]), tree = NP && (NP.species(info.species) || {}).model === 'tree';
      var where = inside(houses, p[0], p[1]) ? 'greenhouse' : bed ? 'bed' : 'map';
      addPlant(info.species, V(p[0], bed ? bed.y : 0, p[1]), info.stage, info.name, where,
               { fit: tree ? { r: 1.1, h: 2.8 } : { r: 0.5 * plantK, h: 1.7 * plantK }, info: info });
      if (tree) MAP_OBST.push(['c', p[0], p[1], 0.3]);
    });
    // orchards without trees get a few
    (houses.orchards || []).forEach(function (pts) {
      var has = plants.some(function (q) { return pointInPoly(q.lpos.x, q.lpos.z, pts); });
      if (has) return;
      for (var k = 0; k < 3; k++) { var tp = randomIn(pts, rnd, 0.8); if (tp) treeAt(tp[0], tp[1], 0.7); }
    });
    // the rest of the plants fill the beds (taking turns between beds), then pots by the lane
    var slotLists = beds.map(function (b) {
      var bb = polyBox(b.pts), list = [];
      for (var x = bb.x0 + 0.45; x < bb.x1; x += 0.9) for (var z = bb.z0 + 0.45; z < bb.z1; z += 0.9) {
        if (!pointInPoly(x, z, b.pts) || polyDist(x, z, b.pts) < 0.3) continue;
        if (plants.some(function (q) { return Math.hypot(q.lpos.x - x, q.lpos.z - z) < 0.75; })) continue;
        list.push({ x: x, z: z, y: b.y });
      }
      return list;
    });
    var slots = [];
    for (var round = 0; slotLists.some(function (l) { return l.length > round; }); round++) slotLists.forEach(function (l) { if (l[round]) slots.push(l[round]); });
    var rest = (D.plants || []).filter(function (q) { return q.type !== 'worm_bin' && !PINNED[q.id]; }), pots = 0;
    rest.forEach(function (info) {
      var sl = slots.shift(), opts = { fit: { r: 0.45 * plantK, h: 1.6 * plantK }, info: info };
      if (sl) { addPlant(info.species, V(sl.x, sl.y, sl.z), info.stage, info.name, 'bed', opts); return; }
      if (pots >= 16) return;
      var px = REGION.x0 + 0.7 + (pots % 16) * 1.1, pz = REGION.z1 + 0.35;
      statics.add(outline(cyl(0.3, 0.22, 0.36, '#c96f42', [px, 0.18, pz], 12)));
      statics.add(cyl(0.27, 0.27, 0.02, '#5a3d27', [px, 0.35, pz], 12));
      MAP_OBST.push(['c', px, pz, 0.3]);
      opts.fit = { r: 0.4, h: 1.3 };
      addPlant(info.species, V(px, 0.36, pz), info.stage, null, 'pot', opts);
      pots++;
    });
  }
  if (MAPG) buildMapGarden();

  // The chalkboard in the yard: this week's real numbers
  (function () {
    var wk = D.week || {};
    var c = document.createElement('canvas'); c.width = 512; c.height = 360;
    var g = c.getContext('2d');
    g.fillStyle = '#2f4a3a'; g.fillRect(0, 0, 512, 360);
    g.strokeStyle = '#8a5f3a'; g.lineWidth = 22; g.strokeRect(0, 0, 512, 360);
    g.fillStyle = '#f4f1e8'; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.font = 'bold 38px "Comic Sans MS", "Chalkboard SE", "Segoe Print", cursive, sans-serif';
    g.fillText('This week at Nevet', 34, 52);
    g.font = '30px "Comic Sans MS", "Chalkboard SE", "Segoe Print", cursive, sans-serif';
    var lines = [
      (wk.actions || 0) + ' actions' + (wk.heroes ? ' by ' + wk.heroes + ' hero' + (wk.heroes === 1 ? '' : 'es') : ''),
      (wk.harvests || 0) + ' harvest' + (wk.harvests === 1 ? '' : 's') + (wk.kg ? ' · ' + wk.kg + ' kg' : ''),
      (wk.waterings || 0) + ' watering' + (wk.waterings === 1 ? '' : 's'),
      (wk.feedings || 0) + ' worm feeding' + (wk.feedings === 1 ? '' : 's'),
      (wk.growing || 0) + ' plants growing'
    ];
    lines.forEach(function (t, i) { g.fillText('• ' + t, 40, 110 + i * 48); });
    var board = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.34), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), side: THREE.DoubleSide }));
    var easel = group([-6.6, 0, 5.0], 0.55);
    board.position.set(0, 1.45, 0.06); board.rotation.x = -0.12;
    easel.add(board);
    [-0.8, 0.8].forEach(function (x) { easel.add(rot(box(0.08, 2.1, 0.08, '#8a5f3a', [x, 1.0, 0.1]), -0.08)); });
    easel.add(rot(box(0.08, 2.0, 0.08, '#8a5f3a', [0, 0.95, -0.45]), 0.3));
    easel.add(box(1.9, 0.07, 0.12, '#8a5f3a', [0, 0.72, 0.18]));
    statics.add(easel);
    CHALK = { x: yx(-6.6), z: yz(5.0) };
  })();

  // ---------------------------------------------------------------- buildings

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
    var cx = POND.x, cz = POND.z;
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
      duck.userData = { cx: yx(cx), cz: yz(cz), r: (1.6 + dk * 0.9) * YS, speed: 0.22 + dk * 0.08, ph: dk * 2.4 };   // (they swim on the farm)
      duck.scale.setScalar(YS);
      ducks.push(duck);
      scene.add(duck);
    }
  })();
  var POND_W = { x: yx(POND.x), z: yz(POND.z) };       // the pond on the farm

  // ---------------------------------------------------------------- trees and the land around the farm (by setting)
  var WORLD_ANIM = [];                                 // little things that move (boats, gulls, tumbleweeds, the lighthouse...)
  // the trees on the farm (heroes walk round them): two in the yard, some in the meadows, and the rows between the areas
  statics = FARM_STATICS;
  var INNER_TREES = [[yx(9), yz(9.5)], [yx(-18), yz(-16)],                        // two in the yard, and the farm's corners
                     [-61, 31], [61, 31], [-61, 59.6], [61, 59.6], [-61, 113.4], [61, 113.4], [-61.2, -39.2], [61.2, -39.2]];
  DIVIDE_TREES.forEach(function (t) { if (INNER_TREES.every(function (o) { return Math.hypot(o[0] - t[0], o[1] - t[1]) > 4.5; })) INNER_TREES.push(t); });
  var EXTRA_OBST = [];                                 // more things heroes walk round (the oasis palms)
  if (window.NevetWorlds) NevetWorlds.build({
    group: group, cyl: cyl, box: box, sphere: sphere, cone: cone, mesh: mesh, mat: mat, rot: rot, outline: outline, blobShadow: blobShadow,
    statics: statics, scene: scene, movers: movers, hillH: hillH, rng: rng, R: R, rr: rr, V: V, SEA_Y: SEA_Y, PLAY: PLAY, BOX: BOX, world: WORLD,
    WORLD_ANIM: WORLD_ANIM, EXTRA_OBST: EXTRA_OBST, INNER_TREES: INNER_TREES, textCanvas: textCanvas, merge: NevetHero.merge
  });

  // Harvest cart, hay bales, hand pump, scarecrow, compost / worm bins (in the yard again)
  statics = YARD;
  var BARN_BINS = (D.plants || []).filter(function (q) { return q.type === 'worm_bin' && !PINNED[q.id]; }).slice(0, 4);
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
      YARD.add(c);
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
    var sc = group(MAPG ? [15.2, 0, -14.6] : [1, 0, -15]);        // with a map garden it guards the planting field
    sc.add(cyl(0.06, 0.06, 2.4, '#7a5233', [0, 1.2, 0], 6));
    sc.add(box(1.8, 0.1, 0.1, '#7a5233', [0, 1.75, 0]));
    sc.add(cyl(0.32, 0.38, 0.9, '#5d82b8', [0, 1.55, 0], 10));
    sc.add(sphere(0.3, '#e6cf8f', [0, 2.3, 0]));
    sc.add(cyl(0.6, 0.6, 0.05, '#dcb65e', [0, 2.5, 0], 16)); sc.add(cyl(0.28, 0.32, 0.3, '#dcb65e', [0, 2.65, 0], 12));
    [-0.85, 0.85].forEach(function (x) { sc.add(sphere(0.12, '#e1c25f', [x, 1.75, 0], [1.3, 0.8, 0.8])); });
    statics.add(outline(sc));
    // compost and the garden's worm bins
    var bins = BARN_BINS;
    if (!bins.length && !MAPG) bins = [{ name: 'Compost' }];
    bins.slice(0, 4).forEach(function (b, i) {
      var bg = group([-11.2 + (i % 2) * 1.6, 0, 1.2 + Math.floor(i / 2) * 1.6]);
      ANIMALS.push({ kind: 'worms', pos: YV(bg.position), name: b.name || 'Worm bin', r: 1.15 * YS });
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
  statics = FARM_STATICS;                              // (the yard is built: from here on the cart and the pump are where they stand on the farm)
  CART = YV(CART); PUMP = YV(PUMP);

  // ---------------------------------------------------------------- the farming lands
  // Round the mud pit and the dance field: the orchard (with the mother tree) and the market garden beside the yard,
  // the sunflowers and the vineyard beside the dance field, the beehives and the pumpkin patch beside the play park,
  // and the wheat, the corn and the hay barn furthest south (see FIELDS). The crops are instanced (one draw call each)
  // and sway in the wind in the vertex shader; the hedges between them are in 'hedges and trees between the areas'.
  var FIELD_OBST = [];                                 // what heroes walk round: ['c', x, z, r] / ['r', x, z, hw, hd, rotY]
  var SWAY_T = { value: 0 };                           // the wind's clock (the crops' vertex shader)
  WORLD_ANIM.push(function (now) { SWAY_T.value = now; });
  (function () {
    function F(kind) { return FIELDS.filter(function (f) { return f[0] === kind; })[0]; }
    function fieldRect(f, pad) { FIELD_OBST.push(['r', (f[1] + f[2]) / 2, (f[3] + f[4]) / 2, (f[2] - f[1]) / 2 + (pad || 0), (f[4] - f[3]) / 2 + (pad || 0), 0]); }
    function patch(f, color, inset, y) {               // the field's ground (soil, stubble, a meadow)
      inset = inset || 0;
      var pm = mesh(new THREE.PlaneGeometry(f[2] - f[1] - 2 * inset, f[4] - f[3] - 2 * inset), color);
      pm.rotation.x = -PI / 2; pm.position.set((f[1] + f[2]) / 2, y || 0.006, (f[3] + f[4]) / 2);
      statics.add(pm);
    }
    function bigSign(text, x, z, rotY) {               // a field's name board, on two posts
      var c = textCanvas(text, { px: 46, bg: '#f3e6c8', color: '#4a321c', radius: 12, pad: 24, stroke: '#8a5f3a' });
      var w = 0.62 * c.width / c.height, g = group([x, 0, z], rotY || 0);
      [-1, 1].forEach(function (s) { g.add(cyl(0.06, 0.07, 1.75, '#8a5f3a', [s * (w / 2 - 0.12), 0.87, 0], 6)); });
      var board = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.62), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), side: THREE.DoubleSide }));
      board.position.set(0, 1.45, 0.07); g.add(board);
      statics.add(g);
    }
    var UP = V(0, 1, 0), m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), sv = V(1, 1, 1), pv = V(0, 0, 0), cc = new THREE.Color();
    function instanced(geo, material, list, colorOf) { // list: [x, y, z, rotY, scale or [sx, sy, sz]]
      var im = new THREE.InstancedMesh(geo, material, Math.max(1, list.length));
      list.forEach(function (it, i) {
        qq.setFromAxisAngle(UP, it[3] || 0);
        var s = it[4] === undefined ? 1 : it[4];
        if (Array.isArray(s)) sv.set(s[0], s[1], s[2]); else sv.setScalar(s);
        m4.compose(pv.set(it[0], it[1], it[2]), qq, sv); im.setMatrixAt(i, m4);
        if (colorOf) im.setColorAt(i, cc.set(colorOf(it, i)));
      });
      im.count = list.length;
      scene.add(im);
      return im;
    }
    function mergeGeos(parts) {                        // [[geometry, x, y, z, rotX, rotY, rotZ, sx, sy, sz]] -> one geometry
      var P = [], N = [], mm = new THREE.Matrix4(), e = new THREE.Euler(), v = V(0, 0, 0), nm = new THREE.Matrix3();
      parts.forEach(function (p) {
        var g = p[0].index ? p[0].toNonIndexed() : p[0];
        e.set(p[4] || 0, p[5] || 0, p[6] || 0);
        mm.compose(V(p[1], p[2], p[3]), qq.setFromEuler(e), V(p[7] || 1, p[8] || p[7] || 1, p[9] || p[7] || 1));
        nm.getNormalMatrix(mm);
        var pa = g.attributes.position, na = g.attributes.normal;
        for (var i = 0; i < pa.count; i++) {
          v.fromBufferAttribute(pa, i).applyMatrix4(mm); P.push(v.x, v.y, v.z);
          v.fromBufferAttribute(na, i).applyMatrix3(nm).normalize(); N.push(v.x, v.y, v.z);
        }
      });
      var out = new THREE.BufferGeometry();
      out.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      out.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
      return out;
    }
    // crops sway in the wind: a slow wave across the field (on the farm's own x and z, so neighbours sway together)
    function swayCompile(sh) {
      sh.uniforms.uSwayT = SWAY_T;
      sh.vertexShader = 'uniform float uSwayT;\n' + sh.vertexShader.replace('#include <project_vertex>', [
        'vec4 mvPosition = vec4( transformed, 1.0 );',
        '#ifdef USE_INSTANCING',
        'mvPosition = instanceMatrix * mvPosition;',
        '#endif',
        'float swH = max( 0.0, mvPosition.y );',
        'float sw = sin( uSwayT * 1.3 + mvPosition.x * 0.21 + mvPosition.z * 0.13 ) + 0.35 * sin( uSwayT * 2.1 + mvPosition.x * 0.45 );',
        'mvPosition.x += sw * 0.045 * swH; mvPosition.z += sw * 0.03 * swH;',
        'mvPosition = modelViewMatrix * mvPosition;',
        'gl_Position = projectionMatrix * mvPosition;'].join('\n'));
    }
    function swayMat(color) {
      var m = new THREE.MeshToonMaterial({ color: new THREE.Color(color || '#ffffff') });
      if (!calm) m.onBeforeCompile = swayCompile;
      return m;
    }
    var rnd = rng(9090);
    function rj(a) { return (rnd() - 0.5) * 2 * a; }  // a little jitter
    var WHITE = 0xffffff;

    // ---- the orchard and the mother tree's clearing (west of the yard)
    (function () {
      var f = F('orchard');
      patch(f, '#8fc267', 0.6);
      var fruitCols = ['#e0402f', '#f29a2e', '#d8cf3a', '#c7323c'], fruits = [];
      for (var x = f[1] + 2.5, col = 0; x < f[2] - 1.5; x += 5.4, col++) for (var z = f[3] + 2.6, row = 0; z < f[4] - 1.2; z += 5, row++) {
        var tx = x + rj(0.4), tz = z + (col % 2) * 2.5 + rj(0.4);
        if (tz > f[4] - 1.2 || Math.hypot(tx - MOTHER.x, tz - MOTHER.z) < 8.5) continue;     // (the mother tree's clearing)
        var k = 0.85 + rnd() * 0.3, t = group([tx, 0, tz]), hT = 1.5 * k;
        t.add(cyl(0.14 * k, 0.2 * k, hT, '#7a5233', [0, hT / 2, 0], 7));
        t.add(sphere(1.25 * k, col % 2 ? '#4f9a3e' : '#5aa845', [0, hT + 0.75 * k, 0], [1, 0.85, 1], 9));
        t.add(sphere(0.8 * k, '#4a8f3a', [0.55 * k, hT + 0.35 * k, 0.3 * k], null, 8));
        t.add(sphere(0.75 * k, '#5fae48', [-0.5 * k, hT + 0.45 * k, -0.35 * k], null, 8));
        statics.add(outline(t, 1.03));
        statics.add(blobShadow(1.5 * k, tx, tz));
        FIELD_OBST.push(['c', tx, tz, 0.45]);
        var fc = fruitCols[(row + col) % fruitCols.length];
        for (var fi = 0; fi < 7; fi++) {
          var a = rnd() * TAU, el = rnd() * 0.9 - 0.15, rr2 = 1.22 * k;
          fruits.push([tx + Math.cos(a) * Math.cos(el) * rr2, hT + 0.75 * k + Math.sin(el) * rr2 * 0.85, tz + Math.sin(a) * Math.cos(el) * rr2, 0, 1, fc]);
        }
      }
      instanced(new THREE.SphereGeometry(0.13, 7, 5), new THREE.MeshToonMaterial({ color: WHITE }), fruits, function (it) { return it[5]; });
      // fruit crates and a ladder against a tree, by the track
      [[-36.2, 1.6], [-37.3, 1.9], [-36.7, 1.6, 0.44]].forEach(function (c) {
        var cr = box(0.7, 0.42, 0.5, '#b07a44', [c[0], (c[2] || 0) + 0.21, c[1]]);
        statics.add(outline(cr));
        statics.add(sphere(0.2, '#e0402f', [c[0], (c[2] || 0) + 0.42, c[1]], [1.4, 0.45, 1], 7));
      });
      FIELD_OBST.push(['r', -36.7, 1.75, 0.9, 0.4, 0]);
      bigSign('🍎 Orchard', f[2] - 3, f[4] + 1.4, 0.35);
    })();

    // ---- the market garden (east of the yard): rows of vegetables, sprinklers
    (function () {
      var f = F('market');
      patch(f, '#7a5236', 0);
      fieldRect(f, 0.2);
      var rounds = [], talls = [], z, k = 0;
      var ROWS = [['round', '#7cc35a', 0.8], ['round', '#9a3f6a', 0.75], ['tall', '#5ab04a', 0.9], ['round', '#5d8f7e', 1.05], ['tall', '#b9d98a', 1.25], ['round', '#a6d26a', 0.85]];
      for (z = f[3] + 1.2; z < f[4] - 0.8; z += 1.65, k++) {
        statics.add(box(f[2] - f[1] - 1.6, 0.18, 0.8, '#6b452c', [(f[1] + f[2]) / 2, 0.09, z]));     // the ridge
        var R0 = ROWS[k % ROWS.length];
        for (var x = f[1] + 1.3; x < f[2] - 1.1; x += 0.95) (R0[0] === 'round' ? rounds : talls).push([x + rj(0.1), 0.17, z + rj(0.08), rnd() * TAU, R0[2] * (0.85 + rnd() * 0.3), R0[1]]);
      }
      var rg = new THREE.IcosahedronGeometry(0.3, 1); rg.scale(1, 0.62, 1); rg.translate(0, 0.16, 0);
      instanced(rg, swayMat(), rounds, function (it) { return it[5]; });
      var tg = mergeGeos([[new THREE.ConeGeometry(0.07, 0.62, 4), 0, 0.31, 0], [new THREE.ConeGeometry(0.07, 0.55, 4), 0.09, 0.27, 0.04, 0, 0, -0.35],
                          [new THREE.ConeGeometry(0.07, 0.55, 4), -0.08, 0.27, -0.05, 0, 0, 0.35]]);
      instanced(tg, swayMat(), talls, function (it) { return it[5]; });
      // sprinklers that turn and spray
      [[f[1] + 7, (f[3] + f[4]) / 2], [(f[1] + f[2]) / 2 + 3, f[3] + 8], [f[2] - 6, f[4] - 7]].forEach(function (sp, i) {
        statics.add(cyl(0.05, 0.06, 1.1, '#8a8f94', [sp[0], 0.55, sp[1]], 6));
        var head = group([sp[0], 1.12, sp[1]]);
        head.add(rot(cyl(0.03, 0.03, 1.1, '#5c7a8f', [0, 0, 0], 5), 0, 0, PI / 2));
        var spray = new THREE.MeshBasicMaterial({ color: 0x9fdcff, transparent: true, opacity: 0.6, depthWrite: false });
        [-1, 1].forEach(function (s) {
          for (var d = 1; d <= 7; d++) { var t = d / 7; head.add(mesh(new THREE.SphereGeometry(0.06 + t * 0.05, 5, 4), spray, [s * (0.5 + t * 2.6), Math.sin(t * PI * 0.8) * 1.2 - t * 0.3, 0])); }
        });
        if (NevetHero.merge) NevetHero.merge(head, function () { return false; });
        scene.add(head);
        WORLD_ANIM.push(function (now) { head.rotation.y = now * (0.6 + i * 0.15) + i; });
      });
      bigSign('🥬 Market garden', f[1] + 3.2, f[4] + 1.5, -0.35);
    })();

    // ---- polytunnels (tomatoes, peppers, cucumbers), south of the market garden's track
    (function () {
      var f = F('tunnels'), L = f[2] - f[1] - 2, cx = (f[1] + f[2]) / 2, R2 = 1.65;
      var film = new THREE.MeshToonMaterial({ color: 0xf2f6f2, transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide });
      var inside = [], fruit = [];
      [f[3] + 1.85, (f[3] + f[4]) / 2, f[4] - 1.85].forEach(function (tz, ti) {
        var cover = mesh(new THREE.CylinderGeometry(R2, R2, L, 16, 1, true, 0, PI), film, [cx, 0, tz]);
        cover.rotation.z = PI / 2;                       // (the half-round on its side: along the tunnel, the open half down)
        scene.add(cover);
        for (var hx = -L / 2; hx <= L / 2 + 0.01; hx += 2.2) {
          var hoop = mesh(new THREE.TorusGeometry(R2, 0.035, 4, 16, PI), '#dfe5e2', [cx + hx, 0, tz]);
          hoop.rotation.y = PI / 2; statics.add(hoop);
        }
        statics.add(box(L - 0.6, 0.12, 0.5, '#5b3d27', [cx, 0.06, tz - 0.55])); statics.add(box(L - 0.6, 0.12, 0.5, '#5b3d27', [cx, 0.06, tz + 0.55]));
        for (var x = cx - L / 2 + 0.8; x < cx + L / 2 - 0.6; x += 0.85) [-0.55, 0.55].forEach(function (dz) {
          inside.push([x + rj(0.08), 0.1, tz + dz, rnd() * TAU, 0.8 + rnd() * 0.35]);
          if (rnd() < 0.7) fruit.push([x + rj(0.15), 0.55 + rnd() * 0.5, tz + dz + rj(0.15), 0, 1, ['#e0402f', '#e0402f', '#f2c230', '#5aa845'][(ti + Math.floor(x)) % 4]]);
        });
        FIELD_OBST.push(['r', cx, tz, L / 2 + 0.1, R2 + 0.05, 0]);
      });
      var pg = new THREE.IcosahedronGeometry(0.32, 0); pg.scale(1, 1.6, 1); pg.translate(0, 0.45, 0);
      instanced(pg, mat('#4f9a3e'), inside);
      instanced(new THREE.SphereGeometry(0.08, 6, 4), new THREE.MeshToonMaterial({ color: WHITE }), fruit, function (it) { return it[5]; });
      bigSign('🍅 Polytunnels', f[1] + 3, f[3] - 1.2, 0.3);
    })();

    // ---- sunflowers (west of the dance field, south of the big wheel)
    (function () {
      var f = F('sunflowers'), stems = [], heads = [], hearts = [];
      patch(f, '#86b85e', 0.4);
      fieldRect(f, 0.1);
      for (var x = f[1] + 0.9; x < f[2] - 0.6; x += 1.15) for (var z = f[3] + 0.9; z < f[4] - 0.6; z += 1.2) {
        var px = x + rj(0.2), pz = z + rj(0.2), h = 1.5 + rnd() * 0.6, face = -0.6 + rj(0.35);   // (they face the sun, south-east)
        stems.push([px, 0, pz, face, [1, h / 1.8, 1]]);
        heads.push([px, h, pz, face, 0.9 + rnd() * 0.25]);
      }
      var sg = mergeGeos([[new THREE.CylinderGeometry(0.035, 0.05, 1.8, 5), 0, 0.9, 0],
                          [new THREE.ConeGeometry(0.16, 0.42, 4), 0.14, 0.75, 0, 0, 0, -1.2, 1, 1, 0.25], [new THREE.ConeGeometry(0.15, 0.4, 4), -0.13, 1.1, 0, 0, 0, 1.2, 1, 1, 0.25]]);
      instanced(sg, swayMat('#4e8f36'), stems);
      // the heads: petals and a brown heart, tilted towards the sun (baked so they sway with their stems)
      var petals = new THREE.CylinderGeometry(0.3, 0.3, 0.05, 12); petals.rotateX(PI / 2 - 0.35); petals.translate(0.04, 0.05, 0.12);
      var heart = new THREE.CylinderGeometry(0.16, 0.16, 0.08, 10); heart.rotateX(PI / 2 - 0.35); heart.translate(0.04, 0.06, 0.15);
      [petals, heart].forEach(function (g) { g.rotateY(PI / 2); });
      instanced(petals, swayMat('#f6c623'), heads);
      instanced(heart, swayMat('#6b3f1f'), heads);
      bigSign('🌻 Sunflowers', f[2] - 3, f[3] - 1.3, -0.2);
    })();

    // ---- the vineyard (east of the dance field, behind the gladiators' tents)
    (function () {
      var f = F('vineyard'), leaves = [], grapes = [];
      patch(f, '#a3a55f', 0.3);
      fieldRect(f, 0.1);
      for (var x = f[1] + 1.4, r2 = 0; x < f[2] - 0.8; x += 2.7, r2++) {
        var z0 = f[3] + 1.2, z1 = f[4] - 1.2;
        for (var z = z0; z <= z1 + 0.01; z += 4.3) statics.add(cyl(0.06, 0.07, 1.6, '#7a5233', [x, 0.8, z], 5));
        [0.75, 1.35].forEach(function (y) { statics.add(box(0.025, 0.025, z1 - z0, '#5a5a52', [x, y, (z0 + z1) / 2])); });
        statics.add(box(0.5, 0.75, z1 - z0, '#4f8a37', [x, 1.05, (z0 + z1) / 2]));          // the vines along the wires
        for (var zz = z0 + 0.3; zz < z1; zz += 0.75) {
          [-1, 1].forEach(function (s) { leaves.push([x + s * (0.22 + rnd() * 0.08), 0.8 + rnd() * 0.65, zz + rj(0.2), rnd() * TAU, 0.8 + rnd() * 0.4, ['#5aa845', '#4f9a3e', '#6db552'][Math.floor(rnd() * 3)]]); });
          if (rnd() < 0.55) grapes.push([x + (rnd() < 0.5 ? -1 : 1) * 0.3, 0.72 + rnd() * 0.25, zz + rj(0.2), rnd() * TAU, 0.9 + rnd() * 0.3, r2 % 3 === 2 ? '#c9d65a' : '#6a2f7a']);
        }
      }
      instanced(new THREE.IcosahedronGeometry(0.26, 0), swayMat(), leaves, function (it) { return it[5]; });
      var bunch = mergeGeos([[new THREE.ConeGeometry(0.12, 0.3, 6), 0, -0.1, 0, PI], [new THREE.SphereGeometry(0.1, 6, 4), 0, 0.02, 0]]);
      instanced(bunch, new THREE.MeshToonMaterial({ color: WHITE }), grapes, function (it) { return it[5]; });
      bigSign('🍇 Vineyard', f[1] + 3, f[3] - 1.2, 0.25);
    })();

    // ---- the beehives in a wildflower meadow (west of the play park)
    var HIVES = [];
    (function () {
      var f = F('hives'), blooms3 = [], stalks = [];
      patch(f, '#9ccb72', 0.4);
      for (var i = 0; i < 520; i++) {
        var x = f[1] + 1 + rnd() * (f[2] - f[1] - 2), z = f[3] + 1 + rnd() * (f[4] - f[3] - 2);
        if (Math.abs(z - 69.5) < 2.2) continue;            // (the hives' row)
        stalks.push([x, 0, z, rnd() * TAU, 0.8 + rnd() * 0.6]);
        blooms3.push([x, 0.42 + rnd() * 0.2, z, 0, 0.8 + rnd() * 0.5, ['#f29bc0', '#f6d743', '#c9a7f2', '#ffffff', '#ff8a65', '#7fb2ff'][i % 6]]);
      }
      var stg = new THREE.ConeGeometry(0.05, 0.5, 4); stg.translate(0, 0.25, 0);
      instanced(stg, swayMat('#5f9e46'), stalks);
      instanced(new THREE.SphereGeometry(0.09, 6, 4), swayMat(), blooms3, function (it) { return it[5]; });
      for (var h = 0; h < 7; h++) {
        var hx = f[1] + 4 + h * ((f[2] - f[1] - 8) / 6), hz = 69.5, g = group([hx, 0, hz], rj(0.15));
        g.add(box(1.0, 0.3, 0.8, '#6b4a2b', [0, 0.15, 0]));
        g.add(box(0.85, 0.45, 0.7, ['#f6f1e4', '#f2d16b', '#cfe3f2', '#f6f1e4'][h % 4], [0, 0.53, 0]));
        g.add(box(0.85, 0.4, 0.7, ['#f2d16b', '#f6f1e4', '#f6f1e4', '#f7c6d9'][h % 4], [0, 0.96, 0]));
        g.add(box(1.0, 0.1, 0.85, '#8a8f94', [0, 1.21, 0]));
        g.add(box(0.3, 0.05, 0.04, '#3c2a1e', [0, 0.38, 0.36]));
        statics.add(outline(g));
        FIELD_OBST.push(['c', hx, hz, 0.75]);
        HIVES.push(V(hx, 0, hz));
      }
      bigSign('🐝 Beehives', f[2] - 3, f[3] - 1.2, -0.25);
    })();
    var beeMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.06, 5, 4), mat('#f2c230'), HIVES.length * 4);
    scene.add(beeMesh);
    WORLD_ANIM.push(function (now, dt, n) {
      beeMesh.visible = n < 0.6;
      if (!beeMesh.visible) return;
      for (var i = 0; i < HIVES.length * 4; i++) {
        var hv = HIVES[i >> 2], a = now * (1.6 + (i % 4) * 0.35) + i * 1.7, r = 0.7 + (i % 4) * 0.35;
        m4.makeTranslation(hv.x + Math.cos(a) * r, 1.0 + Math.sin(a * 1.9 + i) * 0.35, hv.z + Math.sin(a) * r);
        beeMesh.setMatrixAt(i, m4);
      }
      beeMesh.instanceMatrix.needsUpdate = true;
    });

    // ---- the pumpkin patch (east of the play park)
    (function () {
      var f = F('pumpkins'), pumpkins = [], leaves = [];
      patch(f, '#6e5236', 0.2);
      fieldRect(f, 0.1);
      for (var i = 0; i < 380; i++) {
        var x = f[1] + 0.8 + rnd() * (f[2] - f[1] - 1.6), z = f[3] + 0.8 + rnd() * (f[4] - f[3] - 1.6);
        leaves.push([x, 0.08, z, rnd() * TAU, 0.8 + rnd() * 0.6]);
        if (i % 3 === 0) pumpkins.push([x + rj(0.4), 0, z + rj(0.4), rnd() * TAU, 0.75 + rnd() * 0.7, ['#f08a24', '#e9771a', '#f4a13a', '#f6d743', '#7fae5a'][Math.floor(rnd() * rnd() * 5)]]);
      }
      var lg = new THREE.IcosahedronGeometry(0.42, 0); lg.scale(1, 0.32, 1);
      instanced(lg, swayMat('#5a9e3e'), leaves);
      var pg = new THREE.SphereGeometry(0.34, 12, 8); pg.scale(1, 0.72, 1); pg.translate(0, 0.24, 0);
      instanced(pg, new THREE.MeshToonMaterial({ color: WHITE }), pumpkins, function (it) { return it[5]; });
      instanced(new THREE.CylinderGeometry(0.03, 0.04, 0.14, 5).translate(0, 0.52, 0), mat('#5a3d22'), pumpkins);
      var sc = group([(f[1] + f[2]) / 2 + 4, 0, (f[3] + f[4]) / 2]);          // a scarecrow keeps the crows off
      sc.add(cyl(0.06, 0.06, 2.4, '#7a5233', [0, 1.2, 0], 6)); sc.add(box(1.8, 0.1, 0.1, '#7a5233', [0, 1.75, 0]));
      sc.add(cyl(0.32, 0.38, 0.9, '#c0503a', [0, 1.55, 0], 10)); sc.add(sphere(0.3, '#f08a24', [0, 2.3, 0]));
      sc.add(cone(0.42, 0.55, '#3c2a1e', [0, 2.75, 0], 10));
      statics.add(outline(sc));
      bigSign('🎃 Pumpkin patch', f[1] + 3.5, f[3] - 1.2, 0.25);
    })();

    // ---- wheat and corn (furthest south, either side of the path), and the hay barn with its pond
    (function () {
      var w = F('wheat'), c = F('corn'), clumps = [], corn = [], cobs = [];
      patch(w, '#cfa955', 0.2); patch(c, '#6e5236', 0.2);
      fieldRect(w, 0.1); fieldRect(c, 0.1);
      for (var x = w[1] + 0.6; x < w[2] - 0.4; x += 1.05) for (var z = w[3] + 0.6; z < w[4] - 0.4; z += 1.05)
        clumps.push([x + rj(0.25), 0, z + rj(0.25), rnd() * TAU, [1, 0.85 + rnd() * 0.35, 1], ['#e3c25a', '#d9b24a', '#eccf6e', '#cfa54a'][Math.floor(rnd() * 4)]]);
      var parts = [];
      [[0, 0], [0.16, 0.1], [-0.1, 0.15]].forEach(function (o, i) {
        parts.push([new THREE.ConeGeometry(0.03, 1.0, 3), o[0], 0.5, o[1], 0, 0, (i - 1) * 0.1]);
        parts.push([new THREE.OctahedronGeometry(0.06, 0), o[0] - (i - 1) * 0.05, 1.02, o[1], 0, 0, 0, 1, 2.6, 1]);
      });
      instanced(mergeGeos(parts), swayMat(), clumps, function (it) { return it[5]; });
      for (var cx = c[1] + 0.8; cx < c[2] - 0.5; cx += 1.25) for (var cz = c[3] + 0.7; cz < c[4] - 0.5; cz += 0.95) {
        var hh = 0.9 + rnd() * 0.25, ry = rnd() * TAU, kx = cx + rj(0.12), kz = cz + rj(0.12);
        corn.push([kx, 0, kz, ry, [1, hh, 1]]);
        if (rnd() < 0.6) cobs.push([kx, 0, kz, ry, [1, hh, 1]]);
      }
      var cg = mergeGeos([[new THREE.CylinderGeometry(0.035, 0.05, 2.1, 5), 0, 1.05, 0],
                          [new THREE.ConeGeometry(0.12, 0.9, 4), 0.22, 0.95, 0, 0, 0, -1.0, 1, 1, 0.3], [new THREE.ConeGeometry(0.12, 0.9, 4), -0.22, 1.35, 0, 0, 0, 1.0, 1, 1, 0.3],
                          [new THREE.ConeGeometry(0.1, 0.8, 4), 0, 1.6, 0.2, 1.0, 0, 0, 1, 1, 0.3], [new THREE.ConeGeometry(0.06, 0.45, 4), 0, 2.3, 0]]);
      instanced(cg, swayMat('#5d9c3e'), corn);
      var cob = mergeGeos([[new THREE.CylinderGeometry(0.06, 0.05, 0.32, 6), 0.09, 1.25, 0, 0, 0, -0.35]]);
      instanced(cob, swayMat('#f2cf43'), cobs);
      bigSign('🌾 Wheat', w[2] - 3, w[3] - 1.2, 0.1);
      bigSign('🌽 Corn', c[1] + 3, c[3] - 1.2, -0.1);
      // the hay barn: a big roof on posts over the hay, round bales, a pond with a wind pump
      var hb = F('haybarn'), bx = (hb[1] + hb[2]) / 2, bz = hb[3] + 6.5, g = group([bx, 0, bz]), BW = 15, BD = 8, BH = 4.2;
      for (var px = -BW / 2; px <= BW / 2 + 0.01; px += BW / 4) [-1, 1].forEach(function (s) { g.add(box(0.28, BH, 0.28, '#7a5233', [px, BH / 2, s * BD / 2])); });
      [-1, 1].forEach(function (s) { g.add(rot(box(BW + 1.2, 0.18, BD / 2 + 1.0, '#a8423a', [0, BH + 0.9, s * (BD / 4 + 0.35)]), s * 0.42, 0, 0)); });
      for (var hx = -BW / 2 + 1.3; hx < BW / 2 - 1; hx += 2.05) for (var hy = 0; hy < 3 - (Math.abs(hx) > 4 ? 1 : 0); hy++) g.add(box(1.9, 0.85, 3.4, hy % 2 ? '#e1c25f' : '#d6b450', [hx, 0.43 + hy * 0.86, -0.4 + (hy % 2) * 0.3]));
      statics.add(outline(g));
      statics.add(blobShadow(7.5, bx, bz));
      FIELD_OBST.push(['r', bx, bz, BW / 2 + 0.4, BD / 2 + 0.4, 0]);
      for (var b = 0; b < 9; b++) {
        var ba = rnd() * TAU, bxx = bx - 6 + rnd() * 12, bzz = bz + 7 + rnd() * 6;
        var bale = cyl(0.75, 0.75, 1.2, '#e1c25f', [bxx, 0.75, bzz], 14); bale.rotation.set(0, ba, PI / 2); bale.rotation.order = 'YXZ';
        statics.add(outline(bale));
        FIELD_OBST.push(['c', bxx, bzz, 0.95]);
      }
      var pondX = bx + 2, pondZ = hb[4] - 6.5;
      var shore = mesh(new THREE.CircleGeometry(5.2, 30), '#d9c79a'); shore.rotation.x = -PI / 2; shore.position.set(pondX, 0.012, pondZ); statics.add(shore);
      var water = mesh(new THREE.CircleGeometry(4.6, 30), '#5fb3e0'); water.rotation.x = -PI / 2; water.position.set(pondX, 0.028, pondZ); statics.add(water);
      for (var r3 = 0; r3 < 12; r3++) { var ra = r3 / 12 * TAU + rj(0.2); statics.add(cyl(0.03, 0.04, 1.1 + rnd() * 0.4, '#6d9a3c', [pondX + Math.cos(ra) * 4.8, 0.55, pondZ + Math.sin(ra) * 4.8], 5)); }
      FIELD_OBST.push(['c', pondX, pondZ, 5.0]);
      var wp = group([pondX - 6.8, 0, pondZ - 1.5]);              // the wind pump that fills the pond
      [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]].forEach(function (l) { wp.add(rot(box(0.1, 6.2, 0.1, '#8a8f94', [l[0] * 0.55, 3.1, l[1] * 0.55]), l[1] * 0.1, 0, -l[0] * 0.1)); });
      var fan = group([0, 6.3, 0.35]);
      for (var bl = 0; bl < 12; bl++) { var arm = group(); arm.rotation.z = bl / 12 * TAU; arm.add(box(0.14, 1.1, 0.03, '#f4efe4', [0, 0.75, 0])); fan.add(arm); }
      fan.add(rot(cyl(0.12, 0.12, 0.2, '#5a3d22', [0, 0, 0], 8), PI / 2));
      wp.add(fan); wp.add(box(0.06, 0.6, 1.0, '#c0503a', [0, 6.3, -0.6]));
      outline(wp);
      if (NevetHero.merge) NevetHero.merge(wp, function (o) { return o === fan; });
      scene.add(wp);
      FIELD_OBST.push(['c', pondX - 6.8, pondZ - 1.5, 0.7]);
      WORLD_ANIM.push(function (now) { fan.rotation.z = -now * 1.1; });
      bigSign('🏚️ Hay barn', hb[1] + 3, hb[3] - 1.2, -0.15);
    })();

    // ---- a little tractor going up and down the farm track between the park and the far fields
    (function () {
      var t = group(), body = group(); t.add(body);
      body.add(box(1.5, 0.7, 0.95, '#d8402f', [0.2, 0.85, 0]));
      body.add(box(0.75, 0.9, 0.95, '#d8402f', [-0.45, 1.6, 0]));
      body.add(box(0.7, 0.55, 0.85, '#bfe6f0', [-0.45, 1.65, 0]));
      body.add(box(0.85, 0.08, 1.05, '#2f3a40', [-0.45, 2.1, 0]));
      body.add(cyl(0.06, 0.06, 0.6, '#2f3a40', [0.7, 1.5, 0.25], 6));
      var wheels = [];
      [[-0.55, 0.62, 0.6], [0.75, 0.38, 0.42]].forEach(function (w2) {
        [-1, 1].forEach(function (s) { var wh = cyl(w2[1], w2[1], 0.28, '#2f3a40', [w2[0], w2[1], s * w2[2]], 14); wh.rotation.x = PI / 2; t.add(wh); wheels.push(wh);
                                       t.add(rot(cyl(w2[1] * 0.45, w2[1] * 0.45, 0.3, '#f2c230', [w2[0], w2[1], s * w2[2]], 8), PI / 2)); });
      });
      outline(body, 1.03);
      if (NevetHero.merge) NevetHero.merge(t, function (o) { return o === body || wheels.indexOf(o) >= 0; });
      scene.add(t);
      var T0 = -54, T1 = 54, Z = 81.6;
      WORLD_ANIM.push(function (now) {
        var L = T1 - T0, u = (now * 2.2) % (2 * L), back = u > L, x = back ? T1 - (u - L) : T0 + u;
        t.position.set(x, 0, Z + (back ? 0.45 : -0.45));
        t.rotation.y = back ? PI : 0;
        wheels.forEach(function (wh, i) { wh.rotation.y = 0; wh.rotation.z = 0; wh.rotation.x = PI / 2; wh.rotateY(-now * 2.2 / (i < 2 ? 0.62 : 0.38)); });
        body.position.y = Math.abs(Math.sin(now * 9)) * 0.03;
      });
    })();
  })();

  // The campfire in the middle of the farm (the mud arena is built round it): a ring of big stones, a tepee
  // of logs on a bed of glowing coals, and a fire drawn with shaders: flames (noise rising through a fire colour ramp)
  // on planes that always face you, a white-hot core, a glow, firelight on the ground, embers and sparks, smoke, and a
  // flickering light. It's lit for the Campfire dance (and at night in dark mode). For the champion it burns rainbow.
  var flames = [], embers, SPARK_TEX = null;
  var FIREFX = { level: 0, mats: [], boards: [], glow: null, ground: null, coals: [], smoke: [], rainbow: 0 };
  var FLAME_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  var FLAME_FS = [
    'uniform float uTime; uniform float uSeed; uniform float uPower; uniform float uLevel; uniform float uRainbow; varying vec2 vUv;',
    'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
    'float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }',
    'float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }',
    'void main(){',
    '  float x = (vUv.x - 0.5) * 2.0, y = vUv.y;',
    '  float n = fbm(vec2(x * 1.8 + uSeed, y * 2.6 - uTime * 2.1));',
    '  float n2 = fbm(vec2(x * 3.6 - uSeed * 1.7, y * 4.4 - uTime * 3.3));',
    '  float sway = (n - 0.5) * 0.7 * y + sin(uTime * 1.7 + uSeed) * 0.06 * y;',
    '  float width = mix(0.95, 0.04, pow(y, 0.8));',
    '  float shape = 1.0 - smoothstep(width * 0.35, width, abs(x + sway));',
    '  float heat = shape * (0.62 + 0.7 * n2) * (1.15 - y) - y * 0.28;',
    '  heat = clamp(heat * uPower * uLevel, 0.0, 1.0);',
    '  vec3 col = mix(vec3(0.55, 0.04, 0.0), vec3(1.0, 0.36, 0.03), smoothstep(0.04, 0.32, heat));',
    '  col = mix(col, vec3(1.0, 0.78, 0.25), smoothstep(0.32, 0.62, heat));',
    '  col = mix(col, vec3(1.0, 0.98, 0.86), smoothstep(0.7, 1.0, heat));',
    '  vec3 rb = 0.55 + 0.45 * cos(6.2832 * (vec3(0.0, 0.33, 0.67) + y * 0.9 + n * 0.4 - uTime * 0.35 + uSeed * 0.07));',
    '  col = mix(col, rb * (0.45 + 0.8 * heat), uRainbow * smoothstep(0.06, 0.3, heat) * (1.0 - smoothstep(0.82, 1.0, heat)));',
    '  float a = smoothstep(0.02, 0.22, heat);',
    '  gl_FragColor = vec4(col * a, a);',
    '}'].join('\n');
  function flameBoard(w, h, power, seed) {             // a flame on a plane whose bottom sits at its position
    var mat2 = new THREE.ShaderMaterial({ vertexShader: FLAME_VS, fragmentShader: FLAME_FS, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uSeed: { value: seed }, uPower: { value: power }, uLevel: { value: 0 }, uRainbow: { value: 0 } } });
    var geo = new THREE.PlaneGeometry(w, h); geo.translate(0, h / 2, 0);
    var m = new THREE.Mesh(geo, mat2);
    m.renderOrder = 5; m.visible = false; m.frustumCulled = false;
    FIREFX.mats.push(mat2); FIREFX.boards.push(m);
    return m;
  }
  function radialTex(stops) {
    var c = document.createElement('canvas'); c.width = c.height = 128;
    var g2 = c.getContext('2d'), gr = g2.createRadialGradient(64, 64, 0, 64, 64, 64);
    stops.forEach(function (st) { gr.addColorStop(st[0], st[1]); });
    g2.fillStyle = gr; g2.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  }
  SPARK_TEX = radialTex([[0, 'rgba(255,255,255,1)'], [0.4, 'rgba(255,255,255,0.6)'], [1, 'rgba(255,255,255,0)']]);
  (function () {
    var K = FIRE_K, g = group([FIRE.x, 0, FIRE.z]);
    for (var i = 0; i < 19; i++) { var a = i / 19 * TAU; g.add(sphere(0.27 * K, i % 2 ? '#9a9a96' : '#7d7d79', [Math.cos(a) * 1.05 * K, 0.16 * K, Math.sin(a) * 1.05 * K], [1.25, 0.8, 1.05], 8)); }
    g.add(cyl(0.95 * K, 0.95 * K, 0.04, '#2a1d14', [0, 0.02, 0], 24));                  // ash
    for (var l = 0; l < 8; l++) {                       // a tepee of logs
      var lg = group(); lg.rotation.y = l * PI / 4 + 0.2;
      var log = cyl(0.11 * K, 0.13 * K, 1.45 * K, l % 2 ? '#6b4423' : '#5a381d', [0.34 * K, 0.55 * K, 0], 8); log.rotation.z = 0.55;
      lg.add(log); g.add(lg);
    }
    scene.add(g); FIREFX.rig = g;                       // (it rides up the fire tower when the arena folds for the party)
    if (NevetHero.merge) NevetHero.merge(g, function () { return false; });
    for (var cI = 0; cI < 16; cI++) {                   // glowing coals
      var ca = cI / 16 * TAU, coal = mesh(new THREE.SphereGeometry(0.12 * K, 7, 5), new THREE.MeshBasicMaterial({ color: 0xff5a14 }), [Math.cos(ca) * rr(0.15, 0.62) * K, 0.07 * K, Math.sin(ca) * rr(0.15, 0.62) * K]);
      coal.scale.set(1.3, 0.6, 1.1); coal.userData.ph = cI * 1.7; g.add(coal); FIREFX.coals.push(coal);
    }
    [[2.1, 2.9, 1.0, 0.0], [1.1, 1.9, 1.35, 3.1], [1.0, 1.6, 0.9, 6.3], [0.9, 1.4, 0.9, 9.7], [0.95, 1.5, 0.9, 12.9], [0.85, 1.3, 0.9, 15.4]].forEach(function (f, k) {
      var fb = flameBoard(f[0] * K, f[1] * K, f[2], f[3]);
      var side = [[0, 0], [0, 0], [0.45, 0.2], [-0.45, -0.2], [0.2, -0.45], [-0.2, 0.45]][k];
      fb.userData.off = V(side[0] * K, (k < 2 ? 0.15 : 0.1) * K, side[1] * K);
      scene.add(fb); flames.push(fb);
    });
    FIREFX.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTex([[0, 'rgba(255,190,90,0.9)'], [0.25, 'rgba(255,120,30,0.45)'], [1, 'rgba(255,80,0,0)']]),
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 }));
    FIREFX.glow.position.set(FIRE.x, 1.3 * K, FIRE.z); FIREFX.glow.scale.setScalar(6 * K); FIREFX.glow.renderOrder = 4; scene.add(FIREFX.glow);
    FIREFX.ground = new THREE.Mesh(new THREE.CircleGeometry(3.0 * K, 48), new THREE.MeshBasicMaterial({ map: radialTex([[0, 'rgba(255,150,60,0.75)'], [0.5, 'rgba(255,100,30,0.25)'], [1, 'rgba(255,80,20,0)']]),
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 }));
    FIREFX.ground.rotation.x = -PI / 2; FIREFX.ground.position.set(FIRE.x, 0.1, FIRE.z); FIREFX.ground.renderOrder = 3; scene.add(FIREFX.ground);
    var smokeTex = radialTex([[0, 'rgba(90,90,96,0.55)'], [0.6, 'rgba(110,110,116,0.22)'], [1, 'rgba(120,120,126,0)']]);
    for (var sI = 0; sI < 12; sI++) {
      var sm = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false, opacity: 0 }));
      sm.userData = { ph: sI / 12, dx: rr(-0.6, 0.6), dz: rr(-0.6, 0.6) }; scene.add(sm); FIREFX.smoke.push(sm);
    }
    // embers and sparks rising from the fire
    var NE = 260, eg = new THREE.BufferGeometry(), ep = new Float32Array(NE * 3), ec = new Float32Array(NE * 3), col2 = new THREE.Color();
    for (var e = 0; e < NE; e++) { col2.setHSL(0.06 + R() * 0.07, 1, 0.55 + R() * 0.25); ec[e * 3] = col2.r; ec[e * 3 + 1] = col2.g; ec[e * 3 + 2] = col2.b; }
    eg.setAttribute('position', new THREE.BufferAttribute(ep, 3));
    eg.setAttribute('color', new THREE.BufferAttribute(ec, 3));
    embers = new THREE.Points(eg, new THREE.PointsMaterial({ vertexColors: true, size: 0.14, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, map: SPARK_TEX }));
    embers.userData.seeds = [];
    for (var e2 = 0; e2 < NE; e2++) embers.userData.seeds.push([R(), R() * TAU, e2 % 7 === 0 ? rr(0.6, 0.9) : rr(0.18, 0.42), rr(0.2, 1.0)]);   // a few fast sparks
    embers.frustumCulled = false;
    scene.add(embers);
  })();

  // Show effects for the campfire arena and the party: flame jets that shoot up, fireworks and confetti cannons. They
  // go off on the big moments (the bell, a throw, a winner, the champion; the drops at the party) and stay still for
  // anyone who asked their device for reduced motion.
  var FX = { jets: [], works: [], cannons: [] };
  function makeJet(x, z, y, h) {                        // a flame jet standing at (x, y, z), h metres tall when it fires
    var b = flameBoard(1.15, h, 1.3, x * 1.3 + z * 0.7);
    b.position.set(x, y, z); b.userData.off = null;
    scene.add(b);
    var glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: FIREFX.glow.material.map, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 }));
    glow.position.set(x, y + h * 0.3, z); glow.scale.setScalar(h * 0.95); glow.visible = false; glow.renderOrder = 4; scene.add(glow);
    var j = { board: b, glow: glow, at: -99, dur: 1.15, h: h, pos: V(x, y, z) };
    FX.jets.push(j);
    return j;
  }
  function fireJet(j, now, delay) { if (j && !calm) j.at = now + (delay || 0); }
  function stepJets(now, camQ) {
    FX.jets.forEach(function (j) {
      var k = (now - j.at) / j.dur, lv = k < 0 || k > 1 ? 0 : k < 0.1 ? k / 0.1 : Math.pow(1 - (k - 0.1) / 0.9, 0.8);
      var on = lv > 0.01;
      j.board.visible = on; j.glow.visible = on;
      if (!on) return;
      j.board.material.uniforms.uLevel.value = 0.55 + lv * 0.6;
      j.board.scale.set(0.75 + lv * 0.45, 0.3 + lv * 0.8, 1);
      j.board.quaternion.copy(camQ);
      j.glow.material.opacity = lv * 0.5;
    });
  }
  var FW_N = 110, fwCol = new THREE.Color();
  for (var wI = 0; wI < 12; wI++) (function () {
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(FW_N * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(FW_N * 3), 3));
    var pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.42, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, map: SPARK_TEX, opacity: 0 }));
    pts.frustumCulled = false; pts.visible = false; pts.renderOrder = 6; scene.add(pts);
    var dirs = [];
    for (var i = 0; i < FW_N; i++) { var u = R() * 2 - 1, a = R() * TAU, s2 = Math.sqrt(1 - u * u), sp = rr(0.82, 1.0); dirs.push([Math.cos(a) * s2 * sp, u * sp, Math.sin(a) * s2 * sp]); }
    FX.works.push({ pts: pts, dirs: dirs, at: -99, from: V(0, 0, 0), to: V(0, 0, 0), speed: 9, rise: 1.0, life: 2.4 });
  })();
  function launchWork(from, height, hue, now, delay, over) {   // a rocket from `from`, bursting `height` metres up (over a spot, if given)
    if (calm) return;
    var w = FX.works.reduce(function (a, b) { return a.at < b.at ? a : b; });      // the oldest one
    var ox = over ? over.x : from.x, oz = over ? over.z : from.z;
    w.at = now + (delay || 0); w.from.copy(from); w.to.set(ox + rr(-2.5, 2.5), from.y + height, oz + rr(-2.5, 2.5));
    w.speed = rr(7.5, 11.5); w.rise = rr(0.9, 1.25);
    var c = w.pts.geometry.attributes.color, h1 = hue === undefined || hue === null ? R() : hue, h2 = R() < 0.45 ? (h1 + 0.5) % 1 : (h1 + 0.08) % 1;
    for (var i = 0; i < FW_N; i++) { fwCol.setHSL(i % 2 ? h1 : h2, 1, i % 9 === 0 ? 0.92 : 0.6); c.setXYZ(i, fwCol.r, fwCol.g, fwCol.b); }
    c.needsUpdate = true;
  }
  function stepWorks(now, n) {
    FX.works.forEach(function (w) {
      var t = now - w.at, vis = t >= 0 && t < w.rise + w.life;
      w.pts.visible = vis;
      if (!vis) return;
      var p = w.pts.geometry.attributes.position, mt = w.pts.material, i;
      mt.blending = n > 0.35 ? THREE.AdditiveBlending : THREE.NormalBlending;     // (additive sparks vanish against a bright sky)
      if (t < w.rise) {                                // the rocket climbs, trailing sparks
        var k = t / w.rise, e = 1 - (1 - k) * (1 - k);
        var hx = w.from.x + (w.to.x - w.from.x) * e, hy = w.from.y + (w.to.y - w.from.y) * e, hz = w.from.z + (w.to.z - w.from.z) * e;
        for (i = 0; i < FW_N; i++) { var back = (i / FW_N) * 1.8 * (1 - k * 0.4); p.setXYZ(i, hx + w.dirs[i][0] * 0.1, hy - back, hz + w.dirs[i][2] * 0.1); }
        mt.opacity = 0.9; mt.size = 0.26;
      } else {                                         // the burst: a ball of sparks that slows, droops and fades
        var tb = t - w.rise, r = w.speed * (1 - Math.exp(-tb * 2.4)) / 2.4, drop = 1.5 * tb * tb, f = tb / w.life;
        for (i = 0; i < FW_N; i++) p.setXYZ(i, w.to.x + w.dirs[i][0] * r, w.to.y + w.dirs[i][1] * r - drop, w.to.z + w.dirs[i][2] * r);
        mt.opacity = Math.pow(1 - f, 1.3) * (0.88 + 0.12 * Math.sin(now * 9 + w.speed));
        mt.size = 0.42 + f * 0.3;
      }
      p.needsUpdate = true;
    });
  }
  var CC_N = 240;
  function makeCannon(origin, aim) {                    // a confetti cannon at `origin`, shooting towards `aim`
    var geo = new THREE.BufferGeometry(), cc = new Float32Array(CC_N * 3), col = new THREE.Color(), seeds = [];
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(CC_N * 3), 3));
    var d = aim.clone().sub(origin); d.y = 0; var dl = d.length(); d.normalize();
    for (var i = 0; i < CC_N; i++) {
      col.setHSL(R(), 0.9, 0.62); cc[i * 3] = col.r; cc[i * 3 + 1] = col.g; cc[i * 3 + 2] = col.b;
      var sp = rr(0.55, 1.15) * dl * 2.0;
      seeds.push([d.x * sp + rr(-3.5, 3.5), rr(2, 8), d.z * sp + rr(-3.5, 3.5), rr(0, TAU), rr(0.6, 1.2)]);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cc, 3));
    var pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.16, vertexColors: true, transparent: true, depthWrite: false, opacity: 0 }));
    pts.frustumCulled = false; pts.visible = false; scene.add(pts);
    var cn = { pts: pts, o: origin.clone(), seeds: seeds, at: -99 };
    FX.cannons.push(cn);
    return cn;
  }
  function fireCannon(cn, now) { if (cn && !calm) cn.at = now; }
  function stepCannons(now) {
    FX.cannons.forEach(function (cn) {
      var t = now - cn.at, vis = t >= 0 && t < 7;
      cn.pts.visible = vis;
      if (!vis) return;
      var p = cn.pts.geometry.attributes.position, o = cn.o, f = (1 - Math.exp(-2 * t)) / 2;
      cn.seeds.forEach(function (sd, i) {
        var fl = Math.min(1, t) * 0.35, y = o.y + sd[1] * f - sd[4] * (t - f);
        p.setXYZ(i, o.x + sd[0] * f + Math.sin(t * 3 + sd[3]) * fl, Math.max(0.1, y), o.z + sd[2] * f + Math.cos(t * 2.6 + sd[3]) * fl);
      });
      p.needsUpdate = true;
      cn.pts.material.opacity = Math.min(1, (7 - t) / 1.5);
    });
  }

  // The rave, in the middle of the farm round the mud arena: a 29 x 28 m dance field of packed earth that lights up
  // panel by panel on the beat, in front of a low, open stage to the north: a DJ booth, a low LED screen with the
  // NEVET sign, a goal-post truss with a flown speaker hang either side and moving heads, and two big speaker stacks
  // on the ground. Two light towers at the back of the field (by the sound desk under its stretched sail) have
  // lasers and sky searchlights, and flags and festoons line the sides. When the party starts, the arena folds up
  // into a fire tower in the middle of the field (see "the folding arena"). Minimal on purpose, so everyone on the
  // floor can be seen from anywhere; the big wheel turns in the meadow beside the stage. In party mode: lasers, a
  // little fog, confetti, balloons, flame jets and confetti cannons on the drops, fireworks. The stage stays up all
  // the time (the screen and the lights rest between parties).
  var PARTY = { c: PARTY_C, hx: STAGE_HX, hz: STAGE_HZ, half: Math.max(STAGE_HX, STAGE_HZ),
                tiles: null, bulbs: null, beams: [], ball: null, confetti: null, notes: [], lasers: [], spots: [], fog: [],
                balloons: [], speakers: [], decks: [], leds: null, neon: null, group: null, fixed: null, screen: null,
                arches: null, archN: 0, searchlights: [], jets: [], flags: [], obst: [], partyObst: [] };
  var DJ_SPOT = V(PARTY.c.x, 0, STAGE_N - 1.9);
  var STAGE = { w: 9.0, wallZ: DJ_SPOT.z - 1.5, wallW: 12.4, wallH: 2.2, wallY: 0.75, booth: DJ_SPOT.z + 0.95,
                trussX: 7.6, trussH: 7.2, stackX: 10.6, stackZ: STAGE_N - 1.1,
                towerX: 5, towerZ: PARTY_C.z + STAGE_HZ + 2.2, towerH: 8.6, fohX: -8.5 };   // (the light towers flank the sound desk, west of the path to the park)
  STAGE.trussZ = STAGE.wallZ + 0.15;
  // the crowd fills the floor from the front, row by row (rows of up to 11, the middle first), round the fire tower:
  // the more dancers, the more of the field
  var TOWER_R = 2.7, TOWER_CLEAR = TOWER_R + 2.0;        // the folded arena's fire tower in the middle of the field, and room round it
  var CROWD_N = Math.max(1, (D.heroes || []).length - 1);
  function crowdShape(n) { var cols = Math.max(2, Math.min(11, Math.ceil(Math.sqrt(n * 1.7)))); return { cols: cols, rows: Math.max(1, Math.ceil(n / cols)) }; }
  var CROWD_SP = { x: 3.4, z: 3.1 }, CROWD_Z = STAGE_N + 2.9;               // room to dance, and the front row a few steps from the stage
  var CROWD_SLOTS = {};
  function crowdSlots(n) {
    if (CROWD_SLOTS[n]) return CROWD_SLOTS[n];
    var cols = crowdShape(n).cols, spX = Math.min(CROWD_SP.x, (STAGE_HX * 2 - 2.4) / Math.max(1, cols - 1)), spZ = CROWD_SP.z, out = [];
    for (var pass = 0; pass < 4 && out.length < n; pass++, spX *= 0.88, spZ *= 0.85) {   // (closer together if the field is full)
      out = [];
      for (var j = 0; out.length < n; j++) {
        var z = CROWD_Z + j * spZ;
        if (z > PARTY_C.z + STAGE_HZ - 1.2) break;
        var stagger = (j % 2 ? 0.125 : -0.125) * spX, fan = 1 + j * 0.03, row = [];
        for (var i = 0; i < cols; i++) {
          var x = PARTY_C.x + (i - (cols - 1) / 2) * spX * fan + stagger;
          if (Math.abs(x - PARTY_C.x) > STAGE_HX - 0.8 || Math.hypot(x - FIRE.x, z - FIRE.z) < TOWER_CLEAR) continue;
          row.push(V(x, 0, z));
        }
        row.sort(function (a, b) { return Math.abs(a.x - PARTY_C.x) - Math.abs(b.x - PARTY_C.x); });   // a short row stands in the middle
        while (row.length && out.length < n) out.push(row.shift());
      }
    }
    CROWD_SLOTS[n] = out;
    return out;
  }
  var CROWD_C = (function () {                          // the crowd's middle
    var sl = crowdSlots(CROWD_N), c = V(0, 0, 0);
    sl.forEach(function (p) { c.add(p); });
    return sl.length ? c.divideScalar(sl.length) : V(PARTY_C.x, 0, CROWD_Z + 4);
  })();
  var WHEEL_FX = { rot: null, cabins: [], bulbs: null, n: 0 };
  var LED_FS = [
    'uniform float uTime; uniform float uKick; uniform float uMode; uniform float uLevel; uniform vec2 uGrid; uniform float uAspect; varying vec2 vUv;',
    'vec3 hsv(float h, float s, float v){ vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); return v * mix(vec3(1.0), k, s); }',
    'void main(){',
    '  vec2 grid = uGrid, px = (floor(vUv * grid) + 0.5) / grid, cell = fract(vUv * grid);',
    '  float led = smoothstep(0.52, 0.3, length(cell - 0.5));',
    '  vec2 p = (px - 0.5) * vec2(uAspect, 1.0); float t = uTime, m = mod(uMode, 4.0); vec3 c;',
    '  if (m < 1.0) {',                                    // plasma
    '    float v = sin(p.x * 6.0 + t * 1.3) + sin(p.y * 7.0 - t * 1.1) + sin((p.x + p.y) * 5.0 + t * 0.7) + sin(length(p) * 9.0 - t * 2.0);',
    '    c = hsv(v * 0.12 + t * 0.05, 0.85, 0.7 + 0.3 * uKick);',
    '  } else if (m < 2.0) {',                             // a tunnel of rings rushing out
    '    float r = length(p), a = atan(p.y, p.x), rings = step(0.5, fract(1.2 / (r + 0.15) - t * 1.6));',
    '    c = hsv(a / 6.2832 + t * 0.1, 0.9, mix(0.12, 1.0, rings) * (0.7 + 0.3 * uKick));',
    '  } else if (m < 3.0) {',                             // an equaliser
    '    float bx = floor(px.x * 28.0), h = 0.2 + 0.65 * abs(sin(bx * 1.7 + t * 3.0 + sin(bx * 0.6 + t) * 2.0)) * (0.55 + 0.45 * uKick);',
    '    c = hsv(bx / 28.0 + t * 0.05, 0.9, step(px.y, h) * mix(0.55, 1.0, px.y / max(h, 0.01)));',
    '  } else {',                                          // spinning rays
    '    float a = atan(p.y, p.x) + t * 0.8, r = length(p);',
    '    c = hsv(t * 0.08 + r * 0.3, 0.8, (0.3 + 0.7 * step(0.0, sin(a * 8.0))) * smoothstep(1.7, 0.0, r) * (0.75 + 0.25 * uKick));',
    '  }',
    '  gl_FragColor = vec4(c * uLevel * (0.2 + 0.8 * led) + vec3(0.025, 0.025, 0.035), 1.0);',
    '}'].join('\n');
  var ROD_GEO = new THREE.CylinderGeometry(1, 1, 1, 5);
  function rod(a, b, r, color) {                       // a thin bar from a to b (truss chords and braces, scaffold tubes)
    var d = b.clone().sub(a), m2 = mesh(ROD_GEO, color);
    m2.scale.set(r, d.length(), r);
    m2.position.copy(a).add(b).multiplyScalar(0.5);
    m2.quaternion.setFromUnitVectors(V(0, 1, 0), d.normalize());
    return m2;
  }
  function truss(a, b, s, color) {                      // a square truss from a to b, s wide: four chords, zigzag braces on two faces
    var d = b.clone().sub(a), len = d.length(), up = Math.abs(d.y) > len * 0.7;
    var u = up ? V(1, 0, 0) : V(0, 1, 0), w = d.clone().normalize().cross(u).normalize(), h = s / 2;
    u = w.clone().cross(d.clone().normalize()).normalize();
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (k) {
      var o = u.clone().multiplyScalar(k[0] * h).add(w.clone().multiplyScalar(k[1] * h));
      statics.add(rod(a.clone().add(o), b.clone().add(o), 0.04, color));
    });
    var n = Math.max(1, Math.round(len / s));
    [-1, 1].forEach(function (side) {
      for (var i = 0; i < n; i++) {
        var p0 = a.clone().add(d.clone().multiplyScalar(i / n)), p1 = a.clone().add(d.clone().multiplyScalar((i + 1) / n));
        var sa = i % 2 ? -1 : 1, o0 = u.clone().multiplyScalar(sa * h).add(w.clone().multiplyScalar(side * h)), o1 = u.clone().multiplyScalar(-sa * h).add(w.clone().multiplyScalar(side * h));
        statics.add(rod(p0.add(o0), p1.add(o1), 0.022, color));
      }
    });
  }
  (function () {
    var g = group(), fx = group(), c = PARTY.c, hx = PARTY.hx, hz = PARTY.hz, T = 1.45, S = STAGE;
    var nx = Math.round(hx * 2 / T), nz = Math.round(hz * 2 / T), tx = hx * 2 / nx, tz = hz * 2 / nz;
    PARTY.group = g; PARTY.fixed = fx;
    g.visible = false;
    scene.add(g); scene.add(fx);
    // the stage deck and the dance field: one instanced mesh of earth-coloured panels whose colours (and a little lift)
    // change with the beat
    statics.add(box(S.w * 2, 0.05, STAGE_N - S.wallZ + 0.7, '#2a2a33', [c.x, 0.025, (STAGE_N + S.wallZ - 0.7) / 2]));
    statics.add(box(hx * 2 + 0.3, 0.05, hz * 2 + 0.3, WD.dustEdge || '#9a8360', [c.x, 0.025, c.z]));
    var tGeo = new THREE.BoxGeometry(tx * 0.96, 0.08, tz * 0.96);
    var tiles = new THREE.InstancedMesh(tGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), nx * nz);
    var m = new THREE.Matrix4(), col = new THREE.Color(), dust = WD.dust || ['#c8ab7c', '#c0a273', '#d0b588', '#bb9d6f'];
    PARTY.tilePos = []; PARTY.restCol = [];
    for (var i = 0; i < nx; i++) for (var j = 0; j < nz; j++) {
      var tp = [c.x - hx + tx * (i + 0.5), c.z - hz + tz * (j + 0.5)];
      PARTY.tilePos.push(tp);
      m.makeTranslation(tp[0], 0.05, tp[1]);
      tiles.setMatrixAt(i * nz + j, m);
      var rc = new THREE.Color(dust[Math.floor(R() * dust.length)]).multiplyScalar(0.92 + R() * 0.12);
      PARTY.restCol.push(rc);
      tiles.setColorAt(i * nz + j, rc);
    }
    PARTY.tiles = tiles; PARTY.nx = nx; PARTY.nz = nz;
    fx.add(tiles);
    var edgeMat = new THREE.MeshBasicMaterial({ color: 0x8a3a78 });         // a glowing rope light round the field
    [[0, -hz - 0.17, hx * 2 + 0.44, 0.1], [0, hz + 0.17, hx * 2 + 0.44, 0.1], [-hx - 0.17, 0, 0.1, hz * 2 + 0.44], [hx + 0.17, 0, 0.1, hz * 2 + 0.44]].forEach(function (e) {
      fx.add(mesh(new THREE.BoxGeometry(e[2], 0.08, e[3]), edgeMat, [c.x + e[0], 0.06, c.z + e[1]]));
    });
    PARTY.edge = edgeMat;
    // the DJ booth with two decks, facing the floor (south), a little monitor either side
    var booth = group([DJ_SPOT.x, 0, S.booth]);
    booth.add(box(2.8, 1.0, 0.9, '#2d2d3a', [0, 0.5, 0]));
    booth.add(box(2.9, 0.08, 1.0, '#4a4a5c', [0, 1.04, 0]));
    statics.add(outline(booth));
    var stripe = mesh(new THREE.BoxGeometry(2.6, 0.2, 0.02), new THREE.MeshBasicMaterial({ color: 0xff5ea8 }), [DJ_SPOT.x, 0.7, S.booth + 0.46]);
    fx.add(stripe); PARTY.stripe = stripe;
    [-0.6, 0.6].forEach(function (x) {
      var deck = cyl(0.3, 0.3, 0.04, '#111', [DJ_SPOT.x + x, 1.1, S.booth], 20);
      deck.add(cyl(0.08, 0.08, 0.05, '#e3c16f', [0, 0.01, 0], 10));
      fx.add(deck); PARTY.decks.push(deck);
    });
    PARTY.obst.push(['r', DJ_SPOT.x, S.booth, 1.45, 0.5]);
    function speaker(x, y, z, w, h, d, pump) {
      var sp = group([x, y, z]);
      sp.add(box(w, h, d, '#1c1c24', [0, 0, 0]));
      var woof = cyl(Math.min(w, h) * 0.34, Math.min(w, h) * 0.34, 0.05, '#4d4d58', [0, -h * 0.12, d / 2 + 0.01], 18); woof.rotation.x = PI / 2; sp.add(woof);
      var tw = cyl(w * 0.12, w * 0.12, 0.05, '#777', [0, h * 0.3, d / 2 + 0.01], 12); tw.rotation.x = PI / 2; sp.add(tw);
      if (pump) PARTY.speakers.push(woof);
      fx.add(sp);
      return sp;
    }
    [-1, 1].forEach(function (sd) {
      speaker(DJ_SPOT.x + sd * 1.95, 0.35, S.booth + 0.1, 0.55, 0.7, 0.5, false).rotation.y = -sd * 0.35;   // the DJ's monitors
      // the main stacks on the ground either side of the stage: two cabinets wide, three high
      for (var cx2 = 0; cx2 < 2; cx2++) for (var cy = 0; cy < 3; cy++)
        speaker(c.x + sd * (S.stackX + (cx2 - 0.5) * 1.05), 0.6 + cy * 1.14, S.stackZ, 1.0, 1.1, 0.9, true);
      PARTY.obst.push(['r', c.x + sd * S.stackX, S.stackZ, 1.1, 0.5]);
    });
    // the low LED screen behind the DJ (its top below the heads of the crowd seen from the field's far end), and the NEVET sign on it
    var screen = new THREE.Mesh(new THREE.PlaneGeometry(S.wallW, S.wallH), new THREE.ShaderMaterial({ vertexShader: FLAME_VS, fragmentShader: LED_FS,
      uniforms: { uTime: { value: 0 }, uKick: { value: 0 }, uMode: { value: 0 }, uLevel: { value: 0.12 }, uGrid: { value: new THREE.Vector2(120, 22) }, uAspect: { value: S.wallW / S.wallH } } }));
    screen.position.set(c.x, S.wallY + S.wallH / 2, S.wallZ);
    fx.add(screen); PARTY.screen = screen;
    statics.add(box(S.wallW + 0.3, S.wallH + 0.3, 0.24, '#15151b', [c.x, S.wallY + S.wallH / 2, S.wallZ - 0.14]));
    [-1, 0, 1].forEach(function (sd) { statics.add(box(0.24, S.wallY, 0.4, '#2b2b33', [c.x + sd * (S.wallW / 2 - 1.2), S.wallY / 2, S.wallZ - 0.1])); });
    PARTY.obst.push(['r', c.x, S.wallZ - 0.14, S.wallW / 2 + 0.2, 0.22]);
    var nc = document.createElement('canvas'); nc.width = 512; nc.height = 128;
    var nctx = nc.getContext('2d'), signText = D.event ? D.event.title.toUpperCase() : 'NEVET', fpx = 92;   // (an event on: its name)
    do { nctx.font = 'italic 900 ' + fpx + 'px "Trebuchet MS", "Arial Black", sans-serif'; fpx -= 4; } while (fpx > 26 && nctx.measureText(signText).width > 480);
    nctx.textAlign = 'center'; nctx.textBaseline = 'middle';
    nctx.shadowColor = '#ffffff'; nctx.shadowBlur = 18; nctx.lineWidth = 7; nctx.strokeStyle = '#ffffff';
    nctx.strokeText(signText, 256, 66); nctx.fillStyle = '#ffffff'; nctx.fillText(signText, 256, 66);
    var neon = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 1.2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(nc), transparent: true, depthWrite: false, side: THREE.DoubleSide, color: 0x6a2a5a }));
    neon.position.set(c.x, S.wallY + S.wallH + 0.72, S.wallZ - 0.02);
    fx.add(neon); PARTY.neon = neon;
    // the event's line-up across the top of the screen while it's on: who's playing now, and who's next
    if (D.event && D.event.lineup && D.event.lineup.length) {
      var lc = document.createElement('canvas'); lc.width = 1024; lc.height = 112;
      var lu = new THREE.Mesh(new THREE.PlaneGeometry(S.wallW - 0.6, (S.wallW - 0.6) * 112 / 1024),
        new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(lc), transparent: true, depthWrite: false }));
      lu.position.set(c.x, S.wallY + S.wallH - 0.1 - (S.wallW - 0.6) * 56 / 1024, S.wallZ + 0.04);   // (along the top, above the DJ's head)
      lu.visible = false;
      fx.add(lu);
      PARTY.lineup = { mesh: lu, canvas: lc, key: '', next: 0 };
    }
    // a row of little lights along the front lip of the stage (they chase at the party)
    var ledN = 44, leds = new THREE.InstancedMesh(new THREE.BoxGeometry(S.w * 2 / ledN * 0.7, 0.07, 0.07), new THREE.MeshBasicMaterial({ color: 0xffffff }), ledN);
    for (var l = 0; l < ledN; l++) { m.makeTranslation(c.x - S.w + (l + 0.5) * S.w * 2 / ledN, 0.07, STAGE_N - 0.32); leds.setMatrixAt(l, m); leds.setColorAt(l, col.setHSL(l / ledN, 1, 0.3)); }
    fx.add(leds); PARTY.leds = leds;
    // the goal-post truss over the back of the stage: two towers and a beam, open so the DJ stays in sight
    var TR = '#b9c0ca', top = S.trussH;
    [-1, 1].forEach(function (sd) {
      var x = c.x + sd * S.trussX;
      truss(V(x, 0.1, S.trussZ), V(x, top, S.trussZ), 0.42, TR);
      statics.add(box(0.8, 0.1, 0.8, '#555a66', [x, 0.05, S.trussZ]));
      PARTY.obst.push(['r', x, S.trussZ, 0.45, 0.45]);
    });
    truss(V(c.x - S.trussX - 0.21, top + 0.21, S.trussZ), V(c.x + S.trussX + 0.21, top + 0.21, S.trussZ), 0.42, TR);
    // a flown line array hanging from the beam either side, curving down towards the crowd
    [-1, 1].forEach(function (sd) {
      var hang = group([c.x + sd * (S.trussX - 1.0), top - 0.05, S.trussZ + 0.25]);
      for (var k = 0; k < 6; k++) {
        var cab = box(1.0, 0.34, 0.62, '#1c1c24', [0, -0.25 - k * 0.36, k * k * 0.018]);
        cab.rotation.x = -k * 0.045;
        hang.add(cab);
      }
      hang.add(rod(V(0, 0, 0), V(0, 0.26, 0), 0.02, '#888'));
      statics.add(hang);
    });
    // moving heads hung under the beam, sweeping the field
    [-4.6, -1.7, 1.7, 4.6].forEach(function (dx, k) {
      var head = group([c.x + dx, top - 0.3, S.trussZ + 0.2]);
      head.add(box(0.34, 0.3, 0.34, '#2b2b33', [0, 0, 0]));
      fx.add(head);
      var cone2 = mesh(new THREE.ConeGeometry(1.25, 10, 18, 1, true), new THREE.MeshBasicMaterial({ color: [0xfff2b0, 0xb0e8ff, 0xffb0e0, 0xc8ffb0][k], transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      cone2.geometry.translate(0, -5, 0);
      cone2.position.copy(head.position).y -= 0.2;
      cone2.userData = { k: k * 3 };
      g.add(cone2); PARTY.spots.push(cone2);
    });
    // two light towers at the back of the field: scaffolding with a deck on top, lasers and a sky searchlight each
    var SC = '#9aa3ad', laserGeo = new THREE.CylinderGeometry(0.02, 0.02, 1, 5, 1, true); laserGeo.translate(0, 0.5, 0);
    var LCOL = ['#ff2d55', '#2dff6e', '#2dc8ff', '#ff2dd2'];
    var skyGeo = new THREE.CylinderGeometry(2.6, 0.22, 70, 14, 1, true); skyGeo.translate(0, 35, 0);
    function searchlight(x, y, z, k) {
      var sl = mesh(skyGeo, new THREE.MeshBasicMaterial({ color: 0xe8f2ff, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), [x, y, z]);
      sl.userData = { k: k };
      g.add(sl); PARTY.searchlights.push(sl);
    }
    var towerTops = [];
    [-1, 1].forEach(function (sd, t) {
      var x = c.x + S.fohX + sd * S.towerX, z = S.towerZ, H = S.towerH, w2 = 0.75;
      var legs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      legs.forEach(function (k) { statics.add(rod(V(x + k[0] * w2, 0, z + k[1] * w2), V(x + k[0] * w2, H, z + k[1] * w2), 0.05, SC)); });
      for (var lv = 1.8; lv < H; lv += 1.8) for (var e = 0; e < 4; e++) {
        var a2 = legs[e], b2 = legs[(e + 1) % 4];
        statics.add(rod(V(x + a2[0] * w2, lv, z + a2[1] * w2), V(x + b2[0] * w2, lv, z + b2[1] * w2), 0.035, SC));
        statics.add(rod(V(x + a2[0] * w2, lv - 1.8, z + a2[1] * w2), V(x + b2[0] * w2, lv, z + b2[1] * w2), 0.025, SC));
      }
      statics.add(box(w2 * 2 + 0.3, 0.12, w2 * 2 + 0.3, '#3a3d44', [x, H, z]));
      statics.add(box(0.7, 0.45, 0.5, '#2b2b33', [x, H + 0.3, z - 0.3]));
      PARTY.obst.push(['r', x, z, w2 + 0.1, w2 + 0.1]);
      towerTops.push(V(x, H + 0.1, z));
      for (var lb = 0; lb < 3; lb++) {                // lasers from the tower over the field, criss-crossing the other tower's
        var las = mesh(laserGeo, new THREE.MeshBasicMaterial({ color: LCOL[(lb + t) % 4], transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }), [x + (lb - 1) * 0.2, H + 0.45, z - 0.55]);
        las.userData = { k: lb + t * 3, bank: -sd };
        g.add(las); PARTY.lasers.push(las);
      }
      searchlight(x + sd * 0.3, H + 0.2, z + 0.3, t);
    });
    searchlight(c.x - S.trussX - 1.4, 0.3, S.trussZ - 1.2, 2);       // and two more behind the stage
    searchlight(c.x + S.trussX + 1.4, 0.3, S.trussZ - 1.2, 3);
    // festoon bulbs along the sides and the back of the field, on flag poles
    var bulbPos = [], wires = [];                       // (all the cables in one draw)
    function string(a, b2, sag, count) {
      for (var k = 0; k <= count; k++) {
        var t2 = k / count, p = V(a.x + (b2.x - a.x) * t2, a.y + (b2.y - a.y) * t2 - Math.sin(t2 * PI) * sag, a.z + (b2.z - a.z) * t2);
        if (k) wires.push(bulbPos[bulbPos.length - 1], p);
        bulbPos.push(p);
      }
    }
    var PY = 4.45, fz = [STAGE_N - 0.45, c.z - hz / 2, c.z, c.z + hz / 2, c.z + hz + 0.45], fxs = [-1, -0.5, 0, 0.5, 1];
    var left = fz.map(function (z) { return V(c.x - hx - 0.45, PY, z); }), right = fz.map(function (z) { return V(c.x + hx + 0.45, PY, z); });
    var back = fxs.map(function (k) { return V(c.x + k * (hx + 0.45), PY, c.z + hz + 0.45); });
    [left, back, right].forEach(function (line) { for (var e = 0; e + 1 < line.length; e++) string(line[e], line[e + 1], 0.45, 14); });
    var poles = [], seen = {};
    left.concat(back, right).forEach(function (p) { var key = p.x.toFixed(1) + ',' + p.z.toFixed(1); if (!seen[key]) { seen[key] = 1; poles.push(p); } });
    var FLAGC = ['#ff2bd6', '#20e3ff', '#b6ff2e', '#ff9a1f', '#8c5cff', '#ffe600'], corners = [];
    poles.forEach(function (p, k) {
      var corner = (Math.abs(Math.abs(p.x - c.x) - hx - 0.45) < 0.01) && (Math.abs(p.z - fz[0]) < 0.01 || Math.abs(p.z - fz[4]) < 0.01);
      statics.add(cyl(0.07, 0.08, corner ? 4.6 : 5.4, '#8a5f3a', [p.x, corner ? 2.3 : 2.7, p.z], 6));
      PARTY.obst.push(['c', p.x, p.z, 0.14]);
      if (corner) { corners.push(p); return; }
      // a feather flag on every other pole, waving
      var fl = group([p.x, 0, p.z]), sail = new THREE.Shape();
      sail.moveTo(0, 0); sail.quadraticCurveTo(0.95, 0.4, 0.75, 2.9); sail.quadraticCurveTo(0.35, 3.1, 0, 3.0); sail.lineTo(0, 0);
      var flag = mesh(new THREE.ShapeGeometry(sail, 8), new THREE.MeshBasicMaterial({ color: FLAGC[k % FLAGC.length], side: THREE.DoubleSide }), [0.08, 1.35, 0]);
      fl.add(flag);
      fl.rotation.y = Math.atan2(p.x - c.x, p.z - c.z) + PI / 2;
      fl.userData = { ph: k * 1.3, y: fl.rotation.y };
      fx.add(fl); PARTY.flags.push(fl);
    });
    var bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }), bulbPos.length);
    bulbPos.forEach(function (p, k) { m.makeTranslation(p.x, p.y, p.z); bulbs.setMatrixAt(k, m); bulbs.setColorAt(k, col.setHSL(k * 0.13 % 1, 0.6, 0.7)); });
    PARTY.bulbs = bulbs;
    fx.add(bulbs);
    // the sound desk at the back of the field, under a stretched sail
    (function () {
      var x = c.x + S.fohX, z = c.z + hz + 3.4, pts = [[-2.3, -1.7, 3.6], [2.3, -1.7, 2.5], [2.3, 1.7, 3.6], [-2.3, 1.7, 2.5]];
      pts.forEach(function (q) { statics.add(cyl(0.05, 0.06, q[2], '#8a5f3a', [x + q[0], q[2] / 2, z + q[1]], 6)); });
      var sg = new THREE.BufferGeometry(), N2 = 8, pos = [], idx = [];
      for (var a3 = 0; a3 <= N2; a3++) for (var b3 = 0; b3 <= N2; b3++) {       // a hypar: the sail's two high corners and two low ones
        var u2 = a3 / N2, v2 = b3 / N2, P = function (k) { return pts[k]; };
        var y = (1 - u2) * (1 - v2) * P(0)[2] + u2 * (1 - v2) * P(1)[2] + u2 * v2 * P(2)[2] + (1 - u2) * v2 * P(3)[2];
        pos.push(x - 2.3 + 4.6 * u2, y, z - 1.7 + 3.4 * v2);
        if (a3 < N2 && b3 < N2) { var i0 = a3 * (N2 + 1) + b3; idx.push(i0, i0 + 1, i0 + N2 + 1, i0 + 1, i0 + N2 + 2, i0 + N2 + 1); }
      }
      sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); sg.setIndex(idx); sg.computeVertexNormals();
      statics.add(new THREE.Mesh(sg, new THREE.MeshToonMaterial({ color: new THREE.Color('#ff4fb8'), side: THREE.DoubleSide })));
      var desk = group([x, 0, z]);
      desk.add(box(2.4, 0.95, 0.9, '#2d2d3a', [0, 0.475, 0]));
      desk.add(box(2.3, 0.08, 0.8, '#5a5a6c', [0, 0.99, -0.02]));
      statics.add(outline(desk));
      PARTY.obst.push(['r', x, z, 1.3, 0.55]);
    })();
    // balloons tied to the corner poles
    corners.forEach(function (p, k) {
      ['#ff5ea8', '#ffd84d', '#5ec8ff'].forEach(function (hex, j) {
        var b = group([p.x + (j - 1) * 0.4, 4.9 + j * 0.3, p.z]);
        b.add(sphere(0.34, hex, [0, 0, 0], [1, 1.2, 1], 12));
        b.add(cyl(0.006, 0.006, 0.9, '#eee', [0, -0.75, 0], 3));
        b.userData = { ph: k * 2 + j, y: b.position.y };
        g.add(b); PARTY.balloons.push(b);
      });
    });
    // the booth's fan of lasers over the crowd
    for (var lb2 = 0; lb2 < 6; lb2++) {
      var las2 = mesh(laserGeo, new THREE.MeshBasicMaterial({ color: LCOL[lb2 % 4], transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }), [DJ_SPOT.x + (lb2 - 2.5) * 0.22, 1.25, S.booth + 0.5]);
      las2.userData = { k: lb2, bank: 0 };
      g.add(las2); PARTY.lasers.push(las2);
    }
    // a spotlight from the sky on one dancer at a time: the dance-off
    var solo = mesh(new THREE.ConeGeometry(0.85, 8, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    solo.geometry.translate(0, -4, 0);
    solo.position.set(c.x, 8, c.z);
    g.add(solo); PARTY.solo = solo;
    var ring = mesh(new THREE.RingGeometry(0.42, 0.62, 28), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
    ring.rotation.x = -PI / 2; ring.position.set(c.x, 0.11, c.z);
    g.add(ring); PARTY.soloRing = ring;
    // a little low fog and dust over the field (never enough to hide anyone)
    var fogTex = new THREE.CanvasTexture((function () {
      var cv = document.createElement('canvas'); cv.width = cv.height = 64;
      var x = cv.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
      return cv;
    })());
    for (var f = 0; f < 14; f++) {
      var fs = new THREE.Sprite(new THREE.SpriteMaterial({ map: fogTex, color: new THREE.Color().setHSL(f / 14, 0.5, 0.78), transparent: true, opacity: 0.12, depthWrite: false }));
      fs.scale.set(5.0, 1.1, 1);
      fs.userData = { ph: f * 1.7, ox: rr(-hx + 1, hx - 1), oz: rr(-hz + 1, hz - 1) };
      g.add(fs); PARTY.fog.push(fs);
    }
    // confetti falling over the field
    var CN = 460, cg = new THREE.BufferGeometry(), cp = new Float32Array(CN * 3), cc = new Float32Array(CN * 3);
    PARTY.confettiSeeds = [];
    for (var q = 0; q < CN; q++) {
      PARTY.confettiSeeds.push([rr(-hx, hx), rr(0, 1), rr(-hz, hz), rr(0.35, 0.8)]);
      col.setHSL(R(), 0.85, 0.6); cc[q * 3] = col.r; cc[q * 3 + 1] = col.g; cc[q * 3 + 2] = col.b;
    }
    cg.setAttribute('position', new THREE.BufferAttribute(cp, 3));
    cg.setAttribute('color', new THREE.BufferAttribute(cc, 3));
    PARTY.confetti = new THREE.Points(cg, new THREE.PointsMaterial({ size: 0.12, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false }));
    PARTY.confetti.frustumCulled = false;
    g.add(PARTY.confetti);
    // music notes rising from the speaker stacks
    var noteTex = new THREE.CanvasTexture((function () {
      var cv = document.createElement('canvas'); cv.width = cv.height = 64;
      var x = cv.getContext('2d'); x.fillStyle = '#ffffff'; x.font = 'bold 54px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('♪', 32, 34);
      return cv;
    })());
    for (var nn = 0; nn < 8; nn++) {
      var sp2 = new THREE.Sprite(new THREE.SpriteMaterial({ map: noteTex, color: new THREE.Color().setHSL(nn / 8, 0.9, 0.65), transparent: true, depthWrite: false }));
      sp2.scale.setScalar(0.6);
      sp2.userData = { ph: nn / 8, side: nn % 2 ? 1 : -1 };
      g.add(sp2); PARTY.notes.push(sp2);
    }
    // flame jets along the front of the stage (they fire on the drops)
    [-8.2, -6.6, 6.6, 8.2].forEach(function (dx) {
      var x = c.x + dx, z = STAGE_N - 0.45;
      statics.add(box(0.5, 0.28, 0.5, '#202027', [x, 0.14, z]));
      statics.add(cyl(0.09, 0.11, 0.1, '#888', [x, 0.32, z], 8));
      PARTY.obst.push(['c', x, z, 0.36]);
      PARTY.jets.push(makeJet(x, z, 0.36, 4.6));
    });
    // confetti cannons on top of the truss towers, aimed over the crowd
    PARTY.cannons = [-1, 1].map(function (sd) {
      statics.add(rot(cyl(0.2, 0.24, 0.8, '#3a3d44', [c.x + sd * S.trussX, top + 0.75, S.trussZ + 0.1], 10), 0.7, 0, -sd * 0.5));
      return makeCannon(V(c.x + sd * S.trussX, top + 1.0, S.trussZ + 0.3), V(c.x - sd * 2, 0, CROWD_C.z + 2));
    });
  })();
  // The big wheel behind the stage: twelve gondolas on a lit rim, turning all day (the lights chase faster at the party)
  (function () {
    var W2 = WHEEL, hub = W2.r + 1.6, g = group([W2.x, 0, W2.z]), frame = '#e9eef4';
    [-1, 1].forEach(function (sz) {                     // an A-frame either side, up to the axle beyond the rims
      [-1, 1].forEach(function (sx) {
        var leg = cyl(0.12, 0.16, Math.hypot(3.6, hub, 0.5), frame, [sx * 1.8, hub / 2, sz * 1.25], 8);
        leg.rotation.z = sx * Math.atan2(3.6, hub); leg.rotation.x = -sz * Math.atan2(0.5, hub); g.add(leg);
      });
      g.add(box(7.6, 0.18, 0.24, frame, [0, 0.12, sz * 1.5]));
    });
    g.add(rot(cyl(0.22, 0.22, 2.2, '#9aa3ad', [0, hub, 0], 12), PI / 2));
    statics.add(outline(g));
    var rotG = group([W2.x, hub, W2.z]);
    [-0.55, 0.55].forEach(function (zz) {
      var rim = mesh(new THREE.TorusGeometry(W2.r, 0.09, 6, 64), frame, [0, 0, zz]); rotG.add(rim);
      var inner = mesh(new THREE.TorusGeometry(W2.r * 0.55, 0.06, 6, 40), frame, [0, 0, zz]); rotG.add(inner);
      for (var s = 0; s < 12; s++) { var a = s / 12 * TAU, sp = box(0.06, W2.r, 0.06, frame, [Math.cos(a) * W2.r / 2, Math.sin(a) * W2.r / 2, zz]); sp.rotation.z = a - PI / 2; rotG.add(sp); }
    });
    for (var s3 = 0; s3 < 12; s3++) { var a3 = s3 / 12 * TAU; rotG.add(rot(cyl(0.04, 0.04, 1.2, frame, [Math.cos(a3) * W2.r, Math.sin(a3) * W2.r, 0], 6), PI / 2)); }
    if (NevetHero.merge) NevetHero.merge(rotG, function () { return false; });
    scene.add(rotG); WHEEL_FX.rot = rotG;
    var BN = 48, bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.11, 6, 5), new THREE.MeshBasicMaterial({ color: 0xffffff }), BN * 2), m4 = new THREE.Matrix4(), c4 = new THREE.Color();
    for (var b = 0; b < BN * 2; b++) { var ab = (b % BN) / BN * TAU; m4.makeTranslation(Math.cos(ab) * W2.r, Math.sin(ab) * W2.r, b < BN ? 0.62 : -0.62); bulbs.setMatrixAt(b, m4); bulbs.setColorAt(b, c4.setHSL((b % BN) / BN, 0.9, 0.6)); }
    rotG.add(bulbs); WHEEL_FX.bulbs = bulbs; WHEEL_FX.n = BN;
    ['#ff6f61', '#ffd84d', '#4fc3f7', '#7dd36f', '#c58cff', '#ff9f43'].forEach(function (hex, k) {
      [0, 6].forEach(function (o) {
        var cab = group(), roof = hex;
        cab.add(box(0.9, 0.75, 0.8, '#f4efe4', [0, -0.85, 0]));
        cab.add(box(1.0, 0.12, 0.9, roof, [0, -0.42, 0])); cab.add(box(0.95, 0.3, 0.85, roof, [0, -1.15, 0]));
        cab.add(cyl(0.03, 0.03, 0.4, '#9aa3ad', [0, -0.2, 0], 5));
        if (NevetHero.merge) NevetHero.merge(cab, function () { return false; });
        cab.userData.a = (k + o) / 12 * TAU;
        scene.add(cab); WHEEL_FX.cabins.push(cab);
      });
    });
    WHEEL_FX.hub = hub;
  })();

  // ---------------------------------------------------------------- the play park, south of the dance field
  // A football pitch with goals and a scoreboard, swings, a slide, a seesaw, a trampoline, a sandbox with a
  // sandcastle and two kites, between the rows of hedges and trees. (The mud arena is in the middle of the farm.)
  var PLAY_OBST = [];
  var FB = { c: V(-10.5, 0, 25.5 + PDZ), hx: 7, hz: 4.2, mouth: 1.15, ball: null, v: V(0, 0, 0), score: [0, 0], resetAt: 0, idle: 0,
             kits: ['#e8473c', '#2f7be0'], names: ['Tomatoes', 'Blueberries'], board: null, banner: null, bannerAt: -9 };
  var SWING = { x: 8, z: 20.3 + PDZ, pivot: 2.45, seatY: 0.58, seats: [] };
  var SLIDE = { x: 14.6, top: 19.6 + PDZ, bottom: 24.4 + PDZ, h: 2.0, ladder: V(14.6, 0, 18.75 + PDZ), busyBy: null, busyUntil: 0 };
  var SEESAW = { c: V(8, 0, 27.2 + PDZ), half: 1.85, plank: null, angle: 0.3, seats: [] };
  var TRAMP = { c: V(14.6, 0, 29.4 + PDZ), r: 1.55, y: 0.62, mat: null, seats: [] };
  var SANDBOX = { c: V(5.2, 0, 31.6 + PDZ), castle: null, built: 0.25, seats: [] };
  var KITES = [], CHEER_SPOTS = [];
  (function () {
    var lineMat = mat('#ffffff');
    // the pitch: grass (or sand), white lines, two goals with nets
    var c = FB.c, hx = FB.hx, hz = FB.hz;
    var turf = mesh(new THREE.PlaneGeometry(hx * 2 + 1.6, hz * 2 + 1.6), WD.pitch); turf.rotation.x = -PI / 2; turf.position.set(c.x, 0.014, c.z); statics.add(turf);
    function line(x, z, w, d) { var l = mesh(new THREE.PlaneGeometry(w, d), lineMat); l.rotation.x = -PI / 2; l.position.set(x, 0.022, z); statics.add(l); }
    line(c.x, c.z - hz, hx * 2, 0.1); line(c.x, c.z + hz, hx * 2, 0.1); line(c.x - hx, c.z, 0.1, hz * 2); line(c.x + hx, c.z, 0.1, hz * 2); line(c.x, c.z, 0.1, hz * 2);
    var ring = mesh(new THREE.RingGeometry(1.15, 1.25, 32), lineMat); ring.rotation.x = -PI / 2; ring.position.set(c.x, 0.022, c.z); statics.add(ring);
    [-1, 1].forEach(function (sd) {
      line(c.x + sd * (hx - 1.1), c.z, 0.1, 3.4); line(c.x + sd * (hx - 0.55), c.z - 1.7, 1.1, 0.1); line(c.x + sd * (hx - 0.55), c.z + 1.7, 1.1, 0.1);
      var gl = group([c.x + sd * hx, 0, c.z]), post = '#f6f6f2';
      [-1, 1].forEach(function (e) { gl.add(cyl(0.06, 0.06, 1.3, post, [0, 0.65, e * FB.mouth], 8)); gl.add(cyl(0.035, 0.035, 1.35, '#d8d8d2', [sd * 0.8, 0.65, e * FB.mouth], 6)); });
      gl.add(rot(cyl(0.06, 0.06, FB.mouth * 2 + 0.1, post, [0, 1.3, 0], 8), PI / 2));
      var netM = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.55 });
      var back = mesh(new THREE.PlaneGeometry(FB.mouth * 2, 1.3, 9, 6), netM, [sd * 0.8, 0.65, 0]); back.rotation.y = PI / 2; gl.add(back);
      var top = mesh(new THREE.PlaneGeometry(0.8, FB.mouth * 2, 4, 9), netM, [sd * 0.4, 1.3, 0]); top.rotation.x = -PI / 2; gl.add(top);
      [-1, 1].forEach(function (e) { var side = mesh(new THREE.PlaneGeometry(0.8, 1.3, 4, 6), netM, [sd * 0.4, 0.65, e * FB.mouth]); gl.add(side); });
      statics.add(gl);
      PLAY_OBST.push(['c', c.x + sd * hx, c.z - FB.mouth, 0.12], ['c', c.x + sd * hx, c.z + FB.mouth, 0.12]);
    });
    // the ball
    var ball = group([c.x, 0.22, c.z]), inner = group(); ball.add(inner);
    inner.add(sphere(0.22, '#ffffff', [0, 0, 0], null, 14));
    [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].forEach(function (d) { inner.add(sphere(0.075, '#1f2522', [d[0] * 0.2, d[1] * 0.2, d[2] * 0.2], [d[0] ? 0.4 : 1, d[1] ? 0.4 : 1, d[2] ? 0.4 : 1], 8)); });
    ball.userData.inner = inner;
    if (NevetHero.merge) NevetHero.merge(inner, function () { return false; });
    scene.add(ball); FB.ball = ball;
    scene.add(FB.ballShadow = blobShadow(0.22));
    // scoreboard behind the pitch
    var sb = document.createElement('canvas'); sb.width = 512; sb.height = 160;
    var sbTex = new THREE.CanvasTexture(sb);
    FB.board = { canvas: sb, tex: sbTex };
    var board = group([c.x, 0, c.z - hz - 1.5]);
    [-1.5, 1.5].forEach(function (x) { board.add(cyl(0.07, 0.08, 2.2, '#5a5f66', [x, 1.1, 0], 6)); });
    board.add(box(3.4, 1.15, 0.12, '#22262b', [0, 2.6, -0.02]));
    var face2 = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.0), new THREE.MeshBasicMaterial({ map: sbTex })); face2.position.set(0, 2.6, 0.05); board.add(face2);
    statics.add(board);
    PLAY_OBST.push(['r', c.x, c.z - hz - 1.5, 1.7, 0.2]);
    var bn = textCanvas('GOAL!', { px: 72, bg: 'rgba(255,224,77,0.95)', color: '#c2185b', stroke: '#ffffff' });
    FB.banner = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(bn), transparent: true, opacity: 0 }));
    FB.banner.scale.set(2.4 * bn.width / bn.height, 2.4, 1); FB.banner.renderOrder = 22;
    scene.add(FB.banner);
    // benches and a few places to stand and cheer along the south line
    [-14.2, -6.8].forEach(function (bx) {
      var bench = group([bx, 0, c.z + hz + 2.4]);
      bench.add(box(2.2, 0.1, 0.5, '#b07a44', [0, 0.48, 0])); bench.add(box(2.2, 0.5, 0.08, '#b07a44', [0, 0.78, 0.24]));
      [-0.95, 0.95].forEach(function (lx) { bench.add(box(0.1, 0.48, 0.45, '#7a5233', [lx, 0.24, 0])); });
      statics.add(outline(bench));
      PLAY_OBST.push(['r', bx, c.z + hz + 2.4, 1.15, 0.3]);
    });
    for (var cs = 0; cs < 8; cs++) CHEER_SPOTS.push(V(c.x - 5.6 + cs * 1.6, 0, c.z + hz + 1.25));
    // swings: an A-frame and three seats on ropes (the seats swing with whoever sits on them)
    var sw = group([SWING.x, 0, SWING.z]), frame = '#4c9a5b', L = SWING.pivot - SWING.seatY;
    [-2.45, 2.45].forEach(function (x) {
      [-1, 1].forEach(function (e) { var leg = cyl(0.07, 0.08, Math.hypot(SWING.pivot, 0.95), frame, [x, SWING.pivot / 2, e * 0.475], 8); leg.rotation.x = -e * Math.atan2(0.95, SWING.pivot); sw.add(leg); });
      PLAY_OBST.push(['c', SWING.x + x, SWING.z - 0.95, 0.12], ['c', SWING.x + x, SWING.z + 0.95, 0.12]);
    });
    sw.add(rot(cyl(0.08, 0.08, 5.2, frame, [0, SWING.pivot, 0], 8), 0, 0, PI / 2));
    statics.add(outline(sw));
    [-1.35, 0, 1.35].forEach(function (x, i) {
      var seat = group([SWING.x + x, SWING.pivot, SWING.z]);
      [-0.27, 0.27].forEach(function (rx) { seat.add(cyl(0.015, 0.015, L, '#d8c8a8', [rx, -L / 2, 0], 4)); });
      seat.add(box(0.66, 0.06, 0.3, ['#ff6f61', '#ffd84d', '#4fc3f7'][i], [0, -L, 0]));
      if (NevetHero.merge) NevetHero.merge(seat, function () { return false; });
      scene.add(seat);
      SWING.seats.push({ kind: 'swing', mesh: seat, pos: V(SWING.x + x, 0, SWING.z), theta: 0, user: null, ph: i * 1.3 });
    });
    // slide: ladder up to a little platform, then a long chute
    var sl = group([SLIDE.x, 0, 0]), hgt = SLIDE.h, chute = { classic: '#ff7a3d', desert: '#e9845b', seaside: '#4fc3f7', forest: '#f2b33d' }[WORLD];
    [-0.35, 0.35].forEach(function (x) {
      sl.add(cyl(0.05, 0.05, hgt + 0.9, '#5a7fb3', [x, (hgt + 0.9) / 2, SLIDE.ladder.z + 0.45], 6));
      sl.add(cyl(0.06, 0.06, hgt, '#5a7fb3', [x, hgt / 2, SLIDE.top + 0.45], 6));
      sl.add(box(0.05, 0.5, 0.9, '#5a7fb3', [x, hgt + 0.3, SLIDE.top]));
    });
    for (var rg = 1; rg <= 5; rg++) sl.add(rot(cyl(0.03, 0.03, 0.7, '#c9d4e2', [0, rg * hgt / 5.5, SLIDE.ladder.z + 0.45], 5), 0, 0, PI / 2));
    sl.add(box(0.9, 0.1, 0.95, '#c9d4e2', [0, hgt, SLIDE.top]));
    var z0 = SLIDE.top + 0.45, z1 = SLIDE.bottom - 0.7, run = z1 - z0, drop = hgt - 0.35, len = Math.hypot(run, drop), ang = Math.atan2(drop, run);
    var inc = group([0, (hgt + 0.35) / 2, (z0 + z1) / 2]); inc.rotation.x = ang;
    inc.add(box(0.8, 0.06, len, chute, [0, 0, 0])); [-0.4, 0.4].forEach(function (x) { inc.add(box(0.06, 0.22, len, chute, [x, 0.1, 0])); });
    sl.add(inc);
    sl.add(box(0.8, 0.06, 0.75, chute, [0, 0.33, z1 + 0.37])); [-0.4, 0.4].forEach(function (x) { sl.add(box(0.06, 0.2, 0.75, chute, [x, 0.42, z1 + 0.37])); });
    sl.add(cyl(0.05, 0.05, 0.33, '#5a7fb3', [0, 0.16, z1 + 0.6], 6));
    statics.add(outline(sl));
    SLIDE.chuteY = function (z) { return z <= z0 ? hgt : z >= z1 ? 0.36 : hgt - (z - z0) / run * drop + 0.02; };
    PLAY_OBST.push(['r', SLIDE.x, (SLIDE.top + SLIDE.bottom) / 2, 0.55, (SLIDE.bottom - SLIDE.top) / 2]);
    // seesaw
    var ss = group([SEESAW.c.x, 0, SEESAW.c.z]);
    ss.add(box(0.4, 0.5, 0.5, '#7a5233', [0, 0.25, 0]));
    statics.add(outline(ss));
    var plank = group([SEESAW.c.x, 0.55, SEESAW.c.z]);
    plank.add(box(SEESAW.half * 2 + 0.3, 0.08, 0.32, '#e1c25f', [0, 0, 0]));
    [-1, 1].forEach(function (e) { plank.add(cyl(0.03, 0.03, 0.45, '#c0392b', [e * (SEESAW.half - 0.35), 0.24, 0], 6)); plank.add(rot(cyl(0.03, 0.03, 0.4, '#c0392b', [e * (SEESAW.half - 0.35), 0.45, 0], 6), PI / 2)); });
    outline(plank); if (NevetHero.merge) NevetHero.merge(plank, function () { return false; }); scene.add(plank); SEESAW.plank = plank;
    [1, -1].forEach(function (side) { SEESAW.seats.push({ kind: 'seesaw', side: side, pos: V(SEESAW.c.x + side * SEESAW.half, 0, SEESAW.c.z), user: null }); });
    PLAY_OBST.push(['c', SEESAW.c.x, SEESAW.c.z, 0.35]);
    // trampoline
    var tp = group([TRAMP.c.x, 0, TRAMP.c.z]);
    var rim = mesh(new THREE.TorusGeometry(TRAMP.r, 0.12, 8, 30), '#2f7be0', [0, TRAMP.y, 0]); rim.rotation.x = PI / 2; tp.add(rim);
    for (var lg = 0; lg < 6; lg++) { var la = lg / 6 * TAU; tp.add(cyl(0.05, 0.05, TRAMP.y, '#5a5f66', [Math.cos(la) * TRAMP.r, TRAMP.y / 2, Math.sin(la) * TRAMP.r], 6)); }
    statics.add(outline(tp));
    var tmat = mesh(new THREE.CircleGeometry(TRAMP.r - 0.06, 28), mat('#22262b', { side: THREE.DoubleSide }), [TRAMP.c.x, TRAMP.y - 0.02, TRAMP.c.z]); tmat.rotation.x = -PI / 2;
    scene.add(tmat); TRAMP.mat = tmat;
    [PI * 0.75, PI * 0.25].forEach(function (a) {
      TRAMP.seats.push({ kind: 'tramp', user: null, inner: V(TRAMP.c.x + Math.cos(a) * 0.6, 0, TRAMP.c.z - Math.sin(a) * 0.6),
                         pos: V(TRAMP.c.x + Math.cos(a) * 2.2, 0, TRAMP.c.z - Math.sin(a) * 2.2) });
    });
    PLAY_OBST.push(['c', TRAMP.c.x, TRAMP.c.z, TRAMP.r + 0.1]);
    // sandbox with a bucket, a spade and a sandcastle that grows while the heroes dig
    var sbx = group([SANDBOX.c.x, 0, SANDBOX.c.z]);
    [[0, -1.3, 2.7, 0.14], [0, 1.3, 2.7, 0.14], [-1.3, 0, 0.14, 2.7], [1.3, 0, 0.14, 2.7]].forEach(function (b) { sbx.add(box(b[2], 0.28, b[3], '#b07a44', [b[0], 0.14, b[1]])); });
    sbx.add(box(2.5, 0.16, 2.5, '#efdcaa', [0, 0.08, 0]));
    sbx.add(cyl(0.16, 0.12, 0.26, '#e8473c', [0.75, 0.29, -0.6], 10));
    sbx.add(rot(box(0.08, 0.05, 0.6, '#2f7be0', [-0.7, 0.2, 0.6]), 0, 0.6, 0));
    statics.add(outline(sbx));
    var castle = group([SANDBOX.c.x, 0.16, SANDBOX.c.z - 0.1]);
    castle.add(box(0.8, 0.35, 0.8, '#e2c98f', [0, 0.17, 0]));
    [[-0.38, -0.38], [0.38, -0.38], [-0.38, 0.38], [0.38, 0.38]].forEach(function (t) { castle.add(cyl(0.13, 0.15, 0.55, '#e2c98f', [t[0], 0.27, t[1]], 8)); castle.add(cone(0.15, 0.22, '#d9b97a', [t[0], 0.65, t[1]], 8)); });
    castle.add(cyl(0.02, 0.02, 0.4, '#7a5233', [0, 0.55, 0], 4)); castle.add(box(0.22, 0.13, 0.01, '#e8473c', [0.11, 0.68, 0]));
    if (NevetHero.merge) NevetHero.merge(castle, function () { return false; });
    castle.scale.setScalar(SANDBOX.built);
    scene.add(castle); SANDBOX.castle = castle;
    [[-1.75, 0], [1.75, 0], [0, 1.75]].forEach(function (o) { SANDBOX.seats.push({ kind: 'sandbox', user: null, pos: V(SANDBOX.c.x + o[0], 0, SANDBOX.c.z + o[1]) }); });
    PLAY_OBST.push(['r', SANDBOX.c.x, SANDBOX.c.z, 1.38, 1.38]);
    // two kites high over the park
    [[17.8, 33.2 + PDZ, '#ff5ea8', 0], [-18.4, 32.8 + PDZ, '#ffd84d', 2.3]].forEach(function (k) {
      var kite = group(), sh = new THREE.Shape();
      sh.moveTo(0, 0.9); sh.lineTo(0.6, 0); sh.lineTo(0, -1.1); sh.lineTo(-0.6, 0); sh.lineTo(0, 0.9);
      kite.add(mesh(new THREE.ShapeGeometry(sh), mat(k[2], { side: THREE.DoubleSide })));
      kite.add(box(0.03, 2.0, 0.03, '#7a5233', [0, -0.1, 0.02])); kite.add(box(1.2, 0.03, 0.03, '#7a5233', [0, 0, 0.02]));
      for (var b2 = 0; b2 < 4; b2++) kite.add(mesh(new THREE.PlaneGeometry(0.22, 0.12), mat(['#4fc3f7', '#ffffff'][b2 % 2], { side: THREE.DoubleSide }), [Math.sin(b2) * 0.1, -1.4 - b2 * 0.45, 0]));
      if (NevetHero.merge) NevetHero.merge(kite, function () { return false; });
      scene.add(kite);
      var stake = V(k[0], 0.1, k[1]), str = new THREE.Line(new THREE.BufferGeometry().setFromPoints([stake, stake]), new THREE.LineBasicMaterial({ color: 0xf4efe4 }));
      scene.add(str);
      statics.add(cyl(0.04, 0.04, 0.5, '#7a5233', [k[0], 0.25, k[1]], 5));
      KITES.push({ kite: kite, str: str, stake: stake, ph: k[3] });
    });
    // a sign at the park's way in
    var sign = group([2.9, 0, PLAY.minZ + 1.4], -0.3);
    sign.add(cyl(0.07, 0.07, 1.9, '#8a5f3a', [0, 0.95, 0], 6));
    var sp = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.55), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(textCanvas('⚽ Play park', { px: 40, bg: '#f3e6c8', color: '#5a3d22', radius: 10, stroke: '#8a5f3a' })), side: THREE.DoubleSide }));
    sp.position.set(0, 1.75, 0.08); sign.add(sp);
    statics.add(sign);
    PLAY_OBST.push(['c', 2.9, PLAY.minZ + 1.4, 0.15]);
  })();

  // ---------------------------------------------------------------- the mud arena: build
  // A gladiators' mud arena around the fire pit in the middle of the farm, as big as the farm's crowd needs: a mud
  // floor, a low sandstone wall with four gates, marble columns with torches, an arch over each gate (the north one
  // carries the board), banners and shields, and eight braziers round the outside that shoot flames on the big
  // moments. At the Campfire dance everyone dances round it while three at a time wrestle in the mud: the station's
  // tournament (games.py, /api/games/now?mode=campfire), the same for everyone watching, every grab and throw kept as
  // stats. Gladiators' tents stand in the east meadow. It's built from parts that fold (see "the folding arena").
  var RING = { c: V(FIRE.x, 0, FIRE.z), wall: ARENA_W, inner: 1.75 * FIRE_K, fight: ARENA_W - 0.7, h: 0, phase: 'idle', fighters: [], bout: null,
               colors: ['#e8473c', '#2f7be0', '#f2b33d'], floor: null, board: null, banner: null, bannerAt: -9, bannerY: 5.4, pops: [],
               torches: [], braziers: [], evI: 0, pending: [], points: {}, styleId: 'mud', ready: false, ceremony: false, nextJet: 0, nextWork: 0 };
  var RING_SIDES = [0, TAU / 3, -TAU / 3];             // the three corners: east, south-west and north-west
  var ARENA_GATES = [-PI / 2, 0, PI / 2, PI], GATE_HALF = 1.55 / ARENA_W;   // north, east, south and west, about 3 m wide
  var START_R = (RING.inner + RING.fight) / 2;
  RING.starts = RING_SIDES.map(function (a) { return V(RING.c.x + Math.cos(a) * START_R, 0, RING.c.z + Math.sin(a) * START_R); });
  var CAMP = { r: CAMP_R, rot: 0, inward: 0 };          // the dance ring round the arena
  var ARENA_OBST = [];
  var RING_STYLES = [                                  // (the gear and moves for other styles are kept in addGear and ringStance)
    { id: 'mud', name: 'Mud wrestling', reach: 0.75, speed: 1.3, impact: 0.3, kb: 2.6, pow: ['SPLAT!', 'SPLOSH!', 'GLOOP!', 'SPLODGE!'] }
  ];
  function ringStyle() { for (var i = 0; i < RING_STYLES.length; i++) if (RING_STYLES[i].id === RING.styleId) return RING_STYLES[i]; return RING_STYLES[0]; }
  var RING_TEX = {};
  function ringFloorTex(id) {                          // the arena's floor (the fire pit in the middle)
    if (RING_TEX[id]) return RING_TEX[id];
    var cv = document.createElement('canvas'); cv.width = cv.height = 1024;
    var g = cv.getContext('2d'), m = 512, px = 512 / RING.wall, rs = rng(id.length * 97 + 5);
    function circle(r, color, w) { g.beginPath(); g.arc(m, m, r * px, 0, TAU); g.strokeStyle = color; g.lineWidth = w; g.stroke(); }
    function blob(x, y, rx, ry, color) { g.beginPath(); g.ellipse(x, y, rx, ry, rs() * PI, 0, TAU); g.fillStyle = color; g.fill(); }
    var gr = g.createRadialGradient(m, m, 40, m, m, 512);
    gr.addColorStop(0, '#4f331b'); gr.addColorStop(0.9, '#5e3e22'); gr.addColorStop(0.95, '#b8935c'); gr.addColorStop(1, '#d8b98a');
    g.fillStyle = gr; g.fillRect(0, 0, 1024, 1024);
    var span = RING.wall - 0.6 - RING.inner;
    for (var j = 0; j < 560; j++) { var a = rs() * TAU, r = (RING.inner + rs() * span) * px; blob(m + Math.cos(a) * r, m + Math.sin(a) * r, 8 + rs() * 30, 6 + rs() * 18, rs() < 0.5 ? '#41290f' : '#6e4a2a'); }
    for (var q = 0; q < 300; q++) { var a2 = rs() * TAU, r2 = (RING.inner + rs() * span) * px; blob(m + Math.cos(a2) * r2, m + Math.sin(a2) * r2, 3 + rs() * 14, 2 + rs() * 6, 'rgba(255,255,255,0.18)'); }   // wet shine
    RING_SIDES.forEach(function (a, i) {                // each corner's mark, in its colour
      var x = m + Math.cos(a) * START_R * px, y = m + Math.sin(a) * START_R * px;
      g.beginPath(); g.arc(x, y, 30, 0, TAU); g.strokeStyle = RING.colors[i]; g.lineWidth = 10; g.stroke();
    });
    circle(1.05 * FIRE_K, 'rgba(60,40,25,0.55)', 24);  // scorched round the fire
    var t = new THREE.CanvasTexture(cv);
    RING_TEX[id] = t;
    return t;
  }
  // ---------------------------------------------------------------- the folding arena
  // The arena folds itself up for the party, like a Transformer, and opens again for the mud pit. FOLD.t runs from 0
  // (open: the mud pit) to 1 (folded: a fire tower in the middle of the dance field), and every part follows it with
  // its own delay: the gate arches, the torch columns and the braziers screw down into the ground, the eight wall
  // sections unlock, swing upright one after another and slide in to lock round the middle, a column rises from the
  // fire pit and lifts the campfire to the top of the tower, and the dance floor's panels flip over the mud from the
  // rim in. Back to the mud pit, the same in reverse.
  var FOLD = { t: 0, want: 0, dur: 5.2, sectors: [], sinkers: [], pedestal: null, top: 5.6, fireY: 0, fireK: 1, tiles: [],
               locked: [], fader: null, faderSpheres: null, settled: -1 };
  (function () {
    var c = RING.c, W = RING.wall, stone = '#d4bb8f', cap = '#b59a6c', marble = '#efe6d2', bronze = '#8c5a2b';
    var root = group(), parts = new Set();
    scene.add(root); FOLD.root = root;
    RING.floor = new THREE.MeshToonMaterial({ color: 0xffffff, map: ringFloorTex('mud') });
    var fl = new THREE.Mesh(new THREE.CircleGeometry(W - 0.05, 96), RING.floor);
    fl.rotation.x = -PI / 2; fl.position.set(c.x, 0.06, c.z); scene.add(fl);       // (just above the dance field's base)
    function inGate(a) { return ARENA_GATES.some(function (gA) { return Math.abs(((a - gA + PI * 3) % TAU) - PI) < GATE_HALF; }); }
    function wrap(a) { return ((a + PI * 3) % TAU) - PI; }
    // the wall: eight sections, two between each pair of gates
    var gates = ARENA_GATES.slice().sort(function (p, q) { return p - q; });
    gates.forEach(function (gA, gi) {
      var from = gA + GATE_HALF, to = (gi < gates.length - 1 ? gates[gi + 1] : gates[0] + TAU) - GATE_HALF, mid = (from + to) / 2;
      [[from, mid], [mid, to]].forEach(function (span) {
        var as = (span[0] + span[1]) / 2, sg = group();
        sg.rotation.order = 'YXZ';
        sg.userData = { a: as, half: (span[1] - span[0]) / 2, len: W * (span[1] - span[0]) };
        root.add(sg); parts.add(sg); FOLD.sectors.push(sg);
      });
    });
    function sectorOf(a) {
      for (var i = 0; i < FOLD.sectors.length; i++) { var u = FOLD.sectors[i].userData; if (Math.abs(wrap(a - u.a)) <= u.half + 1e-6) return FOLD.sectors[i]; }
      return null;
    }
    function onSector(sg, a, r, y, obj) {               // a piece of wall at angle a, radius r, height y, in its section's own frame
      var d = wrap(a - sg.userData.a);
      obj.position.set(r * Math.cos(d) - W, y - 0.48, r * Math.sin(d)); obj.rotation.y = -d;
      sg.add(obj);
    }
    var N = Math.round(TAU * W / 0.68);                 // the wall, in sandstone blocks with a darker cap
    for (var i = 0; i < N; i++) {
      var a = (i + 0.5) / N * TAU;
      if (inGate(a)) continue;
      var sg = sectorOf(a);
      if (!sg) continue;
      var len = TAU * W / N + 0.03;
      onSector(sg, a, W, 0.43, box(0.46, 0.86, len, i % 3 ? stone : '#cbb086'));
      onSector(sg, a, W, 0.91, box(0.58, 0.11, len + 0.02, cap));
    }
    var NO = Math.round(TAU * W / 0.3);
    for (var o = 0; o < NO; o++) {                      // heroes walk round the wall (and in through the gates) while it's open
      var ao = o / NO * TAU;
      if (!inGate(ao)) ARENA_OBST.push([c.x + Math.cos(ao) * W, c.z + Math.sin(ao) * W, 0.32, 'open']);
    }
    for (var si = 0; si < 16; si++) {                   // round shields on the wall
      var sa = (si + 0.5) * PI / 8 + (si % 2 ? 0.1 : -0.1), ssg = sectorOf(sa);
      if (inGate(sa) || !ssg) continue;
      var sh = group();
      var disc = cyl(0.3, 0.3, 0.05, RING.colors[si % 3], [0, 0, 0], 16); disc.rotation.z = PI / 2; sh.add(disc);
      sh.add(sphere(0.09, '#d9c27a', [0.03, 0, 0]));
      onSector(ssg, sa, W + 0.26, 0.52, sh);
    }
    FOLD.sectors.forEach(function (sg) { outline(sg); });
    // the parts that screw down into the ground: torch columns, gate arches, braziers
    function sinker(g, depth, delay, twist, flames) {
      root.add(g); parts.add(g);
      FOLD.sinkers.push({ g: g, depth: depth, delay: delay, twist: twist, flames: flames || [], y0: g.position.y });
      return g;
    }
    function column(a, torch, into) {
      var x = c.x + Math.cos(a) * (W + 0.05), z = c.z + Math.sin(a) * (W + 0.05), col = group(into ? [x - into.position.x, 0, z - into.position.z] : [x, 0, z]);
      col.add(box(0.7, 0.3, 0.7, cap, [0, 0.15, 0]));
      col.add(cyl(0.25, 0.29, 2.9, marble, [0, 1.75, 0], 14));
      for (var f = 0; f < 8; f++) { var fa = f / 8 * TAU; col.add(cyl(0.035, 0.035, 2.8, marble, [Math.cos(fa) * 0.26, 1.75, Math.sin(fa) * 0.26], 4)); }   // fluting
      col.add(box(0.76, 0.22, 0.76, cap, [0, 3.3, 0]));
      var flames = [];
      if (torch) {
        col.add(cyl(0.36, 0.2, 0.28, bronze, [0, 3.55, 0], 12));
        var tf = flameBoard(0.9, 1.3, 1.25, a * 7.3);   // the same shader flames as the campfire
        tf.position.set(x, 3.6, z); tf.userData.off = null; scene.add(tf); RING.torches.push(tf);
        flames.push({ f: tf, y: 3.6 });
      }
      outline(col);
      if (into) into.add(col);
      ARENA_OBST.push([x, z, 0.42, 'open']);
      return { p: V(x, 0, z), g: col, flames: flames };
    }
    ARENA_GATES.forEach(function (gA, k) {             // an arch over each gate, with columns either side
      var north = gA === -PI / 2, arch = group([c.x + Math.cos(gA) * W, 0, c.z + Math.sin(gA) * W]);
      var l = column(gA - GATE_HALF - 0.05, north, arch), r = column(gA + GATE_HALF + 0.05, north, arch);
      var mid = l.p.clone().add(r.p).multiplyScalar(0.5), span = l.p.distanceTo(r.p) + 0.8, ax = arch.position.x, az = arch.position.z;
      var lintel = box(span, 0.4, 0.6, cap, [mid.x - ax, 3.62, mid.z - az]); lintel.rotation.y = -gA + PI / 2; arch.add(outline(lintel));
      if (gA === PI / 2 || gA === PI) {                 // the south and west gates: the arena's name, readable from both sides
        var nameTex = new THREE.CanvasTexture(textCanvas('NEVET ARENA', { px: 44, bg: '#3a2a1a', color: '#ffd84d', radius: 6 }));
        [0.32, -0.32].forEach(function (off, kk) {
          var nm = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 0.54), new THREE.MeshBasicMaterial({ map: nameTex }));
          nm.position.set(mid.x - ax + Math.cos(gA) * off, 3.62, mid.z - az + Math.sin(gA) * off); nm.rotation.y = -gA + PI / 2 + (kk ? PI : 0); arch.add(nm);
        });
      }
      if (north) {                                      // the board over the north gate (seen across the arena from the usual view)
        var cv = document.createElement('canvas'); cv.width = 512; cv.height = 220;
        RING.board = { canvas: cv, tex: new THREE.CanvasTexture(cv) };
        [0, PI].forEach(function (flip) {
          var face2 = new THREE.Mesh(new THREE.PlaneGeometry(3.3, 1.42), new THREE.MeshBasicMaterial({ map: RING.board.tex }));
          face2.position.set(Math.cos(gA) * (flip ? -0.3 : 0.3), 4.55, Math.sin(gA) * (flip ? -0.3 : 0.3));
          face2.rotation.y = -gA + PI / 2 + flip; arch.add(face2);
        });
        arch.add(box(3.55, 1.6, 0.56, '#22262b', [0, 4.55, 0]));
      }
      sinker(arch, north ? 5.6 : 4.2, 0.02 + k * 0.035, false, l.flames.concat(r.flames));
    });
    for (var ci = 0; ci < 8; ci++) {                    // columns with torches between the gates, and banners hanging outside
      var ca = (ci + 0.5) * PI / 4, cl = column(ca, true);
      var ban = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.6), new THREE.MeshToonMaterial({ color: new THREE.Color(ci % 2 ? '#b8202a' : '#d9a21b'), side: THREE.DoubleSide }));
      ban.position.set(Math.cos(ca) * 0.34, 2.2, Math.sin(ca) * 0.34); ban.rotation.y = -ca + PI / 2; cl.g.add(ban);
      sinker(cl.g, 3.75, 0.05 + ci * 0.022, true, cl.flames);
    }
    for (var bi = 0; bi < 8; bi++) {                    // braziers round the outside: a small fire always, a flame jet on the big moments
      var ba = (bi + 0.5) * PI / 4, bx2 = c.x + Math.cos(ba) * (W + 3.4), bz2 = c.z + Math.sin(ba) * (W + 3.4), br = group([bx2, 0, bz2]);
      br.add(cyl(0.34, 0.46, 1.05, '#9a8a72', [0, 0.52, 0], 10));
      br.add(cyl(0.6, 0.3, 0.38, bronze, [0, 1.22, 0], 14));
      outline(br);
      var bf = flameBoard(0.85, 1.05, 1.1, ba * 5.1);
      bf.position.set(bx2, 1.3, bz2); bf.userData.off = null; scene.add(bf); RING.torches.push(bf);
      RING.braziers.push(makeJet(bx2, bz2, 1.3, 5.4));
      ARENA_OBST.push([bx2, bz2, 0.62, 'open']);
      sinker(br, 1.75, 0.0 + bi * 0.02, true, [{ f: bf, y: 1.3 }]);
    }
    // the column that lifts the campfire to the top of the tower (hidden in the fire pit while the arena is open)
    var ped = group();
    ped.add(cyl(1.15, 1.35, FOLD.top, bronze, [0, -FOLD.top / 2 - 0.3, 0], 18));
    for (var rb = 0; rb < 6; rb++) ped.add(cyl(1.42, 1.42, 0.16, '#6a4422', [0, -0.9 - rb * 0.92, 0], 18));        // bands round it
    ped.add(cyl(2.05, 1.25, 0.42, '#7a4a24', [0, -0.21, 0], 22));                                              // the fire bowl
    ped.add(cyl(2.12, 2.12, 0.1, '#c08a3e', [0, -0.02, 0], 22));
    ped.position.set(c.x, -0.4, c.z);
    root.add(ped); parts.add(ped); FOLD.pedestal = ped;
    outline(ped);
    if (NevetHero.merge) NevetHero.merge(root, function (o) { return parts.has(o); });
    // gladiators' tents in the east meadow, striped, with flags, facing the arena
    [[25.5, -6.5, '#e8473c'], [27.2, 0, '#2f7be0'], [25.5, 6.5, '#f2b33d']].forEach(function (t, k) {
      var tx = t[0], tz = c.z + t[1], tg = group([tx, 0, tz], -PI / 2 + t[1] * 0.04);
      var stripes = [mat(t[2], { side: THREE.DoubleSide }), mat('#f4efe4', { side: THREE.DoubleSide })];
      for (var st = 0; st < 10; st++) tg.add(mesh(new THREE.CylinderGeometry(1.9, 1.9, 1.5, 2, 1, true, st / 10 * TAU, TAU / 10), stripes[st % 2], [0, 0.75, 0]));
      tg.add(cone(2.15, 1.9, t[2], [0, 2.45, 0], 10));
      tg.add(cyl(0.04, 0.04, 1.3, '#7a5233', [0, 3.9, 0], 5));
      tg.add(box(0.7, 0.42, 0.02, t[2], [0.36, 4.3, 0]));
      tg.add(box(0.9, 1.25, 0.04, '#3a2a1a', [0, 0.62, 1.9]));
      statics.add(tg);
      ARENA_OBST.push([tx, tz, 2.0]);
    });
    // the banner over the arena (ROUND 1 · BOUT 2!, ... WINS!) and the comic pops (SPLAT!)
    RING.banner = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, opacity: 0, depthTest: false }));
    RING.banner.renderOrder = 22; RING.banner.visible = false; scene.add(RING.banner);
    for (var k = 0; k < 4; k++) {
      var sp = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, opacity: 0, depthTest: false }));
      sp.renderOrder = 23; sp.visible = false; scene.add(sp);
      RING.pops.push({ s: sp, at: -9 });
    }
    var starC = textCanvas('★ ★ ★', { px: 40, bg: 'rgba(0,0,0,0)', color: '#ffd84d', pad: 6 });
    RING.starTex = new THREE.CanvasTexture(starC); RING.starAspect = starC.width / starC.height;
    setRingStyle('mud');
  })();
  function setRingStyle(id) {
    RING.styleId = id;
    RING.floor.map = ringFloorTex(id); RING.floor.needsUpdate = true;
    drawRingBoard();
  }
  function drawRingBoard() {
    var b = RING.board, g = b.canvas.getContext('2d'), st = ringStyle(), m = RING.bout;
    g.fillStyle = '#1a1d21'; g.fillRect(0, 0, 512, 220);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#ffd84d'; g.font = 'bold 38px sans-serif'; g.fillText('🔥 MUD ARENA 🔥', 256, 38);
    var line = !m ? 'Next bout soon' : m.style === 'ceremony' ? '🏆 Grand champion' : m.stage === 'final' ? 'THE FINAL' : m.stage === 'semi' ? 'Final three' : 'Round ' + m.round + ' · bout ' + m.bout + '/' + m.bouts;
    g.fillStyle = '#ffffff'; g.font = 'bold 44px sans-serif'; g.fillText(line, 256, 100);
    if (m && m.style === 'ceremony') { g.fillStyle = '#ffd84d'; g.font = 'bold 40px sans-serif'; g.fillText(m.champion_name || '?', 256, 168); }
    else if (m) {
      var w = 512 / m.fighters.length;
      m.fighters.forEach(function (f, i) {
        g.fillStyle = RING.colors[f.corner]; g.font = 'bold 30px sans-serif';
        var nm = f.name.length > 9 ? f.name.slice(0, 8) + '…' : f.name;
        g.fillText(nm + ' ' + (RING.points[f.id] || 0), w * (i + 0.5), 170);
      });
    } else { g.fillStyle = '#9aa3ab'; g.font = '28px sans-serif'; g.fillText('three at a time wrestle round the fire', 256, 170); }
    b.tex.needsUpdate = true;
  }
  function ringBanner(text, color, now) {
    var cv = textCanvas(text, { px: 64, bg: 'rgba(255,224,77,0.96)', color: color || '#c2185b', stroke: '#ffffff' });
    if (RING.banner.material.map) RING.banner.material.map.dispose();
    RING.banner.material.map = new THREE.CanvasTexture(cv); RING.banner.material.needsUpdate = true;
    var bh = camera.aspect < 0.8 ? 1.7 : 2.7;           // (narrower on a phone held upright)
    RING.banner.scale.set(bh * cv.width / cv.height, bh, 1);
    RING.bannerAt = now;
  }
  function ringPop(text, pos, color, now) {
    var p = RING.pops.reduce(function (a, b) { return a.at < b.at ? a : b; });
    var cv = textCanvas(text, { px: 56, bg: 'rgba(255,255,255,0.95)', color: color, stroke: color, radius: 18 });
    if (p.s.material.map) p.s.material.map.dispose();
    p.s.material.map = new THREE.CanvasTexture(cv); p.s.material.needsUpdate = true;
    p.s.scale.set(1.15 * cv.width / cv.height, 1.15, 1);
    p.s.position.copy(pos); p.base = pos.y; p.at = now; p.s.visible = true;
  }
  function drawScore() {
    var b = FB.board, g = b.canvas.getContext('2d');
    g.fillStyle = '#1a1d21'; g.fillRect(0, 0, 512, 160);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    [0, 1].forEach(function (t) {
      var x = t ? 416 : 96;
      g.fillStyle = FB.kits[t]; g.fillRect(x - 74, 22, 148, 32);
      g.fillStyle = '#ffffff'; g.font = 'bold 24px -apple-system, Segoe UI, Roboto, sans-serif'; g.fillText(FB.names[t], x, 39);
      g.fillStyle = '#ffe14d'; g.font = 'bold 76px "Courier New", monospace'; g.fillText(String(FB.score[t]), x, 110);
    });
    g.fillStyle = '#ffffff'; g.font = 'bold 60px -apple-system, Segoe UI, Roboto, sans-serif'; g.fillText(':', 256, 104);
    g.font = 'bold 22px -apple-system, Segoe UI, Roboto, sans-serif'; g.fillStyle = '#9fd39a'; g.fillText('NEVET CUP', 256, 38);
    b.tex.needsUpdate = true;
  }
  drawScore();

  // Chickens pecking around the barn
  var chickens = [];
  (function () {
    for (var i = 0; i < 4; i++) {
      var c = group([yx(rr(-13.2, -10.8)), 0, yz(rr(-4.5, 0))]);   // (round the barn door, in the yard)
      c.scale.setScalar(YS);
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
      scene.add(c.userData.shadow = blobShadow(0.3 * YS));
    }
  })();

  // Wild rabbits: the farm is open, so the neighbours drop by. They hop about the meadows and the farm's edges, and
  // scamper off when a hero comes close.
  var rabbits = [];
  (function () {
    var homes = [[-60, -22, 17, 32], [22, 32, 17, 58], [-60, -22, 57.5, 60.6], [22, 60, 57.5, 60.6]];    // the meadows and the field edges
    for (var i = 0; i < 8; i++) {
      var hm = homes[i % 4], fur = ['#f4efe6', '#b08a62', '#8f7a66'][i % 3], rb = group([rr(hm[0], hm[1]), 0, rr(hm[2], hm[3])]);
      var body = group(); rb.add(body);
      body.add(sphere(0.2, fur, [0, 0.2, -0.02], [0.9, 0.85, 1.2], 9));
      body.add(sphere(0.13, fur, [0, 0.37, 0.18], null, 9));
      [-1, 1].forEach(function (sd) {
        body.add(rot(sphere(0.045, fur, [sd * 0.05, 0.57, 0.14], [1, 3.4, 0.7], 6), -0.3, 0, sd * 0.2));
        body.add(sphere(0.022, '#1f2522', [sd * 0.075, 0.41, 0.27], null, 6));
      });
      body.add(sphere(0.07, '#ffffff', [0, 0.25, -0.25], null, 6));
      outline(body, 1.05);
      if (NevetHero.merge) NevetHero.merge(rb, function () { return false; });
      rb.userData = { home: hm, target: rb.position.clone(), next: 0, ph: rr(0, TAU), body: body, fast: false };
      rabbits.push(rb); scene.add(rb);
      scene.add(rb.userData.shadow = blobShadow(0.22));
    }
  })();
  function stepRabbits(now, dt) {
    rabbits.forEach(function (rb) {
      var u = rb.userData, hm = u.home, p = rb.position, near = null, nd = 10;
      heroes.forEach(function (h) { var d = h.root.position.distanceToSquared(p); if (d < nd) { nd = d; near = h; } });
      if (near && now > (u.fled || 0)) {               // a hero: off we go
        var away = V(p.x - near.root.position.x, 0, p.z - near.root.position.z).normalize().multiplyScalar(rr(4, 7));
        u.target.set(Math.max(hm[0], Math.min(hm[1], p.x + away.x)), 0, Math.max(hm[2], Math.min(hm[3], p.z + away.z)));
        u.fled = now + 1.2; u.next = now + rr(2, 4); u.fast = true;
      } else if (now > u.next) {                       // a little way, to nibble somewhere else
        for (var tries = 0; tries < 6; tries++) {
          var tx = Math.max(hm[0], Math.min(hm[1], p.x + rr(-5, 5))), tz = Math.max(hm[2], Math.min(hm[3], p.z + rr(-5, 5)));
          if (walkable(tx, tz)) { u.target.set(tx, 0, tz); break; }
        }
        u.next = now + rr(2.5, 7); u.fast = false;
      }
      tmp.subVectors(u.target, p); tmp.y = 0;
      var d = tmp.length(), moving = d > 0.12;
      if (moving) { p.addScaledVector(tmp, Math.min(1, (u.fast ? 3.4 : 1.1) * dt / d)); rb.rotation.y = Math.atan2(tmp.x, tmp.z); }
      var hop = moving ? Math.abs(Math.sin(now * (u.fast ? 9 : 6) + u.ph)) : 0;
      p.y = hillH(p.x, p.z) + hop * (u.fast ? 0.35 : 0.2);
      u.body.rotation.x = moving ? -0.25 * hop : Math.sin(now * 3 + u.ph) * 0.04;        // (sniffing)
      u.shadow.position.set(p.x, hillH(p.x, p.z) + 0.03, p.z);
    });
  }

  ANIMALS.push({ kind: 'chickens', pos: YV(V(-12, 0, -2.3)), name: 'Chickens', r: 1.9 * YS });
  ANIMALS.push({ kind: 'ducks', pos: V(POND_W.x, 0, POND_W.z), name: 'Ducks', r: 4.25 * YS, arc: [PI * 0.75, PI * 1.6] });   // stand on the west and north shore

  // a signpost in the middle of the yard, in a ring of flowers: the mud arena and the rave south, the meadows east and west
  var SIGNPOST = V(0, 0, 1.4);                         // (yard metres; on the farm once built)
  (function () {
    var statics = YARD;
    var g = group([SIGNPOST.x, 0, SIGNPOST.z]);
    g.add(cyl(0.09, 0.11, 2.9, '#8a5f3a', [0, 1.45, 0], 8));
    g.add(cone(0.16, 0.25, '#8a5f3a', [0, 3.02, 0], 8));
    g.add(cyl(1.0, 1.05, 0.16, '#a8743f', [0, 0.08, 0], 20));
    g.add(cyl(0.9, 0.9, 0.18, '#5b3d27', [0, 0.1, 0], 20));
    statics.add(outline(g));
    for (var f = 0; f < 14; f++) { var fa = f / 14 * TAU; statics.add(sphere(0.12, WD.petals[f % WD.petals.length], [SIGNPOST.x + Math.cos(fa) * 0.62, 0.3, SIGNPOST.z + Math.sin(fa) * 0.62], [1, 0.7, 1], 8)); }
    [['🔥 Mud arena & rave', '🔥 Mud arena & rave', 0, 2.45], ['Market garden  →', '←  Market garden', 1, 1.85], ['←  Orchard & mother tree', 'Orchard & mother tree  →', -1, 1.85]].forEach(function (b) {
      var o = { px: 40, bg: '#f3e6c8', color: '#5a3d22', radius: 10, stroke: '#8a5f3a' }, cv = textCanvas(b[0], o), w = 0.48 * cv.width / cv.height;
      var tex = [new THREE.CanvasTexture(cv), new THREE.CanvasTexture(textCanvas(b[1], o))];     // (seen from the north, the arrow points the other way)
      b.splice(0, 2);
      [0, PI].forEach(function (flip) {
        var bd = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.48), new THREE.MeshBasicMaterial({ map: tex[flip ? 1 : 0] }));
        bd.position.set(SIGNPOST.x + b[0] * (w / 2 + 0.05), b[1], SIGNPOST.z + (flip ? -0.07 : 0.07) * (b[0] ? 1 : 1.4)); bd.rotation.y = flip;
        statics.add(bd);
      });
    });
  })();
  SIGNPOST = YV(SIGNPOST);

  // Butterflies (day) and fireflies (night)
  var butterflies = [];
  (function () {
    var wingGeo = new THREE.CircleGeometry(0.13, 8);
    var colors = ['#f6b93b', '#ffffff', '#e77fbf', '#7fb8e2', '#f6b93b', '#c9a7f2'];
    var NBF = 9 + Math.round((blooms('butterflies') ? 30 : 6) * BL);   // clouds of them on a blooming farm
    for (var i = 0; i < NBF; i++) {
      var b = group();
      var m = new THREE.MeshBasicMaterial({ color: colors[i % colors.length], side: THREE.DoubleSide });
      var l = new THREE.Mesh(wingGeo, m), r = new THREE.Mesh(wingGeo, m);
      l.position.x = -0.12; r.position.x = 0.12;
      var lw = group(), rw = group(); lw.add(l); rw.add(r);
      b.add(lw); b.add(rw);
      var bc = i % 2 === 0 ? V(rr(FARM_W.minX + 4, FARM_W.maxX - 4), 0, rr(FARM_W.minZ + 4, FARM_W.maxZ - 3)) : V((i % 4 === 1 ? 1 : -1) * rr(24, 58), 0, rr(LAND.minZ + 3, LAND.maxZ - 4));    // the yard and the farming lands
      b.userData = { lw: lw, rw: rw, c: bc, r: rr(1.2, 3), h: rr(0.8, 1.8), sp: rr(0.4, 0.9), ph: rr(0, TAU) };
      butterflies.push(b);
      scene.add(b);
    }
  })();
  var fireflyGeo = new THREE.BufferGeometry(), fireflyPos = new Float32Array(150 * 3), fireflySeeds = [];
  for (var fi = 0; fi < 150; fi++) fireflySeeds.push(fi < 60 ? [rr(FARM_W.minX + 3, FARM_W.maxX - 3), rr(0.5, 2.8), rr(FARM_W.minZ + 3, FARM_W.maxZ - 2), rr(0, TAU)] : [(fi % 2 ? 1 : -1) * rr(22, 60), rr(0.5, 3.2), rr(LAND.minZ + 2, LAND.maxZ - 3), rr(0, TAU)]);
  fireflyGeo.setAttribute('position', new THREE.BufferAttribute(fireflyPos, 3));
  var fireflies = new THREE.Points(fireflyGeo, new THREE.PointsMaterial({ color: 0xe8ff7a, size: 0.16, transparent: true, opacity: 0, depthWrite: false }));
  fireflies.frustumCulled = false;
  scene.add(fireflies);

  // ---------------------------------------------------------------- see-through when in the way
  // Big things that stand between the camera and what you're watching (the mother tree) fade to a ghost of
  // themselves, so the heroes behind them can always be seen. Each fader is a few spheres round its parts.
  var FADERS = [], _fseg = V(0, 0, 0), _fto = V(0, 0, 0);
  function fader(obj, spheres, extraMats) {
    var mats = [], lines = [];
    obj.traverse(function (o) {
      if (!o.isMesh) return;
      if (o.userData.isOutline) { lines.push(o); return; }
      o.material = o.material.clone(); mats.push(o.material);          // (its own materials: the cached ones are shared)
    });
    (extraMats || []).forEach(function (m) { mats.push(m); });
    FADERS.push({ mats: mats, lines: lines, spheres: spheres, k: 1, faded: false });
  }
  function inTheWay(f) {
    var cam = camera.position;
    _fseg.subVectors(controls.target, cam);
    var L2 = _fseg.lengthSq();
    return f.spheres.some(function (sp) {
      _fto.subVectors(sp[0], cam);
      if (_fto.length() < sp[1]) return true;                         // the camera is inside it
      var t = L2 > 0 ? _fto.dot(_fseg) / L2 : 0;
      if (t <= 0 || t >= 0.92) return false;                          // behind the camera, or behind what we're watching
      return _fto.addScaledVector(_fseg, -t).length() < sp[1];
    });
  }
  FOLD.faderSpheres = [];
  fader(FOLD.root, FOLD.faderSpheres);                 // (the folded arena's tower)
  function stepFaders(dt) {
    FADERS.forEach(function (f) {
      var want = inTheWay(f) ? 0.16 : 1;
      f.k += (want - f.k) * Math.min(1, dt * 5);
      var fade = f.k < 0.97;
      if (fade !== f.faded) {
        f.faded = fade;
        f.mats.forEach(function (m) { m.transparent = fade; m.depthWrite = !fade; m.opacity = 1; m.needsUpdate = true; });
        f.lines.forEach(function (o) { o.visible = !fade; });
      }
      if (fade) f.mats.forEach(function (m) { m.opacity = f.k; });
    });
  }

  // ---------------------------------------------------------------- the community bloom: the mother tree and the wonders
  // The farm's own mother tree grows with its people (one blossom for every hero, in their outfit's colour); as the
  // bloom rises, wonders appear: plants in blossom and petals on the wind, a rainbow, flocks of birds, shooting
  // stars, hot-air balloons, the northern lights, and at last the mother tree in golden bloom.
  var BLOOMFX = { blossoms: null, blossomCores: null, bPlants: [], petals: null, petalSeeds: [], rainbow: null, flocks: [], stars: [], nextStar: 0,
                  balloons: [], aurora: [], tree: null, treeBlossoms: [], gold: null };
  var OUTFIT = {};
  ((D.catalog && D.catalog.looks) || []).forEach(function (l) { if (l.id === 'outfitColor') l.options.forEach(function (o) { OUTFIT[o.id] = o.color; }); });
  (function () {
    var hT = 3.4 + 5.6 * BL, rC = 2.3 + 3.4 * BL, tr = 0.42 + 0.45 * BL, g = group([MOTHER.x, 0, MOTHER.z]);
    g.add(cyl(tr * 0.75, tr, hT, '#7a5233', [0, hT / 2, 0], 12));
    for (var r = 0; r < 6; r++) {                       // roots and branches
      var ra = r / 6 * TAU + 0.4;
      g.add(rot(cyl(tr * 0.32, tr * 0.5, 1.6, '#6b4423', [Math.cos(ra) * tr * 1.3, 0.25, Math.sin(ra) * tr * 1.3], 7), Math.sin(ra) * 0.9, 0, -Math.cos(ra) * 0.9));
      var br = cyl(tr * 0.2, tr * 0.42, rC * 0.95, '#7a5233', [Math.cos(ra) * rC * 0.32, hT - 0.4 + (r % 2) * 0.5, Math.sin(ra) * rC * 0.32], 7);
      br.rotation.set(Math.sin(ra) * 0.95, 0, -Math.cos(ra) * 0.95); g.add(br);
    }
    var leaf = ['#5fae48', '#4c9a3c', '#7cc35a'], pink = ['#ffb3d1', '#ff8fb8', '#ffd6e7'];
    var crown = [[0, hT + rC * 0.55, 0, 1.0], [rC * 0.6, hT + rC * 0.25, rC * 0.15, 0.7], [-rC * 0.55, hT + rC * 0.3, -rC * 0.2, 0.72],
                 [rC * 0.1, hT + rC * 0.35, rC * 0.62, 0.68], [-rC * 0.15, hT + rC * 0.4, -rC * 0.6, 0.66], [rC * 0.25, hT + rC * 0.95, -rC * 0.1, 0.6]];
    crown.forEach(function (c, i) { g.add(sphere(rC * c[3], i % 3 === 0 ? leaf[i % 3] : (BL > 0.3 ? pink[i % 3] : leaf[(i + 1) % 3]), [c[0], c[1], c[2]], [1, 0.82, 1], 14)); });
    scene.add(outline(g, 1.02));                        // (its own object, not merged: it turns see-through when it's in the way)
    statics.add(blobShadow(rC * 1.25, MOTHER.x, MOTHER.z));
    for (var f = 0; f < 18; f++) { var fa = f / 18 * TAU; statics.add(sphere(0.12, WD.petals[f % WD.petals.length], [MOTHER.x + Math.cos(fa) * (tr + 1.0), 0.14, MOTHER.z + Math.sin(fa) * (tr + 1.0)], [1, 0.7, 1], 8)); }
    var sg = group([MOTHER.x + tr + 1.6, 0, MOTHER.z + tr + 1.2], -0.5);
    sg.add(cyl(0.06, 0.06, 1.5, '#8a5f3a', [0, 0.75, 0], 6));
    var cv = textCanvas('Our mother tree · ' + (BLOOM.heroes || (D.heroes || []).length) + ' heroes', { px: 36, bg: '#f3e6c8', color: '#5a3d22', radius: 10, stroke: '#8a5f3a' });
    var bd = new THREE.Mesh(new THREE.PlaneGeometry(0.42 * cv.width / cv.height, 0.42), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), side: THREE.DoubleSide }));
    bd.position.set(0, 1.45, 0.05); sg.add(bd); statics.add(sg);
    // one blossom for every hero: the heroes on the farm in their outfit's colour, the rest in pinks
    var n = Math.min(80, Math.max((D.heroes || []).length, BLOOM.heroes || 0)), rs = rng(4242);
    var geo = new THREE.SphereGeometry(0.3, 8, 6); geo.scale(1, 0.45, 1);
    var gold = blooms('golden'), bm = new THREE.InstancedMesh(geo, gold ? new THREE.MeshBasicMaterial({ color: 0xffffff }) : new THREE.MeshToonMaterial({ color: 0xffffff }), Math.max(1, n));
    var m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = V(1, 1, 1), col = new THREE.Color();
    for (var k = 0; k < n; k++) {
      var c = crown[k % crown.length], th = rs() * TAU, ph = 0.15 + rs() * 1.1, rr2 = rC * c[3] * 1.05;
      var p = V(MOTHER.x + c[0] + Math.cos(th) * Math.cos(ph) * rr2, c[1] + Math.sin(ph) * rr2 * 0.82, MOTHER.z + c[2] + Math.sin(th) * Math.cos(ph) * rr2);
      q.setFromEuler(new THREE.Euler(rs() * 0.8 - 0.4, rs() * TAU, rs() * 0.8 - 0.4)); sc.setScalar(1.3 + rs() * 0.7);
      m4.compose(p, q, sc); bm.setMatrixAt(k, m4);
      var h = (D.heroes || [])[k], hex = h && h.appearance && OUTFIT[h.appearance.outfitColor];
      bm.setColorAt(k, col.set(hex || ['#ff8fb8', '#ffffff', '#ffd6e7', '#ec407a', '#fff3b0'][k % 5]));
      BLOOMFX.treeBlossoms.push(p);
    }
    scene.add(bm); BLOOMFX.tree = bm;
    fader(g, [[V(MOTHER.x, hT * 0.45, MOTHER.z), tr + 0.9], [V(MOTHER.x, hT + rC * 0.45, MOTHER.z), rC * 1.25]], [bm.material]);
    if (gold) {
      BLOOMFX.gold = new THREE.Sprite(new THREE.SpriteMaterial({ map: FIREFX.glow.material.map, color: 0xffe08a, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.35 }));
      BLOOMFX.gold.position.set(MOTHER.x, hT + rC * 0.5, MOTHER.z); BLOOMFX.gold.scale.setScalar(rC * 4.2); scene.add(BLOOMFX.gold);
    }
    MOTHER.trunk = tr; MOTHER.top = hT + rC * 1.4;
  })();
  if (blooms('blossom')) (function () {                // plants in blossom (ripe ones), and petals drifting over the farm
    var list = plants.filter(function (p) { return p.where !== 'greenhouse' && p.height > 0.25; }).slice(0, 90), rs = rng(99);
    var n = list.length * 3;
    if (!n) return;
    var disc = new THREE.CylinderGeometry(0.11, 0.07, 0.03, 7), core = new THREE.SphereGeometry(0.045, 6, 5);
    var bm = new THREE.InstancedMesh(disc, new THREE.MeshToonMaterial({ color: 0xffffff }), n), cm = new THREE.InstancedMesh(core, mat('#ffd84d'), n), col = new THREE.Color();
    list.forEach(function (p, i) {
      for (var j = 0; j < 3; j++) {
        var a = rs() * TAU, rr3 = (p.model.userData.radius || 0.3) * YS * (0.3 + rs() * 0.5);
        BLOOMFX.bPlants.push({ p: p, ox: Math.cos(a) * rr3, oz: Math.sin(a) * rr3, oy: 0.75 + rs() * 0.3, ph: rs() * TAU, s: (0.8 + rs() * 0.5) * 1.3 });
        bm.setColorAt(i * 3 + j, col.set(WD.petals[(i + j) % WD.petals.length] === '#ffffff' && j === 1 ? '#ffb3d1' : WD.petals[(i + j) % WD.petals.length]));
      }
    });
    scene.add(bm); scene.add(cm); BLOOMFX.blossoms = bm; BLOOMFX.blossomCores = cm;
    var PN = 520, pg = new THREE.BufferGeometry(), pc = new Float32Array(PN * 3);
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PN * 3), 3));
    for (var k = 0; k < PN; k++) {
      col.set(['#ffb3d1', '#ffffff', '#ffd6e7', '#ff8fb8'][k % 4]); pc[k * 3] = col.r; pc[k * 3 + 1] = col.g; pc[k * 3 + 2] = col.b;
      var near = k % 3 === 0;                          // a third swirl round the mother tree
      BLOOMFX.petalSeeds.push([near ? MOTHER.x + rr(-9, 9) : rr(LAND.minX, LAND.maxX), near ? MOTHER.z + rr(-9, 9) : rr(LAND.minZ, LAND.maxZ), rr(0, 1), rr(0.05, 0.11), rr(0, TAU), near ? 11 : 8]);
    }
    pg.setAttribute('color', new THREE.BufferAttribute(pc, 3));
    BLOOMFX.petals = new THREE.Points(pg, new THREE.PointsMaterial({ size: 0.16, vertexColors: true, transparent: true, depthWrite: false, map: SPARK_TEX, opacity: 0.9 }));
    BLOOMFX.petals.frustumCulled = false; scene.add(BLOOMFX.petals);
  })();
  if (blooms('rainbow')) (function () {                // a rainbow in the north-west sky (by day)
    var r1 = 150, r2 = 168;
    var m = new THREE.Mesh(new THREE.RingGeometry(r1, r2, 120, 1, 0, PI), new THREE.ShaderMaterial({ transparent: true, depthWrite: false,
      uniforms: { uOp: { value: 0.4 } },
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: ['uniform float uOp; varying vec2 vP;',
        'vec3 hsv(float h){ vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); return mix(vec3(1.0), k, 0.85); }',
        'void main(){ float t = (length(vP) - ' + r1.toFixed(1) + ') / ' + (r2 - r1).toFixed(1) + ';',
        '  float a = smoothstep(0.0, 0.16, t) * smoothstep(1.0, 0.84, t) * smoothstep(0.0, 25.0, vP.y) * uOp;',
        '  gl_FragColor = vec4(hsv((1.0 - t) * 0.78), a); }'].join('\n') }));
    m.position.set(-40, -38, -235); m.rotation.y = 0.18; m.renderOrder = -1;
    scene.add(m); BLOOMFX.rainbow = m;
  })();
  if (blooms('birds')) for (var fk = 0; fk < 2; fk++) (function (fk) {   // flocks flying in V over the farm (by day)
    var flock = group(), birds = [];
    for (var bI = 0; bI < 9; bI++) {
      var bd2 = group([(bI % 2 ? 1 : -1) * Math.ceil(bI / 2) * 1.6, 0, -Math.ceil(bI / 2) * 1.5]), wl = group(), wr = group();
      wl.add(box(0.9, 0.05, 0.28, '#2f3a40', [-0.45, 0, 0])); wr.add(box(0.9, 0.05, 0.28, '#2f3a40', [0.45, 0, 0]));
      bd2.add(wl); bd2.add(wr); bd2.add(sphere(0.16, '#2f3a40', [0, 0, 0.1], [1, 0.8, 2], 8));
      flock.add(bd2); birds.push({ l: wl, r: wr, ph: bI * 0.7 });
    }
    scene.add(flock);
    BLOOMFX.flocks.push({ g: flock, birds: birds, r: 75 + fk * 22, h: 26 + fk * 7, sp: (fk ? -1 : 1) * (0.045 + fk * 0.01), ph: fk * 2.6 });
  })(fk);
  if (blooms('balloons')) ['#ff6f61', '#ffd84d', '#4fc3f7'].forEach(function (hex, k) {   // hot-air balloons drifting round
    var cv = document.createElement('canvas'); cv.width = 256; cv.height = 32;
    var cg = cv.getContext('2d'), cols = [hex, '#ffffff', ['#4c9a5b', '#c2185b', '#9b7fd1'][k]];
    for (var st = 0; st < 12; st++) { cg.fillStyle = cols[st % 3]; cg.fillRect(st * 256 / 12, 0, 256 / 12 + 1, 32); }
    var b = group(), env = new THREE.Mesh(new THREE.SphereGeometry(3.0, 24, 16), new THREE.MeshToonMaterial({ map: new THREE.CanvasTexture(cv) }));
    env.scale.set(1, 1.18, 1); env.position.y = 4.6; b.add(env);
    var skirt = cone(1.4, 1.6, hex, [0, 1.75, 0], 16); skirt.rotation.x = PI; b.add(skirt);
    b.add(box(1.1, 0.8, 1.1, '#a8743f', [0, 0, 0]));
    [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]].forEach(function (c) { b.add(cyl(0.02, 0.02, 1.5, '#5a3d22', [c[0], 0.9, c[1]], 4)); });
    var fl = new THREE.Sprite(new THREE.SpriteMaterial({ map: FIREFX.glow.material.map, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 }));
    fl.position.y = 1.2; fl.scale.setScalar(1.6); b.add(fl);
    scene.add(b);
    BLOOMFX.balloons.push({ g: b, flame: fl, r: 55 + k * 14, h: 30 + k * 6, sp: 0.018 + k * 0.004, ph: k * 2.1 });
  });
  if (blooms('stars')) for (var sI2 = 0; sI2 < 3; sI2++) (function () {   // shooting stars (at night)
    var lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    lg.setAttribute('color', new THREE.BufferAttribute(new Float32Array([1, 1, 1, 0, 0, 0]), 3));
    var ln = new THREE.Line(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    ln.frustumCulled = false; ln.visible = false; scene.add(ln);
    BLOOMFX.stars.push({ line: ln, at: -99, from: V(0, 0, 0), dir: V(0, 0, 0) });
  })();
  if (blooms('aurora')) for (var aI = 0; aI < 3; aI++) (function (aI) {   // the northern lights (at night)
    var geo = new THREE.PlaneGeometry(300, 46, 80, 1), pa = geo.attributes.position;
    for (var v = 0; v < pa.count; v++) { var x = pa.getX(v); pa.setZ(v, Math.sin(x * 0.02 + aI * 1.7) * 22 + Math.sin(x * 0.051 + aI) * 9); }
    var m = new THREE.Mesh(geo, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uOp: { value: 0 }, uSeed: { value: aI * 3.1 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: ['uniform float uTime; uniform float uOp; uniform float uSeed; varying vec2 vUv;',
        'void main(){ float x = vUv.x * 12.0 + uSeed;',
        '  float rays = 0.55 + 0.45 * sin(x * 3.1 + uTime * 0.7 + sin(x * 1.3 - uTime * 0.4) * 2.0);',
        '  float curtain = smoothstep(0.0, 0.12, vUv.y) * pow(1.0 - vUv.y, 1.6) * smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x);',
        '  vec3 col = mix(vec3(0.15, 1.0, 0.55), vec3(0.2, 0.75, 1.0), vUv.y * 1.2);',
        '  col = mix(col, vec3(1.0, 0.35, 0.75), smoothstep(0.55, 1.0, vUv.y) * (0.5 + 0.5 * sin(x * 0.7 + uTime * 0.3)));',
        '  gl_FragColor = vec4(col * curtain * rays * uOp, 1.0); }'].join('\n') }));
    m.position.set(-20 + aI * 30, 62 + aI * 8, -190 - aI * 18); m.rotation.y = aI * 0.15 - 0.15;
    m.visible = false; m.renderOrder = -1; scene.add(m); BLOOMFX.aurora.push(m);
  })(aI);
  function stepBloom(now, dt, n) {
    var day = 1 - n, i;
    if (BLOOMFX.blossoms) {                            // ripe plants bloom (closed when picked), breathing gently
      var m4 = BLOOMFX.m4 || (BLOOMFX.m4 = new THREE.Matrix4()), q = BLOOMFX.q || (BLOOMFX.q = new THREE.Quaternion()), sv = V(1, 1, 1), pv = V(0, 0, 0);
      BLOOMFX.bPlants.forEach(function (b, k) {
        var p = b.p, open = p.ripe ? Math.max(0, p.ripeK) : 0, s = open * b.s * (1 + (calm ? 0 : Math.sin(now * 1.6 + b.ph) * 0.08));
        pv.set(p.pos.x + b.ox * PG.x, p.pos.y + p.height * b.oy * PG.y, p.pos.z + b.oz * PG.x);
        q.setFromAxisAngle(V(0, 1, 0), b.ph + now * 0.1);
        m4.compose(pv, q, sv.setScalar(Math.max(0.001, s))); BLOOMFX.blossoms.setMatrixAt(k, m4);
        pv.y += 0.02; m4.compose(pv, q, sv.setScalar(Math.max(0.001, s))); BLOOMFX.blossomCores.setMatrixAt(k, m4);
      });
      BLOOMFX.blossoms.instanceMatrix.needsUpdate = true; BLOOMFX.blossomCores.instanceMatrix.needsUpdate = true;
    }
    if (BLOOMFX.petals) {
      BLOOMFX.petals.visible = n < 0.7;
      if (BLOOMFX.petals.visible) {
        var pp = BLOOMFX.petals.geometry.attributes.position;
        BLOOMFX.petalSeeds.forEach(function (sd, k) {
          var u = (now * sd[3] * (calm ? 0.5 : 1) + sd[2]) % 1, y = sd[5] * (1 - u);
          pp.setXYZ(k, sd[0] + Math.sin(now * 0.6 + sd[4]) * 1.6 + u * 3, y, sd[1] + Math.cos(now * 0.5 + sd[4]) * 1.2);
        });
        pp.needsUpdate = true; BLOOMFX.petals.material.opacity = 0.9 * day;
      }
    }
    if (BLOOMFX.rainbow) { BLOOMFX.rainbow.material.uniforms.uOp.value = 0.42 * Math.max(0, day - 0.15); BLOOMFX.rainbow.visible = day > 0.2; }
    BLOOMFX.flocks.forEach(function (f) {
      f.g.visible = n < 0.7;
      var a = now * f.sp + f.ph;
      f.g.position.set(Math.cos(a) * f.r, f.h + Math.sin(now * 0.3 + f.ph) * 2, Math.sin(a) * f.r + 8);
      f.g.rotation.y = -a + (f.sp > 0 ? PI : 0);
      f.birds.forEach(function (b) { var fl = calm ? 0.2 : Math.sin(now * 7 + b.ph) * 0.55; b.l.rotation.z = fl; b.r.rotation.z = -fl; });
    });
    BLOOMFX.balloons.forEach(function (b) {
      var a = now * b.sp + b.ph;
      b.g.position.set(Math.cos(a) * b.r - 5, b.h + Math.sin(now * 0.25 + b.ph) * 2.5, Math.sin(a) * b.r + 6);
      b.flame.material.opacity = (0.25 + 0.6 * n) * (0.7 + 0.3 * Math.sin(now * 9 + b.ph));
    });
    if (BLOOMFX.stars.length) {
      if (n > 0.45 && now > BLOOMFX.nextStar && !calm) {
        var st = BLOOMFX.stars.reduce(function (x, y) { return x.at < y.at ? x : y; });
        var th = rr(-PI * 0.9, -PI * 0.1);
        st.from.set(Math.cos(th) * 210, rr(70, 130), Math.sin(th) * 210); st.dir.set(rr(-1, 1), rr(-0.55, -0.25), rr(-0.3, 0.3)).normalize();
        st.at = now; BLOOMFX.nextStar = now + rr(2.5, 6);
      }
      BLOOMFX.stars.forEach(function (st) {
        var k = (now - st.at) / 0.9;
        st.line.visible = k >= 0 && k < 1 && n > 0.4;
        if (!st.line.visible) return;
        var head = st.from.clone().addScaledVector(st.dir, k * 70), tail = head.clone().addScaledVector(st.dir, -14 * Math.sin(k * PI) - 2);
        var pa = st.line.geometry.attributes.position; pa.setXYZ(0, head.x, head.y, head.z); pa.setXYZ(1, tail.x, tail.y, tail.z); pa.needsUpdate = true;
        st.line.material.opacity = Math.sin(k * PI) * n;
      });
    }
    BLOOMFX.aurora.forEach(function (a) { a.visible = n > 0.45; if (a.visible) { a.material.uniforms.uTime.value = now; a.material.uniforms.uOp.value = Math.min(1, (n - 0.45) * 2.2) * 0.8; } });
    if (BLOOMFX.gold) BLOOMFX.gold.material.opacity = 0.22 + 0.12 * Math.sin(now * 1.3) + 0.15 * n;
  }

  if (NevetHero.merge) NevetHero.merge(statics, function (o) { return movers.has(o); });

  // ---------------------------------------------------------------- navigation
  // Heroes walk on a grid (half-unit cells) that knows where the beds,
  // buildings, cart, arena, stage, pond and fences are. A* finds a route around
  // them and the route is straightened; heroes steer around each other.
  var NAV = { x0: LAND.minX - 0.5, z0: LAND.minZ - 0.5, cell: 0.5 };      // the whole farm
  NAV.w = Math.ceil((LAND.maxX - LAND.minX + 1) / NAV.cell); NAV.h = Math.ceil((LAND.maxZ - LAND.minZ + 1) / NAV.cell);
  var OBST = [], HERO_R = 0.42;
  function addObst(o) {                                // (with a bounding box, so most obstacles are skipped at a glance)
    if (o.t === 'c') { o.x0 = o.x - o.r; o.x1 = o.x + o.r; o.z0 = o.z - o.r; o.z1 = o.z + o.r; }
    else if (o.t === 'r') { var ex = o.hw * Math.abs(o.c) + o.hd * Math.abs(o.s), ez = o.hw * Math.abs(o.s) + o.hd * Math.abs(o.c); o.x0 = o.x - ex; o.x1 = o.x + ex; o.z0 = o.z - ez; o.z1 = o.z + ez; }
    else { o.x0 = Infinity; o.x1 = -Infinity; o.z0 = Infinity; o.z1 = -Infinity; o.pts.forEach(function (q) { o.x0 = Math.min(o.x0, q[0]); o.x1 = Math.max(o.x1, q[0]); o.z0 = Math.min(o.z0, q[1]); o.z1 = Math.max(o.z1, q[1]); }); }
    OBST.push(o);
    return o;
  }
  function obstacleCircle(x, z, r) { return addObst({ t: 'c', x: x, z: z, r: r }); }
  function obstacleRect(x, z, hw, hd, rotY) { return addObst({ t: 'r', x: x, z: z, hw: hw, hd: hd, c: Math.cos(rotY || 0), s: Math.sin(rotY || 0) }); }
  function obstaclePoly(pts) { return addObst({ t: 'p', pts: pts }); }
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
  var partyNav = false;                                // party mode: the arches over the dance floor count
  function fenceBlocked(x, z) {                        // the edge of the farm (no fence: heroes just stay on the farm)
    return x < LAND.minX + 0.6 || x > LAND.maxX - 0.6 || z < LAND.minZ + 0.6 || z > LAND.maxZ - 0.6;
  }
  function obstHit(o, x, z, pad) {
    if (x < o.x0 - pad || x > o.x1 + pad || z < o.z0 - pad || z > o.z1 + pad) return false;
    if (o.t === 'c') { var dx = x - o.x, dz = z - o.z, r = o.r + pad; return dx * dx + dz * dz < r * r; }
    if (o.t === 'r') {
      var ex = x - o.x, ez = z - o.z, lx = ex * o.c - ez * o.s, lz = ex * o.s + ez * o.c;
      return Math.abs(lx) < o.hw + pad && Math.abs(lz) < o.hd + pad;
    }
    return pointInPoly(x, z, o.pts) || polyDist(x, z, o.pts) < pad;
  }
  function blockedAt(x, z, pad) {
    pad = pad === undefined ? HERO_R : pad;
    if (fenceBlocked(x, z)) return true;
    for (var i = 0; i < OBST.length; i++) {
      var o = OBST[i];
      if (o.party && !partyNav || o.open && partyNav) continue;
      if (obstHit(o, x, z, pad)) return true;
    }
    return false;
  }
  var NAVN = NAV.w * NAV.h, navBase = new Uint8Array(NAVN), navParty = new Uint8Array(NAVN), navBlocked = navBase;
  function buildNav() {                                 // two grids: without and with the party's extras; each obstacle marks the cells it covers
    var i, j, k;
    for (j = 0; j < NAV.h; j++) for (i = 0; i < NAV.w; i++) {
      k = j * NAV.w + i;
      navBase[k] = navParty[k] = fenceBlocked(NAV.x0 + (i + 0.5) * NAV.cell, NAV.z0 + (j + 0.5) * NAV.cell) ? 1 : 0;
    }
    OBST.forEach(function (o) {
      var i0 = Math.max(0, Math.floor((o.x0 - HERO_R - NAV.x0) / NAV.cell)), i1 = Math.min(NAV.w - 1, Math.floor((o.x1 + HERO_R - NAV.x0) / NAV.cell));
      var j0 = Math.max(0, Math.floor((o.z0 - HERO_R - NAV.z0) / NAV.cell)), j1 = Math.min(NAV.h - 1, Math.floor((o.z1 + HERO_R - NAV.z0) / NAV.cell));
      for (var jj = j0; jj <= j1; jj++) for (var ii = i0; ii <= i1; ii++) {
        var kk = jj * NAV.w + ii, inBase = !o.party && !navBase[kk], inParty = !o.open && !navParty[kk];   // (party: the arena is folded)
        if (!inBase && !inParty) continue;
        if (!obstHit(o, NAV.x0 + (ii + 0.5) * NAV.cell, NAV.z0 + (jj + 0.5) * NAV.cell, HERO_R)) continue;
        if (inParty) navParty[kk] = 1;
        if (inBase) navBase[kk] = 1;
      }
    });
  }
  function setPartyNav(on) { partyNav = on; navBlocked = on ? navParty : navBase; }
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
    while (heapK.length && guard++ < 90000) {
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
    // the yard's things (built in yard metres): yC / yR take yard metres
    function yC(x, z, r) { return obstacleCircle(yx(x), yz(z), r * YS); }
    function yR(x, z, hw, hd, rotY) { return obstacleRect(yx(x), yz(z), hw * YS, hd * YS, rotY); }
    if (!MAPG) BED_X.forEach(function (bx) { yR(bx, BED_Z0 - (SLOTS - 1) * SLOT_STEP / 2 - 0.5, BED_W / 2 + 0.05, (SLOTS * SLOT_STEP + 0.4) / 2); });
    MAP_OBST.forEach(function (o) {
      if (o[0] === 'p') obstaclePoly(o[1].map(function (q) { return [yx(q[0]), yz(q[1])]; }));
      else if (o[0] === 'c') yC(o[1], o[2], o[3]);
      else yR(o[1], o[2], o[3], o[4], o[5]);
    });
    if (CHALK) obstacleRect(CHALK.x, CHALK.z, 1.0 * YS, 0.45 * YS, 0.55);
    obstacleRect(CART.x, CART.z + 0.35 * YS, 0.75 * YS, 1.65 * YS);
    obstacleCircle(PUMP.x, PUMP.z + 0.3 * YS, 0.55 * YS);
    obstacleCircle(FIRE.x, FIRE.z, 1.0 * FIRE_K);
    obstacleCircle(SIGNPOST.x, SIGNPOST.z, 1.05 * YS);         // the signpost's flower ring
    ARENA_OBST.forEach(function (o) { obstacleCircle(o[0], o[1], o[2]).open = o[3] === 'open'; });     // the arena's wall, columns and braziers (while it's open)
    obstacleCircle(FIRE.x, FIRE.z, TOWER_R + 0.4).party = true;                // the fire tower, when it's folded for the party
    DIVIDE_OBST.forEach(function (o) { obstacleRect(o[0], o[1], o[2], o[3]); });   // the hedges between the areas
    [-1.9, 1.9].forEach(function (x) { obstacleCircle(x, FARM.maxZ, 0.3); });    // the arch's posts
    yR(-15.5, -9.5, 3.2, 3.7);                               // barn
    yR(-15, 5.5, 1.75, 2.45);                                // greenhouse
    yC(13.5, -17.5, 1.9);                                    // windmill
    yC(POND.x, POND.z, 3.55);                                // pond
    if (MAPG) yC(15.2, -14.6, 0.35); else yC(1, -15, 0.35);     // scarecrow
    [[-11, -4.2], [-11.4, -2.8], [-11.2, -3.5]].forEach(function (b) { yC(b[0], b[1], 0.75); });
    for (var i = 0; i < (BARN_BINS.length || (MAPG ? 0 : 1)); i++)
      yR(-11.2 + (i % 2) * 1.6, 1.2 + Math.floor(i / 2) * 1.6, 0.65, 0.55);
    FIELD_OBST.forEach(function (o) { if (o[0] === 'c') obstacleCircle(o[1], o[2], o[3]); else obstacleRect(o[1], o[2], o[3], o[4], o[5]); });   // the farming lands
    INNER_TREES.forEach(function (t) { obstacleCircle(t[0], t[1], 0.9); });
    EXTRA_OBST.forEach(function (t) { obstacleCircle(t[0], t[1], 0.55); });
    PLAY_OBST.forEach(function (o) { if (o[0] === 'c') obstacleCircle(o[1], o[2], o[3]); else obstacleRect(o[1], o[2], o[3], o[4]); });
    function addList(list) { return list.map(function (o) { return o[0] === 'c' ? obstacleCircle(o[1], o[2], o[3]) : obstacleRect(o[1], o[2], o[3], o[4]); }); }
    addList(PARTY.obst);                               // the stage: booth, speakers, truss, screen, light poles, flame jets, searchlights
    addList(PARTY.partyObst).forEach(function (o) { o.party = true; });     // the neon arches' feet (only while the party is on)
    obstacleRect(WHEEL.x, WHEEL.z, 4.0, 1.75);              // the big wheel's frame
    obstacleCircle(MOTHER.x, MOTHER.z, (MOTHER.trunk || 0.6) + 0.9);     // the mother tree and its ring of flowers
    buildNav();
    // where to stand to tend each map-garden plant: free spots around it, nearest first
    plants.forEach(function (p) {
      if (p.where !== 'bed' && p.where !== 'map' && p.where !== 'pot' || !MAPG) return;
      var st = [];
      [0.95, 1.3, 1.7, 2.2, 2.8].forEach(function (r0) {
        var r = r0 * YS;
        if (st.length >= 4) return;
        for (var k = 0; k < 12; k++) { var a = k / 12 * TAU, c = V(p.pos.x + Math.cos(a) * r, 0, p.pos.z + Math.sin(a) * r); if (!blockedAt(c.x, c.z, 0.42)) st.push(c); }
      });
      if (st.length) p.stands = st.slice(0, 8); else p.where = 'unreachable';
    });
  })();

  // ---------------------------------------------------------------- particles (water drops, dirt puffs, sparkles)
  var drops = [];
  var DROP_GEO = new THREE.SphereGeometry(0.045, 6, 4), DROP_MAT = new THREE.MeshBasicMaterial({ color: 0x6fc3ff });
  var DIRT_MAT = new THREE.MeshBasicMaterial({ color: 0x8a5f3a }), SPARK_MAT = new THREE.MeshBasicMaterial({ color: 0xfff2a8 });
  var GRAIN_MAT = new THREE.MeshBasicMaterial({ color: 0xf2d16b }), SCRAP_MAT = new THREE.MeshBasicMaterial({ color: 0x8bc34a }),
      CRUMB_MAT = new THREE.MeshBasicMaterial({ color: 0xf5e6c8 }), SAND_MAT = new THREE.MeshBasicMaterial({ color: 0xe8d39c }), SMOKE_MAT = new THREE.MeshBasicMaterial({ color: 0xdedede, transparent: true, opacity: 0.6 });
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
    var team = h.fbTeam !== undefined ? FB.kits[h.fbTeam] : h.sp ? RING.colors[h.sp.corner] : null;   // footballers wear their team's colour, fighters their corner's
    var c = textCanvas(h.name, { px: 34, pad: 18, bg: selected ? '#4c9a5b' : team || 'rgba(255,255,255,0.92)', color: selected || team ? '#ffffff' : '#1e2a20' });
    if (h.label) { h.label.material.map.dispose(); h.label.material.map = new THREE.CanvasTexture(c); h.label.material.needsUpdate = true; }
    else h.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
    h.label.scale.set(0.55 * c.width / c.height, 0.55, 1);
    h.label.renderOrder = 20;
  }
  function buildHeroRoot(h, tool) {
    var a = {};
    for (var k in h.appearance) a[k] = h.appearance[k];
    if (tool !== undefined && tool !== null) a.hand = tool;
    if (h.dress) a = NevetHero.fightLook(a, { gloves: h.dress.gloves });   // a bout at the campfire: their no-gi kit, gloves in the corner's colour
    a.pet = 'none';                                    // only the heroes come to the farm; companions stay home
    a.petAccessory = 'none';
    var root = NevetHero.build(a, D.catalog, { outlines: outlines, merge: true });
    root.userData.heroIndex = h.i;
    return root;
  }
  function setTool(h, tool) {
    var want = tool === null || tool === undefined ? h.appearance.hand : tool, key = want + (h.dress ? '|fight:' + h.dress.gloves : '');
    if (h.toolKey === key && h.root) return;
    var old = h.root;
    h.root = buildHeroRoot(h, want);
    h.tool = want; h.toolKey = key;
    if (old) {
      h.root.position.copy(old.position); h.root.rotation.copy(old.rotation);
      scene.remove(old);
      NevetHero.dispose(old);
    }
    scene.add(h.root);
    if (h.carry) h.root.add(h.carry);
  }
  var gateQueue = (D.heroes || []).map(function (info, i) {
    return { i: i, id: info.id, name: info.name, level: info.level, appearance: info.appearance || {}, powers: info.powers || null,
             pos: V(0, 0, FARM.maxZ + 1.7 + i * 0.01), facing: PI, path: [], onArrive: null, act: null, actEnd: 0,
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
    assign(h, now);                                    // (they come in under the arch, in the middle of the farm, and go straight to it)
  }

  var simNow = 0;
  function clockNow() { return simNow; }
  function walkTo(h, pts, then) {
    h.path = Array.isArray(pts) ? pts.slice() : [pts];
    h.onArrive = then || null;
    h.act = null;
    h.goal = null;
  }
  function goTo(h, to, then) {
    var goal = to.clone().setY(0);
    walkTo(h, findPath(h.root.position, goal, h), then);
    h.goal = goal;
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
    return pickSpot(h, p.stands || [V(p.pos.x - 1.35 * YS, 0, p.pos.z), V(p.pos.x + 1.35 * YS, 0, p.pos.z)]);
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
  var stats = { harvest: 0, water: 0, plant: 0, animals: 0 };
  function animalStands(a) {                          // where heroes stand to care for these animals
    if (a.stands) return a.stands;
    var out = [];
    if (a.around) {                                    // a worm bed: along its sides
      var cc = polyCentre(a.around);
      for (var e = 0; e < a.around.length; e++) {
        var p = a.around[e], q = a.around[(e + 1) % a.around.length], mx = (p[0] + q[0]) / 2, mz = (p[1] + q[1]) / 2;
        var dx = mx - cc[0], dz = mz - cc[1], d = Math.hypot(dx, dz) || 1;
        out.push(V(mx + dx / d * 0.8 * YS, 0, mz + dz / d * 0.8 * YS));
      }
    } else {
      var lo = a.arc ? a.arc[0] : 0, hi = a.arc ? a.arc[1] : TAU, n = a.arc ? 6 : 8;
      for (var k = 0; k < n; k++) { var ang = lo + (hi - lo) * (a.arc ? k / (n - 1) : k / n); out.push(V(a.pos.x + Math.cos(ang) * a.r, 0, a.pos.z + Math.sin(ang) * a.r)); }
    }
    return (a.stands = out.filter(function (p) { return spotOk(p); }));
  }
  function nearestChicken(p) {
    var best = null, bd = Infinity;
    chickens.forEach(function (c) { var d = c.position.distanceToSquared(p); if (d < bd) { bd = d; best = c; } });
    return best ? best.position.clone() : YV(V(-12, 0, -2.3));
  }
  ACTS = {
    harvest: {
      name: 'Harvest festival', tool: 'none', night: 0, centre: YV(GARDEN_CENTRE), view: 1.3,
      stat: function () { return stats.harvest + ' picked'; },
      next: function harvestNext(h, now) {
        var stand = null;
        var p = nearest(h, plants, function (q) { return q.ripe && !q.claimed && TENDED[q.where] && (stand = workSpot(q, h)) && (q.stand = stand); });
        if (!p) return wanderNear(h, YV(V(2, 0, 3)), 4 * YS, now, function () { harvestNext(h, clockNow()); });
        p.claimed = h;
        goTo(h, p.stand, function () {
          face(h, p.pos);
          doAct(h, 'pick', 1.7, function () {
            p.ripe = false; p.claimed = null; p.regrowAt = clockNow() + rr(16, 28);
            carryItem(h, p.color);
            var col = p.color;
            var drop = pickSpot(h, CART_SPOTS);
            if (!drop) return wanderNear(h, CART, 3.5 * YS, clockNow(), function () { dropCarry(h); addToCart(col); stats.harvest++; harvestNext(h, clockNow()); });
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
      name: 'Watering round', tool: 'watering_can', night: 0, centre: YV(MAPG ? GARDEN_CENTRE : V(-1, 0.6, -6)), view: 1.3,
      stat: function () { return stats.water + ' watered'; },
      next: function waterNext(h, now) {
        if (h.watered >= 3) {                          // can's empty: refill at the pump (or a garden tap)
          var at = pickSpot(h, REFILL_SPOTS);
          if (!at) return wanderNear(h, PUMP, 3 * YS, now, function () { waterNext(h, clockNow()); });
          var src = at.src || PUMP;
          return goTo(h, at, function () {
            face(h, src);
            h.refillAt = src;
            doAct(h, 'refill', 1.6, function () { h.watered = 0; h.refillAt = null; waterNext(h, clockNow()); }, clockNow());
          });
        }
        var thirsty = plants.some(function (q) { return q.thirsty && !q.claimed && TENDED[q.where]; });
        var p = nearest(h, plants, function (q) { return !q.claimed && (thirsty ? q.thirsty : clockNow() - q.wateredAt > 25) && TENDED[q.where] && (q.stand = workSpot(q, h)); });
        if (!p) return wanderNear(h, YV(V(-2, 0, 2)), 4 * YS, now, function () { waterNext(h, clockNow()); });
        p.claimed = h;
        goTo(h, p.stand, function () {
          face(h, p.pos);
          h.waterTarget = p;
          doAct(h, 'water', 2.4, function () {
            p.claimed = null; p.wateredAt = clockNow(); p.perk = 1;
            if (p.thirsty) { p.thirsty = false; if (p.drop) { scene.remove(p.drop); p.drop = null; } }
            h.watered++; stats.water++; h.waterTarget = null;
            waterNext(h, clockNow());
          }, clockNow());
        });
      }
    },
    plant: {
      name: 'Planting day', tool: 'seed_bag', night: 0, centre: YV(V(15.2, 0.5, -8.5)), view: 1.2,
      stat: function () { return stats.plant + ' planted'; },
      next: function plantNext(h, now) {
        var s = nearest(h, spots, function (q) { return q.state === 'empty' && !q.claimed && (q.stand = pickSpot(h, [V(q.pos.x - 0.95 * YS, 0, q.pos.z), V(q.pos.x + 0.95 * YS, 0, q.pos.z)])); });
        if (!s) return wanderNear(h, YV(V(15, 0, -2.6)), 3 * YS, now, function () { plantNext(h, clockNow()); });
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
    animals: {
      name: 'Animal care', tool: 'basket', night: 0, centre: YV(V(-3, 0.6, 0)), view: 1.35,
      stat: function () { return stats.animals + ' fed · ' + ANIMALS.length + ' animal spots'; },
      next: function animalNext(h, now) {
        // go to the animals that had the fewest visits (not the ones you just fed), so every animal gets cared for
        var options = ANIMALS.filter(function (a) { return a !== h.lastAnimal && (a.busy || 0) < (a.kind === 'ducks' || a.kind === 'chickens' ? 4 : 2); });
        if (!options.length) options = ANIMALS.filter(function (a) { return (a.busy || 0) < 4; });
        if (!options.length) return wanderNear(h, YV(V(-6, 0, 0)), 4 * YS, now, function () { animalNext(h, clockNow()); });
        var hp = h.root.position;
        options.sort(function (a, b) { return ((a.visits || 0) + a.pos.distanceTo(hp) * 0.04 + R() * 0.6) - ((b.visits || 0) + b.pos.distanceTo(hp) * 0.04 + R() * 0.6); });
        var a = null, at = null;
        for (var i = 0; i < options.length && !at; i++) { a = options[i]; at = pickSpot(h, animalStands(a)); }
        if (!at) return wanderNear(h, options[0].pos, 3, now, function () { animalNext(h, clockNow()); });
        a.busy = (a.busy || 0) + 1;
        goTo(h, at, function () {
          var look = a.kind === 'ducks' ? V(POND_W.x, 0, POND_W.z) : a.kind === 'chickens' ? nearestChicken(h.root.position) : a.pos;
          face(h, look);
          h.animal = a;
          doAct(h, { worms: 'feedworms', chickens: 'scatter', ducks: 'bread', bees: 'smoke' }[a.kind], a.kind === 'bees' ? 3.6 : 3.2, function () {
            a.busy = Math.max(0, (a.busy || 1) - 1); a.visits = (a.visits || 0) + 1;
            stats.animals++; h.lastAnimal = a; h.animal = null;
            animalNext(h, clockNow());
          }, clockNow());
        });
      }
    },
    play: {
      name: 'Play park', tool: 'none', night: 0, centre: V(1.5, 0.6, 25.8 + PDZ), view: 1.2,
      stat: function () {
        var fb = PST.football.users.length, rest = heroes.filter(function (h) { return h.play && h.play.st !== PST.football; }).length;
        var ring = RING.bout ? 'Arena: ' + ringStyle().name + ' · ' : '';
        return ring + (fb >= 2 ? 'Football ' + FB.score[0] + ':' + FB.score[1] + ' · ' : '') + (fb + rest) + ' playing';
      },
      next: function (h, now) { playAssign(h, now); }
    },
    campfire: {
      name: 'Campfire dance', tool: null, night: 0.62, centre: V(FIRE.x, 0.8, FIRE.z + 1.0), view: 1.75,
      stat: function () {
        var m = RING.bout, dancing = heroes.filter(function (h) { return h.camp; }).length;
        var bout = !m ? '' : m.style === 'ceremony' ? '🏆 ' + m.champion_name + ', grand champion · '
          : 'Mud arena: ' + (m.stage === 'final' ? 'the final' : m.stage === 'semi' ? 'final three' : 'round ' + m.round + ', bout ' + m.bout + '/' + m.bouts) + ' · ';
        return bout + dance.cur.name + ' · ' + dancing + ' dancing';
      },
      next: function (h, now) {                         // dance round the arena (the tournament calls its wrestlers in itself)
        var m = RING.bout;
        if (m && m.fighters && m.fighters.some(function (f) { return f.id === h.id; }) && !h.sp) {
          return ringJoin(h, m.fighters.filter(function (f) { return f.id === h.id; })[0]);
        }
        campJoin(h);
      }
    },
    party: {
      name: 'Party!', tool: null, night: 0, centre: V(PARTY.c.x, 2.2, (STAGE_N + FIRE.z) / 2 + 1), view: 1.9 + 0.05 * Math.max(0, crowdShape(CROWD_N).rows - 4),
      stat: function () {
        var who = heroes.filter(function (h) { return h.act === 'party' || h.act === 'form' || h.act === 'formReady'; }).length;
        if (acid.playing) return dance.cur.name + ' · ' + who + ' dancing to the 303 & 909 · ' + BPM + ' BPM';
        return dance.cur.name + ' · ' + who + ' dancing' + (heroes[0] && heroes[0].act === 'dj' ? ' · DJ ' + heroes[0].name : '');
      },
      next: function (h, now) {
        if (h === heroes[0]) {                         // whoever opened the farm spins the records
          return goTo(h, DJ_SPOT, function () { h.wantFacing = 0; doAct(h, 'dj', 9999, null, clockNow()); });   // facing the floor
        }
        goTo(h, floorSlot(h), function () { face(h, V(DJ_SPOT.x, 0, DJ_SPOT.z)); doAct(h, 'party', 9999, null, clockNow()); });
      }
    }
  };
  function floorSlot(h, kk) {                         // a crowd facing the stage, from the front row back, room round each dancer
    var dancers = heroes.filter(function (o) { return o !== heroes[0]; }), n = Math.max(1, dancers.length, CROWD_N);   // (heroes arrive one by one: lay out for everyone)
    var k = kk !== undefined ? kk : h.floorK !== undefined ? h.floorK : Math.max(0, dancers.indexOf(h));
    var sl = crowdSlots(n), p = sl[k % sl.length], extra = Math.floor(k / sl.length) * 0.8;
    return V(p.x + extra, 0, p.z + extra * 0.5);
  }
  var ORDER = ['harvest', 'water', 'plant', 'animals', 'play', 'campfire', 'party'];
  var EVENT = D.event && ACTS[D.event.act] ? D.event : null;      // an event on the farm right now (events.py): the heroes join in
  var current = D.start && ACTS[D.start] ? D.start : EVENT ? EVENT.act : 'harvest';
  function around(c, list) { return list.map(function (o) { return V(c.x + o[0] * YS, 0, c.z + o[1] * YS); }); }   // (offsets in yard metres)
  var CART_SPOTS = around(CART, [[-1.3, -0.4], [1.3, -0.4], [-1.3, 1.0], [1.3, 1.0], [0, -1.75]]);
  var PUMP_SPOTS = around(PUMP, [[1.05, 0.1], [-1.05, 0.1], [0, -1.05]]);
  var REFILL_SPOTS = PUMP_SPOTS.slice();
  MAP_TAPS.forEach(function (t) {
    around(t, [[0.9, 0.3], [-0.9, 0.3], [0, 1.0]]).forEach(function (sp) { sp.src = t; REFILL_SPOTS.push(sp); });
  });
  var TENDED = { bed: 1, map: 1, pot: 1 };            // plants heroes can reach (not the greenhouse or the new field)
  function assign(h, now) {
    playLeave(h);
    h.camp = false;
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
    var holder = group([s.pos.x, s.pos.y, s.pos.z]), inner = group();
    var sprout = plantModel(species, 'germination', Math.round(now * 100)), grown = plantModel(species, 'mature', Math.round(now * 100) + 1, { r: 0.55, h: 1 });
    grown.scale.setScalar(0.001);
    inner.scale.setScalar(YS);                         // (the yard's plants are YS times bigger)
    inner.add(sprout); inner.add(grown); holder.add(inner);
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

  // ---------------------------------------------------------------- the play park: who plays what
  // The matches come from the station (games.py): three heroes at a time spar in the arena round the campfire,
  // and a football match (two teams, a keeper each once a team has three) is on most of the time. The matches
  // call their heroes in themselves (arenaStart, footballStart). Everyone else takes turns on the swings, the
  // slide (three goes each), the seesaw, the trampoline and in the sandbox, goes to watch the arena, or cheers
  // along the touchline.
  var PST = { football: { users: [] }, slide: { users: [] }, swing: { slots: SWING.seats }, seesaw: { slots: SEESAW.seats },
              tramp: { slots: TRAMP.seats }, sandbox: { slots: SANDBOX.seats }, cheer: { users: [] }, ring: { users: [] }, watch: { users: [] } };
  var SLIDE_WAIT = [V(13.5, 0, 17.4 + PDZ), V(15.7, 0, 17.4 + PDZ), V(12.6, 0, 18.4 + PDZ), V(16.6, 0, 18.4 + PDZ)];
  function playLeave(h) {
    var pl = h.play;
    if (!pl) return;
    h.play = null;
    if (pl.slot && pl.slot.user === h) pl.slot.user = null;
    if (pl.st.users) pl.st.users = pl.st.users.filter(function (o) { return o !== h; });
    if (SLIDE.busyBy === h) { SLIDE.busyBy = null; SLIDE.busyUntil = 0; }
    if (h.fbTeam !== undefined) { h.fbTeam = undefined; h.fbMove = false; heroLabel(h, follow === h); if (!PST.football.users.length) FB.match = null; }
    if (h.sp) ringLeave(h);
  }
  function playDone(h, kind) { return function () { h.lastPlay = kind; playAssign(h, clockNow()); }; }
  function playAssign(h, now) {
    playLeave(h);
    var opts = [];
    ['swing', 'seesaw', 'tramp', 'sandbox'].forEach(function (k) { PST[k].slots.forEach(function (sl) { if (!sl.user) opts.push([k, sl]); }); });
    if (PST.slide.users.length < 3) opts.push(['slide', null], ['slide', null]);
    var fresh = opts.filter(function (o) { return o[0] !== h.lastPlay; });
    if (fresh.length) opts = fresh;
    if (!opts.length) return cheerOn(h, now);
    var o = opts[Math.floor(R() * opts.length)], kind = o[0], slot = o[1];
    if (kind === 'slide') { PST.slide.users.push(h); h.play = { st: PST.slide }; h.laps = 0; return slideTurn(h); }
    slot.user = h;
    h.play = { st: PST[kind], slot: slot };
    goTo(h, slot.pos, function () {
      if (kind === 'swing') { h.wantFacing = 0; doAct(h, 'swing', rr(10, 15), playDone(h, kind), clockNow()); }
      else if (kind === 'seesaw') { h.wantFacing = slot.side > 0 ? -PI / 2 : PI / 2; doAct(h, 'seesaw', rr(9, 14), playDone(h, kind), clockNow()); }
      else if (kind === 'tramp') { face(h, TRAMP.c); doAct(h, 'bounce', rr(8, 12), playDone(h, kind), clockNow()); }
      else { face(h, SANDBOX.c); doAct(h, 'dig', rr(7, 11), playDone(h, kind), clockNow()); }
    });
  }
  function slideTurn(h) {
    if (!h.play || h.play.st !== PST.slide) return;
    var now = clockNow();
    if (h.laps >= 3) return playDone(h, 'slide')();
    var ladderBusy = (SLIDE.busyBy && SLIDE.busyBy !== h && now < SLIDE.busyUntil) || spotTaken(SLIDE.ladder, h, 0.8);
    if (ladderBusy) {                                  // wait in line a moment
      var w = pickSpot(h, SLIDE_WAIT);
      if (!w) return doAct(h, 'idle', 1.2, function () { slideTurn(h); }, now);
      return goTo(h, w, function () { face(h, SLIDE.ladder); doAct(h, 'idle', rr(0.8, 1.6), function () { slideTurn(h); }, clockNow()); });
    }
    SLIDE.busyBy = h; SLIDE.busyUntil = now + 30;
    goTo(h, SLIDE.ladder, function () {
      if (h.root.position.distanceTo(SLIDE.ladder) > 0.6) return slideTurn(h);
      SLIDE.busyUntil = clockNow() + 1.25;              // the next one may climb once I'm up
      h.wantFacing = PI;
      doAct(h, 'slide', 3.0, function () { h.laps++; h.root.position.set(SLIDE.x, 0, SLIDE.bottom + 0.6); slideTurn(h); }, clockNow());
    });
  }
  function fbTeamOf(side) {                           // a team's players on the farm, in the station's order (the keeper last)
    return PST.football.users.filter(function (o) { return o.fbTeam === side; }).sort(function (a, b) { return a.fbIdx - b.fbIdx; });
  }
  function fbHome(h) {                                 // where a footballer stands when the ball is elsewhere
    var team = fbTeamOf(h.fbTeam), k = Math.max(0, team.indexOf(h)), dir = h.fbTeam === 0 ? 1 : -1;
    return V(FB.c.x - dir * (1.4 + (k % 2) * 2.2), 0, FB.c.z + ((k % 3) - 1) * 2.3);
  }
  function joinFootball(h, side, idx) {               // called in by the station's match (footballStart)
    playLeave(h);
    h.fbTeam = side; h.fbIdx = idx;
    PST.football.users.push(h);
    h.play = { st: PST.football };
    heroLabel(h, follow === h);
    goTo(h, fbHome(h), function () { if (h.fbTeam !== undefined) doAct(h, 'football', 9999, null, clockNow()); });
  }
  function cheerOn(h, now) {
    var at = pickSpot(h, CHEER_SPOTS);
    h.play = { st: PST.cheer }; PST.cheer.users.push(h);
    if (!at) return wanderNear(h, V(FB.c.x, 0, FB.c.z + FB.hz + 1.4), 3, now, playDone(h, 'cheer'));
    goTo(h, at, function () { face(h, FB.c); doAct(h, 'cheer', rr(6, 10), playDone(h, 'cheer'), clockNow()); });
  }
  // ---------------------------------------------------------------- matches from the station (games.py)
  // While the farm shows the Campfire dance (the mud tournament) or the Play park (football), it asks the station for
  // the current and next match every few seconds. The station decides who plays and every move; the farm walks the
  // heroes there and acts it out, so everyone watching sees the same thing (and the stats match what was shown).
  var GAMES = { arena: [], football: [], timing: null, base: null, asked: -99, busy: false, fixed: false, mode: null, tournament: null };
  function wallNow() { return GAMES.base === null ? null : clockNow() + GAMES.base; }
  function setGames(j) {
    if (j.mode && j.mode !== GAMES.mode && GAMES.mode) return;          // an answer for the activity we just left
    if (j.arena && (j.mode === 'campfire' || !j.mode)) GAMES.arena = j.arena;
    if (j.football && (j.mode === 'play' || !j.mode)) GAMES.football = j.football;
    GAMES.timing = j.timing; GAMES.tournament = j.tournament || GAMES.tournament;
    GAMES.base = j.now - clockNow();
  }
  function pollGames(now, mode) {
    if (GAMES.mode !== mode) { GAMES.mode = mode; GAMES.asked = -99; }
    if (GAMES.fixed || !D.gamesUrl || !window.fetch || GAMES.busy || now - GAMES.asked < 8) return;
    GAMES.asked = now; GAMES.busy = true;
    fetch(D.gamesUrl + '?mode=' + mode, { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { GAMES.busy = false; if (j) setGames(j); })
      .catch(function () { GAMES.busy = false; });
  }
  function heroById(id) { for (var i = 0; i < heroes.length; i++) if (heroes[i].id === id) return heroes[i]; return null; }

  // ---------------------------------------------------------------- the campfire: dancing round the mud arena
  // Everyone who isn't wrestling dances in a ring round the arena's wall (leaving the two gates clear), doing the
  // party's dances: one at a time for everyone, a new one every 16 beats. In the ring dances the whole ring moves:
  // the Hora steps round, the Conga marches round, in Mayim Mayim everyone steps in towards the fire and out.
  function campJoin(h) {                               // walk to the nearest place on the ring, then dance round it to your own place
    h.camp = true; h.campAt = null;
    var p = h.root.position, a = Math.atan2(p.z - FIRE.z, p.x - FIRE.x) + ((h.i % 9) - 4) * 0.11, half = Math.asin(Math.min(0.9, 1.9 / CAMP.r));   // (spread out: not all to one spot)
    ARENA_GATES.forEach(function (gA) { var d = ((a - gA + PI * 3) % TAU) - PI; if (Math.abs(d) < half) a = gA + (d < 0 ? -half : half) * 1.05; });   // not in a gate
    var at = V(FIRE.x + Math.cos(a) * CAMP.r, 0, FIRE.z + Math.sin(a) * CAMP.r);
    goTo(h, at, function () { if (h.camp) { face(h, FIRE); doAct(h, 'campdance', 9999, null, clockNow()); } });
  }
  function campSlot(h) {
    var list = heroes.filter(function (o) { return o.camp; }).sort(function (a, b) { return a.i - b.i; });
    var n = Math.max(1, list.length), k = Math.max(0, list.indexOf(h));
    var G = ARENA_GATES.length, gap = 2 * Math.asin(Math.min(0.9, 1.9 / CAMP.r)), arc = TAU / G - gap, total = G * arc;   // the ring leaves every gate clear
    var t = (((k + 0.5) / n) * total + CAMP.rot) % total;
    if (t < 0) t += total;
    var gi = Math.min(G - 1, Math.floor(t / arc)), a = ARENA_GATES[gi] + gap / 2 + (t - gi * arc), r = CAMP.r - CAMP.inward;
    var p = V(FIRE.x + Math.cos(a) * r, 0, FIRE.z + Math.sin(a) * r);
    p.a = a;
    return p;
  }
  var campBeat = -1;
  function stepCamp(now, dt) {
    if (current !== 'campfire') return;
    var b = visBeats(now), beat = Math.floor(b);
    if (RING.ceremony && dance.cur.id !== 'handsup') { dance.cur = DANCES[DANCES.length - 1]; dance.startBeat = beat; }   // hands up for the champion
    else if (!RING.ceremony && beat !== campBeat && beat - dance.startBeat >= FLOOR_BEATS && beat % 4 === 0) {
      dance.k = (dance.k + 1) % DANCES.length; dance.cur = DANCES[dance.k]; dance.startBeat = beat;
    }
    campBeat = beat;
    var id = dance.cur.id, gapSpeed = { hora: 0.07, conga: 0.17, mayim: 0.05 }[id] || 0;
    if (id === 'mayim') { var m16 = b % 16; gapSpeed = m16 < 8 ? 0.09 : 0; CAMP.inward = m16 < 8 ? 0 : Math.sin((m16 - 8) / 8 * PI) * 0.9; }
    else CAMP.inward *= Math.max(0, 1 - dt * 3);
    CAMP.rot += gapSpeed * dt;
    heroes.forEach(function (h) {                      // dancers move round the ring (never across the arena) to their places
      if (!h.camp || h.act !== 'campdance') return;
      var tgt = campSlot(h), p = h.root.position, ox = p.x - FIRE.x, oz = p.z - FIRE.z, r0 = Math.hypot(ox, oz) || 1;
      var a0 = Math.atan2(oz, ox), da = ((tgt.a - a0 + PI * 3) % TAU) - PI, tr = Math.hypot(tgt.x - FIRE.x, tgt.z - FIRE.z);
      if (Math.abs(da) * r0 > 1.5) tr = ARENA_W + 0.95;   // a long way to your place: along the inside lane, past the dancers
      var dr = tr - r0;
      var lin = (id === 'conga' ? 3.2 : 2.6) * dt * (Math.abs(da) * r0 > 6 ? 1.8 : 1);     // a long way round: hurry
      var stA = Math.max(-lin / r0, Math.min(lin / r0, da)), stR = Math.max(-lin, Math.min(lin, dr));
      var a1 = a0 + stA, r1 = Math.max(ARENA_W + 0.95, r0 + stR);
      p.x = FIRE.x + Math.cos(a1) * r1; p.z = FIRE.z + Math.sin(a1) * r1;
      h.campMoving = Math.abs(da) * r0 > 0.2 || Math.abs(dr) > 0.2;
      if (id === 'conga') h.wantFacing = Math.atan2(-Math.sin(tgt.a), Math.cos(tgt.a));      // marching round the ring
      else face(h, FIRE);
    });
    // the show round the arena: for the champion the braziers fire one after another on every beat and fireworks
    // fill the sky; while everyone dances, a firework now and then, and two braziers on each new dance
    var nb = RING.braziers.length;
    if (beat !== campFxBeat) {
      campFxBeat = beat;
      if (RING.ceremony && RING.ready) { fireJet(RING.braziers[beat % nb], now); fireJet(RING.braziers[(beat + nb / 2) % nb], now); }
      else if (beat === dance.startBeat && !RING.bout) { var bj = beat % nb; fireJet(RING.braziers[bj], now); fireJet(RING.braziers[(bj + nb / 2) % nb], now); }
    }
    if (RING.ceremony && RING.ready && now > RING.nextWork) {
      var br = RING.braziers[Math.floor(R() * nb)];
      launchWork(br.pos, rr(9, 15), null, now, 0, overArena(br)); RING.nextWork = now + rr(0.5, 0.9);
    } else if (!RING.bout && now > RING.nextWork) {
      var br2 = RING.braziers[Math.floor(R() * nb)];
      launchWork(br2.pos, rr(9, 14), null, now, 0, overArena(br2)); RING.nextWork = now + rr(7, 12);
    }
  }
  var campFxBeat = -1;
  function overArena(j) { return V((j.pos.x + RING.c.x * 2) / 3, 0, (j.pos.z + RING.c.z * 2) / 3); }   // fireworks burst over the arena, not the field

  // ---------------------------------------------------------------- the mud arena: the tournament's bouts
  // The three wrestlers leave the dance and walk in to their corners, salute and bow at the bell, then wrestle round
  // the fire pit: they circle and close in, and every grab and throw happens when the station says, landing, dodged
  // or throwing someone flat (with stars). The most points goes through; they bow and go back to dancing. After the
  // final, the champion has a ceremony by the fire while everyone dances with their hands up.
  function dressForFight(h, corner, champion) {        // into their no-gi kit, gloves in the corner's colour (the champion's gold, with the belt)
    h.dress = { gloves: champion ? '#e8b73a' : RING.colors[corner] || RING.colors[0] };
    setTool(h, 'none');
    if (champion) {
      var u = h.root.userData, gold = new THREE.MeshToonMaterial({ color: 0xf2c94c, emissive: new THREE.Color(0x5a3c00), emissiveIntensity: 0.35 });
      var body = u.hero.children[0] || u.hero;          // (on the body, so it fits broader and narrower heroes alike)
      body.add(mesh(new THREE.CylinderGeometry(0.414, 0.414, 0.15, 28), gold, [0, 0.6, 0]));
      body.add(mesh(new THREE.BoxGeometry(0.3, 0.22, 0.05), gold, [0, 0.6, 0.405]));
      body.add(mesh(new THREE.SphereGeometry(0.05, 10, 8), mat('#d81b60'), [0, 0.6, 0.435]));
    }
  }
  function undress(h) {                                 // back into their own clothes
    if (!h.dress) return;
    h.dress = null;
    setTool(h, ACTS[current].tool);
  }
  function ringJoin(h, f) {                            // a wrestler in this bout: into the fight kit and in to your corner
    playLeave(h);
    h.camp = false;
    dressForFight(h, f.corner, RING.ceremony);
    h.sp = { corner: f.corner, inK: 1, vx: 0, vz: 0, kx: 0, kz: 0, atk: 0, hitT: -9, down: -9, downAt: -9, dodge: -9,
             mud: 0, target: null, retarget: 0, orbit: R() < 0.5 ? 1 : -1, stars: null, speed: 0, force: null, forceUntil: 0, speedK: h.speedK };
    h.speedK = h.sp.speedK * 1.5;                      // hurry in
    RING.fighters.push(h);
    heroLabel(h, follow === h);
    goTo(h, RING.starts[f.corner], function () {
      if (!h.sp) return;
      face(h, RING.c);
      doAct(h, RING.ceremony ? 'champion' : RING.ready ? 'spar' : 'ringwait', 9999, null, clockNow());
    });
  }
  function ringOut(h) {                                // gear off, back to normal
    removeGear(h);
    undress(h);
    if (h.sp) {
      if (h.sp.stars) { scene.remove(h.sp.stars); h.sp.stars.material.dispose(); }
      h.speedK = h.sp.speedK;
    }
    h.sp = null;
    heroLabel(h, follow === h);
  }
  function ringLeave(h) {
    ringOut(h);
    RING.fighters = RING.fighters.filter(function (o) { return o !== h; });
    if (!RING.fighters.length) { RING.bout = null; RING.ceremony = false; RING.phase = 'idle'; drawRingBoard(); }
  }
  function arenaStart(m, now) {
    RING.bout = m; RING.fighters = []; RING.evI = 0; RING.pending = []; RING.points = {}; RING.ready = false; RING.phase = 'gather';
    RING.winner = null; RING.ceremony = m.style === 'ceremony';
    if (RING.ceremony) {
      var ch = heroById(m.champion);
      if (ch) ringJoin(ch, { corner: 0 });
      ringBanner('🏆 ' + (m.champion_name || '?') + ': GRAND CHAMPION!', '#c2185b', now);
    } else m.fighters.forEach(function (f) { RING.points[f.id] = 0; var h = heroById(f.id); if (h) ringJoin(h, f); });
    drawRingBoard();
  }
  function arenaFinish() {                             // the bout is over: back to the dance
    var F = RING.fighters.slice();
    RING.bout = null; RING.phase = 'idle'; RING.ceremony = false; RING.fighters = [];
    F.forEach(function (h) {
      ringOut(h);
      h.act = null;
      if (current === 'campfire') campJoin(h); else assign(h, clockNow());
    });
    drawRingBoard();
  }
  function arenaBell(now) {                            // the bout begins (or we joined in the middle): gear on, everyone in place
    var st = ringStyle();
    RING.ready = true;
    RING.fighters.forEach(function (h) {
      var s2 = RING.starts[h.sp.corner];
      if (h.root.position.distanceTo(s2) > 0.8) { h.path = []; h.onArrive = null; h.root.position.set(s2.x, 0, s2.z); }   // late: straight in
      if (!h.dress) dressForFight(h, h.sp.corner, RING.ceremony);
      if (!RING.ceremony) addGear(h, st);
      face(h, RING.c);
      doAct(h, RING.ceremony ? 'champion' : 'spar', 9999, null, now);
    });
    if (!RING.ceremony) {
      var m = RING.bout;
      ringBanner((m.stage === 'final' ? 'THE FINAL' : m.stage === 'semi' ? 'FINAL THREE' : 'ROUND ' + m.round + ' · BOUT ' + m.bout) + '!', '#6e4a2a', now);
      RING.braziers.forEach(function (j, i) { fireJet(j, now, i * 0.09); });     // the braziers fire all the way round
      if (m.stage === 'final') for (var w = 0; w < 4; w++) launchWork(RING.braziers[w * 2].pos, rr(10, 15), null, now, w * 0.35, overArena(RING.braziers[w * 2]));
    } else {
      RING.braziers.forEach(function (j) { fireJet(j, now); });
      for (var c2 = 0; c2 < 5; c2++) { var bc = RING.braziers[(c2 * 3) % RING.braziers.length]; launchWork(bc.pos, rr(10, 16), 0.13, now, c2 * 0.25, overArena(bc)); }   // gold
    }
    drawRingBoard();
  }
  function nearBraziers(p, n) {                        // the braziers nearest a spot in the arena
    return RING.braziers.slice().sort(function (a, b) { return a.pos.distanceToSquared(p) - b.pos.distanceToSquared(p); }).slice(0, n);
  }
  function ringApply(e, now) {                         // a move the station decided lands (or doesn't)
    var st = ringStyle(), a = heroById(e.a), d = e.d ? heroById(e.d) : null;
    if (e.p) { RING.points[e.a] = (RING.points[e.a] || 0) + e.p; drawRingBoard(); }
    var as = a && a.sp, ds = d && d.sp;
    if (e.r === 'slip') {
      if (!as) return;
      as.down = now + 1.3; as.downAt = now; as.mud = Math.min(1, as.mud + 0.2);
      ringPop('WHOOPS!', a.root.position.clone().setY(2.2), '#6e4a2a', now);
      for (var i = 0; i < 10; i++) emit(a.root.position.clone().setY(0.2), V(rr(-1.2, 1.2), rr(1, 2.2), rr(-1.2, 1.2)), DIRT_MAT, 0.7);
      return;
    }
    if (!ds) return;
    if (e.r === 'dodge') { ds.dodge = now; return; }
    var ap = as ? a.root.position : RING.c, tp = d.root.position, dx = tp.x - ap.x, dz = tp.z - ap.z, dd = Math.hypot(dx, dz) || 1;
    var big = e.r === 'ko', kb = st.kb * (big ? 1.5 : 1);
    ds.kx += dx / dd * kb; ds.kz += dz / dd * kb; ds.hitT = now;
    if (big) { ds.down = now + 1.4; ds.downAt = now; }
    var word = e.m === 'throw' ? 'SPLASHDOWN!' : st.pow[Math.floor(R() * st.pow.length)];
    ringPop(word, V((ap.x + tp.x) / 2, 2.3, (ap.z + tp.z) / 2), RING.colors[as ? as.corner : 0], now);
    var at = tp.clone().setY(0.4);
    for (var k = 0; k < (big ? 22 : 12); k++) emit(at.clone(), V(rr(-1.6, 1.6), rr(1.2, 3.0), rr(-1.6, 1.6)), DIRT_MAT, 0.8);
    ds.mud = Math.min(1, ds.mud + (big ? 0.3 : 0.18)); if (as) as.mud = Math.min(1, as.mud + 0.08);
    if (big || e.m === 'throw') {                      // a throw: the nearest braziers flare, sparks fly from the fire, a big one gets a rocket
      nearBraziers(tp, 2).forEach(function (j, i) { fireJet(j, now, i * 0.12); });
      if (!calm) for (var sk = 0; sk < 14; sk++) emit(V(RING.c.x + rr(-0.6, 0.6), 2.2, RING.c.z + rr(-0.6, 0.6)), V(rr(-2.2, 2.2), rr(3, 5.5), rr(-2.2, 2.2)), SPARK_MAT, 1.1);
      if (big) { var nb1 = nearBraziers(tp, 1)[0]; launchWork(nb1.pos, rr(9, 13), null, now, 0, overArena(nb1)); }
    }
  }
  function stepRing(now, dt) {
    var c = RING.c;
    var bk = Math.max(0, 1 - (now - RING.bannerAt) / 2.6);            // the banner rises and fades
    RING.banner.visible = bk > 0;
    if (bk > 0) { RING.banner.material.opacity = Math.min(1, bk * 3); RING.banner.position.set(c.x, RING.bannerY + (1 - bk) * 0.7, c.z); }
    RING.pops.forEach(function (p) {
      var k = (now - p.at) / 0.8;
      p.s.visible = k >= 0 && k < 1;
      if (p.s.visible) { p.s.material.opacity = Math.min(1, (1 - k) * 2.5); p.s.position.y = p.base + k * 0.6; }
    });
    if (current !== 'campfire') return;
    pollGames(now, 'campfire');
    var w = wallNow(), TT = GAMES.timing;
    if (w === null || !TT) return;
    var T = TT.arena, live = null;
    GAMES.arena.forEach(function (m) {
      var lead = m.style === 'ceremony' ? TT.ceremony.lead : T.lead;
      if (!live && w >= m.start - lead && w < m.end) live = m;
    });
    if (RING.bout && (!live || live.id !== RING.bout.id)) arenaFinish();
    if (live && !RING.bout) arenaStart(live, now);
    if (!RING.bout) return;
    var m = RING.bout, st = ringStyle(), t = w - m.start, F = RING.fighters;
    if (RING.ceremony) {                               // the champion celebrates by the fire, gold sparks fly
      if (t >= 0 && !RING.ready) arenaBell(now);
      if (Math.random() < dt * 18) emit(V(c.x + rr(-1.8, 1.8), 4.6, c.z + rr(-1.8, 1.8)), V(rr(-2, 2), rr(2.5, 5), rr(-2, 2)), SPARK_MAT, 1.6);
      return;
    }
    m.fighters.forEach(function (f) {                  // a wrestler who only just arrived on the farm
      var h = heroById(f.id);
      if (h && !h.sp) { ringJoin(h, f); if (RING.ready) arenaBell(now); }
    });
    F.forEach(function (h) { if (h.gear && h.gear.root !== h.root) addGear(h, st); });   // the hero was rebuilt: put the gear back on
    var ph = t < 0 ? 'gather' : t < T.intro ? 'intro' : t < T.intro + T.fight ? 'fight' : 'outro';
    if (ph !== 'gather' && !RING.ready) arenaBell(now);
    if (ph !== RING.phase) {
      RING.phase = ph; RING.t0 = now - (ph === 'intro' ? t : ph === 'fight' ? t - T.intro : t - T.intro - T.fight);
      if (ph === 'outro') {
        var win = m.fighters.filter(function (f) { return String(f.id) === m.winner; })[0];
        RING.winner = win ? heroById(win.id) : null; RING.winnerId = win ? win.id : null;
        var thru = (m.advance || []).length > 1 ? ' & ' + m.fighters.filter(function (f) { return f.id === m.advance[1]; }).map(function (f) { return f.name; })[0] : '';
        ringBanner(win ? (m.stage === 'final' ? win.name + ' WINS IT ALL!' : win.name + thru + ' GO' + (thru ? '' : 'ES') + ' THROUGH!') : 'A DRAW!',
                   win ? RING.colors[win.corner] : '#2e7d32', now);
        var hue = win ? [0.0, 0.6, 0.12][win.corner] : 0.33;           // fireworks in the winner's colour
        RING.braziers.forEach(function (j) { fireJet(j, now); });
        for (var fw = 0; fw < (m.stage === 'final' ? 7 : 3); fw++) { var bw = RING.braziers[(fw * 3 + 1) % RING.braziers.length]; launchWork(bw.pos, rr(9, 15), fw % 2 ? null : hue, now, fw * 0.3, overArena(bw)); }
      }
    }
    while (RING.evI < m.events.length && m.events[RING.evI].t - st.impact <= t) {     // moves starting now
      var e = m.events[RING.evI++];
      if (e.t < t - 0.5) { if (e.p) RING.points[e.a] = (RING.points[e.a] || 0) + e.p; continue; }   // already over (we joined late)
      var a = heroById(e.a);
      if (a && a.sp && e.r !== 'slip') {
        a.sp.atk = now - Math.max(0, t - (e.t - st.impact)); a.sp.atkSide = R() < 0.5 ? 1 : -1;
        a.sp.force = heroById(e.d); a.sp.forceUntil = now + st.impact + 0.25;
      }
      RING.pending.push(e);
    }
    for (var pi = RING.pending.length - 1; pi >= 0; pi--) {
      if (RING.pending[pi].t <= t) { ringApply(RING.pending[pi], now); RING.pending.splice(pi, 1); }
    }
    if (ph === 'gather') return;
    if (ph === 'outro') {
      F.forEach(function (h) { h.sp.kx *= 0.9; h.sp.kz *= 0.9; if (RING.winner && h !== RING.winner) face(h, RING.winner.root.position); else face(h, RING.c); });
      return;
    }
    if (ph === 'intro') { F.forEach(function (h) { face(h, RING.c); }); return; }
    F.forEach(function (h) {                           // wrestling: circle round the fire, close in for each move
      var s = h.sp, p = h.root.position;
      s.kx *= Math.max(0, 1 - dt * 3.5); s.kz *= Math.max(0, 1 - dt * 3.5);
      if (now < s.down) { p.x += s.kx * dt; p.z += s.kz * dt; ringClamp(p); return; }
      var pool = F.filter(function (o) { return o !== h; });
      if (!pool.length) return;
      if (!s.target || pool.indexOf(s.target) < 0 || now > s.retarget) { s.target = pool[Math.floor(R() * pool.length)]; s.retarget = now + rr(2.5, 5); s.orbit = R() < 0.5 ? 1 : -1; }
      var tgt = s.force && now < s.forceUntil && pool.indexOf(s.force) >= 0 ? s.force : s.target;
      var tp = tgt.root.position, dx = tp.x - p.x, dz = tp.z - p.z, d = Math.hypot(dx, dz) || 1e-3;
      var stag = now - s.hitT < 0.45 ? 0.2 : 1, closing = tgt === s.force && now < s.forceUntil;
      var radial = Math.max(-1, Math.min(1, (d - st.reach * (closing ? 0.7 : 1.1)) * 1.6)), tang = closing ? 0 : s.orbit * 0.8;
      var mx = dx / d * radial - dz / d * tang, mz = dz / d * radial + dx / d * tang;
      pool.forEach(function (o) {                      // keep a little room from the third wrestler
        if (o === tgt) return;
        var ox = p.x - o.root.position.x, oz = p.z - o.root.position.z, od = Math.hypot(ox, oz);
        if (od < 1.0 && od > 1e-3) { mx += ox / od * (1.0 - od) * 3; mz += oz / od * (1.0 - od) * 3; }
      });
      var ml = Math.hypot(mx, mz);
      if (ml > 1) { mx /= ml; mz /= ml; }
      var sp2 = st.speed * stag * (closing ? 1.6 : 1);
      s.vx += (mx * sp2 - s.vx) * Math.min(1, dt * 5); s.vz += (mz * sp2 - s.vz) * Math.min(1, dt * 5);
      p.x += (s.vx + s.kx) * dt; p.z += (s.vz + s.kz) * dt;
      if (d < 0.62) { p.x -= dx / d * (0.62 - d) * 0.5; p.z -= dz / d * (0.62 - d) * 0.5; }   // never inside each other
      ringClamp(p);
      h.wantFacing = Math.atan2(dx, dz);
      s.speed = Math.hypot(s.vx, s.vz);
    });
  }
  function ringClamp(p) {                              // stay on the sand: off the fire pit and inside the wall
    var dx = p.x - RING.c.x, dz = p.z - RING.c.z, d = Math.hypot(dx, dz) || 1e-3;
    var k = d < RING.inner ? RING.inner / d : d > RING.fight ? RING.fight / d : 1;
    if (k !== 1) { p.x = RING.c.x + dx * k; p.z = RING.c.z + dz * k; }
  }
  // ---- the gear for each style, put on at the bell and taken off after the round
  function gearMat(c, o) { var m = { color: new THREE.Color(c) }; for (var k in o || {}) m[k] = o[k]; return new THREE.MeshToonMaterial(m); }
  function addGear(h, st) {
    removeGear(h);
    var u = h.root.userData, arms = u.arms || {}, legs = u.legs || {}, col = RING.colors[h.sp.corner], parts = [], mud = [];
    function put(parent, obj, pos, scale) {
      if (!parent) return obj;
      if (pos) obj.position.set(pos[0], pos[1], pos[2]);
      if (scale) obj.scale.set(scale[0], scale[1], scale[2]);
      parent.add(obj); parts.push(obj);
      return obj;
    }
    function ball(r, c) { return new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), gearMat(c)); }
    if (st.id === 'gloves') {                          // huge padded gloves and a head guard
      [1, -1].forEach(function (sd) {
        put(arms[sd], ball(0.22, col), [0, -0.52, 0.05], [1, 1.05, 1.25]);
        put(arms[sd], new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.115, 0.1, 12), gearMat('#ffffff')), [0, -0.36, 0]);
      });
      var band = put(u.headRig, new THREE.Mesh(new THREE.TorusGeometry(0.53, 0.075, 8, 28), gearMat(col)), [0, 0.62, 0]);
      band.rotation.x = PI / 2;
    } else if (st.id === 'sumo') {                     // a big puffy sumo suit with its belt
      var skin = '#f3c7a0';
      put(u.hero, ball(0.52, skin), [0, 0.8, 0.03], [1.14, 0.96, 1.06]);
      var belt = put(u.hero, new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.1, 8, 28), gearMat(col)), [0, 0.55, 0], [1.12, 1.04, 1]);
      belt.rotation.x = PI / 2;
      put(u.hero, new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.3, 0.06), gearMat(col)), [0, 0.4, 0.47]);
      [1, -1].forEach(function (sd) {
        put(arms[sd], ball(0.16, skin), [0, -0.2, 0]);
        put(legs[sd], ball(0.17, skin), [0, -0.12, 0]);
      });
    } else if (st.id === 'kendo') {                    // a bamboo sword, a helmet with a face grille and a chest guard
      var sw = new THREE.Group();
      sw.add(mesh(new THREE.CylinderGeometry(0.022, 0.026, 1.15, 8), gearMat('#e8d29a'), [0, -0.62, 0]));
      sw.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.08, 8), gearMat('#ffffff'), [0, -1.22, 0]));
      sw.add(mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.025, 14), gearMat('#3a2a1a'), [0, -0.04, 0]));
      sw.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 8), gearMat('#f4efe4'), [0, 0.07, 0]));
      put(arms[1], sw, [0, -0.47, 0.03]);
      var navy = '#1f2a4a';
      put(u.headRig, new THREE.Mesh(new THREE.SphereGeometry(0.61, 18, 12, PI, PI), gearMat(navy, { side: THREE.DoubleSide })), [0, 0.45, 0]);
      put(u.headRig, new THREE.Mesh(new THREE.SphereGeometry(0.62, 18, 6, 0, PI, 0, PI * 0.28), gearMat(navy, { side: THREE.DoubleSide })), [0, 0.45, 0]);
      put(u.headRig, new THREE.Mesh(new THREE.SphereGeometry(0.63, 12, 8, 0, PI, PI * 0.28, PI * 0.5),
        new THREE.MeshBasicMaterial({ color: 0xc9d1d9, wireframe: true })), [0, 0.45, 0]);
      put(u.hero, new THREE.Mesh(new THREE.CylinderGeometry(0.37, 0.4, 0.42, 18, 1, true, -PI / 2, PI), gearMat('#2b2420', { side: THREE.DoubleSide })), [0, 0.86, 0.02]);
      put(u.hero, new THREE.Mesh(new THREE.CylinderGeometry(0.41, 0.46, 0.24, 18, 1, true), gearMat(navy, { side: THREE.DoubleSide })), [0, 0.54, 0]);
      put(u.hero, new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.04), gearMat(col)), [0, 1.0, -0.36]);   // the corner's colour on the back
    } else {                                           // mud: splotches that grow as they wrestle
      var mm = gearMat('#5b3b20');
      [[u.hero, [0.18, 0.92, 0.3]], [u.hero, [-0.2, 0.7, 0.3]], [u.hero, [0.06, 1.0, -0.3]], [u.hero, [-0.28, 0.85, -0.12]],
       [legs[1], [0, -0.2, 0.1]], [legs[-1], [0, -0.3, 0.09]], [arms[1], [0, -0.3, 0.08]], [arms[-1], [0, -0.22, 0.08]],
       [u.headRig, [0.25, 0.35, 0.45]], [u.headRig, [-0.32, 0.62, 0.36]], [u.headRig, [0.1, 0.85, 0.2]]].forEach(function (m) {
        var b = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), mm);
        put(m[0], b, m[1], [0.01, 0.01, 0.01]);
        if (b.parent) mud.push(b);
      });
    }
    h.gear = { root: h.root, parts: parts, mud: mud, style: st.id };
  }
  function removeGear(h) {
    if (!h.gear) return;
    h.gear.parts.forEach(function (o) {
      if (o.parent) o.parent.remove(o);
      o.traverse(function (x) { if (x.geometry) x.geometry.dispose(); if (x.material) x.material.dispose(); });
    });
    h.gear = null;
  }
  function ringPose(h, u, arms, legs, now, dt) {
    var s = h.sp, st = ringStyle();
    if (!s) return;
    var ph = RING.phase, T = (GAMES.timing && GAMES.timing.arena) || { intro: 4, outro: 4.2 };
    if (ph === 'intro' || ph === 'gather') {           // at the bell: a gladiator's salute, a bow, then a stomp (sumo) or the guard
      var bt = ph === 'gather' ? 0 : (now - RING.t0) / T.intro;
      if (bt < 0.4) { armSet(arms, 1, -2.9, 0.1); armSet(arms, -1, -0.2, 0); u.hero.position.y += Math.abs(Math.sin(bt * 20)) * 0.04; }   // ave!
      else if (bt < 0.7) u.hero.rotation.x = Math.sin((bt - 0.4) / 0.3 * PI) * 0.55;
      else if (st.id === 'sumo') { var lk = Math.sin((bt - 0.7) / 0.3 * PI); if (legs[1]) legs[1].rotation.z = lk * 0.9; u.hero.rotation.z = -lk * 0.15; }
      else ringStance(h, u, arms, legs, now, st);
      if (st.id === 'mud') mudGrow(h);
      return;
    }
    if (ph === 'outro') {
      u.hero.position.y += RING.h;
      var ot = now - RING.t0;
      if (ot > T.outro - 1.3) u.hero.rotation.x = Math.sin((ot - T.outro + 1.3) / 1.3 * PI) * 0.55;   // everyone bows
      else if (RING.winner === h || !RING.winner) {
        u.hero.position.y += Math.abs(Math.sin(now * 7 + h.phase)) * 0.35;
        [1, -1].forEach(function (s2) { armSet(arms, s2, -2.95, 0.3); });
      } else [1, -1].forEach(function (s2) { armSet(arms, s2, -1.35, -0.45 + Math.abs(Math.sin(now * 9)) * 0.35); });   // clapping
      if (st.id === 'mud') mudGrow(h);
      return;
    }
    // the fight
    u.hero.position.y += RING.h;
    if (now < s.down) {                                // knocked flat (or slipped): on their back, stars round the head
      var dk = Math.min(1, (now - s.downAt) / 0.25), uk = Math.min(1, (s.down - now) / 0.4), k = Math.min(dk, uk);
      u.hero.rotation.x = -1.45 * k;
      u.hero.position.y += 0.28 * k;
      [1, -1].forEach(function (s2) { armSet(arms, s2, -2.2 * k, 0.6 * k); if (legs[s2]) legs[s2].rotation.x = -0.5 * k * (s2 > 0 ? 1 : 0.6); });
      if (!s.stars) {
        s.stars = new THREE.Sprite(new THREE.SpriteMaterial({ map: RING.starTex, transparent: true, depthTest: false }));
        s.stars.scale.set(0.5 * RING.starAspect, 0.5, 1); s.stars.renderOrder = 21; scene.add(s.stars);
      }
      var bx = Math.sin(h.root.rotation.y) * -1.3 * k, bz = Math.cos(h.root.rotation.y) * -1.3 * k;
      s.stars.visible = k > 0.5;
      s.stars.position.set(h.root.position.x + bx, RING.h + 0.9 + (1 - k) * 1.4, h.root.position.z + bz);
      s.stars.material.rotation = now * 3;
      if (st.id === 'mud') mudGrow(h);
      return;
    }
    if (s.stars) s.stars.visible = false;
    ringStance(h, u, arms, legs, now, st);
    var hk = now - s.hitT;                             // just got hit: rock back
    if (hk < 0.45) { u.hero.rotation.x -= Math.sin(hk / 0.45 * PI) * 0.4; if (u.headRig) u.headRig.rotation.x = -Math.sin(hk / 0.45 * PI) * 0.3; }
    var dk2 = now - s.dodge;                           // ducked
    if (dk2 < 0.4) { u.hero.position.y -= Math.sin(dk2 / 0.4 * PI) * 0.25; u.hero.rotation.z = Math.sin(dk2 / 0.4 * PI) * 0.3 * s.orbit; }
    if (st.id === 'mud') mudGrow(h);
  }
  function ringStance(h, u, arms, legs, now, st) {
    var s = h.sp, a = now - s.atk, sw = s.atk && a < 0.55 ? a / 0.55 : -1, step = (s.speed || 0) > 0.3;
    if (step) {
      var cyc = now * 10 * h.speedK + h.phase;
      [1, -1].forEach(function (s2) { if (legs[s2]) legs[s2].rotation.x = Math.sin(cyc) * 0.45 * s2; });
    }
    if (st.id === 'gloves') {                          // gloves up at the chest (higher hides them in the big heads), bounce, jab
      var jb = sw >= 0 ? Math.sin(sw * PI) : 0;
      u.hero.position.y += Math.abs(Math.sin(now * 7 + h.phase)) * 0.05;
      u.hero.rotation.x = 0.1 + jb * 0.18;
      [1, -1].forEach(function (s2) {
        if (jb && s2 === s.atkSide) armSet(arms, s2, -1.3 - jb * 0.3, -0.32 + jb * 0.3);
        else armSet(arms, s2, -1.25 + Math.sin(now * 6 + s2) * 0.08, -0.38);
      });
    } else if (st.id === 'sumo') {                     // wide and low, then a belly charge
      if (!step) [1, -1].forEach(function (s2) { if (legs[s2]) legs[s2].rotation.z = s2 * 0.3; });
      var ch = sw >= 0 ? Math.sin(sw * PI) : 0;
      u.hero.rotation.x = 0.18 + ch * 0.3;
      u.hero.scale.set(1 + ch * 0.06, 1 - ch * 0.05, 1 + ch * 0.06);
      [1, -1].forEach(function (s2) { armSet(arms, s2, -1.35 - ch * 0.25, 0.35); });
    } else if (st.id === 'kendo') {                    // sword up front, then over the head and down
      var lift = sw < 0 ? 0 : sw < 0.45 ? sw / 0.45 : 1 - (sw - 0.45) / 0.55 * 1.25;
      var ax = -1.25 - Math.max(0, lift) * 1.55 + Math.max(0, -lift) * 0.35;
      armSet(arms, 1, ax, -0.32);
      armSet(arms, -1, ax + 0.05, -0.42);
      u.hero.rotation.x = 0.06 + (sw > 0.45 ? 0.15 : 0);
    } else {                                           // mud: crouched, arms out, then a lunge to grab
      var ln = sw >= 0 ? Math.sin(sw * PI) : 0;
      u.hero.position.y -= 0.1;
      u.hero.rotation.x = 0.35 + ln * 0.3;
      [1, -1].forEach(function (s2) { armSet(arms, s2, -1.45 - ln * 0.3, 0.3 - ln * 0.25); });
    }
  }
  function mudGrow(h) {
    if (!h.gear || !h.gear.mud) return;
    var k = 0.6 + h.sp.mud * 0.8;                     // a little muddy from the first step in, much muddier later
    h.gear.mud.forEach(function (b, i) { var kk = Math.max(0.01, k - (i % 3) * 0.15); b.scale.set(kk, kk * 0.8, kk * 0.6); });
  }
  // ---------------------------------------------------------------- football: the station's match
  // The station picks balanced teams and decides every goal, save and miss; the farm plays it: the players chase the
  // ball as usual, and for each of the station's shots the shooter gets the ball and kicks (in, at the keeper, or
  // wide). Only the station's goals count: anything else bounces off the post or the keeper.
  function footballStart(m) {
    FB.match = m; FB.evI = 0; FB.shot = null; FB.score = [0, 0]; FB.allow = -1;
    m.teams.forEach(function (tm, side) { tm.forEach(function (p, k) { var h = heroById(p.id); if (h) joinFootball(h, side, k); }); });
    drawScore();
  }
  function footballFinish() {
    var list = PST.football.users.slice();
    FB.match = null; FB.shot = null;
    list.forEach(function (h) { h.act = null; playDone(h, 'football')(); });
  }
  function footballGoal(team, now, e) {                // a goal the station decided: score, banner, cheering
    if (e.counted) return;
    e.counted = true;
    FB.score[team]++; drawScore();
    var c = FB.c, dir = team === 0 ? 1 : -1;
    FB.resetAt = now + 2.4; FB.bannerAt = now;
    FB.banner.position.set(c.x + dir * (FB.hx - 1.5), 2.6, c.z);
    PST.football.users.forEach(function (h) { if (h.fbTeam === team) h.fbCheer = now + 2.0; });
  }
  function stepMatch(now, dt) {                        // which match is on, who plays, and the station's shots
    if (current !== 'play') return;
    pollGames(now, 'play');
    var w = wallNow(), T = GAMES.timing && GAMES.timing.football;
    if (w === null || !T) return;
    var live = null;
    GAMES.football.forEach(function (m) { if (!live && w >= m.start - T.lead && w < m.end + 1) live = m; });
    if (FB.match && (!live || live.id !== FB.match.id)) footballFinish();
    if (live && !FB.match) {
      footballStart(live);
      live.events.forEach(function (e) { if (e.t < w - live.start - 0.5) { e.done = true; if (e.type === 'goal' && !e.counted) { e.counted = true; FB.score[e.team]++; } } });
      drawScore();
    }
    var m = FB.match;
    if (!m) return;
    m.teams.forEach(function (tm, side) { tm.forEach(function (p, k) { var h = heroById(p.id); if (h && h.fbTeam === undefined && !h.sp) joinFootball(h, side, k); }); });
    var el = w - m.start, ball = FB.ball, bp = ball.position, c = FB.c;
    var e = m.events.filter(function (x) { return !x.done; })[0];
    if (e && el >= e.t - 1.1 && !FB.shot) FB.shot = { e: e, kicked: false };
    var sh = FB.shot;
    if (!sh) return;
    var ev = sh.e, shooter = heroById(ev.by), dir = ev.team === 0 ? 1 : -1;
    if (!sh.kicked && shooter && shooter.fbTeam !== undefined) {   // the shooter gets the ball
      var sp = shooter.root.position, front = V(sp.x + dir * 0.45, 0.22, sp.z);
      bp.lerp(front, Math.min(1, dt * 9)); FB.v.multiplyScalar(0.5); FB.resetAt = 0;
    }
    if (!sh.kicked && el >= ev.t - 0.75) {             // ...and kicks
      sh.kicked = true;
      var goalX = c.x + dir * (FB.hx + 0.4), tz;
      if (ev.type === 'goal') tz = c.z + rr(-0.55, 0.55);
      else if (ev.type === 'save') { var kp = heroById(ev.keeper); tz = kp ? kp.root.position.z : c.z; goalX = c.x + dir * (FB.hx - 0.5); }
      else tz = c.z + (R() < 0.5 ? -1 : 1) * (FB.mouth + rr(0.5, 1.1));
      if (!shooter || shooter.fbTeam === undefined) { bp.set(goalX - dir * 5, 0.22, c.z); }
      var dx = goalX - bp.x, dz = tz - bp.z, D2 = Math.hypot(dx, dz) || 1, speed = Math.min(17, D2 * 1.8);
      FB.v.set(dx / D2 * speed, 0, dz / D2 * speed);
      FB.allow = ev.type === 'goal' ? ev.team : -1;
      if (shooter) { shooter.kickT = now; shooter.kickAt = now + 0.7; shooter.wantFacing = Math.atan2(dx, dz); }
      if (ev.type === 'save') { var kp2 = heroById(ev.keeper); if (kp2) kp2.saveAt = now + 0.7; }
    }
    if (sh.kicked && el >= ev.t + 0.6) {               // done (a goal that missed the net still counts: the station said so)
      if (ev.type === 'goal') footballGoal(ev.team, now, ev);
      ev.done = true; FB.shot = null; FB.allow = -1;
    }
  }
  var _fbT = V(0, 0, 0);
  function stepFootball(now, dt) {
    var ball = FB.ball, bp = ball.position, v = FB.v, c = FB.c;
    stepMatch(now, dt);
    var players = PST.football.users.filter(function (h) { return h.act === 'football'; });
    if (FB.resetAt && now > FB.resetAt) { FB.resetAt = 0; bp.set(c.x, 0.22, c.z); v.set(0, 0, 0); }
    bp.x += v.x * dt; bp.z += v.z * dt;
    var fr = Math.max(0, 1 - dt * 0.85); v.x *= fr; v.z *= fr;
    var inner = ball.userData.inner;
    inner.rotation.x += v.z * dt / 0.22; inner.rotation.z -= v.x * dt / 0.22;
    if (bp.z < c.z - FB.hz + 0.22) { bp.z = c.z - FB.hz + 0.22; v.z = Math.abs(v.z) * 0.7; }
    if (bp.z > c.z + FB.hz - 0.22) { bp.z = c.z + FB.hz - 0.22; v.z = -Math.abs(v.z) * 0.7; }
    var end = bp.x - c.x;
    if (!FB.resetAt && Math.abs(end) > FB.hx - 0.15) {
      var team = end > 0 ? 0 : 1;
      if (Math.abs(bp.z - c.z) < FB.mouth - 0.2 && FB.allow === team && FB.shot) {     // GOAL! (one the station decided)
        footballGoal(team, now, FB.shot.e); FB.allow = -1;
      } else { bp.x = c.x + Math.sign(end) * (FB.hx - 0.15); v.x = -v.x * 0.6; }     // off the post, or the keeper's hands
    }
    if (FB.resetAt && Math.abs(end) > FB.hx + 0.6) { bp.x = c.x + Math.sign(end) * (FB.hx + 0.6); v.set(0, 0, 0); }   // in the net
    var bk = Math.max(0, 1 - (now - FB.bannerAt) / 2.2);
    FB.banner.material.opacity = bk > 0 ? Math.min(1, bk * 3) : 0;
    FB.banner.visible = bk > 0;
    if (bk > 0) FB.banner.position.y = 2.6 + (1 - bk) * 0.8;
    if (FB.ballShadow) FB.ballShadow.position.set(bp.x, 0.03, bp.z);
    if (!players.length) {                             // nobody playing: the ball rolls back to the middle in time
      FB.idle += dt;
      if (FB.idle > 6 && !FB.resetAt) { bp.lerp(V(c.x, 0.22, c.z), Math.min(1, dt * 0.5)); }
      return;
    }
    FB.idle = 0;
    [0, 1].forEach(function (team) {
      var mine = players.filter(function (h) { return h.fbTeam === team; }).sort(function (a, b) { return a.fbIdx - b.fbIdx; });
      if (!mine.length) return;
      var dir = team === 0 ? 1 : -1, goalX = c.x + dir * FB.hx, ownX = c.x - dir * FB.hx;
      var keeper = mine.length >= 3 ? mine[mine.length - 1] : null, chaser = null, best = Infinity;
      mine.forEach(function (h) { if (h === keeper) return; var d = h.root.position.distanceToSquared(bp); if (d < best) { best = d; chaser = h; } });
      mine.forEach(function (h, k) {
        var p = h.root.position, speed = 2.4;
        if (h.fbCheer > now) { h.fbMove = false; face(h, V(c.x, 0, c.z + 10)); return; }
        if (FB.resetAt) _fbT.copy(fbHome(h));
        else if (h === keeper) { _fbT.set(ownX + dir * 0.8, 0, Math.max(c.z - 1.0, Math.min(c.z + 1.0, bp.z))); speed = 2.8; }
        else if (FB.shot && !FB.shot.kicked && h.id === FB.shot.e.by) { _fbT.set(bp.x - dir * 0.38, 0, bp.z); speed = 3.6; }   // the station's shooter
        else if (h === chaser) { _fbT.set(bp.x - dir * 0.38, 0, bp.z); speed = 3.3; }
        else _fbT.set(Math.max(c.x - FB.hx + 0.8, Math.min(c.x + FB.hx - 0.8, bp.x - dir * (1.8 + (k % 2) * 2) )), 0, c.z + ((k % 3) - 1) * 2.4);
        var dx = _fbT.x - p.x, dz = _fbT.z - p.z, d = Math.hypot(dx, dz);
        if (d > 0.12) {
          var st = Math.min(d, speed * h.speedK * dt);
          p.x += dx / d * st; p.z += dz / d * st;
          h.fbMove = true; h.wantFacing = Math.atan2(dx, dz);
        } else { h.fbMove = false; face(h, bp); }
        p.x = Math.max(c.x - FB.hx - 0.2, Math.min(c.x + FB.hx + 0.2, p.x)); p.z = Math.max(c.z - FB.hz - 0.5, Math.min(c.z + FB.hz + 0.5, p.z));
        if (FB.resetAt || FB.shot || now < (h.kickAt || 0) || (h !== chaser && h !== keeper)) return;   // the station's shots aren't interrupted
        if (Math.hypot(bp.x - p.x, bp.z - p.z) > 0.62) return;
        var mate = mine.filter(function (o) { return o !== h && o !== keeper && (o.root.position.x - p.x) * dir > 0.5; })[0];
        var aim = mate && R() < 0.35 ? V(mate.root.position.x - bp.x, 0, mate.root.position.z - bp.z)
                                     : V(goalX + dir * 0.6 - bp.x, 0, c.z + rr(-0.95, 0.95) - bp.z);
        var power = h === keeper ? 8 : mate && aim.length() < 6 ? rr(4, 5.5) : rr(5.5, 8.5);
        aim.normalize(); v.set(aim.x * power, 0, aim.z * power);
        h.kickAt = now + 0.7; h.kickT = now; h.wantFacing = Math.atan2(aim.x, aim.z);
      });
    });
  }
  function stepPlay(now, dt) {
    stepFootball(now, dt);
    stepRing(now, dt);
    SWING.seats.forEach(function (sl) {                // the seat swings with whoever sits on it, then slows down
      if (!(sl.user && sl.user.act === 'swing')) sl.theta *= Math.max(0, 1 - dt * 1.2);
      sl.mesh.rotation.x = -(sl.theta + Math.sin(now * 1.3 + sl.ph) * 0.03);
    });
    var riders = SEESAW.seats.filter(function (sl) { return sl.user && sl.user.act === 'seesaw'; }), want;
    if (riders.length === 2) want = Math.sin((now - riders[0].user.actStart) * 2.2) * 0.3;
    else if (riders.length === 1) want = -riders[0].side * 0.3;
    else want = 0.3;
    SEESAW.angle += (want - SEESAW.angle) * Math.min(1, dt * (riders.length === 2 ? 12 : 3));
    SEESAW.plank.rotation.z = SEESAW.angle;
    var dip = 0;
    TRAMP.seats.forEach(function (sl) { if (sl.user && sl.user.act === 'bounce' && sl.user.trampLow) dip = Math.max(dip, sl.user.trampLow); });
    TRAMP.mat.position.y = TRAMP.y - 0.02 - dip * 0.18;
    var diggers = SANDBOX.seats.filter(function (sl) { return sl.user && sl.user.act === 'dig'; }).length;
    if (diggers) { SANDBOX.built = Math.min(1, SANDBOX.built + dt * 0.012 * diggers); SANDBOX.castle.scale.setScalar(SANDBOX.built); }
    KITES.forEach(function (k) {
      var x = k.stake.x + Math.sin(now * 0.23 + k.ph) * 3 - Math.sign(k.stake.x) * 4, y = 12 + Math.sin(now * 0.5 + k.ph) * 1.6, z = k.stake.z - 6 + Math.cos(now * 0.31 + k.ph) * 2;
      k.kite.position.set(x, y, z); k.kite.rotation.set(0.2, Math.sin(now * 0.4 + k.ph) * 0.4, Math.sin(now * 0.9 + k.ph) * 0.25);
      var pos = k.str.geometry.attributes.position; pos.setXYZ(1, x, y - 0.9, z); pos.needsUpdate = true; k.str.geometry.computeBoundingSphere();
    });
  }
  function sitPose(u, legs, arms, legX) {
    [1, -1].forEach(function (s2) { if (legs[s2]) { legs[s2].rotation.x = legX; legs[s2].rotation.z = 0; } });
  }
  function runPose(h, u, legs, arms, now, k) {
    var cyc = now * 11 * h.speedK + h.phase;
    [1, -1].forEach(function (s2) {
      if (legs[s2]) legs[s2].rotation.x = Math.sin(cyc) * 0.75 * s2 * k;
      if (arms[s2]) arms[s2].rotation.x = -Math.sin(cyc) * 0.7 * s2 * k;
    });
    u.hero.position.y += Math.abs(Math.sin(cyc)) * 0.09 * k;
    u.hero.rotation.x = 0.12 * k;
  }

  // ---------------------------------------------------------------- switching
  var auto = !D.start && !EVENT, actStarted = 0, AUTO_DUR = { harvest: 50, water: 45, plant: 45, animals: 45, play: 60, campfire: 150, party: 75 };
  // Light: full daylight by default. The sun / moon button turns the farm to night (remembered in this browser);
  // the Campfire dance dims to dusk by itself, so its fire glows.
  var FARM_DARK = (function () { try { return localStorage.getItem('nevet-farm-dark') === '1'; } catch (e) { return false; } })();
  function lightTarget(name) { return FARM_DARK ? 1 : ACTS[name].night; }
  var nightTarget = 0, night = 0;
  function setActivity(name, now, byUser) {
    if (!ACTS[name]) return;
    current = name;
    actStarted = now;
    nightTarget = lightTarget(name);
    if (byUser) auto = false;
    focusTarget = ACTS[name].centre.clone();
    focusUntil = now + 2.2;
    if (name !== 'campfire' && RING.bout) arenaFinish();    // leaving the campfire: the wrestlers change back
    PARTY.group.visible = name === 'party';
    setPartyNav(name === 'party');
    form.on = false;
    if (name === 'party') { dance.k = 0; dance.cur = DANCES[0]; dance.startBeat = Math.floor(visBeats(now)); heroes.forEach(function (h) { h.floorK = undefined; }); }
    if (name === 'campfire') { dance.k = 0; dance.cur = DANCES[0]; dance.startBeat = Math.floor(visBeats(now)); CAMP.rot = 0; CAMP.inward = 0; }
    else { music.stop(); if (acidPanel) acidPanel.leave(); }
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
      var fin = h.path[h.path.length - 1], rem = Math.hypot(fin.x - root.position.x, fin.z - root.position.z);
      h.rush = rem > 8 ? Math.min(2.3, 1 + (rem - 8) / 11) : 1;          // a long way to go (to the other field): jog
      var d = tmp.length(), step = HERO_SPEED * h.speedK * h.rush * dt;
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
          if (!walkable(nx, nz) && h.goal && now > (h.replanAt || 0)) {    // pushed off the route and the way ahead is blocked: find a new way from here
            h.replanAt = now + 0.6;
            var then4 = h.onArrive;
            h.path = findPath(root.position, h.goal, h); h.onArrive = then4;
            tmp.subVectors(h.path[0], root.position); tmp.y = 0; tmp.normalize();
            nx = root.position.x + tmp.x * step; nz = root.position.z + tmp.z * step;
          }
        }
        root.position.x = nx; root.position.z = nz;
        (h.moveDir || (h.moveDir = V(0, 0, 0))).copy(tmp);
        h.stuckT = (h.stuckT || 0) + dt;                   // hardly moving for a while? plan a new way round
        if (h.stuckT > 1.2) {
          if (h.stuckAt && h.stuckAt.distanceTo(root.position) < 0.35 && h.goal) {
            var then2 = h.onArrive;
            h.path = findPath(root.position, h.goal, h); h.onArrive = then2;
          } else if (h.stuckAt && h.stuckAt.distanceTo(root.position) < 0.35 && !h.goal && h.path.length === 1 && h.onArrive) {
            h.path = []; var cb2 = h.onArrive; h.onArrive = null; cb2();     // a crowd in the way of a plain walk (the gate): good enough, carry on
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
    [1, -1].forEach(function (s) { if (legs[s]) { legs[s].rotation.x = 0; legs[s].rotation.z = 0; } });
    u.hero.position.x = 0; u.hero.position.z = 0;
    if (moving) {
      var jog = Math.min(1, Math.max(0, (h.rush || 1) - 1.15) * 2);   // walking .. jogging
      h.walkPh = (h.walkPh || 0) + dt * 9.5 * h.speedK * (1 + jog * 0.45);
      var cyc = h.walkPh + h.phase;
      [1, -1].forEach(function (s) {
        if (legs[s]) legs[s].rotation.x = Math.sin(cyc) * (0.55 + jog * 0.3) * s;
        if (arms[s] && !h.carry) arms[s].rotation.x = -Math.sin(cyc) * (0.5 + jog * 0.35) * s;
      });
      u.hero.position.y += Math.abs(Math.sin(cyc)) * (0.07 + jog * 0.06);
      u.hero.rotation.z = Math.sin(cyc) * (legs[1] ? 0.03 : 0.08);      // robes waddle a bit more
      u.hero.rotation.x = jog * 0.12;
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
        if (PUMP_HANDLE && !(h.refillAt && h.refillAt !== PUMP)) PUMP_HANDLE.rotation.z = Math.sin(p * 8) * 0.3;
        if (Math.random() < dt * 12) emit(h.refillAt && h.refillAt !== PUMP ? h.refillAt.clone().add(V(0, 0.8 * YS, 0.2 * YS)) : PUMP.clone().add(V(0, 1.1 * YS, 0.5 * YS)), V(rr(-0.1, 0.1), -0.5, 0.3), DROP_MAT, 0.5);
        break;
      case 'feedworms':                                // kneel at the bin and drop in kitchen scraps
        u.hero.position.y -= 0.22; u.hero.rotation.x = 0.45;
        [1, -1].forEach(function (s) { if (arms[s]) arms[s].rotation.x = -1.25 + Math.abs(Math.sin(p * 4 + s * 1.6)) * 0.5; });
        if (Math.random() < dt * 6 && h.animal) emit(root.position.clone().add(V(Math.sin(root.rotation.y) * 0.5, 0.75, Math.cos(root.rotation.y) * 0.5)), V(rr(-0.3, 0.3), 0.4, rr(-0.3, 0.3)).add(V(Math.sin(root.rotation.y) * 0.8, 0, Math.cos(root.rotation.y) * 0.8)), Math.random() < 0.5 ? SCRAP_MAT : DIRT_MAT, 0.7);
        break;
      case 'scatter':                                  // throw grain in wide swings: the chickens come running
        if (arms[1]) { arms[1].rotation.x = -0.7 - Math.max(0, Math.sin(p * 4)) * 0.8; arms[1].rotation.z = arms[1].userData.rest - Math.sin(p * 4) * 0.5; }
        if (Math.random() < dt * 14) { var fw = root.rotation.y + rr(-0.6, 0.6); emit(root.position.clone().add(V(0, 0.9, 0)), V(Math.sin(fw) * rr(1.5, 2.6), rr(0.6, 1.4), Math.cos(fw) * rr(1.5, 2.6)), GRAIN_MAT, 0.9); }
        break;
      case 'bread':                                    // overhand throws of bread crumbs onto the water
        if (arms[1]) arms[1].rotation.x = -2.6 + ((p * 1.2) % 1) * 2.2;
        if (((p * 1.2) % 1) > 0.55 && ((p * 1.2) % 1) < 0.6) for (var bc = 0; bc < 4; bc++) emit(root.position.clone().add(V(0, 1.3, 0)), V(Math.sin(root.rotation.y + rr(-0.25, 0.25)) * rr(2.6, 3.6), rr(1.2, 2.0), Math.cos(root.rotation.y + rr(-0.25, 0.25)) * rr(2.6, 3.6)), CRUMB_MAT, 1.2);
        break;
      case 'smoke':                                    // a gentle puff of smoke so the bees stay calm
        if (arms[1]) { arms[1].rotation.x = -1.0 + Math.sin(p * 2) * 0.12; }
        if (arms[-1]) arms[-1].rotation.x = -0.5 + Math.abs(Math.sin(p * 5)) * 0.4;
        if (Math.random() < dt * 9) emit(root.position.clone().add(V(Math.sin(root.rotation.y) * 0.55, 1.0, Math.cos(root.rotation.y) * 0.55)), V(rr(-0.2, 0.2), 3.2, rr(-0.2, 0.2)), SMOKE_MAT, 1.1);
        break;
      case 'plant':
        u.hero.position.y -= 0.18; u.hero.rotation.x = 0.4;
        [1, -1].forEach(function (s) { if (arms[s]) arms[s].rotation.x = -1.2 + Math.abs(Math.sin(p * 7 + s)) * 0.45; });
        break;
      case 'campdance':                                // round the arena: the party's dance of the moment
        dancePose(dance.cur.id, h, u, arms, legs, now);
        if (h.campMoving && dance.cur.id !== 'conga' && legs[1]) { var cy = now * 9 + h.phase; legs[1].rotation.x += Math.sin(cy) * 0.3; if (legs[-1]) legs[-1].rotation.x -= Math.sin(cy) * 0.3; }
        acidJump(h, u, now);
        break;
      case 'champion':                                 // the grand champion: jumping by the fire, arms up, a twirl now and then
        var cb = visBeats(now);
        u.hero.position.y += Math.abs(Math.sin(cb * PI)) * 0.45;
        [1, -1].forEach(function (s2) { armSet(arms, s2, -2.95 + Math.sin(cb * PI * 2 + s2) * 0.15, 0.35); });
        if (cb % 8 < 1) u.hero.rotation.y = (cb % 1) * TAU;
        break;
      case 'party':                                    // the floor's dance of the moment
        dancePose(dance.cur.form ? 'handsup' : dance.cur.id, h, u, arms, legs, now);
        acidJump(h, u, now);
        if (h === PARTY.soloHero) {                    // in the spotlight: a twirl every bar and bigger hops
          var sb = visBeats(now) % 4;
          if (sb < 1) u.hero.rotation.y = sb * TAU;
          u.hero.position.y += Math.abs(Math.sin(sb * PI)) * 0.12;
        }
        break;
      case 'form':                                     // dancing in a ring, lines or a conga
        dancePose(form.kind, h, u, arms, legs, now);
        acidJump(h, u, now);
        break;
      case 'formReady':                                // waiting in place for the formation (or to go back)
        if (!form.on && h.backAt && now >= h.backAt) {
          h.backAt = 0;
          goTo(h, floorSlot(h), function () { face(h, V(DJ_SPOT.x, 0, DJ_SPOT.z)); doAct(h, 'party', 9999, null, clockNow()); });
        } else dancePose(form.on ? form.kind : dance.cur.form ? 'handsup' : dance.cur.id, h, u, arms, legs, now);
        break;
      case 'dj':
        if (arms[1]) arms[1].rotation.x = -1.0 + Math.sin(now * 14) * 0.18;        // scratching
        if (arms[-1]) { arms[-1].rotation.x = -0.9; arms[-1].rotation.z = arms[-1].userData.rest + 0.15; }
        u.headRig.rotation.x = Math.abs(Math.sin(beatPhase(now) * PI)) * 0.22;      // nodding on the beat
        u.hero.position.y += Math.abs(Math.sin(beatPhase(now) * PI)) * 0.04;
        break;
      case 'swing': {                                  // sitting on a swing, pumping higher and higher
        var sl = h.play && h.play.slot;
        if (!sl) break;
        var amp = Math.min(0.72, 0.18 + p * 0.11), th = Math.sin(p * 2.25 + sl.ph) * amp, Ls = SWING.pivot - SWING.seatY;
        sl.theta = th;
        root.position.x = sl.pos.x; root.position.z = sl.pos.z;
        u.hero.position.z = Math.sin(th) * Ls;
        u.hero.position.y += (1 - Math.cos(th)) * Ls + SWING.seatY + 0.05 - 0.48;
        u.hero.rotation.x = -th * 0.6;
        sitPose(u, legs, arms, -1.35 - th * 0.6);
        [1, -1].forEach(function (s2) { armSet(arms, s2, -2.7 - th * 0.6, -0.12); });
        break;
      }
      case 'seesaw': {
        var ss = h.play && h.play.slot;
        if (!ss) break;
        root.position.x = ss.pos.x; root.position.z = ss.pos.z;
        u.hero.position.y += 0.6 + ss.side * Math.sin(SEESAW.angle) * SEESAW.half - 0.48;
        sitPose(u, legs, arms, -1.25);
        [1, -1].forEach(function (s2) { armSet(arms, s2, -1.2, -0.1); });
        if (u.headRig && Math.sin(SEESAW.angle) * ss.side > 0.2) u.headRig.rotation.x = -0.2;      // up high: whee
        break;
      }
      case 'slide': {                                  // climb, sit at the top, whoosh down
        var cz, by;
        if (p < 1.1) { var k1 = p / 1.1; cz = SLIDE.ladder.z + k1 * 0.75; by = k1 * SLIDE.h; h.wantFacing = PI;
          [1, -1].forEach(function (s2) { armSet(arms, s2, -2.3 + Math.sin(p * 9 + s2) * 0.35, 0); if (legs[s2]) legs[s2].rotation.x = -Math.max(0, Math.sin(p * 9 + s2 * 1.6)) * 0.8; }); }
        else if (p < 1.55) { cz = SLIDE.top; by = SLIDE.h + 0.07 - 0.48; h.wantFacing = 0; sitPose(u, legs, arms, -1.4); }
        else if (p < 2.55) { var k2 = (p - 1.55) / 1.0; k2 = k2 * k2 * (3 - 2 * k2); cz = SLIDE.top + 0.45 + k2 * (SLIDE.bottom + 0.1 - SLIDE.top - 0.45); by = SLIDE.chuteY(cz) + 0.05 - 0.48;
          h.wantFacing = 0; root.rotation.y = 0; u.hero.rotation.x = -0.25; sitPose(u, legs, arms, -1.45); [1, -1].forEach(function (s2) { armSet(arms, s2, -2.9, 0.4); }); }
        else { var k3 = Math.min(1, (p - 2.55) / 0.4); cz = SLIDE.bottom + 0.1 + k3 * 0.5; by = (0.36 + 0.05 - 0.48) * (1 - k3); sitPose(u, legs, arms, -1.45 * (1 - k3)); }
        root.position.x = SLIDE.x; root.position.z = cz;
        u.hero.position.y += by;
        break;
      }
      case 'bounce': {                                 // hop on, bounce (a flip now and then), hop off
        var sl2 = h.play && h.play.slot;
        if (!sl2) break;
        var dur = h.actEnd - h.actStart, ty = TRAMP.y - 0.02, inK, jy;
        if (p < 0.5) inK = p / 0.5; else if (p > dur - 0.5) inK = Math.max(0, (dur - p) / 0.5); else inK = 1;
        root.position.x = sl2.pos.x + (sl2.inner.x - sl2.pos.x) * inK; root.position.z = sl2.pos.z + (sl2.inner.z - sl2.pos.z) * inK;
        if (inK < 1) { jy = ty * inK + Math.sin(inK * PI) * 0.5; h.trampLow = 0; }
        else {
          var bt = (p - 0.5) / 0.85, ph2 = bt % 1, nb = Math.floor(bt);
          jy = ty + Math.sin(ph2 * PI) * (1.2 + (nb % 3 === 2 ? 0.5 : 0));
          h.trampLow = ph2 < 0.12 || ph2 > 0.88 ? 1 : 0;
          if (nb % 3 === 2) u.hero.rotation.x = -ph2 * TAU * (h.i % 2 ? 1 : -1);       // a flip
          [1, -1].forEach(function (s2) { armSet(arms, s2, -1.2 - Math.sin(ph2 * PI) * 1.6, 0.25); if (legs[s2]) legs[s2].rotation.x = ph2 > 0.15 && ph2 < 0.85 ? -0.35 * s2 : 0; });
        }
        u.hero.position.y += jy;
        break;
      }
      case 'dig':                                      // kneeling in the sand
        u.hero.position.y -= 0.18; u.hero.rotation.x = 0.4;
        [1, -1].forEach(function (s2) { if (arms[s2]) arms[s2].rotation.x = -1.2 + Math.abs(Math.sin(p * 6 + s2)) * 0.5; });
        if (Math.random() < dt * 5) emit(root.position.clone().add(V(Math.sin(root.rotation.y) * 0.5, 0.35, Math.cos(root.rotation.y) * 0.5)), V(rr(-0.6, 0.6), rr(1, 1.8), rr(-0.6, 0.6)), SAND_MAT, 0.6);
        break;
      case 'football':
        if (h.fbCheer > now) {
          u.hero.position.y += Math.abs(Math.sin(now * 8 + h.phase)) * 0.3;
          [1, -1].forEach(function (s2) { armSet(arms, s2, -2.9, 0.35); });
        } else if (h.fbMove) runPose(h, u, legs, arms, now, 1);
        if (h.kickT && now - h.kickT < 0.35 && legs[1]) { var kp = (now - h.kickT) / 0.35; legs[1].rotation.x = -Math.sin(kp * PI) * 1.4; }
        break;
      case 'ringwait':                                 // bouncing on the toes by the ropes, waiting for the bell
        u.hero.position.y += Math.abs(Math.sin(now * 6 + h.phase)) * 0.06;
        [1, -1].forEach(function (s2) { armSet(arms, s2, -1.5 + Math.sin(now * 5 + s2 * 1.7 + h.phase) * 0.3, -0.3); });
        break;
      case 'spar':
        ringPose(h, u, arms, legs, now, dt);
        break;
      case 'cheer':
        if (now > (h.cheerAt || 0)) { NevetHero.emote(root, ['cheer', 'hop', 'pump', 'wave'][Math.floor(R() * 4)]); h.cheerAt = now + rr(1.6, 3); }
        break;
      case 'idle':
        break;
    }
    // feet on the ground and a soft shadow
    root.position.y = 0;
    if (h.shadow) h.shadow.position.set(root.position.x, 0.03 + (h.sp && h.act === 'spar' ? RING.h * h.sp.inK : 0), root.position.z);
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
        if (A.act === 'spar' || B.act === 'spar') continue;     // the ring keeps its own distances
        var dx = b.x - a.x, dz = b.z - a.z, d2 = dx * dx + dz * dz;
        var MIN = 1.05;
        if (d2 >= MIN * MIN || d2 < 1e-6) continue;
        var d = Math.sqrt(d2), push = (MIN - d) / d * 0.35;
        var wa = A.path.length || A.act === 'form' ? 1 : 0.12, wb = B.path.length || B.act === 'form' ? 1 : 0.12, sum = wa + wb;
        var ax = a.x - dx * push * wa / sum, az = a.z - dz * push * wa / sum;
        var bx = b.x + dx * push * wb / sum, bz = b.z + dz * push * wb / sum;
        if (walkable(ax, az) || !walkable(a.x, a.z)) { a.x = ax; a.z = az; }
        if (walkable(bx, bz) || !walkable(b.x, b.z)) { b.x = bx; b.z = bz; }
      }
    }
  }

  // ---------------------------------------------------------------- party choreography
  // The whole floor does one dance at a time and moves on to the next:
  // dances in place on the floor grid, and formation dances where everyone
  // first walks to a place (circle, lines, conga oval), then moves together.
  // The beat clock. It runs at 120 BPM on its own; while the acid synth plays
  // it takes the synth's tempo and is nudged into phase on every step heard.
  var BPM = 120, beatT0 = 0, beatB0 = 0, visOff = 0;
  function beatsAt(now) { return beatB0 + (now - beatT0) * BPM / 60; }
  // What the dancers and the lights follow: the beat, or half of it above 160 BPM, so a 300 BPM track still gets
  // dancers you can watch and lights that change no more than ~2.5 times a second. It runs on without a jump when
  // the tempo changes.
  function beatDiv(bpm) { return bpm > 160 ? 2 : 1; }
  function visBeats(now) { return visOff + beatsAt(now) / beatDiv(BPM); }
  function setBPM(bpm, now) {
    if (bpm === BPM) return;
    var v = visBeats(now);
    beatB0 = beatsAt(now); beatT0 = now; BPM = bpm;
    visOff = v - beatB0 / beatDiv(bpm);
  }
  function beatPhase(now) { return visBeats(now) % 1; }
  var DANCES = [
    { id: 'disco', name: 'Disco' }, { id: 'pogo', name: 'Pogo' }, { id: 'hora', name: 'Hora', form: 'hora' },
    { id: 'voodoo', name: 'Voodoo' }, { id: 'yemenite', name: 'Yemenite step' }, { id: 'robot', name: 'Robot' },
    { id: 'mayim', name: 'Mayim Mayim', form: 'mayim' }, { id: 'chicken', name: 'Chicken dance' }, { id: 'sprinkler', name: 'The sprinkler' },
    { id: 'debka', name: 'Debka', form: 'debka' }, { id: 'twist', name: 'Twist' }, { id: 'runningman', name: 'Running man' },
    { id: 'conga', name: 'Conga line', form: 'conga' }, { id: 'handsup', name: 'Hands up!' }
  ];
  var FLOOR_PATTERNS = 6, FLOOR_BEATS = 16, FORM_SECS = { conga: 10, hora: 11, mayim: 12, debka: 10 };
  var dance = { k: 0, startBeat: 0, cur: DANCES[0] };
  function armSet(arms, s, x, z) { if (arms[s]) { arms[s].rotation.x = x; arms[s].rotation.z = arms[s].userData.rest + s * z; } }
  function legSet(legs, s, x, z) { if (legs[s]) { legs[s].rotation.x = x; legs[s].rotation.z = s * (z || 0); } }
  // one frame of a dance's moves; b = beats (with a tiny per-hero delay so the floor ripples)
  function dancePose(id, h, u, arms, legs, now) {
    var b = visBeats(now) - (h.i % 4) * 0.03, ph = b % 1, up = Math.abs(Math.sin(ph * PI)), on = Math.floor(b), body = u.hero, head = u.headRig;
    body.position.x = 0; body.position.z = 0;
    [1, -1].forEach(function (s) { legSet(legs, s, 0, 0); });
    switch (id) {
      case 'disco': {                                  // point up to the right, then down across; hips sway
        var hi = on % 2 === 0;
        armSet(arms, 1, hi ? -2.7 : -0.5, hi ? 0.55 : -0.5);
        armSet(arms, -1, 0.25, 0.55);
        body.rotation.z = Math.sin(b * PI) * 0.12; body.position.x = Math.sin(b * PI) * 0.06; body.position.y += up * 0.05;
        if (head) { head.rotation.y = hi ? -0.3 : 0.25; head.rotation.x = hi ? -0.25 : 0.2; }
        break;
      }
      case 'pogo':                                     // straight up and down, as high as you can
        body.position.y += Math.pow(up, 0.7) * 0.42;
        [1, -1].forEach(function (s) { armSet(arms, s, on % 4 === 3 && s === 1 ? -2.8 : 0.08, 0.06); });
        body.rotation.z = Math.sin(b * 1.7 + h.i) * 0.08;
        if (head) head.rotation.x = up * 0.28;
        break;
      case 'voodoo':                                   // hunched, deep knees, shaking hands up high, swirling head
        body.rotation.x = 0.35; body.position.y += -0.08 + up * 0.07;
        body.rotation.y = Math.sin(b * PI / 4) * 0.8;
        [1, -1].forEach(function (s) {
          armSet(arms, s, -2.2 + Math.sin(now * 26 + s) * 0.14, 0.3 + Math.sin(b * PI * 2 + s) * 0.25);
          legSet(legs, s, on % 2 === (s > 0 ? 0 : 1) ? -0.35 * up : 0, 0.12);
        });
        if (head) { head.rotation.z = Math.sin(b * PI) * 0.3; head.rotation.x = Math.cos(b * PI) * 0.2; }
        break;
      case 'yemenite': {                               // side, back, forward with a dip, hold (and snap); then to the left
        var c = b % 8, side = c < 4 ? 1 : -1, sub = c % 4, t = sub % 1, step = Math.floor(sub);
        var xs = [0, 0.2, 0.2, 0.08, 0.08], x0 = xs[step], x1 = xs[step + 1];
        body.position.x = side * (x0 + (x1 - x0) * Math.min(1, t * 2));
        body.position.z = step === 1 ? -0.07 : step === 2 ? 0.07 * Math.sin(t * PI) : 0;
        if (step === 2) { body.position.y -= Math.sin(t * PI) * 0.12; body.rotation.x = Math.sin(t * PI) * 0.15; }
        legSet(legs, side, step === 0 ? -0.3 * Math.sin(t * PI) : step === 2 ? -0.45 * Math.sin(t * PI) : 0, step === 0 ? 0.18 : 0);
        legSet(legs, -side, step === 1 ? 0.4 * Math.sin(t * PI) : 0, 0);
        [1, -1].forEach(function (s) { armSet(arms, s, -1.15, 0.28 + (step === 3 ? Math.sin(t * PI * 4) * 0.08 : 0)); });
        body.rotation.z = side * 0.06;
        break;
      }
      case 'robot': {                                  // stiff poses that click into place twice a beat
        var POSES = [[-1.57, 0, 0, 0.15], [0, 1.5, -1.57, 0], [-1.57, 1.5, -1.57, 1.5], [-3.0, 0.1, 0, 0.1], [0.3, 0.4, -1.57, 0.9], [-1.57, 0.2, -3.0, 0.1]];
        var pz = POSES[Math.floor(b * 2) % POSES.length];
        armSet(arms, 1, pz[0], pz[1]); armSet(arms, -1, pz[2], pz[3]);
        if (head) head.rotation.y = [0, 0.6, 0, -0.6][Math.floor(b) % 4];
        body.position.y += (Math.floor(b * 2) % 2) * 0.03;
        body.rotation.y = [0, 0.25, 0, -0.25][Math.floor(b / 2) % 4];
        break;
      }
      case 'sprinkler': {                              // hand behind the head, arm out, tick-tick-tick round, then swoosh back
        var cyc = b % 4, tick = Math.floor(cyc * 2);
        body.rotation.y = cyc < 3 ? -0.7 + tick * 0.24 : 0.7 - (cyc - 3) * 1.4;
        armSet(arms, -1, -2.9, -0.35);
        armSet(arms, 1, -1.5, 0.05);
        legSet(legs, 1, -0.35, 0);
        body.position.y -= 0.04 - (cyc < 3 ? (cyc * 2 % 1) * 0.03 : 0);
        break;
      }
      case 'chicken':                                  // flap the wings, peck, wiggle the tail
        body.rotation.x = 0.22; body.position.y += -0.06 + up * 0.04;
        [1, -1].forEach(function (s) { armSet(arms, s, 0.35, 0.45 + up * 0.55); });
        if (head) head.rotation.x = on % 2 ? 0.45 * up : -0.1;
        body.rotation.z = Math.sin(b * PI * 2) * 0.14;
        break;
      case 'twist':
        body.rotation.y = Math.sin(b * PI) * 0.5;
        [1, -1].forEach(function (s) { armSet(arms, s, -0.8 + Math.sin(b * PI + s) * 0.3, 0.35); legSet(legs, s, Math.sin(b * PI) * 0.15 * s, 0); });
        body.position.y += up * 0.04 - 0.05;
        break;
      case 'runningman':                               // run on the spot, kicking back
        [1, -1].forEach(function (s) {
          var k2 = Math.sin(b * PI + (s > 0 ? 0 : PI));
          legSet(legs, s, k2 * 0.7, 0);
          armSet(arms, s, -k2 * 0.9 - 0.2, 0.15);
        });
        body.position.y += up * 0.1; body.rotation.x = 0.1;
        break;
      case 'hora':                                     // holding hands in a ring, step and hop with a kick
        [1, -1].forEach(function (s) { armSet(arms, s, -0.25 - up * 0.3, 1.15); legSet(legs, s, on % 2 === (s > 0 ? 0 : 1) ? -0.45 * up : 0, 0.05); });
        body.position.y += up * 0.14;
        break;
      case 'mayim': {                                  // round the ring; into the middle, arms up, "hey!"; and back out
        var m = b % 16;
        if (m < 8) {
          body.position.x = Math.sin(b * PI) * 0.12;
          [1, -1].forEach(function (s) { armSet(arms, s, -0.2, 1.1); legSet(legs, s, 0, Math.max(0, Math.sin(b * PI * s)) * 0.3); });
          body.position.y += up * 0.06;
        } else {
          var lift = m < 12 ? (m - 8) / 4 : 1 - (m - 12) / 4;
          [1, -1].forEach(function (s) { armSet(arms, s, -0.3 - lift * 2.6, 0.6 + lift * 0.4); legSet(legs, s, on % 2 === (s > 0 ? 0 : 1) ? -0.4 * up : 0, 0); });
          body.position.y += up * (0.06 + lift * 0.12);
          if (head) head.rotation.x = -lift * 0.3;
        }
        break;
      }
      case 'debka': {                                  // shoulder to shoulder: stomp, stomp, kick, stomp
        var beat4 = on % 4;
        [1, -1].forEach(function (s) { armSet(arms, s, -0.15, 1.45); });
        var foot = beat4 % 2 ? -1 : 1;
        if (beat4 === 2) legSet(legs, 1, -0.8 * up, 0);
        else legSet(legs, foot, -0.35 * up, 0);
        body.position.y += beat4 === 2 ? up * 0.12 : -up * 0.05;
        body.rotation.x = 0.08;
        if (head) head.rotation.x = beat4 === 2 ? -0.2 : 0.1;
        break;
      }
      case 'conga': {
        [1, -1].forEach(function (s) { armSet(arms, s, -1.35, -0.2); legSet(legs, s, Math.sin(ph * PI * 2) * 0.5 * s, 0); });
        body.position.y += Math.abs(Math.sin(ph * PI * 2)) * 0.08;
        body.rotation.z = Math.sin(ph * PI * 2) * 0.1;
        break;
      }
      default:                                         // hands up, swaying
        [1, -1].forEach(function (s) { armSet(arms, s, 0, 2.0 + Math.sin(b * PI) * 0.3); });
        body.rotation.z = Math.sin(b * PI) * 0.12; body.position.y += up * 0.09;
    }
  }
  // formation dances: where each dancer belongs (k of n) right now
  var form = { on: false, moving: false, kind: null, order: [], t0: 0, t1: 0, theta: 0 }, partyBeat = -1;
  var CONGA_A = Math.min(PARTY.hx - 0.6, 10.5), CONGA_B = Math.min(PARTY.hz - 0.6, 9.5);   // an oval round the fire tower
  var CONGA_LEN = PI * (3 * (CONGA_A + CONGA_B) - Math.sqrt((3 * CONGA_A + CONGA_B) * (CONGA_A + 3 * CONGA_B)));
  var CONGA_R = CONGA_LEN / TAU;                      // arc length per radian, on average
  function congaPoint(s) {
    var a = s / CONGA_R;
    return V(FIRE.x + Math.cos(a) * CONGA_A, 0, FIRE.z + Math.sin(a) * CONGA_B);
  }
  function congaGap(n) { return Math.min(1.7, CONGA_LEN / Math.max(1, n)); }
  var RING_C = V(FIRE.x, 0, FIRE.z);                   // the Hora and Mayim Mayim go round the fire tower
  function ringR(n) { return Math.min(Math.min(PARTY.hx, PARTY.hz) - 0.8, Math.max(TOWER_CLEAR + 0.6, n * 1.75 / TAU)); }
  function formSlot(kind, k, n, now) {
    if (kind === 'conga') return congaPoint(form.theta - k * congaGap(n));
    if (kind === 'debka') {                            // lines of up to 7 facing the DJ, drifting side to side together
      var perRow = Math.min(7, n), row = Math.floor(k / perRow), inRow = Math.min(perRow, n - row * perRow), j = k % perRow;
      var drift = form.moving ? Math.sin((now - form.t1) * PI / 4) * 0.6 : 0;
      return V(PARTY.c.x + (j - (inRow - 1) / 2) * 1.55 + drift, 0, PARTY.c.z - PARTY.hz + 1.6 + row * 1.9);
    }
    var r = ringR(n), a = form.theta + k / n * TAU;
    if (kind === 'mayim' && form.moving) {             // into the middle on beats 8-15 of every 16
      var m = ((now - form.t1) * BPM / beatDiv(BPM) / 60) % 16;
      var inner = Math.max((TOWER_R + 1.1) / r, Math.min(1, n * 0.95 / TAU / r)), f = m < 8 ? 0 : m < 12 ? (m - 8) / 4 : 1 - (m - 12) / 4;
      r *= 1 - (1 - inner) * f;                        // (never so tight that dancers overlap)
    }
    return V(RING_C.x + Math.cos(a) * r, 0, RING_C.z + Math.sin(a) * r);
  }
  function startForm(kind, now) {
    var line = heroes.filter(function (h) { return h.act === 'party'; });
    if (kind === 'debka') {                            // nearest the DJ make the front row; each row in the order they stand
      line.sort(function (a, b) { return a.root.position.z - b.root.position.z; });
      var per = Math.min(7, line.length), rows = [];
      for (var r0 = 0; r0 < line.length; r0 += per) rows.push(line.slice(r0, r0 + per).sort(function (a, b) { return a.root.position.x - b.root.position.x; }));
      line = [].concat.apply([], rows);
    } else {                                           // in the order they stand around the floor, so nobody crosses
      var cc = RING_C;
      line.forEach(function (h) { h.ang = Math.atan2(h.root.position.z - cc.z, h.root.position.x - cc.x); });
      line.sort(function (a, b) { return kind === 'conga' ? b.ang - a.ang : a.ang - b.ang; });
    }
    form.on = true; form.moving = false; form.kind = kind; form.t0 = now; form.order = line;
    form.theta = kind === 'conga' ? (line.length ? line[0].ang * CONGA_R : 0) : (line.length ? line[0].ang : 0);
    line.forEach(function (h, k) {
      goTo(h, formSlot(kind, k, line.length, now), function () { h.wantFacing = undefined; doAct(h, 'formReady', 9999, null, clockNow()); });
    });
  }
  function endForm(now) {
    form.on = false;
    // back to the floor: everyone takes the nearest free spot (closest pairs first), one after another
    var back = (form.order || []).filter(function (h) { return h.act === 'form' || h.act === 'formReady'; });
    var taken = {}, rank = 0, n = heroes.length - 1;
    var floor = heroes.filter(function (o) { return o !== heroes[0]; });
    floor.forEach(function (h, i) { if (back.indexOf(h) < 0) taken[h.floorK !== undefined ? h.floorK : i] = true; });
    var left = back.slice();
    while (left.length) {
      var best = null;
      left.forEach(function (h) {
        for (var k = 0; k < Math.max(n, left.length); k++) {
          if (taken[k]) continue;
          var d = h.root.position.distanceToSquared(floorSlot(h, k));
          if (!best || d < best.d) best = { h: h, k: k, d: d };
        }
      });
      if (!best) break;
      taken[best.k] = true;
      best.h.floorK = best.k;
      best.h.act = 'formReady';
      best.h.backAt = now + rank++ * 0.4;          // one after another, so they don't bump on the big floor
      left.splice(left.indexOf(best.h), 1);
    }
  }
  function nextDance(now, beat) {
    var settled = heroes.every(function (h) { return h === heroes[0] || h.act === 'party'; });
    var dancers = heroes.filter(function (h) { return h.act === 'party'; }).length;
    for (var tries = 0; tries < DANCES.length; tries++) {
      dance.k = (dance.k + 1) % DANCES.length;
      var d = DANCES[dance.k];
      if (!d.form || (settled && dancers > 2)) break;  // formations wait until everyone is on the floor
    }
    dance.cur = DANCES[dance.k]; dance.startBeat = beat;
    if (dance.cur.form) startForm(dance.cur.form, now);
  }
  var LASER_UP = V(0, 1, 0), CONE_DOWN = V(0, -1, 0), tmpDir = V(0, 0, 0), tmpTgt = V(0, 0, 0);
  function aimAt(obj, axis, x, y, z) {                 // point an object's axis at (x, y, z), stretched to reach it (lasers)
    tmpDir.set(x - obj.position.x, y - obj.position.y, z - obj.position.z);
    var len = tmpDir.length();
    obj.quaternion.setFromUnitVectors(axis, tmpDir.divideScalar(len || 1));
    return len;
  }
  // ---------------------------------------------------------------- the folding arena: moving
  function seg(t, a, b) { return t <= a ? 0 : t >= b ? 1 : (t - a) / (b - a); }
  function easeIO(x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
  var _tm = new THREE.Matrix4(), _tq = new THREE.Quaternion(), _ts = new THREE.Vector3(1, 1, 1), _tp = new THREE.Vector3(), _tx = V(1, 0, 0);
  function foldTiles() {                               // which dance-floor panels cover the mud pit, and when each flips over
    if (FOLD.tileK) return FOLD.tileK;
    var ra = RING.wall + 0.75;
    FOLD.tileK = PARTY.tilePos.map(function (tp, i) {
      var r = Math.hypot(tp[0] - FIRE.x, tp[1] - FIRE.z);
      if (r >= ra) return null;
      var a = 0.56 + 0.3 * (1 - r / ra);               // from the rim in
      return { a: a, b: a + 0.12, core: r < TOWER_R + 0.3, dir: i % 2 ? 1 : -1 };
    });
    return FOLD.tileK;
  }
  function placeTiles(kick) {                          // the dance floor: lit panels pop up on the kick; over the mud pit they flip in and out
    var K = foldTiles(), lit = PARTY.lit, T = FOLD.t;
    for (var t = 0; t < PARTY.tilePos.length; t++) {
      var tp = PARTY.tilePos[t], f = K[t], lift = kick && lit && lit[t] ? kick * 0.05 : 0;
      if (!f) _tm.makeTranslation(tp[0], 0.05 + lift, tp[1]);
      else {
        var u = f.core ? 0 : easeIO(seg(T, f.a, f.b));
        if (u < 0.002) _tm.makeScale(0, 0, 0);
        else { _tq.setFromAxisAngle(_tx, (1 - u) * PI * f.dir); _tm.compose(_tp.set(tp[0], -0.32 + 0.37 * u + lift * u, tp[1]), _tq, _ts); }
      }
      PARTY.tiles.setMatrixAt(t, _tm);
    }
    PARTY.tiles.instanceMatrix.needsUpdate = true;
  }
  function stepFold(now, dt) {
    FOLD.want = current === 'party' ? 1 : 0;
    var prev = FOLD.t;
    if (FOLD.t !== FOLD.want) FOLD.t = FOLD.want > FOLD.t ? Math.min(1, FOLD.t + dt / FOLD.dur) : Math.max(0, FOLD.t - dt / FOLD.dur);
    if (FOLD.t === prev && FOLD.settled === FOLD.t) return;          // (still: nothing to move)
    var live = FOLD.settled !== -1 || FOLD.t !== prev;               // (not the first frame: sparks and dust)
    FOLD.settled = FOLD.t === prev ? FOLD.t : -2;
    applyFold(prev, live && FOLD.t !== prev);
    if (!PARTY.group.visible) placeTiles(0);
  }
  function applyFold(prevT, live) {
    var T = FOLD.t, c = RING.c, W = RING.wall;
    FOLD.sinkers.forEach(function (sk) {               // the arches, torch columns and braziers screw down into the ground
      var u = easeIO(seg(T, sk.delay, sk.delay + 0.2));
      sk.g.position.y = sk.y0 - sk.depth * u;
      if (sk.twist) sk.g.rotation.y = u * PI * 0.75;
      else sk.g.rotation.z = Math.sin(u * PI * 5) * 0.02 * (1 - u);     // (the arches shudder as they go)
      sk.g.visible = u < 0.995;
      sk.flames.forEach(function (fl) { fl.f.position.y = fl.y - sk.depth * u; fl.f.userData.sunk = u > 0.2; });
    });
    FOLD.sectors.forEach(function (sg, k) {           // the wall sections: unlock, swing upright, slide in, lock
      var u0 = 0.2 + k * 0.035, sNow = seg(T, u0, u0 + 0.5), sWas = seg(prevT, u0, u0 + 0.5), ud = sg.userData;
      var a1 = easeIO(seg(sNow, 0, 0.18)), b1 = easeIO(seg(sNow, 0.18, 0.52)), c1 = easeIO(seg(sNow, 0.52, 0.86)), d1 = seg(sNow, 0.86, 1);
      var phi = -PI / 2 * b1, y0 = 0.48 + 0.3 * a1, standY = ud.len / 2 + 0.32;
      var y = y0 + (standY - y0) * Math.sin(-phi) - 0.06 * Math.sin(d1 * PI);
      var r = W - 0.8 * b1 - (W - 0.8 - TOWER_R) * c1 - 0.2 * Math.sin(d1 * PI);
      sg.position.set(c.x + Math.cos(ud.a) * r, y, c.z + Math.sin(ud.a) * r);
      sg.rotation.set(phi, -ud.a, -0.14 * Math.sin(a1 * PI) * (1 - b1));
      if (live) {
        var pos = V(c.x + Math.cos(ud.a) * r, 0, c.z + Math.sin(ud.a) * r), out = V(Math.cos(ud.a), 0, Math.sin(ud.a));
        if (sWas < 0.9 && sNow >= 0.9) for (var sp = 0; sp < 10; sp++)          // locked: sparks
          emit(pos.clone().setY(rr(0.6, ud.len)), out.clone().multiplyScalar(rr(1, 3)).add(V(rr(-1.5, 1.5), rr(1, 4), rr(-1.5, 1.5))), SPARK_MAT, rr(0.4, 0.8));
        if (sWas > 0.03 && sNow <= 0.03) for (var dp = 0; dp < 8; dp++)        // back down on the ground: a puff of dirt
          emit(pos.clone().setY(0.2), V(rr(-1.5, 1.5), rr(1, 2.5), rr(-1.5, 1.5)), DIRT_MAT, rr(0.4, 0.7));
      }
    });
    var pu = easeIO(seg(T, 0.42, 0.88));              // the column lifts the campfire to the top
    FOLD.fireY = FOLD.top * pu;
    FOLD.fireK = 1 - 0.2 * pu;
    FOLD.pedestal.position.y = pu > 0 ? FOLD.fireY - 0.02 : -0.4;
    FOLD.pedestal.visible = pu > 0.001;
    FIREFX.rig.position.y = 0.05 + FOLD.fireY;
    FIREFX.rig.scale.setScalar(FOLD.fireK);
    FOLD.faderSpheres.length = 0;                      // folded, the tower may stand between you and the dancers
    if (T > 0.5) FOLD.faderSpheres.push([V(c.x, 1.6, c.z), TOWER_R + 0.6], [V(c.x, 4.6, c.z), TOWER_R + 0.6]);
  }
  function drawLineup() {                             // the line-up board: now / next, by the real clock
    var L = PARTY.lineup, t = Date.now(), slots = D.event.lineup, cur = null, nxt = null;
    slots.forEach(function (sl) {
      var a = new Date(sl.at).getTime(), b = new Date(sl.end).getTime();
      if (a <= t && t < b) cur = sl;
      else if (a > t && !nxt) nxt = sl;
    });
    var key = (cur ? cur.at : '-') + '|' + (nxt ? nxt.at : '-');
    L.mesh.visible = !!(cur || nxt);
    if (key === L.key) return;
    L.key = key;
    var g2 = L.canvas.getContext('2d'), W = L.canvas.width, H = L.canvas.height;
    g2.clearRect(0, 0, W, H);
    g2.fillStyle = 'rgba(8, 6, 16, 0.78)'; g2.beginPath(); g2.roundRect ? g2.roundRect(0, 8, W, H - 16, 18) : g2.rect(0, 8, W, H - 16); g2.fill();
    g2.textBaseline = 'middle';
    function fit(text, max, px, weight) { var p = px; do { g2.font = weight + ' ' + p + 'px system-ui, sans-serif'; p -= 2; } while (p > 16 && g2.measureText(text).width > max); return text; }
    var x = 22;
    if (cur) {
      g2.fillStyle = '#ff2d8a'; g2.beginPath(); g2.roundRect ? g2.roundRect(x, 28, 118, 56, 12) : g2.rect(x, 28, 118, 56); g2.fill();
      g2.fillStyle = '#fff'; g2.font = '900 30px system-ui, sans-serif'; g2.fillText('● NOW', x + 12, 57);
      x += 136;
      g2.fillStyle = '#ffffff'; g2.fillText(fit(cur.what, nxt ? 470 : 840, 44, '800'), x, 57);
    }
    if (nxt) {
      var label = 'NEXT ' + nxt.time + ' · ', rx = cur ? 640 : 22;
      g2.font = '700 26px system-ui, sans-serif'; g2.fillStyle = '#9fe6ff'; g2.fillText(label, rx, 57);
      var lw = g2.measureText(label).width;
      g2.fillStyle = '#e8f6ff'; g2.fillText(fit(nxt.what, W - rx - lw - 24, 30, '700'), rx + lw, 57);
    }
    L.mesh.material.map.needsUpdate = true;
  }
  function stepStage(now, dt, n) {                     // the big wheel turns all day; the stage rests between parties
    var party = PARTY.group.visible, col = PARTY.tmpC || (PARTY.tmpC = new THREE.Color());
    if (PARTY.lineup) {                                // (checked every few seconds, by the real clock)
      if (!party) { PARTY.lineup.mesh.visible = false; PARTY.lineup.next = 0; }
      else if (Date.now() > PARTY.lineup.next) { PARTY.lineup.next = Date.now() + 5000; drawLineup(); }
    }
    var spin = now * (calm ? 0.05 : 0.11);
    WHEEL_FX.rot.rotation.z = spin;
    WHEEL_FX.cabins.forEach(function (cb) {
      var a = cb.userData.a + spin;
      cb.position.set(WHEEL.x + Math.cos(a) * WHEEL.r, WHEEL_FX.hub + Math.sin(a) * WHEEL.r, WHEEL.z);
    });
    var BN = WHEEL_FX.n, glow = party ? 0.62 : 0.42 + n * 0.2, speed = party ? 0.6 : 0.12;
    for (var b = 0; b < BN * 2; b++) {
      var k = b % BN;
      col.setHSL((k / BN + now * speed * 0.3) % 1, 0.9, glow * (0.7 + 0.3 * Math.max(0, Math.sin(now * (party ? 6 : 2) - k * 0.5))));
      WHEEL_FX.bulbs.setColorAt(b, col);
    }
    WHEEL_FX.bulbs.instanceColor.needsUpdate = true;
    PARTY.flags.forEach(function (fl) {               // the flags wave (harder at the party)
      fl.rotation.y = fl.userData.y + Math.sin(now * (party ? 2.6 : 1.1) + fl.userData.ph) * (party ? 0.32 : 0.16);
    });
    var scr = PARTY.screen.material.uniforms;
    scr.uTime.value = now;
    if (!party) {
      scr.uLevel.value += (0.14 - scr.uLevel.value) * Math.min(1, dt * 2); scr.uKick.value = 0; scr.uMode.value = 0;
      if (!PARTY.resting) {                            // the party's over: the floor, the LEDs and the sign go quiet
        PARTY.resting = true;
        for (var t = 0; t < PARTY.tilePos.length; t++) PARTY.tiles.setColorAt(t, PARTY.restCol[t]);
        PARTY.tiles.instanceColor.needsUpdate = true;
        placeTiles(0);
        for (var l = 0; l < PARTY.leds.count; l++) PARTY.leds.setColorAt(l, col.setHSL(l / PARTY.leds.count, 1, 0.3));
        PARTY.leds.instanceColor.needsUpdate = true;
        for (var q = 0; q < PARTY.bulbs.count; q++) PARTY.bulbs.setColorAt(q, col.setHSL(q * 0.13 % 1, 0.6, 0.7));
        PARTY.bulbs.instanceColor.needsUpdate = true;
        PARTY.neon.material.color.set('#6a2a5a'); PARTY.edge.color.set('#8a3a78'); PARTY.stripe.material.color.set('#ff5ea8');
        PARTY.speakers.forEach(function (w) { w.scale.set(1, 1, 1); });
      }
    }
  }
  function stepParty(now, dt) {
    if (!PARTY.group.visible) return;
    PARTY.resting = false;
    var b = visBeats(now), beat = Math.floor(b), ph = b % 1, kick = Math.pow(1 - ph, 3);
    var live = acid.playing && now - acid.heardAt < 1.5;          // the acid synth is playing
    if (live && beatDiv(BPM) === 1) kick = Math.max(Math.exp(-(now - acid.kickAt) * 9), 0.6 * Math.exp(-(now - acid.accentAt) * 7));   // (fast tracks: the half-time pulse)
    if (calm) kick *= 0.35;
    var bright = live ? 0.3 + 0.36 * acid.cut : 0.6;                // the filter opens, the floor lights up
    var c = PARTY.c, S = STAGE;
    // floor tiles: a new light pattern every 8 beats; lit tiles pop up on the kick
    var nx = PARTY.nx, nz = PARTY.nz, col = new THREE.Color();
    if (beat !== partyBeat) {
      partyBeat = beat;
      var pattern = Math.floor(beat / 8) % FLOOR_PATTERNS, cx = (nx - 1) / 2, cz = (nz - 1) / 2;
      PARTY.lit = PARTY.lit || [];
      for (var i = 0; i < nx; i++) for (var j = 0; j < nz; j++) {
        var on, hue = ((i * 7 + j * 3 + beat * 5) % 20) / 20, dx = i - cx, dz = j - cz;
        switch (pattern) {
          case 0: on = (i + j + beat) % 2 === 0; break;                                            // checkerboard
          case 1: on = Math.round(Math.abs(dx) + Math.abs(dz)) % 4 === beat % 4; break;          // diamonds rippling out
          case 2: on = (j + beat) % 4 < 2; hue = (j * 0.09 + beat * 0.05) % 1; break;           // stripes rolling to the DJ
          case 3: on = Math.floor(((Math.atan2(dz, dx) / TAU + 1) * 6 + beat) % 6) % 2 === 0; break; // a spinning pinwheel
          case 4: on = Math.round(Math.hypot(dx, dz)) % 3 === beat % 3; hue = (Math.hypot(dx, dz) * 0.08 + beat * 0.04) % 1; break; // rings
          default: on = R() < 0.42;                                                               // sparkle
        }
        PARTY.lit[i * nz + j] = on;
        if (on) col.setHSL(hue, 0.9, bright); else col.copy(PARTY.restCol[i * nz + j]).multiplyScalar(0.42);   // the earth in the shade
        PARTY.tiles.setColorAt(i * nz + j, col);
      }
      PARTY.tiles.instanceColor.needsUpdate = true;
      // the next dance: floor dances last 16 beats, formations until they've gone round
      if (!dance.cur.form && beat - dance.startBeat >= FLOOR_BEATS && beat % 4 === 0) nextDance(now, beat);
      else if (dance.cur.form && form.on && form.moving && now - form.t1 > FORM_SECS[form.kind]) { endForm(now); nextDance(now, beat); }
      else if (dance.cur.form && !form.on) nextDance(now, beat);
      // the dance-off: every 8 beats the sky spotlight picks someone on the floor
      if (beat % 8 === 0) {
        var floorNow = heroes.filter(function (h) { return h.act === 'party'; });
        PARTY.soloHero = floorNow.length > 2 && !form.on ? floorNow[Math.floor(R() * floorNow.length)] : null;
      }
      // the drops: every 16 beats the stage's flame jets fire; every 32 the confetti cannons too, the corner jets and fireworks
      if (beat % 16 === 0) {
        PARTY.jets.slice(0, 4).forEach(function (jt, k) { fireJet(jt, now, [0.18, 0, 0, 0.18][k]); });
        if (beat % 32 === 0) {
          PARTY.cannons.forEach(function (cn) { fireCannon(cn, now); });
          for (var fw = 0; fw < 4; fw++) launchWork(V(c.x + (fw - 1.5) * 4.5, 0.5, S.wallZ - 2.2), rr(11, 17), null, now, fw * 0.28, V(c.x + (fw - 1.5) * 4, 0, CROWD_C.z - 2));
        }
        PARTY.screenMode = (PARTY.screenMode || 0) + 1;
      }
      if (beat % 4 === 0 && !calm && R() < 0.2) launchWork(V(c.x + rr(-12, 12), 0.5, S.wallZ - 2.2), rr(11, 17), null, now, 0, V(c.x + rr(-8, 8), 0, CROWD_C.z - rr(-2, 4)));
    }
    placeTiles(kick);
    PARTY.edge.color.setHSL((now * 0.15 + kick * 0.1) % 1, 1, 0.55 + kick * 0.2);
    // the LED wall: a new picture every 16 beats, pulsing on the kick
    var scr = PARTY.screen.material.uniforms;
    scr.uLevel.value += (1 - scr.uLevel.value) * Math.min(1, dt * 2); scr.uKick.value = kick; scr.uMode.value = PARTY.screenMode || 0;
    // the stage lip's lights chase, the neon sign changes colour on the bar
    var ledN = PARTY.leds.count;
    for (var l = 0; l < ledN; l++) { col.setHSL((l / ledN + now * 0.35) % 1, 1, 0.35 + 0.35 * Math.max(0, Math.sin(now * 7 - l * 0.6))); PARTY.leds.setColorAt(l, col); }
    PARTY.leds.instanceColor.needsUpdate = true;
    PARTY.neon.material.color.setHSL((Math.floor(b / 4) * 0.17) % 1, 1, 0.6 + kick * 0.25);
    // lasers: the booth's fan sweeps over the crowd to the far end
    PARTY.lasers.forEach(function (las) {
      var u = las.userData, k = u.k, len;
      if (u.bank === 0) len = aimAt(las, LASER_UP, c.x + Math.sin(now * 1.3 + k * 0.9) * (PARTY.hx + 1) , 0.2, c.z + PARTY.hz + 2 + Math.sin(now * 0.7 + k) * 1.5);
      else len = aimAt(las, LASER_UP, c.x - u.bank * ((Math.sin(now * 0.9 + k * 0.7) * 0.5 + 0.5) * PARTY.hx * 1.5 - 4), 0.15, CROWD_C.z + Math.cos(now * 1.1 + k * 1.3) * PARTY.hz * 0.55);
      las.scale.y = len;
      las.material.opacity = 0.2 + 0.3 * Math.abs(Math.sin(now * 3 + k));
    });
    PARTY.spots.forEach(function (sp) {               // the moving heads swing across the floor (never off it)
      var k = sp.userData.k;
      sp.scale.y = aimAt(sp, CONE_DOWN, c.x + Math.sin(now * 0.7 + k * 1.9) * PARTY.hx * 0.7, 0, c.z + Math.cos(now * 0.55 + k * 1.3) * PARTY.hz * 0.75) / 10;
    });
    PARTY.searchlights.forEach(function (sl) {        // searchlights sweep the sky
      var k = sl.userData.k;
      aimAt(sl, LASER_UP, sl.position.x + Math.sin(now * 0.35 + k * 1.7) * 18, 40, sl.position.z + Math.cos(now * 0.3 + k * 2.3) * 18);
      sl.material.opacity = 0.045 + 0.05 * night;
    });
    // fog drifts low over the floor
    PARTY.fog.forEach(function (fs, q) {
      var u = fs.userData;
      fs.position.set(c.x + u.ox + Math.sin(now * 0.25 + u.ph) * 1.2, 0.3 + Math.sin(now * 0.4 + u.ph) * 0.06, c.z + u.oz + Math.cos(now * 0.2 + u.ph) * 0.9);
      fs.material.opacity = 0.09 + 0.04 * Math.sin(now * 0.5 + q);
    });
    // the dance-off spotlight follows its dancer
    var soloOn = PARTY.soloHero && PARTY.soloHero.act === 'party' && heroes.indexOf(PARTY.soloHero) >= 0;
    var so = PARTY.solo.material, sr = PARTY.soloRing.material;
    so.opacity += ((soloOn ? 0.22 : 0) - so.opacity) * Math.min(1, dt * 4);
    sr.opacity += ((soloOn ? 0.8 : 0) - sr.opacity) * Math.min(1, dt * 4);
    if (soloOn) {
      var hp = PARTY.soloHero.root.position;
      PARTY.solo.position.set(hp.x, 8, hp.z); PARTY.soloRing.position.set(hp.x, 0.11, hp.z);
      sr.color.setHSL((now * 0.3) % 1, 1, 0.7);
    }
    var bulbCount = PARTY.bulbs.count;
    for (var k = 0; k < bulbCount; k++) { col.setHSL((k * 0.13 + now * 0.25) % 1, 0.9, 0.45 + 0.25 * Math.max(0, Math.sin(now * 6 + k))); PARTY.bulbs.setColorAt(k, col); }
    PARTY.bulbs.instanceColor.needsUpdate = true;
    PARTY.beams.forEach(function (bm) {
      var a = now * 0.9 + bm.userData.k * TAU / PARTY.beams.length;
      bm.rotation.set(Math.sin(a * 1.3) * 0.6, 0, Math.cos(a) * 0.6);
      bm.material.opacity = 0.04 + kick * 0.06 + (live ? acid.res * 0.06 : 0);
    });
    PARTY.speakers.forEach(function (w) { w.scale.set(1, 1 + kick * 0.6, 1 + kick * 0.6); });
    PARTY.decks.forEach(function (d) { d.rotation.y = now * 3.5; });
    PARTY.stripe.material.color.setHSL((now * 0.2) % 1, 0.9, 0.6);
    PARTY.balloons.forEach(function (bl) { bl.position.y = bl.userData.y + Math.sin(now * 1.4 + bl.userData.ph) * 0.15; bl.rotation.z = Math.sin(now + bl.userData.ph) * 0.1; });
    var cp = PARTY.confetti.geometry.attributes.position;
    PARTY.confettiSeeds.forEach(function (sd, q) {
      var y = 5.6 - ((now * sd[3] + sd[1]) % 1) * 5.6;
      cp.setXYZ(q, c.x + sd[0] + Math.sin(now * 2 + q) * 0.18, y, c.z + sd[2] + Math.cos(now * 1.7 + q) * 0.18);
    });
    cp.needsUpdate = true;
    acidNotes.forEach(function (sp) {                              // the notes the synth plays float up from the booth
      var u = (now - sp.userData.t0) / 2.2;
      sp.visible = u >= 0 && u < 1;
      if (!sp.visible) return;
      sp.position.set(DJ_SPOT.x + sp.userData.side * (0.6 + u * 0.6), 2.3 + u * 2.6, DJ_SPOT.z + 0.6 + u * 0.8);
      sp.material.opacity = Math.min(1, (1 - u) * 2.2);
    });
    PARTY.notes.forEach(function (nt) {
      var u = (now * 0.35 + nt.userData.ph) % 1;
      nt.position.set(DJ_SPOT.x + nt.userData.side * S.stackX + Math.sin(u * 9) * 0.3, 3.8 + u * 2.6, S.stackZ + 0.5 + u * 0.8);
      nt.material.opacity = Math.sin(u * PI);
    });
    // a formation: once everyone is in place, they all move together
    if (form.on && !form.moving) {
      var ready = (form.order || []).every(function (h) { return h.act === 'formReady' || heroes.indexOf(h) < 0; });
      if (ready || now - form.t0 > 7) {
        form.moving = true; form.t1 = now;
        form.order.forEach(function (h) { h.path = []; h.act = 'form'; h.goal = null; });
      }
    }
    if (form.on && form.moving) {
      form.theta += dt * (form.kind === 'conga' ? 1.25 : form.kind === 'hora' ? 0.45 : form.kind === 'mayim' ? ((((now - form.t1) * BPM / beatDiv(BPM) / 60) % 16) < 8 ? 0.6 : 0) : 0);
      var line = (form.order || []).filter(function (h) { return h.act === 'form'; }), cnt = form.order.length;
      line.forEach(function (h) {
        var k = form.order.indexOf(h), target = formSlot(form.kind, k, cnt, now), r = h.root.position;
        var dx = target.x - r.x, dz = target.z - r.z, d = Math.hypot(dx, dz);
        var spd = Math.min(d, (1.25 + d) * dt * 1.6);
        if (d > 1e-3) { r.x += dx / d * spd; r.z += dz / d * spd; }
        if (form.kind === 'conga') { if (d > 1e-3) h.wantFacing = Math.atan2(dx, dz); }
        else if (form.kind === 'debka') h.wantFacing = Math.atan2(DJ_SPOT.x - r.x, DJ_SPOT.z - r.z);
        else h.wantFacing = Math.atan2(RING_C.x - r.x, RING_C.z - r.z);           // facing into the ring
      });
    }
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


  // ---------------------------------------------------------------- the party's synth (TB-303 + TR-909)
  // While it plays, the beat clock takes its tempo, the speakers pump on the
  // kick, the dancers hop on accents, the floor and beams follow the filter,
  // and the notes float up from the booth.
  var acid = { playing: false, stoppedAt: -9, heardAt: -9, kickAt: -9, accentAt: -9, cut: 0.4, res: 0.3, step: 0, steps: 16 };
  function acidJump(h, u, now) {
    if (!acid.playing) return;
    var t = now - acid.accentAt - (h.i % 5) * 0.025;              // a quick hop on every accent, rippling across the floor
    if (t > 0 && t < 0.3) u.hero.position.y += Math.sin(t / 0.3 * PI) * 0.22;
  }
  var acidNotes = [], acidTex = {};
  function acidNote(name, accent, now) {
    if (!name) return;
    var key = name + (accent ? '!' : '');
    if (!acidTex[key]) {
      var l = Nevet3D.makeLabel(name, accent ? '#ff5fa2' : '#c7ff2e', 1);
      acidTex[key] = l.material.map; l.material.dispose();
    }
    var sp = acidNotes.filter(function (x) { return !x.visible; })[0];
    if (!sp) {
      if (acidNotes.length >= 8) return;
      sp = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
      sp.scale.set(1.1, 0.275, 1);
      PARTY.group.add(sp);
      acidNotes.push(sp);
    }
    sp.material.map = acidTex[key]; sp.material.needsUpdate = true;
    sp.userData.t0 = now; sp.userData.side = acidNotes.indexOf(sp) % 2 ? 1 : -1;
    sp.visible = true;
  }
  // The party's music engine: AcidEngine from kg13-acid-space (a TB-303 bass
  // line and a TR-909 drum kit), with the little synth docked above the
  // bottom bar (static/js/party-synth.js). The top bar's synth button opens
  // it, the speaker button plays or stops it. Without the engine (the
  // companion repo not downloaded yet) the speaker plays the simple built-in beat.
  var acidPanel = (function () {
    var btn = document.getElementById('farm-synth'), dock = document.getElementById('farm-synth-dock');
    var none = { show: function () {}, leave: function () {}, engine: null };
    if (!btn || !dock || !window.AcidEngine || !window.NevetSynth) { if (btn) btn.hidden = true; return none; }
    var eng = AcidEngine.create({ bpm: 128 });
    function heard(m) {                                 // every 16th as it is heard: the party follows
      var t = clockNow();
      if (t - acid.stoppedAt < 0.6) return;
      if (!acid.playing) { acid.playing = true; music.stop(); updateUI(); }
      acid.heardAt = t; acid.step = m.step; acid.steps = m.steps || 16;
      if (m.bpm && m.bpm !== BPM) { setBPM(m.bpm, t); updateUI(); }
      var want = (m.step % 4) / 4, have = beatsAt(t) % 1, d = ((want - have + 1.5) % 1) - 0.5;     // phase lock: step k is beat k/4
      beatB0 += d * (Math.abs(d) > 0.3 ? 1 : 0.5);
      if (m.kick) acid.kickAt = t;
      if (m.accent && !m.mute.tb303) acid.accentAt = t;
      acid.cut = Math.max(0, Math.min(1, Math.log((m.cutoff || 420) / 60) / Math.log(100)));
      acid.res = Math.max(0, Math.min(1, (m.reso || 0) / 30));
      if (!m.mute.tb303) acidNote(m.note, m.accent, t);
    }
    function transport(tr) {
      var t = clockNow();
      acid.playing = tr.playing;
      if (tr.playing) { music.stop(); acid.heardAt = t; setBPM(tr.bpm, t); }
      else { acid.stoppedAt = t; setBPM(120, t); }
      if (ui.sound) { ui.sound.classList.toggle('active', tr.playing); ui.sound.setAttribute('aria-pressed', tr.playing); }
      btn.classList.toggle('playing', tr.playing);
      updateUI();
    }
    function setOpen(on) {
      dock.hidden = !on;
      btn.classList.toggle('active', on); btn.setAttribute('aria-pressed', on);
      setViewShift(on ? dock.offsetHeight + 12 : 0);    // lift the picture so the dance floor stays above the synth
    }
    NevetSynth.mount(dock, eng, { onStep: heard, onTransport: transport, onShow: setOpen });
    btn.addEventListener('click', function () { setOpen(dock.hidden); });
    return {
      engine: eng,
      show: function (on) { btn.hidden = !on; if (!on) setOpen(false); },
      leave: function () { eng.stop(); acid.playing = false; acid.stoppedAt = clockNow(); setOpen(false); },
      toggleMusic: function () { return eng.toggle(); }
    };
  })();

  // ---------------------------------------------------------------- world animation
  function stepWorld(now, dt) {
    // day / night
    night += (nightTarget - night) * Math.min(1, dt * 0.9);
    var n = night;
    skyMat.uniforms.top.value.copy(SKY.dayTop).lerp(SKY.nightTop, n);
    skyMat.uniforms.bottom.value.copy(SKY.dayHorizon).lerp(SKY.nightHorizon, n);
    var dusk = Math.sin(Math.min(1, n) * PI);           // a warm sunset on the way to night (the campfire's dusk)
    skyMat.uniforms.bottom.value.lerp(SKY.dusk, dusk * 0.55);
    skyMat.uniforms.top.value.lerp(SKY.duskTop, dusk * 0.35);
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
    // the campfire: lit for the Campfire dance (and for the party in dark mode); it flares up and dies down smoothly
    var fireOn = current === 'campfire' || current === 'party' ? 1 : 0;   // (at the party it burns on top of the folded arena)
    FIREFX.level += (fireOn - FIREFX.level) * Math.min(1, dt * 1.4);
    var lv = FIREFX.level, lit = lv > 0.02, camQ = camera.quaternion;
    var flick = 1 + Math.sin(now * 11) * 0.07 + Math.sin(now * 23.7) * 0.05 + Math.sin(now * 5.3) * 0.06;
    FIREFX.rainbow += ((RING.ceremony && current === 'campfire' ? 1 : 0) - FIREFX.rainbow) * Math.min(1, dt * 1.2);   // the champion's rainbow fire
    FIREFX.mats.forEach(function (m) { m.uniforms.uTime.value = now; m.uniforms.uRainbow.value = FIREFX.rainbow; });
    flames.forEach(function (f) {
      f.visible = lit;
      f.material.uniforms.uLevel.value = lv * flick;
      f.position.set(FIRE.x + f.userData.off.x * FOLD.fireK, f.userData.off.y + FOLD.fireY, FIRE.z + f.userData.off.z * FOLD.fireK);
      f.scale.setScalar(1 + 0.6 * FOLD.fireY / FOLD.top);           // (a beacon on top of the tower)
      f.quaternion.copy(camQ);                          // always facing you
    });
    var torchOn = current === 'campfire' || n > 0.3;
    RING.torches.forEach(function (f) { f.visible = torchOn && !f.userData.sunk; f.material.uniforms.uLevel.value = flick; f.quaternion.copy(camQ); });
    FIREFX.glow.visible = FIREFX.ground.visible = lit;
    FIREFX.glow.material.opacity = lv * (0.12 + 0.28 * n) * flick;
    FIREFX.glow.position.y = 1.3 * FIRE_K + FOLD.fireY;
    if (FOLD.fireY > 0.5) FIREFX.glow.material.opacity = Math.max(FIREFX.glow.material.opacity, lv * 0.32 * flick);
    FIREFX.glow.scale.setScalar((4.2 + Math.sin(now * 2.7) * 0.3) * FIRE_K);
    FIREFX.ground.material.opacity = lv * (0.08 + 0.3 * n) * flick * (1 - 0.6 * FOLD.fireY / FOLD.top);
    FIREFX.coals.forEach(function (c) {
      var p2 = c.userData.ph;
      c.material.color.setHSL(0.025 + 0.02 * Math.sin(now * 2.3 + p2), 1, 0.12 + lv * (0.32 + 0.1 * Math.sin(now * 4.1 + p2)));
    });
    FIREFX.smoke.forEach(function (sm) {
      var k = (now * 0.11 + sm.userData.ph) % 1;
      sm.visible = lit;
      sm.position.set(FIRE.x + (sm.userData.dx * k * 2.5 + k * 1.2) * FIRE_K, (2.6 + k * 6.5) * FIRE_K + FOLD.fireY, FIRE.z + sm.userData.dz * k * 2.5 * FIRE_K);
      sm.scale.setScalar((1.0 + k * 4.0) * FIRE_K);
      sm.material.opacity = lv * 0.45 * Math.sin(k * PI) * (1 - n * 0.4);
    });
    fireLight.intensity = lv * (0.35 + 0.75 * n) * flick;   // warm, not blinding (the toon colours clip easily)
    fireLight.position.set(FIRE.x, 3.4 + FOLD.fireY, FIRE.z);
    fireLight.distance = 34;
    embers.material.opacity = lv;
    embers.visible = lit;
    if (lit) {
      var ep = embers.geometry.attributes.position;
      embers.userData.seeds.forEach(function (s, i) {
        var k = (now * s[2] + s[0]) % 1, sw = s[1] + k * 4 + Math.sin(now * 1.3 + i) * 0.4, rad = (0.15 + k * (0.6 + s[3])) * FIRE_K;
        ep.setXYZ(i, FIRE.x + Math.cos(sw) * rad, 0.5 + k * (3.2 + s[3] * 3.5) * 1.5 + FOLD.fireY, FIRE.z + Math.sin(sw) * rad);
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
    stepJets(now, camQ); stepWorks(now, n); stepCannons(now);
    stepFold(now, dt); stepStage(now, dt, n); stepBloom(now, dt, n); stepFaders(dt);
    // things that move
    if (sails) sails.rotation.z = -now * 0.6;
    WORLD_ANIM.forEach(function (f) { f(now, dt, n); });
    clouds.forEach(function (c) { c.position.x += c.userData.speed * dt; if (c.position.x > 150) c.position.x = -150; });
    var thrower = heroes.filter(function (h) { return h.act === 'bread'; })[0];
    ducks.forEach(function (d) {
      var u = d.userData, a = now * u.speed + u.ph;
      if (u.cx0 === undefined) { u.cx0 = u.cx; u.cz0 = u.cz; u.r0 = u.r; }
      var gx = u.cx0, gz = u.cz0, gr = u.r0;                // swim over to whoever throws bread
      if (thrower) { var tp = thrower.root.position, dx2 = tp.x - POND_W.x, dz2 = tp.z - POND_W.z, dl = Math.hypot(dx2, dz2) || 1; gx = POND_W.x + dx2 / dl * 2.2 * YS; gz = POND_W.z + dz2 / dl * 2.2 * YS; gr = 0.7 * YS; }
      u.cx += (gx - u.cx) * Math.min(1, dt * 0.6); u.cz += (gz - u.cz) * Math.min(1, dt * 0.6); u.r += (gr - u.r) * Math.min(1, dt * 0.6);
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
      var feeder = null, fd = 40;                      // someone scattering grain nearby? run over and peck
      heroes.forEach(function (h) { if (h.act === 'scatter') { var dd = h.root.position.distanceToSquared(c.position); if (dd < fd) { fd = dd; feeder = h; } } });
      if (feeder && now > (u.fedNext || 0)) {
        var fr = feeder.root, ang = fr.rotation.y + rr(-0.7, 0.7), dist = rr(0.9, 1.9);
        u.target.set(fr.position.x + Math.sin(ang) * dist, 0, fr.position.z + Math.cos(ang) * dist);
        u.fedNext = now + rr(1, 2); u.next = now + 3; u.peck = now + rr(0.2, 0.8);
      } else if (now > u.next) { u.target.set(yx(rr(-13.5, -10.6)), 0, yz(rr(-5, 0.4))); u.next = now + rr(3, 7); u.peck = now + rr(0.5, 2); }
      tmp.subVectors(u.target, c.position); tmp.y = 0;
      var d = tmp.length();
      if (d > 0.1) { c.position.addScaledVector(tmp, Math.min(1, 0.9 * dt / d)); c.rotation.y = Math.atan2(tmp.x, tmp.z); c.position.y = Math.abs(Math.sin(now * 12)) * 0.04; }
      var pk = now > u.peck && now < u.peck + 0.6 ? Math.sin((now - u.peck) / 0.6 * PI * 3) : 0;
      u.head.rotation.x = Math.abs(pk) * 0.9;
      u.shadow.position.set(c.position.x, 0.03, c.position.z);
    });
    stepRabbits(now, dt);
    WORMS.forEach(function (w) { w.rotation.z = Math.sin(now * 3 + w.userData.wiggle) * 0.4; w.position.y = 0.9 + Math.abs(Math.sin(now * 1.5 + w.userData.wiggle)) * 0.05; });
    if (!calm) mapWorms.forEach(function (w) { w.rotation.y = Math.sin(now * 1.3 + w.userData.ph) * 0.6; w.scale.set(1 + Math.sin(now * 4 + w.userData.ph) * 0.12, 1, 1); });
    mapBees.forEach(function (b) { var u = b.userData, a = now * 2.2 + u.ph; b.position.set(u.c.x + Math.cos(a) * u.r, u.c.y + Math.sin(a * 1.7) * 0.25, u.c.z + Math.sin(a) * u.r); b.rotation.y = -a; });
    mapLeds.forEach(function (l) { l.visible = (now % 2) < 1.6; });
    // plants: fruit regrows, watered plants perk up and their soil darkens
    plants.forEach(function (p) {
      if (!p.ripe && p.regrowAt && now > p.regrowAt) { p.ripe = true; p.regrowAt = 0; }
      var want = p.ripe ? 1 : 0;
      p.ripeK += (want - p.ripeK) * Math.min(1, dt * 3);
      var ms = p.model.userData.minScale || 0;
      var sc = Math.max(0.001, ms + (1 - ms) * p.ripeK);
      (p.model.userData.produce || []).forEach(function (o) { if (!o.userData.s0) o.userData.s0 = o.scale.clone(); o.scale.copy(o.userData.s0).multiplyScalar(sc); });
      if (p.perk > 0) p.perk = Math.max(0, p.perk - dt * 0.8);
      p.droop = (p.droop || 0) + ((p.thirsty ? 1 : 0) - (p.droop || 0)) * Math.min(1, dt * 2);
      p.holder.scale.set(PG.x, PG.y * (1 + Math.sin(p.perk * PI) * 0.18 - p.droop * 0.16), PG.x);   // (taller as the community blooms)
      p.holder.rotation.z = calm ? 0 : Math.sin(now * 1.2 + p.pos.x + p.pos.z) * 0.03;
      p.holder.rotation.x = p.droop * 0.2;
      if (p.drop) p.drop.position.y = p.pos.y + Math.min(2.2 * YS, p.height) * PG.y + 0.45 + Math.sin(now * 3 + p.pos.x) * 0.06;
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
  function viewDistance() { return (camera.aspect < 0.8 ? 27 : camera.aspect < 1.2 ? 22 : 17) * ((ACTS && ACTS[current] && ACTS[current].view) || 1); }   // (the arena and the stage need a wider look)
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
    sound: document.getElementById('farm-sound'), light: document.getElementById('farm-light')
  };
  function showLight() { if (ui.light) { ui.light.classList.toggle('dark', FARM_DARK); ui.light.setAttribute('aria-pressed', FARM_DARK); ui.light.title = FARM_DARK ? 'Night: switch to day' : 'Day: switch to night'; } }
  if (ui.light) ui.light.addEventListener('click', function () {
    FARM_DARK = !FARM_DARK;
    try { localStorage.setItem('nevet-farm-dark', FARM_DARK ? '1' : '0'); } catch (e) { /* private mode: just for now */ }
    nightTarget = lightTarget(current);
    showLight();
  });
  showLight();
  if (ui.sound) ui.sound.addEventListener('click', function () {
    if (acidPanel && acidPanel.engine) { acidPanel.toggleMusic(); return; }   // the 303/909 engine (its transport updates the button)
    var on = music.toggle();
    ui.sound.classList.toggle('active', on); ui.sound.setAttribute('aria-pressed', on);
  });
  function updateUI() {
    if (ui.name) ui.name.textContent = actTitle();
    ui.chips.forEach(function (c) { c.classList.toggle('active', c.dataset.act === current); c.setAttribute('aria-pressed', c.dataset.act === current); });
    if (ui.auto) { ui.auto.classList.toggle('active', auto); ui.auto.setAttribute('aria-pressed', auto); }
    if (ui.sound) ui.sound.hidden = current !== 'party';
    if (acidPanel) acidPanel.show(current === 'party');
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
      var pw = h.powers ? ' · 💪' + h.powers.strength + ' 🫀' + h.powers.stamina + ' 🤸' + h.powers.agility + ' 🦉' + h.powers.wisdom + ' 💚' + h.powers.heart : '';
      if (ui.follow) { ui.follow.hidden = false; ui.follow.textContent = h.name + (h.level ? ' · Lv ' + h.level : '') + pw + ' — tap the ground to let go'; }
    } else if (ui.follow) ui.follow.hidden = true;
  }
  // keyboard / USB button boxes: 1-7 pick an activity, A toggles auto, Esc goes back
  document.addEventListener('keydown', function (e) {
    var k = e.key;
    if (k >= '1' && k <= String(ORDER.length)) setActivity(ORDER[+k - 1], clockNow(), true);
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

  // ---------------------------------------------------------------- the live channel (TV) view: /farm?tv=1
  // No buttons; activities change by themselves (by the real time of day), the camera glides round and now
  // and then follows a hero, and real actions logged on Nevet appear on screen as they happen.
  var TV = !!D.tv, tvFollowAt = 18, tvFollowEnd = 0, tvLast = D.lastLog || 0, tvNewsUntil = 0, tvClockAt = 0;
  var tvEl = { act: document.getElementById('tv-act'), clock: document.getElementById('tv-clock'), news: document.getElementById('tv-news'), exit: document.getElementById('tv-exit') };
  var TV_ACT = { watering: 'water', harvest: 'harvest', planting: 'plant', seeding: 'plant', germination: 'plant', transplant: 'plant',
                 feeding: 'animals', delivery: 'harvest', pruning: 'harvest', weeding: 'water', fertilizing: 'water' };
  function stepTV(now) {
    if (now > tvClockAt) {
      tvClockAt = now + 1;
      var d = new Date();
      if (tvEl.clock) tvEl.clock.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      if (tvEl.act) tvEl.act.textContent = actTitle() + (follow ? ' · ' + follow.name : '');
    }
    if (!follow && now > tvFollowAt) {                 // the camera finds someone busy and stays with them a while
      var busy = heroes.filter(function (h) { return h.act && h.act !== 'idle'; });
      if (busy.length) { setFollow(busy[Math.floor(R() * busy.length)]); tvFollowEnd = now + rr(12, 18); }
      else tvFollowAt = now + 5;
    } else if (follow && now > tvFollowEnd) {
      setFollow(null); userTouched = -99; controls.autoRotate = true; tvFollowAt = now + rr(25, 40);
      focusTarget = ACTS[current].centre.clone(); focusUntil = now + 3;
    }
    if (tvEl.news && !tvEl.news.hidden && now > tvNewsUntil) tvEl.news.hidden = true;
  }
  function tvPoll() {
    fetch('/api/farm/live?since=' + tvLast, { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j) return;
      tvLast = j.latest;
      var ev = j.events[j.events.length - 1];
      if (!ev) return;
      tvEl.news.innerHTML = '<small>Just now on the farm</small>';
      tvEl.news.appendChild(document.createTextNode(ev.who + ' ' + ev.verb + ' ' + ev.what + (j.events.length > 1 ? ' (+' + (j.events.length - 1) + ' more)' : '')));
      tvEl.news.hidden = false; tvNewsUntil = clockNow() + 12;
      var act = TV_ACT[ev.type];
      if (act && act !== current) setActivity(act, clockNow(), false);   // the heroes act it out
      actStarted = clockNow();
    }).catch(function (e) { if (window.console) console.warn('live view:', e); });
  }
  if (TV) {
    auto = true; actStarted = 0;
    controls.autoRotateSpeed = 0.22;
    setInterval(tvPoll, 30000);
    setTimeout(function () { location.reload(); }, 6 * 3600 * 1000);   // fresh plants, heroes and memory every 6 hours
    var wake = function () { if (navigator.wakeLock) navigator.wakeLock.request('screen').catch(function () {}); };
    wake(); document.addEventListener('visibilitychange', function () { if (!document.hidden) wake(); });
    var exitT = null;
    document.addEventListener('pointerdown', function () { if (!tvEl.exit) return; tvEl.exit.hidden = false; clearTimeout(exitT); exitT = setTimeout(function () { tvEl.exit.hidden = true; }, 4000); });
    var hr0 = new Date().getHours();
    if (!D.start && !EVENT) setActivity(hr0 >= 20 || hr0 < 6 ? 'campfire' : 'harvest', clockNow(), false);
  }

  // ---------------------------------------------------------------- loop
  var clock = new THREE.Clock(), last = 0, nextSpawn = 0.4, running = true;
  document.addEventListener('visibilitychange', function () { running = !document.hidden; if (running) { last = clock.getElapsedTime(); loop(); } });
  // the next activity when it changes by itself; the live (TV) view follows the real clock: work by day, campfire and party at night
  function actTitle() { return EVENT && current === EVENT.act ? EVENT.emoji + ' ' + EVENT.title + ' · ' + ACTS[current].name : ACTS[current].name; }
  function nextAuto() {
    if (EVENT && TV) return EVENT.act;                // the live view stays with the event while it's on
    var list = ORDER;
    if (TV) { var hr = new Date().getHours(); list = hr >= 20 || hr < 6 ? ['campfire', 'party'] : ['harvest', 'water', 'animals', 'play', 'plant']; }
    var i = list.indexOf(current);
    return list[(i + 1) % list.length];
  }
  function step(dt) {
    simNow += dt;
    var now = simNow;
    if (arrivals.length && now >= nextSpawn) { spawnNext(now); nextSpawn = now + 0.7; }
    if (auto && now - actStarted > AUTO_DUR[current] && !arrivals.length) setActivity(nextAuto(), now, false);
    heroes.forEach(function (h) { stepHero(h, now, dt); });
    separate();
    stepCamp(now, dt);
    stepParty(now, dt);
    stepPlay(now, dt);
    stepWorld(now, dt);
    stepParticles(dt);
  }
  updateUI();
  nightTarget = lightTarget(current); night = nightTarget;
  PARTY.group.visible = current === 'party';
  setPartyNav(current === 'party');
  (function () {                                       // first view: the gate and the activity behind it
    var c = ACTS[current].centre, dir = V(0.55, 0.6, 0.85).normalize();
    controls.target.copy(c).lerp(V(0, 0.8, 8), 0.45);
    camera.position.copy(controls.target).addScaledVector(dir, viewDistance() * 1.1);
    focusTarget = c.clone(); focusUntil = 6;
  })();
  var lastDraw = 0;
  function loop() {
    if (!running) return;
    requestAnimationFrame(loop);
    var real = clock.getElapsedTime();
    if (TV && real - lastDraw < 1 / 30) return;        // live view: 30 frames a second is plenty and keeps the device cool
    lastDraw = real;
    var dt = Math.min(0.05, real - last);
    last = real;
    if (TV) stepTV(simNow);
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
    tv: function () { return { on: TV, following: follow && follow.name, current: current, last: tvLast }; },
    tvPoll: function () { tvPoll(); },
    acid: function () { return { playing: acid.playing, bpm: BPM, step: acid.step, cut: acid.cut, beats: beatsAt(clockNow()), engine: !!(acidPanel && acidPanel.engine) }; },
    synth: function () { return acidPanel && acidPanel.engine; },
    simulate: function (sec) { for (var t = 0; t < sec; t += 0.05) step(0.05); },
    closest: function () {
      var best = Infinity;
      for (var i = 0; i < heroes.length; i++) for (var j = i + 1; j < heroes.length; j++)
        best = Math.min(best, Math.hypot(heroes[i].root.position.x - heroes[j].root.position.x, heroes[i].root.position.z - heroes[j].root.position.z));
      return best;
    },
    free: function (x, z) { return freeAt(x, z); }, path: function (a, b) { return findPath(V(a[0], 0, a[1]), V(b[0], 0, b[1])).map(function (v) { return [+v.x.toFixed(1), +v.z.toFixed(1)]; }); },
    plants: plants,
    blocked: function (x, z, pad) { return blockedAt(x, z, pad); },
    party: function () { return { dance: dance.cur.id, name: dance.cur.name, form: form.on ? form.kind : null, moving: form.moving }; },
    debugFold: function () { return FOLD; },
    floorSlots: function () { return heroes.slice(1).map(function (h, k) { var v = floorSlot(h, k); return [+v.x.toFixed(2), +v.z.toFixed(2)]; }); },
    ring: function () {
      return { phase: RING.phase, bout: RING.bout && RING.bout.id, style: ringStyle().id, winner: RING.winner && RING.winner.name, points: RING.points,
               fighters: RING.fighters.map(function (h) { return { id: h.id, name: h.name, act: h.act, gear: !!h.gear, kit: h.dress ? h.dress.gloves : null, x: +h.root.position.x.toFixed(2), z: +h.root.position.z.toFixed(2), down: h.sp.down > clockNow() }; }),
               dancing: heroes.filter(function (h) { return h.camp; }).length, dance: dance.cur.id, ceremony: RING.ceremony,
               football: FB.match && { id: FB.match.id, score: FB.score.slice(), players: PST.football.users.map(function (h) { return h.name + ':' + h.fbTeam + ':' + h.act; }) },
               wall: wallNow() };
    },
    setGames: function (j) { GAMES.fixed = true; setGames(j); },
    games: function () { return GAMES; },
    blockedHeroes: function () { return heroes.filter(function (h) { return blockedAt(h.root.position.x, h.root.position.z, 0.2); }).length; },
    look: function (name, dist, dir) {                 // snap the camera to an activity (or to a point [x, y, z]) at a comfortable distance
      var c = Array.isArray(name) ? V(name[0], name[1], name[2]) : ACTS[name || current].centre, d = V(dir ? dir[0] : 0.55, dir ? dir[1] : 0.6, dir ? dir[2] : 0.85).normalize();
      controls.autoRotate = false; userTouched = clockNow(); focusTarget = null;
      controls.target.copy(c); camera.position.copy(c).addScaledVector(d, dist || viewDistance()); controls.update();
    },
    fx: function () { return { jets: FX.jets.filter(function (j) { return j.board.visible; }).length, works: FX.works.filter(function (w) { return w.pts.visible; }).length,
                               cannons: FX.cannons.filter(function (c) { return c.pts.visible; }).length, rainbow: +FIREFX.rainbow.toFixed(2) }; },
    fire: function (what) {                             // set off the show by hand (for testing): 'jets', 'works', 'cannons'
      var now = clockNow();
      if (what === 'jets' || !what) FX.jets.forEach(function (j, i) { fireJet(j, now, i * 0.03); });
      if (what === 'works' || !what) for (var i = 0; i < 6; i++) {
        var bj = RING.braziers[i % RING.braziers.length];
        if (current === 'party') launchWork(V(PARTY.c.x + rr(-10, 10), 0.5, STAGE.wallZ - 2.2), rr(11, 17), null, now, i * 0.2, V(PARTY.c.x + rr(-8, 8), 0, CROWD_C.z - 2));
        else launchWork(bj.pos, rr(9, 15), null, now, i * 0.2, overArena(bj));
      }
      if (what === 'cannons' || !what) FX.cannons.forEach(function (c) { fireCannon(c, now); });
    },
    camp: function () { return heroes.filter(function (h) { return h.camp || h.act === 'campdance'; }).map(function (h) { var t = campSlot(h), p = h.root.position;
      return [h.name, h.camp, h.act, +Math.atan2(p.z - FIRE.z, p.x - FIRE.x).toFixed(2), +Math.hypot(p.x - FIRE.x, p.z - FIRE.z).toFixed(2), +t.a.toFixed(2), h.path.length]; }); },
    setDark: function (on) { FARM_DARK = !!on; nightTarget = lightTarget(current); night = nightTarget; showLight(); }
  };
})();
