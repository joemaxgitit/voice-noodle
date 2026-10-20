"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import MyCards from "./training/MyCards";
import { nextMove, weekStart, type MoveAttempt, type MoveCall, type MoveModule, type NextMove } from "@/lib/nextMove";

/**
 * Today: the one move most likely to lift this rep, found from where they
 * score lowest across their calls and drills, and the quickest way into a
 * practice call. Nothing to compare with anyone else -- this is just theirs.
 */
export default function TodayPanel({
  supabase,
  es,
  roleplayOn,
  userId,
  viewing,
  modules,
  lang,
}: {
  userId: string;
  /** A manager looking at this rep's view. */
  viewing?: boolean;
  supabase: SupabaseClient;
  es: boolean;
  roleplayOn: boolean;
  modules: MoveModule[];
  lang: "en" | "es";
}) {
  const [move, setMove] = useState<NextMove | null>(null);
  const [thisWeek, setThisWeek] = useState(0);

  useEffect(() => {
    if (!userId || !modules.length) return;
    void (async () => {
      const [c, a] = await Promise.all([
        supabase
          .from("calls")
          .select("source, created_at, slp_score, sections:grade->sections, hardship_at:grade->spotlights->hardship->moved_on_at, followup_kind:grade->spotlights->followup->>kind")
          .eq("rep_id", userId)
          .eq("status", "graded")
          .order("created_at", { ascending: false })
          .limit(30),
        supabase.from("attempts").select("segment_id, created_at, scores").eq("user_id", userId).order("created_at", { ascending: false }).limit(120),
      ]);
      setMove(nextMove(modules, (c.data || []) as unknown as MoveCall[], (a.data || []) as MoveAttempt[], lang));
      const { count } = await supabase
        .from("calls")
        .select("id", { count: "exact", head: true })
        .eq("rep_id", userId)
        .eq("source", "roleplay")
        .neq("status", "failed")
        .gte("created_at", weekStart().toISOString());
      setThisWeek(count ?? 0);
    })();
  }, [supabase, userId, modules, lang]);

  const m = move?.module ?? null;
  const goal = move?.goal ?? 2;
  const done = Math.min(thisWeek, goal);

  return (
    <div>
      {/* A card from their manager comes first; nothing shows when there isn't one. */}
      <MyCards supabase={supabase} repId={viewing ? userId : undefined} openOnly empty={null} />

      <section className="my-section">
        <h2>{es ? "Tu siguiente mejor paso" : "Your next best move"}</h2>
        <div className="card next-move">
          {m ? (
            <>
              <div className="k">{es ? "Practica esta sección" : "Drill this section"}</div>
              <h3 style={{ margin: "4px 0 6px" }}>{m.title}</h3>
              <p className="muted" style={{ marginTop: 0 }}>{move!.why}</p>
              <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
                <Link className="btn primary big" href={viewing ? "#" : `/train/${m.id}`} style={{ textDecoration: "none" }}>
                  {es ? "Empezar a practicar" : "Start drilling it"}
                </Link>
                <Link className="btn big" href={viewing ? "#" : "/roleplay"} style={{ textDecoration: "none" }}>
                  {es ? "Luego, una llamada de práctica" : "Then take a practice call"}
                </Link>
              </div>
            </>
          ) : (
            <>
              <p style={{ marginTop: 0 }}>
                {es
                  ? "Aún no hay suficientes llamadas calificadas para saber dónde enfocarte. Una llamada de práctica es la forma más rápida de averiguarlo."
                  : "Not enough graded calls yet to know where to focus. A practice call is the fastest way to find out."}
              </p>
              <Link className="btn primary big" href={viewing ? "#" : "/roleplay"} style={{ textDecoration: "none" }}>
                {es ? "Haz una llamada de práctica" : "Take a practice call"}
              </Link>
            </>
          )}
        </div>
      </section>

      <section className="my-section">
        <h2>{es ? "Esta semana" : "This week"}</h2>
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
            <span>
              <b style={{ fontSize: 22 }}>
                {done} / {goal}
              </b>{" "}
              {es ? "llamadas de práctica" : "practice calls"}
              {done >= goal ? (es ? " -- ¡meta cumplida!" : " -- goal met, nice work") : ""}
            </span>
            <span className="goal-dots" aria-hidden="true">
              {Array.from({ length: goal }, (_, i) => (
                <i key={i} className={i < done ? "on" : ""} />
              ))}
            </span>
          </div>
          <small className="muted">
            {es
              ? "Tu meta se ajusta a lo que más te ayuda practicar. Empieza de nuevo cada lunes."
              : "Your goal is set from what you most need to work on. It starts fresh every Monday -- nothing to lose."}
          </small>
          {!roleplayOn && (
            <p className="hint" style={{ marginBottom: 0 }}>
              {es ? "Las llamadas de práctica están apagadas por ahora." : "Practice calls are switched off right now -- drill your sections in the meantime."}
            </p>
          )}
        </div>
      </section>

    </div>
  );
}
