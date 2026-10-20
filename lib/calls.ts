/*
  Call monitoring: shared types and the transcript pipeline that runs between
  ElevenLabs and the database.

  Nothing in here talks to the network, so it runs the same on the server
  (where transcripts are built) and in the browser (where they are shown).
*/

export type CallStatus =
  | "live" // a practice call still in progress
  | "uploading"
  | "uploaded"
  | "transcribing"
  | "transcribed"
  | "grading"
  | "graded"
  | "failed";

export type Role = "rep" | "client" | "am" | "other";

export const ROLE_LABEL: Record<Role, string> = {
  rep: "Rep",
  client: "Client",
  am: "Account manager",
  other: "Other",
};

export type Utterance = {
  speaker: string; // raw id from the transcriber: "speaker_0", "agent", ...
  start: number;
  end: number;
  text: string;
};

export type Span = { start: number; end: number };

export type Transcript = {
  utterances: Utterance[];
  speakers: string[]; // in order of first appearance
  language?: string | null;
  /** Where each redacted number was said, in seconds -- used to bleep the
   *  recording itself. Missing on calls transcribed before this existed. */
  redact_spans?: Span[];
};

export type SectionResult = {
  section: string;
  status: "hit" | "partial" | "missed" | "not_reached";
  evidence: string;
  time: number | null;
  coaching: string;
};

export type ComplianceResult = {
  item: string;
  status: "yes" | "no" | "unclear" | "not_reached";
  evidence: string;
  time: number | null;
};

export type Flag = {
  time: number | null;
  quote: string;
  issue: string;
  in_script: boolean;
  severity: "high" | "medium" | "low";
};

export type ArcStage = {
  stage: string;
  section?: string; // the script section this stage happened in, as the grader read it
  voice?: string; // how the rep's voice served this stage
  intended: string;
  observed: string;
  landed: "yes" | "partial" | "no" | "not_reached";
  evidence: string;
  time: number | null;
};

export type SlpSkill = {
  skill: string;
  score: number | null; // 1-10, null = no chance to show it
  evidence: string;
  time: number | null;
  coaching: string;
};

export type Tonality = {
  summary: string;
  flat_stretches: { start: number; end: number; note: string }[];
  tone_checks: {
    time: number | null;
    tone: string;
    expected: string;
    heard: string;
    match: "yes" | "partial" | "no";
  }[];
};

export type ThreeTens = {
  product: number | null;
  rep: number | null;
  company: number | null;
  evidence: string;
};

export type Outcome = "enrolled" | "callback" | "not_interested" | "hung_up" | "other";

export const OUTCOME_LABEL: Record<Outcome, string> = {
  enrolled: "Enrolled",
  callback: "Callback set",
  not_interested: "Not interested",
  hung_up: "Hung up",
  other: "Other",
};

/* Retention: whether an enrolled client stayed. Entered by a manager for
   now; the Bolton retention agent can fill it in later, matched on the
   lead ID in the Client field. */
export type Retention = "active" | "cancelled" | "graduated" | "paid6";

/** Proven sales: the client graduated, or made more than 6 payments. These are the calls we push reps toward. */
export const PROVEN: Retention[] = ["graduated", "paid6"];
export const RETENTION_LABEL: Record<Retention, string> = { active: "Active", cancelled: "Cancelled", graduated: "Graduated", paid6: "Made 6+ payments" };

export const CANCEL_REASONS: Record<string, string> = {
  remorse: "Buyer's remorse",
  afford: "Couldn't afford it",
  misunderstood: "Misunderstood the program",
  pressure: "Creditor or legal pressure",
  family: "Family talked them out of it",
  other: "Other",
};

