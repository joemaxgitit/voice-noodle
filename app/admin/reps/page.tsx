"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { scoreBand } from "@/lib/calls";
import { fmtKpi, headlineValue, monthlyReports, monthOf, fmtMonth, type KpiReport, type KpiRow } from "@/lib/kpi";
import DropBox from "./DropBox";
import "../calls/calls.css";
import "../training/training.css";
import "./reps.css";

type Person = { id: string; full_name: string | null; role: string; team: string | null; active: boolean };
type CallLite = { rep_id: string; created_at: string; call_date: string | null; source: string; slp_score: number | null; status: string };
type ReviewLite = { rep_id: string; status: string; created_at: string; trajectory: string | null };

const DAY = 86400000;
const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null);

/** The team at a glance, and the drop box that feeds every profile. */
export default function Reps() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [orgId, setOrgId] = useState("");
  const [me, setMe] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [calls, setCalls] = useState<CallLite[]>([]);
  const [reports, setReports] = useState<KpiReport[]>([]);
  const [kpiRows, setKpiRows] = useState<KpiRow[]>([]);
  const [notes, setNotes] = useState<Map<string, number>>(new Map());
  const [reviews, setReviews] = useState<ReviewLite[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return;
    setMe(session.user.id);
    const { data: mine } = await supabase.from("profiles").select("org_id").eq("id", session.user.id).single();
    const org = mine?.org_id ?? "";
    setOrgId(org);
    const since = new Date(Date.now() - 60 * DAY).toISOString();
    const [p, c, r, k, n, v] = await Promise.all([
      supabase.from("profiles").select("id, full_name, role, team, active").eq("org_id", org).order("full_name"),
      supabase.from("calls").select("rep_id, created_at, call_date, source, slp_score, status").gte("created_at", since).not("rep_id", "is", null),
      supabase.from("kpi_reports").select("*"),
      supabase.from("kpi_rows").select("id, report_id, rep_id, salesman, data"),
      supabase.from("rep_notes").select("rep_id"),
      supabase.from("rep_reviews").select("rep_id, status, created_at, trajectory:review->>trajectory").order("created_at", { ascending: false }),
    ]);
    const err = p.error || c.error || r.error || n.error;
    if (err) setError(/kpi_|rep_notes|rep_reviews|does not exist/i.test(err.message) ? `${err.message} -- run supabase/rep-profile.sql in the Supabase SQL Editor first.` : err.message);
    setPeople((p.data || []) as Person[]);
    setCalls((c.data || []) as CallLite[]);
    setReports((r.data || []) as KpiReport[]);
    setKpiRows((k.data || []) as KpiRow[]);
    const counts = new Map<string, number>();
    for (const x of n.data || []) counts.set(x.rep_id as string, (counts.get(x.rep_id as string) ?? 0) + 1);
    setNotes(counts);
    setReviews((v.data || []) as ReviewLite[]);
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  // The most recent CRM report month, and the one before, for deals and closing ratio.
  const kpi = useMemo(() => {
    const byGroup = monthlyReports(reports.filter((r) => r.kind !== "other"));
    const g = byGroup.get("sales_dashboard") ?? byGroup.get("sale_report") ?? [...byGroup.values()][0];
    if (!g) return null;
    const months = [...g.keys()].sort();
    const cur = g.get(months.at(-1)!)!;
    const prev = months.length > 1 ? g.get(months.at(-2)!)! : null;
    const rowsOf = (rep: KpiReport | null) => (rep ? kpiRows.filter((x) => x.report_id === rep.id) : []);
    return { cur, prev, curRows: rowsOf(cur), prevRows: rowsOf(prev) };
  }, [reports, kpiRows]);

  const rows = useMemo(() => {
    const now = Date.now();
    return people
      .filter((p) => p.role === "rep" && (showAll || p.active))
      .map((p) => {
        const mine = calls.filter((c) => c.rep_id === p.id && c.status === "graded");
        const at = (c: CallLite) => new Date(c.call_date || c.created_at).getTime();
        const now30 = mine.filter((c) => at(c) >= now - 30 * DAY);
        const prev30 = mine.filter((c) => at(c) < now - 30 * DAY);
        const slp = avg(now30.map((c) => c.slp_score).filter((x): x is number => x !== null));
        const slpPrev = avg(prev30.map((c) => c.slp_score).filter((x): x is number => x !== null));
        const kr = kpi?.curRows.find((r) => r.rep_id === p.id);
        const kp = kpi?.prevRows.find((r) => r.rep_id === p.id);
        const deals = kr && kpi ? headlineValue(kr, kpi.cur.columns, "deals") : null;
        const close = kr && kpi ? headlineValue(kr, kpi.cur.columns, "close") : null;
        const closePrev = kp && kpi?.prev ? headlineValue(kp, kpi.prev.columns, "close") : null;
        const review = reviews.find((r) => r.rep_id === p.id && r.status === "done");
        return {
          p,
          slp,
          slpDelta: slp !== null && slpPrev !== null ? slp - slpPrev : null,
          real: now30.filter((c) => c.source !== "roleplay").length,
          practice: now30.filter((c) => c.source === "roleplay").length,
          deals,
          close,
          closeDelta: typeof close?.v === "number" && typeof closePrev?.v === "number" ? close.v - closePrev.v : null,
          notes: notes.get(p.id) ?? 0,
          review,
        };
      });
  }, [people, calls, kpi, notes, reviews, showAll]);

  return (
    <main className="shell">
      <div className="eyebrow">Team</div>
      <h1>Reps</h1>
      <p className="muted" style={{ maxWidth: "66ch" }}>
        Every rep&rsquo;s profile collects their graded calls, practice calls, KPI reports, your notes and files, and training. Open one to see the
        arc, prep a KPI one-on-one, or run a coaching review. Managers only.
      </p>
      {error && <div className="error">{error}</div>}

      <div className="rx-scroll" style={{ marginTop: 10 }}>
        <table className="rx-table">
          <thead>
            <tr>
              <th>Rep</th>
              <th className="num">Straight Line, 30d</th>
              <th className="num">Calls / practice, 30d</th>
              <th className="num">{kpi ? `Deals, ${fmtMonth(monthOf(kpi.cur), false)}` : "Deals"}</th>
              <th className="num">Closing ratio</th>
              <th className="num">Notes</th>
              <th>Last review</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.p.id} className="link" onClick={() => router.push(`/admin/reps/${r.p.id}`)}>
                <td>
                  <a href={`/admin/reps/${r.p.id}`} onClick={(e) => e.preventDefault()}>
                    <b>{r.p.full_name || "Unnamed"}</b>
                  </a>
                  {!r.p.active && <small className="muted"> · inactive</small>}
                </td>
                <td className="num">
                  {r.slp === null ? (
                    <span className="muted">--</span>
                  ) : (
                    <>
                      <span className={`pill ${scoreBand(r.slp)}`}>{r.slp}</span>
                      {r.slpDelta !== null && r.slpDelta !== 0 && (
                        <small className={r.slpDelta > 0 ? "rx-up" : "rx-down"}>
                          {" "}
                          {r.slpDelta > 0 ? "▲" : "▼"}
                          {Math.abs(r.slpDelta)}
                        </small>
                      )}
                    </>
                  )}
                </td>
                <td className="num">
                  {r.real} / {r.practice}
                </td>
                <td className="num">{r.deals ? fmtKpi(r.deals.v, r.deals.type) : "--"}</td>
                <td className="num">
                  {r.close ? fmtKpi(r.close.v, r.close.type) : "--"}
                  {r.closeDelta !== null && Math.abs(r.closeDelta) >= 0.005 && (
                    <small className={r.closeDelta > 0 ? "rx-up" : "rx-down"}>
                      {" "}
                      {r.closeDelta > 0 ? "▲" : "▼"}
                      {Math.abs(Math.round(r.closeDelta * 1000) / 10)}
                    </small>
                  )}
                </td>
                <td className="num">{r.notes || ""}</td>
                <td>
                  {r.review ? (
                    <span className={`pill ${r.review.trajectory === "improving" ? "good" : r.review.trajectory === "slipping" ? "poor" : "fair"}`}>
                      {r.review.trajectory ?? "done"}
                    </span>
                  ) : (
                    <span className="muted">--</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <label className="hint" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
        <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} style={{ width: "auto" }} /> Show inactive reps
      </label>

      {orgId && <DropBox supabase={supabase} orgId={orgId} me={me} people={people.filter((p) => p.active || p.role === "rep")} onSaved={() => void load()} />}
    </main>
  );
}
