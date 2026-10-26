import { jsonrepair } from "jsonrepair";
import { hardshipScoreOf, lineScoreOf, type Ended } from "@/lib/calls";

/**
 * The version of the grading rules. Bump it for a MAJOR grading change (new
 * scores, new rules): every graded call on file is then re-graded by itself,
 * oldest first, the next time a manager opens the Calls page.
 */
export const GRADER_VERSION = 10;
/**
 * The oldest grade that's still current, per kind of call (a change that only
 * affects renew calls raises just the renew number). Version 6: the close read
 * balanced both ways (fragile not too free, not too soft) -- every call.
 * Versions 7 and 8 only fixed re-grades that failed (those are retried; calls
 * graded fine on 6 stay as they are).
 * Version 10: why a call ended early ("ended"), hardship not timed when the
 * client had to go, a booked time is a callback. Only matters for calls that
 * didn't enroll.
 */
export const CURRENT_FROM = { renew: 10, other: 10 };

/**
 * A grading change no longer re-grades everything on file -- only the newest
 * calls (by when they were made), and only those the change can affect.
 */
export const REGRADE_NEWEST = 10;
export const regradeApplies = (c: { outcome: string | null; outcome_manual?: string | null }) => (c.outcome_manual || c.outcome) !== "enrolled";
import {
  ROADMAP,
  voiceNotes,
  type VoiceTimeline,
  langOf,
  gradeCostUsd,
  isStuck,
  scoreOf,
  slpScoreOf,
  type CallCost,
  type CallStatus,
  type Grade,
  type GradeVersion,
  type Transcript,
} from "@/lib/calls";
import { failCall, log, thinkingFor, type Supa } from "@/lib/callsServer";
import { practiceNote, type PersonaSecret } from "@/lib/roleplay";
import { rewriteRules } from "@/lib/gradingRulesServer";

/*
  The grader, shared by uploaded calls (/api/calls/grade, managers) and
  practice calls with a mock client (/api/roleplay/finish, the rep's own
  token). Same prompt, same schema, same scoring -- a practice score means
  the same thing as a real one.
*/

const UPSTREAM_TIMEOUT_MS = 270_000;
const MODEL = process.env.GRADER_MODEL || "claude-sonnet-5-5";
const HISTORY_KEEP = 10;

type ModuleRow = {
  title: string;
  kind: string | null;
  language: string | null;
  sort_order: number;
  segments: {
    segment_code: string;
    title: string | null;
    script_text: string;
    sort_order: number;
    active: boolean;
    tones: string[] | null;
    tone_map: { tone: string | null; text: string }[] | null;
    coaching: string | null;
    client_should_feel: string | null;
    script_note: string | null;
    condition: string | null;
  }[];
};

type ScriptRow = {
  title: string;
  continues_into: string | null;
  continues_from: string | null;
  grading_note: string | null;
};

const MODULE_SELECT =
  "title, kind, language, sort_order, segments(segment_code, title, script_text, sort_order, active, tones, tone_map, coaching, client_should_feel, script_note, condition)";



export type GradePrep =
  | { ok: false; status: number; error: string }
  | { ok: true; already: true }
  | { ok: true; already?: false; run: () => Promise<void>; summary: string };

/**
 * Loads everything the grader needs and claims the call. Returns run(),
 * which does the slow part -- call it inside after() or await it.
 *
 * The grader only ever sees the redacted transcript.
 */
export async function prepareGrade(
  supabase: Supa,
  callId: string,
  key: string,
  started: number
): Promise<GradePrep> {
  const { data: call, error } = await supabase
    .from("calls")
    .select(
      "id, org_id, status, updated_at, transcript, voice, script_id, grade, score, slp_score, grade_history, cost, rep_name, source, roleplay, profiles:rep_id(full_name)"
    )
    .eq("id", callId)
    .single();

  if (error || !call) {
    return { ok: false, status: 404, error: `Call not found. ${error?.message ?? ""}` };
  }

  const status = call.status as CallStatus;
  if ((status === "transcribing" || status === "grading") && !isStuck(status, call.updated_at)) {
    return { ok: true, already: true };
  }
  if (!call.transcript) {
    return { ok: false, status: 400, error: "Transcribe the call first." };
  }
  if (!call.script_id) {
    return { ok: false, status: 400, error: "Pick which script this call should be graded against." };
  }

  const [{ data: scriptData }, { data: modules, error: modErr }] = await Promise.all([
    supabase
      .from("scripts")
      .select("title, continues_into, continues_from, grading_note")
      .eq("id", call.script_id)
      .single(),
    supabase
      .from("modules")
      .select(MODULE_SELECT)
      .eq("script_id", call.script_id)
      .eq("active", true)
      .order("sort_order"),
  ]);
  const script = scriptData as ScriptRow | null;

  if (modErr || !modules || modules.length === 0) {
    return {
      ok: false,
      status: 500,
      error: `Could not load the script. ${modErr?.message ?? "It has no modules."}`,
    };
  }

  /*
    The Options Script holds English and Spanish versions of every section.
    Grade only against the language of the call: half the script tokens, and
    no "Apertura -- not reached" rows on an English call. If a script has no
    modules marked for that language, use them all.
  */
  const transcript = call.transcript as Transcript;
  const lang = langOf(transcript.language);
  const pickLangFor = (ms: ModuleRow[], lg: "en" | "es") => {
    const same = ms.filter((m) => (m.language || "en") === lg);
    return same.length > 0 ? same : ms;
  };
  const pickLang = (ms: ModuleRow[]) => pickLangFor(ms, lang);

  /*
    A script that hands off to another one -- the Renew script opens the call
    and then continues on the Options Script from Phase 2. Grade the whole
    call as one script: this script's sections, then the other script's from
    the hand-off line onward, plus its objection loops.
  */
  const notes: string[] = [];
  if (script?.grading_note) notes.push(script.grading_note.trim());

  let contModules: ModuleRow[] = [];
  let contTitle = "";
  if (script?.continues_into) {
    const [{ data: cont }, { data: cm }] = await Promise.all([
      supabase.from("scripts").select("title").eq("id", script.continues_into).single(),
      supabase
        .from("modules")
        .select(MODULE_SELECT)
        .eq("script_id", script.continues_into)
        .eq("active", true)
        .order("sort_order"),
    ]);
    contModules = (cm || []) as unknown as ModuleRow[];
    contTitle = cont?.title ?? "";
  }
  const assemble = (lg: "en" | "es") => {
    const own = pickLangFor(modules as unknown as ModuleRow[], lg);
    if (!script?.continues_into) return own;
    const next = pickLangFor(contModules, lg);
    const from = script.continues_from;
    const startModule = from ? next.find((m) => m.segments?.some((g) => g.segment_code === from)) : null;
    const startSeg = startModule?.segments.find((g) => g.segment_code === from);
    const carried = next
      .filter((m) => m.kind === "loop" || !startModule || m.sort_order >= startModule.sort_order)
      .map((m) =>
        m === startModule && startSeg
          ? { ...m, segments: m.segments.filter((g) => g.sort_order >= startSeg.sort_order) }
          : m
      );
    // This script's own loops (if any) stay; the other script's are added.
    return [...own, ...carried];
  };
  const useModules = assemble(lang);
  if (script?.continues_into) {
    notes.push(
      `After the sections above, the call continues on "${contTitle || "the next script"}"` +
        (script.continues_from ? ` from ${script.continues_from}` : "") +
        ". Those sections are included above, in order, and are graded the same way."
    );
    notes.push(
      "A renew call is fast-paced on purpose: the client went through the full hardship conversation months ago. The hardship target on a renew is about 2-4 minutes from the START of the call, not 8-12: confirm the debt is still a problem and why, re-anchor the pain in the client's own words, and move on. Grade the hardship spotlight and its parts against that short re-qualification -- reward getting the client to re-own the pain quickly; don't coach a longer dig, and mark it down only when the rep skipped re-anchoring the pain or dragged it out well past 4-6 minutes. There is no loan on this call, so there is no loan turndown."
    );
  }

  /*
    How the grade names things, so managers read it against the script:
    every section is named by its title in the English script (a Spanish
    call is graded on the Spanish script, then its section names are mapped
    to their English counterparts, which sit in the same order).
    A script that picks up after the loan (Renew) has no SuperMoney, so
    those two roadmap stages are left out entirely.
  */
  const titles = useModules.map((m) => m.title);
  // Each Spanish section's English twin: same script, same place (sort order), else same position among its kind.
  const twinOf = (m: ModuleRow): string => {
    if ((m.language || "en") === "en") return m.title;
    const pool = (modules as unknown as ModuleRow[]).includes(m) ? (modules as unknown as ModuleRow[]) : contModules;
    const en = pool.filter((x) => (x.language || "en") === "en" && (x.kind === "loop") === (m.kind === "loop")).sort((a, b) => a.sort_order - b.sort_order);
    const es = pool.filter((x) => x.language === "es" && (x.kind === "loop") === (m.kind === "loop")).sort((a, b) => a.sort_order - b.sort_order);
    const same = en.find((x) => x.sort_order === m.sort_order);
    if (same && en.length === es.length) return same.title;
    const i = es.findIndex((x) => x.title === m.title);
    return en.length === es.length && i >= 0 ? en[i].title : same?.title ?? m.title;
  };
  const english = useModules.map((m) => twinOf(m.segments && contModules.some((c) => c.title === m.title && c.language === m.language) ? contModules.find((c) => c.title === m.title && c.language === m.language)! : m));
  const naming: Naming = {
    titles,
    english,
    skip: script?.continues_into ? ["Hope spike", "Hopeless"] : [],
    lang,
  };

  const { error: claimErr } = await supabase
    .from("calls")
    .update({ status: "grading", updated_at: new Date().toISOString() })
    .eq("id", callId);
  if (claimErr) {
    return { ok: false, status: 500, error: `Could not start. ${claimErr.message}` };
  }

  /*
    A practice call: the grader is told who the mock client really was and
    what the right result was, so it can judge whether the rep found out.
    Read before nothing else changes -- the reveal only works once the call
    has ended, which it has by now.
  */
  const isPractice = call.source === "roleplay";
  let practice = "";
  if (isPractice) {
    const { data: secret } = await supabase.rpc("roleplay_reveal", { p_call: callId }).maybeSingle();
    const rp = (call.roleplay as { persona?: string; lang?: string; archetype?: { name: string; text: string } | null } | null) || {};
    practice = practiceNote(rp.persona || "the client", (secret as PersonaSecret | null) ?? null, rp.archetype ?? null);
    const mode = (call.roleplay as { mode?: string; previous?: string | null } | null) || {};
    if (mode.mode === "followup")
      practice += `\nThis practice call was a FOLLOW-UP: the client had spoken with Lionside before and put it off.${mode.previous ? ` What the client was told about last time: ${mode.previous}` : ""} Grade it as a follow-up: stages that belonged to that earlier call are "not_reached" with evidence starting "Covered earlier (practice set-up)", skills with no fair chance for that reason score null, set spotlights.followup.kind to "followup", and judge how the rep re-opened and whether they got to the bottom of the stall.\n`;
  }

  // A real call in a client journey: earlier calls with the same client ID, so a follow-up isn't marked down for stages done before.
  if (!isPractice) practice = await journeyNote(supabase, callId, script?.title ?? "");
  // How the close calls have held up on this team's real retention, so the fragile read stays honest.
  if (!isPractice) practice += await closeCalibration(supabase);

  // After the claim: a rep grading their own practice call can only read
  // the managers' lessons while that call is marked as grading.
  const guidance = await managerGuidance(supabase, isPractice);

  const repName =
    (call as unknown as { profiles: { full_name: string | null } | null }).profiles?.full_name ||
    (call.rep_name as string | null)?.trim() ||
    "the rep";

  const voice = (call.voice as VoiceTimeline | null) ?? null;
  const build = (guidance: string) => buildPrompt(
    script?.title || "Script",
    useModules,
    transcript,
    repName,
    lang,
    voice,
    notes.join("\n"),
    guidance,
    practice,
    naming.skip
  );
  let blocks = build(guidance);

  const previous: GradeVersion | null =
    call.grade && call.score !== undefined
      ? {
          grade: call.grade as Grade,
          score: call.score as number | null,
          slp_score: (call.slp_score as number | null) ?? null,
        }
      : null;

  return {
    ok: true,
    summary: `${lang}, ${useModules.length} modules${isPractice ? ", practice" : ""}`,
    run: async () => {
      // Corrections made since the last real call was graded: fold them into the standing rules
      // first -- once, by whichever grade gets there first -- then grade by them.
      if (!isPractice && call.org_id) {
        const r = await rewriteRules(supabase, key, call.org_id as string, null);
        if (r.rules && !r.skipped) blocks = build(await managerGuidance(supabase, false));
        if (r.error && !/grading_rules\.sql/.test(r.error)) log("grade", callId, started, `rules rewrite skipped: ${r.error.slice(0, 120)}`);
      }
      return grade(supabase, callId, blocks, key, started, {
        naming,
        previous,
        history: (call.grade_history as GradeVersion[] | null) || [],
        cost: (call.cost as CallCost | null) || {},
      });
    },
  };
}

