// midi.js — Web MIDI API: output to DAWs, input from controllers
const MIDI = (() => {
  let midiAccess = null;
  let selectedOutput = null;
  let selectedInput = null;

  async function init() {
    if (!navigator.requestMIDIAccess) return;
    try {
      midiAccess = await navigator.requestMIDIAccess({ sysex: false });
      midiAccess.onstatechange = refreshDevices;
      refreshDevices();
    } catch (e) {
      console.warn('Web MIDI not available:', e);
    }
  }

  function refreshDevices() {
    if (!midiAccess) return;

    const outSelect = document.getElementById('midi-output');
    const inSelect = document.getElementById('midi-input');
    if (!outSelect || !inSelect) return;

    // Save current selections
    const prevOut = outSelect.value;
    const prevIn = inSelect.value;

    // Clear and repopulate outputs
    outSelect.innerHTML = '<option value="">None</option>';
    midiAccess.outputs.forEach((port, id) => {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = port.name;
      outSelect.appendChild(opt);
    });

    // Clear and repopulate inputs
    inSelect.innerHTML = '<option value="">None</option>';
    midiAccess.inputs.forEach((port, id) => {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = port.name;
      inSelect.appendChild(opt);
    });

    // Restore selections
    if (prevOut) outSelect.value = prevOut;
    if (prevIn) inSelect.value = prevIn;

    selectOutput(outSelect.value);
    selectInput(inSelect.value);
  }

  function selectOutput(id) {
    if (!midiAccess) return;
    selectedOutput = id ? midiAccess.outputs.get(id) : null;
  }

  function selectInput(id) {
    if (!midiAccess) return;

    // Unbind old input
    if (selectedInput) {
      selectedInput.onmidimessage = null;
    }

    selectedInput = id ? midiAccess.inputs.get(id) : null;

    if (selectedInput) {
      selectedInput.onmidimessage = onMIDIMessage;
    }
  }

  function onMIDIMessage(e) {
    const [status, note, velocity] = e.data;
    const command = status >> 4;
    const channel = (status & 0x0F) + 1;

    if (command === 9 && velocity > 0) {
      // Note-on → trigger string note
      const chord = Chords.getActive();
      if (chord) {
        const freq = 440 * Math.pow(2, (note - 69) / 12);
        Audio.playStringVoice(freq, velocity / 127);
      }
    }
  }

  function sendNoteOn(channel, note, velocity) {
    if (!selectedOutput) return;
    const status = 0x90 | ((channel - 1) & 0x0F);
    selectedOutput.send([status, note & 0x7F, velocity & 0x7F]);
  }

  function sendNoteOff(channel, note) {
    if (!selectedOutput) return;
    const status = 0x80 | ((channel - 1) & 0x0F);
    selectedOutput.send([status, note & 0x7F, 0]);
  }

  return { init, selectOutput, selectInput, sendNoteOn, sendNoteOff, refreshDevices };
})();
