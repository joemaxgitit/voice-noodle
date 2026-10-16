/*
  Decodes and shrinks a call recording in the browser before upload.

  Dialer MP3s are often 128 kbps stereo -- about 55 MB an hour, over Supabase's
  50 MB per-file limit on the free plan. Phone audio only carries ~8 kHz of
  real information, so re-encoding to 16 kHz mono at 32 kbps loses nothing the
  transcriber can use and comes out around 14 MB an hour.

  The decoded audio is also what lib/voice.ts measures, so decoding happens
  once and feeds both.

  Runs entirely on the manager's computer; nothing leaves the browser until
  the smaller file is uploaded.
*/

export const DECODE_RATE = 16_000;
const KBPS = 32;
const FRAME = 1152; // samples per MP3 frame
const FRAMES_PER_YIELD = 400; // keep the page responsive while encoding

/** Files at or under this size are uploaded as they are. */
export const SHRINK_OVER_BYTES = 20 * 1024 * 1024;

export type Decoded = { pcm: Float32Array; rate: number; seconds: number };

/** Any audio the browser can read -> mono float samples at 16 kHz. */
export async function decodeMono(input: File | ArrayBuffer): Promise<Decoded> {
  const raw = input instanceof ArrayBuffer ? input : await input.arrayBuffer();

  // Decoding into a 16 kHz context resamples as part of the decode, which
  // keeps memory down for long calls.
  const ctx = new OfflineAudioContext(1, 1, DECODE_RATE);
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(raw);
  } catch {
    throw new Error(
      "This browser could not read that audio file. Try exporting it from the dialer as MP3."
    );
  }

  const length = decoded.length;
  const n = decoded.numberOfChannels;
  let pcm: Float32Array;
  if (n === 1) {
    pcm = decoded.getChannelData(0);
  } else {
    pcm = new Float32Array(length);
    const channels = Array.from({ length: n }, (_, c) => decoded.getChannelData(c));
    for (let i = 0; i < length; i++) {
      let s = 0;
      for (let c = 0; c < n; c++) s += channels[c][i];
      pcm[i] = s / n;
    }
  }
  return { pcm, rate: DECODE_RATE, seconds: decoded.duration };
}

/** Mono 16 kHz samples -> a small speech-quality MP3. */
export async function encodeMp3(
  audio: Decoded,
  name: string,
  onProgress: (fraction: number) => void
): Promise<File> {
  const { pcm } = audio;
  const length = pcm.length;

  const { Mp3Encoder } = await import("@breezystack/lamejs");
  const encoder = new Mp3Encoder(1, audio.rate, KBPS);
  const parts: Uint8Array[] = [];
  const buf = new Int16Array(FRAME);

  let frames = 0;
  for (let i = 0; i < length; i += FRAME) {
    const end = Math.min(i + FRAME, length);
    const chunk = end - i === FRAME ? buf : new Int16Array(end - i);
    for (let k = i; k < end; k++) {
      const s = pcm[k];
      chunk[k - i] = s < -1 ? -32768 : s > 1 ? 32767 : Math.round(s * 32767);
    }
    const out = encoder.encodeBuffer(chunk);
    if (out.length) parts.push(out.slice());
    if (++frames % FRAMES_PER_YIELD === 0) {
      onProgress(i / length);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  const tail = encoder.flush();
  if (tail.length) parts.push(tail.slice());
  onProgress(1);

  return new File(parts as BlobPart[], name.replace(/\.[^.]+$/, "") + ".mp3", {
    type: "audio/mpeg",
  });
}
