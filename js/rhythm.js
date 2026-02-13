// rhythm.js — Drum synth + pattern sequencer with look-ahead scheduling
const Rhythm = (() => {
  let playing = false;
  let tempo = 120;
  let volume = 0.6;
  let currentStep = 0;
  let currentPattern = 'rock';
  let lookaheadTimer = null;
  let nextStepTime = 0;
  let metronomeOn = false;
  let countInCallback = null; // called when count-in finishes
  let countInStep = -1;       // -1 = not counting in
  let countInTotal = 0;
  const SCHEDULE_AHEAD = 0.1; // seconds
  const LOOKAHEAD_MS = 25;    // ms

  // Patterns: each step has [kick, snare, hihat_closed, hihat_open, clap, rim]
  // 1 = hit, 0 = rest. 16 steps (or 12 for waltz)
  const PATTERNS = {
    rock: {
      steps: 16, timeSignature: '4/4',
      kick:   [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
      snare:  [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      hihat:  [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
      ohihat: [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,1],
      clap:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
      rim:    [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0]
    },
    '16beat': {
      steps: 16, timeSignature: '4/4',
      kick:   [1,0,0,0, 0,0,0,0, 1,0,1,0, 0,0,0,0],
      snare:  [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      hihat:  [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1],
      ohihat: [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
      clap:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
      rim:    [0,0,0,0, 0,0,1,0, 0,0,0,0, 0,0,1,0]
    },
    waltz: {
      steps: 12, timeSignature: '3/4',
      kick:   [1,0,0,0, 0,0,0,0, 0,0,0,0],
      snare:  [0,0,0,0, 1,0,0,0, 1,0,0,0],
      hihat:  [1,0,1,0, 1,0,1,0, 1,0,1,0],
      ohihat: [0,0,0,0, 0,0,0,0, 0,0,0,0],
      clap:   [0,0,0,0, 0,0,0,0, 0,0,0,0],
      rim:    [0,0,0,0, 0,0,0,0, 0,0,0,0]
    },
    bossa: {
      steps: 16, timeSignature: '4/4',
      kick:   [1,0,0,0, 0,0,1,0, 0,0,1,0, 0,0,0,0],
      snare:  [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
      hihat:  [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
      ohihat: [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
      clap:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
      rim:    [0,0,0,1, 0,0,0,1, 0,0,0,1, 0,0,0,1]
    },
    samba: {
      steps: 16, timeSignature: '4/4',
      kick:   [1,0,0,0, 0,0,1,0, 1,0,0,0, 0,0,1,0],
      snare:  [0,0,0,0, 1,0,0,1, 0,0,0,0, 1,0,0,1],
      hihat:  [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1],
      ohihat: [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
      clap:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
      rim:    [0,1,0,1, 0,0,0,1, 0,1,0,1, 0,0,0,1]
    },
    swing: {
      steps: 16, timeSignature: '4/4',
      kick:   [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
      snare:  [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      hihat:  [1,0,0,1, 0,0,1,0, 0,1,0,0, 1,0,0,1],
      ohihat: [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
      clap:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
      rim:    [0,0,1,0, 0,0,0,0, 0,0,1,0, 0,0,0,0]
    },
    march: {
      steps: 16, timeSignature: '4/4',
      kick:   [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],
      snare:  [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0],
      hihat:  [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
      ohihat: [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
      clap:   [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
      rim:    [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,1]
    },
    disco: {
      steps: 16, timeSignature: '4/4',
      kick:   [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],
      snare:  [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      hihat:  [1,1,1,1, 1,1,1,1, 1,1,1,1, 1,1,1,1],
      ohihat: [0,0,0,1, 0,0,0,1, 0,0,0,1, 0,0,0,1],
      clap:   [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      rim:    [0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0]
    }
  };

  function getStepDuration() {
    // One step = one 16th note
    return 60 / tempo / 4;
  }

  function getPatternSteps() {
    return PATTERNS[currentPattern]?.steps || 16;
  }

  function scheduler() {
    const ctx = Audio.getContext();
    if (!ctx) return;

    while (nextStepTime < ctx.currentTime + SCHEDULE_AHEAD) {
      scheduleStep(currentStep, nextStepTime);
      nextStepTime += getStepDuration();
      currentStep = (currentStep + 1) % getPatternSteps();
    }
  }

  function scheduleStep(step, time) {
    const p = PATTERNS[currentPattern];
    if (!p) return;

    // Metronome: click on each beat (every 4 steps for 4/4, every 4 steps for 3/4)
    const stepsPerBeat = 4; // 16th notes per beat
    if (metronomeOn && step % stepsPerBeat === 0) {
      const beatInBar = step / stepsPerBeat;
      Audio.playMetronomeClick(time, beatInBar === 0); // accent beat 1
    }

    const vol = volume;
    if (p.kick[step])   Audio.playKick(time, vol);
    if (p.snare[step])  Audio.playSnare(time, vol * 0.8);
    if (p.hihat[step])  Audio.playHihat(time, false, vol * 0.5);
    if (p.ohihat[step]) Audio.playHihat(time, true, vol * 0.5);
    if (p.clap[step])   Audio.playClap(time, vol * 0.6);
    if (p.rim[step])    Audio.playRim(time, vol * 0.5);

    // MIDI drum output (channel 10)
    const drumMap = { kick: 36, snare: 38, hihat: 42, ohihat: 46, clap: 39, rim: 37 };
    if (p.kick[step])   MIDI.sendNoteOn(10, drumMap.kick, Math.round(vol * 100));
    if (p.snare[step])  MIDI.sendNoteOn(10, drumMap.snare, Math.round(vol * 80));
    if (p.hihat[step])  MIDI.sendNoteOn(10, drumMap.hihat, Math.round(vol * 60));
    if (p.ohihat[step]) MIDI.sendNoteOn(10, drumMap.ohihat, Math.round(vol * 60));
    if (p.clap[step])   MIDI.sendNoteOn(10, drumMap.clap, Math.round(vol * 70));
    if (p.rim[step])    MIDI.sendNoteOn(10, drumMap.rim, Math.round(vol * 60));

    // Visual beat indicator update
    requestAnimationFrame(() => updateBeatIndicator(step));

    // Count-in: fire callback when we reach bar boundary after count-in
    if (countInCallback && step === 0) {
      if (countInStep > 0) {
        countInStep--; // skip this bar boundary (it's the starting point)
      } else {
        const cb = countInCallback;
        countInCallback = null;
        countInStep = -1;
        setTimeout(cb, 0); // fire after this scheduling cycle
      }
    }
  }

  function start() {
    if (playing) return;
    const ctx = Audio.getContext();
    if (!ctx) return;
    playing = true;
    currentStep = 0;
    nextStepTime = ctx.currentTime;
    lookaheadTimer = setInterval(scheduler, LOOKAHEAD_MS);
  }

  function stop() {
    if (!playing) return;
    playing = false;
    clearInterval(lookaheadTimer);
    lookaheadTimer = null;
    currentStep = 0;
    updateBeatIndicator(-1);
  }

  function toggle() {
    if (playing) stop(); else start();
    return playing;
  }

  function setTempo(bpm) {
    tempo = Math.max(60, Math.min(200, bpm));
  }

  function getTempo() { return tempo; }

  function setVolume(val) {
    volume = Math.max(0, Math.min(1, val));
  }

  function setPattern(name) {
    if (PATTERNS[name]) {
      currentPattern = name;
      if (playing) {
        currentStep = currentStep % getPatternSteps();
      }
    }
  }

  function isPlaying() { return playing; }
  function getCurrentStep() { return currentStep; }
  function getPatternNames() { return Object.keys(PATTERNS); }

  function toggleMetronome() {
    metronomeOn = !metronomeOn;
    return metronomeOn;
  }

  function isMetronomeOn() { return metronomeOn; }

  // Count-in: enable metronome, wait until the next bar boundary (step 0), then fire callback.
  // If rhythm is not playing, starts it. The first full bar serves as the audible count-in.
  function startCountIn(beatsCount, callback) {
    const wasMetronomeOn = metronomeOn;
    metronomeOn = true; // always click during count-in

    const wasPlaying = playing;
    if (!playing) {
      start();
    }

    // If we just called start(), it begins at step 0 immediately.
    // Skip that first step-0 so the full bar plays as count-in.
    // If already playing, fire on the next natural step 0 (bar boundary).
    countInStep = wasPlaying ? 0 : 1;
    countInCallback = () => {
      if (!wasMetronomeOn) metronomeOn = false;
      callback();
    };
  }

  function updateBeatIndicator(step) {
    const dots = document.querySelectorAll('.beat-dot');
    dots.forEach((dot, i) => {
      dot.classList.toggle('current', i === step);
      // Also show which steps have hits
      const p = PATTERNS[currentPattern];
      if (p && i < p.steps) {
        const hasHit = p.kick[i] || p.snare[i] || p.clap[i];
        dot.classList.toggle('active', hasHit);
      }
    });
  }

  function getBeatsPerBar() {
    const p = PATTERNS[currentPattern];
    if (!p) return 4;
    return p.timeSignature === '3/4' ? 3 : 4;
  }

  function getBarDuration() {
    return getBeatsPerBar() * (60 / tempo);
  }

  return {
    start, stop, toggle, setTempo, getTempo, setVolume, setPattern,
    isPlaying, getCurrentStep, getPatternSteps, getPatternNames,
    getBeatsPerBar, getBarDuration,
    toggleMetronome, isMetronomeOn, startCountIn
  };
})();
