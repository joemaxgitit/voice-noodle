"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { okToSpend, usd, useEstimate } from "@/lib/spend";
import { fmtTime, type DayReview } from "@/lib/dayReview";
import type { Ctx } from "./page";

const localDay = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const nice = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

/** One day of the rep's calls, read together against their best call -- for a bad day. */
export default function DayReviews({ ctx }: { ctx: Ctx }) {
  const { supabase, repId, repName, history: h, reload } = ctx;
  const [day, setDay] = useState(localDay);
  const [focus, setFocus] = useState("");
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const est = useEstimate(supabase, "review");
  const working = h.dayReviews.find((r) => r.status === "working" && Date.now() - new Date(r.created_at).getTime() < 10 * 60000);
  const shown = h.dayReviews.find((r) => r.id === openId) ?? h.dayReviews.find((r) => r.status !== "working");

  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => void reload(), 4000);
    return () => clearInterval(t);
  }, [working, reload]);

  async function run() {
    if (!(await okToSpend(supabase, est ?? 0, "This day review"))) return;
    setStarting(true);
    setError("");
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    const res = await fetch("/api/reps/day-review", { method: "POST", headers: { Authorization: `Bearer ${token ?? ""}`, "Content-Type": "application/json" }, body: JSON.stringify({ repId, day, focus }) }).catch((e) => e as Error);
    setStarting(false);
    if (res instanceof Error) return setError(res.message);
    if (!res.ok) return setError((await res.json().catch(() => ({})))?.error || `Request failed (${res.status}).`);
    setOpenId(null);
    setFocus("");
    await reload();
  }

  const v = shown?.status === "done" ? (shown.review as unknown as DayReview | null) : null;

  return (
    <div style={{ marginBottom: 22 }}>
      <section className="card rx-noprint">
        <h3 className="rx-sec-title">Review one day</h3>
        <p className="hint" style={{ marginTop: 0 }}>
          For a bad day: every call {repName.split(" ")[0]} made on that date -- full calls, voicemails and short calls, in order -- read together against their own best call. Where the deals
          slipped, how the opening held up, and their mood through the day. Upload the day&rsquo;s calls first (Call review &rarr; A whole day).
        </p>
        <div className="row" style={{ gap: 10, alignItems: "end", flexWrap: "wrap" }}>
          <label className="field" style={{ margin: 0 }}>
            <span className="label">Day</span>
            <input type="date" value={day} max={localDay()} onChange={(e) => setDay(e.target.value)} style={{ width: "auto" }} />
          </label>
          <label className="field" style={{ margin: 0, flex: "1 1 240px" }}>
            <span className="label">Anything to look at especially? (optional)</span>
            <input value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="e.g. why nothing closed after lunch" />
          </label>
          <button className="primary" disabled={starting || !!working || !day} onClick={() => void run()}>
            {working ? "Reading the day…" : starting ? "Starting…" : `Review ${day === localDay() ? "today" : nice(day)}${est !== null ? ` · about ${usd(est)}` : ""}`}
          </button>
        </div>
        {error && <div className="error">{error}</div>}
      </section>

      {working && (
        <div className="card rx-working" style={{ marginTop: 14 }}>
          <span className="rx-spin" aria-hidden="true" />
          <span>Reading {working.period_from ? nice(working.period_from) : "the day"}&rsquo;s calls against the best one. Takes a minute.</span>
        </div>
      )}

      {shown?.status === "failed" && <div className="error" style={{ marginTop: 14 }}>That day review failed: {shown.error}</div>}

      {v && shown && (
        <div className="rx-review" style={{ marginTop: 14 }}>
          <div className="rx-verdict">
            <span className="badge mixed">{nice(v.day)}</span>
            <div>
              <div className="headline">{v.headline}</div>
              <p>{v.story}</p>
              <p className="hint" style={{ marginTop: 8 }}>
                {shown.inputs?.calls ?? 0} full call{shown.inputs?.calls === 1 ? "" : "s"}, {shown.inputs?.quick ?? 0} voicemail{shown.inputs?.quick === 1 ? "" : "s"} and short calls
                {shown.focus ? ` · focus: ${shown.focus}` : ""}
              </p>
            </div>
          </div>

          <div className="rx-grid2">
            <section className="card">
              <h3 className="rx-sec-title">Mood through the day</h3>
              <p style={{ margin: 0, lineHeight: 1.55 }}>{v.mood}</p>
            </section>
            <section className="card">
              <h3 className="rx-sec-title">The opening</h3>
              <p style={{ margin: 0, lineHeight: 1.55 }}>{v.opening || "No short calls or hang-ups to read the opening from."}</p>
            </section>
          </div>

          <section className="card">
            <h3 className="rx-sec-title" style={{ color: "var(--bad)" }}>
              Where the deals slipped
            </h3>
            {!v.slipping.length && <p className="hint">Nothing clear.</p>}
            {v.slipping.map((t, i) => (
              <div key={i} className="rx-trend bad">
                <b>{t.title}</b>
                <p className="ev">{t.evidence}</p>
                <p>
                  <b style={{ display: "inline" }}>On their best call: </b>
                  {t.vs_best}
                </p>
                <p>
                  <b style={{ display: "inline" }}>Fix: </b>
                  {t.fix}
                </p>
              </div>
            ))}
          </section>

          <section className="card">
            <h3 className="rx-sec-title">Call by call</h3>
            <table className="rx-table">
              <tbody>
                {v.calls.map((c) => {
                  const line = v.per_call.find((p) => p.n === c.n)?.line;
                  return (
                    <tr key={c.n}>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <Link href={`/admin/calls/${c.id}`}>
                          #{c.n} {c.time ? fmtTime(c.time) : ""}
                        </Link>
                      </td>
                      <td style={{ whiteSpace: "nowrap" }} className="muted">
                        {c.what}
                      </td>
                      <td>{line ?? ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          <div className="rx-grid2">
            <section className="card">
              <h3 className="rx-sec-title">Before the next shift</h3>
              {v.coach_now.map((f, i) => (
                <div key={i} className="rx-trend focus">
                  <b>
                    {i + 1}. {f.skill}
                  </b>
                  <p>
                    <b style={{ display: "inline" }}>Drill: </b>
                    {f.drill}
                  </p>
                  <button className="tr-sm rx-noprint" onClick={() => ctx.seedCard(`${f.skill}. Drill: ${f.drill}`, null)}>
                    Make a training card from this
                  </button>
                </div>
              ))}
            </section>
            <section className="card">
              <h3 className="rx-sec-title">Questions to ask</h3>
              <ul className="plain-list">
                {v.questions_to_ask.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </section>
          </div>
          <div className="rx-noprint">
            <button onClick={() => window.print()}>Print</button>
          </div>
        </div>
      )}

      {h.dayReviews.length > 1 && (
        <details style={{ marginTop: 12 }} className="rx-noprint">
          <summary className="hint" style={{ cursor: "pointer" }}>
            Earlier day reviews ({h.dayReviews.length})
          </summary>
          <table className="rx-table">
            <tbody>
              {h.dayReviews.map((r) => (
                <tr key={r.id} className="link" onClick={() => setOpenId(r.id)} style={r.id === shown?.id ? { background: "var(--ink-2)" } : undefined}>
                  <td style={{ whiteSpace: "nowrap" }}>{r.period_from ? nice(r.period_from) : ""}</td>
                  <td>{r.status === "done" ? (r.review as unknown as DayReview | null)?.headline : r.status === "working" ? "Reading…" : `Failed: ${r.error ?? ""}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}
