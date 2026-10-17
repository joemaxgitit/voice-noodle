"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { compare, favouring, formatValue, MIN_FOR_FINDINGS, type InsightCall, type Metric } from "@/lib/insights";
import "../calls.css";

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

  const load = useCallback(async () => {
    const [c, f, g] = await Promise.all([
      supabase
        .from("calls")
        .select("id, retention, score, slp_score, grade")
        .in("retention", ["graduated", "cancelled"])
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
    setCalls((c.data || []) as unknown as InsightCall[]);
    setFixes((f.data || []) as Correction[]);
    const lessons = (g.data?.lessons as string | null) ?? "";
    setSaved(lessons);
    setDraft(lessons);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

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
        {nG} graduated &middot; {nC} cancelled &middot; {fixes.length} correction{fixes.length === 1 ? "" : "s"}
      </div>
      <h1>Insights &amp; tuning</h1>
      <p className="muted">
        What was different about the enrollment calls of clients who graduated and clients who cancelled, and what the
        grader has been taught. Approved lessons and corrections are added to every grade.
      </p>
      {error && <div className="error">{error}</div>}
      {note && <div className="note">{note}</div>}

      <h2>Graduates vs cancels</h2>
      {nG === 0 || nC === 0 ? (
        <p className="muted">
          Upload enrollment calls of clients who graduated and clients who cancelled, grade them, then set Retention on
          each call to <strong>Graduated</strong> or <strong>Cancelled</strong>. The comparison appears here once there is
          at least one of each.
        </p>
      ) : (
        <>
          {(nG < MIN_FOR_FINDINGS || nC < MIN_FOR_FINDINGS) && (
            <div className="note" style={{ marginTop: 0 }}>
              Early days: {nG} graduated and {nC} cancelled. Treat these differences as hints until there are at least{" "}
              {MIN_FOR_FINDINGS} of each.
            </div>
          )}

          <p className="muted" style={{ marginBottom: 6 }}>
            Biggest differences. Green means graduates&rsquo; calls were stronger here.
          </p>
          <div className="compare">
            <div className="compare-row compare-head">
              <span />
              <span>Graduated</span>
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
                    <span>Graduated</span>
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
