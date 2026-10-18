import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/callsServer";
import { loadRepHistory } from "@/lib/repHistory";
import { askJsonCost, callLine, REVIEW_MODEL } from "@/lib/repReview";
import { logSpend } from "@/lib/spendServer";
import { CARD_RULES, DRAFT_SCHEMA, KIND_GUIDE, type CardKind, type DraftResult } from "@/lib/cards";
import type { Grade } from "@/lib/calls";

export const runtime = "nodejs";
export const maxDuration = 120;

const mmss = (t: number | null | undefined) => (typeof t === "number" ? `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}` : "");

/** The moments in one graded call, with times and quotes, for Claude to anchor a card on. */
function moments(id: string, g: Grade): string {
  const out: string[] = [`CALL ${id} -- detail:`];
  for (const s of g.slp ?? [])
    if (typeof s.score === "number") out.push(`  skill ${s.skill} ${s.score}/10${s.time !== null ? ` at ${mmss(s.time)}` : ""}: ${s.evidence} | coach: ${s.coaching}`);
  for (const s of g.sections ?? []) if (s.status !== "hit") out.push(`  section ${s.section} ${s.status}${s.time !== null ? ` at ${mmss(s.time)}` : ""}: ${s.evidence} | coach: ${s.coaching}`);
  for (const f of g.flags ?? []) out.push(`  flag [${f.severity}]${f.time !== null ? ` at ${mmss(f.time)}` : ""}: ${f.issue} -- "${f.quote}"`);
  for (const c of g.compliance ?? []) if (c.status === "no") out.push(`  compliance missed: ${c.item}${c.time !== null ? ` at ${mmss(c.time)}` : ""} -- ${c.evidence}`);
  for (const t of g.tonality?.tone_checks ?? []) if (t.match !== "yes") out.push(`  tone at ${mmss(t.time)}: expected ${t.expected}, heard ${t.heard}`);
  if (g.strengths?.length) out.push(`  strengths: ${g.strengths.join(" / ")}`);
  return out.join("\n");
}

/**
 * Drafts one training card for a rep. Saves nothing: the manager edits the
 * draft on the page and decides whether it goes out.
 */
