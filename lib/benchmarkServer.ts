import { jsonrepair } from "jsonrepair";
import { kick } from "@/lib/chain";
import { thinkingFor, type Supa } from "@/lib/callsServer";
import { gradeCostUsd } from "@/lib/calls";
import { GRADER_VERSION, prepareGrade } from "@/lib/gradeCall";
import { logSpend } from "@/lib/spendServer";
import { BENCH_MIN, BENCH_TOLERANCE, agreementOf, compare, keyIsUsable, rulesHash, type BenchItem, type BenchKey } from "@/lib/benchmark";
import type { GradingRule } from "@/lib/gradingRules";

/*
  Running the answer key (see lib/benchmark.ts).

  A run grades every keyed call once, each in its own request (so each has the
  full time limit), compares each grade with the manager's answers, and when
  the last one lands, adds it up. Runs happen:
  - by hand, from the Answer key page;
  - by themselves when the grader version changes (once per version);
  - by themselves when corrections produce new standing rules: the new rules
    wait as "pending" while the current ones keep grading. They're tested
    against the current rules, and go live by themselves unless they agree
    with the manager clearly less often -- then they wait for the super admin
    to approve or reject them. Every change of rules is kept, so it can be
    rolled back.
  Test grades are never saved onto the calls.
*/

const JUDGE_MODEL = process.env.LEARN_MODEL || "claude-haiku-5-5";

export type Run = {
  id: string;
  org_id: string;
  purpose: "manual" | "version" | "rules" | "baseline";
  grader_version: number;
  rules: GradingRule[] | null;
  rules_hash: string;
  status: "running" | "finishing" | "done" | "failed";
  expected: number;
  agreement: number | null;
  breakdown: Record<string, { label: string; agree: number; n: number }> | null;
  verdict: string | null;
  usd: number | null;
  created_at: string;
  finished_at: string | null;
};

type Guidance = { rules: GradingRule[] | null; rules_pending: GradingRule[] | null; rules_history: { rules: GradingRule[]; until: string; why: string }[] | null };

export async function guidanceOf(supabase: Supa): Promise<Guidance | null> {
  const { data, error } = await supabase.from("grading_guidance").select("rules, rules_pending, rules_history").maybeSingle();
  if (error) return null;
  return (data as Guidance | null) ?? { rules: null, rules_pending: null, rules_history: null };
}

export async function keyedCalls(supabase: Supa): Promise<{ call_id: string; key: BenchKey }[]> {
  const { data } = await supabase.from("grading_benchmark").select("call_id, key");
  return ((data || []) as { call_id: string; key: BenchKey }[]).filter((r) => keyIsUsable(r.key));
}

/** Starts a run: one row, then one request per keyed call. */
export async function startRun(
  request: Request,
  supabase: Supa,
  orgId: string,
  userId: string | null,
  purpose: Run["purpose"],
  rules: GradingRule[]
): Promise<{ id?: string; error?: string }> {
  const calls = await keyedCalls(supabase);
  if (!calls.length) return { error: "No calls in the answer key yet." };
  const { data, error } = await supabase
    .from("grading_benchmark_runs")
    .insert({ org_id: orgId, purpose, grader_version: GRADER_VERSION, rules, rules_hash: rulesHash(rules), expected: calls.length, created_by: userId })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message || "Couldn't start the test." };
  const id = (data as { id: string }).id;
  await Promise.all(calls.map((c) => kick(request, "/api/calls/answer-key", { action: "one", runId: id, callId: c.call_id })));
  return { id };
}

