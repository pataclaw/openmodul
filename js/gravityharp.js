// gravityharp.js — Gravity Harp — cosmic gravity well instrument
// Concentric ring-strings around a gravity well. Drop particles,
// watch them spiral inward, plucking each ring they cross.
// Burst at the center. Hold to pour. Tilt to shift the well.
const GravityHarp = (() => {

  const TUNINGS = {
    pentatonic: [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24],
    chromatic:  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    whole:      [0, 2, 4, 6, 8, 10, 12],
    minor:      [0, 2, 3, 5, 7, 8, 10, 12, 14, 15, 17, 19],
    major:      [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19]
  };

  const BASE_FREQ = 130.81;
  const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

  // --- State ---
  let audioCtx = null;
  let masterGain = null;
  let reverbNode = null;
  let reverbGain = null;
  let dryGain = null;
  let compressor = null;

  let canvas = null;
  let ctx = null;
  let rings = [];
  let particles = [];
  let sparks = [];
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

  // Gravity center offset (shifted by mouse tilt)
  let gcOffX = 0;
  let gcOffY = 0;

  // Center burst glow
  let centerGlow = 0;

  // Hold-to-drop
  let isHolding = false;
  let holdX = 0;
  let holdY = 0;
  let holdTimer = null;

  // Cosmic skins
  const SKINS = {
    void: {
      bg: '#050508',
      ring: [170, 180, 200],
      ringGlow: [200, 210, 230],
      particle: [210, 220, 240],
      trail: [140, 150, 180],
      spark: [200, 210, 230],
      center: [180, 190, 210],
      star: [70, 80, 100],
      noteLabel: 'rgba(170, 180, 200, 0.25)'
    },
    nebula: {
      bg: '#080604',
      ring: [220, 175, 70],
      ringGlow: [240, 195, 90],
      particle: [255, 215, 130],
      trail: [200, 155, 50],
      spark: [255, 200, 90],
      center: [220, 175, 70],
      star: [100, 75, 35],
      noteLabel: 'rgba(220, 175, 70, 0.25)'
    },
    quasar: {
      bg: '#040508',
      ring: [70, 140, 240],
      ringGlow: [90, 160, 255],
      particle: [190, 100, 255],
      trail: [150, 70, 220],
      spark: [170, 110, 255],
      center: [110, 70, 255],
      star: [35, 50, 110],
      noteLabel: 'rgba(70, 140, 240, 0.25)'
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

    const tuningSelect = document.getElementById('gh-tuning');
    if (tuningSelect) tuningSelect.addEventListener('change', () => {
      currentTuning = tuningSelect.value;
      buildRings();
    });

    const massSlider = document.getElementById('gh-mass');
    if (massSlider) massSlider.addEventListener('input', () => { massLevel = parseInt(massSlider.value); });

    const reverbSlider = document.getElementById('gh-reverb');
    if (reverbSlider) reverbSlider.addEventListener('input', () => {
      reverbMix = parseInt(reverbSlider.value) / 100;
      updateReverbMix();
    });

    const gravitySlider = document.getElementById('gh-gravity');
    if (gravitySlider) gravitySlider.addEventListener('input', () => { gravityStrength = parseInt(gravitySlider.value); });

    const clearBtn = document.getElementById('gh-clear');
    if (clearBtn) clearBtn.addEventListener('click', () => { particles = []; sparks = []; });

    body.querySelectorAll('.gh-skin-btn').forEach(btn => {
      btn.addEventListener('click', () => switchSkin(btn.dataset.skin));
    });

    const stage = body.querySelector('.gh-stage');
    if (stage) {
      stage.addEventListener('pointerdown', onStageDown);
      stage.addEventListener('pointermove', onStageMove);
      stage.addEventListener('pointerup', onStageUp);
      stage.addEventListener('pointerleave', onStageUp);
    }

    if (window.DeviceOrientationEvent) {
      window.addEventListener('deviceorientation', onDeviceOrientation);
    }

    if (typeof WindowManager !== 'undefined') {
      WindowManager.on('open', ({ id }) => { if (id === 'gravityharp') onWindowOpen(); });
      WindowManager.on('close', ({ id }) => { if (id === 'gravityharp') onWindowClose(); });
    }

    buildRings();
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

      dryGain = audioCtx.createGain();
      dryGain.gain.value = 1 - reverbMix;
      masterGain.connect(dryGain);
      dryGain.connect(compressor);

      reverbGain = audioCtx.createGain();
      reverbGain.gain.value = reverbMix;
      buildReverb();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function buildReverb() {
    const ac = ensureAudio();
    const sampleRate = ac.sampleRate;
    const length = sampleRate * 3;
    const buffer = ac.createBuffer(2, length, sampleRate);

    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        const t = i / sampleRate;
        data[i] = (Math.random() * 2 - 1) * Math.exp(-t * 2.2);
      }
    }

    reverbNode = ac.createConvolver();
    reverbNode.buffer = buffer;
    masterGain.connect(reverbGain);
    reverbGain.connect(reverbNode);
    reverbNode.connect(compressor);
  }

  function updateReverbMix() {
    if (dryGain) dryGain.gain.value = 1 - reverbMix;
    if (reverbGain) reverbGain.gain.value = reverbMix;
  }

  function playStringSound(ringIndex, velocity) {
    const ac = ensureAudio();
    const ring = rings[ringIndex];
    if (!ring) return;

    const freq = ring.freq;
    const now = ac.currentTime;

    const noteGain = ac.createGain();
    const vel = Math.min(velocity, 1.5);
    noteGain.gain.setValueAtTime(0, now);
    noteGain.gain.linearRampToValueAtTime(vel * 0.18, now + 0.003);
    noteGain.gain.setTargetAtTime(0, now + 0.003, 0.3 + vel * 0.4);
    noteGain.connect(masterGain);

    const osc = ac.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;

    const osc2 = ac.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = freq * 1.002;
    const osc2Gain = ac.createGain();
    osc2Gain.gain.value = 0.3;
    osc2.connect(osc2Gain);
    osc2Gain.connect(noteGain);

    const osc3 = ac.createOscillator();
    osc3.type = 'sine';
    osc3.frequency.value = freq * 2;
    const osc3Gain = ac.createGain();
    osc3Gain.gain.value = 0.08;
    osc3.connect(osc3Gain);
    osc3Gain.connect(noteGain);
    osc3Gain.gain.setTargetAtTime(0, now + 0.01, 0.15);

    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(Math.min(freq * 8, 12000), now);
    filter.frequency.setTargetAtTime(freq * 2.5, now + 0.01, 0.2);
    filter.Q.value = 1.5;

    osc.connect(filter);
    filter.connect(noteGain);

    osc.start(now); osc2.start(now); osc3.start(now);
    const stopTime = now + 3;
    osc.stop(stopTime); osc2.stop(stopTime); osc3.stop(stopTime);
  }

  // --- Rings (concentric circle-strings) ---
  function buildRings() {
    const offsets = TUNINGS[currentTuning] || TUNINGS.pentatonic;
    const count = offsets.length;
    rings = offsets.map((semitone, i) => {
      // Outer = low pitch, inner = high pitch
      // Logarithmic spacing (tighter near center)
      const t = i / Math.max(count - 1, 1);
      const radiusFrac = 0.88 * Math.pow(0.12 / 0.88, t);
      return {
        index: i,
        semitone,
        freq: BASE_FREQ * Math.pow(2, semitone / 12),
        noteName: NOTE_NAMES[semitone % 12] + (3 + Math.floor(semitone / 12)),
        radiusFrac,
        displacement: 0,
        velocity: 0,
        lastPluckTime: 0,
        glowIntensity: 0
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
        size: Math.random() < 0.2 ? 1.5 : 0.8,
        brightness: Math.random() * 0.4 + 0.05,
        twinklePhase: Math.random() * Math.PI * 2,
        twinkleSpeed: Math.random() * 0.4 + 0.2
      });
    }
  }

  // --- Particles ---
  function spawnParticle(x, y) {
    const w = canvas.width, h = canvas.height;
    const cx = w / 2 + gcOffX;
    const cy = h / 2 + gcOffY;

    const dx = x - cx, dy = y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;

    // Radial direction (toward center)
    const rx = -dx / dist, ry = -dy / dist;
    // Tangential direction (perpendicular — creates the spiral)
    const tx = -ry, ty = rx;

    const mass = massLevel;
    const tangSpeed = 50 + mass * 12;
    const radSpeed = 10 + mass * 5;

    particles.push({
      x, y,
      vx: rx * radSpeed + tx * tangSpeed,
      vy: ry * radSpeed + ty * tangSpeed,
      mass,
      size: 2 + mass,
      life: 1,
      age: 0,
      trail: [],
      prevDist: dist
    });
  }

  function spawnSparks(x, y, count) {
    count = count || (4 + Math.floor(Math.random() * 5));
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 30 + Math.random() * 80;
      sparks.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        decay: 2 + Math.random() * 2.5,
        size: Math.random() < 0.3 ? 2 : 1
      });
    }
  }

  function spawnCenterBurst(x, y) {
    const count = 12 + Math.floor(Math.random() * 8);
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.3;
      const speed = 60 + Math.random() * 120;
      sparks.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        decay: 1.2 + Math.random() * 1.5,
        size: 1 + Math.random() * 1.5
      });
    }
  }

  // --- Physics ---
  function updatePhysics(dt) {
    if (dt > 0.1) dt = 0.1;

    const w = canvas.width, h = canvas.height;
    const cx = w / 2 + gcOffX;
    const cy = h / 2 + gcOffY;
    const halfSize = Math.min(w, h) / 2;
    const force = gravityStrength * 2.5;

    // Update particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.age += dt;

      // Trail
      p.trail.push({ x: p.x, y: p.y });
      if (p.trail.length > 30) p.trail.shift();

      // Gravity toward center
      const dx = cx - p.x, dy = cy - p.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const ax = (dx / dist) * force;
      const ay = (dy / dist) * force;
      p.vx += ax * dt;
      p.vy += ay * dt;

      // Light damping (creates decaying orbit → spiral)
      p.vx *= 0.997;
      p.vy *= 0.997;

      // Move
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      // Check ring crossings
      const newDist = Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2);

      for (const ring of rings) {
        const ringR = ring.radiusFrac * halfSize;
        const crossed = (p.prevDist > ringR && newDist <= ringR) ||
                        (p.prevDist < ringR && newDist >= ringR);

        if (crossed) {
          const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
          if (speed > 2) {
            const now = performance.now();
            if (now - ring.lastPluckTime > 45) {
              ring.lastPluckTime = now;
              const velocity = Math.min(speed / 100, 1.5);
              const dir = newDist < p.prevDist ? -1 : 1;
              ring.displacement += dir * Math.min(velocity * 4, 6);
              ring.velocity += dir * velocity * 15;
              ring.glowIntensity = Math.min(1, ring.glowIntensity + velocity * 0.6);
              playStringSound(ring.index, velocity);
              spawnSparks(p.x, p.y, 3);
            }
            // Slow particle slightly on crossing
            p.vx *= 0.9;
            p.vy *= 0.9;
          }
        }
      }

      p.prevDist = newDist;

      // Center burst — particle falls into the well
      if (newDist < halfSize * 0.07) {
        spawnCenterBurst(p.x, p.y);
        centerGlow = Math.min(1, centerGlow + 0.4);
        p.life = 0;
      }

      // Off-screen removal
      const margin = 100;
      if (p.x < -margin || p.x > w + margin || p.y < -margin || p.y > h + margin) {
        p.life -= dt * 3;
      }

      if (p.age > 30) p.life -= dt * 0.3;
      if (p.life <= 0) particles.splice(i, 1);
    }
    if (particles.length > 150) particles.splice(0, particles.length - 150);

    // Update sparks
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vx *= 0.96;
      s.vy *= 0.96;
      s.life -= dt * s.decay;
      if (s.life <= 0) sparks.splice(i, 1);
    }
    if (sparks.length > 300) sparks.splice(0, sparks.length - 300);

    // Ring spring physics
    for (const ring of rings) {
      const spring = 600;
      const damping = 5;
      const accel = -spring * ring.displacement - damping * ring.velocity;
      ring.velocity += accel * dt;
      ring.displacement += ring.velocity * dt;
      if (Math.abs(ring.displacement) < 0.01 && Math.abs(ring.velocity) < 0.1) {
        ring.displacement = 0;
        ring.velocity = 0;
      }
      ring.glowIntensity *= 0.97;
    }

    // Center glow decay
    centerGlow *= 0.94;
  }

  // --- Rendering ---
  function render(time) {
    if (!isOpen || !ctx || !canvas) return;

    const dt = lastTime ? (time - lastTime) / 1000 : 0.016;
    lastTime = time;

    updatePhysics(dt);

    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2 + gcOffX;
    const cy = h / 2 + gcOffY;
    const halfSize = Math.min(w, h) / 2;
    const skin = SKINS[currentSkin];
    const t = time * 0.001;

    // Clear with trail (longer trail = visible spirals)
    ctx.fillStyle = skin.bg;
    ctx.globalAlpha = 0.12;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;

    // Stars
    for (const star of starField) {
      const twinkle = 0.5 + 0.5 * Math.sin(t * star.twinkleSpeed + star.twinklePhase);
      const alpha = star.brightness * twinkle;
      const [r, g, b] = skin.star;
      ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
      ctx.fillRect(Math.floor(star.x * w), Math.floor(star.y * h), star.size, star.size);
    }

    // === Center vortex glow ===
    const [cr, cg, cb] = skin.center;
    if (centerGlow > 0.01) {
      const crad = halfSize * 0.14;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, crad);
      grad.addColorStop(0, `rgba(${cr},${cg},${cb},${centerGlow * 0.5})`);
      grad.addColorStop(0.5, `rgba(${cr},${cg},${cb},${centerGlow * 0.15})`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, crad, 0, Math.PI * 2);
      ctx.fill();
    }

    // Center dot (always visible — the well)
    ctx.fillStyle = `rgba(${cr},${cg},${cb},${0.15 + centerGlow * 0.3})`;
    ctx.beginPath();
    ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // === Rings ===
    const [rr, rg, rb] = skin.ring;
    const [gr, gg, gb] = skin.ringGlow;

    for (const ring of rings) {
      const radius = ring.radiusFrac * halfSize + ring.displacement;
      if (radius < 2) continue;
      const vibAmp = Math.abs(ring.displacement);
      const intensity = Math.max(vibAmp / 4, ring.glowIntensity);

      // Glow halo
      if (intensity > 0.02) {
        ctx.strokeStyle = `rgba(${gr},${gg},${gb},${intensity * 0.2})`;
        ctx.lineWidth = 3 + intensity * 5;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Ring line
      const ringAlpha = 0.15 + intensity * 0.45;
      ctx.strokeStyle = `rgba(${rr},${rg},${rb},${ringAlpha})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();

      // Note label (right side of ring)
      ctx.fillStyle = skin.noteLabel;
      ctx.font = '7px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(ring.noteName, cx + radius + 5, cy);
    }

    // === Particle trails (spiral paths) ===
    const [tr, tg, tb] = skin.trail;
    for (const p of particles) {
      const alpha = p.life;

      if (p.trail.length > 2) {
        // Draw trail segments with fading opacity
        for (let ti = 1; ti < p.trail.length; ti++) {
          const segAlpha = (ti / p.trail.length) * alpha * 0.35;
          const segWidth = 0.5 + (ti / p.trail.length) * 1.5;
          ctx.strokeStyle = `rgba(${tr},${tg},${tb},${segAlpha})`;
          ctx.lineWidth = segWidth;
          ctx.beginPath();
          ctx.moveTo(p.trail[ti - 1].x, p.trail[ti - 1].y);
          ctx.lineTo(p.trail[ti].x, p.trail[ti].y);
          ctx.stroke();
        }
      }

      // Particle glow
      const [pr, pg, pb] = skin.particle;
      const glowR = p.size * 3;
      ctx.fillStyle = `rgba(${pr},${pg},${pb},${alpha * 0.1})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, glowR, 0, Math.PI * 2);
      ctx.fill();

      // Particle core
      ctx.fillStyle = `rgba(${pr},${pg},${pb},${alpha * 0.85})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();

      // Bright center
      ctx.fillStyle = `rgba(255,255,255,${alpha * 0.5})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 0.3, 0, Math.PI * 2);
      ctx.fill();
    }

    // === Sparks ===
    const [sr, sg, sb] = skin.spark;
    for (const s of sparks) {
      ctx.fillStyle = `rgba(${sr},${sg},${sb},${s.life * 0.8})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size * s.life, 0, Math.PI * 2);
      ctx.fill();
    }

    // Subtle vignette
    const vr = Math.max(w, h) * 0.6;
    const vig = ctx.createRadialGradient(w / 2, h / 2, vr * 0.4, w / 2, h / 2, vr);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.3)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, w, h);

    animFrame = requestAnimationFrame(render);
  }

  // --- Input ---
  function onStageDown(e) {
    if (!canvas) return;
    ensureAudio();

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    holdX = (e.clientX - rect.left) * scaleX;
    holdY = (e.clientY - rect.top) * scaleY;

    spawnParticle(holdX, holdY);
    isHolding = true;

    if (holdTimer) clearInterval(holdTimer);
    holdTimer = setInterval(() => {
      if (isHolding) {
        spawnParticle(
          holdX + (Math.random() - 0.5) * 14,
          holdY + (Math.random() - 0.5) * 14
        );
      }
    }, 70);
  }

  function onStageMove(e) {
    if (!canvas || !isOpen) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    if (isHolding) {
      holdX = (e.clientX - rect.left) * scaleX;
      holdY = (e.clientY - rect.top) * scaleY;
    }

    // Subtle gravity center tilt
    const relX = (e.clientX - rect.left) / rect.width - 0.5;
    const relY = (e.clientY - rect.top) / rect.height - 0.5;
    gcOffX = relX * 30;
    gcOffY = relY * 30;
  }

  function onStageUp() {
    isHolding = false;
    if (holdTimer) {
      clearInterval(holdTimer);
      holdTimer = null;
    }
  }

  function onDeviceOrientation(e) {
    if (!isOpen) return;
    const gamma = (e.gamma || 0) / 45;
    const beta = (e.beta || 0) / 45;
    gcOffX = Math.max(-40, Math.min(40, gamma * 40));
    gcOffY = Math.max(-40, Math.min(40, (beta - 0.5) * 40));
  }

  // --- Skin ---
  function switchSkin(skin) {
    if (!SKINS[skin]) return;
    currentSkin = skin;
    const body = document.getElementById('gravityharp-body');
    if (body) body.className = `skin-${skin}`;
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

    if (ctx && canvas) {
      ctx.fillStyle = SKINS[currentSkin].bg;
      ctx.globalAlpha = 1;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    animFrame = requestAnimationFrame(render);
  }

  function onWindowClose() {
    isOpen = false;
    onStageUp();
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
