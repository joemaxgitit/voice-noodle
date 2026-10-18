/*
  Training cards: one behavior, under a minute to read, signed by a manager.
  Claude drafts; a manager edits, approves and sends; the rep answers and
  practices. Shared by the manager editor, the rep view and the draft route.
*/

export type CardKind = "focus" | "win" | "model" | "compliance" | "encouragement";
export type CardStatus = "draft" | "sent" | "closed" | "discarded";
export type CardDrill = { type: "module" | "persona"; id: string; label: string } | null;

export type Card = {
  id: string;
  org_id: string;
  rep_id: string;
  kind: CardKind;
  skill: string;
  noticed: string;
  why: string;
  try_this: string;
  when_then: string;
  rep_plan: string | null;
  call_id: string | null;
  call_moment: string | null;
  drill: CardDrill;
  status: CardStatus;
  signed_by: string | null;
  signed_name: string | null;
  created_by: string | null;
  review_id: string | null;
  group_id: string | null;
  rep_response: "got_it" | "question" | "disagree" | null;
  rep_note: string | null;
  practiced: number;
  last_practiced_at: string | null;
  sent_at: string | null;
  read_at: string | null;
  responded_at: string | null;
  closed_at: string | null;
  close_note: string | null;
  created_at: string;
  updated_at: string;
};

export const CARD_KIND: Record<CardKind, { label: string; blurb: string }> = {
  focus: { label: "Focus", blurb: "One thing to work on" },
  win: { label: "Win", blurb: "Something to keep doing" },
  model: { label: "Model", blurb: "How a strong rep handles a moment" },
  compliance: { label: "Compliance", blurb: "Protecting the client and you" },
  encouragement: { label: "Encouragement", blurb: "After a rough stretch" },
};

export const RESPONSE_LABEL: Record<string, string> = {
  got_it: "Got it",
  question: "Has a question",
  disagree: "Sees it differently",
};

/** Words in the card's own text -- the research says 40-90 is the sweet spot. */
export function cardWords(c: Pick<Card, "noticed" | "why" | "try_this" | "when_then">): number {
  return [c.noticed, c.why, c.try_this, c.when_then].join(" ").split(/\s+/).filter(Boolean).length;
}

export const DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["skill", "noticed", "why", "try_this", "when_then", "call_id", "call_moment", "drill_type", "drill_id"],
  properties: {
    skill: { type: "string" },
    noticed: { type: "string" },
    why: { type: "string" },
    try_this: { type: "string" },
    when_then: { type: "string" },
    call_id: { type: "string" },
    call_moment: { type: "string" },
    drill_type: { type: "string", enum: ["module", "persona", "none"] },
    drill_id: { type: "string" },
  },
};

export type DraftResult = {
  skill: string;
  noticed: string;
  why: string;
  try_this: string;
  when_then: string;
  call_id: string;
  call_moment: string;
  drill_type: "module" | "persona" | "none";
  drill_id: string;
};

export const CARD_RULES = `How to write a training card (this is what the research on feedback says works -- follow it closely):
- ONE behavior. Never a list of issues.
- About the call, never about the person. No labels ("weak closer"), no ego praise ("you're a natural"), no comparing them to other reps.
- Curious, not corrective: "Here's a moment worth another look", not "You failed to".
- Second person, plain words, short sentences. The four text fields together: 40 to 90 words.
- "skill": the Straight Line skill or script moment, 1-4 words (e.g. "Looping", "Tonality: certainty", "Hardship probing").
- "noticed": one neutral sentence about what happened, anchored to a real moment from one of their calls with the time and a short quote when you have one.
- "why": one sentence on what it does to the client's state on the Straight Line (certainty in product, rep, company) -- not about the rep's character.
- "try_this": one concrete line or move to use next time, in Lionside's words where possible.
- "when_then": "When <the trigger on a call>, I'll <the move>." One sentence, in the rep's voice.
- "call_id": the id of the call the moment came from, or "" if none. "call_moment": e.g. "at 4:12 -- 'I need to talk to my wife'", or "".
- "drill_type"/"drill_id": the single best practice for it -- a script section (module id) to drill in the trainer, or a mock client (persona id) to call -- from the lists given, or "none" and "".
- Never copy a client's personal or banking details.`;

export const KIND_GUIDE: Record<CardKind, string> = {
  focus: "A FOCUS card: one fixable behavior from their recent calls -- the highest-leverage one.",
  win: "A WIN card: specific praise for one thing they did well on a recent call, so they keep doing it. 'try_this' says how to make it a habit; 'when_then' locks it in.",
  model: "A MODEL card: how a strong delivery of one moment sounds, framed as an example to imitate, not as a correction.",
  compliance:
    "A COMPLIANCE card: one disclosure or compliance behavior, framed as protecting the client and the rep. Calm, factual, no blame. Use the company's required wording where the call shows it was missed or rushed.",
  encouragement:
    "An ENCOURAGEMENT card after a rough stretch: name one real thing that went well recently, frame the setback as temporary and specific, and suggest one light drill. No corrections.",
};
