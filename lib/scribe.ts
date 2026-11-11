import type { ScribeWord } from "@/lib/calls";

/* ElevenLabs speech-to-text (Scribe): shared by call transcription and whole-script run-throughs. */

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

export async function sendToScribe(
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

  let busyTries = 0;
  for (let i = 0; i < styles.length; i++) {
    const style = styles[i];
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
    // Too many at once (the plan's limit on calls running in parallel): wait for a slot and try the same
    // request again, a few times, while there's still time left for a long call to finish after.
    // ElevenLabs hiccups (5xx, not charged) get the same short wait and retry.
    if (((res.status === 429 && /concurrent/i.test(raw)) || res.status >= 500) && busyTries < 4 && deadline - Date.now() > 200_000) {
      busyTries++;
      await new Promise((r) => setTimeout(r, 15_000 + Math.random() * 10_000));
      i--;
      continue;
    }
    if (res.status !== 422) break; // only a format complaint is worth a retry
    console.log(`[transcribe] 422 with ${style} lists: ${raw.slice(0, 300)}`);
  }

  throw new Error(lastError || "Transcription did not finish in time.");
}

export function describeScribeError(status: number, raw: string): string {
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

