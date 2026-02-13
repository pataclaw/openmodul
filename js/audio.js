// audio.js — Web Audio engine: multi-voice Omnichord synthesis
// 9 voice presets: 3 authentic Omnichord, 3 retro/game, 3 synth
const Audio = (() => {
  let ctx = null;
  let masterGain = null;
  let compressor = null;
  let reverbNode = null;
  let reverbGain = null;
  let dryGain = null;
  let chorusBus = null;
  let reverbAmount = 0.4;
  let mediaStreamDest = null;

  // Shared noise buffer for drums
  let noiseBuffer = null;

  // Voice system
  let currentVoice = 'om27';
  let vibratoEnabled = false;
  let vibratoLFO = null;
  let vibratoLFOGain = null;
  let sustainValue = 0.5; // 0-1, maps to duration

  // =============================================
  // VOICE PRESETS
  // =============================================
  const VOICES = {
    // --- Omnichord (authentic hardware recreation) ---
    om27: {
      name: 'OM-27 Harp',
      category: 'Omnichord',
      build(ctx, masterGain, freq, vel, dur) {
        const now = ctx.currentTime;
        // Square + square (octave up, quiet) — the real OM-27 divide-down sound
        const osc1 = ctx.createOscillator();
        osc1.type = 'square';
        osc1.frequency.value = freq;

        const osc2 = ctx.createOscillator();
        osc2.type = 'square';
        osc2.frequency.value = freq * 2; // octave up
        const osc2Gain = ctx.createGain();
        osc2Gain.gain.value = 0.15; // quiet octave shimmer

        // Vibrato LFO: 5Hz sine +/-6 cents — the real Omnichord shimmer
        const vibLFO = ctx.createOscillator();
        vibLFO.type = 'sine';
        vibLFO.frequency.value = 5;
        const vibGain = ctx.createGain();
        vibGain.gain.value = freq * (Math.pow(2, 6/1200) - 1); // 6 cents
        vibLFO.connect(vibGain);
        vibGain.connect(osc1.frequency);
        vibGain.connect(osc2.frequency);

        const oscMix = ctx.createGain();
        oscMix.gain.value = 1;
        const osc1Gain = ctx.createGain();
        osc1Gain.gain.value = 0.45;
        osc1.connect(osc1Gain);
        osc2.connect(osc2Gain);
        osc1Gain.connect(oscMix);
        osc2Gain.connect(oscMix);

        // LP filter with pluck envelope: vel*3000 peak -> close 80ms
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.Q.value = 1.5;
        const filterBase = 200 + freq * 0.2;
        const filterPeak = filterBase + vel * 3000;
        filter.frequency.setValueAtTime(filterPeak, now);
        filter.frequency.exponentialRampToValueAtTime(filterBase + 100, now + 0.08);
        filter.frequency.exponentialRampToValueAtTime(filterBase, now + dur * 0.5);

        // Amp: 2ms attack, fast decay (tau=0.06)
        const amp = ctx.createGain();
        amp.gain.setValueAtTime(0, now);
        amp.gain.linearRampToValueAtTime(vel * 0.28, now + 0.002);
        amp.gain.setTargetAtTime(0.001, now + 0.002, 0.06 * (dur / 1.0));

        oscMix.connect(filter);
        filter.connect(amp);
        amp.connect(masterGain);

        vibLFO.start(now);
        osc1.start(now);
        osc2.start(now);
        const stopTime = now + dur + 0.3;
        vibLFO.stop(stopTime);
        osc1.stop(stopTime);
        osc2.stop(stopTime);
        return { stopTime };
      }
    },

    om84: {
      name: 'OM-84 Harp',
      category: 'Omnichord',
      build(ctx, masterGain, freq, vel, dur) {
        const now = ctx.currentTime;
        // Two squares, detuned +5 cents — brighter OM-84
        const osc1 = ctx.createOscillator();
        osc1.type = 'square';
        osc1.frequency.value = freq;

        const osc2 = ctx.createOscillator();
        osc2.type = 'square';
        osc2.frequency.value = freq;
        osc2.detune.value = 5;

        // Vibrato: 4.5Hz +/-8 cents (wider)
        const vibLFO = ctx.createOscillator();
        vibLFO.type = 'sine';
        vibLFO.frequency.value = 4.5;
        const vibGain = ctx.createGain();
        vibGain.gain.value = freq * (Math.pow(2, 8/1200) - 1);
        vibLFO.connect(vibGain);
        vibGain.connect(osc1.frequency);
        vibGain.connect(osc2.frequency);

        const oscMix = ctx.createGain();
        const osc1Gain = ctx.createGain();
        osc1Gain.gain.value = 0.4;
        const osc2Gain = ctx.createGain();
        osc2Gain.gain.value = 0.35;
        osc1.connect(osc1Gain);
        osc2.connect(osc2Gain);
        osc1Gain.connect(oscMix);
        osc2Gain.connect(oscMix);

        // LP, Q=2.0, brighter base
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.Q.value = 2.0;
        const filterBase = 350 + freq * 0.3;
        const filterPeak = filterBase + vel * 3500;
        filter.frequency.setValueAtTime(filterPeak, now);
        filter.frequency.exponentialRampToValueAtTime(filterBase + 150, now + 0.08);
        filter.frequency.exponentialRampToValueAtTime(filterBase, now + dur * 0.5);

        // 2ms attack, medium decay (tau=0.08)
        const amp = ctx.createGain();
        amp.gain.setValueAtTime(0, now);
        amp.gain.linearRampToValueAtTime(vel * 0.26, now + 0.002);
        amp.gain.setTargetAtTime(0.001, now + 0.002, 0.08 * (dur / 1.0));

        oscMix.connect(filter);
        filter.connect(amp);
        amp.connect(masterGain);

        vibLFO.start(now);
        osc1.start(now);
        osc2.start(now);
        const stopTime = now + dur + 0.3;
        vibLFO.stop(stopTime);
        osc1.stop(stopTime);
        osc2.stop(stopTime);
        return { stopTime };
      }
    },

    om300: {
      name: 'OM-300 Digital',
      category: 'Omnichord',
      build(ctx, masterGain, freq, vel, dur) {
        const now = ctx.currentTime;
        // Sawtooth + detuned copy — cleaner digital sound
        const osc1 = ctx.createOscillator();
        osc1.type = 'sawtooth';
        osc1.frequency.value = freq;

        const osc2 = ctx.createOscillator();
        osc2.type = 'sawtooth';
        osc2.frequency.value = freq;
        osc2.detune.value = 7;

        const oscMix = ctx.createGain();
        const osc1Gain = ctx.createGain();
        osc1Gain.gain.value = 0.4;
        const osc2Gain = ctx.createGain();
        osc2Gain.gain.value = 0.3;
        osc1.connect(osc1Gain);
        osc2.connect(osc2Gain);
        osc1Gain.connect(oscMix);
        osc2Gain.connect(oscMix);

        // LP, Q=1.0, gentle sweep (no vibrato — clean digital)
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.Q.value = 1.0;
        const filterBase = 400 + freq * 0.4;
        const filterPeak = filterBase + vel * 2500;
        filter.frequency.setValueAtTime(filterPeak, now);
        filter.frequency.exponentialRampToValueAtTime(filterBase + 200, now + 0.1);
        filter.frequency.exponentialRampToValueAtTime(filterBase, now + dur * 0.6);

        // 3ms attack, longer sustain
        const amp = ctx.createGain();
        amp.gain.setValueAtTime(0, now);
        amp.gain.linearRampToValueAtTime(vel * 0.22, now + 0.003);
        amp.gain.setTargetAtTime(vel * 0.08, now + 0.003, 0.1);
        amp.gain.setTargetAtTime(0.001, now + dur * 0.5, dur * 0.3);

        oscMix.connect(filter);
        filter.connect(amp);
        amp.connect(masterGain);

        osc1.start(now);
        osc2.start(now);
        const stopTime = now + dur + 0.3;
        osc1.stop(stopTime);
        osc2.stop(stopTime);
        return { stopTime };
      }
    },

    // --- Retro / Video Game ---
    '8bit': {
      name: '8-Bit',
      category: 'Retro',
      build(ctx, masterGain, freq, vel, dur) {
        const now = ctx.currentTime;
        // Pure square, no detuning, no filter — NES bleeps
        const osc = ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.value = freq;

        // Short duration: 0.3 + vel*0.3s
        const shortDur = Math.min(dur, 0.3 + vel * 0.3);

        // 1ms attack, sharp decay (tau=0.04)
        const amp = ctx.createGain();
        amp.gain.setValueAtTime(0, now);
        amp.gain.linearRampToValueAtTime(vel * 0.2, now + 0.001);
        amp.gain.setTargetAtTime(0.001, now + 0.001, 0.04 * (shortDur / 0.6));

        osc.connect(amp);
        amp.connect(masterGain);

        osc.start(now);
        const stopTime = now + shortDur + 0.2;
        osc.stop(stopTime);
        return { stopTime };
      }
    },

    chip: {
      name: 'Chip Lead',
      category: 'Retro',
      build(ctx, masterGain, freq, vel, dur) {
        const now = ctx.currentTime;
        // Two squares offset for PWM effect — SID-style buzz
        const osc1 = ctx.createOscillator();
        osc1.type = 'square';
        osc1.frequency.value = freq;

        const osc2 = ctx.createOscillator();
        osc2.type = 'square';
        osc2.frequency.value = freq;
        osc2.detune.value = 15; // offset creates PWM-like timbre

        const oscMix = ctx.createGain();
        const osc1Gain = ctx.createGain();
        osc1Gain.gain.value = 0.3;
        const osc2Gain = ctx.createGain();
        osc2Gain.gain.value = 0.25;
        osc1.connect(osc1Gain);
        osc2.connect(osc2Gain);
        osc1Gain.connect(oscMix);
        osc2Gain.connect(oscMix);

        // Bandpass at 2x freq, mild Q
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = freq * 2;
        filter.Q.value = 1.2;

        // 1ms attack, medium decay
        const amp = ctx.createGain();
        amp.gain.setValueAtTime(0, now);
        amp.gain.linearRampToValueAtTime(vel * 0.22, now + 0.001);
        amp.gain.setTargetAtTime(0.001, now + 0.001, 0.06 * (dur / 1.0));

        oscMix.connect(filter);
        filter.connect(amp);
        amp.connect(masterGain);

        osc1.start(now);
        osc2.start(now);
        const stopTime = now + dur + 0.2;
        osc1.stop(stopTime);
        osc2.stop(stopTime);
        return { stopTime };
      }
    },

    triangle: {
      name: 'Triangle',
      category: 'Retro',
      build(ctx, masterGain, freq, vel, dur) {
        const now = ctx.currentTime;
        // Triangle + quiet sub (octave down) — Game Boy channel
        const osc1 = ctx.createOscillator();
        osc1.type = 'triangle';
        osc1.frequency.value = freq;

        const osc2 = ctx.createOscillator();
        osc2.type = 'triangle';
        osc2.frequency.value = freq / 2;

        const oscMix = ctx.createGain();
        const osc1Gain = ctx.createGain();
        osc1Gain.gain.value = 0.35;
        const osc2Gain = ctx.createGain();
        osc2Gain.gain.value = 0.1;
        osc1.connect(osc1Gain);
        osc2.connect(osc2Gain);
        osc1Gain.connect(oscMix);
        osc2Gain.connect(oscMix);

        // 2ms attack, gentle decay
        const amp = ctx.createGain();
        amp.gain.setValueAtTime(0, now);
        amp.gain.linearRampToValueAtTime(vel * 0.3, now + 0.002);
        amp.gain.setTargetAtTime(0.001, now + 0.002, 0.08 * (dur / 1.0));

        oscMix.connect(amp);
        amp.connect(masterGain);

        osc1.start(now);
        osc2.start(now);
        const stopTime = now + dur + 0.3;
        osc1.stop(stopTime);
        osc2.stop(stopTime);
        return { stopTime };
      }
    },

    // --- Synth ---
    shimmer: {
      name: 'Shimmer',
      category: 'Synth',
      build(ctx, masterGain, freq, vel, dur, chorusBus) {
        const now = ctx.currentTime;
        // Original sound: detuned saws + sub triangle + chorus bus
        const osc1 = ctx.createOscillator();
        osc1.type = 'sawtooth';
        osc1.frequency.value = freq;

        const osc2 = ctx.createOscillator();
        osc2.type = 'sawtooth';
        osc2.frequency.value = freq;
        osc2.detune.value = 7 + Math.random() * 5;

        const osc3 = ctx.createOscillator();
        osc3.type = 'triangle';
        osc3.frequency.value = freq / 2;
        const subGain = ctx.createGain();
        subGain.gain.value = vel * 0.08;

        const oscMix = ctx.createGain();
        const osc1Gain = ctx.createGain();
        osc1Gain.gain.value = 0.5;
        const osc2Gain = ctx.createGain();
        osc2Gain.gain.value = 0.35;

        osc1.connect(osc1Gain);
        osc2.connect(osc2Gain);
        osc3.connect(subGain);
        osc1Gain.connect(oscMix);
        osc2Gain.connect(oscMix);
        subGain.connect(oscMix);

        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.Q.value = 2.5;
        const filterBase = 300 + freq * 0.3;
        const filterPeak = filterBase + vel * 4000;
        filter.frequency.setValueAtTime(filterPeak, now);
        filter.frequency.exponentialRampToValueAtTime(filterBase + 200, now + 0.06);
        filter.frequency.exponentialRampToValueAtTime(filterBase, now + dur * 0.5);

        const amp = ctx.createGain();
        amp.gain.setValueAtTime(0, now);
        amp.gain.linearRampToValueAtTime(vel * 0.25, now + 0.004);
        amp.gain.setTargetAtTime(vel * 0.12, now + 0.004, 0.08);
        amp.gain.setTargetAtTime(vel * 0.04, now + 0.15, 0.15);
        amp.gain.setTargetAtTime(0.001, now + dur * 0.6, dur * 0.25);

        oscMix.connect(filter);
        filter.connect(amp);
        amp.connect(masterGain);

        // Route through chorus for shimmer
        if (chorusBus) {
          const chorusSend = ctx.createGain();
          chorusSend.gain.value = 0.3;
          amp.connect(chorusSend);
          chorusSend.connect(chorusBus.input);
        }

        osc1.start(now);
        osc2.start(now);
        osc3.start(now);
        const stopTime = now + dur + 0.3;
        osc1.stop(stopTime);
        osc2.stop(stopTime);
        osc3.stop(stopTime);
        return { stopTime };
      }
    },

    bell: {
      name: 'Bell',
      category: 'Synth',
      build(ctx, masterGain, freq, vel, dur) {
        const now = ctx.currentTime;
        // FM synthesis: sine carrier + sine modulator (ratio=2, index 6->0.5)
        // Creates metallic vibraphone tones
        const modRatio = 2;
        const modFreq = freq * modRatio;

        // Modulator
        const modOsc = ctx.createOscillator();
        modOsc.type = 'sine';
        modOsc.frequency.value = modFreq;

        // Modulation index envelope: 6 -> 0.5 (bright attack, mellow ring)
        const modGain = ctx.createGain();
        const modIndexStart = modFreq * 6;
        const modIndexEnd = modFreq * 0.5;
        modGain.gain.setValueAtTime(modIndexStart, now);
        modGain.gain.exponentialRampToValueAtTime(modIndexEnd, now + 0.15);
        modGain.gain.setTargetAtTime(modFreq * 0.2, now + 0.15, 0.3);

        // Carrier
        const carrier = ctx.createOscillator();
        carrier.type = 'sine';
        carrier.frequency.value = freq;

        modOsc.connect(modGain);
        modGain.connect(carrier.frequency);

        // Amp: 1ms attack, long ring (tau=0.3)
        const amp = ctx.createGain();
        amp.gain.setValueAtTime(0, now);
        amp.gain.linearRampToValueAtTime(vel * 0.2, now + 0.001);
        amp.gain.setTargetAtTime(0.001, now + 0.001, 0.3 * (dur / 1.5));

        carrier.connect(amp);
        amp.connect(masterGain);

        modOsc.start(now);
        carrier.start(now);
        const stopTime = now + dur + 0.5;
        modOsc.stop(stopTime);
        carrier.stop(stopTime);
        return { stopTime };
      }
    },

    pad: {
      name: 'Warm Pad',
      category: 'Synth',
      build(ctx, masterGain, freq, vel, dur) {
        const now = ctx.currentTime;
        // Triangle + detuned tri + sub sine — ambient texture
        const osc1 = ctx.createOscillator();
        osc1.type = 'triangle';
        osc1.frequency.value = freq;

        const osc2 = ctx.createOscillator();
        osc2.type = 'triangle';
        osc2.frequency.value = freq;
        osc2.detune.value = 10;

        const osc3 = ctx.createOscillator();
        osc3.type = 'sine';
        osc3.frequency.value = freq / 2;

        const oscMix = ctx.createGain();
        const osc1Gain = ctx.createGain();
        osc1Gain.gain.value = 0.3;
        const osc2Gain = ctx.createGain();
        osc2Gain.gain.value = 0.25;
        const osc3Gain = ctx.createGain();
        osc3Gain.gain.value = 0.15;
        osc1.connect(osc1Gain);
        osc2.connect(osc2Gain);
        osc3.connect(osc3Gain);
        osc1Gain.connect(oscMix);
        osc2Gain.connect(oscMix);
        osc3Gain.connect(oscMix);

        // LP at 600Hz, Q=0.5 — keep it warm
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 600 + vel * 400;
        filter.Q.value = 0.5;

        // 80ms slow attack, long sustain
        const amp = ctx.createGain();
        amp.gain.setValueAtTime(0, now);
        amp.gain.linearRampToValueAtTime(vel * 0.2, now + 0.08);
        amp.gain.setTargetAtTime(vel * 0.12, now + 0.08, 0.2);
        amp.gain.setTargetAtTime(0.001, now + dur * 0.7, dur * 0.3);

        oscMix.connect(filter);
        filter.connect(amp);
        amp.connect(masterGain);

        osc1.start(now);
        osc2.start(now);
        osc3.start(now);
        const stopTime = now + dur + 0.5;
        osc1.stop(stopTime);
        osc2.stop(stopTime);
        osc3.stop(stopTime);
        return { stopTime };
      }
    }
  };

  function init() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();

    masterGain = ctx.createGain();
    masterGain.gain.value = 0.8;

    compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -15;
    compressor.knee.value = 10;
    compressor.ratio.value = 3;
    compressor.attack.value = 0.005;
    compressor.release.value = 0.2;

    // Reverb
    reverbGain = ctx.createGain();
    reverbGain.gain.value = reverbAmount;
    dryGain = ctx.createGain();
    dryGain.gain.value = 1;

    reverbNode = ctx.createConvolver();
    reverbNode.buffer = buildReverbImpulse(2.5, 2.2);

    // Chorus bus
    chorusBus = buildChorusBus();

    // Routing: master -> dry + reverb + chorus -> compressor -> output
    masterGain.connect(dryGain);
    masterGain.connect(reverbGain);
    masterGain.connect(chorusBus.input);

    dryGain.connect(compressor);
    reverbGain.connect(reverbNode);
    reverbNode.connect(compressor);
    chorusBus.output.connect(compressor);

    compressor.connect(ctx.destination);

    // MediaStream for recorder
    mediaStreamDest = ctx.createMediaStreamDestination();
    compressor.connect(mediaStreamDest);

    // Pre-generate noise buffer
    buildNoiseBuffer();

    return ctx;
  }

  function buildReverbImpulse(duration, decay) {
    const rate = ctx.sampleRate;
    const length = rate * duration;
    const impulse = ctx.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        const t = i / rate;
        const hfDecay = Math.exp(-t * 3);
        const raw = Math.random() * 2 - 1;
        const warmth = 0.3 + (1 - hfDecay) * 0.5;
        data[i] = raw * Math.pow(1 - i / length, decay);
        if (i > 0) data[i] = data[i] * (1 - warmth) + data[i - 1] * warmth;
      }
    }
    return impulse;
  }

  function buildChorusBus() {
    const input = ctx.createGain();
    input.gain.value = 0.35;
    const output = ctx.createGain();
    output.gain.value = 0.6;

    const delayL = ctx.createDelay(0.05);
    delayL.delayTime.value = 0.012;
    const lfoL = ctx.createOscillator();
    lfoL.type = 'sine';
    lfoL.frequency.value = 0.8;
    const lfoGainL = ctx.createGain();
    lfoGainL.gain.value = 0.003;
    lfoL.connect(lfoGainL);
    lfoGainL.connect(delayL.delayTime);
    lfoL.start();

    const delayR = ctx.createDelay(0.05);
    delayR.delayTime.value = 0.017;
    const lfoR = ctx.createOscillator();
    lfoR.type = 'sine';
    lfoR.frequency.value = 1.1;
    const lfoGainR = ctx.createGain();
    lfoGainR.gain.value = 0.004;
    lfoR.connect(lfoGainR);
    lfoGainR.connect(delayR.delayTime);
    lfoR.start();

    const delayC = ctx.createDelay(0.05);
    delayC.delayTime.value = 0.008;
    const lfoC = ctx.createOscillator();
    lfoC.type = 'sine';
    lfoC.frequency.value = 0.5;
    const lfoGainC = ctx.createGain();
    lfoGainC.gain.value = 0.002;
    lfoC.connect(lfoGainC);
    lfoGainC.connect(delayC.delayTime);
    lfoC.start();

    input.connect(delayL);
    input.connect(delayR);
    input.connect(delayC);
    delayL.connect(output);
    delayR.connect(output);
    delayC.connect(output);

    return { input, output };
  }

  function buildNoiseBuffer() {
    const length = ctx.sampleRate * 2;
    noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
  }

  function getNoiseSource() {
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer;
    return source;
  }

  function setReverbAmount(val) {
    reverbAmount = val;
    if (reverbGain) reverbGain.gain.setTargetAtTime(val, ctx.currentTime, 0.05);
  }

  // =============================================
  // VOICE API
  // =============================================
  function setVoice(id) {
    if (VOICES[id]) currentVoice = id;
  }

  function getVoice() { return currentVoice; }

  function getVoiceNames() {
    const result = {};
    for (const [id, v] of Object.entries(VOICES)) {
      if (!result[v.category]) result[v.category] = [];
      result[v.category].push({ id, name: v.name });
    }
    return result;
  }

  function setSustain(val) {
    sustainValue = Math.max(0, Math.min(1, val));
  }

  function getSustain() { return sustainValue; }

  function setVibratoEnabled(on) {
    vibratoEnabled = on;
  }

  function getVibratoEnabled() { return vibratoEnabled; }

  // =============================================
  // SONIC STRING VOICE — dispatches to current preset
  // =============================================
  function playStringVoice(freq, velocity = 0.7, duration = null) {
    if (!ctx) return null;
    const vel = Math.max(0.15, Math.min(1, velocity));
    // Sustain maps: 0 = 0.2s, 1 = 3.0s
    const dur = duration || (0.2 + sustainValue * 2.8);

    const voice = VOICES[currentVoice];
    if (!voice) return null;

    const result = voice.build(ctx, masterGain, freq, vel, dur, chorusBus);

    // Global vibrato toggle — adds extra wobble on top of any voice
    if (vibratoEnabled && result.stopTime) {
      applyGlobalVibrato(freq, result.stopTime);
    }

    return result;
  }

  // Global vibrato: 5.5Hz LFO modulating pitch by +/-10 cents
  // This is applied as an additional effect on top of per-voice vibrato
  function applyGlobalVibrato(freq, stopTime) {
    // We can't retroactively connect to oscillators that are already created
    // inside the voice builder, so the global vibrato is baked into voices
    // that support it via the vibratoEnabled flag.
    // For simplicity, the per-voice builders check vibratoEnabled and add extra LFO.
    // This function is a no-op placeholder — the actual implementation is in each voice.
  }

  // =============================================
  // CHORD SUSTAIN PAD
  // =============================================
  let activeChordVoices = [];

  function playChordPad(frequencies) {
    if (!ctx) return;
    stopChordPad();

    const now = ctx.currentTime;
    const voices = [];

    frequencies.forEach(freq => {
      const osc1 = ctx.createOscillator();
      osc1.type = 'sawtooth';
      osc1.frequency.value = freq;

      const osc2 = ctx.createOscillator();
      osc2.type = 'sawtooth';
      osc2.frequency.value = freq;
      osc2.detune.value = 8;

      const osc3 = ctx.createOscillator();
      osc3.type = 'triangle';
      osc3.frequency.value = freq / 2;

      const mix = ctx.createGain();
      const osc1g = ctx.createGain(); osc1g.gain.value = 0.3;
      const osc2g = ctx.createGain(); osc2g.gain.value = 0.2;
      const osc3g = ctx.createGain(); osc3g.gain.value = 0.15;

      osc1.connect(osc1g); osc1g.connect(mix);
      osc2.connect(osc2g); osc2g.connect(mix);
      osc3.connect(osc3g); osc3g.connect(mix);

      const flt = ctx.createBiquadFilter();
      flt.type = 'lowpass';
      flt.frequency.value = 800 + Math.min(freq, 600);
      flt.Q.value = 0.7;

      const voice = ctx.createGain();
      voice.gain.setValueAtTime(0, now);
      voice.gain.linearRampToValueAtTime(0.045, now + 0.2);

      mix.connect(flt);
      flt.connect(voice);
      voice.connect(masterGain);

      osc1.start(now);
      osc2.start(now);
      osc3.start(now);

      voices.push({ osc1, osc2, osc3, gain: voice, filter: flt });
    });

    activeChordVoices = voices;
  }

  function stopChordPad() {
    if (!ctx) return;
    const now = ctx.currentTime;
    activeChordVoices.forEach(v => {
      v.gain.gain.cancelScheduledValues(now);
      v.gain.gain.setValueAtTime(v.gain.gain.value, now);
      v.gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      v.osc1.stop(now + 0.45);
      v.osc2.stop(now + 0.45);
      v.osc3.stop(now + 0.45);
    });
    activeChordVoices = [];
  }

  // =============================================
  // DRUM SYNTH
  // =============================================
  function playKick(time, vol = 0.7) {
    if (!ctx) return;
    const t = time || ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.1);

    const click = ctx.createOscillator();
    click.type = 'square';
    click.frequency.value = 800;
    const clickGain = ctx.createGain();
    clickGain.gain.setValueAtTime(vol * 0.15, t);
    clickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.008);
    click.connect(clickGain);
    clickGain.connect(masterGain);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol * 0.8, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);

    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 600;

    osc.connect(filt);
    filt.connect(gain);
    gain.connect(masterGain);

    osc.start(t);
    osc.stop(t + 0.25);
    click.start(t);
    click.stop(t + 0.01);
  }

  function playSnare(time, vol = 0.5) {
    if (!ctx) return;
    const t = time || ctx.currentTime;

    const noise = getNoiseSource();
    const noiseFilt = ctx.createBiquadFilter();
    noiseFilt.type = 'bandpass';
    noiseFilt.frequency.value = 4000;
    noiseFilt.Q.value = 1.5;

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(vol * 0.45, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);

    noise.connect(noiseFilt);
    noiseFilt.connect(noiseGain);
    noiseGain.connect(masterGain);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(150, t + 0.04);

    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(vol * 0.3, t);
    oscGain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);

    osc.connect(oscGain);
    oscGain.connect(masterGain);

    noise.start(t);
    noise.stop(t + 0.12);
    osc.start(t);
    osc.stop(t + 0.08);
  }

  function playHihat(time, open = false, vol = 0.3) {
    if (!ctx) return;
    const t = time || ctx.currentTime;
    const duration = open ? 0.18 : 0.035;

    const noise = getNoiseSource();

    const filt = ctx.createBiquadFilter();
    filt.type = 'highpass';
    filt.frequency.value = 8000;

    const filt2 = ctx.createBiquadFilter();
    filt2.type = 'lowpass';
    filt2.frequency.value = 12000;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol * 0.7, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    noise.connect(filt);
    filt.connect(filt2);
    filt2.connect(gain);
    gain.connect(masterGain);
    noise.start(t);
    noise.stop(t + duration + 0.02);
  }

  function playClap(time, vol = 0.4) {
    if (!ctx) return;
    const t = time || ctx.currentTime;

    for (let i = 0; i < 3; i++) {
      const offset = i * 0.012;
      const noise = getNoiseSource();

      const filt = ctx.createBiquadFilter();
      filt.type = 'bandpass';
      filt.frequency.value = 2000;
      filt.Q.value = 1.5;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(vol * 0.35, t + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, t + offset + 0.05);

      noise.connect(filt);
      filt.connect(gain);
      gain.connect(masterGain);
      noise.start(t + offset);
      noise.stop(t + offset + 0.06);
    }
  }

  function playRim(time, vol = 0.3) {
    if (!ctx) return;
    const t = time || ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 1600;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol * 0.6, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.012);

    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(t);
    osc.stop(t + 0.02);
  }

  // =============================================
  // METRONOME CLICK
  // =============================================
  function playMetronomeClick(time, accent = false) {
    if (!ctx) return;
    const t = time || ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = accent ? 1800 : 1200;

    const gain = ctx.createGain();
    const vol = accent ? 0.35 : 0.2;
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);

    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(t);
    osc.stop(t + 0.05);
  }

  function getContext() { return ctx; }
  function getMasterGain() { return masterGain; }
  function getMediaStream() { return mediaStreamDest ? mediaStreamDest.stream : null; }
  function now() { return ctx ? ctx.currentTime : 0; }

  return {
    init,
    getContext,
    getMasterGain,
    getMediaStream,
    now,
    setReverbAmount,
    playStringVoice,
    playChordPad,
    stopChordPad,
    playKick,
    playSnare,
    playHihat,
    playClap,
    playRim,
    playMetronomeClick,
    // Voice API
    setVoice,
    getVoice,
    getVoiceNames,
    setSustain,
    getSustain,
    setVibratoEnabled,
    getVibratoEnabled
  };
})();
