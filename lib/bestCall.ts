import type { SupabaseClient } from "@supabase/supabase-js";
import { PROVEN, type Retention } from "@/lib/calls";

/*
  A rep's best call: the one to hand them as the model of their own best day.
  From every real call ever graded for them, enrolled only, never a client who
  cancelled, with the recording still on file. Ranked by the Straight Line
  score; a client who made 6+ payments (or graduated) adds 10, a fragile
  close takes 5 off. Two picks: their best regular call and their best Renew.
  A manager can pin a different call; a pin wins until it's taken off.
*/

export type BestKind = "regular" | "renew";

export type BestRow = {
  id: string;
  rep_id: string | null;
  client_label: string | null;
  call_date: string | null;
  created_at: string;
  duration_secs: number | null;
  slp_score: number | null;
  score: number | null;
  retention: Retention | null;
  close_quality: string | null;
  script_id: string | null;
  handoff: string | null;
  audio_path: string | null;
  best_pin?: boolean | null;
};

export type BestPick = { kind: BestKind; call: BestRow; rank: number; proven: boolean; pinned: boolean; pool: number; why: string };

export const PROVEN_BONUS = 10;
export const FRAGILE_PENALTY = 5;

export function rankOf(c: BestRow): number {
  return (c.slp_score ?? 0) + (c.retention && PROVEN.includes(c.retention) ? PROVEN_BONUS : 0) - (c.close_quality === "fragile" ? FRAGILE_PENALTY : 0);
}

const COLS = "id, rep_id, client_label, call_date, created_at, duration_secs, slp_score, score, retention, close_quality:grade->>close_quality, script_id, handoff, audio_path";

/** The calls that can be a best call, for one rep (or every rep when repId is null). */
export async function bestPool(supabase: SupabaseClient, repId: string | null): Promise<{ rows: BestRow[]; renewScripts: Set<string>; pinCol: boolean; error: string }> {
  const q = (cols: string) => {
    let x = supabase
      .from("calls")
      .select(cols)
      .eq("status", "graded")
      .neq("source", "roleplay")
      .eq("outcome", "enrolled")
      .not("audio_path", "is", null)
      .not("slp_score", "is", null)
      .limit(5000);
    if (repId) x = x.eq("rep_id", repId);
    return x;
  };
  let pinCol = true;
  let res = await q(`${COLS}, best_pin`);
  if (res.error && /best_pin/.test(res.error.message)) {
    pinCol = false;
    res = await q(COLS);
  }
  const { data: sc } = await supabase.from("scripts").select("id, title, continues_into");
  const renewScripts = new Set(((sc || []) as { id: string; title: string; continues_into: string | null }[]).filter((s) => s.continues_into || /renew/i.test(s.title)).map((s) => s.id));
  const rows = ((res.data || []) as unknown as BestRow[]).filter((c) => c.retention !== "cancelled");
  return { rows, renewScripts, pinCol, error: res.error?.message ?? "" };
}

export const kindOf = (c: Pick<BestRow, "script_id" | "handoff">, renewScripts: Set<string>): BestKind => (renewScripts.has(c.script_id ?? "") || c.handoff === "renew" ? "renew" : "regular");

/** The best regular and best Renew call among one rep's calls. */
export function pickBest(rows: BestRow[], renewScripts: Set<string>): BestPick[] {
  const out: BestPick[] = [];
  for (const kind of ["regular", "renew"] as const) {
    const pool = rows.filter((c) => kindOf(c, renewScripts) === kind);
    if (!pool.length) continue;
    const pinned = pool.find((c) => c.best_pin);
    const sorted = [...pool].sort((a, b) => rankOf(b) - rankOf(a) || (b.score ?? 0) - (a.score ?? 0));
    const call = pinned ?? sorted[0];
    const proven = !!call.retention && PROVEN.includes(call.retention);
    const why = pinned
      ? "Pinned by a manager."
      : `Highest Straight Line score of ${pool.length} enrolled call${pool.length === 1 ? "" : "s"}${proven ? `, plus ${PROVEN_BONUS} because the client made 6+ payments` : ""}${call.close_quality === "fragile" ? `, minus ${FRAGILE_PENALTY} for a fragile close` : ""}.`;
    out.push({ kind, call, rank: rankOf(call), proven, pinned: !!pinned, pool: pool.length, why });
  }
  return out;
}
