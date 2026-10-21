"use client";

import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { scoreBand, callAt } from "@/lib/calls";
import { fmtKpi, headlineValue, monthlyReports, monthOf, fmtMonth, type KpiReport, type KpiRow } from "@/lib/kpi";
import DropBox from "./DropBox";
import { useMode } from "@/lib/superMode";
import "../calls/calls.css";
import "../training/training.css";
import "./reps.css";

type Person = { id: string; full_name: string | null; role: string; team: string | null; active: boolean };
type CallLite = {
  rep_id: string;
  created_at: string;
  call_date: string | null;
  source: string;
  slp_score: number | null;
  score: number | null;
  status: string;
  script_id: string | null;
  tens: { product?: number | null; rep?: number | null; company?: number | null } | null;
  hs: number | null;
  hss: number | null;
  fu: string | null;
};
type SortKey = "name" | "slp" | "script" | "product" | "rep" | "company" | "hardship" | "calls" | "review";
const clock = (secs: number) => `${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, "0")}`;
const avg1 = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null);
const tenBand = (x: number) => (x >= 7 ? "good" : x >= 5 ? "fair" : "poor");
type ReviewLite = { rep_id: string; status: string; created_at: string; trajectory: string | null; core_trajectory?: string | null };

const DAY = 86400000;
const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null);