/**
 * The grader's close calls checked against what actually happened: of the
 * enrollments it called fragile, how many lasted (6+ payments or graduated)
 * and how many cancelled. If "fragile" keeps landing on sales that stick, the
 * grader is told to be stricter about what counts.
 */
async function closeCalibration(supabase: Supa): Promise<string> {
  const { data } = await supabase
    .from("calls")
    .select("retention, cq:grade->>close_quality")
    .eq("status", "graded")
    .neq("source", "roleplay")
    .in("retention", ["graduated", "paid6", "cancelled"])
    .limit(2000);
  const rows = (data || []) as { retention: string; cq: string | null }[];
  const tally = (q: string) => {
    const xs = rows.filter((r) => r.cq === q);
    return { n: xs.length, lasted: xs.filter((r) => r.retention !== "cancelled").length, cancelled: xs.filter((r) => r.retention === "cancelled").length };
  };
  const f = tally("fragile");
  const o = tally("ok");
  const so = tally("solid");
  if (f.n + o.n + so.n < 3) return "";
  return `
<close_track_record>
How earlier close calls on this team held up (clients whose result is known): called fragile ${f.n} -- ${f.lasted} lasted 6+ payments or graduated, ${f.cancelled} cancelled; called ok ${o.n} -- ${o.lasted} lasted, ${o.cancelled} cancelled; called solid ${so.n} -- ${so.lasted} lasted, ${so.cancelled} cancelled.${
    f.n >= 3 && f.lasted >= f.cancelled ? " Most clients called fragile actually stuck with the program, so \"fragile\" has been used too freely: keep it for a specific red flag still standing at the signature." : ""
  }${
    // The other direction: "ok"/"solid" closes cancelling as often as fragile ones means the grader has gone too soft.
    o.n + so.n >= 4 && o.cancelled + so.cancelled >= 3 && (o.cancelled + so.cancelled) / (o.n + so.n) >= (f.n ? f.cancelled / f.n : 0.5)
      ? " Clients called ok or solid have been cancelling about as often as fragile ones, so real red flags at the signature are being missed: look harder for them."
      : ""
  }
</close_track_record>
`;
}

/*
  Where this call sits in the client's journey, for the grader. Earlier calls
  with the same client ID are summarised so a follow-up is graded fairly:
  stages done on an earlier call are left out of the scores ("covered
  earlier"), and stages from an earlier call that isn't uploaded are "not on
  record" -- neutral. Everything that happened on this call is graded as normal.
*/
async function journeyNote(supabase: Supa, callId: string, scriptTitle: string): Promise<string> {
  const { data: me } = await supabase.from("calls").select("id, org_id, client_label, call_date, created_at").eq("id", callId).single();
  const label = (me?.client_label as string | null)?.trim();
  // The manager's call number and handoff (separate, so grading works before those columns exist).
  const extra = await supabase.from("calls").select("call_number, handoff").eq("id", callId).maybeSingle();
  const myNumber = (extra.data as { call_number?: number | null } | null)?.call_number ?? null;
  const handoff = (extra.data as { handoff?: string | null } | null)?.handoff ?? null;
  const renew = /renew/i.test(scriptTitle) || handoff === "renew";
  const lines: string[] = [];
  let earlier: { id: string; call_date: string | null; created_at: string; grade: Grade | null; outcome: string | null; outcome_manual: string | null; rep_name?: string | null; profiles?: { full_name: string | null } | null }[] = [];
  if (label) {
    const { data } = await supabase
      .from("calls")
      .select("id, call_date, created_at, grade, outcome, outcome_manual, rep_name, profiles:rep_id(full_name)")
      .eq("org_id", me!.org_id)
      .ilike("client_label", label)
      .neq("id", callId)
      .neq("source", "roleplay");
    const mine = (me!.call_date as string | null) || String(me!.created_at).slice(0, 10);
    earlier = ((data || []) as unknown as typeof earlier)
      .filter((c) => (c.call_date || c.created_at.slice(0, 10)) < mine || ((c.call_date || c.created_at.slice(0, 10)) === mine && c.created_at < String(me!.created_at)))
      .sort((a, b) => (a.call_date || a.created_at).localeCompare(b.call_date || b.created_at));
  }
  const n = myNumber ?? earlier.length + 1;
  if (n <= 1 && !earlier.length) {
    if (!renew)
      return `\n<client_journey>\nThis is the first call on record with this client. If the call itself clearly sounds like a follow-up (it refers back to an earlier conversation or picks up mid-process), treat it as one (and don't coach the rep to redo those earlier stages or call them skipped): stages that would have happened on that earlier call are NOT ON RECORD -- mark those script sections "not_reached" and those roadmap stages landed "not_reached" with evidence starting "Not on record", score Straight Line skills that had no fair chance on this call as null, and set spotlights.followup.kind to "followup".\n</client_journey>\n`;
  }
  lines.push(`This is call #${n} with this client${label ? ` (client ID ${label})` : ""}.`);
  if (renew) lines.push(`It is a RENEW call: the lead was worked before, possibly by a different rep, and came back around.`);
  if (handoff === "coverage") lines.push(`This rep took the call to cover for the client's usual rep, who was out.`);
  if (earlier.length) {
    lines.push(`Earlier calls on record, oldest first:`);
    earlier.forEach((c, i) => {
      const g = c.grade;
      const who = c.profiles?.full_name || c.rep_name || "a rep";
      lines.push(
        `- Call ${i + 1} (${c.call_date || c.created_at.slice(0, 10)}, ${who}): ${g?.summary ?? "not graded"} Ended: ${g?.furthest_point ?? "?"}; outcome ${c.outcome_manual || c.outcome || "?"}.` +
          (g?.spotlights?.hardship?.read ? ` Hardship: ${g.spotlights.hardship.read}` : "") +
          (g?.spotlights?.turndown?.happened ? ` Turndown: ${g.spotlights.turndown.read}` : "") +
          (g?.spotlights?.followup?.stall_stated ? ` Stall: "${g.spotlights.followup.stall_stated}"${g.spotlights.followup.stall_real ? ` (really: ${g.spotlights.followup.stall_real})` : ""}.` : "")
      );
    });
  }
  if (n > 1 && earlier.length < n - 1) lines.push(`${n - 1 - earlier.length} earlier call${n - 1 - earlier.length === 1 ? " is" : "s are"} not uploaded.`);
  lines.push(
    `Grade it as a FOLLOW-UP: script sections and roadmap stages that belonged to an earlier call and weren't needed again on this one -> section status "not_reached" and roadmap landed "not_reached", with evidence starting "Covered earlier (call K)" when the earlier call is listed above, or "Not on record" when it isn't. Straight Line skills that had no fair chance on this call for that reason -> score null. Everything that actually happened on this call is graded exactly as normal -- including whether the rep re-anchored the pain and certainty before asking again, which a strong follow-up does. For the hardship spotlight, if hardship was covered earlier, set moved_on_at 0 and start its read with "Covered earlier" or "Not on record". Set spotlights.followup.kind to "followup" and use the earlier calls to judge repeat_stall. Do NOT coach the rep to redo stages that belonged to an earlier call: leave them out of coaching_priorities, slp_summary, strengths and flags, and don't call them skipped -- coach only what THIS call needed (including re-anchoring the pain and certainty before the close, if that was missing).`
  );
  return `\n<client_journey>\n${lines.join("\n")}\n</client_journey>\n`;
}

