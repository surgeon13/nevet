/* hero3d.js - Procedural 3D chibi heroes for Nevet (three.js r128).
 *
 * Every hero is built from simple shapes at runtime, driven by an
 * appearance object like:
 *   { skin, hair, hairColor, eyes, eyeColor, mouth, outfitColor,
 *     head, body, hand, back, pet }
 * whose values are option ids from static/assets/heroes/catalog.json.
 *
 * To add a new item: add it to catalog.json, then add a builder for its
 * id in the matching table below (HEAD, BODY, HAND, BACK, PET, HAIR).
 * Items without a builder simply don't render, so the catalog can run
 * ahead of the art.
 *
 * API (window.NevetHero):
 *   build(appearance, catalog)                -> THREE.Group
 *   viewer(canvas, wrap, appearance, catalog) -> { set(appearance) }
 *   snapshot(appearance, catalog, w, h)       -> PNG data URL (full body)
 *   itemIcon(catId, optId, appearance, catalog, size) -> data URL or null
 *   faceIcon(appearance, catalog, size)       -> data URL (2D face)
 */
(function () {
  if (typeof THREE === 'undefined') return;

  var HEAD_Y = 1.5, HEAD_R = 0.55;
  var HAND = new THREE.Vector3(0.46, 0.58, 0.02);
  var PET = new THREE.Vector3(-0.95, 0, 0.3);
  var OUTLINE_COLOR = 0x1f2522;
  var PI = Math.PI;

  // ---------- catalog lookups ----------
  function findOpt(catalog, catId, optId) {
    var cats = catalog.looks.concat(catalog.gear);
    for (var i = 0; i < cats.length; i++) {
      if (cats[i].id !== catId) continue;
      var opts = cats[i].options;
      for (var j = 0; j < opts.length; j++) if (opts[j].id === optId) return opts[j];
      return opts[0];
    }
    return null;
  }
  function colorOf(catalog, catId, optId, fallback) {
    var o = findOpt(catalog, catId, optId);
    return (o && o.color) || fallback;
  }
  function resolve(a, catalog) {
    return {
      a: a,
      skin: colorOf(catalog, 'skin', a.skin, '#efc4a3'),
      hairColor: colorOf(catalog, 'hairColor', a.hairColor, '#6b4226'),
      eyeColor: colorOf(catalog, 'eyeColor', a.eyeColor, '#6b4226'),
      outfit: colorOf(catalog, 'outfitColor', a.outfitColor, '#4c9a5b')
    };
  }

  // ---------- materials & shape helpers ----------
  function mat(color, opts) {
    var o = { color: new THREE.Color(color) };
    if (opts) for (var k in opts) o[k] = opts[k];
    return new THREE.MeshToonMaterial(o);
  }
  function shade(hex, amount) {
    var c = new THREE.Color(hex);
    var hsl = {}; c.getHSL(hsl);
    c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + amount)));
    return '#' + c.getHexString();
  }
  function mesh(geo, color, pos, opts) {
    var m = new THREE.Mesh(geo, color && color.isMaterial ? color : mat(color, opts));
    if (pos) m.position.set(pos[0], pos[1], pos[2]);
    return m;
  }
  function sphere(r, color, pos, scale, opts) {
    var m = mesh(new THREE.SphereGeometry(r, 20, 14), color, pos, opts);
    if (scale) m.scale.set(scale[0], scale[1], scale[2]);
    return m;
  }
  function cyl(rt, rb, h, color, pos, seg, opts) {
    return mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 20), color, pos, opts);
  }
  function box(w, h, d, color, pos) { return mesh(new THREE.BoxGeometry(w, h, d), color, pos); }
  function group(pos) {
    var g = new THREE.Group();
    if (pos) g.position.set(pos[0], pos[1], pos[2]);
    return g;
  }
  function onHead(r, polar, azimuth) {
    // point on a sphere around the head centre; polar from the top,
    // azimuth 0 = facing front (+z), positive = hero's left (+x)
    return new THREE.Vector3(
      r * Math.sin(polar) * Math.sin(azimuth),
      HEAD_Y + r * Math.cos(polar),
      r * Math.sin(polar) * Math.cos(azimuth)
    );
  }
  function pointOut(obj, from, to) {
    var dir = new THREE.Vector3().subVectors(to, from).normalize();
    obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  }
  var noOutline = function (m) { m.userData.noOutline = true; return m; };

  // ---------- face (drawn on a canvas, shared by 3D head and 2D icons) ----------
  function drawFace(g, cx, cy, s, eyes, eyeColor, mouth) {
    var dark = '#231b17';
    function eye(x, kind) {
      g.save();
      g.translate(x, cy);
      if (kind === 'happy' || kind === 'sleepy') {
        var up = kind === 'happy';
        g.lineCap = 'round';
        [['rgba(255,255,255,0.55)', 8], [dark, 4.8]].forEach(function (st) {
          g.strokeStyle = st[0]; g.lineWidth = st[1] * s;
          g.beginPath();
          if (up) g.arc(0, 4 * s, 9 * s, PI * 1.15, PI * 1.85); else g.arc(0, -3 * s, 9 * s, PI * 0.15, PI * 0.85);
          g.stroke();
        });
      } else {
        // white of the eye + dark rim: reads on every skin tone
        var big = kind === 'sparkle' ? 1.18 : 1;
        g.fillStyle = '#ffffff';
        g.strokeStyle = dark; g.lineWidth = 2.6 * s;
        g.beginPath(); g.ellipse(0, 0, 9.5 * s * big, 12.5 * s * big, 0, 0, PI * 2); g.fill(); g.stroke();
        g.fillStyle = eyeColor;
        g.beginPath(); g.ellipse(0, 2 * s, 7 * s * big, 9.5 * s * big, 0, 0, PI * 2); g.fill();
        g.fillStyle = dark;
        g.beginPath(); g.ellipse(0, 3 * s, 3.2 * s * big, 4.5 * s * big, 0, 0, PI * 2); g.fill();
        g.fillStyle = '#ffffff';
        g.beginPath(); g.arc(-3.5 * s * big, -4.5 * s * big, 3.4 * s * big, 0, PI * 2); g.fill();
        if (kind === 'sparkle') {
          g.beginPath(); g.arc(3.5 * s, 5 * s, 1.8 * s, 0, PI * 2); g.fill();
        }
      }
      g.restore();
    }
    var dx = 27 * s;
    eye(cx - dx, eyes === 'wink' ? 'round' : eyes);
    eye(cx + dx, eyes === 'wink' ? 'happy' : eyes);

    // cheeks
    g.fillStyle = 'rgba(240, 110, 120, 0.32)';
    g.beginPath(); g.ellipse(cx - 42 * s, cy + 17 * s, 9 * s, 5.5 * s, 0, 0, PI * 2); g.fill();
    g.beginPath(); g.ellipse(cx + 42 * s, cy + 17 * s, 9 * s, 5.5 * s, 0, 0, PI * 2); g.fill();

    // mouth
    var my = cy + 25 * s;
    g.strokeStyle = dark; g.fillStyle = '#8a2f36'; g.lineWidth = 3.5 * s; g.lineCap = 'round';
    if (mouth === 'grin') {
      g.beginPath(); g.arc(cx, my - 3 * s, 9 * s, 0.1, PI - 0.1); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#fff'; g.fillRect(cx - 6 * s, my - 2.5 * s, 12 * s, 3 * s);
    } else if (mouth === 'neutral') {
      g.beginPath(); g.moveTo(cx - 6 * s, my); g.lineTo(cx + 6 * s, my); g.stroke();
    } else if (mouth === 'open') {
      g.beginPath(); g.ellipse(cx, my + 1 * s, 5 * s, 6.5 * s, 0, 0, PI * 2); g.fill(); g.stroke();
    } else if (mouth === 'cat') {
      g.beginPath(); g.arc(cx - 4.5 * s, my - 2 * s, 4.5 * s, 0.1, PI - 0.1); g.stroke();
      g.beginPath(); g.arc(cx + 4.5 * s, my - 2 * s, 4.5 * s, 0.1, PI - 0.1); g.stroke();
    } else {
      g.beginPath(); g.arc(cx, my - 6 * s, 8 * s, 0.35, PI - 0.35); g.stroke();
    }
  }

  function headTexture(R) {
    // Equirectangular skin texture; three.js puts the sphere's front
    // (+z) at u = 0.25, so the face is drawn centred at x = 128.
    var c = document.createElement('canvas');
    c.width = 512; c.height = 256;
    var g = c.getContext('2d');
    g.fillStyle = R.skin;
    g.fillRect(0, 0, 512, 256);
    drawFace(g, 128, 140, 1, R.a.eyes, R.eyeColor, R.a.mouth);
    var t = new THREE.CanvasTexture(c);
    t.anisotropy = 4;
    return t;
  }

  // ---------- head ----------
  function buildHead(R) {
    var g = group();
    var head = mesh(new THREE.SphereGeometry(HEAD_R, 40, 28), mat('#ffffff', { map: headTexture(R) }), [0, HEAD_Y, 0]);
    g.add(head);
    g.add(sphere(0.1, R.skin, [0.54, HEAD_Y - 0.03, 0], [0.6, 1, 0.8]));
    g.add(sphere(0.1, R.skin, [-0.54, HEAD_Y - 0.03, 0], [0.6, 1, 0.8]));
    return g;
  }

  // ---------- hair ----------
  // hats that sit low on the forehead hide the fringe
  var LOW_HATS = { sun_cap: 1, beanie: 1, mushroom_cap: 1 };
  function hairCap(R, g) {
    var cap = mesh(new THREE.SphereGeometry(0.585, 36, 18, 0, PI * 2, 0, PI * 0.44), mat(R.hairColor, { side: THREE.DoubleSide }), [0, HEAD_Y, 0]);
    cap.rotation.x = -0.4;
    g.add(cap);
    if (LOW_HATS[R.a.head]) return;
    [-0.42, 0, 0.42].forEach(function (az) {
      var p = onHead(0.57, 0.98, az);
      var bang = sphere(0.16, R.hairColor, [p.x, p.y, p.z], [1.1, 0.55, 0.75]);
      bang.lookAt(new THREE.Vector3(0, HEAD_Y, 0));
      g.add(bang);
    });
  }
  var HAIR = {
    short: function (R, g) { hairCap(R, g); },
    long: function (R, g) {
      hairCap(R, g);
      g.add(mesh(new THREE.CylinderGeometry(0.6, 0.68, 0.85, 28, 1, true, PI * 0.38, PI * 1.24),
        mat(R.hairColor, { side: THREE.DoubleSide }), [0, HEAD_Y - 0.2, 0]));
      g.add(cyl(0.09, 0.13, 0.6, R.hairColor, [0.5, HEAD_Y - 0.24, 0.14]));
      g.add(cyl(0.09, 0.13, 0.6, R.hairColor, [-0.5, HEAD_Y - 0.24, 0.14]));
    },
    spiky: function (R, g, covered) {
      hairCap(R, g);
      if (covered) return;
      var centre = new THREE.Vector3(0, HEAD_Y, 0);
      [[0.25, 0], [0.55, 1.2], [0.55, -1.2], [0.6, 2.4], [0.6, -2.4], [0.7, PI], [0.95, 0.6], [0.95, -0.6]].forEach(function (pa) {
        var p = onHead(0.62, pa[0], pa[1]);
        var spike = mesh(new THREE.ConeGeometry(0.13, 0.42, 8), R.hairColor, [p.x, p.y, p.z]);
        pointOut(spike, centre, p);
        g.add(spike);
      });
    },
    bun: function (R, g, covered) {
      hairCap(R, g);
      if (covered) return;
      g.add(sphere(0.22, R.hairColor, [0, HEAD_Y + 0.5, -0.3]));
      var band = mesh(new THREE.TorusGeometry(0.13, 0.035, 8, 20), '#c0504d', [0, HEAD_Y + 0.38, -0.22]);
      band.rotation.x = 1.1;
      g.add(band);
    },
    mohawk: function (R, g, covered) {
      if (covered) { hairCap(R, g); return; }
      var centre = new THREE.Vector3(0, HEAD_Y, 0);
      for (var i = 0; i < 7; i++) {
        var alpha = 0.95 - i * 0.36;              // from forehead over the top to the back
        var p = new THREE.Vector3(0, HEAD_Y + 0.6 * Math.cos(alpha), 0.6 * Math.sin(alpha));
        var fin = box(0.1, 0.34 - Math.abs(i - 2) * 0.03, 0.2, R.hairColor, [p.x, p.y, p.z]);
        pointOut(fin, centre, p);
        g.add(fin);
      }
    },
    bald: function () {}
  };
  function buildHair(R, covered) {
    var g = group();
    (HAIR[R.a.hair] || HAIR.short)(R, g, covered);
    return g;
  }

  // ---------- head gear ----------
  var HEAD = {
    straw_hat: function () {
      var g = group([0, 1.93, 0]); g.rotation.x = -0.12;
      g.add(cyl(0.92, 0.92, 0.035, '#dcb65e', [0, 0, 0], 36));
      g.add(cyl(0.42, 0.48, 0.32, '#dcb65e', [0, 0.16, 0], 28));
      g.add(cyl(0.487, 0.487, 0.08, '#b33a3a', [0, 0.05, 0], 28));
      return g;
    },
    sun_cap: function () {
      var g = group([0, HEAD_Y + 0.02, 0]); g.rotation.x = -0.15;
      g.add(mesh(new THREE.SphereGeometry(0.6, 32, 16, 0, PI * 2, 0, PI * 0.5), '#3b7dd8'));
      var visor = mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.03, 28, 1, false, -PI / 2, PI), '#2f66b3', [0, 0.16, 0.3]);
      visor.rotation.x = 0.2;
      g.add(visor);
      g.add(sphere(0.06, '#2f66b3', [0, 0.6, 0]));
      return g;
    },
    beanie: function () {
      var g = group([0, HEAD_Y, 0]); g.rotation.x = -0.12;
      var dome = mesh(new THREE.SphereGeometry(0.6, 32, 16, 0, PI * 2, 0, PI * 0.5), '#c0504d', [0, 0.05, 0]);
      dome.scale.y = 1.15;
      g.add(dome);
      var cuff = mesh(new THREE.TorusGeometry(0.585, 0.08, 10, 36), '#9e3d3a', [0, 0.1, 0]);
      cuff.rotation.x = PI / 2;
      g.add(cuff);
      g.add(sphere(0.15, '#f1efe9', [0, 0.78, 0]));
      return g;
    },
    flower_crown: function () {
      var g = group([0, 1.78, 0]); g.rotation.x = -0.2;
      var ring = mesh(new THREE.TorusGeometry(0.49, 0.045, 8, 40), '#4f8a3a');
      ring.rotation.x = PI / 2;
      g.add(ring);
      var petals = ['#f2a7c3', '#fff1a3', '#ffffff', '#c9a7f2'];
      for (var i = 0; i < 9; i++) {
        var a = i / 9 * PI * 2;
        var f = group([Math.sin(a) * 0.49, 0.03, Math.cos(a) * 0.49]);
        f.add(sphere(0.085, petals[i % petals.length], [0, 0, 0], [1, 0.7, 1]));
        f.add(sphere(0.035, '#f2c230', [0, 0.045, 0]));
        g.add(f);
      }
      return g;
    },
    mushroom_cap: function () {
      var g = group([0, 1.8, 0]);
      var capM = mesh(new THREE.SphereGeometry(0.75, 36, 18, 0, PI * 2, 0, PI * 0.5), '#d9453b');
      capM.scale.y = 0.62;
      g.add(capM);
      g.add(cyl(0.74, 0.74, 0.02, '#f3e6c8', [0, 0, 0], 36));
      [[0.25, 0], [0.6, 0.9], [0.6, -1.4], [0.8, 2.4], [0.9, -0.2], [0.55, 3.6], [1.0, 1.7], [1.0, 4.4]].forEach(function (pa) {
        var sp = sphere(0.085, '#ffffff', [0.75 * Math.sin(pa[0]) * Math.sin(pa[1]), 0.465 * Math.cos(pa[0]), 0.75 * Math.sin(pa[0]) * Math.cos(pa[1])], [1, 0.6, 1]);
        g.add(sp);
      });
      return g;
    },
    sage_hat: function () {
      var g = group([0, 1.9, 0]); g.rotation.x = -0.15;
      g.add(cyl(0.8, 0.8, 0.035, '#5b3fa0', [0, 0, 0], 36));
      var cone = mesh(new THREE.ConeGeometry(0.46, 1.05, 28), '#5b3fa0', [0, 0.52, -0.02]);
      cone.rotation.x = -0.08;
      g.add(cone);
      g.add(cyl(0.458, 0.47, 0.1, '#e3c16f', [0, 0.06, 0], 28));
      g.add(mesh(new THREE.OctahedronGeometry(0.09), '#ffd54a', [0, 0.08, 0.47], { emissive: new THREE.Color('#6b4b00') }));
      return g;
    }
  };

  // ---------- body / outfit ----------
  function baseBody(R, o) {
    // o: { top, sleeves, pants, boots, legs:false }
    var g = group();
    g.add(cyl(0.3, 0.36, 0.56, o.top, [0, 0.82, 0], 28));
    [1, -1].forEach(function (side) {
      g.add(sphere(0.13, o.sleeves, [side * 0.33, 1.02, 0]));
      var arm = group([side * 0.35, 1.02, 0]);
      arm.rotation.z = side * 0.25;
      arm.add(cyl(0.085, o.bell ? 0.14 : 0.095, 0.42, o.sleeves, [0, -0.21, 0], 16));
      arm.add(sphere(0.1, R.skin, [0, -0.45, 0]));
      g.add(arm);
      if (o.legs !== false) {
        g.add(cyl(0.11, 0.1, 0.36, o.pants, [side * 0.14, 0.3, 0], 16));
        g.add(sphere(0.13, o.boots || '#5b3a24', [side * 0.14, 0.07, 0.05], [1, 0.7, 1.35]));
      }
    });
    return g;
  }
  var BODY = {
    tunic: function (R) {
      var g = baseBody(R, { top: R.outfit, sleeves: R.outfit, pants: '#5a4632' });
      g.add(cyl(0.37, 0.41, 0.14, R.outfit, [0, 0.5, 0], 28));
      g.add(cyl(0.365, 0.365, 0.07, '#6b4226', [0, 0.62, 0], 28));
      g.add(box(0.1, 0.08, 0.03, '#e3c16f', [0, 0.62, 0.37]));
      return g;
    },
    overalls: function (R) {
      var denim = '#3f6fb5';
      var g = baseBody(R, { top: R.outfit, sleeves: R.outfit, pants: denim });
      g.add(cyl(0.366, 0.372, 0.26, denim, [0, 0.66, 0], 28));
      g.add(box(0.36, 0.26, 0.05, denim, [0, 0.9, 0.315]));
      g.add(box(0.06, 0.24, 0.04, denim, [0.13, 1.05, 0.28]));
      g.add(box(0.06, 0.24, 0.04, denim, [-0.13, 1.05, 0.28]));
      g.add(sphere(0.03, '#e3c16f', [0.13, 0.97, 0.345]));
      g.add(sphere(0.03, '#e3c16f', [-0.13, 0.97, 0.345]));
      return g;
    },
    apron: function (R) {
      var g = baseBody(R, { top: R.outfit, sleeves: R.outfit, pants: '#4a3b30' });
      g.add(noOutline(mesh(new THREE.CylinderGeometry(0.335, 0.39, 0.62, 24, 1, true, -0.78, 1.56),
        mat('#8b5e3c', { side: THREE.DoubleSide }), [0, 0.62, 0])));
      g.add(box(0.2, 0.12, 0.03, '#6f4a2f', [0, 0.6, 0.39]));
      g.add(box(0.05, 0.2, 0.03, '#8b5e3c', [0.12, 1.02, 0.29]));
      g.add(box(0.05, 0.2, 0.03, '#8b5e3c', [-0.12, 1.02, 0.29]));
      return g;
    },
    hoodie: function (R) {
      var g = baseBody(R, { top: R.outfit, sleeves: R.outfit, pants: '#3e4450' });
      var hood = mesh(new THREE.TorusGeometry(0.22, 0.1, 10, 22), shade(R.outfit, -0.08), [0, 1.12, -0.24]);
      hood.rotation.x = 1.2;
      g.add(hood);
      g.add(box(0.3, 0.14, 0.04, shade(R.outfit, -0.1), [0, 0.7, 0.35]));
      g.add(cyl(0.012, 0.012, 0.18, '#ffffff', [0.06, 0.98, 0.31], 6));
      g.add(cyl(0.012, 0.012, 0.18, '#ffffff', [-0.06, 0.98, 0.31], 6));
      return g;
    },
    leaf_armor: function (R) {
      var g = baseBody(R, { top: '#4f8a3a', sleeves: '#4f8a3a', pants: '#5a4632' });
      [[-0.14, 0.95], [0.14, 0.95], [0, 0.8], [-0.2, 0.72], [0.2, 0.72], [0, 0.63]].forEach(function (p) {
        var leaf = sphere(0.12, '#6bbf59', [p[0], p[1], 0.33], [1, 1.4, 0.35]);
        leaf.rotation.z = p[0] * 1.5;
        g.add(leaf);
      });
      g.add(sphere(0.17, '#6bbf59', [0.34, 1.07, 0], [1.2, 0.75, 1.2]));
      g.add(sphere(0.17, '#6bbf59', [-0.34, 1.07, 0], [1.2, 0.75, 1.2]));
      return g;
    },
    robe: function (R) {
      var g = baseBody(R, { top: R.outfit, sleeves: R.outfit, pants: R.outfit, legs: false, bell: true });
      g.add(cyl(0.37, 0.53, 0.56, R.outfit, [0, 0.28, 0], 28));
      var trim = mesh(new THREE.TorusGeometry(0.525, 0.03, 8, 40), '#e3c16f', [0, 0.02, 0]);
      trim.rotation.x = PI / 2;
      g.add(trim);
      g.add(cyl(0.37, 0.37, 0.07, '#e3c16f', [0, 0.6, 0], 28));
      g.add(box(0.07, 0.34, 0.03, '#e3c16f', [0, 0.87, 0.325]));
      return g;
    }
  };

  // ---------- hand tools (built around the right hand) ----------
  function stick(len, color, y) { return cyl(0.03, 0.03, len, color || '#8b5e3c', [0, y, 0], 10); }
  var METAL = '#b8c1c7';
  var HAND_ITEMS = {
    trowel: function () {
      var g = group();
      g.add(cyl(0.04, 0.04, 0.22, '#8b5e3c', [0, 0, 0], 10));
      g.add(cyl(0.02, 0.02, 0.1, METAL, [0, 0.15, 0], 8));
      g.add(sphere(0.1, METAL, [0, 0.32, 0], [1, 1.7, 0.25]));
      return g;
    },
    watering_can: function () {
      var g = group();
      g.add(cyl(0.17, 0.17, 0.26, '#3a8f8f', [0, -0.18, 0], 22));
      g.add(cyl(0.175, 0.175, 0.03, '#2f7373', [0, -0.05, 0], 22));
      var handle = mesh(new THREE.TorusGeometry(0.11, 0.025, 8, 18, PI), '#2f7373', [0, -0.05, 0]);
      handle.rotation.y = PI / 2;
      g.add(handle);
      var spout = cyl(0.025, 0.035, 0.34, '#3a8f8f', [0, -0.12, 0.26], 10);
      spout.rotation.x = 1.0;
      g.add(spout);
      var rose = mesh(new THREE.ConeGeometry(0.06, 0.07, 12), '#2f7373', [0, 0.02, 0.4]);
      rose.rotation.x = 1.0;
      g.add(rose);
      return g;
    },
    hoe: function () {
      var g = group([0, 0, 0.1]); g.rotation.z = -0.3;
      g.add(stick(1.35, null, 0.25));
      var head = box(0.2, 0.16, 0.03, METAL, [0, 0.9, 0.1]);
      head.rotation.x = 0.35;
      g.add(head);
      return g;
    },
    pitchfork: function () {
      var g = group([0, 0, 0.1]); g.rotation.z = -0.3;
      g.add(stick(1.3, null, 0.2));
      g.add(box(0.26, 0.035, 0.035, METAL, [0, 0.87, 0]));
      [-0.11, 0, 0.11].forEach(function (x) { g.add(cyl(0.018, 0.012, 0.3, METAL, [x, 1.03, 0], 6)); });
      return g;
    },
    sickle: function () {
      var g = group();
      g.add(cyl(0.04, 0.04, 0.3, '#8b5e3c', [0, 0, 0], 10));
      var blade = mesh(new THREE.TorusGeometry(0.2, 0.028, 8, 28, PI * 1.15), '#d7dee3', [0.2, 0.15, 0], { emissive: new THREE.Color('#1c2a38') });
      blade.rotation.y = PI;
      g.add(blade);
      return g;
    },
    staff: function () {
      var g = group([0, 0, 0.1]); g.rotation.z = -0.28;
      g.add(cyl(0.035, 0.045, 1.5, '#5b3a24', [0, 0.3, 0], 10));
      g.add(sphere(0.12, '#8dff9f', [0, 1.15, 0], null, { emissive: new THREE.Color('#2f9a4a') }));
      [0, 2.1, 4.2].forEach(function (a) {
        var leaf = sphere(0.1, '#4f8a3a', [Math.sin(a) * 0.1, 1.05, Math.cos(a) * 0.1], [0.5, 1.4, 0.2]);
        leaf.rotation.y = a;
        leaf.rotation.x = 0.5;
        g.add(leaf);
      });
      return g;
    }
  };
  function buildHandItem(R) {
    var fn = HAND_ITEMS[R.a.hand];
    if (!fn) return null;
    var outer = group([HAND.x, HAND.y, HAND.z]);
    outer.add(fn(R));
    return outer;
  }

  // ---------- back items ----------
  function frontStraps(g, color) {
    g.add(box(0.06, 0.3, 0.03, color, [0.17, 0.96, 0.29]));
    g.add(box(0.06, 0.3, 0.03, color, [-0.17, 0.96, 0.29]));
  }
  var BACK = {
    backpack: function () {
      var g = group();
      g.add(box(0.46, 0.5, 0.24, '#a0713d', [0, 0.85, -0.43]));
      g.add(box(0.47, 0.16, 0.25, '#7d5530', [0, 1.03, -0.43]));
      g.add(box(0.3, 0.16, 0.06, '#7d5530', [0, 0.72, -0.57]));
      frontStraps(g, '#7d5530');
      return g;
    },
    basket: function () {
      var g = group();
      g.add(cyl(0.27, 0.2, 0.36, '#c9a15a', [0, 0.9, -0.47], 18));
      var rim = mesh(new THREE.TorusGeometry(0.27, 0.035, 8, 24), '#a8813f', [0, 1.08, -0.47]);
      rim.rotation.x = PI / 2;
      g.add(rim);
      [[-0.1, 0.05], [0.08, -0.08], [0.12, 0.1]].forEach(function (p) {
        var carrot = mesh(new THREE.ConeGeometry(0.045, 0.28, 10), '#e8772e', [p[0], 1.12, -0.47 + p[1]]);
        carrot.rotation.x = PI;
        g.add(carrot);
        g.add(sphere(0.05, '#4f8a3a', [p[0], 1.28, -0.47 + p[1]], [0.7, 1.2, 0.7]));
      });
      g.add(sphere(0.12, '#7cc56b', [-0.05, 1.12, -0.58]));
      frontStraps(g, '#a8813f');
      return g;
    },
    cape: function () {
      var g = group();
      g.add(noOutline(mesh(new THREE.CylinderGeometry(0.4, 0.62, 1.0, 28, 1, true, PI * 0.6, PI * 0.8),
        mat('#b33a3a', { side: THREE.DoubleSide }), [0, 0.6, 0])));
      g.add(sphere(0.05, '#e3c16f', [0.2, 1.06, 0.22]));
      g.add(sphere(0.05, '#e3c16f', [-0.2, 1.06, 0.22]));
      return g;
    },
    leaf_wings: function () {
      var g = group();
      [1, -1].forEach(function (side) {
        [[1.05, 0.9, 0.45], [0.82, 1.55, 0.32]].forEach(function (w) {
          var leaf = sphere(0.2, '#8ed873', [side * 0.4, w[0], -0.42], [0.55, 2.1 * w[2] / 0.45, 0.12], { emissive: new THREE.Color('#1d4a14') });
          leaf.rotation.z = -side * w[1];
          g.add(leaf);
        });
      });
      return g;
    }
  };

  // ---------- companions ----------
  function petEyes(g, x, y, z, spread) {
    g.add(sphere(0.022, '#1c1714', [x - spread, y, z]));
    g.add(sphere(0.022, '#1c1714', [x + spread, y, z]));
  }
  var PETS = {
    worm: function () {
      var g = group([PET.x, PET.y, PET.z]);
      for (var i = 0; i < 6; i++) {
        var r = 0.11 - i * 0.009;
        g.add(sphere(r, i % 2 ? '#e8909c' : '#f0a1ac', [-i * 0.12, r + 0.02 + Math.sin(i * 1.3) * 0.04, -i * 0.03]));
      }
      g.add(sphere(0.125, '#f0a1ac', [0.1, 0.2, 0.03]));
      petEyes(g, 0.12, 0.24, 0.14, 0.045);
      return g;
    },
    snail: function () {
      var g = group([PET.x, PET.y, PET.z]);
      g.add(sphere(0.12, '#c9d3a8', [0, 0.08, 0], [2.1, 0.65, 0.9]));
      g.add(sphere(0.2, '#c47a3a', [-0.06, 0.3, 0]));
      var swirl = mesh(new THREE.TorusGeometry(0.1, 0.03, 8, 20), '#8d4f22', [-0.06, 0.3, 0.17]);
      g.add(swirl);
      [0.06, -0.06].forEach(function (z) {
        var stalk = cyl(0.015, 0.015, 0.16, '#c9d3a8', [0.2, 0.2, z], 6);
        stalk.rotation.z = -0.3;
        g.add(stalk);
        g.add(sphere(0.035, '#1c1714', [0.23, 0.29, z]));
      });
      return g;
    },
    bee: function () {
      var g = group([-0.85, 1.35, 0.35]);
      g.userData.flying = true;
      g.add(sphere(0.14, '#f2c230', [0, 0, 0], [1.3, 1, 1]));
      [-0.05, 0.07].forEach(function (x) {
        var ring = mesh(new THREE.TorusGeometry(0.128, 0.03, 8, 20), '#2b2622', [x, 0, 0]);
        ring.rotation.y = PI / 2;
        ring.scale.set(1, 0.98, 0.98);
        g.add(ring);
      });
      g.add(sphere(0.09, '#2b2622', [0.2, 0.02, 0]));
      g.add(sphere(0.02, '#ffffff', [0.26, 0.05, 0.05]));
      g.add(sphere(0.02, '#ffffff', [0.26, 0.05, -0.05]));
      [0.09, -0.09].forEach(function (z) {
        var wing = noOutline(sphere(0.12, mat('#e8f6ff', { transparent: true, opacity: 0.75 }), [0, 0.14, z], [0.6, 0.12, 1]));
        wing.rotation.x = z > 0 ? -0.4 : 0.4;
        g.add(wing);
      });
      var sting = mesh(new THREE.ConeGeometry(0.03, 0.08, 8), '#2b2622', [-0.21, 0, 0]);
      sting.rotation.z = PI / 2;
      g.add(sting);
      return g;
    },
    sprout: function () {
      var g = group([PET.x, PET.y, PET.z]);
      g.add(sphere(0.2, '#9be07f', [0, 0.18, 0], [1, 0.85, 1], { emissive: new THREE.Color('#1f4d16') }));
      petEyes(g, 0, 0.21, 0.18, 0.06);
      g.add(cyl(0.015, 0.015, 0.12, '#4f8a3a', [0, 0.4, 0], 6));
      [1, -1].forEach(function (side) {
        var leaf = sphere(0.08, '#6bbf59', [side * 0.07, 0.47, 0], [1.3, 0.35, 0.8]);
        leaf.rotation.z = side * 0.5;
        g.add(leaf);
      });
      return g;
    }
  };

  // ---------- outlines (cel-shaded RPG look) ----------
  var outlineMat = new THREE.MeshBasicMaterial({ color: OUTLINE_COLOR, side: THREE.BackSide });
  function addOutlines(root) {
    var targets = [];
    root.traverse(function (o) {
      if (!o.isMesh || o.userData.noOutline || o.userData.isOutline) return;
      if (o.material.side === THREE.DoubleSide || o.material.transparent) return;
      targets.push(o);
    });
    targets.forEach(function (o) {
      o.geometry.computeBoundingSphere();
      var r = o.geometry.boundingSphere.radius * Math.max(o.scale.x, o.scale.y, o.scale.z);
      var k = Math.min(1.18, Math.max(1.02, 1 + 0.02 / Math.max(r, 0.01)));
      var line = new THREE.Mesh(o.geometry, outlineMat);
      line.userData.isOutline = true;
      line.scale.setScalar(k);
      o.add(line);
    });
  }

  // ---------- full hero ----------
  function build(appearance, catalog) {
    var R = resolve(appearance || {}, catalog);
    var root = new THREE.Group();
    var hero = new THREE.Group();
    root.add(hero);
    hero.add((BODY[R.a.body] || BODY.tunic)(R));
    hero.add(buildHead(R));
    var hat = HEAD[R.a.head];
    hero.add(buildHair(R, !!hat));
    if (hat) hero.add(hat(R));
    var tool = buildHandItem(R);
    if (tool) hero.add(tool);
    if (BACK[R.a.back]) hero.add(BACK[R.a.back](R));
    var pet = PETS[R.a.pet] ? PETS[R.a.pet](R) : null;
    if (pet) root.add(pet);
    addOutlines(root);
    root.userData = { hero: hero, pet: pet, petBase: pet ? pet.position.clone() : null };
    return root;
  }

  function dispose(obj) {
    obj.traverse(function (o) {
      if (o.userData && o.userData.isOutline) return;
      if (o.geometry) o.geometry.dispose();
      if (o.material && o.material !== outlineMat) {
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      }
    });
  }

  function animate(root, t) {
    var u = root.userData;
    if (!u || !u.hero) return;
    u.hero.position.y = Math.sin(t * 2.2) * 0.018;
    if (u.pet) {
      if (u.pet.userData.flying) {
        u.pet.position.set(u.petBase.x + Math.cos(t * 0.9) * 0.12, u.petBase.y + Math.sin(t * 3) * 0.06, u.petBase.z + Math.sin(t * 0.9) * 0.12);
      } else {
        u.pet.position.y = u.petBase.y + Math.abs(Math.sin(t * 2.6)) * 0.04;
      }
    }
  }

  function addLights(scene) {
    scene.add(new THREE.HemisphereLight(0xffffff, 0x7d8a78, 0.52));
    var sun = new THREE.DirectionalLight(0xffffff, 0.58);
    sun.position.set(3, 6, 5);
    scene.add(sun);
  }

  function fitCamera(camera, obj, dir, pad) {
    var bb = new THREE.Box3().setFromObject(obj);
    var size = bb.getSize(new THREE.Vector3()), centre = bb.getCenter(new THREE.Vector3());
    var tanV = Math.tan(camera.fov * PI / 360), tanH = tanV * camera.aspect;
    var radius = size.length() / 2;
    var dist = Math.max(size.y / 2 / tanV, size.x / 2 / tanH, radius / Math.min(tanV, tanH) * 0.72) * (pad || 1.1) + size.z / 2;
    camera.position.copy(centre).add(dir.clone().normalize().multiplyScalar(dist));
    camera.lookAt(centre);
    camera.updateProjectionMatrix();
    return centre;
  }

  // ---------- interactive viewer (customizer + profile) ----------
  function viewer(canvas, wrap, appearance, catalog, opts) {
    opts = opts || {};
    var view = Nevet3D.createView(canvas, wrap, { fov: 32, onFrame: function (t) {
      if (current) animate(current, t);
      if (controls) controls.update();
    }});
    var scene = view.scene, camera = view.camera, current = null, controls = null;
    addLights(scene);

    var accent = Nevet3D.cssColor('--accent', '#4c9a5b');
    var pedestal = cyl(0.95, 1.05, 0.14, Nevet3D.cssColor('--bg-card', '#ffffff'), [0, -0.07, 0], 48);
    scene.add(pedestal);
    var ring = mesh(new THREE.TorusGeometry(1.0, 0.025, 8, 64), new THREE.MeshBasicMaterial({ color: accent }), [0, 0.001, 0]);
    ring.rotation.x = PI / 2;
    scene.add(ring);

    // Frame the tallest possible hero (sage hat ~3.0 high, pet/wings
    // ~1.3 to each side) for whatever shape the stage box has.
    var TARGET = new THREE.Vector3(0, 1.35, 0);
    function frame() {
      var tanV = Math.tan(camera.fov * PI / 360), tanH = tanV * camera.aspect;
      var dist = Math.max(1.65 / tanV, 1.35 / tanH) * 1.06;
      var dir = camera.position.clone().sub(TARGET);
      if (dir.lengthSq() < 0.01) dir.set(0, 0.12, 1);
      camera.position.copy(TARGET).add(dir.normalize().multiplyScalar(dist));
      camera.lookAt(TARGET);
      if (controls) { controls.minDistance = dist * 0.55; controls.maxDistance = dist * 1.6; }
    }
    camera.position.set(0, 1.35 + 0.7, 6);
    if (THREE.OrbitControls) {
      controls = new THREE.OrbitControls(camera, canvas);
      controls.target.copy(TARGET);
      controls.enableDamping = true;
      controls.enablePan = false;
      controls.minPolarAngle = PI * 0.25;
      controls.maxPolarAngle = PI * 0.56;
      controls.autoRotate = !Nevet3D.reducedMotion() && opts.autoRotate !== false;
      controls.autoRotateSpeed = 1.2;
      controls.addEventListener('start', function () { controls.autoRotate = false; });
    }

    frame();
    window.addEventListener('resize', function () { requestAnimationFrame(frame); });

    function set(a) {
      if (current) { scene.remove(current); dispose(current); }
      current = build(a, catalog);
      scene.add(current);
    }
    Nevet3D.onThemeChange(function () {
      pedestal.material.color.set(Nevet3D.cssColor('--bg-card', '#ffffff'));
      ring.material.color.set(Nevet3D.cssColor('--accent', '#4c9a5b'));
    });
    set(appearance);
    return { set: set };
  }

  // ---------- snapshots (one shared offscreen renderer) ----------
  var snap = null;
  function snapper() {
    if (snap) return snap;
    var canvas = document.createElement('canvas');
    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    var scene = new THREE.Scene();
    addLights(scene);
    var camera = new THREE.PerspectiveCamera(30, 1, 0.05, 100);
    snap = { renderer: renderer, scene: scene, camera: camera };
    return snap;
  }
  function renderObject(obj, w, h, dir, pad) {
    var s = snapper();
    s.renderer.setSize(w, h, false);
    s.camera.aspect = w / h;
    s.scene.add(obj);
    fitCamera(s.camera, obj, dir, pad);
    s.renderer.render(s.scene, s.camera);
    var url = s.renderer.domElement.toDataURL('image/png');
    s.scene.remove(obj);
    dispose(obj);
    return url;
  }

  function snapshot(appearance, catalog, w, h) {
    return renderObject(build(appearance, catalog), w || 220, h || 260, new THREE.Vector3(0.2, 0.22, 1), 1.02);
  }

  function itemIcon(catId, optId, appearance, catalog, size) {
    size = size || 96;
    var a = {}; for (var k in appearance) a[k] = appearance[k];
    var R = resolve(a, catalog);
    var g = new THREE.Group();
    var dir = new THREE.Vector3(0.55, 0.35, 1);
    if (catId === 'hair') {
      R.a.hair = optId;
      if (optId === 'bald') return null;
      g.add(buildHead(R));
      g.add(buildHair(R, false));
    } else if (catId === 'head') {
      if (!HEAD[optId]) return null;
      g.add(HEAD[optId](R));
    } else if (catId === 'body') {
      if (!BODY[optId]) return null;
      g.add(BODY[optId](R));
    } else if (catId === 'hand') {
      if (!HAND_ITEMS[optId]) return null;
      g.add(HAND_ITEMS[optId](R));
    } else if (catId === 'back') {
      if (!BACK[optId]) return null;
      g.add(BACK[optId](R));
      dir = new THREE.Vector3(0.9, 0.35, -1);
    } else if (catId === 'pet') {
      if (!PETS[optId]) return null;
      g.add(PETS[optId](R));
    } else {
      return null;
    }
    addOutlines(g);
    return renderObject(g, size, size, dir, 1.05);
  }

  function faceIcon(appearance, catalog, size) {
    size = size || 96;
    var R = resolve(appearance, catalog);
    var c = document.createElement('canvas');
    c.width = c.height = size * 2;
    var g = c.getContext('2d');
    g.fillStyle = R.skin;
    g.beginPath(); g.arc(size, size, size * 0.95, 0, PI * 2); g.fill();
    drawFace(g, size, size * 0.86, size / 58, appearance.eyes, R.eyeColor, appearance.mouth);
    return c.toDataURL('image/png');
  }

  function supported() {
    return typeof Nevet3D !== 'undefined' && Nevet3D.supportsWebGL();
  }

  window.NevetHero = {
    build: build, viewer: viewer, snapshot: snapshot, itemIcon: itemIcon,
    faceIcon: faceIcon, supported: supported
  };
})();
