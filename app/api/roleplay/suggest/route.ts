import { NextResponse } from "next/server";
import { requireAdmin, thinkingFor } from "@/lib/callsServer";
import { gradeCostUsd } from "@/lib/calls";
import type { ClientInsight } from "@/lib/learn";

export const runtime = "nodejs";
export const maxDuration = 300;

/*
  Drafts up to two new practice clients from real calls that haven't been
  used yet, covering situations the current clients don't. They're saved
  hidden (inactive) for a manager to check, edit and switch on. About ten
  cents a press. Body: {}.
*/

const MODEL = process.env.SUGGEST_MODEL || "claude-sonnet-5-5";
const str = { type: "string" } as const;
const int = { type: "integer" } as const;
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
        required: ["name", "title", "difficulty", "speaks", "age", "state", "source", "requested", "purpose", "credit_score", "accounts", "notes", "loan_approved", "loan_text", "backstory", "product", "rep", "company", "pain", "patience", "right_outcome", "right_outcome_note", "first_message_en", "first_message_es", "based_on"],
        properties: {
          name: str,
          title: str,
          difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
          speaks: { type: "string", enum: ["en", "es"] },
          age: int,
          state: str,
          source: str,
          requested: int,
          purpose: str,
          credit_score: int,
          accounts: { type: "array", items: { type: "object", additionalProperties: false, required: ["creditor", "type", "balance", "status"], properties: { creditor: str, type: str, balance: int, status: str } } },
          notes: str,
          loan_approved: { type: "boolean" },
          loan_text: str,
          backstory: str,
          product: int,
          rep: int,
          company: int,
          pain: int,
          patience: int,
          right_outcome: { type: "string", enum: ["enrolled", "callback", "no_sale"] },
          right_outcome_note: str,
          first_message_en: str,
          first_message_es: str,
          based_on: { type: "array", items: str },
        },
      },
    },
  },
} as const;

const INSTRUCTIONS = `You design practice clients for a debt relief sales team (Lionside Financial; the program is run by Bolton). Below are anonymous profiles of REAL clients from recent calls, and short descriptions of the practice clients the team already has.

Create at most 2 NEW practice clients that cover real situations the existing ones don't. Each must be a blend of several real clients, never a copy of one: invent a new first and last name, a plausible US state, round, realistic debts (creditor names like real card issuers and personal-loan companies are fine), and a backstory written to the AI that will play them (second person: "You are..."). The backstory must include: who they are, how they fell behind, what they hide until a rep earns it, their real objections and how they actually say them (use the real wording style), what would genuinely win them, what makes them hang up, and who else decides.
- speaks: "es" for a client who mainly speaks Spanish (write the backstory in English, but say they speak Spanish and how).
- Tens and pain 1-10 as they'd start; patience 1 (hangs up fast) to 10 (very patient), from how the real clients behaved.
- right_outcome: what a great rep should get with this person, and right_outcome_note why.
- first_message_en/es: how they answer the phone ("Hello?", "Yeah, who's this?").
- based_on: the ids of the real profiles you drew on.
- notes: one line for the rep's lead card (what the application said), no secrets.
If nothing real is missing from the existing clients, return an empty list.`;

const slugOf = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