// The standing rules carry every correction ever made; the newest few go in too, as worked examples.
const CORRECTIONS_IN_PROMPT = 12;

/*
  What managers have taught the grader, added to every grade:
  - lessons they approved on the Insights page (graduates vs cancels), and
  - their most recent corrections to individual report items.
  Kept in the cached part of the prompt; it only changes when a manager adds
  something, so calls graded back to back still share the cache.
*/
type Fix = { item_kind: string; item_label: string | null; original: string; correction: string };

async function managerGuidance(supabase: Supa, practice = false): Promise<string> {
  const [{ data: gRow }, { data: f }, { data: rRow }] = await Promise.all([
    supabase.from("grading_guidance").select("lessons").maybeSingle(),
    supabase
      .from("call_corrections")
      .select("item_kind, item_label, original, correction")
      .order("created_at", { ascending: false })
      .limit(CORRECTIONS_IN_PROMPT),
    // Needs supabase/grading_rules.sql; until then this comes back empty.
    supabase.from("grading_guidance").select("rules").maybeSingle(),
  ]);
  const rules = ((rRow as { rules?: { rule: string }[] | null } | null)?.rules ?? []).filter((r) => r?.rule);
  let lessonsRaw = (gRow?.lessons as string | null) ?? null;
  let fixes = (f as Fix[] | null) ?? null;

  // A rep grading their own practice call cannot read those tables (they
  // come back empty); roleplay_guidance() hands the same thing over.
  if (practice && !lessonsRaw && !fixes?.length) {
    const { data } = await supabase.rpc("roleplay_guidance").maybeSingle();
    const d = data as { lessons: string | null; corrections: Fix[] | null } | null;
    lessonsRaw = d?.lessons ?? null;
    fixes = d?.corrections ?? null;
  }
  const g = { lessons: lessonsRaw };

  const parts: string[] = [];
  if (rules.length) {
    parts.push(
      "STANDING GRADING RULES -- written from every correction the sales manager has made to earlier grades. Follow these as rules on every call; where one conflicts with the general instructions above, the rule wins:\n" +
        rules.map((r, i) => `${i + 1}. ${r.rule}`).join("\n")
    );
  }
  const lessons = (g?.lessons as string | null)?.trim();
  if (lessons) {
    parts.push(
      "Lessons the sales manager approved from comparing enrollment calls of proven sales (clients who graduated or made 6+ payments -- the calls this team wants every rep to make) with clients who cancelled. Use them to sharpen your judgment of the roadmap, close quality and coaching -- they are patterns, not rules:\n" +
        lessons
    );
  }
  if (fixes?.length) {
    parts.push(
      "The most recent corrections, as worked examples of the rules above. Apply the principle behind each one wherever it fits this call; never copy a correction onto a call where it does not apply:\n" +
        fixes
          .map(
            (f) =>
              `- [${f.item_kind}${f.item_label ? `: ${f.item_label}` : ""}] the grader said: "${String(f.original).slice(0, 240)}" -- the manager corrected: "${String(f.correction).slice(0, 400)}"`
          )
          .join("\n")
    );
  }
  return parts.length ? `\n<manager_guidance>\n${parts.join("\n\n")}\n</manager_guidance>\n` : "";
}

function scriptText(modules: ModuleRow[]): { text: string; sequence: string[] } {
  const sequence: string[] = [];
  const blocks: string[] = [];

  for (const m of modules) {
    const isLoop = m.kind === "loop";
    if (!isLoop) sequence.push(m.title);
    const segs = (m.segments || [])
      .filter((s) => s.active !== false)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((s) => {
        // Tone markers inline, where the script puts them: "<AC> We
        // specialize... <I CARE> Today we will...". Falls back to the
        // segment's tone list, then to plain text.
        const spoken = s.tone_map?.length
          ? s.tone_map
              .map((t) => (t.tone ? `<${t.tone.toUpperCase()}> ` : "") + t.text.trim())
              .join(" ")
          : (s.tones?.length ? `<${s.tones.join("/").toUpperCase()}> ` : "") + s.script_text.trim();
        const lines = [`  [${s.segment_code}]${s.condition ? ` (${s.condition})` : ""} ${spoken}`];
        if (s.script_note) lines.push(`      direction: ${s.script_note.trim()}`);
        if (s.client_should_feel) lines.push(`      client should feel: ${s.client_should_feel.trim()}`);
        if (s.coaching) lines.push(`      coaching: ${s.coaching.trim()}`);
        return lines.join("\n");
      })
      .join("\n");
    blocks.push(`### ${isLoop ? "OBJECTION LOOP" : "SECTION"}: ${m.title}\n${segs}`);
  }

  return { text: blocks.join("\n\n"), sequence };
}

function transcriptText(t: Transcript, notes: (string | null)[]): string {
  const lines = t.utterances.map(
    (u, i) => `[${Math.round(u.start)}] ${u.speaker}${notes[i] ? ` {${notes[i]}}` : ""}: ${u.text}`
  );
  let out = lines.join("\n");
  // A 90-minute call is ~90k characters. This only bites on something absurd.
  if (out.length > 300_000) out = out.slice(0, 300_000) + "\n[transcript truncated]";
  return out;
}

/**
 * Two blocks. The first -- instructions plus script -- is identical for every
 * call on the same script, so it is cached: calls graded within a few minutes
 * of each other pay ~5% of the normal price for it. The second block is the
 * part that changes per call. Keep anything call-specific OUT of the first
 * block, or the cache never hits.
 */
