import type { SupabaseClient } from "@supabase/supabase-js";
import { gradeCostUsd, OUTCOME_LABEL, type Outcome } from "@/lib/calls";
import { thinkingFor } from "@/lib/callsServer";
import { compareRep, fmtChange, fmtKpi, fmtMonth, KIND_LABEL, monthlyReports, type KpiRow } from "@/lib/kpi";
import { TAG_LABEL, type HistCall, type RepHistory, type ReviewBody } from "@/lib/repHistory";
import { readSheet, sheetAsText } from "@/lib/xlsx";

/*
  The coaching review: Claude reads everything on record about one rep --
  graded calls (real and practice), KPI reports month by month, manager
  notes and files, knowledge checks, training and attendance -- and writes
  the overall arc for the managers. Managers only; the rep never sees it.
*/

export const REVIEW_MODEL = process.env.REVIEW_MODEL || process.env.GRADER_MODEL || "claude-sonnet-5-5";

const trendItem = {
  type: "object",
  additionalProperties: false,
  required: ["title", "evidence", "since", "action"],
  properties: {
    title: { type: "string" },
    evidence: { type: "string" },
    since: { type: "string" },
    action: { type: "string" },
  },
};

export const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "trajectory",
    "headline",
    "arc",
    "slipping",
    "improving",
    "focus_next",
    "kpi_read",
    "kpi_talking_points",
    "compliance_watch",
    "questions_to_ask",
    "data_gaps",
    "core",
  ],
  properties: {
    // The voice, tone, script and Straight Line view: what core-mode managers see.
    core: {
      type: "object",
      additionalProperties: false,
      required: ["trajectory", "headline", "arc", "slipping", "improving", "focus_next", "questions_to_ask"],
      properties: {
        trajectory: { type: "string", enum: ["improving", "steady", "slipping", "mixed", "early"] },
        headline: { type: "string" },
        arc: { type: "string" },
        slipping: { type: "array", items: trendItem },
        improving: { type: "array", items: trendItem },
        focus_next: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["skill", "why", "drill"],
            properties: { skill: { type: "string" }, why: { type: "string" }, drill: { type: "string" } },
          },
        },
        questions_to_ask: { type: "array", items: { type: "string" } },
      },
    },
    trajectory: { type: "string", enum: ["improving", "steady", "slipping", "mixed", "early"] },
    headline: { type: "string" },
    arc: { type: "string" },
    slipping: { type: "array", items: trendItem },
    improving: { type: "array", items: trendItem },
    focus_next: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["skill", "why", "drill"],
        properties: { skill: { type: "string" }, why: { type: "string" }, drill: { type: "string" } },
      },
    },
    kpi_read: { type: "string" },
    kpi_talking_points: { type: "array", items: { type: "string" } },
    compliance_watch: { type: "array", items: { type: "string" } },
    questions_to_ask: { type: "array", items: { type: "string" } },
    data_gaps: { type: "string" },
  },
};

const day = (iso: string) => iso.slice(0, 10);
const cut = (s: string | null | undefined, n: number) => (!s ? "" : s.length > n ? `${s.slice(0, n)}…` : s);

