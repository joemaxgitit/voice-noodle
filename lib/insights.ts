/*
  Graduates vs cancels: what was different about the enrollment calls of
  clients who finished the program and those who cancelled.

  Pure functions over grades already stored on each call, so the Insights
  page and the lesson drafter (api/calls/lessons) see exactly the same numbers.
*/
import { ROADMAP, stageLabel, stageTerm, type Grade } from "@/lib/calls";

export type InsightCall = {
  id: string;
  retention: "graduated" | "cancelled";
  score: number | null;
  slp_score: number | null;
  grade: Grade;
};

export type Metric = {
  group: string;
  label: string;
  hint?: string;
  unit: "pct" | "ten" | "score" | "count";
  graduated: number | null;
  cancelled: number | null;
  /** Difference on a 0-100 scale, graduated minus cancelled, for ranking. */
  gap: number | null;
  nGraduated: number;
  nCancelled: number;
};

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function metric(
  group: string,
  label: string,
  unit: Metric["unit"],
  pick: (c: InsightCall) => number | null | undefined,
  calls: InsightCall[],
  hint?: string
): Metric {
  const vals = (r: InsightCall["retention"]) =>
    calls
      .filter((c) => c.retention === r)
      .map(pick)
      .filter((v): v is number => typeof v === "number" && isFinite(v));
  const g = vals("graduated");
  const c = vals("cancelled");
  const ga = avg(g);
  const ca = avg(c);
  const scale = unit === "ten" ? 10 : unit === "count" ? 20 : 1; // count: 1 flag ~ 20 points
  return {
    group,
    label,
    hint,
    unit,
    graduated: ga,
    cancelled: ca,
    gap: ga !== null && ca !== null ? (ga - ca) * scale : null,
    nGraduated: g.length,
    nCancelled: c.length,
  };
}

const landed = (l: string) => (l === "yes" ? 100 : l === "partial" ? 50 : l === "no" ? 0 : null);

export function compare(calls: InsightCall[]): Metric[] {
  const out: Metric[] = [];

  out.push(metric("Scores", "Script score", "score", (c) => c.score, calls));
  out.push(metric("Scores", "Straight Line score", "score", (c) => c.slp_score, calls));

  for (const r of ROADMAP) {
    out.push(
      metric(
        "Emotional roadmap",
        stageLabel(r.stage),
        "pct",
        (c) => {
          const a = c.grade.emotional_arc?.find((x) => x.stage.toLowerCase() === r.stage.toLowerCase());
          return a ? landed(a.landed) : null;
        },
        calls,
        stageTerm(r.stage)
      )
    );
  }

  const skills = new Set<string>();
  for (const c of calls) for (const k of c.grade.slp ?? []) skills.add(k.skill);
  for (const skill of skills) {
    out.push(
      metric(
        "Straight Line skills",
        skill,
        "ten",
        (c) => c.grade.slp?.find((k) => k.skill === skill)?.score ?? null,
        calls
      )
    );
  }

  out.push(metric("Three Tens at the end", "Product certainty", "ten", (c) => c.grade.three_tens?.product, calls));
  out.push(metric("Three Tens at the end", "Rep certainty", "ten", (c) => c.grade.three_tens?.rep, calls));
  out.push(metric("Three Tens at the end", "Company certainty", "ten", (c) => c.grade.three_tens?.company, calls));

  out.push(
    metric(
      "Close and compliance",
      "Solid close",
      "pct",
      (c) => (c.grade.close_quality === "solid" ? 100 : c.grade.close_quality === "fragile" ? 0 : null),
      calls,
      "share of closes the grader called solid"
    )
  );
  out.push(
    metric(
      "Close and compliance",
      "High flags per call",
      "count",
      (c) => (c.grade.flags ?? []).filter((f) => f.severity === "high").length,
      calls,
      "fewer is better"
    )
  );
  out.push(
    metric(
      "Close and compliance",
      "Disclosures done",
      "pct",
      (c) => {
        const reached = (c.grade.compliance ?? []).filter((x) => x.status !== "not_reached");
        return reached.length ? (100 * reached.filter((x) => x.status === "yes").length) / reached.length : null;
      },
      calls
    )
  );
  out.push(
    metric(
      "Tonality",
      "Tones matched",
      "pct",
      (c) => {
        const t = c.grade.tonality?.tone_checks ?? [];
        return t.length ? (100 * t.reduce((s, x) => s + (x.match === "yes" ? 1 : x.match === "partial" ? 0.5 : 0), 0)) / t.length : null;
      },
      calls
    )
  );
  out.push(
    metric(
      "Tonality",
      "Flat stretches per call",
      "count",
      (c) => (c.grade.tonality ? c.grade.tonality.flat_stretches.length : null),
      calls,
      "fewer is better"
    )
  );

  return out;
}

/** "Fewer is better" metrics flip sign so a positive gap always favours graduates. */
export function favouring(m: Metric): number | null {
  if (m.gap === null) return null;
  return m.unit === "count" ? -m.gap : m.gap;
}

export function formatValue(m: Metric, v: number | null): string {
  if (v === null) return "–";
  if (m.unit === "pct") return `${Math.round(v)}%`;
  if (m.unit === "ten") return v.toFixed(1);
  if (m.unit === "count") return v.toFixed(1);
  return String(Math.round(v));
}

/** A compact per-call summary for the lesson drafter -- no transcript. */
export function digest(c: InsightCall): string {
  const g = c.grade;
  const arc = (g.emotional_arc ?? [])
    .filter((a) => a.landed !== "not_reached")
    .map((a) => `${a.stage}=${a.landed}${a.observed ? ` (${a.observed})` : ""}`)
    .join("; ");
  const turns = (g.turning_points ?? []).map((t) => `${t.direction}: ${t.moment}`).join("; ");
  const skills = (g.slp ?? [])
    .filter((k) => typeof k.score === "number")
    .map((k) => `${k.skill} ${k.score}`)
    .join(", ");
  const tens = g.three_tens ? `product ${g.three_tens.product ?? "?"}, rep ${g.three_tens.rep ?? "?"}, company ${g.three_tens.company ?? "?"}` : "";
  const high = (g.flags ?? []).filter((f) => f.severity === "high").map((f) => f.issue).join("; ");
  return [
    `${c.retention.toUpperCase()}: ${g.summary}`,
    `close: ${g.close_quality ?? "?"}${g.close_quality_reason ? ` -- ${g.close_quality_reason}` : ""}`,
    `three tens at the end: ${tens}`,
    `roadmap: ${arc}`,
    `turning points: ${turns}`,
    `skills: ${skills}`,
    high ? `high flags: ${high}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Below this many calls in either group, differences are hints, not findings. */
export const MIN_FOR_FINDINGS = 10;
