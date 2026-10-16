/*
  Call monitoring: shared types and the transcript pipeline that runs between
  ElevenLabs and the database.

  Nothing in here talks to the network, so it runs the same on the server
  (where transcripts are built) and in the browser (where they are shown).
*/

export type CallStatus =
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

export type Transcript = {
  utterances: Utterance[];
  speakers: string[]; // in order of first appearance
  language?: string | null;
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

export type Grade = {
  speaker_roles: { speaker: string; role: Role }[];
  summary: string;
  furthest_point: string;
  sections: SectionResult[];
  compliance: ComplianceResult[];
  flags: Flag[];
  strengths: string[];
  coaching_priorities: string[];
  model?: string;
  graded_at?: string;
};

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

const DIGIT_WORDS: Record<string, string> = {
  zero: "0", oh: "0", o: "0",
  one: "1", two: "2", three: "3", four: "4", five: "5",
  six: "6", seven: "7", eight: "8", nine: "9",
};

const TENS_WORDS: Record<string, string> = {
  ten: "10", eleven: "11", twelve: "12", thirteen: "13", fourteen: "14",
  fifteen: "15", sixteen: "16", seventeen: "17", eighteen: "18", nineteen: "19",
  twenty: "20", thirty: "30", forty: "40", fifty: "50",
  sixty: "60", seventy: "70", eighty: "80", ninety: "90",
};

// Said between digits without ending the number -- by either party, since
// numbers are usually read in chunks with the other side confirming each one.
const CONNECTORS = new Set([
  "dash", "-", "hyphen", "um", "uh", "and", "then",
  "yes", "yeah", "yep", "ok", "okay", "right", "correct", "uh-huh", "mm-hmm", "mhm", "got", "it",
]);
const MAX_GAP = 3; // connector tokens allowed between two numeric chunks

const MONEY_AFTER = new Set(["dollars", "dollar", "bucks", "cents", "grand", "k"]);

const REDACTED = "[REDACTED]";

function clean(token: string): string {
  return token.toLowerCase().replace(/^[^\w$]+|[^\w]+$/g, "");
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

  return { transcript: { utterances, speakers, language: language ?? null }, redactions: count };
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
