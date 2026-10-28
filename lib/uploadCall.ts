import type { SupabaseClient } from "@supabase/supabase-js";
import { startJob } from "@/lib/callsClient";
import { decodeMono, encodeMp3, SHRINK_OVER_BYTES, type Decoded } from "@/lib/shrinkAudio";
import { measureVoice, type VoiceData } from "@/lib/voice";

/*
  One recording into Voice Noodle, in the browser: read it, refuse a
  duplicate, measure the voice, shrink it if it's big, save the call, upload
  the audio and start transcription (grading follows by itself). Used by the
  single upload and by bulk upload.
*/

// Supabase's own per-file limit on the free plan. Paid plans can raise it.
export const MAX_MB = 50;

/** Length of an audio file, read in the browser before upload. */
export function audioSeconds(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const a = new Audio();
    let settled = false;
    const done = (v: number | null) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve(v);
    };
    a.preload = "metadata";
    a.onloadedmetadata = () => done(isFinite(a.duration) ? Math.round(a.duration) : null);
    a.onerror = () => done(null);
    setTimeout(() => done(null), 5000);
    a.src = url;
  });
}

// The same recording saved twice often gets " (1)" or " - Copy" added to its name.
export function baseName(n: string): string {
  return n
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,5}$/, "")
    .replace(/(\s*-\s*copy|\s+copy)?(\s*\(\d+\))*$/g, "")
    .replace(/(\s*-\s*copy|\s+copy)$/g, "")
    .trim();
}

