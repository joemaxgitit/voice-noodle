import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/callsServer";
import { rewriteRules, rulesState } from "@/lib/gradingRulesServer";

export const runtime = "nodejs";
export const maxDuration = 300;

/*
  The standing grading rules from every correction (lib/gradingRulesServer.ts).
  They rewrite themselves just before the next call is graded; this is for the
  Insights page. GET: the rules and whether corrections came in since.
  POST {force: true}: rewrite now.
*/

export async function GET(request: Request) {
  const ctx = await requireAdmin(request);
  if (ctx instanceof NextResponse) return ctx;
  const s = await rulesState(ctx.supabase);
  if (s.error) return NextResponse.json({ error: s.error }, { status: 500 });
  return NextResponse.json({ rules: s.rules, updated_at: s.updated_at, count: s.count, stale: s.stale });
}

export async function POST(request: Request) {
  const ctx = await requireAdmin(request);
  if (ctx instanceof NextResponse) return ctx;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 500 });
  const body = (await request.json().catch(() => ({}))) as { force?: boolean };
  const r = await rewriteRules(ctx.supabase, key, ctx.orgId, ctx.userId, !!body.force);
  if (r.error) return NextResponse.json({ error: r.error }, { status: 502 });
  return NextResponse.json({ ok: true, ...r });
}
