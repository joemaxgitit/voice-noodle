"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useLang } from "@/lib/lang";
import type { RepFeedback } from "@/lib/repFeedback";

/*
  A rep's feedback on their calls -- only what a manager reviewed and sent
  (supabase/rep-feedback.sql). Reps never see a call's grade itself.
*/
export default function MyFeedback() {
  const supabase = useMemo(() => createClient(), []);
  const es = useLang() === "es";
  const [rows, setRows] = useState<RepFeedback[] | null>(null);

  useEffect(() => {
    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return setRows([]);
      const { data } = await supabase
        .from("rep_feedback")
        .select("id, created_at, seen_at, sent_by_name, call_date, script_title, content")
        .eq("rep_id", session.user.id)
        .order("created_at", { ascending: false })
        .limit(50);
      const list = (data || []) as RepFeedback[];
      setRows(list);
      // Opening the page counts as seen.
      for (const f of list) if (!f.seen_at) void supabase.rpc("mark_feedback_seen", { p_id: f.id });
    })();
  }, [supabase]);

  const day = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString(es ? "es-US" : "en-US", { weekday: "short", month: "short", day: "numeric" }) : "");

  return (
    <main className="shell" style={{ maxWidth: 760 }}>
      <div className="eyebrow">{es ? "Tus llamadas" : "Your calls"}</div>
      <h1>{es ? "Mis comentarios" : "My feedback"}</h1>
      <p className="muted">{es ? "Comentarios de tu gerente sobre tus llamadas." : "Notes from your manager on your calls."}</p>
      {rows === null && <p className="muted">{es ? "Cargando…" : "Loading…"}</p>}
      {rows?.length === 0 && <p className="muted">{es ? "Todavía no hay nada aquí." : "Nothing here yet."}</p>}
      {rows?.map((f) => {
        const c = f.content;
        return (
          <section key={f.id} className="card" style={{ marginTop: 14 }}>
            <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <b>
                {es ? "Llamada del" : "Call on"} {day(f.call_date)}
                {f.script_title ? <span className="muted"> · {f.script_title}</span> : null}
              </b>
              <span className="row" style={{ gap: 8 }}>
                {!f.seen_at && <span className="pill good">{es ? "Nuevo" : "New"}</span>}
                {typeof c.score === "number" && <span className="pill">{c.score}</span>}
              </span>
            </div>
            {f.sent_by_name && (
              <small className="muted">
                {es ? "De" : "From"} {f.sent_by_name}
              </small>
            )}
            {c.note && <p style={{ margin: "10px 0 0", lineHeight: 1.55 }}>{c.note}</p>}
            {c.did_well.length > 0 && (
              <>
                <div className="cn-label" style={{ marginTop: 12 }}>
                  {es ? "Lo que hiciste bien" : "Did well"}
                </div>
                <ul style={{ margin: "4px 0 0", paddingLeft: 18, display: "grid", gap: 4 }}>
                  {c.did_well.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              </>
            )}
            {c.work_on && (
              <>
                <div className="cn-label" style={{ marginTop: 12 }}>
                  {es ? "Para mejorar" : "Work on"}
                </div>
                <p style={{ margin: "4px 0 0" }}>
                  <b>{c.work_on.title}</b>
                </p>
                {c.work_on.what_happened && <p style={{ margin: "6px 0 0", lineHeight: 1.55 }}>{c.work_on.what_happened}</p>}
                {c.work_on.next_call && (
                  <p style={{ margin: "6px 0 0", lineHeight: 1.55 }}>
                    <b>{es ? "En la próxima llamada: " : "Next call: "}</b>
                    {c.work_on.next_call}
                  </p>
                )}
                {c.work_on.practice && (
                  <p style={{ margin: "6px 0 0", lineHeight: 1.55 }}>
                    <b>{es ? "Práctica: " : "Practice: "}</b>
                    {c.work_on.practice}
                  </p>
                )}
              </>
            )}
          </section>
        );
      })}
    </main>
  );
}
