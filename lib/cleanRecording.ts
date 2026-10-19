import type { SupabaseClient } from "@supabase/supabase-js";
import { bleepAudio } from "@/lib/bleep";
import { bleepPlan, type Transcript } from "@/lib/calls";

export type CleanableCall = {
  id: string;
  audio_path: string | null;
  transcript: Transcript | null;
  file_name: string | null;
  audio_redact_state: string | null;
};

/*
  Bleep the bank, card and ID numbers out of the stored recording, using the
  times the transcript recorded for each one. Runs in the manager's browser
  (free), once per call: the claim (state null -> working) stops two open
  tabs doing it twice. The cleaned file replaces the original, which is then
  deleted.

  Used by the call page and, so nobody has to open each call, by the Calls
  list as soon as a transcript lands.
*/
export async function cleanRecording(
  supabase: SupabaseClient,
  call: CleanableCall,
  opts: { retry?: boolean; onProgress?: (stage: string) => void } = {}
): Promise<{ ok: boolean; error?: string }> {
  const progress = opts.onProgress ?? (() => {});
  if (!call.audio_path || !call.transcript) return { ok: false };
  const from = opts.retry ? call.audio_redact_state : null;
  const claim = supabase
    .from("calls")
    .update({ audio_redact_state: "working", audio_redact_note: null, audio_redacted_at: new Date().toISOString() })
    .eq("id", call.id);
  const { data: claimed, error: claimErr } = await (from ? claim.eq("audio_redact_state", from) : claim.is("audio_redact_state", null)).select("id");
  if (claimErr) return { ok: false, error: `Could not start cleaning the recording. ${claimErr.message}` };
  if (!claimed?.length) return { ok: false }; // another tab got there first

  const oldPath = call.audio_path;
  const plan = bleepPlan(call.transcript);
  try {
    if (plan.spans.length === 0) {
      await supabase.from("calls").update({ audio_redact_state: "done", audio_redact_note: "No numbers to remove." }).eq("id", call.id);
      return { ok: true };
    }
    progress("Downloading recording...");
    const { data: signed, error: sErr } = await supabase.storage.from("call-audio").createSignedUrl(oldPath, 600);
    if (sErr || !signed) throw new Error(`Could not reach the recording. ${sErr?.message ?? ""}`);
    const res = await fetch(signed.signedUrl);
    if (!res.ok) throw new Error(`Could not download the recording (${res.status}).`);
    const out = await bleepAudio(await res.arrayBuffer(), plan.spans, call.file_name || "call.mp3", progress);

    progress("Uploading cleaned recording...");
    const newPath = `${oldPath.replace(/\.[^./]+$/, "")}-redacted-${Date.now()}.mp3`;
    const { error: upErr } = await supabase.storage.from("call-audio").upload(newPath, out.file, { contentType: "audio/mpeg", upsert: false });
    if (upErr) throw new Error(`Upload failed. ${upErr.message}`);

    const note =
      `${out.spans} spot${out.spans === 1 ? "" : "s"} bleeped` +
      (plan.method === "lines" ? " (whole lines, because this call was transcribed before exact timing was kept)" : "");
    const { error: updErr } = await supabase
      .from("calls")
      .update({ audio_path: newPath, audio_redact_state: "done", audio_redacted_at: new Date().toISOString(), audio_redact_note: note })
      .eq("id", call.id);
    if (updErr) throw new Error(updErr.message);

    // Only now is the original safe to remove.
    const { error: rmErr } = await supabase.storage.from("call-audio").remove([oldPath]);
    if (rmErr) await supabase.from("calls").update({ audio_redact_note: `${note}. The original file could not be deleted: ${rmErr.message}` }).eq("id", call.id);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabase.from("calls").update({ audio_redact_state: "failed", audio_redact_note: msg }).eq("id", call.id);
    return { ok: false, error: msg };
  }
}
