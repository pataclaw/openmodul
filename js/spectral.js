// spectral.js — Spectral freezer / vocoder instrument
// Capture sound. Freeze its spectrum. Play it like a keyboard.
// Breakbeat punk aesthetic. 3D plastic extruded blocks. Wild shapes.
const Spectral = (() => {

  // --- Keyboard layout (2 octaves, C3-B4) ---
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

  const QWERTY_MAP = {
    'a': 48, 'w': 49, 's': 50, 'e': 51, 'd': 52, 'f': 53,
    't': 54, 'g': 55, 'y': 56, 'h': 57, 'u': 58, 'j': 59,
    'k': 60, 'o': 61, 'l': 62, 'p': 63, ';': 64
  };

  // Breakbeat punk palettes — neon, aggressive, plastic
  const SKINS = {
    acid: {
      bg: '#0a0a0a',
      bar: (i, total) => {
        const t = i / total;
        const r = Math.floor(255 - t * 120);
        const g = Math.floor(32 + t * 224);
        const b = Math.floor(128 - t * 80);
        return [r, g, b];
      },
      barTop: (i, total) => {
        const t = i / total;
        return [255, Math.floor(80 + t * 175), Math.floor(180 - t * 60)];
      },
      barSide: (i, total) => {
        const t = i / total;
        return [Math.floor(140 - t * 60), Math.floor(20 + t * 100), Math.floor(80 - t * 40)];
      },
      glow: [255, 32, 128],
      frozen: [64, 255, 128],
      text: [128, 80, 100],
      glitch: [255, 32, 128],
      depth: 8
    },
    chrome: {
      bg: '#080808',
      bar: (i, total) => {
        const t = i / total;
        const r = Math.floor(64 + t * 60);
        const g = Math.floor(128 + t * 40);
        const b = Math.floor(255 - t * 40);
        return [r, g, b];
      },
      barTop: (i, total) => {
        const t = i / total;
        return [Math.floor(120 + t * 80), Math.floor(180 + t * 50), 255];
      },
      barSide: (i, total) => {
        const t = i / total;
        return [Math.floor(30 + t * 30), Math.floor(60 + t * 20), Math.floor(140 - t * 20)];
      },
      glow: [64, 128, 255],
      frozen: [200, 220, 255],
      text: [80, 100, 130],
      glitch: [64, 128, 255],
      depth: 7
    },
    noise: {
      bg: '#0a0808',
      bar: (i, total) => {
        const t = i / total;
        const r = Math.floor(255 - t * 40);
        const g = Math.floor(64 - t * 40);
        const b = Math.floor(64 - t * 40);
        return [r, g, b];
      },
      barTop: (i, total) => {
        return [255, 200, 200];
      },
      barSide: (i, total) => {
        const t = i / total;
        return [Math.floor(120 - t * 30), Math.floor(20), Math.floor(20)];
      },
      glow: [255, 64, 64],
      frozen: [255, 255, 255],
      text: [120, 80, 80],
      glitch: [255, 40, 40],
      depth: 9
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
  let sourceNode = null;
  let droneNodes = null;
  let micStream = null;

  let canvas = null;
  let ctx = null;
  let animFrame = null;
  let initialized = false;
  let isOpen = false;
  let currentSkin = 'acid';
  let currentSource = 'drone';

  let frozen = false;
  let frozenBuffer = null;
  let frozenSpectrum = null;
  let frozenFundamental = 261.63;

  let attackMs = 20;
  let releaseMs = 400;
  let reverbMix = 0.5;

  let activeVoices = new Map();
  let fftData = null;
  let keyElements = new Map();

  let lastTime = 0;
  let frozenGlowPhase = 0;
  let frameCount = 0;

  // Bounce state for bars
  let barBounce = new Float32Array(128);
  let barVelocity = new Float32Array(128);

  // Glitch lines
  let glitchLines = [];

  // --- Init ---
  function init() {
    if (initialized) return;
    initialized = true;

    const body = document.getElementById('spectral-body');
    if (!body) return;

    canvas = document.getElementById('sp-canvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');

    buildKeyboard();

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

    body.querySelectorAll('.sp-source-btn').forEach(btn => {
      btn.addEventListener('click', () => switchSource(btn.dataset.source));
    });

    body.querySelectorAll('.sp-skin-btn').forEach(btn => {
      btn.addEventListener('click', () => switchSkin(btn.dataset.skin));
    });

    const fileInput = document.getElementById('sp-file');
    if (fileInput) fileInput.addEventListener('change', onFileSelected);

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);

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

    const droneGain = ac.createGain();
    droneGain.gain.value = 0.15;
    droneGain.connect(analyser);

    const nodes = [];
    const baseFreq = 130.81;

    [0, 5, -3].forEach(detune => {
      const osc = ac.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = baseFreq;
      osc.detune.value = detune;
      osc.connect(droneGain);
      osc.start();
      nodes.push(osc);
    });

    const sub = ac.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = baseFreq / 2;
    const subGain = ac.createGain();
    subGain.gain.value = 0.3;
    sub.connect(subGain);
    subGain.connect(droneGain);
    sub.start();
    nodes.push(sub);

    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 800;
    filter.Q.value = 2;
    droneGain.disconnect();
    droneGain.connect(filter);
    filter.connect(analyser);

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
      const bufferLength = analyser.fftSize;
      const timeData = new Float32Array(bufferLength);
      analyser.getFloatTimeDomainData(timeData);

      frozenBuffer = ac.createBuffer(1, bufferLength, ac.sampleRate);
      frozenBuffer.getChannelData(0).set(timeData);

      frozenSpectrum = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(frozenSpectrum);

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

      activeVoices.forEach((voice, midi) => releaseVoice(midi));

      if (freezeBtn) freezeBtn.classList.remove('frozen');
      if (indicator) {
        indicator.textContent = 'LIVE';
        indicator.classList.remove('frozen');
      }
    }
  }

  function detectFundamental(timeData, sampleRate) {
    const n = timeData.length;
    const maxLag = Math.floor(sampleRate / 60);
    const minLag = Math.floor(sampleRate / 1000);

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

    if (activeVoices.has(midi)) releaseVoice(midi);

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
      label.textContent = key.note;
      el.appendChild(label);

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

  // --- Rendering (breakbeat punk 3D blocks) ---
  function render(time) {
    if (!isOpen || !ctx || !canvas) return;

    const dt = lastTime ? (time - lastTime) / 1000 : 0.016;
    lastTime = time;
    frozenGlowPhase += dt;
    frameCount++;

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

    const barCount = Math.min(spectrum.length, 96);
    const binStep = Math.floor(spectrum.length / barCount);
    const totalBarW = w * 0.92;
    const barW = totalBarW / barCount;
    const barMargin = (w - totalBarW) / 2;
    const depth = skin.depth;
    const dxOff = depth * 0.7;  // 3D x-offset
    const dyOff = -depth * 0.6; // 3D y-offset

    // Update bar bounce physics
    for (let i = 0; i < barCount; i++) {
      let sum = 0;
      const binStart = i * binStep;
      for (let b = 0; b < binStep; b++) {
        sum += spectrum[binStart + b] || 0;
      }
      const target = (sum / binStep / 255) * h * 0.78;

      // Spring to target
      const springK = 28;
      const dampK = 8;
      const force = (target - barBounce[i]) * springK - barVelocity[i] * dampK;
      barVelocity[i] += force * dt;
      barBounce[i] += barVelocity[i] * dt;
      if (barBounce[i] < 0) { barBounce[i] = 0; barVelocity[i] = 0; }
    }

    // Spawn glitch lines on energy peaks
    if (frameCount % 3 === 0) {
      let energy = 0;
      for (let i = 0; i < 16; i++) energy += spectrum[i] || 0;
      energy /= (16 * 255);
      if (energy > 0.4 && Math.random() < energy * 0.5) {
        const [gr, gg, gb] = skin.glitch;
        glitchLines.push({
          y: Math.random() * h,
          w: 20 + Math.random() * (w * 0.4),
          x: Math.random() * w,
          life: 3 + Math.floor(Math.random() * 4),
          color: `rgba(${gr},${gg},${gb},${0.12 + Math.random() * 0.1})`
        });
      }
    }

    // Draw glitch lines (behind bars)
    for (let gi = glitchLines.length - 1; gi >= 0; gi--) {
      const gl = glitchLines[gi];
      ctx.fillStyle = gl.color;
      ctx.fillRect(gl.x, gl.y, gl.w, 1 + Math.random());
      gl.life--;
      if (gl.life <= 0) glitchLines.splice(gi, 1);
    }
    if (glitchLines.length > 40) glitchLines.splice(0, glitchLines.length - 40);

    // === Draw 3D extruded bars ===
    for (let i = 0; i < barCount; i++) {
      const barH = barBounce[i];
      if (barH < 1) continue;

      const bx = barMargin + i * barW;
      const by = h - barH;
      const bw = barW - 1;

      // Frozen shimmer
      let alpha = 0.85;
      if (frozen) {
        const shimmer = 0.5 + 0.5 * Math.sin(frozenGlowPhase * 2 + i * 0.15);
        alpha = shimmer * 0.9;
      }

      const [fr, fg, fb] = skin.bar(i, barCount);
      const [tr, tg, tb] = skin.barTop(i, barCount);
      const [sr, sg, sb] = skin.barSide(i, barCount);

      // Back glow (subtle bloom)
      ctx.fillStyle = `rgba(${fr},${fg},${fb},${alpha * 0.08})`;
      ctx.fillRect(bx - 3, by - 3, bw + 6 + dxOff, barH + 6);

      // RIGHT SIDE FACE (darker — depth)
      ctx.fillStyle = `rgba(${sr},${sg},${sb},${alpha * 0.9})`;
      ctx.beginPath();
      ctx.moveTo(bx + bw, by);
      ctx.lineTo(bx + bw + dxOff, by + dyOff);
      ctx.lineTo(bx + bw + dxOff, h + dyOff);
      ctx.lineTo(bx + bw, h);
      ctx.closePath();
      ctx.fill();

      // TOP FACE (brighter — plastic sheen)
      ctx.fillStyle = `rgba(${tr},${tg},${tb},${alpha * 0.7})`;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + dxOff, by + dyOff);
      ctx.lineTo(bx + bw + dxOff, by + dyOff);
      ctx.lineTo(bx + bw, by);
      ctx.closePath();
      ctx.fill();

      // FRONT FACE (main color)
      ctx.fillStyle = `rgba(${fr},${fg},${fb},${alpha})`;
      ctx.fillRect(bx, by, bw, barH);

      // Plastic highlight stripe (glossy band near top of front face)
      if (barH > 8) {
        const hlH = Math.min(barH * 0.15, 6);
        ctx.fillStyle = `rgba(255,255,255,${alpha * 0.12})`;
        ctx.fillRect(bx + 1, by + 2, bw - 2, hlH);
      }

      // Bright cap line (top edge)
      ctx.fillStyle = `rgba(${tr},${tg},${tb},${alpha})`;
      ctx.fillRect(bx, by, bw, 1);
    }

    // Active voice indicators
    if (frozen && activeVoices.size > 0) {
      const [gr, gg, gb] = skin.glow;
      activeVoices.forEach((voice, midi) => {
        const freq = 440 * Math.pow(2, (midi - 69) / 12);
        const binIndex = Math.round(freq / (audioCtx.sampleRate / analyser.fftSize));
        const barIndex = Math.floor(binIndex / binStep);

        if (barIndex >= 0 && barIndex < barCount) {
          const pulse = 0.5 + 0.5 * Math.sin(frozenGlowPhase * 4);
          const glowWidth = barW * 8;
          const cx = barMargin + barIndex * barW + barW / 2;

          const grad = ctx.createRadialGradient(cx, h * 0.5, 0, cx, h * 0.5, glowWidth);
          grad.addColorStop(0, `rgba(${gr},${gg},${gb},${0.12 * pulse})`);
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

    // Scanline overlay (subtle punk grain)
    ctx.fillStyle = 'rgba(0,0,0,0.04)';
    for (let y = 0; y < h; y += 2) {
      ctx.fillRect(0, y, w, 1);
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

    if (currentSource === 'drone') startDrone();

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
