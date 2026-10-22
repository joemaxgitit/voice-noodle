import { NextResponse, after } from "next/server";
import { requireAdmin, thinkingFor } from "@/lib/callsServer";
import { gradeCostUsd, type Grade } from "@/lib/calls";
import { clientKey, numbered, type JourneyCall } from "@/lib/journey";

export const runtime = "nodejs";
export const maxDuration = 300;

/*
  One read of a client's whole journey across their calls: what carried
  over well between calls (bridges), what broke (disconnects), and what
  decided it. Runs by itself whenever a call in a journey of 2+ is graded.
  About 5 cents. Body: { clientLabel }.
*/

const MODEL = process.env.REVIEW_MODEL || "claude-sonnet-5-5";
const str = { type: "string" } as const;
const item = {
  type: "object",
  additionalProperties: false,
  required: ["what", "calls", "evidence"],
  properties: { what: str, calls: str, evidence: str },
} as const;
const RENEW = {
  type: "object",
  additionalProperties: false,
  required: ["applies", "first_stall", "really", "what_moved", "lesson"],
  properties: { applies: { type: "boolean" }, first_stall: str, really: str, what_moved: str, lesson: str },
} as const;
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["story", "bridges", "disconnects", "decided_it", "next_move", "renew"],
  properties: { story: str, bridges: { type: "array", items: item }, disconnects: { type: "array", items: item }, decided_it: str, next_move: str, renew: RENEW },
} as const;

/** A renew: the same client, called again months later (often by another rep). The second chance shows what the first call missed. */
export type RenewRead = {
  applies: boolean;
  first_stall: string;
  really: string;
  what_moved: string;
  lesson: string;
  /** Filled in by the app, not the model. */
  first_rep_id?: string | null;
  renew_rep_id?: string | null;
  renew_outcome?: string | null;
  same_rep?: boolean;
};
export type JourneyRead = { story: string; bridges: { what: string; calls: string; evidence: string }[]; disconnects: { what: string; calls: string; evidence: string }[]; decided_it: string; next_move: string; renew?: RenewRead };

export async function POST(request: Request) {
  const ctx = await requireAdmin(request);
  if (ctx instanceof NextResponse) return ctx;
  const { supabase, orgId } = ctx;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 500 });
  const body = (await request.json().catch(() => ({}))) as { clientLabel?: string; background?: boolean };
  const label = String(body.clientLabel || "").trim();
  if (!label) return NextResponse.json({ error: "No client ID." }, { status: 400 });
  if (body.background) {
    after(() => readJourney(supabase, orgId, key, label).then(() => undefined));
    return NextResponse.json({ ok: true }, { status: 202 });
  }
  const r = await readJourney(supabase, orgId, key, label);
  return NextResponse.json(r.body, { status: r.status });
}

