import { NextResponse, after } from "next/server";
import { requireAdmin } from "@/lib/callsServer";
import { autoRun, decideRules, guidanceOf, promote, runOne, startRun } from "@/lib/benchmarkServer";
import type { GradingRule } from "@/lib/gradingRules";

export const runtime = "nodejs";
export const maxDuration = 300;

/*
  The answer key (lib/benchmark.ts, lib/benchmarkServer.ts).
  POST { action }:
    "one"      -- one call of a run (started by the server itself)
    "auto"     -- start whatever test is due (Calls and Answer key pages send this)
    "run"      -- test the grader now, on the current rules (super admin)
    "approve" / "reject" -- held rules (super admin)
    "rollback" { index } -- put an earlier set of rules back (super admin)
*/
export async function POST(request: Request) {
  const ctx = await requireAdmin(request);
  if (ctx instanceof NextResponse) return ctx;
  const { supabase, orgId, userId } = ctx;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 500 });
  const body = (await request.json().catch(() => ({}))) as { action?: string; runId?: string; callId?: string; index?: number };

  if (body.action === "one") {
    const { runId, callId } = body;
    if (!runId || !callId) return NextResponse.json({ error: "Missing run or call." }, { status: 400 });
    after(async () => {
      await runOne(request, supabase, key, runId, callId, orgId, userId);
    });
    return NextResponse.json({ ok: true }, { status: 202 });
  }

  if (body.action === "auto") {
    const what = await autoRun(request, supabase, orgId, userId);
    return NextResponse.json({ ok: true, what });
  }

  // Everything else is the super admin's call.
  const { data: me } = await supabase.from("profiles").select("super_admin").eq("id", userId).maybeSingle();
  if (!(me as { super_admin?: boolean } | null)?.super_admin) return NextResponse.json({ error: "Only the super admin can do that." }, { status: 403 });

  const g = await guidanceOf(supabase);
  if (!g) return NextResponse.json({ error: "Run supabase/grading_benchmark.sql in the Supabase SQL Editor first." }, { status: 400 });

  if (body.action === "run") {
    const r = await startRun(request, supabase, orgId, userId, "manual", g.rules ?? []);
    if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json({ ok: true, id: r.id });
  }

  if (body.action === "approve") {
    if (!g.rules_pending) return NextResponse.json({ error: "No new rules are waiting." }, { status: 400 });
    await promote(supabase, orgId, g, "Approved by the super admin");
    await supabase.from("grading_benchmark_runs").update({ verdict: "approved" }).eq("purpose", "rules").eq("verdict", "held");
    return NextResponse.json({ ok: true });
  }

  if (body.action === "reject") {
    if (!g.rules_pending) return NextResponse.json({ error: "No new rules are waiting." }, { status: 400 });
    await supabase.from("grading_guidance").update({ rules_pending: null, rules_pending_at: null }).eq("org_id", orgId);
    await supabase.from("grading_benchmark_runs").update({ verdict: "rejected" }).eq("purpose", "rules").eq("verdict", "held");
    return NextResponse.json({ ok: true });
  }

  if (body.action === "rollback") {
    const i = Number(body.index);
    const h = g.rules_history ?? [];
    const back = h[i];
    if (!back) return NextResponse.json({ error: "That version isn't in the history." }, { status: 400 });
    // The rules being replaced go to the top of the history, so a rollback can itself be undone.
    const history = [{ rules: g.rules ?? [], until: new Date().toISOString(), why: "Replaced by a rollback" }, ...h.filter((_, k) => k !== i)].slice(0, 20);
    await supabase.from("grading_guidance").update({ rules: back.rules as GradingRule[], rules_history: history }).eq("org_id", orgId);
    return NextResponse.json({ ok: true });
  }

  if (body.action === "decide") {
    await decideRules(supabase, orgId, userId);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
