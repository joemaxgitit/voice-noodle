import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/callsServer";
import { askJsonCost } from "@/lib/repReview";
import { logSpend } from "@/lib/spendServer";
import { SESSION_SCHEMA, sessionPrompt, type CoachingSession, type CoachingTopic, type SessionDraft } from "@/lib/coaching";

export const runtime = "nodejs";
export const maxDuration = 60;

// A small, fast model is plenty for tidying a few lines of notes.
const MODEL = process.env.COACHING_MODEL || "claude-haiku-5-5";

/**
 * Tidies a manager's one-on-one notes into a summary, topics and
 * commitments. Saves nothing: the manager checks it, then saves.
 */
export async function POST(request: Request) {
  const ctx = await requireAdmin(request);
  if (ctx instanceof NextResponse) return ctx;
  const { supabase, orgId, userId } = ctx;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 500 });

  const body = (await request.json().catch(() => ({}))) as { repId?: string; notes?: string };
  const repId = String(body.repId || "");
  const notes = String(body.notes || "").trim().slice(0, 8000);
  if (!repId || !notes) return NextResponse.json({ error: "Write a few notes first." }, { status: 400 });

  const [{ data: rep }, { data: topics }, { data: last }] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", repId).maybeSingle(),
    supabase.from("coaching_topics").select("*").eq("archived", false).order("sort_order"),
    // Personal one-on-ones never go to Claude.
    supabase.from("coaching_sessions").select("*").eq("rep_id", repId).eq("private", false).order("session_date", { ascending: false }).order("created_at", { ascending: false }).limit(1),
  ]);
  const list = (topics || []) as CoachingTopic[];

  try {
    const { data, usd } = await askJsonCost<SessionDraft>(
      [{ type: "text", text: sessionPrompt({ rep: rep?.full_name || "the rep", notes, topics: list, last: ((last || [])[0] as CoachingSession) ?? null }) }],
      SESSION_SCHEMA,
      key,
      "Tidying the notes",
      2000,
      MODEL
    );
    await logSpend(supabase, { org_id: orgId, kind: "coaching", usd, user_id: userId, ref_id: repId });
    const names = new Set(list.map((t) => t.name));
    return NextResponse.json({
      ok: true,
      draft: { ...data, topics: (data.topics || []).filter((t) => names.has(t)), commitments: (data.commitments || []).filter(Boolean) },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
