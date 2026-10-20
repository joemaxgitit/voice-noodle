import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/callsServer";
import { learnFromCall } from "@/lib/learnServer";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Keeps an anonymous client profile from one graded real call, for the
 * practice clients (lib/learn.ts). Called in the background by the Calls
 * page once a call is graded. Body: { callId }.
 */
export async function POST(request: Request) {
  const ctx = await requireAdmin(request);
  if (ctx instanceof NextResponse) return ctx;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 500 });
  const callId = String(((await request.json().catch(() => ({}))) as { callId?: string }).callId || "");
  if (!callId) return NextResponse.json({ error: "No call id." }, { status: 400 });
  const r = await learnFromCall(ctx.supabase, ctx.orgId, callId, key);
  return NextResponse.json(r, { status: r.ok ? 200 : 500 });
}
