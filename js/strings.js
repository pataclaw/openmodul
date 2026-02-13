// strings.js — Sonic Strings touch strip: strum detection + voice triggering
const Strings = (() => {
  const MAX_VOICES = 8;
  let canvas, ctxCanvas, strip;
  let voices = [];
  let isDown = false;
  let lastX = 0;
  let lastTime = 0;
  let lastZone = -1;
  let volume = 0.75;
  let particles = [];
  let animFrame = null;

  function init() {
    strip = document.getElementById('strings-strip');
    canvas = document.getElementById('strings-canvas');
    ctxCanvas = canvas.getContext('2d');
    resize();

    strip.addEventListener('pointerdown', onPointerDown);
    strip.addEventListener('pointermove', onPointerMove);
    strip.addEventListener('pointerup', onPointerUp);
    strip.addEventListener('pointerleave', onPointerUp);
    strip.addEventListener('pointercancel', onPointerUp);

    window.addEventListener('resize', resize);
    startAnimation();
  }

  function resize() {
    const rect = strip.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    ctxCanvas.scale(window.devicePixelRatio, window.devicePixelRatio);
  }

  function getZoneCount() {
    const chord = Chords.getActive();
    return chord ? chord.stripNotes.length : 12;
  }

  function posToZone(x) {
    const rect = strip.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (x - rect.left) / rect.width));
    return Math.floor(ratio * getZoneCount());
  }

  function onPointerDown(e) {
    e.preventDefault();
    strip.setPointerCapture(e.pointerId);
    isDown = true;
    lastX = e.clientX;
    lastTime = performance.now();
    lastZone = -1;
    handlePointer(e);
  }

  function onPointerMove(e) {
    if (!isDown) return;
    e.preventDefault();
    handlePointer(e);
  }

  function onPointerUp(e) {
    isDown = false;
    lastZone = -1;
  }

  function handlePointer(e) {
    const chord = Chords.getActive();
    if (!chord) return;

    const zone = posToZone(e.clientX);
    if (zone === lastZone) return;

    // Strum velocity
    const now = performance.now();
    const dt = now - lastTime;
    const dx = Math.abs(e.clientX - lastX);
    const speed = dt > 0 ? dx / dt : 0.5; // pixels per ms
    const velocity = Math.min(1, Math.max(0.2, speed * 0.8)) * volume;

    lastX = e.clientX;
    lastTime = now;
    lastZone = zone;

    // Trigger note
    if (zone >= 0 && zone < chord.stripNotes.length) {
      const note = chord.stripNotes[zone];
      triggerNote(note, velocity);

      // Spawn particle
      const rect = strip.getBoundingClientRect();
      const x = ((zone + 0.5) / getZoneCount()) * rect.width;
      const y = e.clientY - rect.top;
      spawnParticle(x, y, velocity);
    }
  }

  function triggerNote(note, velocity) {
    // Voice stealing: remove oldest if at max
    if (voices.length >= MAX_VOICES) {
      voices.shift();
    }

    // Duration derived from sustain slider (null = let audio.js use sustainValue)
    const voice = Audio.playStringVoice(note.freq, velocity);
    voices.push(voice);

    // MIDI output
    MIDI.sendNoteOn(1, note.midi, Math.round(velocity * 127));
    setTimeout(() => MIDI.sendNoteOff(1, note.midi), 800);

    // Recorder
    Recorder.logEvent('note', { channel: 1, midi: note.midi, velocity: Math.round(velocity * 127), freq: note.freq });
  }

  function setVolume(val) {
    volume = val;
  }

  // --- Visual ---
  function spawnParticle(x, y, velocity) {
    const count = 3 + Math.floor(velocity * 5);
    for (let i = 0; i < count; i++) {
      particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 3,
        vy: -(1 + Math.random() * 2) * velocity,
        life: 1,
        decay: 0.02 + Math.random() * 0.02,
        size: 2 + Math.random() * 3 * velocity
      });
    }
  }

  function startAnimation() {
    function frame() {
      animFrame = requestAnimationFrame(frame);
      draw();
    }
    frame();
  }

  function draw() {
    const rect = strip.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    ctxCanvas.clearRect(0, 0, w, h);

    const chord = Chords.getActive();
    const zones = getZoneCount();

    // Draw zone lines
    ctxCanvas.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--strip-zone-line').trim() || 'rgba(255,255,255,0.08)';
    ctxCanvas.lineWidth = 1;
    for (let i = 1; i < zones; i++) {
      const x = (i / zones) * w;
      ctxCanvas.beginPath();
      ctxCanvas.moveTo(x, 0);
      ctxCanvas.lineTo(x, h);
      ctxCanvas.stroke();
    }

    // Draw note labels (subtle)
    if (chord) {
      ctxCanvas.font = '9px monospace';
      ctxCanvas.fillStyle = 'rgba(255,255,255,0.15)';
      ctxCanvas.textAlign = 'center';
      chord.stripNotes.forEach((note, i) => {
        if (i < zones) {
          const x = ((i + 0.5) / zones) * w;
          ctxCanvas.fillText(note.name, x, h - 4);
        }
      });
    }

    // Draw pointer line when active
    if (isDown) {
      const glowColor = getComputedStyle(document.documentElement).getPropertyValue('--strip-glow').trim() || '#e94560';
      const rect2 = strip.getBoundingClientRect();
      const relX = lastX - rect2.left;

      ctxCanvas.strokeStyle = glowColor;
      ctxCanvas.lineWidth = 2;
      ctxCanvas.shadowColor = glowColor;
      ctxCanvas.shadowBlur = 12;
      ctxCanvas.beginPath();
      ctxCanvas.moveTo(relX, 0);
      ctxCanvas.lineTo(relX, h);
      ctxCanvas.stroke();
      ctxCanvas.shadowBlur = 0;
    }

    // Draw particles
    const glowColor = getComputedStyle(document.documentElement).getPropertyValue('--strip-glow').trim() || '#e94560';
    particles.forEach(p => {
      ctxCanvas.globalAlpha = p.life;
      ctxCanvas.fillStyle = glowColor;
      ctxCanvas.beginPath();
      ctxCanvas.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
      ctxCanvas.fill();

      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.05; // gravity
      p.life -= p.decay;
    });
    ctxCanvas.globalAlpha = 1;

    // Cull dead particles
    particles = particles.filter(p => p.life > 0);
  }

  return { init, setVolume, resize };
})();
