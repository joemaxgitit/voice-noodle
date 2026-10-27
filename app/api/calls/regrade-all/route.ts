import { NextResponse, after } from "next/server";
import { requireAdmin, log } from "@/lib/callsServer";
import { CURRENT_FROM, GRADER_VERSION, prepareGrade, REGRADE_NEWEST, regradeApplies } from "@/lib/gradeCall";
import { prepareQuick } from "@/lib/quickRead";
import { kick } from "@/lib/chain";

export const runtime = "nodejs";
export const maxDuration = 300;

/*
  After a major grading change (GRADER_VERSION bumped), re-grades every call
  on file by itself: two at a time, oldest call first, then starts the next
  pair. Started from the Calls page when it sees calls graded on older rules;
  if the chain ever stops (session expired, deploy), the next visit to the
  Calls page picks it up where it left off.

  GET: how many calls are still on older rules. POST { background: true }:
  run the next pair and keep going.
*/

const PER_RUN = 2;

type Row = { id: string; status: string; call_date: string | null; created_at: string; updated_at: string; ver: string | null; script_id: string | null; handoff: string | null; fail: string | null; tries: string | null; failv: string | null; source: string | null; outcome: string | null; outcome_manual: string | null; kind?: string | null };

async function stale(supabase: Awaited<ReturnType<typeof requireAdmin>> extends infer T ? (T extends { supabase: infer S } ? S : never) : never) {
  const { data, error } = await supabase
    .from("calls")
    .select("id, status, call_date, created_at, updated_at, script_id, handoff, source, outcome, outcome_manual, kind, ver:grade->>grader_version, fail:grade->>regrade_failed, tries:grade->>regrade_tries, failv:grade->>regrade_failed_version")
    .in("status", ["graded", "grading", "failed"])
    .not("transcript", "is", null)
    .not("script_id", "is", null)
    .limit(5000);
  if (error) return { error: error.message, todo: [] as Row[], grading: 0, total: 0, renewScript: null, renewIds: new Set<string>(), wrongScript: new Set<string>() };
  const rows = (data || []) as Row[];
  // Renew calls (scripts that continue into another) may need a newer version than the rest.
  const { data: sc } = await supabase.from("scripts").select("id, title, continues_into");
  const scripts = (sc || []) as { id: string; title: string; continues_into: string | null }[];
  const renew = new Set(scripts.filter((x) => x.continues_into).map((x) => x.id));
  const renewScript = scripts.find((x) => x.continues_into) ?? scripts.find((x) => /renew/i.test(x.title)) ?? null;
  // A call is a renew if it's on the Renew script or marked Renew in its client journey.
  const isRenew = (r: Row) => renew.has(r.script_id ?? "") || r.handoff === "renew";
  // Out of date, or a re-grade that failed (kept its old grade): retried up to 3 times per grader version,
  // so a fix to the grader (a new version) gets every failed call another go.
  // Only the newest real calls are ever re-graded after a grading change -- and only those the change can affect.
  const newest = new Set(
    rows
      .filter((r) => r.source !== "roleplay" && (r.status === "graded" || (r.status === "failed" && r.ver !== null)))
      .sort((a, b) => (b.call_date || b.created_at.slice(0, 10)).localeCompare(a.call_date || a.created_at.slice(0, 10)) || b.created_at.localeCompare(a.created_at))
      .slice(0, REGRADE_NEWEST)
      .map((r) => r.id)
  );
  const old = rows.filter((r) => r.status !== "failed" || r.ver !== null).filter((r) => (r.status === "grading" && r.source !== "roleplay" && !r.kind) || (newest.has(r.id) && regradeApplies(r))).filter(
    (r) =>
      r.status === "failed" ||
      (Number(r.ver) || 1) < (isRenew(r) ? CURRENT_FROM.renew : CURRENT_FROM.other) ||
      (r.fail === "true" && ((Number(r.failv) || 0) < GRADER_VERSION || (Number(r.tries) || 1) < 3))
  );
  const recent = Date.now() - 10 * 60_000;
  return {
    error: "",
    total: rows.filter((r) => r.status !== "failed").length,
    renewScript,
    renewIds: new Set(rows.filter(isRenew).map((r) => r.id)),
    wrongScript: new Set(rows.filter((r) => r.handoff === "renew" && !renew.has(r.script_id ?? "")).map((r) => r.id)),
    // Oldest call first, so a client's journey is re-read in order.
    // Graded calls, plus any left stuck mid-grade (no progress for 10+ minutes).
    // Also calls whose last grading attempt failed but that still have an earlier grade to fall back on.
    todo: old.filter((r) => r.status === "graded" || (r.status === "failed" && r.ver !== null) || (r.status === "grading" && new Date(r.updated_at).getTime() <= recent)).sort((a, b) => (a.call_date || a.created_at).localeCompare(b.call_date || b.created_at)),
    grading: rows.filter((r) => r.status === "grading" && new Date(r.updated_at).getTime() > recent).length,
  };
}

