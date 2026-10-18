import type { SupabaseClient } from "@supabase/supabase-js";

/** Records a paid action. Never throws: a logging hiccup must not fail the work. */
export async function logSpend(
  supabase: SupabaseClient,
  row: { org_id: string; kind: string; usd: number; user_id?: string | null; ref_id?: string | null; note?: string | null }
) {
  if (!(row.usd > 0)) return;
  try {
    await supabase.from("spend_log").insert({ ...row, usd: Math.round(row.usd * 100000) / 100000 });
  } catch {
    // ignore
  }
}
