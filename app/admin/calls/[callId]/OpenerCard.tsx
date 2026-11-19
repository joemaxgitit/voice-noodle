"use client";

import type { OpenerParts } from "@/lib/gradeOpener";

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const pct = (n: number, of: number) => (of ? Math.round((100 * n) / of) : null);
const band = (n: number | null) => (n == null ? "" : n >= 85 ? "good" : n >= 65 ? "fair" : "poor");

/** An opener call's grade: the application questions, read-backs, compliance count and rebuttals. */
export default function OpenerCard({ o, seek }: { o: OpenerParts; seek: (t: number) => void }) {
  const At = ({ t }: { t: number | null }) =>
    t == null ? null : (
      <button className="time-link" onClick={() => seek(t)}>
        {clock(t)}
      </button>
    );
  const missedQ = o.questions.filter((q) => q.asked === "no" || q.asked === "partly");
  const reachedR = o.readbacks.filter((r) => r.done !== "not_reached");
  const comp = pct(o.compliance_said, o.compliance_total);
  return (
    <>
      <h2>Opener call</h2>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        {o.script_pct != null && <span className={`pill ${band(o.script_pct)}`}>Script {o.script_pct}%</span>}
        {o.compliance_total > 0 && (
          <span className={`pill ${o.compliance_said === o.compliance_total ? "good" : "poor"}`}>
            Compliance {o.compliance_said}/{o.compliance_total}
          </span>
        )}
        {o.rebuttals.length > 0 && (
          <span className={`pill ${band(pct(o.rebuttals_good, o.rebuttals.length))}`}>
            Rebuttals {o.rebuttals_good}/{o.rebuttals.length} done right
          </span>
        )}
        {o.let_go_early.early && <span className="pill poor">Let the client go early</span>}
        {comp === null && null}
      </div>
      {o.let_go_early.early && (
        <p style={{ marginTop: 6 }}>
          <At t={o.let_go_early.time} /> {o.let_go_early.note}
        </p>
      )}

      <div className="grade-item" style={{ marginTop: 10 }}>
        <div className="grade-item-head">
          <span>Application questions</span>
          <span className="muted">
            {o.questions.filter((q) => q.asked === "yes").length} of {o.questions.filter((q) => q.asked !== "not_reached").length} asked
          </span>
        </div>
        {missedQ.length === 0 ? (
          <small className="muted">Every question the call reached was asked.</small>
        ) : (
          <ul style={{ margin: "4px 0 0" }}>
            {missedQ.map((q, i) => (
              <li key={i}>
                <span className={`pill ${q.asked === "no" ? "poor" : "fair"}`}>{q.asked === "no" ? "skipped" : "partly"}</span> {q.item} <At t={q.time} />
                {q.note && <span className="muted"> &mdash; {q.note}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {reachedR.length > 0 && (
        <div className="grade-item">
          <div className="grade-item-head">
            <span>Read-backs</span>
            <span className="muted">
              {reachedR.filter((r) => r.done === "yes").length} of {reachedR.length}
            </span>
          </div>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {reachedR.map((r, i) => (
              <span key={i} className={`pill ${r.done === "yes" ? "good" : "poor"}`}>
                {r.done === "yes" ? "✓" : "✗"} {r.item}
              </span>
            ))}
          </div>
        </div>
      )}

      {o.rebuttals.length > 0 && (
        <div className="grade-item">
          <div className="grade-item-head">
            <span>Rebuttals</span>
            <span className="muted">{o.rebuttals.length} objection{o.rebuttals.length === 1 ? "" : "s"}</span>
          </div>
          {o.rebuttals.map((r, i) => {
            const good = r.used_approved === "yes" && r.tie_down === "yes" && r.asked_concerns !== "no";
            return (
              <div key={i} style={{ padding: "6px 0", borderTop: i ? "1px solid var(--line)" : undefined }}>
                <At t={r.at} /> <b>&ldquo;{r.objection}&rdquo;</b>
                {r.matched && <span className="muted"> &rarr; {r.matched}</span>}
                <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                  {r.asked_concerns !== "n/a" && (
                    <span className={`pill ${r.asked_concerns === "yes" ? "good" : "poor"}`}>{r.asked_concerns === "yes" ? "Asked their concerns" : "Didn't ask their concerns"}</span>
                  )}
                  <span className={`pill ${r.used_approved === "yes" ? "good" : r.used_approved === "partly" ? "fair" : "poor"}`}>
                    {r.used_approved === "yes" ? "Approved rebuttal" : r.used_approved === "partly" ? "Partly the rebuttal" : "Not the rebuttal"}
                  </span>
                  <span className={`pill ${r.tie_down === "yes" ? "good" : "poor"}`}>{r.tie_down === "yes" ? "Tie-down" : "No tie-down"}</span>
                  <span className={`pill ${r.result === "kept_going" ? "good" : r.result === "callback" ? "fair" : r.result === "lost" ? "poor" : ""}`}>
                    {r.result === "kept_going" ? "Kept going" : r.result === "callback" ? "Callback" : r.result === "lost" ? "Lost them" : "Unclear"}
                  </span>
                  {!good && null}
                </div>
                {r.note && <small className="muted">{r.note}</small>}
              </div>
            );
          })}
        </div>
      )}

      {o.control && (
        <div className="grade-item">
          <div className="grade-item-head">
            <span>Pace and energy</span>
          </div>
          <span>{o.control}</span>
        </div>
      )}
    </>
  );
}
