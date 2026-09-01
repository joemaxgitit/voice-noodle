import type { Phrase } from "@/lib/useKaraoke";

export type Scores = {
  pace: number; // 0-100
  pauses: number | null; // null when the master has no marked pauses
  clarity: number; // 0-100
  /** How much faster or slower than the master, as a signed fraction. */
  paceDelta: number;
  /** Words the rep hurried past, by index into the word list. */
  rushed: number[];
  /** Pause points in the master the rep did not leave, by word index. */
  missedPauses: number[];
  pauseCount: number;
};

/*
  A gap this long between words in the master is a deliberate pause, not the
  ordinary space between words. Ordinary gaps in connected speech sit well
  under 0.2s; the script's own PAUSE directions land far above this.
*/
const PAUSE_GAP = 0.35;

/*
  A rep's pause counts as present if it is at least this fraction of the
  master's. Nobody matches a pause to the millisecond, and demanding it would
  make the score noise.
*/
const PAUSE_CREDIT = 0.5;

/*
  A word said in less than this fraction of the master's time for the same
  word was hurried past rather than spoken. Set from listening: at 0.55 the
  flagged words are ones you genuinely have to replay to catch.
*/
const RUSHED = 0.55;

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

const span = (words: Phrase[]) =>
  words.length ? words[words.length - 1].end - words[0].start : 0;

/**
 * Compare a rep's attempt against the master they were imitating.
 *
 * Every number here is relative to that master. Nothing is measured against a
 * general model of English, which means the scores say "unlike this recording"
 * rather than "unlike how people speak" -- the first is coachable and the
 * second is not.
 *
 * Returns null when the two word lists do not correspond, which happens if
 * alignment dropped or invented words. A wrong score is worse than none.
 */
export function score(rep: Phrase[], master: Phrase[]): Scores | null {
  if (rep.length === 0 || master.length === 0) return null;
  if (rep.length !== master.length) return null;

  const repSpan = span(rep);
  const masterSpan = span(master);
  if (repSpan <= 0 || masterSpan <= 0) return null;

  // --- pace -------------------------------------------------------------
  // Signed so the UI can say faster or slower rather than just "off".
  const paceDelta = (repSpan - masterSpan) / masterSpan;

  /*
    Ten percent off is still a good read, so it costs little. Fifty percent
    off is a different delivery, and lands near zero.
  */
  const pace = clamp(100 - Math.abs(paceDelta) * 200);

  // --- pauses -----------------------------------------------------------
  const missedPauses: number[] = [];
  let pauseCount = 0;
  let pausesKept = 0;

  for (let i = 0; i < master.length - 1; i++) {
    const masterGap = master[i + 1].start - master[i].end;
    if (masterGap < PAUSE_GAP) continue;

    pauseCount++;
    const repGap = rep[i + 1].start - rep[i].end;

    if (repGap >= masterGap * PAUSE_CREDIT) pausesKept++;
    else missedPauses.push(i);
  }

  const pauses = pauseCount === 0 ? null : clamp((pausesKept / pauseCount) * 100);

  // --- clarity ----------------------------------------------------------
  /*
    Not pronunciation in the phonetic sense -- we cannot hear that. This is
    the words the rep got through so much faster than the master that they
    would not land, which is the thing that actually loses a client.
  */
  const rushed: number[] = [];

  for (let i = 0; i < rep.length; i++) {
    const masterDur = master[i].end - master[i].start;
    const repDur = rep[i].end - rep[i].start;
    if (masterDur <= 0) continue;
    if (repDur / masterDur < RUSHED) rushed.push(i);
  }

  const clarity = clamp(100 - (rushed.length / rep.length) * 100);

  return {
    pace,
    pauses,
    clarity,
    paceDelta,
    rushed,
    missedPauses,
    pauseCount,
  };
}

/** Plain-language reading of the pace difference. */
export function paceNote(delta: number): string {
  const pct = Math.abs(Math.round(delta * 100));
  if (pct < 5) return "Right on the master's pace";
  return pct > 0 && delta > 0
    ? `${pct}% slower than the master`
    : `${pct}% faster than the master`;
}

/*
  What clears a segment.

  Set so a competent read passes and a rushed or flat one does not. They are
  a floor, not a target -- the point is to stop someone moving on while they
  are still noticeably off, not to chase 100.
*/
export const PASS = { pace: 75, clarity: 75, pauses: 70 };

/*
  Pauses are only judged when the master has at least two. On a six-word line
  the one gap over the threshold is usually the narrator drawing breath, and
  failing someone for not copying a breath is noise, not coaching.
*/
export const MIN_PAUSES_TO_JUDGE = 2;

/** Does this take clear the segment? */
export function passed(s: Scores): boolean {
  if (s.pace < PASS.pace) return false;
  if (s.clarity < PASS.clarity) return false;
  if (s.pauseCount >= MIN_PAUSES_TO_JUDGE && (s.pauses ?? 0) < PASS.pauses) {
    return false;
  }
  return true;
}