function buildPrompt(
  scriptTitle: string,
  modules: ModuleRow[],
  t: Transcript,
  repName: string,
  lang: "en" | "es",
  voice: VoiceTimeline | null,
  scriptNote: string,
  guidance: string,
  practice = "",
  skip: string[] = []
) {
  const s = scriptText(modules);
  const roadmap = ROADMAP.filter((r) => !skip.includes(r.stage));

  const stable = `You are reviewing a recorded phone call for a sales manager who coaches reps on a script. Grade how well the rep followed the script, and flag anything a compliance reviewer should hear.

The script is "${scriptTitle}".
${scriptNote ? `\n<about_this_script>\n${scriptNote}\n</about_this_script>\n` : ""}
<script>
${s.text}
</script>

How the script is annotated: <AC>, <I CARE>, <PT>, <RM>, <S>, <CALM>, <PREACHER> are Straight Line tonality markers (Absolute Certainty, I Care, Presupposing Tone, Reasonable Man, Scarcity, Calm, The Preacher) placed on the phrase they apply to. "client should feel" is the emotion that line is built to create. "coaching" is the manager's own note on why the line is there.

The script is built on Jordan Belfort's Straight Line Persuasion. Its backbone is this emotional roadmap -- the sequence of feelings the call is designed to take the client through, in order:
${roadmap.map((r, i) => `${i + 1}. ${r.stage} -- ${r.feel}`).join("\n")}
The script sections deliver these stages, but not one-to-one${skip.length ? "" : ': "Hopeless", for example, happens inside the SuperMoney section when the loan is not available'}. The three objection loops each rebuild one of Belfort's Three Tens: Loop 1 the product, Loop 2 trust in the rep, Loop 3 the company.

The transcript will follow. Each line is [seconds from start] speaker_id: words.
Speaker ids come from automatic diarization and can be imperfect -- work out who is who from what is said.
Banking and ID numbers have been removed and appear as [REDACTED] or [... REDACTED]. That is expected; never penalize it.

How to grade:

speaker_roles: one entry per speaker id in the transcript. role is "rep" (the rep named below), "client", "am" (an account manager conferenced in near the end), or "other".

sections: exactly one entry for each SECTION below, in this order:
${s.sequence.map((x) => `- ${x}`).join("\n")}
Add an entry for an OBJECTION LOOP only if that objection came up on the call; name it "Objection: <loop title>".
- "hit": the rep delivered the substance of the section. Word-for-word is not required.
- "partial": the rep did the section but left out something that matters. Say what in coaching.
- "missed": the call got past this point and the rep skipped it.
- "not_reached": the call ended or was handed off before this point.
evidence: a short quote from the transcript (20 words or fewer) showing what happened, or "" if missed/not reached. time: the seconds value of that line, or -1 if there is none.
coaching: one specific, practical sentence for the rep. "" if nothing to improve.

compliance: every required disclosure or confirmation question that appears in the script itself -- for example the call-recording notice, each compliance question the client must answer yes to, and statements about cancellation rights. One entry each, worded as the item. status "yes" if clearly done (for questions: asked and answered yes), "no" if the call reached that point and it was not done or the answer was not a clear yes, "unclear", or "not_reached".

flags: anything a compliance reviewer should listen to:
- every promise or claim about results (credit scores, timelines, savings, legal awards, debt being "gone"), even if the script contains it -- set in_script true when the script says essentially the same thing;
- anything said that contradicts the client acknowledgements (for example calling the program a loan or debt settlement, or saying the debt is no longer owed);
- misstatements, pressure, rushing past a client question or hesitation, or a client who sounds confused about what they agreed to;
- the rep reading sensitive numbers back aloud.
severity: "high" for anything that could mislead a client about what they are buying or what will happen to them; "medium" for overstated claims; "low" for minor wording. Quote 25 words or fewer. time: seconds, or -1.
List at most 15 flags. If there are more, keep the most serious, and prefer claims that are NOT in the script over ones that are. If the same claim is repeated, flag it once.

emotional_arc: this is the backbone of the grade. Exactly one entry per roadmap stage, in roadmap order, using the stage names exactly as written. Find each stage wherever it actually happened on the call. intended: the roadmap feeling for that stage, sharpened with the script's "client should feel" lines where they apply. observed: what the client actually showed, in a few words, judged only from what the client said. landed: "yes" if the client's own words show they reached the feeling, "partial", "no", or "not_reached" if the call never got there.
A stage only lands if the client genuinely understood. Agreement given while confused ("okay", "I guess") is not a landed pitch, close or contract stage -- mark it "partial" or "no" and say why in observed. If the loan was approved, "Hopeless" did not happen: mark it "not_reached".
evidence: a short quote of the CLIENT (20 words or fewer) or "", and its time (-1 if none).
section: the script section where this stage actually happened -- or, if it was not reached, the section where it belongs -- copied exactly as that section is titled in the script above.

slp: exactly these eight skills, in this order, each scored 1-10 (1-3 weak, 4-6 developing, 7-8 solid, 9-10 textbook), or 0 if the call never gave the rep a chance to show it:
- "Control and the straight line": the rep leads the conversation, brings tangents back, and moves the call forward on purpose.
- "Intelligence gathering": depth and quality of the hardship questions, listening, and summarizing back what the client said.
- "Rapport and trust (Ten 2)": the client's certainty in the rep as an expert who cares.
- "Product certainty (Ten 1)": whether the client clearly understands the program and believes it fits them.
- "Company certainty (Ten 3)": the client's certainty in Bolton and Lionside.
- "Looping": recognizing which Ten is low when the client stalls and running the matching loop.
- "Action and pain thresholds": raising the client's urgency honestly and lowering the risk they feel about acting.
- "Tonality and tonal variety": whether the rep's voice matched the tones the script marks and kept moving between them, judged from the voice measurements (see Tonality below).
evidence: a short quote (20 words or fewer) and its time (-1 if none), or "". coaching: one specific sentence.

How Straight Line is scored here -- this matters:
Approved wording and guarantees (from the sales manager):
- Saying a debt is "eliminated" is accurate and fine. When a debt is successfully disputed, the collection agency loses its right to collect, and the original creditor sold the debt so it can't collect either -- for all intents and purposes it is eliminated.
- GUARANTEEING debt elimination is fine too: whatever happens along the way, the company has a process to clear it (including escalating to legal to settle instead). Never flag, mark down or coach against guaranteeing that the debts will be eliminated, or the program's results generally.
- The ONE result that must not be guaranteed is a credit score in the 700s (or any specific score): the company doesn't control whether the client keeps up with their other credit obligations outside the program. Saying the score usually improves is fine; promising a specific score or range is a flag.
- Timelines: the ONLY short timeline a rep may give is that most accounts take about 4-6 months to go to collections after non-payment (true). Debt elimination and credit recovery (including any talk of the 700s) take AT LEAST 18-24 months, and the rep must say so when they bring them up. Flag any shorter timeline for elimination or credit recovery (for example "your debts will be gone in 4-6 months"), and flag talking about elimination or a better score without the 18-24 month timeframe when the client is clearly expecting it sooner. Don't confuse the two: "4-6 months to collections" is correct.
- What still matters, separately: the client understands the program is not a loan and not debt settlement, that Lionside/Bolton does not pay their creditors for them, and that their accounts go to collections.

Straight Line is about building real certainty and closing qualified buyers. A client who says they do not understand, cannot afford it, or want to stop is telling you their product certainty is low or that they may not qualify. In that moment the rep earns credit for slowing down, re-explaining in plain words, and confirming understanding and fit -- or for letting them go and setting a callback. Pushing forward, piling on new claims, or looping past real confusion or real inability to pay is NOT good control or good looping: score it down on "Control", "Product certainty" and "Looping", and it also belongs in flags. Never reward pressure on a client who has not understood what they are agreeing to.

three_tens: your estimate of where the client ended the call on product, rep and company, each 1-10, or 0 if the call did not get far enough to tell, plus one sentence of evidence.

slp_summary: two plain sentences on how well the rep ran the Straight Line, naming the roadmap stage where the arc broke (if it did) and why.

outcome: how the call ended for the sale -- "enrolled" (agreement signed or payment set up), "callback" (a specific follow-up was agreed), "not_interested", "hung_up", or "other". If the client agreed to a specific day or time to talk again (for example "Saturday at 11 with my wife"), the outcome is "callback", never "other".

ended: why the call stopped where it did. early: true if it ended before the close for a reason other than finishing (anything short of enrolled or a clear final no at the end of a full pitch). why: "client_time" (the client had to go -- work, kids, driving, a bad time), "spouse_needed" (wanted the spouse or another decision-maker there), "client_checked_out" (lost interest or got annoyed), "rep_ended" (the rep wrapped up or let it go when the client could have kept talking), "hung_up" (the line dropped or the client hung up without a reason), "completed" (not early), or "other". handled: how well the rep handled the early end -- "well" (for example booked a firm time with every decision-maker and re-anchored the pain first), "ok", "poorly" (let a willing client go, no firm next step, or pushed someone who had to leave), or "n/a" if not early. read: one plain sentence a manager can act on. When the client had to go or wanted the spouse there, the rep is not at fault for the sections the call never reached -- judge only what the time allowed, and say so. outcome_note: a few words, for example "set Nov 15 payment, did not give bank info".

turning_points: the 2 or 3 moments that most moved the client toward yes or away from it. time (seconds), moment (what happened, in a few words), direction ("toward" or "away"), why (one sentence). On an enrolled call these explain what earned the yes; on a lost call, where it was lost. Do not award credit for the close itself -- explain what caused it.

close_quality: only for an enrolled call, otherwise "n/a". Judge the client's state AT THE MOMENT THEY SIGNED, not the bumps along the way -- confusion or hesitation that the rep cleared up before the signature is normal selling, not a risk. "solid": by the end the client showed in their own words that they understood the core points (not a loan, not settlement, payments go to Bolton, accounts go to collections, they have to take part), chose it freely, and the payment fits their budget. "ok": the usual enrollment -- some bumps, small gaps or a rushed moment, but nothing that leaves the client signing on a false belief; most enrollments are "ok". "fragile": ONLY when a specific red flag is still standing when they sign -- they still clearly believe something false about a core point (it's a loan, the company pays their creditors, nothing will go to collections), they said they didn't understand and then just said "yes"/"okay" through the acknowledgements without the gap being closed, the payment is plainly beyond what they said they can afford, they were pushed past a clear "no", or the rep promised something that contradicts the acknowledgements and never corrected it. A fragile close must name that moment. Don't go soft either: if one of those red flags is genuinely still standing, it is "fragile" even if the call otherwise went well. close_quality_reason: one sentence, or "".

spotlights: two moments that decide most sales on this team. They are EXTRA awareness only. Grade everything else exactly as described above, and never let these change any other field or either score.
- hardship: the hardship / intelligence-gathering stretch. On this team the strongest calls keep the client talking about personal, vulnerable things (what happened, how it hits their family, how they feel about it) until roughly 8-12 minutes from the START of the call before moving on to the loan, credit report or options. moved_on_at: seconds from the start of the call when the rep moved off hardship (0 if the call never reached hardship; the call's end if they never moved on). vulnerable_secs: about how many seconds the client spent on genuinely personal, vulnerable talk. deepest: what the client opened up about, in a few words, no names. best_question: the rep's best follow-up that took it deeper (a quote), or "". cut_short and cut_short_time: the moment the rep cut it short while the client was still opening up (a quote, and seconds), or "" and 0. read: one plain sentence.
  Time alone is not the skill: the hardship is about getting the client vulnerable enough to share the sensitive, painful things that caused the debt, through empathy and the right questions. depth_reached: the deepest layer the client actually reached, judged only from the client's own words -- "facts" (amounts, accounts), "cause" (what happened that caused the debt), "impact" (how it hit their life, work, family), "feelings" (fear, shame, exhaustion, said in their own words), or "future" (what happens if nothing changes, and they feel it) -- or "none".
  parts, each 0-10: depth -- how far the client opened up (facts 2, cause 4, impact 6, feelings 8, future pain felt 10); questions -- open questions that moved from facts to cause to impact to feelings, not a yes/no checklist; followups -- whether the rep followed the client's own thread one layer deeper rather than jumping to the next question; empathy -- I Care tone, slowing down, pauses, letting silence work, not interrupting, reflecting back what they heard; anchoring -- whether the rep summed the pain back and got the client to own it before moving on to Create the Villain; on_line -- whether the hardship stayed on the straight line (the client's painful story about the debt IS on the line; unrelated stories, small talk and tangents are not) or the rep brought it back. If the call never reached hardship, all parts 0.
line_control: the straight line from open to close. Clients constantly try to pull the call "off to Pluto" -- stories that have nothing to do with the debt, side questions, debates, small talk -- and reps sometimes take it there themselves (chasing a tangent, oversharing). Going off the line briefly to build rapport is good when the rep brings it back; the longer it runs, the harder it is to bring the client back. The client's painful story about what caused the debt is ON the line, as is anything that moves the sale forward. excursions: every trip off the line longer than about 15 seconds -- at (seconds from the start), by ("client" or "rep" -- who took it off the line), about (a few words, no names), secs (how long it ran), back ("smooth" if the rep brought it back with a question or a tone shift, "slow" if it took several tries or the rep only got back after the client ran out, "never" if the call drifted and did not return), how (the line the rep used to bring it back, as a short quote, or ""). read: one plain sentence on how well the rep kept control of the line.
- turndown: the moment the SuperMoney loan comes back declined (the Hopeless stage). happened: false if there was no decline on this call (then the rest is "" / 0 / "n/a"). at: seconds. client_reaction: how the client took it, in a few words. pickup: the rep's next 60-90 seconds -- "strong" if they came back with real, positive certainty and energy that lifted the client out of despair (use the voice measurements in braces when present: energy and pitch up against the rep's own level, steady pace, no rush), "ok", or "flat" if they sounded deflated, unsure, apologetic or rushed. pickup_evidence: a quote or measurement. options_even: the three options exactly as the script presents them (credit counseling, debt settlement, financial wellness -- use the script's own wording and order) -- "yes" if all three were first laid out evenly and without bias, "partly", "no" if the rep steered before presenting all three neutrally, "n/a" if options were never reached. Steering toward one AFTER all three were presented evenly is fine and expected -- never count it against them. options_note: one short sentence. recovered: "yes", "partly", "no" or "n/a" -- did the client come back up afterwards, judged by what they said next. read: one plain sentence.

- followup: the follow-up game. More than half of this team's enrollments take more than one call, so how a rep handles a call that doesn't close, and how they re-open a follow-up, matters. kind: "followup" if this call picks up a conversation from an earlier call (see the client journey note, or clear cues in the call itself like "as we talked about", jumping straight into the application), "one_call" if the whole sale happened on this call, otherwise "first". ended_open: true if the call ended without an enrollment. stall_stated: the reason the client gave for not going ahead today ("need to talk to my wife", "call me Friday"), or "". stall_real: what was really underneath it, as far as the call shows, or "". got_to_bottom: "yes" if the rep found the real reason and dealt with it, "partly", "no" if they accepted the brush-off, "n/a" if there was no stall. next_step: "set" if a specific next step was agreed (a time, who needs to be on the call, what the client will have ready), "vague", "none", or "n/a" if the call enrolled. next_step_detail: a few words. reopen: on a follow-up, how the rep opened -- did they bring the pain and certainty back first, or jump straight to paperwork -- one sentence, else "". rebuilt: on a follow-up, "yes", "partly" or "no" for whether they rebuilt pain and certainty before asking again, else "n/a". repeat_stall: true if the client raised the same stall as on an earlier call. read: one plain sentence.

furthest_point: one short phrase for where the call ended (for example "Enrolled and handed to account manager" or "Client hung up during options").
summary: 2-3 plain sentences a busy manager can read in ten seconds.
strengths: 2-4 short items. coaching_priorities: the top 3 things for this rep to work on, most important first -- draw on the roadmap stage where the arc broke first, the Straight Line scorecard, the script sections and the flags together.

Tonality. Straight Line tonality is half of how the rep is graded, so judge it on every part of the call.
Most transcript lines carry measurements taken from the recording itself, in braces, for example {pitch moves 6.2st, ends falling, quieter by 4dB, 168wpm, after 1.3s pause}:
- pitch moves Xst: how much the voice rose and fell within that line, in semitones. Under ~2 is flat; 4-8 is normal expressive speech; 10+ is very animated.
- higher / lower than usual: the line's pitch against that speaker's own normal voice.
- ends rising / falling / level: the pitch at the end of the line against the rest of it.
- louder / quieter by XdB: against that speaker's own normal volume. 3dB is noticeable, 6dB is a clear change, 10dB+ is dramatic.
- wpm: speaking pace for that line. after Xs pause: silence before it.
A summary per speaker comes before the transcript, including long flat stretches. These are measured from phone audio, so treat them as good evidence rather than exact -- one odd reading is noise; a pattern is real.
What each tone sounds like, measured that way (from the Tone Key):
- AC (Absolute Certainty): hard and definitive -- firm, steady or louder volume, falling ends, no rush, no hesitation.
- I CARE: genuine empathy, then stop talking -- softer and often slower or lower than usual, then a pause for the client.
- PT (Presupposing): said like it goes without saying -- matter-of-fact, level or falling ends, even pace.
- RM (Reasonable Man): calm and level on small asks -- relaxed, with the ask ending rising ("Sound good?").
- S (Scarcity): drop toward a near-whisper -- clearly quieter.
- CALM: reassuring and steady -- slow, even, little movement. Flat is RIGHT here; never call CALM monotone.
- PREACHER: Absolute Certainty with annoyance and the spirit of the pulpit -- louder and more animated.
The Tone Key's own rule: never sit in one tone for long; the movement between tones is what clients respond to. Long flat stretches outside CALM, rushing (well above that rep's usual pace) through key moments, and statements that end rising (sounding unsure) all count against tonality.
If there are no measurements for this call, judge tonality from wording only and say so in tonality.summary.

tonality: summary: two sentences on how the rep used tone and variety across the call. flat_stretches: each long flat stretch from the summary that matters, with start and end in seconds and a note on what was being said (empty if none). tone_checks: up to 8 of the most telling moments where the script marks a tone -- time, tone (the marker, for example "I CARE"), expected (what it should sound like, a few words), heard (what the measurements show, a few words), match ("yes", "partial" or "no").
In emotional_arc, voice: a few words on how the rep's voice served that stage (for example "softened and slowed for the hardship -- I Care landed"), or "" if not reached.
Judge content from the words and delivery from the measurements. Do not guess at tone of voice beyond what the measurements show.
${guidance}
Return only the JSON object described by the schema.`;

  // Kept out of the cached block: the cache is per script, not per language.
  const spanish =
    lang === "es"
      ? `
This call is in Spanish and is graded against the Spanish script above. Read the original Spanish carefully -- judge what was actually said, not a paraphrase. Write ALL of your output in English, for an English-speaking manager: translate every quote and piece of evidence into faithful English -- never leave a quote in Spanish. Name each script section by its title exactly as listed (the names are mapped to the English script afterwards).
`
      : "";

  const notes = voiceNotes(voice, t);
  const voiceSummary = notes.header
    ? `\n<voice_summary>\n${notes.header}\n</voice_summary>\n`
    : "\nNo voice measurements were taken for this call.\n";

  const perCall = `The rep on this call is ${repName}.
${practice}${spanish}${voiceSummary}
<transcript>
${transcriptText(t, notes.lines)}
</transcript>

Grade this call as instructed above.`;

  return [
    { type: "text", text: stable, cache_control: { type: "ephemeral" } },
    { type: "text", text: perCall },
  ];
}

