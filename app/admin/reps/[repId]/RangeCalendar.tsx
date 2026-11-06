"use client";

import { useMemo, useState } from "react";

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/*
  A month calendar for picking one day or a range: click a day, then click a
  later day to make it a range (clicking again starts over). Days with calls
  get a dot and the count.
*/
export default function RangeCalendar({
  from,
  to,
  max,
  counts,
  onChange,
}: {
  from: string;
  to: string;
  max: string;
  counts: Record<string, number>;
  onChange: (from: string, to: string) => void;
}) {
  const [month, setMonth] = useState(() => new Date(`${to.slice(0, 7)}-01T12:00:00`));
  const [picking, setPicking] = useState(false); // true after the first click of a range

  const cells = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1, 12);
    const lead = first.getDay();
    const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const out: (string | null)[] = Array(lead).fill(null);
    for (let d = 1; d <= days; d++) out.push(iso(new Date(month.getFullYear(), month.getMonth(), d, 12)));
    while (out.length % 7) out.push(null);
    return out;
  }, [month]);

  const step = (n: number) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1, 12));
  const atMax = iso(new Date(month.getFullYear(), month.getMonth() + 1, 1, 12)) > max;

  function click(d: string) {
    if (picking && d >= from) {
      onChange(from, d);
      setPicking(false);
    } else {
      onChange(d, d);
      setPicking(true);
    }
  }

  return (
    <div className="rcal">
      <div className="rcal-head">
        <button type="button" className="link-btn" onClick={() => step(-1)} aria-label="Previous month">
          &#8249;
        </button>
        <b>{month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</b>
        <button type="button" className="link-btn" onClick={() => step(1)} disabled={atMax} aria-label="Next month">
          &#8250;
        </button>
      </div>
      <div className="rcal-grid">
        {["S", "M", "T", "W", "T", "F", "S"].map((w, i) => (
          <span key={i} className="rcal-wd">
            {w}
          </span>
        ))}
        {cells.map((d, i) =>
          d ? (
            <button
              key={d}
              type="button"
              disabled={d > max}
              onClick={() => click(d)}
              className={`rcal-day${d >= from && d <= to ? " in" : ""}${d === from || d === to ? " end" : ""}`}
              title={counts[d] ? `${counts[d]} call${counts[d] === 1 ? "" : "s"}` : "No calls"}
            >
              {Number(d.slice(8))}
              {counts[d] ? <small>{counts[d]}</small> : <small>&nbsp;</small>}
            </button>
          ) : (
            <span key={`x${i}`} />
          ),
        )}
      </div>
      <small className="muted">{picking ? "Click a later day for a range, or Review for just this day." : "Click a day, then a later day for a range."}</small>
    </div>
  );
}
