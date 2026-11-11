import type { ScribeWord, Transcript } from "./calls";
import { paceOf, type PaceRead } from "./pace";

/*
  Whole-script run-throughs: a rep reads the entire script in one take. After
  it's transcribed, everything here is worked out in code (no AI, no cost):
  which lines were said, the word-for-word lines, pace, long pauses and how
  long each section took. Then one AI read on tone and coaching (lib side in
  app/api/script-takes/review).
*/

export type RunLineStatus = "said" | "partly" | "missed";
export type RunLine = {
  code: string;
  section: string;
  /** First words of the line, so a list of misses is readable. */
  text: string;
  verbatim: boolean;
  /** A branch line ("if they say..."): not counted against them when skipped. */
  optional: boolean;
  status: RunLineStatus;
  /** For word-for-word lines: exact, close or missed. */
  exact?: "exact" | "close" | "missed";
  match: number;
  time: number | null;
};

export type RunSection = { title: string; start: number | null; secs: number | null; said: number; total: number };
export type RunNeed = { title: string; why: string; time: number | null; fix: string };
export type RunAi = {
  score: number;
  summary: string;
  tonality: { summary: string; checks: { time: number | null; tone: string; expected: string; heard: string; match: "yes" | "partial" | "no" }[] };
  needs: RunNeed[];
  strengths: { text: string; time: number | null }[];
};

export type RunReview = {
  v: 1;
  /** % of the required (non-branch) lines said. */
  coverage: number;
  lines: RunLine[];
  sections: RunSection[];
  verbatim: { total: number; exact: number; close: number; missed: number };
  pace: PaceRead | null;
  pauses: { at: number; secs: number }[];
  ai?: RunAi | null;
  ai_error?: string | null;
};

export type ScriptLine = { segment_code: string; script_text: string; verbatim: boolean; condition: string | null; section: string; tones: string[] };

const LONG_PAUSE = 4; // seconds of silence worth pointing out

const norm = (s: string) =>
  s
    .replace(/\([^)]*\)|\[[^\]]*\]|_{2,}/g, " ") // placeholders: (Client's Name), [amount], ___
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/'/g, "")
    .split(/\s+/)
    .filter(Boolean);

type W = { w: string; start: number; end: number };

/** All the code-only checks. `words` are the transcriber's words with their times. */
export function checkRun(words: ScribeWord[], transcript: Transcript, script: ScriptLine[]): RunReview {
  const ws: W[] = [];
  for (const x of words) {
    if ((x.type ?? "word") !== "word" || !x.text) continue;
    for (const w of norm(x.text)) ws.push({ w, start: x.start ?? 0, end: x.end ?? x.start ?? 0 });
  }

  // Where each word pair occurs in the take.
  const bi = new Map<string, number[]>();
  for (let i = 0; i + 1 < ws.length; i++) {
    const k = `${ws[i].w} ${ws[i + 1].w}`;
    const arr = bi.get(k);
    if (arr) arr.push(i);
    else bi.set(k, [i]);
  }

  let ptr = 0;
  const lines: RunLine[] = [];
  for (const s of script) {
    const toks = norm(s.script_text);
    const pairs = [...new Set(toks.slice(0, -1).map((w, i) => `${w} ${toks[i + 1]}`))];
    const optional = !!s.condition?.trim();
    const preview = s.script_text.replace(/\s+/g, " ").trim().slice(0, 90);
    if (pairs.length === 0) {
      // One-word lines can't be matched reliably; leave them out of the counts.
      continue;
    }
    // Candidate starts: where its pairs show up, not too far behind where we are.
    const span = Math.max(8, Math.round(toks.length * 1.8));
    const hits: number[] = [];
    for (const p of pairs) for (const i of bi.get(p) || []) if (i >= ptr - 40) hits.push(i);
    hits.sort((a, b) => a - b);
    let best = { n: 0, from: -1, to: -1 };
    for (let a = 0, b = 0; b < hits.length; b++) {
      while (hits[b] - hits[a] > span) a++;
      // distinct pairs inside this window
      const seen = new Set<string>();
      for (let i = hits[a]; i <= hits[b]; i++) {
        const k = `${ws[i]?.w} ${ws[i + 1]?.w}`;
        if (pairs.includes(k)) seen.add(k);
      }
      if (seen.size > best.n || (seen.size === best.n && best.from >= 0 && hits[a] < best.from && hits[a] >= ptr)) best = { n: seen.size, from: hits[a], to: hits[b] + 1 };
    }
    const match = best.n / pairs.length;
    const status: RunLineStatus = match >= 0.7 ? "said" : match >= 0.35 ? "partly" : "missed";
    const line: RunLine = {
      code: s.segment_code,
      section: s.section,
      text: preview,
      verbatim: s.verbatim,
      optional,
      status,
      match: Math.round(match * 100),
      time: best.from >= 0 && status !== "missed" ? Math.round(ws[best.from].start) : null,
    };
    if (s.verbatim) line.exact = match >= 0.9 ? "exact" : match >= 0.4 ? "close" : "missed";
    lines.push(line);
    if (status === "said" && best.to > ptr) ptr = best.to;
  }

  const required = lines.filter((l) => !l.optional);
  const coverage = required.length ? Math.round((required.filter((l) => l.status === "said").length / required.length) * 100) : 0;
  const vb = lines.filter((l) => l.verbatim && !l.optional);
  const verbatim = {
    total: vb.length,
    exact: vb.filter((l) => l.exact === "exact").length,
    close: vb.filter((l) => l.exact === "close").length,
    missed: vb.filter((l) => l.exact === "missed").length,
  };

  // Sections: from the first line said in each to the first line said in the next.
  const order: string[] = [];
  for (const l of lines) if (!order.includes(l.section)) order.push(l.section);
  const starts = order.map((t) => {
    const ts = lines.filter((l) => l.section === t && l.time !== null).map((l) => l.time!);
    return ts.length ? Math.min(...ts) : null;
  });
  const endOfTake = ws.length ? ws[ws.length - 1].end : 0;
  const sections: RunSection[] = order.map((title, i) => {
    const st = starts[i];
    const next = starts.slice(i + 1).find((x) => x !== null && st !== null && x > st) ?? null;
    const own = lines.filter((l) => l.section === title && !l.optional);
    return {
      title,
      start: st,
      secs: st === null ? null : Math.max(0, Math.round((next ?? endOfTake) - st)),
      said: own.filter((l) => l.status === "said").length,
      total: own.length,
    };
  });

  // Long silences between words.
  const pauses: { at: number; secs: number }[] = [];
  for (let i = 1; i < ws.length; i++) {
    const gap = ws[i].start - ws[i - 1].end;
    if (gap >= LONG_PAUSE) pauses.push({ at: Math.round(ws[i - 1].end), secs: Math.round(gap) });
  }

  // Pace: one reader, so every line counts as theirs.
  const solo: Transcript = { ...transcript, speakers: ["rep"], utterances: transcript.utterances.map((u) => ({ ...u, speaker: "rep" })) };
  const pace = paceOf(
    solo,
    "rep",
    sections.filter((s) => s.start !== null).map((s) => ({ section: s.title, time: s.start }))
  );

  return { v: 1, coverage, lines, sections, verbatim, pace, pauses };
}

