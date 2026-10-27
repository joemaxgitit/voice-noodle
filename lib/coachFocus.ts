/*
  "Coach this": a coaching focus a manager starts from a call's Coach Now
  card. The grader then checks the rep's next calls for it -- only calls made
  on or after the day it was started, and only calls that gave a fair chance
  to show it. After FOCUS_CHECKS such calls it closes with a result.
  Managers only, unless a manager sends it to the rep's home page.
*/

export const FOCUS_CHECKS = 5;

export type CoachFocus = {
  id: string;
  rep_id: string;
  call_id: string | null;
  skill: string | null;
  title: string;
  next_call: string | null;
  drill: string | null;
  check_for: string | null;
  shared: boolean;
  status: "active" | "done" | "stopped" | "replaced";
  result: "improved" | "mixed" | "not_yet" | null;
  created_at: string;
  finished_at: string | null;
};

export type FocusCheck = { focus_id: string; call_id: string; call_date: string | null; shown: "yes" | "partly" | "no"; quote: string | null; at_secs: number | null; note: string | null };

export const FOCUS_RESULT_LABEL: Record<NonNullable<CoachFocus["result"]>, string> = {
  improved: "Improved",
  mixed: "Some improvement",
  not_yet: "Not yet",
};

export const SHOWN_LABEL: Record<FocusCheck["shown"], string> = { yes: "Did it", partly: "Partly", no: "Didn't" };

/** Yes = 1, partly = half; improved at 70%+, some improvement at 40%+. */
export function focusResult(checks: Pick<FocusCheck, "shown">[]): CoachFocus["result"] {
  if (!checks.length) return null;
  const v = checks.reduce((a, c) => a + (c.shown === "yes" ? 1 : c.shown === "partly" ? 0.5 : 0), 0) / checks.length;
  return v >= 0.7 ? "improved" : v >= 0.4 ? "mixed" : "not_yet";
}

/** What the grader checks a call for (grades from v12 on). */
export type FocusCheckGrade = { focus_id?: string; chance: boolean; shown: "yes" | "partly" | "no" | "n/a"; quote: string; time: number | null; note: string };
