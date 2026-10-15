/* party-synth.js - the little synth docked above the farm's bottom bar in party mode.
 *
 * The sound comes from AcidEngine (kg13-acid-space/engine/acid-engine.js,
 * kept up to date next to Nevet and served at /extras/acid/engine/): a
 * TB-303 bass line and a TR-909 drum kit on one 16-step sequencer. This file
 * is only the interface, sized for a phone:
 *
 *   [▶] [303 •][909 •]  BPM − 128 +  🎲  ▾        transport, engine tabs (the dot mutes/unmutes)
 *   [ 16 steps, the playing one lit ]              303: tap = on → accent → slide → off, drag up/down = note
 *                                                  909: tap = toggle the chosen drum
 *   (knobs)                                        303: cutoff reso env decay accent drive, saw/square
 *                                                  909: drum chips + level tune decay, swing
 *   tip line                                       explains what you touch and what you hear
 *
 *   NevetSynth.mount(rootEl, engine, { onStep, onTransport, onShow })
 * Pattern and knobs are remembered in this browser (localStorage, if allowed).
 */
(function () {
  'use strict';
  var STORE = 'nevet-party-synth-v1';
  var KNOBS303 = [
    { k: 'cutoff', label: 'Cutoff', min: 60, max: 6000, log: true, def: 420, fmt: function (v) { return v >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.round(v) + ''; },
      tip: 'Cutoff opens the filter: darker to brighter. The dance floor lights up with it.' },
    { k: 'reso', label: 'Reso', min: 0.5, max: 28, def: 12, fmt: function (v) { return Math.round(v) + ''; },
      tip: 'Resonance is the squelchy acid peak at the cutoff. The light beams glow with it.' },
    { k: 'depth', label: 'Env', min: 0, max: 1.5, def: 0.7, fmt: function (v) { return Math.round(v * 100) + ''; },
      tip: 'Env mod: how far each note sweeps the filter open. More = more "wow".' },
    { k: 'decay', label: 'Decay', min: 0.03, max: 0.8, def: 0.22, fmt: function (v) { return Math.round(v * 1000) + ''; },
      tip: 'Decay: how fast each note closes again. Short = plucky, long = singing.' },
    { k: 'accent', label: 'Accent', min: 0, max: 1.5, def: 0.6, fmt: function (v) { return Math.round(v * 100) + ''; },
      tip: 'Accent: how much louder and brighter accented steps are. Dancers hop on them.' },
    { k: 'drive', label: 'Drive', min: 0, max: 1, def: 0.22, fmt: function (v) { return Math.round(v * 100) + ''; },
      tip: 'Drive saturates the sound before the filter: warmer, then dirtier.' }
  ];
  var DRUM_TIPS = {
    bd: 'Kick: the four-on-the-floor heartbeat. The dancers step on it and the speakers pump.',
    sd: 'Snare: tone plus a burst of noise, usually on beats 2 and 4.',
    cp: 'Clap: several quick noise bursts, the classic 909 backbeat.',
    ch: 'Closed hat: a short tick that drives the groove. It cuts off the open hat.',
    oh: 'Open hat: a longer "tsss", great on the off-beats (step 3, 7, 11, 15).',
    rs: 'Rim: a dry click for syncopation, between the kicks.'
  };
  var DRUM_COLORS = { bd: '#ff8a3d', sd: '#ffd84d', cp: '#ff5fa2', ch: '#5ec8ff', oh: '#7dff6a', rs: '#c49bff' };
  var KNOBS909 = [
    { k: 'level', label: 'Level', min: 0, max: 1, def: 0.8, fmt: function (v) { return Math.round(v * 100) + ''; }, tip: 'Level of the chosen drum.' },
    { k: 'tune', label: 'Tune', min: -12, max: 12, def: 0, fmt: function (v) { return (v > 0 ? '+' : '') + Math.round(v); }, tip: 'Tune the chosen drum up or down (in semitones).' },
    { k: 'decay', label: 'Decay', min: 0, max: 1, def: 0.5, fmt: function (v) { return Math.round(v * 100) + ''; }, tip: 'Decay: how long the chosen drum rings.' },
    { k: 'swing', label: 'Swing', min: 0, max: 0.6, def: 0, fmt: function (v) { return Math.round(v * 100) + '%'; }, tip: 'Swing pushes every second 16th a little late: straight → shuffled.' }
  ];

  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  // a small knob: drag up/down (or the wheel) to turn, double-tap to reset
  function knob(spec, get, set, onTouch) {
    var wrap = el('div', 'ps-knob'), dial = el('div', 'ps-dial'), val = el('span', 'ps-kval'), lab = el('span', 'ps-klab', spec.label);
    dial.setAttribute('role', 'slider'); dial.setAttribute('aria-label', spec.label); dial.tabIndex = 0;
    dial.innerHTML = '<svg viewBox="0 0 36 36" aria-hidden="true"><circle class="ps-track" cx="18" cy="18" r="14"/><path class="ps-arc" d=""/><line class="ps-ptr" x1="18" y1="18" x2="18" y2="6"/></svg>';
    wrap.appendChild(dial); wrap.appendChild(val); wrap.appendChild(lab);
    function norm(v) { return spec.log ? Math.log(v / spec.min) / Math.log(spec.max / spec.min) : (v - spec.min) / (spec.max - spec.min); }
    function denorm(n) { n = clamp(n, 0, 1); return spec.log ? spec.min * Math.pow(spec.max / spec.min, n) : spec.min + n * (spec.max - spec.min); }
    function draw() {
      var v = get(), n = clamp(norm(v), 0, 1), a0 = -135, a = a0 + n * 270;
      var rad = function (d) { return (d - 90) * Math.PI / 180; };
      var p = function (d) { return (18 + 14 * Math.cos(rad(d))).toFixed(2) + ' ' + (18 + 14 * Math.sin(rad(d))).toFixed(2); };
      dial.querySelector('.ps-arc').setAttribute('d', n > 0.002 ? 'M' + p(a0) + ' A14 14 0 ' + (a - a0 > 180 ? 1 : 0) + ' 1 ' + p(a) : '');
      dial.querySelector('.ps-ptr').setAttribute('transform', 'rotate(' + a + ' 18 18)');
      val.textContent = spec.fmt(v);
      dial.setAttribute('aria-valuetext', spec.fmt(v));
    }
    var start = null, lastTap = 0;
    dial.addEventListener('pointerdown', function (e) {
      e.preventDefault(); dial.setPointerCapture(e.pointerId);
      var t = performance.now();
      if (t - lastTap < 300) { set(spec.def); draw(); onTouch(spec); lastTap = 0; return; }
      lastTap = t; start = { y: e.clientY, n: norm(get()) }; onTouch(spec); wrap.classList.add('on');
    });
    dial.addEventListener('pointermove', function (e) {
      if (!start) return;
      set(denorm(start.n + (start.y - e.clientY) / 140)); draw();
    });
    function up() { start = null; wrap.classList.remove('on'); }
    dial.addEventListener('pointerup', up); dial.addEventListener('pointercancel', up);
    dial.addEventListener('wheel', function (e) { e.preventDefault(); set(denorm(norm(get()) - Math.sign(e.deltaY) * 0.03)); draw(); onTouch(spec); }, { passive: false });
    dial.addEventListener('keydown', function (e) {
      var d = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 0.03 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -0.03 : 0;
      if (d) { e.preventDefault(); set(denorm(norm(get()) + d)); draw(); onTouch(spec); }
    });
    draw();
    return { el: wrap, draw: draw };
  }

  function mount(root, eng, hooks) {
    hooks = hooks || {};
    var tab = '303', drum = 'bd', knobs = [], cells = [];
    load();

    root.innerHTML = '';
    root.classList.add('ps');
    // row 1: transport, tabs, tempo, generate, hide
    var top = el('div', 'ps-top');
    var play = el('button', 'ps-play', '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path class="ps-i-play" d="M7 4.5v15l13-7.5z"/><rect class="ps-i-stop" x="6" y="6" width="12" height="12" rx="2"/></svg>');
    play.type = 'button'; play.setAttribute('aria-label', 'Play');
    var tabs = el('div', 'ps-tabs');
    var t303 = el('button', 'ps-tab', '<i class="ps-led" title="Mute or unmute"></i>303'), t909 = el('button', 'ps-tab', '<i class="ps-led" title="Mute or unmute"></i>909');
    t303.type = t909.type = 'button'; t303.dataset.tab = '303'; t909.dataset.tab = '909';
    t303.setAttribute('aria-label', 'TB-303 bass line'); t909.setAttribute('aria-label', 'TR-909 drums');
    tabs.appendChild(t303); tabs.appendChild(t909);
    var bpm = el('div', 'ps-bpm'), minus = el('button', 'ps-mini', '−'), bval = el('span', 'ps-bval'), plus = el('button', 'ps-mini', '+');
    minus.type = plus.type = 'button'; minus.setAttribute('aria-label', 'Slower'); plus.setAttribute('aria-label', 'Faster');
    bpm.appendChild(minus); bpm.appendChild(bval); bpm.appendChild(plus);
    var gen = el('button', 'ps-mini ps-gen', '🎲'); gen.type = 'button'; gen.title = 'New pattern'; gen.setAttribute('aria-label', 'New pattern');
    var hide = el('button', 'ps-mini ps-hide', '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>');
    hide.type = 'button'; hide.title = 'Hide (keeps playing)'; hide.setAttribute('aria-label', 'Hide the synth, keep playing');
    [play, tabs, bpm, gen, hide].forEach(function (x) { top.appendChild(x); });
    // row 2: the steps
    var grid = el('div', 'ps-steps');
    for (var i = 0; i < 16; i++) { var c = el('button', 'ps-step'); c.type = 'button'; c.dataset.i = i; grid.appendChild(c); cells.push(c); }
    // row 3: knobs (rebuilt per tab), row 4: the tip
    var ctl = el('div', 'ps-ctl'), tip = el('p', 'ps-tip');
    root.appendChild(top); root.appendChild(grid); root.appendChild(ctl); root.appendChild(tip);

    function say(t) { tip.textContent = t; }
    function save() {
      try { localStorage.setItem(STORE, JSON.stringify({ bpm: eng.bpm, swing: eng.swing, acid: eng.acid, drums: eng.drums, p303: eng.p303, p909: eng.p909, mute: eng.mute })); } catch (e) {}
    }
    function load() {
      try {
        var s = JSON.parse(localStorage.getItem(STORE) || 'null');
        if (!s) return;
        if (s.bpm) eng.bpm = s.bpm; if (typeof s.swing === 'number') eng.swing = s.swing;
        if (s.acid && s.acid.length === 16) eng.acid = s.acid;
        if (s.drums) Object.keys(eng.drums).forEach(function (k) { if (s.drums[k] && s.drums[k].length === 16) eng.drums[k] = s.drums[k]; });
        if (s.p303) Object.keys(s.p303).forEach(function (k) { if (k in eng.p303) eng.p303[k] = s.p303[k]; });
        if (s.p909) ['level', 'tune', 'decay'].forEach(function (g) { if (s.p909[g]) Object.keys(eng.p909[g]).forEach(function (k) { if (typeof s.p909[g][k] === 'number') eng.p909[g][k] = s.p909[g][k]; }); });
        if (s.mute) eng.mute = { tb303: !!s.mute.tb303, tr909: !!s.mute.tr909 };
      } catch (e) {}
    }

    function drawTop() {
      root.classList.toggle('playing', eng.playing);
      play.setAttribute('aria-label', eng.playing ? 'Stop' : 'Play');
      bval.textContent = eng.bpm;
      t303.classList.toggle('active', tab === '303'); t909.classList.toggle('active', tab === '909');
      t303.classList.toggle('muted', eng.mute.tb303); t909.classList.toggle('muted', eng.mute.tr909);
      root.dataset.tab = tab;
    }
    function drawSteps() {
      cells.forEach(function (c, i) {
        var s = eng.acid[i], html = '';
        if (tab === '303') {
          c.className = 'ps-step' + (s.active ? ' on' : '') + (s.active && s.accent ? ' acc' : '') + (s.active && s.slide ? ' sld' : '') + (i % 4 === 0 ? ' beat' : '');
          html = s.active ? '<b>' + eng.noteName(i).replace(/\d/, '') + '</b><small>' + eng.noteName(i).replace(/\D/g, '') + '</small>' : '';
          c.setAttribute('aria-label', 'Step ' + (i + 1) + ': ' + (s.active ? eng.noteName(i) + (s.accent ? ', accent' : '') + (s.slide ? ', slide' : '') : 'rest'));
        } else {
          var on = eng.drums[drum][i];
          c.className = 'ps-step drum' + (on ? ' on' : '') + (i % 4 === 0 ? ' beat' : '');
          c.style.setProperty('--dc', DRUM_COLORS[drum]);
          html = '<span class="ps-dots">' + AcidEngine.DRUMS.map(function (d) { return eng.drums[d][i] ? '<i style="background:' + DRUM_COLORS[d] + '"></i>' : ''; }).join('') + '</span>';
          c.setAttribute('aria-label', 'Step ' + (i + 1) + ': ' + AcidEngine.DRUM_NAMES[drum] + (on ? ' on' : ' off'));
        }
        if (c.innerHTML !== html) c.innerHTML = html;
      });
    }
    function drawCtl() {
      ctl.innerHTML = ''; knobs = [];
      if (tab === '303') {
        var wave = el('button', 'ps-wave', eng.p303.wave === 'square' ? 'SQR' : 'SAW'); wave.type = 'button';
        wave.title = 'Oscillator: saw or square';
        wave.addEventListener('click', function () { eng.set303('wave', eng.p303.wave === 'square' ? 'sawtooth' : 'square'); wave.textContent = eng.p303.wave === 'square' ? 'SQR' : 'SAW'; say('Saw is buzzy and bright, square is hollow and woody.'); save(); });
        ctl.appendChild(wave);
        KNOBS303.forEach(function (sp) {
          var kn = knob(sp, function () { return eng.p303[sp.k]; }, function (v) { eng.set303(sp.k, v); save(); }, function (s) { say(s.tip); });
          ctl.appendChild(kn.el); knobs.push(kn);
        });
      } else {
        var chips = el('div', 'ps-drums');
        AcidEngine.DRUMS.forEach(function (d) {
          var b = el('button', 'ps-drum' + (d === drum ? ' active' : ''), d.toUpperCase()); b.type = 'button';
          b.style.setProperty('--dc', DRUM_COLORS[d]); b.title = AcidEngine.DRUM_NAMES[d];
          b.addEventListener('click', function () { drum = d; drawCtl(); drawSteps(); say(DRUM_TIPS[d]); });
          chips.appendChild(b);
        });
        ctl.appendChild(chips);
        KNOBS909.forEach(function (sp) {
          var get = sp.k === 'swing' ? function () { return eng.swing; } : function () { return eng.p909[sp.k][drum]; };
          var set = sp.k === 'swing' ? function (v) { eng.swing = v; save(); } : function (v) { eng.p909[sp.k][drum] = v; save(); };
          var kn = knob(sp, get, set, function (s) { say(s.tip + (s.k !== 'swing' ? ' (' + AcidEngine.DRUM_NAMES[drum] + ')' : '')); });
          ctl.appendChild(kn.el); knobs.push(kn);
        });
      }
    }
    function drawAll() { drawTop(); drawSteps(); drawCtl(); }

    // ---- steps: tap cycles, drag changes the note (303)
    var drag = null;
    grid.addEventListener('pointerdown', function (e) {
      var c = e.target.closest('.ps-step'); if (!c) return;
      e.preventDefault(); c.setPointerCapture(e.pointerId);
      drag = { i: +c.dataset.i, y: e.clientY, moved: false, deg: eng.acid[+c.dataset.i].degreeIndex, oct: eng.acid[+c.dataset.i].octave };
    });
    grid.addEventListener('pointermove', function (e) {
      if (!drag || tab !== '303') return;
      var dy = Math.round((drag.y - e.clientY) / 14);
      if (!dy && !drag.moved) return;
      drag.moved = true;
      var n = eng.degrees.length - 1, total = drag.deg + drag.oct * n + dy;          // walk the scale, across octaves
      total = clamp(total, -n, 2 * n);
      var s = eng.acid[drag.i];
      s.active = true; s.octave = Math.floor(total / n); s.degreeIndex = ((total % n) + n) % n;
      if (s.octave > 1) { s.octave = 1; s.degreeIndex = n; }
      drawSteps(); say('Step ' + (drag.i + 1) + ': ' + eng.noteName(drag.i) + '. Drag up and down to pick the note.');
    });
    function stepUp() {
      if (!drag) return;
      var i = drag.i, moved = drag.moved; drag = null;
      if (moved) { save(); return; }
      if (tab === '303') {
        var s = eng.acid[i];
        if (!s.active) { s.active = true; s.accent = false; s.slide = false; say('On: the note plays. Tap again for an accent.'); }
        else if (!s.accent && !s.slide) { s.accent = true; say('Accent: louder and brighter. Tap again to slide into it.'); }
        else if (s.accent) { s.accent = false; s.slide = i > 0; say(i > 0 ? 'Slide: the previous note glides into this one. Tap again for a rest.' : 'The first step can\'t slide. Tap again for a rest.'); if (!s.slide) s.active = false; }
        else { s.active = false; s.slide = false; say('Rest: silence on this step. Space makes the groove.'); }
      } else {
        eng.drums[drum][i] = !eng.drums[drum][i];
        say(AcidEngine.DRUM_NAMES[drum] + (eng.drums[drum][i] ? ' on step ' : ' off step ') + (i + 1) + '.');
      }
      drawSteps(); save();
    }
    grid.addEventListener('pointerup', stepUp); grid.addEventListener('pointercancel', function () { drag = null; });

    // ---- top row
    play.addEventListener('click', function () { eng.toggle(); });
    [t303, t909].forEach(function (t) {
      t.addEventListener('click', function (e) {
        var which = t.dataset.tab === '303' ? 'tb303' : 'tr909';
        if (e.target.classList.contains('ps-led')) {              // the dot mutes / unmutes that engine
          eng.setMute(which, !eng.mute[which]);
          say((t.dataset.tab === '303' ? 'TB-303 bass line ' : 'TR-909 drums ') + (eng.mute[which] ? 'muted.' : 'back on.'));
        } else if (tab !== t.dataset.tab) {
          tab = t.dataset.tab; drawSteps(); drawCtl();
          say(tab === '303' ? 'TB-303: the squelchy bass line. Tap steps, drag for notes. Its dot mutes it.' : 'TR-909: the drum machine. Pick a drum, tap its steps. Its dot mutes it.');
        }
        drawTop(); save();
      });
    });
    function nudge(d) { eng.setBpm(eng.bpm + d); drawTop(); say('BPM ' + eng.bpm + ': the tempo. The whole party follows it.'); save(); }
    var rep = null;
    [[minus, -1], [plus, 1]].forEach(function (pr) {
      pr[0].addEventListener('pointerdown', function (e) { e.preventDefault(); nudge(pr[1]); var n = 0; rep = setInterval(function () { if (++n > 3) nudge(pr[1] * 2); }, 120); });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) { pr[0].addEventListener(ev, function () { clearInterval(rep); }); });
    });
    gen.addEventListener('click', function () {
      var st = eng.generate();
      drawSteps(); save();
      say('New "' + st + '" pattern. Tweak it, or roll again.');
    });
    hide.addEventListener('click', function () { if (hooks.onShow) hooks.onShow(false); });

    // ---- the engine tells us what plays
    var lastLit = -1;
    eng.onStep = function (info) {
      if (lastLit >= 0) cells[lastLit].classList.remove('now');
      cells[info.step].classList.add('now'); lastLit = info.step;
      if (hooks.onStep) hooks.onStep(info);
    };
    eng.onTransport = function (t) {
      drawTop();
      if (!t.playing && lastLit >= 0) { cells[lastLit].classList.remove('now'); lastLit = -1; }
      if (hooks.onTransport) hooks.onTransport(t);
    };

    drawAll();
    say('Press ▶ to play. Tap steps: on → accent → slide → rest; drag up/down for the note.');
    return { redraw: drawAll, say: say };
  }

  window.NevetSynth = { mount: mount };
})();
