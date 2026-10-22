import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/callsServer";
import { clock, gradeCostUsd, type Grade } from "@/lib/calls";
import { logSpend } from "@/lib/spendServer";
import { plainWords } from "@/lib/plain";

export const runtime = "nodejs";
export const maxDuration = 120;

const MODEL = process.env.GRADER_MODEL || "claude-sonnet-5-5";

type Row = { id: string; client_label: string | null; call_date: string | null; duration_secs: number | null; slp_score: number | null; score: number | null; grade: Grade | null; retention: string | null; outcome: string | null };

/** A grade in a few dozen lines: what happened, section by section, with times. */
function digest(c: Row): string {
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

/**
 * "What's the difference?" -- where call B went off compared with call A
 * (usually the rep's best call), in plain words with the times on both.
 */
export async function POST(request: Request) {
  const ctx = await requireAdmin(request);
  if (ctx instanceof NextResponse) return ctx;
  const { supabase, orgId, userId } = ctx;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 500 });
  const { a, b } = (await request.json().catch(() => ({}))) as { a?: string; b?: string };
  if (!a || !b) return NextResponse.json({ error: "Two calls are needed." }, { status: 400 });
  const { data, error } = await supabase.from("calls").select("id, client_label, call_date, duration_secs, slp_score, score, grade, retention, outcome").in("id", [a, b]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const A = (data || []).find((x) => x.id === a) as Row | undefined;
  const B = (data || []).find((x) => x.id === b) as Row | undefined;
  if (!A?.grade || !B?.grade) return NextResponse.json({ error: "Both calls need a grade first." }, { status: 400 });

  const prompt = `A sales manager at a debt-relief company is comparing two graded calls by the same sales rep. Call A is the model -- usually the rep's own best call. Call B is the one being coached. Both were graded against the company script and Jordan Belfort's Straight Line method.

<call_a>
${digest(A)}
</call_a>

<call_b>
${digest(B)}
</call_b>

Write what call B is missing compared with call A, so the manager can coach it in a few minutes:
- 3 to 6 short points, most important first. Each one: what A did, what B did instead, and the time on each call in square brackets, like "[A 9:40]" and "[B 4:15]", so the manager can play both moments.
- Then one line starting "Biggest single fix:".
Rules: plain English, no jargon or shorthand, no client names, no scores restated as the point itself. If B was a different kind of call (a callback, a hang-up before the pitch), say so and compare only what both calls reached. Plain text only: each point on its own line starting with "- ".`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 1500, messages: [{ role: "user", content: prompt }] }),
    signal: AbortSignal.timeout(100_000),
  });
  if (!res.ok) {
    const raw = await res.text().catch(() => "");
    let message = raw.slice(0, 300);
    try {
      message = JSON.parse(raw)?.error?.message || message;
    } catch {
      // not JSON
    }
    return NextResponse.json({ error: `Comparison failed (${res.status}). ${message}` }, { status: 502 });
  }
  const out = (await res.json()) as { content?: { type: string; text?: string }[]; usage?: Record<string, number> };
  const text = plainWords((out.content || []).filter((c) => c.type === "text").map((c) => c.text || "").join("").trim());
  const cost = gradeCostUsd(MODEL, out.usage ?? {});
  if (cost) await logSpend(supabase, { org_id: orgId, kind: "compare", usd: cost, user_id: userId, ref_id: b });
  return NextResponse.json({ text, cost });
}
