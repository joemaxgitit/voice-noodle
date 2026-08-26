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
    short: "Firm and unwavering. You already know.",
    body:
      "Firm and unwavering. You are not hoping they agree \u2014 you already know. " +
      "Certainty transfers: whatever you feel, they feel.",
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
    short: "Certainty with a righteous edge. Indignant on their behalf.",
    body:
      "A Lionside tone, not a Straight Line one. Absolute Certainty with a " +
      "righteous edge \u2014 indignant on their behalf, in the spirit of the pulpit.",
  },
];

/** Match a tone code from the database, tolerating case and spacing. */
export function findTone(code: string): Tone | undefined {
  const key = code.trim().toUpperCase().replace(/\s+/g, " ");
  return TONES.find((t) => t.code.toUpperCase() === key);
}
