// spectral.js — Spectral freezer / vocoder instrument
// Capture sound. Freeze its spectrum. Play it like a keyboard.
// Northern lights FFT visualization. Wavetable synthesis engine.
const Spectral = (() => {

  // --- Keyboard layout (2 octaves, C3–B4) ---
  const KEYS = [
    { note: 'C3',  midi: 48, black: false },
    { note: 'C#3', midi: 49, black: true },
    { note: 'D3',  midi: 50, black: false },
    { note: 'D#3', midi: 51, black: true },
    { note: 'E3',  midi: 52, black: false },
    { note: 'F3',  midi: 53, black: false },
    { note: 'F#3', midi: 54, black: true },
    { note: 'G3',  midi: 55, black: false },
    { note: 'G#3', midi: 56, black: true },
    { note: 'A3',  midi: 57, black: false },
    { note: 'A#3', midi: 58, black: true },
    { note: 'B3',  midi: 59, black: false },
    { note: 'C4',  midi: 60, black: false },
    { note: 'C#4', midi: 61, black: true },
    { note: 'D4',  midi: 62, black: false },
    { note: 'D#4', midi: 63, black: true },
    { note: 'E4',  midi: 64, black: false },
    { note: 'F4',  midi: 65, black: false },
    { note: 'F#4', midi: 66, black: true },
    { note: 'G4',  midi: 67, black: false },
    { note: 'G#4', midi: 68, black: true },
    { note: 'A4',  midi: 69, black: false },
    { note: 'A#4', midi: 70, black: true },
    { note: 'B4',  midi: 71, black: false }
  ];

  // QWERTY keyboard mapping → MIDI note
  const QWERTY_MAP = {
    'a': 48, 'w': 49, 's': 50, 'e': 51, 'd': 52, 'f': 53,
    't': 54, 'g': 55, 'y': 56, 'h': 57, 'u': 58, 'j': 59,
    'k': 60, 'o': 61, 'l': 62, 'p': 63, ';': 64
  };

  // Skin palettes for canvas
  const SKINS = {
    aurora: {
      bg: '#040810',
      bar: (i, total) => {
        const t = i / total;
        const r = Math.floor(40 + t * 120);
        const g = Math.floor(216 - t * 80);
        const b = Math.floor(208 + t * 47);
        return [r, g, b];
      },
      glow: [64, 216, 208],
      frozen: [255, 64, 128],
      text: [96, 128, 144]
    },
    solar: {
      bg: '#0c0604',
      bar: (i, total) => {
        const t = i / total;
        const r = 255;
        const g = Math.floor(128 - t * 68);
        const b = Math.floor(64 - t * 4);
        return [r, g, b];
      },
      glow: [255, 128, 64],
      frozen: [255, 64, 64],
      text: [160, 128, 112]
    },
    void: {
      bg: '#060606',
      bar: (i, total) => {
        const v = Math.floor(180 + (i / total) * 40);
        return [v, v, v];
      },
      glow: [224, 224, 224],
      frozen: [255, 255, 255],
      text: [96, 96, 96]
    }
  };

  // --- State ---
  let audioCtx = null;
  let analyser = null;
  let masterGain = null;
  let reverbNode = null;
  let reverbGain = null;
  let dryGain = null;
  let compressor = null;
  let sourceNode = null;   // Current audio source (drone osc, mic, or file)
  let droneNodes = null;   // Drone oscillators
  let micStream = null;

  let canvas = null;
  let ctx = null;
  let animFrame = null;
  let initialized = false;
  let isOpen = false;
  let currentSkin = 'aurora';
  let currentSource = 'drone';

  let frozen = false;
  let frozenBuffer = null;  // AudioBuffer of captured wavetable
  let frozenSpectrum = null; // Uint8Array snapshot for visual
  let frozenFundamental = 261.63; // C4 — base pitch of frozen sample

  let attackMs = 20;
  let releaseMs = 400;
  let reverbMix = 0.5;

  let activeVoices = new Map(); // midi → { source, gain }
  let fftData = null;
  let keyElements = new Map(); // midi → DOM element

  let lastTime = 0;
  let frozenGlowPhase = 0;

  // --- Init ---
  function init() {
    if (initialized) return;
    initialized = true;

    const body = document.getElementById('spectral-body');
    if (!body) return;

    canvas = document.getElementById('sp-canvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');

    // Build keyboard
    buildKeyboard();

    // Wire toolbar
    const freezeBtn = document.getElementById('sp-freeze');
    if (freezeBtn) freezeBtn.addEventListener('click', toggleFreeze);

    const attackSlider = document.getElementById('sp-attack');
    if (attackSlider) attackSlider.addEventListener('input', () => { attackMs = parseInt(attackSlider.value); });

    const releaseSlider = document.getElementById('sp-release');
    if (releaseSlider) releaseSlider.addEventListener('input', () => { releaseMs = parseInt(releaseSlider.value); });

    const reverbSlider = document.getElementById('sp-reverb');
    if (reverbSlider) reverbSlider.addEventListener('input', () => {
      reverbMix = parseInt(reverbSlider.value) / 100;
      updateReverbMix();
    });

    // Source buttons
    body.querySelectorAll('.sp-source-btn').forEach(btn => {
      btn.addEventListener('click', () => switchSource(btn.dataset.source));
    });

    // Skin buttons
    body.querySelectorAll('.sp-skin-btn').forEach(btn => {
      btn.addEventListener('click', () => switchSkin(btn.dataset.skin));
    });

    // File input
    const fileInput = document.getElementById('sp-file');
    if (fileInput) fileInput.addEventListener('change', onFileSelected);

    // QWERTY keyboard
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);

    // WindowManager hooks
    if (typeof WindowManager !== 'undefined') {
      WindowManager.on('open', ({ id }) => { if (id === 'spectral') onWindowOpen(); });
      WindowManager.on('close', ({ id }) => { if (id === 'spectral') onWindowClose(); });
    }

    resize();
  }

  // --- Audio setup ---
  function ensureAudio() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();

      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.8;
      fftData = new Uint8Array(analyser.frequencyBinCount);

      compressor = audioCtx.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.knee.value = 12;
      compressor.ratio.value = 4;
      compressor.connect(audioCtx.destination);

      masterGain = audioCtx.createGain();
      masterGain.gain.value = 0.7;

      dryGain = audioCtx.createGain();
      dryGain.gain.value = 1 - reverbMix;
      masterGain.connect(dryGain);
      dryGain.connect(compressor);

      reverbGain = audioCtx.createGain();
      reverbGain.gain.value = reverbMix;
      masterGain.connect(reverbGain);
      buildReverb();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function buildReverb() {
    const ac = ensureAudio();
    const sampleRate = ac.sampleRate;
    const length = sampleRate * 3.5;
    const buffer = ac.createBuffer(2, length, sampleRate);

    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        const t = i / sampleRate;
        data[i] = (Math.random() * 2 - 1) * Math.exp(-t * 1.8);
      }
    }

    reverbNode = ac.createConvolver();
    reverbNode.buffer = buffer;
    reverbGain.connect(reverbNode);
    reverbNode.connect(compressor);
  }

  function updateReverbMix() {
    if (dryGain) dryGain.gain.value = 1 - reverbMix;
    if (reverbGain) reverbGain.gain.value = reverbMix;
  }

  // --- Sources ---
  function switchSource(source) {
    if (!isOpen) return;
    stopCurrentSource();
    currentSource = source;

    const body = document.getElementById('spectral-body');
    body.querySelectorAll('.sp-source-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.source === source);
    });

    // Unfreeze when switching source
    if (frozen) toggleFreeze();

    if (source === 'drone') startDrone();
    else if (source === 'mic') startMic();
    else if (source === 'file') {
      document.getElementById('sp-file')?.click();
    }
  }

  function stopCurrentSource() {
    if (droneNodes) {
      droneNodes.forEach(n => { try { n.stop(); } catch(e) {} });
      droneNodes = null;
    }
    if (sourceNode) {
      try { sourceNode.disconnect(); } catch(e) {}
      sourceNode = null;
    }
    if (micStream) {
      micStream.getTracks().forEach(t => t.stop());
      micStream = null;
    }
  }

  function startDrone() {
    const ac = ensureAudio();

    // Rich drone: 3 detuned saws + sub sine
    const droneGain = ac.createGain();
    droneGain.gain.value = 0.15;
    droneGain.connect(analyser);

    const nodes = [];
    const baseFreq = 130.81; // C3

    // Main saws
    [0, 5, -3].forEach(detune => {
      const osc = ac.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = baseFreq;
      osc.detune.value = detune;
      osc.connect(droneGain);
      osc.start();
      nodes.push(osc);
    });

    // Sub sine
    const sub = ac.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = baseFreq / 2;
    const subGain = ac.createGain();
    subGain.gain.value = 0.3;
    sub.connect(subGain);
    subGain.connect(droneGain);
    sub.start();
    nodes.push(sub);

    // Slow filter sweep for movement
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 800;
    filter.Q.value = 2;
    droneGain.disconnect();
    droneGain.connect(filter);
    filter.connect(analyser);

    // LFO on filter
    const lfo = ac.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.15;
    const lfoGain = ac.createGain();
    lfoGain.gain.value = 600;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start();
    nodes.push(lfo);

    droneNodes = nodes;
    sourceNode = droneGain;
  }

  async function startMic() {
    try {
      const ac = ensureAudio();
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const micSource = ac.createMediaStreamSource(micStream);
      micSource.connect(analyser);
      sourceNode = micSource;
    } catch (e) {
      // Fall back to drone if mic denied
      switchSource('drone');
    }
  }

  function onFileSelected(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    const ac = ensureAudio();
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const audioBuffer = await ac.decodeAudioData(reader.result);
        const bufSource = ac.createBufferSource();
        bufSource.buffer = audioBuffer;
        bufSource.loop = true;
        bufSource.connect(analyser);
        bufSource.start();
        sourceNode = bufSource;
      } catch (err) {
        switchSource('drone');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  // --- Freeze ---
  function toggleFreeze() {
    const ac = ensureAudio();
    const freezeBtn = document.getElementById('sp-freeze');
    const indicator = document.getElementById('sp-freeze-indicator');

    if (!frozen) {
      // Capture wavetable from analyser
      // Get time-domain data for wavetable
      const bufferLength = analyser.fftSize;
      const timeData = new Float32Array(bufferLength);
      analyser.getFloatTimeDomainData(timeData);

      // Create an AudioBuffer from captured waveform
      frozenBuffer = ac.createBuffer(1, bufferLength, ac.sampleRate);
      frozenBuffer.getChannelData(0).set(timeData);

      // Capture spectrum for visualization
      frozenSpectrum = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(frozenSpectrum);

      // Detect fundamental frequency for pitch tracking
      frozenFundamental = detectFundamental(timeData, ac.sampleRate) || 261.63;

      frozen = true;
      if (freezeBtn) freezeBtn.classList.add('frozen');
      if (indicator) {
        indicator.textContent = 'FROZEN';
        indicator.classList.add('frozen');
      }
    } else {
      frozen = false;
      frozenBuffer = null;
      frozenSpectrum = null;

      // Release all playing voices
      activeVoices.forEach((voice, midi) => releaseVoice(midi));

      if (freezeBtn) freezeBtn.classList.remove('frozen');
      if (indicator) {
        indicator.textContent = 'LIVE';
        indicator.classList.remove('frozen');
      }
    }
  }

  function detectFundamental(timeData, sampleRate) {
    // Autocorrelation-based pitch detection
    const n = timeData.length;
    const maxLag = Math.floor(sampleRate / 60);  // Min 60Hz
    const minLag = Math.floor(sampleRate / 1000); // Max 1000Hz

    let bestCorr = 0;
    let bestLag = 0;

    for (let lag = minLag; lag < maxLag && lag < n / 2; lag++) {
      let corr = 0;
      for (let i = 0; i < n - lag; i++) {
        corr += timeData[i] * timeData[i + lag];
      }
      if (corr > bestCorr) {
        bestCorr = corr;
        bestLag = lag;
      }
    }

    if (bestLag > 0) return sampleRate / bestLag;
    return null;
  }

  // --- Voice playback ---
  function playVoice(midi) {
    if (!frozen || !frozenBuffer) return;

    const ac = ensureAudio();

    // Kill existing voice on this key
    if (activeVoices.has(midi)) releaseVoice(midi);

    // Playback rate = desired freq / frozen fundamental freq
    const targetFreq = 440 * Math.pow(2, (midi - 69) / 12);
    const rate = targetFreq / frozenFundamental;

    const source = ac.createBufferSource();
    source.buffer = frozenBuffer;
    source.loop = true;
    source.playbackRate.value = rate;

    const gain = ac.createGain();
    gain.gain.setValueAtTime(0, ac.currentTime);
    gain.gain.linearRampToValueAtTime(0.3, ac.currentTime + attackMs / 1000);

    source.connect(gain);
    gain.connect(masterGain);
    source.start();

    activeVoices.set(midi, { source, gain });

    // Visual
    const el = keyElements.get(midi);
    if (el) el.classList.add('active');
  }

  function releaseVoice(midi) {
    const voice = activeVoices.get(midi);
    if (!voice) return;

    const ac = ensureAudio();
    const now = ac.currentTime;
    const releaseSec = releaseMs / 1000;

    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
    voice.gain.gain.linearRampToValueAtTime(0, now + releaseSec);

    const src = voice.source;
    setTimeout(() => {
      try { src.stop(); } catch(e) {}
    }, releaseMs + 50);

    activeVoices.delete(midi);

    // Visual
    const el = keyElements.get(midi);
    if (el) el.classList.remove('active');
  }

  // --- Keyboard ---
  function buildKeyboard() {
    const container = document.getElementById('sp-keyboard');
    if (!container) return;

    KEYS.forEach(key => {
      const el = document.createElement('div');
      el.className = `sp-key ${key.black ? 'sp-key-black' : 'sp-key-white'}`;
      el.dataset.midi = key.midi;

      const label = document.createElement('span');
      label.className = 'sp-key-label';
      label.textContent = key.note.replace('#', '#');
      el.appendChild(label);

      // Pointer events for mouse/touch
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        playVoice(key.midi);
      });
      el.addEventListener('pointerup', () => releaseVoice(key.midi));
      el.addEventListener('pointerleave', () => {
        if (activeVoices.has(key.midi)) releaseVoice(key.midi);
      });

      container.appendChild(el);
      keyElements.set(key.midi, el);
    });
  }

  // QWERTY input
  const heldKeys = new Set();

  function onKeyDown(e) {
    if (!isOpen || !frozen) return;
    if (e.repeat) return;

    const midi = QWERTY_MAP[e.key.toLowerCase()];
    if (midi !== undefined && !heldKeys.has(e.key.toLowerCase())) {
      heldKeys.add(e.key.toLowerCase());
      playVoice(midi);
    }
  }

  function onKeyUp(e) {
    if (!isOpen) return;

    const key = e.key.toLowerCase();
    const midi = QWERTY_MAP[key];
    if (midi !== undefined && heldKeys.has(key)) {
      heldKeys.delete(key);
      releaseVoice(midi);
    }
  }

  // --- Rendering ---
  function render(time) {
    if (!isOpen || !ctx || !canvas) return;

    const dt = lastTime ? (time - lastTime) / 1000 : 0.016;
    lastTime = time;
    frozenGlowPhase += dt;

    const w = canvas.width;
    const h = canvas.height;
    const skin = SKINS[currentSkin];

    // Clear
    ctx.fillStyle = skin.bg;
    ctx.fillRect(0, 0, w, h);

    // Get FFT data
    let spectrum;
    if (frozen && frozenSpectrum) {
      spectrum = frozenSpectrum;
    } else if (analyser) {
      analyser.getByteFrequencyData(fftData);
      spectrum = fftData;
    } else {
      animFrame = requestAnimationFrame(render);
      return;
    }

    const barCount = Math.min(spectrum.length, 128);
    const binStep = Math.floor(spectrum.length / barCount);
    const barWidth = w / barCount;
    const padding = 1;

    // Draw bars
    for (let i = 0; i < barCount; i++) {
      // Average nearby bins for smoother look
      let sum = 0;
      const binStart = i * binStep;
      for (let b = 0; b < binStep; b++) {
        sum += spectrum[binStart + b] || 0;
      }
      const value = sum / binStep / 255;
      const barH = value * h * 0.85;

      if (barH < 1) continue;

      const [r, g, b] = skin.bar(i, barCount);

      // Frozen shimmer
      let alpha = 0.8;
      if (frozen) {
        const shimmer = 0.6 + 0.4 * Math.sin(frozenGlowPhase * 1.5 + i * 0.1);
        alpha = shimmer * 0.9;
      }

      // Glow behind bar
      const glowAlpha = value * 0.15 * alpha;
      ctx.fillStyle = `rgba(${r},${g},${b},${glowAlpha})`;
      ctx.fillRect(i * barWidth - 2, h - barH - 4, barWidth + 4, barH + 8);

      // Main bar
      ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
      ctx.fillRect(i * barWidth + padding, h - barH, barWidth - padding * 2, barH);

      // Bright cap
      if (barH > 4) {
        ctx.fillStyle = `rgba(${r},${g},${b},${alpha * 1.2})`;
        ctx.fillRect(i * barWidth + padding, h - barH, barWidth - padding * 2, 2);
      }
    }

    // Active voice indicators — highlight corresponding frequency regions
    if (frozen && activeVoices.size > 0) {
      const [gr, gg, gb] = skin.glow;
      activeVoices.forEach((voice, midi) => {
        const freq = 440 * Math.pow(2, (midi - 69) / 12);
        const binIndex = Math.round(freq / (audioCtx.sampleRate / analyser.fftSize));
        const barIndex = Math.floor(binIndex / binStep);

        if (barIndex >= 0 && barIndex < barCount) {
          // Glow pulse around played frequency
          const pulse = 0.5 + 0.5 * Math.sin(frozenGlowPhase * 4);
          const glowWidth = barWidth * 6;
          const cx = barIndex * barWidth + barWidth / 2;

          const grad = ctx.createRadialGradient(cx, h * 0.5, 0, cx, h * 0.5, glowWidth);
          grad.addColorStop(0, `rgba(${gr},${gg},${gb},${0.15 * pulse})`);
          grad.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = grad;
          ctx.fillRect(cx - glowWidth, 0, glowWidth * 2, h);
        }
      });
    }

    // Frozen indicator line
    if (frozen) {
      const [fr, fg, fb] = skin.frozen;
      const lineAlpha = 0.3 + 0.15 * Math.sin(frozenGlowPhase * 2);
      ctx.strokeStyle = `rgba(${fr},${fg},${fb},${lineAlpha})`;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 8]);
      ctx.beginPath();
      ctx.moveTo(0, 12);
      ctx.lineTo(w, 12);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    animFrame = requestAnimationFrame(render);
  }

  // --- Skin ---
  function switchSkin(skin) {
    if (!SKINS[skin]) return;
    currentSkin = skin;

    const body = document.getElementById('spectral-body');
    if (body) body.className = `skin-${skin}`;

    body.querySelectorAll('.sp-skin-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.skin === skin);
    });
  }

  // --- Window lifecycle ---
  function onWindowOpen() {
    isOpen = true;
    ensureAudio();
    resize();
    lastTime = 0;

    // Start default source
    if (currentSource === 'drone') startDrone();

    // Clear canvas
    if (ctx && canvas) {
      ctx.fillStyle = SKINS[currentSkin].bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    animFrame = requestAnimationFrame(render);
  }

  function onWindowClose() {
    isOpen = false;
    if (animFrame) {
      cancelAnimationFrame(animFrame);
      animFrame = null;
    }

    // Release all voices
    activeVoices.forEach((voice, midi) => releaseVoice(midi));
    heldKeys.clear();

    stopCurrentSource();
  }

  // --- Resize ---
  function resize() {
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
  }

  return { init, resize, start: onWindowOpen, stop: onWindowClose };
})();

document.addEventListener('DOMContentLoaded', () => Spectral.init());
