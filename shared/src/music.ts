/**
 * Quantum Doodle's background tune: an original, calm 8-bar chiptune loop in
 * C major (C – Am – F – G). Used by the game's music player (WebAudio) and by
 * tools/add-music.ts, which renders the same notes into the tutorial videos.
 */
export type Voice = "bass" | "arp" | "lead";

export interface MusicNote {
  /** Start, in beats from the start of the loop. */
  at: number;
  /** Length in beats. */
  beats: number;
  midi: number;
  voice: Voice;
}

export const MUSIC_BPM = 100;
export const MUSIC_BEATS = 32; // 8 bars of 4/4: about 19 s per loop

/** How each voice sounds; both players follow these. */
export const VOICES: Record<Voice, { wave: "triangle" | "square"; gain: number; attack: number; release: number; lowpass?: number }> = {
  bass: { wave: "triangle", gain: 0.38, attack: 0.01, release: 0.12 },
  arp: { wave: "triangle", gain: 0.11, attack: 0.005, release: 0.08 },
  lead: { wave: "square", gain: 0.075, attack: 0.02, release: 0.15, lowpass: 2200 },
};

/** Chord per half bar (2 beats): root for the bass, tones for the arpeggio. */
const CHORDS: Record<string, { root: number; tones: number[] }> = {
  C: { root: 48, tones: [60, 64, 67, 72] },
  Am: { root: 45, tones: [57, 60, 64, 69] },
  F: { root: 41, tones: [53, 57, 60, 65] },
  G: { root: 43, tones: [55, 59, 62, 67] },
};
const PROGRESSION = ["C", "C", "Am", "Am", "F", "F", "G", "G", "C", "C", "Am", "Am", "F", "G", "C", "C"];

/** The melody: [beat, length, midi]. C major pentatonic, so it always sits well on the chords. */
const MELODY: [number, number, number][] = [
  // Bar 1 (C)
  [0, 1, 76], [1, 0.5, 79], [1.5, 0.5, 81], [2, 1, 79], [3, 1, 76],
  // Bar 2 (Am)
  [4, 1, 72], [5, 0.5, 74], [5.5, 0.5, 76], [6, 2, 69],
  // Bar 3 (F)
  [8, 0.5, 69], [8.5, 0.5, 72], [9, 1, 74], [10, 1, 72], [11, 1, 69],
  // Bar 4 (G)
  [12, 1, 67], [13, 0.5, 69], [13.5, 0.5, 72], [14, 2, 74],
  // Bar 5 (C)
  [16, 1, 76], [17, 0.5, 79], [17.5, 0.5, 81], [18, 1, 84], [19, 1, 81],
  // Bar 6 (Am)
  [20, 1, 79], [21, 0.5, 76], [21.5, 0.5, 74], [22, 2, 76],
  // Bar 7 (F, G)
  [24, 1, 74], [25, 0.5, 72], [25.5, 0.5, 74], [26, 1, 76], [27, 1, 74],
  // Bar 8 (C)
  [28, 3, 72],
];

function build(): MusicNote[] {
  const notes: MusicNote[] = [];
  PROGRESSION.forEach((name, half) => {
    const chord = CHORDS[name];
    const start = half * 2;
    // Bass: the root on each half bar, an octave jump on the off-beat for a little bounce.
    notes.push({ at: start, beats: 1.4, midi: chord.root, voice: "bass" });
    notes.push({ at: start + 1.5, beats: 0.4, midi: chord.root + 12, voice: "bass" });
    // Arpeggio: the chord tones rising in eighth notes.
    [0, 1, 2, 3].forEach((i) => {
      const tone = chord.tones[i];
      notes.push({ at: start + i * 0.5, beats: 0.45, midi: tone, voice: "arp" });
    });
  });
  for (const [at, beats, midi] of MELODY) notes.push({ at, beats: beats * 0.92, midi, voice: "lead" });
  return notes.sort((a, b) => a.at - b.at);
}

export const MUSIC_NOTES: MusicNote[] = build();

export const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
export const beatSeconds = () => 60 / MUSIC_BPM;
