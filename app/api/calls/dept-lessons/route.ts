import { NextResponse } from "next/server";
import { requireAdmin, thinkingFor, type Supa } from "@/lib/callsServer";
import { gradeCostUsd } from "@/lib/calls";
import { logSpend } from "@/lib/spendServer";
import { plainCounts } from "@/lib/plain";
import { clientKey } from "@/lib/journey";
import { prepareGrade } from "@/lib/gradeCall";
import { coachMatch, keyedCalls } from "@/lib/benchmarkServer";
import { BENCH_MIN, BENCH_TOLERANCE, agreementOf, compare, rulesHash } from "@/lib/benchmark";
import { DEPT_MIN, DEPT_WORDS, LOWER_IS_BETTER, deptMetrics, digestCall, labelCalls, type LearnCall, type LearnDept, type LeadResult } from "@/lib/deptLearning";

export const runtime = "nodejs";
export const maxDuration = 300;

const MODEL = process.env.GRADER_MODEL || "claude-sonnet-5-5";
const PER_GROUP = 25;
const EVERY_MS = 6 * 3600_000;

/*
  Self-tuning for Service and Openers (lib/deptLearning.ts).
  GET ?dept=: the results, what separates good calls from bad ones, and the
  lessons the grader is using now -- for the Insights page.
  POST {dept, auto}: writes new lessons from good vs bad calls and puts them
  straight into grading. Sent by itself after each graded call of that
  department; runs at most every 6 hours, and only once there are enough
  calls with a known result on both sides. Compliance is never learned away.
*/

const isDept = (d: unknown): d is LearnDept => d === "service" || d === "openers";

async function gather(supabase: Supa, dept: LearnDept) {
  const { data: sc } = await supabase.from("scripts").select("id, team");
  const ids = ((sc || []) as { id: string; team: string | null }[]).filter((s) => (dept === "openers" ? s.team === "openers" : s.team === "ams")).map((s) => s.id);
  if (!ids.length) return { labeled: [], total: 0 };
  const q = (cols: string) =>
    supabase.from("calls").select(cols).in("script_id", ids).eq("status", "graded").neq("source", "roleplay").not("grade", "is", null).order("created_at", { ascending: false }).limit(600);
  // The phone column comes with supabase/call-phone.sql; before that, lead IDs only.
  let res = await q("id, phone, client_label, call_date, created_at, outcome, outcome_manual, score, grade");
  if (res.error) res = await q("id, client_label, call_date, created_at, outcome, outcome_manual, score, grade");
  const calls = (res.data || []) as unknown as LearnCall[];
  const keys = [...new Set(calls.map((c) => clientKey(c.client_label)).filter(Boolean))];
  const leads = new Map<string, LeadResult>();
  for (let i = 0; i < keys.length; i += 300) {
    const { data: r } = await supabase.rpc("lead_results", { p_leads: keys.slice(i, i + 300) });
    for (const x of (r || []) as LeadResult[]) leads.set(x.lead, x);
  }
  // And by phone: the same client in every department, whatever lead ID each system gave them.
  const phones = [...new Set(calls.map((c) => c.phone).filter(Boolean))] as string[];
  for (let i = 0; i < phones.length; i += 300) {
    const { data: r } = await supabase.rpc("phone_results", { p_phones: phones.slice(i, i + 300) });
    for (const x of (r || []) as (Omit<LeadResult, "lead"> & { phone: string })[]) leads.set(`p:${x.phone}`, { ...x, lead: `p:${x.phone}` });
  }
  return { labeled: labelCalls(dept, calls, leads), total: calls.length };
}

/**
 * Grades every answer-key call of this department with these lessons (never
 * saved onto the calls) and returns how often the grader agreed with the
 * manager. All calls at once, so it fits in one request.
 */
async function testLessons(supabase: Supa, apiKey: string, dept: LearnDept, lessons: string, keyed: Awaited<ReturnType<typeof keyedCalls>>) {
  let usd = 0;
  const all = await Promise.all(
    keyed.map(async (k) => {
      try {
        const prep = await prepareGrade(supabase, k.call_id, apiKey, Date.now(), { dryRun: true, deptLessons: lessons });
        if (!prep.ok || prep.already) return [];
        const out = await prep.run();
        if (!out) return [];
        usd += out.usd ?? 0;
        const g = out.grade;
        const cm = await coachMatch(apiKey, k.key.coach_first ?? "", g.coach_now?.priority.title ? `${g.coach_now.priority.title}. ${g.coach_now.priority.next_call}` : g.coaching_priorities?.[0] ?? "");
        usd += cm.usd;
        return compare(k.key, g, cm.score);
      } catch {
        return [];
      }
    })
  );
  void dept;
  return { agreement: agreementOf(all.flat()), usd };
}