/** Days from the sales call to the cancellation, or null if either date is missing. */
export function daysToCancel(callDate: string | null, cancelDate: string | null): number | null {
  if (!callDate || !cancelDate) return null;
  const a = new Date(`${callDate}T00:00:00`).getTime();
  const b = new Date(`${cancelDate}T00:00:00`).getTime();
  if (!isFinite(a) || !isFinite(b)) return null;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

export type TurningPoint = {
  time: number | null;
  moment: string;
  direction: "toward" | "away";
  why: string;
};

export type Spotlights = {
  followup?: {
    kind: "first" | "followup" | "one_call";
    ended_open: boolean;
    stall_stated: string;
    stall_real: string;
    got_to_bottom: "yes" | "partly" | "no" | "n/a";
    next_step: "set" | "vague" | "none" | "n/a";
    next_step_detail: string;
    reopen: string;
    rebuilt: "yes" | "partly" | "no" | "n/a";
    repeat_stall: boolean;
    read: string;
  };
  hardship: { moved_on_at: number; vulnerable_secs: number; deepest: string; best_question: string; cut_short: string; cut_short_time: number; read: string };
  turndown: {
    happened: boolean;
    at: number;
    client_reaction: string;
    pickup: "strong" | "ok" | "flat" | "n/a";
    pickup_evidence: string;
    options_even: "yes" | "partly" | "no" | "n/a";
    options_note: string;
    recovered: "yes" | "partly" | "no" | "n/a";
    read: string;
  };
};

/** The hardship target on this team: keep the client on vulnerable topics until 8-12 minutes from the start of the call. */
export const HARDSHIP_TARGET = { from: 8 * 60, to: 12 * 60 };
export const hardshipBand = (secs: number) => (secs >= HARDSHIP_TARGET.from ? "good" : secs >= 5 * 60 ? "fair" : "poor");

export type Grade = {
  speaker_roles: { speaker: string; role: Role }[];
  summary: string;
  furthest_point: string;
  sections: SectionResult[];
  compliance: ComplianceResult[];
  flags: Flag[];
  strengths: string[];
  coaching_priorities: string[];
  // Straight Line. Optional: grades made before it was added lack them.
  emotional_arc?: ArcStage[];
  slp?: SlpSkill[];
  three_tens?: ThreeTens;
  slp_summary?: string;
  tonality?: Tonality;
  // Outcome. Explains the result; never adds points to either score.
  outcome?: Outcome;
  outcome_note?: string;
  turning_points?: TurningPoint[];
  close_quality?: "solid" | "fragile" | "n/a";
  close_quality_reason?: string;
  /** Hardship depth and the loan-turndown pickup. Extra awareness only; never in either score. */
  spotlights?: Spotlights;
  model?: string;
  graded_at?: string;
};

/*
  The emotional roadmap of a sale -- Max's own, in his words. This is the
  backbone of the Straight Line grade: each stage is graded on whether the
  client actually reached the feeling it is built to create, and the arc is
  half of the Straight Line score. Stages are found wherever they happen on
  the call, not by script section ("Hopeless" happens inside SuperMoney).
  Edit here to change the roadmap; nothing else needs to change.
*/
export const ROADMAP: { stage: string; feel: string; label: string }[] = [
  { stage: "Intro", label: "Opening", feel: "trust and comfort" },
  { stage: "Intelligence gathering (hardship)", label: "Hardship", feel: "opens up, feels heard, the pain gets real" },
  { stage: "Create the villain", label: "Create the Villain", feel: "anger at the system as a whole -- it's not my fault" },
  { stage: "Hope spike", label: "SuperMoney (loan offer)", feel: "hope -- the SuperMoney loan might fix this" },
  { stage: "Hopeless", label: "SuperMoney (no loan)", feel: "the drop -- the loan isn't available" },
  {
    stage: "Light at the end of the tunnel",
    label: "Three Options",
    feel: "relief -- there are real options -- and empowered, because the choice is handed back to them",
  },
  { stage: "The pitch", label: "The Pitch", feel: "understands the program and believes it fits" },
  { stage: "Credit review", label: "Credit Review", feel: "urgency -- the pain made concrete by maxed-out accounts" },
  { stage: "More about Bolton", label: "More About Bolton", feel: "certainty in the company" },
  { stage: "The close", label: "The Close", feel: "certain enough to act" },
  { stage: "Contract and compliance", label: "Contract & Compliance", feel: "clear on exactly what they agreed to" },
  { stage: "Button up", label: "The Button Up", feel: "committed, and patient for the long haul" },
];

/** Lowercase roadmap stage name for display beside the section label ("hope spike"). */
export function stageTerm(stage: string): string {
  return stage.replace(/\s*\(.*\)\s*$/, "").toLowerCase();
}

/**
 * What managers see for a roadmap stage: the script section it happened in
 * (as the grader recorded it), else the standard section for that stage.
 * Grading still runs on the roadmap stage itself.
 */
export function stageLabel(stage: string, section?: string | null): string {
  if (section && section.trim()) return section.trim();
  return ROADMAP.find((r) => r.stage.toLowerCase() === stage.toLowerCase())?.label ?? stage;
}

/** "en" or "es" from whatever code the transcriber returned ("eng", "spa", "es-MX"...). */
export function langOf(code: string | null | undefined): "en" | "es" {
  const c = (code || "").toLowerCase();
  return c.startsWith("es") || c.startsWith("spa") ? "es" : "en";
}

/** English version of a Spanish transcript, one line per utterance. */
export type Translation = {
  status: "working" | "done" | "failed";
  lines?: string[]; // same length and order as transcript.utterances
  model?: string;
  usd?: number | null;
  error?: string;
  started_at?: string;
};

/** A translation job is presumed dead after this long. */
export function translationStuck(t: Translation | null): boolean {
  return (
    t?.status === "working" &&
    !!t.started_at &&
    Date.now() - new Date(t.started_at).getTime() > STUCK_AFTER_MS
  );
}

/** A grade that has since been replaced by a re-grade. */
export type GradeVersion = { grade: Grade; score: number | null; slp_score?: number | null };

/** What processing one call cost. Estimates from list prices. */
export type CallCost = {
  transcribe_secs?: number;
  transcribe_usd?: number;
  grade_model?: string;
  grade_input_tokens?: number;
  grade_cache_read_tokens?: number;
  grade_cache_write_tokens?: number;
  grade_output_tokens?: number;
  grade_usd?: number | null; // the latest grading run
  grade_usd_total?: number; // every grading run on this call, re-grades included
  roleplay_secs?: number; // practice call with a mock client
  roleplay_usd?: number;
};

/*
  List prices, USD. Update these if the providers change their pricing.
  ElevenLabs: Scribe v2 $0.22/hour + keyterm prompting $0.05/hour.
  Anthropic: per million tokens.
*/
export const TRANSCRIBE_USD_PER_HOUR = 0.22 + 0.05;

const CLAUDE_PRICES: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  "claude-sonnet-5-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.1 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
};

