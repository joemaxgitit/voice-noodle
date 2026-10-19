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
  // Every lost client on record (once each), for the 3-month look back.
  const [cancels, setCancels] = useState<{ rep_id: string; requested: string; stage: string }[]>([]);
  // Latest Friday retention lookback, per rep.
  const [ret, setRet] = useState<{ end: string; byRep: Map<string, { rate: number | null; prior: number | null; pos: number; reasons: Record<string, number> }> } | null>(null);
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
    // Separate, so a database without the retention tables still loads this page.
    const lr = await supabase.from("retention_reports").select("id, period_end").order("period_end", { ascending: false }).limit(1).maybeSingle();
    const rc = await supabase.from("retention_cancels").select("rep_id, requested, stage").not("rep_id", "is", null).limit(20000);
    setCancels((rc.data || []) as { rep_id: string; requested: string; stage: string }[]);
    if (lr.data) {
      const rr = await supabase.from("retention_reps").select("rep_id, before1_rate, prior_rate, pos_lost, pos_reasons").eq("report_id", lr.data.id).not("rep_id", "is", null);
      setRet({
        end: lr.data.period_end as string,
        byRep: new Map(
          ((rr.data || []) as { rep_id: string; before1_rate: number | null; prior_rate: number | null; pos_lost: number; pos_reasons: Record<string, number> }[]).map((x) => [
            x.rep_id,
            { rate: x.before1_rate === null ? null : Number(x.before1_rate), prior: x.prior_rate === null ? null : Number(x.prior_rate), pos: x.pos_lost, reasons: x.pos_reasons },
          ])
        ),
      });
    }
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

  // 3-month look back: clients who cancelled (before or after the 1st payment) in the
  // 90 days up to the latest lookback, against the rep's deals in the last 3 report months.
  const look = useMemo(() => {
    if (!cancels.length) return null;
    const end = ret?.end ?? new Date().toISOString().slice(0, 10);
    const start = new Date(new Date(`${end}T12:00:00`).getTime() - 90 * DAY).toISOString().slice(0, 10);
    const byGroup = monthlyReports(reports.filter((r) => r.kind === "sales_dashboard" || r.kind === "monthly_report"));
    const g = byGroup.get("sales_dashboard") ?? byGroup.get("monthly_report");
    const months = g ? [...g.keys()].filter((m) => m <= end.slice(0, 7)).sort().slice(-3) : [];
    const deals = new Map<string, number>();
    for (const m of months) {
      const rep = g!.get(m)!;
      for (const row of kpiRows.filter((x) => x.report_id === rep.id && x.rep_id)) {
        const d = headlineValue(row, rep.columns, "deals");
        if (typeof d?.v === "number") deals.set(row.rep_id!, (deals.get(row.rep_id!) ?? 0) + d.v);
      }
    }
    const inWin = cancels.filter((c) => c.requested >= start && c.requested <= end);
    return { start, end, months, deals, inWin };
  }, [cancels, ret, reports, kpiRows]);

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
          ret: ret?.byRep.get(p.id) ?? null,
          look: (() => {
            if (!look) return null;
            const mine = look.inWin.filter((c) => c.rep_id === p.id);
            const d = look.deals.get(p.id) ?? 0;
            return { n: mine.length, before: mine.filter((c) => c.stage === "before_1st").length, after: mine.filter((c) => c.stage === "after_1st").length, deals: d, rate: d ? mine.length / d : null };
          })(),
        };
      });
  }, [people, calls, kpi, notes, reviews, showAll, ret, look]);

  return (
    <main className="shell rx-page" style={{ maxWidth: 1120 }}>
      <div className="eyebrow">Team</div>
      <h1>Reps</h1>
      <p className="muted" style={{ maxWidth: "66ch" }}>
        Every rep&rsquo;s profile collects their graded calls, practice calls, KPI reports, your notes and files, and training. Open one to see the
        arc, prep a KPI one-on-one, or run a coaching review. Managers only.
      </p>
      {error && <div className="error">{error}</div>}

      <div className="rx-scroll" style={{ marginTop: 10 }}>
        <table className="rx-table rx-fit">
          <thead>
            <tr>
              <th>Rep</th>
              <th className="num" title="Straight Line score, last 30 days">SLP 30d</th>
              <th className="num" title="Real calls / practice calls graded, last 30 days">Calls / practice</th>
              <th className="num">{kpi ? `Deals ${fmtMonth(monthOf(kpi.cur), false)}` : "Deals"}</th>
              <th className="num">Close %</th>
              <th className="num" title="Cancelled before the 1st payment, from the latest Friday retention lookback. Lower is better.">
                {ret ? `Cancel < 1st, ${new Date(`${ret.end}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : "Cancel < 1st"}
              </th>
              <th
                className="num"
                title="Clients who cancelled before or after the 1st payment in the last 3 months, as a share of the rep's deals in the last 3 report months. Lower is better."
              >
                Cancel 3 mo
              </th>
              <th className="num">Notes</th>
              <th>Review</th>
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
                <td
                  className="num"
                  title={r.ret?.pos ? `Lost at the sale: ${Object.entries(r.ret.reasons).map(([k, n]) => `${k}${n > 1 ? ` ×${n}` : ""}`).join(", ")}` : undefined}
                >
                  {r.ret?.rate != null ? `${Math.round(r.ret.rate * 100)}%` : "--"}
                  {r.ret?.rate != null && r.ret.prior != null && Math.abs(r.ret.rate - r.ret.prior) >= 0.01 && (
                    <small className={r.ret.rate > r.ret.prior ? "rx-down" : "rx-up"}>
                      {" "}
                      {r.ret.rate > r.ret.prior ? "▲" : "▼"}
                      {Math.abs(Math.round((r.ret.rate - r.ret.prior) * 100))}
                    </small>
                  )}
                </td>
                <td
                  className="num"
                  title={r.look ? `${r.look.n} cancelled (${r.look.before} before the 1st payment, ${r.look.after} after) ÷ ${r.look.deals} deals` : undefined}
                >
                  {r.look?.rate != null ? `${Math.round(r.look.rate * 100)}%` : r.look?.n ? `${r.look.n} cancels` : "--"}
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