/*
  Structured output: the API guarantees the reply matches this schema.
  Every object must say additionalProperties: false.

  Kept deliberately plain -- no enums, no "number or null" unions. Both make
  the API's compiled grammar bigger, and past a limit it refuses the request
  ("compiled grammar is too large"). Allowed values are spelled out in the
  prompt instead and checked in clean() below; "none" is -1 or 0.
*/
const GRADE_SCHEMA = {
  type: "object",
  required: [
    "speaker_roles",
    "summary",
    "furthest_point",
    "sections",
    "compliance",
    "flags",
    "strengths",
    "coaching_priorities",
    "emotional_arc",
    "slp",
    "three_tens",
    "slp_summary",
    "tonality",
    "outcome",
    "outcome_note",
    "turning_points",
    "close_quality",
    "close_quality_reason",
    "spotlights",
    "line_control",
    "ended",
  ],
  additionalProperties: false,
  properties: {
    ended: {
      type: "object",
      additionalProperties: false,
      required: ["early", "why", "handled", "read"],
      properties: {
        early: { type: "boolean" },
        why: { type: "string" },
        handled: { type: "string" },
        read: { type: "string" },
      },
    },
    line_control: {
      type: "object",
      additionalProperties: false,
      required: ["excursions", "read"],
      properties: {
        excursions: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["at", "by", "about", "secs", "back", "how"],
            properties: { at: { type: "number" }, by: { type: "string" }, about: { type: "string" }, secs: { type: "number" }, back: { type: "string" }, how: { type: "string" } },
          },
        },
        read: { type: "string" },
      },
    },
    emotional_arc: {
      type: "array",
      items: {
        type: "object",
        required: ["stage", "section", "intended", "observed", "landed", "evidence", "time", "voice"],
        additionalProperties: false,
        properties: {
          stage: { type: "string" },
          intended: { type: "string" },
          observed: { type: "string" },
          landed: { type: "string" },
          voice: { type: "string" },
          section: { type: "string" },
          evidence: { type: "string" },
          time: { type: "number" },
        },
      },
    },
    slp: {
      type: "array",
      items: {
        type: "object",
        required: ["skill", "score", "evidence", "time", "coaching"],
        additionalProperties: false,
        properties: {
          skill: { type: "string" },
          score: { type: "integer" },
          evidence: { type: "string" },
          time: { type: "number" },
          coaching: { type: "string" },
        },
      },
    },
    three_tens: {
      type: "object",
      required: ["product", "rep", "company", "evidence"],
      additionalProperties: false,
      properties: {
        product: { type: "integer" },
        rep: { type: "integer" },
        company: { type: "integer" },
        evidence: { type: "string" },
      },
    },
    slp_summary: { type: "string" },
    tonality: {
      type: "object",
      required: ["summary", "flat_stretches", "tone_checks"],
      additionalProperties: false,
      properties: {
        summary: { type: "string" },
        flat_stretches: {
          type: "array",
          items: {
            type: "object",
            required: ["start", "end", "note"],
            additionalProperties: false,
            properties: { start: { type: "number" }, end: { type: "number" }, note: { type: "string" } },
          },
        },
        tone_checks: {
          type: "array",
          items: {
            type: "object",
            required: ["time", "tone", "expected", "heard", "match"],
            additionalProperties: false,
            properties: {
              time: { type: "number" },
              tone: { type: "string" },
              expected: { type: "string" },
              heard: { type: "string" },
              match: { type: "string" },
            },
          },
        },
      },
    },
    outcome: { type: "string" },
    outcome_note: { type: "string" },
    turning_points: {
      type: "array",
      items: {
        type: "object",
        required: ["time", "moment", "direction", "why"],
        additionalProperties: false,
        properties: {
          time: { type: "number" },
          moment: { type: "string" },
          direction: { type: "string" },
          why: { type: "string" },
        },
      },
    },
    close_quality: { type: "string" },
    close_quality_reason: { type: "string" },
    // Two moments that decide most sales. Extra awareness only: never part of either score.
    spotlights: {
      type: "object",
      required: ["hardship", "turndown", "followup"],
      additionalProperties: false,
      properties: {
        hardship: {
          type: "object",
          required: ["moved_on_at", "vulnerable_secs", "deepest", "best_question", "cut_short", "cut_short_time", "read", "depth_reached", "parts"],
          additionalProperties: false,
          properties: {
            depth_reached: { type: "string" },
            parts: {
              type: "object",
              additionalProperties: false,
              required: ["depth", "questions", "followups", "empathy", "anchoring", "on_line"],
              properties: {
                depth: { type: "number" },
                questions: { type: "number" },
                followups: { type: "number" },
                empathy: { type: "number" },
                anchoring: { type: "number" },
                on_line: { type: "number" },
              },
            },
            moved_on_at: { type: "number" },
            vulnerable_secs: { type: "number" },
            deepest: { type: "string" },
            best_question: { type: "string" },
            cut_short: { type: "string" },
            cut_short_time: { type: "number" },
            read: { type: "string" },
          },
        },
        followup: {
          type: "object",
          required: ["kind", "ended_open", "stall_stated", "stall_real", "got_to_bottom", "next_step", "next_step_detail", "reopen", "rebuilt", "repeat_stall", "read"],
          additionalProperties: false,
          properties: {
            kind: { type: "string" },
            ended_open: { type: "boolean" },
            stall_stated: { type: "string" },
            stall_real: { type: "string" },
            got_to_bottom: { type: "string" },
            next_step: { type: "string" },
            next_step_detail: { type: "string" },
            reopen: { type: "string" },
            rebuilt: { type: "string" },
            repeat_stall: { type: "boolean" },
            read: { type: "string" },
          },
        },
        turndown: {
          type: "object",
          required: ["happened", "at", "client_reaction", "pickup", "pickup_evidence", "options_even", "options_note", "recovered", "read"],
          additionalProperties: false,
          properties: {
            happened: { type: "boolean" },
            at: { type: "number" },
            client_reaction: { type: "string" },
            pickup: { type: "string" },
            pickup_evidence: { type: "string" },
            options_even: { type: "string" },
            options_note: { type: "string" },
            recovered: { type: "string" },
            read: { type: "string" },
          },
        },
      },
    },
    speaker_roles: {
      type: "array",
      items: {
        type: "object",
        required: ["speaker", "role"],
        additionalProperties: false,
        properties: {
          speaker: { type: "string" },
          role: { type: "string" },
        },
      },
    },
    summary: { type: "string" },
    furthest_point: { type: "string" },
    sections: {
      type: "array",
      items: {
        type: "object",
        required: ["section", "status", "evidence", "time", "coaching"],
        additionalProperties: false,
        properties: {
          section: { type: "string" },
          status: { type: "string" },
          evidence: { type: "string" },
          time: { type: "number" },
          coaching: { type: "string" },
        },
      },
    },
    compliance: {
      type: "array",
      items: {
        type: "object",
        required: ["item", "status", "evidence", "time"],
        additionalProperties: false,
        properties: {
          item: { type: "string" },
          status: { type: "string" },
          evidence: { type: "string" },
          time: { type: "number" },
        },
      },
    },
    flags: {
      type: "array",
      items: {
        type: "object",
        required: ["time", "quote", "issue", "in_script", "severity"],
        additionalProperties: false,
        properties: {
          time: { type: "number" },
          quote: { type: "string" },
          issue: { type: "string" },
          in_script: { type: "boolean" },
          severity: { type: "string" },
        },
      },
    },
    strengths: { type: "array", items: { type: "string" } },
    coaching_priorities: { type: "array", items: { type: "string" } },
  },
};

