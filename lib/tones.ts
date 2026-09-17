import type { Lang } from "@/lib/lang";

/**
 * Single source of truth for the tone system.
 *
 * Used by the training card (contextual, only the tones on that card) and by
 * the footer key (all of them). One definition, two presentations -- so they
 * can never drift apart.
 *
 * Each tone carries English and Spanish copy. The CODE is never translated:
 * it is what is stored in segments.tones and printed on the chips, and a
 * Spanish card shows "AC" beside "Certeza Absoluta" rather than a translated
 * abbreviation that nothing in the data would match.
 */
export type ToneCopy = {
  name: string;
  /** One line, shown on the card beside the chip while the rep is working. */
  short: string;
  /** Fuller definition for the footer key. */
  body: string;
};

export type Tone = ToneCopy & {
  code: string;
  es: ToneCopy;
};

export const TONES: Tone[] = [
  {
    code: "AC",
    name: "Absolute Certainty",
    short: "Hard and definitive. You are just absolutely certain.",
    body:
      "A hard, definitive tone when you are implying something and are just " +
      "absolutely certain about it.",
    es: {
      name: "Certeza Absoluta",
      short: "Firme y definitivo. Estás absolutamente seguro.",
      body:
        "Un tono firme y definitivo cuando estás insinuando algo y estás " +
        "absolutamente seguro de ello.",
    },
  },
  {
    code: "I CARE",
    name: "I Care",
    short: "Empathy for what they just told you. Then stop talking.",
    body:
      "Genuine empathy in response to what they just told you. Never say you " +
      "care. Let the tone say it, and then stop talking.",
    es: {
      name: "Me Importa",
      short: "Empatía por lo que acaban de contarte. Después, cállate.",
      body:
        "Empatía genuina en respuesta a lo que acaban de contarte. Nunca digas " +
        "que te importa. Deja que el tono lo diga, y después deja de hablar.",
    },
  },
  {
    code: "PT",
    name: "Presupposing Tone",
    short: "Say it like it goes without saying.",
    body:
      "Implied obviousness. Deliver it as something self-evident that goes " +
      "without saying, so it is absorbed rather than questioned.",
    es: {
      name: "Tono de Presuposición",
      short: "Dilo como si no hiciera falta decirlo.",
      body:
        "Obviedad implícita. Dilo como algo evidente que no hace falta " +
        "explicar, para que se absorba en vez de cuestionarse.",
    },
  },
  {
    code: "RM",
    name: "Reasonable Man",
    short: "We are both reasonable people, right? No big deal.",
    body:
      "Calm and level, on the small asks. We are both reasonable people here, " +
      "right? It implies that what you want is no big deal.",
    es: {
      name: "El Hombre Razonable",
      short: "Los dos somos razonables, ¿verdad? No es gran cosa.",
      body:
        "Calmado y parejo, en las peticiones pequeñas. Los dos somos personas " +
        "razonables aquí, ¿verdad? Da a entender que lo que pides no es gran cosa.",
    },
  },
  {
    code: "S",
    name: "Scarcity",
    short: "Drop your voice. Urgency, and a secret.",
    body:
      "Drop your voice toward a near-whisper. Creates urgency and the feeling " +
      "that they are being let in on something.",
    es: {
      name: "Escasez",
      short: "Baja la voz. Urgencia, y un secreto.",
      body:
        "Baja la voz casi a un susurro. Crea urgencia y la sensación de que les " +
        "estás confiando algo.",
    },
  },
  {
    code: "CALM",
    name: "Calm",
    short: "Reassuring and steady. The antidote to their uncertainty.",
    body:
      "Reassuring and steady, like a warm blanket. This is the antidote when " +
      "you hear any hint of uncertainty from them.",
    es: {
      name: "Calma",
      short: "Tranquilizador y firme. El antídoto a su incertidumbre.",
      body:
        "Tranquilizador y parejo, como una cobija tibia. Este es el antídoto " +
        "cuando escuchas cualquier señal de duda de su parte.",
    },
  },
  {
    code: "Preacher",
    name: "The Preacher",
    short: "Absolute Certainty plus annoyance. Pulpit energy.",
    body:
      "Tone of Absolute Certainty with the added layer of annoyance and in " +
      "the spirit of the pulpit.",
    es: {
      name: "El Predicador",
      short: "Certeza Absoluta con algo de fastidio. Energía de púlpito.",
      body:
        "Tono de Certeza Absoluta con una capa añadida de fastidio, en el " +
        "espíritu del púlpito.",
    },
  },
];

/** The copy for a tone in the language being read. */
export function toneCopy(t: Tone, lang: Lang): ToneCopy {
  return lang === "es"
    ? t.es
    : { name: t.name, short: t.short, body: t.body };
}

/** Match a tone code from the database, tolerating case and spacing. */
export function findTone(code: string): Tone | undefined {
  const key = code.trim().toUpperCase().replace(/\s+/g, " ");
  return TONES.find((t) => t.code.toUpperCase() === key);
}

/** Headings and the closing note, which also need translating. */
export const TONE_KEY_COPY: Record<Lang, { title: string; hint: string; note: string }> = {
  en: {
    title: "Tone key",
    hint: "The shift between tones is the skill",
    note:
      "Never sit in one tone for long. Holding a single tonality is how a " +
      "client habituates and tunes out — the movement between tones is what " +
      "they actually respond to.",
  },
  es: {
    title: "Guía de tonos",
    hint: "El cambio entre tonos es la habilidad",
    note:
      "Nunca te quedes mucho tiempo en un solo tono. Mantener una sola " +
      "tonalidad es como el cliente se acostumbra y desconecta — el movimiento " +
      "entre tonos es lo que de verdad les llega.",
  },
};

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
