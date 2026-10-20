import { NextResponse } from "next/server";
import { requireAdmin, thinkingFor } from "@/lib/callsServer";
import { gradeCostUsd, type Grade } from "@/lib/calls";
import { digest, type InsightCall } from "@/lib/insights";
import { FINGERPRINT_MIN, type Fingerprint } from "@/lib/fingerprint";

export const runtime = "nodejs";
export const maxDuration = 300;

/*
  A rep's own style that works: their proven sales (graduated or 6+
  payments) against their own cancels. Never compared with other reps.
  Straight Line grading stays universal; this is a separate, personal layer.
  About 10-20 cents a run. Body: { repId }.
*/

const MODEL = process.env.REVIEW_MODEL || "claude-sonnet-5-5";
const str = { type: "string" } as const;
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "markers", "watch_outs", "keep_universal", "practice_focus"],
  properties: {
    summary: str,
    markers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["marker", "how_it_sounds", "evidence", "in_proven", "in_cancels"],
        properties: { marker: str, how_it_sounds: str, evidence: str, in_proven: { type: "integer" }, in_cancels: { type: "integer" } },
      },
    },
    watch_outs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["marker", "evidence", "in_proven", "in_cancels"],
        properties: { marker: str, evidence: str, in_proven: { type: "integer" }, in_cancels: { type: "integer" } },
      },
    },
    keep_universal: str,
    practice_focus: str,
  },
} as const;

const INSTRUCTIONS = `You study ONE sales rep's own calls at a debt relief company (Lionside Financial; Straight Line Persuasion). Below are this rep's graded enrollment calls whose clients STUCK (graduated, or made more than 6 payments -- proven sales) and this rep's enrollment calls whose clients CANCELLED.

Find this rep's personal success fingerprint: the specific, repeatable things in HOW THEY run a call that keep showing up in their proven sales and not (or much less) in their cancels. This is about their own style -- humour, storytelling, pace, warmth, how they handle hardship, how they pick a client up after the loan turndown, how they explain the program, how they close. Never judge them against a generic ideal or another rep; a style that works for them is right for them.

- markers: up to 5, strongest first. marker: a short name. how_it_sounds: what it looks like in their calls, concrete. evidence: the dates/moments it came from. in_proven / in_cancels: how many of each group it showed up in -- count honestly.
- watch_outs: up to 3 things that show up in their CANCELS and not their proven sales (their own failure pattern), with the same counts.
- keep_universal: one sentence reminding that the Straight Line fundamentals (roadmap, tonality, three tens, compliance) still apply to them -- name the one fundamental their proven sales do best.
- practice_focus: one or two sentences on how practice should strengthen their style and target their own watch-out.
- summary: two plain sentences for a manager.
Only claim a marker when the counts support it. With few calls, say so in the summary and keep to the clearest one or two.`;

export async function POST(request: Request) {
  const ctx = await requireAdmin(request);
  if (ctx instanceof NextResponse) return ctx;
  const { supabase, orgId, userId } = ctx;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 500 });
  const repId = String(((await request.json().catch(() => ({}))) as { repId?: string }).repId || "");
  if (!repId) return NextResponse.json({ error: "No rep." }, { status: 400 });

  const { data, error } = await supabase
    .from("calls")
    .select("id, retention, score, slp_score, grade, call_date, created_at")
    .eq("rep_id", repId)
    .neq("source", "roleplay")
    .in("retention", ["graduated", "paid6", "cancelled"])
    .not("grade", "is", null)
    .order("created_at", { ascending: false })
    .limit(60);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = (data || []) as (InsightCall & { retention: string; call_date: string | null; created_at: string })[];
  const proven = rows.filter((r) => r.retention !== "cancelled");
  const cancels = rows.filter((r) => r.retention === "cancelled");
  if (proven.length < FINGERPRINT_MIN.proven || cancels.length < FINGERPRINT_MIN.cancelled)
    return NextResponse.json({ error: `Not enough yet: ${proven.length} proven sale${proven.length === 1 ? "" : "s"} and ${cancels.length} cancel${cancels.length === 1 ? "" : "s"} for this rep. It needs at least ${FINGERPRINT_MIN.proven} and ${FINGERPRINT_MIN.cancelled}.` }, { status: 400 });

  const block = (r: (typeof rows)[number]) => {
    const g = r.grade as Grade;
    const sp = g.spotlights;
    return [
      `${r.call_date || r.created_at.slice(0, 10)} | ${r.retention === "cancelled" ? "CANCELLED" : r.retention === "graduated" ? "PROVEN (graduated)" : "PROVEN (6+ payments)"}`,
      digest({ ...r, retention: r.retention === "cancelled" ? "cancelled" : "graduated" } as InsightCall),
      g.strengths?.length ? `strengths: ${g.strengths.join("; ")}` : "",
      g.tonality?.summary ? `tonality: ${g.tonality.summary}` : "",
      sp?.hardship ? `hardship: ${sp.hardship.read}` : "",
      sp?.turndown?.happened ? `after the loan turndown: ${sp.turndown.read}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  };
  const text = `<proven_sales>\n${proven.slice(0, 15).map(block).join("\n\n")}\n</proven_sales>\n\n<cancelled>\n${cancels.slice(0, 12).map(block).join("\n\n")}\n</cancelled>`;

  const res = await fetch(`${process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com"}/v1/messages`, {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 6000,
      ...thinkingFor(MODEL),
      output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content: [{ type: "text", text: INSTRUCTIONS }, { type: "text", text }] }],
    }),
    signal: AbortSignal.timeout(280_000),
  });
  if (!res.ok) return NextResponse.json({ error: `Couldn't read this rep's style (${res.status}). ${(await res.text().catch(() => "")).slice(0, 200)}` }, { status: 500 });
  const out = (await res.json()) as { content?: { type: string; text?: string }[]; usage?: Record<string, number> };
  const raw = (out.content || []).filter((c) => c.type === "text").map((c) => c.text || "").join("");
  let body: Fingerprint;
  try {
    body = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as Fingerprint;
  } catch {
    return NextResponse.json({ error: "The result came back unreadable. Try again." }, { status: 500 });
  }
  const usd = gradeCostUsd(MODEL, out.usage ?? {});
  const { error: insErr } = await supabase.from("rep_fingerprints").insert({
    org_id: orgId,
    rep_id: repId,
    created_by: userId,
    inputs: { proven: proven.length, cancelled: cancels.length },
    body,
    model: MODEL,
    usd,
  });
  if (insErr) return NextResponse.json({ error: /rep_fingerprints|does not exist/i.test(insErr.message) ? "Run supabase/rep-fingerprint.sql first." : insErr.message }, { status: 500 });
  return NextResponse.json({ ok: true, usd });
}
