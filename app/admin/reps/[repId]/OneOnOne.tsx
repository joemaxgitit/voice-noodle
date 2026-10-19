"use client";

import { useEffect, useMemo, useState } from "react";
import { compareRep, fmtChange, fmtMonth, highlights, monthlyReports, type KpiRow } from "@/lib/kpi";
import type { Commitment, CoachingSession, CoachingTopic, SessionDraft } from "@/lib/coaching";
import { CARD_KIND } from "@/lib/cards";
import { okToSpend, usd, useEstimate } from "@/lib/spend";
import { today } from "@/lib/training";
import type { Ctx } from "./page";

const STATUS_LABEL: Record<Commitment["status"], string> = { open: "Open", kept: "Kept", missed: "Not yet" };
const NEXT: Record<Commitment["status"], Commitment["status"]> = { open: "kept", kept: "missed", missed: "open" };

const fmtDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

/**
 * The one-on-one: what was said last time and whether it stuck, a minute of
 * prep, then a few quick notes that Claude tidies and sorts into topics.
 * The coaching itself happens in the room; this keeps it from being lost.
 */
export default function OneOnOne({ ctx }: { ctx: Ctx }) {
  const { supabase, orgId, me, repId, repName, history: h, people, reload, seedCard } = ctx;
  const first = repName.split(" ")[0];
  const [topics, setTopics] = useState<CoachingTopic[]>([]);
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState(today());
  const [draft, setDraft] = useState<SessionDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [saved, setSaved] = useState<CoachingSession | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [personal, setPersonal] = useState(false);
  const est = useEstimate(supabase, "coaching");

  useEffect(() => {
    void supabase
      .from("coaching_topics")
      .select("*")
      .eq("archived", false)
      .order("sort_order")
      .then(({ data, error }) => {
        if (error) setError(/coaching_|does not exist/i.test(error.message) ? `${error.message} -- run supabase/coaching.sql first.` : error.message);
        setTopics((data || []) as CoachingTopic[]);
      });
  }, [supabase]);

  const last = h.sessions[0] ?? null;

  // Since the last one-on-one: practice and real calls, cards, the latest KPI moves.
  const since = useMemo(() => {
    const from = last ? new Date(`${last.session_date}T00:00:00`).getTime() : Date.now() - 30 * 86400000;
    const graded = h.calls.filter((c) => c.status === "graded" && c.slp_score !== null);
    const after = graded.filter((c) => new Date(c.call_date || c.created_at).getTime() >= from);
    const before = graded.filter((c) => new Date(c.call_date || c.created_at).getTime() < from).slice(0, 10);
    const avg = (xs: typeof graded) => (xs.length ? Math.round(xs.reduce((s, c) => s + (c.slp_score ?? 0), 0) / xs.length) : null);
    const rowsByReport = new Map<string, KpiRow[]>();
    for (const r of h.kpiRows) rowsByReport.set(r.report_id, [...(rowsByReport.get(r.report_id) ?? []), r]);
    const kpi: { month: string; good: string[]; bad: string[] } = { month: "", good: [], bad: [] };
    for (const [, byMonth] of monthlyReports(h.kpiReports)) {
      const months = [...byMonth.keys()].sort().filter((m) => (rowsByReport.get(byMonth.get(m)!.id) ?? []).some((r) => r.rep_id === repId));
      if (months.length < 2) continue;
      const cur = byMonth.get(months.at(-1)!)!;
      const prev = byMonth.get(months.at(-2)!)!;
      const hl = highlights(compareRep({ repId, cur, prev, curRows: rowsByReport.get(cur.id) ?? [], prevRows: rowsByReport.get(prev.id) ?? [], prefs: h.prefs }));
      kpi.month = months.at(-1)!;
      kpi.good.push(...hl.good.slice(0, 3).map((m) => `${m.label} ${fmtChange(m)}`));
      kpi.bad.push(...hl.bad.slice(0, 3).map((m) => `${m.label} ${fmtChange(m)}`));
    }
    const days = h.daily.filter((d) => new Date(`${d.day}T12:00:00`).getTime() >= from);
    const rotation = days.length ? { made: days.filter((d) => d.override_made ?? d.made).length, n: days.length, missed: days.filter((d) => !(d.override_made ?? d.made)).map((d) => d.day) } : null;
    return {
      rotation,
      real: after.filter((c) => c.source !== "roleplay").length,
      practice: after.filter((c) => c.source === "roleplay").length,
      slp: avg(after),
      slpBefore: avg(before),
      openCards: h.cards.filter((c) => c.status === "sent"),
      kpi: kpi.month ? kpi : null,
    };
  }, [h, last, repId]);

  async function tidy() {
    if (!notes.trim()) return;
    if (!(await okToSpend(supabase, est ?? 0, "Tidying these notes"))) return;
    setBusy(true);
    setError("");
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const res = await fetch("/api/coaching/tidy", {
      method: "POST",
      headers: { Authorization: `Bearer ${session?.access_token ?? ""}`, "Content-Type": "application/json" },
      body: JSON.stringify({ repId, notes }),
    }).catch((e) => e as Error);
    setBusy(false);
    if (res instanceof Error) return setError(res.message);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setError(body?.error || `Failed (${res.status}).`);
    setDraft(body.draft as SessionDraft);
  }

  async function save(d: SessionDraft | null) {
    setBusy(true);
    setError("");
    const row = {
      org_id: orgId,
      rep_id: repId,
      manager_id: me,
      session_date: date,
      raw_notes: notes.trim(),
      summary: d?.summary?.trim() || null,
      topics: d?.topics ?? [],
      commitments: (d?.commitments ?? []).map((t) => t.trim()).filter(Boolean).map((text) => ({ text, status: "open" as const })),
      follow_up: d?.follow_up?.trim() || null,
      ...(personal ? { private: true } : {}),
    };
    const { data, error } = await supabase.from("coaching_sessions").insert(row).select("*").single();
    setBusy(false);
    if (error) return setError(error.message);
    setSaved(data as CoachingSession);
    setDraft(null);
    setNotes("");
    setDate(today());
    setPersonal(false);
    setStatus("Saved. It'll open the next one-on-one with " + first + ".");
    await reload();
  }

  async function setCommitment(s: CoachingSession, i: number) {
    const list = s.commitments.map((c, j) => (j === i ? { ...c, status: NEXT[c.status] } : c));
    const { error } = await supabase.from("coaching_sessions").update({ commitments: list, updated_at: new Date().toISOString() }).eq("id", s.id);
    if (error) return setError(error.message);
    await reload();
  }

  async function remove(s: CoachingSession) {
    if (!confirm(`Delete the one-on-one from ${fmtDay(s.session_date)}?`)) return;
    await supabase.from("coaching_sessions").delete().eq("id", s.id);
    await reload();
  }

  const sessionCard = (s: CoachingSession, big: boolean) => (
    <div key={s.id} className={big ? "card" : "rx-note"} style={big ? { borderLeft: "4px solid var(--live)" } : undefined}>
      <div className="rx-head" style={{ alignItems: "baseline" }}>
        <div>
          {big && (
            <div className="eyebrow" style={{ margin: 0 }}>
              Last one-on-one
            </div>
          )}
          <b>{fmtDay(s.session_date)}</b> <span className="muted">· {people.get(s.manager_id || "") ?? "a manager"}</span>
          {s.private && <span className="muted" title="Personal: never used by Claude"> · personal, not used by AI</span>}
        </div>
        {!big && (
          <button className="link-btn" onClick={() => void remove(s)}>
            Delete
          </button>
        )}
      </div>
      {s.topics.length > 0 && (
        <div className="rx-tags" style={{ margin: "6px 0" }}>
          {s.topics.map((t) => (
            <span key={t} className="pill">
              {t}
            </span>
          ))}
        </div>
      )}
      <p style={{ margin: "6px 0", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{s.summary || s.raw_notes}</p>
      {s.commitments.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div className="rx-sec-title" style={{ marginBottom: 4 }}>
            Commitments {big && <span className="hint" style={{ textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>-- tap to mark</span>}
          </div>
          {s.commitments.map((c, i) => (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 0" }}>
              <button
                className={`pill ${c.status === "kept" ? "good" : c.status === "missed" ? "poor" : ""}`}
                style={{ cursor: "pointer", background: "none", minWidth: 70 }}
                onClick={() => void setCommitment(s, i)}
                title="Open → Kept → Not yet"
              >
                {STATUS_LABEL[c.status]}
              </button>
              <span>{c.text}</span>
            </div>
          ))}
        </div>
      )}
      {s.follow_up && big && (
        <p className="hint" style={{ marginBottom: 0 }}>
          <b>Check today:</b> {s.follow_up}
        </p>
      )}
      {big && s.raw_notes && s.summary && (
        <details style={{ marginTop: 6 }}>
          <summary className="hint" style={{ cursor: "pointer" }}>
            Original notes
          </summary>
          <p style={{ whiteSpace: "pre-wrap", margin: "6px 0 0" }}>{s.raw_notes}</p>
        </details>
      )}
    </div>
  );

  return (
    <div>
      {error && <div className="error">{error}</div>}
      {status && <div className="status">{status}</div>}

      <div className="rx-grid2" style={{ alignItems: "start" }}>
        <div>{last ? sessionCard(last, true) : <div className="card"><p style={{ margin: 0 }}>No one-on-ones on record with {first} yet. After this one, it&rsquo;ll be here every time you sit down together.</p></div>}</div>

        <section className="card">
          <h3 className="rx-sec-title">Since {last ? fmtDay(last.session_date) : "the last 30 days"}</h3>
          <ul className="plain-list" style={{ margin: 0 }}>
            <li>
              {since.real} real call{since.real === 1 ? "" : "s"} and {since.practice} practice call{since.practice === 1 ? "" : "s"} graded
              {since.slp !== null && (
                <>
                  {" "}
                  &middot; Straight Line <b>{since.slp}</b>
                  {since.slpBefore !== null && (
                    <span className={since.slp - since.slpBefore >= 0 ? "rx-up" : "rx-down"}>
                      {" "}
                      ({since.slp - since.slpBefore >= 0 ? "+" : ""}
                      {since.slp - since.slpBefore} vs before)
                    </span>
                  )}
                </>
              )}
            </li>
            {since.rotation && (
              <li>
                Rotation: made it <b>{since.rotation.made} of {since.rotation.n}</b> days
                {since.rotation.missed.length > 0 && (
                  <span className="muted">
                    {" "}
                    &middot; missed {since.rotation.missed.slice(0, 4).map((d) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: "short" })).join(", ")}
                    {since.rotation.missed.length > 4 ? "…" : ""}
                  </span>
                )}
              </li>
            )}
            {since.openCards.map((c) => (
              <li key={c.id}>
                Open {CARD_KIND[c.kind as keyof typeof CARD_KIND]?.label.toLowerCase() ?? "card"}: <b>{c.skill}</b> &middot;{" "}
                {c.practiced ? `practiced ${c.practiced}×` : "not practiced yet"}
                {c.rep_response === "disagree" ? " · sees it differently" : c.rep_response === "question" ? " · has a question" : ""}
              </li>
            ))}
            {since.kpi && (
              <li>
                KPIs, {fmtMonth(since.kpi.month)}:{" "}
                {since.kpi.good.length ? <span className="rx-up">{since.kpi.good.join(", ")}</span> : null}
                {since.kpi.good.length && since.kpi.bad.length ? " · " : ""}
                {since.kpi.bad.length ? <span className="rx-down">{since.kpi.bad.join(", ")}</span> : null}
                {!since.kpi.good.length && !since.kpi.bad.length ? "no big moves" : ""}
              </li>
            )}
          </ul>
        </section>
      </div>

      <section className="card" style={{ marginTop: 14 }}>
        <h3 className="rx-sec-title">Today&rsquo;s one-on-one</h3>
        {!draft ? (
          <>
            <textarea
              rows={5}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={`Quick notes, however they come out -- e.g. "state check, rough week, sleeping bad. went over 2 cancelled files, skipping pre-flight. agreed: review lead notes before every call, 3 practice calls this week"`}
              style={{ width: "100%" }}
            />
            <div className="rx-actions" style={{ marginTop: 8 }}>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" style={{ width: "auto" }} />
              <label className="hint" style={{ display: "inline-flex", gap: 6, alignItems: "center", margin: 0 }} title="Personal details -- every manager can see it, but it's never used by Claude">
                <input type="checkbox" checked={personal} onChange={(e) => setPersonal(e.target.checked)} style={{ width: "auto" }} /> Personal -- keep out of AI
              </label>
              {!personal && (
                <button className="primary" disabled={busy || !notes.trim()} onClick={() => void tidy()}>
                  {busy ? "Sorting…" : `Tidy and sort${est !== null ? ` · about ${usd(est)}` : ""}`}
                </button>
              )}
              <button className={personal ? "primary" : ""} disabled={busy || !notes.trim()} onClick={() => void save(null)}>
                {personal ? "Save personal note" : "Save as is"}
              </button>
            </div>
            {personal ? (
              <p className="hint" style={{ marginBottom: 0 }}>
                Personal: saved as you wrote it so you remember the details. Every manager can see it, but it&rsquo;s never sent to Claude -- not tidied, not tagged, and never used in reviews, cards or trends.
              </p>
            ) : (
            <p className="hint" style={{ marginBottom: 0 }}>
              Claude writes a short summary, pulls out what was agreed, and tags the topics ({topics.map((t) => t.name).join(", ") || "loading…"}). You check it before it&rsquo;s saved.
            </p>
            )}
          </>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            <label className="field" style={{ margin: 0 }}>
              <span className="label">Summary</span>
              <textarea rows={3} value={draft.summary} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} />
            </label>
            <div>
              <span className="label">Topics -- tap to change</span>
              <div className="rx-tags">
                {topics.map((t) => {
                  const on = draft.topics.includes(t.name);
                  return (
                    <button
                      key={t.id}
                      className={on ? "on" : ""}
                      aria-pressed={on}
                      onClick={() => setDraft({ ...draft, topics: on ? draft.topics.filter((x) => x !== t.name) : [...draft.topics, t.name] })}
                    >
                      {t.name}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <span className="label">Commitments</span>
              {draft.commitments.map((c, i) => (
                <div key={i} style={{ display: "flex", gap: 6, marginTop: 6 }}>
                  <input value={c} onChange={(e) => setDraft({ ...draft, commitments: draft.commitments.map((x, j) => (j === i ? e.target.value : x)) })} />
                  <button className="tr-sm" aria-label="Remove" onClick={() => setDraft({ ...draft, commitments: draft.commitments.filter((_, j) => j !== i) })}>
                    &times;
                  </button>
                </div>
              ))}
              <button className="link-btn" style={{ marginTop: 6 }} onClick={() => setDraft({ ...draft, commitments: [...draft.commitments, ""] })}>
                + Add one
              </button>
            </div>
            <label className="field" style={{ margin: 0 }}>
              <span className="label">Check next time</span>
              <input value={draft.follow_up} onChange={(e) => setDraft({ ...draft, follow_up: e.target.value })} />
            </label>
            <div className="rx-actions">
              <button className="primary" disabled={busy} onClick={() => void save(draft)}>
                {busy ? "Saving…" : "Save one-on-one"}
              </button>
              <button disabled={busy} onClick={() => setDraft(null)}>
                Back to notes
              </button>
            </div>
          </div>
        )}
        {saved && saved.commitments.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <span className="hint">Turn a commitment into a training card {first} sees on their home screen:</span>
            <div className="rx-tags">
              {saved.commitments.map((c, i) => (
                <button key={i} onClick={() => seedCard(c.text, null)}>
                  Card: {c.text.length > 40 ? `${c.text.slice(0, 40)}…` : c.text}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {h.sessions.length > 1 && (
        <section style={{ marginTop: 18 }}>
          <h3 className="rx-sec-title">Earlier one-on-ones ({h.sessions.length - 1})</h3>
          {(showAll ? h.sessions.slice(1) : h.sessions.slice(1, 6)).map((s) => sessionCard(s, false))}
          {!showAll && h.sessions.length > 6 && (
            <button className="link-btn" onClick={() => setShowAll(true)}>
              Show all
            </button>
          )}
        </section>
      )}
    </div>
  );
}
