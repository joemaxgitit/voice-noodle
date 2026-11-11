"use client";

import { useRef, useState } from "react";
import type { RunReview } from "@/lib/runThrough";

export type TakeRow = {
  id: string;
  audio_path: string;
  seconds: number | null;
  created_at: string;
  status: string | null;
  error: string | null;
  score: number | null;
  review: RunReview | null;
};

const clock = (s: number | null | undefined) => (s == null ? "" : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`);
const band = (n: number) => (n >= 85 ? "good" : n >= 70 ? "fair" : "poor");

/** The review of one whole-script run-through: shared by the rep's Whole script page and the managers' Attempts page. */
export default function RunReviewView({ take, url }: { take: TakeRow; url: string | null }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [showMissed, setShowMissed] = useState(false);
  const r = take.review;
  const seek = (t: number | null) => {
    if (t == null || !audio.current) return;
    audio.current.currentTime = Math.max(0, t - 1);
    void audio.current.play().catch(() => {});
  };
  const At = ({ t }: { t: number | null }) =>
    t == null ? null : (
      <button className="time-link" onClick={() => seek(t)}>
        {clock(t)}
      </button>
    );

  const busy = take.status === "saved" || take.status === "transcribing" || take.status === "reviewing";
  const ai = r?.ai;
  const missed = (r?.lines || []).filter((l) => !l.optional && l.status !== "said");

  return (
    <div style={{ marginTop: 8 }}>
      {url && <audio ref={audio} controls src={url} style={{ width: "100%" }} />}
      {take.status === "failed" && <p className="error">Couldn&rsquo;t review this take: {take.error}</p>}
      {busy && (
        <p className="muted">
          {take.status === "reviewing" && r ? "Checked against the script; writing the coaching now…" : "Reviewing this take — usually a few minutes. You can leave this page."}
        </p>
      )}
      {r && (
        <div style={{ display: "grid", gap: 12, marginTop: 8 }}>
          <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {ai && <span className={`pill ${band(ai.score)}`}>Delivery {ai.score}</span>}
            <span className={`pill ${band(r.coverage)}`}>Script {r.coverage}% said</span>
            {r.verbatim.total > 0 && (
              <span className={`pill ${r.verbatim.missed ? "poor" : r.verbatim.close ? "fair" : "good"}`}>
                Word-for-word {r.verbatim.exact}/{r.verbatim.total} exact
              </span>
            )}
            {r.pace && <span className="pill">{r.pace.usual} wpm usual</span>}
          </div>
          {ai?.summary && <p style={{ margin: 0 }}>{ai.summary}</p>}
          {r.ai_error && !ai && <small className="muted">The coaching part didn&rsquo;t run ({r.ai_error}); the script checks below are complete.</small>}

          {ai && ai.needs.length > 0 && (
            <div>
              <b>Fix first</b>
              {ai.needs.map((n, i) => (
                <div key={i} className="grade-coach" style={{ marginTop: 6 }}>
                  <b>
                    #{i + 1} {n.title}
                  </b>{" "}
                  <At t={n.time} />
                  <div className="muted">{n.why}</div>
                  <div>Next run-through: {n.fix}</div>
                </div>
              ))}
            </div>
          )}

          {ai && ai.strengths.length > 0 && (
            <div>
              <b>Did well</b>
              <ul style={{ margin: "4px 0 0" }}>
                {ai.strengths.map((s, i) => (
                  <li key={i}>
                    <At t={s.time} /> {s.text}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <b>Script</b>{" "}
            <span className="muted">
              {r.coverage}% of the lines said{r.verbatim.total ? ` · word-for-word lines: ${r.verbatim.exact} exact, ${r.verbatim.close} close, ${r.verbatim.missed} missed` : ""}
            </span>
            {missed.length > 0 && (
              <>
                {" "}
                <button className="link-btn" onClick={() => setShowMissed(!showMissed)}>
                  {showMissed ? "Hide" : "Show"} {missed.length} missed or partly said
                </button>
                {showMissed && (
                  <ul style={{ margin: "4px 0 0" }}>
                    {missed.map((l, i) => (
                      <li key={i}>
                        <span className={`pill ${l.status === "missed" ? "poor" : "fair"}`}>{l.status === "missed" ? "missed" : "partly"}</span>
                        {l.verbatim && <span className="pill poor" style={{ marginLeft: 4 }}>word for word</span>} <span className="muted">{l.section}:</span> &ldquo;{l.text}
                        {l.text.length >= 90 ? "…" : ""}&rdquo; <At t={l.time} />
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>

          {r.pace && (
            <div>
              <b>Pace</b>{" "}
              <span className="muted">usually {r.pace.usual} words a minute.</span>{" "}
              {r.pace.stretches.length === 0 ? (
                <span className="muted">Never sped up much.</span>
              ) : (
                r.pace.stretches.map((s, i) => (
                  <span key={i} style={{ whiteSpace: "nowrap" }}>
                    {i > 0 && ", "}
                    <button className="time-link" onClick={() => seek(s.start)}>
                      {clock(s.start)}&ndash;{clock(s.end)}
                    </button>{" "}
                    <span className={s.key ? "" : "muted"}>
                      ({s.wpm} wpm, +{s.pct}%{s.section ? ` · ${s.section}` : ""})
                    </span>
                    {s.key && <span className="pill poor" style={{ marginLeft: 4 }}>key moment</span>}
                  </span>
                ))
              )}
            </div>
          )}

          {r.pauses.length > 0 && (
            <div>
              <b>Long pauses</b>{" "}
              {r.pauses.slice(0, 12).map((p, i) => (
                <span key={i}>
                  {i > 0 && ", "}
                  <At t={p.at} /> <span className="muted">{p.secs}s</span>
                </span>
              ))}
            </div>
          )}

          {ai?.tonality && (
            <div>
              <b>Tone</b> <span className="muted">{ai.tonality.summary}</span>
              {ai.tonality.checks.length > 0 && (
                <ul style={{ margin: "4px 0 0" }}>
                  {ai.tonality.checks.map((c, i) => (
                    <li key={i}>
                      <At t={c.time} /> <span className={`pill ${c.match === "yes" ? "good" : c.match === "partial" ? "fair" : "poor"}`}>{c.tone}</span> expected {c.expected}; heard {c.heard}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {r.sections.length > 0 && (
            <div>
              <b>Section by section</b>
              <table className="rx-table" style={{ marginTop: 4 }}>
                <thead>
                  <tr>
                    <th>Section</th>
                    <th className="num">Took</th>
                    <th className="num">Lines said</th>
                  </tr>
                </thead>
                <tbody>
                  {r.sections.map((s, i) => (
                    <tr key={i}>
                      <td>
                        {s.start != null ? (
                          <button className="time-link" onClick={() => seek(s.start)}>
                            {s.title}
                          </button>
                        ) : (
                          <span className="muted">{s.title}</span>
                        )}
                      </td>
                      <td className="num">{s.secs != null ? clock(s.secs) : "—"}</td>
                      <td className="num">
                        {s.said}/{s.total}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
