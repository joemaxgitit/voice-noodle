import { NextResponse } from "next/server";
import { requireAdmin, thinkingFor, type Supa } from "@/lib/callsServer";
import { gradeCostUsd } from "@/lib/calls";
import { logSpend } from "@/lib/spendServer";
import { plainCounts } from "@/lib/plain";
import { clientKey } from "@/lib/journey";
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
  const { data } = await supabase
    .from("calls")
    .select("id, client_label, call_date, created_at, outcome, outcome_manual, score, grade")
    .in("script_id", ids)
    .eq("status", "graded")
    .neq("source", "roleplay")
    .not("grade", "is", null)
    .order("created_at", { ascending: false })
    .limit(600);
  const calls = (data || []) as unknown as LearnCall[];
  const keys = [...new Set(calls.map((c) => clientKey(c.client_label)).filter(Boolean))];
  const leads = new Map<string, LeadResult>();
  for (let i = 0; i < keys.length; i += 300) {
    const { data: r } = await supabase.rpc("lead_results", { p_leads: keys.slice(i, i + 300) });
    for (const x of (r || []) as LeadResult[]) leads.set(x.lead, x);
  }
  return { labeled: labelCalls(dept, calls, leads), total: calls.length };
}

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
  const { error } = await supabase
    .from("dept_guidance")
    .upsert({ org_id: orgId, dept, lessons: lines.join("\n"), good_n: good.length, bad_n: bad.length, updated_at: new Date().toISOString() });
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
};
