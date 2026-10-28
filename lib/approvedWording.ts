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
- Timelines: the program's results -- debt elimination, the credit score reaching 700+, every result -- happen within about 18-24 months, whatever the plan length (an 18-, 22- or 32-month plan alike); the minimum program is 18 months for exactly that reason. Reps don't have to give a timeframe at all. The best wording is "by the end of the program" or "a little before the program ends"; saying 18-24 months is also fine, for any result including credit. The ONLY timing issue is promising any result SOONER than 18 months (for example "your debts will be gone in 6 months" or "you'll be in the 700s within a year") -- flag that. Leaving the timeframe out is never an issue. Separately, "most accounts go to collections in about 4-6 months after non-payment" is true and fine -- that's not a result.
- What starts within 24 hours of enrollment is true and fine to say: the coaching, the legal protection, the discounts and the credit builder account all kick in within 24 hours, and so does disputing the debts that are already in collections (debts not yet in collections are disputed once they get there). These are services starting, not results -- never flag them as a too-soon timeline.`;

/** How this team handles "I need to think about it" (and any stall) -- the sales manager's rule. */
export const STALL_RULE = `"I need to think about it" (and any stall or put-off) -- the sales manager's rule:
- Never just honor it. The rep runs the loop first: before The Pitch, organic looping (acknowledge, find out what they want to think over, loop back to the pain, the benefit and certainty, ask again); after The Pitch, the right one of The Loops (Loop 1, 2, 3), then ask again.
- Only when the SAME objection comes back a second time, after the rep has looped it, is it a real, valid objection -- THEN the rep books a specific callback (a set day and time, with everyone who needs to be there). Booking a callback on the first "let me think about it" without looping is a miss, even if the time is specific.
- Looping once and then booking when the same stall returns is exactly right -- never mark that down as giving up, and never coach the rep to keep pushing past a second, repeated objection.`;

/** The call-recording notice: given once, on the first contact. */
export const RECORDING_RULE = `The call-recording notice is given on the FIRST contact with a client. A re-contact or follow-up call with a client who was already spoken to (call 2 or later in the client journey, or a call that clearly picks up an earlier conversation) does NOT need it again: never mark it missing, flag it or coach it on those calls.`;

/** The same, wrapped for a prompt that also reads earlier grades: those grades may still say otherwise. */
export const WORDING_NOTE = `<approved_wording>
${APPROVED_WORDING}

${STALL_RULE}

${RECORDING_RULE}
Some grades, flags and coaching notes below were written before this was made clear: they may call a 700+ credit score promise a problem, praise or coach simply honoring "I need to think about it" and booking a callback without looping, or call a missing recording notice on a follow-up call a problem. Where they disagree with the above, the above wins: never repeat them, never coach on them, never list them as a slip or a pattern.
</approved_wording>

`;

/** A flag (or coaching line) about promising a credit score that isn't an explicit guarantee -- approved wording, not an issue. */
export function isApprovedScoreTalk(text: string): boolean {
  const t = String(text || "");
  if (!/\b7\d\d\b|700s?|\bcredit score|\bscore\b/i.test(t)) return false;
  if (/guarant/i.test(t)) return false;
  // A timeline shorter than 18-24 months is still an issue.
  // Any result promised in under 18 months (or in weeks) is still an issue.
  const m = [...t.matchAll(/\b(\d{1,2})\s*(months?|weeks?)\b/gi)];
  if (m.some((x) => /week/i.test(x[2]) || Number(x[1]) < 18)) return false;
  if (/within a year|in a year|one year|1 year/i.test(t)) return false;
  return true;
}
