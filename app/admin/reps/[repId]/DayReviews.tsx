"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { okToSpend, usd, useEstimate } from "@/lib/spend";
import { fmtTime, secsOf, type DayNeed, type DayReview } from "@/lib/dayReview";
import { OUTCOME_LABEL, type Outcome } from "@/lib/calls";
import { FOCUS_CHECKS } from "@/lib/coachFocus";
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

      {v && shown && <DayView v={v} shown={shown} ctx={ctx} />}

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

type Shown = Ctx["history"]["dayReviews"][number];

/** A call moment: "#6 10:05 AM · 40:12" -- opens that call at that moment and plays it. */
function Moment({ v, n, at }: { v: DayReview; n: number; at?: string }) {
  const c = v.calls.find((x) => x.n === n);
  if (!c) return null;
  const t = secsOf(at);
  return (
    <Link href={`/admin/calls/${c.id}${t !== null ? `?t=${t}` : ""}`} className="dr-moment">
      &#9654; {c.time ? `${fmtTime(c.time)} call` : `Call #${n}`}
      {at ? `, ${at} in` : ""}
    </Link>
  );
}

/** The top of a day review: the day in numbers, then the two coaching needs, each ready to coach. */
function DayView({ v, shown, ctx }: { v: DayReview; shown: Shown; ctx: Ctx }) {
  const first = ctx.repName.split(" ")[0];
  const [regraded, setRegraded] = useState(0);
  useEffect(() => {
    if (!v.graded_through) return;
    void ctx.supabase
      .from("calls")
      .select("id, graded_at:grade->>graded_at")
      .in("id", v.calls.map((c) => c.id))
      .then(({ data }) => setRegraded(((data || []) as { graded_at: string | null }[]).filter((r) => r.graded_at && r.graded_at > v.graded_through!).length));
  }, [ctx.supabase, v]);
  const sc = v.score;
  const tile = (k: string, val: ReactNode) => (
    <div className="rx-tile">
      <div className="k">{k}</div>
      <div className="v">{val}</div>
    </div>
  );
  return (
    <div className="rx-review dr-print" style={{ marginTop: 14 }}>
      <div className="rx-verdict">
        <span className="badge mixed">{nice(v.day)}</span>
        <div>
          <div className="headline">{v.headline}</div>
          {shown.focus ? <p className="hint">Focus: {shown.focus}</p> : null}
        </div>
      </div>
      {sc && (
        <div className="rx-tiles">
          {tile("Contacts", sc.contacts)}
          {tile("Full calls", sc.full)}
          {tile("Voicemails / short", `${sc.voicemail} / ${sc.short}`)}
          {tile("Enrolled", sc.enrolled)}
          {tile("Callbacks set", sc.callbacks)}
          {tile("Furthest stage", sc.furthest || "--")}
        </div>
      )}
      {regraded > 0 && (
        <div className="note rx-noprint">
          {regraded} of these calls {regraded === 1 ? "was" : "were"} re-graded on newer grading rules since this review was written. Run the day again (above) to read the new grades.
        </div>
      )}

      {(v.needs?.length ?? 0) > 0 && (
        <>
          <h3 className="rx-sec-title" style={{ marginTop: 16 }}>
            Coach first {v.needs!.length > 1 ? "\u2014 pick one" : ""}
          </h3>
          <div className="rx-grid2">
            {v.needs!.map((nd, i) => (
              <NeedCard key={i} i={i} nd={nd} v={v} ctx={ctx} first={first} />
            ))}
          </div>
          {v.needs!.length === 1 && <p className="hint">Only one need had clear evidence today.</p>}
        </>
      )}

      {v.strength?.text && (
        <section className="card" style={{ borderColor: "var(--ok)" }}>
          <h3 className="rx-sec-title" style={{ color: "var(--ok)" }}>Protect this strength</h3>
          <p style={{ margin: 0 }}>
            {v.strength.text} {v.strength.n ? <Moment v={v} n={v.strength.n} at={v.strength.at} /> : null}
          </p>
        </section>
      )}

      {v.slipping.length > 0 && (
        <section className="card">
          <h3 className="rx-sec-title" style={{ color: "var(--bad)" }}>
            {v.needs ? "Other places deals slipped" : "Where the deals slipped"}
          </h3>
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
      )}

      <section className="card">
        <h3 className="rx-sec-title">The day, call by call</h3>
        <table className="rx-table">
          <tbody>
            {v.calls.map((c) => {
              const line = v.per_call.find((p) => p.n === c.n)?.line;
              const kind = c.kind === "voicemail" ? `Voicemail \u00b7 ${c.what.replace(/^voicemail\s*/i, "message score ")}` : c.kind === "short" ? `Short call \u00b7 ${c.what}` : c.kind === "full" ? `${c.outcome ? OUTCOME_LABEL[c.outcome as Outcome] ?? c.outcome : "Call"} \u00b7 SLP ${c.slp ?? "--"}` : c.what;
              return (
                <tr key={c.n}>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <Link href={`/admin/calls/${c.id}`}>{c.time ? fmtTime(c.time) : `Call #${c.n}`}</Link>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }} className="muted">
                    {kind}
                  </td>
                  <td>{line ?? ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="hint" style={{ marginBottom: 0 }}>
          Times are when each call started. A clip&rsquo;s &ldquo;12:30 in&rdquo; is how far into that call. Voicemail scores rate the message left, not a sales call -- they aren&rsquo;t on the same scale as SLP.
        </p>
      </section>

      <details className="fold">
        <summary>
          <span className="fold-title">More from the day</span>
          <span className="fold-preview">how the day went, mood, the opening, drills and questions</span>
        </summary>
        <div className="fold-body">
          {v.story && (
            <section className="card">
              <h3 className="rx-sec-title">How the day went</h3>
              <p style={{ margin: 0, lineHeight: 1.55 }}>{v.story}</p>
            </section>
          )}
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
        </div>
      </details>
      <div className="rx-noprint" style={{ marginTop: 10 }}>
        <button
          onClick={() => {
            // Paper gets this one review, opened up -- nothing else on the page.
            document.querySelectorAll<HTMLDetailsElement>(".dr-print details").forEach((d) => (d.open = true));
            window.print();
          }}
        >
          Print this day review
        </button>
      </div>
      <style>{`
        .dr-moment { display: inline-block; font-size: 13px; font-weight: 600; margin-right: 8px; white-space: nowrap; }
        .dr-need .lbl { display: block; font-size: 12px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); margin-top: 10px; }
        .dr-need.first { border-color: var(--live); }
        @media print {
          body * { visibility: hidden; }
          .dr-print, .dr-print * { visibility: visible; }
          .dr-print { position: absolute; left: 0; top: 0; width: 100%; }
        }
      `}</style>
    </div>
  );
}

/** One of the day's two coaching needs: the moments that prove it, the fix, the drill, the check, a question -- and Coach this. */
function NeedCard({ i, nd, v, ctx, first }: { i: number; nd: DayNeed; v: DayReview; ctx: Ctx; first: string }) {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  async function coach() {
    setBusy(true);
    setMsg("");
    const callId = v.calls.find((c) => c.n === nd.moments[0]?.n)?.id ?? null;
    const { data: act } = await ctx.supabase.from("coaching_focus").select("id").eq("rep_id", ctx.repId).eq("status", "active");
    for (const a of (act || []) as { id: string }[]) await ctx.supabase.from("coaching_focus").update({ status: "replaced", finished_at: new Date().toISOString() }).eq("id", a.id);
    const d = new Date();
    const z = (n: number) => String(n).padStart(2, "0");
    const { error } = await ctx.supabase.from("coaching_focus").insert({
      org_id: ctx.orgId,
      rep_id: ctx.repId,
      call_id: callId,
      skill: nd.title,
      title: nd.title,
      next_call: nd.coach || null,
      drill: nd.drill || null,
      check_for: nd.check || null,
      shared: false,
      started_local: `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`,
    });
    setBusy(false);
    setMsg(error ? (/coaching_focus/.test(error.message) ? "Run supabase/coaching_focus.sql first." : error.message) : `Tracking it on the next ${FOCUS_CHECKS} calls ${first} makes. Send it to ${first}'s home page from the call page if you want.`);
  }
  return (
    <section className={`card dr-need${i === 0 ? " first" : ""}`} style={{ margin: 0 }}>
      <small className="muted">#{i + 1}</small>
      <div style={{ fontSize: 17, fontWeight: 700, margin: "2px 0 4px" }}>{nd.title}</div>
      {nd.why && <small className="muted">{nd.why}</small>}
      {nd.moments.length > 0 && (
        <>
          <span className="lbl">Hear it</span>
          {nd.moments.map((m, k) => (
            <div key={k} style={{ margin: "2px 0" }}>
              <Moment v={v} n={m.n} at={m.at} /> <span>{m.note}</span>
            </div>
          ))}
        </>
      )}
      <span className="lbl">Coach</span>
      <b>{nd.coach}</b>
      {nd.drill && (
        <>
          <span className="lbl">Practice</span>
          {nd.drill}
        </>
      )}
      {nd.check && (
        <>
          <span className="lbl">How you&rsquo;ll know it worked</span>
          {nd.check}
        </>
      )}
      {nd.ask && (
        <>
          <span className="lbl">Ask {first}</span>
          &ldquo;{nd.ask}&rdquo;
        </>
      )}
      <div className="rx-noprint" style={{ marginTop: 10 }}>
        <button className="primary" disabled={busy} onClick={() => void coach()}>
          Coach this
        </button>
        {msg && <small className="muted" style={{ display: "block", marginTop: 6 }}>{msg}</small>}
      </div>
    </section>
  );
}
