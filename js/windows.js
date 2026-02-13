// windows.js — Window manager (state + drag + events)
// Visual transitions handled by site.js
const WindowManager = (() => {
  const windows = new Map();
  let topZ = 100;
  let activeId = null;

  const listeners = { focus: [], close: [], open: [] };
  function on(event, fn) { listeners[event].push(fn); }
  function emit(event, data) { listeners[event].forEach(fn => fn(data)); }

  function register(id, options = {}) {
    const el = document.getElementById(`wm-${id}`);
    if (!el) return;

    const win = { el, options, isOpen: false };
    windows.set(id, win);

    // Close button
    el.querySelector('.wm-close')?.addEventListener('click', (e) => {
      e.stopPropagation();
      close(id);
    });

    // Focus on mousedown (only when open)
    el.addEventListener('mousedown', () => {
      if (win.isOpen) focus(id);
    });

    // Click to open (only when NOT open — carousel mode)
    el.addEventListener('click', (e) => {
      if (!win.isOpen && !e.target.closest('.wm-btn')) {
        open(id);
      }
    });

    // Drag (only when open)
    const titlebar = el.querySelector('.wm-titlebar');
    if (titlebar) initDrag(id, el, titlebar);
  }

  function open(id) {
    const win = windows.get(id);
    if (!win || win.isOpen) return;
    win.isOpen = true;
    focus(id);
    emit('open', { id });
  }

  function close(id) {
    const win = windows.get(id);
    if (!win || !win.isOpen) return;
    win.isOpen = false;
    if (activeId === id) activeId = null;
    emit('close', { id });
  }

  function focus(id) {
    if (activeId === id) return;
    const win = windows.get(id);
    if (!win) return;
    win.el.style.zIndex = ++topZ;
    windows.forEach((w, wid) => {
      w.el.classList.toggle('wm-focused', wid === id);
    });
    activeId = id;
    emit('focus', { id });
  }

  function isOpen(id) {
    return windows.get(id)?.isOpen || false;
  }

  function getEl(id) {
    return windows.get(id)?.el;
  }

  // --- Drag (only when window is open) ---
  function initDrag(id, winEl, handle) {
    let dragging = false;
    let startX, startY, origLeft, origTop;

    handle.addEventListener('mousedown', (e) => {
      const win = windows.get(id);
      if (!win?.isOpen) return;
      if (e.target.closest('.wm-btn')) return;

      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = winEl.getBoundingClientRect();
      origLeft = rect.left + rect.width / 2;
      origTop = rect.top + rect.height / 2;
      winEl.classList.add('wm-dragging');
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      winEl.style.left = (origLeft + dx) + 'px';
      winEl.style.top = (origTop + dy) + 'px';
      winEl.style.transform = 'translate(-50%, -50%) scale(1)';
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      winEl.classList.remove('wm-dragging');
    });
  }

  return {
    register, open, close, focus, isOpen, getEl, on,
    getActive: () => activeId,
    getWindows: () => windows
  };
})();
