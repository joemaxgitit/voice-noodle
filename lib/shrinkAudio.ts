/*
  Shrinks a call recording in the browser before upload.

  Dialer MP3s are often 128 kbps stereo -- about 55 MB an hour, over Supabase's
  50 MB per-file limit on the free plan. Phone audio only carries ~8 kHz of
  real information, so re-encoding to 16 kHz mono at 32 kbps loses nothing the
  transcriber can use and comes out around 14 MB an hour.

  Runs entirely on the manager's computer; nothing leaves the browser until
  the smaller file is uploaded.
*/

const TARGET_RATE = 16_000;
const KBPS = 32;
const FRAME = 1152; // samples per MP3 frame
const FRAMES_PER_YIELD = 400; // keep the page responsive while encoding

/** Files at or under this size are uploaded as they are. */
export const SHRINK_OVER_BYTES = 20 * 1024 * 1024;

export type Shrunk = { file: File; seconds: number };

export async function shrinkAudio(
  file: File,
  onProgress: (fraction: number) => void
): Promise<Shrunk> {
  const raw = await file.arrayBuffer();

  // Decoding into a 16 kHz context resamples as part of the decode, which
  // keeps memory down for long calls.
  const ctx = new OfflineAudioContext(1, 1, TARGET_RATE);
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(raw);
  } catch {
    throw new Error(
      "This browser could not read that audio file. Try exporting it from the dialer as MP3."
    );
  }

  // Mix to mono 16-bit.
  const length = decoded.length;
  const pcm = new Int16Array(length);
  const channels = Array.from({ length: decoded.numberOfChannels }, (_, c) =>
    decoded.getChannelData(c)
  );
  const n = channels.length;
  for (let i = 0; i < length; i++) {
    let s = 0;
    for (let c = 0; c < n; c++) s += channels[c][i];
    s /= n;
    pcm[i] = s < -1 ? -32768 : s > 1 ? 32767 : Math.round(s * 32767);
  }
  const seconds = decoded.duration;

  const { Mp3Encoder } = await import("@breezystack/lamejs");
  const encoder = new Mp3Encoder(1, TARGET_RATE, KBPS);
  const parts: Uint8Array[] = [];

  let frames = 0;
  for (let i = 0; i < length; i += FRAME) {
    const out = encoder.encodeBuffer(pcm.subarray(i, i + FRAME));
    if (out.length) parts.push(out.slice());
    if (++frames % FRAMES_PER_YIELD === 0) {
      onProgress(i / length);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  const tail = encoder.flush();
  if (tail.length) parts.push(tail.slice());
  onProgress(1);

  const name = file.name.replace(/\.[^.]+$/, "") + ".mp3";
  return {
    file: new File(parts as BlobPart[], name, { type: "audio/mpeg" }),
    seconds: Math.round(seconds),
  };
}
