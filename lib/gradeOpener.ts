import type { CoachNow, ComplianceResult, Flag, Grade, Outcome, SectionResult } from "./calls";

/*
  Opener calls are graded their own way. An opener takes an inbound call from
  a mailer, collects a loan application, reads three consents and hands off to
  a Financial Specialist -- a 5-10 minute call with no hardship, no options and
  no close. So no Straight Line score: just the script, the compliance lines,
  the rebuttals and the outcome, plus the top 2 things to coach.

  The grade is stored in the same shape as a closer's (sections, compliance,
  flags, coach_now, outcome) so the call page, lists, day reviews and best-calls
  all work, with the opener-only parts in grade.opener.
*/

export const OPENER_GRADER_VERSION = 1;

/** The application questions, in order. Checked one by one. */
export const OPENER_QUESTIONS = [
  "Invitation ID / PIN from the letter",
  "Confirmed they're speaking with the client",
  "Confirmed name and full address",
  "Spelling of name and address correct",
  "Middle name",
  "Rent or own",
  "Monthly mortgage or rent payment",
  "How long at the address",
  "Best phone number",
  "Second phone number",
  "OK to call any time (or best time)",
  "Email address",
  "Current employer",
  "How long employed there",
  "Position",
  "Full time or part time",
  "Gross monthly or annual income",
  "Additional expenses",
  "Checking or savings account",
  "US citizen",
  "Active military",
  "Date of birth",
  "Last 4 of SSN",
];

/** Things they must repeat back to the client. */
export const OPENER_READBACKS = ["Second phone number", "Email (spelled back)", "Date of birth", "Last 4 of SSN"];

/** The compliance lines, which must be said as written. */
export const OPENER_COMPLIANCE = [
  "Soft pull: won't show as an inquiry and won't affect their credit score",
  "Permission to submit the application through the lending platform",
  "Permission for lenders or other 3rd parties to contact them by phone and email",
  "Permission for text messages",
  "The Financial Specialist is part of our team at LionSide",
];

export type OpenerRebuttal = {
  at: number | null;
  /** What the client said, in a few words. */
  objection: string;
  /** Which rebuttal in the library fits ("Let me think about it"), or "". */
  matched: string;
  asked_concerns: "yes" | "no" | "n/a";
  used_approved: "yes" | "partly" | "no";
  tie_down: "yes" | "no";
  result: "kept_going" | "callback" | "lost" | "unclear";
  note: string;
};

export type OpenerParts = {
  version: number;
  questions: { item: string; asked: "yes" | "partly" | "no" | "not_reached"; time: number | null; note: string }[];
  readbacks: { item: string; done: "yes" | "no" | "not_reached"; time: number | null }[];
  rebuttals: OpenerRebuttal[];
  /** Did they let the client go (or accept a callback) before trying the rebuttals? */
  let_go_early: { early: boolean; note: string; time: number | null };
  /** Pace, energy, urgency and dead air, in plain words. */
  control: string;
  /** Scores shown on the call page (worked out in code). */
  script_pct: number | null;
  compliance_said: number;
  compliance_total: number;
  rebuttals_good: number;
};

export const OPENER_OUTCOMES = ["submitted", "callback", "callback_vague", "not_interested", "no_id", "not_authorized", "hung_up", "interrupted", "other"] as const;

const timeT = { type: ["number", "null"] } as const;
const str = { type: "string" } as const;
const coachItem = {
  type: "object",
  additionalProperties: false,
  required: ["skill", "title", "time", "quote", "observed", "why_it_matters", "next_call", "drill", "check", "confidence", "reasons"],
  properties: {
    skill: str,
    title: str,
    time: timeT,
    quote: str,
    observed: str,
    why_it_matters: str,
    next_call: str,
    drill: str,
    check: str,
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    reasons: str,
  },
} as const;

