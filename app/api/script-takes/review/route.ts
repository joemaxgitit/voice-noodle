import { NextResponse, after } from "next/server";
import { createTokenSupabase, subjectOf } from "@/lib/supabase/server";
import { buildTranscript, transcribeCostUsd, voiceNotes, type Transcript, type VoiceTimeline } from "@/lib/calls";
import { sendToScribe } from "@/lib/scribe";
import { askJsonCost, REVIEW_MODEL } from "@/lib/repReview";
import { kick } from "@/lib/chain";
import { paceNotes } from "@/lib/pace";
import { checkRun, scriptForReview, RUN_AI_SCHEMA, TONE_GUIDE, type RunAi, type RunReview, type ScriptLine } from "@/lib/runThrough";

export const runtime = "nodejs";
export const maxDuration = 300;

/*
  Reviews a whole-script run-through, in two steps so each gets its own time limit:
  1. transcribe (ElevenLabs), then the code-only checks: lines said, word-for-word
     lines, pace, pauses, section lengths;
  2. one AI read: tone against the script's markers, the top 2 things to fix, what went well.
  Started by the rep's browser when they keep a take. Row-level security decides who
  can touch which take: the rep their own, managers the reps they can see.
*/
export async function POST(request: Request) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const userId = token ? subjectOf(token) : null;
  if (!userId) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  const supabase = await createTokenSupabase(token);
  const body = (await request.json().catch(() => ({}))) as { takeId?: string; step?: "transcribe" | "ai" };
  const takeId = String(body.takeId || "");
  const step = body.step === "ai" ? "ai" : "transcribe";
  if (!takeId) return NextResponse.json({ error: "No take." }, { status: 400 });

  const { data: take, error } = await supabase
    .from("script_takes")
    .select("id, user_id, script_id, audio_path, seconds, status, updated_at, transcript, review, voice")
    .eq("id", takeId)
    .single();
  if (error || !take) return NextResponse.json({ error: `Take not found. ${error?.message ?? ""}` }, { status: 404 });

  const busy = ["transcribing", "reviewing"].includes(String(take.status)) && Date.now() - new Date(String(take.updated_at)).getTime() < 6 * 60_000;
  if (step === "transcribe" && busy) return NextResponse.json({ ok: true, already: true }, { status: 202 });

  const save = (patch: Record<string, unknown>) => supabase.from("script_takes").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", takeId);

  if (step === "transcribe") {
    const key = process.env.ELEVENLABS_API_KEY;
    if (!key) return NextResponse.json({ error: "ELEVENLABS_API_KEY is not set on the server." }, { status: 500 });
    const { data: signed, error: sErr } = await supabase.storage.from("practice-audio").createSignedUrl(String(take.audio_path), 900);
    if (sErr || !signed?.signedUrl) return NextResponse.json({ error: `Could not open the recording. ${sErr?.message ?? ""}` }, { status: 500 });
    await save({ status: "transcribing", error: null });

    after(async () => {
      try {
        const { words, language } = await sendToScribe(signed.signedUrl, key, null, Date.now() + 280_000);
        if (!words.length) throw new Error("No speech was found in the recording.");
        const { transcript } = buildTranscript(words, language);
        const lang = /^es|spa/i.test(transcript.language || "") ? "es" : "en";
        const script = await scriptLines(supabase, String(take.script_id), lang);
        const review = checkRun(words, transcript, script);
        const secs = Number(take.seconds) || Math.round(transcript.utterances[transcript.utterances.length - 1]?.end ?? 0);
        const usd = transcribeCostUsd(secs);
        await save({ status: "reviewing", transcript, review, score: null, cost: { transcribe_usd: usd } });
        await kick(request, "/api/script-takes/review", { takeId, step: "ai" });
      } catch (e) {
        await save({ status: "failed", error: (e instanceof Error ? e.message : String(e)).slice(0, 500) });
      }
    });
    return NextResponse.json({ ok: true }, { status: 202 });
  }

  // Step 2: the AI read.
  const anthropic = process.env.ANTHROPIC_API_KEY;
  const transcript = take.transcript as Transcript | null;
  const review = take.review as RunReview | null;
  if (!transcript || !review) return NextResponse.json({ error: "Not transcribed yet." }, { status: 400 });
  if (!anthropic) {
    await save({ status: "done", review: { ...review, ai: null, ai_error: "ANTHROPIC_API_KEY is not set." } });
    return NextResponse.json({ ok: true });
  }
  await save({ status: "reviewing" });

  after(async () => {
    try {
      const lang = /^es|spa/i.test(transcript.language || "") ? "es" : "en";
      const script = await scriptLines(supabase, String(take.script_id), lang);
      const solo: Transcript = { ...transcript, speakers: ["rep"], utterances: transcript.utterances.map((u) => ({ ...u, speaker: "rep" })) };
      const notes = voiceNotes((take.voice as VoiceTimeline | null) ?? null, solo);
      const text = solo.utterances.map((u, i) => `[${Math.round(u.start)}] ${u.text}${notes.lines[i] ? ` {${notes.lines[i]}}` : ""}`).join("\n");
      const missed = review.lines.filter((l) => !l.optional && l.status !== "said").map((l) => `${l.section}: "${l.text}" (${l.status})`);
      const exactMiss = review.lines.filter((l) => l.verbatim && !l.optional && l.exact !== "exact").map((l) => `${l.section}: "${l.text}" (${l.exact})`);

      const prompt = `A sales rep recorded themselves reading the WHOLE sales script in one take, alone -- a practice run-through, no client on the line. Review the delivery the way a sales manager would, against the script below.

There is no client, so rapport, objections, looping, line control and the close's outcome don't apply. Judge: tone against the script's tone markers, pace (rushing key moments: the price or payment, the three options, the close), clarity and confidence, and whether the word-for-word lines were said exactly. Lines marked "(only if: ...)" are branches; skipping them is fine.

${TONE_GUIDE}
In this run-through there is one speaker (the rep). ${notes.header ? "" : "There are no voice measurements for this take: judge tone from wording and pace only, and say so in tonality.summary."}

<script>
${scriptForReview(script)}
</script>

<checked_by_code>
Script coverage: ${review.coverage}% of required lines said.
Missed or partly said: ${missed.length ? missed.slice(0, 40).join("; ") : "none"}.
Word-for-word lines: ${review.verbatim.exact} exact, ${review.verbatim.close} close, ${review.verbatim.missed} missed of ${review.verbatim.total}.${exactMiss.length ? ` Not exact: ${exactMiss.slice(0, 20).join("; ")}.` : ""}
Long pauses: ${review.pauses.length ? review.pauses.map((p) => `[${p.at}] ${p.secs}s`).join(", ") : "none"}.
</checked_by_code>
${notes.header ? `<voice_summary>\n${notes.header}\n</voice_summary>\n` : ""}<pace>
${paceNotes(solo) || "Not enough talking to measure."}
</pace>

<transcript>
${text}
</transcript>

Return JSON:
- score: 0-100 for the delivery overall (tone, pace, confidence, word-for-word accuracy). 85+ ready for live calls; 70-84 close; under 70 needs work.
- summary: two or three plain sentences a rep would understand.
- tonality: summary (two sentences on tone and variety), checks: up to 8 of the most telling tone moments -- time in seconds, tone (the marker), expected (a few words), heard (a few words), match yes/partial/no.
- needs: the TOP 2 things to fix, most important first -- title (short), why (one sentence), time (seconds, where it shows, or null), fix (what to do on the next run-through, one or two sentences).
- strengths: up to 3 things done well, each with a time or null.
Write everything in English. Times are seconds into the recording.`;

      const { data, usd } = await askJsonCost<RunAi>([{ type: "text", text: prompt }], RUN_AI_SCHEMA, anthropic, "Run-through review", 8000, REVIEW_MODEL);
      const ai: RunAi = { ...data, score: Math.max(0, Math.min(100, Math.round(Number(data.score) || 0))), needs: (data.needs || []).slice(0, 2), strengths: (data.strengths || []).slice(0, 3) };
      const { data: cur } = await supabase.from("script_takes").select("cost").eq("id", takeId).single();
      await save({ status: "done", review: { ...review, ai, ai_error: null }, score: ai.score, cost: { ...((cur?.cost as object) || {}), review_usd: usd } });
    } catch (e) {
      // The code checks stand on their own; keep them and say what went wrong with the AI read.
      await save({ status: "done", review: { ...review, ai: null, ai_error: (e instanceof Error ? e.message : String(e)).slice(0, 300) } });
    }
  });
  return NextResponse.json({ ok: true }, { status: 202 });
}

