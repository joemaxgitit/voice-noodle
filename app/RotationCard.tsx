"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fmtDay, fmtHours, score } from "@/lib/rotation";

type Daily = { day: string; for_day: string; talk_hours: number | null; calls: number | null; deals: number | null; points: number; made: boolean; override_made: boolean | null };

/**
 * A rep's own last working day and rotation result, from the manager's
 * nightly upload. Only their own numbers -- nobody else's, no ranking.
 */
export default function RotationCard({ supabase, userId, es, strip }: { supabase: SupabaseClient; userId: string; es: boolean; strip?: boolean }) {
  const [rows, setRows] = useState<Daily[] | null>(null);

  useEffect(() => {
    void supabase
      .from("rep_daily")
      .select("day, for_day, talk_hours, calls, deals, points, made, override_made")
      .eq("rep_id", userId)
      .order("day", { ascending: false })
      .limit(20)
      .then(({ data }) =>
        setRows(((data || []) as Daily[]).map((d) => ({ ...d, talk_hours: d.talk_hours === null ? null : Number(d.talk_hours), deals: d.deals === null ? null : Number(d.deals), points: Number(d.points) })))
      );
  }, [supabase, userId]);

  if (!rows || !rows.length) return null;
  const last = rows[0];
  const made = last.override_made ?? last.made;
  const hint = made ? "" : score(last).hint;

  if (strip) {
    const recent = rows.slice(0, 10).reverse();
    const n = recent.filter((d) => d.override_made ?? d.made).length;
    let streak = 0;
    for (const d of rows) {
      if (d.override_made ?? d.made) streak++;
      else break;
    }
    return (
      <section className="card" style={{ marginTop: 14 }}>
        <h3 className="rx-sec-title">{es ? "Rotación" : "Rotation"}</h3>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", margin: "4px 0 8px" }}>
          {recent.map((d) => {
            const ok = d.override_made ?? d.made;
            return (
              <span
                key={d.day}
                title={`${fmtDay(d.day, true)}: ${d.points} pt -- ${fmtHours(d.talk_hours)}, ${d.calls ?? 0} calls, ${d.deals ?? 0} deals`}
                className={`rot-cell ${ok ? "in" : "out"}`}
                style={{ display: "inline-grid", placeItems: "center" }}
              >
                {ok ? "✓" : "✗"}
              </span>
            );
          })}
        </div>
        <p className="hint" style={{ margin: 0 }}>
          {es
            ? `Lograste rotación ${n} de tus últimos ${recent.length} días${streak > 1 ? ` · racha de ${streak}` : ""}.`
            : `Made rotation ${n} of your last ${recent.length} days${streak > 1 ? ` · ${streak} in a row` : ""}.`}
        </p>
      </section>
    );
  }

  return (
    <section className="my-section">
      <h2>{fmtDay(last.day, true)}</h2>
      <div className="card" style={{ borderLeft: `4px solid ${made ? "var(--ok)" : "var(--bad)"}` }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 18px", fontSize: 15 }}>
          <span>
            <b>{fmtHours(last.talk_hours)}</b> {es ? "de conversación" : "talk time"}
          </span>
          <span>
            <b>{last.calls ?? 0}</b> {es ? "llamadas" : "calls"}
          </span>
          <span>
            <b>{last.deals ?? 0}</b> {es ? "inscripciones" : last.deals === 1 ? "deal" : "deals"}
          </span>
          <span>
            <b>{last.points}</b> {es ? "pts" : "pts"}
          </span>
        </div>
        <p style={{ margin: "8px 0 0", fontWeight: 650, color: made ? "var(--ok)" : "var(--text)" }}>
          {made
            ? es
              ? `Estás en rotación para el ${fmtDay(last.for_day, true)}.`
              : `You're in rotation for ${fmtDay(last.for_day, true)}.`
            : es
              ? `No llegaste a rotación para el ${fmtDay(last.for_day, true)}.`
              : `Missed rotation for ${fmtDay(last.for_day, true)}.`}
        </p>
        {!made && hint && (
          <p className="hint" style={{ margin: "2px 0 0" }}>
            {es ? "Te faltó: " : "You "}
            {es ? hint.replace(/^needed /, "") : hint}.
          </p>
        )}
        <p className="hint" style={{ margin: "6px 0 0" }}>
          {es ? "1 punto: 2.5h = 0.5 o 4h = 1 · 60 llamadas = 0.5 o 90 = 1 · cada inscripción 0.5" : "1 point gets you in: 2.5h talk = 0.5 or 4h = 1 · 60 calls = 0.5 or 90 = 1 · each deal 0.5"}
        </p>
      </div>
    </section>
  );
}
