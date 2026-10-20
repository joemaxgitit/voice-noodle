import type { Supa } from "@/lib/callsServer";
import { langOf, type Transcript } from "@/lib/calls";
import { clientKey, numbered } from "@/lib/journey";

/*
  The server keeps the pipeline moving by itself -- nobody has to have a page
  open: transcribed -> grade (and translate a Spanish call); graded -> learn
  from it for the practice clients, re-grade any later call in the journey
  that didn't know about this one, refresh the journey read, and bring the
  practice voices up to date. Each step is its own request (own time limit),
  started with the same manager session that started the first one.
*/

export function kick(request: Request, path: string, body: Record<string, unknown>) {
  const auth = request.headers.get("authorization") || "";
  return fetch(new URL(path, request.url), {
    method: "POST",
    headers: { authorization: auth, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
}

/** After a transcript lands: grade it, and translate it if it's Spanish. */
export async function afterTranscribe(request: Request, supabase: Supa, callId: string) {
  const { data } = await supabase.from("calls").select("status, script_id, transcript").eq("id", callId).single();
  if (!data || data.status !== "transcribed") return;
  const jobs: Promise<unknown>[] = [];
  if (data.script_id) jobs.push(kick(request, "/api/calls/grade", { callId }));
  if (langOf((data.transcript as Transcript | null)?.language) === "es") jobs.push(kick(request, "/api/calls/translate", { callId }));
  await Promise.all(jobs);
}

/** After a real call is graded. */
export async function afterGrade(request: Request, supabase: Supa, callId: string) {
  const { data: me } = await supabase.from("calls").select("id, source, status, client_label, rep_id, retention").eq("id", callId).single();
  if (!me || me.status !== "graded" || me.source === "roleplay") return;
  const jobs: Promise<unknown>[] = [kick(request, "/api/calls/learn", { callId, background: true })];

  const label = (me.client_label as string | null)?.trim();
  if (label) {
    const [{ data: cs }, nums] = await Promise.all([
      supabase.from("calls").select("id, client_label, call_date, created_at, status, graded_at:grade->>graded_at").ilike("client_label", label).neq("source", "roleplay"),
      supabase.from("calls").select("id, call_number").ilike("client_label", label),
    ]);
    const num = new Map(((nums.data || []) as { id: string; call_number: number | null }[]).map((x) => [x.id, x.call_number]));
    type C = { id: string; client_label: string | null; call_date: string | null; created_at: string; status: string; graded_at: string | null };
    const list = numbered(
      ((cs || []) as C[]).map((c) => ({ ...c, call_number: num.get(c.id) ?? null, rep_id: null, outcome: null, outcome_manual: null, retention: null, score: null, slp_score: null }))
    );
    const mine = list.find((c) => c.id === callId);
    if (mine && list.length > 1) {
      // Later calls graded before this one was: re-grade them so they know the whole story.
      for (const c of list) if (c.n > mine.n && c.status === "graded" && c.graded_at && mine.graded_at && c.graded_at < mine.graded_at) jobs.push(kick(request, "/api/calls/grade", { callId: c.id }));
      // Journey read once the journey has 2+ graded calls and nothing else in it is still grading.
      const graded = list.filter((c) => c.status === "graded");
      const busy = list.some((c) => ["uploading", "uploaded", "transcribing", "grading"].includes(c.status) && c.id !== callId);
      if (graded.length >= 2 && !busy && clientKey(label)) jobs.push(kick(request, "/api/journeys/read", { clientLabel: label, background: true }));
    }
  }
  // A graded call with a known result (proven or cancelled) can sharpen the rep's own style.
  if (me.rep_id && ["graduated", "paid6", "cancelled"].includes((me.retention as string | null) ?? "")) jobs.push(kick(request, "/api/reps/fingerprint", { repId: me.rep_id, auto: true }));
  // Practice voices pick up anything new from real calls (free; skips voices already up to date).
  jobs.push(kick(request, "/api/roleplay/sync", { background: true }));
  await Promise.all(jobs);
}
