"use client";

import { usd, type SpendSummary } from "@/lib/spend";

/** Today and this month against their limits. Used on Home and the Spending page. */
export default function SpendMeters({ s }: { s: SpendSummary }) {
  const now = new Date();
  const daysIn = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const projected = (s.month / Math.max(1, now.getDate())) * daysIn;
  const meter = (label: string, spent: number, limit: number | null, sub?: string) => {
    const pct = limit ? Math.min(100, (100 * spent) / limit) : 0;
    const over = limit != null && spent > limit;
    const near = limit != null && !over && spent > limit * 0.8;
    return (
      <div className="rx-tile">
        <div className="k">{label}</div>
        <div className="v">
          {usd(spent)}
          {limit != null && <small style={{ fontSize: 14, fontWeight: 500, color: "var(--muted)" }}> of {usd(limit)}</small>}
        </div>
        {limit != null ? (
          <>
            <div className="sp-bar" role="meter" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={`${label}: ${Math.round(pct)}% of limit`}>
              <i style={{ width: `${pct}%`, background: over ? "var(--bad)" : near ? "var(--live)" : "var(--ok)" }} />
            </div>
            <div className={`d ${over ? "rx-down" : ""}`}>{over ? `${usd(spent - limit)} over` : `${usd(limit - spent)} left`}{sub ? ` · ${sub}` : ""}</div>
          </>
        ) : (
          <div className="d">No limit set{sub ? ` · ${sub}` : ""}</div>
        )}
      </div>
    );
  };
  return (
    <div className="rx-tiles" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
      {meter("Today", s.today, s.budgets.daily)}
      {meter("This month", s.month, s.budgets.monthly, `on pace for ${usd(projected)}`)}
    </div>
  );
}