export const OPENER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["speaker_roles", "summary", "furthest_point", "sections", "questions", "readbacks", "compliance", "rebuttals", "let_go_early", "control", "flags", "outcome", "outcome_note", "coach_now", "strengths"],
  properties: {
    speaker_roles: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["speaker", "role"], properties: { speaker: str, role: { type: "string", enum: ["rep", "client", "other"] } } },
    },
    summary: str,
    furthest_point: str,
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["section", "status", "evidence", "time", "coaching"],
        properties: { section: str, status: { type: "string", enum: ["hit", "partial", "missed", "not_reached"] }, evidence: str, time: timeT, coaching: str },
      },
    },
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["item", "asked", "time", "note"],
        properties: { item: str, asked: { type: "string", enum: ["yes", "partly", "no", "not_reached"] }, time: timeT, note: str },
      },
    },
    readbacks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["item", "done", "time"],
        properties: { item: str, done: { type: "string", enum: ["yes", "no", "not_reached"] }, time: timeT },
      },
    },
    compliance: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["item", "status", "evidence", "time"],
        properties: { item: str, status: { type: "string", enum: ["yes", "no", "unclear", "not_reached"] }, evidence: str, time: timeT },
      },
    },
    rebuttals: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["at", "objection", "matched", "asked_concerns", "used_approved", "tie_down", "result", "note"],
        properties: {
          at: timeT,
          objection: str,
          matched: str,
          asked_concerns: { type: "string", enum: ["yes", "no", "n/a"] },
          used_approved: { type: "string", enum: ["yes", "partly", "no"] },
          tie_down: { type: "string", enum: ["yes", "no"] },
          result: { type: "string", enum: ["kept_going", "callback", "lost", "unclear"] },
          note: str,
        },
      },
    },
    let_go_early: { type: "object", additionalProperties: false, required: ["early", "note", "time"], properties: { early: { type: "boolean" }, note: str, time: timeT } },
    control: str,
    flags: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["time", "quote", "issue", "in_script", "severity"],
        properties: { time: timeT, quote: str, issue: str, in_script: { type: "boolean" }, severity: { type: "string", enum: ["high", "medium", "low"] } },
      },
    },
    outcome: { type: "string", enum: [...OPENER_OUTCOMES] },
    outcome_note: str,
    coach_now: {
      type: "object",
      additionalProperties: false,
      required: ["priority", "second", "strengths"],
      properties: {
        priority: coachItem,
        second: { anyOf: [coachItem, { type: "null" }] },
        strengths: {
          type: "array",
          items: { type: "object", additionalProperties: false, required: ["text", "time"], properties: { text: str, time: timeT } },
        },
      },
    },
    strengths: { type: "array", items: str },
  },
} as const;