const lessonsHash = (lessons: string | null | undefined, keyed: { call_id: string }[]) =>
  // The lessons and which calls are in the key: either changing means testing again.
  `${rulesHash((lessons ?? "").split("\n").map((rule) => ({ rule })))}:${rulesHash(keyed.map((k) => ({ rule: k.call_id })).sort((a, b) => a.rule.localeCompare(b.rule)))}`;

export async function GET(request: Request) {
  const ctx = await requireAdmin(request);
  if (ctx instanceof NextResponse) return ctx;
  const dept = new URL(request.url).searchParams.get("dept");
  if (!isDept(dept)) return NextResponse.json({ error: "Which department?" }, { status: 400 });
  const { labeled, total } = await gather(ctx.supabase, dept);
  const { data: g, error } = await ctx.supabase.from("dept_guidance").select("lessons, good_n, bad_n, updated_at").eq("dept", dept).maybeSingle();
  return NextResponse.json({
    setup: error && /dept_guidance|lead_results/.test(error.message) ? "Run supabase/dept-learning.sql in the Supabase SQL Editor first." : null,
    total,
    good: labeled.filter((c) => c.label === "good").length,
    bad: labeled.filter((c) => c.label === "bad").length,
    min: DEPT_MIN,
    metrics: deptMetrics(dept, labeled).slice(0, 30),
    lessons: (g as { lessons: string | null } | null)?.lessons ?? null,
    updated_at: (g as { updated_at: string } | null)?.updated_at ?? null,
    keyed: (await keyedCalls(ctx.supabase, dept)).length,
    keyMin: BENCH_MIN,
    test: await ctx.supabase
      .from("dept_guidance")
      .select("key_agreement, last_test")
      .eq("dept", dept)
      .maybeSingle()
      .then(({ data }) => (data as { key_agreement: number | null; last_test: string | null } | null) ?? null, () => null),
  });
}

export async function POST(request: Request) {
  const ctx = await requireAdmin(request);
  if (ctx instanceof NextResponse) return ctx;
  const { supabase, orgId, userId } = ctx;
  const body = (await request.json().catch(() => ({}))) as { dept?: string; auto?: boolean };
  const dept = body.dept;
  if (!isDept(dept)) return NextResponse.json({ error: "Which department?" }, { status: 400 });
  const auto = body.auto !== false;

  const { data: g0, error: gErr } = await supabase.from("dept_guidance").select("updated_at, good_n, bad_n").eq("dept", dept).maybeSingle();
  if (gErr) return NextResponse.json({ skipped: "run supabase/dept-learning.sql first" });
  const prev = g0 as { updated_at: string; good_n: number; bad_n: number } | null;
  if (auto && prev?.updated_at && Date.now() - new Date(prev.updated_at).getTime() < EVERY_MS) return NextResponse.json({ skipped: "refreshed in the last 6 hours" });

  const { labeled } = await gather(supabase, dept);
  const good = labeled.filter((c) => c.label === "good");
  const bad = labeled.filter((c) => c.label === "bad");
  // Nothing to spend on until there's enough on both sides, or nothing new since last time.
  if (good.length < DEPT_MIN || bad.length < DEPT_MIN) return NextResponse.json({ skipped: `needs ${DEPT_MIN} good and ${DEPT_MIN} bad calls (have ${good.length} and ${bad.length})` });
  if (auto && prev && prev.good_n === good.length && prev.bad_n === bad.length) return NextResponse.json({ skipped: "no new results" });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 500 });

  const w = DEPT_WORDS[dept];
  const stats = deptMetrics(dept, labeled)
    .slice(0, 25)
    .map((m) => `${m.group} / ${m.label}${LOWER_IS_BETTER.has(m.label) ? " (lower is better)" : ""}: good calls ${m.good}% (${m.nGood}) vs bad calls ${m.bad}% (${m.nBad})`)
    .join("\n");

  const prompt = `You are helping ${w.who} learn what separates good calls from bad ones, judged by what actually happened afterwards. The calls are ${w.calls}. Every call below was already graded against the company's script.

GOOD = ${w.good}. BAD = ${w.bad}.
There are ${good.length} good and ${bad.length} bad calls.

<differences>
${stats || "(not enough calls on each side for per-item numbers yet)"}
</differences>

<good_calls>
${good.slice(0, PER_GROUP).map((c, i) => `#${i + 1}\n${digestCall(c)}`).join("\n\n")}
</good_calls>

<bad_calls>
${bad.slice(0, PER_GROUP).map((c, i) => `#${i + 1}\n${digestCall(c)}`).join("\n\n")}
</bad_calls>

