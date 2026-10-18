"use client";

import { useState } from "react";

/*
  Small hand-drawn charts for the rep pages. One y-axis, thin 2px lines,
  >=8px markers, recessive grid, a legend for two or more series, and a hover
  readout. Colors come from the app's own tokens so light and dark both work.
*/

export type Series = { name: string; color: string; points: { x: number; y: number; label: string; href?: string }[] };

export function LineChart({
  series,
  yMin = 0,
  yMax = 100,
  height = 200,
  fmtX,
}: {
  series: Series[];
  yMin?: number;
  yMax?: number;
  height?: number;
  fmtX: (x: number) => string;
}) {
  const [hover, setHover] = useState<{ s: number; i: number } | null>(null);
  const all = series.flatMap((s) => s.points);
  if (!all.length) return <p className="hint">Nothing to chart yet.</p>;
  const W = 640;
  const H = height;
  const pad = { l: 34, r: 12, t: 10, b: 24 };
  let x0 = Math.min(...all.map((p) => p.x));
  let x1 = Math.max(...all.map((p) => p.x));
  if (x0 === x1) (x0 -= 86400000), (x1 += 86400000);
  const sx = (x: number) => pad.l + ((x - x0) / (x1 - x0)) * (W - pad.l - pad.r);
  const sy = (y: number) => pad.t + (1 - (y - yMin) / (yMax - yMin)) * (H - pad.t - pad.b);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => yMin + f * (yMax - yMin));
  const xt = [x0, (x0 + x1) / 2, x1];
  const hp = hover ? series[hover.s].points[hover.i] : null;

  return (
    <div style={{ position: "relative" }}>
      <svg className="rx-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={series.map((s) => s.name).join(" and ") + " over time"}>
        <g className="grid">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={sy(t)} y2={sy(t)} strokeWidth={1} />
              <text x={pad.l - 6} y={sy(t) + 4} textAnchor="end">
                {Math.round(t)}
              </text>
            </g>
          ))}
          {xt.map((x, i) => (
            <text key={i} x={sx(x)} y={H - 6} textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"}>
              {fmtX(x)}
            </text>
          ))}
        </g>
        {series.map((s, si) => {
          const pts = [...s.points].sort((a, b) => a.x - b.x);
          return (
            <g key={s.name}>
              {pts.length > 1 && (
                <polyline
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  points={pts.map((p) => `${sx(p.x)},${sy(p.y)}`).join(" ")}
                />
              )}
              {s.points.map((p, i) => (
                <g key={i}>
                  <circle cx={sx(p.x)} cy={sy(p.y)} r={4.5} fill={s.color} stroke="var(--ink)" strokeWidth={2} />
                  <circle
                    cx={sx(p.x)}
                    cy={sy(p.y)}
                    r={12}
                    fill="transparent"
                    style={{ cursor: p.href ? "pointer" : "default" }}
                    onMouseEnter={() => setHover({ s: si, i })}
                    onMouseLeave={() => setHover(null)}
                    onFocus={() => setHover({ s: si, i })}
                    onBlur={() => setHover(null)}
                    onClick={() => p.href && (window.location.href = p.href)}
                    tabIndex={p.href ? 0 : -1}
                  >
                    <title>{p.label}</title>
                  </circle>
                </g>
              ))}
            </g>
          );
        })}
      </svg>
      {hp && (
        <div
          className="card"
          style={{
            position: "absolute",
            pointerEvents: "none",
            left: `${(sx(hp.x) / W) * 100}%`,
            top: `${(sy(hp.y) / H) * 100}%`,
            transform: `translate(${sx(hp.x) > W * 0.6 ? "-105%" : "8%"}, -110%)`,
            padding: "6px 10px",
            fontSize: 12,
            whiteSpace: "nowrap",
            margin: 0,
            zIndex: 2,
          }}
        >
          {hp.label}
        </div>
      )}
      {series.length > 1 && (
        <div className="rx-legend">
          {series.map((s) => (
            <span key={s.name}>
              <i style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** A tiny trend line for a table cell. The last point is marked. */
export function Sparkline({ values, color = "var(--live)" }: { values: (number | null)[]; color?: string }) {
  const v = values.map((x, i) => ({ x: i, y: x })).filter((p): p is { x: number; y: number } => p.y !== null);
  if (v.length < 2) return <span className="hint">--</span>;
  const W = 80;
  const H = 22;
  const lo = Math.min(...v.map((p) => p.y));
  const hi = Math.max(...v.map((p) => p.y));
  const n = values.length - 1 || 1;
  const sx = (x: number) => 3 + (x / n) * (W - 6);
  const sy = (y: number) => (hi === lo ? H / 2 : 3 + (1 - (y - lo) / (hi - lo)) * (H - 6));
  const last = v[v.length - 1];
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" style={{ verticalAlign: "middle" }}>
      <polyline fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" points={v.map((p) => `${sx(p.x)},${sy(p.y)}`).join(" ")} />
      <circle cx={sx(last.x)} cy={sy(last.y)} r={2.6} fill={color} />
    </svg>
  );
}