/** The instructions. Everything call-specific goes in the second block so the first is cached. */
export function openerPrompt(opts: { scriptTitle: string; script: string; sections: string[]; voiceGuide: string }): string {
  return `You are grading a recorded INBOUND OPENER call for LionSide Financial. The client got a pre-approved personal loan offer in the mail and called in. The opener ("rep") verifies who they are, takes a short loan application over the phone, reads the consents, submits it, and hands the client off to a Financial Specialist (FS) on the team. A good call takes about 5 minutes once the client is in. There is no hardship, no options and no close on this call -- do NOT judge it like a sales close.

Grade four things only: the SCRIPT (did they ask every application question, in order, and read back what must be read back), COMPLIANCE (the consent lines, as written), REBUTTALS (how they handled pushback, against the rebuttal library) and the OUTCOME. Then pick the top 2 things to coach.

THE SCRIPT ("${opts.scriptTitle}"), in order. Sequence sections first, then the REBUTTAL LIBRARY (sections marked LOOP) -- the approved answer to each kind of pushback:
${opts.script}

RULES
- If the rep said it and it is in the script or the rebuttal library, it is approved wording -- never flag it, even strong claims like "We can GUARANTEE it won't affect your credit score". Only flag claims that are NOT in the script or the library (for example promising a specific rate or that they are approved for a loan, or saying the FS is not part of our team).
- sections: one row per sequence section above, by its exact title: ${opts.sections.join(" | ")}. hit = all of it done, partial = some, missed = skipped while the call got past it, not_reached = the call ended before it. evidence: a short quote or what happened. coaching: one sentence, "" if nothing to fix.
- questions: one row per item in this exact list and order: ${OPENER_QUESTIONS.join(" | ")}. asked yes/partly/no, or not_reached if the call ended before it. A question the client answered before being asked (they volunteered it) counts as yes. time: seconds where it was asked.
- readbacks: one row per item in this exact list: ${OPENER_READBACKS.join(" | ")}. done = the rep repeated it back to the client to confirm (spelling the email back counts for the email).
- compliance: one row per item in this exact list: ${OPENER_COMPLIANCE.join(" | ")}. yes = said in substance as written (the meaning must be intact: soft pull AND no effect on the score; permission to SUBMIT; permission for lenders / 3rd parties to contact by PHONE AND EMAIL; TEXT messages; the FS is part of our team). no = skipped or changed in a way that loses the meaning while the call got that far. not_reached = the call ended before it. evidence: the quote.
- rebuttals: every time the client pushed back, stalled or hesitated ("let me think about it", "call me back", "not interested", "is this a scam", "I don't want to give my social", "talk to my spouse"...). asked_concerns: did the rep first ask "What questions or concerns do you have?" (or close to it) where the library says to -- "n/a" for questions that just need an answer. matched: the library rebuttal that fits, by its title, or "" if none does. used_approved: did they give that rebuttal (yes / partly / no -- "no" if they argued, made something up or caved). tie_down: did they end with a tie-down ("okay?", "sound good?", "fair enough?"). result: kept_going (the application continued), callback (a callback was set), lost (client left), unclear.
- PERSISTENCE (the manager's rule): never just accept a stall or a "no" the first time. The rep asks what their questions or concerns are, gives the matching rebuttal, and keeps going. Only when the client gives the SAME objection a second time is it real -- then booking a set callback (or letting them go) is the right move, not a mistake.
- let_go_early: true when the rep accepted a callback or let the client go before the client had given that same objection twice -- for example on the first "call me back" or "not interested", or without asking their concerns and giving the matching rebuttal. Not "early" when the same objection came back after a rebuttal, or when the client has no client ID or isn't the client and the rep handled it the way the library says.
- control: two plain sentences on pace, energy and dead air. The library says to set urgency with tonality and pace when a client says they're too busy -- note if the rep did. Long silences while typing are worth one mention only if they cost the call.
- outcome: submitted (application submitted), callback (a set callback time), callback_vague (call back with no set time), not_interested, no_id (wouldn't or couldn't give the client ID), not_authorized (wasn't the client and no permission), hung_up, interrupted, other. outcome_note: one sentence.
- coach_now: the TOP 2 things to coach, most important first, each tied to a moment (time in seconds, the quote, what happened, why it matters on an opener call, what to do on the next call, a 2-minute drill, and what to listen for next time). second is null only if the call clearly shows just one. strengths: up to 3 things done well, each with a time. Coach what loses submissions first (letting go early, skipped consents, skipped questions that block the submit), then rebuttal delivery, then pace and read-backs.
- speaker_roles: which transcript speaker is the rep, the client, or someone else.
- summary: two or three plain sentences. furthest_point: the last script section the call reached.
- Write everything in plain English a manager would use, even when the call is in Spanish (quote Spanish lines in English).
- Times are seconds from the start of the call, from the [number] at the start of each transcript line.

${opts.voiceGuide}`;
}

const yes = (v: unknown, ok: string[], fallback: string) => (ok.includes(String(v)) ? String(v) : fallback);

