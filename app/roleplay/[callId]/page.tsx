"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  clock,
  isStuck,
  scoreBand,
  stageLabel,
  OUTCOME_LABEL,
  type CallStatus,
  type Grade,
  type Outcome,
  type Transcript, clockify } from "@/lib/calls";
import { RIGHT_OUTCOME_LABEL, verdictOf, type PersonaSecret, type RoleplayInfo } from "@/lib/roleplay";
import "../../admin/calls/calls.css";
import "../roleplay.css";

type Row = {
  id: string;
  status: CallStatus;
  error: string | null;
  updated_at: string;
  created_at: string;
  duration_secs: number | null;
  score: number | null;
  slp_score: number | null;
  outcome: string | null;
  grade: Grade | null;
  transcript: Transcript | null;
  roleplay: RoleplayInfo | null;
};

const LANDED: Record<string, string> = { yes: "Landed", partial: "Partly", no: "Missed", not_reached: "Not reached" };
const LANDED_CLASS: Record<string, string> = { yes: "yes", partial: "partial", no: "no", not_reached: "" };

/** One practice call: the grade, what the client was hiding, and the transcript. */
export default function PracticeResult() {
  const { callId } = useParams<{ callId: string }>();
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();

  const [row, setRow] = useState<Row | null>(null);
  const [secret, setSecret] = useState<PersonaSecret | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [audioUrl, setAudioUrl] = useState("");
  const [audioBusy, setAudioBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      router.replace("/login");
      return;
    }
    const { data, error } = await supabase
      .from("calls")
      .select("id, status, error, updated_at, created_at, duration_secs, score, slp_score, outcome, grade, transcript, roleplay")
      .eq("id", callId)
      .single();
    if (error) setError(error.message);
    setRow(data as Row | null);
  }, [supabase, router, callId]);

  useEffect(() => {
    load();
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return;
      const { data } = await supabase.from("profiles").select("role").eq("id", session.user.id).single();
      setIsAdmin(["admin", "manager"].includes(data?.role || ""));
    });
  }, [load, supabase]);

  // Poll while the transcript and grade are on their way.
  const working = row && ["transcribing", "grading", "transcribed"].includes(row.status);
  useEffect(() => {
    if (!working) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [working, load]);

  // The hidden side of the client, once the call is over.
  useEffect(() => {
    if (!row || row.status === "live" || secret) return;
    supabase
      .rpc("roleplay_reveal", { p_call: row.id })
      .maybeSingle()
      .then(({ data }) => {
        if (data) setSecret(data as PersonaSecret);
      });
  }, [row, secret, supabase]);

  async function token() {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token ?? "";
  }

  async function retry() {
    setBusy(true);
    setError("");
    const res = await fetch("/api/roleplay/finish", {
      method: "POST",
      headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ callId }),
    }).catch(() => null);
    if (!res || !res.ok) {
      const b = res ? await res.json().catch(() => ({})) : {};
      setError(b?.error || "Could not start grading.");
    }
    setBusy(false);
    load();
  }

  async function loadAudio() {
    setAudioBusy(true);
    const res = await fetch(`/api/roleplay/audio?callId=${callId}`, {
      headers: { Authorization: `Bearer ${await token()}` },
    }).catch(() => null);
    if (res?.ok) {
      setAudioUrl(URL.createObjectURL(await res.blob()));
    } else {
      const b = res ? await res.json().catch(() => ({})) : {};
      setError(b?.error || "The recording is not available.");
    }
    setAudioBusy(false);
  }

  if (!row) {
    return (
      <main className="shell rp-shell">
        <p className="muted">{error || "Loading…"}</p>
      </main>
    );
  }

  const rp = row.roleplay || ({ persona: "the client", lang: "en" } as RoleplayInfo);
  const g = row.grade ? clockify(row.grade) : row.grade;
  const first = rp.persona.split(" ")[0];
  const stuck = (row.status === "transcribing" || row.status === "grading") && isStuck(row.status, row.updated_at);
  const verdict = g && secret ? verdictOf(secret.right_outcome, row.outcome, g.close_quality) : null;

  return (
    <main className="shell rp-shell">
      <div className="topbar">
        <Link className="btn" href="/roleplay" style={{ textDecoration: "none" }}>
          &larr; Practice calls
        </Link>
        {isAdmin && (
          <Link className="btn" href={`/admin/calls/${row.id}`} style={{ textDecoration: "none" }}>
            Full report
          </Link>
        )}
      </div>

      <div className="eyebrow">
        Practice call &middot; {new Date(row.created_at).toLocaleString()} &middot; {clock(row.duration_secs) || "--"}
        {rp.lang === "es" ? " · Spanish" : ""}
      </div>
      <h1>
        {rp.persona_title || "Practice call"}: {rp.persona}
      </h1>

      {error && <div className="error">{error}</div>}

      {/* ---------- still working, or failed ---------- */}
      {row.status === "live" && (
        <div className="card">
          <p style={{ marginTop: 0 }}>This call was never finished -- the page closed before it was sent for grading.</p>
          {rp.conversation_id ? (
            <button className="primary" onClick={retry} disabled={busy}>Grade it now</button>
          ) : (
            <p className="muted">It never connected, so there is nothing to grade.</p>
          )}
        </div>
      )}
      {working && !stuck && (
        <div className="card">
          <span className="pill busy">{row.status === "grading" ? "Grading" : "Getting the transcript"}</span>
          <p className="muted" style={{ marginBottom: 0 }}>
            {row.status === "grading"
              ? "Grading against the script and Straight Line. This usually takes a minute or two -- this page updates by itself."
              : "Fetching the call. This page updates by itself."}
          </p>
        </div>
      )}
      {(row.status === "failed" || stuck) && (
        <div className="card">
          <span className="pill failed">Failed</span>
          <p>{stuck ? "This took too long and probably stopped." : row.error}</p>
          <button onClick={retry} disabled={busy}>Try again</button>
        </div>
      )}

      {/* ---------- the grade ---------- */}
      {g && row.status === "graded" && (
        <>
          <div className="row" style={{ gap: 18, marginTop: 6 }}>
            <div>
              <div className="label">Script</div>
              <div className={`score-big ${scoreBand(row.score)}`}>{row.score ?? "--"}</div>
            </div>
            <div>
              <div className="label">Straight Line</div>
              <div className={`score-big ${scoreBand(row.slp_score)}`}>{row.slp_score ?? "--"}</div>
            </div>
            <div>
              <div className="label">Result</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>
                {OUTCOME_LABEL[row.outcome as Outcome] ?? row.outcome ?? "--"}
                {g.close_quality && g.close_quality !== "n/a" ? (
                  <span className={`pill ${g.close_quality === "solid" ? "good" : g.close_quality === "ok" ? "fair" : "poor"}`} style={{ marginLeft: 8 }}>
                    {g.close_quality}
                  </span>
                ) : null}
              </div>
              {g.outcome_note && <div className="hint" style={{ margin: 0 }}>{g.outcome_note}</div>}
            </div>
          </div>

          {verdict && (
            <div className={`rp-verdict ${verdict.ok === true ? "right" : verdict.ok === false ? "wrong" : "close"}`}>
              <span className="mark" aria-hidden="true">{verdict.ok === true ? "✓" : verdict.ok === false ? "✗" : "~"}</span>
              <div>
                <b>{verdict.text}</b>
                <div className="hint" style={{ margin: "4px 0 0" }}>
                  The right result for {first}: {RIGHT_OUTCOME_LABEL[secret!.right_outcome]}.
                </div>
              </div>
            </div>
          )}

          <div className="rp-section">
            <p style={{ lineHeight: 1.6 }}>{g.summary}</p>
            {g.slp_summary && <p className="muted" style={{ lineHeight: 1.6 }}>{g.slp_summary}</p>}
          </div>

          {g.coaching_priorities?.length > 0 && (
            <div className="rp-section">
              <h2>Work on next</h2>
              <ol className="rp-list">
                {g.coaching_priorities.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ol>
            </div>
          )}

          {g.strengths?.length > 0 && (
            <div className="rp-section">
              <h2>What went well</h2>
              <ul className="rp-list">
                {g.strengths.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}

          {secret && (
            <div className="rp-section">
              <h2>{first}&rsquo;s Three Tens</h2>
              <div className="rp-tens">
                {(["product", "rep", "company"] as const).map((k) => (
                  <div className="rp-ten" key={k}>
                    <div className="label" style={{ textTransform: "capitalize" }}>{k}</div>
                    <div className="n">
                      {secret.tens[k]} &rarr; {g.three_tens?.[k] ?? "?"} <small>/ 10</small>
                    </div>
                  </div>
                ))}
              </div>
              <p className="hint" style={{ marginTop: 8 }}>
                Where {first} started, and where the grader thinks the call left them.
                {g.three_tens?.evidence ? ` ${g.three_tens.evidence}` : ""}
              </p>
            </div>
          )}

          {secret && (
            <details className="rp-secret">
              <summary>What {first} was hiding</summary>
              <p>{secret.backstory}</p>
              {secret.right_outcome_note && <p className="muted">{secret.right_outcome_note}</p>}
            </details>
          )}

          {(g.emotional_arc?.length ?? 0) > 0 && (
            <div className="rp-section">
              <h2>Emotional roadmap</h2>
              {(g.emotional_arc ?? []).map((a, i) => (
                <div className="rp-stage" key={i}>
                  <b>{stageLabel(a.stage, a.section)}</b>
                  <span className={`pill ${LANDED_CLASS[a.landed] ?? ""}`}>{LANDED[a.landed] ?? a.landed}</span>
                  <span className="obs">{a.observed}</span>
                </div>
              ))}
            </div>
          )}

          {(g.slp?.length ?? 0) > 0 && (
            <div className="rp-section">
              <h2>Straight Line skills</h2>
              {(g.slp ?? []).map((k, i) => (
                <div className="rp-stage" key={i}>
                  <b>{k.skill}</b>
                  <span className={`pill ${k.score === null ? "" : k.score >= 7 ? "good" : k.score >= 5 ? "fair" : "poor"}`}>
                    {k.score ?? "--"}/10
                  </span>
                  <span className="obs">{k.coaching}</span>
                </div>
              ))}
            </div>
          )}

          {g.flags?.length > 0 && (
            <div className="rp-section">
              <h2>Flags</h2>
              {g.flags.map((f, i) => (
                <div className="rp-stage" key={i}>
                  <b>{f.issue}</b>
                  <span className={`pill ${f.severity}`}>{f.severity}</span>
                  <span className="obs">&ldquo;{f.quote}&rdquo;</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ---------- recording and transcript ---------- */}
      {row.transcript && (
        <div className="rp-section">
          <h2>Recording</h2>
          {audioUrl ? (
            <audio controls src={audioUrl} style={{ width: "100%" }} />
          ) : (
            <button onClick={loadAudio} disabled={audioBusy}>
              {audioBusy ? "Loading…" : "Play the call"}
            </button>
          )}
        </div>
      )}

      {row.transcript && (
        <div className="rp-section rp-transcript">
          <h2>Transcript</h2>
          {row.transcript.utterances.map((u, i) => {
            const rep = u.speaker === "speaker_0";
            return (
              <p key={i}>
                <span className="t">{clock(u.start)}</span>
                <span className={`who ${rep ? "rep" : "client"}`}>{rep ? "You" : first}</span>
                {u.text}
              </p>
            );
          })}
        </div>
      )}
    </main>
  );
}
