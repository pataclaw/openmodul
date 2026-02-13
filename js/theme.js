// theme.js — Theme switcher, EyeDropper, palette extraction from URL/image
const Theme = (() => {
  let currentTheme = 'plain';
  let customVars = {};

  function init() {
    // Load saved custom theme
    const saved = localStorage.getItem('omnichord-custom-theme');
    if (saved) {
      try { customVars = JSON.parse(saved); } catch (e) {}
    }

    // Load last selected theme
    const lastTheme = localStorage.getItem('omnichord-theme') || 'om-27';
    setTheme(lastTheme);

    // Wire up theme select
    document.getElementById('theme-select').addEventListener('change', e => {
      setTheme(e.target.value);
    });

    // Wire up custom panel
    setupCustomPanel();
  }

  function setTheme(name) {
    currentTheme = name;
    localStorage.setItem('omnichord-theme', name);

    const link = document.getElementById('theme-stylesheet');
    const panel = document.getElementById('custom-theme-panel');

    if (name === 'custom') {
      link.href = 'css/themes/plain.css'; // base
      panel.classList.remove('hidden');
      applyCustomVars();
    } else {
      link.href = `css/themes/${name}.css`;
      panel.classList.add('hidden');
      // Clear custom overrides
      Object.keys(customVars).forEach(key => {
        document.documentElement.style.removeProperty(key);
      });
    }

    // Update select
    document.getElementById('theme-select').value = name;
  }

  function applyCustomVars() {
    Object.entries(customVars).forEach(([key, val]) => {
      document.documentElement.style.setProperty(key, val);
    });
    // Sync color pickers
    document.querySelectorAll('#custom-theme-panel input[type="color"]').forEach(input => {
      const varName = input.dataset.var;
      if (customVars[varName]) input.value = customVars[varName];
    });
  }

  function setupCustomPanel() {
    // Color pickers
    document.querySelectorAll('#custom-theme-panel input[type="color"]').forEach(input => {
      input.addEventListener('input', e => {
        const varName = input.dataset.var;
        customVars[varName] = e.target.value;
        document.documentElement.style.setProperty(varName, e.target.value);
      });
    });

    // EyeDropper buttons
    document.querySelectorAll('.eyedrop-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!('EyeDropper' in window)) {
          alert('EyeDropper API not supported in this browser');
          return;
        }
        try {
          const dropper = new EyeDropper();
          const result = await dropper.open();
          const varName = btn.dataset.var;
          customVars[varName] = result.sRGBHex;
          document.documentElement.style.setProperty(varName, result.sRGBHex);
          // Update sibling color input
          const input = btn.parentElement.querySelector('input[type="color"]');
          if (input) input.value = result.sRGBHex;
        } catch (e) {
          // User cancelled
        }
      });
    });

    // Palette extraction from URL
    const urlInput = document.getElementById('palette-url');
    const extractBtn = document.getElementById('extract-palette-btn');

    extractBtn.addEventListener('click', () => {
      const url = urlInput.value.trim();
      if (url) extractPaletteFromURL(url);
    });

    urlInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const url = urlInput.value.trim();
        if (url) extractPaletteFromURL(url);
      }
    });

    // Drag-drop image
    const dropZone = document.getElementById('palette-drop-zone');
    dropZone.addEventListener('dragover', e => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', e => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('image/')) {
        extractPaletteFromFile(file);
      }
    });

    // Click drop zone to open file picker
    const filePicker = document.createElement('input');
    filePicker.type = 'file';
    filePicker.accept = 'image/*';
    filePicker.style.display = 'none';
    document.body.appendChild(filePicker);
    dropZone.addEventListener('click', () => filePicker.click());
    filePicker.addEventListener('change', () => {
      if (filePicker.files[0]) extractPaletteFromFile(filePicker.files[0]);
      filePicker.value = '';
    });

    // Clipboard paste (Ctrl/Cmd+V) — works when custom panel is visible
    document.addEventListener('paste', e => {
      if (document.getElementById('custom-theme-panel').classList.contains('hidden')) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const blob = item.getAsFile();
          if (blob) extractPaletteFromFile(blob);
          return;
        }
      }
    });

    // Save/load/export/import
    document.getElementById('save-custom-theme').addEventListener('click', () => {
      localStorage.setItem('omnichord-custom-theme', JSON.stringify(customVars));
    });

    document.getElementById('load-custom-theme').addEventListener('click', () => {
      const saved = localStorage.getItem('omnichord-custom-theme');
      if (saved) {
        customVars = JSON.parse(saved);
        applyCustomVars();
      }
    });

    document.getElementById('export-custom-theme').addEventListener('click', () => {
      const json = JSON.stringify(customVars, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'omnichord-theme.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });

    document.getElementById('import-custom-theme').addEventListener('click', () => {
      document.getElementById('import-theme-file').click();
    });

    document.getElementById('import-theme-file').addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          customVars = JSON.parse(reader.result);
          applyCustomVars();
        } catch (err) {
          alert('Invalid theme JSON');
        }
      };
      reader.readAsText(file);
    });
  }

  // --- Palette Extraction ---

  // URL extraction: fetch as blob first (avoids tainted canvas), fall back to img
  async function extractPaletteFromURL(url) {
    const status = document.getElementById('palette-drop-zone');
    const original = status.textContent;
    status.textContent = 'Loading...';

    try {
      // Try fetch → blob → object URL (bypasses tainted canvas)
      const resp = await fetch(url, { mode: 'cors' });
      if (!resp.ok) throw new Error('fetch failed');
      const blob = await resp.blob();
      if (!blob.type.startsWith('image/')) throw new Error('not an image');
      await extractPaletteFromBlob(blob);
      status.textContent = original;
    } catch (e1) {
      // fetch failed (CORS) — try img tag with crossOrigin
      try {
        await new Promise((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => { extractFromImage(img); resolve(); };
          img.onerror = reject;
          img.src = url;
        });
        status.textContent = original;
      } catch (e2) {
        status.textContent = original;
        alert('CORS blocked — the server won\'t let us read that image.\n\nTry instead:\n• Right-click the image → Save As → drag it here\n• Or copy the image (Ctrl/Cmd+C) → paste here (Ctrl/Cmd+V)');
      }
    }
  }

  function extractPaletteFromBlob(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        extractFromImage(img);
        URL.revokeObjectURL(url);
        resolve();
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('invalid image'));
      };
      img.src = url;
    });
  }

  function extractPaletteFromFile(file) {
    extractPaletteFromBlob(file);
  }

  function extractFromImage(img) {
    const canvas = document.getElementById('palette-canvas');
    const ctx = canvas.getContext('2d');

    // Scale down for performance
    const maxDim = 100;
    const scale = Math.min(maxDim / img.width, maxDim / img.height, 1);
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    let imageData;
    try {
      imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    } catch (e) {
      alert('Could not read image pixels (security restriction).\nTry drag-dropping a local file or pasting from clipboard.');
      return;
    }

    const pixels = [];
    for (let i = 0; i < imageData.data.length; i += 4) {
      // Skip fully transparent pixels
      if (imageData.data[i + 3] < 128) continue;
      pixels.push([imageData.data[i], imageData.data[i + 1], imageData.data[i + 2]]);
    }

    if (pixels.length < 5) {
      alert('Image has too few visible pixels to extract a palette.');
      return;
    }

    const palette = kMeans(pixels, 5);
    applyPalette(palette);
  }

  // Simple k-means clustering for color extraction
  function kMeans(pixels, k, maxIter = 20) {
    // Initialize centroids randomly
    let centroids = [];
    const step = Math.floor(pixels.length / k);
    for (let i = 0; i < k; i++) {
      centroids.push([...pixels[i * step]]);
    }

    for (let iter = 0; iter < maxIter; iter++) {
      // Assign pixels to nearest centroid
      const clusters = Array.from({ length: k }, () => []);
      pixels.forEach(px => {
        let minDist = Infinity;
        let minIdx = 0;
        centroids.forEach((c, i) => {
          const d = (px[0] - c[0]) ** 2 + (px[1] - c[1]) ** 2 + (px[2] - c[2]) ** 2;
          if (d < minDist) { minDist = d; minIdx = i; }
        });
        clusters[minIdx].push(px);
      });

      // Update centroids
      const newCentroids = clusters.map((cluster, i) => {
        if (cluster.length === 0) return centroids[i];
        const avg = [0, 0, 0];
        cluster.forEach(px => { avg[0] += px[0]; avg[1] += px[1]; avg[2] += px[2]; });
        return avg.map(v => Math.round(v / cluster.length));
      });

      centroids = newCentroids;
    }

    return centroids;
  }

  function applyPalette(colors) {
    // Sort by luminance (darkest first)
    colors.sort((a, b) => luminance(a) - luminance(b));

    const hex = colors.map(c => `#${c.map(v => v.toString(16).padStart(2, '0')).join('')}`);

    // Show palette preview
    showPalettePreview(hex);

    // Map: darkest→bg/page, next→secondary bg/buttons, mids→accents, lightest→text
    const mapping = {
      '--page-bg': hex[0],
      '--bezel-bg': hex[0],
      '--body-bg': hex[0],
      '--body-bg-secondary': hex[1],
      '--btn-bg': hex[1],
      '--body-border': hex[2],
      '--btn-border': hex[2],
      '--strip-bg': hex[0],
      '--grill-bg': hex[0],
      '--timeline-bg': hex[0],
      '--accent-1': hex[2],
      '--accent-2': hex[3],
      '--btn-active': hex[3],
      '--strip-glow': hex[3],
      '--timeline-note': hex[3],
      '--beat-dot-active': hex[3],
      '--text-primary': hex[4],
      '--btn-text': hex[4],
      '--text-secondary': hex[3],
      '--text-muted': hex[2]
    };

    Object.entries(mapping).forEach(([key, val]) => {
      customVars[key] = val;
      document.documentElement.style.setProperty(key, val);
    });

    // Sync color pickers
    document.querySelectorAll('#custom-theme-panel input[type="color"]').forEach(input => {
      const varName = input.dataset.var;
      if (customVars[varName]) input.value = customVars[varName];
    });
  }

  function showPalettePreview(hexColors) {
    let preview = document.getElementById('palette-preview');
    if (!preview) {
      preview = document.createElement('div');
      preview.id = 'palette-preview';
      preview.style.cssText = 'display:flex;gap:4px;margin:8px 0 4px;';
      const dropZone = document.getElementById('palette-drop-zone');
      dropZone.parentElement.insertBefore(preview, dropZone.nextSibling);
    }
    preview.innerHTML = hexColors.map(c =>
      `<div style="width:28px;height:28px;border-radius:4px;background:${c};border:1px solid rgba(128,128,128,0.3)" title="${c}"></div>`
    ).join('');
  }

  function luminance([r, g, b]) {
    return 0.299 * r + 0.587 * g + 0.114 * b;
  }

  return { init, setTheme };
})();
