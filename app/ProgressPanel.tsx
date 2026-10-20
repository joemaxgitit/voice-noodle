"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SlpSkill } from "@/lib/calls";
import { skillAverages, type HistCall } from "@/lib/repHistory";
import { LineChart } from "./admin/reps/charts";
import "./admin/reps/reps.css";

type Call = { id: string; created_at: string; slp_score: number | null; status: string; slp: SlpSkill[] | null };
type DoneCard = { id: string; skill: string; closed_at: string | null; practiced: number };

const DAY = 86400000;
const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : null);

/**
 * My progress: the rep against their own past. No rankings, no team
 * averages -- the research is clear that comparing to yourself is what
 * keeps people improving.
 */
export default function ProgressPanel({ supabase, userId, es, linesDone }: { supabase: SupabaseClient; userId: string; es: boolean; linesDone: number }) {
  const [calls, setCalls] = useState<Call[] | null>(null);
  const [quizzes, setQuizzes] = useState<{ score: number; passed: boolean }[]>([]);
  const [cards, setCards] = useState<DoneCard[]>([]);

  useEffect(() => {
    void (async () => {
      const [c, q, k] = await Promise.all([
        supabase
          .from("calls")
          .select("id, created_at, slp_score, status, slp:grade->slp")
          .eq("rep_id", userId)
          .eq("source", "roleplay")
          .eq("status", "graded")
          .order("created_at", { ascending: true })
          .limit(200),
        supabase.from("training_quiz_attempts").select("score, passed").eq("user_id", userId),
        supabase.from("training_cards").select("id, skill, closed_at, practiced").eq("rep_id", userId).eq("status", "closed").order("closed_at", { ascending: false }),
      ]);
      setCalls((c.data || []) as Call[]);
      setQuizzes((q.data || []) as { score: number; passed: boolean }[]);
      setCards((k.data || []) as DoneCard[]);
    })();
  }, [supabase, userId]);

  const now = Date.now();
  const at = (c: Call) => new Date(c.created_at).getTime();
  const recent = useMemo(() => (calls ?? []).filter((c) => at(c) >= now - 30 * DAY), [calls, now]);
  const before = useMemo(() => (calls ?? []).filter((c) => at(c) < now - 30 * DAY && at(c) >= now - 60 * DAY), [calls, now]);

  if (!calls) return <p className="muted">{es ? "Cargando…" : "Loading…"}</p>;

  const scores = (xs: Call[]) => xs.map((c) => c.slp_score).filter((x): x is number => x !== null);
  const slpNow = avg(scores(recent));
  const slpBefore = avg(scores(before));
  const best = calls.reduce<Call | null>((b, c) => (c.slp_score !== null && (!b || c.slp_score > (b.slp_score ?? -1)) ? c : b), null);
  const asHist = (xs: Call[]) => xs as unknown as HistCall[];
  const skillsNow = skillAverages(asHist(recent.length ? recent : calls));
  const skillsBefore = skillAverages(asHist(before));
  const skills = [...skillsNow].sort((a, b) => b[1].avg - a[1].avg);
  const fmt = (x: number) => new Date(x).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const d = slpNow !== null && slpBefore !== null ? slpNow - slpBefore : null;

  return (
    <div>
      <div className="rx-tiles">
        <div className="rx-tile">
          <div className="k">{es ? "Straight Line, 30 días" : "Straight Line, 30 days"}</div>
          <div className="v">{slpNow ?? "--"}</div>
          <div className={`d ${d === null ? "" : d >= 0 ? "rx-up" : ""}`}>
            {d === null ? (es ? "tu práctica" : "your practice calls") : d >= 0 ? `+${d} ${es ? "vs. el mes anterior" : "vs. the month before"}` : `${d} ${es ? "vs. el mes anterior" : "vs. the month before"}`}
          </div>
        </div>
        <div className="rx-tile">
          <div className="k">{es ? "Tu mejor" : "Personal best"}</div>
          <div className="v">{best?.slp_score ?? "--"}</div>
          <div className="d">{best ? new Date(best.created_at).toLocaleDateString() : es ? "aún no" : "not yet"}</div>
        </div>
        <div className="rx-tile">
          <div className="k">{es ? "Llamadas de práctica" : "Practice calls"}</div>
          <div className="v">{recent.length}</div>
          <div className="d">{es ? "en los últimos 30 días" : "in the last 30 days"}</div>
        </div>
        <div className="rx-tile">
          <div className="k">{es ? "Líneas dominadas" : "Script lines done"}</div>
          <div className="v">{linesDone}</div>
          <div className="d">{(() => {
              const n = quizzes.filter((q) => q.passed).length;
              if (!quizzes.length) return "";
              return es ? `${n} ${n === 1 ? "evaluación aprobada" : "evaluaciones aprobadas"}` : `${n} knowledge check${n === 1 ? "" : "s"} passed`;
            })()}</div>
        </div>
      </div>

      <div className="rx-grid2">
        <section className="card">
          <h3 className="rx-sec-title">{es ? "Tu puntaje Straight Line" : "Your Straight Line score"}</h3>
          {calls.some((c) => c.slp_score !== null) ? (
            <LineChart
              series={[
                {
                  name: es ? "Práctica" : "Practice calls",
                  color: "var(--live)",
                  points: calls
                    .filter((c) => c.slp_score !== null)
                    .map((c) => ({ x: at(c), y: c.slp_score!, label: `${fmt(at(c))}: ${c.slp_score}`, href: `/roleplay/${c.id}` })),
                },
              ]}
              fmtX={fmt}
            />
          ) : (
            <p className="hint">
              {es ? "Haz una llamada de práctica y tu progreso aparecerá aquí." : "Run a practice call and your progress shows up here."}{" "}
              <Link href="/roleplay">{es ? "Llamar ahora" : "Call one now"}</Link>
            </p>
          )}
        </section>
        <section className="card">
          <h3 className="rx-sec-title">{es ? "Tus habilidades" : "Your skills"}</h3>
          {!skills.length ? (
            <p className="hint">{es ? "Aparecen después de tu primera llamada calificada." : "These show up after your first graded call."}</p>
          ) : (
            skills.map(([skill, s]) => {
              const p = skillsBefore.get(skill);
              const dd = p ? s.avg - p.avg : null;
              return (
                <div className="rx-skill" key={skill}>
                  <span>{skill}</span>
                  <span className="bar">
                    <i style={{ width: `${s.avg * 10}%` }} />
                  </span>
                  <span className={`delta ${dd !== null && dd >= 0.5 ? "rx-up" : ""}`}>
                    {s.avg.toFixed(1)}
                    {dd !== null && dd >= 0.5 ? " ▲" : ""}
                  </span>
                </div>
              );
            })
          )}
        </section>
      </div>


      {cards.length > 0 && (
        <section className="my-section">
          <h2>{es ? "Lo que has dominado" : "What you've worked through"}</h2>
          {cards.map((c) => (
            <div key={c.id} className="my-mat" style={{ gridTemplateColumns: "minmax(0,1fr) auto" }}>
              <span>
                <b>{c.skill}</b>
                <small>
                  {c.closed_at ? new Date(c.closed_at).toLocaleDateString() : ""}
                  {c.practiced ? ` · ${es ? "practicado" : "practiced"} ${c.practiced}×` : ""}
                </small>
              </span>
              <span className="pill good">{es ? "hecho" : "done"}</span>
            </div>
          ))}
        </section>
      )}
      <p className="hint" style={{ marginTop: 18 }}>
        {es
          ? "Solo tú y tus gerentes ven esto. Sin rankings: es tu progreso contra ti mismo."
          : "Only you and your managers see this. No rankings -- it's you against your own past."}
      </p>
    </div>
  );
}