export function transcribeCostUsd(seconds: number): number {
  return (seconds / 3600) * TRANSCRIBE_USD_PER_HOUR;
}

/** Null when the model is not in the price table. */
export function gradeCostUsd(
  model: string,
  u: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  }
): number | null {
  const p = CLAUDE_PRICES[model];
  if (!p) return null;
  return (
    ((u.input_tokens ?? 0) * p.input +
      (u.output_tokens ?? 0) * p.output +
      (u.cache_creation_input_tokens ?? 0) * p.cacheWrite +
      (u.cache_read_input_tokens ?? 0) * p.cacheRead) /
    1_000_000
  );
}

export function money(usd: number | null | undefined): string {
  if (usd === null || usd === undefined) return "?";
  return usd < 0.01 ? "<$0.01" : `$${usd.toFixed(2)}`;
}

/** ElevenLabs Scribe word, as returned by /v1/speech-to-text. */
export type ScribeWord = {
  text: string;
  start?: number;
  end?: number;
  type?: string; // "word" | "spacing" | "audio_event"
  speaker_id?: string;
};

/* ------------------------------------------------------------------------
   Redaction backstop

   ElevenLabs already redacts the entity types we ask for. This is the second
   net, because spoken digit strings are exactly where entity detection is
   weakest: "zero two one, zero zero zero, oh eight nine" can come back as
   words, digits, or a mix, split across many tokens.

   Rule: any run of 6+ digits -- written or spoken, with spaces, dashes or
   commas between -- becomes [REDACTED], unless it is plainly money ($ before
   it, "dollars" after it, or a single grouped figure like 125,000).

   That also catches phone numbers and anything else long and numeric. For
   this use that is the right side to err on.
   ------------------------------------------------------------------------ */

