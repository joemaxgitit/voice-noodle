"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { paceNote, type Scores } from "@/lib/score";

type Row = {
  id: string;
  audio_path: string;
  seconds: number | null;
  scores: Scores | null;
  created_at: string;
  user_id: string;
  profiles: { full_name: string | null } | null;
  segments: { segment_code: string; title: string | null } | null;
  narrators: { name: string } | null;
};

function when(iso: string): string {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return today
    ? time
    : `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}

function band(n: number): string {
  return n >= 80 ? "good" : n >= 55 ? "fair" : "poor";
}

const avg = (ns: number[]) =>
  ns.length ? Math.round(ns.reduce((a, b) => a + b, 0) / ns.length) : null;

/**
 * Every practice attempt, with its scores.
 *
 * The rep-facing side of this is a practice tool; this is the assessment
 * side. Same recordings, same numbers -- what differs is that a manager can
 * hear across the team and over time, which is what makes it coachable.
 *
 * Averages are shown per person because a single attempt says very little:
 * a rep can fluff one take and nail the next, and the pattern is the signal.
 */
export default function Attempts() {
  const supabase = createClient();

  const [rows, setRows] = useState<Row[]>([]);
  const [who, setWho] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from("attempts")
        .select(
          "id, audio_path, seconds, scores, created_at, user_id, profiles(full_name), segments(segment_code, title), narrators(name)"
        )
        .order("created_at", { ascending: false })
        .limit(200);

      if (cancelled) return;

      if (error) setError(error.message);
      setRows((data || []) as unknown as Row[]);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [supabase]);

  // One card per person: how much they have done, and how it is going.
  const people = useMemo(() => {
    const by = new Map<
      string,
      { name: string; count: number; pace: number[]; pauses: number[]; clarity: number[] }
    >();

    for (const r of rows) {
      const cur = by.get(r.user_id) || {
        name: r.profiles?.full_name || "Unnamed",
        count: 0,
        pace: [],
        pauses: [],
        clarity: [],
      };

      cur.count += 1;

      if (r.scores) {
        cur.pace.push(r.scores.pace);
        cur.clarity.push(r.scores.clarity);
        if (r.scores.pauses !== null) cur.pauses.push(r.scores.pauses);
      }

      by.set(r.user_id, cur);
    }

    return [...by.entries()].sort((a, b) => b[1].count - a[1].count);
  }, [rows]);

  const shown = useMemo(
    () => (who ? rows.filter((r) => r.user_id === who) : rows),
    [rows, who]
  );

  async function hear(r: Row) {
    setError("");
    setPlaying(r.id);

    try {
      const { data, error } = await supabase.storage
        .from("practice-audio")
        .createSignedUrl(r.audio_path, 3600);

      if (error) throw error;

      const audio = new Audio(data.signedUrl);
      audio.onended = () => setPlaying(null);
      audio.onerror = () => {
        setPlaying(null);
        setError("That recording could not be played.");
      };
      await audio.play();
    } catch (e) {
      setPlaying(null);
      setError(e instanceof Error ? e.message : "Could not play that take.");
    }
  }

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
          href="/admin/listening"
          style={{ textDecoration: "none" }}
        >
          Listening
        </Link>
      </div>

      <div className="eyebrow">
        {rows.length} {rows.length === 1 ? "attempt" : "attempts"}
        {rows.length === 200 ? " (most recent)" : ""}
      </div>
      <h1>Practice attempts</h1>
      <p className="muted">
        Scores compare each take to the master that rep was listening to. A
        single attempt says little &mdash; look for the pattern.
      </p>

      {error && <div className="error">{error}</div>}

      {rows.length === 0 && (
        <p className="muted" style={{ marginTop: 24 }}>
          Nothing recorded yet. This fills in as reps practise.
        </p>
      )}

      {people.length > 0 && (
        <>
          <h2>By person</h2>
          <div className="section-tabs">
            <button aria-pressed={who === null} onClick={() => setWho(null)}>
              Everyone
              <span className="section-count">{rows.length}</span>
            </button>
            {people.map(([id, p]) => (
              <button
                key={id}
                aria-pressed={who === id}
                onClick={() => setWho(who === id ? null : id)}
              >
                {p.name}
                <span className="section-count">{p.count}</span>
              </button>
            ))}
          </div>

          {who && (
            <>
              {people
                .filter(([id]) => id === who)
                .map(([id, p]) => {
                  const pace = avg(p.pace);
                  const pauses = avg(p.pauses);
                  const clarity = avg(p.clarity);

                  return (
                    <p className="hint" key={id} style={{ marginTop: 12 }}>
                      {pace === null ? (
                        "No scored attempts yet."
                      ) : (
                        <>
                          Average across {p.pace.length} scored{" "}
                          {p.pace.length === 1 ? "attempt" : "attempts"}
                          {": "}
                          <span className="scores" style={{ marginLeft: 0 }}>
                            <span className={`score ${band(pace)}`}>
                              Pace {pace}
                            </span>
                            {pauses !== null && (
                              <span className={`score ${band(pauses)}`}>
                                Pauses {pauses}
                              </span>
                            )}
                            {clarity !== null && (
                              <span className={`score ${band(clarity)}`}>
                                Clarity {clarity}
                              </span>
                            )}
                          </span>
                        </>
                      )}
                    </p>
                  );
                })}
            </>
          )}
        </>
      )}

      {shown.length > 0 && (
        <ul className="list" style={{ marginTop: 22 }}>
          {shown.map((r) => (
            <li key={r.id}>
              <div className="attempt">
                <button className="ts" onClick={() => hear(r)}>
                  {playing === r.id ? "\u25b6" : "\u25b7"}
                </button>

                <span className="attempt-when">
                  <span className="code">
                    {r.segments?.segment_code || "unknown"}
                  </span>
                  {r.segments?.title ? ` \u00b7 ${r.segments.title}` : ""}
                  <br />
                  <span className="count">
                    {who ? "" : `${r.profiles?.full_name || "Unnamed"} \u00b7 `}
                    {when(r.created_at)}
                    {r.seconds ? ` \u00b7 ${r.seconds.toFixed(1)}s` : ""}
                    {r.narrators?.name ? ` \u00b7 vs ${r.narrators.name}` : ""}
                  </span>
                </span>

                {r.scores ? (
                  <span className="scores">
                    <span className={`score ${band(r.scores.pace)}`}>
                      Pace {r.scores.pace}
                    </span>
                    {r.scores.pauses !== null && (
                      <span className={`score ${band(r.scores.pauses)}`}>
                        Pauses {r.scores.pauses}
                      </span>
                    )}
                    <span className={`score ${band(r.scores.clarity)}`}>
                      Clarity {r.scores.clarity}
                    </span>
                  </span>
                ) : (
                  <span className="count" style={{ marginLeft: "auto" }}>
                    not scored
                  </span>
                )}
              </div>

              {r.scores && (
                <p className="attempt-note">
                  {paceNote(r.scores.paceDelta)}
                  {r.scores.rushed.length > 0 &&
                    ` \u00b7 ${r.scores.rushed.length} ${
                      r.scores.rushed.length === 1 ? "word" : "words"
                    } rushed`}
                  {r.scores.missedPauses.length > 0 &&
                    ` \u00b7 missed ${r.scores.missedPauses.length} of ${r.scores.pauseCount} pauses`}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
