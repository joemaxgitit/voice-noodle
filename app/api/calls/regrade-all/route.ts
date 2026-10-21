import { NextResponse, after } from "next/server";
import { requireAdmin, log } from "@/lib/callsServer";
import { CURRENT_FROM, GRADER_VERSION, prepareGrade } from "@/lib/gradeCall";
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

type Row = { id: string; status: string; call_date: string | null; created_at: string; updated_at: string; ver: string | null; script_id: string | null };

async function stale(supabase: Awaited<ReturnType<typeof requireAdmin>> extends infer T ? (T extends { supabase: infer S } ? S : never) : never) {
  const { data, error } = await supabase
    .from("calls")
    .select("id, status, call_date, created_at, updated_at, script_id, ver:grade->>grader_version")
    .in("status", ["graded", "grading"])
    .not("transcript", "is", null)
    .not("script_id", "is", null)
    .limit(5000);
  if (error) return { error: error.message, todo: [] as Row[], grading: 0 };
  const rows = (data || []) as Row[];
  // Renew calls (scripts that continue into another) may need a newer version than the rest.
  const { data: sc } = await supabase.from("scripts").select("id, continues_into");
  const renew = new Set(((sc || []) as { id: string; continues_into: string | null }[]).filter((x) => x.continues_into).map((x) => x.id));
  const old = rows.filter((r) => (Number(r.ver) || 1) < (renew.has(r.script_id ?? "") ? CURRENT_FROM.renew : CURRENT_FROM.other));
  const recent = Date.now() - 10 * 60_000;
  return {
    error: "",
    // Oldest call first, so a client's journey is re-read in order.
    todo: old.filter((r) => r.status === "graded").sort((a, b) => (a.call_date || a.created_at).localeCompare(b.call_date || b.created_at)),
    grading: rows.filter((r) => r.status === "grading" && new Date(r.updated_at).getTime() > recent).length,
  };
}

export async function GET(request: Request) {
  const ctx = await requireAdmin(request);
  if (ctx instanceof NextResponse) return ctx;
  const s = await stale(ctx.supabase);
  if (s.error) return NextResponse.json({ error: s.error }, { status: 500 });
  return NextResponse.json({ version: GRADER_VERSION, remaining: s.todo.length, grading: s.grading });
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

  const preps: { run: () => Promise<void> }[] = [];
  for (const c of next) {
    const prep = await prepareGrade(supabase, c.id, key, started);
    if (prep.ok && !prep.already) preps.push(prep);
    else if (!prep.ok) {
      // Can't be re-graded (no script, no transcript...): mark it so the run moves past it.
      const { data: g } = await supabase.from("calls").select("grade").eq("id", c.id).maybeSingle();
      if (g?.grade) await supabase.from("calls").update({ grade: { ...(g.grade as Record<string, unknown>), grader_version: GRADER_VERSION, regrade_failed: true } }).eq("id", c.id);
    }
  }
  after(async () => {
    await Promise.all(preps.map((p) => p.run().catch(() => undefined)));
    // A re-grade that fails must not take a graded call out of the numbers: put it back on its old grade.
    // It's stamped with the current version so the run doesn't retry it forever; a manual Re-grade still works.
    const ids = next.map((c) => c.id);
    const { data: after_ } = await supabase.from("calls").select("id, status, grade").in("id", ids);
    for (const c of (after_ || []) as { id: string; status: string; grade: Record<string, unknown> | null }[]) {
      if (c.status === "failed" && c.grade) {
        await supabase
          .from("calls")
          .update({ status: "graded", grade: { ...c.grade, grader_version: GRADER_VERSION, regrade_failed: true } })
          .eq("id", c.id);
      }
    }
    log("regrade-all", ids.join(","), started, `done; ${s.todo.length - next.length} left`);
    if (s.todo.length > next.length) await kick(request, "/api/calls/regrade-all", { background: true });
  });
  return NextResponse.json({ ok: true, remaining: s.todo.length }, { status: 202 });
}
