import { NextResponse } from "next/server";
import { requireAdmin, thinkingFor } from "@/lib/callsServer";
import { gradeCostUsd } from "@/lib/calls";
import type { ClientInsight } from "@/lib/learn";

export const runtime = "nodejs";
export const maxDuration = 300;

/*
  Fine-tunes the practice clients we already have from recent real calls:
  for each one, a suggested new backstory and patience that keep who they
  are (name, debts, the right result) but make how they talk, object and
  react truer to real clients. Saved as a suggestion for a manager to
  apply or dismiss -- nothing changes on its own. About ten cents a press.
*/

const MODEL = process.env.SUGGEST_MODEL || "claude-sonnet-5-5";
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["clients"],
  properties: {
    clients: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "change", "backstory", "patience", "why", "based_on"],
        properties: {
          id: { type: "string" },
          change: { type: "boolean" },
          backstory: { type: "string" },
          patience: { type: "integer" },
          why: { type: "string" },
          based_on: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;

const INSTRUCTIONS = `You fine-tune AI practice clients for a debt relief sales team (Lionside Financial; program run by Bolton). Below are the current practice clients (their hidden backstories, written to the AI that plays them) and anonymous profiles of REAL clients from recent calls.

For each practice client, decide whether real calls show something that would make it more true to life: how real people in that situation actually talk, the real objections and the exact way they put them, what really sits underneath, what makes them warm up, and what makes them hang up. If so, rewrite the backstory (change: true). If the client is already true to life, return change: false and the backstory unchanged.

Rules for a rewrite:
- Keep who they are: same name, age, family, job, debts and amounts, the right result, and the core of their story. Improve, don't replace.
- Weave in real wording and behaviour from the real profiles. Never copy one real client's identifying details.
- Keep it written to the AI in second person ("You are...") and about the same length or a little longer.
- patience: 1 (hangs up fast) to 10 (very patient), from how comparable real clients behaved.
- why: one or two plain sentences for the manager on what changed and which real patterns it reflects.
- based_on: ids of the real profiles you drew on.`;

export async function POST(request: Request) {
  const ctx = await requireAdmin(request);
  if (ctx instanceof NextResponse) return ctx;
  const { supabase } = ctx;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 500 });

  const [{ data: ins, error }, { data: personas }, { data: secrets }] = await Promise.all([
    supabase.from("client_insights").select("*").in("kind", ["full", "short"]).order("created_at", { ascending: false }).limit(24),
    supabase.from("roleplay_personas").select("id, name, title, difficulty"),
    supabase.from("roleplay_persona_secrets").select("persona_id, backstory, patience, right_outcome"),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const pool = (ins || []) as ClientInsight[];
  if (pool.length < 3) return NextResponse.json({ error: "Not enough real calls learned yet -- give it a few more graded calls." }, { status: 400 });
  const cast = (personas || []).filter((p) => (secrets || []).some((s) => s.persona_id === p.id));
  if (!cast.length) return NextResponse.json({ tuned: 0 });

  const current = cast
    .map((p) => {
      const s = (secrets || []).find((x) => x.persona_id === p.id)!;
      return `<client id="${p.id}" title="${p.title}" difficulty="${p.difficulty}" patience="${s.patience ?? "unset"}" right_result="${s.right_outcome}">\n${s.backstory}\n</client>`;
    })
    .join("\n");
  const real = pool
    .map((i) => `<real id="${i.id}" lang="${i.lang}" kind="${i.kind}" outcome="${i.outcome ?? "?"}">\n${JSON.stringify({ profile: i.profile, objections: i.objections, moments: i.moments, ending: i.ending })}\n</real>`)
    .join("\n");

  const res = await fetch(`${process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com"}/v1/messages`, {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 24000,
      ...thinkingFor(MODEL),
      output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content: [{ type: "text", text: INSTRUCTIONS }, { type: "text", text: `Current practice clients:\n${current}\n\nReal clients:\n${real}` }] }],
    }),
    signal: AbortSignal.timeout(280_000),
  });
  if (!res.ok) return NextResponse.json({ error: `Tuning failed (${res.status}). ${(await res.text().catch(() => "")).slice(0, 200)}` }, { status: 500 });
  const data = (await res.json()) as { content?: { type: string; text?: string }[]; usage?: Record<string, number> };
  const raw = (data.content || []).filter((c) => c.type === "text").map((c) => c.text || "").join("");
  let out: { id: string; change: boolean; backstory: string; patience: number; why: string; based_on: string[] }[] = [];
  try {
    out = (JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as { clients: typeof out }).clients;
  } catch {
    return NextResponse.json({ error: "The tuner returned something unreadable. Try again." }, { status: 500 });
  }

  let tuned = 0;
  for (const c of out) {
    if (!c.change || !cast.some((p) => p.id === c.id) || !c.backstory?.trim()) continue;
    const { error: upErr } = await supabase
      .from("roleplay_persona_secrets")
      .update({
        proposal: { backstory: c.backstory.trim(), patience: Math.max(1, Math.min(10, Math.round(c.patience || 5))), why: c.why, based_on: c.based_on, at: new Date().toISOString() },
      })
      .eq("persona_id", c.id);
    if (upErr) return NextResponse.json({ error: /proposal/.test(upErr.message) ? "Run the latest SQL (proposal column) first." : upErr.message }, { status: 500 });
    tuned++;
  }
  return NextResponse.json({ tuned, usd: gradeCostUsd(MODEL, data.usage ?? {}) });
}
