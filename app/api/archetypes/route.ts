import { NextResponse, after } from "next/server";
import { jsonrepair } from "jsonrepair";
import { requireAdmin, thinkingFor } from "@/lib/callsServer";
import { gradeCostUsd } from "@/lib/calls";
import type { ClientInsight } from "@/lib/learn";
import { logSpend } from "@/lib/spendServer";

export const runtime = "nodejs";
export const maxDuration = 300;

/*
  Groups the real clients the app has learned from into the 6-8 archetypes
  that actually show up, through the Straight Line lens. Saved as a draft for
  a manager to approve; approved archetypes build and mix the practice
  clients. Anonymous: it only ever sees the learned profiles, never names.
  About 10-30 cents a run.
*/

const MODEL = process.env.REVIEW_MODEL || "claude-sonnet-5-5";
const str = { type: "string" } as const;
const ARCH = {
  type: "object",
  additionalProperties: false,
  required: [
    "name", "clients", "summary", "spot_it", "buyer_type", "action_threshold", "pain_awareness", "weakest_ten", "core_belief",
    "openness", "pluto", "decision", "layers", "sounds_like", "what_closes", "what_loses", "results", "confidence",
  ],
  properties: {
    name: str,
    clients: { type: "number" },
    summary: str,
    spot_it: str,
    buyer_type: str,
    action_threshold: str,
    pain_awareness: str,
    weakest_ten: str,
    core_belief: str,
    openness: str,
    pluto: str,
    decision: str,
    layers: {
      type: "object",
      additionalProperties: false,
      required: ["facts", "cause", "impact", "feelings", "future"],
      properties: { facts: str, cause: str, impact: str, feelings: str, future: str },
    },
    sounds_like: { type: "array", items: str },
    what_closes: str,
    what_loses: str,
    results: str,
    confidence: str,
  },
} as const;
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["archetypes", "notes"],
  properties: { archetypes: { type: "array", items: ARCH }, notes: str },
} as const;

export type Archetype = {
  name: string;
  clients: number;
  summary: string;
  spot_it: string;
  buyer_type: string;
  action_threshold: string;
  pain_awareness: string;
  weakest_ten: string;
  core_belief: string;
  openness: string;
  pluto: string;
  decision: string;
  layers: { facts: string; cause: string; impact: string; feelings: string; future: string };
  sounds_like: string[];
  what_closes: string;
  what_loses: string;
  results: string;
  confidence: string;
};

const INSTRUCTIONS = `You are helping a debt-relief sales manager who trains reps on Jordan Belfort's Straight Line Persuasion. Below are anonymous profiles of real clients from recorded calls, each with a Straight Line read: buyer type (in heat / in power / lookie-loo), action threshold (how much certainty across the Three Tens -- product, rep, company -- they needed before acting), pain awareness (felt it vs denial), which Ten started weakest, the core belief behind their hesitation, openness, how they pulled the call off the line ("to Pluto"), the hardship layers they revealed, what closed them, and how the sale turned out (enrolled; later graduated or made 6+ payments = proven; cancelled).

Group these clients into the 6-8 archetypes that genuinely recur here -- fewer if the evidence only supports fewer. An archetype is a recurring combination of those Straight Line traits, not a demographic. For each:
- name: short and memorable, the way a sales floor would say it ("The Proud Payer", "Burned Before").
- clients: how many of the profiles below fit it best (each profile in exactly one archetype).
- summary: two plain sentences.
- spot_it: how a rep can tell in the first few minutes they're talking to this archetype.
- buyer_type, action_threshold, pain_awareness, weakest_ten, core_belief, openness, pluto, decision (who decides and how): the typical value for this archetype, in a few words.
- layers: what this kind of client typically reveals at each hardship layer -- facts, cause, impact, feelings, future -- and what it takes from the rep to get to the next one.
- sounds_like: 2-4 typical lines in their own words, anonymized, paraphrased from the profiles (English).
- what_closes: what actually moved this archetype to yes on these calls -- specific to the Straight Line (which Ten to raise, which loop, how to lower the action threshold, how to amplify the pain).
- what_loses: what reps did that lost them or led to a cancel.
- results: how these clients turned out, from the data (e.g. "5 enrolled, 3 proven, 1 cancelled").
- confidence: "solid" if 5+ clients back it, "thin" otherwise.
notes: one or two sentences on how much evidence there is and what would sharpen the picture.
Never use a name, place or exact number that could identify a client. Write for a sales manager in plain words: no statistics shorthand like "n=2" -- say "from 2 clients". Return the JSON only.`;

type Db = Awaited<ReturnType<typeof requireAdmin>> extends infer T ? (T extends { supabase: infer S } ? S : never) : never;

