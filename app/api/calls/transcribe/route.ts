import { NextResponse, after } from "next/server";
import { buildTranscript, isStuck, transcribeCostUsd, type CallStatus, type ScribeWord } from "@/lib/calls";
import { requireAdmin, failCall, log, type Supa } from "@/lib/callsServer";

export const runtime = "nodejs";
// Vercel Hobby's ceiling. The response goes back immediately; this is how
// long the work in after() is allowed to keep running behind it.
export const maxDuration = 300;

const UPSTREAM_TIMEOUT_MS = 280_000;

/*
  Words ElevenLabs should expect to hear. Without these it writes "Bolton" as
  "Bolden" and "Chirp" as "chirped". Adds ~20% to the transcription cost.
*/
const KEYTERMS = [
  "Lionside",
  "Lionside Financial",
  "Bolton",
  "Bolton Services Group",
  "Slate",
  "Chirp",
  "SuperMoney",
  "UA Law",
  "Financial Wellness",
  "Credit Counseling",
  "Debt Settlement",
  "Debt Consolidation",
  "tradeline",
  "charge off",
  "routing number",
];

/*
  Redacted by ElevenLabs before the transcript ever reaches us. Names and
  dollar amounts are deliberately NOT on this list -- the grader needs to
  hear the rep quote the payment and say the client's name.
  lib/calls.ts redacts long digit runs again as a second net.
*/
const REDACT_TYPES = [
  "bank_account",
  "account_number",
  "routing_number",
  "credit_card",
  "credit_card_expiration",
  "cvv",
  "ssn",
  "numerical_pii",
];

/**
 * Starts transcription of an uploaded call and returns at once.
 *
 * The audio never passes through this function: it is handed to ElevenLabs
 * as a short-lived signed URL, so file size and upload time are not our
 * problem. The transcription itself runs in after(), and the page polls the
 * calls row for the result.
 */
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

  after(() =>
    transcribe(supabase, callId, signed.signedUrl, key, repName || null, audioSecs, started)
  );

  log("transcribe", callId, started, "accepted");
  return NextResponse.json({ ok: true }, { status: 202 });
}

/** Builds the request body. `listStyle` exists because the API reference
 *  does not say how list fields are encoded in multipart; see sendToScribe. */
function scribeForm(
  sourceUrl: string,
  repName: string | null,
  listStyle: "repeat" | "json" | "none"
): FormData {
  const form = new FormData();
  form.append("model_id", "scribe_v2");
  form.append("source_url", sourceUrl);
  form.append("diarize", "true");
  // No detect_speaker_roles: it adds ~10% to the cost, and the grader works
  // out who the rep is from what is said. Labels can be fixed on the page.
  form.append("tag_audio_events", "false");
  form.append("timestamps_granularity", "word");

  const terms = [...KEYTERMS];
  for (const part of (repName || "").split(/\s+/)) {
    if (part.length > 1 && /^[\p{L}'-]+$/u.test(part)) terms.push(part);
  }

  if (listStyle === "repeat") {
    for (const t of terms) form.append("keyterms", t);
    for (const t of REDACT_TYPES) form.append("entity_detection", t);
    for (const t of REDACT_TYPES) form.append("entity_redaction", t);
  } else if (listStyle === "json") {
    form.append("keyterms", JSON.stringify(terms));
    form.append("entity_detection", JSON.stringify(REDACT_TYPES));
    form.append("entity_redaction", JSON.stringify(REDACT_TYPES));
  }
  if (listStyle !== "none") form.append("entity_redaction_mode", "entity_type");

  return form;
}

async function sendToScribe(
  sourceUrl: string,
  key: string,
  repName: string | null,
  deadline: number
): Promise<{ words: ScribeWord[]; language: string | null; note: string | null }> {
  /*
    Try the most likely encoding of the list fields first. If ElevenLabs
    rejects the request as malformed (422), try the other encoding, and as a
    last resort send it without keyterms or redaction -- our own digit-run
    redaction still runs on the result, so nothing unredacted is stored.
  */
  const styles: ("repeat" | "json" | "none")[] = ["repeat", "json", "none"];
  let lastError = "";

  for (const style of styles) {
    const remaining = deadline - Date.now();
    if (remaining < 15_000) break;

    const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": key },
      body: scribeForm(sourceUrl, repName, style),
      signal: AbortSignal.timeout(remaining),
    });

    if (res.ok) {
      const data = (await res.json()) as {
        words?: ScribeWord[];
        language_code?: string;
      };
      return {
        words: data.words || [],
        language: data.language_code || null,
        note:
          style === "none"
            ? "Transcribed without ElevenLabs redaction and keyterms (the request format was rejected). Digit-run redaction still applied."
            : null,
      };
    }

    const raw = await res.text().catch(() => "");
    lastError = describeScribeError(res.status, raw);
    if (res.status !== 422) break; // only a format complaint is worth a retry
    console.log(`[transcribe] 422 with ${style} lists: ${raw.slice(0, 300)}`);
  }

  throw new Error(lastError || "Transcription did not finish in time.");
}

function describeScribeError(status: number, raw: string): string {
  let code = "";
  let message = "";
  try {
    const parsed = JSON.parse(raw);
    code = parsed?.detail?.status || "";
    message = parsed?.detail?.message || (typeof parsed?.detail === "string" ? parsed.detail : "");
  } catch {
    // not JSON
  }
  if (code === "missing_permissions") {
    return "Your ElevenLabs key is missing Speech to Text permission. ElevenLabs > Developers > API Keys > Edit.";
  }
  if (code === "quota_exceeded") return "Your ElevenLabs account is out of credits.";
  return `Transcription failed (${status}). ${message || raw.slice(0, 300)}`;
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
