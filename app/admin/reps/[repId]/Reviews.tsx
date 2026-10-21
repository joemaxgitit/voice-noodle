"use client";

import { reviewView } from "@/lib/repHistory";
import { useEffect, useState } from "react";
import type { RepReview, ReviewBody } from "@/lib/repHistory";
import { okToSpend, usd, useEstimate } from "@/lib/spend";
import type { Ctx } from "./page";

const TRAJ: Record<ReviewBody["trajectory"], string> = {
  improving: "Improving",
  steady: "Steady",
  slipping: "Slipping",
  mixed: "Mixed",
  early: "Too early to tell",
};

/** Claude's read on the rep's overall arc, and the history of past reads. */
export default function Reviews({ ctx }: { ctx: Ctx }) {
  const { supabase, repId, repName, history: h, people, reload } = ctx;
  const [focus, setFocus] = useState("");
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const est = useEstimate(supabase, "review");

  const working = h.reviews.find((r) => r.status === "working" && Date.now() - new Date(r.created_at).getTime() < 10 * 60000);
  const shown = h.reviews.find((r) => r.id === openId) ?? h.reviews.find((r) => r.status !== "working");

  // Poll while one is being written.
  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => void reload(), 4000);
    return () => clearInterval(t);
  }, [working, reload]);

  async function run() {
    if (!(await okToSpend(supabase, est ?? 0, "This coaching review"))) return;
    setStarting(true);
    setError("");
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const res = await fetch("/api/reps/review", {
      method: "POST",
      headers: { Authorization: `Bearer ${session?.access_token ?? ""}`, "Content-Type": "application/json" },
      body: JSON.stringify({ repId, days: 0, focus }),
    }).catch((e) => e as Error);
    setStarting(false);
    if (res instanceof Error) return setError(res.message);
    if (!res.ok) return setError((await res.json().catch(() => ({})))?.error || `Request failed (${res.status}).`);
    setOpenId(null);
    setFocus("");
    await reload();
  }

  return (
    <div>
      <section className="card rx-noprint">
        <h3 className="rx-sec-title">Run a coaching review</h3>
        <p className="hint" style={{ marginTop: 0 }}>
          {ctx.superMode
            ? "Claude reads every graded call (real and practice), the KPI reports month by month, your notes and files, knowledge checks and attendance, and writes"
            : "Claude reads every graded call (real and practice), the Straight Line, script and tonality scores, and practice, and writes"} {repName.split(" ")[0]}&rsquo;s arc: what&rsquo;s slipping before it gets worse, what&rsquo;s getting better, and what to
          coach next. Takes a minute or two.
        </p>
        <label className="field">
          <span className="label">Anything to look at especially? (optional)</span>
          <input value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="e.g. cancels before first payment, or the SuperMoney drop" />
        </label>
        <button className="primary" disabled={starting || !!working} onClick={run}>
          {working ? "Writing the review…" : starting ? "Starting…" : `Run coaching review${est !== null ? ` · about ${usd(est)}` : ""}`}
        </button>
        {error && <div className="error">{error}</div>}
      </section>

      {working && (
        <div className="card rx-working" style={{ marginTop: 14 }}>
          <span className="rx-spin" aria-hidden="true" />
          <span>
            Reading {working.inputs ? describeInputs(ctx.superMode ? working.inputs : { calls: working.inputs.calls, practice: working.inputs.practice, quizzes: working.inputs.quizzes }) : "everything on record"} and writing the review. You can leave this page; it&rsquo;ll be here when
            you come back.
          </span>
        </div>
      )}

      {shown && (
        <div style={{ marginTop: 14 }}>
          {shown.status === "failed" ? (
            <div className="error">
              The review from {new Date(shown.created_at).toLocaleString()} failed: {shown.error}
            </div>
          ) : shown.review ? (
            reviewView(shown.review, ctx.superMode) ? (
              <ReviewView r={shown} v={reviewView(shown.review, ctx.superMode)!} author={people.get(shown.created_by || "") ?? "a manager"} onCard={(f) => ctx.seedCard(f, shown.id)} />
            ) : (
              <p className="hint">This review was run before the voice and script view existed. Run a new one to see it.</p>
            )
          ) : null}
        </div>
      )}

      {h.reviews.length > 1 && (
        <section style={{ marginTop: 20 }} className="rx-noprint">
          <h3 className="rx-sec-title">Earlier reviews</h3>
          <table className="rx-table">
            <tbody>
              {h.reviews.map((r) => (
                <tr key={r.id} className="link" onClick={() => setOpenId(r.id)} style={r.id === shown?.id ? { background: "var(--ink-2)" } : undefined}>
                  <td style={{ whiteSpace: "nowrap" }}>{new Date(r.created_at).toLocaleDateString()}</td>
                  <td>
                    {r.status === "done" && r.review
                      ? (reviewView(r.review, ctx.superMode)?.headline ?? "Run before the voice and script view")
                      : r.status === "working"
                        ? "Writing…"
                        : `Failed: ${r.error ?? ""}`}
                  </td>
                  <td className="num">
                    {reviewView(r.review, ctx.superMode) && (() => {
                      const t = reviewView(r.review, ctx.superMode)!.trajectory;
                      return <span className={`pill ${t === "improving" ? "good" : t === "slipping" ? "poor" : "fair"}`}>{TRAJ[t]}</span>;
                    })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

function describeInputs(i: Record<string, number>) {
  const parts = [
    i.calls ? `${i.calls} real call${i.calls === 1 ? "" : "s"}` : "",
    i.practice ? `${i.practice} practice call${i.practice === 1 ? "" : "s"}` : "",
    i.kpi_months ? `${i.kpi_months} KPI report${i.kpi_months === 1 ? "" : "s"}` : "",
    i.notes ? `${i.notes} note${i.notes === 1 ? "" : "s"}` : "",
    i.files ? `${i.files} file${i.files === 1 ? "" : "s"}` : "",
    i.quizzes ? `${i.quizzes} knowledge check${i.quizzes === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "what's on record";
}

function ReviewView({ r, v, author, onCard }: { r: RepReview; v: NonNullable<ReturnType<typeof reviewView>>; author: string; onCard: (focus: string) => void }) {
  return (
    <div className="rx-review">
      <div className="rx-verdict">
        <span className={`badge ${v.trajectory}`}>{TRAJ[v.trajectory]}</span>
        <div>
          <div className="headline">{v.headline}</div>
          <p>{v.arc}</p>
          <p className="hint" style={{ marginTop: 8 }}>
            {new Date(r.created_at).toLocaleDateString()} · run by {author} ·{" "}
            {r.period_from ? `since ${r.period_from}` : "everything on record"}
            {r.inputs ? ` · read ${describeInputs(v.coreOnly ? { calls: r.inputs.calls, practice: r.inputs.practice, quizzes: r.inputs.quizzes } : r.inputs)}` : ""}
            {r.focus ? ` · focus: ${r.focus}` : ""}
          </p>
        </div>
      </div>

      <div className="rx-grid2">
        <section className="card">
          <h3 className="rx-sec-title" style={{ color: "var(--bad)" }}>
            Slipping -- catch it now
          </h3>
          {!v.slipping.length && <p className="hint">Nothing slipping.</p>}
          {v.slipping.map((t, i) => (
            <div key={i} className="rx-trend bad">
              <b>{t.title}</b>
              <p className="ev">{t.evidence}</p>
              {t.since && <p className="ev">Since {t.since}</p>}
              {t.action && (
                <p>
                  <b style={{ display: "inline" }}>Do: </b>
                  {t.action}
                </p>
              )}
            </div>
          ))}
        </section>
        <section className="card">
          <h3 className="rx-sec-title" style={{ color: "var(--ok)" }}>
            Improving -- call it out
          </h3>
          {!v.improving.length && <p className="hint">No clear gains yet.</p>}
          {v.improving.map((t, i) => (
            <div key={i} className="rx-trend good">
              <b>{t.title}</b>
              <p className="ev">{t.evidence}</p>
              {t.action && <p>{t.action}</p>}
            </div>
          ))}
        </section>
      </div>

      <section className="card">
        <h3 className="rx-sec-title">Coach next</h3>
        {v.focus_next.map((f, i) => (
          <div key={i} className="rx-trend focus">
            <b>
              {i + 1}. {f.skill}
            </b>
            <p>{f.why}</p>
            <p>
              <b style={{ display: "inline" }}>Drill: </b>
              {f.drill}
            </p>
            <button className="tr-sm rx-noprint" onClick={() => onCard(`${f.skill}: ${f.why} Drill: ${f.drill}`)}>
              Make a training card from this
            </button>
          </div>
        ))}
      </section>

      <div className="rx-grid2">
        {!v.coreOnly && (
        <section className="card">
          <h3 className="rx-sec-title">KPIs month to month</h3>
          <p style={{ marginTop: 0, lineHeight: 1.55 }}>{v.kpi_read}</p>
          {v.kpi_talking_points.length > 0 && (
            <>
              <h3 className="rx-sec-title" style={{ marginTop: 12 }}>
                For the one-on-one
              </h3>
              <ul className="plain-list">
                {v.kpi_talking_points.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </>
          )}
        </section>
        )}
        <section className="card">
          <h3 className="rx-sec-title">Questions to ask</h3>
          <ul className="plain-list">
            {v.questions_to_ask.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
          {v.compliance_watch.length > 0 && (
            <>
              <h3 className="rx-sec-title" style={{ marginTop: 12, color: "var(--bad)" }}>
                Compliance watch
              </h3>
              <ul className="plain-list">
                {v.compliance_watch.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
      {v.data_gaps && <p className="hint">What would sharpen this: {v.data_gaps}</p>}
      <div className="rx-noprint">
        <button onClick={() => window.print()}>Print</button>
      </div>
    </div>
  );
}
