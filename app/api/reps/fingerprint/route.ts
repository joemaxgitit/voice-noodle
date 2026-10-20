import { NextResponse } from "next/server";
import { requireAdmin, thinkingFor } from "@/lib/callsServer";
import { gradeCostUsd, type Grade } from "@/lib/calls";
import { digest, type InsightCall } from "@/lib/insights";
import { EXPERIMENT_FAIR_TRY, FINGERPRINT_MIN, type Experiment, type Fingerprint, type TeamPattern } from "@/lib/fingerprint";

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
  required: ["summary", "markers", "watch_outs", "keep_universal", "practice_focus", "try_next", "experiment_checks"],
  properties: {
    try_next: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["pattern", "why_fits", "how_to_try"],
        properties: { pattern: str, why_fits: str, how_to_try: str },
      },
    },
    experiment_checks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "showing_in", "of", "effect", "verdict", "note"],
        properties: {
          id: str,
          showing_in: { type: "integer" },
          of: { type: "integer" },
          effect: { type: "string", enum: ["helping", "no_change", "hurting", "too_early"] },
          verdict: { type: "string", enum: ["keep_trying", "kept", "dropped"] },
          note: str,
        },
      },
    },
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
Only claim a marker when the counts support it. With few calls, say so in the summary and keep to the clearest one or two.

Experiments (a small stretch, never a style change):
- experiment_checks: for each experiment the rep is currently trying (listed below with its start date), look at their recent calls since it started: showing_in = in how many of those calls they actually did it, of = how many calls since it started, effect = whether calls where they did it went better (enrollments, clients staying warm, the roadmap landing) than calls where they didn't -- "too_early" if there's too little to tell. verdict: "kept" if it has clearly become part of how they sell and it's helping; "dropped" if after a fair try (about ${EXPERIMENT_FAIR_TRY}+ calls) it doesn't fit them or isn't helping; otherwise "keep_trying". note: one plain sentence.
- try_next: 0 to 2 team-proven patterns (from the list below) for this rep to try next -- only ones that are NOT already part of their own style and that sit closest to how they already sell (a warm storyteller gets a story-based pattern, not a rapid-fire one). Suggest as many as their calls genuinely support, which may be none. why_fits: one sentence tying it to their style. how_to_try: one or two sentences on doing it in their own words. Never suggest anything that would cut against their own markers.`;

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
    .select("id, retention, score, slp_score, grade, call_date, created_at, client_label")
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
  // Team-proven patterns, this rep's current experiments, and their calls since those started.
  const [tp, ex] = await Promise.all([
    supabase.from("team_patterns").select("body").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("rep_experiments").select("*").eq("rep_id", repId).eq("status", "trying"),
  ]);
  const team = ((tp.data?.body as { patterns?: TeamPattern[] } | null)?.patterns ?? []).filter((p) => !p.reps.includes(repId));
  const active = (ex.data || []) as Experiment[];
  let recent = "";
  if (active.length) {
    const since = active.map((e) => e.started_at).sort()[0];
    const { data: rc } = await supabase
      .from("calls")
      .select("id, retention, score, slp_score, grade, call_date, created_at, outcome, outcome_manual")
      .eq("rep_id", repId)
      .neq("source", "roleplay")
      .eq("status", "graded")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(15);
    recent = ((rc || []) as (InsightCall & { call_date: string | null; created_at: string; outcome: string | null; outcome_manual: string | null })[])
      .map((r) => `${r.call_date || r.created_at.slice(0, 10)} | outcome: ${r.outcome_manual || r.outcome || "?"}\n${digest({ ...r, retention: "graduated" } as InsightCall).replace(/^GRADUATED: /, "")}`)
      .join("\n\n");
  }
  // Whole-journey reads for this rep's clients: how they bridge calls, and where it breaks.
  const labels = [...new Set(rows.map((r) => ((r as unknown as { client_label?: string | null }).client_label || "").trim().toLowerCase()).filter(Boolean))];
  const jr = labels.length ? await supabase.from("client_journeys").select("client_key, read").in("client_key", labels) : { data: [] };
  const journeys = ((jr.data || []) as { client_key: string; read: { story?: string; bridges?: { what: string }[]; disconnects?: { what: string }[] } }[])
    .map((j) => `- ${j.read.story ?? ""} Bridges: ${(j.read.bridges ?? []).map((b) => b.what).join("; ") || "none"}. Disconnects: ${(j.read.disconnects ?? []).map((b) => b.what).join("; ") || "none"}.`)
    .slice(0, 10);
  const extra = [
    journeys.length ? `<their_multi_call_journeys>\n${journeys.join("\n")}\nUse these too: how this rep carries a client across calls is part of their style.\n</their_multi_call_journeys>` : "",
    team.length ? `<team_patterns>\n${team.map((p) => `- ${p.pattern}: ${p.how_it_sounds} (works for ${p.reps.length} reps)`).join("\n")}\n</team_patterns>` : "<team_patterns>(none found yet -- try_next must be empty)</team_patterns>",
    active.length ? `<current_experiments>\n${active.map((e) => `- id ${e.id}: ${e.pattern} -- started ${e.started_at.slice(0, 10)}. ${e.how_to_try ?? ""}`).join("\n")}\n</current_experiments>\n<recent_calls>\n${recent || "(no graded calls since they started)"}\n</recent_calls>` : "<current_experiments>(none)</current_experiments>",
  ].join("\n\n");
  const text = `<proven_sales>\n${proven.slice(0, 15).map(block).join("\n\n")}\n</proven_sales>\n\n<cancelled>\n${cancels.slice(0, 12).map(block).join("\n\n")}\n</cancelled>\n\n${extra}`;

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

  // Experiments: apply the checks, then start the suggested ones (the app suggests; managers can drop or keep any).
  const now = new Date().toISOString();
  let stillTrying = active.length;
  for (const c of body.experiment_checks ?? []) {
    const e = active.find((x) => x.id === c.id);
    if (!e) continue;
    const done = c.verdict !== "keep_trying" && c.of >= EXPERIMENT_FAIR_TRY;
    await supabase
      .from("rep_experiments")
      .update({
        last_check: { showing_in: c.showing_in, of: c.of, effect: c.effect, note: c.note, at: now },
        ...(done ? { status: c.verdict, ended_at: now } : {}),
      })
      .eq("id", e.id);
    if (done) stillTrying--;
  }
  if (stillTrying === 0) {
    for (const t of (body.try_next ?? []).slice(0, 2)) {
      await supabase.from("rep_experiments").insert({ org_id: orgId, rep_id: repId, pattern: t.pattern, how_to_try: t.how_to_try, why_fits: t.why_fits });
    }
  }
  return NextResponse.json({ ok: true, usd });
}
