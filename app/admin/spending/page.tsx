"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { loadSpend, SPEND_LABEL, usd, type SpendSummary } from "@/lib/spend";
import SpendMeters from "./SpendMeters";
import "../calls/calls.css";
import "../reps/reps.css";

/** Daily spend for the last 30 days, with the daily limit as a dashed line. */
function DailyBars({ daily, limit }: { daily: { day: string; usd: number }[]; limit: number | null }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = 180;
  const pad = { l: 40, r: 8, t: 10, b: 22 };
  const top = Math.max(limit ?? 0, ...daily.map((d) => d.usd), 0.01) * 1.1;
  const bw = (W - pad.l - pad.r) / daily.length;
  const sy = (v: number) => pad.t + (1 - v / top) * (H - pad.t - pad.b);
  const ticks = [0, top / 2, top];
  const label = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return (
    <div style={{ position: "relative" }}>
      <svg className="sp-chart" viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }} role="img" aria-label="Spending per day, last 30 days">
        <g className="grid">
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={pad.l} x2={W - pad.r} y1={sy(t)} y2={sy(t)} />
              <text x={pad.l - 6} y={sy(t) + 4} textAnchor="end">
                {usd(t)}
              </text>
            </g>
          ))}
        </g>
        {daily.map((d, i) => {
          const x = pad.l + i * bw;
          const h = sy(0) - sy(d.usd);
          return (
            <g key={d.day} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              {d.usd > 0 && <rect className={`bar ${limit != null && d.usd > limit ? "over" : ""}`} x={x + 1} y={sy(d.usd)} width={Math.max(1, bw - 2)} height={Math.max(1, h)} rx={2} />}
              <rect className="hit" x={x} y={pad.t} width={bw} height={H - pad.t - pad.b}>
                <title>{`${label(d.day)}: ${usd(d.usd)}`}</title>
              </rect>
            </g>
          );
        })}
        {limit != null && <line className="limit" x1={pad.l} x2={W - pad.r} y1={sy(limit)} y2={sy(limit)} />}
        <text x={pad.l} y={H - 6}>
          {label(daily[0].day)}
        </text>
        <text x={W - pad.r} y={H - 6} textAnchor="end">
          Today
        </text>
      </svg>
      {hover !== null && (
        <div className="card" style={{ position: "absolute", top: 0, left: `${((pad.l + hover * bw) / W) * 100}%`, transform: hover > 20 ? "translateX(-100%)" : undefined, padding: "4px 8px", fontSize: 12, margin: 0, pointerEvents: "none" }}>
          {label(daily[hover].day)}: <b>{usd(daily[hover].usd)}</b>
        </div>
      )}
      {limit != null && <p className="hint" style={{ margin: "4px 0 0" }}>Dashed line: your daily limit.</p>}
    </div>
  );
}

