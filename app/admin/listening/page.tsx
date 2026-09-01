"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type Row = {
  seconds: number;
  created_at: string;
  source: string;
  user_id: string;
  profiles: { full_name: string | null } | null;
  segments: { segment_code: string; title: string | null } | null;
  narrators: { name: string } | null;
};

/** Local YYYY-MM-DD, not UTC -- a 9pm session belongs to that evening. */
function dayKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/*
  6s, 1m 6s, 1h 12m. Zero parts are dropped, so a clean two minutes reads
  "2m" rather than "2m 0s". Daily totals across a team pass an hour, hence
  the third unit.
*/
/** Wall-clock time, for saying when something happened. */
function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function spell(seconds: number): string {
  const total = Math.round(seconds);
  if (total < 60) return `${total}s`;

  const mins = Math.floor(total / 60);
  const secs = total % 60;

  if (mins < 60) return secs ? `${mins}m ${secs}s` : `${mins}m`;

  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

/**
 * Who listened to what, and for how long.
 *
 * Counts audio genuinely heard -- see lib/useListenLog. Time with the page
 * open is not the same thing and would flatter anyone who leaves a tab open,
 * so it is not counted.
 */
export default function Listening() {
  const supabase = createClient();

  const [rows, setRows] = useState<Row[]>([]);
  const [day, setDay] = useState(dayKey(new Date()));
  const [openRep, setOpenRep] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // Thirty days back, which is enough to see a pattern without pulling
      // the whole history into the browser.
      const since = new Date();
      since.setDate(since.getDate() - 30);

      const { data, error } = await supabase
        .from("listens")
        .select(
          "seconds, created_at, source, user_id, profiles(full_name), segments(segment_code, title), narrators(name)"
        )
        .gte("created_at", since.toISOString())
        .order("created_at", { ascending: false });

      if (cancelled) return;

      if (error) setError(error.message);
      setRows((data || []) as unknown as Row[]);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [supabase]);

  // Days that actually have listening, newest first.
  const days = useMemo(() => {
    const totals = new Map<string, number>();
    for (const r of rows) {
      const k = dayKey(new Date(r.created_at));
      totals.set(k, (totals.get(k) || 0) + Number(r.seconds));
    }
    return [...totals.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [rows]);

  const forDay = useMemo(
    () => rows.filter((r) => dayKey(new Date(r.created_at)) === day),
    [rows, day]
  );

  // Rep totals for the selected day.
  const reps = useMemo(() => {
    const by = new Map<
      string,
      { name: string; seconds: number; plays: number }
    >();

    for (const r of forDay) {
      const cur = by.get(r.user_id) || {
        name: r.profiles?.full_name || "Unnamed",
        seconds: 0,
        plays: 0,
      };
      cur.seconds += Number(r.seconds);
      cur.plays += 1;
      by.set(r.user_id, cur);
    }

    return [...by.entries()].sort((a, b) => b[1].seconds - a[1].seconds);
  }, [forDay]);

  // What the open rep spent that day on.
  const breakdown = useMemo(() => {
    if (!openRep) return [];

    const by = new Map<
      string,
      {
        code: string;
        title: string;
        seconds: number;
        plays: number;
        first: number;
        last: number;
        sources: Set<string>;
        voices: Set<string>;
      }
    >();

    for (const r of forDay) {
      if (r.user_id !== openRep) continue;
      const code = r.segments?.segment_code || "unknown";
      const at = new Date(r.created_at).getTime();

      const cur = by.get(code) || {
        code,
        title: r.segments?.title || "",
        seconds: 0,
        plays: 0,
        first: at,
        last: at,
        sources: new Set<string>(),
        voices: new Set<string>(),
      };

      cur.seconds += Number(r.seconds);
      cur.plays += 1;
      // When they worked on it, not just how long. A run of plays at 8am is a
      // different habit from the same total scattered through the day.
      cur.first = Math.min(cur.first, at);
      cur.last = Math.max(cur.last, at);
      // A segment can be worked both ways and against either voice; the row
      // totals them and says which.
      cur.sources.add(r.source);
      if (r.narrators?.name) cur.voices.add(r.narrators.name);
      by.set(code, cur);
    }

    return [...by.values()].sort((a, b) => b.seconds - a.seconds);
  }, [forDay, openRep]);

  const dayTotal = forDay.reduce((n, r) => n + Number(r.seconds), 0);

  if (loading) {
    return (
      <main className="shell">
        <p className="muted">Loading&hellip;</p>
      </main>
    );
  }

  return (
    <main className="shell">
      <div className="topbar">
        <Link className="btn" href="/admin" style={{ textDecoration: "none" }}>
          &larr; Segments
        </Link>
        <Link
          className="btn"
          href="/admin/people"
          style={{ textDecoration: "none" }}
        >
          People
        </Link>
      </div>

      <div className="eyebrow">
        {spell(dayTotal)} on {day}
      </div>
      <h1>Listening</h1>
      <p className="muted">
        Audio actually heard, not time with the page open. Pick a day, then a
        person to see what they worked on.
      </p>

      {error && <div className="error">{error}</div>}

      {days.length === 0 && (
        <p className="muted" style={{ marginTop: 24 }}>
          Nothing logged yet. This fills in as people play segments.
        </p>
      )}

      {days.length > 0 && (
        <>
          <h2>Last 30 days</h2>
          <div className="section-tabs">
            {days.map(([d, secs]) => (
              <button
                key={d}
                aria-pressed={d === day}
                onClick={() => {
                  setDay(d);
                  setOpenRep(null);
                }}
              >
                {d.slice(5)}
                <span className="section-count">{spell(secs)}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {reps.length === 0 ? (
        <p className="muted" style={{ marginTop: 20 }}>
          No listening logged on {day}.
        </p>
      ) : (
        <ul className="list" style={{ marginTop: 20 }}>
          {reps.map(([id, r]) => (
            <li key={id}>
              <button
                onClick={() => setOpenRep(openRep === id ? null : id)}
                style={{
                  width: "100%",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  textAlign: "left",
                }}
              >
                <span>
                  {r.name}
                  <br />
                  <span className="count">
                    {r.plays} {r.plays === 1 ? "play" : "plays"}
                  </span>
                </span>
                <span className="live-count">{spell(r.seconds)}</span>
              </button>

              {openRep === id && (
                <ul className="phrases" style={{ marginTop: 10 }}>
                  {breakdown.map((b) => (
                    <li key={b.code} className="set">
                      <span className="ts">{spell(b.seconds)}</span>
                      <span className="text">
                        <span className="code">{b.code}</span>
                        {b.title ? ` \u00b7 ${b.title}` : ""}
                        {[...b.voices].sort().map((v) => (
                          <span className="source-tag" key={v}>
                            {v}
                          </span>
                        ))}
                        {[...b.sources].sort().map((src) => (
                          <span className="source-tag" key={src}>
                            {src === "read" ? "read-along" : "card"}
                          </span>
                        ))}
                      </span>
                      <span className="count">
                        {b.plays} {b.plays === 1 ? "play" : "plays"}
                        <br />
                        {clock(b.first)}
                        {b.last - b.first > 60_000 ? `\u2013${clock(b.last)}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
