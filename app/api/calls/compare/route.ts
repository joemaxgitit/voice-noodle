import { NextResponse } from "next/server";
import { requireAdmin, thinkingFor } from "@/lib/callsServer";
import { gradeCostUsd } from "@/lib/calls";
import { digest, type DigestRow as Row } from "@/lib/callDigest";
import { logSpend } from "@/lib/spendServer";
import { plainWords } from "@/lib/plain";
import { clientKey, numbered, type JourneyCall } from "@/lib/journey";

export const runtime = "nodejs";
export const maxDuration = 120;

const MODEL = process.env.GRADER_MODEL || "claude-sonnet-5-5";

/**
 * "What's the difference?" -- where call B went off compared with call A
 * (usually the rep's best call), in plain words with the times on both.
 */
export async function POST(request: Request) {
  const ctx = await requireAdmin(request);
  if (ctx instanceof NextResponse) return ctx;
  const { supabase, orgId, userId } = ctx;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 500 });
  const input = (await request.json().catch(() => ({}))) as { a?: string; b?: string; clientA?: string; clientB?: string };
  if (input.clientA && input.clientB) return journeys(supabase, key, orgId, userId, input.clientA.trim(), input.clientB.trim());
  const { a, b } = input;
  if (!a || !b) return NextResponse.json({ error: "Two calls are needed." }, { status: 400 });
  const { data, error } = await supabase.from("calls").select("id, client_label, call_date, duration_secs, slp_score, score, grade, retention, outcome").in("id", [a, b]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const A = (data || []).find((x) => x.id === a) as Row | undefined;
  const B = (data || []).find((x) => x.id === b) as Row | undefined;
  if (!A?.grade || !B?.grade) return NextResponse.json({ error: "Both calls need a grade first." }, { status: 400 });

  const prompt = `A sales manager at a debt-relief company is comparing two graded calls by the same sales rep. Call A is the model -- usually the rep's own best call. Call B is the one being coached. Both were graded against the company script and Jordan Belfort's Straight Line method.

<call_a>
${digest(A)}
</call_a>

<call_b>
${digest(B)}
</call_b>

Write what call B is missing compared with call A, so the manager can coach it in a few minutes:
- 3 to 6 short points, most important first. Each one: what A did, what B did instead, and the time on each call in square brackets, like "[A 9:40]" and "[B 4:15]", so the manager can play both moments.
- Then one line starting "Biggest single fix:".
Rules: plain English, no jargon or shorthand, no client names, no scores restated as the point itself. If B was a different kind of call (a callback, a hang-up before the pitch), say so and compare only what both calls reached. Plain text only: each point on its own line starting with "- ".`;

  return ask(supabase, key, orgId, userId, prompt, b);
}

type Supa = Awaited<ReturnType<typeof requireAdmin>> extends infer T ? (T extends { supabase: infer S } ? S : never) : never;

/** Two clients' whole journeys: every graded call with each client ID, in order. */
async function journeys(supabase: Supa, key: string, orgId: string, userId: string, la: string, lb: string) {
  const load = async (label: string) => {
    const { data } = await supabase
      .from("calls")
      .select("id, client_label, call_date, call_time, created_at, call_number, rep_id, rep_name, status, outcome, outcome_manual, retention, duration_secs, slp_score, score, grade, profiles:rep_id(full_name)")
      .ilike("client_label", label)
      .neq("source", "roleplay")
      .eq("status", "graded");
    const { data: jr } = await supabase.from("client_journeys").select("read").eq("client_key", clientKey(label)).maybeSingle();
    return { calls: numbered((data || []) as unknown as (JourneyCall & Row & { rep_name: string | null; profiles: { full_name: string | null } | null })[]), read: (jr as { read: { story?: string; decided_it?: string } } | null)?.read ?? null };
  };
  const [A, B] = await Promise.all([load(la), load(lb)]);
  if (!A.calls.length || !B.calls.length) return NextResponse.json({ error: "Both clients need at least one graded call." }, { status: 400 });
  const text = (j: typeof A) =>
    j.calls
      .map((c) => `CALL ${c.n} -- ${c.call_date || c.created_at.slice(0, 10)}, rep ${c.profiles?.full_name || c.rep_name || "?"}\n${digest(c)}`)
      .join("\n\n") + (j.read?.story ? `\n\nJOURNEY READ: ${j.read.story} What decided it: ${j.read.decided_it ?? ""}` : "");
  const prompt = `A sales manager at a debt-relief company is comparing two clients' whole journeys -- every call with each client, in order. Journey A is the model (usually a sale that stuck); journey B is the one being coached. Every call was graded against the company script and Jordan Belfort's Straight Line method. More than half of this team's sales take more than one call, so how a lead is carried from call to call matters as much as any single call.

<journey_a>
${text(A)}
</journey_a>

<journey_b>
${text(B)}
</journey_b>

Write what journey B is missing compared with journey A, so the manager can coach it in a few minutes:
- 3 to 6 short points, most important first, about the journey as a whole: how the first call set up the next, how the stall was handled and whether the rep got to the bottom of it, how firm the next step was, how long between calls, whether the rep re-opened by rebuilding the pain and certainty or jumped to paperwork, a hand-off to another rep, and where each journey was decided. Name the calls, like "(A call 2)" and "(B call 1, 12:30)".
- Then one line starting "Biggest single fix:".
Rules: plain English, no jargon or shorthand, no client names, no scores restated as the point itself. If B is still open, say what the next call needs to do. Plain text only: each point on its own line starting with "- ".`;
  return ask(supabase, key, orgId, userId, prompt, null);
}

async function ask(supabase: Supa, key: string, orgId: string, userId: string, prompt: string, ref: string | null) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 4000, ...thinkingFor(MODEL), messages: [{ role: "user", content: prompt }] }),
    signal: AbortSignal.timeout(100_000),
  });
  if (!res.ok) {
    const raw = await res.text().catch(() => "");
    let message = raw.slice(0, 300);
    try {
      message = JSON.parse(raw)?.error?.message || message;
    } catch {
      // not JSON
    }
    return NextResponse.json({ error: `Comparison failed (${res.status}). ${message}` }, { status: 502 });
  }
  const out = (await res.json()) as { content?: { type: string; text?: string }[]; usage?: Record<string, number> };
  const text = plainWords((out.content || []).filter((c) => c.type === "text").map((c) => c.text || "").join("").trim());
  const cost = gradeCostUsd(MODEL, out.usage ?? {});
  if (cost) await logSpend(supabase, { org_id: orgId, kind: "compare", usd: cost, user_id: userId, ref_id: ref });
  return NextResponse.json({ text, cost });
}
