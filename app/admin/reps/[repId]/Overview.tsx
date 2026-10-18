"use client";

import { useMemo } from "react";
import { skillAverages, TAG_LABEL } from "@/lib/repHistory";
import { scoreBand } from "@/lib/calls";
import { LineChart } from "../charts";
import type { Ctx } from "./page";

const DAY = 86400000;
const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null);

export default function Overview({ ctx }: { ctx: Ctx }) {
  const { history: h, openTab, people } = ctx;
  const now = Date.now();

  const graded = useMemo(() => h.calls.filter((c) => c.status === "graded"), [h.calls]);
  const real = graded.filter((c) => c.source !== "roleplay");
  const practice = graded.filter((c) => c.source === "roleplay");
  const t = (c: { created_at: string; call_date?: string | null }) => new Date(c.call_date || c.created_at).getTime();
  const last30 = graded.filter((c) => t(c) >= now - 30 * DAY);
  const prev30 = graded.filter((c) => t(c) < now - 30 * DAY && t(c) >= now - 60 * DAY);

  const slpNow = avg(last30.map((c) => c.slp_score).filter((x): x is number => x !== null));
  const slpPrev = avg(prev30.map((c) => c.slp_score).filter((x): x is number => x !== null));
  const scoreNow = avg(last30.filter((c) => c.source !== "roleplay").map((c) => c.score).filter((x): x is number => x !== null));

  const skillsNow = skillAverages(last30);
  const skillsPrev = skillAverages(prev30);
  const skillsAll = skillAverages(graded);
  const skills = [...(skillsNow.size ? skillsNow : skillsAll)].sort((a, b) => a[1].avg - b[1].avg);

  const quizPassRate = h.quizzes.length ? Math.round((100 * h.quizzes.filter((q) => q.passed).length) / h.quizzes.length) : null;
  const latestReview = h.reviews.find((r) => r.status === "done" && r.review);
  const fmt = (x: number) => new Date(x).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  const series = [
    {
      name: "Real calls -- Straight Line",
      color: "var(--live)",
      points: real
        .filter((c) => c.slp_score !== null)
        .map((c) => ({ x: t(c), y: c.slp_score!, label: `${fmt(t(c))} real call: SLP ${c.slp_score}${c.score !== null ? `, script ${c.score}` : ""}`, href: `/admin/calls/${c.id}` })),
    },
    {
      name: "Practice calls -- Straight Line",
      color: "var(--tone)",
      points: practice
        .filter((c) => c.slp_score !== null)
        .map((c) => ({ x: t(c), y: c.slp_score!, label: `${fmt(t(c))} practice (${h.personas.get(c.persona_id || "")?.split(" -- ")[0] ?? "mock"}): SLP ${c.slp_score}`, href: `/admin/calls/${c.id}` })),
    },
  ].filter((s) => s.points.length);

  const delta = (a: number | null, b: number | null) =>
    a === null || b === null ? null : a - b;
  const d = delta(slpNow, slpPrev);

  return (
    <div>
      <div className="rx-tiles">
        <div className="rx-tile">
          <div className="k">Straight Line, 30 days</div>
          <div className="v">{slpNow ?? "--"}</div>
          <div className={`d ${d === null ? "" : d >= 0 ? "rx-up" : "rx-down"}`}>{d === null ? "no earlier month to compare" : `${d >= 0 ? "+" : ""}${d} vs the 30 days before`}</div>
        </div>
        <div className="rx-tile">
          <div className="k">Script score, real calls</div>
          <div className="v">{scoreNow ?? "--"}</div>
          <div className="d">last 30 days</div>
        </div>
        <div className="rx-tile">
          <div className="k">Calls graded</div>
          <div className="v">{real.length}</div>
          <div className="d">{real.filter((c) => t(c) >= now - 30 * DAY).length} in the last 30 days</div>
        </div>
        <div className="rx-tile">
          <div className="k">Practice calls</div>
          <div className="v">{practice.length}</div>
          <div className="d">{practice.filter((c) => t(c) >= now - 30 * DAY).length} in the last 30 days</div>
        </div>
        <div className="rx-tile">
          <div className="k">Knowledge checks</div>
          <div className="v">{quizPassRate === null ? "--" : `${quizPassRate}%`}</div>
          <div className="d">{h.quizzes.length ? `of ${h.quizzes.length} attempts passed` : "none taken"}</div>
        </div>
      </div>

      <div className="rx-grid2">
        <section className="card">
          <h3 className="rx-sec-title">Straight Line score over time</h3>
          {series.length ? (
            <LineChart series={series} fmtX={(x) => fmt(x)} />
          ) : (
            <p className="hint">No graded calls yet. Upload a call on Calls, or have them run a practice call.</p>
          )}
        </section>
        <section className="card">
          <h3 className="rx-sec-title">Skills{skillsNow.size ? ", last 30 days" : ""} -- weakest first</h3>
          {!skills.length ? (
            <p className="hint">Skills show up once calls are graded.</p>
          ) : (
            skills.map(([skill, s]) => {
              const p = skillsPrev.get(skill);
              const dd = p && skillsNow.size ? s.avg - p.avg : null;
              return (
                <div className="rx-skill" key={skill}>
                  <span>
                    {skill} <small className="muted">· {s.n} call{s.n === 1 ? "" : "s"}</small>
                  </span>
                  <span className="bar">
                    <i style={{ width: `${s.avg * 10}%`, background: s.avg < 5 ? "var(--bad)" : s.avg < 7 ? "var(--live)" : "var(--ok)" }} />
                  </span>
                  <span className={`delta ${dd === null ? "" : dd >= 0 ? "rx-up" : "rx-down"}`}>
                    {s.avg.toFixed(1)}
                    {dd !== null && Math.abs(dd) >= 0.5 ? ` ${dd > 0 ? "▲" : "▼"}` : ""}
                  </span>
                </div>
              );
            })
          )}
        </section>
      </div>

      <div className="rx-grid2" style={{ marginTop: 14 }}>
        <section className="card">
          <h3 className="rx-sec-title">Latest coaching review</h3>
          {latestReview?.review ? (
            <>
              <span className={`pill ${latestReview.review.trajectory === "improving" ? "good" : latestReview.review.trajectory === "slipping" ? "poor" : "fair"}`}>
                {latestReview.review.trajectory}
              </span>
              <p style={{ marginBottom: 6 }}>
                <b>{latestReview.review.headline}</b>
              </p>
              <p className="hint" style={{ marginTop: 0 }}>
                {new Date(latestReview.created_at).toLocaleDateString()} ·{" "}
                {latestReview.review.focus_next.map((f) => f.skill).join(", ")}
              </p>
              <button className="tr-sm" onClick={() => openTab("review")}>
                Open it
              </button>
            </>
          ) : (
            <>
              <p className="hint">No review yet. It reads every call, KPI report, note and file on record and writes the overall arc.</p>
              <button className="primary" onClick={() => openTab("review")}>
                Run the first one
              </button>
            </>
          )}
        </section>
        <section className="card">
          <h3 className="rx-sec-title">Recent notes</h3>
          {!h.notes.length ? (
            <p className="hint">Nothing yet.</p>
          ) : (
            h.notes.slice(0, 3).map((n) => (
              <div key={n.id} style={{ marginBottom: 10 }}>
                <span className={`rx-kind ${n.tag === "concern" ? "concern" : "note"}`}>{TAG_LABEL[n.tag]}</span>
                <small className="muted">
                  {n.note_date} · {people.get(n.author_id || "") ?? "someone"}
                </small>
                <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.45 }}>{n.body.length > 220 ? `${n.body.slice(0, 220)}…` : n.body}</div>
              </div>
            ))
          )}
          <button className="tr-sm" onClick={() => openTab("notes")}>
            Add anything
          </button>
        </section>
      </div>
      {real.length > 0 && (
        <p className="hint">
          Last real call scored{" "}
          <span className={`pill ${scoreBand(real[0].slp_score)}`}>SLP {real[0].slp_score ?? "--"}</span> on{" "}
          {new Date(t(real[0])).toLocaleDateString()}.
        </p>
      )}
    </div>
  );
}