export async function POST(request: Request) {
  const ctx = await requireAdmin(request);
  if (ctx instanceof NextResponse) return ctx;
  const { supabase, orgId, userId } = ctx;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 500 });

  const body = (await request.json().catch(() => ({}))) as { repId?: string; kind?: CardKind; callId?: string; reviewId?: string; focus?: string; hint?: string };
  const repId = String(body.repId || "");
  const kind: CardKind = body.kind && KIND_GUIDE[body.kind] ? body.kind : "focus";
  if (!repId) return NextResponse.json({ error: "No rep id." }, { status: 400 });

  const [{ data: rep }, { history }, { data: mods }, { data: personas }, { data: org }] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", repId).maybeSingle(),
    loadRepHistory(supabase, repId, { callLimit: 40 }),
    supabase.from("modules").select("id, title, language, scripts(title)").order("sort_order"),
    supabase.from("roleplay_personas").select("id, name, title, difficulty, active").eq("active", true),
    supabase.from("orgs").select("roleplay_enabled").eq("id", orgId).maybeSingle(),
  ]);
  if (!rep) return NextResponse.json({ error: "That rep wasn't found." }, { status: 404 });

  const graded = history.calls.filter((c) => c.status === "graded");
  const detailIds = [...new Set([body.callId, ...graded.slice(0, 5).map((c) => c.id)].filter(Boolean))] as string[];
  const { data: details } = detailIds.length ? await supabase.from("calls").select("id, grade").in("id", detailIds) : { data: [] };

  const review = body.reviewId ? history.reviews.find((r) => r.id === body.reviewId) : history.reviews.find((r) => r.status === "done");
  const openCards = await supabase.from("training_cards").select("kind, skill, status, sent_at").eq("rep_id", repId).in("status", ["sent", "draft"]);

  const modList = ((mods || []) as { id: string; title: string; language: string | null; scripts: { title: string } | { title: string }[] | null }[])
    .filter((m) => (m.language || "en") === "en")
    .map((m) => {
      const s = Array.isArray(m.scripts) ? m.scripts[0] : m.scripts;
      return `${m.id} | ${s?.title ? `${s.title} · ` : ""}${m.title}`;
    });
  // Mock clients only while practice calls are switched on.
  const perList = ((org?.roleplay_enabled ? personas || [] : []) as { id: string; name: string; title: string; difficulty: string }[]).map(
    (p) => `${p.id} | ${p.name} -- ${p.title} (${p.difficulty})`
  );

  const text = [
    `You are drafting a training card for ${rep.full_name || "a rep"}, a phone sales rep at Lionside Financial (debt relief; Jordan Belfort's Straight Line Persuasion). A manager will edit and sign it before the rep sees it.`,
    KIND_GUIDE[kind],
    body.focus ? `THE MANAGER WANTS IT TO BE ABOUT: ${body.focus}` : "",
    body.hint ? `MANAGER'S NOTE: ${body.hint}` : "",
    "",
    CARD_RULES,
    "",
    `RECENT GRADED CALLS (newest first):`,
    graded.slice(0, 15).map((c) => `[call id ${c.id}] ${callLine(c, history.personas)}`).join("\n") || "(none)",
    "",
    ((details || []) as { id: string; grade: Grade | null }[]).filter((d) => d.grade).map((d) => moments(d.id, d.grade!)).join("\n\n"),
    "",
    review?.review
      ? `LATEST COACHING REVIEW (${review.created_at.slice(0, 10)}): ${review.review.headline}\nSlipping: ${review.review.slipping.map((s) => s.title).join("; ")}\nImproving: ${review.review.improving.map((s) => s.title).join("; ")}\nCoach next: ${review.review.focus_next.map((f) => `${f.skill} -- ${f.drill}`).join("; ")}`
      : "",
    (openCards.data || []).length
      ? `CARDS ALREADY OPEN FOR THIS REP (don't repeat them): ${(openCards.data || []).map((c) => `${c.kind}: ${c.skill} (${c.status})`).join("; ")}`
      : "",
    "",
    `SCRIPT SECTIONS THEY CAN DRILL (module id | name):\n${modList.join("\n") || "(none)"}`,
    "",
    `MOCK CLIENTS THEY CAN CALL (persona id | name):\n${perList.join("\n") || "(none)"}`,
  ]
    .filter((l) => l !== undefined)
    .join("\n");

  try {
    const { data: d, usd } = await askJsonCost<DraftResult>([{ type: "text", text }], DRAFT_SCHEMA, key, "The draft", 4000);
    await logSpend(supabase, { org_id: orgId, kind: "card_draft", usd, user_id: userId, ref_id: repId });
    const mod = d.drill_type === "module" ? modList.find((m) => m.startsWith(`${d.drill_id} |`)) : null;
    const per = d.drill_type === "persona" ? perList.find((p) => p.startsWith(`${d.drill_id} |`)) : null;
    const drill = mod ? { type: "module", id: d.drill_id, label: mod.split(" | ")[1] } : per ? { type: "persona", id: d.drill_id, label: per.split(" | ")[1].replace(/ \(\w+\)$/, "") } : null;
    const callOk = graded.some((c) => c.id === d.call_id);
    return NextResponse.json({
      ok: true,
      model: REVIEW_MODEL,
      draft: {
        kind,
        skill: d.skill,
        noticed: d.noticed,
        why: d.why,
        try_this: d.try_this,
        when_then: d.when_then,
        call_id: callOk ? d.call_id : null,
        call_moment: callOk ? d.call_moment || null : null,
        drill,
        review_id: review?.id ?? null,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
