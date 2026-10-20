"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { asProven, compare, favouring, formatValue, MIN_FOR_FINDINGS, type InsightCall, type Metric } from "@/lib/insights";
import "../calls.css";
import "../../reps/reps.css";

type Correction = {
  id: string;
  call_id: string;
  item_kind: string;
  item_label: string | null;
  original: string;
  correction: string;
  created_at: string;
};

function Gap({ m }: { m: Metric }) {
  const f = favouring(m);
  if (f === null) return <span className="muted">&ndash;</span>;
  const w = Math.min(100, Math.abs(f));
  return (
    <span className="gap">
      <span className={`gap-bar ${f >= 0 ? "toward" : "away"}`} style={{ width: `${w}%` }} />
      <span className="gap-n">
        {f >= 0 ? "+" : "−"}
        {Math.abs(Math.round(f))}
      </span>
    </span>
  );
}

/**
 * Insights & tuning: what separates graduates' enrollment calls from cancels,
 * the lessons a manager approved from that, and every correction managers
 * have made to a grade. Lessons and corrections both feed every future grade.
 */
export default function Insights() {
  const supabase = createClient();
  const [calls, setCalls] = useState<InsightCall[]>([]);
  const [fixes, setFixes] = useState<Correction[]>([]);
  const [saved, setSaved] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  // Spotlights vs results: does time in hardship and the turndown pickup line up with enrollments on real calls?
  const [spot, setSpot] = useState<{ outcome: string | null; manual: string | null; hs: number | null; pickup: string | null; even: string | null }[]>([]);

  const load = useCallback(async () => {
    const [c, f, g] = await Promise.all([
      supabase
        .from("calls")
        .select("id, retention, score, slp_score, grade")
        .in("retention", ["graduated", "paid6", "cancelled"])
        .not("grade", "is", null)
        .order("created_at", { ascending: false })
        .limit(400),
      supabase
        .from("call_corrections")
        .select("id, call_id, item_kind, item_label, original, correction, created_at")
        .order("created_at", { ascending: false })
        .limit(200),
      supabase.from("grading_guidance").select("lessons").maybeSingle(),
    ]);
    if (c.error) setError(c.error.message);
    else if (f.error) setError(`${f.error.message} -- has the calls-learning SQL been run?`);
    // "Made 6+ payments" counts as a proven sale, the same as graduated.
    setCalls(asProven((c.data || []) as unknown as (InsightCall & { retention: string })[]) as InsightCall[]);
    setFixes((f.data || []) as Correction[]);
    const lessons = (g.data?.lessons as string | null) ?? "";
    setSaved(lessons);
    setDraft(lessons);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void load();
    void supabase
      .from("calls")
      .select("outcome, outcome_manual, hs:grade->spotlights->hardship->moved_on_at, pickup:grade->spotlights->turndown->>pickup, even:grade->spotlights->turndown->>options_even")
      .neq("source", "roleplay")
      .eq("status", "graded")
      .not("grade->spotlights", "is", null)
      .order("created_at", { ascending: false })
      .limit(1000)
      .then(({ data }) => setSpot(((data || []) as { outcome: string | null; outcome_manual: string | null; hs: number | null; pickup: string | null; even: string | null }[]).map((x) => ({ ...x, manual: x.outcome_manual }))));
  }, [load, supabase]);

  const nG = calls.filter((c) => c.retention === "graduated").length;
  const nC = calls.filter((c) => c.retention === "cancelled").length;
  const metrics = useMemo(() => compare(calls), [calls]);
  const top = useMemo(
    () =>
      metrics
        .filter((m) => m.gap !== null && m.nGraduated > 0 && m.nCancelled > 0)
        .sort((a, b) => Math.abs(favouring(b) ?? 0) - Math.abs(favouring(a) ?? 0))
        .slice(0, 6),
    [metrics]
  );
  const groups = useMemo(() => {
    const by = new Map<string, Metric[]>();
    for (const m of metrics) by.set(m.group, [...(by.get(m.group) || []), m]);
    return [...by.entries()];
  }, [metrics]);

  async function draftLessons() {
    setError("");
    setNote("");
    setBusy("Drafting from the graded calls... (about a minute)");
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Your session has expired. Sign in again.");
      const res = await fetch("/api/calls/lessons", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `Request failed (${res.status}).`);
      setDraft(body.draft || "");
      setNote("Draft ready. Edit it, delete anything you don't agree with, then press Save. Nothing is used until you save.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy("");
  }

  async function saveLessons(text: string) {
    setError("");
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const { data: me } = await supabase
      .from("profiles")
      .select("org_id")
      .eq("id", session?.user.id ?? "")
      .single();
    if (!me?.org_id) {
      setError("Could not find your organization.");
      return;
    }
    const { error } = await supabase.from("grading_guidance").upsert({
      org_id: me.org_id,
      lessons: text.trim() || null,
      updated_by: session?.user.id ?? null,
      updated_at: new Date().toISOString(),
    });
    if (error) {
      setError(error.message);
      return;
    }
    setSaved(text.trim());
    setDraft(text.trim());
    setNote(text.trim() ? "Saved. Every grade from now on uses these lessons." : "Lessons cleared.");
  }

  async function removeFix(id: string) {
    if (!confirm("Delete this correction? Future grades will stop using it.")) return;
    const { error } = await supabase.from("call_corrections").delete().eq("id", id);
    if (error) setError(error.message);
    else setFixes((f) => f.filter((x) => x.id !== id));
  }

  if (loading) {
    return (
      <main className="shell calls-shell">
        <p className="muted">Loading&hellip;</p>
      </main>
    );
  }

  return (
    <main className="shell calls-shell">

      <div className="eyebrow">
        {nG} proven (graduated or 6+ payments) &middot; {nC} cancelled &middot; {fixes.length} correction{fixes.length === 1 ? "" : "s"}
      </div>
      <h1>Insights &amp; tuning</h1>
      <p className="muted">
        What was different about the enrollment calls of proven sales (graduated or made 6+ payments) and clients who cancelled, and what the
        grader has been taught. Approved lessons and corrections are added to every grade.
      </p>
      {error && <div className="error">{error}</div>}
      {note && <div className="note">{note}</div>}

      <h2>Spotlights vs results</h2>
      {(() => {
        const won = (x: (typeof spot)[number]) => (x.manual || x.outcome) === "enrolled";
        const rate = (xs: typeof spot) => (xs.length ? `${Math.round((xs.filter(won).length / xs.length) * 100)}%` : "--");
        const bands = [
          { label: "Under 5 min", f: (m: number) => m < 5 },
          { label: "5–8 min", f: (m: number) => m >= 5 && m < 8 },
          { label: "8–12 min (target)", f: (m: number) => m >= 8 && m <= 12 },
          { label: "Over 12 min", f: (m: number) => m > 12 },
        ];
        const withHs = spot.filter((x) => typeof x.hs === "number" && x.hs > 0);
        const td = spot.filter((x) => x.pickup && x.pickup !== "n/a");
        if (!withHs.length)
          return <p className="muted">Real calls graded from now on show how long the rep stayed in hardship and how they picked the client up after the loan turndown. Once there are some, this shows which actually goes with enrollments on your calls.</p>;
        return (
          <>
            <p className="muted" style={{ marginTop: 0 }}>
              From {spot.length} graded real call{spot.length === 1 ? "" : "s"}. This only measures -- it never changes a grade -- so your own calls show whether the 8–12 minute target and a strong pickup hold up.
            </p>
            <div className="rx-grid2">
              <section className="card">
                <b>Time in hardship before moving on</b>
                <table className="rx-table" style={{ marginTop: 6 }}>
                  <tbody>
                    {bands.map((b) => {
                      const xs = withHs.filter((x) => b.f((x.hs as number) / 60));
                      return (
                        <tr key={b.label}>
                          <td>{b.label}</td>
                          <td className="num">{xs.length} calls</td>
                          <td className="num">
                            <b>{rate(xs)}</b> enrolled
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </section>
              <section className="card">
                <b>After the loan turndown</b>
                <table className="rx-table" style={{ marginTop: 6 }}>
                  <tbody>
                    {(["strong", "ok", "flat"] as const).map((k) => {
                      const xs = td.filter((x) => x.pickup === k);
                      return (
                        <tr key={k}>
                          <td>Pickup {k}</td>
                          <td className="num">{xs.length} calls</td>
                          <td className="num">
                            <b>{rate(xs)}</b> enrolled
                          </td>
                        </tr>
                      );
                    })}
                    {(["yes", "no"] as const).map((k) => {
                      const xs = td.filter((x) => x.even === k);
                      return (
                        <tr key={`e${k}`}>
                          <td>Options laid out evenly: {k}</td>
                          <td className="num">{xs.length} calls</td>
                          <td className="num">
                            <b>{rate(xs)}</b> enrolled
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </section>
            </div>
          </>
        );
      })()}

      <h2>Proven sales vs cancels</h2>
      {nG === 0 || nC === 0 ? (
        <p className="muted">
          Upload enrollment calls of proven sales and clients who cancelled, grade them, then set Retention on
          each call to <strong>Graduated</strong>, <strong>Made 6+ payments</strong> or <strong>Cancelled</strong>. The comparison appears here once there is
          at least one of each.
        </p>
      ) : (
        <>
          {(nG < MIN_FOR_FINDINGS || nC < MIN_FOR_FINDINGS) && (
            <div className="note" style={{ marginTop: 0 }}>
              Early days: {nG} proven and {nC} cancelled. Treat these differences as hints until there are at least{" "}
              {MIN_FOR_FINDINGS} of each.
            </div>
          )}

          <p className="muted" style={{ marginBottom: 6 }}>
            Biggest differences. Green means graduates&rsquo; calls were stronger here.
          </p>
          <div className="compare">
            <div className="compare-row compare-head">
              <span />
              <span>Proven</span>
              <span>Cancelled</span>
              <span>Difference</span>
            </div>
            {top.map((m) => (
              <div key={m.group + m.label} className="compare-row">
                <span>
                  {m.label}
                  <span className="calls-meta">{m.group}</span>
                </span>
                <span>{formatValue(m, m.graduated)}</span>
                <span>{formatValue(m, m.cancelled)}</span>
                <Gap m={m} />
              </div>
            ))}
          </div>

          <details className="fold" style={{ marginTop: 14 }}>
            <summary>
              <span className="fold-title">Everything compared</span>
              <span className="fold-preview">{metrics.length} measures</span>
            </summary>
            <div className="fold-body">
              {groups.map(([group, ms]) => (
                <div key={group} className="compare" style={{ marginTop: 10 }}>
                  <div className="compare-row compare-head">
                    <span>{group}</span>
                    <span>Proven</span>
                    <span>Cancelled</span>
                    <span>Difference</span>
                  </div>
                  {ms.map((m) => (
                    <div key={m.label} className="compare-row">
                      <span>
                        {m.label}
                        {m.hint && <span className="stage-term">{m.hint}</span>}
                      </span>
                      <span>
                        {formatValue(m, m.graduated)}
                        <span className="calls-meta">n={m.nGraduated}</span>
                      </span>
                      <span>
                        {formatValue(m, m.cancelled)}
                        <span className="calls-meta">n={m.nCancelled}</span>
                      </span>
                      <Gap m={m} />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </details>
        </>
      )}

      <h2>Lessons for the grader</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Claude can draft lessons from the calls above. Nothing is used until you edit and save it, because early patterns
        can be coincidence. One lesson per line.
      </p>
      <textarea
        rows={8}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="- On graduates' calls, the client restated the program in their own words before the close."
      />
      <div className="row" style={{ marginTop: 10 }}>
        <button disabled={!!busy || nG === 0 || nC === 0} onClick={draftLessons}>
          {busy || "Draft lessons from these calls"}
        </button>
        <button className="primary" disabled={!!busy || draft.trim() === saved.trim()} onClick={() => saveLessons(draft)}>
          Save lessons
        </button>
        {saved && (
          <button className="danger" disabled={!!busy} onClick={() => saveLessons("")}>
            Clear lessons
          </button>
        )}
      </div>
      <p className="muted" style={{ fontSize: 12 }}>
        {saved ? "Saved lessons are in use on every grade." : "No lessons in use yet."} Drafting costs about 10&ndash;20
        cents.
      </p>

      <h2>Corrections ({fixes.length})</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Made with &ldquo;Not right?&rdquo; on a report. The {Math.min(fixes.length, 30)} most recent are added to every
        grade so the grader learns from them. Delete any that turned out to be wrong.
      </p>
      {fixes.length === 0 && <p className="muted">None yet.</p>}
      {fixes.map((f) => (
        <div key={f.id} className="grade-item">
          <div className="grade-item-head">
            <span>
              <span className="tone-chip">{f.item_kind}</span> {f.item_label}
            </span>
            <span className="row" style={{ gap: 10 }}>
              <Link href={`/admin/calls/${f.call_id}`} className="link-btn">
                Open call
              </Link>
              <button className="link-btn danger" onClick={() => removeFix(f.id)}>
                Delete
              </button>
            </span>
          </div>
          <div className="grade-quote" style={{ textDecoration: "line-through" }}>
            {f.original}
          </div>
          <div className="grade-coach">
            <strong>Correction:</strong> {f.correction}
          </div>
          <div className="calls-meta">{new Date(f.created_at).toLocaleDateString()}</div>
        </div>
      ))}
    </main>
  );
}