// English and Spanish. Keys are lowercase with accents removed (see clean()).
const DIGIT_WORDS: Record<string, string> = {
  zero: "0", oh: "0", o: "0",
  one: "1", two: "2", three: "3", four: "4", five: "5",
  six: "6", seven: "7", eight: "8", nine: "9",
  cero: "0", uno: "1", una: "1", un: "1", dos: "2", tres: "3", cuatro: "4",
  cinco: "5", seis: "6", siete: "7", ocho: "8", nueve: "9",
};

const TENS_WORDS: Record<string, string> = {
  ten: "10", eleven: "11", twelve: "12", thirteen: "13", fourteen: "14",
  fifteen: "15", sixteen: "16", seventeen: "17", eighteen: "18", nineteen: "19",
  twenty: "20", thirty: "30", forty: "40", fifty: "50",
  sixty: "60", seventy: "70", eighty: "80", ninety: "90",
  diez: "10", once: "11", doce: "12", trece: "13", catorce: "14", quince: "15",
  dieciseis: "16", diecisiete: "17", dieciocho: "18", diecinueve: "19",
  veinte: "20", veintiuno: "21", veintiun: "21", veintidos: "22", veintitres: "23",
  veinticuatro: "24", veinticinco: "25", veintiseis: "26", veintisiete: "27",
  veintiocho: "28", veintinueve: "29",
  treinta: "30", cuarenta: "40", cincuenta: "50", sesenta: "60",
  setenta: "70", ochenta: "80", noventa: "90",
};

// Said between digits without ending the number -- by either party, since
// numbers are usually read in chunks with the other side confirming each one.
const CONNECTORS = new Set([
  "dash", "-", "hyphen", "um", "uh", "and", "then",
  "yes", "yeah", "yep", "ok", "okay", "right", "correct", "uh-huh", "mm-hmm", "mhm", "got", "it",
  // Spanish: "y" (and), "guion" (dash), and the confirmations said between chunks.
  "y", "guion", "este", "eh", "si", "aja", "okey", "vale", "bueno", "correcto", "exacto", "listo", "perfecto",
]);
const MAX_GAP = 3; // connector tokens allowed between two numeric chunks

const MONEY_AFTER = new Set([
  "dollars", "dollar", "bucks", "cents", "grand", "k",
  "dolares", "dolar", "centavos", "pesos", "mil",
]);

const REDACTED = "[REDACTED]";

function clean(token: string): string {
  // Accents off first ("sí" -> "si", "veintidós" -> "veintidos"); otherwise
  // the edge-trim below would cut accented letters as punctuation.
  return token
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/^[^\w$]+|[^\w]+$/g, "");
}

/** Digits a token contributes to a number, or null if it is not numeric. */
function digitsOf(token: string): string | null {
  const t = clean(token);
  if (!t) return null;
  if (/^\$?[\d][\d,.\-]*$/.test(t)) return t.replace(/[^\d]/g, "");
  if (t in DIGIT_WORDS) return DIGIT_WORDS[t];
  if (t in TENS_WORDS) return TENS_WORDS[t];
  // "forty-five", "twenty-one"
  const parts = t.split("-");
  if (parts.length === 2 && parts[0] in TENS_WORDS && parts[1] in DIGIT_WORDS) {
    return TENS_WORDS[parts[0]].slice(0, 1) + DIGIT_WORDS[parts[1]];
  }
  return null;
}

function looksLikeMoney(run: string[], next: string | undefined, prev: string | undefined): boolean {
  const first = run[0] ?? "";
  if (first.trim().startsWith("$")) return true;
  if (prev && clean(prev) === "$") return true;
  if (next && MONEY_AFTER.has(clean(next))) return true;
  // A single written figure in thousands format: 125,000 or 1,250.00
  if (run.length === 1 && /^\$?\d{1,3}(,\d{3})+(\.\d{2})?[^\w]*$/.test(first.trim())) return true;
  return false;
}

/** Turns ElevenLabs' {BANK_ACCOUNT} markers into something readable. */
function prettyMarker(token: string): string | null {
  const m = token.match(/\{([A-Z_]+?)(?:_\d+)?\}/);
  if (!m) return null;
  return `[${m[1].replace(/_/g, " ")} REDACTED]`;
}

