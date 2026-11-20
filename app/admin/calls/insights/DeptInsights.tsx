"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { LOWER_IS_BETTER, type DeptMetric, type LearnDept } from "@/lib/deptLearning";
import type { DeptLessonsView } from "@/app/api/calls/dept-lessons/route";

const WORDS: Record<LearnDept, { good: string; bad: string; intro: string }> = {
  openers: {
    good: "Won",
    bad: "Lost",
    intro:
      "Every opener call is matched by lead ID to what happened next. Won: the application was submitted, the loan approved, or Sales enrolled the lead. Lost: not interested, a callback with no set time, or a hang-up, and the lead never came back.",
  },
  service: {
    good: "Stayed",
    bad: "Cancelled",
    intro:
      "Every account-manager call is matched by lead ID to what the client did next. Stayed: 6+ payments, graduated, or still with us 90 days after the call. Cancelled: the client cancelled after the call (or within a week before it -- a save that didn't work).",
  },
};

/** One row's lean: positive when good calls do more of the good thing. */
const lean = (m: DeptMetric) => (m.gap === null ? null : LOWER_IS_BETTER.has(m.label) ? -m.gap : m.gap);

/**
 * Insights for Service and Openers: what separates calls that led somewhere
 * from calls that didn't, and the lessons the grader learned from it by
 * itself. Nothing to press -- it refreshes as results come in.
 */
export default function DeptInsights({ dept }: { dept: LearnDept }) {
  const supabase = createClient();
  const [d, setD] = useState<DeptLessonsView | null>(null);
  const [error, setError] = useState("");
  const w = WORDS[dept];

  useEffect(() => {
    let off = false;
    setD(null);
    (async () => {
      const token = (await supabase.auth.getSession()).data.session?.access_token ?? "";
      const res = await fetch(`/api/calls/dept-lessons?dept=${dept}`, { headers: { Authorization: `Bearer ${token}` } });
      const j = await res.json().catch(() => ({}));
      if (off) return;
      if (!res.ok) setError(j.error || `Couldn't load (${res.status}).`);
      else setD(j as DeptLessonsView);
    })();
    return () => {
      off = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dept]);

  return (
    <main className="shell" style={{ maxWidth: 1000 }}>
      <div className="eyebrow">{dept === "openers" ? "Openers" : "Service"}</div>
      <h1>Insights &amp; tuning</h1>
      <p className="muted" style={{ maxWidth: "70ch" }}>
        {w.intro} The grader learns from the difference by itself, and its lessons go into every new grade. Disclaimers and word-for-word lines are never learned away.
      </p>
      {error && <div className="error">{error}</div>}
      {d?.setup && <div className="error">{d.setup}</div>}
      {!d && !error && <p className="muted">Loading&hellip;</p>}

      {d && (
        <>
          <section className="card" style={{ marginTop: 14 }}>
            <b>Calls with a known result</b>
            <p style={{ margin: "6px 0 0" }}>
              <span className="pill good">
                {w.good}: {d.good}
              </span>{" "}
              <span className="pill poor">
                {w.bad}: {d.bad}
              </span>{" "}
              <span className="muted">
                of {d.total} graded call{d.total === 1 ? "" : "s"}
              </span>
            </p>
            {(d.good < d.min || d.bad < d.min) && (
              <p className="muted" style={{ marginBottom: 0 }}>
                The grader starts learning once there are {d.min} of each ({Math.max(0, d.min - d.good)} more {w.good.toLowerCase()} and {Math.max(0, d.min - d.bad)} more {w.bad.toLowerCase()} to go). Calls without a lead ID can&rsquo;t be matched.
              </p>
            )}
          </section>

          <section className="card" style={{ marginTop: 14 }}>
            <b>What the grader learned</b>
            {d.lessons ? (
              <>
                <ul style={{ margin: "8px 0 0", paddingLeft: 18, display: "grid", gap: 6 }}>
                  {d.lessons
                    .split("\n")
                    .map((l) => l.replace(/^-\s*/, "").trim())
                    .filter(Boolean)
                    .map((l, i) => (
                      <li key={i}>{l}</li>
                    ))}
                </ul>
                {d.updated_at && (
                  <p className="muted" style={{ margin: "8px 0 0", fontSize: 13 }}>
                    Updated {new Date(d.updated_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}. Refreshes itself as new results come in (at most every 6 hours).
                  </p>
                )}
              </>
            ) : (
              <p className="muted" style={{ margin: "6px 0 0" }}>
                Nothing yet.
              </p>
            )}
          </section>

          <section className="card" style={{ marginTop: 14 }}>
            <b>Answer key</b>
            <p style={{ margin: "6px 0 0" }}>
              {d.keyed} call{d.keyed === 1 ? "" : "s"} graded by hand.{" "}
              {d.keyed < d.keyMin ? (
                <span className="muted">
                  At {d.keyMin} or more, every new set of lessons is tested on them first and only goes live if the grader agrees with you at least as often as before. Open any {dept === "openers" ? "opener" : "service"} call and use the Answer key box at the bottom.
                </span>
              ) : (
                <span className="muted">New lessons are tested on these before they go live.</span>
              )}
            </p>
            {d.test?.last_test && <p style={{ margin: "6px 0 0" }}>{d.test.last_test}</p>}
          </section>

          <section className="card" style={{ marginTop: 14 }}>
            <b>
              {w.good} vs {w.bad.toLowerCase()} calls
            </b>
            {d.metrics.length ? (
              <table className="rx-table" style={{ marginTop: 6 }}>
                <thead>
                  <tr>
                    <th>What the grader saw</th>
                    <th className="num">{w.good}</th>
                    <th className="num">{w.bad}</th>
                    <th className="num">Lean</th>
                  </tr>
                </thead>
                <tbody>
                  {d.metrics.map((m) => {
                    const l = lean(m);
                    return (
                      <tr key={`${m.group}|${m.label}`}>
                        <td>
                          <small className="muted">{m.group} · </small>
                          {m.label}
                          {LOWER_IS_BETTER.has(m.label) && <small className="muted"> (lower is better)</small>}
                        </td>
                        <td className="num" title={`${m.nGood} calls`}>
                          {m.good}%
                        </td>
                        <td className="num" title={`${m.nBad} calls`}>
                          {m.bad}%
                        </td>
                        <td className="num">
                          {l === null ? (
                            "–"
                          ) : (
                            <span className="gap">
                              <span className={`gap-bar ${l >= 0 ? "toward" : "away"}`} style={{ width: `${Math.min(100, Math.abs(l))}%` }} />
                              <span className="gap-n">
                                {l >= 0 ? "+" : "−"}
                                {Math.abs(l)}
                              </span>
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <p className="muted" style={{ margin: "6px 0 0" }}>
                Shows once there are at least 3 calls on each side.
              </p>
            )}
          </section>
        </>
      )}
    </main>
  );
}
