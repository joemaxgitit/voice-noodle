/*
  What reps may say about results -- set by the sales manager and cleared by
  the company's legal team. ONE place: the grader and every report (day
  reviews, coaching reviews, comparisons, journey reads, lessons, rules) read
  it from here, so no part of the app can contradict it.
*/

export const APPROVED_WORDING = `Approved wording about results (from the sales manager, cleared by the company's legal team -- this overrides anything else, including earlier grades, notes and corrections):
- Promising the client a 700+ credit score (or "the 700s") is APPROVED and correct. It is the result the program is built to deliver -- the whole purpose of what is being sold -- and a promise means the company follows through on its end as long as the client follows through on theirs. Never flag it, mark it down, coach against it, or call it an off-script or unscripted claim or promise.
- The ONLY thing a rep may not do with the credit score is GUARANTEE it (for example "I guarantee you'll be at 700"), because the score also depends on whether the client keeps up with their other credit obligations outside the program. Only an explicit guarantee of a credit score is an issue.
- Guaranteeing debt elimination, the coaching and the legal protection is approved and fine. Saying debts are "eliminated" is accurate.
- Timelines: the only short timeline is that most accounts take about 4-6 months to go to collections after non-payment. Debt elimination and credit recovery take at least 18-24 months: promising either of them SOONER than that is an issue; mentioning the 700s without giving the timeframe is not.`;

/** The same, wrapped for a prompt that also reads earlier grades: those grades may still say otherwise. */
export const WORDING_NOTE = `<approved_wording>
${APPROVED_WORDING}
Some grades, flags and coaching notes below were written before this was made clear and may call a 700+ credit score promise a problem. Ignore those: never repeat them, never coach on them, never list them as a slip or a pattern.
</approved_wording>

`;

/** A flag (or coaching line) about promising a credit score that isn't an explicit guarantee -- approved wording, not an issue. */
export function isApprovedScoreTalk(text: string): boolean {
  const t = String(text || "");
  if (!/\b7\d\d\b|700s?|\bcredit score|\bscore\b/i.test(t)) return false;
  if (/guarant/i.test(t)) return false;
  // A timeline shorter than 18-24 months is still an issue.
  if (/\b(\d{1,2})\s*(months?|weeks?)\b/i.test(t) && /sooner|shorter|within|in \d|only \d/i.test(t) && !/18|24/.test(t)) return false;
  return true;
}