type Tok = { text: string; start: number; end: number; speaker: string };

/**
 * Redacts long digit runs in a token stream. Returns the new stream and how
 * many spans were removed (ElevenLabs markers included).
 */
export function redactTokens(tokens: Tok[]): { tokens: Tok[]; count: number } {
  const out: Tok[] = [];
  let count = 0;
  let i = 0;

  while (i < tokens.length) {
    const marker = prettyMarker(tokens[i].text);
    if (marker) {
      out.push({ ...tokens[i], text: marker });
      count += 1;
      i += 1;
      continue;
    }

    if (digitsOf(tokens[i].text) === null) {
      out.push(tokens[i]);
      i += 1;
      continue;
    }

    // Grow the run: numeric tokens, with up to MAX_GAP connector tokens
    // between them ("zero two one" / "yep" / "zero zero zero"). Connectors
    // after the last numeric token belong to the sentence, not the number.
    let j = i;
    let lastNumeric = i;
    let gap = 0;
    let digits = "";
    while (j < tokens.length) {
      const d = digitsOf(tokens[j].text);
      if (d !== null && !prettyMarker(tokens[j].text)) {
        digits += d;
        lastNumeric = j;
        gap = 0;
        j += 1;
      } else if (
        gap < MAX_GAP &&
        (CONNECTORS.has(clean(tokens[j].text)) || clean(tokens[j].text) === "")
      ) {
        gap += 1;
        j += 1;
      } else {
        break;
      }
    }

    const run = tokens.slice(i, lastNumeric + 1);
    const next = tokens[lastNumeric + 1]?.text;
    const prev = i > 0 ? tokens[i - 1].text : undefined;

    if (digits.length >= 6 && !looksLikeMoney(run.map((t) => t.text), next, prev)) {
      // Each contiguous numeric chunk becomes one marker; the confirmations
      // between chunks stay, with their own speakers.
      let k = 0;
      while (k < run.length) {
        if (digitsOf(run[k].text) === null) {
          out.push(run[k]);
          k += 1;
          continue;
        }
        let e = k;
        while (
          e + 1 < run.length &&
          run[e + 1].speaker === run[k].speaker &&
          (digitsOf(run[e + 1].text) !== null || clean(run[e + 1].text) === "dash" || run[e + 1].text === "-")
        ) {
          e += 1;
        }
        const trailing = run[e].text.match(/[.,?!]+$/)?.[0] ?? "";
        out.push({ text: REDACTED + trailing, start: run[k].start, end: run[e].end, speaker: run[k].speaker });
        k = e + 1;
      }
      count += 1;
    } else {
      out.push(...run);
    }
    i = lastNumeric + 1;
  }

  return { tokens: out, count };
}

/**
 * ElevenLabs words -> redacted utterances (consecutive words from one
 * speaker, broken on long pauses so a monologue is not one wall of text).
 */
export function buildTranscript(
  words: ScribeWord[],
  language?: string | null
): { transcript: Transcript; redactions: number } {
  const tokens: Tok[] = words
    .filter((w) => (w.type ?? "word") === "word" && w.text && w.text.trim())
    .map((w) => ({
      text: w.text.trim(),
      start: Number(w.start) || 0,
      end: Number(w.end) || 0,
      speaker: w.speaker_id || "speaker_0",
    }));

  const { tokens: safe, count } = redactTokens(tokens);

  const utterances: Utterance[] = [];
  const speakers: string[] = [];
  const PAUSE_BREAK = 4; // seconds of silence that starts a new line

  for (const t of safe) {
    if (!speakers.includes(t.speaker)) speakers.push(t.speaker);
    const cur = utterances[utterances.length - 1];
    if (cur && cur.speaker === t.speaker && t.start - cur.end < PAUSE_BREAK) {
      cur.text += " " + t.text;
      cur.end = t.end;
    } else {
      utterances.push({ speaker: t.speaker, start: t.start, end: t.end, text: t.text });
    }
  }

  return {
    transcript: { utterances, speakers, language: language ?? null, redact_spans: spansOf(safe, utterances) },
    redactions: count,
  };
}

const isRedacted = (text: string) => /REDACTED\]/.test(text);

