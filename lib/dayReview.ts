/* A one-day review of a rep's calls (app/api/reps/day-review). */

export type DayReview = {
  day: string;
  headline: string;
  story: string;
  mood: string;
  opening: string;
  slipping: { title: string; evidence: string; vs_best: string; fix: string }[];
  per_call: { n: number; line: string }[];
  coach_now: { skill: string; drill: string }[];
  questions_to_ask: string[];
  calls: { n: number; id: string; time: string | null; what: string; kind?: "full" | "voicemail" | "short"; outcome?: string | null; slp?: number | null }[];
  /** v2: the top 2 coaching needs of the day, each with its clearest moments (best first). */
  needs?: DayNeed[];
  /** v2: one strength to protect. */
  strength?: { text: string; n: number | null; at: string };
  /** v2: the day in numbers, worked out from the calls (no AI). */
  score?: { contacts: number; full: number; voicemail: number; short: number; enrolled: number; callbacks: number; furthest: string };
  /** v2: the newest grade among the day's calls when the review was written (to spot re-grades since). */
  graded_through?: string | null;
};

export type DayNeed = {
  title: string;
  why: string;
  moments: { n: number; at: string; note: string }[];
  coach: string;
  drill: string;
  check: string;
  ask: string;
};

/** "40:12" or "1:02:03" -> seconds, or null. */
export const secsOf = (at: string | null | undefined): number | null => {
  if (!at) return null;
  const p = String(at).trim().split(":").map(Number);
  if (!p.length || p.some((x) => !isFinite(x))) return null;
  return p.reduce((a, b) => a * 60 + b, 0);
};

/** "13:05" -> "1:05 PM". */
export const fmtTime = (hhmm: string | null) => {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};
