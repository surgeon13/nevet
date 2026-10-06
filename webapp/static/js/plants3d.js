/* plants3d.js - 3D models for everything Nevet grows.
 *
 * Every species lives in static/assets/plants/catalog.json as a model
 * archetype plus a few parameters (height, leaf shape, fruit shape and
 * colours...). This file turns a species + growth stage into a small
 * toon-shaded three.js model:
 *
 *   NevetPlants.use(catalog)                  register species (whole catalog or a few)
 *   NevetPlants.detect(name, variety)         -> species id ('cherry_tomato'), or null
 *   NevetPlants.build(idOrSpec, stage, opts)  -> THREE.Group, base at y = 0 (soil level)
 *       group.userData = { species, stage, produce: [group], minScale, color, height, radius }
 *       opts: { seed, merge (default true) }
 *   NevetPlants.viewer(canvas, wrap, id, stage, opts) -> { set(id, stage), plant, scene, camera }
 *   NevetPlants.snapshot(id, stage, size)     -> PNG data URL (cached)
 *
 * Stages follow farm_db.PLANT_STAGES: seed, germination, seedling,
 * growing, mature, harvested, archived. Models are built from plain
 * shapes, then baked into one mesh (plus one for the produce, so the farm
 * can pick fruit), which keeps each plant to two draw calls.
 */
