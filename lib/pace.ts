import type { Transcript } from "./calls";

/*
  Pace, measured straight from the transcript's word timings -- no AI, no cost.

  A rep's "usual" pace is their own median over the call, taken in windows of
  about 30 seconds of their own talking. A stretch is flagged when the rep runs
  FAST_RATIO above their own usual for at least that long. Each rep is measured
  against themselves, so a naturally quick talker isn't flagged all call.
*/

export const FAST_RATIO = 1.2; // 20% above their own usual
const WINDOW_SECS = 30; // of the rep's own talking
const MERGE_GAP = 10; // seconds between flagged windows that still count as one stretch

export type PaceStretch = {
  start: number;
  end: number;
  /** Fastest window in the stretch, words per minute. */
  wpm: number;
  /** How far above usual, e.g. 26 for +26%. */
  pct: number;
  /** The script section the stretch falls in, when the grade has section times. */
  section?: string | null;
  /** True when that section is one where rushing costs deals. */
  key?: boolean;
};

export type PaceRead = {
  usual: number;
  stretches: PaceStretch[];
  /** Seconds of the call spent in fast stretches. */
  fast_secs: number;
};

/** Sections where rushing hurts most: money, options, objections, the close. */
export const KEY_SECTION = /option|pric|payment|cost|fee|close|closing|enroll|objection|loop|program|budget|acknowledg|agreement|sign|turndown|loan|decision|commit/i;

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/** One speaker's pace, or null when they didn't talk enough to say (under 2 minutes). */
export function paceOf(t: Transcript | null | undefined, speaker: string | null | undefined, sections?: { section: string; time: number | null }[] | null): PaceRead | null {
  if (!t?.utterances?.length || !speaker) return null;
  const us = t.utterances
    .filter((u) => u.speaker === speaker && u.end - u.start >= 1)
    .map((u) => ({ start: u.start, end: u.end, talk: u.end - u.start, words: u.text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length }))
    .filter((u) => u.words > 0 && (u.words / u.talk) * 60 < 400); // drop timing glitches
  const total = us.reduce((n, u) => n + u.talk, 0);
  if (total < 120) return null;

  // Windows of ~30 s of this speaker's talking, starting at each of their lines.
  const wins: { start: number; end: number; wpm: number }[] = [];
  for (let k = 0; k < us.length; k++) {
    let talk = 0;
    let words = 0;
    let j = k;
    for (; j < us.length && talk < WINDOW_SECS; j++) {
      talk += us[j].talk;
      words += us[j].words;
    }
    if (talk < WINDOW_SECS) break;
    wins.push({ start: us[k].start, end: us[j - 1].end, wpm: (words / talk) * 60 });
  }
  if (wins.length < 3) return null;
  const usual = median(wins.map((w) => w.wpm));

  const stretches: PaceStretch[] = [];
  for (const w of wins) {
    if (w.wpm < usual * FAST_RATIO) continue;
    const last = stretches[stretches.length - 1];
    if (last && w.start <= last.end + MERGE_GAP) {
      last.end = Math.max(last.end, w.end);
      last.wpm = Math.max(last.wpm, w.wpm);
    } else stretches.push({ start: w.start, end: w.end, wpm: w.wpm, pct: 0 });
  }

  const secs = (sections || []).filter((s) => s.time != null && s.time >= 0).sort((a, b) => a.time! - b.time!);
  for (const s of stretches) {
    s.wpm = Math.round(s.wpm);
    s.pct = Math.round((s.wpm / usual - 1) * 100);
    s.start = Math.round(s.start);
    s.end = Math.round(s.end);
    // Sections the stretch overlaps (each runs until the next one starts); a key one wins, else the one at its middle.
    const over = secs.filter((x, i) => x.time! < s.end && (secs[i + 1]?.time ?? Infinity) > s.start);
    const mid = (s.start + s.end) / 2;
    const sec = over.find((x) => KEY_SECTION.test(x.section)) ?? [...over].reverse().find((x) => x.time! <= mid) ?? over[0];
    s.section = sec?.section ?? null;
    s.key = !!sec && KEY_SECTION.test(sec.section);
  }
  return { usual: Math.round(usual), stretches, fast_secs: stretches.reduce((n, s) => n + (s.end - s.start), 0) };
}

/** For the grader's notes: each speaker's usual pace and fast stretches, in its [seconds] style. */
export function paceNotes(t: Transcript | null | undefined): string {
  if (!t?.speakers?.length) return "";
  const out: string[] = [];
  for (const sp of t.speakers) {
    const p = paceOf(t, sp);
    if (!p) continue;
    out.push(
      `${sp}: usual pace ${p.usual}wpm. ` +
        (p.stretches.length
          ? `Sped up (${Math.round((FAST_RATIO - 1) * 100)}%+ above their own usual for 30s+ of talking): ` + p.stretches.map((s) => `[${s.start}]-[${s.end}] ${s.wpm}wpm (+${s.pct}%)`).join(", ") + "."
          : "No sped-up stretches.")
    );
  }
  return out.join("\n");
}
