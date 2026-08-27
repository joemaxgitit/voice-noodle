/**
 * Single source of truth for the tone system.
 *
 * Used by the training card (contextual, only the tones on that card) and by
 * the footer key (all of them). One definition, two presentations -- so they
 * can never drift apart.
 */

export type Tone = {
  code: string;
  name: string;
  /** One line, shown on the card beside the chip while the rep is working. */
  short: string;
  /** Fuller definition for the footer key. */
  body: string;
};

export const TONES: Tone[] = [
  {
    code: "AC",
    name: "Absolute Certainty",
    short: "Hard and definitive. You are just absolutely certain.",
    body:
      "A hard, definitive tone when you are implying something and are just " +
      "absolutely certain about it.",
  },
  {
    code: "I CARE",
    name: "I Care",
    short: "Empathy for what they just told you. Then stop talking.",
    body:
      "Genuine empathy in response to what they just told you. Never say you " +
      "care. Let the tone say it, and then stop talking.",
  },
  {
    code: "PT",
    name: "Presupposing Tone",
    short: "Say it like it goes without saying.",
    body:
      "Implied obviousness. Deliver it as something self-evident that goes " +
      "without saying, so it is absorbed rather than questioned.",
  },
  {
    code: "RM",
    name: "Reasonable Man",
    short: "We are both reasonable people, right? No big deal.",
    body:
      "Calm and level, on the small asks. We are both reasonable people here, " +
      "right? It implies that what you want is no big deal.",
  },
  {
    code: "S",
    name: "Scarcity",
    short: "Drop your voice. Urgency, and a secret.",
    body:
      "Drop your voice toward a near-whisper. Creates urgency and the feeling " +
      "that they are being let in on something.",
  },
  {
    code: "CALM",
    name: "Calm",
    short: "Reassuring and steady. The antidote to their uncertainty.",
    body:
      "Reassuring and steady, like a warm blanket. This is the antidote when " +
      "you hear any hint of uncertainty from them.",
  },
  {
    code: "Preacher",
    name: "The Preacher",
    short: "Absolute Certainty plus annoyance. Pulpit energy.",
    body:
      "Tone of Absolute Certainty with the added layer of annoyance and in " +
      "the spirit of the pulpit.",
  },
];

/** Match a tone code from the database, tolerating case and spacing. */
export function findTone(code: string): Tone | undefined {
  const key = code.trim().toUpperCase().replace(/\s+/g, " ");
  return TONES.find((t) => t.code.toUpperCase() === key);
}

export type ToneSpan = { tone: string; text: string };

/**
 * Which tone covers each phrase of a segment.
 *
 * The script marks tones inline — "AC We specialize... I CARE Today we will
 * go over... RM Sound good?" — so a tone belongs to a stretch of words, not
 * to the whole segment. Phrases come from the recording's timing data and do
 * not necessarily align with the tone boundaries, so we walk both by
 * character offset and report the tone in force at each phrase's start.
 *
 * Returns one entry per phrase: the tone covering it, or "" where the script
 * marks none.
 */
export function tonesForPhrases(
  toneMap: ToneSpan[] | null,
  phraseTexts: string[]
): string[] {
  if (!toneMap || toneMap.length === 0) return phraseTexts.map(() => "");

  // character ranges of each tone span
  const ranges: { tone: string; end: number }[] = [];
  let at = 0;
  for (const span of toneMap) {
    at += span.text.length + 1; // the joining space
    ranges.push({ tone: span.tone || "", end: at });
  }

  const out: string[] = [];
  let cursor = 0;
  for (const text of phraseTexts) {
    const hit = ranges.find((r) => cursor < r.end);
    out.push(hit ? hit.tone : "");
    cursor += text.length + 1;
  }
  return out;
}
