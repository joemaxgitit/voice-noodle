import { NextResponse, after } from "next/server";
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
import { requireAdmin, failCall, log, thinkingFor, type Supa } from "@/lib/callsServer";

export const runtime = "nodejs";
export const maxDuration = 300;

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


/**
 * Grades a transcribed call against its script. Returns at once; the work
 * runs in after() and the page polls the calls row.
 *
 * The grader only ever sees the redacted transcript.
 */
export async function POST(request: Request) {
  const started = Date.now();
  const ctx = await requireAdmin(request);
  if (ctx instanceof NextResponse) return ctx;
  const { supabase } = ctx;

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not set on the server. Add it in Vercel > Project > Settings > Environment Variables, then redeploy." },
      { status: 500 }
    );
  }

  let callId = "";
  try {
    callId = String((await request.json())?.callId || "");
  } catch {
    // fall through
  }
  if (!callId) return NextResponse.json({ error: "No call id." }, { status: 400 });

  const { data: call, error } = await supabase
    .from("calls")
    .select(
      "id, status, updated_at, transcript, voice, script_id, grade, score, slp_score, grade_history, cost, rep_name, profiles:rep_id(full_name)"
    )
    .eq("id", callId)
    .single();

  if (error || !call) {
    return NextResponse.json({ error: `Call not found. ${error?.message ?? ""}` }, { status: 404 });
  }

  const status = call.status as CallStatus;
  if ((status === "transcribing" || status === "grading") && !isStuck(status, call.updated_at)) {
    return NextResponse.json({ ok: true, already: true }, { status: 202 });
  }
  if (!call.transcript) {
    return NextResponse.json({ error: "Transcribe the call first." }, { status: 400 });
  }
  if (!call.script_id) {
    return NextResponse.json({ error: "Pick which script this call should be graded against." }, { status: 400 });
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
    return NextResponse.json(
      { error: `Could not load the script. ${modErr?.message ?? "It has no modules."}` },
      { status: 500 }
    );
  }

  /*
    The Options Script holds English and Spanish versions of every section.
    Grade only against the language of the call: half the script tokens, and
    no "Apertura -- not reached" rows on an English call. If a script has no
    modules marked for that language, use them all.
  */
  const transcript = call.transcript as Transcript;
  const lang = langOf(transcript.language);
  const pickLang = (ms: ModuleRow[]) => {
    const same = ms.filter((m) => (m.language || "en") === lang);
    return same.length > 0 ? same : ms;
  };
  let useModules = pickLang(modules as unknown as ModuleRow[]);

  /*
    A script that hands off to another one -- the Renew script opens the call
    and then continues on the Options Script from Phase 2. Grade the whole
    call as one script: this script's sections, then the other script's from
    the hand-off line onward, plus its objection loops.
  */
  const notes: string[] = [];
  const guidance = await managerGuidance(supabase);
  if (script?.grading_note) notes.push(script.grading_note.trim());

  if (script?.continues_into) {
    const [{ data: cont }, { data: contModules }] = await Promise.all([
      supabase.from("scripts").select("title").eq("id", script.continues_into).single(),
      supabase
        .from("modules")
        .select(MODULE_SELECT)
        .eq("script_id", script.continues_into)
        .eq("active", true)
        .order("sort_order"),
    ]);
    const next = pickLang((contModules || []) as unknown as ModuleRow[]);
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
    useModules = [...useModules, ...carried];
    notes.push(
      `After the sections above, the call continues on "${cont?.title ?? "the next script"}"` +
        (from ? ` from ${from}` : "") +
        ". Those sections are included above, in order, and are graded the same way."
    );
  }

  const { error: claimErr } = await supabase
    .from("calls")
    .update({ status: "grading", updated_at: new Date().toISOString() })
    .eq("id", callId);
  if (claimErr) {
    return NextResponse.json({ error: `Could not start. ${claimErr.message}` }, { status: 500 });
  }

  const repName =
    (call as unknown as { profiles: { full_name: string | null } | null }).profiles?.full_name ||
    (call.rep_name as string | null)?.trim() ||
    "the rep";

  const voice = (call.voice as VoiceTimeline | null) ?? null;
  const blocks = buildPrompt(
    script?.title || "Script",
    useModules,
    transcript,
    repName,
    lang,
    voice,
    notes.join("\n"),
    guidance
  );

  const previous: GradeVersion | null =
    call.grade && call.score !== undefined
      ? {
          grade: call.grade as Grade,
          score: call.score as number | null,
          slp_score: (call.slp_score as number | null) ?? null,
        }
      : null;

  after(() =>
    grade(supabase, callId, blocks, key, started, {
      previous,
      history: (call.grade_history as GradeVersion[] | null) || [],
      cost: (call.cost as CallCost | null) || {},
    })
  );

  log("grade", callId, started, `accepted (${lang}, ${useModules.length} modules)`);
  return NextResponse.json({ ok: true }, { status: 202 });
}

