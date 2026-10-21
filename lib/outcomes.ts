import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * After a client's result changes (cancelled, 6+ payments, graduated), the
 * system refines itself: each affected rep's "Style that works" is re-read,
 * and the grader's lessons from proven sales vs cancels are refreshed (that
 * one waits until there are enough of both, and runs at most every 6 hours).
 * Everything else -- the close track record, Insights, archetypes, practice
 * clients -- reads the results directly.
 */
export async function afterOutcomes(supabase: SupabaseClient, repIds: (string | null | undefined)[]) {
  const token = (await supabase.auth.getSession()).data.session?.access_token ?? "";
  const post = (path: string, body: Record<string, unknown>) =>
    fetch(path, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const reps = [...new Set(repIds.filter((x): x is string => !!x))];
  await Promise.all([...reps.map((repId) => post("/api/reps/fingerprint", { repId, auto: true })), post("/api/calls/lessons", { auto: true })]);
}