/** The team at a glance, and the drop box that feeds every profile. */
export default function Reps() {
  const { superMode } = useMode();
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
  const [totals, setTotals] = useState<Map<string, { real: number; practice: number }>>(new Map());
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "name", dir: 1 });
  // Scripts that pick up after the loan (Renew): no hardship target, so they're left out of the hardship column.
  const [renewScripts, setRenewScripts] = useState<Set<string>>(new Set());
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
      // By when the call happened (call date), falling back to upload date when no call date was given.
      supabase
        .from("calls")
        .select("rep_id, created_at, call_date, source, slp_score, score, status, script_id, tens:grade->three_tens, hs:grade->spotlights->hardship->moved_on_at, hss:grade->spotlights->hardship->score, fu:grade->spotlights->followup->>kind")
        .or(`call_date.gte.${since.slice(0, 10)},and(call_date.is.null,created_at.gte.${since})`)
        .not("rep_id", "is", null),
      supabase.from("kpi_reports").select("*"),
      supabase.from("kpi_rows").select("id, report_id, rep_id, salesman, data"),
      supabase.from("rep_notes").select("rep_id"),
      supabase.from("rep_reviews").select("rep_id, status, created_at, trajectory:review->>trajectory, core_trajectory:review->core->>trajectory").order("created_at", { ascending: false }),
    ]);
    const err = p.error || c.error || r.error || n.error;
    if (err) setError(/kpi_|rep_notes|rep_reviews|does not exist/i.test(err.message) ? `${err.message} -- run supabase/rep-profile.sql in the Supabase SQL Editor first.` : err.message);
    setPeople((p.data || []) as Person[]);
    setCalls((c.data || []) as unknown as CallLite[]);
    // Every graded call on file per rep, whatever the date, so "2 in 30 days" never reads as "only 2 calls".
    const all = await supabase.from("calls").select("rep_id, source").eq("status", "graded").not("rep_id", "is", null).limit(20000);
    const tot = new Map<string, { real: number; practice: number }>();
    for (const x of (all.data || []) as { rep_id: string; source: string }[]) {
      const t = tot.get(x.rep_id) ?? { real: 0, practice: 0 };
      if (x.source === "roleplay") t.practice++;
      else t.real++;
      tot.set(x.rep_id, t);
    }
    setTotals(tot);
    const sc = await supabase.from("scripts").select("id, continues_into");
    setRenewScripts(new Set(((sc.data || []) as { id: string; continues_into: string | null }[]).filter((x) => x.continues_into).map((x) => x.id)));
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
        const at = (c: CallLite) => callAt(c);
        const now30 = mine.filter((c) => at(c) >= now - 30 * DAY);
        // Movement: this 30 days against the 30 before it, by call date.
        const prev30 = mine.filter((c) => at(c) < now - 30 * DAY && at(c) >= now - 60 * DAY);
        const slp = avg(now30.map((c) => c.slp_score).filter((x): x is number => x !== null));
        const slpPrev = avg(prev30.map((c) => c.slp_score).filter((x): x is number => x !== null));
        // Script score: real calls only (practice calls aren't graded on the script the same way).
        const scr = avg(now30.filter((c) => c.source !== "roleplay").map((c) => c.score).filter((x): x is number => x !== null));
        const scrPrev = avg(prev30.filter((c) => c.source !== "roleplay").map((c) => c.score).filter((x): x is number => x !== null));
        const ten = (k: "product" | "rep" | "company") => avg1(now30.map((c) => c.tens?.[k]).filter((x): x is number => typeof x === "number"));
        const tens = { product: ten("product"), rep: ten("rep"), company: ten("company") };
        const tv = Object.entries(tens).filter(([, v]) => v !== null) as [string, number][];
        const weakest = tv.length > 1 ? tv.reduce((a, b) => (b[1] < a[1] ? b : a))[0] : null;
        // Hardship: Options Script first calls only (renew calls have no hardship target; follow-ups covered it before).
        const hsCalls = now30.filter((c) => !renewScripts.has(c.script_id ?? "") && c.fu !== "followup" && typeof c.hss === "number");
        const hs = avg(hsCalls.map((c) => c.hss as number));
        const timed = hsCalls.filter((c) => typeof c.hs === "number" && (c.hs as number) > 0);
        const hsTime = timed.length ? timed.reduce((a, c) => a + (c.hs as number), 0) / timed.length : null;
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
          scr,
          scrDelta: scr !== null && scrPrev !== null ? scr - scrPrev : null,
          tens,
          weakest,
          hs,
          hsN: hsCalls.length,
          hsTime,
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
  }, [people, calls, kpi, notes, reviews, showAll, ret, look, renewScripts]);

  const TRAJ_RANK: Record<string, number> = { slipping: 0, mixed: 1, early: 2, steady: 3, improving: 4 };
  const sorted = useMemo(() => {
    const val = (r: (typeof rows)[number]): number | string | null => {
      switch (sort.key) {
        case "name": return (r.p.full_name || "").toLowerCase();
        case "slp": return r.slp;
        case "script": return r.scr;
        case "product": return r.tens.product;
        case "rep": return r.tens.rep;
        case "company": return r.tens.company;
        case "hardship": return r.hs;
        case "calls": return r.real + r.practice;
        case "review": {
          const t = r.review ? (superMode ? r.review.trajectory : r.review.core_trajectory) : null;
          return t ? TRAJ_RANK[t] ?? 2 : null;
        }
      }
    };
    // Empty values always sink to the bottom, whichever way it's sorted.
    return [...rows].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      if (x === null && y === null) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort, superMode]);

  const head = (key: SortKey, label: React.ReactNode, cls = "", title?: string) => (
    <th
      className={`rx-sort ${cls}`}
      title={title}
      aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
      onClick={() => setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: key === "name" ? 1 : -1 }))}
    >
      {label}
      {sort.key === key ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
    </th>
  );

  return (
    <main className="shell rx-page" style={{ maxWidth: 1120 }}>
      <div className="eyebrow">Team</div>
      <h1>Reps</h1>
      <p className="muted" style={{ maxWidth: "66ch" }}>
        {superMode
          ? "Every rep’s profile collects their graded calls, practice calls, KPI reports, your notes and files, and training. Open one to see the arc, prep a KPI one-on-one, or run a coaching review. Managers only."
          : "Every rep’s graded calls, practice calls and Straight Line progress. Open one to see the arc or run a coaching review. Managers only."}
      </p>
      {error && <div className="error">{error}</div>}

      <div className="rx-scroll" style={{ marginTop: 10 }}>
        <table className="rx-table rx-fit">
          <thead>
            <tr>
              {head("name", "Rep")}
              {head("slp", "SLP 30d", "num rx-slp", "Straight Line score, last 30 days by call date. The arrow is the change from the 30 days before.")}
              {head("script", "Script 30d", "num rx-slp", "Script score on real calls, last 30 days by call date. The arrow is the change from the 30 days before.")}
              {head("product", <>Product<br />(Ten 1)</>, "num rx-hide-sm rx-wrap", "Client's certainty in the product, 1-10, last 30 days")}
              {head("rep", <>Rep<br />(Ten 2)</>, "num rx-hide-sm rx-wrap", "Client's trust in the rep, 1-10, last 30 days")}
              {head("company", <>Company<br />(Ten 3)</>, "num rx-hide-sm rx-wrap", "Client's certainty in the company, 1-10, last 30 days")}
              {head("hardship", "Hardship", "num", "Hardship score (0-100): how deep the client opened up, question quality, follow-ups, empathy, anchoring the pain and staying on the line. Options Script first calls, last 30 days; renew calls and follow-ups are left out. Faded when it rests on fewer than 3 calls.")}
              {head("calls", <>Calls 30d<br />(all time)</>, "num rx-hide-sm rx-wrap", "Real calls / practice calls graded with a call date in the last 30 days. Underneath: every graded call on file. Older calls still count in the rep's profile, trends and coaching review -- the 30-day columns only use the last 30 days.")}
              {superMode && (
                <>
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
                </>
              )}
              {head("review", "Review")}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.p.id} className="link" onClick={() => router.push(`/admin/reps/${r.p.id}`)}>
                <td>
                  <a href={`/admin/reps/${r.p.id}`} onClick={(e) => e.preventDefault()}>
                    <b>{r.p.full_name || "Unnamed"}</b>
                  </a>
                  {!r.p.active && <small className="muted"> · inactive</small>}
                </td>
                <td className="num rx-slp">
                  {r.slp === null ? (
                    <span className="muted">--</span>
                  ) : (
                    <span className="rx-score">
                      <span className={`pill ${scoreBand(r.slp)}`}>{r.slp}</span>
                      {r.slpDelta !== null && r.slpDelta !== 0 && (
                        <small className={`rx-delta ${r.slpDelta > 0 ? "rx-up" : "rx-down"}`}>
                          {r.slpDelta > 0 ? "▲" : "▼"}
                          {Math.abs(r.slpDelta)}
                        </small>
                      )}
                    </span>
                  )}
                </td>
                <td className="num rx-slp">
                  {r.scr === null ? (
                    <span className="muted">--</span>
                  ) : (
                    <span className="rx-score">
                      <span className={`pill ${scoreBand(r.scr)}`}>{r.scr}</span>
                      {r.scrDelta !== null && r.scrDelta !== 0 && (
                        <small className={`rx-delta ${r.scrDelta > 0 ? "rx-up" : "rx-down"}`}>
                          {r.scrDelta > 0 ? "▲" : "▼"}
                          {Math.abs(r.scrDelta)}
                        </small>
                      )}
                    </span>
                  )}
                </td>
                {(["product", "rep", "company"] as const).map((k) => (
                  <td key={k} className="num rx-hide-sm">
                    {r.tens[k] === null ? (
                      <span className="muted">--</span>
                    ) : (
                      <span className={`pill ${tenBand(r.tens[k]!)}`} style={r.weakest === k ? { fontWeight: 800, outline: "1px solid currentColor" } : undefined} title={r.weakest === k ? "Weakest of the three" : undefined}>
                        {r.tens[k]!.toFixed(1)}
                      </span>
                    )}
                  </td>
                ))}
                <td className="num" title={r.hsN ? `${r.hsN} Options first call${r.hsN === 1 ? "" : "s"}${r.hsTime ? ` · moved on at ${clock(r.hsTime)} on average` : ""}` : undefined}>
                  {r.hs === null ? (
                    <span className="muted">--</span>
                  ) : (
                    <span className={`pill ${scoreBand(r.hs)}`} style={r.hsN < 3 ? { opacity: 0.6 } : undefined}>
                      {r.hs}
                    </span>
                  )}
                </td>
                <td className="num rx-hide-sm">
                  <span style={{ whiteSpace: "nowrap" }}>
                    {r.real} / {r.practice}
                    {(() => {
                      // All-time count, same line, only when it differs from the 30 days.
                      const t = totals.get(r.p.id);
                      return t && (t.real !== r.real || t.practice !== r.practice) ? (
                        <small className="muted" title={`${t.real} real and ${t.practice} practice calls graded in all`}>
                          {" "}
                          ({t.practice ? `${t.real} / ${t.practice}` : t.real})
                        </small>
                      ) : null;
                    })()}
                  </span>
                </td>
                {superMode && (
                  <>
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
                  </>
                )}
                <td>
                  {r.review && (superMode || r.review.core_trajectory) ? (() => {
                    // Core mode shows the voice-and-script read only.
                    const t = superMode ? r.review.trajectory : r.review.core_trajectory;
                    return <span className={`pill ${t === "improving" ? "good" : t === "slipping" ? "poor" : "fair"}`}>{t ?? "done"}</span>;
                  })() : (
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

      {orgId && superMode && <DropBox supabase={supabase} orgId={orgId} me={me} people={people.filter((p) => p.active || p.role === "rep")} onSaved={() => void load()} />}
    </main>
  );
}
