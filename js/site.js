// site.js — Showcase site shell
// White void. Real instruments shown small. Click to zoom up and play.
const Site = (() => {
  const CAROUSEL_SCALE = 0.3;

  const PRODUCTS = [
    {
      id: 'insomnichord',
      name: 'Insomnichord',
      category: 'INSTRUMENT',
      accent: '#c8a84e',
      ready: true,
      labelGap: -30, // D-shape curves inward — pull label up
      getPageBg: () => {
        return getComputedStyle(document.documentElement).getPropertyValue('--page-bg').trim() || '#0a0a10';
      }
    },
    {
      id: 'drumbyte',
      name: 'Drumbyte',
      category: 'INSTRUMENT',
      accent: '#e05030',
      ready: false,
      labelGap: 0,
      getPageBg: () => '#1a1614'
    },
    {
      id: 'nullamp',
      name: 'Nullamp',
      category: 'VISUALIZER',
      accent: '#40c040',
      ready: true,
      labelGap: 0,
      getPageBg: () => '#fafaf8'
    }
  ];

  let carouselPositions = {};
  let labelsVisible = true;

  function init() {
    // Register all windows
    PRODUCTS.forEach(p => {
      WindowManager.register(p.id, { accent: p.accent });
    });

    // Back button
    const backBtn = document.getElementById('back-btn');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        const active = WindowManager.getActive();
        if (active && WindowManager.isOpen(active)) {
          WindowManager.close(active);
        }
      });
    }

    // Layout carousel
    layoutCarousel();
    buildLabels();

    // Handle window open
    WindowManager.on('open', ({ id }) => {
      const product = PRODUCTS.find(p => p.id === id);
      if (!product) return;

      // Don't open if not ready
      if (!product.ready) {
        // Reset isOpen state since we're blocking it
        WindowManager.close(id);
        return;
      }

      // Start audio for Insomnichord
      if (id === 'insomnichord' && typeof UI !== 'undefined') {
        UI.startAudio();
      }

      // Animate window to full size
      const el = WindowManager.getEl(id);
      if (!el) return;

      el.classList.add('wm-open');
      el.classList.remove('hover-glow');
      el.style.transition = 'left 0.55s cubic-bezier(0.16, 1, 0.3, 1), top 0.55s cubic-bezier(0.16, 1, 0.3, 1), transform 0.55s cubic-bezier(0.16, 1, 0.3, 1), filter 0.4s ease';
      // Animate filter on next frame so transition catches it
      requestAnimationFrame(() => {
        el.style.filter = 'brightness(1) saturate(1)';
      });
      el.style.left = '50%';
      el.style.top = '50%';
      el.style.transform = 'translate(-50%, -50%) scale(1)';

      // Remove transition after animation so drag works freely
      setTimeout(() => {
        el.style.transition = '';
        // Re-size canvas-based instruments now that scale is 1
        if (id === 'insomnichord' && typeof Strings !== 'undefined' && Strings.resize) {
          Strings.resize();
        }
        if (id === 'nullamp' && typeof Nullamp !== 'undefined' && Nullamp.resize) {
          Nullamp.resize();
        }
      }, 600);

      // Hide labels
      hideLabels();

      // Fade out other windows
      PRODUCTS.forEach(p => {
        if (p.id !== id) {
          const other = WindowManager.getEl(p.id);
          if (other) {
            other.style.transition = 'opacity 0.3s ease';
            other.style.opacity = '0';
            other.style.pointerEvents = 'none';
          }
        }
      });

      // Show back button
      const backBtn = document.getElementById('back-btn');
      if (backBtn) backBtn.classList.remove('back-hidden');

      // Background transition (delayed to let theme CSS load)
      setTimeout(() => transitionBackground(product.getPageBg()), 100);
    });

    // Handle window close
    WindowManager.on('close', ({ id }) => {
      const el = WindowManager.getEl(id);
      if (!el) return;

      el.classList.remove('wm-open');

      // Animate back to carousel position
      const pos = carouselPositions[id];
      if (pos) {
        el.style.transition = 'left 0.45s cubic-bezier(0.4, 0, 0.2, 1), top 0.45s cubic-bezier(0.4, 0, 0.2, 1), transform 0.45s cubic-bezier(0.4, 0, 0.2, 1), filter 0.4s ease';
        el.style.left = pos.x + 'px';
        el.style.top = pos.y + 'px';
        el.style.transform = `translate(-50%, -50%) scale(${CAROUSEL_SCALE})`;
        el.style.filter = 'brightness(0.85) saturate(0.8)';
        setTimeout(() => { el.style.transition = ''; }, 500);
      }

      // Show other windows again
      PRODUCTS.forEach(p => {
        if (p.id !== id) {
          const other = WindowManager.getEl(p.id);
          if (other) {
            other.style.transition = 'opacity 0.4s ease 0.1s';
            other.style.opacity = '1';
            other.style.pointerEvents = '';
          }
        }
      });

      // Show labels
      setTimeout(() => showLabels(), 200);

      // Hide back button
      const backBtn = document.getElementById('back-btn');
      if (backBtn) backBtn.classList.add('back-hidden');

      // Background back to white
      transitionBackground('#fafaf8');
    });

    // Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const active = WindowManager.getActive();
        if (active && WindowManager.isOpen(active)) {
          WindowManager.close(active);
        }
      }
    });

    // Theme change → update background
    const themeLink = document.getElementById('theme-stylesheet');
    if (themeLink) {
      const observer = new MutationObserver(() => {
        if (WindowManager.isOpen('insomnichord')) {
          setTimeout(() => {
            const product = PRODUCTS.find(p => p.id === 'insomnichord');
            if (product) transitionBackground(product.getPageBg());
          }, 50);
        }
      });
      observer.observe(themeLink, { attributes: true, attributeFilter: ['href'] });
    }

    // Resize → relayout carousel
    window.addEventListener('resize', () => {
      if (!WindowManager.isOpen(WindowManager.getActive())) {
        layoutCarousel();
        positionLabels();
      }
    });

    // 3D tilt on carousel windows
    initTiltEffect();
  }

  // --- Carousel layout ---
  function layoutCarousel() {
    const count = PRODUCTS.length;
    // Calculate visual width of each window at scale
    // Use the first window's actual width, or default to 1100
    const sampleEl = WindowManager.getEl(PRODUCTS[0].id);
    const itemWidth = (sampleEl?.offsetWidth || 1100) * CAROUSEL_SCALE;
    const gap = 50;
    const totalWidth = count * itemWidth + (count - 1) * gap;
    const startX = (window.innerWidth - totalWidth) / 2 + itemWidth / 2;
    const y = window.innerHeight * 0.43;

    PRODUCTS.forEach((product, i) => {
      const x = startX + i * (itemWidth + gap);
      carouselPositions[product.id] = { x, y };

      const el = WindowManager.getEl(product.id);
      if (el && !WindowManager.isOpen(product.id)) {
        el.style.left = x + 'px';
        el.style.top = y + 'px';
        el.style.transform = `translate(-50%, -50%) scale(${CAROUSEL_SCALE})`;
        el.style.opacity = '1';
      }
    });
  }

  // --- Labels ---
  function buildLabels() {
    const container = document.getElementById('carousel-labels');
    if (!container) return;

    PRODUCTS.forEach(product => {
      const label = document.createElement('div');
      label.className = 'carousel-label';
      label.dataset.product = product.id;
      label.innerHTML = `
        <span class="cl-category" style="color: ${product.accent}">${product.category}</span>
        <span class="cl-name">${product.name}</span>
        ${!product.ready ? '<span class="cl-soon">COMING SOON</span>' : ''}
      `;
      container.appendChild(label);
    });

    positionLabels();
  }

  function positionLabels() {
    const labels = document.querySelectorAll('.carousel-label');
    labels.forEach(label => {
      const id = label.dataset.product;
      const pos = carouselPositions[id];
      const el = WindowManager.getEl(id);
      const product = PRODUCTS.find(p => p.id === id);
      if (!pos || !el || !product) return;

      // Position below the scaled window (per-product offset for non-rectangular shapes)
      const visualHeight = el.offsetHeight * CAROUSEL_SCALE;
      const gap = 20 + (product.labelGap || 0);
      label.style.left = pos.x + 'px';
      label.style.top = (pos.y + visualHeight / 2 + gap) + 'px';
    });
  }

  function hideLabels() {
    labelsVisible = false;
    const container = document.getElementById('carousel-labels');
    if (container) container.classList.add('labels-hidden');
  }

  function showLabels() {
    labelsVisible = true;
    const container = document.getElementById('carousel-labels');
    if (container) container.classList.remove('labels-hidden');
  }

  // --- Background ---
  function transitionBackground(color) {
    const bg = document.getElementById('site-bg');
    if (bg) bg.style.backgroundColor = color;
  }

  // --- 3D Tilt on carousel windows ---
  // Smooth, organic sway — lerps toward target instead of snapping.
  // Each instrument tracks its own state and eases independently.
  function initTiltEffect() {
    // Per-product animation state
    const tiltState = {};
    PRODUCTS.forEach(p => {
      tiltState[p.id] = {
        // Current (rendered) values — what you see
        rotX: 0, rotY: 0, lift: 0, brightness: 0.85, saturate: 0.8,
        // Target values — where the mouse wants it
        tRotX: 0, tRotY: 0, tLift: 0, tBrightness: 0.85, tSaturate: 0.8,
        hovering: false
      };
    });

    // Mouse updates targets only — no direct DOM writes
    document.addEventListener('mousemove', (e) => {
      if (WindowManager.getActive() && WindowManager.isOpen(WindowManager.getActive())) return;

      PRODUCTS.forEach(product => {
        const el = WindowManager.getEl(product.id);
        if (!el) return;
        const s = tiltState[product.id];

        const rect = el.getBoundingClientRect();
        const pad = 20;
        const isOver = e.clientX >= rect.left - pad && e.clientX <= rect.right + pad &&
                       e.clientY >= rect.top - pad && e.clientY <= rect.bottom + pad;

        if (isOver) {
          s.hovering = true;
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          const dx = e.clientX - cx;
          const dy = e.clientY - cy;

          const maxTilt = 5;
          s.tRotY = (dx / rect.width) * maxTilt * 2;
          s.tRotX = -(dy / rect.height) * maxTilt * 2;

          const distFromCenter = Math.sqrt(dx * dx + dy * dy);
          const maxDist = Math.sqrt(rect.width * rect.width + rect.height * rect.height) / 2;
          const factor = 1 - Math.min(distFromCenter / maxDist, 1);
          s.tLift = factor * 4;
          s.tBrightness = 1 + factor * 0.18;
          s.tSaturate = 1 + factor * 0.12;
        } else {
          s.hovering = false;
          s.tRotX = 0;
          s.tRotY = 0;
          s.tLift = 0;
          s.tBrightness = 0.85;
          s.tSaturate = 0.8;
        }
      });
    });

    // Also clear targets when mouse leaves the window entirely
    document.addEventListener('mouseleave', () => {
      PRODUCTS.forEach(p => {
        const s = tiltState[p.id];
        s.hovering = false;
        s.tRotX = 0; s.tRotY = 0; s.tLift = 0;
        s.tBrightness = 0.85; s.tSaturate = 0.8;
      });
    });

    // Animation loop — lerp current toward target
    let animating = false;
    function tick() {
      if (WindowManager.getActive() && WindowManager.isOpen(WindowManager.getActive())) {
        animating = false;
        return;
      }

      let needsFrame = false;

      PRODUCTS.forEach(product => {
        const el = WindowManager.getEl(product.id);
        if (!el) return;
        const s = tiltState[product.id];

        // Different easing speeds — approach fast, settle slow (like muscle)
        const ease = s.hovering ? 0.08 : 0.05;

        s.rotX += (s.tRotX - s.rotX) * ease;
        s.rotY += (s.tRotY - s.rotY) * ease;
        s.lift += (s.tLift - s.lift) * ease;
        s.brightness += (s.tBrightness - s.brightness) * ease;
        s.saturate += (s.tSaturate - s.saturate) * ease;

        // Check if still moving (threshold to stop the loop when idle)
        const moving = Math.abs(s.tRotX - s.rotX) > 0.01 ||
                       Math.abs(s.tRotY - s.rotY) > 0.01 ||
                       Math.abs(s.tLift - s.lift) > 0.01 ||
                       Math.abs(s.tBrightness - s.brightness) > 0.001 ||
                       Math.abs(s.tSaturate - s.saturate) > 0.001;

        if (moving) needsFrame = true;

        // Apply
        el.style.transform = `translate(-50%, -50%) scale(${CAROUSEL_SCALE}) perspective(800px) rotateX(${s.rotX}deg) rotateY(${s.rotY}deg) translateZ(${s.lift}px)`;
        el.style.filter = `brightness(${s.brightness}) saturate(${s.saturate})`;

        // Glow class with hysteresis — add above 0.9 brightness, remove below 0.87
        if (s.brightness > 0.9 && !el.classList.contains('hover-glow')) {
          el.classList.add('hover-glow');
        } else if (s.brightness <= 0.87 && el.classList.contains('hover-glow')) {
          el.classList.remove('hover-glow');
        }
      });

      if (needsFrame) {
        requestAnimationFrame(tick);
      } else {
        animating = false;
      }
    }

    // Kick the animation loop whenever the mouse moves
    document.addEventListener('mousemove', () => {
      if (!animating) {
        animating = true;
        requestAnimationFrame(tick);
      }
    });
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => Site.init());
