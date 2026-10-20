"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { startJob } from "@/lib/callsClient";
import { cleanRecording } from "@/lib/cleanRecording";
import { estimateFor, okToSpend, transcribeEstimate, usd } from "@/lib/spend";
import {
  OUTCOME_LABEL,
  langOf,
  STATUS_LABEL,
  clock,
  isStuck,
  money,
  scoreBand,
  type CallCost,
  type CallStatus,
  type Outcome,
} from "@/lib/calls";
import { decodeMono, encodeMp3, SHRINK_OVER_BYTES, type Decoded } from "@/lib/shrinkAudio";
import { measureVoice, type VoiceData } from "@/lib/voice";
import "./calls.css";

type Person = { id: string; full_name: string | null; email: string | null; team: string | null; org_id: string | null };

const NEW_REP = "__new";

/** One key per rep, whether they have an account or were typed in by name. */
const repKeyOf = (c: CallRow): string | null =>
  c.rep_id ?? (c.rep_name?.trim() ? `name:${c.rep_name.trim().toLowerCase()}` : null);

const repLabelOf = (c: CallRow): string =>
  c.profiles?.full_name?.trim() || c.rep_name?.trim() || "Unknown rep";

const nameOf = (p: Person) => p.full_name?.trim() || p.email || "Unnamed";
type ScriptOpt = { id: string; title: string; team: string | null; sort_order: number };

type CallRow = {
  id: string;
  rep_id: string | null;
  rep_name: string | null; // typed in when the rep has no account yet
  client_label: string | null;
  call_date: string | null;
  duration_secs: number | null;
  status: CallStatus;
  score: number | null;
  slp_score: number | null;
  outcome: Outcome | null;
  outcome_manual: Outcome | null;
  close_quality: string | null;
  retention: string | null;
  redaction_count: number;
  audio_path: string | null;
  audio_redact_state: string | null;
  error: string | null;
  script_id: string | null;
  updated_at: string;
  created_at: string;
  cost: CallCost | null;
  lang: string | null;
  translation_status: string | null;
  translation_usd: number | null;
  profiles: { full_name: string | null } | null;
};

const BUSY: CallStatus[] = ["uploading", "uploaded", "transcribing", "grading"];

