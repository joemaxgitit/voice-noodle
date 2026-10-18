import { NextResponse, after } from "next/server";
import { requireAdmin } from "@/lib/callsServer";
import { loadRepHistory } from "@/lib/repHistory";
import { askForReview, buildReviewInput, REVIEW_MODEL } from "@/lib/repReview";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Starts a coaching review of one rep. Returns the review id at once; the
 * reading and writing happen in after(), and the page polls rep_reviews.
 * Uses the manager's own token, so row level security still applies.
 */
export async function POST(request: Request) {
  const ctx = await requireAdmin(request);
  if (ctx instanceof NextResponse) return ctx;
  const { supabase, userId, orgId } = ctx;

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 500 });

  const body = (await request.json().catch(() => ({}))) as { repId?: string; days?: number; focus?: string };
  const repId = String(body.repId || "");
  if (!repId) return NextResponse.json({ error: "No rep id." }, { status: 400 });
  const days = Number(body.days) || 0;
  const since = days > 0 ? new Date(Date.now() - days * 86400000).toISOString() : null;
  const focus = (body.focus || "").trim().slice(0, 600) || null;

  const { data: rep, error: re } = await supabase.from("profiles").select("full_name").eq("id", repId).maybeSingle();
  if (re || !rep) return NextResponse.json({ error: re?.message || "That rep wasn't found." }, { status: 404 });

  const { data: row, error: ie } = await supabase
    .from("rep_reviews")
    .insert({
      org_id: orgId,
      rep_id: repId,
      created_by: userId,
      status: "working",
      period_from: since ? since.slice(0, 10) : null,
      period_to: new Date().toISOString().slice(0, 10),
      focus,
      model: REVIEW_MODEL,
    })
    .select("id")
    .single();
  if (ie || !row) return NextResponse.json({ error: ie?.message || "Couldn't start the review." }, { status: 500 });

  after(async () => {
    try {
      const { history } = await loadRepHistory(supabase, repId);
      const { content, inputs } = await buildReviewInput({ supabase, history, repId, repName: rep.full_name || "this rep", since, focus });
      await supabase.from("rep_reviews").update({ inputs }).eq("id", row.id);
      const review = await askForReview(content, key);
      await supabase.from("rep_reviews").update({ status: "done", review, finished_at: new Date().toISOString() }).eq("id", row.id);
    } catch (e) {
      await supabase
        .from("rep_reviews")
        .update({ status: "failed", error: (e instanceof Error ? e.message : String(e)).slice(0, 1000), finished_at: new Date().toISOString() })
        .eq("id", row.id);
    }
  });

  return NextResponse.json({ ok: true, id: row.id }, { status: 202 });
}