/** The script's lines in order, main sections only (no objection loops), in the take's language. */
async function scriptLines(supabase: Awaited<ReturnType<typeof createTokenSupabase>>, scriptId: string, lang: "en" | "es"): Promise<ScriptLine[]> {
  const { data: mods } = await supabase.from("modules").select("id, title, sort_order, kind, language").eq("script_id", scriptId);
  type M = { id: string; title: string; sort_order: number; kind: string | null; language: string | null };
  let ms = ((mods || []) as M[]).filter((m) => m.kind !== "loop");
  const inLang = ms.filter((m) => (m.language || "en") === lang);
  if (inLang.length) ms = inLang;
  else ms = ms.filter((m) => (m.language || "en") === "en");
  ms.sort((a, b) => a.sort_order - b.sort_order);
  if (!ms.length) return [];
  const { data: segs } = await supabase
    .from("segments")
    .select("segment_code, script_text, verbatim, condition, tones, sort_order, module_id")
    .in(
      "module_id",
      ms.map((m) => m.id),
    );
  const order = new Map(ms.map((m, i) => [m.id, i]));
  const title = new Map(ms.map((m) => [m.id, m.title]));
  type S = { segment_code: string; script_text: string | null; verbatim: boolean | null; condition: string | null; tones: string[] | null; sort_order: number; module_id: string };
  return ((segs || []) as S[])
    .filter((s) => (s.script_text || "").trim())
    .sort((a, b) => order.get(a.module_id)! - order.get(b.module_id)! || a.sort_order - b.sort_order)
    .map((s) => ({ segment_code: s.segment_code, script_text: s.script_text || "", verbatim: !!s.verbatim, condition: s.condition, section: title.get(s.module_id) || "", tones: s.tones || [] }));
}