// Supabase's own per-file limit on the free plan. Paid plans can raise it.
const MAX_MB = 50;

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dateLabel(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

/** Length of an audio file, read in the browser before upload. */
function audioSeconds(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const a = new Audio();
    const done = (v: number | null) => {
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

/**
 * Call monitoring: upload a recording downloaded from the dialer, and it is
 * transcribed (with banking numbers redacted) and graded against the script.
 */
export default function Calls() {
  const supabase = createClient();
  const router = useRouter();

  const [me, setMe] = useState<Person | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [scripts, setScripts] = useState<ScriptOpt[]>([]);
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [file, setFile] = useState<File | null>(null);
  const [repId, setRepId] = useState("");
  const [repName, setRepName] = useState(""); // used when repId is NEW_REP
  const [scriptId, setScriptId] = useState("");
  const [client, setClient] = useState("");
  const [callDate, setCallDate] = useState(today());
  // For older calls whose outcome is already known (graduated, 6+ payments, cancelled).
  const [upStatus, setUpStatus] = useState("");
  // Which call this is with the client (empty = numbered by date from the client ID), and whether another rep took it.
  const [upNumber, setUpNumber] = useState("");
  const [upHandoff, setUpHandoff] = useState("");
  const [busy, setBusy] = useState("");
  const [filterRep, setFilterRep] = useState("");
  const [filterOutcome, setFilterOutcome] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  // Grading is started from here once a transcript lands. Remember which
  // calls this tab has already kicked so a poll does not start it twice.
  const kicked = useRef(new Set<string>());
  const kickedTranslate = useRef(new Set<string>());
  // Bleeping numbers out of recordings, one at a time, right here -- no need to open each call.
  const bleeping = useRef(false);
  const triedBleep = useRef(new Set<string>());
  const [bleepNote, setBleepNote] = useState("");

  const loadCalls = useCallback(async () => {
    const { data, error } = await supabase
      .from("calls")
      .select(
        "id, rep_id, rep_name, client_label, call_date, duration_secs, status, score, slp_score, outcome, outcome_manual, close_quality:grade->>close_quality, retention, redaction_count, audio_path, audio_redact_state, error, script_id, updated_at, created_at, cost, lang:transcript->>language, translation_status:translation->>status, translation_usd:translation->usd, profiles:rep_id(full_name)"
      )
      // Practice calls with a mock client have their own page.
      .neq("source", "roleplay")
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) setError(error.message);
    setCalls((data || []) as unknown as CallRow[]);
  }, [supabase]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const uid = session?.user.id;

      const [peopleRes, scriptRes] = await Promise.all([
        supabase.from("profiles").select("id, full_name, email, team, org_id").eq("active", true),
        supabase.from("scripts").select("id, title, team, sort_order").eq("active", true).order("sort_order"),
      ]);
      if (cancelled) return;

      const all = (peopleRes.data || []) as Person[];
      setMe(all.find((p) => p.id === uid) || null);
      setPeople(
        all
          .filter((p) => p.org_id)
          .sort((a, b) => nameOf(a).localeCompare(nameOf(b)))
      );
      setScripts((scriptRes.data || []) as ScriptOpt[]);
      await loadCalls();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, loadCalls]);

  // Poll while anything is in progress.
  const anyBusy = calls.some((c) => BUSY.includes(c.status) && !isStuck(c.status, c.updated_at));
  useEffect(() => {
    if (!anyBusy) return;
    const t = setInterval(loadCalls, 5000);
    return () => clearInterval(t);
  }, [anyBusy, loadCalls]);

  // Transcript has numbers in it -> bleep them out of the stored recording.
  useEffect(() => {
    if (bleeping.current) return;
    const next = calls.find(
      (c) =>
        c.redaction_count > 0 &&
        c.audio_path &&
        c.audio_redact_state === null &&
        !["uploading", "uploaded", "transcribing"].includes(c.status) &&
        !triedBleep.current.has(c.id)
    );
    if (!next) return;
    bleeping.current = true;
    triedBleep.current.add(next.id);
    void (async () => {
      const { data } = await supabase.from("calls").select("id, audio_path, transcript, file_name, audio_redact_state").eq("id", next.id).single();
      if (data?.transcript) {
        const who = next.client_label || "a call";
        await cleanRecording(supabase, data as Parameters<typeof cleanRecording>[1], { onProgress: (stage) => setBleepNote(`Removing numbers from ${who}: ${stage.toLowerCase()}`) });
      }
      setBleepNote("");
      bleeping.current = false;
      await loadCalls();
    })();
  }, [calls, supabase, loadCalls]);

  // Graded real call -> keep an anonymous client profile for the practice clients (lib/learn.ts).
  // One at a time, quietly, about a third of a cent each; older calls are worked through too.
  const learning = useRef(false);
  const learned = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (learning.current) return;
    learning.current = true;
    void (async () => {
      try {
        if (!learned.current) {
          const { data, error } = await supabase.from("client_insights").select("call_id");
          if (error) return; // table not there yet
          learned.current = new Set((data || []).map((x) => x.call_id as string));
        }
        const todo = calls.filter((c) => c.status === "graded" && !learned.current!.has(c.id));
        const {
          data: { session },
        } = await supabase.auth.getSession();
        for (const c of todo.slice(0, 20)) {
          learned.current.add(c.id);
          await fetch("/api/calls/learn", {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${session?.access_token ?? ""}` },
            body: JSON.stringify({ callId: c.id }),
          }).catch(() => null);
        }
      } finally {
        learning.current = false;
      }
    })();
  }, [calls, supabase]);

  // Transcript ready -> start grading.
  useEffect(() => {
    for (const c of calls) {
      if (c.status === "transcribed" && c.script_id && !kicked.current.has(c.id)) {
        kicked.current.add(c.id);
        void startJob(supabase, "grade", c.id).then((err) => {
          if (err) setError(err);
          void loadCalls();
        });
      }
    }
  }, [calls, supabase, loadCalls]);

  // Spanish transcript ready -> translate it, alongside grading.
  useEffect(() => {
    for (const c of calls) {
      if (c.lang && langOf(c.lang) === "es" && !c.translation_status && !kickedTranslate.current.has(c.id)) {
        kickedTranslate.current.add(c.id);
        void startJob(supabase, "translate", c.id).then((err) => {
          if (err) setError(err);
        });
      }
    }
  }, [calls, supabase]);

  // Picking a rep picks the script for their team. A typed-in rep has no
  // team, so the script is left for the manager to choose.
  function chooseRep(id: string) {
    setRepId(id);
    if (id === NEW_REP) return;
    const team = people.find((p) => p.id === id)?.team;
    const match = scripts.find((s) => s.team && s.team === team);
    if (match) setScriptId(match.id);
  }

  // What this upload will cost: transcription by the minute, grading from recent calls.
  const [est, setEst] = useState<{ secs: number; usd: number } | null>(null);
  useEffect(() => {
    let off = false;
    setEst(null);
    if (!file) return;
    void Promise.all([audioSeconds(file), estimateFor(supabase, "grade")]).then(([secs, grade]) => {
      if (!off && secs) setEst({ secs, usd: transcribeEstimate(secs) + grade });
    });
    return () => {
      off = true;
    };
  }, [file, supabase]);

  async function upload() {
    setError("");
    if (est && !(await okToSpend(supabase, est.usd, "This call"))) return;
    const typed = repId === NEW_REP ? repName.trim() : "";
    if (!file || !repId || (repId === NEW_REP && !typed) || !scriptId || !me?.org_id) {
      setError(
        repId === NEW_REP && !typed
          ? "Type the rep's name."
          : "Choose a recording, the rep, and the script."
      );
      return;
    }
    // The recording is decoded once, in this browser. That feeds two things:
    // compressing long calls under the storage limit (lib/shrinkAudio.ts) and
    // measuring the voice for tonality grading (lib/voice.ts).
    let upFile = file;
    let seconds: number | null = null;
    let voice: VoiceData | null = null;
    let decoded: Decoded | null = null;

    setBusy("Reading recording...");
    try {
      decoded = await decodeMono(file);
      seconds = Math.round(decoded.seconds);
    } catch (e) {
      // A file this browser cannot decode can still be transcribed; it just
      // gets no voice measurements. Too big to upload uncompressed, though.
      if (file.size > SHRINK_OVER_BYTES) {
        setBusy("");
        setError(e instanceof Error ? e.message : "Could not read the recording.");
        return;
      }
      seconds = await audioSeconds(file);
    }

    if (decoded) {
      try {
        voice = await measureVoice(decoded.pcm, decoded.rate, (f) =>
          setBusy(`Measuring voice ${Math.round(f * 100)}%...`)
        );
      } catch {
        voice = null; // grading still works, from the words alone
      }

      if (file.size > SHRINK_OVER_BYTES) {
        try {
          upFile = await encodeMp3(decoded, file.name, (f) =>
            setBusy(`Compressing ${Math.round(f * 100)}%...`)
          );
        } catch (e) {
          setBusy("");
          setError(e instanceof Error ? e.message : "Could not compress the recording.");
          return;
        }
      }
      decoded = null; // let the browser free the decoded audio
    }

    if (upFile.size > MAX_MB * 1024 * 1024) {
      setBusy("");
      setError(
        `Even compressed, this recording is ${(upFile.size / 1048576).toFixed(0)} MB, over the ${MAX_MB} MB storage limit. That is roughly a 3-hour call.`
      );
      return;
    }

    const ext =
      (upFile.name.split(".").pop() || "mp3").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp3";

    setBusy("Saving...");
    const { data: row, error: insErr } = await supabase
      .from("calls")
      .insert({
        org_id: me.org_id,
        uploaded_by: me.id,
        rep_id: repId === NEW_REP ? null : repId,
        rep_name: repId === NEW_REP ? typed : null,
        script_id: scriptId,
        client_label: client.trim() || null,
        call_date: callDate || null,
        ...(upStatus ? { retention: upStatus } : {}),
        ...(upNumber ? { call_number: Number(upNumber) } : {}),
        ...(upHandoff ? { handoff: upHandoff } : {}),
        file_name: file.name,
        duration_secs: seconds,
        voice,
        status: "uploading",
      })
      .select("id")
      .single();

    if (insErr || !row) {
      setBusy("");
      setError(`Could not create the call. ${insErr?.message ?? ""}`);
      return;
    }

    setBusy("Uploading recording...");
    const path = `${me.org_id}/${row.id}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from("call-audio")
      .upload(path, upFile, { contentType: upFile.type || "audio/mpeg", upsert: false });

    if (upErr) {
      await supabase.from("calls").delete().eq("id", row.id);
      setBusy("");
      setError(`Upload failed. ${upErr.message}`);
      return;
    }

    await supabase
      .from("calls")
      .update({ audio_path: path, status: "uploaded", updated_at: new Date().toISOString() })
      .eq("id", row.id);

    setBusy("Starting transcription...");
    const err = await startJob(supabase, "transcribe", row.id);
    setBusy("");

    if (err) {
      setError(err);
      await loadCalls();
      return;
    }

    setFile(null);
    setClient("");
    setUpStatus("");
    setUpNumber("");
    setUpHandoff("");
    setRepName("");
    if (fileInput.current) fileInput.current.value = "";
    router.push(`/admin/calls/${row.id}`);
  }

  const outcomeOf = (c: CallRow): Outcome | null => c.outcome_manual ?? c.outcome;

  const shown = useMemo(
    () =>
      calls.filter(
        (c) =>
          (!filterRep || repKeyOf(c) === filterRep) &&
          (!filterOutcome ||
            (filterOutcome === "fragile"
              ? c.close_quality === "fragile"
              : filterOutcome === "cancelled" || filterOutcome === "graduated" || filterOutcome === "paid6"
                ? c.retention === filterOutcome
                : outcomeOf(c) === filterOutcome))
      ),
    [calls, filterRep, filterOutcome]
  );

  const repsWithCalls = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of calls) {
      const key = repKeyOf(c);
      if (key && !seen.has(key)) seen.set(key, repLabelOf(c));
    }
    return [...seen.entries()]
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [calls]);

  // Estimated spend this calendar month, from each call's recorded cost.
  const monthCost = useMemo(() => {
    const now = new Date();
    let usd = 0;
    let n = 0;
    for (const c of calls) {
      const d = new Date(c.created_at);
      if (d.getFullYear() !== now.getFullYear() || d.getMonth() !== now.getMonth() || !c.cost) continue;
      usd += (c.cost.transcribe_usd ?? 0) + (c.cost.grade_usd_total ?? 0) + (Number(c.translation_usd) || 0);
      n += 1;
    }
    return { usd, n };
  }, [calls]);

  // Of a rep's reviewed closes, how many cancelled.
  const cancelsFor = (key: string) => {
    const closes = calls.filter((c) => repKeyOf(c) === key && outcomeOf(c) === "enrolled");
    return {
      closes: closes.length,
      cancelled: closes.filter((c) => c.retention === "cancelled").length,
      graduated: closes.filter((c) => c.retention === "graduated" || c.retention === "paid6").length,
    };
  };

  /*
    The check on the grader itself: do closes it called fragile actually
    cancel more than solid ones? Only shown once there is something to compare.
  */
  const closeCheck = useMemo(() => {
    const tally = (q: string) => {
      const set = calls.filter((c) => outcomeOf(c) === "enrolled" && c.close_quality === q && c.retention);
      return { n: set.length, cancelled: set.filter((c) => c.retention === "cancelled").length };
    };
    return { fragile: tally("fragile"), solid: tally("solid") };
  }, [calls]);

  // Average graded score per rep, for the filter view.
  const avgFor = (key: string) => {
    const s = calls.filter((c) => repKeyOf(c) === key && c.score !== null).map((c) => c.score as number);
    return s.length ? Math.round(s.reduce((a, b) => a + b, 0) / s.length) : null;
  };

  if (loading) {
    return (
      <main className="shell calls-shell">
        <p className="muted">Loading&hellip;</p>
      </main>
    );
  }

  return (
    <main className="shell calls-shell">

      <div className="eyebrow">
        {calls.length} calls
        {monthCost.n > 0 ? ` \u00b7 this month ${monthCost.n} processed, about ${money(monthCost.usd)}` : ""}
      </div>
      <h1>Call review</h1>
      <p className="muted">
        Upload a recording from the dialer. It is transcribed with bank, card and ID numbers
        removed, then graded against the script. Only managers and admins can see this page.
      </p>

      <div className="card" style={{ marginTop: 18 }}>
        <div className="calls-form">
          <label className="field wide">
            <span>Recording</span>
            <input
              ref={fileInput}
              type="file"
              accept="audio/*,.mp3,.wav,.m4a"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </label>
          <label className="field">
            <span>Rep</span>
            <select value={repId} onChange={(e) => chooseRep(e.target.value)}>
              <option value="">Choose&hellip;</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {nameOf(p)}
                </option>
              ))}
              <option value={NEW_REP}>Not listed &mdash; enter a name&hellip;</option>
            </select>
            {repId === NEW_REP && (
              <input
                autoFocus
                value={repName}
                placeholder="Rep's full name"
                onChange={(e) => setRepName(e.target.value)}
                style={{ marginTop: 8 }}
              />
            )}
          </label>
          <label className="field">
            <span>Grade against</span>
            <select value={scriptId} onChange={(e) => setScriptId(e.target.value)}>
              <option value="">Choose&hellip;</option>
              {scripts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Client (optional)</span>
            <input
              value={client}
              placeholder="First name or lead ID"
              onChange={(e) => setClient(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Call date</span>
            <input type="date" value={callDate} onChange={(e) => setCallDate(e.target.value)} />
          </label>
          <label className="field">
            <span>Client status (optional)</span>
            <select value={upStatus} onChange={(e) => setUpStatus(e.target.value)}>
              <option value="">Not known yet</option>
              <option value="active">Active</option>
              <option value="cancelled">Cancelled</option>
              <option value="paid6">Made 6+ payments</option>
              <option value="graduated">Graduated</option>
            </select>
          </label>
          <label className="field">
            <span>Call # with this client</span>
            <select value={upNumber} onChange={(e) => setUpNumber(e.target.value)}>
              <option value="">Auto (from the client ID)</option>
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  Call {n}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Renew?</span>
            <select value={upHandoff} onChange={(e) => setUpHandoff(e.target.value)}>
              <option value="">No</option>
              <option value="renew">Renew</option>
            </select>
          </label>
        </div>

        <div className="row">
          <button className="primary" disabled={!!busy} onClick={upload}>
            {busy || "Upload and grade"}
          </button>
          {est && !busy && (
            <span className="muted" style={{ fontSize: 14 }}>
              {Math.round(est.secs / 60)} min call &middot; about {usd(est.usd)} to transcribe and grade
            </span>
          )}
        </div>

        {error && <div className="error">{error}</div>}
        {bleepNote && <div className="status">{bleepNote}</div>}
      </div>

      <div className="row" style={{ marginTop: 28, justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>Calls</h2>
        <span className="row" style={{ gap: 8 }}>
        <select
          value={filterOutcome}
          onChange={(e) => setFilterOutcome(e.target.value)}
          style={{ width: "auto", fontSize: 14, padding: "8px 10px" }}
          aria-label="Filter by outcome"
        >
          <option value="">All outcomes</option>
          {(Object.keys(OUTCOME_LABEL) as Outcome[]).map((o) => (
            <option key={o} value={o}>
              {OUTCOME_LABEL[o]}
            </option>
          ))}
          <option value="fragile">Fragile closes</option>
          <option value="cancelled">Cancelled</option>
          <option value="paid6">Made 6+ payments</option>
          <option value="graduated">Graduated</option>
        </select>
        {repsWithCalls.length > 1 && (
          <select
            value={filterRep}
            onChange={(e) => setFilterRep(e.target.value)}
            style={{ width: "auto", fontSize: 14, padding: "8px 10px" }}
          >
            <option value="">All reps</option>
            {repsWithCalls.map((r) => {
              const a = avgFor(r.key);
              return (
                <option key={r.key} value={r.key}>
                  {r.label}
                  {a !== null ? ` (avg ${a})` : ""}
                  {(() => {
                    const k = cancelsFor(r.key);
                    return k.closes
                      ? ` \u00b7 ${k.cancelled}/${k.closes} cancelled${k.graduated ? `, ${k.graduated} proven` : ""}`
                      : "";
                  })()}
                </option>
              );
            })}
          </select>
        )}
        </span>
      </div>

      {(closeCheck.fragile.n > 0 || closeCheck.solid.n > 0) && (
        <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
          Closes with retention entered: fragile {closeCheck.fragile.cancelled}/{closeCheck.fragile.n} cancelled
          {" \u00b7 "}solid {closeCheck.solid.cancelled}/{closeCheck.solid.n} cancelled
        </p>
      )}

      {shown.length === 0 && (
        <p className="muted">{calls.length === 0 ? "No calls uploaded yet." : "No calls match these filters."}</p>
      )}

      <ul className="list" style={{ marginTop: 10 }}>
        {shown.map((c) => {
          const stuck = isStuck(c.status, c.updated_at);
          const band = scoreBand(c.score);
          return (
            <li key={c.id}>
              <Link href={`/admin/calls/${c.id}`}>
                <span>
                  {repLabelOf(c)}
                  {c.client_label ? ` · ${c.client_label}` : ""}
                  <div className="calls-meta">
                    {dateLabel(c.call_date)}
                    {c.duration_secs ? ` · ${clock(c.duration_secs)}` : ""}
                    {outcomeOf(c) ? ` · ${OUTCOME_LABEL[outcomeOf(c) as Outcome]}` : ""}
                    {c.lang && langOf(c.lang) === "es" ? " · Spanish" : ""}
                    {c.close_quality === "fragile" && <span className="danger">{" · fragile close"}</span>}
                    {c.retention === "cancelled" && <strong className="danger">{" · cancelled"}</strong>}
                    {c.retention === "graduated" && <strong className="good-text">{" · graduated"}</strong>}
                    {c.retention === "paid6" && <strong className="good-text">{" · 6+ payments"}</strong>}
                    {c.redaction_count > 0 && c.audio_path && c.audio_redact_state !== "done" && (
                      <span className="danger">{" · numbers still in recording"}</span>
                    )}
                  </div>
                </span>
                {c.status === "graded" && c.score !== null ? (
                  <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                    <span className={`pill ${band}`} title="Script score">{c.score}</span>
                    {c.slp_score !== null && (
                      <span className={`pill ${scoreBand(c.slp_score)}`} title="Straight Line score">
                        SLP {c.slp_score}
                      </span>
                    )}
                  </span>
                ) : (
                  <span
                    className={`pill ${
                      c.status === "failed" || stuck ? "failed" : BUSY.includes(c.status) ? "busy" : ""
                    }`}
                  >
                    {stuck ? "Stuck" : STATUS_LABEL[c.status]}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
