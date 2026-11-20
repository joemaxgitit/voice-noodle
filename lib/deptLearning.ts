import type { Grade, SectionResult } from "@/lib/calls";
import { clientKey } from "@/lib/journey";

/*
  Self-tuning for Service and Openers (Sales has its own: lib/insights.ts).

  Every call is tied to a lead ID, and the lead ID is the same in every
  department, so each call can be judged by what happened to that lead
  afterwards:
  - Openers: good = the application was submitted (or the loan approved),
    or Sales went on to enroll the lead. Bad = the opener lost the lead
    (not interested, vague callback, hung up) and it never came back.
  - Service: good = the client went on to make 6+ payments or graduate, or
    is still with us 90 days after the call. Bad = the client cancelled
    after (or within a week before) the call.
  Calls whose result isn't known yet are left out.

  Pure functions, so the Insights page and the lesson writer
  (api/calls/dept-lessons) see the same numbers.
*/

export type LearnDept = "service" | "openers";
export const LEARN_DEPTS: LearnDept[] = ["service", "openers"];
/** Each side needs this many calls before anything is learned automatically. */
export const DEPT_MIN = 10;
/** A metric is only shown with at least this many calls on each side. */
export const METRIC_MIN = 3;

/** What became of a lead, from every department's calls and the cancel reports (supabase function lead_results). */
export type LeadResult = { lead: string; enrolled: boolean; retention: string | null; cancelled_on: string | null };

export type LearnCall = {
  id: string;
  client_label: string | null;
  call_date: string | null;
  created_at: string;
  outcome: string | null;
  outcome_manual: string | null;
  score: number | null;
  grade: Grade | null;
};

export type Labeled = LearnCall & { label: "good" | "bad"; why: string };

const DAY = 86_400_000;
const dayOf = (c: LearnCall) => c.call_date || c.created_at.slice(0, 10);
const WON = new Set(["submitted", "loan_approved"]);
const LOST = new Set(["not_interested", "callback_vague", "hung_up"]);

export function labelCalls(dept: LearnDept, calls: LearnCall[], leads: Map<string, LeadResult>, now = Date.now()): Labeled[] {
  const out: Labeled[] = [];
  // Openers: a lead another opener call later won isn't a loss.
  const wonLeads = new Set(calls.filter((c) => WON.has((c.outcome_manual ?? c.outcome) || "")).map((c) => clientKey(c.client_label)));
  for (const c of calls) {
    if (!c.grade) continue;
    const key = clientKey(c.client_label);
    const lead = key ? leads.get(key) : undefined;
    if (dept === "openers") {
      const res = (c.outcome_manual ?? c.outcome) || "";
      if (WON.has(res)) out.push({ ...c, label: "good", why: res === "loan_approved" ? "loan approved" : "application submitted" });
      else if (lead?.enrolled) out.push({ ...c, label: "good", why: "sales enrolled the lead" });
      else if (LOST.has(res) && !(key && wonLeads.has(key))) out.push({ ...c, label: "bad", why: res.replace("_", " ") });
      continue;
    }
    // Service
    if (!lead) continue;
    const d = dayOf(c);
    const cancelAfter = lead.cancelled_on && new Date(`${lead.cancelled_on}T12:00:00`).getTime() >= new Date(`${d}T12:00:00`).getTime() - 7 * DAY;
    if (cancelAfter) out.push({ ...c, label: "bad", why: "client cancelled" });
    else if (lead.retention === "graduated" || lead.retention === "paid6") out.push({ ...c, label: "good", why: lead.retention === "paid6" ? "6+ payments" : "graduated" });
    else if (!lead.cancelled_on && (lead.enrolled || lead.retention === "active") && now - new Date(`${d}T12:00:00`).getTime() >= 90 * DAY) out.push({ ...c, label: "good", why: "still with us 90 days later" });
  }
  return out;
}

export type DeptMetric = { group: string; label: string; good: number | null; bad: number | null; gap: number | null; nGood: number; nBad: number };

const pct = (xs: number[]) => (xs.length ? Math.round((100 * xs.reduce((a, b) => a + b, 0)) / xs.length) : null);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const secPts = (s: SectionResult["status"]) => (s === "hit" ? 1 : s === "partial" ? 0.5 : s === "missed" ? 0 : null);