Write 3 to 8 lessons the call grader can apply to future calls of this kind. Each lesson:
- one plain sentence about what the rep did (or what the client showed) that tends to come before a good or a bad result;
- support: the evidence in a few words, with counts where you can ("tie-down after the rebuttal in 9/12 good calls vs 3/11 bad").
Rules:
- Only patterns that genuinely differ between the groups. Don't restate the script or general advice.
- Disclaimers and word-for-word script lines are legal requirements. Never write a lesson that makes skipping, rushing or softening them acceptable, even if calls that skipped them did well.
- Never reward pressure, overstated claims, or pushing a client who was confused or said no clearly.
- A result also depends on the lead and on luck: only state a lesson when the difference is clear, and say "early pattern" when the numbers are small.
- No names of reps or clients.`;

  const res = await fetch(`${process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com"}/v1/messages`, {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      ...thinkingFor(MODEL),
      output_config: {
        effort: "high",
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            required: ["lessons"],
            additionalProperties: false,
            properties: {
              lessons: {
                type: "array",
                items: { type: "object", required: ["lesson", "support"], additionalProperties: false, properties: { lesson: { type: "string" }, support: { type: "string" } } },
              },
            },
          },
        },
      },
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(240_000),
  });
  if (!res.ok) {
    const raw = await res.text().catch(() => "");
    return NextResponse.json({ error: `Writing lessons failed (${res.status}). ${raw.slice(0, 300)}` }, { status: 502 });
  }
  const out = (await res.json()) as { content?: { type: string; text?: string }[]; usage?: Parameters<typeof gradeCostUsd>[1] };
  await logSpend(supabase, { org_id: orgId, kind: "lessons", usd: gradeCostUsd(MODEL, out.usage ?? {}) ?? 0, user_id: userId });
  let lines: string[] = [];
  try {
    const parsed = JSON.parse(out.content?.find((c) => c.type === "text")?.text || "{}") as { lessons?: { lesson: string; support: string }[] };
    lines = (parsed.lessons ?? []).map((l) => plainCounts(`- ${l.lesson.trim()} (${l.support.trim()})`));
  } catch {
    return NextResponse.json({ error: "The lessons could not be read. Try again." }, { status: 502 });
  }
  if (!lines.length) return NextResponse.json({ skipped: "no clear lessons yet" });
  const next = lines.join("\n");
  const row: Record<string, unknown> = { org_id: orgId, dept, lessons: next, good_n: good.length, bad_n: bad.length, updated_at: new Date().toISOString() };

  /*
    The answer key keeps it honest: with enough of this department's calls
    graded by hand, the new lessons only go live if the grader agrees with
    the manager at least about as often as with the lessons before. Each test
    re-grades every keyed call (about 20 cents a call).
  */
  const keyed = await keyedCalls(supabase, dept);
  if (keyed.length >= BENCH_MIN) {
    const { data: cur } = await supabase.from("dept_guidance").select("lessons, key_agreement, key_hash").eq("dept", dept).maybeSingle();
    const c = cur as { lessons: string | null; key_agreement: number | null; key_hash: string | null } | null;
    const [cand, base] = await Promise.all([
      testLessons(supabase, key, dept, next, keyed),
      c?.key_hash === lessonsHash(c?.lessons, keyed) && c?.key_agreement !== null && c?.key_agreement !== undefined
        ? Promise.resolve({ agreement: c.key_agreement, usd: 0 })
        : testLessons(supabase, key, dept, c?.lessons ?? "", keyed),
    ]);
    const spent = cand.usd + base.usd;
    if (spent > 0) await logSpend(supabase, { org_id: orgId, kind: "benchmark", usd: spent, user_id: userId });
    const when = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Los_Angeles" });
    if (cand.agreement !== null && base.agreement !== null && cand.agreement < base.agreement - BENCH_TOLERANCE) {
      // Held back: keep the lessons in use, remember why.
      await supabase
        .from("dept_guidance")
        .upsert({ org_id: orgId, dept, lessons: c?.lessons ?? null, good_n: good.length, bad_n: bad.length, key_agreement: base.agreement, key_hash: lessonsHash(c?.lessons, keyed), last_test: `${when}: new lessons held back -- the grader agreed with your answer key ${cand.agreement}% of the time with them vs ${base.agreement}% without.` });
      return NextResponse.json({ held: true, candidate: cand.agreement, current: base.agreement });
    }
    Object.assign(row, {
      key_agreement: cand.agreement,
      key_hash: lessonsHash(next, keyed),
      last_test: `${when}: tested on ${keyed.length} answer-key calls -- ${cand.agreement ?? "?"}% agreement with your answers (${base.agreement ?? "?"}% before).`,
    });
  }
  let { error } = await supabase.from("dept_guidance").upsert(row);
  // Before supabase/dept-answer-key.sql has run there are no test columns: save the lessons anyway.
  if (error && /key_|last_test/.test(error.message)) {
    delete row.key_agreement;
    delete row.key_hash;
    delete row.last_test;
    ({ error } = await supabase.from("dept_guidance").upsert(row));
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ saved: true, good: good.length, bad: bad.length });
}

export type DeptLessonsView = {
  setup: string | null;
  total: number;
  good: number;
  bad: number;
  min: number;
  metrics: ReturnType<typeof deptMetrics>;
  lessons: string | null;
  updated_at: string | null;
  keyed: number;
  keyMin: number;
  test: { key_agreement: number | null; last_test: string | null } | null;
};
