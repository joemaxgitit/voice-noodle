import { ROADMAP, scoreOf, slpScoreOf, OUTCOME_LABEL, ENDED_LABEL, type Ended, type Grade, type Outcome } from "@/lib/calls";

/*
  The answer key: calls a manager has graded by hand, once. Every new grader
  version, and every new set of standing rules, is tested against them -- the
  grader re-grades each call (never saved onto the call) and the result is
  compared with the manager's answers. That turns "the grader feels right"
  into a number, and stops the self-refining loops from teaching themselves
  something wrong.

  Shared by the server routes and the pages, so both use the same comparison.
*/

/** The manager's answers for one call. Every field is optional: only what's answered is compared. */
export type BenchKey = {
  outcome?: Outcome;
  ended_why?: Ended["why"];
  close_quality?: "solid" | "ok" | "fragile";
  /** The one thing the manager would coach first, in their words. */
  coach_first?: string;
  /** The roadmap stage where the call first went wrong, or "none". */
  arc_break?: string;
  /** Did the rep dig into the hardship enough? */
  hardship?: "yes" | "partly" | "no";
  /** Three Tens where the client ended: 1-10, or 0 for "not reached". */
  product?: number;
  rep?: number;
  company?: number;
  /** Gut numbers, 0-100. */
  script?: number;
  slp?: number;
  notes?: string;
  /** Service and Openers keys; no dept = Sales. Each department's lessons are tested on its own keys. */
  dept?: "service" | "openers";
  /** Openers: application verification (questions + read-backs), gut 0-100. */
  app_pct?: number;
  /** Openers: disclaimers said. */
  disclaimers?: "all" | "some" | "few";
  /** Openers: how the objections were handled. */
  rebuttals?: "good" | "mixed" | "poor" | "none";
  /** Openers: let the client go before the same objection came twice? */
  let_go_early?: "yes" | "no";
};

/** Which department a key belongs to (no dept = Sales). */
export const keyDept = (k: BenchKey | null | undefined): "sales" | "service" | "openers" => k?.dept ?? "sales";

export type BenchItem = { item: string; label: string; key: string; grader: string; score: number };

/** Below this many keyed calls a test says too little to hold back new rules. */
export const BENCH_MIN = 5;
/** New standing rules go live by themselves unless they score this many points below the current ones. */
export const BENCH_TOLERANCE = 3;

export const BENCH_ITEM_LABEL: Record<string, string> = {
  outcome: "Outcome",
  ended_why: "Why it ended",
  close_quality: "Close quality",
  coach_first: "What to coach first",
  arc_break: "Where the roadmap broke",
  hardship: "Hardship dug enough",
  product: "Product certainty",
  rep: "Rep certainty",
  company: "Company certainty",
  script: "Script score",
  slp: "Straight Line score",
  app_pct: "Application verification",
  disclaimers: "Disclaimers said",
  rebuttals: "Rebuttals",
  let_go_early: "Let the client go early",
};

/** A short fingerprint of a set of standing rules, to tell rule sets apart. */
export function rulesHash(rules: { rule: string }[] | null | undefined): string {
  const text = (rules ?? []).map((r) => r.rule.trim()).join("\n");
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return `${(rules ?? []).length}-${(h >>> 0).toString(36)}`;
}

/** The first roadmap stage that didn't land (then the first that only partly landed), or "none". */
export function arcBreakOf(g: Grade): string {
  const arc = (g.emotional_arc ?? []).filter((a) => a.landed !== "not_reached");
  if (!arc.length) return "";
  return (arc.find((a) => a.landed === "no") ?? arc.find((a) => a.landed === "partial"))?.stage ?? "none";
}

function hardshipOf(g: Grade): "yes" | "partly" | "no" | "" {
  const s = g.spotlights?.hardship?.score;
  if (typeof s !== "number") return "";
  return s >= 70 ? "yes" : s >= 45 ? "partly" : "no";
}

const near = (a: number, b: number, full: number, half: number) => (Math.abs(a - b) <= full ? 1 : Math.abs(a - b) <= half ? 0.5 : 0);
const stageIndex = (s: string) => ROADMAP.findIndex((r) => r.stage.toLowerCase() === s.toLowerCase());

/**
 * Compares one test grade with the manager's answers, item by item: 1 = agrees,
 * 0.5 = close, 0 = disagrees. "What to coach first" needs a judgment call and is
 * scored by the server (coachMatch) and passed in.
 */
