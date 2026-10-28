import { WORDING_NOTE } from "@/lib/approvedWording";
import { NextResponse } from "next/server";
import { compare, digest, formatValue, favouring, MIN_FOR_FINDINGS, type InsightCall, asProven } from "@/lib/insights";
import { requireAdmin, thinkingFor } from "@/lib/callsServer";
import { gradeCostUsd } from "@/lib/calls";
import { logSpend } from "@/lib/spendServer";
import { plainCounts } from "@/lib/plain";

export const runtime = "nodejs";
export const maxDuration = 300;

const MODEL = process.env.GRADER_MODEL || "claude-sonnet-5-5";
const PER_GROUP = 30; // most recent calls of each kind sent to the drafter

/**
 * Drafts lessons from graduates' vs cancelled clients' enrollment calls.
 * Returns the draft for a manager to review and save on the Insights page.
 * With { auto: true } (sent by itself whenever new cancels or proven sales
 * come in) it also saves the lessons straight into grading, so the grader
 * keeps refining itself -- at most every 6 hours, and only once there are
 * enough proven and cancelled calls to compare.
 */
export async function POST(request: Request) {
  const ctx = await requireAdmin(request);
  if (ctx instanceof NextResponse) return ctx;
  const { supabase, orgId, userId } = ctx;
  const input = (await request.json().catch(() => ({}))) as { auto?: boolean };
  const auto = !!input.auto;
  if (auto) {
    const { data: g } = await supabase.from("grading_guidance").select("updated_at").eq("org_id", orgId).maybeSingle();
    if (g?.updated_at && Date.now() - new Date(g.updated_at as string).getTime() < 6 * 3600_000) return NextResponse.json({ skipped: "refreshed in the last 6 hours" });
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 500 });

  const { data, error } = await supabase
    .from("calls")
    .select("id, retention, score, slp_score, grade, created_at")
    .in("retention", ["graduated", "paid6", "cancelled"])
    .not("grade", "is", null)
    .order("created_at", { ascending: false })
    .limit(400);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // "Made 6+ payments" counts as a proven sale, the same as graduated.
  const calls = asProven((data || []) as unknown as (InsightCall & { retention: string })[]) as InsightCall[];
  const grads = calls.filter((c) => c.retention === "graduated");
  const cancels = calls.filter((c) => c.retention === "cancelled");
  // Automatic refresh only once there's enough to compare -- no spend before then.
  if (auto && (grads.length < MIN_FOR_FINDINGS || cancels.length < MIN_FOR_FINDINGS))
    return NextResponse.json({ skipped: `needs ${MIN_FOR_FINDINGS} proven and ${MIN_FOR_FINDINGS} cancelled calls (have ${grads.length} and ${cancels.length})` });
  if (!grads.length || !cancels.length) {
    return NextResponse.json(
      { error: "Mark at least one graded enrollment call Graduated and one Cancelled first." },
      { status: 400 }
    );
  }

  const stats = compare(calls)
    .filter((m) => m.gap !== null)
    .sort((a, b) => Math.abs(favouring(b) ?? 0) - Math.abs(favouring(a) ?? 0))
    .slice(0, 25)
    .map(
      (m) =>
        `${m.group} / ${m.label}: proven ${formatValue(m, m.graduated)} (from ${m.nGraduated} calls) vs cancelled ${formatValue(m, m.cancelled)} (from ${m.nCancelled} calls)`
    )
    .join("\n");

  const small = grads.length < MIN_FOR_FINDINGS || cancels.length < MIN_FOR_FINDINGS;

  const prompt = WORDING_NOTE + `A sales manager at a debt-relief company wants to learn what separates the enrollment calls of PROVEN sales -- clients who GRADUATED (finished the program -- out of debt, usually with a 700+ credit score) or made MORE THAN 6 PAYMENTS (stuck with it; just as valuable) -- from the enrollment calls of clients who CANCELLED. Every call below was already graded against the company's script and Jordan Belfort's Straight Line method, including an emotional roadmap of the call.

There are ${grads.length} proven (graduated or 6+ payments) and ${cancels.length} cancelled calls.${
    small ? ` That is a small sample: only state a lesson when the difference is clear, and say "early pattern" in its support.` : ""
  }

<differences>
${stats}
</differences>

<graduated_calls>
${grads.slice(0, PER_GROUP).map((c, i) => `#${i + 1}\n${digest(c)}`).join("\n\n")}
</graduated_calls>

<cancelled_calls>
${cancels.slice(0, PER_GROUP).map((c, i) => `#${i + 1}\n${digest(c)}`).join("\n\n")}
</cancelled_calls>

Write 3 to 8 lessons a call grader can apply to future enrollment calls. Each lesson:
- one plain sentence about what the rep did or what the client showed, that tends to come before graduation or before cancellation;
- support: the evidence in a few words, with counts where you can ("client restated the program in 7/9 graduates vs 2/8 cancels").
Rules:
- Only patterns that genuinely differ between the groups. Do not restate the script or general sales advice.
- Never write a lesson that rewards pressure, rushing, overstated claims, or closing a client who was confused or could not afford it. Compliance problems stay problems even if a pressured client happened to graduate.
- Graduates enrolled long ago, often on an older version of the script, so judge the substance (understanding, certainty, the emotional roadmap), not whether exact script wording was used.
- Do not mention reps by name.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
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
                items: {
                  type: "object",
                  required: ["lesson", "support"],
                  additionalProperties: false,
                  properties: { lesson: { type: "string" }, support: { type: "string" } },
                },
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
    let message = raw.slice(0, 300);
    try {
      message = JSON.parse(raw)?.error?.message || message;
    } catch {
      // not JSON
    }
    return NextResponse.json({ error: `Drafting failed (${res.status}). ${message}` }, { status: 502 });
  }

  const out = (await res.json()) as { content?: { type: string; text?: string }[]; usage?: Parameters<typeof gradeCostUsd>[1] };
  await logSpend(supabase, { org_id: orgId, kind: "lessons", usd: gradeCostUsd(MODEL, out.usage ?? {}) ?? 0, user_id: userId });
  try {
    const parsed = JSON.parse(out.content?.find((c) => c.type === "text")?.text || "{}") as {
      lessons?: { lesson: string; support: string }[];
    };
    const lines = (parsed.lessons ?? []).map((l) => plainCounts(`- ${l.lesson.trim()} (${l.support.trim()})`));
    if (auto && lines.length && grads.length >= MIN_FOR_FINDINGS && cancels.length >= MIN_FOR_FINDINGS) {
      await supabase.from("grading_guidance").upsert({ org_id: orgId, lessons: lines.join("\n"), updated_by: userId, updated_at: new Date().toISOString() });
      return NextResponse.json({ saved: true, graduated: grads.length, cancelled: cancels.length });
    }
    return NextResponse.json({ draft: lines.join("\n"), graduated: grads.length, cancelled: cancels.length });
  } catch {
    return NextResponse.json({ error: "The draft could not be read. Try again." }, { status: 502 });
  }
}
