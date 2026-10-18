/*
  One-on-one coaching sessions: the manager's short notes, tidied by Claude
  into a summary, commitments and topics from the team's own list.
*/

export type CoachingTopic = { id: string; name: string; hint: string | null; sort_order: number; archived: boolean };
export type Commitment = { text: string; status: "open" | "kept" | "missed" };
export type CoachingSession = {
  id: string;
  org_id: string;
  rep_id: string;
  manager_id: string | null;
  session_date: string;
  raw_notes: string;
  summary: string | null;
  topics: string[];
  commitments: Commitment[];
  follow_up: string | null;
  private: boolean;
  created_at: string;
  updated_at: string;
};

export type SessionDraft = { summary: string; topics: string[]; commitments: string[]; follow_up: string };

export const SESSION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "topics", "commitments", "follow_up"],
  properties: {
    summary: { type: "string" },
    topics: { type: "array", items: { type: "string" } },
    commitments: { type: "array", items: { type: "string" } },
    follow_up: { type: "string" },
  },
};

export function sessionPrompt(opts: { rep: string; notes: string; topics: CoachingTopic[]; last: CoachingSession | null }) {
  const { rep, notes, topics, last } = opts;
  return `A sales manager at Lionside Financial (debt relief, phone sales, Straight Line Persuasion) just finished a one-on-one coaching session with ${rep} and jotted these notes:

"""
${notes}
"""
${last ? `\nThe previous one-on-one (${last.session_date}): ${last.summary || last.raw_notes}\nCommitments then: ${last.commitments.map((c) => c.text).join("; ") || "none"}\n` : ""}
Tidy them up for the record. Keep the manager's meaning; don't add advice or anything that wasn't said.
- "summary": 1-3 plain sentences of what was covered and how it went.
- "topics": every topic from this list that the notes actually touch, using the exact names (several is fine, none is fine):
${topics.map((t) => `  - ${t.name}${t.hint ? `: ${t.hint}` : ""}`).join("\n")}
- "commitments": what the rep (or manager) agreed to do, each as a short action ("Loop once before answering price on every call"). Empty if none were made.
- "follow_up": one line on what to check at the next one-on-one, or "".`;
}