function askClaude(blocks: { type: string; text: string }[], key: string, strict: boolean) {
  /*
    strict: the grade comes back as JSON held to the schema by the API.
    Not strict (the API said the schema is too complex to compile): the grade
    is requested as a forced tool call instead. Tool inputs aren't compiled
    into a grammar, so there's no size limit, and the model fills the whole
    object far more reliably than when asked for "JSON in the reply".
  */
  return fetch(`${process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com"}/v1/messages`, {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      /*
        These models think by default, and thinking counts against
        max_tokens -- on a 90-minute call it used up the whole budget
        before writing the grade. thinkingFor() turns it off, which also
        keeps the job well inside Vercel's 5-minute limit.
      */
      max_tokens: 32000,
      ...thinkingFor(MODEL),
      ...(strict
        ? { output_config: { effort: "high", format: { type: "json_schema", schema: GRADE_SCHEMA } } }
        : {
            output_config: { effort: "high" },
            tools: [
              {
                name: "submit_grade",
                description: "Submit the complete grade for this call. Every field in the schema is required -- fill all of them.",
                input_schema: GRADE_SCHEMA,
              },
            ],
            // This model doesn't allow forcing a specific tool, so it's offered and the request says to use it.
            tool_choice: { type: "auto" },
          }),
      messages: [
        {
          role: "user",
          content: strict
            ? blocks
            : [...blocks, { type: "text", text: "Submit the grade by calling the submit_grade tool once, with every field filled in. Do not write the grade as text." }],
        },
      ],
    }),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
}

/** Maps the schema's plain values back to the app's: -1 and 0 mean "none",
 *  and anything outside the allowed set falls back to a safe value. */
/** How the grade names script sections and which roadmap stages a script leaves out. */
export type Naming = { titles: string[]; english: string[]; skip: string[]; lang: "en" | "es" };

const normTitle = (x: string) =>
  x
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z0-9áéíóúñü]+/g, " ")
    .trim();

/**
 * Names every section the way the English script does: snaps the grader's
 * name to the closest real section title (it sometimes adds or drops a word),
 * then swaps a Spanish title for its English counterpart. Drops roadmap
 * stages this script doesn't have.
 */
export function nameSections(g: Grade, n: Naming) {
  const find = (name: string): string => {
    const raw = (name || "").trim();
    if (!raw) return raw;
    const obj = raw.match(/^(objection|objeción)\s*:\s*/i);
    const body = obj ? raw.slice(obj[0].length) : raw;
    const a = normTitle(body);
    let i = n.titles.findIndex((t) => normTitle(t) === a);
    if (i < 0) i = n.titles.findIndex((t) => { const b = normTitle(t); return !!a && !!b && (a.startsWith(b) || b.startsWith(a)); });
    if (i < 0) i = n.english.findIndex((t) => normTitle(t) === a);
    const out = i >= 0 ? n.english[i] : body;
    return obj ? `Objection: ${out}` : out;
  };
  for (const s of g.sections ?? []) s.section = find(s.section);
  if (g.emotional_arc) {
    g.emotional_arc = g.emotional_arc.filter((a) => !n.skip.some((k) => k.toLowerCase() === String(a.stage).toLowerCase()));
    for (const a of g.emotional_arc) if (a.section) a.section = find(a.section);
  }
}

const SPANISH = /[¿¡ñ]|\b(qué|cómo|porque|usted|tengo|está|estoy|puedo|quiero|tarjetas|deuda|pagar|ahorita|bueno|gracias|también|entonces|necesito|dinero)\b/i;
const SPANISH_TITLE = /[áéíóúñ¿¡]|\b(el|la|los|las|del|sobre|cierre|contrato|presentación|crédito|villano|remate|apertura|dificultad)\b/i;
const NAME_KEYS = new Set(["section", "stage", "status", "landed", "outcome", "close_quality", "model", "graded_at", "role", "speaker", "severity", "direction", "kind", "skill"]);

/**
 * The grader is told to write in English, but quotes from a Spanish call
 * sometimes come back in Spanish. Translate whatever is left, in one cheap
 * pass, so a manager never has to read Spanish.
 */