export function callLine(c: HistCall, personas: Map<string, string>): string {
  const kind = c.source === "roleplay" ? `PRACTICE with mock client ${personas.get(c.persona_id || "") || "?"}` : `REAL client call${c.client_label ? ` (${c.client_label})` : ""}`;
  const outcome = (c.outcome_manual || c.outcome) as Outcome | null;
  const parts = [
    `${day(c.call_date || c.created_at)} | ${kind}`,
    `script score ${c.score ?? "--"} | Straight Line ${c.slp_score ?? "--"}`,
    outcome ? `outcome ${OUTCOME_LABEL[outcome] ?? outcome}` : "",
    c.close_quality && c.close_quality !== "n/a" ? `close ${c.close_quality}` : "",
    c.duration_secs ? `${Math.round(Number(c.duration_secs) / 60)} min` : "",
    c.spotlights?.hardship ? `hardship moved on at ${Math.round(c.spotlights.hardship.moved_on_at / 60)} min (target 8-12)` : "",
    c.spotlights?.turndown?.happened ? `loan turndown pickup ${c.spotlights.turndown.pickup}, options even ${c.spotlights.turndown.options_even}, client back up ${c.spotlights.turndown.recovered}` : "",
  ].filter(Boolean);
  const lines = [parts.join(" | ")];
  const skills = (c.slp ?? []).filter((s) => typeof s.score === "number").map((s) => `${s.skill} ${s.score}`);
  if (skills.length) lines.push(`  skills (1-10): ${skills.join(", ")}`);
  if (c.three_tens) lines.push(`  three tens: product ${c.three_tens.product ?? "-"}, rep ${c.three_tens.rep ?? "-"}, company ${c.three_tens.company ?? "-"}`);
  const missed = (c.sections ?? []).filter((s) => s.status === "missed").map((s) => s.section);
  if (missed.length) lines.push(`  script sections missed: ${missed.join(", ")}`);
  const comp = (c.compliance ?? []).filter((x) => x.status === "no").map((x) => `${x.item}${x.evidence ? ` ("${cut(x.evidence, 100)}")` : ""}`);
  if (comp.length) lines.push(`  COMPLIANCE MISSES: ${comp.join("; ")}`);
  const flags = (c.flags ?? []).filter((f) => f.severity === "high" || f.severity === "medium").map((f) => `[${f.severity}] ${cut(f.issue, 140)}`);
  if (flags.length) lines.push(`  flags: ${flags.join("; ")}`);
  if (c.tonality) lines.push(`  tonality: ${cut(c.tonality, 220)}`);
  if (c.strengths?.length) lines.push(`  strengths: ${c.strengths.slice(0, 3).map((s) => cut(s, 140)).join(" / ")}`);
  if (c.coaching?.length) lines.push(`  coaching priorities: ${c.coaching.slice(0, 3).map((s) => cut(s, 160)).join(" / ")}`);
  if (c.slp_summary || c.summary) lines.push(`  summary: ${cut(c.slp_summary || c.summary, 320)}`);
  return lines.join("\n");
}

function kpiText(h: RepHistory, repId: string): string {
  const rowsByReport = new Map<string, KpiRow[]>();
  for (const r of h.kpiRows) rowsByReport.set(r.report_id, [...(rowsByReport.get(r.report_id) ?? []), r]);
  const out: string[] = [];
  for (const [, byMonth] of monthlyReports(h.kpiReports)) {
    const months = [...byMonth.keys()].sort().filter((m) => (rowsByReport.get(byMonth.get(m)!.id) ?? []).some((r) => r.rep_id === repId));
    if (!months.length) continue;
    const latest = byMonth.get(months.at(-1)!)!;
    const prev = months.length > 1 ? byMonth.get(months.at(-2)!)! : null;
    out.push(`${KIND_LABEL[latest.kind] ?? latest.title} ("${latest.title}") -- months on record: ${months.map((m) => fmtMonth(m)).join(", ")}`);
    // the rep's value per month for every category
    const recent = months.slice(-6);
    for (const c of latest.columns) {
      if (c.type === "name" || c.type === "text") continue;
      const vals = recent.map((m) => {
        const row = (rowsByReport.get(byMonth.get(m)!.id) ?? []).find((r) => r.rep_id === repId);
        return `${fmtMonth(m, false)} ${fmtKpi(row?.data[c.key], c.type)}`;
      });
      out.push(`  ${c.label}: ${vals.join(" → ")}`);
    }
    const moves = compareRep({
      repId,
      cur: latest,
      prev,
      curRows: rowsByReport.get(latest.id) ?? [],
      prevRows: prev ? rowsByReport.get(prev.id) ?? [] : [],
      prefs: h.prefs,
    });
    out.push(`  Latest month vs the one before, with team rank and team average (direction = which way is better):`);
    for (const m of moves)
      out.push(
        `    ${m.label} [${m.better === "up" ? "higher better" : m.better === "down" ? "lower better" : "neutral"}]: ${fmtChange(m)}; rank ${m.rank ?? "-"} of ${m.of}; team avg ${fmtKpi(m.teamAvg, m.type)}${m.notable ? (m.good ? "  << notable gain" : m.good === false ? "  << notable drop" : "") : ""}`
      );
  }
  return out.join("\n");
}

export type Block = { type: "text"; text: string } | { type: "image" | "document"; source: { type: "base64"; media_type: string; data: string } };

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

