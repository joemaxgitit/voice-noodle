import { NextResponse, after } from "next/server";
import { requireAdmin } from "@/lib/callsServer";
import { askJsonCost, REVIEW_MODEL } from "@/lib/repReview";
import { logSpend } from "@/lib/spendServer";
import { bestPool, pickBest } from "@/lib/bestCall";
import { correctionsFor, digest, type DigestRow } from "@/lib/callDigest";
import { clock } from "@/lib/calls";
import { SHORT_LABEL, type Quick } from "@/lib/quick";
import { fmtTime, type DayReview } from "@/lib/dayReview";

export const runtime = "nodejs";
export const maxDuration = 300;

/*
  One day of one rep's calls, read together -- built for a bad day: every
  full call, voicemail and short call from that date in order, measured
  against the rep's own best call. Saved in rep_reviews (inputs.day_review)
  but kept apart from the overall coaching reviews and the Reps list.
*/

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "story", "mood", "opening", "slipping", "per_call", "coach_now", "questions_to_ask"],
  properties: {
    headline: { type: "string" },
    story: { type: "string" },
    mood: { type: "string" },
    opening: { type: "string" },
    slipping: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["title", "evidence", "vs_best", "fix"], properties: { title: { type: "string" }, evidence: { type: "string" }, vs_best: { type: "string" }, fix: { type: "string" } } },
    },
    per_call: { type: "array", items: { type: "object", additionalProperties: false, required: ["n", "line"], properties: { n: { type: "integer" }, line: { type: "string" } } } },
    coach_now: { type: "array", items: { type: "object", additionalProperties: false, required: ["skill", "drill"], properties: { skill: { type: "string" }, drill: { type: "string" } } } },
    questions_to_ask: { type: "array", items: { type: "string" } },
  },
};

type Row = DigestRow & { status: string; created_at: string; kind?: string | null; quick?: Quick | null; call_time?: string | null; script_id: string | null; handoff: string | null };

