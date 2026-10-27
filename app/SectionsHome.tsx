"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { ShellData } from "./RepShell";

type SentFocus = { title: string; next_call: string | null; drill: string | null };

/**
 * The rep's home: every section of the Options Script, in order, each one
 * opening its practice. Loops follow. Nothing else -- straight into practice.
 */
export default function SectionsHome({ data, lang, viewing }: { data: ShellData; lang: "en" | "es"; viewing?: boolean }) {
  const es = lang === "es";
  // Always open at the top, with the title showing (phones restore an old scroll spot otherwise).
  useEffect(() => {
    if (!viewing) window.scrollTo(0, 0);
  }, [viewing]);
  // A coaching point a manager chose to send to this rep -- only those (never anything a manager didn't send).
  const supabase = useMemo(() => createClient(), []);
  const [focus, setFocus] = useState<SentFocus | null>(null);
  useEffect(() => {
    void supabase
      .from("coaching_focus")
      .select("title, next_call, drill")
      .eq("rep_id", data.userId)
      .eq("shared", true)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .then(({ data: d, error }) => setFocus(error ? null : (((d || []) as SentFocus[])[0] ?? null)));
  }, [supabase, data.userId]);
  const script = data.scripts.find((s) => /options/i.test(s.title)) ?? data.scripts[0];
  const mods = data.modules.filter((m) => (m.language || "en") === lang);
  const sections = script ? mods.filter((m) => m.script_id === script.id && m.kind !== "loop") : [];
  const seen = new Set<string>();
  const loops = mods.filter((m) => m.kind === "loop" && m.segments?.length && !seen.has(m.title.toLowerCase()) && (seen.add(m.title.toLowerCase()), true));

  const row = (m: (typeof mods)[number]) => {
    const total = m.segments?.length ?? 0;
    const done = (m.segments || []).filter((s) => data.done.has(s.id)).length;
    const inner = (
      <>
        <b>{m.title}</b>
        <small className="muted">{total ? `${done}/${total}` : ""}</small>
      </>
    );
    return viewing ? (
      <div key={m.id} className="card sh-row">
        {inner}
      </div>
    ) : (
      <Link key={m.id} href={`/train/${m.id}`} className="card sh-row">
        {inner}
      </Link>
    );
  };

  return (
    <>
      <h1>{script ? script.title.replace(/\s+[—–-]+\s+.*$/, "") : es ? "Guion" : "Script"}</h1>
      <p className="hint" style={{ marginTop: -4 }}>{es ? "Elige una sección y empieza a practicar." : "Pick a section and start practicing."}</p>
      {focus && (
        <div className="card sh-focus">
          <small className="muted">{es ? "De tu coach" : "From your coach"}</small>
          <b>{focus.title}</b>
          {focus.next_call && <span>{focus.next_call}</span>}
          {focus.drill && (
            <small className="muted">
              {es ? "Práctica: " : "Practice: "}
              {focus.drill}
            </small>
          )}
        </div>
      )}
      <div className="sh-list">{sections.map(row)}</div>
      {loops.length > 0 && (
        <>
          <h2 style={{ marginTop: 24 }}>Loops</h2>
          <div className="sh-list">{loops.map(row)}</div>
        </>
      )}
      <style>{`
        .sh-list { display: grid; gap: 8px; }
        .sh-focus { display: grid; gap: 4px; margin: 0 0 14px; padding: 14px 16px; border-color: var(--live); }
        .sh-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 14px 16px; margin: 0; text-decoration: none; color: inherit; }
        a.sh-row:hover { border-color: var(--accent, #e8a33d); }
      `}</style>
    </>
  );
}
