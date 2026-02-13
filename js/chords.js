// chords.js — 36 chord definitions (12 roots × Maj/Min/7th)
const Chords = (() => {
  const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

  // Semitone intervals from root
  const TYPES = {
    maj: [0, 4, 7],       // Major: 1-3-5
    min: [0, 3, 7],       // Minor: 1-b3-5
    sev: [0, 4, 7, 10]    // Seventh: 1-3-5-b7
  };

  // A4 = 440 Hz
  function midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  // Root note MIDI numbers (C3 = 48)
  function rootMidi(rootIndex) {
    return 48 + rootIndex; // C3-based
  }

  // Build all 36 chords
  const chords = {};

  NOTE_NAMES.forEach((name, rootIdx) => {
    Object.entries(TYPES).forEach(([type, intervals]) => {
      const key = `${name}_${type}`;
      const baseMidi = rootMidi(rootIdx);

      // Notes across octaves 3-6 for the strings strip (4 octaves + top root)
      const stripNotes = [];
      for (let octave = 0; octave < 4; octave++) {
        intervals.forEach(interval => {
          const midi = baseMidi + interval + (octave * 12);
          stripNotes.push({
            midi,
            freq: midiToFreq(midi),
            name: NOTE_NAMES[(rootIdx + interval) % 12] + (3 + octave)
          });
        });
      }
      // Cap with the root at the top of the range
      const topMidi = baseMidi + (4 * 12);
      stripNotes.push({
        midi: topMidi,
        freq: midiToFreq(topMidi),
        name: NOTE_NAMES[rootIdx] + 7
      });

      // Chord pad notes (octave 3-4, close voicing)
      const padNotes = intervals.map(interval => ({
        midi: baseMidi + interval,
        freq: midiToFreq(baseMidi + interval)
      }));
      // Add octave above root
      padNotes.push({
        midi: baseMidi + 12,
        freq: midiToFreq(baseMidi + 12)
      });

      chords[key] = {
        name,
        type,
        label: type === 'maj' ? name : type === 'min' ? name + 'm' : name + '7',
        root: rootIdx,
        intervals,
        stripNotes,     // for Sonic Strings (sorted low to high)
        padFreqs: padNotes.map(n => n.freq),
        padMidi: padNotes.map(n => n.midi)
      };
    });
  });

  // Active chord state
  let activeChord = null;

  function setActive(chordKey) {
    activeChord = chords[chordKey] || null;
    return activeChord;
  }

  function getActive() {
    return activeChord;
  }

  function get(chordKey) {
    return chords[chordKey];
  }

  function getAllKeys() {
    return Object.keys(chords);
  }

  function getNoteNames() {
    return NOTE_NAMES;
  }

  function getTypes() {
    return Object.keys(TYPES);
  }

  return { setActive, getActive, get, getAllKeys, getNoteNames, getTypes };
})();
