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
  calls: { n: number; id: string; time: string | null; what: string }[];
};

/** "13:05" -> "1:05 PM". */
export const fmtTime = (hhmm: string | null) => {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};