export async function GET(request: Request) {
  const ctx = await requireAdmin(request);
  if (ctx instanceof NextResponse) return ctx;
  const s = await stale(ctx.supabase);
  if (s.error) return NextResponse.json({ error: s.error }, { status: 500 });
  return NextResponse.json({ version: GRADER_VERSION, remaining: s.todo.length, grading: s.grading, total: s.total, renew: s.renewIds.size });
}

export async function POST(request: Request) {
  const started = Date.now();
  const ctx = await requireAdmin(request);
  if (ctx instanceof NextResponse) return ctx;
  const { supabase } = ctx;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 500 });

  const s = await stale(supabase);
  if (s.error) return NextResponse.json({ error: s.error }, { status: 500 });
  // Another run is already going (or a manager is grading): let that one carry on.
  if (s.grading >= PER_RUN) return NextResponse.json({ ok: true, busy: true, remaining: s.todo.length }, { status: 202 });
  const next = s.todo.slice(0, PER_RUN);
  if (!next.length) return NextResponse.json({ ok: true, remaining: 0 });

  const preps: { run: () => Promise<unknown> }[] = [];
  for (const c of next) {
    // Marked Renew but still on another script (uploaded before Renew switched it): grade it on the Renew script.
    if (s.wrongScript.has(c.id) && s.renewScript) await supabase.from("calls").update({ script_id: s.renewScript.id }).eq("id", c.id);
    // A voicemail or short call graded in full before quick reads existed gets the quick read instead.
    const quick = await prepareQuick(supabase, c.id, key, ctx.orgId, ctx.userId, { regrade: true });
    if (quick) {
      preps.push(quick);
      continue;
    }
    const prep = await prepareGrade(supabase, c.id, key, started);
    if (prep.ok && !prep.already) preps.push(prep);
    else if (!prep.ok) {
      // Can't be re-graded (no script, no transcript...): mark it so the run moves past it.
      const { data: g } = await supabase.from("calls").select("grade").eq("id", c.id).maybeSingle();
      if (g?.grade) {
        const gr = g.grade as Record<string, unknown>;
        await supabase.from("calls").update({ grade: { ...gr, grader_version: GRADER_VERSION, regrade_failed: true, regrade_failed_version: GRADER_VERSION, regrade_tries: (Number(gr.regrade_failed_version) || 0) < GRADER_VERSION ? 1 : (Number(gr.regrade_tries) || 1) + 1 } }).eq("id", c.id);
      }
    }
  }
  after(async () => {
    await Promise.all(preps.map((p) => p.run().catch(() => undefined)));
    // A re-grade that fails must not take a graded call out of the numbers: put it back on its old grade.
    // It's stamped with the current version so the run doesn't retry it forever; a manual Re-grade still works.
    const ids = next.map((c) => c.id);
    const { data: after_ } = await supabase.from("calls").select("id, status, grade, error").in("id", ids);
    for (const c of (after_ || []) as { id: string; status: string; grade: Record<string, unknown> | null; error: string | null }[]) {
      if (c.status === "failed" && c.grade) {
        await supabase
          .from("calls")
          .update({ status: "graded", grade: { ...c.grade, grader_version: GRADER_VERSION, regrade_failed: true, regrade_failed_version: GRADER_VERSION, regrade_error: (c.error || "").slice(0, 400), regrade_tries: (Number(c.grade.regrade_failed_version) || 0) < GRADER_VERSION ? 1 : (Number(c.grade.regrade_tries) || 1) + 1 } })
          .eq("id", c.id);
      }
    }
    log("regrade-all", ids.join(","), started, `done; ${s.todo.length - next.length} left`);
    if (s.todo.length > next.length) await kick(request, "/api/calls/regrade-all", { background: true });
  });
  return NextResponse.json({ ok: true, remaining: s.todo.length }, { status: 202 });
}
