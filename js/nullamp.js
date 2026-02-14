// nullamp.js — Cursed MTV image visualizer + oscilloscope audio visualizer
// Seeded media collage engine with 4 glitch themes, layered over radar-grid sine waves.
const Nullamp = (() => {

  // === PIXEL FONT (variable-width, 5 rows, MSB-first) ===
  const FONT = {
    'N': { w: 5, rows: [0b10001, 0b11001, 0b10101, 0b10011, 0b10001] },
    'u': { w: 3, rows: [0b000, 0b000, 0b101, 0b101, 0b011] },
    'l': { w: 2, rows: [0b10, 0b10, 0b10, 0b10, 0b10] },
    'a': { w: 3, rows: [0b000, 0b110, 0b011, 0b111, 0b101] },
    'm': { w: 5, rows: [0b00000, 0b00000, 0b11011, 0b10101, 0b10001] },
    'p': { w: 3, rows: [0b000, 0b110, 0b101, 0b110, 0b100] },
  };
  const LOGO_TEXT = 'Nullamp';
  const PX = 3;

  // === COLOR SCHEMES ===
  const COLOR_SCHEMES = [
    {
      name: 'Phosphor',
      bg: '#0a0a0a',
      primary: '#40c040',
      secondary: '#208020',
      accent: '#80ff80',
      wave(t) {
        const g = 120 + t * 135;
        return `rgb(${30 + t * 50}, ${g}, ${30 + t * 50})`;
      }
    },
    {
      name: 'Plasma',
      bg: '#08081a',
      primary: '#4080ff',
      secondary: '#2040a0',
      accent: '#ff40ff',
      wave(t) {
        const h = 220 + t * 80;
        return `hsl(${h}, 80%, ${45 + t * 20}%)`;
      }
    },
    {
      name: 'Fire',
      bg: '#0a0600',
      primary: '#ff6020',
      secondary: '#802000',
      accent: '#ffcc00',
      wave(t) {
        return `rgb(255, ${50 + t * 180}, ${t * 40})`;
      }
    },
    {
      name: 'Rainbow',
      bg: '#0a0a0a',
      primary: '#ff4080',
      secondary: '#402040',
      accent: '#8040ff',
      wave(t, frame) {
        const h = (t * 300 + (frame || 0) * 1.5) % 360;
        return `hsl(${h}, 85%, 55%)`;
      }
    },
    {
      name: 'Matrix',
      bg: '#000800',
      primary: '#00ff41',
      secondary: '#004010',
      accent: '#80ff80',
      wave(t) {
        return `rgb(0, ${100 + t * 155}, ${t * 50})`;
      }
    }
  ];

  // === PEXELS CONFIG ===
  // Free API key from https://www.pexels.com/api/ — drop yours here
  const PEXELS_API_KEY = 'XhwjAeet3pkVHHPabu91TOM4UAKJkbvcwM5YoH9pUtrSePldVrcehRs6';

  // Search queries per theme — curated for the vibe
  const THEME_QUERIES = [
    // VHS Purgatory
    ['old television', 'vhs tape', 'vintage film', 'abandoned building', 'fog mist', 'static noise', 'old camera', 'grainy footage'],
    // Channel Surf
    ['neon lights city', 'fast traffic night', 'tv static', 'glitch art', 'arcade game', 'retro computer', 'broadcast tower', 'cable tv'],
    // Corrupted Memory
    ['digital art abstract', 'circuit board', 'data center', 'binary code', 'pixel art', 'broken screen', 'server room', 'technology grid'],
    // Fever Dream
    ['psychedelic art', 'underwater ocean', 'aurora borealis', 'ink in water', 'kaleidoscope', 'lava lamp', 'colorful smoke', 'crystal prism'],
  ];

  // === MEDIA THEMES ===
  const THEMES = [
    { name: 'VHS Purgatory', imageHold: 120, grayscale: true, effects: ['colorBleed', 'trackingLines', 'tear'], opacity: 0.5 },
    { name: 'Channel Surf', imageHold: 15, grayscale: false, effects: ['rgbSplit', 'static', 'hardCut'], opacity: 0.7 },
    { name: 'Corrupted Memory', imageHold: 60, grayscale: false, effects: ['sliceDisplace', 'blockCorrupt', 'invert'], opacity: 0.5 },
    { name: 'Fever Dream', imageHold: 90, grayscale: false, effects: ['chromatic', 'hueRotate', 'feedback'], opacity: 0.6 },
  ];

  // === STATE ===
  let canvas, ctx, logoCanvas, logoCtx;
  let audioCtx, analyser;
  let bufferSource = null, audioBuffer = null;
  let dataArray, freqArray;
  let currentScheme = 0;
  let sensitivity = 1.0;
  let frameCount = 0;
  let smoothBeat = 0;
  let isRunning = false;
  let rafId = null;
  let fileLoaded = false;
  let isPlaying = false;
  let startTime = 0, pauseOffset = 0;
  let particles = [];

  // === MEDIA STATE ===
  let mediaImages = [];       // Rolling buffer of {img, canvas, ctx, loaded, id}
  let currentSlot = 0;        // Index into mediaImages for current display
  let nextSlot = 1;           // Index into mediaImages for crossfade target
  let imageCounter = 0;       // Ever-incrementing — next image ID to fetch
  let crossfade = 0;          // 0-1 blend between current and next
  let currentTheme = 0;       // 0-3, picked by seed
  let audioSeed = 0;          // 32-bit seed from audio hash
  let seededRng = null;       // PRNG function
  let staticFrames = 0;       // countdown for static burst between cuts
  let glitchIntensity = 0;    // smoothed 0-1 driven by beat
  let imageZoom = 1;          // zoom pulse amount
  let lastBeatHit = 0;        // frame of last beat trigger (debounce)
  let imageFrameCount = 0;    // frames since last image switch
  let feedbackCanvas = null;  // for Fever Dream feedback loop
  let feedbackCtx = null;
  let glitchCanvas = null;    // offscreen canvas for glitch processing
  let glitchCtx = null;

  // === SEED-DERIVED PER-SONG CONSTANTS ===
  let songWarpFreq = 0.02;    // VHS sine warp oscillation speed (0.01-0.04)
  let songSliceScale = 1.0;   // corruption slice size multiplier (0.5-2.0)
  let songRGBShiftDir = 0;    // 0=horizontal, 1=vertical, 2=diagonal
  let songHueBase = 0;        // base hue offset for Fever Dream (0-360)
  let songSplaySpeed = 0.03;  // gaussian splay rotation speed (0.01-0.06)
  let songCutStyle = 0.5;     // hard cuts (1.0) vs crossfades (0.0) bias

  // === BRIDGE DETECTION + LATTICE STATE ===
  let energyHistory = [];
  const ENERGY_WINDOW = 180;
  let bridgeAmount = 0;
  let latticeAnchors = [];
  const BRIDGE_ERRORS = [
    'ERR_BRIDGE_DETECTED', 'SIGNAL::LOST', '>>> BREAKDOWN <<<',
    'BPM_DRIFT: NaN', 'CARRIER_FADE 0x00', 'SYNC_LOST ///',
    'FREQ_COLLAPSE', '!!BRIDGE!!', 'DATA_VOID', 'NULL_SIGNAL',
    '---BREAK---', 'DROPOUT@', 'PHASE::SHIFT', 'dB=-Inf',
  ];
  const LATTICE_MSGS = [
    'ANALYZING', 'SCANNING FREQ', 'DECODE', 'MAPPING',
    'TRACE SIGNAL', 'LOCK ON', 'SAMPLING', 'READING',
    'PARSE WAVE', 'INTERCEPT', 'ISOLATE', 'EXTRACT',
  ];

  // Pexels video state
  let pexelsVideoPool = [];   // Pool of {url, width, height} fetched from Pexels
  let pexelsFetching = false;  // Lock to prevent duplicate fetches
  let pexelsQueryIdx = 0;     // Rotate through theme queries
  let pexelsPage = 1;         // Pagination
  const BUFFER_SIZE = 12;     // Keep 12 media slots loaded at a time
  const PREFETCH_AT = 6;      // Start fetching more when buffer drops to 6 ready
  const POOL_REFILL_AT = 15;  // Fetch more Pexels URLs when pool drops below this

  // === SEEDED PRNG ===
  function mulberry32(seed) {
    let s = seed | 0;
    return function() {
      s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashAudioBuffer(buffer) {
    const channel = buffer.getChannelData(0);
    const len = Math.min(channel.length, 2048); // ~8KB of float32
    let hash = 0x811c9dc5; // FNV offset basis
    for (let i = 0; i < len; i++) {
      // Convert float to integer bits for hashing
      const bits = (channel[i] * 32768) | 0;
      hash ^= bits & 0xFF;
      hash = Math.imul(hash, 0x01000193); // FNV prime
      hash ^= (bits >> 8) & 0xFF;
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0; // ensure unsigned
  }

  // === MEDIA LOADING (rolling infinite buffer — images + Pexels videos) ===

  // Fetch a batch of video URLs from Pexels into the pool
  async function fetchPexelsBatch() {
    if (!PEXELS_API_KEY) return;

    const queries = THEME_QUERIES[currentTheme] || THEME_QUERIES[0];
    const query = queries[pexelsQueryIdx % queries.length];
    pexelsQueryIdx++;

    try {
      const res = await fetch(
        `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=40&page=${pexelsPage}&orientation=landscape`,
        { headers: { 'Authorization': PEXELS_API_KEY } }
      );
      const json = await res.json();

      for (const vid of (json.videos || [])) {
        const file = vid.video_files
          .filter(f => f.width >= 320 && f.width <= 720 && f.file_type === 'video/mp4')
          .sort((a, b) => a.width - b.width)[0]
          || vid.video_files.find(f => f.file_type === 'video/mp4');
        if (file) {
          pexelsVideoPool.push(file.link);
        }
      }
      pexelsPage++;
    } catch (e) {
      console.warn('Nullamp: Pexels fetch failed', e);
    }
  }

  // Fetch multiple batches in parallel for fast pool fill
  async function fetchPexelsVideos(batches) {
    if (pexelsFetching || !PEXELS_API_KEY) return;
    pexelsFetching = true;
    const n = batches || 2;
    const promises = [];
    for (let i = 0; i < n; i++) {
      promises.push(fetchPexelsBatch());
    }
    await Promise.all(promises);
    pexelsFetching = false;
  }

  // Keep the pool topped up — called frequently, non-blocking
  function maintainVideoPool() {
    if (!PEXELS_API_KEY || pexelsFetching) return;
    if (pexelsVideoPool.length < POOL_REFILL_AT) {
      fetchPexelsVideos(2); // fire-and-forget, 2 parallel batches
    }
  }

  // Get a video URL from pool
  function getVideoUrl() {
    if (pexelsVideoPool.length > 0) {
      maintainVideoPool(); // top up in background
      return pexelsVideoPool.shift();
    }
    // Pool empty — trigger refill for next time
    maintainVideoPool();
    return null;
  }

  function applyGrayscaleToCanvas(entryCtx) {
    if (!THEMES[currentTheme].grayscale) return;
    const imgData = entryCtx.getImageData(0, 0, 400, 400);
    const d = imgData.data;
    for (let j = 0; j < d.length; j += 4) {
      const gray = d[j] * 0.299 + d[j+1] * 0.587 + d[j+2] * 0.114;
      d[j] = d[j+1] = d[j+2] = gray;
    }
    entryCtx.putImageData(imgData, 0, 0);
  }

  function fetchOneImage(id) {
    const entry = { type: 'image', img: new Image(), canvas: null, ctx: null, loaded: false, id };
    entry.img.crossOrigin = 'anonymous';
    entry.canvas = document.createElement('canvas');
    entry.canvas.width = 400;
    entry.canvas.height = 400;
    entry.ctx = entry.canvas.getContext('2d');

    entry.img.onload = () => {
      entry.ctx.drawImage(entry.img, 0, 0, 400, 400);
      applyGrayscaleToCanvas(entry.ctx);
      entry.loaded = true;
    };
    entry.img.onerror = () => {
      entry.img.src = `https://picsum.photos/seed/${audioSeed}-${imageCounter++}/400/400`;
    };
    entry.img.src = `https://picsum.photos/seed/${audioSeed}-${id}/400/400`;
    return entry;
  }

  function fetchOneVideo(id) {
    const entry = { type: 'video', video: null, canvas: null, ctx: null, loaded: false, id };
    entry.canvas = document.createElement('canvas');
    entry.canvas.width = 400;
    entry.canvas.height = 400;
    entry.ctx = entry.canvas.getContext('2d');

    const url = getVideoUrl();
    if (!url) {
      // Pool empty, fall back to image
      return fetchOneImage(id);
    }

    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.setAttribute('playsinline', '');

    video.onloadeddata = () => {
      entry.loaded = true;
      video.play().catch(() => {});
    };
    video.onerror = () => {
      // Fallback to image on failure
      entry.type = 'image';
      entry.img = new Image();
      entry.img.crossOrigin = 'anonymous';
      entry.img.onload = () => {
        entry.ctx.drawImage(entry.img, 0, 0, 400, 400);
        applyGrayscaleToCanvas(entry.ctx);
        entry.loaded = true;
      };
      entry.img.src = `https://picsum.photos/seed/${audioSeed}-${id}/400/400`;
    };
    video.src = url;
    entry.video = video;
    return entry;
  }

  // Decide: video (70%) or image (30%)
  function fetchOneMedia(id) {
    if (PEXELS_API_KEY && id % 10 < 7) {
      return fetchOneVideo(id);
    }
    return fetchOneImage(id);
  }

  // Update video frames — draw current video frame to each video slot's canvas
  function updateVideoFrames() {
    for (const slot of mediaImages) {
      if (slot.type === 'video' && slot.video && slot.loaded && !slot.video.paused) {
        slot.ctx.drawImage(slot.video, 0, 0, 400, 400);
        applyGrayscaleToCanvas(slot.ctx);
      }
    }
  }

  // Clean up a slot (pause + release video memory)
  function cleanupSlot(slot) {
    if (slot.type === 'video' && slot.video) {
      slot.video.pause();
      slot.video.removeAttribute('src');
      slot.video.load();
      slot.video = null;
    }
  }

  function prefetchMedia() {
    while (mediaImages.length < BUFFER_SIZE) {
      mediaImages.push(fetchOneMedia(imageCounter++));
    }
    maintainVideoPool();
  }

  function advanceImage() {
    if (mediaImages.length > 2) {
      const old = mediaImages.shift();
      cleanupSlot(old);
      currentSlot = 0;
      nextSlot = 1;
    }
    prefetchMedia();
  }

  function loadMediaImages(seed) {
    // Clean up any existing video elements
    for (const slot of mediaImages) cleanupSlot(slot);

    mediaImages = [];
    currentSlot = 0;
    nextSlot = 1;
    crossfade = 0;
    imageFrameCount = 0;
    imageCounter = 0;
    pexelsVideoPool = [];
    pexelsPage = 1;
    pexelsQueryIdx = 0;

    if (PEXELS_API_KEY) {
      // Fire 3 parallel batches (up to 120 video URLs) then fill buffer
      fetchPexelsVideos(3).then(() => {
        while (mediaImages.length < BUFFER_SIZE) {
          mediaImages.push(fetchOneMedia(imageCounter++));
        }
      });
      // Immediate images to show while videos load
      for (let i = 0; i < 3; i++) {
        mediaImages.push(fetchOneImage(imageCounter++));
      }
    } else {
      for (let i = 0; i < BUFFER_SIZE; i++) {
        mediaImages.push(fetchOneImage(imageCounter++));
      }
    }

    if (!glitchCanvas) {
      glitchCanvas = document.createElement('canvas');
      glitchCtx = glitchCanvas.getContext('2d');
    }
    if (!feedbackCanvas) {
      feedbackCanvas = document.createElement('canvas');
      feedbackCtx = feedbackCanvas.getContext('2d');
    }
  }

  // === GLITCH EFFECTS ===
  function applyGlitch(srcCanvas, dstCtx, w, h, opts) {
    glitchCanvas.width = w;
    glitchCanvas.height = h;
    glitchCtx.drawImage(srcCanvas, 0, 0, w, h);
    const imgData = glitchCtx.getImageData(0, 0, w, h);
    const data = imgData.data;

    // RGB Channel Split
    if (opts.rgbSplit && opts.rgbSplit > 0) {
      const shift = Math.floor(opts.rgbSplit);
      const copy = new Uint8ClampedArray(data);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = (y * w + x) * 4;
          // Shift red channel right
          const rx = Math.min(w - 1, x + shift);
          data[idx] = copy[(y * w + rx) * 4];
          // Shift blue channel left
          const bx = Math.max(0, x - shift);
          data[idx + 2] = copy[(y * w + bx) * 4 + 2];
        }
      }
    }

    // Horizontal Slice Displacement
    if (opts.sliceDisplace && opts.sliceDisplace > 0) {
      const copy = new Uint8ClampedArray(data);
      const sliceH = 4 + Math.floor(seededRng() * 12);
      for (let y = 0; y < h; y += sliceH) {
        const offset = Math.floor((seededRng() - 0.5) * opts.sliceDisplace * 2);
        const rows = Math.min(sliceH, h - y);
        for (let row = 0; row < rows; row++) {
          for (let x = 0; x < w; x++) {
            const srcX = ((x - offset) % w + w) % w;
            const dstIdx = ((y + row) * w + x) * 4;
            const srcIdx = ((y + row) * w + srcX) * 4;
            data[dstIdx] = copy[srcIdx];
            data[dstIdx + 1] = copy[srcIdx + 1];
            data[dstIdx + 2] = copy[srcIdx + 2];
          }
        }
      }
    }

    // Block Corruption
    if (opts.blockCorrupt && opts.blockCorrupt > 0) {
      const numBlocks = Math.floor(opts.blockCorrupt);
      const copy = new Uint8ClampedArray(data);
      for (let b = 0; b < numBlocks; b++) {
        const bx = Math.floor(seededRng() * (w - 40));
        const by = Math.floor(seededRng() * (h - 30));
        const bw = 20 + Math.floor(seededRng() * 40);
        const bh = 10 + Math.floor(seededRng() * 30);
        const sx = Math.floor(seededRng() * (w - bw));
        const sy = Math.floor(seededRng() * (h - bh));
        for (let row = 0; row < bh; row++) {
          for (let col = 0; col < bw; col++) {
            const dIdx = ((by + row) * w + (bx + col)) * 4;
            const sIdx = ((sy + row) * w + (sx + col)) * 4;
            data[dIdx] = copy[sIdx];
            data[dIdx + 1] = copy[sIdx + 1];
            data[dIdx + 2] = copy[sIdx + 2];
          }
        }
      }
    }

    // Static Noise
    if (opts.staticNoise && opts.staticNoise > 0) {
      const density = opts.staticNoise;
      for (let i = 0; i < w * h * density; i++) {
        const px = Math.floor(Math.random() * w);
        const py = Math.floor(Math.random() * h);
        const idx = (py * w + px) * 4;
        const v = Math.random() > 0.5 ? 255 : 0;
        data[idx] = data[idx + 1] = data[idx + 2] = v;
      }
    }

    // Color Inversion in bands
    if (opts.invertBands && opts.invertBands > 0) {
      const numBands = Math.floor(opts.invertBands);
      for (let b = 0; b < numBands; b++) {
        const bandY = Math.floor(seededRng() * h);
        const bandH = 5 + Math.floor(seededRng() * 20);
        for (let y = bandY; y < Math.min(h, bandY + bandH); y++) {
          for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 4;
            data[idx] = 255 - data[idx];
            data[idx + 1] = 255 - data[idx + 1];
            data[idx + 2] = 255 - data[idx + 2];
          }
        }
      }
    }

    glitchCtx.putImageData(imgData, 0, 0);
    dstCtx.drawImage(glitchCanvas, 0, 0);
  }

  // === STATIC BURST ===
  function drawStaticBurst(dstCtx, w, h) {
    const imgData = dstCtx.createImageData(w, h);
    const d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = Math.random() > 0.5 ? 255 : 0;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
    dstCtx.putImageData(imgData, 0, 0);
  }

  // === GAUSSIAN SPLAY / 360 EFFECTS ===
  function applyGaussianSplay(dstCtx, w, h, intensity, frame) {
    // Spherical warp — pixels displaced radially from center, gaussian falloff
    const imgData = dstCtx.getImageData(0, 0, w, h);
    const copy = new Uint8ClampedArray(imgData.data);
    const data = imgData.data;
    const cx = w / 2;
    const cy = h / 2;
    const maxR = Math.sqrt(cx * cx + cy * cy);
    const splayAmt = intensity * 25;
    const rotation = frame * songSplaySpeed; // spin speed from song seed

    for (let y = 0; y < h; y += 2) { // skip rows for perf
      for (let x = 0; x < w; x += 2) { // skip cols for perf
        const dx = x - cx;
        const dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const norm = dist / maxR; // 0 at center, 1 at corners

        // Gaussian-weighted radial displacement — strongest at mid-radius
        const gauss = Math.exp(-((norm - 0.5) * (norm - 0.5)) / 0.08);
        const displaceR = splayAmt * gauss;

        // Spiral: add rotational offset that increases with distance
        const angle = Math.atan2(dy, dx) + rotation * (1 - norm) + displaceR * 0.01;
        const newDist = dist + displaceR * Math.sin(frame * 0.05 + dist * 0.02);

        const srcX = Math.floor(cx + Math.cos(angle) * newDist);
        const srcY = Math.floor(cy + Math.sin(angle) * newDist);

        if (srcX >= 0 && srcX < w && srcY >= 0 && srcY < h) {
          const dIdx = (y * w + x) * 4;
          const sIdx = (srcY * w + srcX) * 4;
          // Write to 2x2 block for the skipped pixels
          for (let py = 0; py < 2 && y + py < h; py++) {
            for (let px = 0; px < 2 && x + px < w; px++) {
              const di = ((y + py) * w + (x + px)) * 4;
              data[di] = copy[sIdx];
              data[di + 1] = copy[sIdx + 1];
              data[di + 2] = copy[sIdx + 2];
            }
          }
        }
      }
    }

    // Radial blur — blend pixels along radial direction
    if (intensity > 0.3) {
      const blurCopy = new Uint8ClampedArray(data);
      const blurSteps = 3;
      const blurDist = intensity * 4;
      for (let y = 0; y < h; y += 2) {
        for (let x = 0; x < w; x += 2) {
          const dx = x - cx;
          const dy = y - cy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 1) continue;
          const dirX = dx / dist;
          const dirY = dy / dist;
          let r = 0, g = 0, b = 0;
          for (let s = 0; s < blurSteps; s++) {
            const sx = Math.floor(x + dirX * s * blurDist);
            const sy = Math.floor(y + dirY * s * blurDist);
            const si = (Math.max(0, Math.min(h - 1, sy)) * w + Math.max(0, Math.min(w - 1, sx))) * 4;
            r += blurCopy[si]; g += blurCopy[si + 1]; b += blurCopy[si + 2];
          }
          const idx = (y * w + x) * 4;
          data[idx] = Math.floor(r / blurSteps);
          data[idx + 1] = Math.floor(g / blurSteps);
          data[idx + 2] = Math.floor(b / blurSteps);
          // Fill 2x2 block
          for (let py = 0; py < 2 && y + py < h; py++) {
            for (let px = 0; px < 2 && x + px < w; px++) {
              const di = ((y + py) * w + (x + px)) * 4;
              data[di] = data[idx]; data[di + 1] = data[idx + 1]; data[di + 2] = data[idx + 2];
            }
          }
        }
      }
    }

    dstCtx.putImageData(imgData, 0, 0);
  }

  // === DATAMOSH STATE ===
  let moshCanvas = null;
  let moshCtx = null;
  let prevFrameData = null;

  // === MEDIA LAYER ===
  function drawMediaLayer(w, h, beat, frame, freq, sens) {
    // Update video frames — draw current video frame to each video slot's canvas
    updateVideoFrames();

    const anyLoaded = mediaImages.some(m => m.loaded);
    if (!anyLoaded) return;

    const theme = THEMES[currentTheme];
    imageFrameCount++;

    // Frequency band energies for reactive effects
    let bassEnergy = 0, midEnergy = 0, highEnergy = 0;
    if (freq) {
      for (let i = 0; i < 8; i++) bassEnergy += freq[i];
      bassEnergy = (bassEnergy / (8 * 255)) * (sens || 1);
      for (let i = 20; i < 80; i++) midEnergy += freq[i];
      midEnergy = (midEnergy / (60 * 255)) * (sens || 1);
      for (let i = 100; i < 300; i++) highEnergy += freq[i];
      highEnergy = (highEnergy / (200 * 255)) * (sens || 1);
    }

    // Faster glitch tracking — follows beat more tightly
    glitchIntensity = glitchIntensity * 0.75 + beat * 0.25;

    // Zoom pulse — punchier, bass-driven
    const zoomTarget = 1.0 + bassEnergy * 0.08;
    imageZoom = imageZoom * 0.85 + zoomTarget * 0.15;

    // Ensure current slot points to a loaded image
    if (!mediaImages[currentSlot] || !mediaImages[currentSlot].loaded) {
      for (let i = 0; i < mediaImages.length; i++) {
        if (mediaImages[i].loaded) { currentSlot = i; break; }
      }
    }
    nextSlot = Math.min(currentSlot + 1, mediaImages.length - 1);

    // Beat-triggered image switch
    if (beat > 0.5 && frame - lastBeatHit > 8) {
      lastBeatHit = frame;
      imageZoom = 1.12 + beat * 0.1;
      if (imageFrameCount > theme.imageHold * 0.3 || theme.imageHold < 30) {
        advanceImage(); // drop old, fetch new, shift slots
        imageFrameCount = 0;
        crossfade = 0;
        // No static burst — let datamosh smear the transition
      }
    }

    // Auto-advance if held too long
    if (imageFrameCount > theme.imageHold) {
      advanceImage();
      imageFrameCount = 0;
      crossfade = 0;
    }

    // Prefetch more if buffer is getting thin
    const readyCount = mediaImages.filter(m => m.loaded).length;
    if (readyCount <= PREFETCH_AT) prefetchMedia();
    // Always keep the video pool topped up (runs every frame, but no-ops if pool is full)
    if (frame % 30 === 0) maintainVideoPool();

    // Crossfade ramp — slow and continuous for seamless morphing
    crossfade = Math.min(1, crossfade + 0.008 + beat * 0.015);

    const current = mediaImages[currentSlot];
    if (!current || !current.loaded) return;

    // Build offscreen composited frame
    glitchCanvas.width = w;
    glitchCanvas.height = h;
    glitchCtx.clearRect(0, 0, w, h);

    // Init mosh canvas
    if (!moshCanvas) {
      moshCanvas = document.createElement('canvas');
      moshCtx = moshCanvas.getContext('2d');
    }
    moshCanvas.width = w;
    moshCanvas.height = h;

    // Draw current image with beat-synced zoom + wobble — bass drives X, mids drive Y
    const wobbleX = Math.sin(frame * 0.07) * bassEnergy * 18 + Math.sin(frame * 0.13) * midEnergy * 6;
    const wobbleY = Math.cos(frame * 0.05) * bassEnergy * 12 + Math.cos(frame * 0.11) * highEnergy * 4;
    glitchCtx.save();
    glitchCtx.translate(w / 2 + wobbleX, h / 2 + wobbleY);
    glitchCtx.scale(imageZoom, imageZoom);
    glitchCtx.translate(-w / 2, -h / 2);
    glitchCtx.drawImage(current.canvas, 0, 0, w, h);
    glitchCtx.restore();

    // Always blend next image — continuous morph, beat accelerates the blend
    const next = mediaImages[nextSlot];
    if (next && next.loaded && crossfade < 1) {
      glitchCtx.globalAlpha = crossfade * 0.6 + beat * 0.3;
      glitchCtx.save();
      glitchCtx.translate(w / 2 - wobbleX * 0.5, h / 2 - wobbleY * 0.5);
      glitchCtx.scale(imageZoom * 0.98, imageZoom * 0.98);
      glitchCtx.translate(-w / 2, -h / 2);
      glitchCtx.drawImage(next.canvas, 0, 0, w, h);
      glitchCtx.restore();
      glitchCtx.globalAlpha = 1;
    }

    // === DATAMOSH — always-on pixel smearing, beat makes it heavier ===
    {
      const currentFrameData = glitchCtx.getImageData(0, 0, w, h);
      if (prevFrameData && prevFrameData.width === w && prevFrameData.height === h) {
        const cur = currentFrameData.data;
        const prev = prevFrameData.data;
        const moshAmt = 0.2 + beat * 0.5 + bassEnergy * 0.3;
        const blockSize = 8;
        for (let by = 0; by < h; by += blockSize) {
          for (let bx = 0; bx < w; bx += blockSize) {
            let diff = 0;
            for (let py = 0; py < blockSize && by + py < h; py++) {
              for (let px = 0; px < blockSize && bx + px < w; px++) {
                const idx = ((by + py) * w + (bx + px)) * 4;
                diff += Math.abs(cur[idx] - prev[idx]) + Math.abs(cur[idx+1] - prev[idx+1]);
              }
            }
            diff /= (blockSize * blockSize * 2);
            if (diff > 5 && seededRng() < moshAmt) {
              const displaceX = Math.floor((Math.random() - 0.5) * (12 + beat * 35));
              const displaceY = Math.floor((Math.random() - 0.5) * (6 + beat * 25));
              // prevBlend: how much of the old frame to keep (heavier = more morph)
              const prevBlend = 0.6 + beat * 0.25;
              const curBlend = 1 - prevBlend;
              for (let py = 0; py < blockSize && by + py < h; py++) {
                for (let px = 0; px < blockSize && bx + px < w; px++) {
                  const dstIdx = ((by + py) * w + (bx + px)) * 4;
                  const srcY = Math.max(0, Math.min(h - 1, by + py + displaceY));
                  const srcX = Math.max(0, Math.min(w - 1, bx + px + displaceX));
                  const srcIdx = (srcY * w + srcX) * 4;
                  cur[dstIdx] = Math.floor(cur[dstIdx] * curBlend + prev[srcIdx] * prevBlend);
                  cur[dstIdx + 1] = Math.floor(cur[dstIdx + 1] * curBlend + prev[srcIdx + 1] * prevBlend);
                  cur[dstIdx + 2] = Math.floor(cur[dstIdx + 2] * curBlend + prev[srcIdx + 2] * prevBlend);
                }
              }
            }
          }
        }
        glitchCtx.putImageData(currentFrameData, 0, 0);
      }
      prevFrameData = glitchCtx.getImageData(0, 0, w, h);
    }

    // Apply theme-specific glitch effects — intensity boosted by frequency bands
    const gi = Math.min(1, glitchIntensity + bassEnergy * 0.3);
    const imgData = glitchCtx.getImageData(0, 0, w, h);
    const d = imgData.data;

    switch (currentTheme) {
      case 0: // VHS Purgatory — bass drives warp + melt
        applyVHSEffects(d, w, h, Math.min(1, gi + bassEnergy * 0.2), frame);
        break;
      case 1: // Channel Surf — mids drive RGB + cuts
        applyChannelSurfEffects(d, w, h, Math.min(1, gi + midEnergy * 0.25), frame);
        break;
      case 2: // Corrupted Memory — bass drives slices
        applyCorruptedEffects(d, w, h, Math.min(1, gi + bassEnergy * 0.2), frame);
        break;
      case 3: // Fever Dream — highs drive chromatic + hue
        applyFeverDreamEffects(d, w, h, Math.min(1, gi + highEnergy * 0.3), frame);
        break;
    }

    glitchCtx.putImageData(imgData, 0, 0);

    // Temporal feedback — persistence drops on beats so new content punches through
    feedbackCanvas.width = w;
    feedbackCanvas.height = h;
    if (prevFrameData && prevFrameData.width === w) {
      feedbackCtx.putImageData(prevFrameData, 0, 0);
      const persistence = 0.3 - bassEnergy * 0.2;
      if (persistence > 0.03) {
        glitchCtx.globalAlpha = persistence;
        glitchCtx.drawImage(feedbackCanvas, 0, 0);
        glitchCtx.globalAlpha = 1;
      }
    }

    // Draw to main canvas — opacity pumps harder with bass
    ctx.globalAlpha = theme.opacity * (0.5 + bassEnergy * 0.5 + beat * 0.3);
    ctx.drawImage(glitchCanvas, 0, 0);
    ctx.globalAlpha = 1;
  }

  // === THEME EFFECT FUNCTIONS ===

  function applyVHSEffects(data, w, h, intensity, frame) {
    const copy = new Uint8ClampedArray(data);

    // Sine wave warp — whole image wobbles like a bad VHS tape
    const warpAmt = 3 + intensity * 12;
    for (let y = 0; y < h; y++) {
      const offset = Math.floor(Math.sin(y * songWarpFreq + frame * songWarpFreq * 3) * warpAmt);
      for (let x = 0; x < w; x++) {
        const srcX = ((x - offset) % w + w) % w;
        const dIdx = (y * w + x) * 4;
        const sIdx = (y * w + srcX) * 4;
        data[dIdx] = copy[sIdx];
        data[dIdx + 1] = copy[sIdx + 1];
        data[dIdx + 2] = copy[sIdx + 2];
      }
    }

    // Color bleed — smear red channel horizontally
    const bleed = Math.floor(2 + intensity * 8);
    for (let y = 0; y < h; y++) {
      for (let x = w - 1; x >= bleed; x--) {
        const idx = (y * w + x) * 4;
        const srcIdx = (y * w + x - bleed) * 4;
        data[idx] = Math.floor(data[idx] * 0.5 + data[srcIdx] * 0.5);
      }
    }

    // Pixel melt — on beats, pixels drip downward
    if (intensity > 0.3) {
      const meltCopy = new Uint8ClampedArray(data);
      const meltAmt = Math.floor(intensity * 8);
      for (let y = h - 1; y >= meltAmt; y--) {
        for (let x = 0; x < w; x++) {
          if (seededRng() < intensity * 0.3) {
            const dIdx = (y * w + x) * 4;
            const sIdx = ((y - meltAmt) * w + x) * 4;
            data[dIdx] = meltCopy[sIdx];
            data[dIdx + 1] = meltCopy[sIdx + 1];
            data[dIdx + 2] = meltCopy[sIdx + 2];
          }
        }
      }
    }

    // Multiple tracking lines — scrolling bright bands
    for (let t = 0; t < 3; t++) {
      const lineY = (frame * (2 + t) + t * 97) % h;
      const lineH = 2 + t;
      for (let dy = 0; dy < lineH; dy++) {
        const y = (lineY + dy) % h;
        for (let x = 0; x < w; x++) {
          const idx = (y * w + x) * 4;
          const boost = 40 + Math.floor(intensity * 40);
          data[idx] = Math.min(255, data[idx] + boost);
          data[idx + 1] = Math.min(255, data[idx + 1] + boost);
          data[idx + 2] = Math.min(255, data[idx + 2] + boost);
        }
      }
    }

    // Horizontal tear — shift a band of rows sideways
    if (intensity > 0.2) {
      const numTears = 1 + Math.floor(intensity * 3);
      const tearCopy = new Uint8ClampedArray(data);
      for (let t = 0; t < numTears; t++) {
        const tearY = Math.floor(seededRng() * h);
        const tearH = Math.floor((3 + intensity * 20) * songSliceScale);
        const tearOffset = Math.floor((seededRng() - 0.5) * 50 * intensity);
        for (let y = tearY; y < Math.min(h, tearY + tearH); y++) {
          for (let x = 0; x < w; x++) {
            const srcX = ((x - tearOffset) % w + w) % w;
            const dIdx = (y * w + x) * 4;
            const sIdx = (y * w + srcX) * 4;
            data[dIdx] = tearCopy[sIdx];
            data[dIdx + 1] = tearCopy[sIdx + 1];
            data[dIdx + 2] = tearCopy[sIdx + 2];
          }
        }
      }
    }

    // CRT phosphor tint — slight green/blue color cast
    for (let i = 0; i < data.length; i += 4) {
      data[i] = Math.floor(data[i] * 0.85);         // reduce red
      data[i + 1] = Math.min(255, data[i + 1] + 8); // boost green
      data[i + 2] = Math.min(255, data[i + 2] + 4); // slight blue
    }

    // Tape noise — scattered dim pixels
    const noiseAmt = Math.floor(w * h * 0.005 * (0.5 + intensity));
    for (let i = 0; i < noiseAmt; i++) {
      const idx = Math.floor(Math.random() * w * h) * 4;
      const v = Math.floor(Math.random() * 50);
      data[idx] = Math.min(255, data[idx] + v);
      data[idx + 1] = Math.min(255, data[idx + 1] + v);
      data[idx + 2] = Math.min(255, data[idx + 2] + v);
    }

    // Interlace — darken every other line for old CRT field effect
    for (let y = 0; y < h; y += 2) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        data[idx] = Math.floor(data[idx] * 0.8);
        data[idx + 1] = Math.floor(data[idx + 1] * 0.8);
        data[idx + 2] = Math.floor(data[idx + 2] * 0.8);
      }
    }
  }

  function applyChannelSurfEffects(data, w, h, intensity, frame) {
    const copy = new Uint8ClampedArray(data);

    // RGB split — direction derived from song seed
    for (let y = 0; y < h; y++) {
      const rowShift = Math.floor((3 + intensity * 15) * (1 + Math.sin(y * 0.1 + frame * 0.3) * 0.5));
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        if (songRGBShiftDir === 0) {
          // Horizontal split
          const rx = Math.min(w - 1, x + rowShift);
          data[idx] = copy[(y * w + rx) * 4];
          const bx = Math.max(0, x - rowShift);
          data[idx + 2] = copy[(y * w + bx) * 4 + 2];
        } else if (songRGBShiftDir === 1) {
          // Vertical split
          const ry = Math.min(h - 1, y + rowShift);
          data[idx] = copy[(ry * w + x) * 4];
          const by = Math.max(0, y - rowShift);
          data[idx + 2] = copy[(by * w + x) * 4 + 2];
        } else {
          // Diagonal split
          const rx = Math.min(w - 1, x + rowShift);
          const ry = Math.min(h - 1, y + Math.floor(rowShift * 0.5));
          data[idx] = copy[(ry * w + rx) * 4];
          const bx = Math.max(0, x - rowShift);
          const by = Math.max(0, y - Math.floor(rowShift * 0.5));
          data[idx + 2] = copy[(by * w + bx) * 4 + 2];
        }
      }
    }

    // Vertical roll — image scrolls up like changing channels
    if (intensity > 0.5) {
      const rollAmt = Math.floor(intensity * h * 0.15);
      const rollCopy = new Uint8ClampedArray(data);
      for (let y = 0; y < h; y++) {
        const srcY = (y + rollAmt) % h;
        for (let x = 0; x < w; x++) {
          const dIdx = (y * w + x) * 4;
          const sIdx = (srcY * w + x) * 4;
          data[dIdx] = rollCopy[sIdx];
          data[dIdx + 1] = rollCopy[sIdx + 1];
          data[dIdx + 2] = rollCopy[sIdx + 2];
        }
      }
    }

    // Static bursts — noise rectangles, positions from seed, pixels truly random
    const numBursts = Math.floor(1 + intensity * 6);
    for (let b = 0; b < numBursts; b++) {
      const bx = Math.floor(seededRng() * w);
      const by = Math.floor(seededRng() * h);
      const bw = 15 + Math.floor(seededRng() * 80);
      const bh = 3 + Math.floor(seededRng() * 25);
      for (let y = by; y < Math.min(h, by + bh); y++) {
        for (let x = bx; x < Math.min(w, bx + bw); x++) {
          const idx = (y * w + x) * 4;
          const v = Math.random() > 0.5 ? 255 : 0; // per-pixel noise stays random
          data[idx] = data[idx + 1] = data[idx + 2] = v;
        }
      }
    }

    // Hard horizontal cuts — swap blocks of rows (seeded positions)
    if (intensity > 0.35 * songCutStyle + 0.15) {
      const cutCopy = new Uint8ClampedArray(data);
      const numCuts = 2 + Math.floor(intensity * 4);
      for (let c = 0; c < numCuts; c++) {
        const y1 = Math.floor(seededRng() * h);
        const y2 = Math.floor(seededRng() * h);
        const cutH = 5 + Math.floor(seededRng() * 15);
        for (let dy = 0; dy < cutH && y1 + dy < h && y2 + dy < h; dy++) {
          for (let x = 0; x < w; x++) {
            const d1 = ((y1 + dy) * w + x) * 4;
            const d2 = ((y2 + dy) * w + x) * 4;
            data[d1] = cutCopy[d2];
            data[d1 + 1] = cutCopy[d2 + 1];
            data[d1 + 2] = cutCopy[d2 + 2];
          }
        }
      }
    }

    // Fake channel number overlay
    if (frame % 60 < 40) {
      const numX = w - 60;
      const numY = 20;
      for (let y = numY; y < numY + 14; y++) {
        for (let x = numX; x < numX + 30; x++) {
          if (x < w && y < h) {
            const idx = (y * w + x) * 4;
            data[idx] = Math.min(255, data[idx] + 100);
            data[idx + 1] = Math.min(255, data[idx + 1] + 100);
            data[idx + 2] = Math.min(255, data[idx + 2] + 100);
          }
        }
      }
    }

    // Phosphor burn — bright pixels leave trails (warm CRT glow)
    for (let i = 0; i < data.length; i += 4) {
      const brightness = (data[i] + data[i+1] + data[i+2]) / 3;
      if (brightness > 200) {
        data[i] = Math.min(255, data[i] + 30);
        data[i+1] = Math.min(255, data[i+1] + 15);
      }
    }
  }

  function applyCorruptedEffects(data, w, h, intensity, frame) {
    // Slice displacement — size scaled by song fingerprint
    const sliceH = Math.floor((3 + seededRng() * 8) * songSliceScale);
    const copy = new Uint8ClampedArray(data);
    for (let y = 0; y < h; y += sliceH) {
      if (seededRng() > 0.4 + (1 - intensity) * 0.4) {
        const offset = Math.floor((seededRng() - 0.5) * 40 * intensity);
        const rows = Math.min(sliceH, h - y);
        for (let row = 0; row < rows; row++) {
          for (let x = 0; x < w; x++) {
            const srcX = ((x - offset) % w + w) % w;
            const dIdx = ((y + row) * w + x) * 4;
            const sIdx = ((y + row) * w + srcX) * 4;
            data[dIdx] = copy[sIdx];
            data[dIdx + 1] = copy[sIdx + 1];
            data[dIdx + 2] = copy[sIdx + 2];
          }
        }
      }
    }

    // Block corruption
    const numBlocks = Math.floor(2 + intensity * 6);
    for (let b = 0; b < numBlocks; b++) {
      const bx = Math.floor(seededRng() * (w - 40));
      const by = Math.floor(seededRng() * (h - 30));
      const bw = 15 + Math.floor(seededRng() * 35);
      const bh = 8 + Math.floor(seededRng() * 25);
      const sx = Math.floor(seededRng() * (w - bw));
      const sy = Math.floor(seededRng() * (h - bh));
      for (let row = 0; row < bh; row++) {
        for (let col = 0; col < bw; col++) {
          const dIdx = ((by + row) * w + (bx + col)) * 4;
          const sIdx = ((sy + row) * w + (sx + col)) * 4;
          if (dIdx < data.length && sIdx < data.length) {
            data[dIdx] = copy[sIdx];
            data[dIdx + 1] = copy[sIdx + 1];
            data[dIdx + 2] = copy[sIdx + 2];
          }
        }
      }
    }

    // Inversion bands
    if (intensity > 0.2) {
      const numBands = Math.floor(1 + intensity * 3);
      for (let b = 0; b < numBands; b++) {
        const bandY = Math.floor(seededRng() * h);
        const bandH = 3 + Math.floor(seededRng() * 15);
        for (let y = bandY; y < Math.min(h, bandY + bandH); y++) {
          for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 4;
            data[idx] = 255 - data[idx];
            data[idx + 1] = 255 - data[idx + 1];
            data[idx + 2] = 255 - data[idx + 2];
          }
        }
      }
    }

    // Pixel sort — sort pixels by brightness in horizontal strips (glitch art staple)
    if (intensity > 0.25) {
      const sortH = 2 + Math.floor(seededRng() * 6);
      for (let y = 0; y < h; y += sortH) {
        if (seededRng() < intensity * 0.5) {
          // Collect pixel brightnesses for this row
          const rowPixels = [];
          for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 4;
            rowPixels.push({ r: data[idx], g: data[idx+1], b: data[idx+2], bright: data[idx] + data[idx+1] + data[idx+2] });
          }
          rowPixels.sort((a, b) => a.bright - b.bright);
          for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 4;
            data[idx] = rowPixels[x].r;
            data[idx+1] = rowPixels[x].g;
            data[idx+2] = rowPixels[x].b;
          }
        }
      }
    }

    // Smear — stretch blocks vertically on beat
    if (intensity > 0.4) {
      const smearCopy = new Uint8ClampedArray(data);
      const numSmears = Math.floor(intensity * 5);
      for (let s = 0; s < numSmears; s++) {
        const sx = Math.floor(seededRng() * w);
        const sw = 3 + Math.floor(seededRng() * 20);
        const srcY = Math.floor(seededRng() * h);
        const smearLen = 10 + Math.floor(intensity * 40);
        for (let dy = 0; dy < smearLen && srcY + dy < h; dy++) {
          for (let dx = 0; dx < sw && sx + dx < w; dx++) {
            const dIdx = ((srcY + dy) * w + (sx + dx)) * 4;
            const sIdx = (srcY * w + (sx + dx)) * 4;
            data[dIdx] = smearCopy[sIdx];
            data[dIdx + 1] = smearCopy[sIdx + 1];
            data[dIdx + 2] = smearCopy[sIdx + 2];
          }
        }
      }
    }
  }

  function applyFeverDreamEffects(data, w, h, intensity, frame) {
    const copy = new Uint8ClampedArray(data);

    // Chromatic aberration — direction from song seed
    const shift = Math.floor(2 + intensity * 14);
    const vertFactor = songRGBShiftDir === 0 ? 0 : songRGBShiftDir === 1 ? 1.0 : 0.5;
    const horizFactor = songRGBShiftDir === 1 ? 0 : 1.0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        const rx = Math.min(w - 1, x + Math.floor(shift * horizFactor));
        const ry = Math.min(h - 1, y + Math.floor(shift * vertFactor));
        data[idx] = copy[(ry * w + rx) * 4];
        const bx = Math.max(0, x - Math.floor(shift * horizFactor));
        const by = Math.max(0, y - Math.floor(shift * vertFactor));
        data[idx + 2] = copy[(by * w + bx) * 4 + 2];
      }
    }

    // Kaleidoscope — mirror quadrants for trippy symmetry
    if (intensity > 0.2) {
      const kCopy = new Uint8ClampedArray(data);
      const cx = Math.floor(w / 2);
      const cy = Math.floor(h / 2);
      const kBlend = 0.3 + intensity * 0.3;
      for (let y = 0; y < cy; y++) {
        for (let x = 0; x < cx; x++) {
          const srcIdx = (y * w + x) * 4;
          // Mirror to right
          const mirX = w - 1 - x;
          const rIdx = (y * w + mirX) * 4;
          data[rIdx] = Math.floor(data[rIdx] * (1 - kBlend) + kCopy[srcIdx] * kBlend);
          data[rIdx+1] = Math.floor(data[rIdx+1] * (1 - kBlend) + kCopy[srcIdx+1] * kBlend);
          data[rIdx+2] = Math.floor(data[rIdx+2] * (1 - kBlend) + kCopy[srcIdx+2] * kBlend);
          // Mirror to bottom
          const mirY = h - 1 - y;
          const bIdx = (mirY * w + x) * 4;
          data[bIdx] = Math.floor(data[bIdx] * (1 - kBlend) + kCopy[srcIdx] * kBlend);
          data[bIdx+1] = Math.floor(data[bIdx+1] * (1 - kBlend) + kCopy[srcIdx+1] * kBlend);
          data[bIdx+2] = Math.floor(data[bIdx+2] * (1 - kBlend) + kCopy[srcIdx+2] * kBlend);
        }
      }
    }

    // Radial warp — pixels spiral from center on beat
    if (intensity > 0.3) {
      const warpCopy = new Uint8ClampedArray(data);
      const cx = w / 2;
      const cy = h / 2;
      const warpAmt = intensity * 0.03;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const dx = x - cx;
          const dy = y - cy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const angle = Math.atan2(dy, dx) + warpAmt * dist * Math.sin(frame * 0.05);
          const srcX = Math.floor(cx + Math.cos(angle) * dist);
          const srcY = Math.floor(cy + Math.sin(angle) * dist);
          if (srcX >= 0 && srcX < w && srcY >= 0 && srcY < h) {
            const dIdx = (y * w + x) * 4;
            const sIdx = (srcY * w + srcX) * 4;
            data[dIdx] = warpCopy[sIdx];
            data[dIdx+1] = warpCopy[sIdx+1];
            data[dIdx+2] = warpCopy[sIdx+2];
          }
        }
      }
    }

    // Hue rotation — base offset from song seed
    const hueShift = (songHueBase + frame * 3 + intensity * 60) % 360;
    const rad = hueShift * Math.PI / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const blend = 0.3 + intensity * 0.4;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const nr = r * (0.213 + 0.787 * cos - 0.213 * sin) + g * (0.715 - 0.715 * cos - 0.715 * sin) + b * (0.072 - 0.072 * cos + 0.928 * sin);
      const ng = r * (0.213 - 0.213 * cos + 0.143 * sin) + g * (0.715 + 0.285 * cos + 0.140 * sin) + b * (0.072 - 0.072 * cos - 0.283 * sin);
      const nb = r * (0.213 - 0.213 * cos - 0.787 * sin) + g * (0.715 - 0.715 * cos + 0.715 * sin) + b * (0.072 + 0.928 * cos + 0.072 * sin);
      data[i] = Math.floor(r * (1 - blend) + Math.max(0, Math.min(255, nr)) * blend);
      data[i + 1] = Math.floor(g * (1 - blend) + Math.max(0, Math.min(255, ng)) * blend);
      data[i + 2] = Math.floor(b * (1 - blend) + Math.max(0, Math.min(255, nb)) * blend);
    }

    // Saturation boost — pump up colors for fever intensity
    for (let i = 0; i < data.length; i += 4) {
      const avg = (data[i] + data[i+1] + data[i+2]) / 3;
      const boost = 1.3 + intensity * 0.5;
      data[i] = Math.max(0, Math.min(255, Math.floor(avg + (data[i] - avg) * boost)));
      data[i+1] = Math.max(0, Math.min(255, Math.floor(avg + (data[i+1] - avg) * boost)));
      data[i+2] = Math.max(0, Math.min(255, Math.floor(avg + (data[i+2] - avg) * boost)));
    }
  }

  // === RADAR GRID ===
  function drawRadarGrid(w, h, beat, scheme, frame) {
    const cx = w / 2;
    const cy = h / 2;
    const maxR = Math.min(w, h) * 0.42;
    const rings = 6;
    const spokes = 12;
    const pulse = 1 + beat * 0.05;

    ctx.save();
    ctx.globalAlpha = 0.12 + beat * 0.06;

    // Concentric rings
    for (let i = 1; i <= rings; i++) {
      const r = (i / rings) * maxR * pulse;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = scheme.primary;
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }

    // Radial spokes
    for (let i = 0; i < spokes; i++) {
      const angle = (i / spokes) * Math.PI * 2 + frame * 0.002;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(angle) * maxR * pulse, cy + Math.sin(angle) * maxR * pulse);
      ctx.strokeStyle = scheme.secondary;
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }

    // Crosshair
    ctx.beginPath();
    ctx.moveTo(cx - maxR * pulse, cy);
    ctx.lineTo(cx + maxR * pulse, cy);
    ctx.moveTo(cx, cy - maxR * pulse);
    ctx.lineTo(cx, cy + maxR * pulse);
    ctx.strokeStyle = scheme.primary;
    ctx.lineWidth = 0.3;
    ctx.globalAlpha = 0.06 + beat * 0.03;
    ctx.stroke();

    ctx.restore();
  }

  // === SINE WAVES (oscilloscope style) ===
  function drawWaves(w, h, data, freq, scheme, frame, beat, sens) {
    const cx = w / 2;
    const cy = h / 2;
    const waveW = w * 0.9;
    const waveX = (w - waveW) / 2;
    const points = 300;

    const bands = [
      { freqStart: 0, freqEnd: 10, amp: 0.3, speed: 1.0, thickness: 1.5 },
      { freqStart: 10, freqEnd: 40, amp: 0.22, speed: 0.7, thickness: 1.2 },
      { freqStart: 40, freqEnd: 100, amp: 0.16, speed: 1.3, thickness: 1.0 },
      { freqStart: 100, freqEnd: 200, amp: 0.10, speed: 1.8, thickness: 0.8 },
      { freqStart: 200, freqEnd: 400, amp: 0.06, speed: 2.5, thickness: 0.6 },
    ];

    let wavePoints = [];

    for (let bi = 0; bi < bands.length; bi++) {
      const band = bands[bi];
      let energy = 0;
      for (let i = band.freqStart; i < Math.min(band.freqEnd, freq.length); i++) {
        energy += freq[i];
      }
      energy = energy / ((band.freqEnd - band.freqStart) * 255) * sens;
      const t_norm = bi / bands.length;

      for (let pass = 0; pass < 3; pass++) {
        ctx.beginPath();
        const yShift = (pass - 1) * 1.5;

        const pts = [];
        for (let i = 0; i <= points; i++) {
          const t = i / points;
          const x = waveX + t * waveW;
          const env = Math.sin(t * Math.PI);
          const di = Math.floor(t * data.length);
          const sample = (data[di] / 128 - 1) * sens;
          const synthetic = Math.sin(t * Math.PI * (3 + bi * 2) + frame * 0.02 * band.speed) * energy;
          const combined = (sample * 0.4 + synthetic * 0.6) * band.amp;
          const y = cy + combined * h * env + yShift;
          pts.push({ x, y });
          if (bi === 0 && pass === 2) wavePoints.push({ x, y });
        }

        // Smooth quadratic curves through midpoints
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length - 1; i++) {
          const mx = (pts[i].x + pts[i + 1].x) / 2;
          const my = (pts[i].y + pts[i + 1].y) / 2;
          ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
        }
        ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);

        const color = scheme.wave(t_norm, frame);

        if (pass === 0) {
          ctx.strokeStyle = color;
          ctx.lineWidth = band.thickness * 4 + beat * 8;
          ctx.shadowColor = color;
          ctx.shadowBlur = 20 + beat * 25;
          ctx.globalAlpha = 0.08 + energy * 0.1;
        } else if (pass === 1) {
          ctx.strokeStyle = color;
          ctx.lineWidth = band.thickness * 2.5 + beat * 3;
          ctx.shadowColor = scheme.accent;
          ctx.shadowBlur = 8;
          ctx.globalAlpha = 0.25 + energy * 0.25;
        } else {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = band.thickness + 0.5;
          ctx.shadowColor = scheme.accent;
          ctx.shadowBlur = 4;
          ctx.globalAlpha = 0.6 + energy * 0.4;
        }
        ctx.stroke();
      }
    }
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;

    // Bridge overlays — error text + lattice (waves stay horizontal, always)
    if (bridgeAmount > 0.15 && wavePoints.length > 10) {
      drawWaveErrors(wavePoints, scheme, frame, beat);
    }
    if (wavePoints.length > 10) {
      drawLattice(w, h, wavePoints, scheme, frame, beat);
    }
  }

  // === ERROR TEXT ALONG WAVEFORM (during bridges) ===
  function drawWaveErrors(wavePoints, scheme, frame, beat) {
    ctx.save();
    ctx.font = '9px monospace';
    const numErrors = 2 + Math.floor(bridgeAmount * 5);
    const step = Math.floor(wavePoints.length / (numErrors + 1));
    for (let e = 0; e < numErrors; e++) {
      const idx = step * (e + 1) + Math.floor(Math.sin(frame * 0.03 + e) * step * 0.3);
      const clamped = Math.max(0, Math.min(wavePoints.length - 2, idx));
      const pt = wavePoints[clamped];
      const ptNext = wavePoints[Math.min(clamped + 1, wavePoints.length - 1)];
      const angle = Math.atan2(ptNext.y - pt.y, ptNext.x - pt.x);
      let errIdx = (Math.floor(frame * 0.05) + e * 3) % BRIDGE_ERRORS.length;
      if (beat > 0.4) errIdx = Math.floor(Math.random() * BRIDGE_ERRORS.length);
      let errText = BRIDGE_ERRORS[errIdx];
      if (beat > 0.3) {
        const chars = errText.split('');
        for (let c = 0; c < chars.length; c++) {
          if (Math.random() < beat * 0.3) chars[c] = String.fromCharCode(33 + Math.floor(Math.random() * 93));
        }
        errText = chars.join('');
      }
      ctx.save();
      ctx.translate(pt.x, pt.y);
      ctx.rotate(angle);
      ctx.globalAlpha = bridgeAmount * (0.4 + beat * 0.4);
      ctx.fillStyle = scheme.accent;
      ctx.fillText(errText, 0, -4);
      ctx.globalAlpha = bridgeAmount * 0.2;
      ctx.fillStyle = scheme.primary;
      ctx.fillText(errText, 2, -2);
      ctx.restore();
    }
    ctx.restore();
  }

  // === ASCII LATTICE — analysis lines from wave to anchor points ===
  function drawLattice(w, h, wavePoints, scheme, frame, beat) {
    if (bridgeAmount < 0.1) {
      latticeAnchors = latticeAnchors.filter(a => { a.life -= 0.02; return a.life > 0; });
      if (latticeAnchors.length === 0) return;
    }
    if (bridgeAmount > 0.2 && latticeAnchors.length < 8 && Math.random() < bridgeAmount * 0.08) {
      const waveIdx = Math.floor(Math.random() * wavePoints.length);
      const wp = wavePoints[waveIdx];
      const ang = (Math.random() - 0.5) * Math.PI;
      const dist = 40 + Math.random() * 120;
      latticeAnchors.push({
        waveIdx,
        ax: wp.x + Math.cos(ang) * dist,
        ay: wp.y + Math.sin(ang) * dist - 30,
        msg: LATTICE_MSGS[Math.floor(Math.random() * LATTICE_MSGS.length)],
        life: 1, dots: 0, progress: 0, charOffset: 0,
      });
    }
    ctx.save();
    for (const anchor of latticeAnchors) {
      const wIdx = Math.min(anchor.waveIdx, wavePoints.length - 1);
      const wp = wavePoints[wIdx];
      if (!wp) continue;
      anchor.dots = (anchor.dots + 0.04) % 4;
      anchor.progress = Math.min(1, anchor.progress + 0.015);
      anchor.charOffset += 0.3;
      const alpha = anchor.life * Math.max(bridgeAmount, 0.1);
      const px = wp.x + (anchor.ax - wp.x) * anchor.progress;
      const py = wp.y + (anchor.ay - wp.y) * anchor.progress;

      ctx.beginPath();
      ctx.moveTo(wp.x, wp.y);
      const mx = (wp.x + px) / 2 + Math.sin(frame * 0.03 + anchor.waveIdx) * 10;
      const my = (wp.y + py) / 2 - 8;
      ctx.quadraticCurveTo(mx, my, px, py);
      ctx.strokeStyle = scheme.primary;
      ctx.lineWidth = 0.8;
      ctx.globalAlpha = alpha * 0.5;
      ctx.setLineDash([3, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.arc(px, py, 2 + beat * 2, 0, Math.PI * 2);
      ctx.fillStyle = scheme.accent;
      ctx.globalAlpha = alpha * 0.7;
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(px - 5, py); ctx.lineTo(px + 5, py);
      ctx.moveTo(px, py - 5); ctx.lineTo(px, py + 5);
      ctx.strokeStyle = scheme.accent;
      ctx.lineWidth = 0.5;
      ctx.globalAlpha = alpha * 0.4;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(wp.x, wp.y, 2, 0, Math.PI * 2);
      ctx.fillStyle = scheme.accent;
      ctx.globalAlpha = alpha * 0.6;
      ctx.fill();

      if (anchor.progress > 0.5) {
        const textAlpha = (anchor.progress - 0.5) * 2 * alpha;
        let msg = anchor.msg + '.'.repeat(Math.floor(anchor.dots));
        if (beat > 0.4) {
          const chars = msg.split('');
          for (let c = 0; c < chars.length; c++) {
            if (Math.random() < beat * 0.2) chars[c] = String.fromCharCode(33 + Math.floor(Math.random() * 93));
          }
          msg = chars.join('');
        }
        ctx.font = '8px monospace';
        ctx.globalAlpha = textAlpha * 0.8;
        ctx.fillStyle = scheme.accent;
        ctx.fillText(msg, px + 6, py - 3);
        if (anchor.progress > 0.8) {
          ctx.globalAlpha = textAlpha * 0.4;
          ctx.fillStyle = scheme.primary;
          const readout = Array.from({ length: 12 }, (_, i) =>
            String.fromCharCode(33 + ((Math.floor(anchor.charOffset) + i * 7) % 93))
          ).join('');
          ctx.fillText(readout, px + 6, py + 6);
        }
      }
    }
    for (const a of latticeAnchors) { if (bridgeAmount < 0.15) a.life -= 0.01; }
    latticeAnchors = latticeAnchors.filter(a => a.life > 0);
    ctx.restore();
  }

  // === LOGO RENDERER (static — render once) ===
  function initLogo() {
    logoCanvas = document.getElementById('nullamp-logo');
    if (!logoCanvas) return;
    logoCtx = logoCanvas.getContext('2d');

    const gap = PX;
    let totalW = 0;
    for (let i = 0; i < LOGO_TEXT.length; i++) {
      const g = FONT[LOGO_TEXT[i]];
      if (g) totalW += g.w * PX;
      if (i < LOGO_TEXT.length - 1) totalW += gap;
    }
    logoCanvas.width = totalW + 6;
    logoCanvas.height = 5 * PX + 14;
    renderLogo();
  }

  function renderLogo() {
    if (!logoCtx) return;
    const w = logoCanvas.width;
    const h = logoCanvas.height;
    const gap = PX;
    const charH = 5 * PX;

    const waveAmp = 1.6;
    const waveFreq = 1.4;

    logoCtx.fillStyle = '#ffffff';
    let cx = 3;

    for (let ci = 0; ci < LOGO_TEXT.length; ci++) {
      const glyph = FONT[LOGO_TEXT[ci]];
      if (!glyph) continue;

      const charMidX = cx + (glyph.w * PX) / 2;
      const normX = charMidX / w;
      const yOff = Math.sin(normX * Math.PI * 2 * waveFreq + 0.3) * waveAmp * PX;
      const baseY = (h - charH) / 2 + yOff;

      for (let row = 0; row < 5; row++) {
        for (let col = 0; col < glyph.w; col++) {
          if ((glyph.rows[row] >> (glyph.w - 1 - col)) & 1) {
            logoCtx.fillRect(cx + col * PX, baseY + row * PX, PX, PX);
          }
        }
      }
      cx += glyph.w * PX + gap;
    }
  }

  // === AUDIO FILE LOADING ===
  function initAudioContext() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.82;
    analyser.connect(audioCtx.destination);
    dataArray = new Uint8Array(analyser.fftSize);
    freqArray = new Uint8Array(analyser.frequencyBinCount);
  }

  function loadFile(file) {
    if (!file) return;

    initAudioContext();
    audioCtx.resume();

    stopPlayback();

    file.arrayBuffer().then(buf => {
      return audioCtx.decodeAudioData(buf);
    }).then(buffer => {
      audioBuffer = buffer;
      fileLoaded = true;
      pauseOffset = 0;
      hideDropZone();
      updateFileName(file.name);

      // Seed from audio content
      audioSeed = hashAudioBuffer(buffer);
      seededRng = mulberry32(audioSeed);
      currentTheme = audioSeed % 4;

      // Derive per-song effect fingerprint from PRNG
      songWarpFreq = 0.01 + seededRng() * 0.03;
      songSliceScale = 0.5 + seededRng() * 1.5;
      songRGBShiftDir = Math.floor(seededRng() * 3);
      songHueBase = seededRng() * 360;
      songSplaySpeed = 0.01 + seededRng() * 0.05;
      songCutStyle = seededRng();

      loadMediaImages(audioSeed);

      playFromOffset(0);
    }).catch(err => {
      console.error('Nullamp: decode failed', err);
      showDropZone();
    });
  }

  function playFromOffset(offset) {
    if (!audioBuffer) return;
    stopPlayback();
    bufferSource = audioCtx.createBufferSource();
    bufferSource.buffer = audioBuffer;
    bufferSource.loop = true;
    bufferSource.connect(analyser);
    startTime = audioCtx.currentTime - offset;
    bufferSource.start(0, offset);
    isPlaying = true;
    updatePlayPause(true);
  }

  function stopPlayback() {
    if (bufferSource) {
      try { bufferSource.stop(); } catch(e) {}
      bufferSource.disconnect();
      bufferSource = null;
    }
    isPlaying = false;
  }

  function togglePlayPause() {
    if (!audioBuffer) return;
    if (isPlaying) {
      pauseOffset = (audioCtx.currentTime - startTime) % audioBuffer.duration;
      stopPlayback();
      updatePlayPause(false);
    } else {
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
      playFromOffset(pauseOffset);
    }
  }

  function updatePlayPause(playing) {
    const btn = document.getElementById('nullamp-playpause');
    if (btn) btn.textContent = playing ? '\u275A\u275A' : '\u25B6';
  }

  function updateFileName(name) {
    const el = document.getElementById('nullamp-filename');
    if (el) {
      el.textContent = name.length > 35 ? name.slice(0, 32) + '...' : name;
      el.title = name;
    }
  }

  function showDropZone() {
    const el = document.getElementById('nullamp-dropzone');
    if (el) el.classList.remove('hidden');
  }

  function hideDropZone() {
    const el = document.getElementById('nullamp-dropzone');
    if (el) el.classList.add('hidden');
  }

  // === BEAT DETECTION + BRIDGE DETECTION ===
  function detectBeat() {
    if (!freqArray) return 0;
    let sum = 0;
    for (let i = 0; i < 10; i++) sum += freqArray[i];
    const avg = sum / 10 / 255;
    smoothBeat = Math.max(avg, smoothBeat * 0.92);

    if (!fileLoaded) { bridgeAmount = 0; return smoothBeat; }

    let totalEnergy = 0;
    for (let i = 0; i < freqArray.length; i++) totalEnergy += freqArray[i] * freqArray[i];
    totalEnergy = Math.sqrt(totalEnergy / freqArray.length) / 255;
    energyHistory.push(totalEnergy);
    if (energyHistory.length > ENERGY_WINDOW) energyHistory.shift();

    if (energyHistory.length > 30) {
      const longAvg = energyHistory.reduce((a, b) => a + b, 0) / energyHistory.length;
      const recentAvg = energyHistory.slice(-15).reduce((a, b) => a + b, 0) / 15;
      let bassNow = 0;
      for (let i = 0; i < 6; i++) bassNow += freqArray[i];
      bassNow /= (6 * 255);
      const energyDrop = Math.max(0, 1 - recentAvg / Math.max(0.01, longAvg));
      const bassDrop = bassNow < 0.15 ? 1 : 0;
      bridgeAmount = bridgeAmount * 0.95 + Math.min(1, Math.max(energyDrop * 1.5, bassDrop * 0.7)) * 0.05;
    }

    return smoothBeat;
  }

  // === RING BUFFER for waterfall/history ===
  let freqHistory = [];
  const HISTORY_LEN = 128;

  // === THE VISUALIZATION ===
  function drawVisualization(w, h, data, freq, scheme, frame, beat, sens) {
    const cx = w / 2;
    const cy = h / 2;

    // Store frequency snapshot
    freqHistory.push(new Uint8Array(freq));
    if (freqHistory.length > HISTORY_LEN) freqHistory.shift();

    // 1. AFTERIMAGE
    const clearAlpha = 0.08 - beat * 0.04;
    ctx.fillStyle = `rgba(0,0,0,${Math.max(0.015, clearAlpha)})`;
    ctx.fillRect(0, 0, w, h);

    // === BACKGROUND LAYER: MEDIA IMAGES ===
    drawMediaLayer(w, h, beat, frame, freq, sens);

    // === LAYER 1: RADAR GRID ===
    drawRadarGrid(w, h, beat, scheme, frame);

    // === LAYER 2: OSCILLOSCOPE WAVES ===
    drawWaves(w, h, data, freq, scheme, frame, beat, sens);

    // === LAYER 3: PARTICLE FIELD ===
    const waveW = w * 0.9;
    const waveX = (w - waveW) / 2;
    const spawnRate = 0.3 + beat * 0.8;
    for (let i = 0; i < 3; i++) {
      if (Math.random() < spawnRate * sens) {
        const t = Math.random();
        const di = Math.floor(t * data.length);
        const sample = (data[di] / 128 - 1) * sens;
        const env = Math.sin(t * Math.PI);
        particles.push({
          x: waveX + t * waveW,
          y: cy + sample * h * 0.25 * env,
          vx: (Math.random() - 0.5) * 3,
          vy: (Math.random() - 0.5) * 3 - 0.5,
          life: 1,
          decay: 0.01 + Math.random() * 0.02,
          color: scheme.wave(Math.random(), frame),
          size: 1 + Math.random() * 2
        });
      }
    }

    // Update + draw particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.98;
      p.vy *= 0.98;
      p.life -= p.decay;
      if (p.life <= 0 || p.x < -10 || p.x > w + 10 || p.y < -10 || p.y > h + 10) {
        particles.splice(i, 1);
        continue;
      }
      ctx.fillStyle = p.color;
      ctx.globalAlpha = p.life * 0.5;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = p.size * 2;
      ctx.fillRect(Math.floor(p.x), Math.floor(p.y), p.size, p.size);
    }
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    if (particles.length > 400) particles.splice(0, particles.length - 400);

    // === BEAT FLASH ===
    if (beat > 0.55) {
      ctx.fillStyle = scheme.primary;
      ctx.globalAlpha = (beat - 0.55) * 0.08;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }

    // === ASCII OVERLAY ===
    drawAsciiOverlay(w, h, beat, frame, scheme);
  }

  // === ASCII OVERLAY ===
  const ASCII_RAMP = ' .,:;+*?%S#@';
  const GLITCH_WORDS = [
    'NULL', 'VOID', 'ERR', 'SYNC', '/////', 'DATA', '0xFF',
    'MOSH', 'LOST', 'SIGNAL', '>>>>', 'FEED', 'DEAD', 'LOOP',
    '##', '???', 'NO CARRIER', 'OVERFLOW', 'BRK', '01101',
    'CORRUPT', '---', 'ABORT', 'RETRY', 'FAIL', 'xoxo',
  ];
  let asciiDrops = []; // matrix-style falling characters

  function drawAsciiOverlay(w, h, beat, frame, scheme) {
    // 1. ASCII DITHER — sample canvas brightness, render characters
    const cellW = 10;
    const cellH = 14;
    const cols = Math.floor(w / cellW);
    const rows = Math.floor(h / cellH);
    // Only render on beats or periodically (perf)
    const asciiAlpha = beat * 0.35 + 0.05;
    if (asciiAlpha < 0.08) return;

    // Sample the current canvas for brightness
    const sampleData = ctx.getImageData(0, 0, w, h).data;

    ctx.save();
    ctx.font = '10px monospace';
    ctx.textBaseline = 'top';

    // Sparse dither — skip cells randomly, more on quiet, fewer on beat
    const density = 0.15 + beat * 0.35;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        if (Math.random() > density) continue;
        const px = col * cellW + Math.floor(cellW / 2);
        const py = row * cellH + Math.floor(cellH / 2);
        const idx = (py * w + px) * 4;
        const brightness = (sampleData[idx] + sampleData[idx + 1] + sampleData[idx + 2]) / 3;
        const charIdx = Math.floor((brightness / 255) * (ASCII_RAMP.length - 1));
        const ch = ASCII_RAMP[charIdx];
        if (ch === ' ') continue;

        // Color from scheme with slight variation
        ctx.globalAlpha = asciiAlpha * (0.5 + brightness / 510);
        ctx.fillStyle = (row + col + frame) % 7 === 0 ? scheme.accent : scheme.primary;
        ctx.fillText(ch, col * cellW, row * cellH);
      }
    }

    // 2. GLITCH TEXT FRAGMENTS — flash on hard beats
    if (beat > 0.4) {
      const numFrags = 1 + Math.floor(beat * 3);
      ctx.font = '12px monospace';
      for (let i = 0; i < numFrags; i++) {
        const word = GLITCH_WORDS[Math.floor(Math.random() * GLITCH_WORDS.length)];
        const gx = Math.floor(Math.random() * (w - 100));
        const gy = Math.floor(Math.random() * h);
        ctx.globalAlpha = 0.3 + beat * 0.5;
        ctx.fillStyle = scheme.accent;
        ctx.fillText(word, gx, gy);
        // Ghost duplicate offset
        if (beat > 0.6) {
          ctx.globalAlpha = 0.15;
          ctx.fillStyle = scheme.primary;
          ctx.fillText(word, gx + 3, gy + 2);
        }
      }
    }

    // 3. MATRIX DROPS — sparse falling characters
    // Spawn new drops on beats
    if (beat > 0.3 && Math.random() < beat * 0.4) {
      asciiDrops.push({
        x: Math.floor(Math.random() * cols) * cellW,
        y: -cellH,
        speed: 1.5 + Math.random() * 3,
        chars: Array.from({ length: 3 + Math.floor(Math.random() * 8) }, () =>
          ASCII_RAMP[Math.floor(Math.random() * ASCII_RAMP.length)]
        ),
        life: 1,
      });
    }

    ctx.font = '10px monospace';
    for (let i = asciiDrops.length - 1; i >= 0; i--) {
      const drop = asciiDrops[i];
      drop.y += drop.speed;
      drop.life -= 0.008;
      if (drop.y > h + 50 || drop.life <= 0) {
        asciiDrops.splice(i, 1);
        continue;
      }
      for (let j = 0; j < drop.chars.length; j++) {
        const cy = drop.y - j * cellH;
        if (cy < -cellH || cy > h) continue;
        const fade = (1 - j / drop.chars.length) * drop.life;
        ctx.globalAlpha = fade * 0.5;
        ctx.fillStyle = j === 0 ? scheme.accent : scheme.primary;
        // Mutate trailing chars occasionally
        if (Math.random() < 0.05) {
          drop.chars[j] = ASCII_RAMP[Math.floor(Math.random() * ASCII_RAMP.length)];
        }
        ctx.fillText(drop.chars[j], drop.x, cy);
      }
    }
    if (asciiDrops.length > 60) asciiDrops.splice(0, asciiDrops.length - 60);

    ctx.restore();
  }

  // === POST-PROCESSING ===
  function postProcess(w, h) {
    // Scanlines
    ctx.fillStyle = 'rgba(0,0,0,0.06)';
    for (let y = 0; y < h; y += 3) {
      ctx.fillRect(0, y, w, 1);
    }
    // Vignette
    const r = Math.max(w, h) * 0.72;
    const grad = ctx.createRadialGradient(w / 2, h / 2, r * 0.35, w / 2, h / 2, r);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.4)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  // === RENDER LOOP ===
  function render() {
    if (!isRunning) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;

    if (analyser && fileLoaded) {
      analyser.getByteTimeDomainData(dataArray);
      analyser.getByteFrequencyData(freqArray);
    } else {
      if (!dataArray) dataArray = new Uint8Array(1024);
      if (!freqArray) freqArray = new Uint8Array(512);
      for (let i = 0; i < dataArray.length; i++) {
        dataArray[i] = 128 + Math.sin(i * 0.04 + frameCount * 0.015) * 12;
      }
      for (let i = 0; i < freqArray.length; i++) {
        const base = Math.sin(i * 0.008 + frameCount * 0.008) * 25 + 25;
        freqArray[i] = Math.max(0, base * (1 - i / freqArray.length));
      }
    }

    const beat = detectBeat();
    const scheme = COLOR_SCHEMES[currentScheme];

    drawVisualization(w, h, dataArray, freqArray, scheme, frameCount, beat, sensitivity);
    postProcess(w, h);

    frameCount++;
    rafId = requestAnimationFrame(render);
  }

  // === CANVAS RESIZE ===
  function resize() {
    if (!canvas) return;
    const display = document.getElementById('nullamp-display');
    if (!display) return;
    const rect = display.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
  }

  function start() {
    if (isRunning) return;
    isRunning = true;
    resize();
    render();
  }

  function stop() {
    isRunning = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  }

  // === CONTROLS ===
  function wireControls() {
    const schemeSel = document.getElementById('nullamp-scheme');
    const gainSlider = document.getElementById('nullamp-gain');
    const playPauseBtn = document.getElementById('nullamp-playpause');
    const fileInput = document.getElementById('nullamp-file');
    const dropZone = document.getElementById('nullamp-dropzone');
    const display = document.getElementById('nullamp-display');

    if (schemeSel) {
      COLOR_SCHEMES.forEach((s, i) => {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = s.name;
        schemeSel.appendChild(opt);
      });
      schemeSel.addEventListener('change', () => {
        currentScheme = parseInt(schemeSel.value);
      });
    }

    if (gainSlider) {
      gainSlider.addEventListener('input', () => {
        sensitivity = gainSlider.value / 50;
      });
    }

    if (playPauseBtn) playPauseBtn.addEventListener('click', togglePlayPause);

    const resetBtn = document.getElementById('nullamp-reset');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        stopPlayback();
        audioBuffer = null;
        fileLoaded = false;
        isPlaying = false;
        pauseOffset = 0;
        // Clean up media slots
        for (const slot of mediaImages) cleanupSlot(slot);
        mediaImages = [];
        prevFrameData = null;
        updateFileName('');
        showDropZone();
        if (fileInput) {
          fileInput.value = '';
          fileInput.click();
        }
      });
    }

    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        if (e.target.files[0]) loadFile(e.target.files[0]);
      });
    }

    if (dropZone && fileInput) {
      dropZone.addEventListener('click', () => fileInput.click());
    }

    if (display) {
      display.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        display.classList.add('nullamp-dragover');
      });
      display.addEventListener('dragleave', () => {
        display.classList.remove('nullamp-dragover');
      });
      display.addEventListener('drop', (e) => {
        e.preventDefault();
        display.classList.remove('nullamp-dragover');
        if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
      });
    }
  }

  // === LIFECYCLE ===
  function init() {
    canvas = document.getElementById('nullamp-canvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');

    initLogo();
    wireControls();

    if (typeof WindowManager !== 'undefined') {
      WindowManager.on('open', ({ id }) => { if (id === 'nullamp') onOpen(); });
      WindowManager.on('close', ({ id }) => { if (id === 'nullamp') onClose(); });
    }

    window.addEventListener('resize', () => { if (isRunning) resize(); });
  }

  function onOpen() {
    particles = [];
    start();
    if (audioBuffer && !isPlaying) {
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
      playFromOffset(pauseOffset);
    }
  }

  function onClose() {
    stop();
    if (isPlaying) {
      pauseOffset = (audioCtx.currentTime - startTime) % audioBuffer.duration;
      stopPlayback();
    }
  }

  document.addEventListener('DOMContentLoaded', () => init());

  return { init, start, stop, resize };
})();