/*
  The stretches of audio to bleep. Each redacted token keeps the start and
  end of the words it replaced. If a token's times look wrong (missing, or
  implausibly long), that whole line is bleeped instead -- erring toward
  removing too much rather than leaving a number audible.
*/
function spansOf(tokens: Tok[], utterances: Utterance[]): Span[] {
  const spans: Span[] = [];
  for (const t of tokens) {
    if (!isRedacted(t.text)) continue;
    if (t.end > t.start && t.end - t.start < 25) spans.push({ start: t.start, end: t.end });
  }
  for (const u of utterances) {
    if (!isRedacted(u.text)) continue;
    const covered = spans.some((s) => s.start >= u.start - 1 && s.end <= u.end + 1);
    if (!covered) spans.push({ start: u.start, end: u.end });
  }
  return mergeSpans(spans);
}

/** Overlapping or nearly touching spans become one. */
export function mergeSpans(spans: Span[], gap = 0.3): Span[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start - last.end <= gap) last.end = Math.max(last.end, s.end);
    else out.push({ ...s });
  }
  return out;
}

/**
 * What to bleep on a call. Exact spans when the transcript has them; for
 * calls transcribed before that, every line that had a number redacted.
 */
export function bleepPlan(t: Transcript | null): { spans: Span[]; method: "exact" | "lines" } {
  if (!t) return { spans: [], method: "exact" };
  if (t.redact_spans) return { spans: t.redact_spans, method: "exact" };
  return {
    spans: mergeSpans(t.utterances.filter((u) => isRedacted(u.text)).map((u) => ({ start: u.start, end: u.end }))),
    method: "lines",
  };
}

/* ------------------------------------------------------------------------
   Speaker roles
   ------------------------------------------------------------------------ */

/**
 * Who each speaker is. Order of precedence: a manager's manual override,
 * then the grader's reading of the call, then the transcriber's own
 * agent/customer labels, then first-speaker-is-the-rep.
 */
export function resolveRoles(
  transcript: Transcript | null,
  override: Record<string, Role> | null,
  grade: Grade | null
): Record<string, Role> {
  const roles: Record<string, Role> = {};
  const speakers = transcript?.speakers ?? [];

  speakers.forEach((s, i) => {
    if (s === "agent") roles[s] = "rep";
    else if (s === "customer") roles[s] = "client";
    else roles[s] = i === 0 ? "rep" : i === 1 ? "client" : "other";
  });

  for (const r of grade?.speaker_roles ?? []) {
    if (speakers.includes(r.speaker)) roles[r.speaker] = r.role;
  }

  for (const [s, r] of Object.entries(override ?? {})) {
    if (speakers.includes(s)) roles[s] = r;
  }

  return roles;
}

/* ------------------------------------------------------------------------
   Scoring and display helpers
   ------------------------------------------------------------------------ */

/**
 * 0-100 from the section results. Sections the call never reached (the
 * client hung up, the call was transferred) are left out rather than counted
 * as misses -- otherwise every short call grades as a failure.
 */
export function scoreOf(grade: Grade): number | null {
  const reached = grade.sections.filter((s) => s.status !== "not_reached");
  if (reached.length === 0) return null;
  const points = reached.reduce(
    (sum, s) => sum + (s.status === "hit" ? 1 : s.status === "partial" ? 0.5 : 0),
    0
  );
  return Math.round((100 * points) / reached.length);
}

/** 0-100 from the emotional roadmap: landed = full, partly = half. Stages the
 *  call never reached are left out, as with the script score. */
export function arcScoreOf(grade: Grade): number | null {
  const reached = (grade.emotional_arc ?? []).filter((a) => a.landed !== "not_reached");
  if (reached.length === 0) return null;
  const points = reached.reduce(
    (sum, a) => sum + (a.landed === "yes" ? 1 : a.landed === "partial" ? 0.5 : 0),
    0
  );
  return Math.round((100 * points) / reached.length);
}

/** 0-100 from the 8-skill scorecard. */
export function skillsScoreOf(grade: Grade): number | null {
  const scored = (grade.slp ?? [])
    .map((k) => k.score)
    .filter((n): n is number => typeof n === "number");
  if (scored.length === 0) return null;
  return Math.round((10 * scored.reduce((a, b) => a + b, 0)) / scored.length);
}

