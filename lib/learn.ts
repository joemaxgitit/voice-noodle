/*
  Practice clients that learn from real calls.

  After a real call is graded, a cheap model reads it and keeps an anonymous
  profile of the client (lib/learnServer.ts): their situation, the
  objections they raised in their own words, what made them go cold or warm
  up, and how the call ended. No names, no numbers.

  That library feeds practice calls three ways:
    - every practice client borrows real wording for its objections,
    - real hang-ups teach practice clients when to hang up on a rep,
    - managers can have new practice clients drafted from real calls.

  The material updates as calls are learned; the Practice calls page
  brings the voice agents up to date by itself when it changes.
*/

export const OBJECTION_TYPES = [
  "think_about_it",
  "spouse_partner",
  "monthly_payment",
  "credit_damage",
  "trust_scam",
  "pay_it_myself",
  "not_now",
  "collections_lawsuits",
  "tried_before",
  "wants_a_loan",
  "other",
] as const;
export type ObjectionType = (typeof OBJECTION_TYPES)[number];

export const OBJECTION_LABEL: Record<ObjectionType, string> = {
  think_about_it: "Needs to think about it",
  spouse_partner: "Spouse or partner",
  monthly_payment: "Monthly payment",
  credit_damage: "Credit damage",
  trust_scam: "Trust / sounds like a scam",
  pay_it_myself: "Would rather pay it myself",
  not_now: "Not the right time",
  collections_lawsuits: "Collections and lawsuits",
  tried_before: "Tried something before",
  wants_a_loan: "Only wanted a loan",
  other: "Other",
};

export type Objection = { type: ObjectionType; quote: string; underneath: string; handled: boolean; what_worked: string };
export type Moment = { rep_did: string; client_reaction: string };
export type Ending = { how: "enrolled" | "callback" | "declined" | "hung_up" | "other"; hung_up: boolean; trigger: string; last_words: string };
export type Profile = {
  situation: string;
  hardship: string;
  debts: string;
  personality: string;
  speech: string;
  wanted: string;
  decision: string;
  opened_up?: string;
  turndown?: string;
};

export type ClientInsight = {
  id: string;
  call_id: string;
  lang: "en" | "es";
  kind: "full" | "short" | "skip";
  outcome: string | null;
  profile: Partial<Profile>;
  objections: Objection[];
  moments: { cold?: Moment[]; warm?: Moment[] };
  ending: Partial<Ending>;
  used_in: string | null;
  usd: number | null;
  created_at: string;
  /** The call's retention, joined in (graduated / paid6 = a proven sale). */
  calls?: { retention: string | null } | null;
};

/** A sale that lasted: the client graduated or made 6+ payments. */
export const isProven = (i: Pick<ClientInsight, "calls">) => ["graduated", "paid6"].includes(i.calls?.retention ?? "");

/** Calls under this length (or with very little from the client) only teach how calls end. */
export const SHORT_CALL_SECS = 180;

/** Monday 00:00 of this week, as an ISO date: the library refresh point. */
export function libraryCutoff(now = new Date()): string {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.toISOString();
}

export type RealVoice = {
  /** Real objection lines, a few per type, in this language. */
  lines: { type: ObjectionType; quote: string; underneath: string }[];
  /** What real reps did right before a client hung up or went cold. */
  triggers: string[];
  /** What real reps did that won a client back. */
  winners: string[];
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * The real-call material a practice agent is built with. Deterministic for
 * a given set of insights (newest first), so the agent fingerprint only
 * changes when the weekly library does.
 */
export function realVoice(insights: ClientInsight[], lang: "en" | "es", cutoff = "9999"): RealVoice {
  const pool = insights
    .filter((i) => i.kind !== "skip" && i.created_at < cutoff)
    // Proven sales first (graduated or 6+ payments): what won those clients is what we want reps to learn.
    .sort((a, b) => Number(isProven(b)) - Number(isProven(a)) || (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id.localeCompare(b.id)));
  const mine = pool.filter((i) => i.lang === lang);
  // Spanish clients are fewer; fall back to English material for behaviour, never for wording.
  const lines: RealVoice["lines"] = [];
  const perType = new Map<string, number>();
  for (const i of mine)
    for (const o of i.objections || []) {
      if (!o.quote || lines.length >= 16) continue;
      const n = perType.get(o.type) ?? 0;
      if (n >= 2) continue;
      perType.set(o.type, n + 1);
      lines.push({ type: o.type, quote: clip(o.quote.trim(), 160), underneath: clip((o.underneath || "").trim(), 120) });
    }
  const seen = new Set<string>();
  const uniq = (xs: string[], max: number) =>
    xs
      .map((x) => clip(x.trim(), 140))
      .filter((x) => x && !seen.has(x.toLowerCase()) && (seen.add(x.toLowerCase()), true))
      .slice(0, max);
  const triggers = uniq(
    pool.flatMap((i) => [...(i.ending?.hung_up && i.ending.trigger ? [i.ending.trigger] : []), ...(i.moments?.cold || []).map((m) => m.rep_did)]),
    10
  );
  const winners = uniq(
    pool.flatMap((i) => (i.moments?.warm || []).map((m) => m.rep_did)),
    8
  );
  return { lines, triggers, winners };
}

/** The part of a practice client's instructions that comes from real calls. Empty when there's nothing yet. */
export function realVoiceSection(rv: RealVoice | null | undefined, lang: "en" | "es"): string {
  if (!rv || (!rv.lines.length && !rv.triggers.length && !rv.winners.length)) return "";
  const out: string[] = ["", "# What real clients like you have said (from real Lionside calls)"];
  if (rv.lines.length) {
    out.push(
      lang === "es"
        ? "When one of these concerns is genuinely yours, say it the way real clients said it -- in your own words, never word for word, and only when it fits your situation:"
        : "When one of these concerns is genuinely yours, say it the way real clients said it -- in your own words, never word for word, and only when it fits your situation:"
    );
    for (const l of rv.lines) out.push(`- "${l.quote}"${l.underneath ? ` (what was really underneath: ${l.underneath})` : ""}`);
  }
  if (rv.triggers.length) {
    out.push("", "Real clients went cold or hung up when the rep did things like:");
    for (const t of rv.triggers) out.push(`- ${t}`);
  }
  if (rv.winners.length) {
    out.push("", "Real clients warmed up when the rep did things like:");
    for (const w of rv.winners) out.push(`- ${w}`);
  }
  return out.join("\n");
}
