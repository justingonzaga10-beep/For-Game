import { useSyncExternalStore } from "react";
import { load, save } from "./storage";

/**
 * Tiny chiptune synth on WebAudio: square and triangle blips, no audio files.
 * The context starts on the first user gesture (browsers block autoplay).
 */
let ctx: AudioContext | null = null;
let master: GainNode | null = null;

interface SoundPrefs {
  volume: number;
  muted: boolean;
  /** Background music in rooms (quiet, on by default). */
  music: boolean;
}
let prefs: SoundPrefs = { volume: 0.5, muted: false, music: true, ...load<Partial<SoundPrefs>>("sound", {}) };
const listeners = new Set<() => void>();

/** The shared audio context and master volume, for the music player. Null if audio isn't supported. */
export function audioGraph(): { ctx: AudioContext; master: GainNode } | null {
  const a = audio();
  return a && master ? { ctx: a, master } : null;
}

function audio(): AudioContext | null {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.connect(ctx.destination);
    applyVolume();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function applyVolume() {
  if (master && ctx) master.gain.setValueAtTime(prefs.muted ? 0 : prefs.volume * 0.6, ctx.currentTime);
}

// Unlock audio on the first interaction anywhere on the page.
const unlock = () => {
  audio();
  window.removeEventListener("pointerdown", unlock);
  window.removeEventListener("keydown", unlock);
};
window.addEventListener("pointerdown", unlock);
window.addEventListener("keydown", unlock);

function note(freq: number, at: number, dur: number, type: OscillatorType = "square", vol = 0.25) {
  const a = audio();
  if (!a || !master || prefs.muted || prefs.volume === 0) return;
  const t = a.currentTime + at;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

const N = { C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880, C6: 1046.5, E6: 1318.5, G4: 392, C4: 261.63, E4: 329.63 };

export const sfx = {
  tick: () => note(1400, 0, 0.05, "square", 0.12),
  tickLast: () => note(1800, 0, 0.08, "square", 0.16),
  correct: () => {
    note(N.E5, 0, 0.08);
    note(N.A5, 0.07, 0.08);
    note(N.E6, 0.14, 0.18);
  },
  /** Someone else guessed. */
  otherCorrect: () => {
    note(N.C5, 0, 0.06, "triangle", 0.2);
    note(N.G5, 0.06, 0.1, "triangle", 0.2);
  },
  close: () => {
    note(N.D5, 0, 0.07, "triangle", 0.2);
    note(N.C5, 0.07, 0.1, "triangle", 0.2);
  },
  turnStart: () => {
    note(N.C5, 0, 0.09);
    note(N.E5, 0.09, 0.09);
    note(N.G5, 0.18, 0.09);
    note(N.C6, 0.27, 0.22);
  },
  gameEnd: () => {
    const seq = [N.C5, N.E5, N.G5, N.C6, N.G5, N.C6, N.E6];
    seq.forEach((f, i) => note(f, i * 0.11, i === seq.length - 1 ? 0.5 : 0.1));
    note(N.C4, 0, 0.8, "triangle", 0.2);
  },
  click: () => note(900, 0, 0.03, "square", 0.08),
  /** A wet "splat" for thrown paint. */
  splat: () => {
    note(220, 0, 0.09, "sawtooth", 0.08);
    note(120, 0.03, 0.14, "triangle", 0.18);
  },
  /** A soft bubble pop for emoji reactions. */
  react: () => {
    note(N.G5, 0, 0.05, "sine", 0.08);
    note(N.C6, 0.04, 0.07, "sine", 0.06);
  },
  /** A gentle "not quite" (wrong answer). */
  wrong: () => {
    note(N.E4, 0, 0.09, "triangle", 0.18);
    note(N.C4, 0.09, 0.16, "triangle", 0.18);
  },
};

export function setSound(patch: Partial<SoundPrefs>) {
  prefs = { ...prefs, ...patch };
  save("sound", prefs);
  applyVolume();
  listeners.forEach((l) => l());
}

export function useSoundPrefs(): SoundPrefs {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => prefs,
  );
}
