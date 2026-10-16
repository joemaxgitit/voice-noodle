"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  type Outcome,
  arcScoreOf,
  skillsScoreOf,
  type CallStatus,
  type Grade,
  type Role,
  type Transcript,
  type CallCost,
  type GradeVersion,
} from "@/lib/calls";
import "../calls.css";

type Call = {
  id: string;
  client_label: string | null;
  call_date: string | null;
  file_name: string | null;
  audio_path: string | null;
  duration_secs: number | null;
  status: CallStatus;
  error: string | null;
  transcript: Transcript | null;
  redaction_count: number;
  speaker_roles: Record<string, Role> | null;
  grade: Grade | null;
  score: number | null;
  slp_score: number | null;
  outcome: Outcome | null;
  outcome_manual: Outcome | null;
  grade_history: GradeVersion[] | null;
  cost: CallCost | null;
  script_id: string | null;
  updated_at: string;
  profiles: { full_name: string | null } | null;
  scripts: { title: string } | null;
};

const BUSY: CallStatus[] = ["uploading", "uploaded", "transcribing", "grading"];

const SECTION_LABEL = { hit: "Hit", partial: "Partial", missed: "Missed", not_reached: "Not reached" };
const ARC_LABEL: Record<string, string> = { yes: "Landed", partial: "Partly", no: "Didn't land", not_reached: "Not reached" };
const ARC_PILL: Record<string, string> = { yes: "good", partial: "fair", no: "poor", not_reached: "" };
const COMPLIANCE_LABEL = { yes: "Yes", no: "No", unclear: "Unclear", not_reached: "Not reached" };

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
  const [audioUrl, setAudioUrl] = useState("");
  const [now, setNow] = useState(0);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  // -1 = the current grade; 0.. = an earlier one from grade_history.
  const [version, setVersion] = useState(-1);
  const audio = useRef<HTMLAudioElement>(null);
  const kicked = useRef(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("calls")
      .select(
        "id, client_label, call_date, file_name, audio_path, duration_secs, status, error, transcript, redaction_count, speaker_roles, grade, score, slp_score, outcome, outcome_manual, grade_history, cost, script_id, updated_at, profiles:rep_id(full_name), scripts(title)"
      )
      .eq("id", callId)
      .single();
    if (error) setError(error.message);
    setCall((data as unknown as Call) || null);
  }, [supabase, callId]);

  useEffect(() => {
    void load();
    void supabase
      .from("scripts")
      .select("id, title")
      .eq("active", true)
      .order("sort_order")
      .then(({ data }) => setScripts(data || []));
  }, [load, supabase]);

  // Signed URL for playback, once we know the path.
  const audioPath = call?.audio_path;
  useEffect(() => {
    if (!audioPath) {
      setAudioUrl("");
      return;
    }
    void supabase.storage
      .from("call-audio")
      .createSignedUrl(audioPath, 3600)
      .then(({ data }) => setAudioUrl(data?.signedUrl || ""));
  }, [audioPath, supabase]);

  // Poll while a job runs.
  const running = !!call && BUSY.includes(call.status) && !isStuck(call.status, call.updated_at);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [running, load]);

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

  // Transcript labels use the names entered at upload: the rep chosen in the
  // dropdown, and the client name if one was typed.
  const label = (r: Role): string => {
    if (r === "rep") return call?.profiles?.full_name?.trim() || ROLE_LABEL.rep;
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

  async function run(route: "transcribe" | "grade") {
    if (!call) return;
    setWorking(true);
    setError("");
    kicked.current = true;
    const err = await startJob(supabase, route, call.id);
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
  async function setOutcome(value: string) {
    if (!call) return;
    const manual = !value || value === call.outcome ? null : (value as Outcome);
    setCall({ ...call, outcome_manual: manual });
    const { error } = await supabase.from("calls").update({ outcome_manual: manual }).eq("id", call.id);
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
  const totalCost =
    cost && (cost.transcribe_usd !== undefined || cost.grade_usd_total !== undefined)
      ? (cost.transcribe_usd ?? 0) + (cost.grade_usd_total ?? 0)
      : null;
  const stuck = isStuck(call.status, call.updated_at);
  const band = scoreBand(shownScore);
  const utterances = call.transcript?.utterances ?? [];
  const speakers = call.transcript?.speakers ?? [];
  const flags = [...(g?.flags ?? [])].sort(
    (a, b) => ["high", "medium", "low"].indexOf(a.severity) - ["high", "medium", "low"].indexOf(b.severity)
  );

  return (
    <main className="shell calls-shell">
      <div className="topbar">
        <Link className="btn" href="/admin/calls" style={{ textDecoration: "none" }}>
          &larr; Calls
        </Link>
      </div>

      <div className="call-head">
        <div>
          <div className="eyebrow">
            {call.call_date || ""}
            {call.duration_secs ? ` · ${clock(call.duration_secs)}` : ""}
            {call.scripts?.title ? ` · ${call.scripts.title}` : ""}
          </div>
          <h1>
            {call.profiles?.full_name || "Unknown rep"}
            {call.client_label ? ` · ${call.client_label}` : ""}
          </h1>
          <span
            className={`pill ${call.status === "failed" || stuck ? "failed" : running ? "busy" : ""}`}
          >
            {stuck ? "Stuck" : STATUS_LABEL[call.status]}
          </span>
          {call.redaction_count > 0 && (
            <span className="muted" style={{ marginLeft: 10, fontSize: 13 }}>
              {call.redaction_count} number{call.redaction_count === 1 ? "" : "s"} redacted
            </span>
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

      {call.status === "failed" && call.error && <div className="error">{call.error}</div>}
      {call.status !== "failed" && call.error && <div className="note">{call.error}</div>}
      {error && <div className="error">{error}</div>}

      <div className="row" style={{ marginTop: 14 }}>
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
        <div className="call-audio">
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
        <label className="field" style={{ maxWidth: 420, marginTop: 18 }}>
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

      {g && (
        <>
          <h2>Summary</h2>
          <p style={{ lineHeight: 1.6, margin: 0 }}>{g.summary}</p>
          <p className="muted" style={{ marginTop: 6 }}>
            Call ended: {g.furthest_point}
          </p>

          {(call.outcome || call.outcome_manual || g.outcome) && (
            <>
              <h2>Outcome</h2>
              <div className="grade-item">
                <div className="grade-item-head" style={{ alignItems: "center" }}>
                  <select
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
                {call.outcome_manual && (
                  <div className="calls-meta">
                    Corrected by a manager. The grader read it as{" "}
                    {OUTCOME_LABEL[(call.outcome ?? g.outcome ?? "other") as Outcome]}.
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
                  <li key={i}>{c}</li>
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

          {(g.emotional_arc?.length ?? 0) > 0 && (
            <>
              <h2>
                Emotional roadmap
                {arcScoreOf(g) !== null && (
                  <span className={`pill ${scoreBand(arcScoreOf(g))}`} style={{ marginLeft: 10 }}>
                    {arcScoreOf(g)}
                  </span>
                )}
              </h2>
              <p className="muted" style={{ marginTop: 0 }}>
                The backbone of the sale: what each stage is built to make the client feel, and what the
                client actually showed. Half of the Straight Line score.
              </p>
              {g.emotional_arc!.map((a, i) => (
                <div key={i} className={`grade-item arc ${a.landed}`}>
                  <div className="grade-item-head">
                    <span>{a.stage}</span>
                    <span className={`pill ${ARC_PILL[a.landed] ?? ""}`}>{ARC_LABEL[a.landed] ?? a.landed}</span>
                  </div>
                  {a.landed !== "not_reached" && (
                    <div className="arc-feel">
                      <span className="muted">Built to feel:</span> {a.intended}
                      <br />
                      <span className="muted">Client showed:</span> {a.observed}
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
                </div>
              ))}
            </>
          )}

          {(g.slp?.length ?? 0) > 0 && (
            <>
              <h2>
                Straight Line skills
                {skillsScoreOf(g) !== null && (
                  <span className={`pill ${scoreBand(skillsScoreOf(g))}`} style={{ marginLeft: 10 }}>
                    {skillsScoreOf(g)}
                  </span>
                )}
              </h2>
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
                </div>
              ))}
            </>
          )}

          {flags.length > 0 && (
            <>
              <h2>Flags for review ({flags.length})</h2>
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
                </div>
              ))}
            </>
          )}

          <h2>Script sections</h2>
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
            </div>
          ))}

          {g.compliance.length > 0 && (
            <>
              <h2>Required disclosures</h2>
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
                </div>
              ))}
            </>
          )}

          <p className="muted" style={{ fontSize: 12, marginTop: 14 }}>
            {g.model ? `Graded by ${modelName(g.model)}. ` : ""}Graded from the words only, not tone of voice. The Straight Line score is half the emotional roadmap, half the skills. The script score counts sections the call reached:
            hit = full credit, partial = half.
          </p>
        </>
      )}

      {speakers.length > 0 && (
        <>
          <h2>Speakers</h2>
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
        </>
      )}

      {utterances.length > 0 && (
        <>
          <h2>Transcript</h2>
          <div className="transcript">
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
                    <Said text={u.text} />
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}

      <h2>Settings</h2>
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
          {cost.grade_cache_read_tokens ? " \u00b7 script read from cache" : ""}
        </p>
      )}
      <div className="row">
        {call.audio_path && (
          <button className="danger" onClick={deleteAudio}>
            Delete recording, keep transcript
          </button>
        )}
        <button className="danger" onClick={deleteCall}>
          Delete call
        </button>
      </div>
    </main>
  );
}