export async function POST(request: Request) {
  const ctx = await requireAdmin(request);
  if (ctx instanceof NextResponse) return ctx;
  const { supabase, userId, orgId } = ctx;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 500 });

  const body = (await request.json().catch(() => ({}))) as { repId?: string; day?: string; focus?: string };
  const repId = String(body.repId || "");
  const day = String(body.day || "");
  if (!repId || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return NextResponse.json({ error: "Pick a rep and a day." }, { status: 400 });
  const focus = (body.focus || "").trim().slice(0, 600) || null;

  const base = "id, client_label, call_date, created_at, duration_secs, slp_score, score, grade, retention, outcome, status, script_id, handoff";
  const get = (cols: string) => supabase.from("calls").select(cols).eq("rep_id", repId).eq("call_date", day).neq("source", "roleplay");
  let q = await get(`${base}, kind, quick, call_time`);
  if (q.error) q = await get(base);
  if (q.error) return NextResponse.json({ error: q.error.message }, { status: 500 });
  const all = (q.data || []) as unknown as Row[];
  const busy = all.filter((c) => !["graded", "read", "failed"].includes(c.status)).length;
  const calls = all
    .filter((c) => (c.status === "graded" && c.grade) || (c.status === "read" && c.quick))
    .sort((a, b) => (a.call_time ?? a.created_at.slice(11, 16)).localeCompare(b.call_time ?? b.created_at.slice(11, 16)) || a.created_at.localeCompare(b.created_at));
  if (!calls.length) return NextResponse.json({ error: busy ? `${busy} call${busy === 1 ? " is" : "s are"} still being transcribed or graded for that day -- try again in a few minutes.` : "No graded calls for that rep on that day." }, { status: 400 });

  const { data: rep } = await supabase.from("profiles").select("full_name").eq("id", repId).maybeSingle();
  const pool = await bestPool(supabase, repId);
  const best = pickBest(pool.rows.filter((c) => c.call_date !== day), pool.renewScripts).find((p) => p.kind === "regular") ?? null;
  let bestText = "(no enrolled call on file yet to compare with)";
  if (best) {
    const { data: b } = await supabase.from("calls").select("id, client_label, call_date, duration_secs, slp_score, score, grade, retention, outcome").eq("id", best.call.id).maybeSingle();
    if (b) bestText = `${b.call_date ?? ""}\n${digest(b as unknown as DigestRow)}`;
  }

  const list: DayReview["calls"] = calls.map((c, i) => {
    const qk = c.quick;
    const what = qk ? (qk.kind === "voicemail" ? `voicemail ${qk.score}` : SHORT_LABEL[qk.what]) : `${c.outcome ?? "call"} · SLP ${c.slp_score ?? "--"}`;
    return { n: i + 1, id: c.id, time: c.call_time ?? null, what };
  });
  const fixes = await correctionsFor(supabase, [
    ...calls.filter((c) => c.grade).map((c) => ({ id: c.id, graded_at: (c.grade as { graded_at?: string } | null)?.graded_at ?? null })),
    ...(best ? [{ id: best.call.id }] : []),
  ]);
  if (best && fixes.get(best.call.id)) bestText += `\n${fixes.get(best.call.id)}`;
  const lines = calls.map((c, i) => {
    const head = `#${i + 1} ${c.call_time ? fmtTime(c.call_time) : ""} · ${clock(c.duration_secs)}`;
    const qk = c.quick;
    if (qk?.kind === "voicemail") return `${head} · VOICEMAIL (score ${qk.score}/100; mood ${qk.mood}/10 ${qk.mood_word}): ${qk.said} -- ${qk.read}${qk.flag ? ` FLAG: ${qk.flag}` : ""}`;
    if (qk?.kind === "short") return `${head} · SHORT CALL, ${SHORT_LABEL[qk.what]} (mood ${qk.mood}/10 ${qk.mood_word}): opening ${qk.opening}; ended ${qk.ended_at != null ? `at ${clock(qk.ended_at)}` : ""} by ${qk.ended_by} -- ${qk.read}`;
    return `${head} · FULL CALL\n${digest(c)}${fixes.get(c.id) ? `\n${fixes.get(c.id)}` : ""}`;
  });

  const prompt = `A sales manager at a debt-relief company wants to understand one day for one sales rep -- usually a bad day, where the rep isn't closing. Below is every call the rep made that day that has been read, in order: full calls graded against the script and Jordan Belfort's Straight Line method, plus voicemails and short calls (under a minute and a half) that only got a quick read of what happened and the rep's mood. Then the rep's own best call, for comparison -- what they do on their best day.

REP: ${rep?.full_name ?? "the rep"}
DAY: ${day}${busy ? ` (${busy} more call${busy === 1 ? " is" : "s are"} still processing and not included)` : ""}
${focus ? `THE MANAGER ASKED YOU TO LOOK ESPECIALLY AT: ${focus}\n` : ""}
THE DAY'S CALLS, IN ORDER:
${lines.join("\n\n")}

THE REP'S BEST CALL (their own model):
${bestText}

Write the day review:
- headline: one plain sentence on what went wrong (or right) today.
- story: 2-4 sentences on how the day went from first call to last -- did it start well and fade, never get going, fall apart after a bad call?
- mood: the rep's energy and certainty through the day, from the voicemails, short calls and voice notes, with times. Say plainly if it dropped and when.
- opening: what the short calls and hang-ups say about the opening (how far it gets, when clients drop). "" if there were none.
- slipping: 1-4 places deals slipped today, most important first. title; evidence (which calls, by #number and time); vs_best (what the rep did on their best call at that same point); fix (the one change for tomorrow).
- per_call: one plain line per call worth a comment, by its #number (skip voicemails with nothing notable).
- coach_now: 1-3 things to work on before the next shift, each with a quick drill (a script section to practice, a mock client, or listening back to a moment of their best call).
- questions_to_ask: 2-4 questions for the manager to ask the rep about today.
Rules: plain English, no jargon, no shorthand like "n=", no client names. Never mention sales numbers, KPIs, closing ratio, rank or rotation. Be specific and kind -- a bad day happens; name the fix.`;

  const { data: row, error: ie } = await supabase
    .from("rep_reviews")
    .insert({ org_id: orgId, rep_id: repId, created_by: userId, status: "working", period_from: day, period_to: day, focus, model: REVIEW_MODEL, inputs: { day_review: 1, calls: calls.filter((c) => !c.quick).length, quick: calls.filter((c) => c.quick).length } })
    .select("id")
    .single();
  if (ie || !row) return NextResponse.json({ error: ie?.message || "Couldn't start the review." }, { status: 500 });

  after(async () => {
    try {
      const { data, usd } = await askJsonCost<Omit<DayReview, "day" | "calls">>([{ type: "text", text: prompt }], SCHEMA, key, "The day review", 8000);
      const arr = <T,>(x: T[] | undefined) => (Array.isArray(x) ? x : []);
      const str = (x: unknown) => (typeof x === "string" ? x : "");
      const review: DayReview = {
        headline: str(data.headline),
        story: str(data.story),
        mood: str(data.mood),
        opening: str(data.opening),
        slipping: arr(data.slipping),
        per_call: arr(data.per_call),
        coach_now: arr(data.coach_now),
        questions_to_ask: arr(data.questions_to_ask),
        day,
        calls: list,
      };
      await supabase.from("rep_reviews").update({ status: "done", review, finished_at: new Date().toISOString() }).eq("id", row.id);
      await logSpend(supabase, { org_id: orgId, kind: "review", usd, user_id: userId, ref_id: repId });
    } catch (e) {
      await supabase
        .from("rep_reviews")
        .update({ status: "failed", error: (e instanceof Error ? e.message : String(e)).slice(0, 1000), finished_at: new Date().toISOString() })
        .eq("id", row.id);
    }
  });
  return NextResponse.json({ ok: true, id: row.id }, { status: 202 });
}
