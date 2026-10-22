"use client";

import { useEffect, useState } from "react";
import type { createClient } from "@/lib/supabase/client";
import { clock } from "@/lib/calls";
import { SHORT_LABEL, type Quick } from "@/lib/quick";

const PARTS: [keyof Extract<Quick, { kind: "voicemail" }>["parts"], string, number][] = [
  ["who", "Name and company", 20],
  ["reason", "Reason to call back", 20],
  ["callback", "Callback number", 15],
  ["length", "Length", 15],
  ["tone", "Tone", 15],
  ["safe", "Safe to hear", 15],
];

/** A voicemail's score or a short call's read -- kept apart from every grade and average. */
export default function QuickCard({ supabase, callId, status }: { supabase: ReturnType<typeof createClient>; callId: string; status: string }) {
  const [q, setQ] = useState<Quick | null>(null);
  useEffect(() => {
    void supabase
      .from("calls")
      .select("kind, quick")
      .eq("id", callId)
      .maybeSingle()
      .then(({ data, error }) => setQ(!error && data?.quick && status === "read" ? (data.quick as Quick) : null));
  }, [supabase, callId, status]);
  if (!q) return null;

  const band = (n: number, of: number) => (n >= of * 0.75 ? "good" : n >= of * 0.45 ? "fair" : "poor");
  return (
    <section className="card no-print" style={{ marginTop: 14 }}>
      {q.kind === "voicemail" ? (
        <>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
            <b>Voicemail</b>
            <span className={`pill ${band(q.score, 100)}`}>Voicemail score {q.score}</span>
          </div>
          <p style={{ margin: "8px 0" }}>{q.read}</p>
          <p className="muted" style={{ margin: "0 0 8px" }}>
            &ldquo;{q.said}&rdquo; · {q.rep_secs}s · mood {q.mood}/10{q.mood_word ? ` (${q.mood_word})` : ""}
          </p>
          {q.flag && <div className="error" style={{ margin: "0 0 8px" }}>On the message: {q.flag}</div>}
          <div style={{ display: "grid", gap: 4 }}>
            {PARTS.map(([k, label, of]) => (
              <div key={k} className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                <span>{label}</span>
                <span className={`pill ${band(q.parts[k], of)}`}>
                  {q.parts[k]}/{of}
                </span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
            <b>{SHORT_LABEL[q.what]}</b>
            <span className="muted">
              mood {q.mood}/10{q.mood_word ? ` (${q.mood_word})` : ""}
            </span>
          </div>
          <p style={{ margin: "8px 0" }}>{q.read}</p>
          <p className="muted" style={{ margin: 0 }}>
            Opening: {q.opening || "--"}
            {q.ended_at != null ? ` · ended at ${clock(q.ended_at)}` : ""}
            {q.ended_by !== "unclear" ? ` by the ${q.ended_by}` : ""}
          </p>
        </>
      )}
      <p className="hint" style={{ margin: "8px 0 0" }}>
        A quick read, not a full grade: it never counts toward the Straight Line or Script scores, best calls or averages. If this was really a full conversation, press Grade it fully.
      </p>
    </section>
  );
}