/** Manager-uploaded files: sheets and text as text, PDFs and images as themselves. */
export async function fileBlocks(supabase: SupabaseClient, h: RepHistory, since: string | null): Promise<{ blocks: Block[]; read: number; skipped: string[] }> {
  const blocks: Block[] = [];
  const skipped: string[] = [];
  let budget = 18 * 1024 * 1024;
  let read = 0;
  const files = h.files.filter((f) => !since || f.created_at >= since).slice(0, 25);
  for (const f of files) {
    const label = `FILE "${f.name}" uploaded ${day(f.created_at)}${f.note ? ` -- manager's note: ${f.note}` : ""}`;
    const size = Number(f.size_bytes || 0);
    const mime = (f.mime || "").toLowerCase();
    const isSheet = /\.(xlsx|csv)$/i.test(f.name);
    const isText = /^text\//.test(mime) || /\.(txt|md)$/i.test(f.name);
    const isPdf = mime === "application/pdf" || /\.pdf$/i.test(f.name);
    const isImg = IMAGE_TYPES.includes(mime);
    if (!(isSheet || isText || isPdf || isImg) || size > budget || (isImg && size > 5 * 1024 * 1024)) {
      skipped.push(f.name);
      blocks.push({ type: "text", text: `${label} (not readable here -- name only)` });
      continue;
    }
    const { data, error } = await supabase.storage.from("rep-files").download(f.path);
    if (error || !data) {
      skipped.push(f.name);
      continue;
    }
    const bytes = new Uint8Array(await data.arrayBuffer());
    budget -= bytes.length;
    read++;
    if (isSheet) {
      try {
        blocks.push({ type: "text", text: `${label}\n${sheetAsText(readSheet(f.name, bytes), 150)}` });
      } catch {
        blocks.push({ type: "text", text: `${label} (spreadsheet could not be read)` });
      }
    } else if (isText) {
      blocks.push({ type: "text", text: `${label}\n${cut(new TextDecoder().decode(bytes), 20000)}` });
    } else {
      blocks.push({ type: "text", text: label });
      blocks.push({
        type: isPdf ? "document" : "image",
        source: { type: "base64", media_type: isPdf ? "application/pdf" : mime, data: Buffer.from(bytes).toString("base64") },
      });
    }
  }
  return { blocks, read, skipped };
}

const INSTRUCTIONS = `You are the sales coaching analyst for ProEdge Solutions (Lionside Financial), a debt relief company. Reps sell on the phone using Jordan Belfort's Straight Line Persuasion: the emotional roadmap of the call, tonality, looping, and the three tens (certainty in the product, the rep, and the company). The managers (Max, Pat, Kevin) asked for an honest read on one rep's overall arc so they can catch problems before they get worse and call out what's getting better.

You get, newest first: graded calls (REAL client calls and PRACTICE calls with AI mock clients -- weigh real calls more for production, practice calls for skill-building effort), monthly KPI numbers from the CRM with team rank, the managers' private notes and files, knowledge-check results, training completions and Master Your Craft attendance, and the previous review if there was one.

How to write it:
- Lead with what matters. Be direct and specific, like a sharp sales manager talking to another manager. No filler, no praise sandwich.
- Every trend needs evidence: dates, scores, the KPI move, a quote from a note. If the evidence is thin (say, two calls), say so instead of overcalling it.
- Connect the dots across sources when the data supports it: a falling looping score alongside a falling closing ratio, cancels rising while "close quality: fragile" keeps appearing, a concern in the notes that the calls confirm or contradict.
- "slipping": things getting worse or stuck below where they should be, oldest-first evidence showing the slide, and a concrete action for the manager. "improving": real gains worth naming to the rep.
- "focus_next": at most three skills, each with a specific drill (a script section to practice in the trainer, a mock client to call, a Master Your Craft topic).
- "kpi_read": a paragraph on the KPI picture month to month. "kpi_talking_points": short lines the manager can say in the monthly one-on-one, wins first, then the moves to talk through, each with the numbers.
- "compliance_watch": any compliance misses or high flags, especially repeated ones. Empty if none -- don't invent any.
- "questions_to_ask": 2-4 questions for the one-on-one that would surface what the data can't show.
- "trajectory": improving, steady, slipping, mixed, or early (not enough data yet).
- "since" is when a trend started (a date or month) or "" if unclear; "action" is "" for improving trends if nothing is needed.
- "data_gaps": what is missing that would sharpen this (no KPI reports, no real calls graded lately, etc.). "" if nothing.
- Never put a client's personal or banking details in the review.
- Spotlights: each call line may show how long the rep stayed in hardship before moving on (this team's target is 8-12 minutes from the start of the call) and how they picked the client back up after the loan turndown (pickup strength, whether the three options were first laid out evenly). Give these two moments special attention -- name a pattern if one shows up across calls -- but weigh them alongside everything else, never instead of it.
- "core": a SECOND, separate version of the review for coaches who only see voice, tone, script and Straight Line training. Same fields, but built ONLY from the graded calls (real and practice), their Straight Line, script, tonality and voice measurements, script practice drills, knowledge checks and training cards. In "core", never mention or hint at deals, sales numbers, closing ratio, conversion, KPIs, rank, retention or cancellations, rotation, the Deal Clip, attendance, one-on-ones, or manager notes and files -- not even indirectly ("despite strong numbers"). Judge trajectory from the calls alone. If there are few or no graded calls in the window, say so plainly and lean on practice. Its focus_next drills are trainer sections and mock clients only.
- Stay on the work. If a note mentions the rep's personal life (health, family, money), don't repeat it or speculate about it; at most say the rep's state came up in a one-on-one.`;

