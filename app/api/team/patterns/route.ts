import { NextResponse, after } from "next/server";
import { requireAdmin, thinkingFor } from "@/lib/callsServer";
import { gradeCostUsd } from "@/lib/calls";
import { TEAM_MIN_REPS, type FingerprintRow, type TeamPattern } from "@/lib/fingerprint";

export const runtime = "nodejs";
export const maxDuration = 300;

/*
  Team-proven patterns: from every rep's latest "style that works", the
  things that show up in proven sales across 3 or more reps. Offered to
  reps as things worth trying, never required. About 5 cents a run.
*/

const MODEL = process.env.REVIEW_MODEL || "claude-sonnet-5-5";
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["patterns"],
  properties: {
    patterns: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["pattern", "how_it_sounds", "reps", "evidence"],
        properties: { pattern: { type: "string" }, how_it_sounds: { type: "string" }, reps: { type: "array", items: { type: "string" } }, evidence: { type: "string" } },
      },
    },
  },
} as const;

export async function POST(request: Request) {
  const ctx = await requireAdmin(request);
  if (ctx instanceof NextResponse) return ctx;
  const { supabase, orgId, userId } = ctx;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 500 });
  const input = (await request.json().catch(() => ({}))) as { background?: boolean };
  if (input.background) {
    after(() => findPatterns(supabase, orgId, userId, key).then(() => undefined));
    return NextResponse.json({ ok: true }, { status: 202 });
  }
  const r = await findPatterns(supabase, orgId, userId, key);
  return NextResponse.json(r.body, { status: r.status });
}

type Db = Awaited<ReturnType<typeof requireAdmin>> extends infer T ? (T extends { supabase: infer S } ? S : never) : never;

async function findPatterns(supabase: Db, orgId: string, userId: string, key: string): Promise<{ status: number; body: Record<string, unknown> }> {

  const { data, error } = await supabase.from("rep_fingerprints").select("id, rep_id, created_at, inputs, body, usd").order("created_at", { ascending: false }).limit(400);
  if (error) return { status: 500, body: { error: error.message } };
  const latest = new Map<string, FingerprintRow>();
  for (const f of (data || []) as FingerprintRow[]) if (!latest.has(f.rep_id)) latest.set(f.rep_id, f);
  if (latest.size < TEAM_MIN_REPS)
    return { status: 400, body: { error: `Team patterns need at least ${TEAM_MIN_REPS} reps with a "Style that works" -- there ${latest.size === 1 ? "is" : "are"} ${latest.size} so far.` } };

  const text = [...latest.values()]
    .map((f) => `<rep id="${f.rep_id}" proven="${f.inputs.proven ?? "?"}" cancelled="${f.inputs.cancelled ?? "?"}">\n${f.body.markers.map((m) => `- ${m.marker}: ${m.how_it_sounds} (in ${m.in_proven} proven, ${m.in_cancels} cancels)`).join("\n")}\n</rep>`)
    .join("\n");

  const res = await fetch(`${process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com"}/v1/messages`, {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 5000,
      ...thinkingFor(MODEL),
      output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA } },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Below is each sales rep's own "style that works" -- markers found in that rep's proven sales (clients who graduated or made 6+ payments) and not their cancels. Find the TEAM-PROVEN patterns: the same underlying behaviour showing up in the markers of at least ${TEAM_MIN_REPS} different reps, even if each rep does it in their own way. For each: pattern (a short name), how_it_sounds (the common core, concrete enough for any rep to try in their own words), reps (the rep ids it showed up for -- at least ${TEAM_MIN_REPS}), evidence (one line). Don't count a behaviour that's really just one rep's personality. Strongest first, at most 8. If none reach ${TEAM_MIN_REPS} reps, return an empty list.`,
            },
            { type: "text", text },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(280_000),
  });
  if (!res.ok) return { status: 500, body: { error: `Couldn't find team patterns (${res.status}). ${(await res.text().catch(() => "")).slice(0, 200)}` } };
  const out = (await res.json()) as { content?: { type: string; text?: string }[]; usage?: Record<string, number> };
  const raw = (out.content || []).filter((c) => c.type === "text").map((c) => c.text || "").join("");
  let patterns: TeamPattern[] = [];
  try {
    patterns = (JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as { patterns: TeamPattern[] }).patterns.filter((p) => new Set(p.reps.filter((r) => latest.has(r))).size >= TEAM_MIN_REPS);
  } catch {
    return { status: 500, body: { error: "The result came back unreadable. Try again." } };
  }
  const usd = gradeCostUsd(MODEL, out.usage ?? {});
  const { error: insErr } = await supabase.from("team_patterns").insert({ org_id: orgId, created_by: userId, body: { patterns, reps: latest.size }, usd });
  if (insErr) return { status: 500, body: { error: /team_patterns|does not exist/i.test(insErr.message) ? "Run supabase/team-patterns.sql first." : insErr.message } };
  return { status: 200, body: { ok: true, found: patterns.length, usd } };
}
