import { yieldNow } from "@/lib/yieldNow";
/*
  Voice measurement for call review: how the voice moves, measured from the
  recording itself. Claude cannot listen to audio, so this turns the sound
  into numbers it can read next to the script's tone markers.

  Runs in the browser at upload (or from the "Analyze voice" button for
  calls uploaded before this existed). No outside service, no cost.

  Output is a coarse timeline -- one value per quarter second for pitch and
  for loudness -- which lib/calls.ts lines up with the transcript later.
  About 150 KB for a 90-minute call.

  Method: YIN pitch detection (de Cheveigne & Kawahara, 2002) on 8 kHz audio.
  Phone lines cut the lowest frequencies, but YIN finds the period from the
  harmonics, so it still works -- just rougher than on a clean recording.
*/

export type VoiceData = {
  v: 1;
  bin: number; // seconds per value
  f0: number[]; // median pitch per bin in Hz, 0 = no clear voice
  db: number[]; // loudness per bin in dB (relative; only differences matter)
};

const RATE = 8000; // pitch work happens at 8 kHz -- all a phone line carries
const HOP = 200; // 25 ms
const WIN = 256; // 32 ms
const MIN_HZ = 70;
const MAX_HZ = 400;
const YIN_THRESHOLD = 0.15;
const BIN_FRAMES = 10; // 10 x 25 ms = 0.25 s per bin
const FRAMES_PER_YIELD = 4000;

/** 16 kHz -> 8 kHz by averaging pairs (a crude low-pass, plenty for speech). */
function downsample(pcm: Float32Array, rate: number): Float32Array {
  const step = Math.round(rate / RATE);
  if (step <= 1) return pcm;
  const out = new Float32Array(Math.floor(pcm.length / step));
  for (let i = 0; i < out.length; i++) {
    let s = 0;
    for (let k = 0; k < step; k++) s += pcm[i * step + k];
    out[i] = s / step;
  }
  return out;
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** YIN pitch for one frame, in Hz, or 0 if the frame is not clearly voiced. */
function yin(x: Float32Array, at: number, d: Float32Array, tauMin: number, tauMax: number): number {
  // Difference function d(tau) over the window.
  for (let tau = 1; tau <= tauMax; tau++) {
    let sum = 0;
    for (let j = 0; j < WIN - tauMax; j++) {
      const diff = x[at + j] - x[at + j + tau];
      sum += diff * diff;
    }
    d[tau] = sum;
  }
  // Cumulative mean normalized difference.
  let running = 0;
  d[0] = 1;
  for (let tau = 1; tau <= tauMax; tau++) {
    running += d[tau];
    d[tau] = running > 0 ? (d[tau] * tau) / running : 1;
  }
  // First dip under the threshold, then walk to its bottom.
  for (let tau = tauMin; tau < tauMax; tau++) {
    if (d[tau] < YIN_THRESHOLD) {
      while (tau + 1 < tauMax && d[tau + 1] < d[tau]) tau++;
      // Parabolic interpolation for sub-sample accuracy.
      const a = d[tau - 1];
      const b = d[tau];
      const c = d[tau + 1];
      const denom = a - 2 * b + c;
      const shift = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
      return RATE / (tau + Math.max(-1, Math.min(1, shift)));
    }
  }
  return 0;
}

export async function measureVoice(
  pcm: Float32Array,
  rate: number,
  onProgress: (fraction: number) => void = () => {}
): Promise<VoiceData> {
  const x = downsample(pcm, rate);
  const frames = Math.max(0, Math.floor((x.length - WIN) / HOP));
  const tauMin = Math.floor(RATE / MAX_HZ);
  const tauMax = Math.ceil(RATE / MIN_HZ);
  const d = new Float32Array(tauMax + 2);

  // Pass 1: loudness of every frame, to set a "someone is talking" gate.
  const dbs = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let e = 0;
    const at = f * HOP;
    for (let j = 0; j < WIN; j++) e += x[at + j] * x[at + j];
    dbs[f] = 10 * Math.log10(e / WIN + 1e-12);
  }
  const sorted = Array.from(dbs).sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.2)] ?? -100;
  const gate = floor + 10; // 10 dB above the quietest fifth of the call

  // Pass 2: pitch, only where someone is talking.
  const f0s = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    if (dbs[f] > gate) f0s[f] = yin(x, f * HOP, d, tauMin, tauMax);
    if (f % FRAMES_PER_YIELD === 0) {
      onProgress(f / Math.max(1, frames));
      await yieldNow();
    }
  }
  onProgress(1);

  // Bin to quarter seconds.
  const bins = Math.ceil(frames / BIN_FRAMES);
  const f0: number[] = new Array(bins);
  const db: number[] = new Array(bins);
  for (let b = 0; b < bins; b++) {
    const voiced: number[] = [];
    let loud = 0;
    let n = 0;
    for (let f = b * BIN_FRAMES; f < Math.min(frames, (b + 1) * BIN_FRAMES); f++) {
      if (f0s[f] > 0) voiced.push(f0s[f]);
      loud += dbs[f];
      n++;
    }
    // Needs a few voiced frames, or a single stray detection becomes "pitch".
    f0[b] = voiced.length >= 3 ? Math.round(median(voiced)) : 0;
    db[b] = n ? Math.round(loud / n) : 0;
  }

  return { v: 1, bin: (HOP * BIN_FRAMES) / RATE, f0, db };
}
