/* nevet3d.js - Shared helpers for every Nevet three.js view.
 *
 * Handles the boring-but-important parts once so each 3D view doesn't
 * have to: WebGL detection with a graceful fallback, theme-aware
 * colours, crisp text labels, resizing, and pausing rendering when
 * the tab is hidden (saves phone battery). Loaded after three.min.js.
 */
(function () {
  function supportsWebGL() {
    try {
      var c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext &&
        (c.getContext('webgl') || c.getContext('experimental-webgl')));
    } catch (e) { return false; }
  }

  function cssColor(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  function reducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // Text label that always faces the camera.
  function makeLabel(text, color, width) {
    var c = document.createElement('canvas');
    c.width = 512; c.height = 128;
    var ctx = c.getContext('2d');
    ctx.font = 'bold 56px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 10;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.strokeText(text, 256, 64);
    ctx.fillStyle = color;
    ctx.fillText(text, 256, 64);
    var tex = new THREE.CanvasTexture(c);
    var s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    var w = width || 1.6;
    s.scale.set(w, w / 4, 1);
    return s;
  }

  // Creates renderer + camera sized to `wrap`, runs `onFrame(t)` each
  // frame, pauses while the tab is hidden. Returns {scene, camera, renderer}.
  function createView(canvas, wrap, opts) {
    opts = opts || {};
    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(opts.fov || 45, 1, 0.1, 200);
    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    function resize() {
      var w = wrap.clientWidth, h = wrap.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    window.addEventListener('resize', resize);
    resize();

    var clock = new THREE.Clock();
    var running = true;
    document.addEventListener('visibilitychange', function () {
      running = !document.hidden;
      if (running) { clock.getDelta(); loop(); }
    });
    function loop() {
      if (!running) return;
      requestAnimationFrame(loop);
      if (opts.onFrame) opts.onFrame(clock.getElapsedTime());
      renderer.render(scene, camera);
    }
    loop();
    return { scene: scene, camera: camera, renderer: renderer };
  }

  // Returns the object (or its ancestor carrying userData[key]) under a tap.
  function pick(ev, canvas, camera, objects, key) {
    var rect = canvas.getBoundingClientRect();
    var p = new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1
    );
    var rc = new THREE.Raycaster();
    rc.setFromCamera(p, camera);
    var hits = rc.intersectObjects(objects, true);
    for (var i = 0; i < hits.length; i++) {
      var o = hits[i].object;
      while (o && !(o.userData && o.userData[key] !== undefined)) o = o.parent;
      if (o) return o;
    }
    return null;
  }

  function onThemeChange(cb) { document.addEventListener('nevet-theme-changed', cb); }

  window.Nevet3D = {
    supportsWebGL: supportsWebGL, cssColor: cssColor, reducedMotion: reducedMotion,
    makeLabel: makeLabel, createView: createView, pick: pick, onThemeChange: onThemeChange
  };
})();
