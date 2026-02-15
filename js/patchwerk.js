// patchwerk.js — Modular synth with patch cables
// Electric cyan. Dark workspace. Bezier cable SVG. Web Audio engine.
const Patchwerk = (() => {

  // --- Module type definitions ---
  const MODULE_TYPES = {
    osc: {
      label: 'OSC', name: 'Oscillator',
      inputs: [],
      outputs: [{ id: 'out', label: 'OUT', type: 'audio' }],
      knobs: [
        { id: 'freq', label: 'Freq', min: 20, max: 2000, value: 220, log: true, unit: 'Hz' },
        { id: 'detune', label: 'Detune', min: -100, max: 100, value: 0, unit: 'ct', center: true }
      ],
      wave: true, waveOptions: ['sine', 'sawtooth', 'square', 'triangle'], waveDefault: 'sawtooth'
    },
    lfo: {
      label: 'LFO', name: 'LFO',
      inputs: [],
      outputs: [{ id: 'out', label: 'OUT', type: 'mod' }],
      knobs: [
        { id: 'rate', label: 'Rate', min: 0.1, max: 30, value: 2, unit: 'Hz' },
        { id: 'depth', label: 'Depth', min: 0, max: 100, value: 50, unit: '%' }
      ],
      wave: true, waveOptions: ['sine', 'sawtooth', 'square', 'triangle'], waveDefault: 'sine'
    },
    flt: {
      label: 'FLT', name: 'Filter',
      inputs: [
        { id: 'in', label: 'IN', type: 'audio' },
        { id: 'mod', label: 'MOD', type: 'mod' }
      ],
      outputs: [{ id: 'out', label: 'OUT', type: 'audio' }],
      knobs: [
        { id: 'cutoff', label: 'Cutoff', min: 20, max: 12000, value: 2000, log: true, unit: 'Hz' },
        { id: 'resonance', label: 'Res', min: 0, max: 30, value: 2, unit: '' }
      ],
      filterType: true, filterOptions: ['lowpass', 'highpass', 'bandpass'], filterDefault: 'lowpass'
    },
    amp: {
      label: 'AMP', name: 'Amplifier',
      inputs: [
        { id: 'in', label: 'IN', type: 'audio' },
        { id: 'mod', label: 'MOD', type: 'mod' }
      ],
      outputs: [{ id: 'out', label: 'OUT', type: 'audio' }],
      knobs: [
        { id: 'gain', label: 'Gain', min: 0, max: 100, value: 75, unit: '%' }
      ]
    },
    dly: {
      label: 'DLY', name: 'Delay',
      inputs: [{ id: 'in', label: 'IN', type: 'audio' }],
      outputs: [{ id: 'out', label: 'OUT', type: 'audio' }],
      knobs: [
        { id: 'time', label: 'Time', min: 10, max: 1000, value: 300, unit: 'ms' },
        { id: 'feedback', label: 'Fdbk', min: 0, max: 95, value: 40, unit: '%' },
        { id: 'mix', label: 'Mix', min: 0, max: 100, value: 50, unit: '%' }
      ]
    },
    out: {
      label: 'OUT', name: 'Master',
      inputs: [{ id: 'in', label: 'IN', type: 'audio' }],
      outputs: [],
      knobs: [
        { id: 'volume', label: 'Vol', min: 0, max: 100, value: 75, unit: '%' }
      ]
    }
  };

  const WAVE_LABELS = { sine: 'SIN', sawtooth: 'SAW', square: 'SQR', triangle: 'TRI' };
  const FILTER_LABELS = { lowpass: 'LP', highpass: 'HP', bandpass: 'BP' };

  // --- State ---
  let audioCtx = null;
  let modules = [];
  let cables = [];
  let nextModuleId = 1;
  let nextCableId = 1;
  let pendingCable = null; // { moduleId, jackId, isOutput, type }
  let dragState = null; // { moduleId, startX, startY, origX, origY }
  let activeKnob = null; // { moduleId, knobId }
  let knobDragStartY = 0;
  let knobDragStartVal = 0;
  let currentSkin = 'circuit';
  let workspace = null;
  let svgLayer = null;
  let pendingPath = null;
  let initialized = false;
  let isOpen = false;

  // --- Init ---
  function init() {
    if (initialized) return;
    initialized = true;

    const body = document.getElementById('patchwerk-body');
    if (!body) return;

    workspace = body.querySelector('.pw-workspace');
    svgLayer = body.querySelector('.pw-cables');
    if (!workspace || !svgLayer) return;

    // Wire toolbar
    body.querySelectorAll('.pw-add-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.type;
        if (type === 'out') return; // Only one OUT
        addModule(type, 60 + Math.random() * 200, 40 + Math.random() * 150);
      });
    });

    // Skin selector
    body.querySelectorAll('.pw-skin-btn').forEach(btn => {
      btn.addEventListener('click', () => switchSkin(btn.dataset.skin));
    });

    // Preset selector
    const presetSelect = document.getElementById('pw-preset');
    if (presetSelect) {
      presetSelect.addEventListener('change', () => {
        const val = presetSelect.value;
        if (val) loadPreset(val);
        else clearPatch();
        presetSelect.value = '';
      });
    }

    // Workspace click — cancel pending cable
    workspace.addEventListener('click', (e) => {
      if (e.target === workspace || e.target.classList.contains('pw-cables')) {
        cancelPending();
      }
    });

    // Mouse move for pending cable preview
    workspace.addEventListener('mousemove', onMouseMove);
    workspace.addEventListener('touchmove', onTouchMove, { passive: false });

    // ESC to cancel pending
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') cancelPending();
    });

    // Pointer up — end knob drag
    document.addEventListener('pointerup', onKnobUp);
    document.addEventListener('pointermove', onKnobMove);

    // WindowManager hooks
    if (typeof WindowManager !== 'undefined') {
      WindowManager.on('open', ({ id }) => { if (id === 'patchwerk') onOpen(); });
      WindowManager.on('close', ({ id }) => { if (id === 'patchwerk') onClose(); });
    }

    drawAllKnobs();
  }

  // --- Audio context ---
  function ensureAudio() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  }

  // --- Open / Close ---
  function onOpen() {
    isOpen = true;
    ensureAudio();
    startAllModules();
    updateAllCables();
  }

  function onClose() {
    isOpen = false;
    stopAllModules();
    cancelPending();
  }

  // --- Create module ---
  function addModule(type, x, y) {
    const def = MODULE_TYPES[type];
    if (!def) return null;

    // Only one OUT allowed
    if (type === 'out' && modules.some(m => m.type === 'out')) return null;

    const id = nextModuleId++;
    const mod = {
      id, type, x, y,
      knobValues: {},
      wave: def.waveDefault || null,
      filterType: def.filterDefault || null,
      audioNodes: null
    };

    // Init knob values
    def.knobs.forEach(k => {
      mod.knobValues[k.id] = k.value;
    });

    modules.push(mod);

    // Create DOM
    const el = buildModuleDOM(mod);
    workspace.appendChild(el);

    // Create audio nodes if context exists
    if (audioCtx) {
      createAudioNodes(mod);
    }

    return mod;
  }

  function buildModuleDOM(mod) {
    const def = MODULE_TYPES[mod.type];
    const el = document.createElement('div');
    el.className = 'pw-module';
    el.id = `pw-mod-${mod.id}`;
    el.dataset.type = mod.type;
    el.dataset.moduleId = mod.id;
    el.style.left = mod.x + 'px';
    el.style.top = mod.y + 'px';

    // Header
    const header = document.createElement('div');
    header.className = 'pw-module-header';
    header.innerHTML = `
      <span><span class="pw-module-type">${def.label}</span><span class="pw-module-name">${def.name}</span></span>
      <button class="pw-module-delete" title="Delete module">&times;</button>
    `;
    el.appendChild(header);

    // Header drag
    header.addEventListener('mousedown', (e) => onModuleDragStart(e, mod));
    header.addEventListener('touchstart', (e) => onModuleTouchStart(e, mod), { passive: false });

    // Delete button
    header.querySelector('.pw-module-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteModule(mod.id);
    });

    // Body
    const body = document.createElement('div');
    body.className = 'pw-module-body';

    // Input jacks
    if (def.inputs.length > 0) {
      const col = document.createElement('div');
      col.className = 'pw-jacks-col pw-jacks-in';
      def.inputs.forEach(jack => {
        const j = createJackEl(mod.id, jack, false);
        col.appendChild(j);
      });
      body.appendChild(col);
    }

    // Knobs area
    const knobsArea = document.createElement('div');
    knobsArea.className = 'pw-knobs-area';

    // Waveform toggle
    if (def.wave) {
      const btn = document.createElement('button');
      btn.className = 'pw-wave-btn';
      btn.dataset.moduleId = mod.id;
      btn.textContent = WAVE_LABELS[mod.wave] || 'SIN';
      btn.addEventListener('click', () => cycleWave(mod, btn));
      knobsArea.appendChild(btn);
    }

    // Filter type toggle
    if (def.filterType) {
      const btn = document.createElement('button');
      btn.className = 'pw-type-btn';
      btn.dataset.moduleId = mod.id;
      btn.textContent = FILTER_LABELS[mod.filterType] || 'LP';
      btn.addEventListener('click', () => cycleFilterType(mod, btn));
      knobsArea.appendChild(btn);
    }

    // Knobs
    def.knobs.forEach(knobDef => {
      const group = document.createElement('div');
      group.className = 'pw-knob-group';

      const canvas = document.createElement('canvas');
      canvas.className = 'pw-knob-canvas';
      canvas.width = 96;
      canvas.height = 96;
      canvas.dataset.moduleId = mod.id;
      canvas.dataset.knob = knobDef.id;

      canvas.addEventListener('pointerdown', (e) => onKnobDown(e, mod, knobDef));

      group.appendChild(canvas);

      const label = document.createElement('div');
      label.className = 'pw-knob-label';
      label.textContent = knobDef.label;
      group.appendChild(label);

      const valueEl = document.createElement('div');
      valueEl.className = 'pw-knob-value';
      valueEl.textContent = formatValue(mod.knobValues[knobDef.id], knobDef);
      group.appendChild(valueEl);

      knobsArea.appendChild(group);
    });

    body.appendChild(knobsArea);

    // Output jacks
    if (def.outputs.length > 0) {
      const col = document.createElement('div');
      col.className = 'pw-jacks-col pw-jacks-out';
      def.outputs.forEach(jack => {
        const j = createJackEl(mod.id, jack, true);
        col.appendChild(j);
      });
      body.appendChild(col);
    }

    el.appendChild(body);
    return el;
  }

  function createJackEl(moduleId, jack, isOutput) {
    const el = document.createElement('div');
    el.className = 'pw-jack ' + (isOutput ? 'pw-jack-output' : 'pw-jack-input');
    if (jack.type === 'mod') el.classList.add('pw-jack-mod');
    el.dataset.moduleId = moduleId;
    el.dataset.jackId = jack.id;
    el.dataset.isOutput = isOutput;
    el.dataset.label = jack.label;
    el.dataset.jackType = jack.type;

    el.addEventListener('click', (e) => {
      e.stopPropagation();
      onJackClick(moduleId, jack.id, isOutput, jack.type);
    });

    return el;
  }

  // --- Delete module ---
  function deleteModule(id) {
    const mod = modules.find(m => m.id === id);
    if (!mod || mod.type === 'out') return;

    // Remove cables connected to this module
    const toRemove = cables.filter(c => c.fromModule === id || c.toModule === id);
    toRemove.forEach(c => disconnectCable(c.id));

    // Destroy audio
    destroyAudioNodes(mod);

    // Remove DOM
    const el = document.getElementById(`pw-mod-${id}`);
    if (el) el.remove();

    modules = modules.filter(m => m.id !== id);
  }

  // --- Jack click → patching ---
  function onJackClick(moduleId, jackId, isOutput, jackType) {
    if (!pendingCable) {
      // Start new cable — must be output
      if (!isOutput) {
        // Clicked input first — start from there (reversed), we'll swap when connecting
        pendingCable = { moduleId, jackId, isOutput: false, type: jackType };
      } else {
        pendingCable = { moduleId, jackId, isOutput: true, type: jackType };
      }
      // Highlight jack
      const jackEl = getJackEl(moduleId, jackId);
      if (jackEl) jackEl.classList.add('pw-jack-active');
      return;
    }

    // Completing a cable
    const from = pendingCable;

    // Can't connect to same module
    if (from.moduleId === moduleId) {
      cancelPending();
      return;
    }

    // Can't connect same direction
    if (from.isOutput === isOutput) {
      cancelPending();
      return;
    }

    // Determine output → input
    let outModId, outJackId, inModId, inJackId;
    if (from.isOutput) {
      outModId = from.moduleId; outJackId = from.jackId;
      inModId = moduleId; inJackId = jackId;
    } else {
      outModId = moduleId; outJackId = jackId;
      inModId = from.moduleId; inJackId = from.jackId;
    }

    // Remove existing cable on this input
    const existing = cables.find(c => c.toModule === inModId && c.toJack === inJackId);
    if (existing) disconnectCable(existing.id);

    // Connect
    connectJacks(outModId, outJackId, inModId, inJackId);
    cancelPending();
  }

  function cancelPending() {
    if (pendingCable) {
      const jackEl = getJackEl(pendingCable.moduleId, pendingCable.jackId);
      if (jackEl) jackEl.classList.remove('pw-jack-active');
      pendingCable = null;
    }
    // Remove pending path
    if (pendingPath) {
      pendingPath.remove();
      pendingPath = null;
    }
  }

  // --- Cable connection ---
  function connectJacks(fromModId, fromJackId, toModId, toJackId) {
    const id = nextCableId++;
    const cable = { id, fromModule: fromModId, fromJack: fromJackId, toModule: toModId, toJack: toJackId };

    // Create SVG elements (hit area + visible line)
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.dataset.cableId = id;

    const hitPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    hitPath.classList.add('pw-cable-hit');

    const linePath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    linePath.classList.add('pw-cable-line');

    g.appendChild(hitPath);
    g.appendChild(linePath);

    // Click to delete
    g.addEventListener('click', (e) => {
      e.stopPropagation();
      disconnectCable(id);
    });

    svgLayer.appendChild(g);
    cable.svgGroup = g;
    cable.hitPath = hitPath;
    cable.linePath = linePath;

    cables.push(cable);
    renderCable(cable);

    // Mark jacks as connected
    updateJackStates();

    // Audio wiring
    wireAudio(cable);
  }

  function disconnectCable(cableId) {
    const idx = cables.findIndex(c => c.id === cableId);
    if (idx === -1) return;
    const cable = cables[idx];

    // Unwire audio
    unwireAudio(cable);

    // Remove SVG
    if (cable.svgGroup) cable.svgGroup.remove();

    cables.splice(idx, 1);
    updateJackStates();
  }

  function updateJackStates() {
    // Clear all connected states
    workspace.querySelectorAll('.pw-jack').forEach(j => j.classList.remove('pw-jack-connected'));

    // Mark connected
    cables.forEach(c => {
      const fromEl = getJackEl(c.fromModule, c.fromJack);
      const toEl = getJackEl(c.toModule, c.toJack);
      if (fromEl) fromEl.classList.add('pw-jack-connected');
      if (toEl) toEl.classList.add('pw-jack-connected');
    });
  }

  // --- Cable rendering ---
  function renderCable(cable) {
    const fromPos = getJackPos(cable.fromModule, cable.fromJack);
    const toPos = getJackPos(cable.toModule, cable.toJack);
    if (!fromPos || !toPos) return;

    const d = bezierPath(fromPos.x, fromPos.y, toPos.x, toPos.y);
    cable.linePath.setAttribute('d', d);
    cable.hitPath.setAttribute('d', d);
  }

  function updateAllCables() {
    cables.forEach(c => renderCable(c));
  }

  function bezierPath(x1, y1, x2, y2) {
    const dx = Math.abs(x2 - x1);
    const cpOffset = Math.max(40, dx * 0.4);
    const droop = Math.max(20, Math.abs(y2 - y1) * 0.1 + 15);
    const midY = (y1 + y2) / 2 + droop;
    return `M ${x1},${y1} C ${x1 + cpOffset},${midY} ${x2 - cpOffset},${midY} ${x2},${y2}`;
  }

  function getJackPos(moduleId, jackId) {
    const jackEl = getJackEl(moduleId, jackId);
    if (!jackEl || !workspace) return null;

    const jackRect = jackEl.getBoundingClientRect();
    const wsRect = workspace.getBoundingClientRect();

    return {
      x: jackRect.left + jackRect.width / 2 - wsRect.left,
      y: jackRect.top + jackRect.height / 2 - wsRect.top
    };
  }

  function getJackEl(moduleId, jackId) {
    return workspace.querySelector(`.pw-jack[data-module-id="${moduleId}"][data-jack-id="${jackId}"]`);
  }

  // --- Pending cable preview ---
  function onMouseMove(e) {
    if (!pendingCable) return;
    drawPendingCable(e.clientX, e.clientY);
  }

  function onTouchMove(e) {
    if (!pendingCable) return;
    e.preventDefault();
    const touch = e.touches[0];
    drawPendingCable(touch.clientX, touch.clientY);
  }

  function drawPendingCable(clientX, clientY) {
    const fromPos = getJackPos(pendingCable.moduleId, pendingCable.jackId);
    if (!fromPos) return;

    const wsRect = workspace.getBoundingClientRect();
    const mx = clientX - wsRect.left;
    const my = clientY - wsRect.top;

    if (!pendingPath) {
      pendingPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      pendingPath.classList.add('pw-cable-pending');
      svgLayer.appendChild(pendingPath);
    }

    let d;
    if (pendingCable.isOutput) {
      d = bezierPath(fromPos.x, fromPos.y, mx, my);
    } else {
      d = bezierPath(mx, my, fromPos.x, fromPos.y);
    }
    pendingPath.setAttribute('d', d);
  }

  // --- Module dragging ---
  function onModuleDragStart(e, mod) {
    if (e.target.closest('.pw-module-delete')) return;
    e.preventDefault();

    const el = document.getElementById(`pw-mod-${mod.id}`);
    if (!el) return;
    el.classList.add('pw-dragging');

    dragState = {
      moduleId: mod.id,
      startX: e.clientX,
      startY: e.clientY,
      origX: mod.x,
      origY: mod.y
    };

    const onMove = (ev) => {
      if (!dragState) return;
      const dx = ev.clientX - dragState.startX;
      const dy = ev.clientY - dragState.startY;
      mod.x = Math.max(0, dragState.origX + dx);
      mod.y = Math.max(0, dragState.origY + dy);
      el.style.left = mod.x + 'px';
      el.style.top = mod.y + 'px';
      updateAllCables();
    };

    const onUp = () => {
      el.classList.remove('pw-dragging');
      dragState = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function onModuleTouchStart(e, mod) {
    if (e.target.closest('.pw-module-delete')) return;
    e.preventDefault();

    const el = document.getElementById(`pw-mod-${mod.id}`);
    if (!el) return;
    el.classList.add('pw-dragging');

    const touch = e.touches[0];
    dragState = {
      moduleId: mod.id,
      startX: touch.clientX,
      startY: touch.clientY,
      origX: mod.x,
      origY: mod.y
    };

    const onMove = (ev) => {
      if (!dragState) return;
      const t = ev.touches[0];
      const dx = t.clientX - dragState.startX;
      const dy = t.clientY - dragState.startY;
      mod.x = Math.max(0, dragState.origX + dx);
      mod.y = Math.max(0, dragState.origY + dy);
      el.style.left = mod.x + 'px';
      el.style.top = mod.y + 'px';
      updateAllCables();
    };

    const onUp = () => {
      el.classList.remove('pw-dragging');
      dragState = null;
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onUp);
    };

    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onUp);
  }

  // --- Knob interaction ---
  function onKnobDown(e, mod, knobDef) {
    e.preventDefault();
    e.target.setPointerCapture(e.pointerId);

    activeKnob = { moduleId: mod.id, knobId: knobDef.id };
    knobDragStartY = e.clientY;
    knobDragStartVal = mod.knobValues[knobDef.id];

    const group = e.target.closest('.pw-knob-group');
    if (group) group.classList.add('dragging');
  }

  function onKnobMove(e) {
    if (!activeKnob) return;

    const mod = modules.find(m => m.id === activeKnob.moduleId);
    if (!mod) return;

    const def = MODULE_TYPES[mod.type];
    const knobDef = def.knobs.find(k => k.id === activeKnob.knobId);
    if (!knobDef) return;

    const dy = knobDragStartY - e.clientY;
    const sensitivity = (e.shiftKey ? 0.15 : 1) * 0.005;

    if (knobDef.log) {
      const logMin = Math.log(knobDef.min);
      const logMax = Math.log(knobDef.max);
      const startNorm = (Math.log(knobDragStartVal) - logMin) / (logMax - logMin);
      const newNorm = Math.max(0, Math.min(1, startNorm + dy * sensitivity));
      mod.knobValues[knobDef.id] = Math.exp(logMin + newNorm * (logMax - logMin));
    } else {
      const range = knobDef.max - knobDef.min;
      const newVal = knobDragStartVal + dy * sensitivity * range;
      mod.knobValues[knobDef.id] = Math.max(knobDef.min, Math.min(knobDef.max, newVal));
    }

    drawKnob(mod, knobDef);
    applyKnobValue(mod, knobDef);
  }

  function onKnobUp(e) {
    if (!activeKnob) return;

    const canvas = document.querySelector(`.pw-knob-canvas[data-module-id="${activeKnob.moduleId}"][data-knob="${activeKnob.knobId}"]`);
    if (canvas) {
      const group = canvas.closest('.pw-knob-group');
      if (group) group.classList.remove('dragging');
    }

    activeKnob = null;
  }

  // --- Knob drawing ---
  function drawKnob(mod, knobDef) {
    const canvas = document.querySelector(`.pw-knob-canvas[data-module-id="${mod.id}"][data-knob="${knobDef.id}"]`);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const size = 36;
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    const cx = size / 2;
    const cy = size / 2;
    const r = 12;

    // Get colors from skin
    const body = document.getElementById('patchwerk-body');
    const style = getComputedStyle(body);
    const knobColor = style.getPropertyValue('--pw-knob').trim() || '#0a0e14';
    const capColor = style.getPropertyValue('--pw-knob-cap').trim() || '#151c28';
    const indicator = style.getPropertyValue('--pw-indicator').trim() || '#ffffff';
    const accent = style.getPropertyValue('--pw-accent').trim() || '#00d4ff';

    // Normalized value
    const val = mod.knobValues[knobDef.id];
    let norm;
    if (knobDef.log) {
      const logMin = Math.log(knobDef.min);
      const logMax = Math.log(knobDef.max);
      norm = (Math.log(val) - logMin) / (logMax - logMin);
    } else {
      norm = (val - knobDef.min) / (knobDef.max - knobDef.min);
    }

    // Angle: 225 to -45 (270deg sweep)
    const startAngle = (225 * Math.PI) / 180;
    const endAngle = (-45 * Math.PI) / 180;
    const sweep = 1.5 * Math.PI;
    const angle = startAngle - norm * sweep;

    ctx.clearRect(0, 0, size, size);

    // Track arc
    ctx.beginPath();
    ctx.arc(cx, cy, r + 3, startAngle, endAngle, true);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
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

    // Cap
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.7, 0, Math.PI * 2);
    ctx.fillStyle = capColor;
    ctx.fill();

    // Pointer
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

    // Update value display
    const group = canvas.closest('.pw-knob-group');
    if (group) {
      const valueEl = group.querySelector('.pw-knob-value');
      if (valueEl) valueEl.textContent = formatValue(val, knobDef);
    }
  }

  function drawAllKnobs() {
    modules.forEach(mod => {
      const def = MODULE_TYPES[mod.type];
      def.knobs.forEach(knobDef => drawKnob(mod, knobDef));
    });
  }

  function formatValue(val, def) {
    if (def.unit === 'Hz' && val >= 1000) return (val / 1000).toFixed(1) + 'k';
    if (def.unit === 'ms') return Math.round(val) + 'ms';
    if (def.unit === '%') return Math.round(val) + '%';
    if (def.unit === 'Hz') return val.toFixed(1);
    if (def.unit === 'ct') return (val >= 0 ? '+' : '') + Math.round(val);
    return Math.round(val * 10) / 10;
  }

  // --- Waveform / Filter type cycling ---
  function cycleWave(mod, btn) {
    const def = MODULE_TYPES[mod.type];
    const opts = def.waveOptions;
    const idx = opts.indexOf(mod.wave);
    mod.wave = opts[(idx + 1) % opts.length];
    btn.textContent = WAVE_LABELS[mod.wave];

    // Apply to audio
    if (mod.audioNodes) {
      if (mod.type === 'osc' && mod.audioNodes.osc) {
        mod.audioNodes.osc.type = mod.wave;
      }
      if (mod.type === 'lfo' && mod.audioNodes.osc) {
        mod.audioNodes.osc.type = mod.wave;
      }
    }
  }

  function cycleFilterType(mod, btn) {
    const def = MODULE_TYPES[mod.type];
    const opts = def.filterOptions;
    const idx = opts.indexOf(mod.filterType);
    mod.filterType = opts[(idx + 1) % opts.length];
    btn.textContent = FILTER_LABELS[mod.filterType];

    // Apply to audio
    if (mod.audioNodes && mod.audioNodes.filter) {
      mod.audioNodes.filter.type = mod.filterType;
    }
  }

  // --- Skin switching ---
  function switchSkin(skin) {
    const body = document.getElementById('patchwerk-body');
    if (!body) return;
    body.className = `skin-${skin}`;
    body.id = 'patchwerk-body';
    currentSkin = skin;

    // Update active btn
    body.querySelectorAll('.pw-skin-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.skin === skin);
    });

    // Redraw knobs
    drawAllKnobs();
  }

  // === WEB AUDIO ENGINE ===

  function createAudioNodes(mod) {
    const ctx = ensureAudio();
    const def = MODULE_TYPES[mod.type];

    switch (mod.type) {
      case 'osc': {
        const osc = ctx.createOscillator();
        osc.type = mod.wave || 'sawtooth';
        osc.frequency.value = mod.knobValues.freq;
        osc.detune.value = mod.knobValues.detune;
        osc.start();
        const gain = ctx.createGain();
        gain.gain.value = 1;
        osc.connect(gain);
        mod.audioNodes = { osc, output: gain };
        break;
      }
      case 'lfo': {
        const osc = ctx.createOscillator();
        osc.type = mod.wave || 'sine';
        osc.frequency.value = mod.knobValues.rate;
        osc.start();
        const gain = ctx.createGain();
        gain.gain.value = mod.knobValues.depth / 100 * 500;
        osc.connect(gain);
        mod.audioNodes = { osc, depthGain: gain, output: gain };
        break;
      }
      case 'flt': {
        const filter = ctx.createBiquadFilter();
        filter.type = mod.filterType || 'lowpass';
        filter.frequency.value = mod.knobValues.cutoff;
        filter.Q.value = mod.knobValues.resonance;
        mod.audioNodes = { filter, input: filter, modTarget: filter.frequency, output: filter };
        break;
      }
      case 'amp': {
        const gain = ctx.createGain();
        gain.gain.value = mod.knobValues.gain / 100;
        mod.audioNodes = { gain, input: gain, modTarget: gain.gain, output: gain };
        break;
      }
      case 'dly': {
        const input = ctx.createGain();
        input.gain.value = 1;
        const delay = ctx.createDelay(2);
        delay.delayTime.value = mod.knobValues.time / 1000;
        const feedback = ctx.createGain();
        feedback.gain.value = mod.knobValues.feedback / 100;
        const wet = ctx.createGain();
        wet.gain.value = mod.knobValues.mix / 100;
        const dry = ctx.createGain();
        dry.gain.value = 1 - mod.knobValues.mix / 100;
        const output = ctx.createGain();
        output.gain.value = 1;

        // Routing: input → dry → output
        //          input → delay → wet → output
        //          delay → feedback → delay
        input.connect(dry);
        input.connect(delay);
        delay.connect(wet);
        delay.connect(feedback);
        feedback.connect(delay);
        dry.connect(output);
        wet.connect(output);

        mod.audioNodes = { input, delay, feedback, wet, dry, output: output };
        break;
      }
      case 'out': {
        const gain = ctx.createGain();
        gain.gain.value = mod.knobValues.volume / 100;
        gain.connect(ctx.destination);
        mod.audioNodes = { gain, input: gain };
        break;
      }
    }
  }

  function destroyAudioNodes(mod) {
    if (!mod.audioNodes) return;

    // Disconnect everything
    try {
      Object.values(mod.audioNodes).forEach(node => {
        if (node && typeof node.disconnect === 'function') node.disconnect();
        if (node && typeof node.stop === 'function') {
          try { node.stop(); } catch(e) {}
        }
      });
    } catch(e) {}

    mod.audioNodes = null;
  }

  function wireAudio(cable) {
    const fromMod = modules.find(m => m.id === cable.fromModule);
    const toMod = modules.find(m => m.id === cable.toModule);
    if (!fromMod?.audioNodes || !toMod?.audioNodes) return;

    const outputNode = fromMod.audioNodes.output;
    if (!outputNode) return;

    // Determine target
    const toJackDef = MODULE_TYPES[toMod.type].inputs.find(j => j.id === cable.toJack);
    if (!toJackDef) return;

    let targetNode;
    if (toJackDef.type === 'mod' && toMod.audioNodes.modTarget) {
      // Modulation input — connect to AudioParam
      targetNode = toMod.audioNodes.modTarget;
    } else {
      // Audio input
      targetNode = toMod.audioNodes.input;
    }

    if (targetNode) {
      try { outputNode.connect(targetNode); } catch(e) {}
    }
  }

  function unwireAudio(cable) {
    const fromMod = modules.find(m => m.id === cable.fromModule);
    const toMod = modules.find(m => m.id === cable.toModule);
    if (!fromMod?.audioNodes || !toMod?.audioNodes) return;

    const outputNode = fromMod.audioNodes.output;
    if (!outputNode) return;

    const toJackDef = MODULE_TYPES[toMod.type].inputs.find(j => j.id === cable.toJack);
    if (!toJackDef) return;

    let targetNode;
    if (toJackDef.type === 'mod' && toMod.audioNodes.modTarget) {
      targetNode = toMod.audioNodes.modTarget;
    } else {
      targetNode = toMod.audioNodes.input;
    }

    if (targetNode) {
      try { outputNode.disconnect(targetNode); } catch(e) {}
    }
  }

  function applyKnobValue(mod, knobDef) {
    if (!mod.audioNodes) return;
    const val = mod.knobValues[knobDef.id];

    switch (mod.type) {
      case 'osc':
        if (knobDef.id === 'freq') mod.audioNodes.osc.frequency.value = val;
        if (knobDef.id === 'detune') mod.audioNodes.osc.detune.value = val;
        break;
      case 'lfo':
        if (knobDef.id === 'rate') mod.audioNodes.osc.frequency.value = val;
        if (knobDef.id === 'depth') mod.audioNodes.depthGain.gain.value = val / 100 * 500;
        break;
      case 'flt':
        if (knobDef.id === 'cutoff') mod.audioNodes.filter.frequency.value = val;
        if (knobDef.id === 'resonance') mod.audioNodes.filter.Q.value = val;
        break;
      case 'amp':
        if (knobDef.id === 'gain') mod.audioNodes.gain.gain.value = val / 100;
        break;
      case 'dly':
        if (knobDef.id === 'time') mod.audioNodes.delay.delayTime.value = val / 1000;
        if (knobDef.id === 'feedback') mod.audioNodes.feedback.gain.value = val / 100;
        if (knobDef.id === 'mix') {
          mod.audioNodes.wet.gain.value = val / 100;
          mod.audioNodes.dry.gain.value = 1 - val / 100;
        }
        break;
      case 'out':
        if (knobDef.id === 'volume') mod.audioNodes.gain.gain.value = val / 100;
        break;
    }
  }

  function startAllModules() {
    modules.forEach(mod => {
      if (!mod.audioNodes) createAudioNodes(mod);
    });
    // Re-wire all cables
    cables.forEach(c => wireAudio(c));
  }

  function stopAllModules() {
    modules.forEach(mod => destroyAudioNodes(mod));
  }

  // --- Clear all modules and cables ---
  function clearPatch() {
    // Remove all cables
    while (cables.length) disconnectCable(cables[0].id);
    // Remove all modules (copy array since deleteModule modifies it)
    const ids = modules.map(m => m.id);
    ids.forEach(id => {
      const mod = modules.find(m => m.id === id);
      if (mod) {
        destroyAudioNodes(mod);
        const el = document.getElementById(`pw-mod-${id}`);
        if (el) el.remove();
      }
    });
    modules = [];
    cancelPending();
  }

  // --- Preset patches ---
  const PRESETS = {
    simple: {
      desc: 'OSC → OUT (basic tone)',
      modules: [
        { type: 'osc', x: 60, y: 60, knobs: { freq: 440 }, wave: 'sine' },
        { type: 'out', x: 300, y: 60, knobs: { volume: 60 } }
      ],
      cables: [[0, 'out', 1, 'in']]
    },
    bass: {
      desc: 'OSC → FLT → AMP → OUT (fat bass)',
      modules: [
        { type: 'osc', x: 40, y: 60, knobs: { freq: 65, detune: 7 }, wave: 'sawtooth' },
        { type: 'flt', x: 220, y: 40, knobs: { cutoff: 400, resonance: 8 }, filterType: 'lowpass' },
        { type: 'amp', x: 400, y: 40, knobs: { gain: 85 } },
        { type: 'out', x: 560, y: 60, knobs: { volume: 70 } }
      ],
      cables: [[0, 'out', 1, 'in'], [1, 'out', 2, 'in'], [2, 'out', 3, 'in']]
    },
    lead: {
      desc: 'OSC → FLT → OUT + LFO → FLT (wobble lead)',
      modules: [
        { type: 'osc', x: 40, y: 40, knobs: { freq: 330 }, wave: 'sawtooth' },
        { type: 'lfo', x: 40, y: 210, knobs: { rate: 5, depth: 70 }, wave: 'sine' },
        { type: 'flt', x: 240, y: 40, knobs: { cutoff: 1200, resonance: 12 }, filterType: 'lowpass' },
        { type: 'out', x: 440, y: 60, knobs: { volume: 65 } }
      ],
      cables: [[0, 'out', 2, 'in'], [1, 'out', 2, 'mod'], [2, 'out', 3, 'in']]
    },
    pad: {
      desc: 'OSC → FLT → DLY → OUT + LFO → FLT (ambient pad)',
      modules: [
        { type: 'osc', x: 30, y: 40, knobs: { freq: 220, detune: 5 }, wave: 'triangle' },
        { type: 'lfo', x: 30, y: 220, knobs: { rate: 0.3, depth: 40 }, wave: 'sine' },
        { type: 'flt', x: 210, y: 40, knobs: { cutoff: 800, resonance: 4 }, filterType: 'lowpass' },
        { type: 'dly', x: 390, y: 40, knobs: { time: 500, feedback: 60, mix: 50 } },
        { type: 'out', x: 570, y: 60, knobs: { volume: 55 } }
      ],
      cables: [[0, 'out', 2, 'in'], [1, 'out', 2, 'mod'], [2, 'out', 3, 'in'], [3, 'out', 4, 'in']]
    }
  };

  function loadPreset(name) {
    const preset = PRESETS[name];
    if (!preset) return;

    clearPatch();

    const mods = [];
    preset.modules.forEach(def => {
      const mod = addModule(def.type, def.x, def.y);
      if (mod) {
        if (def.knobs) Object.assign(mod.knobValues, def.knobs);
        if (def.wave) mod.wave = def.wave;
        if (def.filterType) mod.filterType = def.filterType;
        // Update DOM for wave/filter buttons
        const el = document.getElementById(`pw-mod-${mod.id}`);
        if (el) {
          const waveBtn = el.querySelector('.pw-wave-btn');
          if (waveBtn && def.wave) waveBtn.textContent = WAVE_LABELS[def.wave] || def.wave;
          const typeBtn = el.querySelector('.pw-type-btn');
          if (typeBtn && def.filterType) typeBtn.textContent = FILTER_LABELS[def.filterType] || def.filterType;
        }
      }
      mods.push(mod);
    });

    preset.cables.forEach(([fromIdx, fromJack, toIdx, toJack]) => {
      if (mods[fromIdx] && mods[toIdx]) {
        connectJacks(mods[fromIdx].id, fromJack, mods[toIdx].id, toJack);
      }
    });

    drawAllKnobs();

    // If patchwerk is open, start audio
    if (isOpen) {
      startAllModules();
      updateAllCables();
    }
  }

  // --- Resize ---
  function resize() {
    updateAllCables();
    drawAllKnobs();
  }

  // --- Public API ---
  return { init, resize, start: onOpen, stop: onClose };
})();

document.addEventListener('DOMContentLoaded', () => Patchwerk.init());