export async function fileHash(f: File): Promise<string | null> {
  try {
    const d = await crypto.subtle.digest("SHA-256", await f.arrayBuffer());
    return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

export type Dupe = { id: string; what: string };

/** Same audio bytes, or the same name (ignoring "(1)", "- Copy") at the same length. */
export async function findDuplicate(supabase: SupabaseClient, file: File, seconds: number | null, hash: string | null): Promise<{ dupe: Dupe | null; hashCol: boolean }> {
  let hashCol = true;
  let hit: { id: string; client_label: string | null; call_date: string | null } | null = null;
  if (hash) {
    const { data, error } = await supabase.from("calls").select("id, client_label, call_date").eq("file_hash", hash).limit(1);
    if (error) hashCol = false; // column not added yet: the name check still runs
    else hit = data?.[0] ?? null;
  }
  if (!hit) {
    const base = baseName(file.name);
    const like = base.replace(/[\\%_]/g, (c) => "\\" + c);
    const { data } = await supabase.from("calls").select("id, file_name, duration_secs, client_label, call_date").ilike("file_name", `${like}%`).limit(50);
    hit =
      ((data || []) as { id: string; file_name: string | null; duration_secs: number | null; client_label: string | null; call_date: string | null }[]).find(
        (c) => baseName(c.file_name || "") === base && (c.duration_secs == null || seconds == null || Math.abs(c.duration_secs - seconds) <= 2)
      ) ?? null;
  }
  return { dupe: hit ? { id: hit.id, what: [hit.client_label, hit.call_date].filter(Boolean).join(" · ") } : null, hashCol };
}

export type UploadMeta = {
  orgId: string;
  uploadedBy: string;
  repId: string | null;
  repName: string | null;
  scriptId: string;
  clientLabel: string | null;
  callDate: string | null;
  /** "HH:MM", 24-hour. Saved once supabase/quick_reads.sql has been run. */
  callTime?: string | null;
  retention?: string | null;
  callNumber?: number | null;
  handoff?: string | null;
};

export type UploadResult = { ok: true; id: string } | { ok: false; error: string; dupe?: Dupe };

export async function uploadCall(supabase: SupabaseClient, file: File, meta: UploadMeta, onBusy: (s: string) => void = () => {}): Promise<UploadResult> {
  // The recording is decoded once, in this browser: for compressing long calls
  // under the storage limit and for measuring the voice for tonality grading.
  let upFile = file;
  let seconds: number | null = null;
  let voice: VoiceData | null = null;
  let decoded: Decoded | null = null;

  onBusy("Reading recording...");
  try {
    decoded = await decodeMono(file);
    seconds = Math.round(decoded.seconds);
  } catch (e) {
    // A file this browser cannot decode can still be transcribed; it just gets no voice measurements.
    if (file.size > SHRINK_OVER_BYTES) return { ok: false, error: e instanceof Error ? e.message : "Could not read the recording." };
    seconds = await audioSeconds(file);
  }

  onBusy("Checking it isn't already on file...");
  const hash = await fileHash(file);
  const { dupe, hashCol } = await findDuplicate(supabase, file, seconds, hash);
  if (dupe) return { ok: false, error: "This recording is already on file. Delete that call first if you want to upload it again.", dupe };

  if (decoded) {
    try {
      voice = await measureVoice(decoded.pcm, decoded.rate, (f) => onBusy(`Measuring voice ${Math.round(f * 100)}%...`));
    } catch {
      voice = null; // grading still works, from the words alone
    }
    if (file.size > SHRINK_OVER_BYTES) {
      try {
        upFile = await encodeMp3(decoded, file.name, (f) => onBusy(`Compressing ${Math.round(f * 100)}%...`));
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Could not compress the recording." };
      }
    }
    decoded = null; // let the browser free the decoded audio
  }

  if (upFile.size > MAX_MB * 1024 * 1024)
    return { ok: false, error: `Even compressed, this recording is ${(upFile.size / 1048576).toFixed(0)} MB, over the ${MAX_MB} MB storage limit. That is roughly a 3-hour call.` };

  const ext = (upFile.name.split(".").pop() || "mp3").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp3";

  onBusy("Saving...");
  const base = {
    org_id: meta.orgId,
    uploaded_by: meta.uploadedBy,
    rep_id: meta.repId,
    rep_name: meta.repName,
    script_id: meta.scriptId,
    client_label: meta.clientLabel,
    call_date: meta.callDate,
    ...(meta.retention ? { retention: meta.retention } : {}),
    ...(meta.callNumber ? { call_number: meta.callNumber } : {}),
    ...(meta.handoff ? { handoff: meta.handoff } : {}),
    file_name: file.name,
    ...(hash && hashCol ? { file_hash: hash } : {}),
    duration_secs: seconds,
    voice,
    status: "uploading",
  };
  const withTime: Record<string, unknown> = meta.callTime ? { ...base, call_time: meta.callTime } : base;
  let ins = await supabase.from("calls").insert(withTime).select("id").single();
  // The time of day needs supabase/quick_reads.sql; without it, save the call anyway.
  if (ins.error && meta.callTime && /call_time/.test(ins.error.message)) ins = await supabase.from("calls").insert(base).select("id").single();
  const row = ins.data as { id: string } | null;
  if (ins.error || !row) return { ok: false, error: `Could not create the call. ${ins.error?.message ?? ""}` };

  onBusy("Uploading recording...");
  const path = `${meta.orgId}/${row.id}.${ext}`;
  const { error: upErr } = await supabase.storage.from("call-audio").upload(path, upFile, { contentType: upFile.type || "audio/mpeg", upsert: false });
  if (upErr) {
    await supabase.from("calls").delete().eq("id", row.id);
    return { ok: false, error: `Upload failed. ${upErr.message}` };
  }
  await supabase.from("calls").update({ audio_path: path, status: "uploaded", updated_at: new Date().toISOString() }).eq("id", row.id);

  onBusy("Starting transcription...");
  const err = await startJob(supabase, "transcribe", row.id);
  if (err) return { ok: false, error: err };
  return { ok: true, id: row.id };
}

/** Convoso file names: ..._<client number>_<caller id>_MMDDYYYY_HHMMSS.mp3 */
export function convosoName(name: string): { phone: string | null; date: string | null; time: string | null } {
  // A copy saved twice gets " (1)" or " - Copy" before the extension: read past it.
  const clean = name.replace(/\s*(\(\d+\)|-\s*copy(\s*\(\d+\))?)(?=\.\w+$)/i, "");
  const m = clean.match(/(?:_(\d{10,11}))?(?:_(\d{10,11}))?_(\d{2})(\d{2})(\d{4})_(\d{2})(\d{2})(\d{2})\.\w+$/);
  if (!m) return { phone: null, date: null, time: null };
  const [, p1, , mm, dd, yyyy, hh, mi] = m;
  const okDate = +mm >= 1 && +mm <= 12 && +dd >= 1 && +dd <= 31;
  return { phone: p1 ? p1.slice(-10) : null, date: okDate ? `${yyyy}-${mm}-${dd}` : null, time: +hh < 24 && +mi < 60 ? `${hh}:${mi}` : null };
}
