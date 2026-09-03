import type { Phrase } from "@/lib/useKaraoke";

/**
 * Does this recording still say what the segment says?
 *
 * The training card and the timing editor both render the text stored inside
 * the recording's timings, not segments.script_text. That is right while they
 * agree -- the timings are what the highlighting runs on -- and quietly wrong
 * the moment the script is edited, because the card carries on showing words
 * the script no longer contains and nothing says so.
 *
 * It happened on 3 September: five segments were updated to the new script,
 * the full script page showed the change immediately, and the training cards
 * kept showing the old wording because their recordings had not been redone.
 *
 * Punctuation and case are ignored. A curly apostrophe or a capital is not a
 * script change, and flagging one would train people to ignore the warning.
 */
function bare(s: string): string {
  return s.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

export function recordingMatchesScript(
  timings: Phrase[] | null | undefined,
  scriptText: string | null | undefined
): boolean {
  // Nothing recorded yet is not a mismatch -- there is simply no master.
  if (!timings || timings.length === 0) return true;
  if (!scriptText) return true;

  return bare(timings.map((p) => p.text).join(" ")) === bare(scriptText);
}