/** Per call: metric key -> 0..1 (or 0..100 for scores), skipping what the call never reached. */
function featuresOf(dept: LearnDept, c: LearnCall): Map<string, { group: string; label: string; v: number }> {
  const f = new Map<string, { group: string; label: string; v: number }>();
  const g = c.grade!;
  const put = (group: string, label: string, v: number | null | undefined) => {
    if (v === null || v === undefined || Number.isNaN(v)) return;
    f.set(`${group}|${label}`, { group, label, v });
  };
  if (typeof c.score === "number") put("Overall", dept === "openers" ? "Application verification %" : "Script score", c.score / 100);
  for (const s of g.sections ?? []) put("Script sections", s.section, secPts(s.status));
  for (const x of g.compliance ?? []) if (x.status !== "not_reached") put("Disclaimers", x.item, x.status === "yes" ? 1 : 0);
  put("Overall", "Flags raised", (g.flags ?? []).length ? 1 : 0);
  const o = g.opener;
  if (dept === "openers" && o) {
    for (const q of o.questions ?? []) if (q.asked !== "not_reached") put("Application questions", q.item, q.asked === "yes" ? 1 : q.asked === "partly" ? 0.5 : 0);
    for (const r of o.readbacks ?? []) if (r.done !== "not_reached") put("Read-backs", r.item, r.done === "yes" ? 1 : 0);
    const rb = o.rebuttals ?? [];
    if (rb.length) {
      put("Rebuttals", "Asked their concerns first", mean(rb.filter((r) => r.asked_concerns !== "n/a").map((r) => (r.asked_concerns === "yes" ? 1 : 0))));
      put("Rebuttals", "Used the approved rebuttal", mean(rb.map((r) => (r.used_approved === "yes" ? 1 : r.used_approved === "partly" ? 0.5 : 0))));
      put("Rebuttals", "Ended on a tie-down", mean(rb.map((r) => (r.tie_down === "yes" ? 1 : 0))));
    }
    put("Rebuttals", "Let the client go early", o.let_go_early?.early ? 1 : 0);
  }
  return f;
}

/** Good vs bad on every metric, biggest differences first. */
export function deptMetrics(dept: LearnDept, labeled: Labeled[]): DeptMetric[] {
  const acc = new Map<string, { group: string; label: string; good: number[]; bad: number[] }>();
  for (const c of labeled) {
    for (const [k, x] of featuresOf(dept, c)) {
      const a = acc.get(k) ?? { group: x.group, label: x.label, good: [], bad: [] };
      (c.label === "good" ? a.good : a.bad).push(x.v);
      acc.set(k, a);
    }
  }
  return [...acc.values()]
    .filter((a) => a.good.length >= METRIC_MIN && a.bad.length >= METRIC_MIN)
    .map((a) => {
      const good = pct(a.good);
      const bad = pct(a.bad);
      return { group: a.group, label: a.label, good, bad, gap: good !== null && bad !== null ? good - bad : null, nGood: a.good.length, nBad: a.bad.length };
    })
    .sort((a, b) => Math.abs(b.gap ?? 0) - Math.abs(a.gap ?? 0));
}

/** "Flags raised" and "Let the client go early" are better when lower. */
export const LOWER_IS_BETTER = new Set(["Flags raised", "Let the client go early"]);

/** A few lines about one call for the lesson writer. No names. */
export function digestCall(c: Labeled): string {
  const g = c.grade!;
  const lines = [`Result: ${c.why}.`, g.summary ? `Summary: ${g.summary}` : ""];
  const miss = (g.sections ?? []).filter((s) => s.status === "missed" || s.status === "partial").map((s) => `${s.section} (${s.status})`);
  if (miss.length) lines.push(`Sections missed or partial: ${miss.join(", ")}`);
  const o = g.opener;
  if (o) {
    const skipped = (o.questions ?? []).filter((q) => q.asked === "no" || q.asked === "partly").map((q) => q.item);
    if (skipped.length) lines.push(`Application questions skipped/partly: ${skipped.join(", ")}`);
    const rb = (o.rebuttals ?? []).map((r) => `${r.objection || r.matched} -> ${r.result}${r.used_approved !== "yes" ? " (not the approved rebuttal)" : ""}${r.tie_down !== "yes" ? " (no tie-down)" : ""}`);
    if (rb.length) lines.push(`Objections: ${rb.join("; ")}`);
    if (o.let_go_early?.early) lines.push(`Let the client go early: ${o.let_go_early.note}`);
    if (o.control) lines.push(`Pace and energy: ${o.control}`);
  }
  if (g.coach_now?.priority?.title) lines.push(`Grader's top coaching point: ${g.coach_now.priority.title}`);
  return lines.filter(Boolean).join("\n");
}

export const DEPT_WORDS: Record<LearnDept, { who: string; calls: string; good: string; bad: string }> = {
  openers: {
    who: "an opener (inbound loan-application) manager",
    calls: "opener calls, where the rep verifies the client, takes the loan application, reads the disclaimers and hands off to a financial specialist",
    good: "the application was submitted, the loan was approved, or Sales went on to enroll the lead",
    bad: "the opener lost the lead (not interested, a callback with no set time, hung up) and it never came back",
  },
  service: {
    who: "an account-manager (client service) manager at a debt-relief company",
    calls: "account-manager calls with enrolled clients",
    good: "the client went on to make 6+ payments, graduate, or was still in the program 90 days after the call",
    bad: "the client cancelled after the call (or within a week before it, so the call was a failed save)",
  },
};