/** Tidy the model's reply into a Grade. Scores are worked out here, not by the model. */
export function finishOpener(raw: Record<string, unknown>): Grade {
  const arr = (x: unknown) => (Array.isArray(x) ? (x as Record<string, unknown>[]) : []);
  const t = (x: unknown) => (typeof x === "number" && x >= 0 ? Math.round(x) : null);
  const s = (x: unknown) => (typeof x === "string" ? x : x == null ? "" : String(x));

  const sections: SectionResult[] = arr(raw.sections).map((r) => ({
    section: s(r.section),
    status: yes(r.status, ["hit", "partial", "missed", "not_reached"], "missed") as SectionResult["status"],
    evidence: s(r.evidence),
    time: t(r.time),
    coaching: s(r.coaching),
  }));
  const questions = arr(raw.questions).map((r) => ({ item: s(r.item), asked: yes(r.asked, ["yes", "partly", "no", "not_reached"], "no") as OpenerParts["questions"][number]["asked"], time: t(r.time), note: s(r.note) }));
  const readbacks = arr(raw.readbacks).map((r) => ({ item: s(r.item), done: yes(r.done, ["yes", "no", "not_reached"], "no") as OpenerParts["readbacks"][number]["done"], time: t(r.time) }));
  const compliance: ComplianceResult[] = arr(raw.compliance).map((r) => ({
    item: s(r.item),
    status: yes(r.status, ["yes", "no", "unclear", "not_reached"], "unclear") as ComplianceResult["status"],
    evidence: s(r.evidence),
    time: t(r.time),
  }));
  const rebuttals: OpenerRebuttal[] = arr(raw.rebuttals).map((r) => ({
    at: t(r.at),
    objection: s(r.objection),
    matched: s(r.matched),
    asked_concerns: yes(r.asked_concerns, ["yes", "no", "n/a"], "n/a") as OpenerRebuttal["asked_concerns"],
    used_approved: yes(r.used_approved, ["yes", "partly", "no"], "no") as OpenerRebuttal["used_approved"],
    tie_down: yes(r.tie_down, ["yes", "no"], "no") as OpenerRebuttal["tie_down"],
    result: yes(r.result, ["kept_going", "callback", "lost", "unclear"], "unclear") as OpenerRebuttal["result"],
    note: s(r.note),
  }));
  // Approved wording is never a flag.
  const flags: Flag[] = arr(raw.flags)
    .map((r) => ({ time: t(r.time), quote: s(r.quote), issue: s(r.issue), in_script: !!r.in_script, severity: yes(r.severity, ["high", "medium", "low"], "low") as Flag["severity"] }))
    .filter((f) => !f.in_script);
  const lg = (raw.let_go_early || {}) as Record<string, unknown>;

  // Script %: the application questions (asked = 1, partly = 1/2) plus read-backs, over those the call reached.
  const reachedQ = questions.filter((q) => q.asked !== "not_reached");
  const reachedR = readbacks.filter((r) => r.done !== "not_reached");
  const pts = reachedQ.reduce((n, q) => n + (q.asked === "yes" ? 1 : q.asked === "partly" ? 0.5 : 0), 0) + reachedR.filter((r) => r.done === "yes").length;
  const of = reachedQ.length + reachedR.length;
  const reachedC = compliance.filter((c) => c.status !== "not_reached");

  const cn = (raw.coach_now || {}) as Record<string, unknown>;
  const item = (x: unknown): CoachNow["priority"] | null => {
    if (!x || typeof x !== "object") return null;
    const o = x as Record<string, unknown>;
    if (!s(o.title)) return null;
    return {
      skill: s(o.skill),
      title: s(o.title),
      time: t(o.time),
      quote: s(o.quote),
      observed: s(o.observed),
      why_it_matters: s(o.why_it_matters),
      next_call: s(o.next_call),
      drill: s(o.drill),
      check: s(o.check),
      confidence: yes(o.confidence, ["high", "medium", "low"], "medium") as "high",
      reasons: s(o.reasons),
    };
  };
  const priority = item(cn.priority);
  const coach_now: CoachNow | undefined = priority
    ? {
        priority,
        second: item(cn.second),
        also: [],
        strengths: arr(cn.strengths)
          .slice(0, 3)
          .map((x) => ({ text: s(x.text), time: t(x.time) })),
        hypotheses: [],
      }
    : undefined;

  const opener: OpenerParts = {
    version: OPENER_GRADER_VERSION,
    questions,
    readbacks,
    rebuttals,
    let_go_early: { early: !!lg.early, note: s(lg.note), time: t(lg.time) },
    control: s(raw.control),
    script_pct: of ? Math.round((100 * pts) / of) : null,
    compliance_said: reachedC.filter((c) => c.status === "yes").length,
    compliance_total: reachedC.length,
    rebuttals_good: rebuttals.filter((r) => r.used_approved === "yes" && r.tie_down === "yes" && r.asked_concerns !== "no").length,
  };

  return {
    speaker_roles: arr(raw.speaker_roles).map((r) => ({ speaker: s(r.speaker), role: yes(r.role, ["rep", "client", "other"], "other") as "rep" })),
    summary: s(raw.summary),
    furthest_point: s(raw.furthest_point),
    sections,
    compliance,
    flags,
    strengths: (Array.isArray(raw.strengths) ? raw.strengths : []).map(s).filter(Boolean),
    coaching_priorities: [priority?.title, item(cn.second)?.title].filter((x): x is string => !!x),
    outcome: yes(raw.outcome, [...OPENER_OUTCOMES], "other") as Outcome,
    outcome_note: s(raw.outcome_note),
    coach_now,
    opener,
  };
}
