"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { startJob } from "@/lib/callsClient";
import {
  ROLE_LABEL,
  STATUS_LABEL,
  money,
  clock,
  isStuck,
  resolveRoles,
  scoreBand,
  slpScoreOf,
  OUTCOME_LABEL,
  bleepPlan,
  stageLabel,
  stageTerm,
  CANCEL_REASONS,
  daysToCancel,
  type Retention,
  type Outcome,
  arcScoreOf,
  skillsScoreOf,
  type CallStatus,
  type Grade,
  type Role,
  type Transcript,
  type Translation,
  langOf,
  translationStuck,
  type CallCost,
  type GradeVersion,
} from "@/lib/calls";
import { decodeMono } from "@/lib/shrinkAudio";
import { measureVoice } from "@/lib/voice";
import { bleepAudio } from "@/lib/bleep";
import type { RoleplayInfo } from "@/lib/roleplay";
import "../calls.css";

type Call = {
  id: string;
  source: string | null; // "roleplay" for a practice call with a mock client
  roleplay: RoleplayInfo | null;
  client_label: string | null;
  call_date: string | null;
  file_name: string | null;
  audio_path: string | null;
  duration_secs: number | null;
  status: CallStatus;
  error: string | null;
  transcript: Transcript | null;
  translation: Translation | null;
  voice_v: number | null; // set when voice measurements exist
  redaction_count: number;
  speaker_roles: Record<string, Role> | null;
  grade: Grade | null;
  score: number | null;
  slp_score: number | null;
  outcome: Outcome | null;
  outcome_manual: Outcome | null;
  retention: Retention | null;
  graduated_date: string | null;
  final_credit_score: number | null;
  audio_redact_state: "working" | "done" | "failed" | null;
  audio_redacted_at: string | null;
  audio_redact_note: string | null;
  cancel_date: string | null;
  cancel_reason: string | null;
  cancel_note: string | null;
  grade_history: GradeVersion[] | null;
  cost: CallCost | null;
  script_id: string | null;
  updated_at: string;
  profiles: { full_name: string | null } | null;
  rep_id: string | null;
  rep_name: string | null;
  scripts: { title: string; logo_url: string | null } | null;
};

const BUSY: CallStatus[] = ["uploading", "uploaded", "transcribing", "grading"];

const SECTION_LABEL = { hit: "Hit", partial: "Partial", missed: "Missed", not_reached: "Not reached" };
const ARC_LABEL: Record<string, string> = { yes: "Landed", partial: "Partly", no: "Didn't land", not_reached: "Not reached" };
const ARC_PILL: Record<string, string> = { yes: "good", partial: "fair", no: "poor", not_reached: "" };
const COMPLIANCE_LABEL = { yes: "Yes", no: "No", unclear: "Unclear", not_reached: "Not reached" };

const FOLD_KEY = "vn-call-folds";
const FOLD_IDS = ["roadmap", "skills", "tonality", "flags", "sections", "disclosures", "speakers", "transcript"];

/** "3 landed · 1 partly · 2 didn't land" -- counts in a fixed order, zeros left out. */
function countLine(values: string[], labels: Record<string, string>): string {
  return Object.entries(labels)
    .map(([k, label]) => [values.filter((v) => v === k).length, label] as const)
    .filter(([n]) => n > 0)
    .map(([n, label]) => `${n} ${label}`)
    .join(" \u00b7 ");
}

/** The lowest-scored Straight Line skill, as the preview for that section. */
function weakest(g: Grade): string {
  const scored = (g.slp ?? []).filter((k) => typeof k.score === "number");
  if (!scored.length) return "";
  const low = scored.reduce((a, b) => ((b.score as number) < (a.score as number) ? b : a));
  return `lowest: ${low.skill} ${low.score}/10`;
}

/**
 * A report section that opens and closes. The header line carries a score
 * badge and a short preview, so a closed section still says how it went.
 */
function Fold({
  title,
  badge,
  preview,
  open,
  forced,
  onOpenChange,
  children,
}: {
  title: string;
  badge?: ReactNode;
  preview?: string;
  open: boolean;
  forced: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <details
      className="fold"
      open={open}
      onToggle={(e) => {
        // While printing, sections are forced open; don't remember that.
        const now = (e.currentTarget as HTMLDetailsElement).open;
        if (!forced && now !== open) onOpenChange(now);
      }}
    >
      <summary>
        <span className="fold-title">{title}</span>
        {badge}
        {preview && <span className="fold-preview">{preview}</span>}
      </summary>
      <div className="fold-body">{children}</div>
    </details>
  );
}

type Correction = { id: string; item_key: string; correction: string };

type FixCtx = {
  fixes: Map<string, Correction>;
  save: (key: string, kind: string, label: string, original: string, text: string) => Promise<void>;
  remove: (key: string) => Promise<void>;
};

/**
 * "Not right?" on a report item. A manager's correction shows in place on
 * this grade, and is added to every future grade so the grader learns it.
 */
