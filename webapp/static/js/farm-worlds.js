// The land around the farm, by setting: the classic green valley, a desert oasis, the seaside, a deep forest,
// snowy mountains, a jungle, African bushland, a Pacific island lagoon and an urban city farm.
// farm3d.js reads CONFIG (ground, sky, fog, ground cover, the play park's border) and calls build() with its
// helpers once the farm's ground is down; build() adds trees, animals and scenery, and registers little
// moving things in K.WORLD_ANIM (called every frame with now, dt and how dark it is).
(function () {
  'use strict';
  var CONFIG = {
    classic: { ground: ['#8cc76a', '#79b85a', '#a3d27a'], sky: ['#6fb8ec', '#e4f4ff'], hemi: 0x6f8a5a, fog: [85, 260],
               tuft: '#5f9e46', petals: ['#ffffff', '#f6d743', '#f29bc0', '#c9a7f2', '#ff8a65', '#ffffff'],
               yard: '#d8c497', path: '#d2bb8c', pitch: '#7cc25c', border: '#4f9a3e', borderStyle: 'hedge' },
    desert:  { ground: ['#ecd29a', '#e2c286', '#f4e0b2'], sky: ['#58ace6', '#fbe5bd'], hemi: 0xc9a46a, fog: [95, 290],
               tuft: '#9aa356', cover: 'shrub', petals: ['#e98ab6', '#f3cf5b', '#ffffff', '#e9845b'],
               yard: '#e7cd98', path: '#dcbb82', pitch: '#e9d29c', border: '#d39a64', borderStyle: 'adobe' },
    seaside: { ground: ['#a2cc74', '#8fbe64', '#b6d888'], sky: ['#4eaef0', '#e0f5ff'], hemi: 0x8aa66a, fog: [95, 300],
               tuft: '#86ab52', cover: 'dune', petals: ['#ffffff', '#f6d743', '#9fd0f2', '#f29bc0'],
               yard: '#e2d1a0', path: '#e8d6a8', pitch: '#86c768', border: '#f6f1e4', borderStyle: 'picket', water: true },
    forest:  { ground: ['#6aa452', '#5a9446', '#7cb461'], sky: ['#6aa6c9', '#d6eadf'], hemi: 0x4f6e3f, fog: [45, 175],
               tuft: '#3d7c35', cover: 'fern', flowers: 'shroom', petals: ['#e2463a', '#e2463a', '#f1e4c6', '#c98b4a'],
               yard: '#cdb78a', path: '#c4ab7b', pitch: '#76b45a', border: '#7a5233', borderStyle: 'logs' },
    snow:    { ground: ['#f4f7fb', '#e4ebf3', '#ffffff'], sky: ['#8fc3ea', '#eef6ff'], hemi: 0xb8c8d8, fog: [75, 245],
               tuft: '#eef4fa', petals: ['#c9e6ff', '#ffffff'], cover: 'snow', flowers: false,
               yard: '#e6dfd2', path: '#d6ccb8', pitch: '#d3e4f1', border: '#6b4a2b', borderStyle: 'logs', hills: 1.7 },
    jungle:  { ground: ['#4f9a3c', '#438a33', '#5fab48'], sky: ['#7fbfd8', '#d9efe0'], hemi: 0x3f6a33, fog: [42, 165],
               tuft: '#3f8f35', petals: ['#ff4f6e', '#ff9f1c', '#ff5ec4', '#ffe14d'], cover: 'leaf',
               yard: '#c9ae7a', path: '#bea06c', pitch: '#5fae48', border: '#9bbf4a', borderStyle: 'bamboo', hills: 1.3 },
    savanna: { ground: ['#d9c27a', '#cdb46a', '#e4cf8c'], sky: ['#69b4e4', '#fbe3b8'], hemi: 0xb59a5a, fog: [105, 310],
               tuft: '#c9a94e', petals: ['#f6d743', '#ffffff', '#e98a5b'], cover: 'tallgrass',
               yard: '#d9bd8a', path: '#cfae78', pitch: '#b9c86a', border: '#8a5f3a', borderStyle: 'posts', hills: 0.45 },
    island:  { ground: ['#7fc95f', '#6dbb52', '#93d46e'], sky: ['#3fb2f2', '#d8f6ff'], hemi: 0x7fb08a, fog: [110, 330],
               tuft: '#5fae48', petals: ['#ff5e7a', '#ffd84d', '#ffffff', '#ff9f1c'],
               yard: '#efe0b2', path: '#efdcaa', pitch: '#7cc25c', border: '#c8a96a', borderStyle: 'posts', water: true },
    city:    { ground: ['#8cc76a', '#7fbd5e', '#99cf78'], sky: ['#7fb6e0', '#e8eef4'], hemi: 0x7a7f86, fog: [85, 270],
               tuft: '#5f9e46', petals: ['#ffffff', '#f6d743', '#f29bc0', '#ff8a65'], cover: 'tuft', sparse: true,
               yard: '#cfc4ae', path: '#bdb8ae', pitch: '#5fb85a', border: '#4a4f57', borderStyle: 'railing' }
  };

  var THREE, PI = Math.PI, TAU = Math.PI * 2;
  var group, cyl, box, sphere, cone, mesh, mat, rot, outline, blobShadow, statics, scene, movers, hillH, rng, R, rr, V,
      SEA_Y, PLAY, BOX, WORLD, WORLD_ANIM, EXTRA_OBST, INNER_TREES, textCanvas, merge;

  function build(K) {
    THREE = window.THREE;
    group = K.group; cyl = K.cyl; box = K.box; sphere = K.sphere; cone = K.cone; mesh = K.mesh; mat = K.mat; rot = K.rot;
    outline = K.outline; blobShadow = K.blobShadow; statics = K.statics; scene = K.scene; movers = K.movers; hillH = K.hillH;
    rng = K.rng; R = K.R; rr = K.rr; V = K.V; SEA_Y = K.SEA_Y; PLAY = K.PLAY; WORLD = K.world; WORLD_ANIM = K.WORLD_ANIM;
    EXTRA_OBST = K.EXTRA_OBST; INNER_TREES = K.INNER_TREES; textCanvas = K.textCanvas; merge = K.merge;
    // the box the scenery goes round: 1 m beyond the farm's outer fence (it grew: the campfire and party fields)
    BOX = K.BOX || { x0: -21, x1: 21, z0: -21, z1: PLAY.maxZ + 1.2 };
    var EAST = BOX.x1 - 21, WEST = BOX.x0 + 21;         // how far the east and west edges moved out (hand-placed scenery moves with them)
    var SPREAD = ((BOX.x1 - BOX.x0) + (BOX.z1 - BOX.z0)) / 98.6;     // more round a bigger farm, as thick as before
  function roundTree(x, z, apple, k) {
    var t = group([x, hillH(x, z), z]);
    var hgt = rr(1.6, 2.4);
    t.add(cyl(0.22, 0.32, hgt, '#7a5233', [0, hgt / 2, 0], 8));
    var cols = WORLD === 'forest' ? ['#3f8a34', '#4c9a3c', '#357a2e'] : ['#4f9a3e', '#5fae48', '#3f8a34'];
    [[0, hgt + 1.1, 0, 1.45], [0.8, hgt + 0.6, 0.2, 1.0], [-0.7, hgt + 0.7, -0.3, 1.05], [0.1, hgt + 1.8, 0.1, 0.95]].forEach(function (c, i) {
      t.add(sphere(c[3], cols[i % 3], [c[0], c[1], c[2]], null, 12));
    });
    if (apple) for (var a = 0; a < 7; a++) { var an = a / 7 * TAU; t.add(sphere(0.12, '#e0402f', [Math.cos(an) * 1.3, hgt + 0.9 + Math.sin(a * 2) * 0.4, Math.sin(an) * 1.3], null, 8)); }
    t.scale.setScalar(k || rr(0.9, 1.35));
    statics.add(outline(t, 1.025));
    statics.add(blobShadow(1.8, x, z, hillH(x, z)));
  }
  function palmTree(x, z, k, lean) {
    var t = group([x, hillH(x, z), z], R() * TAU), trunk = group(), hgt = rr(3.8, 4.8), segs = 7;
    lean = lean === undefined ? rr(0.4, 1.2) : lean;
    for (var i = 0; i < segs; i++) {
      var f = i / segs;
      trunk.add(cyl(0.16 - f * 0.05, 0.2 - f * 0.05, hgt / segs + 0.04, i % 2 ? '#a07f55' : '#8d6c45', [f * f * lean, (i + 0.5) * hgt / segs, 0], 7));
    }
    t.add(outline(trunk, 1.04));
    var top = [lean, hgt, 0];
    for (var l = 0; l < 9; l++) {
      var leaf = group(top, 0);
      leaf.rotation.order = 'YXZ'; leaf.rotation.y = l / 9 * TAU + rr(-0.15, 0.15); leaf.rotation.x = rr(0.15, 0.4);
      var c1 = l % 2 ? '#4f9a3e' : '#5fae48';
      leaf.add(box(0.5, 0.05, 1.3, c1, [0, 0, 0.65]));
      var tip = group([0, 0, 1.25]); tip.rotation.x = 0.6;
      tip.add(box(0.36, 0.05, 1.1, c1, [0, 0, 0.5]));
      leaf.add(tip);
      t.add(leaf);
    }
    for (var n = 0; n < 3; n++) t.add(sphere(0.15, '#7a5233', [lean + Math.cos(n * 2.1) * 0.22, hgt - 0.18, Math.sin(n * 2.1) * 0.22], null, 8));
    t.scale.setScalar(k || rr(0.85, 1.15));
    statics.add(t);
    statics.add(blobShadow(1.4, x + lean, z, hillH(x, z)));
  }
  function cactus(x, z, k) {
    var t = group([x, hillH(x, z), z], R() * TAU), C = '#5f9a4a', hgt = rr(1.8, 2.8);
    t.add(cyl(0.26, 0.3, hgt, C, [0, hgt / 2, 0], 10)); t.add(sphere(0.26, C, [0, hgt, 0], null, 10));
    [[1, rr(0.8, 1.3), rr(0.5, 0.9)], [-1, rr(1.0, 1.6), rr(0.4, 0.8)]].forEach(function (a, i) {
      if (i && R() < 0.35) return;
      t.add(rot(cyl(0.15, 0.15, 0.55, C, [a[0] * 0.45, a[1], 0], 8), 0, 0, PI / 2));
      t.add(cyl(0.15, 0.15, a[2], C, [a[0] * 0.7, a[1] + a[2] / 2, 0], 8));
      t.add(sphere(0.15, C, [a[0] * 0.7, a[1] + a[2], 0], null, 8));
    });
    if (R() < 0.4) t.add(sphere(0.1, '#f29bc0', [0, hgt + 0.25, 0], [1, 0.6, 1], 8));
    t.scale.setScalar(k || rr(0.8, 1.2));
    statics.add(outline(t, 1.04));
    statics.add(blobShadow(0.7, x, z, hillH(x, z)));
  }
  function pine(x, z, k, ink) {
    var t = group([x, hillH(x, z), z], R() * TAU), cols = ['#2f6b3a', '#3a7a40', '#2a5f35'];
    t.add(cyl(0.16, 0.24, 1.3, '#6b4a2b', [0, 0.65, 0], 7));
    [[1.55, 2.1, 1.7], [1.2, 1.8, 2.75], [0.82, 1.5, 3.7]].forEach(function (c, i) { t.add(cone(c[0], c[1], cols[i], [0, c[2], 0], 9)); });
    t.scale.set(1, rr(1.0, 1.5), 1).multiplyScalar(k || rr(0.9, 1.5));
    statics.add(ink ? outline(t, 1.03) : t);
    statics.add(blobShadow(1.5, x, z, hillH(x, z)));
  }
  function rock(x, z, k, color, moss) {
    var r = mesh(new THREE.DodecahedronGeometry(1, 0), mat(color || '#9a968c'), [x, hillH(x, z) + 0.25 * k, z]);
    r.scale.set(k * rr(0.9, 1.4), k * rr(0.5, 0.8), k * rr(0.9, 1.3)); r.rotation.y = R() * TAU;
    statics.add(r);
    if (moss) statics.add(sphere(k * 0.75, moss === true ? '#5f9a43' : moss, [x, hillH(x, z) + k * 0.55, z], [1.1, 0.35, 1], 8));
  }
  // spots outside the farm, at least `gap` apart: `from`..`to` metres beyond it
  function outsideSpots(n, from, to, gap, seed, ok) {
    var out = [], r2 = rng(seed);
    n = Math.round(n * SPREAD);
    for (var t = 0; t < n * 30 && out.length < n; t++) {
      var x = BOX.x0 - to + r2() * (BOX.x1 - BOX.x0 + 2 * to), z = BOX.z0 - to + r2() * (BOX.z1 - BOX.z0 + 2 * to);
      var beyond = Math.max(BOX.x0 - x, x - BOX.x1, BOX.z0 - z, z - BOX.z1);
      if (beyond < from || beyond > to || (ok && !ok(x, z))) continue;
      if (out.some(function (p) { return (p[0] - x) * (p[0] - x) + (p[1] - z) * (p[1] - z) < gap * gap; })) continue;
      out.push([x, z, beyond]);
    }
    return out;
  }
  function animal(kind, x, z, rotY) {                  // camels resting by the oasis, deer at the forest's edge
    var g = group([x, hillH(x, z), z], rotY), c = kind === 'camel' ? '#c9a06a' : '#a8703f', legH = kind === 'camel' ? 1.1 : 0.75;
    var bodyL = kind === 'camel' ? 1.5 : 1.0;
    g.add(sphere(0.5, c, [0, legH + 0.35, 0], [0.8, 0.75, bodyL]));
    if (kind === 'camel') g.add(sphere(0.38, c, [0, legH + 0.82, -0.05], [0.8, 0.9, 1]));
    var neck = cyl(0.12, 0.16, kind === 'camel' ? 1.0 : 0.65, c, [0, legH + 0.75, bodyL * 0.42], 8); neck.rotation.x = 0.6; g.add(neck);
    var head = group([0, legH + (kind === 'camel' ? 1.15 : 1.0), bodyL * 0.42 + 0.4]); g.add(head);
    head.add(sphere(0.18, c, [0, 0, 0.08], [0.8, 0.8, 1.5]));
    head.add(sphere(0.04, '#1f2522', [0.11, 0.06, 0.12], null, 6)); head.add(sphere(0.04, '#1f2522', [-0.11, 0.06, 0.12], null, 6));
    if (kind === 'deer') {
      [-1, 1].forEach(function (s2) {
        head.add(rot(cone(0.06, 0.2, c, [s2 * 0.15, 0.17, -0.05], 5), 0, 0, -s2 * 0.6));
        var ant = group([s2 * 0.08, 0.16, -0.05]); ant.rotation.z = -s2 * 0.35;
        ant.add(cyl(0.02, 0.025, 0.42, '#e6d6b8', [0, 0.21, 0], 5)); ant.add(rot(cyl(0.018, 0.018, 0.2, '#e6d6b8', [s2 * 0.05, 0.3, 0.05], 5), 0.6, 0, -s2 * 0.5));
        head.add(ant);
      });
      g.add(sphere(0.1, '#f4efe4', [0, legH + 0.45, -bodyL * 0.5], null, 6));
    }
    [[0.22, 0.6], [-0.22, 0.6], [0.22, -0.55], [-0.22, -0.55]].forEach(function (l) { g.add(cyl(0.07, 0.06, legH, c, [l[0], legH / 2, l[1] * bodyL * 0.75], 6)); });
    statics.add(outline(g, 1.04));
    statics.add(blobShadow(0.9, x, z, hillH(x, z)));
    return head;
  }
  // ================================================================ the newer settings
  function smokeTex() {
    if (smokeTex.t) return smokeTex.t;
    var cv = document.createElement('canvas'); cv.width = cv.height = 64;
    var x = cv.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    return (smokeTex.t = new THREE.CanvasTexture(cv));
  }
  function smoke(pos, n, size, rise, color) {             // puffs rising from a chimney or a volcano
    var puffs = [];
    for (var i = 0; i < n; i++) {
      var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex(), color: new THREE.Color(color || '#dddddd'), transparent: true, depthWrite: false, opacity: 0 }));
      sp.userData.ph = i / n; scene.add(sp); puffs.push(sp);
    }
    WORLD_ANIM.push(function (now) {
      puffs.forEach(function (sp) {
        var k = (now * 0.12 + sp.userData.ph) % 1;
        sp.position.set(pos.x + Math.sin(k * 5 + sp.userData.ph * 9) * k * size * 0.4, pos.y + k * rise, pos.z + k * size * 0.3);
        sp.scale.setScalar(size * (0.4 + k * 1.4)); sp.material.opacity = Math.sin(k * PI) * 0.55;
      });
    });
  }
  function flyers(n, colors, centre, radius, height, size) {      // birds circling: gulls, parrots, vultures, pigeons
    for (var i = 0; i < n; i++) {
      var b = group(), wl = group(), wr = group(), c = colors[i % colors.length];
      wl.add(box(0.7 * size, 0.04, 0.2 * size, c, [-0.35 * size, 0, 0])); wr.add(box(0.7 * size, 0.04, 0.2 * size, c, [0.35 * size, 0, 0]));
      b.add(wl); b.add(wr); b.add(sphere(0.13 * size, c, [0, 0, 0], [1, 0.8, 1.9], 8));
      b.userData = { c: V(centre.x + rr(-radius, radius) * 0.5, height + rr(-2, 2), centre.z + rr(-radius, radius) * 0.5), r: rr(radius * 0.4, radius), sp: rr(0.2, 0.4) * (i % 2 ? 1 : -1), ph: rr(0, TAU), l: wl, rw: wr };
      scene.add(b);
      (function (bd) {
        WORLD_ANIM.push(function (now) {
          var u = bd.userData, a = now * u.sp + u.ph, fl = Math.sin(now * 6 + u.ph) * 0.5;
          bd.position.set(u.c.x + Math.cos(a) * u.r, u.c.y + Math.sin(now * 0.7 + u.ph) * 0.8, u.c.z + Math.sin(a) * u.r);
          bd.rotation.y = -a + (u.sp > 0 ? 0 : PI); u.l.rotation.z = fl; u.rw.rotation.z = -fl;
        });
      })(b);
    }
  }
  function peaks(n, color, cap, seed, from, to, minR, maxR) {      // far mountains along the north
    var r2 = rng(seed);
    for (var i = 0; i < n; i++) {
      var ang = (from === undefined ? -PI * 0.98 : from) + i / Math.max(1, n - 1) * ((to === undefined ? PI * 0.32 : to) - (from === undefined ? -PI * 0.98 : from)) + (r2() - 0.5) * 0.2;
      var dist = 125 + r2() * 55, mx = Math.cos(ang) * dist, mz = Math.sin(ang) * dist;
      var rad = (minR || 28) + r2() * ((maxR || 54) - (minR || 28)), hh = rad * (1.1 + r2() * 0.7), g = group([mx, hillH(mx, mz) - 2, mz], r2() * TAU);
      g.add(cone(rad, hh, color, [0, hh / 2, 0], 7));
      if (cap) g.add(cone(rad * 0.38 + 0.5, hh * 0.38, cap, [0, hh * 0.81 + 0.3, 0], 7));
      statics.add(g);
    }
  }
  function local(g, x, y, z) { g.updateMatrixWorld(true); return g.localToWorld(V(x, y, z)); }

  // ---------------- snowy mountains: snow-laden pines, snowmen, a log cabin, peaks, falling snow
  function snowPine(x, z, k, ink) {
    var t = group([x, hillH(x, z), z], R() * TAU);
    t.add(cyl(0.16, 0.24, 1.3, '#5a3d22', [0, 0.65, 0], 7));
    [[1.55, 2.1, 1.7], [1.2, 1.8, 2.75], [0.82, 1.5, 3.7]].forEach(function (c, i) {
      t.add(cone(c[0], c[1], ['#2c5f3e', '#336b45', '#2a5a3b'][i], [0, c[2], 0], 9));
      t.add(cone(c[0] * 0.62, c[1] * 0.42, '#f6f9fc', [0, c[2] + c[1] * 0.3, 0], 9));
    });
    t.scale.set(1, rr(1.0, 1.5), 1).multiplyScalar(k || rr(0.9, 1.5));
    statics.add(ink ? outline(t, 1.03) : t);
    statics.add(blobShadow(1.5, x, z, hillH(x, z)));
  }
  function snowman(x, z, ry) {
    var g = group([x, hillH(x, z), z], ry);
    g.add(sphere(0.7, '#ffffff', [0, 0.6, 0], null, 14)); g.add(sphere(0.5, '#ffffff', [0, 1.5, 0], null, 14)); g.add(sphere(0.36, '#ffffff', [0, 2.2, 0], null, 14));
    g.add(rot(cone(0.07, 0.4, '#f2832c', [0, 2.2, 0.48], 8), PI / 2));
    [-0.13, 0.13].forEach(function (ex) { g.add(sphere(0.05, '#1f2522', [ex, 2.3, 0.32], null, 6)); });
    [0.2, 0, -0.2].forEach(function (by) { g.add(sphere(0.05, '#1f2522', [0, 1.5 + by, 0.48], null, 6)); });
    g.add(cyl(0.4, 0.42, 0.14, '#c0392b', [0, 1.88, 0], 14));
    g.add(cyl(0.38, 0.38, 0.05, '#1f2522', [0, 2.5, 0], 14)); g.add(cyl(0.24, 0.26, 0.42, '#1f2522', [0, 2.73, 0], 14));
    [-1, 1].forEach(function (s) { g.add(rot(cyl(0.03, 0.035, 0.9, '#6b4a2b', [s * 0.75, 1.68, 0], 5), 0, 0, -s * 1.0)); });
    statics.add(outline(g, 1.03)); statics.add(blobShadow(0.8, x, z, hillH(x, z)));
  }
  function cabin(x, z, ry) {
    var g = group([x, hillH(x, z), z], ry), W = 5, Dp = 4, H = 2.6;
    for (var i = 0; i < 7; i++) g.add(box(W, H / 7 - 0.02, Dp, i % 2 ? '#7a5233' : '#6b4423', [0, (i + 0.5) * H / 7, 0]));
    var roof = new THREE.Shape(); roof.moveTo(-W / 2 - 0.4, 0); roof.lineTo(0, 1.8); roof.lineTo(W / 2 + 0.4, 0); roof.lineTo(-W / 2 - 0.4, 0);
    var rg = new THREE.ExtrudeGeometry(roof, { depth: Dp + 0.6, bevelEnabled: false }); rg.translate(0, 0, -(Dp + 0.6) / 2);
    g.add(mesh(rg, '#5a3d2a', [0, H, 0]));
    var sr = mesh(rg, '#f6f9fc', [0, H + 0.2, 0]); sr.scale.set(0.97, 0.92, 1.02); g.add(sr);
    g.add(box(0.9, 1.6, 0.08, '#4a3020', [0, 0.8, Dp / 2 + 0.03]));
    [-1.5, 1.5].forEach(function (wx) { g.add(box(0.8, 0.7, 0.06, '#f7d77a', [wx, 1.5, Dp / 2 + 0.04])); });
    g.add(box(0.6, 2.4, 0.6, '#8f8a80', [1.4, H + 1.1, -0.6]));
    statics.add(outline(g, 1.02));
    statics.add(blobShadow(3.4, x, z, hillH(x, z)));
    return local(g, 1.4, H + 2.4, -0.6);
  }
  function snowfall() {
    var N = Math.round(1500 * SPREAD), geo = new THREE.BufferGeometry(), P = new Float32Array(N * 3), seeds = [];
    for (var i = 0; i < N; i++) seeds.push([rr(BOX.x0 - 8, BOX.x1 + 8), rr(0, 32), rr(BOX.z0 - 30, BOX.z1 + 26), rr(0.7, 1.5), rr(0, TAU)]);
    geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
    var pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.17, transparent: true, opacity: 0.9, depthWrite: false }));
    pts.frustumCulled = false; scene.add(pts);
    WORLD_ANIM.push(function (now) {
      for (var i = 0; i < N; i++) {
        var s = seeds[i], y = (s[1] - now * s[3]) % 32; if (y < 0) y += 32;
        P[i * 3] = s[0] + Math.sin(now * 0.6 + s[4]) * 1.2; P[i * 3 + 1] = y; P[i * 3 + 2] = s[2] + Math.cos(now * 0.5 + s[4]) * 0.8;
      }
      geo.attributes.position.needsUpdate = true;
    });
  }
  function snow() {
    INNER_TREES.forEach(function (t) { snowPine(t[0], t[1], 1.1, true); });
    outsideSpots(130, 1.5, 46, 3, 61).forEach(function (s) { snowPine(s[0], s[1], rr(0.9, 1.6), s[2] < 10); });
    outsideSpots(10, 2, 30, 5, 62).forEach(function (s) { rock(s[0], s[1], rr(0.6, 1.3), '#8f96a0', '#f6f9fc'); });
    [[24.5 + EAST, 21, -0.8], [-24 + WEST, 28, 0.9], [25.5 + EAST, 31.5, -1.2]].forEach(function (s) { snowman(s[0], s[1], s[2]); });
    smoke(cabin(-30 + WEST, 8, PI / 2), 7, 1.4, 6, '#e8e8e8');
    peaks(12, '#8d97a3', '#f6f9fc', 63);
    snowfall();
  }

  // ---------------- jungle: rainforest giants with vines, palms, bananas, a waterfall, ruins, parrots
  function jungleTree(x, z, k, ink) {
    var t = group([x, hillH(x, z), z], R() * TAU), hgt = rr(6, 9);
    t.add(cyl(0.3, 0.5, hgt, '#7a5f45', [0, hgt / 2, 0], 8));
    for (var b = 0; b < 4; b++) { var a = b / 4 * TAU + 0.4, fin = box(0.12, 1.4, 1.0, '#6e5440', [Math.cos(a) * 0.45, 0.6, Math.sin(a) * 0.45]); fin.rotation.y = PI / 2 - a; t.add(fin); }
    var cols = ['#2f7a2e', '#3d8f37', '#276a2a'];
    [[0, hgt + 0.4, 0, 2.6], [1.6, hgt - 0.3, 0.6, 1.8], [-1.5, hgt - 0.1, -0.7, 1.9], [0.3, hgt + 1.0, -1.4, 1.6]].forEach(function (c, i) { t.add(sphere(c[3], cols[i % 3], [c[0], c[1], c[2]], [1, 0.5, 1], 12)); });
    if (R() < 0.6) for (var v = 0; v < 5; v++) { var va = R() * TAU, vr = rr(0.8, 2.2), vl = rr(2, hgt * 0.7); t.add(cyl(0.025, 0.025, vl, '#4f8a33', [Math.cos(va) * vr, hgt - 0.3 - vl / 2, Math.sin(va) * vr], 4)); }
    t.scale.setScalar(k || rr(0.9, 1.3));
    statics.add(ink ? outline(t, 1.02) : t); statics.add(blobShadow(2.6, x, z, hillH(x, z)));
  }
  function bananaPlant(x, z, k) {
    var t = group([x, hillH(x, z), z], R() * TAU);
    t.add(cyl(0.12, 0.16, 1.2, '#7f9a4a', [0, 0.6, 0], 7));
    for (var l = 0; l < 6; l++) {
      var leaf = group([0, 1.15, 0]); leaf.rotation.order = 'YXZ'; leaf.rotation.y = l / 6 * TAU + rr(-0.2, 0.2); leaf.rotation.x = rr(-0.7, -0.2);
      leaf.add(box(0.5, 0.04, 1.6, l % 2 ? '#4caf50' : '#5cbf55', [0, 0, 0.8]));
      var tip = group([0, 0, 1.55]); tip.rotation.x = 0.7; tip.add(box(0.42, 0.04, 0.8, l % 2 ? '#4caf50' : '#5cbf55', [0, 0, 0.4])); leaf.add(tip);
      t.add(leaf);
    }
    if (R() < 0.5) t.add(sphere(0.22, '#e8d84a', [0.3, 1.0, 0], [0.8, 1.3, 0.8], 8));
    t.scale.setScalar(k || rr(0.9, 1.4)); statics.add(t);
  }
  function waterfall(x, z, w, h) {
    var y0 = hillH(x, z), cliff = group([x, y0, z]), cw = w + 30;
    cliff.add(box(cw, h + 2, 8, '#5f6e52', [0, h / 2 - 1, -4.2]));
    for (var i = 0; i < 10; i++) cliff.add(sphere(rr(3, 5), i % 2 ? '#2f7a2e' : '#3d8f37', [rr(-cw / 2, cw / 2), h, rr(-7, -1)], [1, 0.5, 1], 10));
    for (var r = 0; r < 6; r++) cliff.add(sphere(rr(0.8, 1.6), '#7d8a6e', [rr(-w, w), 0.3, rr(1, 4)], [1, 0.6, 1], 8));
    statics.add(cliff);
    var cv = document.createElement('canvas'); cv.width = 64; cv.height = 256;
    var g = cv.getContext('2d'); g.fillStyle = '#a9dcf2'; g.fillRect(0, 0, 64, 256);
    for (var s = 0; s < 70; s++) { g.fillStyle = 'rgba(255,255,255,' + rr(0.3, 0.9).toFixed(2) + ')'; g.fillRect(Math.floor(rr(0, 62)), Math.floor(rr(0, 256)), Math.floor(rr(1, 4)), Math.floor(rr(20, 90))); }
    var tex = new THREE.CanvasTexture(cv); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(3, 2);
    var fall = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.93 }));
    fall.position.set(x, y0 + h / 2 - 0.2, z - 0.1); scene.add(fall);
    var pool = mesh(new THREE.CircleGeometry(w * 0.85, 24), '#3fb6d8', [x, y0 + 0.06, z + w * 0.6]); pool.rotation.x = -PI / 2; statics.add(pool);
    smoke(V(x, y0 + 0.4, z + 1.2), 6, w * 0.45, 3, '#ffffff');
    WORLD_ANIM.push(function (now) { tex.offset.y = (now * 0.9) % 1; });
  }
  function ruins(x, z, ry) {
    var g = group([x, hillH(x, z) - 0.3, z], ry), y = 0;
    [[13, 2.2], [10, 2.2], [7, 2.2], [4.4, 2.0]].forEach(function (st, i) {
      g.add(box(st[0], st[1], st[0], i % 2 ? '#a19f86' : '#949279', [0, y + st[1] / 2, 0]));
      for (var m = 0; m < 3; m++) g.add(sphere(rr(0.6, 1.2), '#4f8a3a', [rr(-st[0] / 2, st[0] / 2), y + st[1], st[0] / 2 * (m % 2 ? 1 : -1) * 0.9], [1, 0.35, 1], 8));
      y += st[1];
    });
    g.add(box(3, 2.4, 3, '#8a8873', [0, y + 1.2, 0])); g.add(box(1, 1.5, 0.1, '#2a2a22', [0, y + 0.75, 1.52]));
    var stair = box(2.4, 0.3, Math.hypot(y, 6.5), '#b0ae96', [0, y / 2, 6.5 / 2 + 1.0]); stair.rotation.x = Math.atan2(y, 6.5); g.add(stair);
    statics.add(outline(g, 1.01));
  }
  function jungle() {
    INNER_TREES.forEach(function (t) { palmTree(t[0], t[1], 1, 0.6); });
    var clear = function (x, z) { return !(Math.abs(x) < 24 && z < -42 && z > -70); };
    outsideSpots(80, 2, 48, 5, 71, clear).forEach(function (s) { jungleTree(s[0], s[1], rr(0.9, 1.35), s[2] < 12); });
    outsideSpots(22, 0.8, 14, 3.5, 72, clear).forEach(function (s) { palmTree(s[0], s[1]); });
    outsideSpots(45, 0.6, 22, 2.4, 73, clear).forEach(function (s) { bananaPlant(s[0], s[1]); });
    waterfall(0, -58, 8, 15);
    ruins(-48, -40, 0.7);
    peaks(8, '#3f7a3a', null, 74, -PI * 0.95, PI * 0.25, 30, 50);
    flyers(8, ['#e53935', '#1e88e5', '#fdd835', '#43a047'], V(0, 0, -6), 26, 11, 1.1);
  }

  // ---------------- African bushland: acacias, baobabs, termite mounds, giraffes, elephants, zebras, Kilimanjaro
  function acacia(x, z, k) {
    var t = group([x, hillH(x, z), z], R() * TAU), hgt = rr(3.2, 4.4);
    t.add(rot(cyl(0.16, 0.24, hgt, '#6b4a2b', [0.3, hgt / 2, 0], 7), 0, 0, -0.12));
    [[-0.9, 0.5], [1.2, -0.4], [0.2, 1.1]].forEach(function (b) { var br = cyl(0.07, 0.1, 1.6, '#6b4a2b', [0.5 + b[0] / 2, hgt + 0.5, b[1] / 2], 6); br.rotation.set(b[1] * 0.6, 0, -b[0] * 0.6); t.add(br); });
    [[0.5, hgt + 1.25, 0, 3.0], [1.9, hgt + 1.05, -0.6, 1.8], [-1.0, hgt + 1.1, 0.8, 1.9]].forEach(function (c, i) { t.add(sphere(c[3], i % 2 ? '#6b8c34' : '#7a9a3c', [c[0], c[1], c[2]], [1, 0.22, 1], 12)); });
    t.scale.setScalar(k || rr(0.9, 1.3)); statics.add(outline(t, 1.02)); statics.add(blobShadow(2.8, x, z, hillH(x, z)));
  }
  function baobab(x, z, k) {
    var t = group([x, hillH(x, z), z], R() * TAU);
    t.add(cyl(0.95, 1.45, 5, '#9a8270', [0, 2.5, 0], 10));
    for (var b = 0; b < 7; b++) {
      var a = b / 7 * TAU, br = group([Math.cos(a) * 0.5, 4.9, Math.sin(a) * 0.5]); br.rotation.order = 'YXZ'; br.rotation.y = -a + PI / 2; br.rotation.x = 0.7;
      br.add(cyl(0.1, 0.18, 1.8, '#9a8270', [0, 0.9, 0], 6)); br.add(sphere(0.55, '#7a9a3c', [0, 1.9, 0], [1, 0.6, 1], 8)); t.add(br);
    }
    t.scale.setScalar(k || rr(0.9, 1.2)); statics.add(outline(t, 1.02)); statics.add(blobShadow(2.4, x, z, hillH(x, z)));
  }
  function termiteMound(x, z, k) {
    var t = group([x, hillH(x, z), z], R() * TAU);
    t.add(cone(0.85, 3.0, '#b9784a', [0, 1.5, 0], 8)); t.add(cone(0.5, 1.8, '#a96a3e', [0.6, 0.9, 0.2], 7)); t.add(cone(0.4, 1.3, '#c4834f', [-0.5, 0.65, -0.3], 7));
    t.scale.setScalar(k || rr(0.7, 1.3)); statics.add(outline(t, 1.03));
  }
  function giraffe(x, z, ry) {
    var g = group([x, hillH(x, z), z], ry), c = '#e3b04b', sp = '#8a5a2b';
    g.add(sphere(0.6, c, [0, 2.2, 0], [0.75, 0.7, 1.25]));
    [[0.22, 0.5], [-0.22, 0.5], [0.22, -0.5], [-0.22, -0.5]].forEach(function (l) { g.add(cyl(0.07, 0.06, 2.0, c, [l[0], 1.0, l[1]], 6)); });
    for (var s = 0; s < 12; s++) { var a = rr(0, TAU), zz = rr(-0.6, 0.6); g.add(sphere(0.12, sp, [Math.cos(a) * 0.44, 2.2 + Math.sin(a) * 0.4, zz], [1, 1, 1].map(function () { return 0.6; }), 6)); }
    var neck = group([0, 2.45, 0.55]); neck.rotation.x = 0.35; g.add(neck);
    neck.add(cyl(0.11, 0.19, 2.2, c, [0, 1.1, 0], 8));
    for (var n = 0; n < 4; n++) neck.add(sphere(0.09, sp, [0.12 * (n % 2 ? 1 : -1), 0.4 + n * 0.45, 0.06], [0.6, 1, 0.6], 6));
    var head = group([0, 2.25, 0]); neck.add(head);
    head.add(sphere(0.2, c, [0, 0, 0.2], [0.8, 0.8, 1.6]));
    [-0.08, 0.08].forEach(function (ox) { head.add(cyl(0.025, 0.025, 0.22, sp, [ox, 0.2, 0.05], 5)); head.add(sphere(0.04, sp, [ox, 0.32, 0.05], null, 5)); head.add(sphere(0.03, '#1f2522', [ox * 1.6, 0.06, 0.28], null, 5)); });
    g.add(rot(cyl(0.02, 0.02, 0.8, c, [0, 1.9, -0.75], 4), -0.3));
    movers.add(neck); statics.add(outline(g, 1.03)); statics.add(blobShadow(1.0, x, z, hillH(x, z)));
    return neck;
  }
  function elephant(x, z, ry) {
    var g = group([x, hillH(x, z), z], ry), c = '#8e8e8e';
    g.add(sphere(1.0, c, [0, 1.95, 0], [0.9, 0.85, 1.3]));
    [[0.5, 0.75], [-0.5, 0.75], [0.5, -0.75], [-0.5, -0.75]].forEach(function (l) { g.add(cyl(0.3, 0.27, 1.5, c, [l[0], 0.75, l[1]], 8)); });
    var head = group([0, 2.25, 1.35]); g.add(head);
    head.add(sphere(0.62, c, [0, 0, 0], [0.9, 0.95, 0.85]));
    var t1 = cyl(0.2, 0.25, 0.8, c, [0, -0.45, 0.48], 8); t1.rotation.x = 0.35; head.add(t1);
    var t2 = cyl(0.13, 0.19, 0.8, c, [0, -1.15, 0.62], 8); head.add(t2);
    head.add(rot(cyl(0.11, 0.13, 0.35, c, [0, -1.55, 0.72], 8), -0.5));
    [-1, 1].forEach(function (s) { head.add(rot(cone(0.07, 0.55, '#f4efe4', [s * 0.3, -0.45, 0.55], 6), 1.2)); head.add(sphere(0.06, '#1f2522', [s * 0.33, 0.12, 0.42], null, 6)); });
    var ears = [];
    [-1, 1].forEach(function (s) { var ear = group([s * 0.45, 0.1, -0.05]); ear.add(sphere(0.75, '#9a8f8f', [s * 0.35, 0, -0.1], [0.55, 1.0, 0.12], 10)); ear.rotation.y = s * 0.5; head.add(ear); ears.push(ear); movers.add(ear); });
    g.add(rot(cyl(0.04, 0.04, 0.8, c, [0, 1.7, -1.3], 4), -0.25));
    statics.add(outline(g, 1.02)); statics.add(blobShadow(1.8, x, z, hillH(x, z)));
    return ears;
  }
  function zebra(x, z, ry) {
    var g = group([x, hillH(x, z), z], ry), W = '#f4f2ec', B = '#1f2522';
    g.add(sphere(0.45, W, [0, 1.15, 0], [0.7, 0.75, 1.2], 12));
    for (var s = -2; s <= 2; s++) { var z0 = s * 0.17, f = Math.sqrt(1 - Math.pow(z0 / 0.54, 2)) * 1.03; g.add(sphere(1, B, [0, 1.15, z0], [0.45 * 0.7 * f, 0.45 * 0.75 * f, 0.035], 12)); }
    [[0.17, 0.35], [-0.17, 0.35], [0.17, -0.35], [-0.17, -0.35]].forEach(function (l) { g.add(cyl(0.055, 0.045, 0.85, W, [l[0], 0.43, l[1]], 6)); g.add(cyl(0.05, 0.05, 0.1, B, [l[0], 0.05, l[1]], 6)); });
    var neck = group([0, 1.3, 0.42]); neck.rotation.x = 0.55; g.add(neck);
    neck.add(cyl(0.11, 0.15, 0.7, W, [0, 0.35, 0], 8)); neck.add(box(0.05, 0.6, 0.12, B, [0, 0.4, -0.12]));
    for (var n = 0; n < 3; n++) neck.add(cyl(0.125, 0.125, 0.04, B, [0, 0.15 + n * 0.2, 0], 8));
    var head = group([0, 0.72, 0.05]); neck.add(head); head.rotation.x = 0.7;
    head.add(sphere(0.14, W, [0, 0, 0.12], [0.8, 0.8, 1.9])); head.add(sphere(0.09, B, [0, -0.02, 0.37], [0.9, 0.8, 0.8], 6));
    [-0.07, 0.07].forEach(function (ox) { head.add(cone(0.04, 0.14, W, [ox, 0.14, 0.02], 5)); });
    g.add(rot(cyl(0.02, 0.02, 0.55, B, [0, 1.0, -0.6], 4), -0.3));
    movers.add(neck); statics.add(outline(g, 1.03)); statics.add(blobShadow(0.7, x, z, hillH(x, z)));
    return neck;
  }
  function savanna() {
    INNER_TREES.forEach(function (t) { acacia(t[0], t[1], 0.7); });
    outsideSpots(20, 2, 46, 7, 81).forEach(function (s) { acacia(s[0], s[1]); });
    outsideSpots(4, 6, 40, 14, 82).forEach(function (s) { baobab(s[0], s[1]); });
    outsideSpots(10, 1, 32, 5, 83).forEach(function (s) { termiteMound(s[0], s[1]); });
    outsideSpots(4, 6, 36, 12, 84).forEach(function (s) { for (var i = 0; i < 4; i++) rock(s[0] + rr(-2.5, 2.5), s[1] + rr(-2.5, 2.5), rr(0.8, 1.8), '#b08a62'); });
    var necks = [giraffe(27 + EAST, -8, -1.9), giraffe(29.5 + EAST, -3.5, -2.4), giraffe(-27.5 + WEST, -15, 1.2)];
    var ears = elephant(-31 + WEST, 4, 1.3).concat(elephant(-34.5 + WEST, 9.5, 0.9));
    var grazers = [zebra(28 + EAST, 22, -1.2), zebra(30 + EAST, 24.5, -1.6), zebra(29 + EAST, 27, -0.9), zebra(31.5 + EAST, 21, -2.0), zebra(32 + EAST, 26, -1.4)];
    WORLD_ANIM.push(function (now) {
      necks.forEach(function (n, i) { n.rotation.x = 0.3 + Math.sin(now * 0.4 + i * 2) * 0.22; });
      ears.forEach(function (e, i) { e.rotation.y = (i % 2 ? 1 : -1) * (0.5 + Math.sin(now * 2.2 + i) * 0.35); });
      grazers.forEach(function (n, i) { n.rotation.x = 0.55 + Math.max(0, Math.sin(now * 0.5 + i * 1.7)) * 1.1; });
    });
    var kili = group([-40, -2, -175]);
    kili.add(cyl(14, 70, 42, '#7d8b74', [0, 21, 0], 10)); kili.add(cyl(9, 15, 5, '#f4f7fa', [0, 42, 0], 10));
    statics.add(kili);
    peaks(5, '#9a8f74', null, 85, -PI * 0.3, PI * 0.15, 22, 34);
    flyers(4, ['#3a3530'], V(5, 0, -5), 30, 26, 1.8);
  }

  // ---------------- Pacific island lagoon: a turquoise lagoon, the reef, palms, overwater huts, a canoe, a volcano, dolphins
  function aroundBox(off, t) {                         // a point on the rounded outline `off` metres beyond the farm, t in 0..1
    var x0 = BOX.x0, x1 = BOX.x1, z0 = BOX.z0, z1 = BOX.z1, w = x1 - x0, h = z1 - z0, arc = PI / 2 * off, L = 2 * (w + h) + 4 * arc, s = (t % 1 + 1) % 1 * L;
    var segs = [[w, function (u) { return [x0 + u, z0 - off, 0]; }], [arc, function (u) { var a = -PI / 2 + u / off; return [x1 + Math.cos(a) * off, z0 + Math.sin(a) * off, a + PI / 2]; }],
                [h, function (u) { return [x1 + off, z0 + u, PI / 2]; }], [arc, function (u) { var a = u / off; return [x1 + Math.cos(a) * off, z1 + Math.sin(a) * off, a + PI / 2]; }],
                [w, function (u) { return [x1 - u, z1 + off, PI]; }], [arc, function (u) { var a = PI / 2 + u / off; return [x0 + Math.cos(a) * off, z1 + Math.sin(a) * off, a + PI / 2]; }],
                [h, function (u) { return [x0 - off, z1 - u, -PI / 2]; }], [arc, function (u) { var a = PI + u / off; return [x0 + Math.cos(a) * off, z0 + Math.sin(a) * off, a + PI / 2]; }]];
    for (var i = 0; i < segs.length; i++) { if (s <= segs[i][0]) return segs[i][1](s); s -= segs[i][0]; }
    return segs[0][1](0);
  }
  function hut(x, z, ry) {
    var g = group([x, 0, z], ry);
    [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]].forEach(function (p) { g.add(cyl(0.12, 0.12, 3.2, '#7a5233', [p[0], -1.0, p[1]], 6)); });
    g.add(box(3.4, 0.2, 3.4, '#b98b5a', [0, 0.6, 0]));
    g.add(box(2.6, 1.8, 2.6, '#efe3c4', [0, 1.6, 0])); g.add(box(0.8, 1.3, 0.06, '#7a5233', [0, 1.35, 1.32]));
    g.add(rot(cone(2.6, 1.8, '#b08a4a', [0, 3.4, 0], 4), 0, PI / 4, 0));
    statics.add(outline(g, 1.02));
  }
  function island() {
    INNER_TREES.forEach(function (t, i) { palmTree(t[0], t[1], 1, 0.6 + i * 0.3); });
    var sea = mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshToonMaterial({ color: 0x22b3d6, transparent: true, opacity: 0.62, depthWrite: false }));
    sea.rotation.x = -PI / 2; sea.position.y = SEA_Y; scene.add(sea);
    var deep = mesh(new THREE.PlaneGeometry(900, 900), '#1d5a85'); deep.rotation.x = -PI / 2; deep.position.y = -14; scene.add(deep);
    var dry = function (x, z) { return hillH(x, z) > SEA_Y + 0.25; };
    outsideSpots(34, 0.2, 6, 3.2, 91, dry).forEach(function (s) { palmTree(s[0], s[1], rr(0.9, 1.2), rr(0.6, 1.6)); });
    // the reef: surf breaking all round
    var FN = 220, foam = new THREE.InstancedMesh(new THREE.PlaneGeometry(3.4, 0.55), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide }), FN);
    var m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = V(1, 1, 1);
    for (var i = 0; i < FN; i++) { var p = aroundBox(44.5, i / FN); e.set(-PI / 2, 0, -p[2]); q.setFromEuler(e); sc.set(rr(0.7, 1.3), 1, 1); m4.compose(V(p[0], SEA_Y + 0.03, p[1]), q, sc); foam.setMatrixAt(i, m4); }
    scene.add(foam);
    WORLD_ANIM.push(function (now) { foam.material.opacity = 0.45 + Math.sin(now * 1.3) * 0.25; });
    // overwater huts on the east side with a boardwalk from the beach
    var bw = group([0, 0, 0]);
    for (var x = 22.5; x < 36; x += 1.6) { bw.add(box(1.5, 0.12, 1.4, x % 3.2 < 1.6 ? '#b98b5a' : '#a57849', [x + EAST, 0.5, 4])); bw.add(cyl(0.08, 0.08, 2.6, '#7a5233', [x + EAST, -0.8, 4.6], 5)); }
    for (var zb = -4; zb <= 12; zb += 1.6) if (Math.abs(zb - 4) > 0.8) bw.add(box(1.4, 0.12, 1.5, '#b98b5a', [36 + EAST, 0.5, zb]));
    statics.add(bw);
    [[39.5, -4, -PI / 2], [39.5, 4, -PI / 2], [39.5, 12, -PI / 2]].forEach(function (h) { hut(h[0] + EAST, h[1], h[2]); });
    // an outrigger canoe going round the lagoon
    var canoe = group();
    var hull = box(0.7, 0.35, 4.2, '#8a5f3a', [0, 0.1, 0]); canoe.add(hull);
    canoe.add(rot(cone(0.35, 0.8, '#8a5f3a', [0, 0.1, 2.5], 4), PI / 2, PI / 4)); canoe.add(rot(cone(0.35, 0.8, '#8a5f3a', [0, 0.1, -2.5], 4), -PI / 2, PI / 4));
    canoe.add(box(0.25, 0.2, 2.6, '#c9a46a', [1.6, 0.05, 0])); [-0.8, 0.8].forEach(function (bz) { canoe.add(box(1.8, 0.06, 0.08, '#6b4a2b', [0.8, 0.3, bz])); });
    canoe.add(cyl(0.18, 0.22, 0.5, '#e8473c', [0, 0.55, -0.4], 8)); canoe.add(sphere(0.16, '#c98b5a', [0, 0.95, -0.4], null, 8));
    if (merge) merge(canoe, function () { return false; });
    scene.add(canoe);
    WORLD_ANIM.push(function (now) { var p = aroundBox(22, now * 0.004); canoe.position.set(p[0], SEA_Y + 0.05 + Math.sin(now * 1.5) * 0.04, p[1]); canoe.rotation.y = -p[2] + PI / 2; canoe.rotation.z = Math.sin(now * 1.1) * 0.04; });
    // a volcano on a far island, smoking
    var vx = -110, vz = -160, vol = group([vx, -3, vz]);
    vol.add(cyl(70, 80, 4, '#3f8a3a', [0, 1.5, 0], 12)); vol.add(cyl(8, 52, 40, '#6d5a4a', [0, 23, 0], 12)); vol.add(cyl(5, 8, 1.2, '#ff7a2c', [0, 42.6, 0], 12));
    statics.add(vol);
    smoke(V(vx, 45, vz), 9, 14, 40, '#9a9a9a');
    // dolphins leaping in the lagoon
    [0.1, 0.55].forEach(function (ph, i) {
      var d = group(); d.add(sphere(0.5, '#6f8fa8', [0, 0, 0], [0.6, 0.6, 2.2], 10)); d.add(rot(cone(0.25, 0.5, '#6f8fa8', [0, 0.45, -0.1], 6), -0.4)); d.add(rot(box(0.9, 0.06, 0.35, '#6f8fa8', [0, 0, -1.15]), 0, 0, 0));
      d.add(sphere(0.06, '#1f2522', [0.18, 0.1, 0.8], null, 5)); d.add(sphere(0.06, '#1f2522', [-0.18, 0.1, 0.8], null, 5));
      if (merge) merge(d, function () { return false; });
      scene.add(d);
      WORLD_ANIM.push(function (now) {
        var cyc = (now / 7 + ph), k = cyc % 1, lap = Math.floor(cyc), p = aroundBox(30 + i * 6, lap * 0.13 + i * 0.4 + k * 0.012), q2 = aroundBox(30 + i * 6, lap * 0.13 + i * 0.4 + k * 0.012 + 0.002);
        var j = k < 0.35 ? k / 0.35 : 1;                     // leap during the first third, then swim under
        d.visible = k < 0.35;
        d.position.set(p[0], SEA_Y - 0.6 + Math.sin(j * PI) * 2.2, p[1]);
        d.rotation.set(-Math.cos(j * PI) * 0.9, Math.atan2(q2[0] - p[0], q2[1] - p[1]), 0, 'YXZ');
      });
    });
    // tiki torches along the farm's east and west fences, lit at night
    var flames = [];
    [[BOX.x0 - 0.6, 19], [BOX.x0 - 0.6, 27], [BOX.x0 - 0.6, 34.5], [BOX.x1 + 0.6, 19], [BOX.x1 + 0.6, 27], [BOX.x1 + 0.6, 34.5]].forEach(function (t) {
      statics.add(cyl(0.07, 0.09, 2.2, '#6b4a2b', [t[0], 1.1, t[1]], 6)); statics.add(cyl(0.16, 0.12, 0.3, '#3a2a1a', [t[0], 2.3, t[1]], 8));
      var f = mesh(new THREE.ConeGeometry(0.16, 0.5, 8), new THREE.MeshBasicMaterial({ color: 0xffa23d, transparent: true, opacity: 0.9 }), [t[0], 2.7, t[1]]);
      scene.add(f); flames.push(f);
    });
    WORLD_ANIM.push(function (now, dt, n) { flames.forEach(function (f, i) { f.visible = n > 0.25; f.scale.set(1, 0.85 + Math.sin(now * 13 + i) * 0.18, 1); }); });
    flyers(4, ['#ffffff'], V(0, 0, 8), 34, 10, 1.1);
  }

  // ---------------- urban city farm: sidewalks, a ring road with cars, blocks of buildings (lit windows at night),
  // rooftop gardens, water towers, street lights and a billboard
  function city() {
    INNER_TREES.forEach(function (t) { roundTree(t[0], t[1], false, 0.85); });
    var I = { x0: BOX.x0 - 0.6, x1: BOX.x1 + 0.6, z0: BOX.z0 - 0.6, z1: BOX.z1 + 0.6 };
    function grow(r, d) { return { x0: r.x0 - d, x1: r.x1 + d, z0: r.z0 - d, z1: r.z1 + d }; }
    function plane(x0, x1, z0, z1, color, y) { var p = mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), color); p.rotation.x = -PI / 2; p.position.set((x0 + x1) / 2, y, (z0 + z1) / 2); statics.add(p); }
    function ring(a, b, color, y) { plane(b.x0, b.x1, b.z0, a.z0, color, y); plane(b.x0, b.x1, a.z1, b.z1, color, y); plane(b.x0, a.x0, a.z0, a.z1, color, y); plane(a.x1, b.x1, a.z0, a.z1, color, y); }
    var S = grow(I, 3.2), Rd = grow(S, 8), C = grow(Rd, 0.4);
    ring(I, S, '#cfcac0', 0.02); ring(S, Rd, '#4a4d52', 0.025); ring(Rd, C, '#d9d4ca', 0.03);
    function loop(r, t) {                               // a point on a rectangle's outline (t in 0..1) and its heading
      var w = r.x1 - r.x0, h = r.z1 - r.z0, L = 2 * (w + h), s = (t % 1 + 1) % 1 * L;
      if (s < w) return [r.x0 + s, r.z0, PI / 2]; s -= w;
      if (s < h) return [r.x1, r.z0 + s, 0]; s -= h;
      if (s < w) return [r.x1 - s, r.z1, -PI / 2]; s -= w;
      return [r.x0, r.z1 - s, PI];
    }
    var mid = grow(S, 4), per = 2 * ((mid.x1 - mid.x0) + (mid.z1 - mid.z0)), dn = Math.floor(per / 3);
    var dash = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.16, 1.5), new THREE.MeshBasicMaterial({ color: 0xf2e6a0 }), dn), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    for (var i = 0; i < dn; i++) { var p = loop(mid, i / dn); e.set(-PI / 2, 0, -p[2]); q.setFromEuler(e); m4.compose(V(p[0], 0.035, p[1]), q, V(1, 1, 1)); dash.setMatrixAt(i, m4); }
    scene.add(dash);
    for (var zc = 0; zc < 7; zc++) plane(-3 + zc * 1.0, -2.45 + zc * 1.0, S.z1, Rd.z1, '#f4f2ec', 0.04);   // a zebra crossing by the park
    // street lights and trees in planters along the sidewalk
    var lampMat = new THREE.MeshBasicMaterial({ color: 0xb8b8b0 });
    var sw = grow(I, 2.4), swL = 2 * ((sw.x1 - sw.x0) + (sw.z1 - sw.z0));
    for (var li = 0; li < Math.floor(swL / 11); li++) {
      var lp = loop(sw, li / Math.floor(swL / 11)), lg = group([lp[0], 0, lp[1]], lp[2]);
      if (li % 2) { lg.add(cyl(0.07, 0.09, 4.2, '#3d4249', [0, 2.1, 0], 6)); lg.add(box(0.08, 0.08, 1.0, '#3d4249', [0, 4.15, 0.5])); var lamp = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), lampMat); lamp.position.set(0, 4.0, 0.95); lg.add(lamp); }
      else { lg.add(box(1.1, 0.5, 1.1, '#9a958c', [0, 0.25, 0])); var tr = group([0, 0.5, 0]); tr.add(cyl(0.08, 0.1, 1.4, '#6b4a2b', [0, 0.7, 0], 6)); tr.add(sphere(0.8, '#4f9a3e', [0, 1.8, 0], null, 10)); lg.add(tr); }
      statics.add(lg);
    }
    // the blocks: buildings, their windows (one instanced mesh), water towers and rooftop gardens
    var r2 = rng(97), PAL = ['#b5654a', '#c9c4ba', '#8fa9bf', '#e3d7bf', '#a7b6a0', '#d9a77a', '#9aa0a8', '#c98a7a'];
    var wins = [], cell = 15;
    for (var gx = -10; gx <= 10; gx++) for (var gz = -10; gz <= 10; gz++) {
      var cx = gx * cell, cz = gz * cell + 7, half = 4.5 + r2() * 1.6;
      if (cx + half > C.x0 && cx - half < C.x1 && cz + half > C.z0 && cz - half < C.z1) continue;
      var dist = Math.hypot(cx, cz - 7);
      if (dist > 150) continue;
      var bw2 = half * 2 * (0.85 + r2() * 0.15), bd2 = half * 2 * (0.85 + r2() * 0.15), bh = 7 + r2() * (8 + dist * 0.16) + (dist > 70 && r2() < 0.25 ? 30 + r2() * 30 : 0);
      var col = PAL[Math.floor(r2() * PAL.length)];
      statics.add(box(bw2, bh, bd2, col, [cx, bh / 2, cz]));
      statics.add(box(bw2 + 0.3, 0.4, bd2 + 0.3, '#6f6a62', [cx, bh + 0.2, cz]));
      if (dist < 95) {
        var fl = Math.floor((bh - 2) / 3);
        [[0, 1], [0, -1], [1, 0], [-1, 0]].forEach(function (f) {
          var span = f[0] ? bd2 : bw2, nc = Math.floor((span - 1.4) / 2.4);
          for (var a = 0; a < nc; a++) for (var b = 0; b < fl; b++) {
            var u = (a - (nc - 1) / 2) * 2.4, y = 2.4 + b * 3;
            wins.push(f[0] ? [cx + f[0] * (bw2 / 2 + 0.03), y, cz + u, f[0] > 0 ? PI / 2 : -PI / 2] : [cx + u, y, cz + f[1] * (bd2 / 2 + 0.03), f[1] > 0 ? 0 : PI]);
          }
        });
      }
      var roll = r2();
      if (roll < 0.22) {                                // a water tower
        var wt = group([cx + bw2 * 0.2, bh + 0.4, cz - bd2 * 0.2]);
        [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]].forEach(function (l) { wt.add(cyl(0.06, 0.06, 2.2, '#4a3a2a', [l[0], 1.1, l[1]], 5)); });
        wt.add(cyl(1.1, 1.1, 2.2, '#8a5f3a', [0, 3.2, 0], 12)); wt.add(cone(1.25, 0.9, '#5a4a3a', [0, 4.75, 0], 12));
        statics.add(wt);
      } else if (roll < 0.5) {                          // a rooftop garden: raised beds and a little greenhouse
        for (var rb = 0; rb < 3; rb++) { statics.add(box(bw2 * 0.6, 0.45, 0.9, '#8a5f3a', [cx - bw2 * 0.1, bh + 0.62, cz - bd2 * 0.3 + rb * 1.4])); statics.add(box(bw2 * 0.55, 0.3, 0.75, rb % 2 ? '#5fae48' : '#7cc35a', [cx - bw2 * 0.1, bh + 0.95, cz - bd2 * 0.3 + rb * 1.4])); }
        statics.add(mesh(new THREE.BoxGeometry(2.2, 1.6, 1.8), GLASS, [cx + bw2 * 0.28, bh + 1.2, cz + bd2 * 0.25]));
      } else if (roll < 0.75) statics.add(box(1.4, 0.9, 1.0, '#b9bdc2', [cx + bw2 * 0.25, bh + 0.85, cz]));
    }
    var winGeo = new THREE.PlaneGeometry(1.2, 1.6), winMesh = new THREE.InstancedMesh(winGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), Math.max(1, wins.length)), wc = new THREE.Color();
    wins.forEach(function (w, k) { e.set(0, w[3], 0); q.setFromEuler(e); m4.compose(V(w[0], w[1], w[2]), q, V(1, 1, 1)); winMesh.setMatrixAt(k, m4); winMesh.setColorAt(k, wc.set('#56718c')); });
    scene.add(winMesh);
    var lit = -1, rnd = wins.map(function () { return r2(); });
    WORLD_ANIM.push(function (now, dt, n) {
      var want = n > 0.45 ? 1 : 0;
      if (want === lit) return;
      lit = want;
      wins.forEach(function (w, k) { winMesh.setColorAt(k, wc.set(want ? (rnd[k] < 0.55 ? '#ffd98a' : '#2b3440') : (rnd[k] < 0.5 ? '#56718c' : '#6d8aa6'))); });
      if (winMesh.instanceColor) winMesh.instanceColor.needsUpdate = true;
      lampMat.color.set(want ? '#fff2b0' : '#b8b8b0');
    });
    // cars going round
    var CARS = ['#e8473c', '#2f7be0', '#f2c230', '#f4f2ec', '#2f3a40', '#43a047', '#ff8a3d', '#8e44ad'];
    for (var ci = 0; ci < 9; ci++) {
      var car = group(), cc = CARS[ci % CARS.length];
      car.add(box(1.8, 0.65, 3.8, cc, [0, 0.55, 0])); car.add(box(1.55, 0.55, 1.9, '#2f3a40', [0, 1.1, -0.2]));
      [[0.85, 1.2], [-0.85, 1.2], [0.85, -1.2], [-0.85, -1.2]].forEach(function (wpos) { car.add(rot(cyl(0.33, 0.33, 0.25, '#1f2522', [wpos[0], 0.33, wpos[1]], 10), 0, 0, PI / 2)); });
      car.add(box(0.4, 0.15, 0.05, '#fff6c0', [0.55, 0.62, 1.91])); car.add(box(0.4, 0.15, 0.05, '#fff6c0', [-0.55, 0.62, 1.91]));
      if (merge) merge(car, function () { return false; });
      scene.add(car);
      (function (cr, k) {
        var lane = k % 2 ? grow(S, 2.2) : grow(S, 5.8), dir = k % 2 ? 1 : -1, ph = k / 9, sp = 0.006 + (k % 3) * 0.0012;
        WORLD_ANIM.push(function (now) { var p = loop(lane, ph + dir * now * sp); cr.position.set(p[0], 0, p[1]); cr.rotation.y = p[2] + (dir < 0 ? PI : 0); });
      })(car, ci);
    }
    // a billboard facing the farm
    var bb = group([C.x1 + 6, 0, C.z1 + 6], -PI * 0.75);
    [-2.6, 2.6].forEach(function (x) { bb.add(cyl(0.12, 0.12, 6, '#3d4249', [x, 3, 0], 6)); });
    var bc = textCanvas('GROW LOCAL · NEVET', { px: 64, bg: '#2f7a3c', color: '#ffffff', radius: 12, stroke: '#f2c230' });
    var board = new THREE.Mesh(new THREE.PlaneGeometry(7, 7 * bc.height / bc.width), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(bc), side: THREE.DoubleSide }));
    board.position.set(0, 6, 0.1); bb.add(board);
    scene.add(bb);
    flyers(6, ['#8f949c', '#a3a8b0'], V(0, 0, 6), 16, 7, 0.8);
  }
  var GLASS = new THREE.MeshToonMaterial({ color: 0xbfe6f0, transparent: true, opacity: 0.45, depthWrite: false });
  var SCENERY = { snow: snow, jungle: jungle, savanna: savanna, island: island, city: city };

  (function () {
    if (WORLD === 'classic') {
      INNER_TREES.forEach(function (t, i) { roundTree(t[0], t[1], i === 0); });
      outsideSpots(32, 3.5, 30, 5, 21).forEach(function (s2, i) { roundTree(s2[0], s2[1], i % 4 === 0); });
    } else if (WORLD === 'desert') {
      INNER_TREES.forEach(function (t, i) { if (i === 1) cactus(t[0], t[1], 1.1); else palmTree(t[0], t[1], 1, 0.7); });
      [[19.1, 7.0], [19.2, 14.1]].forEach(function (p) { palmTree(p[0], p[1], 1.05); EXTRA_OBST.push(p); });   // the oasis
      outsideSpots(14, 1.5, 12, 3.5, 31).forEach(function (s2) { palmTree(s2[0], s2[1]); });
      outsideSpots(26, 2, 40, 4, 32).forEach(function (s2) { cactus(s2[0], s2[1]); });
      outsideSpots(14, 3, 45, 5, 33).forEach(function (s2) { rock(s2[0], s2[1], rr(0.5, 1.4), '#c98c5c'); });
      // red mesas far away, flat-topped and banded
      for (var mI = 0; mI < 9; mI++) {
        var ang = -PI * 0.95 + mI / 8 * PI * 1.25 + rr(-0.12, 0.12), dist = rr(120, 175), mx = Math.cos(ang) * dist, mz = Math.sin(ang) * dist;
        var rad = rr(9, 18), hh = rr(10, 22), mg = group([mx, hillH(mx, mz) - 1, mz]);
        mg.add(cyl(rad, rad * 1.18, hh * 0.55, '#c8734a', [0, hh * 0.275, 0], 9));
        mg.add(cyl(rad * 0.86, rad, hh * 0.45, '#d98c5c', [0, hh * 0.55 + hh * 0.225, 0], 9));
        mg.add(cyl(rad * 0.88, rad * 0.86, 0.6, '#b8603d', [0, hh + 0.3, 0], 9));
        mg.scale.set(1, 1, rr(0.6, 1.4)); mg.rotation.y = R() * TAU;
        statics.add(mg);
      }
      animal('camel', 26.5 + EAST, 7.5, -2.2); animal('camel', 28.4 + EAST, 11.2, -1.4);
      // tumbleweeds rolling by
      for (var tw = 0; tw < 3; tw++) {
        var weed = mesh(new THREE.IcosahedronGeometry(0.45, 1), mat('#a8834f', { wireframe: true }));
        weed.userData = { z: [-30, 42, -36][tw], sp: rr(1.6, 2.6), ph: rr(0, 120) };
        scene.add(weed);
        WORLD_ANIM.push(function (now) { var u = weed.userData, x = ((now * u.sp + u.ph) % 120) - 60; weed.position.set(x, hillH(x, u.z) + 0.45 + Math.abs(Math.sin(now * 3 + u.ph)) * 0.3, u.z); weed.rotation.z = -now * u.sp / 0.45; });
      }
    } else if (WORLD === 'seaside') {
      INNER_TREES.forEach(function (t, i) { palmTree(t[0], t[1], 1, [0.8, 0.5][i % 2]); });
      var dry = function (x, z) { return z > -22; };
      outsideSpots(14, 1.5, 14, 3.5, 41, dry).forEach(function (s2) { palmTree(s2[0], s2[1]); });
      outsideSpots(22, 4, 38, 4.5, 42, dry).forEach(function (s2) { pine(s2[0], s2[1], rr(0.9, 1.3), s2[2] < 14); });
      // the sea, with waves rolling onto the beach
      var sea = mesh(new THREE.PlaneGeometry(900, 400), new THREE.MeshToonMaterial({ color: 0x3f9bd8 }));
      sea.rotation.x = -PI / 2; sea.position.set(0, SEA_Y, -26 - 200); scene.add(sea);
      var shallow = mesh(new THREE.PlaneGeometry(900, 7), new THREE.MeshBasicMaterial({ color: 0x8fd6ee, transparent: true, opacity: 0.55, depthWrite: false }));
      shallow.rotation.x = -PI / 2; shallow.position.set(0, SEA_Y + 0.01, -31.5); scene.add(shallow);
      for (var wv = 0; wv < 6; wv++) {
        var foam = mesh(new THREE.PlaneGeometry(260, 0.45), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
        foam.rotation.x = -PI / 2; foam.userData.ph = wv / 6;
        scene.add(foam);
        WORLD_ANIM.push(function (now) { var f = foam, k = (now * 0.07 + f.userData.ph) % 1; f.position.set(0, SEA_Y + 0.02, -28.6 - (1 - k) * 14); f.material.opacity = Math.sin(k * PI) * 0.75; f.scale.y = 1 + k * 1.5; });
      }
      // the lighthouse on a rocky point, with a beam that sweeps round at night
      var LH = V(-27, 0, -31);
      for (var rk = 0; rk < 9; rk++) rock(LH.x + rr(-3.5, 3.5), LH.z + rr(-3, 3), rr(1.2, 2.2), '#8f8a80');
      var lh = group([LH.x, 0.6, LH.z]);
      for (var band = 0; band < 6; band++) lh.add(cyl(1.25 - band * 0.12, 1.37 - band * 0.12, 1.5, band % 2 ? '#d8402f' : '#f6f1e4', [0, 0.75 + band * 1.5, 0], 14));
      lh.add(cyl(1.2, 1.2, 0.18, '#2f3a40', [0, 9.1, 0], 14));
      lh.add(cyl(0.7, 0.7, 1.1, '#fff2a8', [0, 9.75, 0], 12));
      lh.add(cone(0.95, 1.0, '#d8402f', [0, 10.8, 0], 12));
      statics.add(outline(lh, 1.02));
      var beam = group([LH.x, 10.35, LH.z]);
      [1, -1].forEach(function (s2) {
        var bm = mesh(new THREE.ConeGeometry(1.6, 26, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
        bm.geometry.translate(0, -13, 0); bm.rotation.z = s2 * PI / 2; beam.add(bm);
      });
      scene.add(beam);
      WORLD_ANIM.push(function (now, dt, n) { beam.rotation.y = now * 0.8; beam.children.forEach(function (b2) { b2.material.opacity = 0.015 + n * 0.11; }); });
      // a wooden pier, beach umbrellas and towels
      var pier = group([7, 0, -21.5]);
      for (var pk = 0; pk < 10; pk++) {
        var pz = -pk * 2.2;
        pier.add(box(2.2, 0.16, 2.1, pk % 2 ? '#b98b5a' : '#a57849', [0, 0.35, pz - 1.1]));
        [-1, 1].forEach(function (s2) { pier.add(cyl(0.12, 0.12, 2.6, '#7a5233', [s2 * 1.0, -0.9, pz - 1.1], 6)); });
      }
      statics.add(pier);
      [[-6, -24.2, '#ff5e7a'], [-1.5, -23.8, '#ffd84d'], [2.8, -24.6, '#4fc3f7']].forEach(function (u2) {
        var um = group([u2[0], hillH(u2[0], u2[1]), u2[1]]);
        um.add(cyl(0.05, 0.05, 2.3, '#f4efe4', [0, 1.15, 0], 6));
        um.add(cone(1.4, 0.6, u2[2], [0, 2.4, 0], 12));
        var towel = mesh(new THREE.PlaneGeometry(0.9, 1.8), mat(u2[2] === '#ffd84d' ? '#4fc3f7' : '#ffd84d', { side: THREE.DoubleSide }), [1.0, 0.04, 0.4]); towel.rotation.x = -PI / 2;
        um.add(towel);
        statics.add(um);
      });
      // sailboats out at sea and gulls over the beach
      [[-60, -58, 1.3], [40, -82, 0.9], [-10, -110, 1.1]].forEach(function (b2, i) {
        var boat = group();
        var hull = box(3.2, 0.7, 1.1, i === 1 ? '#d8402f' : '#f6f1e4', [0, 0.25, 0]); hull.scale.set(1, 1, 1); boat.add(hull);
        boat.add(box(0.6, 0.72, 1.12, '#2f3a40', [1.4, 0.25, 0]));
        boat.add(cyl(0.06, 0.06, 4.2, '#7a5233', [0, 2.4, 0], 6));
        var sail = new THREE.Shape(); sail.moveTo(0, 0); sail.lineTo(0, 3.6); sail.lineTo(-2.2, 0); sail.lineTo(0, 0);
        boat.add(mesh(new THREE.ShapeGeometry(sail), mat('#ffffff', { side: THREE.DoubleSide }), [-0.1, 0.8, 0]));
        boat.userData = { x0: b2[0], z: b2[1], sp: b2[2], ph: i * 2 };
        scene.add(boat);
        WORLD_ANIM.push(function (now) { var u = boat.userData, x = ((u.x0 + now * u.sp + 150) % 300) - 150; boat.position.set(x, SEA_Y + 0.1 + Math.sin(now * 1.2 + u.ph) * 0.08, u.z); boat.rotation.z = Math.sin(now * 0.9 + u.ph) * 0.05; });
      });
      for (var gl = 0; gl < 6; gl++) {
        var gull = group(), wingL = group(), wingR = group();
        wingL.add(box(0.7, 0.04, 0.18, '#ffffff', [-0.35, 0, 0])); wingR.add(box(0.7, 0.04, 0.18, '#ffffff', [0.35, 0, 0]));
        gull.add(wingL); gull.add(wingR); gull.add(sphere(0.12, '#ffffff', [0, 0, 0], [1, 0.8, 1.8], 8));
        gull.userData = { c: V(rr(-20, 20), rr(7, 13), rr(-34, -24)), r: rr(4, 9), sp: rr(0.25, 0.45) * (gl % 2 ? 1 : -1), ph: rr(0, TAU), l: wingL, rr: wingR };
        scene.add(gull);
        WORLD_ANIM.push(function (now) { var u = gull.userData, a = now * u.sp + u.ph, fl = Math.sin(now * 5 + u.ph) * 0.45; gull.position.set(u.c.x + Math.cos(a) * u.r, u.c.y + Math.sin(now * 0.7 + u.ph) * 0.6, u.c.z + Math.sin(a) * u.r); gull.rotation.y = -a + (u.sp > 0 ? 0 : PI); u.l.rotation.z = fl; u.rr.rotation.z = -fl; });
      }
    } else if (WORLD === 'forest') {                   // deep forest
      INNER_TREES.forEach(function (t) { pine(t[0], t[1], 1.1, true); });
      outsideSpots(230, 1.2, 48, 2.5, 51).forEach(function (s2) { if (R() < 0.12) roundTree(s2[0], s2[1], false, rr(1.0, 1.4)); else pine(s2[0], s2[1], rr(1.0, 1.7), s2[2] < 10); });
      outsideSpots(10, 1, 20, 4, 52).forEach(function (s2) { rock(s2[0], s2[1], rr(0.6, 1.2), '#8a8a82', true); });
      outsideSpots(7, 1, 16, 5, 53).forEach(function (s2) {             // fallen logs
        var lg = cyl(0.32, 0.36, rr(2.6, 4.2), '#6b4a2b', [s2[0], hillH(s2[0], s2[1]) + 0.32, s2[1]], 9);
        lg.rotation.set(0, R() * TAU, PI / 2); lg.rotation.order = 'YZX';
        statics.add(outline(lg, 1.03));
      });
      var deer = [animal('deer', 25.0 + EAST, -5.5, -1.9), animal('deer', 26.6 + EAST, -2.6, -2.5)];
      WORLD_ANIM.push(function (now) { deer.forEach(function (hd, i) { hd.rotation.x = 0.2 + Math.max(0, Math.sin(now * 0.5 + i * 2)) * 0.7; }); });   // grazing
      movers.add(deer[0]); movers.add(deer[1]);
    } else if (SCENERY[WORLD]) SCENERY[WORLD]();
  })();

  }

  window.NevetWorlds = { CONFIG: CONFIG, build: build };
})();
