/*
  Bleeps the redacted numbers out of a call recording.

  The transcript already knows where each bank, card or ID number was said
  (lib/calls.ts, redact_spans). This replaces those stretches of audio with a
  soft tone, so the stored recording no longer contains them. Everything
  else in the call stays exactly where it was -- timestamps still line up.

  Runs in the manager's browser with the same decoder and encoder as upload
  compression: nothing extra to pay for, nothing sent anywhere new.
*/
import { decodeMono, encodeMp3 } from "@/lib/shrinkAudio";
import { mergeSpans, type Span } from "@/lib/calls";

/* Extra time bleeped either side of each number. Word timestamps can land a
   fraction early or late, and a clipped first digit is still a digit. */
const PAD = 0.4;
const TONE_HZ = 1000;
const TONE_LEVEL = 0.08; // quiet: clearly "something removed", not a shriek
const FADE = 0.02; // seconds, so the tone starts and stops without a click

export async function bleepAudio(
  audio: ArrayBuffer,
  spans: Span[],
  name: string,
  onProgress: (stage: string) => void
): Promise<{ file: File; spans: number; seconds: number }> {
  onProgress("Reading recording...");
  const decoded = await decodeMono(audio);
  const { pcm, rate } = decoded;

  const padded = mergeSpans(
    spans.map((s) => ({ start: Math.max(0, s.start - PAD), end: s.end + PAD })),
    0
  );

  let removed = 0;
  for (const s of padded) {
    const a = Math.max(0, Math.floor(s.start * rate));
    const b = Math.min(pcm.length, Math.ceil(s.end * rate));
    if (b <= a) continue;
    const fade = Math.floor(FADE * rate);
    for (let i = a; i < b; i++) {
      const k = i - a;
      const env = Math.min(1, k / fade, (b - 1 - i) / fade);
      pcm[i] = TONE_LEVEL * Math.max(0, env) * Math.sin((2 * Math.PI * TONE_HZ * k) / rate);
    }
    removed += 1;
  }

  const seconds = decoded.seconds;
  const file = await encodeMp3(decoded, name.replace(/\.[^.]+$/, "") + "-redacted.mp3", (f) =>
    onProgress(`Saving cleaned recording ${Math.round(f * 100)}%...`)
  );

  /*
    The original is deleted once this file is stored, so make sure it is a
    whole, playable recording first: decode it again and compare lengths.
  */
  onProgress("Checking cleaned recording...");
  const check = await decodeMono(await file.arrayBuffer());
  if (Math.abs(check.seconds - seconds) > Math.max(1, seconds * 0.02)) {
    throw new Error("The cleaned recording did not come out right, so the original was kept.");
  }
  return { file, spans: removed, seconds };
}
