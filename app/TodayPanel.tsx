"use client";

import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import MyCards from "./training/MyCards";
import RotationCard from "./RotationCard";

type Mod = { id: string; title: string; total: number; complete: number };

/**
 * Today: the one thing to work on, and the quickest way to practice it.
 * Nothing to compare with anyone else -- this is just theirs.
 */
export default function TodayPanel({
  supabase,
  es,
  resume,
  roleplayOn,
  openPractice,
  userId,
}: {
  userId: string;
  supabase: SupabaseClient;
  es: boolean;
  resume: Mod | null;
  roleplayOn: boolean;
  openPractice: () => void;
}) {
  return (
    <div>
      <MyCards
        supabase={supabase}
        openOnly
        empty={
          <section className="my-section">
            <h2>{es ? "Tu enfoque" : "Your focus"}</h2>
            <div className="card">
              <p style={{ margin: 0 }}>
                {es
                  ? "No tienes una tarjeta abierta ahora. Practica una sección del guion o haz una llamada de práctica."
                  : "No focus card right now. When your manager sends one, it shows up here. Meanwhile, drill a script section or run a practice call."}
              </p>
            </div>
          </section>
        }
      />

      {userId && <RotationCard supabase={supabase} userId={userId} es={es} />}

      <section className="my-section">
        <h2>{es ? "Práctica rápida" : "Quick practice"}</h2>
        <div className="today-grid">
          {resume ? (
            <Link href={`/train/${resume.id}`} className="today-tile">
              <span className="k">{es ? "Sigue donde lo dejaste" : "Pick up where you left off"}</span>
              <b>{resume.title}</b>
              <span className="tr-progress">
                <i style={{ width: `${resume.total ? (100 * resume.complete) / resume.total : 0}%` }} />
              </span>
              <small>
                {resume.complete} / {resume.total} {es ? "líneas" : "lines"}
              </small>
            </Link>
          ) : (
            <button className="today-tile" onClick={openPractice}>
              <span className="k">{es ? "Guion" : "Script"}</span>
              <b>{es ? "Elige una sección" : "Pick a section to drill"}</b>
            </button>
          )}
          {roleplayOn && (
            <Link href="/roleplay" className="today-tile">
              <span className="k">{es ? "Llamada de práctica" : "Practice call"}</span>
              <b>{es ? "Llama a un cliente de práctica" : "Call a practice client"}</b>
              <small>{es ? "Calificada en Straight Line, solo para ti y tus gerentes" : "Graded on the Straight Line -- just you and your managers see it"}</small>
            </Link>
          )}
          <Link href="/training" className="today-tile">
            <span className="k">{es ? "Mi capacitación" : "My training"}</span>
            <b>{es ? "Calendario, tareas y biblioteca" : "Schedule, to-dos and library"}</b>
          </Link>
        </div>
      </section>
    </div>
  );
}