export async function englishQuotes(g: Grade, key: string, englishTitles: Set<string> = new Set()) {
  const spots: { obj: Record<string, unknown> | unknown[]; k: string | number }[] = [];
  const walk = (x: unknown, depth = 0) => {
    if (!x || typeof x !== "object" || depth > 6) return;
    const entries: [string | number, unknown][] = Array.isArray(x) ? x.map((v, i) => [i, v]) : Object.entries(x as Record<string, unknown>);
    for (const [k, v] of entries) {
      if (typeof v === "string") {
        // Section names that found their English title stay as they are; any still in Spanish get translated too.
        if (typeof k === "string" && NAME_KEYS.has(k) && !(k === "section" && !englishTitles.has(v.replace(/^Objection:\s*/, "")) && SPANISH_TITLE.test(v))) continue;
        if (v.length > 2 && (SPANISH.test(v) || (k === "section" && SPANISH_TITLE.test(v)))) spots.push({ obj: x as Record<string, unknown>, k });
      } else walk(v, depth + 1);
    }
  };
  walk(g);
  if (!spots.length) return;
  const items = spots.map((s) => String((s.obj as Record<string | number, unknown>)[s.k]));
  const model = process.env.LEARN_MODEL || "claude-haiku-5-5";
  try {
    const res = await fetch(`${process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com"}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: 8000,
        output_config: {
          format: {
            type: "json_schema",
            schema: { type: "object", additionalProperties: false, required: ["items"], properties: { items: { type: "array", items: { type: "string" } } } },
          },
        },
        messages: [
          {
            role: "user",
            content: `These are notes about a recorded sales call. Some contain Spanish. Return the same list, same order and same length, with every Spanish word or quote translated into faithful, natural English. Keep anything already in English exactly as it is, and keep quote marks around quotes. Return the JSON only.\n\n${JSON.stringify(items)}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = (data.content || []).filter((c) => c.type === "text").map((c) => c.text || "").join("");
    const out = (JSON.parse(jsonrepair(text)) as { items?: unknown[] }).items;
    if (!Array.isArray(out) || out.length !== items.length) return;
    spots.forEach((s, i) => {
      if (typeof out[i] === "string" && out[i]) (s.obj as Record<string | number, unknown>)[s.k] = out[i];
    });
  } catch {
    // Leave the grade as it is rather than fail it over a translation.
  }
}

function clean(g: Grade) {
  const t = (n: unknown) => (typeof n === "number" && n >= 0 ? n : null);
  const one = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(v as T) ? (v as T) : fallback;
  const ten = (n: unknown) => (typeof n === "number" && n >= 1 ? Math.min(10, Math.round(n)) : null);

  for (const x of g.sections) {
    x.time = t(x.time);
    x.status = one(x.status, ["hit", "partial", "missed", "not_reached"] as const, "missed");
  }
  for (const x of g.compliance) {
    x.time = t(x.time);
    x.status = one(x.status, ["yes", "no", "unclear", "not_reached"] as const, "unclear");
  }
  for (const x of g.flags) {
    x.time = t(x.time);
    x.severity = one(x.severity, ["high", "medium", "low"] as const, "medium");
  }
  for (const x of g.speaker_roles) x.role = one(x.role, ["rep", "client", "am", "other"] as const, "other");
  for (const x of g.emotional_arc ?? []) {
    x.time = t(x.time);
    x.landed = one(x.landed, ["yes", "partial", "no", "not_reached"] as const, "no");
  }
  for (const x of g.slp ?? []) {
    x.time = t(x.time);
    x.score = ten(x.score);
  }
  if (g.three_tens) {
    g.three_tens.product = ten(g.three_tens.product);
    g.three_tens.rep = ten(g.three_tens.rep);
    g.three_tens.company = ten(g.three_tens.company);
  }
  if (g.tonality) {
    g.tonality.flat_stretches ||= [];
    g.tonality.tone_checks ||= [];
    for (const x of g.tonality.tone_checks) {
      x.time = t(x.time);
      x.match = one(String(x.match).toLowerCase(), ["yes", "partial", "no"] as const, "partial");
    }
  }
  for (const x of g.turning_points ?? []) {
    x.time = t(x.time);
    x.direction = one(x.direction, ["toward", "away"] as const, "away");
  }
  g.outcome = one(g.outcome, ["enrolled", "callback", "not_interested", "hung_up", "other"] as const, "other");
  g.close_quality = one(g.close_quality, ["solid", "ok", "fragile", "n/a"] as const, "n/a");
  const sp = g.spotlights;
  if (sp?.hardship) {
    sp.hardship.moved_on_at = t(sp.hardship.moved_on_at) ?? 0;
    sp.hardship.cut_short_time = t(sp.hardship.cut_short_time) ?? 0;
    sp.hardship.vulnerable_secs = Math.max(0, Math.round(Number(sp.hardship.vulnerable_secs) || 0));
  }
  if (sp?.followup) {
    sp.followup.kind = one(String(sp.followup.kind).toLowerCase(), ["first", "followup", "one_call"] as const, "first");
    sp.followup.got_to_bottom = one(String(sp.followup.got_to_bottom).toLowerCase(), ["yes", "partly", "no", "n/a"] as const, "n/a");
    sp.followup.next_step = one(String(sp.followup.next_step).toLowerCase(), ["set", "vague", "none", "n/a"] as const, "n/a");
    sp.followup.rebuilt = one(String(sp.followup.rebuilt).toLowerCase(), ["yes", "partly", "no", "n/a"] as const, "n/a");
  }
  if (sp?.turndown) {
    sp.turndown.at = t(sp.turndown.at) ?? 0;
    sp.turndown.pickup = one(String(sp.turndown.pickup).toLowerCase(), ["strong", "ok", "flat", "n/a"] as const, "n/a");
    sp.turndown.options_even = one(String(sp.turndown.options_even).toLowerCase(), ["yes", "partly", "no", "n/a"] as const, "n/a");
    sp.turndown.recovered = one(String(sp.turndown.recovered).toLowerCase(), ["yes", "partly", "no", "n/a"] as const, "n/a");
  }
}

type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};

/** Reads the grade JSON out of the reply: every text block joined, wrappers and small slips (stray control characters, trailing commas) tolerated. */
/**
 * On the tool-call route the model sometimes hands back a nested part of the
 * grade (line_control, spotlights...) as a JSON string instead of an object.
 * Turn those back into objects, everywhere in the grade, before anything uses them.
 */
