// gummodul.js — Moogerfooger-style effects pedal
// Bubblegum pink. Four analog-modeled effects. Canvas knobs.
const GumModul = (() => {

  // --- Effect definitions ---
  const EFFECTS = [
    {
      id: 'filter', name: 'Low-Pass Filter', model: 'MF-101',
      knobs: [
        { id: 'filter-cutoff', label: 'Cutoff', min: 20, max: 12000, value: 8000, log: true, unit: 'Hz' },
        { id: 'filter-resonance', label: 'Resonance', min: 0, max: 30, value: 1, unit: '' },
        { id: 'filter-env', label: 'Env Amt', min: 0, max: 100, value: 0, unit: '%' },
        { id: 'filter-lfo', label: 'LFO Rate', min: 0.1, max: 25, value: 0.5, unit: 'Hz' },
      ]
    },
    {
      id: 'ringmod', name: 'Ring Mod', model: 'MF-102',
      knobs: [
        { id: 'ring-freq', label: 'Carrier', min: 1, max: 4000, value: 440, log: true, unit: 'Hz' },
        { id: 'ring-lfo-rate', label: 'LFO Rate', min: 0.1, max: 25, value: 2, unit: 'Hz' },
        { id: 'ring-lfo-depth', label: 'LFO Depth', min: 0, max: 100, value: 0, unit: '%' },
        { id: 'ring-mix', label: 'Mix', min: 0, max: 100, value: 50, unit: '%' },
      ]
    },
    {
      id: 'phaser', name: 'Phaser', model: 'MF-103',
      knobs: [
        { id: 'phaser-rate', label: 'Rate', min: 0.1, max: 10, value: 1, unit: 'Hz' },
        { id: 'phaser-depth', label: 'Depth', min: 0, max: 100, value: 60, unit: '%' },
        { id: 'phaser-feedback', label: 'Feedback', min: 0, max: 95, value: 40, unit: '%' },
        { id: 'phaser-stages', label: 'Stages', min: 4, max: 8, value: 4, step: 4, unit: '' },
      ]
    },
    {
      id: 'delay', name: 'Delay', model: 'MF-104',
      knobs: [
        { id: 'delay-time', label: 'Time', min: 40, max: 800, value: 300, unit: 'ms' },
        { id: 'delay-feedback', label: 'Feedback', min: 0, max: 95, value: 40, unit: '%' },
        { id: 'delay-mix', label: 'Mix', min: 0, max: 100, value: 35, unit: '%' },
        { id: 'delay-lfo', label: 'LFO Rate', min: 0.1, max: 10, value: 0.5, unit: 'Hz' },
      ]
    }
  ];

  // --- State ---
  let audioCtx = null;
  let sourceNode = null;
  let inputGain = null;
  let outputGain = null;
  let analyserNode = null;
  let isPlaying = false;
  let audioBuffer = null;
  let micStream = null;
  let testOsc = null;
  let currentSource = 'file'; // 'file' | 'mic' | 'osc'
  let fileLoaded = false;
  let fileName = '';

  // Effect nodes
  const nodes = {};
  const bypass = { filter: false, ringmod: false, phaser: false, delay: false };

  // Knob state
  const knobValues = {};
  const knobDefaults = {};
  const knobCanvases = {};
  let activeKnob = null;
  let dragStartY = 0;
  let dragStartVal = 0;

  // --- Init ---
  function init() {
    registerKnobs();
    wireControls();
    drawAllKnobs();

    // WindowManager integration
    if (typeof WindowManager !== 'undefined') {
      WindowManager.on('open', ({ id }) => { if (id === 'gummodul') onOpen(); });
      WindowManager.on('close', ({ id }) => { if (id === 'gummodul') onClose(); });
    }
  }

  // --- Register knobs (HTML is static in index.html) ---
  function registerKnobs() {
    // Drive + output
    knobValues['drive'] = 50;
    knobDefaults['drive'] = 50;
    knobValues['output'] = 75;
    knobDefaults['output'] = 75;

    // Effect knobs
    EFFECTS.forEach(fx => {
      fx.knobs.forEach(k => {
        knobValues[k.id] = k.value;
        knobDefaults[k.id] = k.value;
      });
    });

    // Gather all knob canvases
    document.querySelectorAll('#gummodul-body .gm-knob-canvas').forEach(c => {
      knobCanvases[c.dataset.knob] = c;
    });
  }

  // --- Wire Controls ---
  function wireControls() {
    const body = document.getElementById('gummodul-body');
    if (!body) return;

    // Dropzone
    const dropzone = document.getElementById('gm-dropzone');
    const fileInput = document.getElementById('gummodul-file');

    dropzone.addEventListener('click', () => {
      switchSource('file');
      fileInput.click();
    });

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('drag-over');
    });

    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('drag-over');
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file) loadFile(file);
    });

    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) loadFile(file);
    });

    // Source buttons
    body.querySelectorAll('.gm-source-btn').forEach(btn => {
      btn.addEventListener('click', () => switchSource(btn.dataset.source));
    });

    // Play/pause/stop
    document.getElementById('gm-playpause').addEventListener('click', togglePlayPause);
    document.getElementById('gm-stop').addEventListener('click', stopPlayback);

    // Bypass toggles
    body.querySelectorAll('.gm-bypass').forEach(btn => {
      btn.addEventListener('click', () => {
        const fx = btn.dataset.fx;
        bypass[fx] = !bypass[fx];
        const led = btn.querySelector('.gm-led');
        const label = btn.querySelector('span:last-child');
        if (bypass[fx]) {
          led.classList.remove('on');
          label.textContent = 'OFF';
        } else {
          led.classList.add('on');
          label.textContent = 'ON';
        }
        updateBypass(fx);
      });
    });

    // Skin buttons
    body.querySelectorAll('.gm-skin-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        body.className = `skin-${btn.dataset.skin}`;
        body.querySelectorAll('.gm-skin-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        drawAllKnobs();
      });
    });

    // Knob interactions (pointer events)
    body.addEventListener('pointerdown', onKnobDown);
    document.addEventListener('pointermove', onKnobMove);
    document.addEventListener('pointerup', onKnobUp);

    // Double-click to reset knob
    body.addEventListener('dblclick', (e) => {
      const canvas = e.target.closest('.gm-knob-canvas');
      if (!canvas) return;
      const id = canvas.dataset.knob;
      if (knobDefaults[id] !== undefined) {
        knobValues[id] = knobDefaults[id];
        drawKnob(id);
        applyKnobValue(id);
      }
    });
  }

  // --- Knob Rendering ---
  function drawAllKnobs() {
    Object.keys(knobCanvases).forEach(id => drawKnob(id));
  }

  function drawKnob(id) {
    const canvas = knobCanvases[id];
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const size = 42;
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const cx = size / 2;
    const cy = size / 2;
    const r = 15;

    // Get colors from CSS variables
    const body = document.getElementById('gummodul-body');
    const style = getComputedStyle(body);
    const knobColor = style.getPropertyValue('--gm-knob').trim() || '#2a2a2a';
    const capColor = style.getPropertyValue('--gm-knob-cap').trim() || '#3a3a3a';
    const indicator = style.getPropertyValue('--gm-indicator').trim() || '#ffffff';
    const accent = style.getPropertyValue('--gm-accent').trim() || '#ff69b4';

    // Get normalized value (0-1)
    const knobDef = getKnobDef(id);
    const norm = knobDef ? getNormalized(id, knobDef) : (knobValues[id] || 50) / 100;

    // Angle: 225deg (7 o'clock) to -45deg (5 o'clock) — 270deg sweep
    const startAngle = (225 * Math.PI) / 180;
    const endAngle = (-45 * Math.PI) / 180;
    const sweep = 1.5 * Math.PI; // 270 degrees
    const angle = startAngle - norm * sweep;

    ctx.clearRect(0, 0, size, size);

    // Track arc (background)
    ctx.beginPath();
    ctx.arc(cx, cy, r + 3, startAngle, endAngle, true);
    ctx.strokeStyle = 'rgba(0,0,0,0.2)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Value arc
    ctx.beginPath();
    ctx.arc(cx, cy, r + 3, startAngle, angle, true);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Knob body
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = knobColor;
    ctx.fill();

    // Inner cap
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.7, 0, Math.PI * 2);
    ctx.fillStyle = capColor;
    ctx.fill();

    // Pointer line
    const pLen = r * 0.85;
    const px = cx + Math.cos(angle) * pLen;
    const py = cy - Math.sin(angle) * pLen;
    const ix = cx + Math.cos(angle) * (r * 0.3);
    const iy = cy - Math.sin(angle) * (r * 0.3);
    ctx.beginPath();
    ctx.moveTo(ix, iy);
    ctx.lineTo(px, py);
    ctx.strokeStyle = indicator;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Update value readout
    const group = canvas.closest('.gm-knob-group');
    if (group) {
      const valEl = group.querySelector('.gm-knob-value');
      if (valEl) {
        valEl.textContent = formatKnobValue(id);
      }
    }
  }

  function getKnobDef(id) {
    // Check global knobs
    if (id === 'drive') return { min: 0, max: 100, unit: '%' };
    if (id === 'output') return { min: 0, max: 100, unit: '%' };
    // Check effect knobs
    for (const fx of EFFECTS) {
      const k = fx.knobs.find(k => k.id === id);
      if (k) return k;
    }
    return null;
  }

  function getNormalized(id, def) {
    const val = knobValues[id];
    if (def.log) {
      // Log scale normalization
      const logMin = Math.log(def.min);
      const logMax = Math.log(def.max);
      return (Math.log(val) - logMin) / (logMax - logMin);
    }
    return (val - def.min) / (def.max - def.min);
  }

  function formatKnobValue(id) {
    const def = getKnobDef(id);
    const val = knobValues[id];
    if (!def) return Math.round(val);
    if (def.unit === 'Hz' && val >= 1000) return (val / 1000).toFixed(1) + 'k';
    if (def.unit === 'ms') return Math.round(val) + 'ms';
    if (def.unit === '%') return Math.round(val) + '%';
    if (def.unit === 'Hz') return val.toFixed(1) + 'Hz';
    if (def.step === 4) return val === 4 ? '4' : '8';
    return Math.round(val * 10) / 10;
  }

  // --- Knob Interaction ---
  function onKnobDown(e) {
    const canvas = e.target.closest('.gm-knob-canvas');
    if (!canvas) return;

    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);

    activeKnob = canvas.dataset.knob;
    dragStartY = e.clientY;
    dragStartVal = knobValues[activeKnob];

    const group = canvas.closest('.gm-knob-group');
    if (group) group.classList.add('dragging');
  }

  function onKnobMove(e) {
    if (!activeKnob) return;

    const def = getKnobDef(activeKnob);
    if (!def) return;

    const dy = dragStartY - e.clientY; // up = positive
    const sensitivity = (e.shiftKey ? 0.15 : 1) * 0.005;

    if (def.log) {
      const logMin = Math.log(def.min);
      const logMax = Math.log(def.max);
      const startNorm = (Math.log(dragStartVal) - logMin) / (logMax - logMin);
      const newNorm = Math.max(0, Math.min(1, startNorm + dy * sensitivity));
      knobValues[activeKnob] = Math.exp(logMin + newNorm * (logMax - logMin));
    } else if (def.step) {
      const range = def.max - def.min;
      const newVal = dragStartVal + dy * sensitivity * range;
      knobValues[activeKnob] = newVal < (def.min + def.max) / 2 ? def.min : def.max;
    } else {
      const range = def.max - def.min;
      const newVal = dragStartVal + dy * sensitivity * range;
      knobValues[activeKnob] = Math.max(def.min, Math.min(def.max, newVal));
    }

    drawKnob(activeKnob);
    applyKnobValue(activeKnob);
  }

  function onKnobUp() {
    if (activeKnob) {
      const canvas = knobCanvases[activeKnob];
      if (canvas) {
        const group = canvas.closest('.gm-knob-group');
        if (group) group.classList.remove('dragging');
      }
    }
    activeKnob = null;
  }

  // --- Audio Engine ---
  function ensureAudioCtx() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  }

  function buildChain() {
    const ctx = ensureAudioCtx();

    // Input gain (drive)
    inputGain = ctx.createGain();
    inputGain.gain.value = knobValues['drive'] / 50; // 0-2 range

    // === FILTER (MF-101) ===
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = knobValues['filter-cutoff'];
    filter.Q.value = knobValues['filter-resonance'];

    const filterLfo = ctx.createOscillator();
    const filterLfoGain = ctx.createGain();
    filterLfo.frequency.value = knobValues['filter-lfo'];
    filterLfoGain.gain.value = 0; // modulated by knob
    filterLfo.connect(filterLfoGain);
    filterLfoGain.connect(filter.frequency);
    filterLfo.start();

    // Envelope follower for filter
    const envFollower = ctx.createGain();
    envFollower.gain.value = 1;

    // Filter dry/wet
    const filterDry = ctx.createGain();
    const filterWet = ctx.createGain();
    filterDry.gain.value = 0;
    filterWet.gain.value = 1;
    const filterMerge = ctx.createGain();

    nodes.filter = {
      input: ctx.createGain(),
      filter, lfo: filterLfo, lfoGain: filterLfoGain,
      envFollower, dry: filterDry, wet: filterWet, merge: filterMerge,
      output: filterMerge
    };

    // Wire filter
    nodes.filter.input.connect(filter);
    nodes.filter.input.connect(filterDry);
    filter.connect(filterWet);
    filterDry.connect(filterMerge);
    filterWet.connect(filterMerge);

    // === RING MOD (MF-102) ===
    const ringCarrier = ctx.createOscillator();
    ringCarrier.frequency.value = knobValues['ring-freq'];
    ringCarrier.type = 'sine';

    const ringDepth = ctx.createGain();
    ringDepth.gain.value = 0; // carrier modulates this gain node
    ringCarrier.connect(ringDepth.gain);
    ringCarrier.start();

    const ringLfo = ctx.createOscillator();
    const ringLfoGain = ctx.createGain();
    ringLfo.frequency.value = knobValues['ring-lfo-rate'];
    ringLfoGain.gain.value = 0;
    ringLfo.connect(ringLfoGain);
    ringLfoGain.connect(ringCarrier.frequency);
    ringLfo.start();

    const ringDry = ctx.createGain();
    const ringWet = ctx.createGain();
    const ringMix = knobValues['ring-mix'] / 100;
    ringDry.gain.value = 1 - ringMix;
    ringWet.gain.value = ringMix;
    const ringMerge = ctx.createGain();

    nodes.ringmod = {
      input: ctx.createGain(),
      carrier: ringCarrier, depth: ringDepth,
      lfo: ringLfo, lfoGain: ringLfoGain,
      dry: ringDry, wet: ringWet, merge: ringMerge,
      output: ringMerge
    };

    // Wire ring mod
    nodes.ringmod.input.connect(ringDepth); // input × carrier
    nodes.ringmod.input.connect(ringDry);
    ringDepth.connect(ringWet);
    ringDry.connect(ringMerge);
    ringWet.connect(ringMerge);

    // === PHASER (MF-103) ===
    const phaserStages = knobValues['phaser-stages'];
    const allpasses = [];
    for (let i = 0; i < 8; i++) {
      const ap = ctx.createBiquadFilter();
      ap.type = 'allpass';
      ap.frequency.value = 1000;
      ap.Q.value = 0.5;
      allpasses.push(ap);
    }

    // Chain active stages
    for (let i = 0; i < allpasses.length - 1; i++) {
      allpasses[i].connect(allpasses[i + 1]);
    }

    const phaserLfo = ctx.createOscillator();
    const phaserLfoGain = ctx.createGain();
    phaserLfo.frequency.value = knobValues['phaser-rate'];
    phaserLfoGain.gain.value = knobValues['phaser-depth'] / 100 * 2000;
    phaserLfo.connect(phaserLfoGain);
    allpasses.forEach(ap => phaserLfoGain.connect(ap.frequency));
    phaserLfo.start();

    const phaserFeedback = ctx.createGain();
    phaserFeedback.gain.value = knobValues['phaser-feedback'] / 100;
    allpasses[allpasses.length - 1].connect(phaserFeedback);
    phaserFeedback.connect(allpasses[0]);

    const phaserDry = ctx.createGain();
    phaserDry.gain.value = 0.5;
    const phaserWet = ctx.createGain();
    phaserWet.gain.value = 0.5;
    const phaserMerge = ctx.createGain();

    nodes.phaser = {
      input: ctx.createGain(),
      allpasses, lfo: phaserLfo, lfoGain: phaserLfoGain,
      feedback: phaserFeedback,
      dry: phaserDry, wet: phaserWet, merge: phaserMerge,
      output: phaserMerge
    };

    // Wire phaser
    nodes.phaser.input.connect(allpasses[0]);
    nodes.phaser.input.connect(phaserDry);
    allpasses[phaserStages - 1].connect(phaserWet);
    phaserDry.connect(phaserMerge);
    phaserWet.connect(phaserMerge);

    // === DELAY (MF-104) ===
    const delayNode = ctx.createDelay(1.0);
    delayNode.delayTime.value = knobValues['delay-time'] / 1000;

    const delayFeedback = ctx.createGain();
    delayFeedback.gain.value = knobValues['delay-feedback'] / 100;

    const delayLfo = ctx.createOscillator();
    const delayLfoGain = ctx.createGain();
    delayLfo.frequency.value = knobValues['delay-lfo'];
    delayLfoGain.gain.value = 0.002; // subtle modulation
    delayLfo.connect(delayLfoGain);
    delayLfoGain.connect(delayNode.delayTime);
    delayLfo.start();

    const delayDry = ctx.createGain();
    const delayWet = ctx.createGain();
    const delayMixVal = knobValues['delay-mix'] / 100;
    delayDry.gain.value = 1 - delayMixVal * 0.5;
    delayWet.gain.value = delayMixVal;
    const delayMerge = ctx.createGain();

    delayNode.connect(delayFeedback);
    delayFeedback.connect(delayNode);

    nodes.delay = {
      input: ctx.createGain(),
      delay: delayNode, feedback: delayFeedback,
      lfo: delayLfo, lfoGain: delayLfoGain,
      dry: delayDry, wet: delayWet, merge: delayMerge,
      output: delayMerge
    };

    // Wire delay
    nodes.delay.input.connect(delayNode);
    nodes.delay.input.connect(delayDry);
    delayNode.connect(delayWet);
    delayDry.connect(delayMerge);
    delayWet.connect(delayMerge);

    // === OUTPUT ===
    outputGain = ctx.createGain();
    outputGain.gain.value = knobValues['output'] / 100;

    analyserNode = ctx.createAnalyser();
    analyserNode.fftSize = 256;

    // === CHAIN ===
    // input → drive → filter → ringmod → phaser → delay → output
    inputGain.connect(nodes.filter.input);
    nodes.filter.output.connect(nodes.ringmod.input);
    nodes.ringmod.output.connect(nodes.phaser.input);
    nodes.phaser.output.connect(nodes.delay.input);
    nodes.delay.output.connect(outputGain);
    outputGain.connect(analyserNode);
    analyserNode.connect(ctx.destination);

    // Apply bypass states
    Object.keys(bypass).forEach(fx => updateBypass(fx));
  }

  function teardownChain() {
    // Stop oscillators
    ['filter', 'ringmod', 'phaser', 'delay'].forEach(fx => {
      if (nodes[fx]) {
        if (nodes[fx].lfo) try { nodes[fx].lfo.stop(); } catch(e) {}
        if (nodes[fx].carrier) try { nodes[fx].carrier.stop(); } catch(e) {}
      }
    });

    // Disconnect everything
    if (inputGain) try { inputGain.disconnect(); } catch(e) {}
    if (outputGain) try { outputGain.disconnect(); } catch(e) {}
    Object.keys(nodes).forEach(fx => {
      if (nodes[fx]) {
        Object.values(nodes[fx]).forEach(node => {
          if (node && node.disconnect) try { node.disconnect(); } catch(e) {}
        });
        delete nodes[fx];
      }
    });

    inputGain = null;
    outputGain = null;
    analyserNode = null;
  }

  function updateBypass(fx) {
    if (!nodes[fx]) return;
    const n = nodes[fx];
    const isBypassed = bypass[fx];

    // Disconnect and rewire
    // Simple approach: adjust wet/dry
    if (isBypassed) {
      if (n.wet) n.wet.gain.value = 0;
      if (n.dry) n.dry.gain.value = 1;
      // For ring mod — disconnect carrier modulation
      if (fx === 'ringmod' && n.depth) n.depth.gain.value = 0;
    } else {
      // Restore original values
      applyEffectValues(fx);
    }
  }

  function applyEffectValues(fx) {
    if (!nodes[fx]) return;

    switch (fx) {
      case 'filter': {
        const n = nodes.filter;
        n.filter.frequency.value = knobValues['filter-cutoff'];
        n.filter.Q.value = knobValues['filter-resonance'];
        n.lfo.frequency.value = knobValues['filter-lfo'];
        // LFO depth proportional to cutoff
        n.lfoGain.gain.value = knobValues['filter-cutoff'] * 0.3;
        n.wet.gain.value = 1;
        n.dry.gain.value = 0;
        break;
      }
      case 'ringmod': {
        const n = nodes.ringmod;
        n.carrier.frequency.value = knobValues['ring-freq'];
        n.lfo.frequency.value = knobValues['ring-lfo-rate'];
        n.lfoGain.gain.value = knobValues['ring-freq'] * knobValues['ring-lfo-depth'] / 100;
        const mix = knobValues['ring-mix'] / 100;
        n.wet.gain.value = mix;
        n.dry.gain.value = 1 - mix;
        break;
      }
      case 'phaser': {
        const n = nodes.phaser;
        n.lfo.frequency.value = knobValues['phaser-rate'];
        n.lfoGain.gain.value = knobValues['phaser-depth'] / 100 * 2000;
        n.feedback.gain.value = knobValues['phaser-feedback'] / 100;
        n.wet.gain.value = 0.5;
        n.dry.gain.value = 0.5;
        break;
      }
      case 'delay': {
        const n = nodes.delay;
        n.delay.delayTime.value = knobValues['delay-time'] / 1000;
        n.feedback.gain.value = knobValues['delay-feedback'] / 100;
        n.lfo.frequency.value = knobValues['delay-lfo'];
        const mix = knobValues['delay-mix'] / 100;
        n.wet.gain.value = mix;
        n.dry.gain.value = 1 - mix * 0.5;
        break;
      }
    }
  }

  function applyKnobValue(id) {
    if (!audioCtx || !inputGain) return;

    // Drive
    if (id === 'drive') {
      inputGain.gain.value = knobValues['drive'] / 50;
      return;
    }

    // Output
    if (id === 'output') {
      outputGain.gain.value = knobValues['output'] / 100;
      return;
    }

    // Effect params
    const fxId = id.split('-')[0];
    const fxMap = { filter: 'filter', ring: 'ringmod', phaser: 'phaser', delay: 'delay' };
    const fx = fxMap[fxId];
    if (fx && !bypass[fx]) {
      applyEffectValues(fx);
    }
  }

  // --- File Loading ---
  function loadFile(file) {
    const ctx = ensureAudioCtx();
    const reader = new FileReader();
    reader.onload = (e) => {
      ctx.decodeAudioData(e.target.result, (buffer) => {
        audioBuffer = buffer;
        fileLoaded = true;
        fileName = file.name;
        document.getElementById('gm-drop-text').textContent = fileName;
        document.getElementById('gm-dropzone').classList.add('has-file');
        switchSource('file');
        startPlayback();
      });
    };
    reader.readAsArrayBuffer(file);
  }

  function switchSource(source) {
    // Stop current source
    stopSource();

    currentSource = source;

    // Update button states
    document.querySelectorAll('#gummodul-body .gm-source-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.source === source);
    });

    if (source === 'mic') {
      startMic();
    } else if (source === 'osc') {
      startTestOsc();
    }
    // 'file' waits for play button
  }

  function startPlayback() {
    if (isPlaying) stopSource();

    const ctx = ensureAudioCtx();
    if (!inputGain) buildChain();

    if (currentSource === 'file' && audioBuffer) {
      sourceNode = ctx.createBufferSource();
      sourceNode.buffer = audioBuffer;
      sourceNode.loop = true;
      sourceNode.connect(inputGain);
      sourceNode.start();
      isPlaying = true;
      updatePlayButton(true);
    } else if (currentSource === 'mic') {
      startMic();
    } else if (currentSource === 'osc') {
      startTestOsc();
    }
  }

  function stopSource() {
    if (sourceNode) {
      try { sourceNode.stop(); } catch(e) {}
      try { sourceNode.disconnect(); } catch(e) {}
      sourceNode = null;
    }
    if (micStream) {
      micStream.getTracks().forEach(t => t.stop());
      micStream = null;
    }
    if (testOsc) {
      try { testOsc.stop(); } catch(e) {}
      try { testOsc.disconnect(); } catch(e) {}
      testOsc = null;
    }
    isPlaying = false;
    updatePlayButton(false);
  }

  function stopPlayback() {
    stopSource();
    teardownChain();
  }

  function togglePlayPause() {
    if (isPlaying) {
      stopSource();
    } else {
      if (!inputGain) buildChain();
      startPlayback();
    }
  }

  function updatePlayButton(playing) {
    const btn = document.getElementById('gm-playpause');
    if (btn) {
      btn.innerHTML = playing ? '&#9646;&#9646;' : '&#9654;';
      btn.classList.toggle('active', playing);
    }
  }

  async function startMic() {
    try {
      const ctx = ensureAudioCtx();
      if (!inputGain) buildChain();

      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      sourceNode = ctx.createMediaStreamSource(micStream);
      sourceNode.connect(inputGain);
      isPlaying = true;
      updatePlayButton(true);
    } catch (err) {
      console.warn('Mic access denied:', err);
      switchSource('file');
    }
  }

  function startTestOsc() {
    const ctx = ensureAudioCtx();
    if (!inputGain) buildChain();

    testOsc = ctx.createOscillator();
    testOsc.type = 'sawtooth';
    testOsc.frequency.value = 220;
    testOsc.connect(inputGain);
    testOsc.start();
    isPlaying = true;
    updatePlayButton(true);
  }

  // --- Lifecycle ---
  function onOpen() {
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    resize();
  }

  function onClose() {
    stopPlayback();
  }

  function resize() {
    drawAllKnobs();
  }

  function start() {
    // Called externally if needed
  }

  function stop() {
    stopPlayback();
  }

  return { init, resize, start, stop };
})();

document.addEventListener('DOMContentLoaded', () => GumModul.init());