/**
 * The Straight Line score: half the emotional roadmap, half the skills.
 * If only one is available (an older grade), that one alone.
 */
export function slpScoreOf(grade: Grade): number | null {
  const arc = arcScoreOf(grade);
  const skills = skillsScoreOf(grade);
  if (arc === null) return skills;
  if (skills === null) return arc;
  return Math.round((arc + skills) / 2);
}

export function clock(secs: number | null | undefined): string {
  if (secs === null || secs === undefined || !isFinite(secs)) return "";
  const s = Math.max(0, Math.floor(secs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}

export function scoreBand(n: number | null): "good" | "fair" | "poor" | "" {
  if (n === null) return "";
  return n >= 80 ? "good" : n >= 60 ? "fair" : "poor";
}

export const STATUS_LABEL: Record<CallStatus, string> = {
  live: "On the call",
  uploading: "Uploading",
  uploaded: "Queued",
  transcribing: "Transcribing",
  transcribed: "Ready to grade",
  grading: "Grading",
  graded: "Graded",
  failed: "Failed",
};

/** A job is presumed dead after this long without an update. */
export const STUCK_AFTER_MS = 6 * 60 * 1000;

export function isStuck(status: CallStatus, updatedAt: string): boolean {
  if (!["uploading", "uploaded", "transcribing", "grading"].includes(status)) return false;
  return Date.now() - new Date(updatedAt).getTime() > STUCK_AFTER_MS;
}

/* ------------------------------------------------------------------------
   Voice measurements -> per-line notes the grader can read.

   Turns the quarter-second pitch/loudness timeline from lib/voice.ts into a
   short note on each transcript line, plus a per-speaker summary. Every
   number is relative to that speaker's own voice, so a deep voice and a high
   one are judged the same way.
   ------------------------------------------------------------------------ */

export type VoiceTimeline = { v: 1; bin: number; f0: number[]; db: number[] };

const semitones = (f: number, ref: number) => 12 * Math.log2(f / ref);

const pct = (xs: number[], p: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))];
};

/* Under this many semitones of movement for this long reads as monotone.
   Set by judgment, not tuned on real calls yet -- spot-check before trusting. */
const FLAT_ST = 2.5;
const FLAT_MIN_SECS = 90;

