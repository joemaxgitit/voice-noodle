/*
  The rep's "next best move": the one script section most likely to lift them
  overall, found from where they score lowest across their graded calls (real
  and practice) and their script drills. Plus a weekly practice-call goal that
  grows with how much there is to work on. Nothing here is compared with any
  other rep.
*/

import { callAt } from "@/lib/calls";

export type MoveModule = { id: string; title: string; script_id: string; kind: string; language: string; sort_order: number; segments: { id: string }[] };
export type MoveCall = {
  source: string | null;
  created_at: string;
  call_date?: string | null;
  sections: { section: string; status: string }[] | null;
  slp_score: number | null;
  hardship_at: number | null;
  followup_kind: string | null;
};
export type MoveAttempt = { segment_id: string; created_at: string; scores: { pace?: number; clarity?: number } | null };

export type SectionRead = { module: MoveModule; call: number | null; calls: number; drill: number | null; drills: number; combined: number };

export type NextMove = {
  module: MoveModule | null;
  why: string;
  /** Weakest first. */
  sections: SectionRead[];
  /** Practice calls to aim for this week. */
  goal: number;
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z0-9áéíóúñ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Does a grade's section name belong to this module? Grades name sections by the module's title. */
const matches = (section: string, title: string) => {
  const a = norm(section);
  const b = norm(title);
  return !!a && !!b && (a === b || a.startsWith(b) || b.startsWith(a));
};

const POINTS: Record<string, number> = { hit: 1, partial: 0.5, missed: 0 };

export function nextMove(modules: MoveModule[], calls: MoveCall[], attempts: MoveAttempt[], lang: "en" | "es"): NextMove {
  const mods = modules.filter((m) => (m.language || "en") === lang && m.kind !== "loop" && (m.segments?.length ?? 0) > 0).sort((a, b) => a.sort_order - b.sort_order);
  const recent = [...calls].sort((a, b) => callAt(b) - callAt(a)).slice(0, 12);
  const segToMod = new Map<string, MoveModule>();
  for (const m of mods) for (const s of m.segments) segToMod.set(s.id, m);
  const recentAttempts = [...attempts].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 80);

  // Short hardship on first calls: lean the pick toward the hardship section.
  const hs = recent.filter((c) => c.followup_kind !== "followup" && typeof c.hardship_at === "number" && c.hardship_at > 0).map((c) => c.hardship_at as number);
  const shortHardship = hs.length >= 2 && hs.reduce((a, b) => a + b, 0) / hs.length < 5 * 60;

  // Grades name sections by their English title; a Spanish section's English twin sits at the same place in the same script.
  const twin = new Map<string, string>();
  if (lang === "es") {
    const seq = (lg: string, sid: string) => modules.filter((m) => m.script_id === sid && (m.language || "en") === lg && m.kind !== "loop").sort((a, b) => a.sort_order - b.sort_order);
    for (const sid of new Set(mods.map((m) => m.script_id))) {
      const es = seq("es", sid);
      const en = seq("en", sid);
      if (es.length === en.length) es.forEach((m, i) => twin.set(m.id, en[i].title));
    }
  }
  const reads: SectionRead[] = mods.map((m) => {
    const pts: number[] = [];
    const alt = twin.get(m.id);
    for (const c of recent) for (const s of c.sections ?? []) if (s.status in POINTS && (matches(s.section, m.title) || (!!alt && matches(s.section, alt)))) pts.push(POINTS[s.status]);
    const drills = recentAttempts.filter((a) => segToMod.get(a.segment_id)?.id === m.id && a.scores);
    const drillScores = drills.map((a) => ((a.scores!.pace ?? 0) + (a.scores!.clarity ?? 0)) / 2);
    const call = pts.length ? Math.round((100 * pts.reduce((a, b) => a + b, 0)) / pts.length) : null;
    const drill = drillScores.length ? Math.round(drillScores.reduce((a, b) => a + b, 0) / drillScores.length) : null;
    let combined = call !== null && drill !== null ? 0.65 * call + 0.35 * drill : call ?? drill ?? 101;
    if (shortHardship && /hardship|dificultad|situaci/i.test(m.title)) combined *= 0.8;
    return { module: m, call, calls: pts.length, drill, drills: drillScores.length, combined };
  });

  // Only sections with real evidence compete; earlier sections win ties (they set up everything after).
  const scored = reads.filter((r) => r.calls >= 2 || r.drills >= 3).sort((a, b) => a.combined - b.combined || a.module.sort_order - b.module.sort_order);
  const pick = scored[0] ?? null;

  const slp = recent.map((c) => c.slp_score).filter((n): n is number => typeof n === "number");
  const avgSlp = slp.length ? slp.reduce((a, b) => a + b, 0) / slp.length : null;
  let goal = 2;
  if (pick && pick.combined < 50) goal++;
  if (avgSlp !== null && avgSlp < 60) goal++;
  goal = Math.min(4, goal);

  let why = "";
  if (pick) {
    const parts = [
      pick.call !== null ? `${pick.call}% on your last ${pick.calls} call${pick.calls === 1 ? "" : "s"}` : "",
      pick.drill !== null ? `${pick.drill} in your drills` : "",
    ].filter(Boolean);
    why = `Your lowest section right now${parts.length ? `: ${parts.join(" · ")}` : ""}.${shortHardship && /hardship/i.test(pick.module.title) ? " You're also moving off hardship early -- stay with the client longer." : ""}`;
  }
  return { module: pick?.module ?? null, why, sections: scored, goal };
}

/** Monday 00:00 local, for "this week". */
export function weekStart(now = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}