const CORRECTIONS_IN_PROMPT = 30;

/*
  What managers have taught the grader, added to every grade:
  - lessons they approved on the Insights page (graduates vs cancels), and
  - their most recent corrections to individual report items.
  Kept in the cached part of the prompt; it only changes when a manager adds
  something, so calls graded back to back still share the cache.
*/
async function managerGuidance(supabase: Supa): Promise<string> {
  const [{ data: g }, { data: fixes }] = await Promise.all([
    supabase.from("grading_guidance").select("lessons").maybeSingle(),
    supabase
      .from("call_corrections")
      .select("item_kind, item_label, original, correction")
      .order("created_at", { ascending: false })
      .limit(CORRECTIONS_IN_PROMPT),
  ]);

  const parts: string[] = [];
  const lessons = (g?.lessons as string | null)?.trim();
  if (lessons) {
    parts.push(
      "Lessons the sales manager approved from comparing enrollment calls of clients who graduated with clients who cancelled. Use them to sharpen your judgment of the roadmap, close quality and coaching -- they are patterns, not rules:\n" +
        lessons
    );
  }
  if (fixes?.length) {
    parts.push(
      "Corrections managers made to earlier grades. Apply the principle behind each one wherever it fits this call; never copy a correction onto a call where it does not apply:\n" +
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
  guidance: string
) {
  const s = scriptText(modules);

  const stable = `You are reviewing a recorded phone call for a sales manager who coaches reps on a script. Grade how well the rep followed the script, and flag anything a compliance reviewer should hear.

The script is "${scriptTitle}".
${scriptNote ? `\n<about_this_script>\n${scriptNote}\n</about_this_script>\n` : ""}
<script>
${s.text}
</script>

How the script is annotated: <AC>, <I CARE>, <PT>, <RM>, <S>, <CALM>, <PREACHER> are Straight Line tonality markers (Absolute Certainty, I Care, Presupposing Tone, Reasonable Man, Scarcity, Calm, The Preacher) placed on the phrase they apply to. "client should feel" is the emotion that line is built to create. "coaching" is the manager's own note on why the line is there.

The script is built on Jordan Belfort's Straight Line Persuasion. Its backbone is this emotional roadmap -- the sequence of feelings the call is designed to take the client through, in order:
${ROADMAP.map((r, i) => `${i + 1}. ${r.stage} -- ${r.feel}`).join("\n")}
The script sections deliver these stages, but not one-to-one: "Hopeless", for example, happens inside the SuperMoney section when the loan is not available. The three objection loops each rebuild one of Belfort's Three Tens: Loop 1 the product, Loop 2 trust in the rep, Loop 3 the company.

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
section: the name of the script section where this stage actually happened, written exactly as that section is titled in the script above (for a Spanish call, the title followed by its English name in parentheses); "" if the stage was not reached.

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
Straight Line is about building real certainty and closing qualified buyers. A client who says they do not understand, cannot afford it, or want to stop is telling you their product certainty is low or that they may not qualify. In that moment the rep earns credit for slowing down, re-explaining in plain words, and confirming understanding and fit -- or for letting them go and setting a callback. Pushing forward, piling on new claims, or looping past real confusion or real inability to pay is NOT good control or good looping: score it down on "Control", "Product certainty" and "Looping", and it also belongs in flags. Never reward pressure on a client who has not understood what they are agreeing to.

three_tens: your estimate of where the client ended the call on product, rep and company, each 1-10, or 0 if the call did not get far enough to tell, plus one sentence of evidence.

slp_summary: two plain sentences on how well the rep ran the Straight Line, naming the roadmap stage where the arc broke (if it did) and why.

outcome: how the call ended for the sale -- "enrolled" (agreement signed or payment set up), "callback" (a specific follow-up was agreed), "not_interested", "hung_up", or "other". outcome_note: a few words, for example "set Nov 15 payment, did not give bank info".

turning_points: the 2 or 3 moments that most moved the client toward yes or away from it. time (seconds), moment (what happened, in a few words), direction ("toward" or "away"), why (one sentence). On an enrolled call these explain what earned the yes; on a lost call, where it was lost. Do not award credit for the close itself -- explain what caused it.

close_quality: only for an enrolled call, otherwise "n/a". "solid" if the client clearly understood what they agreed to (not a loan, not settlement, payments go to Bolton, accounts go to collections, participation required) and chose it freely. "fragile" if they signed while confused, pressured, unable to afford the payment, or after the rep contradicted the acknowledgements -- a fragile close is a cancellation risk. close_quality_reason: one sentence, or "".

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
This call is in Spanish and is graded against the Spanish script above. Read the original Spanish carefully -- judge what was actually said, not a paraphrase. Write ALL of your output in English, for an English-speaking manager: translate every quote and piece of evidence into faithful English. Name each script section by its title as listed, followed by its English name in parentheses, for example "La dificultad (Hardship)".
`
      : "";

  const notes = voiceNotes(voice, t);
  const voiceSummary = notes.header
    ? `\n<voice_summary>\n${notes.header}\n</voice_summary>\n`
    : "\nNo voice measurements were taken for this call.\n";

  const perCall = `The rep on this call is ${repName}.
${spanish}${voiceSummary}
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
  ],
  additionalProperties: false,
  properties: {
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
  const content = strict
    ? blocks
    : [
        ...blocks,
        {
          type: "text",
          text:
            "Reply with exactly one JSON object and nothing else -- no prose, no code fences. " +
            "It must match this JSON Schema:\n" +
            JSON.stringify(GRADE_SCHEMA),
        },
      ];
  return fetch("https://api.anthropic.com/v1/messages", {
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
      output_config: strict
        ? { effort: "high", format: { type: "json_schema", schema: GRADE_SCHEMA } }
        : { effort: "high" },
      messages: [{ role: "user", content }],
    }),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
}

/** Maps the schema's plain values back to the app's: -1 and 0 mean "none",
 *  and anything outside the allowed set falls back to a safe value. */
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
  g.close_quality = one(g.close_quality, ["solid", "fragile", "n/a"] as const, "n/a");
}

type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};

async function grade(
  supabase: Supa,
  callId: string,
  blocks: { type: string; text: string }[],
  key: string,
  started: number,
  prior: { previous: GradeVersion | null; history: GradeVersion[]; cost: CallCost }
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

    const data = (await res.json()) as {
      content?: { type: string; text?: string }[];
      stop_reason?: string;
      usage?: Usage;
    };

    if (data.stop_reason === "refusal") {
      throw new Error("The grader declined to grade this call.");
    }
    if (data.stop_reason === "max_tokens") {
      throw new Error("The grade was too long and got cut off. Try again.");
    }

    const text = data.content?.find((c) => c.type === "text")?.text || "";
    let result: Grade;
    try {
      // Strict mode returns bare JSON; the plain fallback may wrap it.
      const a = text.indexOf("{");
      const b = text.lastIndexOf("}");
      result = JSON.parse(a >= 0 && b > a ? text.slice(a, b + 1) : text) as Grade;
    } catch {
      throw new Error("The grader returned something unreadable. Try again.");
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
    result.slp ||= [];
    for (const a of result.emotional_arc) a.landed = low(a.landed);
    // Scores outside 1-10 would skew the average; clamp them.
    for (const k of result.slp) {
      if (typeof k.score === "number") k.score = Math.max(1, Math.min(10, Math.round(k.score)));
    }

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