export function voiceNotes(
  voice: VoiceTimeline | null,
  t: Transcript
): { header: string; lines: (string | null)[] } {
  const lines: (string | null)[] = t.utterances.map(() => null);
  if (!voice?.f0?.length) return { header: "", lines };

  const binsOf = (u: Utterance) => {
    const a = Math.max(0, Math.floor(u.start / voice.bin));
    const b = Math.min(voice.f0.length, Math.ceil(u.end / voice.bin));
    const f: number[] = [];
    const d: number[] = [];
    for (let i = a; i < b; i++) {
      if (voice.f0[i] > 0) {
        f.push(voice.f0[i]);
        d.push(voice.db[i]);
      }
    }
    return { f, d };
  };

  // Each speaker's own baseline: typical pitch and typical loudness.
  const base = new Map<string, { hz: number; db: number }>();
  for (const s of t.speakers) {
    const f: number[] = [];
    const d: number[] = [];
    for (const u of t.utterances) {
      if (u.speaker !== s) continue;
      const b = binsOf(u);
      f.push(...b.f);
      d.push(...b.d);
    }
    if (f.length >= 20) base.set(s, { hz: pct(f, 0.5), db: pct(d, 0.5) });
  }

  type Stat = { range: number | null; st: number[]; wpm: number | null };
  const stats: Stat[] = [];

  t.utterances.forEach((u, i) => {
    const ref = base.get(u.speaker);
    const dur = u.end - u.start;
    const words = u.text.replace(/\[[^\]]*\]/g, " ").split(/\s+/).filter(Boolean).length;
    const wpm = dur >= 1.5 && words >= 4 ? Math.round((words / dur) * 60) : null;
    const prevEnd = i > 0 ? t.utterances[i - 1].end : null;
    const pause = prevEnd !== null && u.start - prevEnd >= 1 ? u.start - prevEnd : null;

    const parts: string[] = [];
    let range: number | null = null;
    let st: number[] = [];

    if (ref) {
      const b = binsOf(u);
      st = b.f.map((f) => semitones(f, ref.hz));
      // Drop octave slips: a jump of ~12 semitones from the line's own
      // middle is the detector, not the voice.
      const mid = pct(st, 0.5);
      st = st.filter((x) => Math.abs(x - mid) < 9);
      if (st.length >= 4) {
        range = pct(st, 0.9) - pct(st, 0.1);
        parts.push(`pitch moves ${range.toFixed(1)}st`);
        const level = pct(st, 0.5);
        if (Math.abs(level) >= 2) parts.push(`${level > 0 ? "higher" : "lower"} than usual by ${Math.abs(level).toFixed(0)}st`);
      }
      if (dur >= 1.5 && st.length >= 8) {
        const end = pct(st.slice(-4), 0.5);
        const rest = pct(st.slice(0, -4), 0.5);
        const diff = end - rest;
        parts.push(`ends ${diff >= 1.5 ? "rising" : diff <= -1.5 ? "falling" : "level"}`);
      }
      if (b.d.length >= 4) {
        const vol = pct(b.d, 0.5) - ref.db;
        if (Math.abs(vol) >= 3) parts.push(`${vol > 0 ? "louder" : "quieter"} by ${Math.abs(vol).toFixed(0)}dB`);
      }
    }
    if (wpm !== null) parts.push(`${wpm}wpm`);
    if (pause !== null) parts.push(`after ${pause.toFixed(1)}s pause`);

    lines[i] = parts.length ? parts.join(", ") : null;
    stats.push({ range, st, wpm });
  });

  // Per speaker: typical movement, pace, and long flat stretches.
  const summary: string[] = [];
  for (const s of t.speakers) {
    if (!base.has(s)) continue;
    const idx = t.utterances.map((u, i) => (u.speaker === s ? i : -1)).filter((i) => i >= 0);
    const ranges = idx.map((i) => stats[i].range).filter((x): x is number => x !== null);
    const wpms = idx.map((i) => stats[i].wpm).filter((x): x is number => x !== null);

    // Each line is judged with its neighbours: a rolling window of ~30 s of
    // this speaker's own talking, centred on the line. Runs of flat lines
    // then merge into stretches.
    const talkOf = (i: number) => t.utterances[i].end - t.utterances[i].start;
    const flatAt = idx.map((_, k) => {
      let lo = k;
      let hi = k;
      let talk = talkOf(idx[k]);
      while (talk < 30 && (lo > 0 || hi < idx.length - 1)) {
        if (hi < idx.length - 1) talk += talkOf(idx[++hi]);
        if (talk < 30 && lo > 0) talk += talkOf(idx[--lo]);
      }
      const all = idx.slice(lo, hi + 1).flatMap((i) => stats[i].st);
      if (all.length < 40) return null; // not enough voice to say
      return pct(all, 0.9) - pct(all, 0.1);
    });
    const flats: [number, number, number][] = [];
    idx.forEach((i, k) => {
      const r = flatAt[k];
      if (r === null || r >= FLAT_ST) return;
      const u = t.utterances[i];
      const last = flats[flats.length - 1];
      if (last && k > 0 && flatAt[k - 1] !== null && flatAt[k - 1]! < FLAT_ST) {
        last[1] = u.end;
        last[2] = Math.max(last[2], r);
      } else flats.push([u.start, u.end, r]);
    });

    const long = flats.filter(([a, b]) => b - a >= FLAT_MIN_SECS);
    summary.push(
      `${s}: typical pitch movement per line ${ranges.length ? pct(ranges, 0.5).toFixed(1) : "?"}st, ` +
        `typical pace ${wpms.length ? pct(wpms, 0.5) : "?"}wpm. ` +
        (long.length
          ? `Flat stretches (under ${FLAT_ST}st of movement): ` +
            long.map(([a, b, r]) => `[${Math.round(a)}]-[${Math.round(b)}] (${r.toFixed(1)}st)`).join(", ") +
            "."
          : "No long flat stretches.")
    );
  }

  return { header: summary.join("\n"), lines };
}
