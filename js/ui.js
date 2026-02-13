// ui.js — DOM wiring, state, visual feedback, keyboard shortcuts
const UI = (() => {
  let audioStarted = false;

  function init() {
    // Build visual elements immediately so the instrument looks alive in carousel
    buildChordGrid();
    buildBeatIndicator();

    // Audio start overlay — fallback if opened standalone
    const overlay = document.getElementById('audio-start-overlay');
    if (overlay) {
      overlay.addEventListener('click', startAudio);
      overlay.addEventListener('touchstart', startAudio);
    }
  }

  async function startAudio() {
    if (audioStarted) return;
    audioStarted = true;

    const overlay = document.getElementById('audio-start-overlay');
    if (overlay) {
      overlay.classList.add('fade-out');
      setTimeout(() => overlay.classList.add('hidden'), 400);
    }

    // Initialize all systems (visuals already built in init)
    Audio.init();
    Theme.init();
    Strings.init();
    Recorder.init();
    wireRhythmControls();
    wireRecorderControls();
    wireStringsControls();
    wireKeyboard();
    wireShortcutsOverlay();
    await MIDI.init();
    wireMIDIControls();
  }

  // --- Chord Grid ---
  function buildChordGrid() {
    const grid = document.getElementById('chord-grid');
    grid.innerHTML = '';
    const noteNames = Chords.getNoteNames();
    const types = Chords.getTypes(); // ['maj', 'min', 'sev']
    const typeLabels = { maj: 'MAJ', min: 'MIN', sev: '7TH' };

    types.forEach(type => {
      // Row label
      const label = document.createElement('div');
      label.className = 'chord-row-label';
      label.textContent = typeLabels[type];
      grid.appendChild(label);

      // 12 buttons
      noteNames.forEach(name => {
        const key = `${name}_${type}`;
        const chord = Chords.get(key);

        const btn = document.createElement('button');
        btn.className = `chord-btn ${type}`;
        btn.textContent = chord.label;
        btn.dataset.chord = key;

        // Click to toggle — select chord, click again to deselect
        btn.addEventListener('click', e => {
          e.preventDefault();
          toggleChord(key, btn);
        });
        // Prevent text selection on touch
        btn.addEventListener('touchstart', e => e.preventDefault());

        grid.appendChild(btn);
      });
    });
  }

  let activeChordBtn = null;
  let activeChordKey = null;

  function toggleChord(key, btn) {
    if (activeChordKey === key) {
      // Same chord — deactivate
      deactivateChord();
    } else {
      // Different chord (or none active) — switch to this one
      activateChord(key, btn);
    }
  }

  function activateChord(key, btn) {
    // Deactivate previous pad sound + MIDI
    if (activeChordBtn) {
      activeChordBtn.classList.remove('active');
      const prevChord = Chords.getActive();
      if (prevChord) {
        prevChord.padMidi.forEach(midi => MIDI.sendNoteOff(2, midi));
      }
      Audio.stopChordPad();
    }

    btn.classList.add('active');
    activeChordBtn = btn;
    activeChordKey = key;

    const chord = Chords.setActive(key);
    if (chord) {
      Audio.playChordPad(chord.padFreqs);

      // MIDI chord output (channel 2)
      chord.padMidi.forEach(midi => {
        MIDI.sendNoteOn(2, midi, 80);
      });

      // Recorder
      Recorder.logEvent('chord', { channel: 2, chord: key, midi: chord.padMidi });
    }
  }

  function deactivateChord() {
    if (!activeChordBtn) return;
    activeChordBtn.classList.remove('active');
    Audio.stopChordPad();

    const chord = Chords.getActive();
    if (chord) {
      chord.padMidi.forEach(midi => {
        MIDI.sendNoteOff(2, midi);
      });
    }
    activeChordBtn = null;
    activeChordKey = null;
    // Don't clear Chords.active — strings still use last selected chord
  }

  // --- Beat Indicator ---
  function buildBeatIndicator() {
    const container = document.getElementById('beat-indicator');
    container.innerHTML = '';
    for (let i = 0; i < 16; i++) {
      const dot = document.createElement('div');
      dot.className = 'beat-dot';
      container.appendChild(dot);
    }
  }

  // --- Rhythm Controls ---
  function wireRhythmControls() {
    const startStop = document.getElementById('rhythm-start-stop');
    const tempoSlider = document.getElementById('rhythm-tempo');
    const tempoDisplay = document.getElementById('tempo-display');
    const volumeSlider = document.getElementById('rhythm-volume');
    const patternSelect = document.getElementById('rhythm-pattern');
    const metBtn = document.getElementById('metronome-btn');

    metBtn.addEventListener('click', () => {
      const on = Rhythm.toggleMetronome();
      metBtn.classList.toggle('active', on);
    });

    startStop.addEventListener('click', () => {
      const playing = Rhythm.toggle();
      startStop.classList.toggle('playing', playing);
      startStop.innerHTML = playing ? '&#9632;' : '&#9654;';
    });

    tempoSlider.addEventListener('input', () => {
      Rhythm.setTempo(parseInt(tempoSlider.value));
      tempoDisplay.textContent = tempoSlider.value;
    });

    volumeSlider.addEventListener('input', () => {
      Rhythm.setVolume(parseInt(volumeSlider.value) / 100);
    });

    patternSelect.addEventListener('change', () => {
      Rhythm.setPattern(patternSelect.value);
      // Update beat indicator count
      const steps = Rhythm.getPatternSteps();
      const container = document.getElementById('beat-indicator');
      container.innerHTML = '';
      for (let i = 0; i < steps; i++) {
        const dot = document.createElement('div');
        dot.className = 'beat-dot';
        container.appendChild(dot);
      }
    });
  }

  // --- Recorder Controls ---
  function wireRecorderControls() {
    document.getElementById('rec-record').addEventListener('click', () => {
      const recState = Recorder.getState();
      if (recState === 'recording' || recState === 'counting-in') {
        Recorder.stopRecording();
      } else {
        Recorder.startRecording();
      }
    });

    document.getElementById('rec-overdub').addEventListener('click', () => {
      if (Recorder.getState() === 'overdub') {
        Recorder.stopRecording();
      } else {
        Recorder.startOverdub();
      }
    });

    document.getElementById('rec-play').addEventListener('click', () => {
      Recorder.playLoop();
    });

    document.getElementById('rec-stop').addEventListener('click', () => {
      Recorder.stopPlayback();
    });

    document.getElementById('rec-clear').addEventListener('click', () => {
      Recorder.clear();
    });

    document.getElementById('rec-loop-length').addEventListener('change', e => {
      Recorder.setLoopLength(e.target.value);
    });

    document.getElementById('rec-export-wav').addEventListener('click', () => {
      Recorder.exportWAV();
    });

    document.getElementById('rec-export-midi').addEventListener('click', () => {
      Recorder.exportMIDI();
    });
  }

  // --- Strings Controls ---
  function wireStringsControls() {
    document.getElementById('strings-volume').addEventListener('input', e => {
      Strings.setVolume(parseInt(e.target.value) / 100);
    });

    document.getElementById('strings-reverb').addEventListener('input', e => {
      Audio.setReverbAmount(parseInt(e.target.value) / 100);
    });

    // Voice selector
    document.getElementById('strings-voice').addEventListener('change', e => {
      Audio.setVoice(e.target.value);
    });

    // Vibrato button
    const vibBtn = document.getElementById('vibrato-btn');
    vibBtn.addEventListener('click', () => {
      const on = !Audio.getVibratoEnabled();
      Audio.setVibratoEnabled(on);
      vibBtn.classList.toggle('active', on);
    });

    // Sustain slider
    document.getElementById('strings-sustain').addEventListener('input', e => {
      Audio.setSustain(parseInt(e.target.value) / 100);
    });
  }

  // --- MIDI Controls ---
  function wireMIDIControls() {
    document.getElementById('midi-output').addEventListener('change', e => {
      MIDI.selectOutput(e.target.value);
    });

    document.getElementById('midi-input').addEventListener('change', e => {
      MIDI.selectInput(e.target.value);
    });
  }

  // --- Keyboard Shortcuts ---
  function wireKeyboard() {
    const noteNames = Chords.getNoteNames();
    // Keys 1-9,0,-,= → 12 roots
    const rootKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='];
    let currentType = 'maj';
    let currentRootIdx = 0;

    document.addEventListener('keydown', e => {
      if (e.repeat) return;
      const key = e.key;

      // Root selection (toggle)
      const rootIdx = rootKeys.indexOf(key);
      if (rootIdx >= 0) {
        e.preventDefault();
        currentRootIdx = rootIdx;
        const chordKey = `${noteNames[currentRootIdx]}_${currentType}`;
        const btn = document.querySelector(`[data-chord="${chordKey}"]`);
        if (btn) toggleChord(chordKey, btn);
        return;
      }

      // Type selection (toggle)
      if (key === 'q' || key === 'Q') {
        e.preventDefault();
        currentType = 'maj';
        const chordKey = `${noteNames[currentRootIdx]}_${currentType}`;
        const btn = document.querySelector(`[data-chord="${chordKey}"]`);
        if (btn) toggleChord(chordKey, btn);
        return;
      }
      if (key === 'w' || key === 'W') {
        e.preventDefault();
        currentType = 'min';
        const chordKey = `${noteNames[currentRootIdx]}_${currentType}`;
        const btn = document.querySelector(`[data-chord="${chordKey}"]`);
        if (btn) toggleChord(chordKey, btn);
        return;
      }
      if (key === 'e' || key === 'E') {
        e.preventDefault();
        currentType = 'sev';
        const chordKey = `${noteNames[currentRootIdx]}_${currentType}`;
        const btn = document.querySelector(`[data-chord="${chordKey}"]`);
        if (btn) toggleChord(chordKey, btn);
        return;
      }

      // Space → rhythm toggle
      if (key === ' ') {
        e.preventDefault();
        const startStop = document.getElementById('rhythm-start-stop');
        const playing = Rhythm.toggle();
        startStop.classList.toggle('playing', playing);
        startStop.innerHTML = playing ? '&#9632;' : '&#9654;';
        return;
      }

      // R → record
      if (key === 'r' || key === 'R') {
        e.preventDefault();
        const recState = Recorder.getState();
        if (recState === 'recording' || recState === 'counting-in') Recorder.stopRecording();
        else Recorder.startRecording();
        return;
      }

      // P → play loop
      if (key === 'p' || key === 'P') {
        e.preventDefault();
        if (Recorder.getState() === 'playing') Recorder.stopPlayback();
        else Recorder.playLoop();
        return;
      }

      // Up/Down → tempo
      if (key === 'ArrowUp') {
        e.preventDefault();
        const slider = document.getElementById('rhythm-tempo');
        slider.value = Math.min(200, parseInt(slider.value) + 5);
        Rhythm.setTempo(parseInt(slider.value));
        document.getElementById('tempo-display').textContent = slider.value;
        return;
      }
      if (key === 'ArrowDown') {
        e.preventDefault();
        const slider = document.getElementById('rhythm-tempo');
        slider.value = Math.max(60, parseInt(slider.value) - 5);
        Rhythm.setTempo(parseInt(slider.value));
        document.getElementById('tempo-display').textContent = slider.value;
        return;
      }

      // M → metronome toggle
      if (key === 'm' || key === 'M') {
        e.preventDefault();
        const metBtn = document.getElementById('metronome-btn');
        const on = Rhythm.toggleMetronome();
        if (metBtn) metBtn.classList.toggle('active', on);
        return;
      }

      // V → vibrato toggle
      if (key === 'v' || key === 'V') {
        e.preventDefault();
        const vibBtn = document.getElementById('vibrato-btn');
        const on = !Audio.getVibratoEnabled();
        Audio.setVibratoEnabled(on);
        if (vibBtn) vibBtn.classList.toggle('active', on);
        return;
      }

      // ? → shortcuts
      if (key === '?') {
        e.preventDefault();
        toggleShortcuts();
        return;
      }
    });
  }

  // --- Shortcuts Overlay ---
  function wireShortcutsOverlay() {
    document.getElementById('close-shortcuts').addEventListener('click', () => {
      document.getElementById('shortcuts-overlay').classList.add('hidden');
    });
    const helpBtn = document.getElementById('help-btn');
    if (helpBtn) {
      helpBtn.addEventListener('click', toggleShortcuts);
    }
  }

  function toggleShortcuts() {
    document.getElementById('shortcuts-overlay').classList.toggle('hidden');
  }

  return { init, startAudio };
})();

// Boot
document.addEventListener('DOMContentLoaded', () => UI.init());
