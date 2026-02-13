// recorder.js — Loop recorder: audio capture + MIDI log + visual timeline
const Recorder = (() => {
  let state = 'idle'; // idle | recording | overdub | playing
  let mediaRecorder = null;
  let audioChunks = [];
  let audioBlob = null;
  let audioUrl = null;
  let audioElement = null;
  let eventLog = [];         // timestamped MIDI events
  let recordStartTime = 0;
  let loopLengthBars = 4;
  let loopDurationMs = 0;    // calculated or free
  let playbackStart = 0;
  let playbackFrame = null;
  let canvas = null;
  let canvasCtx = null;

  // Overdub layers
  let layers = [];  // [{blob, events}]

  function init() {
    canvas = document.getElementById('timeline-canvas');
    if (canvas) {
      const rect = canvas.parentElement.getBoundingClientRect();
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      canvasCtx = canvas.getContext('2d');
      canvasCtx.scale(window.devicePixelRatio, window.devicePixelRatio);
    }
    window.addEventListener('resize', resizeCanvas);
  }

  function resizeCanvas() {
    if (!canvas) return;
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    canvasCtx = canvas.getContext('2d');
    canvasCtx.scale(window.devicePixelRatio, window.devicePixelRatio);
    drawTimeline();
  }

  function setLoopLength(bars) {
    if (bars === 'free') {
      loopLengthBars = 0;
      loopDurationMs = 0;
    } else {
      loopLengthBars = parseInt(bars);
      loopDurationMs = loopLengthBars * Rhythm.getBarDuration() * 1000;
    }
  }

  function startRecording() {
    if (state === 'recording' || state === 'counting-in') return;
    const stream = Audio.getMediaStream();
    if (!stream) return;

    // If rhythm is playing (or we start it), do a count-in first
    state = 'counting-in';
    updateUI();

    Rhythm.startCountIn(null, () => {
      // Count-in finished — now actually start recording on the bar boundary
      actuallyStartRecording(stream);
    });
  }

  function actuallyStartRecording(stream) {
    state = 'recording';
    eventLog = [];
    audioChunks = [];
    recordStartTime = performance.now();

    if (loopLengthBars > 0) {
      loopDurationMs = loopLengthBars * Rhythm.getBarDuration() * 1000;
    }

    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    mediaRecorder.ondataavailable = e => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };
    mediaRecorder.onstop = onRecordingStop;
    mediaRecorder.start(100); // 100ms chunks

    // Auto-stop at loop end if not free
    if (loopDurationMs > 0) {
      setTimeout(() => {
        if (state === 'recording') stopRecording();
      }, loopDurationMs);
    }

    updateUI();
    startPlaybackAnimation();
  }

  function startOverdub() {
    if (!audioBlob && layers.length === 0) {
      startRecording();
      return;
    }

    state = 'overdub';
    eventLog = [];
    audioChunks = [];
    recordStartTime = performance.now();

    const stream = Audio.getMediaStream();
    if (!stream) return;

    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    mediaRecorder.ondataavailable = e => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };
    mediaRecorder.onstop = onOverdubStop;
    mediaRecorder.start(100);

    // Play existing loop while overdubbing
    playLoop();

    if (loopDurationMs > 0) {
      setTimeout(() => {
        if (state === 'overdub') stopRecording();
      }, loopDurationMs);
    }

    updateUI();
  }

  function stopRecording() {
    if (state === 'counting-in') {
      state = 'idle';
      updateUI();
      return;
    }
    if (state !== 'recording' && state !== 'overdub') return;
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
  }

  function onRecordingStop() {
    if (loopDurationMs === 0) {
      loopDurationMs = performance.now() - recordStartTime;
    }
    audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
    layers = [{ blob: audioBlob, events: [...eventLog] }];
    state = 'idle';
    updateUI();
    drawTimeline();
  }

  function onOverdubStop() {
    const newBlob = new Blob(audioChunks, { type: 'audio/webm' });
    layers.push({ blob: newBlob, events: [...eventLog] });
    audioBlob = newBlob; // Latest layer (for simple playback we'd mix them)
    state = 'idle';
    if (audioElement) {
      audioElement.pause();
      audioElement = null;
    }
    updateUI();
    drawTimeline();
  }

  function logEvent(type, data) {
    if (state !== 'recording' && state !== 'overdub') return;
    const time = performance.now() - recordStartTime;
    eventLog.push({ time, type, ...data });
  }

  function playLoop() {
    if (layers.length === 0) return;
    state = 'playing';

    // Play all layers simultaneously
    layers.forEach(layer => {
      const url = URL.createObjectURL(layer.blob);
      const audio = new window.Audio(url);
      audio.loop = true;
      audio.play();
      // Store reference for cleanup
      if (!audioElement) audioElement = audio;
    });

    playbackStart = performance.now();
    updateUI();
    startPlaybackAnimation();
  }

  function stopPlayback() {
    state = 'idle';
    if (audioElement) {
      audioElement.pause();
      audioElement.currentTime = 0;
      audioElement = null;
    }
    cancelAnimationFrame(playbackFrame);
    updateUI();
    drawTimeline();
  }

  function clear() {
    stopPlayback();
    layers = [];
    eventLog = [];
    audioBlob = null;
    audioChunks = [];
    loopDurationMs = 0;
    state = 'idle';
    updateUI();
    drawTimeline();
  }

  function startPlaybackAnimation() {
    function frame() {
      if (state === 'idle') return;
      playbackFrame = requestAnimationFrame(frame);
      updatePlaybackHead();
      drawTimeline();
    }
    playbackFrame = requestAnimationFrame(frame);
  }

  function updatePlaybackHead() {
    const head = document.getElementById('playback-head');
    if (!head || loopDurationMs === 0) return;

    const elapsed = performance.now() - (state === 'recording' || state === 'overdub' ? recordStartTime : playbackStart);
    const progress = loopDurationMs > 0 ? (elapsed % loopDurationMs) / loopDurationMs : 0;
    head.style.left = (progress * 100) + '%';
  }

  function drawTimeline() {
    if (!canvasCtx || !canvas) return;
    const w = canvas.parentElement.getBoundingClientRect().width;
    const h = canvas.parentElement.getBoundingClientRect().height;
    canvasCtx.clearRect(0, 0, w, h);

    if (loopDurationMs === 0 && layers.length === 0) return;
    const dur = loopDurationMs || 1;

    // Draw all events from all layers
    const noteColor = getComputedStyle(document.documentElement).getPropertyValue('--timeline-note').trim() || '#e94560';
    const allEvents = layers.flatMap(l => l.events);

    allEvents.forEach(evt => {
      if (evt.midi === undefined) return;
      const x = (evt.time / dur) * w;
      // Map MIDI note to vertical position (36-96 range)
      const yRatio = 1 - ((evt.midi - 36) / 60);
      const y = Math.max(2, Math.min(h - 4, yRatio * h));
      const vel = (evt.velocity || 64) / 127;

      canvasCtx.globalAlpha = 0.4 + vel * 0.6;
      canvasCtx.fillStyle = noteColor;
      canvasCtx.fillRect(x, y, 3, 3);
    });
    canvasCtx.globalAlpha = 1;

    // Bar lines
    if (loopLengthBars > 0) {
      canvasCtx.strokeStyle = 'rgba(255,255,255,0.1)';
      canvasCtx.lineWidth = 1;
      for (let i = 1; i < loopLengthBars; i++) {
        const x = (i / loopLengthBars) * w;
        canvasCtx.beginPath();
        canvasCtx.moveTo(x, 0);
        canvasCtx.lineTo(x, h);
        canvasCtx.stroke();
      }
    }
  }

  // --- Export WAV ---
  async function exportWAV() {
    if (layers.length === 0) return;

    // Decode the first layer to AudioBuffer for WAV export
    const ctx = Audio.getContext();
    const arrayBuffer = await layers[0].blob.arrayBuffer();
    let audioBuffer;
    try {
      audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    } catch (e) {
      console.warn('Could not decode audio for WAV export:', e);
      return;
    }

    const wav = audioBufferToWav(audioBuffer);
    const blob = new Blob([wav], { type: 'audio/wav' });
    downloadBlob(blob, 'omnichord-loop.wav');
  }

  function audioBufferToWav(buffer) {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const format = 1; // PCM
    const bitsPerSample = 16;

    // Interleave channels
    let interleaved;
    if (numChannels === 2) {
      const left = buffer.getChannelData(0);
      const right = buffer.getChannelData(1);
      interleaved = new Float32Array(left.length + right.length);
      for (let i = 0; i < left.length; i++) {
        interleaved[i * 2] = left[i];
        interleaved[i * 2 + 1] = right[i];
      }
    } else {
      interleaved = buffer.getChannelData(0);
    }

    const dataLength = interleaved.length * (bitsPerSample / 8);
    const headerLength = 44;
    const arrayBuffer = new ArrayBuffer(headerLength + dataLength);
    const view = new DataView(arrayBuffer);

    // WAV header
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * bitsPerSample / 8, true);
    view.setUint16(32, numChannels * bitsPerSample / 8, true);
    view.setUint16(34, bitsPerSample, true);
    writeString(view, 36, 'data');
    view.setUint32(40, dataLength, true);

    // Write samples
    let offset = 44;
    for (let i = 0; i < interleaved.length; i++) {
      const s = Math.max(-1, Math.min(1, interleaved[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      offset += 2;
    }

    return arrayBuffer;
  }

  function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  // --- Export MIDI ---
  function exportMIDI() {
    const allEvents = layers.flatMap(l => l.events);
    if (allEvents.length === 0) return;

    const midi = buildMidiFile(allEvents, loopDurationMs);
    const blob = new Blob([midi], { type: 'audio/midi' });
    downloadBlob(blob, 'omnichord-loop.mid');
  }

  function buildMidiFile(events, durationMs) {
    const ticksPerBeat = 480;
    const tempo = Rhythm.getTempo();
    const msPerTick = (60000 / tempo) / ticksPerBeat;

    // Sort by time
    const sorted = [...events].sort((a, b) => a.time - b.time);

    // Build track data
    const trackData = [];
    let lastTick = 0;

    sorted.forEach(evt => {
      if (evt.midi === undefined) return;
      const tick = Math.round(evt.time / msPerTick);
      const delta = tick - lastTick;
      lastTick = tick;

      // Variable-length delta time
      trackData.push(...writeVarLen(delta));
      // Note-on
      const channel = (evt.channel || 1) - 1;
      trackData.push(0x90 | channel);
      trackData.push(evt.midi & 0x7F);
      trackData.push((evt.velocity || 64) & 0x7F);

      // Note-off after short duration
      const noteDur = Math.round(200 / msPerTick); // 200ms
      trackData.push(...writeVarLen(noteDur));
      trackData.push(0x80 | channel);
      trackData.push(evt.midi & 0x7F);
      trackData.push(0);
    });

    // End of track
    trackData.push(0x00, 0xFF, 0x2F, 0x00);

    // Set tempo meta event
    const tempoMicro = Math.round(60000000 / tempo);
    const tempoBytes = [
      0x00, 0xFF, 0x51, 0x03,
      (tempoMicro >> 16) & 0xFF,
      (tempoMicro >> 8) & 0xFF,
      tempoMicro & 0xFF
    ];

    const fullTrack = [...tempoBytes, ...trackData];

    // Build file
    const header = [
      0x4D, 0x54, 0x68, 0x64, // MThd
      0x00, 0x00, 0x00, 0x06, // header length
      0x00, 0x00,             // format 0
      0x00, 0x01,             // 1 track
      (ticksPerBeat >> 8) & 0xFF, ticksPerBeat & 0xFF
    ];

    const trackHeader = [
      0x4D, 0x54, 0x72, 0x6B, // MTrk
      (fullTrack.length >> 24) & 0xFF,
      (fullTrack.length >> 16) & 0xFF,
      (fullTrack.length >> 8) & 0xFF,
      fullTrack.length & 0xFF
    ];

    return new Uint8Array([...header, ...trackHeader, ...fullTrack]);
  }

  function writeVarLen(value) {
    const bytes = [];
    let v = value & 0x7F;
    bytes.unshift(v);
    value >>= 7;
    while (value > 0) {
      v = (value & 0x7F) | 0x80;
      bytes.unshift(v);
      value >>= 7;
    }
    return bytes;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function getState() { return state; }

  function updateUI() {
    const recBtn = document.getElementById('rec-record');
    const odBtn = document.getElementById('rec-overdub');
    if (recBtn) {
      recBtn.classList.toggle('recording', state === 'recording');
      recBtn.classList.toggle('counting-in', state === 'counting-in');
    }
    if (odBtn) odBtn.classList.toggle('recording', state === 'overdub');
  }

  return {
    init, startRecording, startOverdub, stopRecording, playLoop,
    stopPlayback, clear, logEvent, exportWAV, exportMIDI,
    setLoopLength, getState, drawTimeline
  };
})();
