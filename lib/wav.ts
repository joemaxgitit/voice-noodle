/**
 * Turn whatever the browser recorded into a 16 kHz mono WAV.
 *
 * MediaRecorder gives WebM/Opus in Chrome and MP4/AAC in Safari, and neither
 * is a format worth betting the alignment call on. Decoding and re-encoding
 * in the page means one known format reaches the server regardless of browser.
 *
 * 16 kHz mono is what speech recognition wants -- above that is detail no
 * aligner uses. It also keeps a 30-second take near 1 MB rather than 5, which
 * matters against the 4.5 MB request ceiling.
 */

const TARGET_RATE = 16_000;

/** Average channels down to one. Stereo from a single mic is two copies. */
function toMono(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);

  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  const out = new Float32Array(left.length);

  for (let i = 0; i < left.length; i++) out[i] = (left[i] + right[i]) / 2;
  return out;
}

/**
 * Linear resample. Not the highest-quality method available, but the input is
 * speech being downsampled, where the audible difference against a windowed
 * sinc is nil and the cost is a dependency.
 */
function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;

  const ratio = from / to;
  const length = Math.floor(input.length / ratio);
  const out = new Float32Array(length);

  for (let i = 0; i < length; i++) {
    const at = i * ratio;
    const lower = Math.floor(at);
    const upper = Math.min(lower + 1, input.length - 1);
    const t = at - lower;
    out[i] = input[lower] * (1 - t) + input[upper] * t;
  }

  return out;
}

/** 16-bit PCM WAV. */
function encodeWav(samples: Float32Array, rate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeText = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  writeText(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeText(36, "data");
  view.setUint32(40, samples.length * 2, true);

  let at = 44;
  for (let i = 0; i < samples.length; i++) {
    // Clamp before scaling, or a sample slightly over 1 wraps to full-scale
    // negative and clicks.
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(at, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    at += 2;
  }

  return new Blob([view], { type: "audio/wav" });
}

/** Recorded blob in, 16 kHz mono WAV out, with its duration. */
export async function toWav(
  blob: Blob
): Promise<{ wav: Blob; seconds: number }> {
  const bytes = await blob.arrayBuffer();

  // webkitAudioContext for older Safari.
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;

  const ctx = new Ctor();

  try {
    const decoded = await ctx.decodeAudioData(bytes);
    const mono = toMono(decoded);
    const resampled = resample(mono, decoded.sampleRate, TARGET_RATE);

    return {
      wav: encodeWav(resampled, TARGET_RATE),
      seconds: decoded.duration,
    };
  } finally {
    void ctx.close();
  }
}
