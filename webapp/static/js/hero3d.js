/* hero3d.js - Procedural 3D chibi heroes for Nevet (three.js r128).
 *
 * Every hero is built from simple shapes at runtime, driven by an
 * appearance object like:
 *   { skin, hair, hairColor, eyes, eyeColor, mouth, facialHair, outfitColor,
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
 *   viewer(canvas, wrap, appearance, catalog) -> { set(appearance), emote(name) }
 *     (heroes breathe, blink and play an emote every few seconds: wave,
 *      look around, hop, tool swing, cheer...; tap the hero for one)
 *   snapshot(appearance, catalog, w, h)       -> PNG data URL (full body)
 *   itemIcon(catId, optId, appearance, catalog, size) -> data URL or null
 *   faceIcon(appearance, catalog, size)       -> data URL (2D face)
 */
(function () {
  if (typeof THREE === 'undefined') return;

  var HEAD_Y = 1.5, HEAD_R = 0.55, NECK_Y = 1.05;
  var HAND = new THREE.Vector3(0.46, 0.58, 0.02);
  var PET = new THREE.Vector3(-0.95, 0, 0.3);
  var OUTLINE_COLOR = 0x1f2522;
  var PI = Math.PI;

  // ---------- catalog lookups ----------
  function findOpt(catalog, catId, optId) {
    var cats = catalog.looks.concat(catalog.gear, catalog.companion || []);
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
      outfit: colorOf(catalog, 'outfitColor', a.outfitColor, '#4c9a5b'),
      petColor: a.petColor && a.petColor !== 'natural' ? colorOf(catalog, 'petColor', a.petColor, null) : null
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
  // flat 5-point star, extruded a little
  function starGeo(r1, r2, depth) {
    var sh = new THREE.Shape();
    for (var i = 0; i < 10; i++) {
      var r = i % 2 ? r2 : r1, a = PI / 2 + i * PI / 5;
      if (i === 0) sh.moveTo(Math.cos(a) * r, Math.sin(a) * r); else sh.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    sh.closePath();
    var geo = new THREE.ExtrudeGeometry(sh, { depth: depth || 0.02, bevelEnabled: false });
    geo.translate(0, 0, -(depth || 0.02) / 2);
    return geo;
  }
  // tiny looping effects, played by animate(): spin, flicker, bob, flap, rise
  function fx(obj, kind, opts) {
    obj.userData.fx = kind;
    obj.userData.fxo = opts || {};
    return obj;
  }

  // ---------- face (drawn on a canvas, shared by 3D head and 2D icons) ----------
  function starPath(g, x, y, r1, r2) {
    g.beginPath();
    for (var i = 0; i < 10; i++) {
      var r = i % 2 ? r2 : r1, a = -PI / 2 + i * PI / 5;
      g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    g.closePath();
  }
  function heartPath(g, x, y, r) {
    g.beginPath();
    g.moveTo(x, y + r * 0.95);
    g.bezierCurveTo(x - r * 1.7, y - r * 0.15, x - r * 0.7, y - r * 1.35, x, y - r * 0.45);
    g.bezierCurveTo(x + r * 0.7, y - r * 1.35, x + r * 1.7, y - r * 0.15, x, y + r * 0.95);
    g.closePath();
  }

  // facial hair, drawn in the hair colour
  function drawFacialHair(g, cx, cy, s, kind, color, skin) {
    if (!kind || kind === 'none') return;
    var my = cy + 25 * s, edge = 'rgba(35, 27, 23, 0.45)';
    g.save();
    g.fillStyle = color; g.strokeStyle = edge; g.lineWidth = 1.2 * s;
    function mustache(w, h, y) {
      [-1, 1].forEach(function (side) {
        g.beginPath(); g.ellipse(cx + side * w * 0.8, y, w, h, side * -0.28, 0, PI * 2); g.fill(); g.stroke();
      });
    }
    function beardShape() {
      g.beginPath();
      g.moveTo(cx - 48 * s, cy + 3 * s);
      g.quadraticCurveTo(cx - 52 * s, cy + 54 * s, cx, cy + 62 * s);
      g.quadraticCurveTo(cx + 52 * s, cy + 54 * s, cx + 48 * s, cy + 3 * s);
      g.lineTo(cx + 40 * s, cy + 6 * s);
      g.quadraticCurveTo(cx + 36 * s, cy + 30 * s, cx + 13 * s, cy + 21 * s);
      g.quadraticCurveTo(cx, cy + 15 * s, cx - 13 * s, cy + 21 * s);
      g.quadraticCurveTo(cx - 36 * s, cy + 30 * s, cx - 40 * s, cy + 6 * s);
      g.closePath();
    }
    if (kind === 'stubble') {
      g.globalAlpha = 0.42;
      beardShape(); g.fill();
    } else if (kind === 'mustache') {
      mustache(7.5 * s, 3.6 * s, my - 9 * s);
    } else if (kind === 'handlebar') {
      mustache(7.5 * s, 3.2 * s, my - 9 * s);
      g.strokeStyle = color; g.lineWidth = 3 * s; g.lineCap = 'round';
      [-1, 1].forEach(function (side) {
        // curl: from the bottom (joined to the mustache) round and up
        g.beginPath(); g.arc(cx + side * 16 * s, my - 12.5 * s, 3.6 * s, PI * 0.5, side > 0 ? PI * 2 : -PI, side < 0); g.stroke();
      });
    } else if (kind === 'goatee') {
      mustache(6 * s, 2.8 * s, my - 9 * s);
      g.beginPath();
      g.moveTo(cx - 8 * s, my + 5 * s);
      g.quadraticCurveTo(cx, my + 24 * s, cx + 8 * s, my + 5 * s);
      g.quadraticCurveTo(cx, my + 9 * s, cx - 8 * s, my + 5 * s);
      g.fill(); g.stroke();
    } else if (kind === 'chevron') {
      g.beginPath();
      g.moveTo(cx - 14 * s, my - 5 * s);
      g.quadraticCurveTo(cx, my - 17 * s, cx + 14 * s, my - 5 * s);
      g.lineTo(cx + 10 * s, my - 2.5 * s);
      g.quadraticCurveTo(cx, my - 9 * s, cx - 10 * s, my - 2.5 * s);
      g.closePath(); g.fill(); g.stroke();
    } else if (kind === 'soul_patch') {
      g.beginPath(); g.ellipse(cx, my + 9 * s, 3 * s, 4.6 * s, 0, 0, PI * 2); g.fill(); g.stroke();
    } else if (kind === 'sideburns') {
      [-1, 1].forEach(function (side) {
        g.beginPath();
        g.moveTo(cx + side * 49 * s, cy - 24 * s); g.lineTo(cx + side * 60 * s, cy - 24 * s);
        g.lineTo(cx + side * 60 * s, cy + 14 * s); g.quadraticCurveTo(cx + side * 52 * s, cy + 22 * s, cx + side * 47 * s, cy + 12 * s);
        g.closePath(); g.fill(); g.stroke();
      });
    } else if (kind === 'beard' || kind === 'wizard') {
      beardShape(); g.fill(); g.stroke();
      if (skin) {                                 // lips show through the beard
        g.fillStyle = skin;
        g.beginPath(); g.ellipse(cx, my - 1.5 * s, 11 * s, 6.5 * s, 0, 0, PI * 2); g.fill();
      }
    }
    g.restore();
  }

  function drawFace(g, cx, cy, s, look) {
    var dark = '#231b17';
    var eyes = look.eyes, eyeColor = look.eyeColor, mouth = look.mouth;
    function eye(x, kind, side) {
      g.save();
      g.translate(x, cy);
      var shape = look.blink && kind !== 'happy' ? 'sleepy' : kind;     // blinking: lids closed
      if (shape === 'dizzy') {
        g.strokeStyle = dark; g.lineWidth = 2.6 * s; g.lineCap = 'round';
        g.beginPath();
        for (var a = 0; a < PI * 5; a += 0.2) {
          var rr = a * 1.6 * s;
          g.lineTo(Math.cos(a * side) * rr * 0.75, Math.sin(a * side) * rr * 0.95);
        }
        g.stroke();
      } else if (shape === 'happy' || shape === 'sleepy') {
        var up = shape === 'happy';
        g.lineCap = 'round';
        [['rgba(255,255,255,0.55)', 8], [dark, 4.8]].forEach(function (st) {
          g.strokeStyle = st[0]; g.lineWidth = st[1] * s;
          g.beginPath();
          if (up) g.arc(0, 4 * s, 9 * s, PI * 1.15, PI * 1.85); else g.arc(0, -3 * s, 9 * s, PI * 0.15, PI * 0.85);
          g.stroke();
        });
      } else {
        // white of the eye + dark rim: reads on every skin tone
        var big = kind === 'sparkle' ? 1.18 : kind === 'puppy' ? 1.32 : 1;
        g.fillStyle = '#ffffff';
        g.strokeStyle = dark; g.lineWidth = 2.6 * s;
        g.beginPath(); g.ellipse(0, 0, 9.5 * s * big, 12.5 * s * big, 0, 0, PI * 2); g.fill(); g.stroke();
        if (kind === 'star' || kind === 'heart') {
          g.fillStyle = eyeColor; g.strokeStyle = dark; g.lineWidth = 1.6 * s;
          if (kind === 'star') starPath(g, 0, 2 * s, 9 * s, 4 * s); else heartPath(g, 0, 2.5 * s, 7.2 * s);
          g.fill(); g.stroke();
          g.fillStyle = '#ffffff';
          g.beginPath(); g.arc(-2.8 * s, -3 * s, 2.4 * s, 0, PI * 2); g.fill();
        } else {
          g.fillStyle = eyeColor;
          g.beginPath(); g.ellipse(0, 2 * s, 7 * s * big, 9.5 * s * big, 0, 0, PI * 2); g.fill();
          g.fillStyle = dark;
          g.beginPath(); g.ellipse(0, 3 * s, 3.2 * s * big, 4.5 * s * big, 0, 0, PI * 2); g.fill();
          g.fillStyle = '#ffffff';
          g.beginPath(); g.arc(-3.5 * s * big, -4.5 * s * big, 3.4 * s * big, 0, PI * 2); g.fill();
          if (kind === 'sparkle' || kind === 'puppy') {
            g.beginPath(); g.arc(3.5 * s, 5 * s, 1.8 * s * (kind === 'puppy' ? 1.6 : 1), 0, PI * 2); g.fill();
          }
        }
      }
      if (kind === 'fierce') {                    // brow slanting down towards the nose
        g.strokeStyle = dark; g.lineWidth = 4.2 * s; g.lineCap = 'round';
        g.beginPath(); g.moveTo(side * 12 * s, -18 * s); g.lineTo(-side * 11 * s, -11 * s); g.stroke();
      } else if (look.gender === 'male' && kind !== 'sunglasses') {   // fuller brows
        g.strokeStyle = look.hairColor || dark; g.lineWidth = 4.4 * s; g.lineCap = 'round';
        g.beginPath(); g.moveTo(-side * 9 * s, -19 * s); g.quadraticCurveTo(0, -22 * s, side * 10 * s, -18 * s); g.stroke();
      }
      if (look.gender === 'female' && kind !== 'sunglasses' && kind !== 'dizzy') {   // lashes at the outer corner
        g.strokeStyle = dark; g.lineWidth = 2.2 * s; g.lineCap = 'round';
        var top = shape === 'happy' || shape === 'sleepy' ? -2 : -9;
        [[6, top, 11, top - 5], [8.5, top + 3, 14, top - 1]].forEach(function (l) {
          g.beginPath(); g.moveTo(side * l[0] * s, l[1] * s); g.lineTo(side * l[2] * s, l[3] * s); g.stroke();
        });
      }
      g.restore();
    }
    var dx = 27 * s;
    eye(cx - dx, eyes === 'wink' ? 'round' : eyes, -1);
    eye(cx + dx, eyes === 'wink' ? 'happy' : eyes, 1);
    if (eyes === 'sunglasses') {
      g.save();
      g.fillStyle = '#1d1f24'; g.strokeStyle = '#0d0e10'; g.lineWidth = 2 * s;
      [-1, 1].forEach(function (side) {
        g.beginPath(); g.ellipse(cx + side * dx, cy + 1 * s, 17 * s, 13 * s, 0, 0, PI * 2); g.fill(); g.stroke();
        g.fillStyle = 'rgba(255,255,255,0.35)';
        g.beginPath(); g.ellipse(cx + side * dx - 6 * s, cy - 4 * s, 5 * s, 2.6 * s, -0.4, 0, PI * 2); g.fill();
        g.fillStyle = '#1d1f24';
      });
      g.lineWidth = 3.2 * s;
      g.beginPath(); g.moveTo(cx - dx + 16 * s, cy - 2 * s); g.lineTo(cx + dx - 16 * s, cy - 2 * s); g.stroke();
      g.restore();
    }
    if (eyes === 'monocle') {
      g.save();
      g.strokeStyle = '#c9a227'; g.lineWidth = 3 * s; g.fillStyle = 'rgba(220, 240, 255, 0.2)';
      g.beginPath(); g.arc(cx + dx, cy + 1 * s, 15 * s, 0, PI * 2); g.fill(); g.stroke();
      g.lineWidth = 1.4 * s;
      g.beginPath(); g.moveTo(cx + dx + 10 * s, cy + 12 * s); g.quadraticCurveTo(cx + dx + 22 * s, cy + 40 * s, cx + dx + 12 * s, cy + 62 * s); g.stroke();
      g.restore();
    }
    if (eyes === 'glasses') {
      g.save();
      g.strokeStyle = '#3a2f2a'; g.lineWidth = 3 * s; g.fillStyle = 'rgba(200, 230, 255, 0.18)';
      [-1, 1].forEach(function (side) {
        g.beginPath(); g.arc(cx + side * dx, cy + 1 * s, 15.5 * s, 0, PI * 2); g.fill(); g.stroke();
        g.beginPath(); g.moveTo(cx + side * (dx + 15.5 * s), cy - 2 * s); g.lineTo(cx + side * (dx + 30 * s), cy - 5 * s); g.stroke();
      });
      g.beginPath(); g.moveTo(cx - dx + 15.5 * s, cy - 1 * s); g.quadraticCurveTo(cx, cy - 7 * s, cx + dx - 15.5 * s, cy - 1 * s); g.stroke();
      g.restore();
    }

    // cheeks
    g.fillStyle = 'rgba(240, 110, 120, 0.32)';
    g.beginPath(); g.ellipse(cx - 42 * s, cy + 17 * s, 9 * s, 5.5 * s, 0, 0, PI * 2); g.fill();
    g.beginPath(); g.ellipse(cx + 42 * s, cy + 17 * s, 9 * s, 5.5 * s, 0, 0, PI * 2); g.fill();

    drawFacialHair(g, cx, cy, s, look.facialHair, look.hairColor, look.skin);

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
    } else if (mouth === 'smirk') {
      g.beginPath(); g.moveTo(cx - 8 * s, my - 3 * s); g.quadraticCurveTo(cx + 1 * s, my + 2 * s, cx + 9 * s, my - 6 * s); g.stroke();
    } else if (mouth === 'tongue') {
      g.beginPath(); g.arc(cx, my - 3 * s, 9 * s, 0.1, PI - 0.1); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#ef7f8f';
      g.beginPath(); g.ellipse(cx + 2 * s, my + 3 * s, 4.4 * s, 3.4 * s, 0, 0, PI * 2); g.fill();
    } else if (mouth === 'whistle') {
      g.beginPath(); g.arc(cx + 3 * s, my - 1 * s, 3.6 * s, 0, PI * 2); g.fill(); g.stroke();
    } else if (mouth === 'laugh') {
      g.beginPath(); g.moveTo(cx - 11 * s, my - 5 * s); g.arc(cx, my - 5 * s, 11 * s, 0, PI); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#ffffff'; g.fillRect(cx - 8 * s, my - 4.5 * s, 16 * s, 3.2 * s);
      g.fillStyle = '#ef7f8f'; g.beginPath(); g.ellipse(cx, my + 3 * s, 5.5 * s, 2.8 * s, 0, 0, PI * 2); g.fill();
    } else if (mouth === 'kiss') {
      g.fillStyle = '#d8576b'; g.lineWidth = 1.8 * s;
      g.beginPath(); g.ellipse(cx + 2 * s, my - 3.5 * s, 4.2 * s, 2.8 * s, 0, 0, PI * 2); g.fill(); g.stroke();
      g.beginPath(); g.ellipse(cx + 2 * s, my + 1 * s, 4.6 * s, 3 * s, 0, 0, PI * 2); g.fill(); g.stroke();
    } else if (mouth === 'wavy') {
      g.beginPath(); g.moveTo(cx - 10 * s, my - 1 * s);
      for (var wi = 0; wi < 4; wi++) g.quadraticCurveTo(cx - 7.5 * s + wi * 5 * s, my + (wi % 2 ? 3 : -4) * s, cx - 5 * s + wi * 5 * s, my - 1 * s);
      g.stroke();
    } else if (mouth === 'buck') {
      g.beginPath(); g.arc(cx, my - 6 * s, 8.5 * s, 0.3, PI - 0.3); g.stroke();
      g.fillStyle = '#ffffff'; g.lineWidth = 1.2 * s;
      [-2.6, 2.6].forEach(function (x) { g.beginPath(); g.rect(cx + x * s - 2.4 * s, my + 1.6 * s, 4.8 * s, 5 * s); g.fill(); g.stroke(); });
    } else if (mouth === 'fang') {
      g.beginPath(); g.arc(cx, my - 6 * s, 8 * s, 0.35, PI - 0.35); g.stroke();
      g.fillStyle = '#ffffff'; g.lineWidth = 1.2 * s;
      g.beginPath(); g.moveTo(cx + 1.5 * s, my + 1.4 * s); g.lineTo(cx + 5.8 * s, my + 0.4 * s); g.lineTo(cx + 3.9 * s, my + 5.6 * s); g.closePath(); g.fill(); g.stroke();
    } else {
      g.beginPath(); g.arc(cx, my - 6 * s, 8 * s, 0.35, PI - 0.35); g.stroke();
    }
  }

  function headTexture(R, blink) {
    // Equirectangular skin texture; three.js puts the sphere's front
    // (+z) at u = 0.25, so the face is drawn centred at x = 128.
    var c = document.createElement('canvas');
    c.width = 512; c.height = 256;
    var g = c.getContext('2d');
    g.fillStyle = R.skin;
    g.fillRect(0, 0, 512, 256);
    drawFace(g, 128, 140, 1, { eyes: R.a.eyes, eyeColor: R.eyeColor, mouth: R.a.mouth, facialHair: R.a.facialHair,
                               hairColor: R.hairColor, skin: R.skin, blink: !!blink, gender: R.a.gender });
    var t = new THREE.CanvasTexture(c);
    t.anisotropy = 4;
    return t;
  }

  // ---------- head ----------
  function buildHead(R) {
    var g = group();
    var head = mesh(new THREE.SphereGeometry(HEAD_R, 40, 28), mat('#ffffff', { map: headTexture(R) }), [0, HEAD_Y, 0]);
    if (R.a.facialHair === 'wizard') {             // long beard hanging below the chin
      var beard = mesh(new THREE.ConeGeometry(0.27, 0.62, 18), R.hairColor, [0, HEAD_Y - 0.62, 0.36]);
      beard.rotation.x = PI + 0.25;
      g.add(beard);
    }
    head.userData.R = R;                          // the blink texture is drawn on first use
    head.userData.openMap = head.material.map;
    g.userData.face = head;
    g.add(head);
    g.add(sphere(0.1, R.skin, [0.54, HEAD_Y - 0.03, 0], [0.6, 1, 0.8]));
    g.add(sphere(0.1, R.skin, [-0.54, HEAD_Y - 0.03, 0], [0.6, 1, 0.8]));
    return g;
  }

  // ---------- hair ----------
  // hats that sit low on the forehead hide the fringe
  var LOW_HATS = { sun_cap: 1, beanie: 1, mushroom_cap: 1, trucker_cap: 1, bucket_hat: 1, bandana: 1,
                   beekeeper_veil: 1, acorn_helmet: 1, chef_hat: 1, propeller_cap: 1, viking_helmet: 1 };
  var NO_COVER = { halo: 1 };                     // "hats" that leave the whole hairdo visible
  var HEAD_CENTRE = new THREE.Vector3(0, HEAD_Y, 0);
  function bangs(R, g, azimuths, size) {
    if (LOW_HATS[R.a.head]) return;
    azimuths.forEach(function (az) {
      var p = onHead(0.57, 0.98, az);
      var bang = sphere(size || 0.16, R.hairColor, [p.x, p.y, p.z], [1.1, 0.55, 0.75]);
      bang.lookAt(HEAD_CENTRE);
      g.add(bang);
    });
  }
  function hairCap(R, g, noBangs) {
    var cap = mesh(new THREE.SphereGeometry(0.585, 36, 18, 0, PI * 2, 0, PI * 0.44), mat(R.hairColor, { side: THREE.DoubleSide }), [0, HEAD_Y, 0]);
    cap.rotation.x = -0.4;
    g.add(cap);
    if (!noBangs) bangs(R, g, [-0.42, 0, 0.42]);
  }
  function wrapAngle(a) { a = (a + PI) % (PI * 2); return (a < 0 ? a + PI * 2 : a) - PI; }
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
    ponytail: function (R, g) {                     // high and sporty: peeks over the head
      hairCap(R, g);
      var tie = onHead(0.6, 0.7, PI);
      g.add(sphere(0.12, R.hairColor, [0, tie.y, tie.z]));
      var band = mesh(new THREE.TorusGeometry(0.09, 0.03, 8, 16), '#c0504d', [0, tie.y + 0.02, tie.z - 0.07]);
      band.rotation.x = 0.9;
      g.add(band);
      g.add(sphere(0.13, R.hairColor, [0, tie.y + 0.08, tie.z - 0.14]));
      var tail = cyl(0.13, 0.05, 0.72, R.hairColor, [0, tie.y - 0.27, tie.z - 0.3], 14);
      tail.rotation.x = 0.4;
      g.add(tail);
      g.add(sphere(0.05, R.hairColor, [0, tie.y - 0.6, tie.z - 0.44]));
    },
    pigtails: function (R, g) {
      hairCap(R, g);
      [1, -1].forEach(function (side) {
        var tie = new THREE.Vector3(side * 0.56, HEAD_Y + 0.12, -0.12);
        g.add(sphere(0.1, R.hairColor, [tie.x, tie.y, tie.z]));
        g.add(sphere(0.075, '#e27fae', [tie.x + side * 0.03, tie.y + 0.07, tie.z + 0.02], [1.4, 0.75, 0.6]));
        var tail = cyl(0.1, 0.045, 0.52, R.hairColor, [tie.x + side * 0.12, tie.y - 0.27, tie.z - 0.02], 12);
        tail.rotation.z = side * 0.3;
        g.add(tail);
      });
    },
    braid: function (R, g) {                        // side braid over the shoulder
      hairCap(R, g);
      var path = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0.48, 1.42, 0.12), new THREE.Vector3(0.42, 1.22, 0.3), new THREE.Vector3(0.31, 1.05, 0.36),
        new THREE.Vector3(0.25, 0.93, 0.35), new THREE.Vector3(0.22, 0.8, 0.37)]);
      var dark = shade(R.hairColor, -0.07);
      for (var i = 0; i <= 7; i++) {
        var p = path.getPoint(i / 7), r = 0.1 - i * 0.006;
        g.add(sphere(r, i % 2 ? dark : R.hairColor, [p.x + (i % 2 ? 0.015 : -0.015), p.y, p.z], [1, 0.85, 0.85]));
      }
      var end = path.getPoint(1);
      g.add(sphere(0.05, '#4c9a5b', [end.x, end.y - 0.08, end.z + 0.01], [1.3, 0.8, 1]));
      var tuft = mesh(new THREE.ConeGeometry(0.06, 0.14, 8), R.hairColor, [end.x, end.y - 0.17, end.z + 0.01]);
      tuft.rotation.x = PI;
      g.add(tuft);
    },
    bob: function (R, g) {
      hairCap(R, g, true);
      g.add(mesh(new THREE.CylinderGeometry(0.6, 0.66, 0.5, 28, 1, true, PI * 0.3, PI * 1.4),
        mat(R.hairColor, { side: THREE.DoubleSide }), [0, HEAD_Y - 0.08, 0]));
      [1, -1].forEach(function (side) { g.add(sphere(0.1, R.hairColor, [side * 0.53, HEAD_Y - 0.31, 0.37])); });
      bangs(R, g, [-0.56, -0.28, 0, 0.28, 0.56], 0.14);
    },
    side_swept: function (R, g) {
      hairCap(R, g, true);
      if (LOW_HATS[R.a.head]) return;
      var p = onHead(0.56, 0.9, 0.3);
      var sweep = sphere(0.3, R.hairColor, [p.x, p.y, p.z], [1.25, 0.42, 0.55]);
      sweep.lookAt(HEAD_CENTRE);
      sweep.rotateZ(0.45);
      g.add(sweep);
      var tip = onHead(0.57, 1.1, -0.62);
      var end = sphere(0.13, R.hairColor, [tip.x, tip.y, tip.z], [0.8, 0.5, 0.6]);
      end.lookAt(HEAD_CENTRE);
      g.add(end);
    },
    curly: function (R, g, covered) {
      hairCap(R, g, true);
      [[0.15, 3], [0.45, 6], [0.75, 8], [1.05, 9], [1.35, 11], [1.65, 9]].forEach(function (ring) {
        var polar = ring[0], n = ring[1];
        if (covered && polar < 0.9) return;
        for (var k = 0; k < n; k++) {
          var az = wrapAngle(k / n * PI * 2 + polar * 1.7);
          if (Math.abs(az) < 0.8 && polar > 0.85) continue;            // keep the face clear
          if (polar > 1.5 && Math.abs(az) < 1.7) continue;             // lowest ring only at the back
          var p = onHead(0.6, polar, az);
          g.add(mesh(new THREE.SphereGeometry(0.13, 12, 9), R.hairColor, [p.x, p.y, p.z]));
        }
      });
      if (!LOW_HATS[R.a.head]) [-0.45, 0, 0.45].forEach(function (az) {
        var p = onHead(0.6, 0.92, az);
        g.add(mesh(new THREE.SphereGeometry(0.1, 12, 9), R.hairColor, [p.x, p.y, p.z]));
      });
    },
    afro: function (R, g, covered) {
      if (covered) {
        hairCap(R, g, true);
        g.add(sphere(0.42, R.hairColor, [0, HEAD_Y + 0.05, -0.3], [1.35, 1.0, 0.9]));
        return;
      }
      g.add(sphere(0.8, R.hairColor, [0, HEAD_Y + 0.2, -0.2], [1.05, 0.95, 0.95]));
    },
    dreadlocks: function (R, g) {
      hairCap(R, g);
      for (var i = 0; i < 13; i++) {
        var az = PI * 0.38 + i / 12 * PI * 1.24;                       // sides and back
        var p = onHead(0.6, 1.25, az), len = 0.5 + (i % 3) * 0.08;
        var lock = cyl(0.05, 0.04, len, i % 2 ? shade(R.hairColor, -0.05) : R.hairColor,
          [p.x * 1.04, p.y - len / 2 + 0.05, p.z * 1.04], 8);
        lock.rotation.z = Math.sin(az) * 0.15;                          // splay outwards
        lock.rotation.x = -Math.cos(az) * 0.15;
        g.add(lock);
      }
    },
    // ---- added: punk, mullet and styles from history ----
    long_locs: function (R, g) {                    // thick dreadlocks down the back, a few gold cuffs
      hairCap(R, g);
      var dark = shade(R.hairColor, -0.06);
      for (var i = 0; i < 15; i++) {
        var az = PI * 0.42 + i / 14 * PI * 1.16;                        // sides and back, face stays clear
        var p = onHead(0.6, 1.15, az), len = 0.95 + ((i * 7) % 4) * 0.07;
        var front = Math.cos(az) > -0.1;                                // the front-most fall over the shoulders
        var lock = new THREE.Group();
        lock.position.set(p.x * 1.05, p.y + 0.02, p.z * 1.05);
        var strand = cyl(0.068, 0.055, len, i % 2 ? dark : R.hairColor, [0, -len / 2, 0], 9);
        lock.add(strand);
        lock.add(sphere(0.06, i % 2 ? dark : R.hairColor, [0, -len, 0]));
        if (i % 4 === 1) {
          var cuff = mesh(new THREE.CylinderGeometry(0.078, 0.078, 0.07, 12), '#e3c16f', [0, -len * 0.62, 0]);
          lock.add(cuff);
        }
        lock.rotation.z = Math.sin(az) * (front ? 0.05 : 0.22);
        lock.rotation.x = -Math.cos(az) * 0.2 - (front ? 0 : 0.12);
        g.add(lock);
      }
    },
    liberty_spikes: function (R, g, covered) {       // punk: tall spikes in a row, sides shaved
      HAIR.buzz(R, g);
      if (covered) return;
      var centre = new THREE.Vector3(0, HEAD_Y, 0), tip = shade(R.hairColor, 0.18);
      for (var i = 0; i < 6; i++) {
        var alpha = 0.85 - i * 0.42;
        var p = new THREE.Vector3(0, HEAD_Y + 0.56 * Math.cos(alpha), 0.56 * Math.sin(alpha));
        var len = 0.62 - Math.abs(i - 1.5) * 0.05;
        var spike = new THREE.Group();
        spike.position.copy(p);
        spike.add(mesh(new THREE.ConeGeometry(0.11, len, 10), R.hairColor, [0, len / 2, 0]));
        spike.add(mesh(new THREE.ConeGeometry(0.045, len * 0.3, 8), tip, [0, len * 0.86, 0]));
        pointOut(spike, centre, p.clone().add(new THREE.Vector3(0, 0.35, 0)));   // stand up tall
        g.add(spike);
      }
    },
    mullet: function (R, g) {                        // business in front, party in the back
      hairCap(R, g);
      g.add(mesh(new THREE.CylinderGeometry(0.57, 0.6, 0.62, 24, 1, true, PI * 0.7, PI * 0.6),
        mat(R.hairColor, { side: THREE.DoubleSide }), [0, HEAD_Y - 0.3, 0]));
      [-0.42, -0.14, 0.14, 0.42].forEach(function (az) {            // rounded, flicked ends
        g.add(sphere(0.13, shade(R.hairColor, Math.abs(az) > 0.2 ? -0.04 : 0),
          [0.6 * Math.sin(PI + az), HEAD_Y - 0.6, 0.6 * Math.cos(PI + az) - 0.02], [1, 0.7, 0.75]));
      });
    },
    pompadour: function (R, g, covered) {            // 1950s: big glossy quiff
      hairCap(R, g, true);
      if (covered) return;
      var quiff = sphere(0.36, R.hairColor, [0, HEAD_Y + 0.55, 0.22], [1.15, 0.85, 1.25]);
      quiff.rotation.x = -0.35;
      g.add(quiff);
      g.add(sphere(0.2, shade(R.hairColor, 0.1), [0, HEAD_Y + 0.68, 0.42], [1.1, 0.6, 0.9]));
      [1, -1].forEach(function (side) {             // slicked sides
        g.add(sphere(0.2, R.hairColor, [side * 0.42, HEAD_Y + 0.25, -0.05], [0.55, 0.9, 1.3]));
      });
    },
    beehive: function (R, g, covered) {              // 1960s: tall rounded hive with flicked ends
      hairCap(R, g, true);
      if (!covered) {
        g.add(sphere(0.47, R.hairColor, [0, HEAD_Y + 0.5, -0.08], [1, 1.3, 1]));
        var band = mesh(new THREE.TorusGeometry(0.46, 0.035, 8, 32), '#e27fae', [0, HEAD_Y + 0.3, -0.04]);
        band.rotation.x = PI / 2 - 0.12;
        g.add(band);
      }
      [1, -1].forEach(function (side) {             // smooth sides ending in an outward flick
        g.add(sphere(0.15, R.hairColor, [side * 0.53, HEAD_Y - 0.1, 0.0], [0.7, 1.5, 1.1]));
        g.add(sphere(0.085, R.hairColor, [side * 0.61, HEAD_Y - 0.36, 0.02], [1.15, 0.6, 0.85]));
      });
    },
    powdered_wig: function (R, g, covered) {         // 1700s: white curls and a ribboned queue
      var W = '#e2ded3', W2 = '#cfc9bc';
      var cap = mesh(new THREE.SphereGeometry(0.6, 36, 18, 0, PI * 2, 0, PI * 0.5), mat(W, { side: THREE.DoubleSide }), [0, HEAD_Y + 0.02, 0]);
      cap.rotation.x = -0.3;
      g.add(cap);
      if (!covered) g.add(sphere(0.3, W, [0, HEAD_Y + 0.5, 0.05], [1.3, 0.55, 1.2]));
      [1, -1].forEach(function (side) {               // two stacked rolls over each ear
        [0, 1].forEach(function (k) {
          var roll = cyl(0.11, 0.11, 0.42, k ? W2 : W, [side * 0.6, HEAD_Y - 0.02 - k * 0.22, -0.02], 16);
          roll.rotation.x = PI / 2;
          g.add(roll);
        });
      });
      var queue = cyl(0.09, 0.06, 0.4, W, [0, HEAD_Y - 0.5, -0.5], 12);
      queue.rotation.x = 0.12;
      g.add(queue);
      g.add(sphere(0.05, '#1f2522', [0, HEAD_Y - 0.3, -0.56]));
      [1, -1].forEach(function (side) {
        var bow = sphere(0.1, '#1f2522', [side * 0.11, HEAD_Y - 0.3, -0.55], [1.5, 0.9, 0.5]);
        bow.rotation.z = side * 0.35;
        g.add(bow);
      });
    },
    top_knot: function (R, g, covered) {             // samurai-style knot folded forward on the crown
      hairCap(R, g, true);
      if (covered) return;
      var knot = cyl(0.075, 0.09, 0.42, R.hairColor, [0, HEAD_Y + 0.6, 0.04], 12);
      knot.rotation.x = PI / 2 + 0.12;
      g.add(knot);
      g.add(sphere(0.12, R.hairColor, [0, HEAD_Y + 0.58, -0.17]));
      var tie = mesh(new THREE.TorusGeometry(0.095, 0.025, 6, 14), '#f1efe9', [0, HEAD_Y + 0.6, -0.08]);
      g.add(tie);
    },
    victory_rolls: function (R, g, covered) {        // 1940s: two big rolls on top, curls at the back
      hairCap(R, g, true);
      [1, -1].forEach(function (side) {
        if (!covered) {
          var roll = mesh(new THREE.TorusGeometry(0.15, 0.1, 10, 20), R.hairColor, [side * 0.27, HEAD_Y + 0.52, 0.18]);
          roll.rotation.set(0, PI / 2, 0.3 * side);
          g.add(roll);
        }
        g.add(sphere(0.16, R.hairColor, [side * 0.42, HEAD_Y - 0.3, -0.3], [1, 0.8, 1]));
      });
      g.add(mesh(new THREE.CylinderGeometry(0.58, 0.6, 0.4, 24, 1, true, PI * 0.68, PI * 0.64),
        mat(R.hairColor, { side: THREE.DoubleSide }), [0, HEAD_Y - 0.16, 0]));
      g.add(sphere(0.18, R.hairColor, [0, HEAD_Y - 0.36, -0.46], [1.5, 0.8, 0.9]));
    },
    space_buns: function (R, g, covered) {
      hairCap(R, g);
      if (covered) return;
      [1, -1].forEach(function (side) {
        var p = onHead(0.62, 0.62, side * 0.95);
        g.add(sphere(0.21, R.hairColor, [p.x, p.y + 0.06, p.z - 0.05]));
        var band = mesh(new THREE.TorusGeometry(0.14, 0.03, 8, 18), '#7fb8e2', [p.x * 0.93, p.y - 0.08, p.z * 0.93 - 0.04]);
        band.lookAt(HEAD_CENTRE);
        g.add(band);
      });
    },
    flat_top: function (R, g, covered) {             // 80s high-top: tall and flat, faded sides
      HAIR.buzz(R, g);
      if (covered) return;
      var top = group([0, HEAD_Y + 0.42, -0.03]);
      top.rotation.x = -0.08;
      top.add(cyl(0.47, 0.535, 0.52, R.hairColor, [0, 0, 0], 32));
      var curl = shade(R.hairColor, 0.06);
      for (var k = 0; k < 16; k++) {                 // tight curls around the flat top so it reads as hair
        var a = k / 16 * PI * 2;
        top.add(sphere(0.075, curl, [Math.sin(a) * 0.43, 0.25, Math.cos(a) * 0.43], [1, 0.8, 1]));
      }
      for (var m = 0; m < 6; m++) {
        var b = m / 6 * PI * 2 + 0.4;
        top.add(sphere(0.07, curl, [Math.sin(b) * 0.2, 0.26, Math.cos(b) * 0.2], [1, 0.7, 1]));
      }
      g.add(top);
    },
    viking_braids: function (R, g) {                 // a braid in front of each shoulder
      hairCap(R, g);
      var dark = shade(R.hairColor, -0.07);
      [1, -1].forEach(function (side) {
        for (var i = 0; i <= 7; i++) {
          var r = 0.1 - i * 0.006;
          g.add(sphere(r, i % 2 ? dark : R.hairColor, [side * (0.5 - i * 0.012) + (i % 2 ? 0.015 : -0.015) * side,
            HEAD_Y - 0.1 - i * 0.11, 0.2 + Math.min(i, 3) * 0.04], [1, 0.85, 0.85]));
        }
        g.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.07, 12), '#b0b5b3', [side * 0.41, HEAD_Y - 0.94, 0.32]));
      });
      g.add(mesh(new THREE.CylinderGeometry(0.58, 0.61, 0.5, 24, 1, true, PI * 0.7, PI * 0.6),
        mat(R.hairColor, { side: THREE.DoubleSide }), [0, HEAD_Y - 0.22, 0]));
    },
    curtains: function (R, g) {                       // 90s: middle part, curtains to the cheeks
      hairCap(R, g, true);
      if (LOW_HATS[R.a.head]) return;
      [1, -1].forEach(function (side) {
        var p = onHead(0.565, 0.93, side * 0.34);
        var curtain = sphere(0.23, R.hairColor, [p.x, p.y, p.z], [1.05, 0.36, 0.45]);
        curtain.lookAt(HEAD_CENTRE);
        curtain.rotateZ(-side * 0.5);
        g.add(curtain);
        var end = onHead(0.57, 1.18, side * 0.7);
        var tip = sphere(0.1, R.hairColor, [end.x, end.y, end.z], [0.7, 0.9, 0.5]);
        tip.lookAt(HEAD_CENTRE);
        g.add(tip);
      });
    },
    buzz: function (R, g) {
      var cap = mesh(new THREE.SphereGeometry(0.565, 36, 18, 0, PI * 2, 0, PI * 0.42),
        mat(shade(R.hairColor, 0.04), { side: THREE.DoubleSide }), [0, HEAD_Y, 0]);
      cap.rotation.x = -0.35;
      g.add(cap);
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
    backwards_cap: function () {
      var g = group([0, HEAD_Y + 0.02, 0]); g.rotation.x = -0.1;
      g.add(mesh(new THREE.SphereGeometry(0.6, 32, 16, 0, PI * 2, 0, PI * 0.5), '#c0392b'));
      var visor = mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.03, 28, 1, false, PI / 2, PI), '#962d22', [0, 0.14, -0.3]);
      visor.rotation.x = -0.2;
      g.add(visor);
      g.add(sphere(0.06, '#962d22', [0, 0.6, 0]));
      return g;
    },
    trucker_cap: function () {
      var g = group([0, HEAD_Y + 0.02, 0]); g.rotation.x = -0.15;
      g.add(mesh(new THREE.SphereGeometry(0.6, 32, 16, 0, PI, 0, PI * 0.5), '#f4f1e8'));        // foam front
      g.add(mesh(new THREE.SphereGeometry(0.6, 32, 16, PI, PI, 0, PI * 0.5), '#2e7d4f'));       // mesh back
      var visor = mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.03, 28, 1, false, -PI / 2, PI), '#2e7d4f', [0, 0.16, 0.3]);
      visor.rotation.x = 0.2;
      g.add(visor);
      g.add(sphere(0.06, '#2e7d4f', [0, 0.6, 0]));
      var patch = sphere(0.1, '#4f8a3a', [0, 0.36, 0.49], [0.65, 1, 0.25]);
      patch.lookAt(new THREE.Vector3(0, 0.36 * 3, 0.49 * 3));
      g.add(patch);
      return g;
    },
    bucket_hat: function () {
      var g = group([0, HEAD_Y + 0.22, 0]); g.rotation.x = -0.1;
      var khaki = '#b9a77a';
      g.add(cyl(0.46, 0.55, 0.36, khaki, [0, 0.2, 0], 28));
      g.add(cyl(0.556, 0.556, 0.07, '#8f7f57', [0, 0.06, 0], 28));
      g.add(noOutline(mesh(new THREE.CylinderGeometry(0.55, 0.86, 0.16, 32, 1, true), mat(khaki, { side: THREE.DoubleSide }), [0, -0.06, 0])));
      var edge = mesh(new THREE.TorusGeometry(0.86, 0.015, 6, 48), '#8f7f57', [0, -0.14, 0]);
      edge.rotation.x = PI / 2;
      g.add(edge);
      return g;
    },
    bandana: function () {
      var g = group();
      var cloth = mesh(new THREE.SphereGeometry(0.6, 32, 16, 0, PI * 2, 0, PI * 0.42), '#c0392b', [0, HEAD_Y, 0]);
      cloth.rotation.x = -0.2;
      [[0.3, 0], [0.55, 1.1], [0.55, -1.1], [0.8, 0.5], [0.8, -0.5], [0.75, 2.2], [0.75, -2.2], [0.35, 2.8], [1.0, 1.6], [1.0, -1.6], [1.05, 2.8]].forEach(function (pa) {
        cloth.add(sphere(0.035, '#f4f1e8', [0.605 * Math.sin(pa[0]) * Math.sin(pa[1]), 0.605 * Math.cos(pa[0]), 0.605 * Math.sin(pa[0]) * Math.cos(pa[1])]));
      });
      g.add(cloth);
      var knot = onHead(0.61, 1.38, PI);
      g.add(sphere(0.08, '#c0392b', [0, knot.y, knot.z]));
      [1, -1].forEach(function (side) {
        var end = sphere(0.09, '#c0392b', [side * 0.07, knot.y - 0.13, knot.z - 0.05], [0.55, 1.3, 0.25]);
        end.rotation.z = side * 0.45;
        g.add(end);
      });
      return g;
    },
    headband: function () {
      var g = group([0, HEAD_Y + 0.26, 0]);
      var band = mesh(new THREE.TorusGeometry(0.5, 0.06, 10, 40), '#f4f1e8');
      band.rotation.x = PI / 2;
      g.add(band);
      var stripe = mesh(new THREE.TorusGeometry(0.506, 0.062, 10, 40), '#c0392b');
      stripe.rotation.x = PI / 2;
      stripe.scale.set(1, 1, 0.35);
      g.add(stripe);
      return g;
    },
    beret: function () {
      var g = group([0.06, HEAD_Y + 0.5, -0.02]); g.rotation.z = -0.28; g.rotation.x = -0.1;
      g.add(sphere(0.52, '#7a2e3a', [0, 0, 0], [1.12, 0.36, 1.08]));
      g.add(cyl(0.02, 0.03, 0.08, '#7a2e3a', [0, 0.2, 0], 8));
      return g;
    },
    cowboy_hat: function () {
      var g = group([0, 1.95, 0]); g.rotation.x = -0.12;
      var tan = '#a0683a';
      // brim with the sides curled up
      var brimGeo = new THREE.CylinderGeometry(0.95, 0.95, 0.035, 48, 1);
      var pos = brimGeo.attributes.position;
      for (var i = 0; i < pos.count; i++) {
        var over = Math.max(0, Math.abs(pos.getX(i)) - 0.42);
        pos.setY(i, pos.getY(i) + over * over * 1.1);
      }
      brimGeo.computeVertexNormals();
      var brim = mesh(brimGeo, tan);
      brim.scale.z = 0.8;
      g.add(brim);
      g.add(cyl(0.38, 0.45, 0.44, tan, [0, 0.22, 0], 28));
      g.add(box(0.07, 0.06, 0.5, shade(tan, -0.08), [0, 0.44, 0]));      // pinched crown
      g.add(cyl(0.455, 0.455, 0.07, '#5b3a24', [0, 0.05, 0], 28));
      g.add(mesh(new THREE.OctahedronGeometry(0.05), '#e3c16f', [0, 0.06, 0.455]));
      return g;
    },
    beekeeper_veil: function () {
      var g = group([0, 1.93, 0]); g.rotation.x = -0.08;
      g.add(cyl(0.88, 0.88, 0.035, '#f4f1e8', [0, 0, 0], 36));
      g.add(cyl(0.42, 0.47, 0.3, '#f4f1e8', [0, 0.15, 0], 28));
      g.add(cyl(0.476, 0.476, 0.06, '#d9c27a', [0, 0.04, 0], 28));
      g.add(noOutline(mesh(new THREE.CylinderGeometry(0.86, 0.62, 0.78, 32, 1, true),
        mat('#2b2b2b', { transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }), [0, -0.39, 0])));
      return g;
    },
    acorn_helmet: function () {
      var g = group([0, 1.72, 0]); g.rotation.x = -0.12;
      var cap = mesh(new THREE.SphereGeometry(0.66, 36, 18, 0, PI * 2, 0, PI * 0.5), '#8b5a2b');
      cap.scale.y = 0.72;
      g.add(cap);
      [[0.45, 10], [0.8, 14], [1.15, 18]].forEach(function (ring) {
        for (var k = 0; k < ring[1]; k++) {
          var a = k / ring[1] * PI * 2 + ring[0];
          var bump = mesh(new THREE.SphereGeometry(0.06, 8, 6), '#6f4522',
            [0.665 * Math.sin(ring[0]) * Math.sin(a), 0.665 * 0.72 * Math.cos(ring[0]), 0.665 * Math.sin(ring[0]) * Math.cos(a)]);
          bump.scale.set(1, 0.6, 1);
          g.add(bump);
        }
      });
      g.add(cyl(0.67, 0.67, 0.06, '#6f4522', [0, 0.01, 0], 36));
      var stem = cyl(0.04, 0.06, 0.2, '#5b3a24', [0.04, 0.55, 0], 8);
      stem.rotation.z = -0.3;
      g.add(stem);
      return g;
    },
    golden_crown: function () {
      var g = group([0, 2.0, 0]); g.rotation.x = -0.12;
      var gold = mat('#f2c230', { emissive: new THREE.Color('#5a4100') });
      g.add(noOutline(mesh(new THREE.CylinderGeometry(0.44, 0.42, 0.16, 32, 1, true), mat('#f2c230', { emissive: new THREE.Color('#5a4100'), side: THREE.DoubleSide }))));
      [0.08, -0.08].forEach(function (y) {
        var rim = mesh(new THREE.TorusGeometry(y > 0 ? 0.44 : 0.42, 0.025, 8, 40), gold, [0, y, 0]);
        rim.rotation.x = PI / 2;
        g.add(rim);
      });
      for (var i = 0; i < 5; i++) {
        var a = i / 5 * PI * 2;
        g.add(mesh(new THREE.ConeGeometry(0.07, 0.2, 10), gold, [0.44 * Math.sin(a), 0.18, 0.44 * Math.cos(a)]));
        g.add(sphere(0.035, gold, [0.44 * Math.sin(a), 0.29, 0.44 * Math.cos(a)]));
      }
      [['#d83a4a', 0], ['#3fa34d', 1.25], ['#3d7fe0', -1.25]].forEach(function (gem) {
        g.add(sphere(0.05, gem[0], [0.445 * Math.sin(gem[1]), 0, 0.445 * Math.cos(gem[1])], [1, 1, 0.6], { emissive: new THREE.Color(shade(gem[0], -0.3)) }));
      });
      return g;
    },
    chef_hat: function () {
      var g = group([0, 1.86, 0]); g.rotation.x = -0.1;
      g.add(cyl(0.45, 0.47, 0.22, '#f7f5ef', [0, 0.06, 0], 28));
      [[0, 0.36, 0, 0.3], [0.22, 0.3, 0.05, 0.22], [-0.22, 0.3, 0.05, 0.22], [0.05, 0.3, 0.24, 0.22], [-0.05, 0.3, -0.22, 0.22]].forEach(function (p) {
        g.add(sphere(p[3], '#ffffff', [p[0], p[1], p[2]]));
      });
      return g;
    },
    party_hat: function () {
      var g = group([0.06, 2.02, 0]); g.rotation.z = -0.18; g.rotation.x = -0.1;
      g.add(mesh(new THREE.ConeGeometry(0.3, 0.72, 24), '#e84d8a', [0, 0.32, 0]));
      [0.1, 0.32, 0.52].forEach(function (y, i) {
        var r = 0.3 * (1 - (y - 0.0) / 0.72) + 0.006;
        var ring = mesh(new THREE.TorusGeometry(r, 0.02, 6, 24), ['#f2c230', '#3fa3e0', '#7bd36b'][i], [0, y - 0.04, 0]);
        ring.rotation.x = PI / 2;
        g.add(ring);
      });
      g.add(sphere(0.08, '#f2c230', [0, 0.7, 0]));
      return g;
    },
    top_hat: function () {
      var g = group([0, 1.98, 0]); g.rotation.x = -0.1;
      g.add(cyl(0.62, 0.62, 0.035, '#1f2125', [0, 0, 0], 36));
      g.add(cyl(0.36, 0.38, 0.68, '#1f2125', [0, 0.35, 0], 28));
      g.add(cyl(0.385, 0.385, 0.09, '#9e2b2b', [0, 0.08, 0], 28));
      return g;
    },
    propeller_cap: function () {
      var g = group([0, HEAD_Y + 0.02, 0]); g.rotation.x = -0.12;
      ['#e04848', '#f2c230', '#3d7fe0', '#3fa34d'].forEach(function (c, i) {
        g.add(mesh(new THREE.SphereGeometry(0.6, 16, 14, i * PI / 2, PI / 2, 0, PI * 0.5), c));
      });
      var visor = mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.03, 28, 1, false, -PI / 2, PI), '#3d7fe0', [0, 0.14, 0.28]);
      visor.rotation.x = 0.2;
      g.add(visor);
      g.add(cyl(0.025, 0.025, 0.16, '#9aa3ab', [0, 0.66, 0], 8));
      var prop = fx(group([0, 0.75, 0]), 'spin', { speed: 9 });
      [0, PI].forEach(function (a) {
        var blade = box(0.34, 0.02, 0.09, a ? '#f2c230' : '#e04848', [Math.cos(a) * 0.18, 0, Math.sin(a) * 0.18]);
        blade.rotation.x = 0.3 * (a ? -1 : 1);
        prop.add(blade);
      });
      prop.add(sphere(0.04, '#3a3a3a', [0, 0, 0]));
      g.add(prop);
      return g;
    },
    pirate_hat: function () {
      var g = group([0, 1.95, 0]); g.rotation.x = -0.1;
      var black = '#1f2125';
      // brim folded up into three corners
      var brimGeo = new THREE.CylinderGeometry(0.8, 0.8, 0.04, 60, 1);
      var pos = brimGeo.attributes.position;
      for (var i = 0; i < pos.count; i++) {
        var x = pos.getX(i), z = pos.getZ(i), r = Math.sqrt(x * x + z * z);
        if (r < 0.42) continue;
        var th = Math.atan2(x, z);
        pos.setY(i, pos.getY(i) + (r - 0.42) * (0.55 + 0.45 * Math.cos(3 * (th + PI))));
      }
      brimGeo.computeVertexNormals();
      g.add(mesh(brimGeo, black));
      g.add(cyl(0.42, 0.47, 0.3, black, [0, 0.15, 0], 28));
      g.add(sphere(0.07, '#f4f1e8', [0, 0.17, 0.47], [1, 1, 0.5]));                      // skull
      [0.6, -0.6].forEach(function (a) {
        var bone = box(0.2, 0.025, 0.02, '#f4f1e8', [0, 0.1, 0.475]);
        bone.rotation.z = a;
        g.add(bone);
      });
      return g;
    },
    viking_helmet: function () {
      var g = group([0, HEAD_Y + 0.04, 0]); g.rotation.x = -0.1;
      var steel = '#a9b1b8';
      var dome = mesh(new THREE.SphereGeometry(0.61, 32, 16, 0, PI * 2, 0, PI * 0.5), steel);
      dome.scale.y = 0.9;
      g.add(dome);
      g.add(cyl(0.615, 0.615, 0.1, '#8a6a3a', [0, 0.05, 0], 32));
      for (var i = 0; i < 10; i++) {
        var a = i / 10 * PI * 2;
        g.add(sphere(0.022, '#e3c16f', [0.625 * Math.sin(a), 0.05, 0.625 * Math.cos(a)]));
      }
      g.add(box(0.07, 0.24, 0.05, steel, [0, -0.04, 0.6]));                               // nose guard
      [1, -1].forEach(function (side) {
        var horn = group([side * 0.5, 0.28, 0]);
        horn.rotation.z = -side * 0.95;
        horn.add(mesh(new THREE.ConeGeometry(0.1, 0.5, 14), '#efe3c8', [0, 0.25, 0]));
        g.add(horn);
      });
      return g;
    },
    flowerpot: function () {
      var g = group([0, 1.98, 0]); g.rotation.x = -0.08;
      var clay = '#c8693a';
      g.add(cyl(0.44, 0.34, 0.4, clay, [0, 0.2, 0], 24));
      g.add(cyl(0.48, 0.48, 0.09, shade(clay, -0.06), [0, 0.42, 0], 24));
      g.add(cyl(0.42, 0.42, 0.02, '#5b3a24', [0, 0.45, 0], 24));                           // soil
      g.add(cyl(0.02, 0.025, 0.5, '#4f8a3a', [0, 0.7, 0], 8));
      [[0.1, 0.62, 0.6], [-0.1, 0.72, -0.6]].forEach(function (l) {
        var leaf = sphere(0.09, '#6bbf59', [l[0], l[1], 0], [1.4, 0.35, 0.7]);
        leaf.rotation.z = l[2];
        g.add(leaf);
      });
      var bloom = group([0, 0.98, 0]);
      bloom.rotation.x = 0.5;
      for (var i = 0; i < 8; i++) {
        var a = i / 8 * PI * 2;
        var petal = sphere(0.07, '#ffffff', [Math.cos(a) * 0.11, Math.sin(a) * 0.11, 0], [0.6, 1.3, 0.25]);
        petal.rotation.z = a - PI / 2;
        bloom.add(petal);
      }
      bloom.add(sphere(0.06, '#f2c230', [0, 0, 0.01], [1, 1, 0.5]));
      g.add(bloom);
      return g;
    },
    halo: function () {
      var g = fx(group([0, 2.42, 0]), 'bob', { amp: 0.04, speed: 1.6 });
      var ring = mesh(new THREE.TorusGeometry(0.36, 0.045, 10, 40), mat('#ffe27a', { emissive: new THREE.Color('#b8860b') }));
      ring.rotation.x = PI / 2 - 0.2;
      g.add(ring);
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

  // ---------- earrings (one per side, hanging under the ear) ----------
  var GOLD = '#e3c16f';
  function earAt(side, dy) {                      // earrings are drawn 1.5x real size so they read on a chibi
    var g = group([side * 0.6, HEAD_Y - 0.13 + (dy || 0), 0.03]);
    g.scale.setScalar(1.5);
    return g;
  }
  var EARRINGS = {
    studs: function (R, side) {
      var g = earAt(side, 0.05);
      g.add(sphere(0.035, mat(GOLD, { emissive: new THREE.Color('#3a2a00') })));
      return g;
    },
    hoops: function (R, side) {
      var g = earAt(side, -0.04);
      var hoop = mesh(new THREE.TorusGeometry(0.075, 0.013, 8, 24), mat(GOLD, { emissive: new THREE.Color('#3a2a00') }));
      hoop.rotation.y = PI / 2;
      g.add(hoop);
      return g;
    },
    pearls: function (R, side) {
      var g = earAt(side);
      g.add(cyl(0.008, 0.008, 0.06, GOLD, [0, 0.03, 0], 6));
      g.add(sphere(0.045, mat('#f6f1e6', { emissive: new THREE.Color('#2a2620') }), [0, -0.02, 0]));
      return g;
    },
    leaf_drops: function (R, side) {
      var g = earAt(side);
      g.add(cyl(0.008, 0.008, 0.05, GOLD, [0, 0.03, 0], 6));
      var leaf = sphere(0.06, '#5fbf5a', [0, -0.05, 0], [0.25, 1.3, 0.7]);
      g.add(leaf);
      return g;
    },
    cherries: function (R, side) {
      var g = earAt(side);
      [[-0.03, -0.07], [0.03, -0.09]].forEach(function (c) {
        var stem = cyl(0.007, 0.007, 0.09, '#4f8a3a', [0, 0, c[0] / 2], 5);
        stem.rotation.x = c[0] * 6;
        g.add(stem);
        g.add(sphere(0.035, '#d8323c', [0, c[1], c[0]]));
      });
      return g;
    },
    star_drops: function (R, side) {
      var g = earAt(side);
      g.add(cyl(0.008, 0.008, 0.05, GOLD, [0, 0.03, 0], 6));
      var star = mesh(starGeo(0.07, 0.03, 0.02), mat('#ffd54a', { emissive: new THREE.Color('#6b4b00') }), [0, -0.06, 0]);
      star.rotation.y = side * PI / 2;
      g.add(star);
      return g;
    }
  };

  // ---------- body / outfit ----------
  function baseBody(R, o) {
    // o: { top, sleeves, pants, boots, legs:false }
    var g = group();
    g.userData.arms = {};
    g.add(cyl(0.3, 0.36, 0.56, o.top, [0, 0.82, 0], 28));
    [1, -1].forEach(function (side) {
      if (!o.noShoulders) g.add(sphere(0.13, o.sleeves, [side * 0.33, 1.02, 0]));
      var arm = group([side * 0.35, 1.02, 0]);
      arm.rotation.z = side * 0.25;
      arm.add(cyl(0.085, o.bell ? 0.14 : 0.095, 0.42, o.sleeves, [0, -0.21, 0], 16));
      arm.add(sphere(0.1, o.hands || R.skin, [0, -0.45, 0]));
      arm.userData.rest = arm.rotation.z;
      g.userData.arms[side] = arm;
      g.add(arm);
      if (o.legs !== false) {
        g.add(cyl(0.11, 0.1, 0.36, o.pants, [side * 0.14, 0.3, 0], 16));
        g.add(sphere(0.13, o.boots || '#5b3a24', [side * 0.14, 0.07, 0.05], [1, 0.7, 1.35]));
      }
    });
    return g;
  }
  // torso radius at height y (the body cylinder runs 0.36 at y 0.54 to 0.30 at y 1.10)
  function torsoR(y) { return 0.36 - (y - 0.54) / 0.56 * 0.06; }
  // tiling cloth pattern drawn on a canvas (plaid, knit stripes...)
  function patternMat(base, repeatX, repeatY, draw) {
    var c = document.createElement('canvas');
    c.width = c.height = 64;
    var g = c.getContext('2d');
    g.fillStyle = base; g.fillRect(0, 0, 64, 64);
    draw(g);
    var t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeatX, repeatY);
    return mat('#ffffff', { map: t });
  }
  function frontButtons(g, ys, color, r) {
    ys.forEach(function (y) { g.add(sphere(r || 0.028, color, [0, y, torsoR(y) + 0.008])); });
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
    raincoat: function (R) {
      var yellow = '#f2c230';
      var g = baseBody(R, { top: yellow, sleeves: yellow, pants: '#3e4450', boots: '#2f6f8f' });
      g.add(cyl(0.37, 0.46, 0.3, yellow, [0, 0.46, 0], 28));
      var hood = mesh(new THREE.TorusGeometry(0.22, 0.1, 10, 22), '#d9a91f', [0, 1.12, -0.24]);
      hood.rotation.x = 1.2;
      g.add(hood);
      frontButtons(g, [0.98, 0.84, 0.7], '#3e4450', 0.03);
      g.add(sphere(0.03, '#3e4450', [0, 0.5, 0.41]));
      return g;
    },
    flannel: function (R) {
      var plaid = patternMat(R.outfit, 4, 2, function (g) {
        g.fillStyle = shade(R.outfit, -0.2); g.globalAlpha = 0.6;
        g.fillRect(0, 0, 18, 64); g.fillRect(0, 0, 64, 18);
        g.globalAlpha = 0.8; g.fillStyle = shade(R.outfit, 0.28);
        g.fillRect(40, 0, 3, 64); g.fillRect(0, 40, 64, 3);
      });
      var g = baseBody(R, { top: plaid, sleeves: plaid, pants: '#3f5f8f' });
      [1, -1].forEach(function (side) {
        var collar = box(0.12, 0.07, 0.03, shade(R.outfit, -0.25), [side * 0.07, 1.06, 0.29]);
        collar.rotation.z = -side * 0.5;
        g.add(collar);
      });
      frontButtons(g, [0.98, 0.86, 0.74, 0.62], '#f4f1e8', 0.022);
      return g;
    },
    sweater: function (R) {
      var knit = patternMat(R.outfit, 1, 3, function (g) {
        g.fillStyle = shade(R.outfit, 0.16); g.fillRect(0, 18, 64, 9);
        g.fillStyle = shade(R.outfit, -0.12); g.fillRect(0, 44, 64, 4);
        g.fillStyle = 'rgba(255,255,255,0.18)';
        for (var x = 2; x < 64; x += 8) { g.fillRect(x, 20, 3, 5); }
      });
      var g = baseBody(R, { top: knit, sleeves: knit, pants: '#4a4f58' });
      g.add(cyl(0.19, 0.23, 0.12, shade(R.outfit, -0.05), [0, 1.12, 0], 20));          // turtleneck
      g.add(cyl(0.365, 0.37, 0.06, shade(R.outfit, -0.1), [0, 0.57, 0], 28));          // ribbed hem
      return g;
    },
    vest: function (R) {
      var g = baseBody(R, { top: '#f4f1e8', sleeves: '#f4f1e8', pants: '#5a4632' });
      g.add(noOutline(mesh(new THREE.CylinderGeometry(0.312, 0.372, 0.52, 24, 1, true, PI * 0.14, PI * 1.72),
        mat(R.outfit, { side: THREE.DoubleSide }), [0, 0.81, 0])));
      [1, -1].forEach(function (side) {
        [0.72, 0.92].forEach(function (y) {
          var a = side * 0.62, r = torsoR(y) + 0.03;
          var pocket = box(0.12, 0.1, 0.03, shade(R.outfit, -0.12), [r * Math.sin(a), y, r * Math.cos(a)]);
          pocket.rotation.y = a;
          g.add(pocket);
        });
      });
      return g;
    },
    poncho: function (R) {
      var g = baseBody(R, { top: R.outfit, sleeves: R.outfit, pants: '#5a4632', noShoulders: true });
      g.add(cyl(0.22, 0.72, 0.48, R.outfit, [0, 0.94, 0], 28));
      [[0.84, '#f2c230'], [0.77, '#c0392b']].forEach(function (b) {
        var r = 0.22 + (1.18 - b[0]) / 0.48 * 0.5 + 0.006;
        g.add(cyl(r - 0.02, r + 0.02, 0.04, b[1], [0, b[0], 0], 28));
      });
      for (var i = 0; i < 18; i++) {
        var a = i / 18 * PI * 2;
        g.add(noOutline(cyl(0.012, 0.012, 0.08, '#f2c230', [0.7 * Math.sin(a), 0.66, 0.7 * Math.cos(a)], 4)));
      }
      return g;
    },
    beekeeper_suit: function (R) {
      var white = '#f4f1e8';
      var g = baseBody(R, { top: white, sleeves: white, pants: white, boots: '#3a3a3a', hands: '#e8c547' });
      g.add(box(0.025, 0.5, 0.02, '#9aa3ab', [0, 0.84, torsoR(0.84) + 0.01]));       // zip
      [1, -1].forEach(function (side) {
        g.add(box(0.11, 0.1, 0.03, '#e6e1d3', [side * 0.15, 0.95, torsoR(0.95) - 0.01]));
      });
      g.add(cyl(0.365, 0.365, 0.05, '#d9c27a', [0, 0.6, 0], 28));
      return g;
    },
    bark_armor: function (R) {
      var bark = '#6b4a2e', light = '#8a6440', moss = '#6bbf59';
      var g = baseBody(R, { top: bark, sleeves: bark, pants: '#4a3b30', boots: '#3b2a1c' });
      [0.98, 0.82, 0.66].forEach(function (y, row) {
        [-0.62, 0, 0.62].forEach(function (a, k) {
          var r = torsoR(y) + 0.02;
          var plate = box(0.17, 0.13, 0.05, (row + k) % 2 ? bark : light, [r * Math.sin(a), y, r * Math.cos(a)]);
          plate.rotation.y = a;
          plate.rotation.z = ((row * 3 + k) % 3 - 1) * 0.08;
          g.add(plate);
        });
      });
      [1, -1].forEach(function (side) {
        g.add(sphere(0.17, light, [side * 0.34, 1.07, 0], [1.2, 0.7, 1.2]));
        g.add(sphere(0.05, moss, [side * 0.38, 1.17, 0.06]));
      });
      g.add(sphere(0.045, moss, [0.12, 0.88, torsoR(0.88) + 0.05]));
      g.add(cyl(0.37, 0.37, 0.06, '#3b2a1c', [0, 0.58, 0], 28));
      g.add(sphere(0.06, moss, [0, 0.58, 0.37], [1.3, 0.8, 0.5]));
      return g;
    },
    hawaiian: function (R) {
      var print = patternMat(R.outfit, 3, 2, function (g) {
        function flower(x, y, c) {
          g.fillStyle = c;
          for (var i = 0; i < 5; i++) {
            var a = i / 5 * PI * 2;
            g.beginPath(); g.ellipse(x + Math.cos(a) * 5, y + Math.sin(a) * 5, 4, 2.6, a, 0, PI * 2); g.fill();
          }
          g.fillStyle = '#f2c230'; g.beginPath(); g.arc(x, y, 2.4, 0, PI * 2); g.fill();
        }
        g.fillStyle = 'rgba(40, 120, 60, 0.55)';
        [[44, 14, 0.6], [14, 46, -0.8]].forEach(function (l) { g.beginPath(); g.ellipse(l[0], l[1], 9, 3.5, l[2], 0, PI * 2); g.fill(); });
        flower(18, 16, '#ffffff'); flower(46, 42, '#ffd0e0'); flower(52, 6, '#fff3b0');
      });
      var g = baseBody(R, { top: print, sleeves: print, pants: '#c9b48a' });
      [1, -1].forEach(function (side) {
        var collar = box(0.13, 0.08, 0.03, shade(R.outfit, 0.2), [side * 0.08, 1.06, 0.29]);
        collar.rotation.z = -side * 0.6;
        g.add(collar);
      });
      return g;
    },
    tuxedo: function (R) {
      var black = '#24272c';
      var g = baseBody(R, { top: black, sleeves: black, pants: black, boots: '#111214' });
      g.add(box(0.2, 0.42, 0.03, '#f7f5ef', [0, 0.88, torsoR(0.88) - 0.005]));           // shirt front
      [1, -1].forEach(function (side) {
        var lapel = box(0.07, 0.34, 0.035, '#33373e', [side * 0.11, 0.9, torsoR(0.9) + 0.005]);
        lapel.rotation.z = side * 0.28;
        g.add(lapel);
        g.add(sphere(0.045, '#b3202e', [side * 0.05, 1.05, torsoR(1.05) + 0.03], [1.2, 0.8, 0.6]));   // bow tie
      });
      g.add(sphere(0.025, '#b3202e', [0, 1.05, torsoR(1.05) + 0.04]));
      frontButtons(g, [0.9, 0.78, 0.66], '#24272c', 0.018);
      return g;
    },
    pirate_coat: function (R) {
      var red = '#7a1f2a';
      var g = baseBody(R, { top: '#f4f1e8', sleeves: red, pants: '#3a2f28', boots: '#1f1a16' });
      g.add(noOutline(mesh(new THREE.CylinderGeometry(0.318, 0.5, 0.86, 28, 1, true, PI * 0.16, PI * 1.68),
        mat(red, { side: THREE.DoubleSide }), [0, 0.67, 0])));
      [1, -1].forEach(function (side) {
        var a = side * 0.52;
        [0.95, 0.8, 0.65].forEach(function (y) {
          var r = torsoR(y) + 0.06 + (1.1 - y) * 0.25;
          g.add(sphere(0.03, mat(GOLD, { emissive: new THREE.Color('#3a2a00') }), [r * Math.sin(a), y, r * Math.cos(a)]));
        });
      });
      var sash = mesh(new THREE.TorusGeometry(0.35, 0.04, 8, 32), '#c0392b', [0, 0.6, 0]);
      sash.rotation.x = PI / 2;
      g.add(sash);
      g.add(sphere(0.06, '#c0392b', [0.2, 0.55, 0.3], [1, 1.4, 0.6]));
      return g;
    },
    disco: function (R) {
      var sequins = patternMat(shade(R.outfit, 0.05), 6, 4, function (g) {
        for (var y = 0; y < 64; y += 8) {
          for (var x = 0; x < 64; x += 8) {
            var k = (x * 7 + y * 13) % 5;
            g.fillStyle = k === 0 ? 'rgba(255,255,255,0.85)' : k < 3 ? shade(R.outfit, 0.25) : shade(R.outfit, -0.15);
            g.beginPath(); g.arc(x + 4, y + 4, 3.2, 0, PI * 2); g.fill();
          }
        }
      });
      sequins.emissive = new THREE.Color(shade(R.outfit, -0.35));
      var g = baseBody(R, { top: sequins, sleeves: sequins, pants: sequins, boots: '#f4f1e8' });
      [1, -1].forEach(function (side) {
        g.add(cyl(0.1, 0.17, 0.14, sequins, [side * 0.14, 0.17, 0], 16));                // bell bottoms
        var collar = box(0.16, 0.1, 0.03, '#ffffff', [side * 0.09, 1.05, 0.29]);
        collar.rotation.z = -side * 0.7;
        g.add(collar);
      });
      fx(g, 'shimmer', { mat: sequins });
      return g;
    },
    superhero: function (R) {
      var g = baseBody(R, { top: R.outfit, sleeves: R.outfit, pants: R.outfit, boots: '#c0392b', hands: '#c0392b' });
      var badge = mesh(new THREE.OctahedronGeometry(0.13), '#f2c230', [0, 0.92, torsoR(0.92) + 0.005]);
      badge.scale.set(1.1, 0.85, 0.22);
      g.add(badge);
      g.add(mesh(starGeo(0.06, 0.025, 0.02), '#c0392b', [0, 0.92, torsoR(0.92) + 0.035]));
      g.add(cyl(0.365, 0.37, 0.07, '#f2c230', [0, 0.6, 0], 28));
      g.add(box(0.1, 0.08, 0.03, '#c0392b', [0, 0.6, 0.37]));
      return g;
    },
    astronaut: function (R) {
      var white = '#f2f2ee';
      var g = baseBody(R, { top: white, sleeves: white, pants: white, boots: '#d9dcdf', hands: '#b8c1c7' });
      var collar = mesh(new THREE.TorusGeometry(0.24, 0.06, 10, 28), '#b8c1c7', [0, 1.1, 0]);
      collar.rotation.x = PI / 2;
      g.add(collar);
      g.add(box(0.22, 0.16, 0.05, '#7c8a93', [0, 0.86, torsoR(0.86) + 0.01]));         // control panel
      ['#e04848', '#3fa34d', '#f2c230'].forEach(function (c, i) {
        g.add(sphere(0.022, c, [-0.06 + i * 0.06, 0.88, torsoR(0.88) + 0.04]));
      });
      g.add(box(0.3, 0.04, 0.03, '#e8772e', [0, 0.7, torsoR(0.7) + 0.005]));
      [1, -1].forEach(function (side) { g.add(cyl(0.12, 0.12, 0.05, '#e8772e', [side * 0.14, 0.42, 0], 14)); });
      return g;
    },
    royal_robe: function (R) {
      var red = '#8e1b2c', fur = '#f7f5ef';
      var g = baseBody(R, { top: red, sleeves: red, pants: red, legs: false, bell: true });
      g.add(cyl(0.37, 0.56, 0.56, red, [0, 0.28, 0], 28));
      var hem = mesh(new THREE.TorusGeometry(0.55, 0.06, 8, 40), fur, [0, 0.03, 0]);
      hem.rotation.x = PI / 2;
      g.add(hem);
      var cape = mesh(new THREE.TorusGeometry(0.3, 0.09, 10, 32), fur, [0, 1.08, 0]);
      cape.rotation.x = PI / 2;
      g.add(cape);
      for (var i = 0; i < 12; i++) {                                                       // ermine spots
        var a = i / 12 * PI * 2;
        g.add(sphere(0.02, '#1f2125', [0.39 * Math.sin(a), 1.1, 0.39 * Math.cos(a)]));
        g.add(sphere(0.02, '#1f2125', [0.61 * Math.sin(a + 0.25), 0.05, 0.61 * Math.cos(a + 0.25)]));
      }
      var chain = mesh(new THREE.TorusGeometry(0.2, 0.015, 6, 28, PI), mat(GOLD, { emissive: new THREE.Color('#3a2a00') }), [0, 1.02, 0.25]);
      chain.rotation.z = PI;
      chain.rotation.x = 0.35;
      g.add(chain);
      g.add(mesh(new THREE.OctahedronGeometry(0.05), '#d83a4a', [0, 0.82, torsoR(0.82) + 0.03]));
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
    rake: function () {
      var g = group([0, 0, 0.1]); g.rotation.z = -0.3;
      g.add(stick(1.35, null, 0.25));
      g.add(box(0.34, 0.04, 0.04, METAL, [0, 0.92, 0]));
      for (var i = 0; i < 6; i++) {
        var tine = cyl(0.012, 0.01, 0.12, METAL, [-0.15 + i * 0.06, 0.86, 0.05], 6);
        tine.rotation.x = -0.9;
        g.add(tine);
      }
      return g;
    },
    shovel: function () {
      var g = group([0, 0, 0.1]); g.rotation.z = -0.25;
      g.add(stick(0.95, null, 0.275));
      g.add(mesh(new THREE.TorusGeometry(0.07, 0.022, 8, 16), '#5b3a24', [0, 0.82, 0]));
      g.add(cyl(0.035, 0.05, 0.12, METAL, [0, -0.24, 0], 10));
      g.add(sphere(0.14, METAL, [0, -0.38, 0.02], [1, 1.35, 0.22]));
      return g;
    },
    seed_bag: function () {
      var g = group([0, -0.06, 0.04]);
      g.add(sphere(0.15, '#c9a15a', [0, -0.12, 0], [1, 1.15, 0.85]));
      g.add(cyl(0.045, 0.08, 0.08, '#b48c4a', [0, 0.04, 0], 10));
      var tie = mesh(new THREE.TorusGeometry(0.05, 0.015, 6, 14), '#7a4f2a', [0, 0.02, 0]);
      tie.rotation.x = PI / 2;
      g.add(tie);
      g.add(sphere(0.05, '#4f8a3a', [0, -0.1, 0.13], [1, 1.3, 0.3]));
      return g;
    },
    shears: function () {
      var g = group([0, 0.02, 0.05]);
      g.scale.setScalar(1.4);
      [1, -1].forEach(function (side) {
        var arm = group();
        arm.rotation.z = side * 0.22;
        arm.add(cyl(0.028, 0.03, 0.2, '#c0392b', [0, -0.06, 0], 10));
        arm.add(box(0.035, 0.2, 0.012, METAL, [0, 0.14, side * 0.008]));
        g.add(arm);
      });
      g.add(sphere(0.03, '#7a7f84', [0, 0.04, 0.012]));
      return g;
    },
    magnifier: function () {
      var g = group(); g.rotation.z = -0.4;
      g.add(cyl(0.03, 0.035, 0.24, '#5b3a24', [0, 0, 0], 10));
      g.add(mesh(new THREE.TorusGeometry(0.12, 0.022, 8, 28), '#c9a227', [0, 0.25, 0]));
      g.add(noOutline(mesh(new THREE.CircleGeometry(0.115, 24), mat('#cfe9ff', { transparent: true, opacity: 0.45, side: THREE.DoubleSide }), [0, 0.25, 0])));
      return g;
    },
    lantern: function () {
      var g = group([0, -0.05, 0.03]);
      g.add(mesh(new THREE.TorusGeometry(0.07, 0.015, 6, 16, PI), '#3a3a3a', [0, 0, 0]));
      g.add(cyl(0.09, 0.1, 0.05, '#3a3a3a', [0, -0.03, 0], 12));
      g.add(cyl(0.08, 0.08, 0.18, mat('#ffe27a', { emissive: new THREE.Color('#b8860b') }), [0, -0.15, 0], 12));
      g.add(cyl(0.1, 0.09, 0.04, '#3a3a3a', [0, -0.26, 0], 12));
      [[0.16, -0.05, 0.05], [-0.14, -0.2, 0.08], [0.1, -0.3, -0.06]].forEach(function (p) {
        g.add(noOutline(sphere(0.018, mat('#fff59a', { emissive: new THREE.Color('#e0c000') }), p)));
      });
      return g;
    },
    banana: function () {
      var g = group([0, 0.05, 0.03]); g.rotation.z = 0.4;
      var peel = mesh(new THREE.TorusGeometry(0.2, 0.045, 10, 20, 1.5), '#f5d547', [-0.2, 0, 0]);
      peel.rotation.z = -0.75;
      g.add(peel);
      g.add(sphere(0.025, '#6b4a2e', [-0.2 + 0.2 * Math.cos(-0.75), 0.2 * Math.sin(-0.75), 0]));
      g.add(cyl(0.018, 0.024, 0.06, '#8a7a3a', [-0.2 + 0.2 * Math.cos(0.75), 0.2 * Math.sin(0.75) + 0.02, 0], 6));
      return g;
    },
    frying_pan: function () {
      var g = group([0, 0, 0.06]); g.rotation.z = -0.35;
      g.add(cyl(0.025, 0.03, 0.34, '#2b2622', [0, 0.05, 0], 8));
      var pan = group([0, 0.36, 0]);
      pan.rotation.x = PI / 2;
      pan.add(cyl(0.2, 0.17, 0.06, '#33363b', [0, 0, 0], 24));
      pan.add(cyl(0.17, 0.17, 0.01, '#4a4e55', [0, -0.03, 0], 24));
      g.add(pan);
      return g;
    },
    giant_carrot: function () {
      var g = group([0, 0, 0.05]); g.rotation.z = -0.3;
      var root = mesh(new THREE.ConeGeometry(0.12, 0.7, 16), '#e8772e', [0, 0.2, 0]);
      root.rotation.x = PI;
      g.add(root);
      [-0.4, 0, 0.4].forEach(function (a) {
        var leaf = mesh(new THREE.ConeGeometry(0.04, 0.26, 8), '#4f8a3a', [Math.sin(a) * 0.06, 0.66, 0]);
        leaf.rotation.z = -a;
        g.add(leaf);
      });
      return g;
    },
    bubble_wand: function () {
      var g = group([0, 0, 0.05]); g.rotation.z = -0.25;
      g.add(cyl(0.015, 0.015, 0.45, '#e84d8a', [0, 0.15, 0], 8));
      g.add(mesh(new THREE.TorusGeometry(0.08, 0.014, 8, 20), '#e84d8a', [0, 0.45, 0]));
      [[0.12, 0.6, 0.0, 0.06], [-0.05, 0.75, 0.1, 0.045], [0.18, 0.85, -0.05, 0.035]].forEach(function (b, i) {
        g.add(fx(noOutline(sphere(b[3], mat('#cfefff', { transparent: true, opacity: 0.45 }), [b[0], b[1], b[2]])), 'rise', { phase: i / 3 }));
      });
      return g;
    },
    fishing_rod: function () {
      var g = group([0, 0, 0.05]); g.rotation.x = -0.35; g.rotation.z = -0.15;
      g.add(cyl(0.012, 0.025, 1.3, '#5b3a24', [0, 0.45, 0], 8));
      var reel = cyl(0.05, 0.05, 0.05, '#9aa3ab', [0.05, -0.02, 0], 12);
      reel.rotation.z = PI / 2;
      g.add(reel);
      g.add(cyl(0.004, 0.004, 0.8, '#e8eef2', [0, 0.7, 0.18], 4));                        // line
      g.add(sphere(0.04, '#e04848', [0, 0.32, 0.22]));
      g.add(sphere(0.025, '#ffffff', [0, 0.35, 0.22]));
      return g;
    },
    rubber_chicken: function () {
      var g = group([0, -0.05, 0.04]);
      g.add(cyl(0.012, 0.012, 0.12, '#e8a23a', [0, -0.02, 0], 6));                      // feet in the hand
      g.add(sphere(0.1, '#f5d547', [0, -0.2, 0], [0.8, 1.4, 0.8]));
      g.add(cyl(0.035, 0.03, 0.14, '#f5d547', [0, -0.38, 0], 10));                      // floppy neck
      g.add(sphere(0.07, '#f5d547', [0, -0.48, 0.02]));
      var beak = mesh(new THREE.ConeGeometry(0.03, 0.08, 8), '#e8772e', [0, -0.5, 0.09]);
      beak.rotation.x = PI / 2;
      g.add(beak);
      [0, 0.04, -0.04].forEach(function (z) { g.add(sphere(0.025, '#e04848', [0, -0.55, z + 0.01])); });
      petEyes(g, 0, -0.46, 0.065, 0.03);
      return g;
    },
    magic_wand: function () {
      var g = group([0, 0, 0.05]); g.rotation.z = -0.3;
      g.add(cyl(0.018, 0.022, 0.5, '#1f2125', [0, 0.2, 0], 8));
      g.add(cyl(0.019, 0.019, 0.08, '#f7f5ef', [0, 0.42, 0], 8));
      var star = fx(mesh(starGeo(0.1, 0.045, 0.03), mat('#ffd54a', { emissive: new THREE.Color('#8a6400') }), [0, 0.55, 0]), 'spin', { speed: 1.5 });
      g.add(star);
      [[0.12, 0.62], [-0.1, 0.7], [0.05, 0.75]].forEach(function (p, i) {
        g.add(fx(noOutline(sphere(0.018, mat('#fff59a', { emissive: new THREE.Color('#e0c000') }), [p[0], p[1], 0.02])), 'twinkle', { phase: i * 0.7 }));
      });
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
    scarf: function () {
      var g = group(), red = '#c0392b', light = '#f4f1e8';
      var wrap = mesh(new THREE.TorusGeometry(0.29, 0.075, 10, 28), red, [0, 1.0, 0.02]);
      wrap.rotation.x = PI / 2;
      g.add(wrap);
      var end = group([0.12, 0.8, torsoR(0.8) + 0.04]);
      end.rotation.z = 0.12;
      end.add(box(0.13, 0.34, 0.05, red));
      end.add(box(0.135, 0.03, 0.055, light, [0, -0.08, 0]));
      end.add(box(0.135, 0.03, 0.055, light, [0, -0.13, 0]));
      g.add(end);
      return g;
    },
    bedroll: function () {
      var g = group();
      var roll = cyl(0.13, 0.13, 0.62, '#3d7a5c', [0, 1.08, -0.5], 20);
      roll.rotation.z = PI / 2;
      g.add(roll);
      [0.19, -0.19].forEach(function (x) {
        var strap = mesh(new THREE.TorusGeometry(0.135, 0.02, 6, 20), '#5b3a24', [x, 1.08, -0.5]);
        strap.rotation.y = PI / 2;
        g.add(strap);
      });
      frontStraps(g, '#5b3a24');
      return g;
    },
    sprayer: function () {
      var g = group(), red = '#d64541', dark = '#3a3a3a';
      g.add(cyl(0.17, 0.17, 0.5, red, [0, 0.82, -0.48], 22));
      g.add(sphere(0.17, red, [0, 1.07, -0.48], [1, 0.5, 1]));
      g.add(cyl(0.05, 0.05, 0.06, dark, [0, 1.16, -0.48], 10));
      g.add(cyl(0.012, 0.012, 0.36, dark, [0.21, 0.98, -0.48], 6));
      g.add(box(0.12, 0.03, 0.03, dark, [0.21, 1.16, -0.48]));
      var hose = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0.1, 0.6, -0.55), new THREE.Vector3(0.36, 0.48, -0.36),
        new THREE.Vector3(0.43, 0.46, 0.0), new THREE.Vector3(0.4, 0.5, 0.24)]);
      g.add(mesh(new THREE.TubeGeometry(hose, 24, 0.018, 6, false), dark));
      var wand = cyl(0.016, 0.016, 0.22, '#9aa3ab', [0.38, 0.54, 0.33], 6);
      wand.rotation.x = 1.2;
      g.add(wand);
      frontStraps(g, dark);
      return g;
    },
    sunflower: function () {
      var g = group();
      var stem = cyl(0.03, 0.035, 1.6, '#4f8a3a', [0.3, 1.25, -0.45], 8);
      stem.rotation.z = -0.15;
      g.add(stem);
      [[0.32, 1.15, -0.6], [0.36, 1.45, 0.6]].forEach(function (l) {
        var leaf = sphere(0.12, '#6bbf59', [l[0] + 0.12 * Math.sign(l[2]), l[1], -0.45], [1.4, 0.35, 0.7]);
        leaf.rotation.z = l[2];
        g.add(leaf);
      });
      var head = group([0.42, 2.05, -0.42]);
      head.rotation.x = -0.25;
      var disc = cyl(0.16, 0.16, 0.06, '#6b4226', [0, 0, 0], 24);
      disc.rotation.x = PI / 2;
      head.add(disc);
      for (var i = 0; i < 14; i++) {
        var a = i / 14 * PI * 2;
        var petal = sphere(0.09, '#f2c230', [Math.cos(a) * 0.25, Math.sin(a) * 0.25, 0], [0.55, 1.2, 0.2]);
        petal.rotation.z = a - PI / 2;
        head.add(petal);
      }
      g.add(head);
      g.add(box(0.2, 0.25, 0.12, '#8b5e3c', [0.22, 0.8, -0.45]));
      frontStraps(g, '#8b5e3c');
      return g;
    },
    butterfly_wings: function () {
      var g = group();
      function wing(side, pos, rotZ, r, color) {
        var w = group([side * pos[0], pos[1], -0.46]);
        w.rotation.z = -side * rotZ;
        // coloured on both faces with a dark rim showing around the edge
        w.add(sphere(r, color, [0, 0, 0.012], [0.72, 1.12, 0.08], { emissive: new THREE.Color('#3a1d00') }));
        w.add(sphere(r * 1.12, '#2b2622', [0, 0, 0], [0.72, 1.12, 0.07]));
        w.add(sphere(r, color, [0, 0, -0.012], [0.72, 1.12, 0.08], { emissive: new THREE.Color('#3a1d00') }));
        [[0, 0.72], [0.36, 0.48], [-0.36, 0.48]].forEach(function (p) {
          [0.04, -0.04].forEach(function (z) {
            w.add(sphere(r * 0.11, '#fff7e8', [p[0] * r * 0.72, p[1] * r * 1.12, z]));
          });
        });
        return w;
      }
      [1, -1].forEach(function (side) {
        g.add(wing(side, [0.47, 1.22], 0.75, 0.34, '#f39c34'));
        g.add(wing(side, [0.4, 0.78], 2.2, 0.24, '#f6b85c'));
      });
      return g;
    },
    jetpack: function () {
      var g = group(), steel = '#b8c1c7';
      [1, -1].forEach(function (side) {
        g.add(cyl(0.11, 0.11, 0.5, steel, [side * 0.13, 0.85, -0.47], 18));
        g.add(sphere(0.11, steel, [side * 0.13, 1.1, -0.47], [1, 0.6, 1]));
        g.add(mesh(new THREE.ConeGeometry(0.08, 0.12, 14), '#5b636b', [side * 0.13, 0.56, -0.47]));
        var flame = fx(noOutline(mesh(new THREE.ConeGeometry(0.07, 0.3, 12),
          mat('#ffb347', { emissive: new THREE.Color('#ff6a00'), transparent: true, opacity: 0.85 }), [side * 0.13, 0.36, -0.47])), 'flicker', { phase: side });
        flame.rotation.x = PI;
        g.add(flame);
      });
      g.add(box(0.12, 0.4, 0.14, '#e04848', [0, 0.85, -0.45]));
      frontStraps(g, '#3a3a3a');
      return g;
    },
    aqualung: function () {
      var g = group(), yellow = '#f2c230';
      g.add(cyl(0.15, 0.15, 0.62, yellow, [0, 0.82, -0.48], 22));
      g.add(sphere(0.15, yellow, [0, 1.13, -0.48], [1, 0.6, 1]));
      g.add(cyl(0.04, 0.04, 0.1, '#2b2b2b', [0, 1.24, -0.48], 10));
      g.add(mesh(new THREE.TorusGeometry(0.05, 0.015, 6, 14), '#2b2b2b', [0, 1.3, -0.48]));
      var hose = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 1.28, -0.48), new THREE.Vector3(0.22, 1.32, -0.3),
        new THREE.Vector3(0.34, 1.18, 0.0), new THREE.Vector3(0.3, 1.0, 0.24)]);
      g.add(mesh(new THREE.TubeGeometry(hose, 24, 0.02, 6, false), '#2b2b2b'));
      var gauge = cyl(0.05, 0.05, 0.03, '#d9dcdf', [0.3, 0.98, 0.27], 14);                  // pressure gauge
      gauge.rotation.x = PI / 2;
      g.add(gauge);
      [0.95, 0.68].forEach(function (y) {
        var band = mesh(new THREE.TorusGeometry(0.155, 0.015, 6, 20), '#2b2b2b', [0, y, -0.48]);
        band.rotation.x = PI / 2;
        g.add(band);
      });
      frontStraps(g, '#2b2b2b');
      return g;
    },
    turtle_shell: function () {
      var g = group();
      var shellMat = patternMat('#5c8a3a', 3, 2, function (c) {
        c.strokeStyle = '#3e6127'; c.lineWidth = 3;
        for (var y = 0; y < 64; y += 21) for (var x = (y / 21) % 2 ? 10 : 0; x < 70; x += 21) {
          c.beginPath();
          for (var k = 0; k < 6; k++) { var a = k / 6 * PI * 2; c.lineTo(x + Math.cos(a) * 11, y + Math.sin(a) * 11); }
          c.closePath(); c.stroke();
        }
      });
      var dome = mesh(new THREE.SphereGeometry(0.46, 28, 16, 0, PI * 2, 0, PI * 0.5), shellMat, [0, 0.82, -0.36]);
      dome.rotation.x = -PI / 2;
      dome.scale.set(1, 0.6, 1.15);
      g.add(dome);
      var rim = mesh(new THREE.TorusGeometry(0.46, 0.04, 8, 32), '#c9b48a', [0, 0.82, -0.36]);
      rim.scale.set(1, 1.15, 1);
      g.add(rim);
      return g;
    },
    balloons: function () {
      var g = group();
      [['#e04848', 0.42, 2.45, -0.2], ['#3d7fe0', 0.62, 2.25, -0.3], ['#f2c230', 0.3, 2.2, -0.42]].forEach(function (b, i) {
        var bal = fx(group([b[1], b[2], b[3]]), 'bob', { amp: 0.05, speed: 1.3 + i * 0.3 });
        bal.add(sphere(0.18, b[0], [0, 0, 0], [1, 1.18, 1]));
        bal.add(mesh(new THREE.ConeGeometry(0.03, 0.05, 8), b[0], [0, -0.22, 0]));
        g.add(bal);
        var from = new THREE.Vector3(0.22, 1.02, -0.3), to = new THREE.Vector3(b[1], b[2] - 0.24, b[3]);
        var str = cyl(0.004, 0.004, from.distanceTo(to), '#7a7f84', [(from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2], 4);
        pointOut(str, from, to);
        g.add(noOutline(str));
      });
      return g;
    },
    angel_wings: function () {
      var g = group();
      [1, -1].forEach(function (side) {
        var wing = fx(group([side * 0.14, 1.02, -0.42]), 'flap', { side: side, amp: 0.18, speed: 1.4 });
        for (var i = 0; i < 6; i++) {                // a fan of feathers sweeping up and out
          var f = sphere(0.24 - i * 0.022, mat('#ffffff', { emissive: new THREE.Color('#2a2a30') }),
            [side * (0.2 + i * 0.07), 0.05 + i * 0.07, -0.02 - i * 0.012], [1.55, 0.4, 0.12]);
          f.rotation.z = side * (0.15 + i * 0.16);
          wing.add(f);
        }
        g.add(wing);
      });
      return g;
    },
    dragon_wings: function () {
      var g = group(), skin = '#4a7a3a';
      [1, -1].forEach(function (side) {
        var wing = fx(group([side * 0.15, 1.0, -0.42]), 'flap', { side: side, amp: 0.22, speed: 2.0 });
        var sh = new THREE.Shape();
        sh.moveTo(0, 0); sh.lineTo(0.75, 0.45); sh.lineTo(0.7, 0.05);
        sh.quadraticCurveTo(0.6, -0.05, 0.52, -0.2); sh.quadraticCurveTo(0.42, -0.12, 0.33, -0.3);
        sh.quadraticCurveTo(0.22, -0.18, 0.12, -0.3); sh.closePath();
        var memb = noOutline(mesh(new THREE.ShapeGeometry(sh), mat('#6b9a4a', { side: THREE.DoubleSide })));
        memb.scale.x = side;
        wing.add(memb);
        [[0.75, 0.45], [0.52, -0.2], [0.33, -0.3]].forEach(function (tip) {
          var from = new THREE.Vector3(0, 0, 0), to = new THREE.Vector3(side * tip[0], tip[1], 0);
          var bone = cyl(0.016, 0.01, from.distanceTo(to), skin, [to.x / 2, to.y / 2, 0], 6);
          pointOut(bone, from, to);
          wing.add(bone);
        });
        g.add(wing);
      });
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
  // Every companion is built facing the viewer at its own origin (ground
  // level, or its centre if it flies), and marks where a hat goes
  // (userData.top). Colours come from a palette so the player's chosen
  // companion colour replaces the main colour.
  function petEyes(g, x, y, z, spread) {
    g.add(sphere(0.022, '#1c1714', [x - spread, y, z]));
    g.add(sphere(0.022, '#1c1714', [x + spread, y, z]));
  }
  function petPalette(R) {
    var c = R.petColor;
    return {
      main: function (def) { return c || def; },
      dark: function (def) { return c ? shade(c, -0.12) : def; },
      light: function (def) { return c ? shade(c, 0.16) : def; }
    };
  }
  var FLY_POS = [-0.85, 1.35, 0.35];
  var PETS = {
    worm: function (R, P) {
      var g = group();
      for (var i = 0; i < 6; i++) {
        var r = 0.11 - i * 0.009;
        g.add(sphere(r, i % 2 ? P.dark('#e8909c') : P.main('#f0a1ac'), [-i * 0.12, r + 0.02 + Math.sin(i * 1.3) * 0.04, -i * 0.03]));
      }
      g.add(sphere(0.125, P.main('#f0a1ac'), [0.1, 0.2, 0.03]));
      petEyes(g, 0.12, 0.24, 0.14, 0.045);
      g.userData.top = [0.1, 0.32, 0.03];
      return g;
    },
    snail: function (R, P) {
      var g = group();
      g.add(sphere(0.12, '#c9d3a8', [0, 0.08, 0], [2.1, 0.65, 0.9]));
      g.add(sphere(0.2, P.main('#c47a3a'), [-0.06, 0.3, 0]));
      g.add(mesh(new THREE.TorusGeometry(0.1, 0.03, 8, 20), P.dark('#8d4f22'), [-0.06, 0.3, 0.17]));
      [0.06, -0.06].forEach(function (z) {
        var stalk = cyl(0.015, 0.015, 0.16, '#c9d3a8', [0.2, 0.2, z], 6);
        stalk.rotation.z = -0.3;
        g.add(stalk);
        g.add(sphere(0.035, '#1c1714', [0.23, 0.29, z]));
      });
      g.userData.top = [-0.06, 0.49, 0];
      return g;
    },
    bee: function (R, P) {
      var g = group();
      g.userData.flying = true;
      g.add(sphere(0.14, P.main('#f2c230'), [0, 0, 0], [1.3, 1, 1]));
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
      g.userData.top = [0.2, 0.1, 0];
      return g;
    },
    sprout: function (R, P) {
      var g = group();
      g.add(sphere(0.2, P.main('#9be07f'), [0, 0.18, 0], [1, 0.85, 1], { emissive: new THREE.Color('#1f4d16') }));
      petEyes(g, 0, 0.21, 0.18, 0.06);
      g.add(cyl(0.015, 0.015, 0.12, '#4f8a3a', [0, 0.4, 0], 6));
      [1, -1].forEach(function (side) {
        var leaf = sphere(0.08, P.dark('#6bbf59'), [side * 0.07, 0.47, 0], [1.3, 0.35, 0.8]);
        leaf.rotation.z = side * 0.5;
        g.add(leaf);
      });
      g.userData.top = [0.1, 0.33, 0];
      return g;
    },
    frog: function (R, P) {
      var g = group();
      g.add(sphere(0.17, P.main('#6bbf59'), [0, 0.13, 0], [1.15, 0.75, 1]));
      g.add(sphere(0.12, P.light('#d8efb8'), [0, 0.1, 0.07], [1.1, 0.7, 0.8]));
      [1, -1].forEach(function (side) {
        g.add(sphere(0.065, P.main('#6bbf59'), [side * 0.08, 0.24, 0.05]));
        g.add(sphere(0.045, '#ffffff', [side * 0.08, 0.26, 0.09]));
        g.add(sphere(0.022, '#1c1714', [side * 0.08, 0.26, 0.13]));
        g.add(sphere(0.07, P.dark('#58a84a'), [side * 0.17, 0.05, -0.04], [0.8, 0.5, 1.5]));   // back legs
        g.add(sphere(0.035, P.dark('#58a84a'), [side * 0.1, 0.03, 0.15], [1.2, 0.6, 1]));      // front feet
      });
      var smile = mesh(new THREE.TorusGeometry(0.07, 0.008, 6, 16, PI * 0.8), '#2b3a22', [0, 0.17, 0.17]);
      smile.rotation.z = PI * 1.1;
      g.add(smile);
      g.userData.top = [0, 0.29, 0];
      return g;
    },
    chick: function (R, P) {
      var g = group();
      g.add(sphere(0.15, P.main('#f7d84a'), [0, 0.16, 0]));
      g.add(sphere(0.1, P.main('#f7d84a'), [0, 0.32, 0.03]));
      var beak = mesh(new THREE.ConeGeometry(0.03, 0.07, 8), '#e8892e', [0, 0.31, 0.14]);
      beak.rotation.x = PI / 2;
      g.add(beak);
      petEyes(g, 0, 0.35, 0.11, 0.04);
      [1, -1].forEach(function (side) {
        var wing = sphere(0.07, P.dark('#e8c23a'), [side * 0.14, 0.17, 0], [0.4, 0.8, 1]);
        wing.rotation.z = side * 0.3;
        g.add(wing);
        g.add(cyl(0.012, 0.012, 0.06, '#e8892e', [side * 0.05, 0.03, 0.02], 6));
        g.add(sphere(0.03, '#e8892e', [side * 0.05, 0.005, 0.05], [1, 0.4, 1.3]));
      });
      [-0.3, 0, 0.3].forEach(function (a) {
        var tuft = mesh(new THREE.ConeGeometry(0.015, 0.06, 6), P.main('#f7d84a'), [Math.sin(a) * 0.03, 0.43, 0.02]);
        tuft.rotation.z = -a;
        g.add(tuft);
      });
      g.userData.top = [0.03, 0.41, 0.02];
      return g;
    },
    ladybug: function (R, P) {
      var g = group();
      g.userData.flying = true;
      var shell = mesh(new THREE.SphereGeometry(0.14, 20, 12, 0, PI * 2, 0, PI * 0.5), P.main('#d83a3a'), [0, 0, 0]);
      shell.rotation.x = -0.25;
      g.add(shell);
      g.add(sphere(0.135, '#1f1f22', [0, -0.01, 0], [1, 0.35, 1]));                         // underside
      g.add(box(0.012, 0.01, 0.27, '#1f1f22', [0, 0.11, 0]));
      [[0.06, 0.07, 0.05], [-0.06, 0.07, 0.05], [0.07, 0.06, -0.06], [-0.07, 0.06, -0.06], [0, 0.12, -0.02]].forEach(function (p) {
        g.add(sphere(0.025, '#1f1f22', p, [1, 0.5, 1]));
      });
      g.add(sphere(0.07, '#1f1f22', [0, 0.02, 0.14]));
      petEyes(g, 0, 0.04, 0.2, 0.03);
      [1, -1].forEach(function (side) {
        var ant = cyl(0.006, 0.006, 0.1, '#1f1f22', [side * 0.03, 0.1, 0.17], 4);
        ant.rotation.z = -side * 0.4;
        ant.rotation.x = 0.4;
        g.add(ant);
      });
      g.userData.top = [0, 0.13, 0];
      return g;
    },
    hedgehog: function (R, P) {
      var g = group();
      var spikes = P.main('#7a5a3a');
      g.add(sphere(0.17, P.dark('#6b4a2e'), [0, 0.15, -0.02], [1, 0.82, 1.2]));
      g.add(sphere(0.11, '#e8c9a0', [0, 0.13, 0.12], [1, 0.9, 1]));                          // face
      var snout = mesh(new THREE.ConeGeometry(0.05, 0.1, 10), '#e8c9a0', [0, 0.11, 0.24]);
      snout.rotation.x = PI / 2;
      g.add(snout);
      g.add(sphere(0.02, '#1c1714', [0, 0.11, 0.29]));
      petEyes(g, 0, 0.17, 0.2, 0.045);
      var centre = new THREE.Vector3(0, 0.15, -0.02);
      for (var i = 0; i < 30; i++) {
        var a = i * 2.39996, yy = 1 - (i + 0.5) / 30 * 1.6;                               // golden-angle spread
        if (yy < -0.35) continue;
        var rr = Math.sqrt(Math.max(0, 1 - yy * yy));
        var dir = new THREE.Vector3(Math.cos(a) * rr, yy, Math.sin(a) * rr - 0.35).normalize();
        if (dir.z > 0.45) continue;                                                         // keep the face clear
        var tip = centre.clone().add(new THREE.Vector3(dir.x * 0.17, dir.y * 0.14, dir.z * 0.2));
        var sp = mesh(new THREE.ConeGeometry(0.028, 0.12, 6), spikes, [tip.x, tip.y, tip.z]);
        pointOut(sp, centre, tip);
        g.add(sp);
      }
      [1, -1].forEach(function (side) { g.add(sphere(0.03, P.dark('#6b4a2e'), [side * 0.08, 0.02, 0.06], [1, 0.5, 1.3])); });
      g.userData.top = [0, 0.29, 0.04];
      return g;
    }
  };

  // small things a companion can wear, built upwards from the hat spot
  var PET_ACCESSORIES = {
    bow: function () {
      var g = group();
      [1, -1].forEach(function (side) { g.add(sphere(0.045, '#e84d8a', [side * 0.045, 0.03, 0], [1, 0.7, 0.4])); });
      g.add(sphere(0.022, '#c23a72', [0, 0.03, 0]));
      return g;
    },
    party_hat: function () {
      var g = group();
      g.add(mesh(new THREE.ConeGeometry(0.06, 0.15, 14), '#3fa3e0', [0, 0.075, 0]));
      g.add(sphere(0.02, '#f2c230', [0, 0.16, 0]));
      return g;
    },
    flower: function () {
      var g = group([0.04, 0.02, 0.02]);
      for (var i = 0; i < 6; i++) {
        var a = i / 6 * PI * 2;
        g.add(sphere(0.025, '#ffffff', [Math.cos(a) * 0.035, 0.03 + Math.sin(a) * 0.035, 0], [1, 1, 0.4]));
      }
      g.add(sphere(0.02, '#f2c230', [0, 0.03, 0.01]));
      return g;
    },
    top_hat: function () {
      var g = group();
      g.add(cyl(0.09, 0.09, 0.01, '#1f2125', [0, 0.005, 0], 18));
      g.add(cyl(0.055, 0.058, 0.12, '#1f2125', [0, 0.07, 0], 16));
      g.add(cyl(0.059, 0.059, 0.02, '#9e2b2b', [0, 0.025, 0], 16));
      return g;
    },
    crown: function () {
      var g = group();
      var gold = mat('#f2c230', { emissive: new THREE.Color('#5a4100') });
      g.add(cyl(0.06, 0.055, 0.04, gold, [0, 0.02, 0], 16));
      for (var i = 0; i < 4; i++) {
        var a = i / 4 * PI * 2;
        g.add(mesh(new THREE.ConeGeometry(0.015, 0.05, 6), gold, [Math.sin(a) * 0.055, 0.06, Math.cos(a) * 0.055]));
      }
      return g;
    }
  };
  var PET_SIZES = { tiny: 0.6, small: 0.8, normal: 1, big: 1.35 };

  // companion + its colour, accessory and size; the outer group carries
  // the position (and the idle bounce / flight), the inner one the scale
  function buildPet(R) {
    var fn = PETS[R.a.pet];
    if (!fn) return null;
    var body = fn(R, petPalette(R));
    var flying = !!body.userData.flying;
    var g = group(flying ? FLY_POS : [PET.x, PET.y, PET.z]);
    g.userData.flying = flying;
    var acc = PET_ACCESSORIES[R.a.petAccessory];
    if (acc && body.userData.top) {
      var a = acc(R);
      a.position.add(new THREE.Vector3().fromArray(body.userData.top));
      body.add(a);
    }
    var k = PET_SIZES[R.a.petSize] || 1;
    body.scale.setScalar(k);
    g.add(body);
    g.userData.top = body.userData.top ? body.userData.top[1] * k : 0.3;
    g.userData.size = k;
    return g;
  }

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
    var body = (BODY[R.a.body] || BODY.tunic)(R);
    var shape = BODY_SHAPE[R.a.gender];             // a little broader or narrower in the shoulders
    if (shape) body.scale.set(shape[0], 1, shape[1]);
    hero.add(body);
    // head, hair and hat turn together around the neck
    var headRig = group([0, NECK_Y, 0]), headParts = group([0, -NECK_Y, 0]);
    headRig.add(headParts);
    var headGroup = buildHead(R);
    headParts.add(headGroup);
    var hat = HEAD[R.a.head];
    headParts.add(buildHair(R, !!hat && !NO_COVER[R.a.head]));
    if (hat) headParts.add(hat(R));
    if (EARRINGS[R.a.earrings]) [1, -1].forEach(function (side) { headParts.add(EARRINGS[R.a.earrings](R, side)); });
    hero.add(headRig);
    if (BACK[R.a.back]) hero.add(BACK[R.a.back](R));
    var arms = body.userData.arms || {};
    var tool = buildHandItem(R);
    if (tool) {
      hero.add(tool);
      if (arms[1]) { root.updateMatrixWorld(true); arms[1].attach(tool); }   // the tool moves with its hand
    }
    var pet = buildPet(R);
    if (pet) root.add(pet);
    addOutlines(root);
    var effects = [];
    root.traverse(function (o) {
      if (!o.userData.fx) return;
      o.userData.base = { y: o.position.y, ry: o.rotation.y, sy: o.scale.y };
      effects.push(o);
    });
    root.userData = { hero: hero, pet: pet, petBase: pet ? pet.position.clone() : null,
                      headRig: headRig, arms: arms, face: headGroup.userData.face, hasTool: !!tool, effects: effects };
    return root;
  }
  var BODY_SHAPE = { female: [0.94, 0.97], male: [1.07, 1.03] };

  // looping item effects: propellers spin, jet flames flicker, balloons bob...
  function runEffects(list, t) {
    list.forEach(function (o, i) {
      var b = o.userData.base, f = o.userData.fxo || {}, ph = f.phase || i;
      switch (o.userData.fx) {
        case 'spin': o.rotation.y = b.ry + t * (f.speed || 3); break;
        case 'bob': o.position.y = b.y + Math.sin(t * (f.speed || 1.5) + ph) * (f.amp || 0.05); break;
        case 'flicker': o.scale.y = b.sy * (0.8 + 0.25 * Math.sin(t * 31 + ph) * Math.sin(t * 17 + ph * 2) + 0.15 * Math.sin(t * 9)); break;
        case 'flap': o.rotation.y = b.ry + (f.side || 1) * Math.sin(t * (f.speed || 2) + ph) * (f.amp || 0.2); break;
        case 'rise':
          var k = (t * 0.35 + ph) % 1;
          o.position.y = b.y + k * 0.5;
          o.scale.setScalar(k < 0.1 ? k * 10 : k > 0.85 ? (1 - k) / 0.15 : 1);
          break;
        case 'twinkle': o.scale.setScalar(0.4 + 0.6 * Math.abs(Math.sin(t * 3 + ph))); break;
        case 'shimmer': if (f.mat) f.mat.emissiveIntensity = 0.8 + 0.5 * Math.sin(t * 4); break;
      }
    });
  }

  function dispose(obj) {
    obj.traverse(function (o) {
      if (o.userData && o.userData.isOutline) return;
      if (o.userData && o.userData.blinkMap) { o.userData.blinkMap.dispose(); o.userData.openMap.dispose(); }
      if (o.geometry) o.geometry.dispose();
      if (o.material && o.material !== outlineMat) {
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      }
    });
  }

  // ---------- movement: idle breathing + blinking + emotes every few seconds ----------
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function smooth(x) { x = clamp01(x); return x * x * (3 - 2 * x); }
  function bump(p, a, b) { return smooth((p - a) / 0.18) * (1 - smooth((p - b) / 0.18)); }   // 0 -> 1 -> 0 between a and b
  function armZ(u, side, angle) { if (u.arms[side]) u.arms[side].rotation.z = u.arms[side].userData.rest + side * angle; }
  function armX(u, side, angle) { if (u.arms[side]) u.arms[side].rotation.x = angle; }

  // p goes 0..1 over the emote's duration; every emote starts and ends in the rest pose
  var EMOTES = {
    wave: { dur: 2.0, weight: 3, run: function (u, p) {
      var up = bump(p, 0.02, 0.82);
      armZ(u, -1, up * (1.95 + Math.sin(p * 30) * 0.3));
      armX(u, -1, -0.4 * up);                     // a little forward, so the hand shows beside the face
      u.headRig.rotation.z = up * 0.12;
    }},
    look: { dur: 2.6, weight: 3, run: function (u, p) {
      var e = bump(p, 0.02, 0.84);
      u.headRig.rotation.y = Math.sin(p * PI * 2) * 0.65 * e;
      u.headRig.rotation.x = -0.08 * e;
    }},
    hop: { dur: 1.0, weight: 2, run: function (u, p) {
      var air = clamp01((p - 0.22) / 0.56);
      var inAir = p > 0.22 && p < 0.78;
      u.hero.position.y += inAir ? Math.sin(air * PI) * 0.34 : 0;
      var squash = (p < 0.22 ? Math.sin(p / 0.22 * PI) : p > 0.78 ? Math.sin((p - 0.78) / 0.22 * PI) : 0) * 0.08;
      u.hero.scale.set(1 + squash * 0.6, 1 - squash, 1 + squash * 0.6);
      var flap = inAir ? Math.sin(air * PI) * 0.7 : 0;
      armZ(u, 1, flap); armZ(u, -1, flap);
    }},
    swing: { dur: 1.5, weight: 3, needsTool: true, run: function (u, p) {
      // lift the tool up and forward, then strike down, twice
      var k = (p * 2) % 1, e = bump(p, 0.02, 0.86);
      var a = k < 0.55 ? -1.5 * smooth(k / 0.55) : -1.5 + 1.8 * smooth((k - 0.55) / 0.3);
      armX(u, 1, a * e);
      u.hero.rotation.x = (k > 0.55 ? 0.07 : 0) * e;
    }},
    pump: { dur: 1.4, weight: 1, run: function (u, p) {           // fist pump
      var up = bump(p, 0.02, 0.8);
      armZ(u, 1, up * (2.05 + Math.sin(p * 22) * 0.25));
      armX(u, 1, -0.3 * up);
      u.hero.position.y += Math.abs(Math.sin(p * PI * 3)) * 0.06 * up;
    }},
    nod: { dur: 1.2, weight: 1, run: function (u, p) {
      u.headRig.rotation.x = Math.sin(p * PI * 4) * 0.2 * bump(p, 0.02, 0.85);
    }},
    twirl: { dur: 1.5, weight: 1, run: function (u, p) {
      u.hero.rotation.y = smooth(p) * PI * 2;
      u.hero.position.y += Math.sin(clamp01(p) * PI) * 0.12;
      var out = bump(p, 0.05, 0.8) * 0.5;
      armZ(u, 1, out); armZ(u, -1, out);
    }},
    stretch: { dur: 2.4, weight: 1, run: function (u, p) {
      var up = bump(p, 0.04, 0.78);
      armZ(u, 1, up * 2.2); armZ(u, -1, up * 2.2);
      armX(u, 1, -0.25 * up); armX(u, -1, -0.25 * up);
      u.hero.scale.y = 1 + up * 0.04;
      u.headRig.rotation.x = -0.18 * up;
    }},
    cheer: { dur: 1.3, weight: 2, run: function (u, p) {
      var up = bump(p, 0.02, 0.84);
      armZ(u, 1, up * (2.1 + Math.sin(p * 18) * 0.15)); armZ(u, -1, up * (2.1 + Math.sin(p * 18 + 1.5) * 0.15));
      armX(u, 1, -0.3 * up); armX(u, -1, -0.3 * up);
      u.hero.position.y += Math.abs(Math.sin(p * PI * 2)) * 0.16 * up;
    }}
  };
  var EMOTE_NAMES = Object.keys(EMOTES);

  function pickEmote(u) {
    var list = [], total = 0;
    EMOTE_NAMES.forEach(function (n) {
      var e = EMOTES[n];
      if (n === u.lastEmote || (e.needsTool && !u.hasTool)) return;
      list.push(n); total += e.weight;
    });
    var r = Math.random() * total;
    for (var i = 0; i < list.length; i++) { r -= EMOTES[list[i]].weight; if (r <= 0) return list[i]; }
    return list[0];
  }

  // Start an emote now (e.g. when the hero is tapped); null = surprise me.
  function playEmote(root, name) {
    var u = root && root.userData;
    if (!u || !u.hero || !u.arms) return;
    u.queued = name && EMOTES[name] ? name : pickEmote(u);
  }

  function setBlink(u, closed) {
    var face = u.face;
    if (!face) return;
    if (closed && !face.userData.blinkMap) face.userData.blinkMap = headTexture(face.userData.R, true);
    face.material.map = closed ? face.userData.blinkMap : face.userData.openMap;
  }

  function animate(root, t, opts) {
    var u = root.userData;
    if (!u || !u.hero) return;
    var calm = opts && opts.calm;                 // reduced motion: breathe and blink only
    // rest pose + idle breathing / sway
    u.hero.position.y = Math.sin(t * 2.2) * 0.018;
    u.hero.rotation.set(0, 0, 0);
    u.hero.scale.set(1, 1 + Math.sin(t * 2.2) * 0.008, 1);
    if (u.headRig) u.headRig.rotation.set(Math.sin(t * 1.1) * 0.02, Math.sin(t * 0.45) * 0.06, Math.sin(t * 0.9) * 0.03);
    [1, -1].forEach(function (side) {
      if (!u.arms || !u.arms[side]) return;
      u.arms[side].rotation.z = u.arms[side].userData.rest + side * (0.03 + Math.sin(t * 2.2) * 0.025);
      u.arms[side].rotation.x = Math.sin(t * 1.1 + side) * 0.05;
    });

    // emotes: one every 4-9 seconds, never the same twice in a row
    if (u.nextEmote === undefined) u.nextEmote = t + 1.5 + Math.random() * 2;
    if (u.headRig && u.arms) {
      if (u.queued && !u.emote) { u.emote = u.queued; u.queued = null; u.emoteStart = t; }
      if (!calm && !u.emote && t >= u.nextEmote) { u.emote = pickEmote(u); u.emoteStart = t; }
      if (u.emote) {
        var e = EMOTES[u.emote], p = (t - u.emoteStart) / e.dur;
        if (p >= 1) {
          u.lastEmote = u.emote; u.emote = null;
          u.nextEmote = t + 4 + Math.random() * 5;
        } else {
          e.run(u, p);
        }
      }
    }

    // blink every 2.5-6 s, sometimes twice
    if (u.nextBlink === undefined) u.nextBlink = t + 1 + Math.random() * 2;
    if (t >= u.nextBlink && !u.blinking) { u.blinking = t + 0.13; setBlink(u, true); }
    if (u.blinking && t >= u.blinking) {
      u.blinking = 0; setBlink(u, false);
      u.nextBlink = t + (Math.random() < 0.2 ? 0.22 : 2.5 + Math.random() * 3.5);
    }

    if (!calm && u.effects && u.effects.length) runEffects(u.effects, t);

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
      if (current) animate(current, t, { calm: calm });
      if (controls) controls.update();
    }});
    var scene = view.scene, camera = view.camera, current = null, controls = null;
    var calm = Nevet3D.reducedMotion();
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

    // a tap on the hero (not a drag to turn it) plays an emote
    var down = null;
    canvas.addEventListener('pointerdown', function (e) { down = { x: e.clientX, y: e.clientY, t: Date.now() }; });
    canvas.addEventListener('pointerup', function (e) {
      if (!down || !current) return;
      var moved = Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y);
      if (moved < 8 && Date.now() - down.t < 400) playEmote(current, null);
      down = null;
    });

    // little white name tag (pill) sized to the text, readable on any background
    function nameTag(text) {
      var c = document.createElement('canvas'), ctx = c.getContext('2d');
      var font = 'bold 40px sans-serif';
      ctx.font = font;
      var h = 64, w = Math.ceil(ctx.measureText(text).width) + 44;
      c.width = w; c.height = h;
      ctx = c.getContext('2d');
      ctx.beginPath();
      ctx.moveTo(h / 2, 3); ctx.lineTo(w - h / 2, 3);
      ctx.arc(w - h / 2, h / 2, h / 2 - 3, -Math.PI / 2, Math.PI / 2);
      ctx.lineTo(h / 2, h - 3);
      ctx.arc(h / 2, h / 2, h / 2 - 3, Math.PI / 2, Math.PI * 1.5);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(30,42,32,0.18)'; ctx.stroke();
      ctx.font = font; ctx.fillStyle = '#1e2a20';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(text, w / 2, h / 2 + 2);
      var tex = new THREE.CanvasTexture(c);
      var s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
      var H = 0.17;
      s.scale.set(H * w / h, H, 1);
      return s;
    }

    function set(a, opts) {
      var had = !!current;
      if (current) { scene.remove(current); dispose(current); }
      current = build(a, catalog);
      var pet = current.userData.pet;
      if (pet && a.petName) {                     // the companion's name floats above it
        var label = nameTag(a.petName);
        label.position.set(0, pet.userData.top + 0.3, 0);
        label.renderOrder = 10;
        label.material.depthTest = false;
        pet.add(label);
      }
      scene.add(current);
      // trying on something new: a little hop to show it off
      if (had && !calm && !(opts && opts.quiet)) playEmote(current, 'hop');
    }
    Nevet3D.onThemeChange(function () {
      pedestal.material.color.set(Nevet3D.cssColor('--bg-card', '#ffffff'));
      ring.material.color.set(Nevet3D.cssColor('--accent', '#4c9a5b'));
    });
    set(appearance);
    return { set: set, emote: function (name) { if (current) playEmote(current, name); } };
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
    } else if (catId === 'earrings') {
      if (!EARRINGS[optId]) return null;
      g.add(EARRINGS[optId](R, 1));
      dir = new THREE.Vector3(1, 0.2, 0.3);
    } else if (catId === 'pet' || catId === 'petAccessory') {
      R.a.petSize = 'normal';
      if (catId === 'pet') R.a.pet = optId; else R.a.petAccessory = optId;
      if (catId === 'pet') R.a.petAccessory = 'none';
      else if (!PETS[R.a.pet]) R.a.pet = 'worm';            // preview accessories on someone
      var pet = buildPet(R);
      if (!pet || (catId === 'petAccessory' && optId === 'none')) return null;
      pet.position.set(0, 0, 0);
      g.add(pet);
      dir = new THREE.Vector3(0.35, 0.4, 1);
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
    g.save(); g.clip();                           // keep beards etc. inside the face circle
    drawFace(g, size, size * 0.86, size / 58, { eyes: appearance.eyes, eyeColor: R.eyeColor, mouth: appearance.mouth,
                                                facialHair: appearance.facialHair, hairColor: R.hairColor, skin: R.skin,
                                                gender: appearance.gender });
    g.restore();
    return c.toDataURL('image/png');
  }

  function supported() {
    return typeof Nevet3D !== 'undefined' && Nevet3D.supportsWebGL();
  }

  window.NevetHero = {
    build: build, viewer: viewer, snapshot: snapshot, itemIcon: itemIcon,
    faceIcon: faceIcon, supported: supported, animate: animate, emote: playEmote,
    emotes: EMOTE_NAMES
  };
})();
