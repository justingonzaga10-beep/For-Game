import { MUSIC_BEATS, MUSIC_NOTES, VOICES, beatSeconds, midiToHz } from "@inkwave/shared";
import { audioGraph } from "./sound";

/** Background music level relative to sound effects: deliberately low. */
const LEVEL = 0.32;

/**
 * Loops the background tune on WebAudio. Each loop is scheduled in one go a
 * little before it starts; stopping fades out and disconnects, so notes
 * already scheduled play into silence.
 */
class MusicPlayer {
  private out: GainNode | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private playing = false;
  private paused = false;

  start() {
    if (this.playing) return;
    const g = audioGraph();
    if (!g) return;
    this.playing = true;
    const { ctx, master } = g;
    this.out = ctx.createGain();
    this.out.gain.setValueAtTime(0, ctx.currentTime);
    this.out.gain.linearRampToValueAtTime(this.paused ? 0 : LEVEL, ctx.currentTime + 2);
    this.out.connect(master);
    this.scheduleLoop(ctx, ctx.currentTime + 0.3);
  }

  stop() {
    if (!this.playing) return;
    this.playing = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const out = this.out;
    this.out = null;
    const g = audioGraph();
    if (out && g) {
      out.gain.cancelScheduledValues(g.ctx.currentTime);
      out.gain.setValueAtTime(out.gain.value, g.ctx.currentTime);
      out.gain.linearRampToValueAtTime(0, g.ctx.currentTime + 0.6);
      setTimeout(() => out.disconnect(), 800);
    }
  }

  /** Silences the music without forgetting it is on (e.g. while a tutorial video plays). */
  setPaused(paused: boolean) {
    this.paused = paused;
    const g = audioGraph();
    if (!this.out || !g) return;
    const t = g.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.linearRampToValueAtTime(paused ? 0 : LEVEL, t + 0.5);
  }

  private scheduleLoop(ctx: AudioContext, start: number) {
    if (!this.playing || !this.out) return;
    const beat = beatSeconds();
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = VOICES.lead.lowpass ?? 20000;
    filter.connect(this.out);
    for (const n of MUSIC_NOTES) {
      const v = VOICES[n.voice];
      const t0 = start + n.at * beat;
      const t1 = t0 + n.beats * beat;
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = v.wave;
      osc.frequency.value = midiToHz(n.midi);
      env.gain.setValueAtTime(0, t0);
      env.gain.linearRampToValueAtTime(v.gain, t0 + v.attack);
      env.gain.setValueAtTime(v.gain, Math.max(t0 + v.attack, t1 - v.release));
      env.gain.linearRampToValueAtTime(0, t1);
      osc.connect(env).connect(v.lowpass ? filter : this.out);
      osc.start(t0);
      osc.stop(t1 + 0.05);
    }
    const next = start + MUSIC_BEATS * beat;
    setTimeout(() => filter.disconnect(), Math.max(0, (next - ctx.currentTime + 1) * 1000));
    // Schedule the next loop about a second before this one ends.
    this.timer = setTimeout(() => this.scheduleLoop(ctx, next), Math.max(0, (next - ctx.currentTime - 1) * 1000));
  }
}

export const music = new MusicPlayer();
