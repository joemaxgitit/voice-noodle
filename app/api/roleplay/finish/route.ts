import { NextResponse, after } from "next/server";
import { buildTranscript, isStuck, type CallCost, type ScribeWord, type VoiceTimeline } from "@/lib/calls";
import { failCall, log, type Supa } from "@/lib/callsServer";
import { prepareGrade } from "@/lib/gradeCall";
import { getConversation, requireMember, type XiConversation } from "@/lib/roleplayServer";
import { ROLEPLAY_USD_PER_MIN_DEFAULT, type RoleplayInfo } from "@/lib/roleplay";

export const runtime = "nodejs";
export const maxDuration = 300;

const WAIT_FOR_TRANSCRIPT_MS = 60_000;
const CLIENT_WORDS_PER_SEC = 2.6; // the mock client's speaking pace, for line end times

/**
 * The rep hung up. Fetches the call's transcript from ElevenLabs, files it in
 * the same shape as an uploaded call, and grades it with the same grader.
 * Body: { callId, conversationId, voice? } -- voice is the rep's own
 * microphone, measured in the browser, for the tonality grade.
 */
export async function POST(request: Request) {
  const started = Date.now();
  const ctx = await requireMember(request);
  if (ctx instanceof NextResponse) return ctx;
  const { supabase } = ctx;

  const body = (await request.json().catch(() => ({}))) as {
    callId?: string;
    conversationId?: string;
    voice?: VoiceTimeline | null;
  };
  const callId = String(body.callId || "");
  if (!callId) return NextResponse.json({ error: "No call id." }, { status: 400 });

  const { data: call, error } = await supabase
    .from("calls")
    .select("id, status, updated_at, source, roleplay, cost")
    .eq("id", callId)
    .single();
  if (error || !call || call.source !== "roleplay") {
    return NextResponse.json({ error: "Practice call not found." }, { status: 404 });
  }

  const info = (call.roleplay || {}) as RoleplayInfo;
  const conversationId = String(body.conversationId || info.conversation_id || "");
  if (!conversationId) {
    return NextResponse.json({ error: "The call never connected, so there is nothing to grade." }, { status: 400 });
  }
  // Already graded, or being worked on right now: nothing to do. A failed
  // or stuck call can be finished again.
  const busy = (call.status === "transcribing" || call.status === "grading") && !isStuck(call.status, call.updated_at);
  if (call.status === "graded" || busy) {
    return NextResponse.json({ ok: true, already: true }, { status: 202 });
  }

  const voice = body.voice?.f0?.length ? body.voice : null;
  const { error: upErr } = await supabase
    .from("calls")
    .update({
      status: "transcribing",
      error: null,
      roleplay: { ...info, conversation_id: conversationId, ended_at: info.ended_at || new Date().toISOString() },
      ...(voice ? { voice } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", callId);
  if (upErr) return NextResponse.json({ error: `Could not save the call. ${upErr.message}` }, { status: 500 });

  after(() => finish(supabase, callId, conversationId, voice, (call.cost as CallCost | null) || {}, started));
  return NextResponse.json({ ok: true }, { status: 202 });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function finish(
  supabase: Supa,
  callId: string,
  conversationId: string,
  voice: VoiceTimeline | null,
  cost: CallCost,
  started: number
) {
  try {
    // ElevenLabs finishes processing a few seconds after the hang-up.
    let conv: XiConversation | null = null;
    while (Date.now() - started < WAIT_FOR_TRANSCRIPT_MS) {
      conv = await getConversation(conversationId);
      if (conv.status === "done" || conv.status === "failed") break;
      await sleep(3000);
    }
    if (!conv) throw new Error("Could not fetch the practice call.");
    log("roleplay", callId, started, `conversation ${conv.status}, ${conv.transcript?.length ?? 0} turns`);

    const turns = (conv.transcript || []).filter((t) => (t.message || "").trim());
    if (!turns.some((t) => t.role === "user")) {
      throw new Error("Nothing the rep said was picked up on this call. Check the microphone and try again.");
    }

    const { data: row } = await supabase.from("calls").select("roleplay").eq("id", callId).single();
    const info = ((row?.roleplay as RoleplayInfo | null) || {}) as RoleplayInfo;

    const { words, seconds } = wordsOf(turns, voice, conv.metadata?.call_duration_secs);
    const { transcript, redactions } = buildTranscript(words, info.lang === "es" ? "spa" : "eng");

    const rate = Number(process.env.ROLEPLAY_USD_PER_MIN) || ROLEPLAY_USD_PER_MIN_DEFAULT;
    const usd = Math.round((seconds / 60) * rate * 1000) / 1000;

    const { error } = await supabase
      .from("calls")
      .update({
        status: "transcribed",
        transcript,
        redaction_count: redactions,
        duration_secs: seconds,
        // The rep is always speaker_0 and the client speaker_1 -- no guessing.
        speaker_roles: { speaker_0: "rep", speaker_1: "client" },
        roleplay: { ...info, usd },
        cost: { ...cost, roleplay_secs: seconds, roleplay_usd: usd },
        updated_at: new Date().toISOString(),
      })
      .eq("id", callId);
    if (error) throw new Error(`Could not save the transcript. ${error.message}`);

    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY is not set on the server.");
    const prep = await prepareGrade(supabase, callId, key, started);
    if (!prep.ok) throw new Error(prep.error);
    if (prep.already) return;
    log("roleplay", callId, started, `grading (${prep.summary})`);
    await prep.run();
  } catch (e) {
    await failCall(supabase, callId, e instanceof Error ? e.message : String(e));
    log("roleplay", callId, started, `failed: ${e instanceof Error ? e.message : e}`);
  }
}

/**
 * ElevenLabs gives each turn's start time but not word timings. Spread each
 * turn's words over its length so the transcript, redaction and voice notes
 * work exactly as on an uploaded call.
 *
 * A rep's turn ends where their microphone last heard voice before the next
 * turn -- so speaking pace on the report is real, not assumed. Without a
 * microphone measurement, or for the client, the end is estimated.
 */
function wordsOf(
  turns: XiConversation["transcript"],
  voice: VoiceTimeline | null,
  callSecs?: number
): { words: ScribeWord[]; seconds: number } {
  const words: ScribeWord[] = [];
  const total = Math.max(callSecs || 0, (turns[turns.length - 1]?.time_in_call_secs || 0) + 5);

  turns.forEach((t, i) => {
    const text = (t.message || "").trim();
    const tokens = text.split(/\s+/).filter(Boolean);
    const start = Number(t.time_in_call_secs) || 0;
    const next = i + 1 < turns.length ? Number(turns[i + 1].time_in_call_secs) || total : total;
    const room = Math.max(0.4, next - start - 0.1);
    let end = start + Math.min(room, Math.max(0.6, tokens.length / CLIENT_WORDS_PER_SEC));

    if (t.role === "user" && voice) {
      const a = Math.floor(start / voice.bin);
      const b = Math.min(voice.f0.length, Math.floor((start + room) / voice.bin));
      let last = -1;
      for (let k = a; k < b; k++) if (voice.f0[k] > 0) last = k;
      if (last >= a) end = Math.max(start + 0.4, (last + 1) * voice.bin);
    }

    const speaker = t.role === "user" ? "speaker_0" : "speaker_1";
    const step = (end - start) / Math.max(1, tokens.length);
    tokens.forEach((w, k) =>
      words.push({ text: w, start: start + k * step, end: start + (k + 1) * step, type: "word", speaker_id: speaker })
    );
  });

  return { words, seconds: Math.round(total) };
}