export function unstring<T>(x: T, depth = 0): T {
  if (depth > 8 || x == null) return x;
  if (typeof x === "string") {
    const t = x.trim();
    // Tool-call markup leaked into a field (<parameter name="summary">...</parameter>...): read it as an object.
    if (/^<(?:\w+:)?parameter name="/.test(t)) {
      const o: Record<string, unknown> = {};
      const re = /<(?:\w+:)?parameter name="([^"]+)">([\s\S]*?)(?:<\/(?:\w+:)?parameter>|(?=<(?:\w+:)?parameter name=")|$)/g;
      for (const m of t.matchAll(re)) {
        const v = m[2].trim();
        let val: unknown = v;
        if (/^[[{]/.test(v) || /^-?\d+(\.\d+)?$/.test(v) || v === "true" || v === "false" || v === "null") {
          try {
            val = JSON.parse(v);
          } catch {
            try {
              val = JSON.parse(jsonrepair(v));
            } catch {
              val = v;
            }
          }
        }
        o[m[1]] = unstring(val, depth + 1);
      }
      return (Object.keys(o).length ? o : x) as T;
    }
    // Starts like JSON: parse it (repairing a cut-off or slightly broken one).
    if (t.startsWith("{") || (t.startsWith("[") && /^\[\s*[{\["]/.test(t))) {
      try {
        return unstring(JSON.parse(t), depth + 1) as T;
      } catch {
        try {
          return unstring(JSON.parse(jsonrepair(t)), depth + 1) as T;
        } catch {
          return x;
        }
      }
    }
    return x;
  }
  if (Array.isArray(x)) return x.map((v) => unstring(v, depth + 1)) as T;
  if (typeof x === "object") {
    const o = x as Record<string, unknown>;
    for (const k of Object.keys(o)) o[k] = unstring(o[k], depth + 1);
  }
  return x;
}

function readGrade(data: { content?: { type: string; text?: string; input?: unknown }[] }): Grade | null {
  const g = readGradeRaw(data);
  return g ? unstring(g) : null;
}

function readGradeRaw(data: { content?: { type: string; text?: string; input?: unknown }[] }): Grade | null {
  const text = (data.content || []).filter((c) => c.type === "text").map((c) => c.text || "").join("").trim();
  const real = (x: unknown): x is Grade => !!x && typeof x === "object" && !Array.isArray(x) && Array.isArray((x as Grade).sections) && (x as Grade).sections.length > 0;
  // The tool-call route: the grade is the tool's input.
  for (const c of data.content || []) {
    if (c.type !== "tool_use") continue;
    let input = c.input;
    if (typeof input === "string") {
      try {
        input = JSON.parse(input);
      } catch {
        // fall through
      }
    }
    if (real(input)) return input;
  }
  // The grade can come back as-is, wrapped one level down ({"grade": {...}}), inside an array,
  // or even as a JSON string of itself ("[{\"speaker_roles\": ...}]"). Unwrap until a real grade turns up.
  const find = (x: unknown, depth = 0): Grade | null => {
    if (depth > 4 || x == null) return null;
    if (typeof x === "string") {
      try {
        return find(JSON.parse(x), depth + 1);
      } catch {
        return null;
      }
    }
    if (real(x)) return x;
    // Sometimes the grade comes back split across an array of partial objects: put them back together.
    if (Array.isArray(x) && x.length > 1 && x.every((v) => v && typeof v === "object" && !Array.isArray(v))) {
      const merged = Object.assign({}, ...x);
      if (real(merged)) return merged;
    }
    if (Array.isArray(x)) {
      for (const v of x) {
        const g = find(v, depth + 1);
        if (g) return g;
      }
      return null;
    }
    if (typeof x === "object") {
      for (const v of Object.values(x as Record<string, unknown>)) {
        const g = find(v, depth + 1);
        if (g) return g;
      }
    }
    return null;
  };
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  const body = a >= 0 && b > a ? text.slice(a, b + 1) : text;
  const tries = [
    text,
    body,
    // raw tabs/newlines inside strings
    body.replace(/[\u0000-\u001f]+/g, " "),
    // trailing commas
    body.replace(/[\u0000-\u001f]+/g, " ").replace(/,\s*([}\]])/g, "$1"),
  ];
  for (const t of tries) {
    try {
      const g = find(JSON.parse(t));
      if (g) return g;
    } catch {
      // try the next repair
    }
  }
  // Last resort: a full JSON repair (unescaped quotes inside quoted client
  // words, a stray "[" in front, a missing closing bracket, and so on).
  for (const t of [text, body]) {
    try {
      const g = find(JSON.parse(jsonrepair(t)));
      if (g) return g;
    } catch {
      // nothing more to try
    }
  }
  return null;
}

async function grade(
  supabase: Supa,
  callId: string,
  blocks: { type: string; text: string }[],
  key: string,
  started: number,
  prior: { naming: Naming; previous: GradeVersion | null; history: GradeVersion[]; cost: CallCost }
) {
  try {
    let res = await askClaude(blocks, key, true);
    log("grade", callId, started, `anthropic ${res.status}`);

    // If the API ever refuses the schema again, ask for the same JSON as
    // plain text rather than failing the grade.
    if (res.status === 400) {
      const raw = await res.clone().text().catch(() => "");
      if (/grammar|schema|too (large|complex)/i.test(raw)) {
        log("grade", callId, started, "schema refused; retrying without strict format");
        res = await askClaude(blocks, key, false);
        log("grade", callId, started, `anthropic (plain) ${res.status}`);
      }
    }

    if (!res.ok) {
      const raw = await res.text().catch(() => "");
      let message = raw.slice(0, 300);
      try {
        message = JSON.parse(raw)?.error?.message || message;
      } catch {
        // not JSON
      }
      throw new Error(`Grading failed (${res.status}). ${message}`);
    }

    type Reply = { content?: { type: string; text?: string; input?: unknown }[]; stop_reason?: string; usage?: Usage };
    let data = (await res.json()) as Reply;
    const check = (d: Reply) => {
      if (d.stop_reason === "refusal") throw new Error("The grader declined to grade this call.");
      if (d.stop_reason === "max_tokens") throw new Error("The grade was too long and got cut off. Try again.");
    };
    check(data);

    let result = readGrade(data);
    if (!result && Date.now() - started < 150_000) {
      // Long calls occasionally come back malformed; one fresh try nearly always fixes it.
      // The second try takes the other route (a forced tool call), so it isn't the same request twice.
      log("grade", callId, started, "unreadable grade; asking once more as a tool call");
      const again = await askClaude(blocks, key, false);
      if (again.ok) {
        const first = data.usage;
        data = (await again.json()) as Reply;
        check(data);
        result = readGrade(data);
        // Count both attempts in the cost.
        if (first && data.usage)
          data.usage = {
            input_tokens: (first.input_tokens ?? 0) + (data.usage.input_tokens ?? 0),
            output_tokens: (first.output_tokens ?? 0) + (data.usage.output_tokens ?? 0),
            cache_creation_input_tokens: (first.cache_creation_input_tokens ?? 0) + (data.usage.cache_creation_input_tokens ?? 0),
            cache_read_input_tokens: (first.cache_read_input_tokens ?? 0) + (data.usage.cache_read_input_tokens ?? 0),
          };
      }
    }
    if (!result) {
      // Say what actually came back, so the cause can be fixed rather than guessed.
      const raw = (data.content || []).filter((c) => c.type === "text").map((c) => c.text || "").join("");
      const types = (data.content || []).map((c) => c.type).join(",") || "none";
      throw new Error(
        `The grader returned something unreadable. [stop: ${data.stop_reason ?? "?"}; blocks: ${types}; ${raw.length} chars; out ${data.usage?.output_tokens ?? "?"} tokens; starts: ${JSON.stringify(raw.slice(0, 160))}; ends: ${JSON.stringify(raw.slice(-80))}]`
      );
    }

    // Anything that should be an object but still isn't (a hopelessly broken part) is dropped, not allowed to fail the grade.
    const obj = (v: unknown) => !!v && typeof v === "object" && !Array.isArray(v);
    if (result.line_control && !obj(result.line_control)) delete result.line_control;
    if (result.line_control && !Array.isArray(result.line_control.excursions)) result.line_control.excursions = [];
    if (result.spotlights && !obj(result.spotlights)) delete result.spotlights;
    for (const k of ["hardship", "turndown", "followup"] as const) if (result.spotlights && result.spotlights[k] && !obj(result.spotlights[k])) delete result.spotlights[k];
    if (result.spotlights?.hardship?.parts && !obj(result.spotlights.hardship.parts)) delete result.spotlights.hardship.parts;
    if (result.three_tens && !obj(result.three_tens)) delete result.three_tens;
    if (result.tonality && !obj(result.tonality)) delete result.tonality;
    if (result.tonality) {
      if (!Array.isArray(result.tonality.flat_stretches)) result.tonality.flat_stretches = [];
      if (!Array.isArray(result.tonality.tone_checks)) result.tonality.tone_checks = [];
      if (typeof result.tonality.summary !== "string") result.tonality.summary = "";
    }
    // Any other part that should be an object but came back as text: drop it rather than fail the grade.
    {
      const r = result as unknown as Record<string, unknown>;
      for (const k of Object.keys(r)) if (typeof r[k] === "string" && /^\s*(<(?:\w+:)?parameter|[{[])/.test(r[k] as string)) delete r[k];
      for (const k of ["sections", "compliance", "flags", "strengths", "coaching_priorities", "speaker_roles", "emotional_arc", "turning_points", "slp"]) if (r[k] != null && !Array.isArray(r[k])) delete r[k];
    }
    result.sections ||= [];
    result.compliance ||= [];
    result.flags ||= [];
    result.strengths ||= [];
    result.coaching_priorities ||= [];
    result.speaker_roles ||= [];

    // The API can capitalize enum values ("Hit" for "hit"). Normalize so
    // scoring and the colored pills match.
    const low = <T extends string>(v: T) => String(v).toLowerCase().replace(/ /g, "_") as T;
    for (const s of result.sections) s.status = low(s.status);
    for (const c of result.compliance) c.status = low(c.status);
    for (const f of result.flags) f.severity = low(f.severity);
    for (const r of result.speaker_roles) r.role = low(r.role);
    result.emotional_arc ||= [];
    result.turning_points ||= [];
    if (result.outcome) result.outcome = low(result.outcome);
    if (result.close_quality) result.close_quality = low(result.close_quality);
    for (const t of result.turning_points) t.direction = low(t.direction);
    clean(result);
    nameSections(result, prior.naming);
    // Renew calls: a short hardship (2-4 minutes, marked so every page uses that target) and no loan turndown.
    if (prior.naming.skip.length && result.spotlights) {
      if (result.spotlights.hardship) result.spotlights.hardship.target = "renew";
      delete result.spotlights.turndown;
    }
    // Why it ended: a client who had to go (or wanted the spouse there) cut the hardship short, not the rep --
    // the hardship isn't timed against 8-12 minutes then, only its depth and questions count.
    if (result.ended && !obj(result.ended)) delete result.ended;
    if (result.ended) {
      const why = ["client_time", "spouse_needed", "client_checked_out", "rep_ended", "hung_up", "completed", "other"];
      result.ended.why = (why.includes(low(result.ended.why)) ? low(result.ended.why) : "other") as Ended["why"];
      result.ended.handled = (["well", "ok", "poorly", "n/a"].includes(low(result.ended.handled)) ? low(result.ended.handled) : "n/a") as Ended["handled"];
      result.ended.early = !!result.ended.early && result.ended.why !== "completed";
      const h = result.spotlights?.hardship;
      if (result.ended.early && ["client_time", "spouse_needed"].includes(result.ended.why) && h && h.target !== "renew" && typeof h.moved_on_at === "number" && h.moved_on_at < 8 * 60) h.target = "cut_short";
    }
    if (prior.naming.lang === "es") await englishQuotes(result, key, new Set(prior.naming.english));
    result.slp ||= [];
    for (const a of result.emotional_arc) a.landed = low(a.landed);
    // Scores outside 1-10 would skew the average; clamp them.
    for (const k of result.slp) {
      if (typeof k.score === "number") k.score = Math.max(1, Math.min(10, Math.round(k.score)));
    }

    // Hardship and line-control scores are computed here from the grader's parts, so the weights live in one place.
    if (result.spotlights?.hardship) result.spotlights.hardship.score = hardshipScoreOf(result.spotlights.hardship.parts);
    if (result.line_control) {
      const by = (v: string) => (v === "rep" ? "rep" : "client");
      const back = (v: string) => (["smooth", "slow", "never"].includes(String(v).toLowerCase()) ? (String(v).toLowerCase() as "smooth" | "slow" | "never") : "slow");
      result.line_control.excursions = (result.line_control.excursions ?? []).map((e) => ({ ...e, by: by(String(e.by).toLowerCase()), back: back(e.back), secs: Math.max(0, Number(e.secs) || 0), at: Math.max(0, Number(e.at) || 0) }));
      result.line_control.score = lineScoreOf(result.line_control);
    }
    result.grader_version = GRADER_VERSION;
    result.model = MODEL;
    result.graded_at = new Date().toISOString();

    const u = data.usage || {};
    const usd = gradeCostUsd(MODEL, u);
    const cost: CallCost = {
      ...prior.cost,
      grade_model: MODEL,
      grade_input_tokens: u.input_tokens ?? 0,
      grade_cache_read_tokens: u.cache_read_input_tokens ?? 0,
      grade_cache_write_tokens: u.cache_creation_input_tokens ?? 0,
      grade_output_tokens: u.output_tokens ?? 0,
      grade_usd: usd,
      // Every grading run is a real charge, including re-grades.
      grade_usd_total: (prior.cost.grade_usd_total ?? 0) + (usd ?? 0),
    };

    // The grade being replaced goes into history, newest first.
    // (A failed attempt leaves the old grade in place, so a retry would
    // otherwise file the same grade twice.)
    const prev = prior.previous;
    const alreadyFiled =
      !!prev && prior.history[0]?.grade?.graded_at === prev.grade.graded_at;
    const history =
      prev && !alreadyFiled
        ? [prev, ...prior.history].slice(0, HISTORY_KEEP)
        : prior.history;

    const { error } = await supabase
      .from("calls")
      .update({
        status: "graded",
        error: null,
        grade: result,
        score: scoreOf(result),
        slp_score: slpScoreOf(result),
        // The grader's reading. A manager's correction lives in outcome_manual
        // and is never overwritten by a re-grade.
        outcome: result.outcome ?? null,
        grade_history: history,
        cost,
        updated_at: new Date().toISOString(),
      })
      .eq("id", callId);

    if (error) throw new Error(`Could not save the grade. ${error.message}`);
    log(
      "grade",
      callId,
      started,
      `saved; in ${u.input_tokens} cache-read ${u.cache_read_input_tokens} cache-write ${u.cache_creation_input_tokens} out ${u.output_tokens}`
    );
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    await failCall(
      supabase,
      callId,
      timedOut ? "Grading took longer than the time limit. Try again." : e instanceof Error ? e.message : String(e)
    );
    log("grade", callId, started, `failed: ${e instanceof Error ? e.message : e}`);
  }
}
