import type { SupabaseClient } from "@supabase/supabase-js";
import { askJsonCost } from "@/lib/repReview";
import { logSpend } from "@/lib/spendServer";
import { plainWords } from "@/lib/plain";
import type { GradingRule } from "@/lib/gradingRules";

/*
  The standing grading rules, written from EVERY "Not right?" correction.
  Not rewritten after each correction (a call can get 10-15 of them): the
  rewrite happens once, just before the next real call is graded, if any
  corrections came in since the last one. The first grade to notice claims
  the rewrite, so a batch of calls grading at once pays for it once.
*/

type Fix = { item_kind: string; item_label: string | null; original: string; correction: string; created_at: string };

export async function rulesState(supabase: SupabaseClient) {
  const [g, n, last] = await Promise.all([
    supabase.from("grading_guidance").select("rules, rules_updated_at, rules_from").maybeSingle(),
    supabase.from("call_corrections").select("id", { count: "exact", head: true }),
    supabase.from("call_corrections").select("created_at").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (g.error) return { error: /rules/.test(g.error.message) ? "Run supabase/grading_rules.sql in the Supabase SQL Editor first." : g.error.message, rules: [] as GradingRule[], updated_at: null as string | null, count: 0, stale: false, lastAt: null as string | null, hasRow: false };
  const row = g.data as { rules: GradingRule[] | null; rules_updated_at: string | null; rules_from: number | null } | null;
  const count = n.count ?? 0;
  const lastAt = (last.data as { created_at: string } | null)?.created_at ?? null;
  const stale = count > 0 && (row?.rules_from !== count || !row?.rules_updated_at || (!!lastAt && lastAt > row.rules_updated_at));
  return { error: "", rules: row?.rules ?? [], updated_at: row?.rules_updated_at ?? null, count, stale, lastAt, hasRow: !!row };
}

/** Rewrites the rules if corrections came in since the last rewrite (or always, with force). */
export async function rewriteRules(supabase: SupabaseClient, key: string, orgId: string, userId: string | null, force = false): Promise<{ rules?: GradingRule[]; skipped?: string; error?: string }> {
  const s = await rulesState(supabase);
  if (s.error) return { error: s.error };
  if (!force && !s.stale) return { skipped: "up to date", rules: s.rules };
  const startedAt = new Date().toISOString();
  if (!force) {
    // Claim it: only the grade that flips the row does the rewrite; the others grade on the current rules.
    if (!s.hasRow) await supabase.from("grading_guidance").upsert({ org_id: orgId }, { onConflict: "org_id", ignoreDuplicates: true });
    // Counted, not returned: the updated row no longer matches the filter, so it wouldn't come back.
    let q = supabase.from("grading_guidance").update({ rules_from: s.count, rules_updated_at: startedAt }, { count: "exact" }).eq("org_id", orgId);
    q = q.or(`rules_from.is.null,rules_from.neq.${s.count},rules_updated_at.is.null${s.lastAt ? `,rules_updated_at.lt."${s.lastAt}"` : ""}`);
    const { count: claimed, error: ce } = await q;
    if (ce) return { error: `Couldn't claim the rules rewrite: ${ce.message}` };
    if (!claimed) return { skipped: "another grade is rewriting them", rules: s.rules };
  }

  const { data: f, error } = await supabase.from("call_corrections").select("item_kind, item_label, original, correction, created_at").order("created_at", { ascending: true }).limit(600);
  if (error) return { error: error.message };
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
- Never write a rule about which claims or wording are allowed, or about flagging what the script says: approved wording comes from the company's legal review, not from corrections. Leave such corrections out.
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
    const { error: e } = await supabase.from("grading_guidance").upsert({ org_id: orgId, rules, rules_updated_at: startedAt, rules_from: s.count }, { onConflict: "org_id" });
    if (e) throw new Error(e.message);
    await logSpend(supabase, { org_id: orgId, kind: "rules", usd, user_id: userId, ref_id: null });
    return { rules };
  } catch (err) {
    // Let the next grade try again.
    await supabase.from("grading_guidance").update({ rules_from: null }).eq("org_id", orgId);
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
