import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/callsServer";
import { askJsonCost } from "@/lib/repReview";
import { logSpend } from "@/lib/spendServer";
import { plainWords } from "@/lib/plain";
import type { GradingRule } from "@/lib/gradingRules";

export const runtime = "nodejs";
export const maxDuration = 300;

/*
  Turns EVERY "Not right?" correction a manager has made into a short list of
  standing grading rules -- the same mistake corrected five times becomes one
  firm rule -- and saves it where the grader reads it on every call. Runs by
  itself after corrections are saved; rules a manager wrote or edited by hand
  are kept unless a newer correction says otherwise.

  GET: whether the rules are behind the corrections.
  POST {}: rewrite if behind. {force}: rewrite now. Rules apply to every call
  graded from then on; nothing already graded is re-graded.
*/

type Fix = { item_kind: string; item_label: string | null; original: string; correction: string; created_at: string };

async function state(supabase: Awaited<ReturnType<typeof requireAdmin>> extends infer T ? (T extends { supabase: infer S } ? S : never) : never) {
  const [g, n, last] = await Promise.all([
    supabase.from("grading_guidance").select("rules, rules_updated_at, rules_from").maybeSingle(),
    supabase.from("call_corrections").select("id", { count: "exact", head: true }),
    supabase.from("call_corrections").select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (g.error) return { error: /rules/.test(g.error.message) ? "Run supabase/grading_rules.sql in the Supabase SQL Editor first." : g.error.message };
  const row = g.data as { rules: GradingRule[] | null; rules_updated_at: string | null; rules_from: number | null } | null;
  const count = n.count ?? 0;
  const lastAt = (last.data as { created_at: string } | null)?.created_at ?? null;
  const stale = count > 0 && (row?.rules_from !== count || !row?.rules_updated_at || (!!lastAt && lastAt > row.rules_updated_at));
  return { error: "", rules: row?.rules ?? [], updated_at: row?.rules_updated_at ?? null, count, stale };
}

export async function GET(request: Request) {
  const ctx = await requireAdmin(request);
  if (ctx instanceof NextResponse) return ctx;
  const s = await state(ctx.supabase);
  if (s.error) return NextResponse.json({ error: s.error }, { status: 500 });
  return NextResponse.json(s);
}

export async function POST(request: Request) {
  const ctx = await requireAdmin(request);
  if (ctx instanceof NextResponse) return ctx;
  const { supabase, orgId, userId } = ctx;
  const body = (await request.json().catch(() => ({}))) as { force?: boolean };

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 500 });
  const s = await state(supabase);
  if (s.error) return NextResponse.json({ error: s.error }, { status: 500 });
  if (!body.force && !s.stale) return NextResponse.json({ ok: true, skipped: "up to date", rules: s.rules });
  // Corrections often come in bursts: one rewrite a minute is plenty (the next check catches the rest).
  if (!body.force && s.updated_at && Date.now() - new Date(s.updated_at).getTime() < 60_000) return NextResponse.json({ ok: true, skipped: "just rewritten" });

  const { data: f, error } = await supabase.from("call_corrections").select("item_kind, item_label, original, correction, created_at").order("created_at", { ascending: true }).limit(600);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const fixes = (f || []) as Fix[];
  const current = (s.rules ?? []) as GradingRule[];

  const prompt = `A sales manager at a debt-relief company reviews calls that an AI grader scored against the company script and Jordan Belfort's Straight Line method. Whenever the grader got an item wrong, the manager pressed "Not right?" and wrote what it should have said. Below is EVERY correction, oldest first, and the current standing rules.

Turn them into standing grading rules the grader will follow on every future call, so the manager never has to correct the same thing twice:
- Group corrections that teach the same lesson into ONE rule. Write the general principle, not the one call ("When the client gives facts but no feelings, mark hardship partial, not hit" -- not "on the Luis call...").
- Each rule: rule (one or two plain sentences, an instruction to the grader), why (a few words on what it fixes), count (how many corrections it comes from).
- When two corrections disagree, the newer one wins.
- Keep every current rule marked manual exactly as written (manual: true), unless a newer correction clearly says otherwise -- then rewrite it and drop the manual mark.
- Leave out a correction that only fixed a fact about one call (a wrong time, a name, a typo) and teaches nothing general.
- Never write a rule that rewards pressure, overstated promises, or closing a confused client; compliance problems stay problems.
- Plain English, no jargon or shorthand. At most 40 rules, most important first.

<current_rules>
${current.length ? current.map((r) => `- ${r.manual ? "[manual] " : ""}${r.rule}`).join("\n") : "(none yet)"}
</current_rules>

<corrections>
${fixes.map((x) => `- ${x.created_at.slice(0, 10)} [${x.item_kind}${x.item_label ? `: ${x.item_label}` : ""}] the grader said: "${String(x.original).slice(0, 300)}" -- the manager corrected: "${String(x.correction).slice(0, 500)}"`).join("\n")}
</corrections>`;

  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["rules"],
    properties: {
      rules: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["rule", "why", "count", "manual"],
          properties: { rule: { type: "string" }, why: { type: "string" }, count: { type: "integer" }, manual: { type: "boolean" } },
        },
      },
    },
  };
  try {
    const { data, usd } = await askJsonCost<{ rules: GradingRule[] }>([{ type: "text", text: prompt }], schema, key, "The grading rules", 8000);
    const rules = (Array.isArray(data?.rules) ? data.rules : [])
      .filter((r) => r && typeof r.rule === "string" && r.rule.trim())
      .slice(0, 40)
      .map((r) => ({ rule: plainWords(r.rule.trim()), why: plainWords(String(r.why ?? "")), count: Math.max(0, Number(r.count) || 0), ...(r.manual ? { manual: true } : {}) }));
    const { error: e } = await supabase
      .from("grading_guidance")
      .upsert({ org_id: orgId, rules, rules_updated_at: new Date().toISOString(), rules_from: s.count }, { onConflict: "org_id" });
    if (e) return NextResponse.json({ error: e.message }, { status: 500 });
    await logSpend(supabase, { org_id: orgId, kind: "rules", usd, user_id: userId, ref_id: null });
    return NextResponse.json({ ok: true, rules });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
