import { clock, type Grade } from "@/lib/calls";

export type DigestRow = { id: string; client_label: string | null; call_date: string | null; duration_secs: number | null; slp_score: number | null; score: number | null; grade: Grade | null; retention: string | null; outcome: string | null };

/** A grade in a few dozen lines: what happened, section by section, with times. */
export function digest(c: DigestRow): string {
  const g = c.grade;
  if (!g) return "(not graded)";
  const t = (x: number | null | undefined) => (typeof x === "number" ? clock(x) : "--");
  const h = g.spotlights?.hardship;
  const td = g.spotlights?.turndown;
  return [
    `Length ${clock(c.duration_secs)} · outcome ${c.outcome ?? "?"}${c.retention ? ` · client ${c.retention}` : ""} · SLP ${c.slp_score ?? "--"} · script ${c.score ?? "--"} · close ${g.close_quality ?? "--"}${g.close_quality_reason ? ` (${g.close_quality_reason})` : ""}`,
    `Summary: ${g.summary}`,
    g.three_tens ? `Three Tens: product ${g.three_tens.product ?? "-"}, rep ${g.three_tens.rep ?? "-"}, company ${g.three_tens.company ?? "-"}` : "",
    h ? `Hardship: moved on at ${t(h.moved_on_at)}, score ${h.score ?? "-"}; ${h.read}` : "",
    td?.happened ? `Loan turndown at ${t(td.at)}: pickup ${td.pickup}; ${td.read}` : "",
    g.line_control ? `Staying on the line: ${g.line_control.read}` : "",
    "Sections:",
    ...g.sections.map((s) => `- ${s.section} [${t(s.time)}] ${s.status}: ${s.coaching || s.evidence}`),
    "Emotional roadmap:",
    ...(g.emotional_arc ?? []).map((a) => `- ${a.stage} [${t(a.time)}] landed ${a.landed}: ${a.observed}`),
    "Turning points:",
    ...(g.turning_points ?? []).map((p) => `- [${t(p.time)}] ${p.direction === "toward" ? "toward the sale" : "away from the sale"}: ${p.moment} -- ${p.why}`),
  ]
    .filter(Boolean)
    .join("\n");
}