(function () {
  'use strict';
  if (typeof THREE === 'undefined') return;
  var PI = Math.PI, TAU = PI * 2;
  var STAGES = ['seed', 'germination', 'seedling', 'growing', 'mature', 'harvested', 'archived'];

  // ---------------------------------------------------------------- catalog + detection
  var SPECIES = {}, LIST = [];
  function use(cat) {
    var list = Array.isArray(cat) ? cat : (cat && cat.species) || [];
    list.forEach(function (s) { if (!s || !s.id) return; if (!SPECIES[s.id]) LIST.push(s); SPECIES[s.id] = s; });
    return api;
  }
  function load(url) {
    return fetch(url, { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(use);
  }
  function norm(t) {
    return (t || '').toString().toLowerCase().replace(/[׳’‘`´]/g, "'").replace(/\s+/g, ' ').trim();
  }
  function bestMatch(text) {
    text = norm(text);
    if (!text) return null;
    var best = null, len = 0;
    LIST.forEach(function (s) {
      (s.keywords || []).forEach(function (k) {
        k = norm(k);
        if (k && k.length > len && text.indexOf(k) >= 0) { best = s; len = k.length; }
      });
    });
    return best;
  }
  // Same rule as plants.py detect(): the name decides; the variety refines
  // it when it points at a species of the same group ("Tomato" + "Cherry").
  function detect(name, variety, assetType) {
    if (assetType === 'worm_bin') return SPECIES.compost_worms ? 'compost_worms' : null;
    var n = bestMatch(name), v = bestMatch(variety);
    var s = (v && (!n || v.group === n.group)) ? v : (n || v);
    return s ? s.id : null;
  }

  // ---------------------------------------------------------------- small helpers
  function rng(seed) {
    var a = seed >>> 0;
    return function () { a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function hash(s) {
    var h = 2166136261;
    s = String(s);
    for (var i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
  }
  function V(x, y, z) { return new THREE.Vector3(x || 0, y || 0, z || 0); }
  function dirv(yaw) { return V(Math.cos(yaw), 0, -Math.sin(yaw)); }       // matches a leaf's yaw
  function lerpV(a, b, t) { return a.clone().lerp(b, t); }
  var _c1 = new THREE.Color(), _c2 = new THREE.Color();
  function mix(a, b, t) { _c1.set(a); _c2.set(b); return '#' + _c1.lerp(_c2, t).getHexString(); }
  function shade(c, k) { return k >= 0 ? mix(c, '#ffffff', k) : mix(c, '#000000', -k); }

  // Build context: set at the start of build(), read by every helper.
  var C = null;
  var DRY = '#a8865a';
  function col(c) { return C && C.dried ? mix(c, DRY, 0.72) : c; }
  function vary(c) { var r = C.r(); return r < 0.34 ? c : shade(c, r < 0.67 ? 0.09 : -0.09); }

  var mats = {};
  function mat(c, side) {
    var k = c + (side ? '|2' : '');
    return mats[k] || (mats[k] = new THREE.MeshToonMaterial({ color: new THREE.Color(c), side: side ? THREE.DoubleSide : THREE.FrontSide }));
  }
  var GEO = {};
  function cached(key, make) { return GEO[key] || (GEO[key] = make()); }
  function put(parent, geo, c, side) {
    var m = new THREE.Mesh(geo, mat(col(c), side));
    parent.add(m);
    return m;
  }

  // ---------------------------------------------------------------- leaves
  // Unit leaf along +X (stem end at 0, tip at 1), width across Z, facing +Y.
  var PROFILE = {
    oval: function (u) { return 0.27 * Math.pow(Math.sin(PI * u), 0.75); },
    lance: function (u) { return 0.12 * Math.pow(Math.sin(PI * Math.pow(u, 0.8)), 0.85); },
    round: function (u) { return 0.42 * Math.pow(Math.sin(PI * u), 0.55); },
    heart: function (u) { return 0.44 * Math.pow(Math.sin(PI * Math.min(1, 0.12 + u * 0.88)), 0.6) * (1.12 - 0.55 * u); },
    spoon: function (u) { return 0.3 * Math.pow(Math.sin(PI * Math.pow(u, 1.7)), 0.7) + 0.02 * (1 - u); },
    blade: function (u) { return 0.045 * (1 - u * u) + 0.004; },
    needle: function (u) { return 0.07 * Math.pow(Math.sin(PI * u), 0.5); },
    serrated: function (u, i) { return 0.25 * Math.pow(Math.sin(PI * u), 0.8) * (i % 2 ? 0.8 : 1); },
    lobed: function (u) { return 0.2 * Math.pow(Math.sin(PI * u), 0.7) * (0.5 + 0.5 * Math.abs(Math.sin(u * PI * 3.5))); },
    palm: function (u) { return 0.48 * Math.pow(Math.sin(PI * Math.min(1, 0.1 + u * 0.9)), 0.55) * (0.72 + 0.28 * Math.abs(Math.cos(u * PI * 2.5))); },
    petal: function (u) { return 0.36 * Math.pow(Math.sin(PI * u), 0.6); },
    coty: function (u) { return 0.32 * Math.pow(Math.sin(PI * u), 0.6); },
    frond: function (u) { return 0.06 * Math.pow(Math.sin(PI * u), 0.6) + 0.002; }
  };
  var SEGS = { oval: [7, 2], lance: [6, 2], round: [6, 4], heart: [7, 4], spoon: [7, 2], blade: [6, 1], needle: [2, 1],
               serrated: [12, 2], lobed: [14, 2], palm: [12, 4], petal: [4, 2], coty: [3, 2], frond: [4, 1] };
  function leafGeo(type, cup, bend) {
    cup = Math.round(cup * 10) / 10; bend = Math.round(bend * 10) / 10;
    return cached('leaf|' + type + '|' + cup + '|' + bend, function () {
      var prof = PROFILE[type] || PROFILE.oval, s = SEGS[type] || SEGS.oval, nu = s[0], nv = s[1] * 2;
      var pos = [], idx = [];
      for (var i = 0; i <= nu; i++) {
        var u = i / nu, w = prof(u, i);
        for (var j = 0; j <= nv; j++) {
          var t = -1 + 2 * j / nv, z = t * w;
          var y = cup * t * t * w - bend * u * u;
          pos.push(u, y, z);
        }
      }
      for (var a = 0; a < nu; a++) for (var b = 0; b < nv; b++) {
        var p0 = a * (nv + 1) + b, p1 = p0 + nv + 1;
        idx.push(p0, p1, p0 + 1, p0 + 1, p1, p1 + 1);
      }
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    });
  }
  // A leaf at `pos` pointing out at `yaw`, tilted up by `pitch`.
  function leaf(parent, type, len, yaw, pitch, c, pos, o) {
    o = o || {};
    var bend = o.bend || 0;
    if (C.dried) { pitch -= 0.45 + C.r() * 0.35; bend += 0.25; }
    var m = put(parent, leafGeo(type, o.cup === undefined ? 0.3 : o.cup, bend), c, true);
    m.scale.set(len, len, len * (o.w || 1));
    if (pos) m.position.copy(pos);
    m.rotation.order = 'YZX';
    m.rotation.set(o.roll || 0, yaw, pitch);
    return m;
  }

  // ---------------------------------------------------------------- stems, balls, fruit shapes
  var UP = V(0, 1, 0), _d = V(), _q = new THREE.Quaternion();
  function rodGeo(seg, ratio) {
    ratio = Math.round(ratio * 10) / 10;
    return cached('rod|' + seg + '|' + ratio, function () {
      var g = new THREE.CylinderGeometry(ratio, 1, 1, seg, 1, false);
      g.translate(0, 0.5, 0);
      return g;
    });
  }
  function rod(parent, a, b, r0, r1, c, seg) {
    _d.subVectors(b, a);
    var L = _d.length();
    if (L < 1e-4) return null;
    var m = put(parent, rodGeo(seg || 5, (r1 === undefined ? r0 : r1) / r0), c);
    m.position.copy(a);
    m.scale.set(r0, L, r0);
    m.quaternion.copy(_q.setFromUnitVectors(UP, _d.normalize()));
    return m;
  }
  function tube(parent, pts, r, c, segs, radial) {
    var curve = pts.getPoint ? pts : new THREE.CatmullRomCurve3(pts);
    return put(parent, new THREE.TubeGeometry(curve, segs || 8, r, radial || 5, false), c);
  }
  function ballGeo(seg) {
    return cached('ball|' + seg, function () { return new THREE.SphereGeometry(1, seg, Math.max(4, Math.round(seg * 0.7))); });
  }
  function ball(parent, r, c, pos, sc, seg) {
    var m = put(parent, ballGeo(seg || 8), c);
    if (pos) m.position.copy(pos);
    m.scale.set(r * (sc ? sc[0] : 1), r * (sc ? sc[1] : 1), r * (sc ? sc[2] : 1));
    return m;
  }
  function blob(parent, r, c, pos, sc) {                 // faceted low-poly blob for canopies and mounds
    var m = put(parent, cached('blob', function () { return new THREE.IcosahedronGeometry(1, 1); }), c);
    m.position.copy(pos);
    m.scale.set(r * (sc ? sc[0] : 1), r * (sc ? sc[1] : 1), r * (sc ? sc[2] : 1));
    m.rotation.set(C.r() * 3, C.r() * 3, 0);
    return m;
  }
  function coneM(parent, r, h, c, pos, seg) {             // cone with its base at pos, pointing +Y
    var m = put(parent, cached('cone|' + (seg || 6), function () { var g = new THREE.ConeGeometry(1, 1, seg || 6); g.translate(0, 0.5, 0); return g; }), c);
    m.position.copy(pos);
    m.scale.set(r, h, r);
    return m;
  }
  function boxM(parent, w, h, d, c, pos) {
    var m = put(parent, cached('box', function () { return new THREE.BoxGeometry(1, 1, 1); }), c);
    m.position.copy(pos);
    m.scale.set(w, h, d);
    return m;
  }
  function aim(m, dir) { m.quaternion.copy(_q.setFromUnitVectors(UP, _d.copy(dir).normalize())); return m; }

  // Lathe profiles, top-down [radius, y]; largest dimension ~2 units.
  var PROF = {
    round: [[0.1, 0], [0.5, -0.06], [0.88, -0.3], [1, -0.75], [0.9, -1.25], [0.55, -1.58], [0, -1.66]],
    citrus: [[0.08, 0], [0.55, -0.1], [0.9, -0.45], [0.95, -0.95], [0.82, -1.45], [0.4, -1.8], [0.06, -1.9], [0, -1.92]],
    bell: [[0.22, 0], [0.62, -0.05], [0.86, -0.3], [0.9, -0.9], [0.85, -1.5], [0.66, -1.85], [0.3, -1.96], [0, -1.9]],
    chili: [[0.12, 0], [0.21, -0.12], [0.2, -0.6], [0.16, -1.1], [0.1, -1.6], [0.04, -1.9], [0, -2]],
    long: [[0.08, 0], [0.24, -0.12], [0.3, -0.6], [0.36, -1.2], [0.4, -1.6], [0.3, -1.9], [0, -2]],
    pod: [[0.03, 0], [0.13, -0.15], [0.14, -1.0], [0.12, -1.7], [0.04, -1.95], [0, -2]],
    olive: [[0.06, 0], [0.45, -0.15], [0.68, -0.7], [0.68, -1.3], [0.45, -1.85], [0, -2]],
    fig: [[0.1, 0], [0.22, -0.2], [0.55, -0.75], [0.8, -1.3], [0.75, -1.7], [0.45, -1.95], [0, -2]],
    pear: [[0.1, 0], [0.3, -0.15], [0.42, -0.6], [0.7, -1.2], [0.8, -1.55], [0.6, -1.9], [0, -2]],
    straw: [[0.25, 0], [0.75, -0.15], [0.85, -0.55], [0.6, -1.2], [0.25, -1.7], [0, -1.85]],
    butternut: [[0.08, 0], [0.28, -0.08], [0.32, -0.7], [0.48, -1.2], [0.6, -1.55], [0.5, -1.88], [0, -2]],
    melonlong: [[0.06, 0], [0.45, -0.12], [0.66, -0.6], [0.68, -1.3], [0.5, -1.85], [0, -2]],
    bulb: [[0.06, 0.5], [0.16, 0.25], [0.6, -0.3], [0.95, -0.85], [0.85, -1.3], [0.4, -1.55], [0, -1.6]],
    carrot: [[0.85, 0], [1, -0.3], [0.85, -1.5], [0.55, -3.5], [0.2, -5.4], [0, -6]],
    tuber: [[0.3, 0], [0.75, -0.2], [0.85, -0.9], [0.7, -1.6], [0.3, -1.95], [0, -2]],
    cup: [[0.78, 0.25], [0.86, -0.1], [0.8, -0.65], [0.5, -1.05], [0.12, -1.2], [0, -1.22]],
    rose: [[0.95, 0.2], [0.9, -0.2], [0.65, -0.65], [0.25, -0.9], [0, -0.95]],
    trumpet: [[0.75, 0.15], [0.5, -0.2], [0.25, -0.7], [0.12, -1.3], [0, -1.4]],
    pot: [[0.5, 0], [0.47, -0.02], [0.43, -0.08], [0.36, -0.48], [0, -0.48]],
    cap: [[0, 0.62], [0.45, 0.52], [0.85, 0.28], [1, 0], [0.9, -0.08], [0.2, -0.05], [0, -0.04]]
  };
  function latheGeo(name, seg, bendAmt) {
    return cached('lathe|' + name + '|' + seg + '|' + (bendAmt || 0), function () {
      var pts = PROF[name].slice().reverse().map(function (p) { return new THREE.Vector2(p[0], p[1]); });
      var g = new THREE.LatheGeometry(pts, seg);
      if (bendAmt) {
        var p = g.attributes.position;
        for (var i = 0; i < p.count; i++) p.setX(i, p.getX(i) + bendAmt * p.getY(i) * p.getY(i));
        g.computeVertexNormals();
      }
      return g;
    });
  }
  function lathe(parent, name, s, c, pos, seg, bendAmt, side) {
    var m = put(parent, latheGeo(name, seg || 10, bendAmt), c, side);
    if (pos) m.position.copy(pos);
    m.scale.setScalar(s);
    return m;
  }
  // Spike (lavender, wheat ear): a bumpy spindle, base at 0 pointing +Y, length 2.
  function spikeGeo(bumps) {
    return cached('spike|' + bumps, function () {
      var pts = [];
      for (var i = 0; i <= 16; i++) {
        var t = i / 16;
        var r = Math.sin(PI * (0.06 + t * 0.94)) * (0.62 + 0.38 * Math.abs(Math.sin(t * PI * bumps))) * 0.3;
        pts.push(new THREE.Vector2(i === 16 ? 0 : Math.max(0.02, r), t * 2));
      }
      return new THREE.LatheGeometry(pts, 7);
    });
  }
  function spike(parent, s, c, pos, dir, bumps) {
    var m = put(parent, spikeGeo(bumps || 5), c);
    m.position.copy(pos);
    m.scale.setScalar(s);
    if (dir) aim(m, dir);
    return m;
  }

  // Fruit hanging from `pos` (its stem end), size = half its biggest dimension.
  // Returns the group; group.userData.h is its height.
  var FRUIT_K = 0.65;                                  // catalog sizes read a bit big on screen
  function fruit(parent, shape, c, s, pos, o) {
    o = o || {};
    s *= FRUIT_K;
    var g = new THREE.Group(), h = 2 * s, cap = o.cap || '#5d8a35';
    switch (shape) {
      case 'round': case 'pomegranate': case 'melon': case 'citrus': {
        var nm = shape === 'citrus' ? 'citrus' : 'round';
        lathe(g, nm, s, c, null, s > 0.1 ? 14 : 10);
        if (shape === 'pomegranate') coneM(g, s * 0.32, s * 0.35, shade(c, -0.15), V(0, -1.62 * s - s * 0.25, 0), 6).rotation.x = 0;
        if (shape !== 'melon' && s > 0.04) leaf(g, 'coty', s * 0.8, C.r() * TAU, 0.15, cap, V(0, -0.02 * s, 0), { cup: 0 });
        h = 1.66 * s;
        break;
      }
      case 'bell': lathe(g, 'bell', s, c, null, 12); rod(g, V(0, 0.06 * s, 0), V(0, -0.1 * s, 0), s * 0.12, s * 0.12, cap, 5); break;
      case 'chili': lathe(g, 'chili', s, c, null, 7, 0.12); break;
      case 'long': lathe(g, 'long', s, c, null, 10, 0.05); if (o.calyx) ball(g, s * 0.3, cap, V(0, -0.15 * s, 0), [1, 0.6, 1], 6); break;
      case 'pod': { var pd = lathe(g, 'pod', s, c, null, 6, 0.15); pd.scale.z = s * 0.6; break; }
      case 'olive': case 'oval': lathe(g, 'olive', s, c, null, 8, shape === 'oval' ? 0.1 : 0); break;
      case 'fig': lathe(g, 'fig', s, c, null, 9); break;
      case 'pear': lathe(g, 'pear', s, c, null, 10); break;
      case 'strawberry': lathe(g, 'straw', s, c, null, 9); leaf(g, 'coty', s * 0.9, 0, 0.1, cap, V(0, 0, 0), { cup: 0 }); leaf(g, 'coty', s * 0.9, 2.1, 0.1, cap, V(0, 0, 0), { cup: 0 }); leaf(g, 'coty', s * 0.9, 4.2, 0.1, cap, V(0, 0, 0), { cup: 0 }); h = 1.85 * s; break;
      case 'butternut': lathe(g, 'butternut', s, c, null, 12); break;
      case 'watermelon': {
        lathe(g, 'melonlong', s, c, null, 14);
        for (var i = 0; i < 6; i++) {
          var st = ball(g, s, o.stripe || shade(c, -0.35), V(Math.cos(i / 6 * TAU) * s * 0.52, -s, Math.sin(i / 6 * TAU) * s * 0.52), [0.2, 0.92, 0.2], 8);
          st.rotation.y = -i / 6 * TAU;
        }
        break;
      }
      case 'pumpkin': {
        for (var r = 0; r < 8; r++) ball(g, s * 0.55, c, V(Math.cos(r / 8 * TAU) * s * 0.45, -s * 0.8, Math.sin(r / 8 * TAU) * s * 0.45), [0.85, 1.45, 0.85], 10);
        rod(g, V(0, -s * 0.1, 0), V(0.02 * s, s * 0.25, 0), s * 0.08, s * 0.06, '#6b7a35', 5);
        h = 1.6 * s;
        break;
      }
      default: ball(g, s, c, V(0, -s, 0), null, 10);
    }
    if (pos) g.position.copy(pos);
    g.userData.h = h;
    g.userData.s = s;
    parent.add(g);
    return g;
  }
  // Lay a fruit on the ground at (x, z): round ones sit, long ones lie down.
  function groundFruit(parent, shape, c, s, x, z, yaw, o) {
    var f = fruit(parent, shape, c, s, null, o);
    var lying = shape === 'long' || shape === 'watermelon' || shape === 'butternut' || shape === 'chili' || shape === 'pod';
    if (lying) {
      f.rotation.order = 'YXZ';
      f.rotation.set(0, yaw, PI / 2);
      var fs = f.userData.s, r = shape === 'watermelon' ? 0.66 * fs : shape === 'butternut' ? 0.55 * fs : 0.36 * fs;
      f.position.set(x, r, z);
    } else {
      f.rotation.y = yaw;
      f.position.set(x, f.userData.h, z);
    }
    return f;
  }
  // Small 5-petal flower facing `dir`.
  function blossom(parent, c, s, pos, dir, centre) {
    var g = new THREE.Group();
    for (var i = 0; i < 5; i++) leaf(g, 'petal', s, i / 5 * TAU, 0.25, c, null, { cup: 0.3 });
    ball(g, s * 0.32, centre || '#f2c230', V(0, s * 0.08, 0), [1, 0.6, 1], 6);
    g.position.copy(pos);
    if (dir) aim(g, dir);
    parent.add(g);
    return g;
  }
  // Umbel (dill, coriander, parsley): rays from a point ending in tiny flowers.
  function umbel(parent, top, r, c) {
    for (var i = 0; i < 7; i++) {
      var a = i / 7 * TAU, end = top.clone().add(V(Math.cos(a) * r, r * 0.35, Math.sin(a) * r));
      rod(parent, top, end, 0.003, 0.003, '#7aa84a', 4);
      ball(parent, r * 0.28, c, end, [1, 0.5, 1], 6);
    }
  }

  // ---------------------------------------------------------------- archetypes
  // Each draws a mature plant at full size into C.root (and edible parts into
  // C.pg); C.young / C.bloom / C.fruit / C.harvested / C.dried tune it.
  var A = {};
  function N(full, youngN) { return C.young ? (youngN === undefined ? Math.max(2, Math.round(full * 0.4)) : youngN) : full; }
  function LT(t) { return t === 'broad' ? 'round' : t === 'compound' ? 'serrated' : (PROFILE[t] ? t : 'oval'); }

  function branchLeaves(base, tip, type, lc, size) {
    var dx = tip.x - base.x, dz = tip.z - base.z, yaw = Math.atan2(-dz, dx);
    var pitch = Math.atan2(tip.y - base.y, Math.hypot(dx, dz));
    if (type === 'compound') {
      [0.32, 0.56, 0.8].forEach(function (u, k) {
        var p = lerpV(base, tip, u), sz = size * (0.75 + k * 0.12);
        leaf(C.root, 'serrated', sz, yaw + 1.15, pitch - 0.3, vary(lc), p, { cup: 0.35, bend: 0.1 });
        leaf(C.root, 'serrated', sz, yaw - 1.15, pitch - 0.3, vary(lc), p, { cup: 0.35, bend: 0.1 });
      });
      leaf(C.root, 'serrated', size * 1.1, yaw, pitch - 0.2, vary(lc), tip, { cup: 0.35, bend: 0.15 });
    } else {
      var t = LT(type), w = type === 'broad' ? 1.1 : 1;
      leaf(C.root, t, size, yaw, pitch - 0.15, vary(lc), tip, { cup: 0.35, bend: 0.12, w: w });
      leaf(C.root, t, size * 0.85, yaw + 0.95, pitch - 0.3, vary(lc), lerpV(base, tip, 0.55), { cup: 0.35, bend: 0.1, w: w });
      leaf(C.root, t, size * 0.85, yaw - 0.95, pitch - 0.3, vary(lc), lerpV(base, tip, 0.55), { cup: 0.35, bend: 0.1, w: w });
    }
  }
  function fruitColour(fr, ripe, plantColour) {
    if (!ripe) return fr.unripe || '#8cc152';
    return C.r() < (fr.mix === undefined ? 0.8 : fr.mix) ? plantColour : (fr.unripe || '#8cc152');
  }

  A.fruiting = function (p) {
    var H = p.height || 1, fr = p.fruit || {}, lt = p.leaf || 'oval', lc = p.leafColor || '#4f9a3a';
    var stemC = p.stem || '#6a9a3e', bushy = !p.stake, Hs = C.young ? 0.5 : H, leafK = Math.max(0.75, H);
    var top = bushy ? 0.8 : 0.94;
    var curve = new THREE.CatmullRomCurve3([V(0, 0, 0), V(0.02, Hs * 0.3, -0.01), V(-0.015, Hs * 0.6, 0.015), V(0.01, Hs * top, 0)]);
    tube(C.root, curve, C.young ? 0.016 : bushy ? 0.024 : 0.019, stemC, 10);
    if (C.young) { leaf(C.root, 'coty', 0.07, 0.4, 0.35, '#8cc85a', V(0, 0.12, 0), { cup: 0.3, w: 1.1 }); leaf(C.root, 'coty', 0.07, 0.4 + PI, 0.35, '#8cc85a', V(0, 0.12, 0), { cup: 0.3, w: 1.1 }); }
    if (p.stake && !C.young) {
      rod(C.root, V(0.09, 0, 0.07), V(0.09, H * 1.02, 0.07), 0.016, 0.014, '#b58a55', 6);
      [0.38, 0.7].forEach(function (f) { rod(C.root, V(0, H * f, 0), V(0.09, H * f, 0.07), 0.007, 0.007, '#efe4c8', 4); });
    }
    var nodes = N(bushy ? 7 : 8, 3), spots = [];
    for (var i = 0; i < nodes; i++) {
      var t = (i + 0.5) / nodes, yaw = i * 2.4 + C.r() * 0.5;
      var base = curve.getPoint(Math.min(0.97, (C.young ? 0.4 : bushy ? 0.14 : 0.08) + t * (C.young ? 0.5 : bushy ? 0.82 : 0.88)));
      var len = (C.young ? 0.12 : H * (bushy ? 0.34 : 0.3) * (1.08 - t * 0.5) + 0.05);
      var tip = base.clone().add(dirv(yaw).multiplyScalar(len)).add(V(0, len * (bushy ? 0.5 - t * 0.2 : 0.3), 0));
      rod(C.root, base, tip, 0.011, 0.007, stemC, 5);
      branchLeaves(base, tip, lt, lc, (lt === 'compound' ? 0.115 : 0.2) * leafK * (1.1 - t * 0.3));
      spots.push({ a: base, b: tip, yaw: yaw, t: t });
    }
    var crown = curve.getPoint(1);
    for (var c = 0; c < 3; c++) leaf(C.root, LT(lt), leafK * 0.11 + 0.02, c * 2.1, 0.8, vary(lc), crown, { cup: 0.4 });
    if (C.young) return;
    var usable = spots.filter(function (s) { return s.t < 0.9; });
    // flowers
    var nf = Math.round((p.flowers || 5) * C.bloom);
    for (var f = 0; f < nf; f++) {
      var sp = usable[(f * 3 + 1) % usable.length], at = lerpV(sp.a, sp.b, 0.7).add(V(0, -0.03, 0));
      blossom(C.root, p.flower || '#f3d23b', 0.024, at, dirv(sp.yaw).add(V(0, -0.4, 0)), '#f2c230');
    }
    if (!C.fruit) return;
    var ripe = C.fruit === 2, n = fr.count || 4;
    if (!ripe) n = Math.max(1, Math.round(n * 0.5));
    var size = (fr.size || 0.08) * (ripe ? 1 : 0.62);
    var colours = fr.colors || [fr.color || '#e23d28'], plantColour = colours[Math.floor(C.r() * colours.length)];
    var shape = fr.shape || 'round', opts = { calyx: shape === 'long', cap: p.stem && shape === 'long' ? '#4f6a35' : null };
    if (fr.cluster) {
      var trusses = Math.max(1, Math.round(n / 5));
      for (var k = 0; k < trusses; k++) {
        var s2 = usable[(k * 2 + 1) % usable.length], anchor = lerpV(s2.a, s2.b, 0.45);
        var d = dirv(s2.yaw + 0.6), end = anchor.clone().add(d.clone().multiplyScalar(0.07)).add(V(0, -0.06, 0));
        rod(C.pg, anchor, end, 0.004, 0.003, stemC, 4);
        var per = Math.round(n / trusses);
        for (var j = 0; j < per; j++) {
          var u = j / Math.max(1, per - 1), at2 = end.clone().add(d.clone().multiplyScalar(u * 0.09)).add(V((j % 2 ? 1 : -1) * size * 0.9, -u * 0.08, 0));
          fruit(C.pg, shape, fruitColour(fr, ripe, plantColour), size * (1 - u * 0.15), at2);
        }
      }
      return;
    }
    for (var q = 0; q < n; q++) {
      var s3 = usable[(q * 2) % usable.length], uu = 0.35 + C.r() * 0.35, a3 = lerpV(s3.a, s3.b, uu);
      if (fr.up) {
        var fo = fruit(C.pg, shape, fruitColour(fr, ripe, plantColour), size, a3.clone().add(V(0, 0.02, 0)));
        fo.rotation.set(PI + (C.r() - 0.5) * 0.4, 0, (C.r() - 0.5) * 0.4);
        continue;
      }
      var hang = a3.clone().add(V(0, -0.025 - C.r() * 0.03, 0));
      rod(C.pg, a3, hang, 0.004, 0.004, stemC, 4);
      var fg = fruit(C.pg, shape, fruitColour(fr, ripe, plantColour), size * (0.85 + C.r() * 0.3), hang, opts);
      fg.rotation.set((C.r() - 0.5) * 0.3, C.r() * TAU, (C.r() - 0.5) * 0.3);
    }
  };

  // Upright stems with opposite leaf pairs (mint, basil, sage...).
  function pairStems(o) {
    var stems = N(o.stems, Math.max(2, Math.round(o.stems * 0.4))), tops = [];
    for (var s = 0; s < stems; s++) {
      var a = s / stems * TAU + C.r() * 0.6, lean = (o.lean || 0.25) * (0.5 + C.r());
      var h = o.H * (0.7 + C.r() * 0.3) * (s === 0 ? 1.05 : 1) * (C.young ? 0.55 : 1);
      var base = V(Math.cos(a) * 0.035, 0, Math.sin(a) * 0.035);
      var tip = base.clone().add(V(Math.cos(a) * Math.sin(lean) * h, Math.cos(lean) * h, Math.sin(a) * Math.sin(lean) * h));
      rod(C.root, base, tip, o.stemR || 0.007, (o.stemR || 0.007) * 0.6, o.stemC || shade(o.lc, -0.15), 4);
      var nodes = N(o.nodes, 2);
      for (var k = 0; k < nodes; k++) {
        var t = (k + 0.45) / (nodes + 0.25), at = lerpV(base, tip, t), yaw = k * PI / 2 + a;
        var sz = o.len * (1.15 - t * 0.5);
        var pitch = 0.15 + t * 0.6;
        leaf(o.leafParent || C.pg, o.type, sz, yaw, pitch, vary(o.lc), at, { cup: o.cup, bend: 0.1, w: o.w });
        leaf(o.leafParent || C.pg, o.type, sz, yaw + PI, pitch, vary(o.lc), at, { cup: o.cup, bend: 0.1, w: o.w });
      }
      for (var tt = 0; tt < 3; tt++) leaf(o.leafParent || C.pg, o.type, o.len * 0.5, a + tt * 2.1, 1.0, vary(shade(o.lc, 0.08)), tip, { cup: o.cup });
      tops.push(tip);
    }
    return tops;
  }
  function flowerSpikes(tops, c, s, count) {
    for (var i = 0; i < Math.min(count, tops.length); i++) spike(C.root, s, c, tops[i], V(0, 1, 0), 5);
  }

  A.herb = function (p) {
    var H = p.height || 0.5, lc = p.leafColor || '#5fae48', fl = p.flower || '#fbfaf5', f = p.form || 'basil';
    var bloomN = C.stage === 'mature' ? 2 : 0, extra = bloomN ? 1 : 0, tops, i, a, base, tip;
    switch (f) {
      case 'mint':
        tops = pairStems({ stems: 8, H: H * 0.85, nodes: 6, len: 0.085, type: 'serrated', cup: 0.3, w: 1.15, lc: lc, lean: 0.4 });
        flowerSpikes(tops, fl, 0.03, bloomN + extra);
        break;
      case 'basil':
        tops = pairStems({ stems: 6, H: H * 0.8, nodes: 5, len: 0.13, type: 'oval', cup: 0.8, w: 1.2, lc: lc, lean: 0.4, stemR: 0.009 });
        flowerSpikes(tops, fl, 0.04, bloomN);
        break;
      case 'sage':
        tops = pairStems({ stems: 7, H: H * 0.8, nodes: 4, len: 0.13, type: 'oval', cup: 0.55, w: 0.85, lc: lc, lean: 0.5, stemR: 0.008 });
        flowerSpikes(tops, fl, 0.045, bloomN + extra);
        break;
      case 'parsley': case 'coriander': {
        var n = N(11, 4), lt = f === 'parsley' ? 'lobed' : 'palm';
        for (i = 0; i < n; i++) {
          a = i * 2.4; var pitch = 1.0 + C.r() * 0.35, L = H * (0.65 + C.r() * 0.35);
          var d = dirv(a);
          var mid = V(d.x * L * 0.3, L * 0.62, d.z * L * 0.3), end = V(d.x * L * 0.62, L * Math.sin(pitch) * 0.95, d.z * L * 0.62);
          tube(C.root, [V(0, 0, 0), mid, end], 0.004, shade(lc, -0.1), 5, 4);
          var ls = f === 'parsley' ? 0.085 : 0.075, lw = f === 'parsley' ? 1.5 : 1.1;
          [-0.7, 0, 0.7].forEach(function (o) { leaf(C.pg, lt, ls, a + o, 0.35, vary(lc), end, { cup: 0.3, w: lw }); });
          leaf(C.pg, lt, ls * 0.85, a + 1.0, 0.3, vary(lc), mid, { cup: 0.3, w: lw });
          leaf(C.pg, lt, ls * 0.85, a - 1.0, 0.3, vary(lc), lerpV(mid, end, 0.5), { cup: 0.3, w: lw });
        }
        if (C.stage === 'mature') for (i = 0; i < 2; i++) {
          a = i * 2.9 + 0.5; tip = V(Math.cos(a) * 0.08, H * 1.25, Math.sin(a) * 0.08);
          rod(C.root, V(0, 0, 0), tip, 0.005, 0.004, shade(lc, -0.1), 4);
          umbel(C.root, tip, 0.035, fl);
        }
        break;
      }
      case 'dill': {
        var st = N(4, 2);
        for (i = 0; i < st; i++) {
          a = i / st * TAU; base = V(Math.cos(a) * 0.03, 0, Math.sin(a) * 0.03);
          tip = V(Math.cos(a) * 0.1, H * (0.8 + C.r() * 0.2), Math.sin(a) * 0.1);
          rod(C.root, base, tip, 0.008, 0.005, shade(lc, -0.12), 5);
          for (var k = 0; k < N(4, 2); k++) {
            var at = lerpV(base, tip, 0.2 + k * 0.2);
            for (var b = 0; b < 7; b++) leaf(C.pg, 'blade', 0.13 - k * 0.015, b / 7 * TAU + k, 0.25 + C.r() * 0.5, vary(lc), at, { cup: 0, bend: 0.3, w: 0.7 });
          }
          if (C.stage === 'mature') umbel(C.root, tip, 0.06, fl);
        }
        break;
      }
      case 'rosemary': {
        var rs = N(8, 3), needle = H > 0.8 ? 'lance' : 'needle', nl = H > 0.8 ? 0.07 : 0.045;
        for (i = 0; i < rs; i++) {
          a = i / rs * TAU + C.r(); var lean = 0.1 + C.r() * 0.3, h = H * (0.7 + C.r() * 0.3);
          base = V(Math.cos(a) * 0.03, 0, Math.sin(a) * 0.03);
          tip = base.clone().add(V(Math.cos(a) * Math.sin(lean) * h, Math.cos(lean) * h, Math.sin(a) * Math.sin(lean) * h));
          rod(C.root, base, lerpV(base, tip, 0.4), 0.011, 0.008, '#7a5a3a', 5);
          rod(C.root, lerpV(base, tip, 0.4), tip, 0.008, 0.004, shade(lc, -0.2), 4);
          var nn = N(10, 4);
          for (var k2 = 0; k2 < nn; k2++) {
            var at2 = lerpV(base, tip, 0.3 + k2 / nn * 0.7);
            for (var w = 0; w < 3; w++) leaf(C.pg, needle, nl, w / 3 * TAU + k2 * 0.9, 0.55, vary(lc), at2, { cup: 0.1 });
          }
          if (C.stage === 'mature' && i % 2) for (var fb = 0; fb < 3; fb++) ball(C.root, 0.009, fl, lerpV(base, tip, 0.6 + fb * 0.12).add(V(0.015, 0, 0)), null, 6);
        }
        break;
      }
      case 'thyme': case 'oregano': {
        var R = H * 0.5, mound = N(15, 5);
        blob(C.pg, R * 0.7, vary(lc), V(0, R * 0.35, 0), [1, 0.7, 1]);
        for (i = 0; i < mound; i++) {
          var th = i * 2.4 + C.r() * 0.5, ph = 0.35 + (i / mound) * 1.05, pos = V(Math.cos(th) * Math.sin(ph) * R, Math.cos(ph) * R * 0.7 + 0.02, Math.sin(th) * Math.sin(ph) * R);
          blob(C.pg, (f === 'thyme' ? 0.06 : 0.055) + C.r() * 0.02, vary(lc), pos, [1, 0.75, 1]);
          if (f === 'oregano') for (var q = 0; q < 3; q++) leaf(C.pg, 'round', 0.05, -th + (q - 1) * 0.9, 0.35 + ph * 0.3, vary(shade(lc, 0.06)), pos.clone().multiplyScalar(1.12), { cup: 0.35 });
        }
        if (C.stage === 'mature' || C.stage === 'growing') for (i = 0; i < 11; i++) {
          var t2 = i * 2.4, rr2 = R * (0.2 + (i / 11) * 0.65), pp = V(Math.cos(t2) * rr2, R * 0.78 + 0.04 - (i / 11) * R * 0.25, Math.sin(t2) * rr2);
          ball(C.root, f === 'thyme' ? 0.012 : 0.016, fl, pp, null, 6);
        }
        break;
      }
      case 'chives': {
        var cn = N(16, 6);
        for (i = 0; i < cn; i++) {
          a = i * 2.4; var r0 = 0.015 + C.r() * 0.02, lean2 = 0.05 + C.r() * 0.3, h2 = H * (0.7 + C.r() * 0.3);
          base = V(Math.cos(a) * r0, 0, Math.sin(a) * r0);
          var mid2 = base.clone().add(V(Math.cos(a) * h2 * 0.25 * lean2 * 2, h2 * 0.6, Math.sin(a) * h2 * 0.25 * lean2 * 2));
          tip = mid2.clone().add(V(Math.cos(a) * h2 * 0.3 * lean2 * 2.5, h2 * 0.38, Math.sin(a) * h2 * 0.3 * lean2 * 2.5));
          rod(C.pg, base, mid2, 0.006, 0.005, vary(lc), 5); rod(C.pg, mid2, tip, 0.005, 0.0015, vary(lc), 5);
        }
        if (C.stage === 'mature' || C.stage === 'growing') for (i = 0; i < 3; i++) {
          a = i * 2.1; tip = V(Math.cos(a) * 0.05, H * 1.1, Math.sin(a) * 0.05);
          rod(C.root, V(0, 0, 0), tip, 0.004, 0.003, shade(lc, 0.1), 4);
          ball(C.root, 0.028, fl, tip, null, 8);
        }
        break;
      }
      case 'lavender': {
        var ln = N(28, 8);
        for (i = 0; i < ln; i++) leaf(C.pg, 'blade', 0.12 + C.r() * 0.05, i * 2.4, 0.5 + C.r() * 0.8, vary(lc), V(Math.cos(i) * 0.04, 0.02, Math.sin(i) * 0.04), { cup: 0, bend: 0.1, w: 1.4 });
        if (!C.young) for (i = 0; i < (C.stage === 'mature' ? 14 : C.stage === 'growing' ? 7 : 0); i++) {
          a = i * 2.4; var lean3 = 0.1 + C.r() * 0.45, h3 = H * (0.75 + C.r() * 0.25);
          base = V(Math.cos(a) * 0.03, 0.03, Math.sin(a) * 0.03);
          tip = base.clone().add(V(Math.cos(a) * Math.sin(lean3) * h3, Math.cos(lean3) * h3, Math.sin(a) * Math.sin(lean3) * h3));
          rod(C.root, base, tip, 0.003, 0.0025, shade(lc, -0.1), 4);
          spike(C.root, 0.045, fl, tip, tip.clone().sub(base), 6);
        }
        break;
      }
      case 'grass': {
        rod(C.root, V(0, 0, 0), V(0, 0.18, 0), 0.04, 0.03, mix(lc, '#efe8c0', 0.5), 7);
        var gn = N(16, 6);
        for (i = 0; i < gn; i++) leaf(C.pg, 'blade', H * (0.6 + C.r() * 0.4), i * 2.4, 1.05 + C.r() * 0.35, vary(lc), V(0, 0.1 + C.r() * 0.06, 0), { cup: 0.05, bend: 0.55, w: 1.5 });
        break;
      }
      default:
        pairStems({ stems: 6, H: H * 0.85, nodes: 4, len: 0.11, type: 'oval', cup: 0.45, lc: lc, lean: 0.4 });
    }
  };

  A.leafy = function (p) {
    var lc = p.leafColor || '#7cc35a', inner = p.inner || shade(lc, 0.25), f = p.form || 'loose', i, a, n;
    switch (f) {
      case 'loose': {
        var rings = [[5, 0.11, 1.2, inner], [7, 0.15, 0.85, mix(lc, inner, 0.4)], [8, 0.18, 0.45, lc]];
        if (C.young) rings = rings.slice(0, 2);
        rings.forEach(function (r, ri) {
          for (var k = 0; k < r[0]; k++) leaf(C.pg, 'round', r[1], k / r[0] * TAU + ri * 0.5, r[2] + (C.r() - 0.5) * 0.2, vary(r[3]), V(0, 0.02, 0), { cup: 0.6, bend: 0.12, w: 1.2 });
        });
        break;
      }
      case 'romaine':
        n = N(11, 5);
        for (i = 0; i < n; i++) leaf(C.pg, 'spoon', 0.27 - (i < 4 ? 0.06 : 0), i * 2.4, i < 4 ? 1.42 : 1.2 + C.r() * 0.15, vary(i < 4 ? inner : lc), V(0, 0.01, 0), { cup: 0.65, bend: 0.1, w: 0.9 });
        break;
      case 'spoon':
        n = N(13, 5);
        for (i = 0; i < n; i++) leaf(C.pg, 'spoon', 0.15 + C.r() * 0.03, i * 2.4, 0.35 + (i / n) * 0.6, vary(lc), V(0, 0.01, 0), { cup: 0.35, bend: 0.08, w: 1.1 });
        break;
      case 'curly': {
        rod(C.root, V(0, 0, 0), V(0, 0.16, 0), 0.02, 0.016, shade(lc, 0.15), 6);
        n = N(11, 4);
        for (i = 0; i < n; i++) leaf(C.pg, 'lobed', 0.3 - (i / n) * 0.08, i * 2.4, 0.65 + (i / n) * 0.55, vary(lc), V(0, 0.06 + (i / n) * 0.1, 0), { cup: 0.6, bend: 0.4, w: 1.6 });
        break;
      }
      case 'chard': {
        n = N(9, 4);
        var stems = p.stems || ['#d62e3c'];
        for (i = 0; i < n; i++) {
          a = i * 2.4; var pitch = 1.05 + C.r() * 0.3, d = dirv(a), L = 0.2 + C.r() * 0.05;
          var tip = V(d.x * Math.cos(pitch) * L, Math.sin(pitch) * L, d.z * Math.cos(pitch) * L);
          rod(C.root, V(0, 0, 0), tip, 0.011, 0.008, stems[i % stems.length], 5);
          leaf(C.pg, 'oval', 0.26, a, pitch - 0.1, vary(lc), tip, { cup: 0.55, bend: 0.2, w: 1.35 });
        }
        break;
      }
      case 'head': {
        var hr = C.young ? 0 : 0.12;
        if (hr) ball(C.pg, hr, inner, V(0, hr * 0.95, 0), [1, 0.92, 1], 12);
        n = C.young ? 0 : 6;
        for (i = 0; i < n; i++) leaf(C.pg, 'round', 0.19, i / n * TAU, 1.3, vary(mix(lc, inner, 0.5)), V(Math.cos(i / n * TAU) * 0.07, 0.03, -Math.sin(i / n * TAU) * 0.07), { cup: 1.3, w: 1.25 });
        var outer = N(8, 5);
        for (i = 0; i < outer; i++) leaf(C.root, 'round', C.young ? 0.12 : 0.24, i / outer * TAU + 0.3, C.young ? 0.6 : 0.35, vary(lc), V(0, 0.02, 0), { cup: 0.6, bend: 0.15, w: 1.25 });
        break;
      }
      case 'bokchoy': {
        n = N(9, 5);
        for (i = 0; i < n; i++) {
          a = i * 2.4; var pp = 1.25 + C.r() * 0.2, dd = dirv(a), LL = 0.11;
          var t2 = V(dd.x * Math.cos(pp) * LL, Math.sin(pp) * LL, dd.z * Math.cos(pp) * LL);
          var s = rod(C.pg, V(dd.x * 0.015, 0, dd.z * 0.015), t2, 0.018, 0.012, p.stem || '#eef5df', 6);
          s.scale.x *= 1.4; s.scale.z *= 0.6;
          leaf(C.pg, 'round', 0.16, a, pp - 0.15, vary(lc), t2, { cup: 0.7, w: 1.1 });
        }
        break;
      }
      case 'lobed':
        n = N(13, 5);
        for (i = 0; i < n; i++) leaf(C.pg, 'lobed', 0.16 + C.r() * 0.04, i * 2.4, 0.45 + C.r() * 0.5, vary(lc), V(0, 0.01, 0), { cup: 0.2, bend: 0.08, w: 1.4 });
        break;
      case 'broccoli': {
        n = N(9, 4);
        for (i = 0; i < n; i++) leaf(C.root, 'oval', C.young ? 0.18 : 0.32, i * 2.4, 0.6 + (i / n) * 0.5, vary(lc), V(0, 0.04 + (i / n) * 0.08, 0), { cup: 0.45, bend: 0.35, w: 1.2 });
        if (!C.young && C.stage !== 'harvested') {
          rod(C.root, V(0, 0, 0), V(0, 0.22, 0), 0.03, 0.028, shade(lc, 0.2), 6);
          var white = inner && new THREE.Color(inner).getHSL({}).l > 0.7;
          var fl = white ? 7 : 9, fr = white ? 0.075 : 0.065;
          for (i = 0; i < fl; i++) {
            var ang = i / (fl - 1) * TAU, rr = i === 0 ? 0 : 0.075;
            ball(C.pg, fr * (C.stage === 'growing' ? 0.6 : 1), i % 3 ? inner : shade(inner, 0.08), V(Math.cos(ang) * rr, 0.27 + (i === 0 ? 0.03 : 0), Math.sin(ang) * rr), [1, 0.8, 1], 8);
          }
        }
        break;
      }
      case 'celery': {
        n = N(10, 4);
        for (i = 0; i < n; i++) {
          a = i * 2.4; var lean = 0.12 + C.r() * 0.2, h = 0.3 + C.r() * 0.06;
          var tp = V(Math.cos(a) * Math.sin(lean) * h, Math.cos(lean) * h, Math.sin(a) * Math.sin(lean) * h);
          rod(C.pg, V(Math.cos(a) * 0.02, 0, Math.sin(a) * 0.02), tp, 0.012, 0.009, vary(p.stem || '#b7dc8a'), 6);
          [-0.7, 0, 0.7].forEach(function (o) { leaf(C.pg, 'lobed', 0.07, -a + o, 0.6, vary(lc), tp, { cup: 0.2, w: 1.5 }); });
        }
        break;
      }
    }
  };

  A.root = function (p) {
    var lc = p.leafColor || '#5fae48', rt = p.root || {}, tops = p.tops || 'leafy', i, a, n;
    // when harvested the plant is pulled and lies on the soil
    var plant = new THREE.Group(), saved = C.root, savedPg = C.pg;
    var lift = C.harvested && tops !== 'bush' && tops !== 'vine';
    if (lift) { C.root.add(plant); C.root = plant; C.pg = plant; }
    switch (tops) {
      case 'feathery':
        n = N(8, 3);
        for (i = 0; i < n; i++) {
          a = i * 2.4; var pitch = 1.05 + C.r() * 0.35, L = 0.24 + C.r() * 0.06, d = dirv(a);
          var tip = V(d.x * Math.cos(pitch) * L, Math.sin(pitch) * L, d.z * Math.cos(pitch) * L);
          rod(C.root, V(0, 0, 0), tip, 0.003, 0.002, shade(lc, -0.1), 4);
          for (var k = 0; k < 4; k++) leaf(C.root, 'lobed', 0.07, a + (k - 1.5) * 0.5, pitch - 0.6, vary(lc), lerpV(V(0, 0, 0), tip, 0.55 + k * 0.15), { cup: 0.1, w: 1.2 });
        }
        break;
      case 'leafy':
        n = N(8, 3);
        for (i = 0; i < n; i++) {
          a = i * 2.4; var pt = 0.85 + C.r() * 0.35, LL = 0.08, dd = dirv(a);
          var t2 = V(dd.x * Math.cos(pt) * LL, Math.sin(pt) * LL + 0.02, dd.z * Math.cos(pt) * LL);
          rod(C.root, V(0, 0.02, 0), t2, 0.004, 0.003, p.stem || shade(lc, 0.05), 4);
          leaf(C.root, rt.shape === 'ball' && rt.color === '#d6304a' ? 'lobed' : 'spoon', 0.14, a, pt - 0.25, vary(lc), t2, { cup: 0.35, bend: 0.12, w: rt.shape === 'ball' && rt.color === '#d6304a' ? 1.4 : 1 });
        }
        break;
      case 'tubular':
        n = N(7, 3);
        for (i = 0; i < n; i++) {
          a = i * 2.4; var lean = 0.1 + C.r() * 0.35, h = 0.32 + C.r() * 0.1;
          var mid = V(Math.cos(a) * Math.sin(lean) * h * 0.4, h * 0.55, Math.sin(a) * Math.sin(lean) * h * 0.4);
          var tp = V(Math.cos(a) * Math.sin(lean) * h * 1.1, h, Math.sin(a) * Math.sin(lean) * h * 1.1);
          rod(C.root, V(0, 0.03, 0), mid, 0.007, 0.006, vary(lc), 5); rod(C.root, mid, tp, 0.006, 0.002, vary(lc), 5);
        }
        break;
      case 'flat': {
        var leek = rt.shape === 'stalk', ginger = rt.shape === 'tuber';
        var base0 = leek && !C.young ? 0.17 : 0.02;
        if (leek && !C.young) rod(C.pg, V(0, 0, 0), V(0, base0, 0), 0.024, 0.022, rt.color || '#eef5df', 8);
        if (ginger) {
          for (var g = 0; g < N(3, 1); g++) {
            a = g * 2.2; var gb = V(Math.cos(a) * 0.04, 0, Math.sin(a) * 0.04), gt = gb.clone().add(V(Math.cos(a) * 0.05, 0.42, Math.sin(a) * 0.05));
            rod(C.root, gb, gt, 0.006, 0.004, shade(lc, -0.1), 5);
            for (var gl = 0; gl < N(7, 3); gl++) leaf(C.root, 'lance', 0.13, a + (gl % 2 ? PI / 2 : -PI / 2), 0.4, vary(lc), lerpV(gb, gt, 0.25 + gl * 0.1), { cup: 0.2, bend: 0.15, w: 1.2 });
          }
        } else {
          n = N(leek ? 6 : 7, 3);
          for (i = 0; i < n; i++) leaf(C.root, 'blade', leek ? 0.32 : 0.3, (i % 2 ? PI : 0) + (C.r() - 0.5) * 0.4 + 0.3, 1.05 + i * 0.05, vary(lc), V(0, base0 + i * 0.012, 0), { cup: 0.3, bend: 0.3, w: 2.4 });
        }
        break;
      }
      case 'bush':
        n = N(8, 3);
        for (i = 0; i < n; i++) {
          a = i / n * TAU; var lb = V(Math.cos(a) * 0.03, 0, Math.sin(a) * 0.03);
          var lt = V(Math.cos(a) * 0.22, 0.36 + C.r() * 0.08, Math.sin(a) * 0.22);
          rod(C.root, lb, lt, 0.009, 0.006, shade(lc, -0.1), 5);
          branchLeaves(lerpV(lb, lt, 0.15), lt, 'compound', lc, 0.1);
          if (C.bloom && i % 2 === 0) blossom(C.root, p.flower || '#fbfaf5', 0.02, lt.clone().add(V(0, 0.03, 0)), V(0, 1, 0), '#f2c230');
        }
        if (C.harvested) for (i = 0; i < 4; i++) groundFruit(C.root, 'default', rt.color, 0.04, Math.cos(i * 1.7) * 0.25, Math.sin(i * 1.7) * 0.25, 0);
        break;
      case 'vine': {
        var runners = N(4, 2);
        for (i = 0; i < runners; i++) {
          a = i / runners * TAU + 0.3; var pts = [V(0, 0.03, 0)];
          for (var k2 = 1; k2 <= 4; k2++) pts.push(V(Math.cos(a + k2 * 0.18) * k2 * 0.11, 0.02, Math.sin(a + k2 * 0.18) * k2 * 0.11));
          tube(C.root, pts, 0.006, shade(lc, -0.2), 12, 4);
          pts.forEach(function (pp, j) { if (j) leaf(C.root, 'heart', 0.09, -a + (j % 2 ? 0.8 : -0.8), 0.7, vary(lc), pp.clone().add(V(0, 0.01, 0)), { cup: 0.25, w: 1 }); });
        }
        if (C.harvested) for (i = 0; i < 3; i++) groundFruit(C.root, 'long', rt.color, 0.06, Math.cos(i * 2.1) * 0.22, Math.sin(i * 2.1) * 0.22, i * 2.1);
        break;
      }
    }
    // the root itself: shoulder showing at the soil, or the whole thing once pulled
    if (!C.young && rt.shape) {
      var rc = rt.color || '#f08a24';
      switch (rt.shape) {
        case 'cone': lathe(C.pg, 'carrot', 0.028, rc, V(0, 0.025, 0), 8); break;
        case 'ball': {
          var br = rt.color === '#d6304a' ? 0.03 : 0.05;
          ball(C.pg, br, rc, V(0, br * 0.35, 0), [1, 0.95, 1], 10);
          if (rt.top) { var cap = ball(C.pg, br * 1.02, rt.top, V(0, br * 0.55, 0), [1, 0.62, 1], 10); cap.position.y = br * 0.7; }
          rod(C.pg, V(0, -br * 0.5, 0), V(0, -br * 1.6, 0), br * 0.25, br * 0.05, rc, 5);
          break;
        }
        case 'bulb': lathe(C.pg, 'bulb', tops === 'flat' ? 0.026 : 0.04, rc, V(0, tops === 'flat' ? 0.025 : 0.045, 0), 10); break;
        case 'tuber': if (tops === 'flat') for (var tb = 0; tb < 3; tb++) ball(C.pg, 0.03, rc, V(Math.cos(tb * 2.1) * 0.035, 0.01, Math.sin(tb * 2.1) * 0.035), [1.4, 0.7, 1], 7); break;
      }
    }
    if (lift) {
      C.root = saved; C.pg = savedPg;
      plant.rotation.z = PI / 2 - 0.12;
      plant.position.set(-0.04, 0.035, 0);
    }
  };

  A.vine = function (p) {
    var lc = p.leafColor || '#4f9a3a', fr = p.fruit || {}, fl = p.flower || '#f6d33b', h = p.habit || 'sprawl', i, a, k, n;
    var ripe = C.fruit === 2, fc = function () { return ripe ? fr.color : (fr.unripe || shade(fr.color || '#5f8f3a', 0.25)); };
    var fs = (fr.size || 0.1) * (ripe ? 1 : 0.6), fn = C.fruit ? (ripe ? fr.count || 2 : Math.max(1, Math.round((fr.count || 2) / 2))) : 0;
    switch (h) {
      case 'climb': case 'trellis': case 'pole': {
        var H = h === 'pole' ? 1.6 : h === 'climb' ? 1.4 : 0.9, wood = '#b58a55', vineC = shade(lc, -0.15), path = [];
        if (!C.young) {
          if (h === 'pole') {
            rod(C.root, V(0, -0.05, 0), V(0, H, 0), 0.016, 0.012, wood, 6);
          } else {
            var W = h === 'climb' ? 0.32 : 0.26;
            rod(C.root, V(-W, -0.05, 0), V(-W, H, 0), 0.014, 0.012, wood, 6);
            rod(C.root, V(W, -0.05, 0), V(W, H, 0), 0.014, 0.012, wood, 6);
            for (k = 1; k <= 4; k++) rod(C.root, V(-W, H * k / 4.3, 0), V(W, H * k / 4.3, 0), 0.0025, 0.0025, '#efe4c8', 3);
            for (k = -1; k <= 1; k++) rod(C.root, V(W * k * 0.6, 0.02, 0), V(W * k * 0.6, H * 0.95, 0), 0.0025, 0.0025, '#efe4c8', 3);
          }
        }
        var vh = C.young ? 0.22 : H * 0.95, turns = h === 'pole' ? 3 : 0;
        for (k = 0; k <= 14; k++) {
          var t = k / 14;
          if (h === 'pole') path.push(V(Math.cos(t * TAU * turns) * 0.03, t * vh + 0.01, Math.sin(t * TAU * turns) * 0.03));
          else path.push(V(Math.sin(t * 9) * 0.16 * (C.young ? 0.2 : 1), t * vh + 0.01, Math.cos(t * 7) * 0.02));
        }
        tube(C.root, path, 0.007, vineC, 28, 4);
        var nodes = N(h === 'trellis' ? 14 : 12, 3);
        var curve = new THREE.CatmullRomCurve3(path), spots = [];
        for (k = 0; k < nodes; k++) {
          var tt = (k + 0.7) / (nodes + 0.4), at = curve.getPoint(tt), side = k % 2 ? 1 : -1;
          var yaw = (h === 'pole' ? k * 2.1 : PI / 2 * side) + (C.r() - 0.5) * 0.6;
          if (h === 'pole') {
            [-0.6, 0, 0.6].forEach(function (o) { leaf(C.root, 'heart', 0.11, yaw + o, 0.1, vary(lc), at, { cup: 0.25, bend: 0.12 }); });
          } else {
            leaf(C.root, h === 'trellis' ? 'round' : 'palm', h === 'trellis' ? 0.085 : 0.21, yaw, 0.25, vary(lc), at, { cup: 0.3, bend: 0.15, w: h === 'trellis' ? 1 : 1.05 });
            if (h === 'trellis') leaf(C.root, 'round', 0.075, yaw + PI, 0.3, vary(lc), at, { cup: 0.3 });
          }
          spots.push({ at: at, yaw: yaw });
        }
        if (!C.young) {
          var nf = Math.round(5 * C.bloom);
          for (k = 0; k < nf; k++) { var s0 = spots[(k * 3 + 2) % spots.length]; blossom(C.root, fl, h === 'climb' ? 0.028 : 0.02, s0.at.clone().add(dirv(s0.yaw + PI).multiplyScalar(0.03)), dirv(s0.yaw + PI).add(V(0, 0.3, 0))); }
          for (k = 0; k < fn; k++) {
            var s1 = spots[(k * 2 + 1) % spots.length], anchor = s1.at.clone().add(dirv(s1.yaw + PI).multiplyScalar(0.025));
            var fo = fruit(C.pg, fr.shape || 'long', fc(), fs, anchor);
            fo.rotation.set((C.r() - 0.5) * 0.5, C.r() * TAU, (C.r() - 0.5) * 0.4);
          }
        }
        break;
      }
      case 'bush': {
        n = N(8, 3);
        for (i = 0; i < n; i++) {
          a = i * 2.4; var d = dirv(a), L = 0.22 + C.r() * 0.08, tip = V(d.x * L, 0.24 + C.r() * 0.1, d.z * L);
          rod(C.root, V(0, 0.03, 0), tip, 0.009, 0.007, shade(lc, 0.1), 5);
          leaf(C.root, 'palm', C.young ? 0.17 : 0.3, a, 0.15, vary(lc), tip, { cup: 0.35, bend: 0.25, w: 1.05 });
        }
        if (!C.young) {
          for (i = 0; i < Math.round(3 * C.bloom); i++) { var tr = lathe(C.root, 'trumpet', 0.045, fl, V(Math.cos(i * 2.1) * 0.06, 0.13, Math.sin(i * 2.1) * 0.06), 6, 0, true); tr.rotation.set(0.5, i * 2.1, 0); }
          for (i = 0; i < fn; i++) groundFruit(C.pg, fr.shape || 'long', fc(), fs, Math.cos(i * 2.3 + 0.4) * 0.08, Math.sin(i * 2.3 + 0.4) * 0.08, -(i * 2.3 + 0.4));
        }
        break;
      }
      default: {                                       // sprawl along the ground
        var runners = N(3, 2), leaves = [];
        rod(C.root, V(0, 0, 0), V(0, 0.06, 0), 0.016, 0.012, shade(lc, -0.1), 6);
        for (i = 0; i < runners; i++) {
          a = i / runners * TAU + 0.4; var pts = [V(0, 0.04, 0)], len = C.young ? 2 : 6;
          for (k = 1; k <= len; k++) pts.push(V(Math.cos(a + Math.sin(k) * 0.25) * k * 0.1, 0.025, Math.sin(a + Math.sin(k) * 0.25) * k * 0.1));
          tube(C.root, pts, 0.008, shade(lc, -0.15), len * 5, 4);
          pts.forEach(function (pp, j) {
            if (!j) return;
            leaf(C.root, 'palm', C.young ? 0.12 : 0.16, -a + (j % 2 ? 1.3 : -1.3), 0.75 + C.r() * 0.3, vary(lc), pp.clone().add(V(0, 0.01, 0)), { cup: 0.3, bend: 0.15 });
            leaves.push({ p: pp, a: a });
          });
          leaf(C.root, 'palm', 0.13, a, 0.9, vary(lc), V(0, 0.06, 0), { cup: 0.3 });
        }
        if (!C.young) {
          for (i = 0; i < Math.round(3 * C.bloom); i++) { var lf = leaves[(i * 4 + 2) % leaves.length]; var tr2 = lathe(C.root, 'trumpet', 0.04, fl, lf.p.clone().add(V(0.03, 0.06, 0)), 6, 0, true); tr2.rotation.set(0.4, i, 0); }
          for (i = 0; i < fn; i++) {
            var lf2 = leaves[Math.min(leaves.length - 1, 3 + i * 5)] || leaves[0];
            var off = dirv(-lf2.a + PI / 2).multiplyScalar(fs * 1.1);
            groundFruit(C.pg, fr.shape || 'round', fc(), fs, lf2.p.x + off.x, lf2.p.z + off.z, -lf2.a, { stripe: fr.stripe });
          }
        }
      }
    }
  };

  A.stalk = function (p) {
    var lc = p.leafColor || '#5fae48', i, a;
    if (p.form === 'grain') {
      var ripe = C.stage === 'mature' || C.harvested || C.dried, gc = ripe ? (p.ripe || '#e1c25f') : lc;
      var stalks = N(16, 6);
      for (i = 0; i < N(10, 6); i++) leaf(C.root, 'blade', 0.25, i * 2.4, 0.7 + C.r() * 0.6, vary(mix(lc, gc, ripe ? 0.5 : 0)), V(0, 0.02, 0), { cup: 0.1, bend: 0.4, w: 1.3 });
      if (C.young) return;
      for (i = 0; i < stalks; i++) {
        a = C.r() * TAU; var r0 = Math.sqrt(C.r()) * 0.08, base = V(Math.cos(a) * r0, 0, Math.sin(a) * r0);
        var lean = (C.r() - 0.3) * 0.25, h = 0.75 + C.r() * 0.15;
        var tip = base.clone().add(V(Math.cos(a) * Math.sin(lean) * h, h, Math.sin(a) * Math.sin(lean) * h));
        rod(C.root, base, tip, 0.0035, 0.003, vary(gc), 4);
        if (!C.harvested && C.stage !== 'seedling') spike(C.pg, C.stage === 'growing' ? 0.04 : 0.05, vary(gc), tip, tip.clone().sub(base).add(V(0.15, 0, 0)), 7);
      }
      return;
    }
    // corn
    var H = C.young ? 0.5 : 1.85;
    rod(C.root, V(0, 0, 0), V(0, H, 0), 0.026, 0.018, shade(lc, -0.05), 6);
    var nl = N(9, 4);
    for (i = 0; i < nl; i++) {
      var t = (i + 0.5) / nl;
      leaf(C.root, 'blade', (C.young ? 0.3 : 0.72) * (1.1 - t * 0.4), (i % 2 ? PI : 0) + (C.r() - 0.5) * 0.7, 0.55 + t * 0.35, vary(lc), V(0, H * t * 0.9, 0), { cup: 0.25, bend: 0.5, w: 2.6 });
    }
    if (C.young) return;
    if (C.stage !== 'harvested') for (i = 0; i < 6; i++) rod(C.root, V(0, H, 0), V(Math.cos(i) * 0.08, H + 0.18, Math.sin(i) * 0.08), 0.004, 0.002, mix('#d8c27a', '#a8865a', C.stage === 'mature' ? 0.3 : 0), 3);
    if (C.fruit) for (i = 0; i < (C.fruit === 2 ? 2 : 1); i++) {
      var y = H * (0.42 + i * 0.12), side = i ? PI * 0.9 : 0.5;
      var ear = new THREE.Group(); ear.position.set(0, y, 0); ear.rotation.set(0, side, -0.6);
      var s = C.fruit === 2 ? 0.15 : 0.1;
      var husk = lathe(ear, 'long', s, '#cfdc8e', V(0.03, 0, 0), 8); husk.rotation.x = PI;
      husk.scale.set(s * 1.1, s, s * 1.1);
      coneM(ear, 0.018, 0.06, '#a8743a', V(0.03, 2 * s, 0), 5);
      C.pg.add(ear);
    }
  };

  A.flower = function (p) {
    var lc = p.leafColor || '#4f9a3a', H = p.height || 0.5, cols = p.colors || ['#f5c52b'], i, a;
    var pick = function (k) { return cols[k % cols.length]; };
    var open = C.stage === 'mature', bud = C.stage === 'growing';
    switch (p.form) {
      case 'sunflower': {
        var h = C.young ? 0.35 : H;
        var top = V(0.03, h, 0);
        tube(C.root, [V(0, 0, 0), V(0.01, h * 0.5, 0), top], C.young ? 0.012 : 0.022, shade(lc, 0.1), 8, 6);
        var nl = N(8, 3);
        for (i = 0; i < nl; i++) {
          var t = (i + 0.5) / nl, at = V(0.01 + t * 0.02, h * t * 0.85, 0), yaw = i * 2.4;
          var tip = at.clone().add(dirv(yaw).multiplyScalar(0.07)).add(V(0, 0.02, 0));
          rod(C.root, at, tip, 0.006, 0.005, shade(lc, 0.1), 4);
          leaf(C.root, 'heart', 0.3 * (1.1 - t * 0.5), yaw, 0.15, vary(lc), tip, { cup: 0.3, bend: 0.25 });
        }
        if (C.young || C.harvested) return;
        var head = new THREE.Group(); head.position.copy(top); head.rotation.set(0, 0, -0.5 - (C.dried ? 0.9 : 0));
        if (open || C.dried) {
          var disc = put(head, cached('disc', function () { var g = new THREE.CylinderGeometry(1, 0.85, 0.3, 18); g.rotateZ(-PI / 2); return g; }), C.dried ? '#4a3420' : '#6b4423');
          disc.scale.setScalar(0.15);
          for (i = 0; i < 18; i++) {
            var pa = i / 18 * TAU, pl = leaf(head, 'lance', 0.15, 0, 0, pick(i), V(0.015, Math.cos(pa) * 0.125, Math.sin(pa) * 0.125), { cup: 0.15, bend: C.dried ? 0.4 : 0.05, w: 2.2 });
            pl.rotation.order = 'XYZ'; pl.rotation.set(pa, 0, PI / 2 - 0.12);
          }
          var back = put(head, cached('disc'), shade(lc, -0.1)); back.scale.setScalar(0.135); back.position.x = -0.04;
        } else ball(head, 0.06, lc, V(0.02, 0, 0), [0.8, 1, 1], 10);
        C.pg.add(head);
        break;
      }
      case 'rose': {
        var canes = N(5, 2), tips = [];
        for (i = 0; i < canes; i++) {
          a = i / canes * TAU + C.r(); var lean = 0.15 + C.r() * 0.35, h2 = H * (0.75 + C.r() * 0.25);
          var b0 = V(Math.cos(a) * 0.03, 0, Math.sin(a) * 0.03), tp = b0.clone().add(V(Math.cos(a) * Math.sin(lean) * h2, Math.cos(lean) * h2, Math.sin(a) * Math.sin(lean) * h2));
          rod(C.root, b0, tp, 0.008, 0.005, '#5d7a35', 5);
          for (var k = 0; k < N(4, 2); k++) {
            var at2 = lerpV(b0, tp, 0.3 + k * 0.17), yw = k * 2.3 + a;
            var lt = at2.clone().add(dirv(yw).multiplyScalar(0.06)).add(V(0, 0.01, 0));
            rod(C.root, at2, lt, 0.003, 0.003, '#5d7a35', 3);
            branchLeaves(at2, lt, 'compound', lc, 0.065);
          }
          tips.push(tp);
        }
        if (C.young || C.harvested) return;
        tips.forEach(function (tp2, k) {
          if (!open && !bud && !C.dried) return;
          var g = new THREE.Group(); g.position.copy(tp2);
          var c = pick(k);
          if (open || C.dried) {
            [0.05, 0.038, 0.026].forEach(function (r, j) { var cup = lathe(g, 'rose', r, shade(c, -j * 0.06), V(0, j * 0.008, 0), 5, 0, true); cup.rotation.y = j * 0.7; });
          } else { var bd = lathe(g, 'olive', 0.022, c, V(0, 0.04, 0), 6); bd.rotation.x = PI; leaf(g, 'coty', 0.025, 0, 0.6, lc, V(0, 0, 0)); }
          C.pg.add(g);
        });
        break;
      }
      case 'trailing': {
        var nl2 = N(15, 5), ls = [];
        for (i = 0; i < nl2; i++) {
          a = i * 2.4; var r = 0.05 + (i / nl2) * 0.22, hh = 0.06 + C.r() * H * 0.6;
          var lp = V(Math.cos(a) * r, hh, Math.sin(a) * r);
          rod(C.root, V(Math.cos(a) * r * 0.3, 0, Math.sin(a) * r * 0.3), lp, 0.003, 0.003, shade(lc, 0.1), 3);
          var lf = leaf(C.root, 'round', 0.08, a, 0.1 + C.r() * 0.3, vary(lc), lp.clone().add(dirv(a).multiplyScalar(-0.035)), { cup: 0.15, w: 1.2 });
          ls.push(lp);
        }
        if (!C.young && (open || bud)) for (i = 0; i < (open ? 6 : 3); i++) { var at3 = ls[(i * 3 + 1) % ls.length]; blossom(C.pg, pick(i), open ? 0.035 : 0.02, at3.clone().add(V(0, 0.035, 0)), dirv(i * 2.4).add(V(0, 1.2, 0)), '#f5c52b'); }
        break;
      }
      case 'bulb': {
        for (i = 0; i < 3; i++) leaf(C.root, 'lance', C.young ? 0.15 : 0.26, i * 2.1, 1.15, vary(lc), V(0, 0.01, 0), { cup: 0.5, bend: 0.2, w: 1.9 });
        if (C.young) return;
        for (i = 0; i < 2; i++) {
          a = i * 2.6 + 0.4; var st = V(Math.cos(a) * 0.04, H * (0.9 + i * 0.1), Math.sin(a) * 0.04);
          rod(C.root, V(0, 0, 0), st, 0.005, 0.005, shade(lc, 0.1), 4);
          if (C.harvested) continue;
          var tc = open || C.dried ? pick(i) : lc;
          var cupM = lathe(C.pg, 'cup', open ? 0.045 : 0.035, tc, st.clone().add(V(0, open ? 0.055 : 0.045, 0)), 6, 0, true);
          if (!open && !C.dried) cupM.scale.x = cupM.scale.z = 0.028;
        }
        break;
      }
      default: {                                       // a bushy mound with flower heads (marigold, zinnia, geranium)
        var lt2 = H < 0.42 ? 'round' : (cols[0] === '#f08a24' ? 'lobed' : 'oval'), nleaf = N(24, 7);
        for (i = 0; i < nleaf; i++) leaf(C.root, lt2, 0.13, i * 2.4, 0.2 + (i / nleaf) * 0.9, vary(lc), V(0, 0.02 + (i / nleaf) * H * 0.45, 0), { cup: 0.35, bend: 0.1, w: lt2 === 'lobed' ? 1.5 : 1 });
        if (C.young) return;
        var heads = open ? 7 : bud ? 4 : C.dried ? 5 : 0;
        for (i = 0; i < heads; i++) {
          a = i * 2.4; var r2 = i ? 0.06 + C.r() * 0.08 : 0, top2 = V(Math.cos(a) * r2, H * (0.85 + C.r() * 0.2), Math.sin(a) * r2);
          rod(C.root, V(Math.cos(a) * r2 * 0.3, 0.05, Math.sin(a) * r2 * 0.3), top2, 0.004, 0.003, shade(lc, 0.1), 4);
          var hc = pick(i), hg = new THREE.Group(); hg.position.copy(top2);
          if (!open && !C.dried) ball(hg, 0.018, lc, V(0, 0.01, 0), [1, 1.3, 1], 6);
          else if (H < 0.42 && cols[0] === '#e23d5a') { for (var gq = 0; gq < 7; gq++) ball(hg, 0.016, shade(hc, (gq % 3) * 0.06), V(Math.cos(gq) * 0.022, 0.02 + (gq % 2) * 0.01, Math.sin(gq) * 0.022), null, 6); }
          else {
            for (var pr = 0; pr < 10; pr++) leaf(hg, 'petal', 0.04, pr / 10 * TAU, 0.25, hc, V(0, 0, 0), { cup: 0.25 });
            for (var pr2 = 0; pr2 < 7; pr2++) leaf(hg, 'petal', 0.028, pr2 / 7 * TAU + 0.3, 0.6, shade(hc, 0.08), V(0, 0.008, 0), { cup: 0.3 });
            ball(hg, 0.012, cols[0] === '#f5c52b' ? '#e09a1a' : '#f5c52b', V(0, 0.012, 0), null, 6);
          }
          hg.rotation.set((C.r() - 0.5) * 0.4, 0, (C.r() - 0.5) * 0.4);
          C.pg.add(hg);
        }
      }
    }
  };

  A.berry = function (p) {
    var lc = p.leafColor || '#4f9a3a', fr = p.fruit || {}, fc = fr.color || '#c62a4a', i, a, k;
    var ripe = C.fruit === 2;
    switch (p.form) {
      case 'strawberry': {
        var n2 = N(8, 3);
        for (i = 0; i < n2; i++) {
          a = i * 2.4; var pitch = 0.95 + C.r() * 0.3, L = 0.13, d = dirv(a);
          var tip = V(d.x * Math.cos(pitch) * L, Math.sin(pitch) * L, d.z * Math.cos(pitch) * L);
          rod(C.root, V(0, 0, 0), tip, 0.003, 0.003, shade(lc, 0.1), 4);
          [-0.75, 0, 0.75].forEach(function (o) { leaf(C.root, 'serrated', 0.06, a + o, 0.15, vary(lc), tip, { cup: 0.3, w: 1.6 }); });
        }
        if (C.young) return;
        for (i = 0; i < Math.round(4 * C.bloom); i++) blossom(C.root, p.flower || '#fbfaf5', 0.018, V(Math.cos(i * 1.9) * 0.1, 0.09, Math.sin(i * 1.9) * 0.1), V(Math.cos(i * 1.9), 1, Math.sin(i * 1.9)), '#f2c230');
        var nb = C.fruit ? (ripe ? 6 : 3) : 0;
        for (i = 0; i < nb; i++) {
          a = i * 2.4 + 0.6; var end = V(Math.cos(a) * 0.17, 0.035, Math.sin(a) * 0.17);
          tube(C.pg, [V(0, 0.05, 0), V(Math.cos(a) * 0.1, 0.09, Math.sin(a) * 0.1), end.clone().add(V(0, 0.03, 0))], 0.0025, shade(lc, 0.1), 6, 3);
          var bf = fruit(C.pg, 'strawberry', ripe && i % 4 !== 3 ? fc : (fr.unripe || '#dfe7a8'), ripe ? 0.022 : 0.015, end.clone().add(V(0, 0.03, 0)));
          bf.rotation.z = (C.r() - 0.5) * 0.6;
        }
        break;
      }
      case 'blueberry': case 'raspberry': {
        var rasp = p.form === 'raspberry', stems = N(rasp ? 5 : 6, 2), H = rasp ? 1.0 : 0.85, tips = [];
        for (i = 0; i < stems; i++) {
          a = i / stems * TAU + C.r(); var lean = rasp ? 0.3 + C.r() * 0.3 : 0.15 + C.r() * 0.3, h = H * (0.7 + C.r() * 0.3);
          var b0 = V(Math.cos(a) * 0.03, 0, Math.sin(a) * 0.03);
          var mid = b0.clone().add(V(Math.cos(a) * Math.sin(lean) * h * 0.4, h * 0.6, Math.sin(a) * Math.sin(lean) * h * 0.4));
          var tp = b0.clone().add(V(Math.cos(a) * Math.sin(lean) * h * (rasp ? 1.2 : 0.9), h * (rasp ? 0.85 : 1), Math.sin(a) * Math.sin(lean) * h * (rasp ? 1.2 : 0.9)));
          tube(C.root, [b0, mid, tp], rasp ? 0.007 : 0.009, rasp ? '#8a6a4a' : '#8a4a3a', 8, 5);
          var curve = new THREE.CatmullRomCurve3([b0, mid, tp]);
          for (k = 0; k < N(rasp ? 4 : 7, 2); k++) {
            var t = 0.35 + k * (rasp ? 0.16 : 0.09), at = curve.getPoint(Math.min(1, t)), yw = k * 2.2 + a;
            if (rasp) { var lt = at.clone().add(dirv(yw).multiplyScalar(0.06)).add(V(0, 0.02, 0)); rod(C.root, at, lt, 0.003, 0.003, '#6a8a4a', 3); branchLeaves(at, lt, 'compound', lc, 0.085); }
            else { leaf(C.root, 'oval', 0.075, yw, 0.4, vary(lc), at, { cup: 0.3 }); leaf(C.root, 'oval', 0.07, yw + PI, 0.4, vary(lc), at, { cup: 0.3 }); }
            tips.push({ at: at, yaw: yw });
          }
        }
        if (C.young || !C.fruit) { if (!C.young && C.bloom) for (i = 0; i < 6; i++) ball(C.root, 0.008, '#fbfaf5', tips[(i * 3) % tips.length].at.clone().add(V(0, -0.02, 0)), null, 6); return; }
        for (i = 0; i < (ripe ? 7 : 4); i++) {
          var s = tips[(i * 3 + 1) % tips.length], at2 = s.at.clone().add(dirv(s.yaw + PI / 2).multiplyScalar(0.025)).add(V(0, -0.025, 0));
          var per = rasp ? 1 : 4;
          for (k = 0; k < per; k++) {
            var bc = ripe ? (k === per - 1 && !rasp ? (fr.unripe || '#a8c870') : fc) : (fr.unripe || (rasp ? '#e8e0a0' : '#a8c870'));
            ball(C.pg, rasp ? 0.015 : 0.011, bc, at2.clone().add(V(Math.cos(k * 2.1) * 0.014, -k * 0.006, Math.sin(k * 2.1) * 0.014)), rasp ? [1, 1.2, 1] : null, rasp ? 6 : 8);
          }
        }
        break;
      }
      case 'grape': {
        var H2 = 1.35, W = 0.45, wood = '#8a6a4a';
        if (!C.young) {
          rod(C.root, V(-W, -0.05, 0), V(-W, H2, 0), 0.016, 0.014, '#b58a55', 6);
          rod(C.root, V(W, -0.05, 0), V(W, H2, 0), 0.016, 0.014, '#b58a55', 6);
          rod(C.root, V(-W, H2 * 0.88, 0), V(W, H2 * 0.88, 0), 0.003, 0.003, '#9a9a9a', 3);
        }
        var th = C.young ? 0.3 : H2 * 0.88;
        tube(C.root, [V(0, 0, 0), V(0.03, th * 0.4, 0.02), V(-0.02, th * 0.75, -0.01), V(0, th, 0)], 0.02, wood, 10, 6);
        var cordon = [];
        if (C.young) cordon = [V(0, th, 0)];
        else [-1, 1].forEach(function (sd) { tube(C.root, [V(0, th, 0), V(sd * W * 0.5, th + 0.02, 0.01), V(sd * W * 0.95, th, 0)], 0.012, wood, 8, 5); for (var q = 1; q <= 4; q++) cordon.push(V(sd * W * q / 4.3, th + 0.01, 0)); });
        cordon.forEach(function (cp, q) {
          leaf(C.root, 'palm', C.young ? 0.08 : 0.15, PI / 2 + (q % 2 ? 0.4 : -0.4), 0.5 + C.r() * 0.4, vary(lc), cp.clone().add(V(0, 0.02, 0)), { cup: 0.3, bend: 0.15 });
          leaf(C.root, 'palm', C.young ? 0.07 : 0.13, -PI / 2 + (q % 2 ? -0.3 : 0.3), 0.6, vary(lc), cp.clone().add(V(0, 0.03, 0)), { cup: 0.3, bend: 0.15 });
        });
        if (C.young || !C.fruit) return;
        for (i = 0; i < (ripe ? 4 : 2); i++) {
          var cp2 = cordon[(i * 2 + 1) % cordon.length], top = cp2.clone().add(V(0, -0.02, (i % 2 ? 0.05 : -0.05)));
          rod(C.pg, cp2, top, 0.003, 0.003, '#7a8a4a', 3);
          var gcol = ripe ? fc : (fr.unripe || '#a8c870'), rows = [4, 4, 3, 2, 1], y = top.y - 0.012;
          rows.forEach(function (cnt, ri) {
            for (var b = 0; b < cnt; b++) { var ang = b / cnt * TAU + ri; ball(C.pg, 0.014, gcol, V(top.x + Math.cos(ang) * cnt * 0.006, y, top.z + Math.sin(ang) * cnt * 0.006), [1, 1.1, 1], 7); }
            y -= 0.022;
          });
        }
        break;
      }
    }
  };

  A.tree = function (p) {
    var lc = p.leafColor || '#4f9a3a', fr = p.fruit || {}, cn = p.canopy || 'round', i, a, k;
    var ripe = C.fruit === 2, bark = cn === 'olive' || cn === 'fig' ? '#8a8578' : '#7a5a3a';
    if (C.young && cn !== 'palm' && cn !== 'banana') {     // a sapling
      rod(C.root, V(0, 0, 0), V(0.01, 0.55, 0), 0.012, 0.007, bark, 5);
      for (i = 0; i < 6; i++) leaf(C.root, cn === 'olive' ? 'lance' : cn === 'fig' ? 'palm' : 'oval', 0.09, i * 2.4, 0.4, vary(lc), V(0.01, 0.3 + i * 0.05, 0), { cup: 0.3 });
      return;
    }
    var spots = [];
    var placeFruit = function (centre, R, count, shape, size, colour) {
      for (var q = 0; q < count; q++) {
        var th = q * 2.4 + C.r() * 0.6, ph = 1.0 + C.r() * 1.0;
        var pos = centre.clone().add(V(Math.cos(th) * Math.sin(ph) * R, Math.cos(ph) * R * 0.8, Math.sin(th) * Math.sin(ph) * R));
        var f = fruit(C.pg, shape, colour(), size, pos);
        f.rotation.y = C.r() * TAU;
      }
    };
    var colourFn = function () { return ripe ? (C.r() < 0.85 ? fr.color : (fr.unripe || '#8cc152')) : (fr.unripe || '#8cc152'); };
    var fsize = (fr.size || 0.08) * (ripe ? 1 : 0.65), fcount = C.fruit ? (ripe ? fr.count || 6 : Math.ceil((fr.count || 6) / 2)) : 0;
    switch (cn) {
      case 'palm': {
        var H = C.young ? 0.15 : 2.3, top = V(0.08, H, 0);
        if (!C.young) {
          tube(C.root, [V(0, 0, 0), V(0.04, H * 0.5, 0), top], 0.11, '#9a7a52', 10, 7);
          for (k = 1; k < 9; k++) { var rp = V(0.08 * Math.pow(k / 9, 1.4), H * k / 9 - 0.03, 0); var ring = put(C.root, cached('ring', function () { return new THREE.CylinderGeometry(1, 1.15, 1, 8); }), '#866844'); ring.position.copy(rp); ring.scale.set(0.12, 0.06, 0.12); }
        }
        var fronds = N(12, 4);
        for (i = 0; i < fronds; i++) {
          a = i / fronds * TAU + (i % 2) * 0.2; var up = i % 3 === 0 ? 0.9 : 0.35, L = C.young ? 0.35 : 1.15;
          var d = dirv(a), mid = top.clone().add(d.clone().multiplyScalar(L * 0.5)).add(V(0, L * up * 0.6, 0));
          var end = top.clone().add(d.clone().multiplyScalar(L)).add(V(0, L * (up - 0.55), 0));
          var curve = new THREE.CatmullRomCurve3([top, mid, end]);
          tube(C.root, curve, 0.012, shade(lc, -0.1), 6, 3);
          for (k = 1; k < 9; k++) {
            var at = curve.getPoint(k / 9), tg = curve.getTangent(k / 9);
            var yaw = Math.atan2(-tg.z, tg.x), pitch = Math.asin(Math.max(-1, Math.min(1, tg.y)));
            leaf(C.root, 'blade', (C.young ? 0.12 : 0.28) * (1 - k / 14), yaw + 1.1, pitch - 0.25, vary(lc), at, { cup: 0, w: 2 });
            leaf(C.root, 'blade', (C.young ? 0.12 : 0.28) * (1 - k / 14), yaw - 1.1, pitch - 0.25, vary(lc), at, { cup: 0, w: 2 });
          }
        }
        if (!C.young && fcount) for (i = 0; i < 3; i++) {
          a = i * 2.1 + 0.5; var ca = top.clone().add(V(Math.cos(a) * 0.12, -0.05, Math.sin(a) * 0.12));
          var cb = ca.clone().add(V(Math.cos(a) * 0.15, -0.35, Math.sin(a) * 0.15));
          rod(C.pg, ca, cb, 0.01, 0.008, '#c98a3a', 4);
          for (k = 0; k < 16; k++) ball(C.pg, 0.022, ripe ? (k % 5 ? fr.color : '#e0a040') : '#c8b048', lerpV(ca, cb, 0.3 + (k % 8) * 0.09).add(V(Math.cos(k * 1.7) * 0.05, 0, Math.sin(k * 1.7) * 0.05)), [0.8, 1.3, 0.8], 6);
        }
        return;
      }
      case 'banana': {
        var BH = C.young ? 0.3 : 1.35, bt = V(0, BH, 0);
        rod(C.root, V(0, 0, 0), bt, C.young ? 0.03 : 0.085, C.young ? 0.025 : 0.07, '#8a9a4a', 8);
        var nl = N(7, 3);
        for (i = 0; i < nl; i++) {
          a = i * 2.4; var pt = V(0, BH * (0.85 + (i / nl) * 0.15), 0), pd = dirv(a);
          var pet = pt.clone().add(pd.clone().multiplyScalar(0.15)).add(V(0, 0.25, 0));
          rod(C.root, pt, pet, 0.015, 0.01, '#7a9a4a', 4);
          leaf(C.root, 'oval', C.young ? 0.4 : 1.0, a, 0.55 + C.r() * 0.3, vary(lc), pet, { cup: 0.15, bend: 0.45, w: 1.3 });
        }
        if (!C.young && fcount) {
          var stalkEnd = bt.clone().add(V(0.25, -0.15, 0));
          tube(C.pg, [bt, V(0.2, BH + 0.05, 0), stalkEnd, V(0.28, BH - 0.55, 0)], 0.018, '#7a8a3a', 8, 5);
          for (var tier = 0; tier < 4; tier++) {
            var ty = BH - 0.18 - tier * 0.09, tc = V(0.27, ty, 0);
            for (k = 0; k < 6; k++) {
              var fa = k / 6 * PI * 1.2 - 0.6 + PI / 2, fp = tc.clone().add(V(Math.cos(fa) * 0.04, 0, Math.sin(fa) * 0.04));
              var fing = lathe(C.pg, 'chili', 0.07, ripe ? fr.color : '#8cb84a', fp, 6, 0.18);
              fing.rotation.order = 'YXZ'; fing.rotation.set(PI - 0.6, -PI / 2 - fa, 0);
            }
          }
          var bell = lathe(C.pg, 'fig', 0.06, '#6b2a4a', V(0.28, BH - 0.55, 0), 8); bell.rotation.x = 0;
        }
        return;
      }
    }
    // a trunk with a canopy of blobs (round, olive, fig)
    var TH = cn === 'olive' ? 0.9 : 1.0, scale = C.stage === 'growing' ? 0.75 : 1;
    var trunkTop = V(0.05, TH, 0);
    if (cn === 'olive') tube(C.root, [V(0, 0, 0), V(0.08, TH * 0.35, 0.03), V(-0.03, TH * 0.7, -0.04), trunkTop], 0.075, bark, 10, 7);
    else if (cn === 'fig') [0, 2.1, 4.2].forEach(function (aa) { rod(C.root, V(Math.cos(aa) * 0.04, 0, Math.sin(aa) * 0.04), V(Math.cos(aa) * 0.25, TH * 1.05, Math.sin(aa) * 0.25), 0.04, 0.025, bark, 6); });
    else rod(C.root, V(0, 0, 0), trunkTop, 0.075, 0.05, bark, 7);
    var centre = V(0.05, TH + 0.6 * scale, 0), R = 0.6 * scale;
    if (cn !== 'fig') for (i = 0; i < 3; i++) rod(C.root, trunkTop, trunkTop.clone().add(V(Math.cos(i * 2.1) * 0.3, 0.35, Math.sin(i * 2.1) * 0.3).multiplyScalar(scale)), 0.035, 0.02, bark, 5);
    var blobs = cn === 'olive' ? 8 : 7;
    for (i = 0; i < blobs; i++) {
      var th = i / blobs * TAU, rr = i === 0 ? 0 : R * 0.55, yy = i === 0 ? R * 0.25 : (i % 2 ? 0.1 : -0.12) * R;
      blob(C.root, R * (i === 0 ? 0.75 : 0.55 + C.r() * 0.12), vary(lc), centre.clone().add(V(Math.cos(th) * rr, yy, Math.sin(th) * rr)), cn === 'olive' ? [1.1, 0.7, 1.1] : null);
    }
    if (cn === 'fig') for (i = 0; i < 16; i++) {
      var t2 = i * 2.4, ph2 = 0.6 + C.r() * 1.3, dir = V(Math.cos(t2) * Math.sin(ph2), Math.cos(ph2) * 0.8, Math.sin(t2) * Math.sin(ph2));
      leaf(C.root, 'palm', 0.22, -t2, 0.3, vary(lc), centre.clone().add(dir.multiplyScalar(R * 0.92)), { cup: 0.2, bend: 0.1 });
    }
    if (C.bloom && p.flower && !C.dried) for (i = 0; i < 14; i++) {
      var t3 = i * 2.4, ph3 = 0.4 + C.r() * 1.4;
      ball(C.root, 0.03, p.flower, centre.clone().add(V(Math.cos(t3) * Math.sin(ph3), Math.cos(ph3) * 0.8, Math.sin(t3) * Math.sin(ph3)).multiplyScalar(R * 1.02)), null, 6);
    }
    if (fcount) placeFruit(centre, R * 1.0, fcount, fr.shape || 'round', fsize, colourFn);
  };

  A.succulent = function (p) {
    var lc = p.leafColor || '#5f9a5a', i, a;
    switch (p.form) {
      case 'aloe': {
        var n2 = N(13, 5);
        for (i = 0; i < n2; i++) {
          a = i * 2.4; var pitch = 0.5 + (i / n2) * 0.8, L = 0.28 - (i / n2) * 0.08;
          var m = put(C.root, cached('spear', function () { var g = new THREE.ConeGeometry(1, 1, 3); g.translate(0, 0.5, 0); return g; }), vary(lc));
          m.scale.set(0.035, L, 0.017);
          m.position.set(0, 0.02, 0);
          aim(m, V(Math.cos(a) * Math.cos(pitch), Math.sin(pitch), -Math.sin(a) * Math.cos(pitch)));
          m.rotateY(PI / 2);
        }
        if (C.stage === 'mature') {
          rod(C.root, V(0, 0, 0), V(0.03, 0.6, 0), 0.006, 0.005, shade(lc, -0.1), 4);
          for (i = 0; i < 10; i++) { var cc = coneM(C.root, 0.008, 0.035, i % 2 ? '#f08a3a' : '#e2563a', V(0.03 + Math.cos(i) * 0.015, 0.6 - i * 0.012, Math.sin(i) * 0.015), 5); cc.rotation.x = PI; }
        }
        break;
      }
      case 'cactus': {
        var h = C.young ? 0.12 : 0.45, r = C.young ? 0.05 : 0.085;
        var col2 = put(C.root, cached('cactus', function () { var g = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true); g.translate(0, 0.5, 0); return g; }), lc);
        col2.scale.set(r, h, r);
        var dome = put(C.root, cached('dome', function () { return new THREE.SphereGeometry(1, 10, 5, 0, TAU, 0, PI / 2); }), lc);
        dome.scale.set(r, r * 0.9, r); dome.position.y = h;
        if (!C.young) [[1, 0.18, 0.12], [-1, 0.26, 0.1]].forEach(function (arm) {
          var s = arm[0], y = arm[1], ar = 0.045;
          rod(C.root, V(0, y, 0), V(s * 0.15, y, 0), ar, ar, lc, 8);
          rod(C.root, V(s * 0.15, y - ar * 0.6, 0), V(s * 0.15, y + arm[2], 0), ar, ar, lc, 8);
          ball(C.root, ar, lc, V(s * 0.15, y + arm[2], 0), [1, 0.9, 1], 8);
          ball(C.root, ar, lc, V(s * 0.15, y, 0), null, 8);
        });
        if (C.stage === 'mature') for (i = 0; i < 3; i++) blossom(C.pg, p.flower || '#f08aa0', 0.025, V(Math.cos(i * 2.1) * r * 0.5, h + r * 0.8, Math.sin(i * 2.1) * r * 0.5), V(Math.cos(i * 2.1) * 0.5, 1, Math.sin(i * 2.1) * 0.5), '#f5e08a');
        break;
      }
      default: {                                       // jade
        var branches = [[V(0, 0, 0), V(0.02, 0.18, 0)]], tips = [];
        if (!C.young) for (i = 0; i < 4; i++) { a = i * 1.7; branches.push([V(0.02, 0.15, 0), V(Math.cos(a) * 0.14, 0.3 + C.r() * 0.06, Math.sin(a) * 0.14)]); }
        branches.forEach(function (b, k) { rod(C.root, b[0], b[1], k ? 0.014 : 0.022, k ? 0.01 : 0.016, '#8a7a4a', 5); tips.push(b[1]); });
        tips.forEach(function (tp, k) {
          if (!k && tips.length > 1) return;
          for (var q = 0; q < 6; q++) {
            var pad = ball(C.root, 0.032, vary(lc), tp.clone().add(V(Math.cos(q * 1.05) * 0.04, 0.01 + (q % 2) * 0.02, Math.sin(q * 1.05) * 0.04)), [1, 0.4, 0.7], 8);
            pad.rotation.set(0.5 * (q % 2 ? 1 : -1), -q * 1.05, 0.6);
          }
        });
      }
    }
  };

  A.mushroom = function (p) {
    var cap = p.cap || '#cfc6b8', f = p.form || 'button', i, a;
    var grow = { seed: 0, germination: 0.25, seedling: 0.5, growing: 0.8, mature: 1, harvested: 0, archived: 0.9 }[C.stage];
    var caps = grow > 0 && !C.harvested;
    if (C.dried) cap = mix(cap, DRY, 0.7);
    switch (f) {
      case 'shiitake': {                                    // on a log
        var log = put(C.root, cached('log', function () { var g = new THREE.CylinderGeometry(1, 1, 1, 12); g.rotateZ(PI / 2); return g; }), '#6b4a30');
        log.scale.set(0.5, 0.085, 0.085); log.position.y = 0.085;
        [-1, 1].forEach(function (s) { var e = put(C.root, cached('logend', function () { var g = new THREE.CircleGeometry(1, 12); g.rotateY(PI / 2); return g; }), '#c9a26b', true); e.scale.setScalar(0.08); e.position.set(s * 0.251, 0.085, 0); });
        if (!caps) break;
        for (i = 0; i < 7; i++) {
          a = (i % 2 ? 0.5 : -0.4) + (C.r() - 0.5) * 0.4; var x = -0.18 + i * 0.06;
          var base = V(x, 0.085 + Math.cos(a) * 0.085, Math.sin(a) * 0.085), dir = V(0, Math.cos(a), Math.sin(a));
          var tip = base.clone().add(dir.clone().multiplyScalar(0.03 * grow));
          rod(C.pg, base, tip, 0.008, 0.007, '#efe6d6', 5);
          var cp = lathe(C.pg, 'cap', 0.04 * grow * (0.8 + C.r() * 0.4), cap, tip, 10); aim(cp, dir);
        }
        break;
      }
      case 'oyster': {                                      // grow bag
        var bag = put(C.root, cached('bag', function () { var g = new THREE.CylinderGeometry(0.9, 1, 1, 12); g.translate(0, 0.5, 0); return g; }), '#b8996a');
        bag.scale.set(0.12, 0.34, 0.12);
        ball(C.root, 0.12, '#a88a5a', V(0, 0.34, 0), [0.9, 0.3, 0.9], 10);
        if (!caps) break;
        [[0, 0.22], [2.2, 0.12], [4.1, 0.27]].forEach(function (cl) {
          var dir = V(Math.cos(cl[0]), 0, -Math.sin(cl[0])), base = dir.clone().multiplyScalar(0.11).add(V(0, cl[1], 0));
          for (var k = 0; k < 5; k++) {
            var sh = put(C.pg, cached('shelf', function () { return new THREE.SphereGeometry(1, 10, 6, 0, PI); }), shade(cap, (k % 2) * 0.06));
            sh.scale.set(0.065 * grow, 0.016 * grow + 0.004, 0.05 * grow);
            sh.position.copy(base).add(V(0, (k - 2) * 0.022 * grow, 0)).add(dir.clone().multiplyScalar(0.02 * grow));
            sh.rotation.set(0, cl[0] + (k - 2) * 0.25 - PI / 2, (k - 2) * 0.12);
          }
        });
        break;
      }
      case 'lionsmane': {
        boxM(C.root, 0.16, 0.2, 0.16, '#cbb48a', V(0, 0.1, 0));
        if (!caps) break;
        var centre = V(0.09, 0.12, 0), R = 0.07 * grow;
        blob(C.pg, R, cap, centre, [1, 0.9, 1]);
        for (i = 0; i < 18; i++) {
          var th = i * 2.4, ph = 0.6 + (i / 18) * 1.6;
          var pos = centre.clone().add(V(Math.cos(th) * Math.sin(ph), Math.cos(ph) * 0.9, Math.sin(th) * Math.sin(ph)).multiplyScalar(R * 0.85));
          var ic = coneM(C.pg, 0.012 * grow, 0.05 * grow, shade(cap, -0.04), pos, 5); ic.rotation.x = PI;
        }
        break;
      }
      default: {                                            // button mushrooms in a tray
        boxM(C.root, 0.42, 0.08, 0.3, '#5a4a3a', V(0, 0.04, 0));
        boxM(C.root, 0.39, 0.02, 0.27, '#3b2a1e', V(0, 0.081, 0));
        if (!caps) break;
        for (i = 0; i < 14; i++) {
          var x2 = -0.16 + (i % 5) * 0.08 + (C.r() - 0.5) * 0.03, z2 = -0.09 + Math.floor(i / 5) * 0.09 + (C.r() - 0.5) * 0.03;
          var s = (0.022 + C.r() * 0.014) * grow;
          rod(C.pg, V(x2, 0.09, z2), V(x2, 0.09 + s * 0.9, z2), s * 0.45, s * 0.4, '#f3ecdf', 6);
          lathe(C.pg, 'cap', s, cap, V(x2, 0.09 + s * 0.9, z2), 10);
        }
      }
    }
  };

  A.microgreens = function (p) {
    var lc = p.leafColor || '#7cc35a', stem = p.stem || '#e9f2d0', i, j;
    boxM(C.root, 0.38, 0.05, 0.27, '#2f3432', V(0, 0.025, 0));
    boxM(C.root, 0.35, 0.01, 0.24, '#4a3423', V(0, 0.051, 0));
    var h = { seed: 0, germination: 0.012, seedling: 0.03, growing: 0.05, mature: 0.07, harvested: 0.012, archived: 0.05 }[C.stage];
    if (C.stage === 'seed') { for (i = 0; i < 30; i++) ball(C.root, 0.005, '#b89a6a', V((C.r() - 0.5) * 0.32, 0.057, (C.r() - 0.5) * 0.21), null, 4); return; }
    for (i = 0; i < 9; i++) for (j = 0; j < 6; j++) {
      var x = -0.15 + i * 0.0375 + (C.r() - 0.5) * 0.02, z = -0.1 + j * 0.04 + (C.r() - 0.5) * 0.02, hh = h * (0.8 + C.r() * 0.4);
      var top = V(x + (C.r() - 0.5) * 0.01, 0.056 + hh, z);
      rod(C.pg, V(x, 0.056, z), top, 0.0025, 0.002, vary(stem), 3);
      if (C.stage !== 'harvested' && C.stage !== 'germination') {
        var a = C.r() * TAU, ls = 0.022 * Math.min(1, h / 0.05);
        leaf(C.pg, 'coty', ls, a, 0.25, vary(lc), top, { cup: 0.2, w: 1.3 });
        leaf(C.pg, 'coty', ls, a + PI, 0.25, vary(lc), top, { cup: 0.2, w: 1.3 });
      }
    }
  };

  A.worms = function (p) {
    var wood = p.bin || '#8a5f3a', i;
    var W = 0.5, D = 0.36, H = 0.26, t = 0.025;
    boxM(C.root, W, t, D, shade(wood, -0.1), V(0, t / 2, 0));
    [-1, 1].forEach(function (s) { boxM(C.root, t, H, D, wood, V(s * (W - t) / 2, H / 2, 0)); boxM(C.root, W, H, t, shade(wood, 0.06), V(0, H / 2, s * (D - t) / 2)); });
    boxM(C.root, W - 2 * t, 0.02, D - 2 * t, '#3b2a1e', V(0, H - 0.04, 0));
    for (i = 0; i < 6; i++) {
      var x = (C.r() - 0.5) * 0.3, z = (C.r() - 0.5) * 0.2, a = C.r() * TAU, pts = [];
      for (var k = 0; k < 5; k++) pts.push(V(x + Math.cos(a + Math.sin(k * 1.3) * 0.8) * k * 0.012, H - 0.025 + (k === 2 ? 0.008 : 0), z - Math.sin(a + Math.sin(k * 1.3) * 0.8) * k * 0.012));
      tube(C.pg, pts, 0.0045, i % 2 ? '#d98a8a' : '#c97070', 8, 4);
    }
    [['#f08a24', 0.02], ['#7cc35a', 0.025], ['#f3ecdf', 0.015], ['#c9a26b', 0.02]].forEach(function (s, k) {
      boxM(C.root, s[1], 0.006, s[1] * 0.7, s[0], V(-0.15 + k * 0.1, H - 0.027, (k % 2 ? 0.08 : -0.07))).rotation.y = k;
    });
    var hinge = new THREE.Group();                     // the lid stands open, hinged at the back
    hinge.position.set(0, H + 0.01, -D / 2);
    hinge.rotation.x = -(PI / 2 + 0.3);
    C.root.add(hinge);
    boxM(hinge, W + 0.02, 0.02, D + 0.02, shade(wood, -0.15), V(0, 0, D / 2));
  };

  A.hive = function () {
    var i;
    [-1, 1].forEach(function (s) { boxM(C.root, 0.06, 0.12, 0.42, '#8a8578', V(s * 0.17, 0.06, 0)); });
    boxM(C.root, 0.46, 0.04, 0.44, '#b58a55', V(0, 0.14, 0));
    boxM(C.root, 0.42, 0.24, 0.38, '#f3ecd2', V(0, 0.28, 0));
    boxM(C.root, 0.42, 0.16, 0.38, '#f2c94c', V(0, 0.48, 0));
    boxM(C.root, 0.47, 0.05, 0.43, '#9aa5a0', V(0, 0.585, 0));
    boxM(C.root, 0.2, 0.025, 0.02, '#3b2a1e', V(0, 0.175, 0.19));
    boxM(C.root, 0.3, 0.015, 0.08, '#b58a55', V(0, 0.155, 0.22));
    for (i = 0; i < 6; i++) {
      var p = V(-0.15 + i * 0.07 + (C.r() - 0.5) * 0.04, 0.3 + C.r() * 0.35, 0.28 + C.r() * 0.15);
      ball(C.pg, 0.012, '#f2c230', p, [1.4, 1, 1], 6);
      ball(C.pg, 0.008, '#2b2b2b', p.clone().add(V(0.012, 0, 0)), null, 5);
      leaf(C.pg, 'petal', 0.018, PI / 2, 0.5, '#ffffff', p.clone().add(V(0, 0.008, 0)), { cup: 0 });
      leaf(C.pg, 'petal', 0.018, -PI / 2, 0.5, '#ffffff', p.clone().add(V(0, 0.008, 0)), { cup: 0 });
    }
  };

  A.generic = function (p) {
    pairStems({ stems: 6, H: (p.height || 0.5) * 0.85, nodes: 4, len: 0.12, type: 'oval', cup: 0.45, lc: p.leafColor || '#5fae48', lean: 0.4 });
  };

  // ---------------------------------------------------------------- seed + sprout
  var MONOCOT = { stalk: 1 };
  function isMonocot(sp) {
    var p = sp.params || {};
    return MONOCOT[sp.model] || p.form === 'chives' || p.form === 'grass' || p.form === 'bulb' || p.form === 'aloe' ||
      p.tops === 'tubular' || p.tops === 'flat' || p.canopy === 'palm' || p.canopy === 'banana';
  }
  function accent(sp) {
    var p = sp.params || {}, f = p.fruit || {};
    return f.color || (f.colors && f.colors[0]) || (p.root && p.root.color) || (p.colors && p.colors[0]) || p.flower || p.leafColor || '#5fae48';
  }
  function seedMound(sp, sprout) {
    ball(C.root, 0.15, '#6b4a2f', V(0, 0, 0), [1, 0.28, 1], 12);
    if (!sprout) for (var i = 0; i < 3; i++) ball(C.root, 0.012, '#c9a26b', V(Math.cos(i * 2.1) * 0.035, 0.04, Math.sin(i * 2.1) * 0.035), [1, 0.6, 1.4], 6);
    rod(C.root, V(0.1, 0, -0.06), V(0.1, 0.12, -0.06), 0.006, 0.006, '#e8d6b0', 4);
    boxM(C.root, 0.045, 0.032, 0.006, accent(sp), V(0.1, 0.12, -0.06));
    if (!sprout) return;
    var t = V(0, 0.042, 0);
    if (isMonocot(sp)) {
      rod(C.pg, t, V(0.006, 0.15, 0), 0.006, 0.0015, '#7cc35a', 4);
      rod(C.pg, t, V(-0.016, 0.11, 0.006), 0.0055, 0.0015, '#8cc85a', 4);
    } else {
      tube(C.pg, [t, V(0.008, 0.09, 0), V(0.014, 0.13, 0)], 0.006, '#a9d47a', 6, 4);
      leaf(C.pg, 'coty', 0.05, 0.3, 0.3, '#7cc35a', V(0.014, 0.13, 0), { cup: 0.3, w: 1.2 });
      leaf(C.pg, 'coty', 0.05, 0.3 + PI, 0.3, '#7cc35a', V(0.014, 0.13, 0), { cup: 0.3, w: 1.2 });
    }
  }

  // ---------------------------------------------------------------- bake
  // Merge every mesh under each group into one vertex-coloured mesh.
  var BAKED = null;
  function bakedMat() {
    return BAKED || (BAKED = new THREE.MeshToonMaterial({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide }));
  }
  var _inv = new THREE.Matrix4(), _m4 = new THREE.Matrix4(), _n3 = new THREE.Matrix3(), _v = new THREE.Vector3();
  function bake(root, boundaries) {
    root.updateMatrixWorld(true);
    var groups = [root].concat(boundaries || []);
    groups.forEach(function (b) {
      var list = [];
      b.traverse(function (o) {
        if (!o.isMesh || o.userData.keep) return;
        var a = o.parent;
        while (a && a !== b && groups.indexOf(a) < 0) a = a.parent;
        if (a === b) list.push(o);
      });
      if (!list.length) return;
      _inv.copy(b.matrixWorld).invert();
      var nv = 0, ni = 0;
      list.forEach(function (o) { var g = o.geometry; nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; });
      var P = new Float32Array(nv * 3), Nn = new Float32Array(nv * 3), Cc = new Float32Array(nv * 3);
      var I = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni), vo = 0, io = 0;
      list.forEach(function (o) {
        var g = o.geometry, pos = g.attributes.position, nor = g.attributes.normal, c = o.material.color;
        if (!nor) { g.computeVertexNormals(); nor = g.attributes.normal; }
        _m4.multiplyMatrices(_inv, o.matrixWorld);
        _n3.getNormalMatrix(_m4);
        var flip = _m4.determinant() < 0;
        for (var i = 0; i < pos.count; i++) {
          _v.fromBufferAttribute(pos, i).applyMatrix4(_m4);
          P[(vo + i) * 3] = _v.x; P[(vo + i) * 3 + 1] = _v.y; P[(vo + i) * 3 + 2] = _v.z;
          _v.fromBufferAttribute(nor, i).applyMatrix3(_n3).normalize();
          Nn[(vo + i) * 3] = _v.x; Nn[(vo + i) * 3 + 1] = _v.y; Nn[(vo + i) * 3 + 2] = _v.z;
          Cc[(vo + i) * 3] = c.r; Cc[(vo + i) * 3 + 1] = c.g; Cc[(vo + i) * 3 + 2] = c.b;
        }
        var idx = g.index ? g.index.array : null, cnt = idx ? g.index.count : pos.count;
        for (var k = 0; k < cnt; k += 3) {
          var a0 = idx ? idx[k] : k, a1 = idx ? idx[k + 1] : k + 1, a2 = idx ? idx[k + 2] : k + 2;
          I[io + k] = vo + a0; I[io + k + 1] = vo + (flip ? a2 : a1); I[io + k + 2] = vo + (flip ? a1 : a2);
        }
        vo += pos.count; io += cnt;
        o.parent.remove(o);
      });
      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(Nn, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(Cc, 3));
      geo.setIndex(new THREE.BufferAttribute(I, 1));
      geo.computeBoundingSphere();
      var merged = new THREE.Mesh(geo, bakedMat());
      merged.userData.baked = true;
      b.add(merged);
    });
    prune(root, groups);
    return root;
  }
  function prune(o, keep) {
    for (var i = o.children.length - 1; i >= 0; i--) {
      var c = o.children[i];
      prune(c, keep);
      if (!c.isMesh && !c.children.length && keep.indexOf(c) < 0) o.remove(c);
    }
  }

  // ---------------------------------------------------------------- build
  var STAGE = {
    seedling: { k: 0.42, young: true, bloom: 0, fruit: 0 },
    growing: { k: 0.78, bloom: 1, fruit: 1 },
    mature: { k: 1, bloom: 0.4, fruit: 2 },
    harvested: { k: 0.92, bloom: 0, fruit: 0, harvested: true },
    archived: { k: 0.88, bloom: 0, fruit: 0, dried: true }
  };
  var FIXED = { worms: 1, hive: 1, mushroom: 1, microgreens: 1 };   // draw their own stages, no scaling
  function spec(idOrSpec) {
    if (idOrSpec && typeof idOrSpec === 'object') return idOrSpec;
    return SPECIES[idOrSpec] || SPECIES.generic || { id: 'generic', model: 'generic', params: {} };
  }
  function build(idOrSpec, stage, opts) {
    opts = opts || {};
    var sp = spec(idOrSpec), model = A[sp.model] ? sp.model : 'generic';
    stage = STAGES.indexOf(stage) >= 0 ? stage : 'mature';
    var root = new THREE.Group(), pg = new THREE.Group();
    root.add(pg);
    var st = STAGE[stage] || {};
    C = { r: rng(opts.seed === undefined ? hash(sp.id + '|' + stage) : opts.seed), stage: stage, root: root, pg: pg,
          young: !!st.young, bloom: st.bloom || 0, fruit: st.fruit || 0, harvested: !!st.harvested, dried: !!st.dried };
    if (st.harvested && (model === 'herb' || model === 'leafy')) { C.young = true; st = { k: 0.8 }; }
    if (FIXED[model]) {
      if (model === 'worms' || model === 'hive') C.dried = false;
      A[model](sp.params || {});
    } else if (stage === 'seed' || stage === 'germination') {
      seedMound(sp, stage === 'germination');
    } else {
      A[model](sp.params || {});
      root.scale.setScalar(st.k || 1);
    }
    var minScale = { herb: 0.55, leafy: 0.4, microgreens: 0.3 }[model] || 0;
    C = null;
    if (opts.merge !== false) bake(root, [pg]);
    var box = new THREE.Box3().setFromObject(root);
    var size = box.getSize(new THREE.Vector3());
    root.userData = { species: sp.id, stage: stage, model: model, produce: [pg], minScale: minScale, color: accent(sp),
                      height: Math.max(0.05, box.max.y), radius: Math.max(0.08, Math.max(size.x, size.z) / 2),
                      box: box };
    return root;
  }
  function dispose(obj) {
    obj.traverse(function (o) { if (o.isMesh && o.userData.baked) o.geometry.dispose(); });
  }

  // ---------------------------------------------------------------- viewer + snapshots
  function addLights(scene) {
    scene.add(new THREE.HemisphereLight(0xfffdf5, 0x5a4a34, 0.78));
    var sun = new THREE.DirectionalLight(0xffffff, 0.55);
    sun.position.set(3, 6, 4);
    scene.add(sun);
  }
  function makeBase(r, kind) {
    var g = new THREE.Group();
    var mk = function (geo, c) { var m = new THREE.Mesh(geo, new THREE.MeshToonMaterial({ color: new THREE.Color(c) })); g.add(m); return m; };
    if (kind === 'pot') {
      var pot = mk(latheGeo('pot', 20), '#c96f42'); pot.scale.setScalar(r * 2);
      var soil = mk(new THREE.CircleGeometry(1, 20), '#5a3d27'); soil.rotation.x = -PI / 2; soil.scale.setScalar(r * 0.88); soil.position.y = -0.03 * r;
      return g;
    }
    var bed = mk(new THREE.CylinderGeometry(1, 1.02, 1, 32), '#6b4a2f'); bed.scale.set(r, 0.06, r); bed.position.y = -0.03;
    var lawn = mk(new THREE.CylinderGeometry(1, 1, 1, 32), '#86b46a'); lawn.scale.set(r * 1.18, 0.05, r * 1.18); lawn.position.y = -0.055;
    return g;
  }
  function frame(camera, plant, controls, fit) {
    var u = plant.userData, h = u.height, r = u.radius;
    var rad = Math.max(h * 0.62, r * 1.05, 0.18);
    var dist = rad / Math.tan(camera.fov * PI / 360) * (fit || 1.15);
    if (camera.aspect < 1) dist /= Math.max(0.6, camera.aspect);
    var target = V(0, h * 0.45, 0);
    camera.position.set(dist * 0.62, h * 0.45 + dist * 0.42, dist * 0.68);
    camera.lookAt(target);
    if (controls) { controls.target.copy(target); controls.minDistance = dist * 0.4; controls.maxDistance = dist * 2.2; controls.update(); }
  }
  function viewer(canvas, wrap, id, stage, opts) {
    opts = opts || {};
    if (!window.Nevet3D || !Nevet3D.supportsWebGL()) return null;
    var calm = Nevet3D.reducedMotion(), plant = null, base = null, controls = null, sway = !calm && opts.sway !== false;
    var view = Nevet3D.createView(canvas, wrap, { fov: 32, onFrame: function (t) {
      if (plant && sway) { plant.rotation.z = Math.sin(t * 1.3) * 0.025; plant.rotation.x = Math.sin(t * 0.9 + 1) * 0.015; }
      if (controls) controls.update();
    } });
    var scene = view.scene, camera = view.camera;
    addLights(scene);
    if (THREE.OrbitControls && opts.controls !== false) {
      controls = new THREE.OrbitControls(camera, canvas);
      controls.enableDamping = true; controls.enablePan = false; controls.maxPolarAngle = PI * 0.49;
      controls.autoRotate = !calm && opts.autoRotate !== false; controls.autoRotateSpeed = 1.2;
      controls.addEventListener('start', function () { controls.autoRotate = false; });
    }
    var api2 = {
      scene: scene, camera: camera, renderer: view.renderer,
      set: function (id2, stage2) {
        if (plant) { scene.remove(plant); dispose(plant); }
        if (base) scene.remove(base);
        plant = build(id2, stage2);
        var m = plant.userData.model;
        base = opts.base === false ? null : makeBase(Math.max(0.2, plant.userData.radius * 1.15), opts.base || (m === 'worms' || m === 'hive' || m === 'mushroom' || m === 'microgreens' ? 'tile' : 'tile'));
        if (base) scene.add(base);
        scene.add(plant);
        frame(camera, plant, controls, opts.fit);
        api2.plant = plant;
        return plant;
      }
    };
    api2.set(id, stage);
    return api2;
  }
  var snap = null, snapCache = {};
  function snapshot(id, stage, size) {
    size = size || 160;
    var key = (typeof id === 'object' ? id.id : id) + '|' + stage + '|' + size;
    if (snapCache[key]) return snapCache[key];
    if (!snap) {
      var cv = document.createElement('canvas');
      try { snap = { r: new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, preserveDrawingBuffer: true }), scene: new THREE.Scene(), cam: new THREE.PerspectiveCamera(30, 1, 0.01, 50) }; }
      catch (e) { return null; }
      addLights(snap.scene);
    }
    snap.r.setPixelRatio(1);
    snap.r.setSize(size, size, false);
    var plant = build(id, stage);
    var base = makeBase(Math.max(0.2, plant.userData.radius * 1.1));
    snap.scene.add(plant); snap.scene.add(base);
    snap.cam.aspect = 1; snap.cam.updateProjectionMatrix();
    frame(snap.cam, plant, null, 1.05);
    snap.r.render(snap.scene, snap.cam);
    var url = snap.r.domElement.toDataURL('image/png');
    snap.scene.remove(plant); snap.scene.remove(base); dispose(plant);
    snapCache[key] = url;
    return url;
  }

  var api = {
    STAGES: STAGES, use: use, load: load, detect: detect, species: function (id) { return SPECIES[id] || null; },
    list: function () { return LIST.slice(); }, build: build, bake: bake, dispose: dispose,
    viewer: viewer, snapshot: snapshot, accent: function (id) { return accent(spec(id)); }
  };
  window.NevetPlants = api;
  if (window.NEVET_PLANT_CATALOG) use(window.NEVET_PLANT_CATALOG);
})();
