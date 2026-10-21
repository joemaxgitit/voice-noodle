import { NextResponse, after } from "next/server";
import { requireAdmin, log } from "@/lib/callsServer";
import { LEARN_VERSION, learnFromCall } from "@/lib/learnServer";
import { kick } from "@/lib/chain";

export const runtime = "nodejs";
export const maxDuration = 300;

/*
  When the learning step starts reading something new (LEARN_VERSION bumped),
  every graded real call is re-read once, four at a time, by itself. About a
  third of a cent a call. Started from the Calls page; picks up where it left
  off on the next visit if it ever stops.

  GET: how many are left. POST { background: true }: read the next batch and keep going.
*/

const PER_RUN = 4;

type Db = Awaited<ReturnType<typeof requireAdmin>> extends infer T ? (T extends { supabase: infer S } ? S : never) : never;

async function todo(supabase: Db) {
  const [c, i] = await Promise.all([
    supabase.from("calls").select("id, call_date, created_at").eq("status", "graded").neq("source", "roleplay").not("transcript", "is", null).limit(5000),
    supabase.from("client_insights").select("call_id, ver:profile->>learn_version, kind").limit(5000),
  ]);
  if (c.error) return { error: c.error.message, ids: [] as string[] };
  if (i.error) return { error: i.error.message, ids: [] as string[] };
  const done = new Set(((i.data || []) as { call_id: string; ver: string | null; kind: string }[]).filter((x) => x.kind === "skip" || (Number(x.ver) || 1) >= LEARN_VERSION).map((x) => x.call_id));
  const ids = ((c.data || []) as { id: string; call_date: string | null; created_at: string }[])
    .filter((x) => !done.has(x.id))
    .sort((a, b) => (a.call_date || a.created_at).localeCompare(b.call_date || b.created_at))
    .map((x) => x.id);
  return { error: "", ids };
}

export async function GET(request: Request) {
  const ctx = await requireAdmin(request);
  if (ctx instanceof NextResponse) return ctx;
  const t = await todo(ctx.supabase);
  if (t.error) return NextResponse.json({ error: t.error }, { status: 500 });
  return NextResponse.json({ version: LEARN_VERSION, remaining: t.ids.length });
}

export async function POST(request: Request) {
  const started = Date.now();
  const ctx = await requireAdmin(request);
  if (ctx instanceof NextResponse) return ctx;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 500 });
  const t = await todo(ctx.supabase);
  if (t.error) return NextResponse.json({ error: t.error }, { status: 500 });
  const next = t.ids.slice(0, PER_RUN);
  if (!next.length) return NextResponse.json({ ok: true, remaining: 0 });
  after(async () => {
    const rs = await Promise.all(next.map((id) => learnFromCall(ctx.supabase, ctx.orgId, id, key).catch((e) => ({ ok: false, error: String(e) }))));
    log("relearn-all", next.join(","), started, `${rs.filter((r) => r.ok).length}/${next.length} read; ${t.ids.length - next.length} left`);
    // Stop if every one failed (the next Calls visit tries again), so a broken step can't loop.
    if (rs.some((r) => r.ok) && t.ids.length > next.length) await kick(request, "/api/calls/relearn-all", { background: true });
  });
  return NextResponse.json({ ok: true, remaining: t.ids.length }, { status: 202 });
}
