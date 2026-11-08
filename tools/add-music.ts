// Adds Quantum Doodle's background tune (shared/src/music.ts) to MP4 videos,
// replacing any existing audio. Usage:
//   npx tsx tools/add-music.ts client/public/tutorials/guessing.mp4 [more.mp4 ...]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MUSIC_BEATS, MUSIC_NOTES, VOICES, beatSeconds, midiToHz } from "../shared/src/music";

const SR = 44100;
/** Peak level of the music in the videos: present but not loud. */
const PEAK = 0.4;

/** Renders one loop of the tune to mono samples, following the same voices as the in-game player. */
function renderLoop(): Float32Array {
  const beat = beatSeconds();
  const len = Math.round(MUSIC_BEATS * beat * SR);
  const dry = new Float32Array(len);
  const lead = new Float32Array(len);
  for (const n of MUSIC_NOTES) {
    const v = VOICES[n.voice];
    const out = v.lowpass ? lead : dry;
    const f = midiToHz(n.midi);
    const s0 = Math.round(n.at * beat * SR);
    const dur = n.beats * beat;
    const count = Math.round(dur * SR);
    for (let i = 0; i < count && s0 + i < len; i++) {
      const t = i / SR;
      const phase = (t * f) % 1;
      const wave = v.wave === "square" ? (phase < 0.5 ? 1 : -1) : 4 * Math.abs(phase - 0.5) - 1;
      const env = t < v.attack ? t / v.attack : t > dur - v.release ? Math.max(0, (dur - t) / v.release) : 1;
      out[s0 + i] += wave * env * v.gain;
    }
  }
  // One-pole low-pass on the lead to soften the square wave, like the in-game filter.
  const cutoff = VOICES.lead.lowpass ?? 20000;
  const a = 1 - Math.exp((-2 * Math.PI * cutoff) / SR);
  let y = 0;
  for (let i = 0; i < len; i++) {
    y += a * (lead[i] - y);
    dry[i] += y;
  }
  return dry;
}

function wav(samples: Float32Array): Buffer {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((s, i) => buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(s * 32767))), 44 + i * 2));
  return buf;
}

function musicFor(seconds: number): Float32Array {
  const loop = renderLoop();
  let peak = 0;
  for (const s of loop) peak = Math.max(peak, Math.abs(s));
  const gain = PEAK / (peak || 1);
  const total = Math.ceil(seconds * SR);
  const out = new Float32Array(total);
  const fadeIn = 1 * SR;
  const fadeOut = 2.5 * SR;
  for (let i = 0; i < total; i++) {
    let g = gain;
    if (i < fadeIn) g *= i / fadeIn;
    if (i > total - fadeOut) g *= Math.max(0, (total - i) / fadeOut);
    out[i] = loop[i % loop.length] * g;
  }
  return out;
}

for (const file of process.argv.slice(2)) {
  const seconds = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qd-music-"));
  const track = path.join(dir, "music.wav");
  const tmp = path.join(dir, "out.mp4");
  fs.writeFileSync(track, wav(musicFor(seconds)));
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", file, "-i", track, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "96k", "-shortest", "-movflags", "+faststart", tmp]);
  fs.copyFileSync(tmp, file);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`${path.basename(file)}: added ${seconds.toFixed(1)} s of music, now ${(fs.statSync(file).size / 1e6).toFixed(1)} MB`);
}
