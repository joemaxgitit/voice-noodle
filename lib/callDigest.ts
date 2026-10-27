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
    g.ended?.early ? `Ended early (${g.ended.why.replace(/_/g, " ")}, handled ${g.ended.handled}): ${g.ended.read}` : "",
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


/**
 * The "Not right?" corrections a manager made to each call's current grade,
 * as a block to put under that call: they override what the grader said.
 * Corrections to an earlier grade of the call (before a re-grade) are left out.
 */
export async function correctionsFor(
  supabase: { from: (t: string) => any }, // eslint-disable-line @typescript-eslint/no-explicit-any
  calls: { id: string; graded_at?: string | null }[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = calls.map((c) => c.id);
  if (!ids.length) return out;
  const { data } = await supabase.from("call_corrections").select("call_id, item_key, item_kind, item_label, original, correction").in("call_id", ids.slice(0, 300));
  const at = new Map(calls.map((c) => [c.id, c.graded_at ?? null]));
  type F = { call_id: string; item_key: string; item_kind: string; item_label: string | null; original: string; correction: string };
  const by = new Map<string, F[]>();
  for (const f of (data || []) as F[]) {
    const g = at.get(f.call_id);
    if (g && !f.item_key.startsWith(`${g}|`)) continue;
    by.set(f.call_id, [...(by.get(f.call_id) ?? []), f]);
  }
  for (const [id, fs] of by)
    out.set(
      id,
      `MANAGER CORRECTIONS to this grade (they override what the grader said):\n` +
        fs.map((f) => `- [${f.item_kind}${f.item_label ? `: ${f.item_label}` : ""}] the grader said "${String(f.original).slice(0, 200)}" -- the manager says: "${String(f.correction).slice(0, 400)}"`).join("\n")
    );
  return out;
}
