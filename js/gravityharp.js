// gravityharp.js — Gravity-driven string instrument
// Dark void. Luminous strings. Falling particles. Reverb cave.
const GravityHarp = (() => {

  // --- Tuning presets (semitone offsets from C3) ---
  const TUNINGS = {
    pentatonic: [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24],
    chromatic:  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    whole:      [0, 2, 4, 6, 8, 10, 12],
    minor:      [0, 2, 3, 5, 7, 8, 10, 12, 14, 15, 17, 19],
    major:      [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19]
  };

  const BASE_FREQ = 130.81; // C3

  // --- State ---
  let audioCtx = null;
  let masterGain = null;
  let reverbNode = null;
  let reverbGain = null;
  let dryGain = null;
  let compressor = null;

  let canvas = null;
  let ctx = null;
  let strings = [];
  let particles = [];
  let sparks = [];
  let gravityX = 0;
  let gravityY = 1;
  let animFrame = null;
  let initialized = false;
  let isOpen = false;
  let currentSkin = 'void';
  let currentTuning = 'pentatonic';
  let massLevel = 2;
  let reverbMix = 0.6;
  let gravityStrength = 80;
  let lastTime = 0;
  let starField = [];

  // Skin color palettes (used in canvas rendering)
  const SKINS = {
    void: {
      bg: '#06040a',
      string: [176, 96, 255],
      stringGlow: 'rgba(176, 96, 255, 0.15)',
      particle: [224, 192, 255],
      spark: [200, 160, 255],
      star: [140, 100, 200]
    },
    aurora: {
      bg: '#040810',
      string: [64, 216, 160],
      stringGlow: 'rgba(64, 216, 160, 0.15)',
      particle: [160, 255, 224],
      spark: [100, 230, 180],
      star: [60, 140, 120]
    },
    ember: {
      bg: '#0a0604',
      string: [255, 104, 64],
      stringGlow: 'rgba(255, 104, 64, 0.15)',
      particle: [255, 192, 160],
      spark: [255, 140, 100],
      star: [160, 80, 50]
    }
  };

  // --- Init ---
  function init() {
    if (initialized) return;
    initialized = true;

    const body = document.getElementById('gravityharp-body');
    if (!body) return;

    canvas = document.getElementById('gh-canvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');

    // Wire toolbar
    const tuningSelect = document.getElementById('gh-tuning');
    if (tuningSelect) {
      tuningSelect.addEventListener('change', () => {
        currentTuning = tuningSelect.value;
        buildStrings();
      });
    }

    const massSlider = document.getElementById('gh-mass');
    if (massSlider) {
      massSlider.addEventListener('input', () => {
        massLevel = parseInt(massSlider.value);
      });
    }

    const reverbSlider = document.getElementById('gh-reverb');
    if (reverbSlider) {
      reverbSlider.addEventListener('input', () => {
        reverbMix = parseInt(reverbSlider.value) / 100;
        updateReverbMix();
      });
    }

    const gravitySlider = document.getElementById('gh-gravity');
    if (gravitySlider) {
      gravitySlider.addEventListener('input', () => {
        gravityStrength = parseInt(gravitySlider.value);
      });
    }

    const clearBtn = document.getElementById('gh-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        particles = [];
        sparks = [];
      });
    }

    // Skin selector
    body.querySelectorAll('.gh-skin-btn').forEach(btn => {
      btn.addEventListener('click', () => switchSkin(btn.dataset.skin));
    });

    // Click/touch on stage to drop particle
    const stage = body.querySelector('.gh-stage');
    if (stage) {
      stage.addEventListener('pointerdown', onStageClick);
    }

    // Mouse gravity tilt (desktop)
    if (stage) {
      stage.addEventListener('pointermove', onPointerMove);
    }

    // Gyroscope gravity tilt (mobile)
    if (window.DeviceOrientationEvent) {
      window.addEventListener('deviceorientation', onDeviceOrientation);
    }

    // WindowManager hooks
    if (typeof WindowManager !== 'undefined') {
      WindowManager.on('open', ({ id }) => { if (id === 'gravityharp') onWindowOpen(); });
      WindowManager.on('close', ({ id }) => { if (id === 'gravityharp') onWindowClose(); });
    }

    buildStrings();
    generateStarField();
    resize();
  }

  // --- Audio ---
  function ensureAudio() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();

      compressor = audioCtx.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.knee.value = 12;
      compressor.ratio.value = 4;
      compressor.connect(audioCtx.destination);

      masterGain = audioCtx.createGain();
      masterGain.gain.value = 0.7;

      // Dry path
      dryGain = audioCtx.createGain();
      dryGain.gain.value = 1 - reverbMix;
      masterGain.connect(dryGain);
      dryGain.connect(compressor);

      // Reverb path
      reverbGain = audioCtx.createGain();
      reverbGain.gain.value = reverbMix;
      buildReverb();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  }

  function buildReverb() {
    // Algorithmic reverb via convolver with generated impulse
    const ctx = ensureAudio();
    const sampleRate = ctx.sampleRate;
    const length = sampleRate * 3; // 3 second tail
    const buffer = ctx.createBuffer(2, length, sampleRate);

    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        // Exponential decay with diffusion
        const t = i / sampleRate;
        const decay = Math.exp(-t * 2.2);
        data[i] = (Math.random() * 2 - 1) * decay;
      }
    }

    reverbNode = ctx.createConvolver();
    reverbNode.buffer = buffer;

    masterGain.connect(reverbGain);
    reverbGain.connect(reverbNode);
    reverbNode.connect(compressor);
  }

  function updateReverbMix() {
    if (dryGain) dryGain.gain.value = 1 - reverbMix;
    if (reverbGain) reverbGain.gain.value = reverbMix;
  }

  function playStringSound(stringIndex, velocity) {
    const ctx = ensureAudio();
    const str = strings[stringIndex];
    if (!str) return;

    const freq = str.freq;
    const now = ctx.currentTime;

    // Karplus-Strong inspired pluck — filtered noise burst + oscillator
    const noteGain = ctx.createGain();
    const vel = Math.min(velocity, 1.5);
    noteGain.gain.setValueAtTime(0, now);
    noteGain.gain.linearRampToValueAtTime(vel * 0.18, now + 0.003);
    noteGain.gain.setTargetAtTime(0, now + 0.003, 0.3 + vel * 0.4);
    noteGain.connect(masterGain);

    // Main tone — triangle for warm pluck
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;

    // Slight detune for richness
    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = freq * 1.002;
    const osc2Gain = ctx.createGain();
    osc2Gain.gain.value = 0.3;
    osc2.connect(osc2Gain);
    osc2Gain.connect(noteGain);

    // Harmonic shimmer
    const osc3 = ctx.createOscillator();
    osc3.type = 'sine';
    osc3.frequency.value = freq * 2;
    const osc3Gain = ctx.createGain();
    osc3Gain.gain.value = 0.08;
    osc3Gain.connect(noteGain);
    osc3.connect(osc3Gain);
    osc3Gain.gain.setTargetAtTime(0, now + 0.01, 0.15);

    // Filter sweep — brighter attack, settles to warm
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(Math.min(freq * 8, 12000), now);
    filter.frequency.setTargetAtTime(freq * 2.5, now + 0.01, 0.2);
    filter.Q.value = 1.5;

    osc.connect(filter);
    filter.connect(noteGain);

    osc.start(now);
    osc2.start(now);
    osc3.start(now);

    const stopTime = now + 3;
    osc.stop(stopTime);
    osc2.stop(stopTime);
    osc3.stop(stopTime);
  }

  // --- Strings ---
  function buildStrings() {
    const offsets = TUNINGS[currentTuning] || TUNINGS.pentatonic;
    strings = offsets.map((semitone, i) => ({
      index: i,
      semitone,
      freq: BASE_FREQ * Math.pow(2, semitone / 12),
      displacement: 0,       // Current bend amount (pixels)
      velocity: 0,           // Bend velocity for spring-back
      lastPluckTime: 0
    }));
  }

  function getStringPositions() {
    if (!canvas || strings.length === 0) return [];
    const w = canvas.width;
    const h = canvas.height;
    const margin = w * 0.08;
    const usableW = w - margin * 2;
    const gap = usableW / (strings.length - 1 || 1);

    return strings.map((str, i) => {
      const x = margin + i * gap;
      return {
        x,
        y1: h * 0.05,
        y2: h * 0.95,
        str
      };
    });
  }

  // --- Star field ---
  function generateStarField() {
    starField = [];
    for (let i = 0; i < 80; i++) {
      starField.push({
        x: Math.random(),
        y: Math.random(),
        size: Math.random() * 1.5 + 0.3,
        brightness: Math.random() * 0.4 + 0.1,
        twinklePhase: Math.random() * Math.PI * 2,
        twinkleSpeed: Math.random() * 0.5 + 0.3
      });
    }
  }

  // --- Particles ---
  function spawnParticle(x, y) {
    const mass = massLevel;
    const radius = 3 + mass * 2;
    particles.push({
      x, y,
      vx: 0,
      vy: 0,
      mass,
      radius,
      life: 1,
      age: 0
    });
  }

  function spawnSparks(x, y, stringIndex) {
    const skin = SKINS[currentSkin];
    const count = 4 + Math.floor(Math.random() * 4);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 30 + Math.random() * 80;
      sparks.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        decay: 1.5 + Math.random() * 2,
        size: 1 + Math.random() * 2
      });
    }
  }

  // --- Physics ---
  function updatePhysics(dt) {
    if (dt > 0.1) dt = 0.1; // Cap delta for tab-away

    const gx = gravityX * gravityStrength * 3;
    const gy = gravityY * gravityStrength * 3;

    const stringPos = getStringPositions();

    // Update particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.age += dt;

      // Apply gravity
      p.vx += gx * dt;
      p.vy += gy * dt;

      // Air resistance (light damping)
      p.vx *= 0.998;
      p.vy *= 0.998;

      // Move
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      // Check string collisions
      for (let j = 0; j < stringPos.length; j++) {
        const sp = stringPos[j];
        const str = sp.str;
        const dx = p.x - sp.x;
        const hitDist = p.radius + 3;

        // Is particle within vertical range of string?
        if (p.y >= sp.y1 && p.y <= sp.y2 && Math.abs(dx) < hitDist) {
          // Velocity relative to string direction
          const relVx = p.vx;
          const impactSpeed = Math.abs(relVx);

          if (impactSpeed > 5) {
            // Pluck!
            const velocity = Math.min(impactSpeed / 150, 1.5);
            const now = performance.now();

            // Debounce — don't re-pluck same string within 60ms
            if (now - str.lastPluckTime > 60) {
              str.lastPluckTime = now;
              str.displacement += (dx > 0 ? -1 : 1) * Math.min(velocity * 12, 18);
              str.velocity += (dx > 0 ? -1 : 1) * velocity * 40;
              playStringSound(j, velocity);
              spawnSparks(sp.x, p.y, j);
            }

            // Bounce particle slightly
            p.vx *= -0.3;
            p.x = sp.x + (dx > 0 ? hitDist : -hitDist);
          }
        }
      }

      // Fade out particles that go off-screen (with margin)
      const margin = 100;
      if (p.x < -margin || p.x > canvas.width + margin ||
          p.y < -margin || p.y > canvas.height + margin) {
        p.life -= dt * 2;
      }

      // Age-based fade for very old particles
      if (p.age > 15) {
        p.life -= dt * 0.5;
      }

      if (p.life <= 0) {
        particles.splice(i, 1);
      }
    }

    // Update sparks
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vx *= 0.96;
      s.vy *= 0.96;
      s.vy += gy * dt * 0.3;
      s.life -= dt * s.decay;
      if (s.life <= 0) {
        sparks.splice(i, 1);
      }
    }

    // Update string vibrations (damped spring)
    for (const str of strings) {
      const spring = 800;
      const damping = 6;
      const accel = -spring * str.displacement - damping * str.velocity;
      str.velocity += accel * dt;
      str.displacement += str.velocity * dt;

      // Kill micro-vibrations
      if (Math.abs(str.displacement) < 0.01 && Math.abs(str.velocity) < 0.1) {
        str.displacement = 0;
        str.velocity = 0;
      }
    }
  }

  // --- Rendering ---
  function render(time) {
    if (!isOpen || !ctx || !canvas) return;

    const dt = lastTime ? (time - lastTime) / 1000 : 0.016;
    lastTime = time;

    updatePhysics(dt);

    const w = canvas.width;
    const h = canvas.height;
    const skin = SKINS[currentSkin];

    // Clear with slight trail
    ctx.fillStyle = skin.bg;
    ctx.globalAlpha = 0.3;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;

    // Stars
    const t = time * 0.001;
    for (const star of starField) {
      const twinkle = 0.5 + 0.5 * Math.sin(t * star.twinkleSpeed + star.twinklePhase);
      const alpha = star.brightness * twinkle;
      const [r, g, b] = skin.star;
      ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
      ctx.fillRect(star.x * w, star.y * h, star.size, star.size);
    }

    const stringPos = getStringPositions();

    // Draw strings
    for (let i = 0; i < stringPos.length; i++) {
      const sp = stringPos[i];
      const str = sp.str;
      const [r, g, b] = skin.string;
      const disp = str.displacement;
      const vibAmp = Math.abs(disp);

      // Glow behind string (wider when vibrating)
      if (vibAmp > 0.5) {
        const glowWidth = 6 + vibAmp * 1.5;
        const glowAlpha = Math.min(vibAmp / 15, 0.3);
        ctx.strokeStyle = `rgba(${r},${g},${b},${glowAlpha})`;
        ctx.lineWidth = glowWidth;
        ctx.beginPath();
        drawBentString(ctx, sp.x, sp.y1, sp.y2, disp);
        ctx.stroke();
      }

      // String line
      const baseAlpha = 0.4 + Math.min(vibAmp / 10, 0.4);
      ctx.strokeStyle = `rgba(${r},${g},${b},${baseAlpha})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      drawBentString(ctx, sp.x, sp.y1, sp.y2, disp);
      ctx.stroke();

      // Anchor dots
      ctx.fillStyle = `rgba(${r},${g},${b},0.6)`;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y1, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(sp.x, sp.y2, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw sparks
    for (const s of sparks) {
      const [r, g, b] = skin.spark;
      ctx.fillStyle = `rgba(${r},${g},${b},${s.life * 0.8})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size * s.life, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw particles
    for (const p of particles) {
      const [r, g, b] = skin.particle;
      const alpha = p.life * 0.9;

      // Glow
      const glowR = p.radius * 3;
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowR);
      grad.addColorStop(0, `rgba(${r},${g},${b},${alpha * 0.3})`);
      grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, glowR, 0, Math.PI * 2);
      ctx.fill();

      // Core
      ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();

      // Bright center
      ctx.fillStyle = `rgba(255,255,255,${alpha * 0.5})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius * 0.35, 0, Math.PI * 2);
      ctx.fill();
    }

    // Gravity indicator — subtle arrow in bottom-right
    drawGravityIndicator(w, h, t);

    animFrame = requestAnimationFrame(render);
  }

  function drawBentString(ctx, x, y1, y2, displacement) {
    // Quadratic bend through middle
    const midY = (y1 + y2) / 2;
    ctx.moveTo(x, y1);
    ctx.quadraticCurveTo(x + displacement, midY, x, y2);
  }

  function drawGravityIndicator(w, h, t) {
    const cx = w - 30;
    const cy = h - 30;
    const len = 12;
    const angle = Math.atan2(gravityY, gravityX);

    ctx.save();
    ctx.globalAlpha = 0.2;
    const skin = SKINS[currentSkin];
    const [r, g, b] = skin.string;

    // Circle
    ctx.strokeStyle = `rgba(${r},${g},${b},0.3)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, 16, 0, Math.PI * 2);
    ctx.stroke();

    // Arrow
    ctx.strokeStyle = `rgba(${r},${g},${b},0.6)`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angle) * len, cy + Math.sin(angle) * len);
    ctx.stroke();

    ctx.restore();
  }

  // --- Input ---
  function onStageClick(e) {
    if (!canvas) return;
    ensureAudio();

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    spawnParticle(x, y);
  }

  function onPointerMove(e) {
    if (!canvas || !isOpen) return;

    const rect = canvas.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    // Map mouse position to gravity direction
    // Center = straight down, edges = tilted
    const dx = (e.clientX - cx) / (rect.width / 2);
    const dy = (e.clientY - cy) / (rect.height / 2);

    // Gentle tilt — bias toward down
    const tiltStrength = 0.35;
    gravityX = dx * tiltStrength;
    gravityY = 0.7 + dy * 0.3;

    // Normalize
    const len = Math.sqrt(gravityX * gravityX + gravityY * gravityY);
    if (len > 0) {
      gravityX /= len;
      gravityY /= len;
    }
  }

  function onDeviceOrientation(e) {
    if (!isOpen) return;

    // gamma: left-right tilt (-90 to 90)
    // beta: front-back tilt (-180 to 180)
    const gamma = (e.gamma || 0) / 45;  // Normalize to -1..1 (at 45 degrees)
    const beta = (e.beta || 0) / 45;

    const tiltStrength = 0.5;
    gravityX = Math.max(-1, Math.min(1, gamma)) * tiltStrength;
    gravityY = 0.6 + Math.max(-0.4, Math.min(0.4, (beta - 1) * 0.3));

    const len = Math.sqrt(gravityX * gravityX + gravityY * gravityY);
    if (len > 0) {
      gravityX /= len;
      gravityY /= len;
    }
  }

  // --- Skin ---
  function switchSkin(skin) {
    if (!SKINS[skin]) return;
    currentSkin = skin;

    const body = document.getElementById('gravityharp-body');
    if (body) {
      body.className = `skin-${skin}`;
    }

    body.querySelectorAll('.gh-skin-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.skin === skin);
    });
  }

  // --- Window lifecycle ---
  function onWindowOpen() {
    isOpen = true;
    ensureAudio();
    resize();
    lastTime = 0;

    // Clear canvas fully on open (no trails from old session)
    if (ctx && canvas) {
      ctx.fillStyle = SKINS[currentSkin].bg;
      ctx.globalAlpha = 1;
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

document.addEventListener('DOMContentLoaded', () => GravityHarp.init());