function Fix({
  ctx,
  k,
  kind,
  label,
  original,
}: {
  ctx: FixCtx;
  k: string;
  kind: string;
  label: string;
  original: string;
}) {
  const existing = ctx.fixes.get(k);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  if (existing && !open) {
    return (
      <div className="fix-done">
        <strong>Manager&rsquo;s correction:</strong> {existing.correction}
        <span className="no-print">
          {" "}
          <button
            className="link-btn"
            onClick={() => {
              setText(existing.correction);
              setOpen(true);
            }}
          >
            Edit
          </button>{" "}
          <button className="link-btn" onClick={() => void ctx.remove(k)}>
            Remove
          </button>
        </span>
      </div>
    );
  }

  if (!open) {
    return (
      <div className="no-print fix-link">
        <button className="link-btn" onClick={() => setOpen(true)}>
          Not right?
        </button>
      </div>
    );
  }

  return (
    <div className="no-print fix-edit">
      <textarea
        rows={2}
        autoFocus
        value={text}
        placeholder="What should it say? This teaches the grader for future calls."
        onChange={(e) => setText(e.target.value)}
      />
      <div className="row" style={{ marginTop: 6 }}>
        <button
          className="primary"
          disabled={!text.trim() || saving}
          onClick={async () => {
            setSaving(true);
            await ctx.save(k, kind, label, original, text.trim());
            setSaving(false);
            setOpen(false);
          }}
        >
          Save correction
        </button>
        <button onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}

/** Shows [... REDACTED] markers as quiet chips rather than loud text. */
function Said({ text }: { text: string }) {
  const parts = text.split(/(\[[A-Z ]*REDACTED\])/g);
  return (
    <>
      {parts.map((p, i) =>
        /^\[[A-Z ]*REDACTED\]$/.test(p) ? (
          <span key={i} className="redacted">
            {p.slice(1, -1).toLowerCase()}
          </span>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  );
}

export default function CallDetail() {
  const supabase = createClient();
  const router = useRouter();
  const { callId } = useParams<{ callId: string }>();

  const [call, setCall] = useState<Call | null>(null);
  const [scripts, setScripts] = useState<{ id: string; title: string }[]>([]);
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [repDraft, setRepDraft] = useState<string | null>(null); // typed name being edited
  const [audioUrl, setAudioUrl] = useState("");
  const [now, setNow] = useState(0);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  // -1 = the current grade; 0.. = an earlier one from grade_history.
  const [version, setVersion] = useState(-1);
  const audio = useRef<HTMLAudioElement>(null);
  const kicked = useRef(false);
  const kickedTranslate = useRef(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState("");
  const [voiceDone, setVoiceDone] = useState(false);
  const [fixList, setFixList] = useState<Correction[]>([]);
  const [myOrg, setMyOrg] = useState<string | null>(null);
  const [bleepBusy, setBleepBusy] = useState("");
  const kickedBleep = useRef(false);
  // Which part is being printed. The class it puts on <main> tells the print
  // stylesheet what to leave out; cleared again once the print dialog closes.
  const [printMode, setPrintMode] = useState<"report" | "transcript" | null>(null);

  // Which report sections are open. Remembered per browser, so a manager who
  // always reads flags first finds them open next time.
  const [folds, setFolds] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try {
      const saved = localStorage.getItem(FOLD_KEY);
      if (saved) setFolds(JSON.parse(saved));
    } catch {
      // private browsing or blocked storage: everything starts closed
    }
  }, []);
  const saveFolds = (next: Record<string, boolean>) => {
    setFolds(next);
    try {
      localStorage.setItem(FOLD_KEY, JSON.stringify(next));
    } catch {
      // not fatal
    }
  };
  const setAllFolds = (open: boolean) =>
    saveFolds(Object.fromEntries(FOLD_IDS.map((id) => [id, open])));

  // Paper gets every section, closed or not -- including Ctrl+P.
  const [printAll, setPrintAll] = useState(false);
  useEffect(() => {
    const before = () => flushSync(() => setPrintAll(true));
    const after = () => setPrintAll(false);
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);
  const forced = printAll || printMode !== null;
  const foldProps = (id: string) => ({
    open: forced || !!folds[id],
    forced,
    onOpenChange: (open: boolean) => saveFolds({ ...folds, [id]: open }),
  });
  useEffect(() => {
    if (!printMode) return;
    const done = () => setPrintMode(null);
    window.addEventListener("afterprint", done);
    // One frame so the class is on the page before the dialog snapshots it.
    const id = requestAnimationFrame(() => window.print());
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener("afterprint", done);
    };
  }, [printMode]);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("calls")
      .select(
        "id, source, roleplay, client_label, call_date, file_name, audio_path, duration_secs, status, error, transcript, redaction_count, speaker_roles, grade, score, slp_score, outcome, outcome_manual, retention, cancel_date, cancel_reason, cancel_note, graduated_date, final_credit_score, audio_redact_state, audio_redacted_at, audio_redact_note, grade_history, cost, translation, voice_v:voice->v, script_id, updated_at, rep_id, rep_name, profiles:rep_id(full_name), scripts(title, logo_url)"
      )
      .eq("id", callId)
      .single();
    if (error) setError(error.message);
    setCall((data as unknown as Call) || null);
  }, [supabase, callId]);

  // Corrections managers made on this call, and this manager's org for new ones.
  useEffect(() => {
    void supabase
      .from("call_corrections")
      .select("id, item_key, correction")
      .eq("call_id", callId)
      .then(({ data }) => setFixList((data || []) as Correction[]));
    void supabase.auth.getSession().then(({ data }) => {
      const uid = data.session?.user.id;
      if (!uid) return;
      void supabase
        .from("profiles")
        .select("org_id")
        .eq("id", uid)
        .single()
        .then(({ data: p }) => setMyOrg((p?.org_id as string) ?? null));
    });
  }, [supabase, callId]);

  useEffect(() => {
    void load();
    void supabase
      .from("scripts")
      .select("id, title")
      .eq("active", true)
      .order("sort_order")
      .then(({ data }) => setScripts(data || []));
    void supabase
      .from("profiles")
      .select("id, full_name, email, org_id")
      .eq("active", true)
      .then(({ data }) =>
        setPeople(
          (data || [])
            .filter((p) => p.org_id)
            .map((p) => ({ id: p.id as string, name: (p.full_name as string)?.trim() || (p.email as string) || "Unnamed" }))
            .sort((a, b) => a.name.localeCompare(b.name))
        )
      );
  }, [load, supabase]);

  // Signed URL for playback, once we know the path.
  const bleepStale =
    call?.audio_redact_state === "working" &&
    !!call.audio_redacted_at &&
    Date.now() - new Date(call.audio_redacted_at).getTime() > 10 * 60 * 1000;
  useEffect(() => {
    if (!call?.transcript || !call.audio_path || !audioUrl || kickedBleep.current) return;
    if (call.audio_redact_state === null) {
      kickedBleep.current = true;
      void cleanRecording();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call?.transcript, call?.audio_path, call?.audio_redact_state, audioUrl]);

  const audioPath = call?.audio_path;
  // A practice call's recording stays with ElevenLabs; stream it through.
  const practiceConv = call?.source === "roleplay" ? call.roleplay?.conversation_id || "" : "";
  const practiceCallId = practiceConv ? call?.id || "" : "";
  useEffect(() => {
    if (audioPath || !practiceCallId) return;
    let url = "";
    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const res = await fetch(`/api/roleplay/audio?callId=${practiceCallId}`, {
        headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
      }).catch(() => null);
      if (res?.ok) {
        url = URL.createObjectURL(await res.blob());
        setAudioUrl(url);
      }
    })();
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [audioPath, practiceCallId, supabase]);

  useEffect(() => {
    if (!audioPath) {
      if (!practiceCallId) setAudioUrl("");
      return;
    }
    void supabase.storage
      .from("call-audio")
      .createSignedUrl(audioPath, 3600)
      .then(({ data }) => setAudioUrl(data?.signedUrl || ""));
  }, [audioPath, supabase]);

  const isSpanish = langOf(call?.transcript?.language) === "es";
  const translating =
    isSpanish && call?.translation?.status === "working" && !translationStuck(call.translation);

  // Poll while a job runs.
  const running = !!call && BUSY.includes(call.status) && !isStuck(call.status, call.updated_at);
  useEffect(() => {
    if (!running && !translating) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [running, translating, load]);

  // Transcript just landed -> grade it (the list page does the same).
  useEffect(() => {
    if (call?.status === "transcribed" && call.script_id && !kicked.current) {
      kicked.current = true;
      void startJob(supabase, "grade", call.id).then((err) => {
        if (err) setError(err);
        void load();
      });
    }
  }, [call, supabase, load]);

  // Spanish transcript just landed -> translate it. Runs alongside grading;
  // the grade reads the original Spanish and never waits for this.
  useEffect(() => {
    if (call?.transcript && isSpanish && !call.translation && !kickedTranslate.current) {
      kickedTranslate.current = true;
      void startJob(supabase, "translate", call.id).then((err) => {
        if (err) setError(err);
        void load();
      });
    }
  }, [call, isSpanish, supabase, load]);

  /*
    For calls uploaded before voice measurement existed: pull the saved
    recording into this browser and measure it, the same as an upload does.
    Runs here rather than on the server because it is free here.
  */
  /*
    Bleep the bank, card and ID numbers out of the stored recording, using
    the times the transcript recorded for each one. Runs once per call, in
    this browser, as soon as the transcript exists; the cleaned file
    replaces the original, which is then deleted.

    The claim (state null -> working) stops two open tabs doing it twice.
  */
  async function cleanRecording(retry = false) {
    if (!call?.audio_path || !call.transcript || !audioUrl) return;
    setError("");
    const from = retry ? call.audio_redact_state : null;
    const claim = supabase
      .from("calls")
      .update({ audio_redact_state: "working", audio_redact_note: null, audio_redacted_at: new Date().toISOString() })
      .eq("id", call.id);
    const { data: claimed, error: claimErr } = await (from ? claim.eq("audio_redact_state", from) : claim.is("audio_redact_state", null)).select("id");
    if (claimErr) {
      // Most likely the SQL for this step has not been run yet.
      setError(`Could not start cleaning the recording. ${claimErr.message}`);
      return;
    }
    if (!claimed?.length) return; // another tab got there first

    const oldPath = call.audio_path;
    const plan = bleepPlan(call.transcript);
    try {
      if (plan.spans.length === 0) {
        await supabase
          .from("calls")
          .update({ audio_redact_state: "done", audio_redact_note: "No numbers to remove." })
          .eq("id", call.id);
        await load();
        return;
      }

      setBleepBusy("Downloading recording...");
      const res = await fetch(audioUrl);
      if (!res.ok) throw new Error(`Could not download the recording (${res.status}).`);
      const out = await bleepAudio(await res.arrayBuffer(), plan.spans, call.file_name || "call.mp3", setBleepBusy);

      setBleepBusy("Uploading cleaned recording...");
      const newPath = `${oldPath.replace(/\.[^./]+$/, "")}-redacted-${Date.now()}.mp3`;
      const { error: upErr } = await supabase.storage
        .from("call-audio")
        .upload(newPath, out.file, { contentType: "audio/mpeg", upsert: false });
      if (upErr) throw new Error(`Upload failed. ${upErr.message}`);

      const note =
        `${out.spans} spot${out.spans === 1 ? "" : "s"} bleeped` +
        (plan.method === "lines" ? " (whole lines, because this call was transcribed before exact timing was kept)" : "");
      const { error: updErr } = await supabase
        .from("calls")
        .update({
          audio_path: newPath,
          audio_redact_state: "done",
          audio_redacted_at: new Date().toISOString(),
          audio_redact_note: note,
        })
        .eq("id", call.id);
      if (updErr) throw new Error(updErr.message);

      // Only now is the original safe to remove.
      const { error: rmErr } = await supabase.storage.from("call-audio").remove([oldPath]);
      if (rmErr) {
        await supabase
          .from("calls")
          .update({ audio_redact_note: `${note}. The original file could not be deleted: ${rmErr.message}` })
          .eq("id", call.id);
      }
    } catch (e) {
      await supabase
        .from("calls")
        .update({ audio_redact_state: "failed", audio_redact_note: e instanceof Error ? e.message : String(e) })
        .eq("id", call.id);
    }
    setBleepBusy("");
    await load();
  }

  async function analyzeVoice() {
    if (!call || !audioUrl) return;
    setError("");
    try {
      setVoiceBusy("Downloading recording...");
      const res = await fetch(audioUrl);
      if (!res.ok) throw new Error(`Could not download the recording (${res.status}).`);
      const buf = await res.arrayBuffer();
      setVoiceBusy("Reading recording...");
      const decoded = await decodeMono(buf);
      const voice = await measureVoice(decoded.pcm, decoded.rate, (f) =>
        setVoiceBusy(`Measuring voice ${Math.round(f * 100)}%...`)
      );
      setVoiceBusy("Saving...");
      const { error } = await supabase.from("calls").update({ voice }).eq("id", call.id);
      if (error) throw new Error(error.message);
      setVoiceDone(true);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not measure the voice.");
    }
    setVoiceBusy("");
  }

  async function retranslate() {
    if (!call) return;
    kickedTranslate.current = true;
    const err = await startJob(supabase, "translate", call.id);
    if (err) setError(err);
    await load();
  }

  // Transcript labels use the names entered at upload: the rep chosen in the
  // dropdown, and the client name if one was typed.
  const label = (r: Role): string => {
    if (r === "rep") return call?.profiles?.full_name?.trim() || call?.rep_name?.trim() || ROLE_LABEL.rep;
    if (r === "client") return call?.client_label?.trim() || ROLE_LABEL.client;
    return ROLE_LABEL[r];
  };

  const roles = useMemo(
    () => resolveRoles(call?.transcript ?? null, call?.speaker_roles ?? null, call?.grade ?? null),
    [call]
  );

  function seek(t: number | null) {
    if (t === null || !audio.current) return;
    audio.current.currentTime = Math.max(0, t - 1);
    void audio.current.play().catch(() => {});
  }

  async function finishPractice(id: string): Promise<string> {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const res = await fetch("/api/roleplay/finish", {
      method: "POST",
      headers: { Authorization: `Bearer ${session?.access_token ?? ""}`, "Content-Type": "application/json" },
      body: JSON.stringify({ callId: id }),
    }).catch(() => null);
    if (res?.ok) return "";
    const b = res ? await res.json().catch(() => ({})) : {};
    return b?.error || "Could not fetch the practice call.";
  }

  async function run(route: "transcribe" | "grade") {
    if (!call) return;
    setWorking(true);
    setError("");
    kicked.current = true;
    // A practice call has no uploaded audio to transcribe; its transcript
    // comes from the voice agent.
    const err =
      call.source === "roleplay" && route === "transcribe"
        ? await finishPractice(call.id)
        : await startJob(supabase, route, call.id);
    if (err) setError(err);
    await load();
    setWorking(false);
  }

  async function setRole(speaker: string, role: Role) {
    if (!call) return;
    const next = { ...(call.speaker_roles || {}), [speaker]: role };
    setCall({ ...call, speaker_roles: next });
    const { error } = await supabase.from("calls").update({ speaker_roles: next }).eq("id", call.id);
    if (error) setError(error.message);
  }

  // A manager's correction. Kept separate so a re-grade never overwrites it;
  // choosing the grader's own answer clears the correction.
  /*
    Did the client stay? Saved as soon as a field changes. Marking a client
    cancelled defaults the date to today; it can be changed.
  */
  async function setRetention(
    patch: Partial<
      Pick<Call, "retention" | "cancel_date" | "cancel_reason" | "cancel_note" | "graduated_date" | "final_credit_score">
    >
  ) {
    if (!call) return;
    const next = { ...patch };
    if (patch.retention === "cancelled" && !call.cancel_date) {
      const d = new Date();
      next.cancel_date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
    // Switching status clears the other status's details.
    if (patch.retention !== undefined && patch.retention !== "cancelled") {
      next.cancel_date = null;
      next.cancel_reason = null;
      next.cancel_note = null;
    }
    if (patch.retention !== undefined && patch.retention !== "graduated") {
      next.graduated_date = null;
      next.final_credit_score = null;
    }
    setCall({ ...call, ...next });
    const { error } = await supabase.from("calls").update(next).eq("id", call.id);
    if (error) setError(error.message);
  }

  async function setOutcome(value: string) {
    if (!call) return;
    const manual = !value || value === call.outcome ? null : (value as Outcome);
    setCall({ ...call, outcome_manual: manual });
    const { error } = await supabase.from("calls").update({ outcome_manual: manual }).eq("id", call.id);
    if (error) setError(error.message);
  }

  /*
    Who the rep is. Picking an account links the call to it (and its name);
    a typed name is for reps who are not in Voice Noodle yet. Re-grade after
    changing it so the report uses the new name.
  */
  async function setRep(repId: string | null, repName: string | null) {
    if (!call) return;
    const person = people.find((p) => p.id === repId);
    setCall({
      ...call,
      rep_id: repId,
      rep_name: repName,
      profiles: person ? { full_name: person.name } : null,
    });
    const { error } = await supabase.from("calls").update({ rep_id: repId, rep_name: repName }).eq("id", call.id);
    if (error) setError(error.message);
  }

  async function setScript(id: string) {
    if (!call) return;
    setCall({ ...call, script_id: id });
    const { error } = await supabase.from("calls").update({ script_id: id }).eq("id", call.id);
    if (error) setError(error.message);
  }

  async function deleteAudio() {
    if (!call?.audio_path) return;
    if (!confirm("Delete the recording? The transcript and grade stay. This cannot be undone.")) return;
    const { error: rmErr } = await supabase.storage.from("call-audio").remove([call.audio_path]);
    if (rmErr) {
      setError(rmErr.message);
      return;
    }
    await supabase.from("calls").update({ audio_path: null }).eq("id", call.id);
    await load();
  }

  async function deleteCall() {
    if (!call) return;
    if (!confirm("Delete this call, its recording, transcript and grade? This cannot be undone.")) return;
    if (call.audio_path) await supabase.storage.from("call-audio").remove([call.audio_path]);
    const { error } = await supabase.from("calls").delete().eq("id", call.id);
    if (error) {
      setError(error.message);
      return;
    }
    router.push("/admin/calls");
  }

  if (!call) {
    return (
      <main className="shell calls-shell">
        {error ? <div className="error">{error}</div> : <p className="muted">Loading&hellip;</p>}
      </main>
    );
  }

  const history = call.grade_history ?? [];
  const viewing: GradeVersion | null =
    version >= 0 && history[version]
      ? history[version]
      : call.grade
        ? { grade: call.grade, score: call.score, slp_score: call.slp_score }
        : null;
  const g = viewing?.grade ?? null;
  const shownScore = viewing?.score ?? null;
  // Older grades predate the Straight Line scorecard; recompute when absent.
  const shownSlp = viewing ? viewing.slp_score ?? slpScoreOf(viewing.grade) : null;
  const modelName = (m?: string) =>
    !m ? "" : m.includes("haiku") ? "Haiku" : m.includes("sonnet") ? "Sonnet" : m.includes("opus") ? "Opus" : m;
  const versionLabel = (v: GradeVersion, i: number) =>
    `${i < 0 ? "Latest" : "Earlier"} \u00b7 script ${v.score ?? "-"}${
      (v.slp_score ?? slpScoreOf(v.grade)) !== null ? ` \u00b7 SLP ${v.slp_score ?? slpScoreOf(v.grade)}` : ""
    } \u00b7 ${modelName(v.grade.model)}${
      v.grade.graded_at
        ? ` \u00b7 ${new Date(v.grade.graded_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
        : ""
    }`;
  const cost = call.cost;
  const translateUsd = call.translation?.usd ?? null;
  const totalCost =
    cost && (cost.transcribe_usd !== undefined || cost.grade_usd_total !== undefined)
      ? (cost.transcribe_usd ?? 0) + (cost.grade_usd_total ?? 0) + (translateUsd ?? 0)
      : null;
  // The English line for utterance i, when a finished translation exists.
  const englishOf = (i: number): string | null =>
    call.translation?.status === "done" && call.translation.lines?.length === utterances.length
      ? call.translation.lines[i] ?? null
      : null;
  const stuck = isStuck(call.status, call.updated_at);
  const band = scoreBand(shownScore);

  /*
    Corrections belong to the grade they were made on: the key starts with
    that grade's timestamp, so after a re-grade they stop showing here (they
    still teach the grader on every future call).
  */
  const gradeKey = g?.graded_at ?? "";
  const fixCtx: FixCtx = {
    fixes: new Map(fixList.filter((f) => f.item_key.startsWith(gradeKey + "|")).map((f) => [f.item_key, f])),
    save: async (k, kind, label, original, text) => {
      setError("");
      const key = k; // already carries the grade prefix (see fx)
      const existing = fixList.find((f) => f.item_key === key);
      if (existing) {
        const { error } = await supabase.from("call_corrections").update({ correction: text }).eq("id", existing.id);
        if (error) return setError(error.message);
        setFixList((l) => l.map((f) => (f.id === existing.id ? { ...f, correction: text } : f)));
        return;
      }
      if (!myOrg) return setError("Could not find your organization.");
      const { data: session } = await supabase.auth.getSession();
      const { data, error } = await supabase
        .from("call_corrections")
        .insert({
          org_id: myOrg,
          call_id: call.id,
          item_kind: kind,
          item_key: key,
          item_label: label.slice(0, 200),
          original: original.slice(0, 1000),
          correction: text.slice(0, 2000),
          created_by: session.session?.user.id ?? null,
        })
        .select("id, item_key, correction")
        .single();
      if (error) return setError(`${error.message} -- has the calls-learning SQL been run?`);
      setFixList((l) => [...l, data as Correction]);
    },
    remove: async (k) => {
      const key = k; // already carries the grade prefix (see fx)
      const existing = fixList.find((f) => f.item_key === key);
      if (!existing) return;
      const { error } = await supabase.from("call_corrections").delete().eq("id", existing.id);
      if (error) return setError(error.message);
      setFixList((l) => l.filter((f) => f.id !== existing.id));
    },
  };
  // fixCtx.fixes is keyed with the grade prefix; Fix looks up by the full key.
  const fx = (k: string) => `${gradeKey}|${k}`;
  const printLogo = (call.scripts?.logo_url || "/proedge-logo.png")
    .replace(/\.png$/, "-light.png")
    .replace("/lionside-logo-light.png", "/lionside-logo-print.png");
  const utterances = call.transcript?.utterances ?? [];
  const speakers = call.transcript?.speakers ?? [];
  const flags = [...(g?.flags ?? [])].sort(
    (a, b) => ["high", "medium", "low"].indexOf(a.severity) - ["high", "medium", "low"].indexOf(b.severity)
  );

  return (
    <main className={`shell calls-shell${printMode ? ` printing-${printMode}` : ""}`}>
      <div className="topbar no-print">
        <Link className="btn" href="/admin/calls" style={{ textDecoration: "none" }}>
          &larr; Calls
        </Link>
        <div className="row">
          {g && <button onClick={() => setPrintMode("report")}>Print report</button>}
          {utterances.length > 0 && <button onClick={() => setPrintMode("transcript")}>Print transcript</button>}
        </div>
      </div>

      <div className="print-header">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={printLogo} alt="" />
        <span>
          {printMode === "transcript" ? "Call transcript" : "Call review"}
          {" \u00b7 printed "}
          {new Date().toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}
          <br />
          Confidential &mdash; internal use only
        </span>
      </div>

      <div className="call-head">
        <div>
          <div className="eyebrow">
            {call.call_date || ""}
            {call.duration_secs ? ` · ${clock(call.duration_secs)}` : ""}
            {call.scripts?.title ? ` · ${call.scripts.title}` : ""}
          </div>
          <h1>
            {call.profiles?.full_name?.trim() || call.rep_name?.trim() || "Unknown rep"}
            {call.client_label ? ` · ${call.client_label}` : ""}
          </h1>
          <span
            className={`pill ${call.status === "failed" || stuck ? "failed" : running ? "busy" : ""}`}
          >
            {stuck ? "Stuck" : STATUS_LABEL[call.status]}
          </span>
          {call.source === "roleplay" && (
            <span className="pill busy" style={{ marginLeft: 8 }}>
              Practice call{call.roleplay?.persona_title ? ` · ${call.roleplay.persona_title}` : ""}
            </span>
          )}
          {call.retention === "cancelled" && (
            <span className="pill failed" style={{ marginLeft: 8 }}>
              Cancelled
            </span>
          )}
          {call.retention === "graduated" && (
            <span className="pill good" style={{ marginLeft: 8 }}>
              Graduated
            </span>
          )}
          {call.redaction_count > 0 && (
            <span className="muted" style={{ marginLeft: 10, fontSize: 13 }}>
              {call.redaction_count} number{call.redaction_count === 1 ? "" : "s"} redacted
              {call.audio_path &&
                (bleepBusy
                  ? ` \u00b7 ${bleepBusy}`
                  : call.audio_redact_state === "done"
                    ? " \u00b7 bleeped from recording"
                    : call.audio_redact_state === "failed" || bleepStale
                      ? " \u00b7 still in recording"
                      : call.audio_redact_state === "working"
                        ? " \u00b7 removing from recording..."
                        : "")}
            </span>
          )}
          {call.audio_path && (call.audio_redact_state === "failed" || bleepStale) && !bleepBusy && (
            <button className="link-btn no-print" style={{ marginLeft: 8 }} onClick={() => cleanRecording(true)}>
              Bleep now
            </button>
          )}
        </div>
        {(shownScore !== null || shownSlp !== null) && (
          <div className="score-pair">
            {shownScore !== null && (
              <div>
                <div className={`score-big ${band}`}>{shownScore}</div>
                <div className="muted" style={{ fontSize: 12 }}>script</div>
              </div>
            )}
            {shownSlp !== null && (
              <div>
                <div className={`score-big ${scoreBand(shownSlp)}`}>{shownSlp}</div>
                <div className="muted" style={{ fontSize: 12 }}>straight line</div>
              </div>
            )}
          </div>
        )}
      </div>

      {running && (
        <p className="muted" style={{ marginTop: 14 }}>
          {call.status === "grading"
            ? "Grading against the script. Usually under a minute."
            : "Transcribing. A 30-minute call usually takes one to two minutes."}{" "}
          This page updates on its own.
        </p>
      )}

      {call.status === "failed" && call.error && <div className="error no-print">{call.error}</div>}
      {call.status !== "failed" && call.error && <div className="note no-print">{call.error}</div>}
      {error && <div className="error no-print">{error}</div>}

      <div className="row no-print" style={{ marginTop: 14 }}>
        {(call.status === "failed" || stuck) && (
          <button className="primary" disabled={working} onClick={() => run(call.transcript ? "grade" : "transcribe")}>
            Try again
          </button>
        )}
        {(call.status === "graded" || call.status === "failed") && call.transcript && (
          <button disabled={working} onClick={() => run("grade")}>
            Re-grade
          </button>
        )}
        {call.status === "transcribed" && !call.script_id && (
          <span className="muted">Pick a script below to grade this call.</span>
        )}
      </div>

      {audioUrl && (
        <div className="call-audio no-print">
          <audio
            ref={audio}
            src={audioUrl}
            controls
            preload="metadata"
            onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)}
          />
        </div>
      )}

      {history.length > 0 && call.grade && (
        <label className="field no-print" style={{ maxWidth: 420, marginTop: 18 }}>
          <span>Grade shown</span>
          <select value={version} onChange={(e) => setVersion(Number(e.target.value))}>
            <option value={-1}>{versionLabel({ grade: call.grade, score: call.score }, -1)}</option>
            {history.map((v, i) => (
              <option key={i} value={i}>
                {versionLabel(v, i)}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="report-part">
      {g && (
        <>
          <h2>Summary</h2>
          <p style={{ lineHeight: 1.6, margin: 0 }}>{g.summary}</p>
          <Fix ctx={fixCtx} k={fx("summary")} kind="Summary" label="Summary" original={g.summary} />
          <p className="muted" style={{ marginTop: 6 }}>
            Call ended: {g.furthest_point}
          </p>

          {(call.outcome || call.outcome_manual || g.outcome) && (
            <>
              <h2>Outcome</h2>
              <div className="grade-item">
                <div className="grade-item-head" style={{ alignItems: "center" }}>
                  <strong className="print-only">
                    {OUTCOME_LABEL[(call.outcome_manual ?? call.outcome ?? g.outcome ?? "other") as Outcome]}
                  </strong>
                  <select
                    className="no-print"
                    value={call.outcome_manual ?? call.outcome ?? g.outcome ?? ""}
                    onChange={(e) => setOutcome(e.target.value)}
                    style={{ width: "auto", fontSize: 15, padding: "8px 10px" }}
                    aria-label="Call outcome"
                  >
                    {(Object.keys(OUTCOME_LABEL) as Outcome[]).map((o) => (
                      <option key={o} value={o}>
                        {OUTCOME_LABEL[o]}
                      </option>
                    ))}
                  </select>
                  {g.close_quality && g.close_quality !== "n/a" && (
                    <span className={`pill ${g.close_quality === "solid" ? "good" : "poor"}`}>
                      {g.close_quality === "solid" ? "Solid close" : "Fragile close \u00b7 cancel risk"}
                    </span>
                  )}
                </div>
                {g.outcome_note && <div className="grade-coach">{g.outcome_note}</div>}
                {g.close_quality_reason && <div className="grade-coach">{g.close_quality_reason}</div>}
                {g.close_quality && g.close_quality !== "n/a" && (
                  <Fix
                    ctx={fixCtx}
                    k={fx("close")}
                    kind="Close quality"
                    label={g.close_quality}
                    original={`${g.close_quality} close: ${g.close_quality_reason ?? ""}`}
                  />
                )}
                {call.outcome_manual && (
                  <div className="calls-meta">
                    Corrected by a manager. The grader read it as{" "}
                    {OUTCOME_LABEL[(call.outcome ?? g.outcome ?? "other") as Outcome]}.
                  </div>
                )}

                {(call.outcome_manual ?? call.outcome ?? g.outcome) === "enrolled" && (
                  <div className="retention">
                    <div className="grade-item-head" style={{ alignItems: "center" }}>
                      <span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>
                        Retention
                      </span>
                      <strong className="print-only">
                        {call.retention === "cancelled"
                          ? "Cancelled"
                          : call.retention === "graduated"
                            ? "Graduated"
                            : call.retention === "active"
                              ? "Active"
                              : "Not set"}
                      </strong>
                      <select
                        className="no-print"
                        value={call.retention ?? ""}
                        onChange={(e) => setRetention({ retention: (e.target.value || null) as Retention | null })}
                        style={{ width: "auto", fontSize: 14, padding: "6px 10px" }}
                        aria-label="Retention"
                      >
                        <option value="">Not set</option>
                        <option value="active">Active</option>
                        <option value="cancelled">Cancelled</option>
                        <option value="graduated">Graduated</option>
                      </select>
                    </div>

                    {call.retention === "graduated" && (
                      <>
                        <div className="retention-fields no-print">
                          <label className="field">
                            <span>Graduated on (optional)</span>
                            <input
                              type="date"
                              value={call.graduated_date ?? ""}
                              onChange={(e) => setRetention({ graduated_date: e.target.value || null })}
                            />
                          </label>
                          <label className="field">
                            <span>Final credit score (optional)</span>
                            <input
                              type="number"
                              min={300}
                              max={850}
                              defaultValue={call.final_credit_score ?? ""}
                              placeholder="e.g. 712"
                              onBlur={(e) => {
                                const n = e.target.value ? Math.round(Number(e.target.value)) : null;
                                if (n !== call.final_credit_score && (n === null || (n >= 300 && n <= 850)))
                                  void setRetention({ final_credit_score: n });
                              }}
                            />
                          </label>
                        </div>
                        <div className="grade-coach">
                          Graduated
                          {call.graduated_date ? ` on ${call.graduated_date}` : ""}
                          {call.final_credit_score ? ` \u00b7 final credit score ${call.final_credit_score}` : ""}
                          {" \u00b7 "}this call now counts as a graduate&rsquo;s enrollment call on the Insights page.
                        </div>
                      </>
                    )}

                    {call.retention === "cancelled" && (
                      <>
                        <div className="retention-fields no-print">
                          <label className="field">
                            <span>Cancelled on</span>
                            <input
                              type="date"
                              value={call.cancel_date ?? ""}
                              onChange={(e) => setRetention({ cancel_date: e.target.value || null })}
                            />
                          </label>
                          <label className="field">
                            <span>Reason</span>
                            <select
                              value={call.cancel_reason ?? ""}
                              onChange={(e) => setRetention({ cancel_reason: e.target.value || null })}
                            >
                              <option value="">Choose&hellip;</option>
                              {Object.entries(CANCEL_REASONS).map(([k, v]) => (
                                <option key={k} value={k}>
                                  {v}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="field wide">
                            <span>Note (optional)</span>
                            <input
                              defaultValue={call.cancel_note ?? ""}
                              placeholder="What the client said, who took the call"
                              onBlur={(e) =>
                                e.target.value !== (call.cancel_note ?? "") &&
                                setRetention({ cancel_note: e.target.value || null })
                              }
                            />
                          </label>
                        </div>
                        <div className="grade-coach">
                          {(() => {
                            const days = daysToCancel(call.call_date, call.cancel_date);
                            const parts = [
                              days === null
                                ? ""
                                : days <= 7
                                  ? `Cancelled ${days} day${days === 1 ? "" : "s"} after the sale \u2014 within the 7-day window`
                                  : `Cancelled ${days} days after the sale`,
                              call.cancel_reason ? CANCEL_REASONS[call.cancel_reason] : "",
                              call.cancel_note ?? "",
                            ].filter(Boolean);
                            return parts.join(" \u00b7 ");
                          })()}
                        </div>
                        {g.close_quality === "fragile" && (
                          <div className="calls-meta">The grader flagged this close as fragile.</div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>

              {(g.turning_points?.length ?? 0) > 0 && (
                <>
                  <h2>Turning points</h2>
                  {g.turning_points!.map((t, i) => (
                    <div key={i} className={`grade-item turn ${t.direction}`}>
                      <div className="grade-item-head">
                        <span>
                          {t.time !== null && (
                            <button className="time-link" onClick={() => seek(t.time)}>
                              {clock(t.time)}
                            </button>
                          )}
                          {t.moment}
                        </span>
                        <span className={`pill ${t.direction === "toward" ? "good" : "poor"}`}>
                          {t.direction === "toward" ? "Toward yes" : "Away from yes"}
                        </span>
                      </div>
                      <div className="grade-coach">{t.why}</div>
                    </div>
                  ))}
                </>
              )}
            </>
          )}

          {g.coaching_priorities.length > 0 && (
            <>
              <h2>Coach on</h2>
              <ol className="plain-list">
                {g.coaching_priorities.map((c, i) => (
                  <li key={i}>
                    {c}
                    <Fix ctx={fixCtx} k={fx(`coach:${i}`)} kind="Coaching" label={`Coach on #${i + 1}`} original={c} />
                  </li>
                ))}
              </ol>
            </>
          )}

          {g.strengths.length > 0 && (
            <>
              <h2>Did well</h2>
              <ul className="plain-list">
                {g.strengths.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </>
          )}

          {((g.slp?.length ?? 0) > 0 || (g.emotional_arc?.length ?? 0) > 0) && (
            <>
              <h2>Straight Line</h2>
              {g.slp_summary && <p style={{ lineHeight: 1.6, marginTop: 0 }}>{g.slp_summary}</p>}

          </>
          )}

          <div className="row no-print fold-all">
            <button className="link-btn" onClick={() => setAllFolds(true)}>Expand all</button>
            <span className="muted">&middot;</span>
            <button className="link-btn" onClick={() => setAllFolds(false)}>Collapse all</button>
          </div>

          {(g.emotional_arc?.length ?? 0) > 0 && (
            <Fold
              {...foldProps("roadmap")}
              title="Emotional roadmap"
              badge={arcScoreOf(g) !== null && <span className={`pill ${scoreBand(arcScoreOf(g))}`}>{arcScoreOf(g)}</span>}
              preview={countLine(g.emotional_arc!.map((a) => a.landed), { yes: "landed", partial: "partly", no: "didn't land" })}
            >
              <p className="muted" style={{ marginTop: 0 }}>
                The backbone of the sale: what each stage is built to make the client feel, and what the
                client actually showed. Half of the Straight Line score.
              </p>
              {g.emotional_arc!.map((a, i) => (
                <div key={i} className={`grade-item arc ${a.landed}`}>
                  <div className="grade-item-head">
                    <span>
                      {stageLabel(a.stage, a.section)}
                      <span className="stage-term">{stageTerm(a.stage)}</span>
                    </span>
                    <span className={`pill ${ARC_PILL[a.landed] ?? ""}`}>{ARC_LABEL[a.landed] ?? a.landed}</span>
                  </div>
                  {a.landed !== "not_reached" && (
                    <div className="arc-feel">
                      <span className="muted">Built to feel:</span> {a.intended}
                      <br />
                      <span className="muted">Client showed:</span> {a.observed}
                      {a.voice && (
                        <>
                          <br />
                          <span className="muted">Rep&rsquo;s voice:</span> {a.voice}
                        </>
                      )}
                    </div>
                  )}
                  {a.evidence && (
                    <div className="grade-quote">
                      {a.time !== null && (
                        <button className="time-link" onClick={() => seek(a.time)}>
                          {clock(a.time)}
                        </button>
                      )}
                      &ldquo;{a.evidence}&rdquo;
                    </div>
                  )}
                  <Fix
                    ctx={fixCtx}
                    k={fx(`roadmap:${a.stage}`)}
                    kind="Roadmap"
                    label={`${stageLabel(a.stage, a.section)} (${stageTerm(a.stage)})`}
                    original={`${ARC_LABEL[a.landed] ?? a.landed}. Client showed: ${a.observed}${a.voice ? `. Voice: ${a.voice}` : ""}`}
                  />
                </div>
              ))}
            </Fold>
          )}

          {(g.slp?.length ?? 0) > 0 && (
            <Fold
              {...foldProps("skills")}
              title="Straight Line skills"
              badge={skillsScoreOf(g) !== null && <span className={`pill ${scoreBand(skillsScoreOf(g))}`}>{skillsScoreOf(g)}</span>}
              preview={weakest(g)}
            >
              <p className="muted" style={{ marginTop: 0 }}>The other half of the Straight Line score.</p>

              {g.three_tens && (
                <div className="tens">
                  {(
                    [
                      ["Product", g.three_tens.product],
                      ["Rep", g.three_tens.rep],
                      ["Company", g.three_tens.company],
                    ] as [string, number | null][]
                  ).map(([name, n]) => (
                    <div key={name} className="ten">
                      <div className={`ten-n ${n === null ? "" : scoreBand(n * 10)}`}>{n ?? "\u2013"}</div>
                      <div className="muted" style={{ fontSize: 12 }}>{name} certainty</div>
                    </div>
                  ))}
                </div>
              )}
              {g.three_tens?.evidence && (
                <p className="muted" style={{ marginTop: 6 }}>{g.three_tens.evidence}</p>
              )}

              {g.slp!.map((k, i) => (
                <div key={i} className="grade-item">
                  <div className="grade-item-head">
                    <span>{k.skill}</span>
                    <span className={`pill ${k.score === null ? "" : scoreBand(k.score * 10)}`}>
                      {k.score === null ? "n/a" : `${k.score}/10`}
                    </span>
                  </div>
                  {k.score !== null && (
                    <div className="meter">
                      <div className={scoreBand(k.score * 10)} style={{ width: `${k.score * 10}%` }} />
                    </div>
                  )}
                  {k.evidence && (
                    <div className="grade-quote">
                      {k.time !== null && (
                        <button className="time-link" onClick={() => seek(k.time)}>
                          {clock(k.time)}
                        </button>
                      )}
                      &ldquo;{k.evidence}&rdquo;
                    </div>
                  )}
                  {k.coaching && <div className="grade-coach">{k.coaching}</div>}
                  <Fix
                    ctx={fixCtx}
                    k={fx(`skill:${k.skill}`)}
                    kind="Skill"
                    label={k.skill}
                    original={`${k.score ?? "n/a"}/10. ${k.coaching}`}
                  />
                </div>
              ))}
            </Fold>
          )}

          {g.tonality && (
            <Fold
              {...foldProps("tonality")}
              title="Tonality"
              preview={[
                g.tonality.flat_stretches.length
                  ? `${g.tonality.flat_stretches.length} flat stretch${g.tonality.flat_stretches.length === 1 ? "" : "es"}`
                  : "no flat stretches",
                g.tonality.tone_checks.length
                  ? `${g.tonality.tone_checks.filter((c) => c.match === "yes").length}/${g.tonality.tone_checks.length} tones matched`
                  : "",
              ]
                .filter(Boolean)
                .join(" \u00b7 ")}
            >
              <p style={{ lineHeight: 1.6, marginTop: 0 }}>{g.tonality.summary}</p>

              {g.tonality.flat_stretches.length > 0 && (
                <div className="grade-item">
                  <div className="grade-item-head">
                    <span>Flat stretches</span>
                    <span className="pill poor">{g.tonality.flat_stretches.length}</span>
                  </div>
                  {g.tonality.flat_stretches.map((f, i) => (
                    <div key={i} className="grade-coach">
                      <button className="time-link" onClick={() => seek(f.start)}>
                        {clock(f.start)}&ndash;{clock(f.end)}
                      </button>
                      {f.note}
                    </div>
                  ))}
                </div>
              )}

              {g.tonality.tone_checks.map((c, i) => (
                <div key={i} className="grade-item">
                  <div className="grade-item-head">
                    <span>
                      {c.time !== null && (
                        <button className="time-link" onClick={() => seek(c.time)}>
                          {clock(c.time)}
                        </button>
                      )}
                      <span className="tone-chip">{c.tone}</span>
                    </span>
                    <span className={`pill ${c.match === "yes" ? "good" : c.match === "partial" ? "fair" : "poor"}`}>
                      {c.match === "yes" ? "Matched" : c.match === "partial" ? "Partly" : "Missed"}
                    </span>
                  </div>
                  <div className="arc-feel">
                    <span className="muted">Should sound:</span> {c.expected}
                    <br />
                    <span className="muted">Measured:</span> {c.heard}
                  </div>
                  <Fix
                    ctx={fixCtx}
                    k={fx(`tone:${i}`)}
                    kind="Tone"
                    label={c.tone}
                    original={`${c.match}: should sound ${c.expected}; measured ${c.heard}`}
                  />
                </div>
              ))}
              <p className="muted" style={{ fontSize: 12 }}>
                Measured from the recording: pitch movement, line endings, volume and pace. Phone audio makes
                these approximate -- a good guide, not a verdict.
              </p>
            </Fold>
          )}

          {flags.length > 0 && (
            <Fold
              {...foldProps("flags")}
              title="Flags for review"
              badge={
                <span className={`pill ${flags.some((f) => f.severity === "high") ? "high" : "medium"}`}>
                  {flags.length}
                </span>
              }
              preview={countLine(flags.map((f) => f.severity), { high: "high", medium: "medium", low: "low" })}
            >
              {flags.map((f, i) => (
                <div key={i} className="grade-item">
                  <div className="grade-item-head">
                    <span>{f.issue}</span>
                    <span className={`pill ${f.severity}`}>{f.severity}</span>
                  </div>
                  <div className="grade-quote">
                    {f.time !== null && (
                      <button className="time-link" onClick={() => seek(f.time)}>
                        {clock(f.time)}
                      </button>
                    )}
                    &ldquo;{f.quote}&rdquo;
                  </div>
                  <div className="calls-meta">{f.in_script ? "Also in the script" : "Not in the script"}</div>
                  <Fix
                    ctx={fixCtx}
                    k={fx(`flag:${f.issue.slice(0, 60)}`)}
                    kind="Flag"
                    label={`${f.severity} flag`}
                    original={`${f.severity}: ${f.issue} -- "${f.quote}"`}
                  />
                </div>
              ))}
            </Fold>
          )}

          <Fold
            {...foldProps("sections")}
            title="Script sections"
            badge={shownScore !== null && <span className={`pill ${band}`}>{shownScore}</span>}
            preview={countLine(g.sections.map((x) => x.status), { hit: "hit", partial: "partial", missed: "missed" })}
          >
          {g.sections.map((s, i) => (
            <div key={i} className="grade-item">
              <div className="grade-item-head">
                <span>{s.section}</span>
                <span className={`pill ${s.status}`}>{SECTION_LABEL[s.status] ?? s.status}</span>
              </div>
              {s.evidence && (
                <div className="grade-quote">
                  {s.time !== null && (
                    <button className="time-link" onClick={() => seek(s.time)}>
                      {clock(s.time)}
                    </button>
                  )}
                  &ldquo;{s.evidence}&rdquo;
                </div>
              )}
              {s.coaching && <div className="grade-coach">{s.coaching}</div>}
              <Fix
                ctx={fixCtx}
                k={fx(`section:${s.section}`)}
                kind="Section"
                label={s.section}
                original={`${s.status}. ${s.coaching || s.evidence}`}
              />
            </div>
          ))}
          </Fold>

          {g.compliance.length > 0 && (
            <Fold
              {...foldProps("disclosures")}
              title="Required disclosures"
              badge={
                g.compliance.some((c) => c.status === "no") && <span className="pill no">missing</span>
              }
              preview={countLine(g.compliance.map((c) => c.status), { yes: "yes", no: "no", unclear: "unclear" })}
            >
              {g.compliance.map((c, i) => (
                <div key={i} className="grade-item">
                  <div className="grade-item-head">
                    <span>{c.item}</span>
                    <span className={`pill ${c.status}`}>{COMPLIANCE_LABEL[c.status] ?? c.status}</span>
                  </div>
                  {c.evidence && (
                    <div className="grade-quote">
                      {c.time !== null && (
                        <button className="time-link" onClick={() => seek(c.time)}>
                          {clock(c.time)}
                        </button>
                      )}
                      &ldquo;{c.evidence}&rdquo;
                    </div>
                  )}
                  <Fix
                    ctx={fixCtx}
                    k={fx(`disclosure:${c.item}`)}
                    kind="Disclosure"
                    label={c.item}
                    original={`${c.status}${c.evidence ? `: "${c.evidence}"` : ""}`}
                  />
                </div>
              ))}
            </Fold>
          )}

          <p className="muted" style={{ fontSize: 12, marginTop: 14 }}>
            {g.model ? `Graded by ${modelName(g.model)}. ` : ""}Content is graded from the words; tonality from voice
            measurements when the call has them. The Straight Line score is half the emotional roadmap, half the
            skills. The script score counts sections the call reached: hit = full credit, partial = half.
          </p>
        </>
      )}
      </div>

      {speakers.length > 0 && (
        <div className="no-print">
          <Fold
            {...foldProps("speakers")}
            title="Speakers"
            preview={speakers.map((sp) => label(roles[sp] || "other")).join(" \u00b7 ")}
          >
          <p className="muted" style={{ marginTop: 0 }}>
            Detected automatically. If the labels are swapped, fix them here.
          </p>
          <div className="row">
            {speakers.map((s, i) => (
              <label key={s} className="field" style={{ marginBottom: 0, minWidth: 180 }}>
                <span>Voice {i + 1}</span>
                <select value={roles[s]} onChange={(e) => setRole(s, e.target.value as Role)}>
                  {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                    <option key={r} value={r}>
                      {label(r) !== ROLE_LABEL[r] ? `${ROLE_LABEL[r]} (${label(r)})` : ROLE_LABEL[r]}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          </Fold>
        </div>
      )}

      {utterances.length > 0 && (
        <div className="transcript-part">
          <Fold
            {...foldProps("transcript")}
            title="Transcript"
            preview={`${utterances.length} lines${
              isSpanish && call.translation?.status === "done" ? " \u00b7 translated from Spanish" : ""
            }`}
          >
          <div className="row" style={{ justifyContent: "flex-end" }}>
            {isSpanish && call.translation?.status === "done" && (
              <button className="no-print" aria-pressed={showOriginal} onClick={() => setShowOriginal((v) => !v)}>
                {showOriginal ? "Hide original Spanish" : "Show original Spanish"}
              </button>
            )}
          </div>
          {isSpanish && translating && (
            <p className="muted no-print">Translating to English&hellip; showing the original Spanish until it&rsquo;s ready.</p>
          )}
          {isSpanish && (call.translation?.status === "failed" || translationStuck(call.translation)) && (
            <div className="error no-print">
              {call.translation?.error || "The translation stopped."}{" "}
              <button onClick={retranslate} style={{ marginLeft: 8 }}>
                Translate again
              </button>
            </div>
          )}
          {isSpanish && call.translation?.status === "done" && call.translation.error && (
            <div className="note">{call.translation.error}</div>
          )}
          <div className="transcript" style={{ marginTop: 10 }}>
            {utterances.map((u, i) => {
              const role = roles[u.speaker] || "other";
              const isNow = now >= u.start && now < u.end + 0.5;
              return (
                <div key={i} className={`utt ${role}${isNow ? " now" : ""}`}>
                  <button className="time-link" onClick={() => seek(u.start)}>
                    {clock(u.start)}
                  </button>
                  <span className="who">{label(role)}</span>
                  <span className="said">
                    {englishOf(i) !== null ? (
                      <>
                        <Said text={englishOf(i)!} />
                        {showOriginal && (
                          <span className="original">
                            <Said text={u.text} />
                          </span>
                        )}
                      </>
                    ) : (
                      <Said text={u.text} />
                    )}
                  </span>
                </div>
              );
            })}
          </div>
          </Fold>
        </div>
      )}

      <div className="no-print">
      <h2>Settings</h2>
      {call.audio_path && call.audio_redact_state === "done" && call.audio_redact_note && (
        <p className="muted" style={{ marginTop: 0 }}>
          Recording: {call.audio_redact_note}. Bank, card and ID numbers are replaced with a tone; the original was
          deleted.
        </p>
      )}
      {call.audio_path && call.audio_redact_state === "failed" && (
        <div className="error" style={{ marginTop: 0, marginBottom: 12 }}>
          The numbers are still in this recording. {call.audio_redact_note}
        </div>
      )}
      {voiceDone && (
        <div className="note" style={{ marginBottom: 12 }}>
          Voice measured. Press <strong>Re-grade</strong> at the top to grade tonality from it.
        </div>
      )}
      {!call.voice_v && call.audio_path && call.transcript && !voiceDone && (
        <p className="muted" style={{ marginTop: 0 }}>
          This call has no voice measurements, so tonality is graded from the words only. Press Analyze voice
          below, then Re-grade.
        </p>
      )}
      <label className="field" style={{ maxWidth: 360 }}>
        <span>Rep</span>
        <select
          value={repDraft !== null ? "__new" : call.rep_id ?? (call.rep_name ? "__typed" : "")}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "__new") setRepDraft(call.rep_id ? "" : call.rep_name ?? "");
            else if (v && v !== "__typed") {
              setRepDraft(null);
              void setRep(v, null);
            }
          }}
        >
          {!call.rep_id && !call.rep_name && <option value="">Choose&hellip;</option>}
          {!call.rep_id && call.rep_name && <option value="__typed">{call.rep_name} (typed in)</option>}
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          <option value="__new">Not listed &mdash; enter a name&hellip;</option>
        </select>
      </label>
      {repDraft !== null && (
        <div className="row" style={{ marginTop: -6, marginBottom: 14, maxWidth: 360 }}>
          <input
            autoFocus
            value={repDraft}
            placeholder="Rep's full name"
            onChange={(e) => setRepDraft(e.target.value)}
            style={{ flex: 1 }}
          />
          <button
            className="primary"
            disabled={!repDraft.trim()}
            onClick={() => {
              void setRep(null, repDraft.trim());
              setRepDraft(null);
            }}
          >
            Save
          </button>
          <button onClick={() => setRepDraft(null)}>Cancel</button>
        </div>
      )}
      <p className="muted" style={{ marginTop: -6 }}>
        When a typed-in rep gets an account, pick them here to link this call to it. Re-grade after changing the rep.
      </p>
      <label className="field" style={{ maxWidth: 360 }}>
        <span>Grade against</span>
        <select value={call.script_id || ""} onChange={(e) => setScript(e.target.value)}>
          <option value="">Choose&hellip;</option>
          {scripts.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
      </label>
      <p className="muted" style={{ marginTop: 0 }}>
        After changing the script, press Re-grade.
        {call.file_name ? ` Original file: ${call.file_name}.` : ""}
      </p>
      {totalCost !== null && cost && (
        <p className="muted" style={{ marginTop: 0 }}>
          Processing cost (estimate from list prices): <strong>{money(totalCost)}</strong>
          {" \u2014 "}transcription {money(cost.transcribe_usd)}
          {cost.grade_usd_total !== undefined ? `, grading ${money(cost.grade_usd_total)}` : ""}
          {cost.grade_usd_total !== undefined && cost.grade_usd !== cost.grade_usd_total
            ? ` across all grades (latest ${money(cost.grade_usd)})`
            : ""}
          {translateUsd !== null ? `, translation ${money(translateUsd)}` : ""}
          {cost.grade_cache_read_tokens ? " \u00b7 script read from cache" : ""}
        </p>
      )}
      <div className="row">
        {call.audio_path && !call.voice_v && call.transcript && (
          <button disabled={!!voiceBusy || !audioUrl} onClick={analyzeVoice}>
            {voiceBusy || "Analyze voice"}
          </button>
        )}
        {call.audio_path && (
          <button className="danger" onClick={deleteAudio}>
            Delete recording, keep transcript
          </button>
        )}
        <button className="danger" onClick={deleteCall}>
          Delete call
        </button>
      </div>
      </div>
    </main>
  );
}