/** The script laid out for the AI read, with tone markers and word-for-word flags. */
export function scriptForReview(script: ScriptLine[]): string {
  let last = "";
  const out: string[] = [];
  for (const s of script) {
    if (s.section !== last) {
      out.push(`\n## ${s.section}`);
      last = s.section;
    }
    out.push(`${s.tones?.length ? `[${s.tones.join(", ")}] ` : ""}${s.verbatim ? "(WORD FOR WORD) " : ""}${s.condition ? `(only if: ${s.condition}) ` : ""}${s.script_text.trim()}`);
  }
  return out.join("\n");
}

export const RUN_AI_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["score", "summary", "tonality", "needs", "strengths"],
  properties: {
    score: { type: "integer" },
    summary: { type: "string" },
    tonality: {
      type: "object",
      additionalProperties: false,
      required: ["summary", "checks"],
      properties: {
        summary: { type: "string" },
        checks: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["time", "tone", "expected", "heard", "match"],
            properties: {
              time: { type: ["number", "null"] },
              tone: { type: "string" },
              expected: { type: "string" },
              heard: { type: "string" },
              match: { type: "string", enum: ["yes", "partial", "no"] },
            },
          },
        },
      },
    },
    needs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "why", "time", "fix"],
        properties: { title: { type: "string" }, why: { type: "string" }, time: { type: ["number", "null"] }, fix: { type: "string" } },
      },
    },
    strengths: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["text", "time"], properties: { text: { type: "string" }, time: { type: ["number", "null"] } } },
    },
  },
} as const;

/** How to read the voice measurements and the Tone Key -- the same guide the call grader uses. */
export const TONE_GUIDE = "Most transcript lines carry measurements taken from the recording itself, in braces, for example {pitch moves 6.2st, ends falling, quieter by 4dB, 168wpm, after 1.3s pause}:\n- pitch moves Xst: how much the voice rose and fell within that line, in semitones. Under ~2 is flat; 4-8 is normal expressive speech; 10+ is very animated.\n- higher / lower than usual: the line's pitch against that speaker's own normal voice.\n- ends rising / falling / level: the pitch at the end of the line against the rest of it.\n- louder / quieter by XdB: against that speaker's own normal volume. 3dB is noticeable, 6dB is a clear change, 10dB+ is dramatic.\n- wpm: speaking pace for that line. after Xs pause: silence before it.\nA summary per speaker comes before the transcript, including long flat stretches. These are measured from phone audio, so treat them as good evidence rather than exact -- one odd reading is noise; a pattern is real.\nWhat each tone sounds like, measured that way (from the Tone Key):\n- AC (Absolute Certainty): hard and definitive -- firm, steady or louder volume, falling ends, no rush, no hesitation.\n- I CARE: genuine empathy, then stop talking -- softer and often slower or lower than usual, then a pause for the client.\n- PT (Presupposing): said like it goes without saying -- matter-of-fact, level or falling ends, even pace.\n- RM (Reasonable Man): calm and level on small asks -- relaxed, with the ask ending rising (\"Sound good?\").\n- S (Scarcity): drop toward a near-whisper -- clearly quieter.\n- CALM: reassuring and steady -- slow, even, little movement. Flat is RIGHT here; never call CALM monotone.\n- PREACHER: Absolute Certainty with annoyance and the spirit of the pulpit -- louder and more animated.\nThe Tone Key's own rule: never sit in one tone for long; the movement between tones is what clients respond to. Long flat stretches outside CALM, rushing (well above that rep's usual pace) through key moments, and statements that end rising (sounding unsure) all count against tonality.";