/** Does the grader's first coaching point match the manager's? 1 same, 0.5 related, 0 different. About a tenth of a cent. */
async function coachMatch(key: string, manager: string, grader: string): Promise<{ score: number | null; usd: number }> {
  if (!manager.trim() || !grader.trim()) return { score: grader.trim() ? 0 : null, usd: 0 };
  try {
    const res = await fetch(`${process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com"}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: JUDGE_MODEL,
        max_tokens: 300,
        ...thinkingFor(JUDGE_MODEL),
        messages: [
          {
            role: "user",
            content: `A sales manager and an AI grader each said what a sales rep should work on first after one call.\nManager: "${manager.slice(0, 600)}"\nGrader: "${grader.slice(0, 600)}"\nAre they pointing at the same behavior? Reply with only JSON: {"match": "same" | "related" | "different"}. "same" = the same behavior to change, in any words; "related" = the same part of the call or skill but a different change; "different" = something else.`,
          },
        ],
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) return { score: null, usd: 0 };
    const out = (await res.json()) as { content?: { type: string; text?: string }[]; usage?: Record<string, number> };
    const text = (out.content || []).filter((c) => c.type === "text").map((c) => c.text || "").join("");
    const m = text.match(/\{[\s\S]*\}/);
    const v = m ? String((JSON.parse(jsonrepair(m[0])) as { match?: string }).match ?? "") : "";
    return { score: v === "same" ? 1 : v === "related" ? 0.5 : v === "different" ? 0 : null, usd: gradeCostUsd(JUDGE_MODEL, out.usage ?? {}) ?? 0 };
  } catch {
    return { score: null, usd: 0 };
  }
}

/** One call of a run: grade it (not saved), compare with the key, store the result, maybe finish the run. */
export async function runOne(request: Request, supabase: Supa, key: string, runId: string, callId: string, orgId: string, userId: string | null) {
  const started = Date.now();
  const { data: run } = await supabase.from("grading_benchmark_runs").select("*").eq("id", runId).maybeSingle();
  const r = run as Run | null;
  if (!r || r.status !== "running") return;
  const { data: k } = await supabase.from("grading_benchmark").select("key").eq("call_id", callId).maybeSingle();
  const bk = (k as { key: BenchKey } | null)?.key;
  let row: { grade: unknown; agreement: number | null; items: BenchItem[]; error: string | null; usd: number } = { grade: null, agreement: null, items: [], error: null, usd: 0 };
  try {
    if (!bk) throw new Error("This call is no longer in the answer key.");
    const prep = await prepareGrade(supabase, callId, key, started, { dryRun: true, rules: r.rules ?? [] });
    if (!prep.ok) throw new Error(prep.error);
    if (prep.already) throw new Error("The call was busy.");
    const out = await prep.run();
    if (!out) throw new Error("The test grade came back empty.");
    const g = out.grade;
    const cm = await coachMatch(key, bk.coach_first ?? "", g.coach_now?.priority.title ? `${g.coach_now.priority.title}. ${g.coach_now.priority.next_call}` : g.coaching_priorities?.[0] ?? "");
    const items = compare(bk, g, cm.score);
    row = { grade: g, agreement: agreementOf(items), items, error: null, usd: (out.usd ?? 0) + cm.usd };
  } catch (e) {
    row.error = (e instanceof Error ? e.message : String(e)).slice(0, 500);
  }
  await supabase.from("grading_benchmark_results").upsert({ run_id: runId, call_id: callId, org_id: orgId, ...row }, { onConflict: "run_id,call_id" });
  if (row.usd > 0) await logSpend(supabase, { org_id: orgId, kind: "benchmark", usd: row.usd, user_id: userId, ref_id: runId });
  await maybeFinish(request, supabase, runId, orgId, userId);
}

/** When every call of a run is in, add it up -- once (the first to flip the row does it). */
async function maybeFinish(request: Request, supabase: Supa, runId: string, orgId: string, userId: string | null) {
  const { data: rs } = await supabase.from("grading_benchmark_results").select("agreement, items, error, usd").eq("run_id", runId);
  const results = (rs || []) as { agreement: number | null; items: BenchItem[] | null; error: string | null; usd: number | null }[];
  const { data: run } = await supabase.from("grading_benchmark_runs").select("expected, status").eq("id", runId).maybeSingle();
  if (!run || (run as { status: string }).status !== "running" || results.length < (run as { expected: number }).expected) return;
  const { count: claimed } = await supabase.from("grading_benchmark_runs").update({ status: "finishing" }, { count: "exact" }).eq("id", runId).eq("status", "running");
  if (!claimed) return;
  const items = results.flatMap((x) => x.items ?? []);
  const breakdown: Run["breakdown"] = {};
  for (const it of items) {
    const b = (breakdown[it.item] ??= { label: it.label, agree: 0, n: 0 });
    b.agree += it.score;
    b.n += 1;
  }
  for (const b of Object.values(breakdown)) b.agree = Math.round((100 * b.agree) / b.n);
  const ok = results.filter((x) => !x.error);
  await supabase
    .from("grading_benchmark_runs")
    .update({
      status: ok.length ? "done" : "failed",
      agreement: agreementOf(items),
      breakdown,
      usd: results.reduce((a, x) => a + (x.usd ?? 0), 0),
      finished_at: new Date().toISOString(),
    })
    .eq("id", runId);
  await decideRules(supabase, orgId, userId);
}

/** The current rules' result on this grader version, if it's been tested. */
async function baselineFor(supabase: Supa, rules: GradingRule[]): Promise<Run | null> {
  const { data } = await supabase
    .from("grading_benchmark_runs")
    .select("*")
    .eq("rules_hash", rulesHash(rules))
    .eq("grader_version", GRADER_VERSION)
    .neq("purpose", "rules")
    .in("status", ["running", "finishing", "done"])
    .order("created_at", { ascending: false })
    .limit(1);
  return ((data || []) as Run[])[0] ?? null;
}

/** Pending rules, once both tests are in: live if they hold up, otherwise held for the super admin. */
export async function decideRules(supabase: Supa, orgId: string, userId: string | null) {
  const g = await guidanceOf(supabase);
  if (!g?.rules_pending) return;
  const current = g.rules ?? [];
  const base = await baselineFor(supabase, current);
  const { data: cd } = await supabase
    .from("grading_benchmark_runs")
    .select("*")
    .eq("purpose", "rules")
    .eq("rules_hash", rulesHash(g.rules_pending))
    .eq("grader_version", GRADER_VERSION)
    .order("created_at", { ascending: false })
    .limit(1);
  const cand = ((cd || []) as Run[])[0];
  if (!base || !cand || base.status !== "done" || cand.status !== "done" || cand.verdict) return;
  const pass = (cand.agreement ?? 0) >= (base.agreement ?? 0) - BENCH_TOLERANCE;
  // Claimed, so two tests finishing at the same moment can't both act on it.
  const { count: claimed } = await supabase.from("grading_benchmark_runs").update({ verdict: pass ? "promoted" : "held" }, { count: "exact" }).eq("id", cand.id).is("verdict", null);
  if (!claimed) return;
  if (pass) await promote(supabase, orgId, g, `Tested: ${cand.agreement}% agreement vs ${base.agreement}% for the rules before`);
  void userId;
}

/** Makes the pending rules live, keeping the old ones in the history (newest first, last 20). */
export async function promote(supabase: Supa, orgId: string, g: Guidance, why: string) {
  if (!g.rules_pending) return;
  const history = [{ rules: g.rules ?? [], until: new Date().toISOString(), why }, ...(g.rules_history ?? [])].slice(0, 20);
  await supabase.from("grading_guidance").update({ rules: g.rules_pending, rules_pending: null, rules_pending_at: null, rules_history: history }).eq("org_id", orgId);
}

/**
 * Called by the Calls and Answer key pages: starts whatever test is due.
 * - new rules waiting: test them (and the current rules, if this grader version hasn't been tested on them);
 * - a new grader version: test it once.
 * Needs at least BENCH_MIN keyed calls.
 */
export async function autoRun(request: Request, supabase: Supa, orgId: string, userId: string): Promise<string> {
  const calls = await keyedCalls(supabase);
  if (calls.length < BENCH_MIN) return "not enough keyed calls";
  const g = await guidanceOf(supabase);
  if (!g) return "grading_benchmark.sql not run";
  // Anything already running: wait for it.
  const { count: busy } = await supabase.from("grading_benchmark_runs").select("id", { count: "exact", head: true }).in("status", ["running", "finishing"]).gte("created_at", new Date(Date.now() - 30 * 60_000).toISOString());
  if (busy) return "a test is running";
  const current = g.rules ?? [];
  const base = await baselineFor(supabase, current);
  const started: string[] = [];
  if (!base) {
    const r = await startRun(request, supabase, orgId, userId, g.rules_pending ? "baseline" : "version", current);
    if (r.id) started.push("current rules");
  }
  if (g.rules_pending) {
    const { data: last } = await supabase.from("grading_benchmark_runs").select("status, created_at").eq("purpose", "rules").eq("rules_hash", rulesHash(g.rules_pending)).eq("grader_version", GRADER_VERSION).order("created_at", { ascending: false }).limit(1);
    const l = ((last || []) as { status: string; created_at: string }[])[0];
    // Test them unless a test is done or still fresh (a run stuck over 30 minutes is tried again).
    const tested = l && (l.status === "done" || l.status === "finishing" || (l.status === "running" && Date.now() - new Date(l.created_at).getTime() < 30 * 60_000));
    if (!tested) {
      const r = await startRun(request, supabase, orgId, userId, "rules", g.rules_pending);
      if (r.id) started.push("new rules");
    }
  }
  return started.length ? `started: ${started.join(", ")}` : "nothing due";
}

export { BENCH_MIN };
