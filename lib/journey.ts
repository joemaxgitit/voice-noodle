/*
  Client journeys: every call with the same client ID is one journey.
  More than half of enrollments take 1-3 calls or more, so follow-ups are
  graded fairly (stages done on an earlier call aren't "missed") and the
  follow-up game is tracked: why calls don't close, whether the rep got to
  the bottom of it, how they re-open, and what wins in the end.
*/

export const clientKey = (label: string | null | undefined) => (label || "").trim().toLowerCase();

export type JourneyCall = {
  id: string;
  client_label: string | null;
  call_date: string | null;
  created_at: string;
  call_number?: number | null;
  handoff?: string | null;
  rep_id: string | null;
  status: string;
  outcome: string | null;
  outcome_manual: string | null;
  retention: string | null;
  score: number | null;
  slp_score: number | null;
  script_title?: string | null;
};

export const isRenewScript = (title: string | null | undefined) => /renew/i.test(title || "");

/** Calls in date order, each with its number in the journey (the manager's, else by date). */
export function numbered<T extends JourneyCall>(calls: T[]): (T & { n: number })[] {
  const sorted = [...calls].sort((a, b) => (a.call_date || a.created_at.slice(0, 10)).localeCompare(b.call_date || b.created_at.slice(0, 10)) || a.created_at.localeCompare(b.created_at));
  let last = 0;
  return sorted.map((c) => {
    const n = c.call_number ?? last + 1;
    last = n;
    return { ...c, n };
  });
}

export type JourneyStatus = "open" | "enrolled" | "renew";
export function journeyStatus(calls: JourneyCall[]): JourneyStatus {
  if (calls.some((c) => (c.outcome_manual || c.outcome) === "enrolled")) return "enrolled";
  if (calls.some((c) => isRenewScript(c.script_title) || c.handoff === "renew")) return "renew";
  return "open";
}

export const HANDOFF_LABEL: Record<string, string> = { renew: "Renew lead (rep dead-ended it)", coverage: "Covering for an absent rep" };