export async function POST(request: Request) {
  const ctx = await requireAdmin(request);
  if (ctx instanceof NextResponse) return ctx;
  const { supabase, orgId } = ctx;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 500 });

  const [{ data: ins, error }, { data: personas }, { data: secrets }] = await Promise.all([
    supabase.from("client_insights").select("*").eq("kind", "full").is("used_in", null).order("created_at", { ascending: false }).limit(16),
    supabase.from("roleplay_personas").select("id, name, title, difficulty, sort_order"),
    supabase.from("roleplay_persona_secrets").select("persona_id, backstory"),
  ]);
  if (error) return NextResponse.json({ error: /client_insights|does not exist/i.test(error.message) ? "Run supabase/real-call-learning.sql first." : error.message }, { status: 500 });
  const pool = (ins || []) as ClientInsight[];
  if (pool.length < 3) return NextResponse.json({ made: 0 });

  const existing = (personas || [])
    .map((p) => `- ${p.title} (${p.difficulty}): ${String((secrets || []).find((s) => s.persona_id === p.id)?.backstory || "").slice(0, 300)}`)
    .join("\n");
  const real = pool
    .map(
      (i) =>
        `<real id="${i.id}" lang="${i.lang}" outcome="${i.outcome ?? "?"}">\n${JSON.stringify({ profile: i.profile, objections: i.objections, moments: i.moments, ending: i.ending })}\n</real>`
    )
    .join("\n");

  const res = await fetch(`${process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com"}/v1/messages`, {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 12000,
      ...thinkingFor(MODEL),
      output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content: [{ type: "text", text: INSTRUCTIONS }, { type: "text", text: `Existing practice clients:\n${existing || "(none)"}\n\nReal clients:\n${real}` }] }],
    }),
    signal: AbortSignal.timeout(280_000),
  });
  if (!res.ok) return NextResponse.json({ error: `Drafting failed (${res.status}). ${(await res.text().catch(() => "")).slice(0, 200)}` }, { status: 500 });
  const data = (await res.json()) as { content?: { type: string; text?: string }[]; usage?: Record<string, number> };
  const raw = (data.content || []).filter((c) => c.type === "text").map((c) => c.text || "").join("");
  type Draft = {
    name: string; title: string; difficulty: "easy" | "medium" | "hard"; speaks: "en" | "es"; age: number; state: string; source: string; requested: number; purpose: string;
    credit_score: number; accounts: { creditor: string; type: string; balance: number; status: string }[]; notes: string; loan_approved: boolean; loan_text: string;
    backstory: string; product: number; rep: number; company: number; pain: number; patience: number; right_outcome: "enrolled" | "callback" | "no_sale";
    right_outcome_note: string; first_message_en: string; first_message_es: string; based_on: string[];
  };
  let drafts: Draft[] = [];
  try {
    drafts = (JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as { clients: Draft[] }).clients.slice(0, 2);
  } catch {
    return NextResponse.json({ error: "The drafter returned something unreadable. Try again." }, { status: 500 });
  }

  const clamp = (n: number) => Math.max(1, Math.min(10, Math.round(Number(n) || 5)));
  let sort = Math.max(0, ...(personas || []).map((p) => Number(p.sort_order) || 0));
  let made = 0;
  for (const d of drafts) {
    const { data: row, error: pErr } = await supabase
      .from("roleplay_personas")
      .insert({
        org_id: orgId,
        slug: `${slugOf(d.title) || "client"}-${Date.now().toString(36)}`,
        name: d.name,
        title: d.title,
        difficulty: d.difficulty,
        lead: {
          age: d.age,
          state: d.state,
          source: d.source,
          requested: d.requested,
          purpose: d.purpose,
          credit_score: d.credit_score,
          accounts: d.accounts,
          notes: d.speaks === "es" ? `${d.notes} (Speaks mainly Spanish.)` : d.notes,
          loan: { approved: d.loan_approved, text: d.loan_text },
        },
        first_message_en: d.first_message_en || "Hello?",
        first_message_es: d.first_message_es || "¿Bueno?",
        active: false,
        origin: "learned",
        sort_order: ++sort,
      })
      .select("id")
      .single();
    if (pErr || !row) return NextResponse.json({ error: pErr?.message || "Could not save the draft." }, { status: 500 });
    await supabase.from("roleplay_persona_secrets").insert({
      persona_id: row.id,
      org_id: orgId,
      backstory: d.backstory,
      tens: { product: clamp(d.product), rep: clamp(d.rep), company: clamp(d.company), pain: clamp(d.pain) },
      patience: clamp(d.patience),
      right_outcome: d.right_outcome,
      right_outcome_note: d.right_outcome_note || null,
    });
    const used = (d.based_on || []).filter((id) => pool.some((i) => i.id === id));
    if (used.length) await supabase.from("client_insights").update({ used_in: row.id }).in("id", used);
    made++;
  }
  return NextResponse.json({ made, usd: gradeCostUsd(MODEL, data.usage ?? {}) });
}
