import { NextResponse } from "next/server";
import { requireMember } from "@/lib/roleplayServer";

/*
  The scores behind a rep's "next best move", from ALL their graded calls
  (real and practice). Reps can't read their real calls directly -- those
  hold client details and stay manager-only -- so this hands back only the
  per-section hit/partial/missed marks, the Straight Line score and the
  hardship timing. No transcripts, names or notes ever leave the server.

  A manager viewing a rep passes ?rep=<id> and reads with their own access.
*/

export const dynamic = "force-dynamic";

const COLS =
  "source,created_at,slp_score,sections:grade->sections,hardship_at:grade->spotlights->hardship->moved_on_at,followup_kind:grade->spotlights->followup->>kind";

type Row = { source: string | null; created_at: string; slp_score: number | null; sections: { section?: string; status?: string }[] | null; hardship_at: number | null; followup_kind: string | null };

export async function GET(request: Request) {
  const who = await requireMember(request);
  if (who instanceof NextResponse) return who;
  const rep = new URL(request.url).searchParams.get("rep");

  let rows: Row[] = [];
  if (rep && rep !== who.userId) {
    if (!who.isAdmin) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
    const { data, error } = await who.supabase.from("calls").select(COLS).eq("rep_id", rep).eq("status", "graded").order("created_at", { ascending: false }).limit(30);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    rows = (data || []) as unknown as Row[];
  } else {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!key || !base) return NextResponse.json({ calls: [] });
    const q = new URLSearchParams({ select: COLS, rep_id: `eq.${who.userId}`, org_id: `eq.${who.orgId}`, status: "eq.graded", order: "created_at.desc", limit: "30" });
    const res = await fetch(`${base}/rest/v1/calls?${q}`, { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return NextResponse.json({ error: `Could not load your scores (${res.status}).` }, { status: 500 });
    rows = (await res.json()) as Row[];
  }

  // Only the marks: section name and status.
  const calls = rows.map((r) => ({
    source: r.source,
    created_at: r.created_at,
    slp_score: r.slp_score,
    hardship_at: typeof r.hardship_at === "number" ? r.hardship_at : null,
    followup_kind: r.followup_kind,
    sections: Array.isArray(r.sections) ? r.sections.map((s) => ({ section: String(s?.section ?? ""), status: String(s?.status ?? "") })) : null,
  }));
  return NextResponse.json({ calls });
}
