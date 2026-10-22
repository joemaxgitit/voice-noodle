"use client";

import { useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  compareRep,
  fmtChange,
  fmtKpi,
  fmtMonth,
  highlights,
  KIND_LABEL,
  monthlyReports,
  monthOf,
  type Better,
  type KpiReport,
  type KpiRow,
  type MetricPref,
  type Movement,
} from "@/lib/kpi";
import type { RepHistory } from "@/lib/repHistory";
import Link from "next/link";
import { Sparkline } from "../charts";
import { pct, pts, reasonsText } from "@/lib/retention";

const NEXT: Record<Better, Better> = { up: "down", down: "none", none: "up" };
const ARROW: Record<Better, string> = { up: "↑ higher is better", down: "↓ lower is better", none: "· no direction" };

/**
 * The monthly KPI one-on-one: every category in the sales reports, this
 * month against last, with the biggest moves pulled to the top.
 */
export default function KpiTab({
  supabase,
  orgId,
  repId,
  repName,
  history,
  setPrefs,
}: {
  supabase: SupabaseClient;
  orgId: string;
  repId: string;
  repName: string;
  history: RepHistory;
  setPrefs: (p: Map<string, MetricPref>) => void;
}) {
  const { kpiReports, kpiRows, prefs } = history;

  const rowsByReport = useMemo(() => {
    const m = new Map<string, KpiRow[]>();
    for (const r of kpiRows) m.set(r.report_id, [...(m.get(r.report_id) ?? []), r]);
    return m;
  }, [kpiRows]);

  const byGroup = useMemo(() => monthlyReports(kpiReports), [kpiReports]);
  const mineIn = (r: KpiReport) => (rowsByReport.get(r.id) ?? []).some((x) => x.rep_id === repId);

  const months = useMemo(() => {
    const s = new Set<string>();
    for (const [, byMonth] of byGroup) for (const [m, r] of byMonth) if (mineIn(r)) s.add(m);
    return [...s].sort().reverse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byGroup, rowsByReport, repId]);

  const [month, setMonth] = useState<string>("");
  const sel = month && months.includes(month) ? month : months[0];

  const groups = useMemo(() => {
    if (!sel) return [];
    const out: { key: string; cur: KpiReport; prev: KpiReport | null; moves: Movement[]; spark: Map<string, (number | null)[]> }[] = [];
    for (const [g, byMonth] of byGroup) {
      const cur = byMonth.get(sel);
      if (!cur || !mineIn(cur)) continue;
      const earlier = [...byMonth.keys()].filter((m) => m < sel).sort();
      const prevMonth = earlier.filter((m) => mineIn(byMonth.get(m)!)).at(-1);
      const prev = prevMonth ? byMonth.get(prevMonth)! : null;
      const moves = compareRep({
        repId,
        cur,
        prev,
        curRows: rowsByReport.get(cur.id) ?? [],
        prevRows: prev ? rowsByReport.get(prev.id) ?? [] : [],
        prefs,
      });
      // last six months for each category, for the sparkline
      const last6 = [...byMonth.keys()].filter((m) => m <= sel).sort().slice(-6);
      const spark = new Map<string, (number | null)[]>();
      for (const mv of moves)
        spark.set(
          mv.key,
          last6.map((m) => {
            const row = (rowsByReport.get(byMonth.get(m)!.id) ?? []).find((x) => x.rep_id === repId);
            const v = row?.data[mv.key];
            return typeof v === "number" ? v : null;
          })
        );
      out.push({ key: g, cur, prev, moves, spark });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, byGroup, rowsByReport, repId, prefs]);

  const hl = useMemo(() => highlights(groups.flatMap((g) => g.moves)), [groups]);

  async function flip(key: string, cur: Better) {
    const better = NEXT[cur];
    const next = new Map(prefs);
    next.set(key, { metric_key: key, better, hidden: prefs.get(key)?.hidden ?? false });
    setPrefs(next);
    await supabase.from("kpi_metric_prefs").upsert({ org_id: orgId, metric_key: key, better, hidden: prefs.get(key)?.hidden ?? false });
  }
  async function hide(key: string, better: Better) {
    const next = new Map(prefs);
    next.set(key, { metric_key: key, better, hidden: true });
    setPrefs(next);
    await supabase.from("kpi_metric_prefs").upsert({ org_id: orgId, metric_key: key, better, hidden: true });
  }
  async function unhideAll() {
    const hidden = [...prefs.values()].filter((p) => p.hidden);
    const next = new Map(prefs);
    for (const p of hidden) next.set(p.metric_key, { ...p, hidden: false });
    setPrefs(next);
    for (const p of hidden) await supabase.from("kpi_metric_prefs").upsert({ org_id: orgId, metric_key: p.metric_key, better: p.better, hidden: false });
  }

  // Friday retention lookbacks: cancels before the 1st payment trace back to the sale.
  // Morning Deal Clip snapshots for the latest month on record.
  const clipMonth = history.dealClips[0]?.day.slice(0, 7);
  const clips = history.dealClips.filter((c) => c.day.slice(0, 7) === clipMonth);
  const clipCard = clips.length ? (
    <section className="card" style={{ marginBottom: 14 }}>
      <h3 className="rx-sec-title">Deal Clip, {new Date(`${clipMonth}-15T12:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" })}</h3>
      <p className="hint" style={{ marginTop: 0 }}>
        Month-end projection each morning: <b>{Math.round(clips[clips.length - 1].clip)}</b> on {new Date(`${clips[clips.length - 1].day}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
        {clips.length > 1 && (
          <>
            {" "}
            &rarr; <b>{Math.round(clips[0].clip)}</b> on {new Date(`${clips[0].day}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </>
        )}
      </p>
      <div className="rx-scroll">
        <table className="rx-table">
          <thead>
            <tr>
              <th>Through</th>
              <th className="num">Deals</th>
              <th className="num">Close %</th>
              <th className="num">Clip</th>
              <th className="num">Days left</th>
            </tr>
          </thead>
          <tbody>
            {clips.slice(0, 10).map((c) => (
              <tr key={c.day}>
                <td>{new Date(`${c.day}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</td>
                <td className="num">{c.deals}</td>
                <td className="num">{c.ratio === null ? "--" : `${Math.round(c.ratio * 100)}%`}</td>
                <td className="num">
                  <b>{Math.round(c.clip)}</b>
                </td>
                <td className="num">{Math.max(0, c.total - c.gone)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  ) : null;

  const ret = history.retention.slice(0, 6);
  const retentionCard = ret.length ? (
    <section className="card" style={{ marginBottom: 14 }}>
      <h3 className="rx-sec-title">Retention (Friday lookbacks)</h3>
      <div className="rx-scroll">
        <table className="rx-table">
          <thead>
            <tr>
              <th>Requests window</th>
              <th className="num" title="From the sale report the lookback was built on -- it covers a longer stretch than the requests window">Cancelled before 1st</th>
              <th className="num">Requests</th>
              <th>Lost at the sale</th>
            </tr>
          </thead>
          <tbody>
            {ret.map((r) => {
              const up = r.before1_rate !== null && r.prior_rate !== null ? r.before1_rate - r.prior_rate : 0;
              return (
                <tr key={r.period_end}>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {new Date(`${r.period_start}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })} –{" "}
                    {new Date(`${r.period_end}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </td>
                  <td className="num">
                    <b>{pct(r.before1_rate)}</b>
                    {r.deals ? <span className="muted"> of {r.deals} deals</span> : null}{" "}
                    {r.prior_rate !== null && <span className={up > 0.02 ? "rx-down" : up < -0.02 ? "rx-up" : "muted"}>({pts(r.before1_rate, r.prior_rate)})</span>}
                  </td>
                  <td className="num">{r.requests ?? "--"}</td>
                  <td style={{ fontSize: 13 }}>{reasonsText(r.pos_reasons) || <span className="muted">none</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="hint" style={{ marginBottom: 0 }}>Lower is better. The requests (and what was lost at the sale) are from the window shown. The cancel rate comes from the sale report the lookback was built on, which covers a longer stretch -- so the so &ldquo;of 45 deals&rdquo; is every deal in that reportldquo;of N dealsso &ldquo;of 45 deals&rdquo; is every deal in that reportrdquo; count is every deal in that report, not deals made in the window. Rates are a floor while first payments are still pending; the change is against the prior period and is directional.</p>
    </section>
  ) : null;

  if (!months.length)
    return (
      <div>
      {clipCard}
      {retentionCard}
      <div className="card">
        <p style={{ marginTop: 0 }}>No sales reports for {repName} yet.</p>
        <p className="hint">
          Upload the CRM&rsquo;s reports on <Link href="/admin/reports">Sales reports</Link> -- one upload covers the whole team. Upload one a month
          (or more) and this page lines each month up against the last.
        </p>
      </div>
      </div>
    );

  const hiddenCount = [...prefs.values()].filter((p) => p.hidden).length;
  const moveLine = (m: Movement) => (
    <li key={m.key}>
      <b>{m.label}</b>: {fmtKpi(m.prev, m.type)} → {fmtKpi(m.cur, m.type)} <span className={m.good ? "rx-up" : "rx-down"}>({fmtChange(m)})</span>
      {m.rank && m.of > 1 ? <span className="muted"> · #{m.rank} of {m.of} on the team</span> : null}
    </li>
  );

  return (
    <div>
      {clipCard}
      {retentionCard}
      <div className="rx-head rx-noprint" style={{ marginBottom: 12 }}>
        <label className="field" style={{ margin: 0 }}>
          <span className="label">Month</span>
          <select value={sel} onChange={(e) => setMonth(e.target.value)} style={{ width: "auto" }}>
            {months.map((m) => (
              <option key={m} value={m}>
                {fmtMonth(m)}
              </option>
            ))}
          </select>
        </label>
        <div className="rx-actions">
          {hiddenCount > 0 && (
            <button className="tr-sm" onClick={() => void unhideAll()}>
              Show {hiddenCount} hidden
            </button>
          )}
          <button onClick={() => window.print()}>Print for the one-on-one</button>
        </div>
      </div>

      <div className="print-only">
        <h2 style={{ margin: "0 0 4px" }}>
          {repName} -- KPI one-on-one, {fmtMonth(sel)}
        </h2>
      </div>

      {groups.every((g) => !g.prev) ? (
        <div className="card">
          <p style={{ margin: 0 }}>
            This is the first month on record for {repName}, so there&rsquo;s nothing to compare against yet. Next month&rsquo;s upload will show
            the movement in every category.
          </p>
        </div>
      ) : (
        <div className="rx-grid2">
          <section className="card" style={{ borderColor: "var(--ok)" }}>
            <h3 className="rx-sec-title" style={{ color: "var(--ok)" }}>
              Wins to call out
            </h3>
            {hl.good.length ? <ul className="plain-list" style={{ margin: 0 }}>{hl.good.slice(0, 6).map(moveLine)}</ul> : <p className="hint">No big gains this month.</p>}
          </section>
          <section className="card" style={{ borderColor: "var(--bad)" }}>
            <h3 className="rx-sec-title" style={{ color: "var(--bad)" }}>
              Talk through
            </h3>
            {hl.bad.length ? <ul className="plain-list" style={{ margin: 0 }}>{hl.bad.slice(0, 6).map(moveLine)}</ul> : <p className="hint">Nothing slipped noticeably.</p>}
          </section>
        </div>
      )}

      {groups.map((g) => (
        <section key={g.key} className="card" style={{ marginTop: 14 }}>
          <div className="rx-head">
            <div>
              <h3 style={{ margin: 0 }}>{g.cur.kind === "other" ? g.cur.title : KIND_LABEL[g.cur.kind] ?? g.cur.title}</h3>
              <p className="hint" style={{ margin: "2px 0 0" }}>
                {fmtMonth(monthOf(g.cur))}
                {g.prev ? ` vs ${fmtMonth(monthOf(g.prev))}` : " -- no earlier month to compare"}
              </p>
            </div>
          </div>
          <div className="rx-scroll">
            <table className="rx-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th className="num">{g.prev ? fmtMonth(monthOf(g.prev), false) : "Before"}</th>
                  <th className="num">{fmtMonth(monthOf(g.cur), false)}</th>
                  <th className="num">Change</th>
                  <th className="num">Team rank</th>
                  <th className="num">Team avg</th>
                  <th>Trend</th>
                  <th className="rx-noprint" />
                </tr>
              </thead>
              <tbody>
                {g.moves.map((m) => (
                  <tr key={m.key} style={m.notable && m.good !== null ? { background: m.good ? "rgba(111,191,139,0.08)" : "rgba(224,104,95,0.08)" } : undefined}>
                    <td>
                      {m.label}
                      <button
                        className="link-btn rx-noprint"
                        title="Which way is better? Click to change."
                        onClick={() => void flip(m.key, m.better)}
                        style={{ display: "block", fontSize: 11, color: "var(--muted)", padding: 0 }}
                      >
                        {ARROW[m.better]}
                      </button>
                    </td>
                    <td className="num">{fmtKpi(m.prev, m.type)}</td>
                    <td className="num">
                      <b>{fmtKpi(m.cur, m.type)}</b>
                    </td>
                    <td className={`num ${m.good === true ? "rx-up" : m.good === false ? "rx-down" : ""}`} style={{ whiteSpace: "nowrap" }}>
                      {m.notable && m.good !== null ? (m.good ? "▲ " : "▼ ") : ""}
                      {fmtChange(m)}
                    </td>
                    <td className="num">{m.rank && m.of > 1 ? `#${m.rank} of ${m.of}` : "--"}</td>
                    <td className="num">{fmtKpi(m.teamAvg, m.type)}</td>
                    <td>
                      <Sparkline values={g.spark.get(m.key) ?? []} />
                    </td>
                    <td className="rx-noprint">
                      <button className="link-btn" title="Leave this category out of the comparison" onClick={() => void hide(m.key, m.better)} style={{ fontSize: 12, color: "var(--muted)" }}>
                        Hide
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      <p className="hint rx-noprint">
        Highlighted rows moved enough to bring up: 3+ points on a percentage, or 15%+ on a count. Click the line under a category to set which way is
        better -- it applies to every rep.
      </p>
    </div>
  );
}