export async function buildReviewInput(opts: {
  supabase: SupabaseClient;
  history: RepHistory;
  repId: string;
  repName: string;
  since: string | null;
  focus: string | null;
}): Promise<{ content: Block[]; inputs: Record<string, number> }> {
  const { supabase, history: h, repId, repName, since, focus } = opts;
  const inWindow = (iso: string) => !since || iso >= since;
  const calls = h.calls.filter((c) => c.status === "graded" && inWindow(c.created_at)).slice(0, 150);
  // Personal notes never go to Claude.
  const notes = h.notes.filter((n) => !n.private && (inWindow(n.note_date) || n.tag === "concern")).slice(0, 200);
  const quizzes = h.quizzes.filter((q) => inWindow(q.created_at)).slice(0, 40);
  const done = h.completions.filter((c) => inWindow(c.completed_at)).slice(0, 60);
  const att = h.attendance.filter((a) => inWindow(a.week_start)).slice(0, 26);
  const prior = h.reviews.find((r) => r.status === "done" && r.review);
  const files = await fileBlocks(supabase, h, since);
  const kpi = kpiText(h, repId);

  const text = [
    `REP: ${repName}`,
    `WINDOW: ${since ? `since ${day(since)}` : "everything on record"} (today is ${day(new Date().toISOString())})`,
    focus ? `THE MANAGER ASKED YOU TO LOOK ESPECIALLY AT: ${focus}` : "",
    "",
    `GRADED CALLS (${calls.length}, newest first; scores are 0-100):`,
    calls.length ? calls.map((c) => callLine(c, h.personas)).join("\n") : "(none in this window)",
    "",
    "KPI REPORTS FROM THE CRM:",
    kpi || "(no KPI reports matched to this rep yet)",
    "",
    `MANAGER NOTES (${notes.length}, private):`,
    notes.length ? notes.map((n) => `${n.note_date} [${TAG_LABEL[n.tag]}] ${cut(n.body, 1200)}`).join("\n") : "(none)",
    "",
    `KNOWLEDGE CHECKS (${quizzes.length}):`,
    quizzes.length ? quizzes.map((q) => `${day(q.created_at)} ${q.title ?? "quiz"}: ${q.score}% ${q.passed ? "passed" : "failed"}`).join("\n") : "(none)",
    "",
    `TRAINING COMPLETED (${done.length}):`,
    done.length ? done.map((c) => `${day(c.completed_at)} ${c.title ?? "item"}${c.kind ? ` (${c.kind})` : ""}`).join("\n") : "(none)",
    "",
    `ONE-ON-ONE COACHING SESSIONS (${h.sessions.filter((x) => !x.private && inWindow(x.session_date)).length}, the manager's own record -- weigh these heavily):`,
    h.sessions.filter((x) => !x.private && inWindow(x.session_date)).length
      ? h.sessions
          .filter((x) => !x.private && inWindow(x.session_date))
          .slice(0, 120)
          .map((x) => `${x.session_date} [${x.topics.join(", ") || "no topic"}] ${cut(x.summary || x.raw_notes, 600)}${x.commitments.length ? ` | commitments: ${x.commitments.map((c) => `${c.text} (${c.status})`).join("; ")}` : ""}`)
          .join("\n")
      : "(none)",
    "",
    "DEAL CLIP (morning month-to-date deals and month-end projection; context on pace, not a coaching topic by itself):",
    h.dealClips.length
      ? h.dealClips
          .filter((c, i, all) => i === 0 || c.day.slice(0, 7) !== all[i - 1].day.slice(0, 7) || i % 5 === 0)
          .slice(0, 12)
          .map((c) => `${c.day}: ${c.deals} deals, close ${c.ratio === null ? "?" : Math.round(c.ratio * 100) + "%"}, projected ${Math.round(c.clip)} for the month`)
          .join("\n")
      : "(none)",
    "",
    "RETENTION LOOKBACKS (Friday report; cancelled before the 1st payment traces back to the sale. Point-of-sale reasons are why this rep's clients cancelled in ways the sale could have prevented. Rates are a floor while first payments are pending; the change is directional):",
    h.retention.length
      ? h.retention
          .slice(0, 6)
          .map(
            (r) =>
              `${r.period_start} to ${r.period_end}: ${r.deals ?? "?"} deals, before-1st ${r.before1_rate === null ? "?" : Math.round(r.before1_rate * 100) + "%"}${r.prior_rate !== null && r.before1_rate !== null ? ` (prior ${Math.round(r.prior_rate * 100)}%)` : ""}, ${r.requests ?? "?"} cancel requests; point-of-sale reasons: ${Object.entries(r.pos_reasons).map(([k, n]) => `${k} x${n}`).join(", ") || "none"}`
          )
          .join("\n") + "\nIf the same point-of-sale reason shows up twice or more, name it as a coaching priority and suggest the matching practice (e.g. misunderstood the program -> the program explanation; would rather pay it themselves / won't go delinquent -> certainty and looping on the close; third party vetoed -> getting the spouse or partner on the call)."
      : "(none)",
    "",
    `EARLIER ONE-ON-ONES FROM THE OLD TRACKER (topic counts only, no dates; total ${h.earlier.reduce((s, x) => s + x.sessions, 0)}):`,
    h.earlier.length ? h.earlier.map((x) => `${x.topic} ${x.sessions}`).join(", ") : "(none)",
    "",
    "DAILY ACTIVITY AND ROTATION (from the nightly Sales Dashboard; 1 point makes rotation: talk 2.5h=0.5/4h=1, calls 60=0.5/90=1, 0.5 per deal):",
    h.daily.filter((d) => inWindow(d.day)).length
      ? (() => {
          const ds = h.daily.filter((d) => inWindow(d.day));
          const made = ds.filter((d) => d.override_made ?? d.made).length;
          const avg = (f: (d: (typeof ds)[number]) => number | null) => {
            const xs = ds.map(f).filter((x): x is number => x !== null);
            return xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null;
          };
          return [
            `Made rotation ${made} of ${ds.length} working days; average ${avg((d) => d.talk_hours)}h talk, ${avg((d) => d.calls)} calls, ${avg((d) => d.deals)} deals a day.`,
            ...ds.slice(0, 130).map((d) => `${d.day}: ${d.talk_hours ?? "-"}h talk, ${d.calls ?? "-"} calls, ${d.deals ?? "-"} deals, ${d.points ?? "-"} pt ${(d.override_made ?? d.made) ? "MADE" : "missed"}`),
          ].join("\n");
        })()
      : "(no daily numbers yet)",
    "",
    "TRAINING CARDS SENT (one behavior each; did the behavior then show up in the calls after?):",
    h.cards.filter((c) => !since || (c.sent_at ?? "") >= since).length
      ? h.cards
          .filter((c) => !since || (c.sent_at ?? "") >= since)
          .map((c) => `${day(c.sent_at || "")} ${c.kind}: ${c.skill} -- ${c.status}${c.practiced ? `, practiced ${c.practiced}x` : ", not practiced"}${c.rep_response ? `, rep said ${c.rep_response}${c.rep_note ? ` ("${cut(c.rep_note, 200)}")` : ""}` : ""}${c.close_note ? `, closed: ${c.close_note}` : ""}`)
          .join("\n")
      : "(none)",
    "",
    "SCRIPT PRACTICE (recorded script lines; pace and clarity 0-100):",
    (() => {
      const a = h.practice.attempts.filter((x) => inWindow(x.created_at));
      if (!a.length && !h.practice.linesDone) return "(none)";
      const avg = (xs: (number | null)[]) => {
        const v = xs.filter((x): x is number => x !== null);
        return v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : null;
      };
      const bySeg = new Map<string, number>();
      for (const x of a) bySeg.set(x.segment, (bySeg.get(x.segment) ?? 0) + 1);
      return [
        `${a.length} recorded attempts; average pace ${avg(a.map((x) => x.pace)) ?? "-"}, clarity ${avg(a.map((x) => x.clarity)) ?? "-"}, pauses ${avg(a.map((x) => x.pauses)) ?? "-"}`,
        a.length ? `most practiced: ${[...bySeg].sort((x, y) => y[1] - x[1]).slice(0, 6).map(([k, n]) => `${k} x${n}`).join(", ")}` : "",
        `script lines marked done: ${h.practice.linesDone}${h.practice.lastDone ? ` (last ${day(h.practice.lastDone)})` : ""}`,
      ]
        .filter(Boolean)
        .join("\n");
    })(),
    "",
    "MASTER YOUR CRAFT ATTENDANCE:",
    att.length ? att.map((a) => `week of ${a.week_start}: ${a.status.replace(/_/g, " ")}`).join("\n") : "(no attendance marked)",
    "",
    prior?.review
      ? `PREVIOUS REVIEW (${day(prior.created_at)}): ${prior.review.headline}\nFocus set then: ${prior.review.focus_next.map((f) => f.skill).join(", ")}\nSay whether those focus areas moved.`
      : "PREVIOUS REVIEW: none -- this is the first.",
    "",
    files.blocks.length ? `MANAGER FILES (${files.blocks.filter((b) => b.type === "text").length}) follow.` : "MANAGER FILES: none.",
  ]
    .filter((l) => l !== "")
    .join("\n");

  return {
    content: [{ type: "text", text: `${INSTRUCTIONS}\n\n${text}` }, ...files.blocks, { type: "text", text: "Write the review now." }],
    inputs: {
      calls: calls.filter((c) => c.source !== "roleplay").length,
      practice: calls.filter((c) => c.source === "roleplay").length,
      notes: notes.length,
      files: files.read,
      kpi_months: new Set(h.kpiRows.filter((r) => r.rep_id === repId).map((r) => r.report_id)).size,
      quizzes: quizzes.length,
    },
  };
}