export default function Spending() {
  const supabase = useMemo(() => createClient(), []);
  const [s, setS] = useState<SpendSummary | null>(null);
  const [error, setError] = useState("");
  const [role, setRole] = useState("");
  const [orgId, setOrgId] = useState("");
  const [daily, setDaily] = useState("");
  const [monthly, setMonthly] = useState("");
  const [status, setStatus] = useState("");
  const [people, setPeople] = useState<Map<string, string>>(new Map());

  const load = useCallback(async () => {
    const { summary, error } = await loadSpend(supabase);
    setError(error);
    setS(summary);
    if (summary) {
      setDaily(summary.budgets.daily != null ? String(summary.budgets.daily) : "");
      setMonthly(summary.budgets.monthly != null ? String(summary.budgets.monthly) : "");
    }
  }, [supabase]);

  useEffect(() => {
    void load();
    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;
      const { data: me } = await supabase.from("profiles").select("role, org_id").eq("id", session.user.id).single();
      setRole(me?.role ?? "");
      setOrgId(me?.org_id ?? "");
      const { data: ppl } = await supabase.from("profiles").select("id, full_name").eq("org_id", me?.org_id ?? "");
      setPeople(new Map((ppl || []).map((p) => [p.id as string, (p.full_name as string) || "Someone"])));
    })();
  }, [supabase, load]);

  async function saveLimits(e: React.FormEvent) {
    e.preventDefault();
    const num = (v: string) => (v.trim() === "" ? null : Math.max(0, Number(v)));
    const d = num(daily);
    const m = num(monthly);
    if ((d !== null && isNaN(d)) || (m !== null && isNaN(m))) return setError("Limits must be numbers.");
    const { error } = await supabase.from("orgs").update({ budget_daily_usd: d, budget_monthly_usd: m }).eq("id", orgId);
    if (error) return setError(error.message);
    setStatus("Limits saved.");
    await load();
  }

  const biggest = useMemo(() => {
    if (!s) return [];
    const start = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    return s.rows.filter((r) => new Date(r.at) >= start).sort((a, b) => b.usd - a.usd).slice(0, 10);
  }, [s]);

  return (
    <main className="shell rx-page">
      <div className="eyebrow">Settings</div>
      <h1>Spending</h1>
      <p className="muted" style={{ maxWidth: "66ch" }}>
        What the paid services cost: transcribing and grading calls, practice-call voice time, translations, and Claude&rsquo;s coaching reviews, card
        drafts and drop box sorting. Estimates from list prices. Managers and admins only.
      </p>
      {error && <div className="error">{error}</div>}
      {status && <div className="status">{status}</div>}
      {!s ? (
        !error && <p className="muted">Loading&hellip;</p>
      ) : (
        <>
          <SpendMeters s={s} />

          <div className="rx-grid2">
            <section className="card">
              <h3 className="rx-sec-title">Last 30 days</h3>
              <DailyBars daily={s.daily} limit={s.budgets.daily} />
            </section>
            <section className="card">
              <h3 className="rx-sec-title">This month by service</h3>
              {!s.byKind.length ? (
                <p className="hint">Nothing yet this month.</p>
              ) : (
                <table className="rx-table">
                  <tbody>
                    {s.byKind.map((k) => (
                      <tr key={k.kind}>
                        <td>{SPEND_LABEL[k.kind] ?? k.kind}</td>
                        <td className="num">{k.n}×</td>
                        <td className="num">
                          <b>{usd(k.usd)}</b>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>

          <div className="rx-grid2" style={{ marginTop: 14 }}>
            <section className="card">
              <h3 className="rx-sec-title">Limits</h3>
              {role === "admin" ? (
                <form onSubmit={saveLimits}>
                  <div className="tr-two" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <label className="field">
                      <span className="label">Daily limit ($)</span>
                      <input inputMode="decimal" value={daily} onChange={(e) => setDaily(e.target.value)} placeholder="none" />
                    </label>
                    <label className="field">
                      <span className="label">Monthly limit ($)</span>
                      <input inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} placeholder="none" />
                    </label>
                  </div>
                  <button className="primary">Save limits</button>
                  <p className="hint">
                    Limits are a heads-up, not a hard stop: before a paid action that would go over, managers are asked to confirm. Leave blank for no
                    limit.
                  </p>
                </form>
              ) : (
                <p className="hint">
                  Daily {usd(s.budgets.daily)} · monthly {usd(s.budgets.monthly)}. Admins can change these.
                </p>
              )}
            </section>
            <section className="card">
              <h3 className="rx-sec-title">Biggest this month</h3>
              {!biggest.length ? (
                <p className="hint">Nothing yet.</p>
              ) : (
                <table className="rx-table">
                  <tbody>
                    {biggest.map((r, i) => (
                      <tr key={i}>
                        <td style={{ whiteSpace: "nowrap" }}>{new Date(r.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</td>
                        <td>
                          {SPEND_LABEL[r.kind] ?? r.kind}
                          {r.user_id ? <small className="muted"> · {people.get(r.user_id) ?? ""}</small> : null}
                        </td>
                        <td className="num">{usd(r.usd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>
        </>
      )}
    </main>
  );
}
