"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { startJob } from "@/lib/callsClient";
import { cleanRecording } from "@/lib/cleanRecording";
import { clientKey, numbered } from "@/lib/journey";
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
import { SHORT_LABEL, type Quick } from "@/lib/quick";
import { byCallMade } from "@/lib/calls";
import { fmtTime } from "@/lib/dayReview";
import { audioSeconds, convosoName, uploadCall } from "@/lib/uploadCall";
import BulkUpload from "./BulkUpload";
import "./calls.css";

type Person = { id: string; full_name: string | null; email: string | null; team: string | null; org_id: string | null };

const NEW_REP = "__new";

/** One key per rep, whether they have an account or were typed in by name. */
const repKeyOf = (c: CallRow): string | null =>
  c.rep_id ?? (c.rep_name?.trim() ? `name:${c.rep_name.trim().toLowerCase()}` : null);

const repLabelOf = (c: CallRow): string =>
  c.profiles?.full_name?.trim() || c.rep_name?.trim() || "Unknown rep";

const nameOf = (p: Person) => p.full_name?.trim() || p.email || "Unnamed";
type ScriptOpt = { id: string; title: string; team: string | null; sort_order: number; continues_into?: string | null };

type CallRow = {
  id: string;
  rep_id: string | null;
  rep_name: string | null; // typed in when the rep has no account yet
  client_label: string | null;
  call_date: string | null;
  call_time?: string | null;
  duration_secs: number | null;
  status: CallStatus;
  score: number | null;
  slp_score: number | null;
  outcome: Outcome | null;
  outcome_manual: Outcome | null;
  close_quality: string | null;
  gver?: string | null;
  gfail?: string | null;
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


function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dateLabel(iso: string | null): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
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
  const [dupe, setDupe] = useState<{ id: string; what: string } | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [vinNote, setVinNote] = useState("");
  // Major grading changes re-grade every call on file by themselves (see /api/calls/regrade-all).
  const [regrade, setRegrade] = useState<{ remaining: number; each: number; total?: number; renew?: number; error?: string } | null>(null);
  useEffect(() => {
    let stop = false;
    let started = false;
    let relearnAt = 0;
    const tick = async () => {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (!token || stop) return;
      const res = await fetch("/api/calls/regrade-all", { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
      const r = res ? await res.json().catch(() => null) : null;
      if (stop) return;
      if (!res?.ok || !r) return setRegrade({ remaining: 0, each: 0, error: r?.error || `status ${res?.status ?? "unreachable"}` });
      const each = await estimateFor(supabase, "grade");
      setRegrade({ remaining: r.remaining, each, total: r.total, renew: r.renew });
      // Start (or restart) the run when nothing is grading.
      // The learning step's re-read (cheap, about a third of a cent a call) runs the same way.
      if (Date.now() - relearnAt > 5 * 60_000) {
        relearnAt = Date.now();
        const l = await fetch("/api/calls/relearn-all", { headers: { Authorization: `Bearer ${token}` } }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
        if (l?.remaining > 0) void fetch("/api/calls/relearn-all", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ background: true }) }).catch(() => null);
      }
      if (r.remaining > 0 && !r.grading && !started) {
        started = true;
        await fetch("/api/calls/regrade-all", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ background: true }) }).catch(() => null);
        setTimeout(() => (started = false), 6 * 60_000);
      }
    };
    void tick();
    // Every 2 minutes: each check reads every graded call, so not more often than needed.
    const t = setInterval(() => void tick(), 120_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [supabase]);
  const [repId, setRepId] = useState("");
  const [repName, setRepName] = useState(""); // used when repId is NEW_REP
  const [scriptId, setScriptId] = useState("");

  /*
    Vindico recordings ("recording-<id>.mp3") are all renew leads: grade them
    on the Renew script, which picks up the Options Script at Phase 2.
  */
  function pickFile(f: File | null) {
    setFile(f);
    setVinNote("");
    if (!f) return;
    // Convoso names carry the call date: ..._MMDDYYYY_HHMMSS.mp3
    const cd = f.name.match(/_(\d{2})(\d{2})(\d{4})_\d{6}\.\w+$/);
    if (cd) {
      const [, mm, dd, yyyy] = cd;
      if (+mm >= 1 && +mm <= 12 && +dd >= 1 && +dd <= 31) setCallDate(`${yyyy}-${mm}-${dd}`);
    }
    if (!/^recording-[0-9a-f]{8}-[0-9a-f]{4}-/i.test(f.name)) return;
    const renew = scripts.find((x) => x.continues_into || /renew/i.test(x.title));
    if (!renew) return;
    setScriptId(renew.id);
    setUpHandoff("renew");
    setVinNote(`Vindico recording -- grading against ${renew.title} (it continues on the Options Script at Phase 2). Change it below if this one isn't a renew lead.`);
  }
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

  // Voicemail scores and short-call reads (needs supabase/quick_reads.sql; nothing shows before it).
  const [quick, setQuick] = useState<Map<string, Quick>>(new Map());
  const [bulk, setBulk] = useState(false);
  const loadCalls = useCallback(async () => {
    const { data, error } = await supabase
      .from("calls")
      .select(
        "id, rep_id, rep_name, client_label, call_date, call_time, duration_secs, status, score, slp_score, outcome, outcome_manual, close_quality:grade->>close_quality, gver:grade->>grader_version, gfail:grade->>regrade_failed, retention, redaction_count, audio_path, audio_redact_state, error, script_id, updated_at, created_at, cost, lang:transcript->>language, translation_status:translation->>status, translation_usd:translation->usd, profiles:rep_id(full_name)"
      )
      // Practice calls with a mock client have their own page.
      .neq("source", "roleplay")
      .order("call_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) setError(error.message);
    // Newest first by when the call was made (date, then time of day), not when it was uploaded.
    const rows = ((data || []) as unknown as CallRow[]).sort(byCallMade);
    setCalls(rows);
    const readIds = rows.filter((c) => c.status === "read").map((c) => c.id);
    if (readIds.length) {
      const { data: q, error: qErr } = await supabase.from("calls").select("id, quick").in("id", readIds);
      if (!qErr) setQuick(new Map(((q || []) as { id: string; quick: Quick | null }[]).filter((x) => x.quick).map((x) => [x.id, x.quick!])));
    }
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
        supabase.from("scripts").select("id, title, team, sort_order, continues_into").eq("active", true).order("sort_order"),
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

  // Client journeys, kept up to date in the background:
  //  - a call graded before an earlier call in its journey existed gets re-graded, so it knows the whole story;
  //  - each journey of 2+ graded calls gets a fresh journey read (about 5 cents) whenever one of its calls is graded.
  const journeyRun = useRef(0);
  const journeyKicked = useRef(new Set<string>());
  useEffect(() => {
    if (anyBusy || Date.now() - journeyRun.current < 60_000) return;
    journeyRun.current = Date.now();
    void (async () => {
      const [{ data: cs }, nums, js] = await Promise.all([
        supabase.from("calls").select("id, client_label, call_date, call_time, created_at, status, graded_at:grade->>graded_at").neq("source", "roleplay").not("client_label", "is", null).limit(3000),
        supabase.from("calls").select("id, call_number").not("call_number", "is", null).limit(3000),
        supabase.from("client_journeys").select("client_key, updated_at"),
      ]);
      if (js.error) return; // journeys table not there yet
      const num = new Map(((nums.data || []) as { id: string; call_number: number }[]).map((x) => [x.id, x.call_number]));
      const readAt = new Map(((js.data || []) as { client_key: string; updated_at: string }[]).map((x) => [x.client_key, x.updated_at]));
      type C = { id: string; client_label: string | null; call_date: string | null; created_at: string; status: string; graded_at: string | null };
      const groups = new Map<string, C[]>();
      for (const c of (cs || []) as C[]) {
        const k = clientKey(c.client_label);
        if (k) groups.set(k, [...(groups.get(k) || []), c]);
      }
      let regrades = 0;
      let reads = 0;
      for (const [k, list] of groups) {
        if (list.length < 2 || list.some((c) => BUSY.includes(c.status as CallRow["status"]))) continue;
        const ordered = numbered(list.map((c) => ({ ...c, call_number: num.get(c.id) ?? null, rep_id: null, outcome: null, outcome_manual: null, retention: null, score: null, slp_score: null })));
        // A later call graded before an earlier one existed doesn't know the earlier call: re-grade it.
        for (const c of ordered) {
          if (regrades >= 2 || c.status !== "graded" || !c.graded_at || journeyKicked.current.has(c.id)) continue;
          const stale = ordered.some((e) => e.n < c.n && e.status === "graded" && e.graded_at && e.graded_at > c.graded_at!);
          if (!stale) continue;
          journeyKicked.current.add(c.id);
          regrades++;
          await startJob(supabase, "grade", c.id);
        }
        // Fresh journey read when any of its calls was graded since the last one.
        const graded = ordered.filter((c) => c.status === "graded" && c.graded_at);
        const newest = graded.map((c) => c.graded_at!).sort().at(-1);
        if (reads < 1 && graded.length >= 2 && newest && (!readAt.get(k) || readAt.get(k)! < newest) && !journeyKicked.current.has(`read:${k}`)) {
          journeyKicked.current.add(`read:${k}`);
          reads++;
          const {
            data: { session },
          } = await supabase.auth.getSession();
          await fetch("/api/journeys/read", {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${session?.access_token ?? ""}` },
            body: JSON.stringify({ clientLabel: list[0].client_label }),
          }).catch(() => null);
        }
      }
      if (regrades) await loadCalls();
    })();
  }, [calls, anyBusy, supabase, loadCalls]);

  // A quick read (voicemail or short call) that failed: try it once more by itself -- it costs a fraction of a cent.
  useEffect(() => {
    for (const c of calls) {
      if (c.status === "failed" && (c.error || "").startsWith("Quick read:") && !kicked.current.has(c.id)) {
        kicked.current.add(c.id);
        void startJob(supabase, "grade", c.id).then(() => void loadCalls());
      }
    }
  }, [calls, supabase, loadCalls]);

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
    setDupe(null);
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
    const ct = convosoName(file.name).time;
    const res = await uploadCall(
      supabase,
      file,
      {
        orgId: me.org_id,
        uploadedBy: me.id,
        repId: repId === NEW_REP ? null : repId,
        repName: repId === NEW_REP ? typed : null,
        scriptId,
        clientLabel: client.trim() || null,
        callDate: callDate || null,
        callTime: ct,
        retention: upStatus || null,
        callNumber: upNumber ? Number(upNumber) : null,
        handoff: upHandoff || null,
      },
      setBusy
    );
    setBusy("");
    if (!res.ok) {
      if (res.dupe) setDupe(res.dupe);
      setError(res.error);
      await loadCalls();
      return;
    }
    const row = { id: res.id };

    setFile(null);
    setVinNote("");
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
          (filterOutcome === "quick" ? c.status === "read" : filterOutcome === "" ? c.status !== "read" : true) &&
          (!filterOutcome ||
            filterOutcome === "quick" ||
            filterOutcome === "all" ||
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
    return { fragile: tally("fragile"), ok: tally("ok"), solid: tally("solid") };
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
      {regrade?.error && <div className="error" style={{ marginBottom: 12 }}>Couldn&rsquo;t check the automatic re-grade: {regrade.error}</div>}
      {regrade && !regrade.error && regrade.remaining === 0 && !!regrade.total && (
        <p className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
          All {regrade.total} graded calls are on the current grading rules{regrade.renew ? ` (${regrade.renew} renew)` : ""}.
        </p>
      )}
      {regrade && regrade.remaining > 0 && (
        <div className="status" style={{ marginBottom: 12 }}>
          Grading rules were updated. Re-grading every call on file by itself, oldest first: <b>{regrade.remaining}</b> to go
          {regrade.each ? `, about ${money(regrade.remaining * regrade.each)} left` : ""}. You can keep working; it carries on while this page is closed.
        </div>
      )}

      <div className="eyebrow">
        {calls.length} calls
        {monthCost.n > 0 ? ` \u00b7 this month ${monthCost.n} processed, about ${money(monthCost.usd)}` : ""}
      </div>
      <h1>Call review</h1>
      <p className="muted">
        Upload a recording from the dialer. It is transcribed with bank, card and ID numbers
        removed, then graded against the script. Only managers and admins can see this page.
      </p>

      <div className="row" style={{ gap: 8, marginTop: 14 }}>
        <button className={bulk ? "" : "primary"} onClick={() => setBulk(false)}>
          One recording
        </button>
        <button className={bulk ? "primary" : ""} onClick={() => setBulk(true)}>
          A whole day (call log + recordings)
        </button>
      </div>
      {bulk && <BulkUpload supabase={supabase} me={me} people={people} scripts={scripts} onDone={() => void loadCalls()} />}

      <div className="card" style={{ marginTop: 18, display: bulk ? "none" : undefined }}>
        <div className="calls-form">
          <label className="field wide">
            <span>Recording</span>
            <input
              ref={fileInput}
              type="file"
              accept="audio/*,.mp3,.wav,.m4a"
              onChange={(e) => pickFile(e.target.files?.[0] || null)}
            />
            {vinNote && <small className="muted">{vinNote}</small>}
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
            <select
              value={upHandoff}
              onChange={(e) => {
                const v = e.target.value;
                setUpHandoff(v);
                // Renew means the Renew script, always; no need to pick it twice.
                const renew = scripts.find((x) => x.continues_into || /renew/i.test(x.title));
                if (!renew) return;
                if (v === "renew") setScriptId(renew.id);
                else if (scriptId === renew.id && renew.continues_into) setScriptId(renew.continues_into);
              }}
            >
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

        {error && (
          <div className="error">
            {error}
            {dupe && (
              <>
                {" "}
                <Link href={`/admin/calls/${dupe.id}`}>Open the call on file{dupe.what ? ` (${dupe.what})` : ""}</Link>
              </>
            )}
          </div>
        )}
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
          <option value="">All full calls</option>
          {(Object.keys(OUTCOME_LABEL) as Outcome[]).map((o) => (
            <option key={o} value={o}>
              {OUTCOME_LABEL[o]}
            </option>
          ))}
          <option value="fragile">Fragile closes</option>
          <option value="cancelled">Cancelled</option>
          <option value="paid6">Made 6+ payments</option>
          <option value="graduated">Graduated</option>
          <option value="quick">Voicemails &amp; short calls</option>
          <option value="all">Everything, voicemails too</option>
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

      {(closeCheck.fragile.n > 0 || closeCheck.ok.n > 0 || closeCheck.solid.n > 0) && (
        <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
          How the grader&rsquo;s close calls held up (clients with a known result): fragile {closeCheck.fragile.cancelled} of {closeCheck.fragile.n} cancelled
          {" \u00b7 "}normal {closeCheck.ok.cancelled} of {closeCheck.ok.n}
          {" \u00b7 "}solid {closeCheck.solid.cancelled} of {closeCheck.solid.n}
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
                    {c.call_time ? ` · ${fmtTime(c.call_time)}` : ""}
                    {c.duration_secs ? ` · ${clock(c.duration_secs)}` : ""}
                    {outcomeOf(c) ? ` · ${OUTCOME_LABEL[outcomeOf(c) as Outcome]}` : ""}
                    {c.lang && langOf(c.lang) === "es" ? " · Spanish" : ""}
                    {c.close_quality === "fragile" && <span className="danger">{" · fragile close"}</span>}
                    {c.retention === "cancelled" && <strong className="danger">{" · cancelled"}</strong>}
                    {c.retention === "graduated" && <strong className="good-text">{" · graduated"}</strong>}
                    {c.retention === "paid6" && <strong className="good-text">{" · 6+ payments"}</strong>}
                    {c.status === "graded" && c.gfail === "true" && (
                      <span className="muted" title={`This grade is from older grading rules -- the automatic re-grade couldn't redo it${c.error ? `: ${c.error}` : ""}. Open the call and press Re-grade.`}>
                        {" · older grade"}
                      </span>
                    )}
                    {c.redaction_count > 0 && c.audio_path && c.audio_redact_state !== "done" && (
                      <span className="danger">{" · numbers still in recording"}</span>
                    )}
                  </div>
                </span>
                {c.status === "graded" && c.score !== null ? (
                  <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                    <span className={`pill ${band}`} title="Script score">Script {c.score}</span>
                    {c.slp_score !== null && (
                      <span className={`pill ${scoreBand(c.slp_score)}`} title="Straight Line score">
                        SLP {c.slp_score}
                      </span>
                    )}
                  </span>
                ) : c.status === "read" && quick.get(c.id) ? (
                  (() => {
                    const q = quick.get(c.id)!;
                    return q.kind === "voicemail" ? (
                      <span className={`pill ${scoreBand(q.score)}`} title="Voicemail score -- kept apart from every grade and average">
                        Voicemail {q.score}
                      </span>
                    ) : (
                      <span className="pill" title={q.read}>
                        {SHORT_LABEL[q.what]}
                      </span>
                    );
                  })()
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