export function compare(key: BenchKey, g: Grade, coachMatch: number | null): BenchItem[] {
  const out: BenchItem[] = [];
  const add = (item: string, k: string, gr: string, score: number) => out.push({ item, label: BENCH_ITEM_LABEL[item] ?? item, key: k, grader: gr || "--", score });

  if (key.outcome) {
    const o = g.outcome ?? "other";
    const close = new Set([key.outcome, o]).size === 2 && [key.outcome, o].every((x) => x === "callback" || x === "callback_vague");
    add("outcome", OUTCOME_LABEL[key.outcome], OUTCOME_LABEL[o as Outcome] ?? o, key.outcome === o ? 1 : close ? 0.5 : 0);
  }
  if (key.ended_why) {
    const w = g.ended?.why ?? "";
    add("ended_why", ENDED_LABEL[key.ended_why], w ? ENDED_LABEL[w as Ended["why"]] ?? w : "", key.ended_why === w ? 1 : 0);
  }
  if (key.close_quality) {
    const c = g.close_quality ?? "n/a";
    const order = ["fragile", "ok", "solid"];
    const d = order.indexOf(c) < 0 ? 9 : Math.abs(order.indexOf(c) - order.indexOf(key.close_quality));
    add("close_quality", key.close_quality, c, d === 0 ? 1 : d === 1 ? 0.5 : 0);
  }
  if (key.coach_first?.trim() && coachMatch !== null) {
    add("coach_first", key.coach_first.trim(), g.coach_now?.priority.title || g.coaching_priorities?.[0] || "", coachMatch);
  }
  if (key.arc_break) {
    const b = arcBreakOf(g);
    const ki = stageIndex(key.arc_break);
    const gi = stageIndex(b);
    const score = key.arc_break.toLowerCase() === b.toLowerCase() ? 1 : ki >= 0 && gi >= 0 && Math.abs(ki - gi) === 1 ? 0.5 : 0;
    add("arc_break", key.arc_break, b, score);
  }
  if (key.hardship) {
    const h = hardshipOf(g);
    const order = ["no", "partly", "yes"];
    const d = h ? Math.abs(order.indexOf(h) - order.indexOf(key.hardship)) : 9;
    add("hardship", key.hardship, h, d === 0 ? 1 : d === 1 ? 0.5 : 0);
  }
  for (const t of ["product", "rep", "company"] as const) {
    const k = key[t];
    if (typeof k !== "number") continue;
    const v = g.three_tens?.[t] ?? null;
    const gv = typeof v === "number" && v > 0 ? v : 0;
    const score = k === 0 || gv === 0 ? (k === gv ? 1 : 0) : near(k, gv, 2, 3);
    add(t, k === 0 ? "not reached" : String(k), gv === 0 ? "not reached" : String(gv), score);
  }
  if (typeof key.script === "number") {
    const v = scoreOf(g);
    add("script", String(key.script), v === null ? "" : String(v), v === null ? 0 : near(key.script, v, 8, 15));
  }
  const o = g.opener;
  if (typeof key.app_pct === "number") {
    const v = typeof o?.script_pct === "number" ? o.script_pct : null;
    add("app_pct", String(key.app_pct), v === null ? "" : String(v), v === null ? 0 : near(key.app_pct, v, 8, 15));
  }
  if (key.disclaimers) {
    const tot = o?.compliance_total ?? 0;
    const r = tot ? (o?.compliance_said ?? 0) / tot : null;
    const gv = r === null ? "" : r >= 0.999 ? "all" : r >= 0.5 ? "some" : "few";
    const order = ["few", "some", "all"];
    const d = gv ? Math.abs(order.indexOf(gv) - order.indexOf(key.disclaimers)) : 9;
    add("disclaimers", key.disclaimers, gv, d === 0 ? 1 : d === 1 ? 0.5 : 0);
  }
  if (key.rebuttals) {
    const rb = o?.rebuttals ?? [];
    const good = o?.rebuttals_good ?? 0;
    const gv = !rb.length ? "none" : good / rb.length >= 0.75 ? "good" : good / rb.length >= 0.4 ? "mixed" : "poor";
    const order = ["poor", "mixed", "good"];
    const d = key.rebuttals === "none" || gv === "none" ? (key.rebuttals === gv ? 0 : 9) : Math.abs(order.indexOf(gv) - order.indexOf(key.rebuttals));
    add("rebuttals", key.rebuttals, gv, d === 0 ? 1 : d === 1 ? 0.5 : 0);
  }
  if (key.let_go_early) {
    const gv = o ? (o.let_go_early?.early ? "yes" : "no") : "";
    add("let_go_early", key.let_go_early, gv, key.let_go_early === gv ? 1 : 0);
  }
  if (typeof key.slp === "number") {
    const v = slpScoreOf(g);
    add("slp", String(key.slp), v === null ? "" : String(v), v === null ? 0 : near(key.slp, v, 8, 15));
  }
  return out;
}

/** 0-100: how often the grader agreed with the manager, across every answered item. */
export function agreementOf(items: BenchItem[]): number | null {
  if (!items.length) return null;
  return Math.round((100 * items.reduce((a, b) => a + b.score, 0)) / items.length);
}

/** Which items the key has answers for -- a key with none of these isn't usable yet. */
export function keyIsUsable(k: BenchKey | null | undefined): boolean {
  if (!k) return false;
  return !!(k.outcome || k.ended_why || k.close_quality || k.coach_first?.trim() || k.arc_break || k.hardship || typeof k.product === "number" || typeof k.rep === "number" || typeof k.company === "number" || typeof k.script === "number" || typeof k.slp === "number" || typeof k.app_pct === "number" || !!k.disclaimers || !!k.rebuttals || !!k.let_go_early);
}