async function readJourney(supabase: Awaited<ReturnType<typeof requireAdmin>> extends infer T ? (T extends { supabase: infer S } ? S : never) : never, orgId: string, key: string, label: string): Promise<{ status: number; body: Record<string, unknown> }> {

  const { data, error } = await supabase
    .from("calls")
    .select("id, client_label, call_date, call_time, created_at, rep_id, rep_name, status, outcome, outcome_manual, retention, score, slp_score, grade, scripts(title), profiles:rep_id(full_name)")
    .ilike("client_label", label)
    .neq("source", "roleplay");
  if (error) return { status: 500, body: { error: error.message } };
  const nums = await supabase.from("calls").select("id, call_number, handoff").ilike("client_label", label);
  const num = new Map(((nums.data || []) as { id: string; call_number: number | null; handoff: string | null }[]).map((x) => [x.id, x]));
  type Row = JourneyCall & { grade: Grade | null; rep_name: string | null; scripts: { title: string } | null; profiles: { full_name: string | null } | null };
  const rows = ((data || []) as unknown as Row[]).map((r) => ({ ...r, call_number: num.get(r.id)?.call_number ?? null, handoff: num.get(r.id)?.handoff ?? null, script_title: r.scripts?.title ?? null }));
  const graded = numbered(rows).filter((r) => r.status === "graded" && r.grade);
  if (graded.length < 2) return { status: 200, body: { skipped: "fewer than two graded calls" } };

  const text = graded
    .map((c) => {
      const g = c.grade!;
      const f = g.spotlights?.followup;
      return [
        `CALL ${c.n} | ${c.call_date || c.created_at.slice(0, 10)} | rep: ${c.profiles?.full_name || c.rep_name || "?"}${c.handoff === "renew" || /renew/i.test(c.script_title || "") ? " (RENEW)" : ""} | outcome: ${c.outcome_manual || c.outcome || "?"}${c.retention ? ` | client later: ${c.retention}` : ""} | script ${c.score ?? "--"}, Straight Line ${c.slp_score ?? "--"}`,
        `summary: ${g.summary}`,
        `ended: ${g.furthest_point}`,
        g.spotlights?.hardship?.read ? `hardship: ${g.spotlights.hardship.read}` : "",
        g.spotlights?.turndown?.happened ? `turndown: ${g.spotlights.turndown.read}` : "",
        f ? `follow-up: ${f.read}${f.stall_stated ? ` | client said "${f.stall_stated}"${f.stall_real ? ` (really: ${f.stall_real})` : ""}, got to the bottom: ${f.got_to_bottom}, next step: ${f.next_step} ${f.next_step_detail}` : ""}${f.reopen ? ` | opened with: ${f.reopen}` : ""}` : "",
        (g.turning_points ?? []).length ? `turning points: ${(g.turning_points ?? []).map((t) => `${t.direction}: ${t.moment}`).join("; ")}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  const res = await fetch(`${process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com"}/v1/messages`, {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      ...thinkingFor(MODEL),
      output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA } },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Read one debt-relief client's whole sales journey across these calls as ONE continuous story (Straight Line Persuasion; more than half of this team's enrollments take more than one call). story: 2-3 plain sentences. bridges: up to 4 things that carried over WELL between calls (the rep recapped the client's pain from an earlier call, followed through on the next step that was set, handled the earlier stall, built on certainty from before) -- what, calls ("1->2"), evidence. disconnects: up to 4 things that BROKE between calls (forgot what the client said, the same stall came back unaddressed, a promise or number changed, the next step was vague, a renew rep didn't know the history, pain and certainty weren't rebuilt) -- same fields. decided_it: the moment the journey turned, toward a yes or toward going cold, in one sentence. next_move: if the journey is still open, the single best next move for the rep on the next call; if it closed, what to repeat next time. Be specific and honest; if the record is thin, say so.
renew: only when a call marked (RENEW) follows an earlier call that did not enroll -- the same client reached again later, often by a different rep. Set applies true and fill: first_stall -- why the earlier call didn't close, as the client put it then; really -- what was really underneath it, as the renew call revealed; what_moved -- the specific thing the renew rep did that the earlier call didn't (or, if the renew didn't close either, what still stood in the way); lesson -- one plain coaching line for the rep who took the earlier call, about what to do differently on calls like it. Never use the client's name in these. With no renew in the journey: applies false and the four strings "".`,
            },
            { type: "text", text },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(280_000),
  });
  if (!res.ok) return { status: 500, body: { error: `Journey read failed (${res.status}). ${(await res.text().catch(() => "")).slice(0, 200)}` } };
  const out = (await res.json()) as { content?: { type: string; text?: string }[]; usage?: Record<string, number> };
  const raw = (out.content || []).filter((c) => c.type === "text").map((c) => c.text || "").join("");
  let read: JourneyRead;
  try {
    read = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as JourneyRead;
  } catch {
    return { status: 500, body: { error: "The journey read came back unreadable." } };
  }
  // Who took the first call and who took the renew, for coaching and the team view.
  if (read.renew?.applies) {
    const isRenew = (c: (typeof graded)[number]) => c.handoff === "renew" || /renew/i.test(c.script_title || "");
    const ri = graded.findIndex(isRenew);
    const renewCall = ri >= 0 ? graded[ri] : null;
    const first = ri > 0 ? graded.slice(0, ri).reverse().find((c) => !isRenew(c)) ?? null : null;
    if (renewCall && first) {
      read.renew.first_rep_id = first.rep_id ?? null;
      read.renew.renew_rep_id = renewCall.rep_id ?? null;
      read.renew.renew_outcome = renewCall.outcome_manual || renewCall.outcome || null;
      read.renew.same_rep = !!first.rep_id && first.rep_id === renewCall.rep_id;
    } else read.renew.applies = false;
  }
  const usd = gradeCostUsd(MODEL, out.usage ?? {});
  const { error: upErr } = await supabase
    .from("client_journeys")
    .upsert({ org_id: orgId, client_key: clientKey(label), read, calls_read: graded.length, model: MODEL, usd, updated_at: new Date().toISOString() }, { onConflict: "org_id,client_key" });
  if (upErr) return { status: 500, body: { error: /client_journeys|does not exist/i.test(upErr.message) ? "Run supabase/follow-ups.sql first." : upErr.message } };
  return { status: 200, body: { ok: true, usd } };
}
