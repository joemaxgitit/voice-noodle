import { NextResponse, after } from "next/server";
import { afterTranscribe } from "@/lib/chain";
import { buildTranscript, isStuck, transcribeCostUsd, type CallStatus } from "@/lib/calls";
import { requireAdmin, failCall, log, type Supa } from "@/lib/callsServer";
import { sendToScribe } from "@/lib/scribe";

export const runtime = "nodejs";
// Vercel Hobby's ceiling. The response goes back immediately; this is how
// long the work in after() is allowed to keep running behind it.
export const maxDuration = 300;

const UPSTREAM_TIMEOUT_MS = 280_000;

export async function POST(request: Request) {
  const started = Date.now();
  const ctx = await requireAdmin(request);
  if (ctx instanceof NextResponse) return ctx;
  const { supabase } = ctx;

  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "ELEVENLABS_API_KEY is not set on the server." }, { status: 500 });
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
    .select("id, status, updated_at, audio_path, duration_secs, rep_id, rep_name, profiles:rep_id(full_name)")
    .eq("id", callId)
    .single();

  if (error || !call) {
    return NextResponse.json({ error: `Call not found. ${error?.message ?? ""}` }, { status: 404 });
  }
  if (!call.audio_path) {
    return NextResponse.json({ error: "This call has no audio (it was deleted)." }, { status: 400 });
  }

  const status = call.status as CallStatus;
  if ((status === "transcribing" || status === "grading") && !isStuck(status, call.updated_at)) {
    return NextResponse.json({ ok: true, already: true }, { status: 202 });
  }

  // 15 minutes is plenty: ElevenLabs fetches the file once, at the start.
  const { data: signed, error: signErr } = await supabase.storage
    .from("call-audio")
    .createSignedUrl(call.audio_path, 900);

  if (signErr || !signed?.signedUrl) {
    return NextResponse.json(
      { error: `Could not open the audio file. ${signErr?.message ?? ""}` },
      { status: 500 }
    );
  }

  const { error: claimErr } = await supabase
    .from("calls")
    .update({
      status: "transcribing",
      error: null,
      grade: null,
      score: null,
      // A new transcript needs a new translation.
      translation: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", callId);

  if (claimErr) {
    return NextResponse.json({ error: `Could not start. ${claimErr.message}` }, { status: 500 });
  }

  const repName =
    (call as unknown as { profiles: { full_name: string | null } | null }).profiles?.full_name ||
    (call.rep_name as string | null)?.trim() ||
    null;

  const audioSecs = Number(call.duration_secs) || null;

  // Then straight on to grading (and translating a Spanish call) -- no page needs to be open.
  after(async () => {
    await transcribe(supabase, callId, signed.signedUrl, key, repName || null, audioSecs, started);
    await afterTranscribe(request, supabase, callId);
  });

  log("transcribe", callId, started, "accepted");
  return NextResponse.json({ ok: true }, { status: 202 });
}

async function transcribe(
  supabase: Supa,
  callId: string,
  sourceUrl: string,
  key: string,
  repName: string | null,
  audioSecs: number | null,
  started: number
) {
  try {
    const { words, language, note } = await sendToScribe(
      sourceUrl,
      key,
      repName,
      started + UPSTREAM_TIMEOUT_MS
    );
    log("transcribe", callId, started, `scribe returned ${words.length} words`);

    if (words.length === 0) {
      await failCall(supabase, callId, "No speech was found in the recording.");
      return;
    }

    const { transcript, redactions } = buildTranscript(words, language);
    const last = transcript.utterances[transcript.utterances.length - 1];
    // Billed on audio length: use the length measured at upload when we
    // have it, else the last word (which ignores trailing silence).
    const secs = audioSecs ?? (last ? Math.round(last.end) : 0);

    const { error } = await supabase
      .from("calls")
      .update({
        status: "transcribed",
        error: note,
        transcript,
        redaction_count: redactions,
        duration_secs: secs || null,
        cost: { transcribe_secs: secs, transcribe_usd: transcribeCostUsd(secs) },
        updated_at: new Date().toISOString(),
      })
      .eq("id", callId);

    if (error) throw new Error(`Could not save the transcript. ${error.message}`);
    log("transcribe", callId, started, `saved, ${redactions} redactions`);
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    await failCall(
      supabase,
      callId,
      timedOut
        ? "Transcription took longer than 5 minutes, which is Vercel's limit on this plan. Very long calls need the Pro plan."
        : e instanceof Error
          ? e.message
          : String(e)
    );
    log("transcribe", callId, started, `failed: ${e instanceof Error ? e.message : e}`);
  }
}
