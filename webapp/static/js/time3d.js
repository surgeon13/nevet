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
  var GREEN = 0x43a047, LEAF = 0x66bb6a, PINK = 0xec407a, ROSE = 0xf48fb1, BLUSH = 0xffd1e3;
  var calm = Nevet3D.reducedMotion();

  // ---------------------------------------------------------------- scene
  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  var scene = new THREE.Scene();
  scene.background = (function () {                    // sky: blush pink above, mint at the horizon
    var c = document.createElement('canvas'); c.width = 4; c.height = 256;
    var g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, '#ffc2dc'); gr.addColorStop(0.55, '#ffe4ef'); gr.addColorStop(1, '#d6f5e3');
    g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
    var t = new THREE.CanvasTexture(c); return t;
  })();
  scene.fog = new THREE.Fog(0xffe4ef, 14, 46);
  var camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
  scene.add(new THREE.HemisphereLight(0xfff0f6, 0xb9e4c9, 0.95));
  var sun = new THREE.DirectionalLight(0xffffff, 0.75); sun.position.set(4, 10, 6); scene.add(sun);
  function toon(color, extra) { var m = new THREE.MeshToonMaterial(Object.assign({ color: color }, extra || {})); return m; }

  // ---------------------------------------------------------------- the vines
  var N = Math.max(1, DAYS.length), SP = 3.0;
  function base(i) { return V(Math.sin(i * 0.5) * 2.4, Math.cos(i * 0.33) * 1.1 + Math.sin(i * 1.1) * 0.25, -i * SP); }
  var pts = [];
  for (var i = -1; i <= N; i++) pts.push(base(i));
  var curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
  var span = function (d) { return (d + 1) / (N + 1); };          // day index -> curve parameter
  var segs = Math.min(1600, (N + 2) * 14);
  scene.add(new THREE.Mesh(new THREE.TubeGeometry(curve, segs, 0.14, 8, false), toon(GREEN)));
  // the pink vine winds around the green one: the garden and its people, together
  var frames = curve.computeFrenetFrames(segs, false), pinkPts = [];
  for (var k = 0; k <= segs; k++) {
    var u = k / segs, p = curve.getPointAt(u), a = u * (N + 1) * 2.2;
    var off = frames.normals[k].clone().multiplyScalar(Math.cos(a) * 0.32).add(frames.binormals[k].clone().multiplyScalar(Math.sin(a) * 0.32));
    pinkPts.push(p.add(off));
  }
  scene.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pinkPts), segs, 0.06, 6, false), toon(ROSE)));

  // leaves along the green vine
  var leafGeo = new THREE.SphereGeometry(0.22, 8, 6); leafGeo.scale(1, 0.25, 0.55); leafGeo.translate(0.22, 0, 0);
  var leafN = Math.min(1400, (N + 1) * 5), leaves = new THREE.InstancedMesh(leafGeo, toon(LEAF), leafN);
  var m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), col = new THREE.Color();
  for (var l = 0; l < leafN; l++) {
    var lu = (l + 0.5) / leafN, lp = curve.getPointAt(lu);
    q.setFromEuler(new THREE.Euler((l * 2.4) % TAU, (l * 1.7) % TAU, 0.4));
    sc.setScalar(0.7 + ((l * 37) % 10) / 20);
    m4.compose(lp, q, sc); leaves.setMatrixAt(l, m4);
    leaves.setColorAt(l, col.setHSL(0.31 + ((l * 13) % 7) / 100, 0.5, 0.42 + ((l * 7) % 5) / 40));
  }
  scene.add(leaves);

  // ---------------------------------------------------------------- the days: blossoms (and hearts)
  var dayPos = DAYS.map(function (d, i) { return curve.getPointAt(span(i)).add(V(0, 0.42, 0)); });
  var petalGeo = new THREE.SphereGeometry(0.2, 10, 8); petalGeo.scale(1, 0.32, 0.6); petalGeo.translate(0.2, 0, 0);
  var petals = new THREE.InstancedMesh(petalGeo, toon(0xffffff), N * 5);
  var hearts3 = new THREE.InstancedMesh(new THREE.SphereGeometry(0.11, 10, 8), toon(0xffe082), N);
  var busiest = DAYS.reduce(function (m, d) { return Math.max(m, d.n); }, 1);
  var blossomSize = DAYS.map(function (d) { return 0.75 + 0.9 * Math.sqrt(d.n / busiest) + (d.heart ? 0.25 : 0); });
  var proxies = [];
  DAYS.forEach(function (d, i) {
    var p = dayPos[i], s = blossomSize[i], tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.9, 0, 0.3 * Math.sin(i)));
    for (var j = 0; j < 5; j++) {
      var qq = tilt.clone().multiply(new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), j / 5 * TAU + i));
      m4.compose(p, qq, sc.setScalar(s)); petals.setMatrixAt(i * 5 + j, m4);
      petals.setColorAt(i * 5 + j, col.setHSL(0.93 + ((i * 3 + j) % 5) / 100, 0.8, d.heart ? 0.6 : 0.7));
    }
    m4.compose(p, tilt, sc.setScalar(s)); hearts3.setMatrixAt(i, m4);
    var proxy = new THREE.Mesh(new THREE.SphereGeometry(0.6 * s, 6, 4), new THREE.MeshBasicMaterial({ visible: false }));
    proxy.position.copy(p); proxy.userData.day = i; scene.add(proxy); proxies.push(proxy);
  });
  scene.add(petals); scene.add(hearts3);

  // hearts for the big moments: puffy, glowing, floating above their day
  var heartShape = new THREE.Shape();
  heartShape.moveTo(0, -0.5);
  heartShape.bezierCurveTo(-0.15, -0.35, -0.6, -0.1, -0.6, 0.2); heartShape.bezierCurveTo(-0.6, 0.55, -0.2, 0.62, 0, 0.35);
  heartShape.bezierCurveTo(0.2, 0.62, 0.6, 0.55, 0.6, 0.2); heartShape.bezierCurveTo(0.6, -0.1, 0.15, -0.35, 0, -0.5);
  var heartGeo = new THREE.ExtrudeGeometry(heartShape, { depth: 0.18, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.07, bevelSegments: 3, curveSegments: 14 });
  heartGeo.center();
  var heartMat = toon(PINK, { emissive: new THREE.Color(0xad1457), emissiveIntensity: 0.35 });
  var loveMat = toon(0xff1f6e, { emissive: new THREE.Color(0xd81b60), emissiveIntensity: 0.5 });
  var glowTex = (function () {
    var c = document.createElement('canvas'); c.width = c.height = 64;
    var g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,120,180,0.85)'); gr.addColorStop(1, 'rgba(255,120,180,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
  })();
  var bigHearts = [];
  DAYS.forEach(function (d, i) {
    if (!d.heart) return;
    var love = d.moments.indexOf('love') >= 0, h = new THREE.Mesh(heartGeo, love ? loveMat : heartMat);
    var g = new THREE.Group(); g.add(h);
    var glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.scale.setScalar(love ? 2.4 : 1.8); g.add(glow);
    g.position.copy(dayPos[i]).add(V(0, love ? 1.25 : 1.0, 0));
    g.scale.setScalar(love ? 0.9 : 0.62);
    g.userData = { i: i, y: g.position.y, ph: i * 0.7 };
    scene.add(g); bigHearts.push(g);
  });

  // date labels on chapter days, big moments and about every week
  var labels = [];
  DAYS.forEach(function (d, i) {
    if (!(d.heart || i % 6 === 0 || i === N - 1)) return;
    var lbl = Nevet3D.makeLabel(d.label, '#2e7d32', 1.25);
    lbl.position.copy(dayPos[i]).add(V(0, d.heart ? (d.moments.indexOf('love') >= 0 ? 2.35 : 1.95) : 0.85, 0));
    scene.add(lbl); labels.push(lbl);
  });

  // little hearts drifting up through the air, and pollen
  var tinyTex = (function () {
    var c = document.createElement('canvas'); c.width = c.height = 128;
    var g = c.getContext('2d'); g.fillStyle = '#fff'; g.font = 'bold 108px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('♥', 64, 72);
    return new THREE.CanvasTexture(c);
  })();
  var floaters = [];
  for (var f = 0; f < 46; f++) {
    var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tinyTex, color: new THREE.Color().setHSL(0.93 + (f % 5) / 60, 0.85, 0.7 + (f % 3) / 20), transparent: true, depthWrite: false, opacity: 0.85 }));
    sp.scale.setScalar(0.22 + (f % 4) * 0.06);
    sp.userData = { ox: (Math.random() - 0.5) * 12, oz: -Math.random() * 12 + 1, ph: Math.random() * 6, sp: 0.25 + Math.random() * 0.35 };   // around and beyond the vine, never in the camera's face
    scene.add(sp); floaters.push(sp);
  }
  var pollenGeo = new THREE.BufferGeometry(), pp = new Float32Array(500 * 3);
  for (var pi = 0; pi < 500; pi++) { var pu = Math.random(); var ppos = curve.getPointAt(pu); pp[pi * 3] = ppos.x + (Math.random() - 0.5) * 12; pp[pi * 3 + 1] = ppos.y + (Math.random() - 0.3) * 6; pp[pi * 3 + 2] = ppos.z + (Math.random() - 0.5) * 6; }
  pollenGeo.setAttribute('position', new THREE.BufferAttribute(pp, 3));
  scene.add(new THREE.Points(pollenGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.07, transparent: true, opacity: 0.8, depthWrite: false })));

  // ---------------------------------------------------------------- travelling through time
  var pos = 0, target = 0, playing = false, lastShown = -1, userAt = 0;
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
  });
  canvas.addEventListener('wheel', function (e) { e.preventDefault(); go(target + e.deltaY * 0.004 + e.deltaX * 0.004, true); }, { passive: false });
  var drag = null;
  canvas.addEventListener('pointerdown', function (e) { drag = { x: e.clientX, y: e.clientY, t: target, moved: false }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var d = (drag.x - e.clientX) + (drag.y - e.clientY);         // left or up = forward in time
    if (Math.abs(d) > 6) drag.moved = true;
    if (drag.moved) go(drag.t + d / 90, true);
  });
  canvas.addEventListener('pointerup', function (e) {
    if (drag && !drag.moved) {                                     // a tap: jump to the blossom under the finger
      var hit = Nevet3D.pick(e, canvas, camera, proxies, 'day');
      if (hit) go(hit.userData.day, true);
    }
    if (drag && drag.moved) go(Math.round(target), true);          // settle on a day
    drag = null;
  });

  function showDay(i) {
    var d = DAYS[i]; if (!d) return;
    ui.date.textContent = d.weekday + ' ' + d.label;
    ui.count.textContent = 'day ' + (i + 1) + ' of ' + DAYS.length;
    ui.heading.textContent = d.title || '';
    ui.lines.innerHTML = '';
    d.lines.forEach(function (t) {
      var li = document.createElement('li'); li.textContent = t;
      if (/ are | is .*'s |together|joined/.test(t)) li.className = 'love';
      ui.lines.appendChild(li);
    });
    ui.chips.innerHTML = '';
    function chip(text, pink) { var c = document.createElement('span'); c.className = 'time-chip' + (pink ? ' pink' : ''); c.textContent = text; ui.chips.appendChild(c); }
    if (d.n) chip(d.n + ' action' + (d.n !== 1 ? 's' : ''));
    if (d.kg) chip(d.kg + ' kg picked');
    if (d.who.length) chip(d.who.length + ' hero' + (d.who.length !== 1 ? 'es' : ''), true);
    if (d.moments.indexOf('love') >= 0) chip('♥ love', true);
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
  function frame() {
    requestAnimationFrame(frame);
    if (document.hidden) return;
    var dt = Math.min(0.05, clock.getDelta()), t = clock.elapsedTime;
    if (!autoDone && performance.now() - startT > 1800) { autoDone = true; if (!userAt && !calm && N > 1) setPlaying(true); }   // the story starts telling itself, once, unless you already moved
    if (playing) { target = clampDay(target + dt * 0.55); if (target >= N - 1) setPlaying(false); }
    pos += (target - pos) * Math.min(1, dt * (Math.abs(target - pos) > 4 ? 6 : 4));
    var u = span(pos), ahead = span(Math.min(N - 0.5, pos + 0.6));
    var here = curve.getPointAt(u), next = curve.getPointAt(Math.min(1, ahead));
    var far = camera.aspect < 0.8 ? 1.45 : 1;          // a phone held upright sees less sideways: step back
    var want = here.clone().add(V(5.4 * far, 2.8 * far, 4.0 * far));
    var wantLook = here.clone().lerp(next, 0.5).add(V(0, 0.55, 0));
    if (first) { camPos.copy(want); look.copy(wantLook); first = false; }
    camPos.lerp(want, Math.min(1, dt * 3)); look.lerp(wantLook, Math.min(1, dt * 3));
    camera.position.copy(camPos); camera.lookAt(look);
    var day = Math.round(pos);
    if (day !== lastShown) { lastShown = day; showDay(day); }
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
      var ud = f.userData, h = ((t * ud.sp + ud.ph) % 6);
      f.position.set(here.x + ud.ox + Math.sin(t + ud.ph) * 0.4, here.y - 1.5 + h, here.z + ud.oz);
      f.material.opacity = Math.min(1, h) * Math.min(1, 6 - h) * 0.8;
    });
    renderer.render(scene, camera);
  }
  // start at the very beginning: "Once upon a time…"
  showDay(0); lastShown = 0;
  frame();
  window.NevetTime = { go: function (i) { go(i, true); }, state: function () { return { pos: pos, target: target, playing: playing, days: N, shown: lastShown }; } };
})();