export async function POST(request: Request) {
  const ctx = await requireAdmin(request);
  if (ctx instanceof NextResponse) return ctx;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 500 });
  const body = (await request.json().catch(() => ({}))) as { background?: boolean };
  if (body.background) {
    after(() => draft(ctx.supabase, ctx.orgId, ctx.userId, key).then(() => undefined));
    return NextResponse.json({ ok: true }, { status: 202 });
  }
  const r = await draft(ctx.supabase, ctx.orgId, ctx.userId, key);
  return NextResponse.json(r.body, { status: r.status });
}

async function draft(supabase: Db, orgId: string, userId: string, key: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const { data, error } = await supabase
    .from("client_insights")
    .select("id, call_id, lang, kind, outcome, profile, objections, moments, ending, created_at, calls(retention)")
    .neq("kind", "skip")
    .order("created_at", { ascending: false })
    .limit(400);
  if (error) return { status: 500, body: { error: error.message } };
  const rows = (data || []) as unknown as ClientInsight[];
  if (rows.length < 5) return { status: 400, body: { error: `Archetypes need at least 5 learned real calls -- there ${rows.length === 1 ? "is" : "are"} ${rows.length} so far.` } };

  const res = (r: ClientInsight) => r.calls?.retention ?? "";
  const text = rows
    .map((r, i) => {
      const p = r.profile || {};
      const lines = [
        `<client n="${i + 1}" lang="${r.lang}" call="${r.kind}" outcome="${r.outcome ?? "?"}"${res(r) ? ` later="${res(r)}"` : ""}>`,
        `situation: ${p.situation ?? ""} | hardship: ${p.hardship ?? ""} | personality: ${p.personality ?? ""} | decision: ${p.decision ?? ""} | wanted: ${p.wanted ?? ""}`,
        p.buyer_type ? `straight line: buyer ${p.buyer_type}; threshold ${p.action_threshold}; pain ${p.pain_awareness}; weakest ten ${p.weakest_ten}, hardest ${p.hardest_ten}; belief "${p.core_belief}"; openness ${p.openness}; pluto: ${p.pluto}` : "",
        p.hardship_layers ? `hardship layers: ${p.hardship_layers}` : p.opened_up ? `opened up: ${p.opened_up}` : "",
        p.stall_stated ? `stall: "${p.stall_stated}" (really: ${p.stall_real}; moved by: ${p.stall_moved})` : "",
        (r.objections || []).length ? `objections: ${(r.objections || []).map((o) => `${o.type}: "${o.quote}"${o.handled ? " (handled)" : ""}`).join("; ")}` : "",
        p.what_closed ? `what closed / stood in the way: ${p.what_closed}` : "",
        r.ending?.how ? `ended: ${r.ending.how}${r.ending.trigger ? ` after: ${r.ending.trigger}` : ""}` : "",
        "</client>",
      ];
      return lines.filter(Boolean).join("\n");
    })
    .join("\n");

  const resp = await fetch(`${process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com"}/v1/messages`, {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 12000,
      ...thinkingFor(MODEL),
      output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content: [{ type: "text", text: INSTRUCTIONS }, { type: "text", text }] }],
    }),
    signal: AbortSignal.timeout(280_000),
  });
  if (!resp.ok) return { status: 500, body: { error: `Grouping failed (${resp.status}). ${(await resp.text().catch(() => "")).slice(0, 200)}` } };
  const out = (await resp.json()) as { content?: { type: string; text?: string }[]; usage?: Record<string, number> };
  const raw = (out.content || []).filter((c) => c.type === "text").map((c) => c.text || "").join("");
  let body: { archetypes: Archetype[]; notes: string };
  try {
    body = JSON.parse(jsonrepair(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)));
  } catch {
    return { status: 500, body: { error: "The grouping came back unreadable." } };
  }
  const usd = gradeCostUsd(MODEL, out.usage ?? {});
  const proven = rows.filter((r) => ["graduated", "paid6"].includes(res(r))).length;
  const cancelled = rows.filter((r) => res(r) === "cancelled").length;
  const ins = await supabase
    .from("client_archetypes")
    .insert({ org_id: orgId, created_by: userId, status: "draft", body, inputs: { clients: rows.length, proven, cancelled, straight_line: rows.filter((r) => r.profile?.buyer_type).length }, usd })
    .select("id")
    .single();
  if (ins.error) return { status: 500, body: { error: /client_archetypes|does not exist/i.test(ins.error.message) ? "Run supabase/archetypes.sql in the Supabase SQL Editor first." : ins.error.message } };
  await logSpend(supabase, { org_id: orgId, kind: "archetypes", usd: usd ?? 0, user_id: userId, ref_id: ins.data.id }).catch(() => undefined);
  return { status: 200, body: { ok: true, id: ins.data.id, usd } };
}