export async function askForReview(content: Block[], key: string): Promise<{ data: ReviewBody; usd: number }> {
  return askJsonCost<ReviewBody>(content, REVIEW_SCHEMA, key, "The review");
}

/** One Claude call that must come back as JSON matching the schema. */
export async function askJson<T>(content: Block[], schema: object, key: string, what: string, maxTokens = 16000): Promise<T> {
  return (await askJsonCost<T>(content, schema, key, what, maxTokens)).data;
}

/** The same, plus what it cost (list prices) for the spending log. */
export async function askJsonCost<T>(
  content: Block[],
  schema: object,
  key: string,
  what: string,
  maxTokens = 16000,
  model = REVIEW_MODEL
): Promise<{ data: T; usd: number }> {
  const send = (strict: boolean) =>
    fetch(`${process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com"}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        ...thinkingFor(model),
        output_config: strict ? { effort: "high", format: { type: "json_schema", schema } } : { effort: "high" },
        messages: [
          {
            role: "user",
            content: strict
              ? content
              : [...content, { type: "text", text: `Reply with one JSON object only, matching this JSON Schema:\n${JSON.stringify(schema)}` }],
          },
        ],
      }),
      signal: AbortSignal.timeout(270_000),
    });

  let res = await send(true);
  if (res.status === 400) {
    const raw = await res.clone().text().catch(() => "");
    if (/grammar|schema|too (large|complex)|output_config/i.test(raw)) res = await send(false);
  }
  if (!res.ok) {
    const raw = await res.text().catch(() => "");
    let msg = raw.slice(0, 300);
    try {
      msg = JSON.parse(raw)?.error?.message || msg;
    } catch {
      // not JSON
    }
    throw new Error(`${what} failed (${res.status}). ${msg}`);
  }
  const data = (await res.json()) as {
    content?: { type: string; text?: string }[];
    stop_reason?: string;
    usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
  };
  const usd = gradeCostUsd(model, data.usage ?? {}) ?? 0;
  if (data.stop_reason === "max_tokens") throw new Error(`${what} ran too long and got cut off.`);
  const text = data.content?.find((c) => c.type === "text")?.text || "";
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  try {
    return { data: JSON.parse(a >= 0 && b > a ? text.slice(a, b + 1) : text) as T, usd };
  } catch {
    throw new Error(`${what} came back unreadable. Try again.`);
  }
}
