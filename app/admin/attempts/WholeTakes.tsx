"use client";

import { useEffect, useState } from "react";
import type { createClient } from "@/lib/supabase/client";

type Row = { id: string; user_id: string; audio_path: string; seconds: number | null; created_at: string; scripts: { title: string } | null };
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Whole-script run-throughs reps recorded from the Whole script page. Hidden until there is one. */
export default function WholeTakes({ supabase }: { supabase: ReturnType<typeof createClient> }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    void (async () => {
      const { data, error } = await supabase.from("script_takes").select("id, user_id, audio_path, seconds, created_at, scripts(title)").order("created_at", { ascending: false }).limit(50);
      if (error || !data?.length) return;
      const list = data as unknown as Row[];
      setRows(list);
      const ids = [...new Set(list.map((r) => r.user_id))];
      const { data: ps } = await supabase.from("profiles").select("id, full_name").in("id", ids);
      setNames(Object.fromEntries(((ps || []) as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name || "Unnamed"])));
    })();
  }, [supabase]);

  async function hear(r: Row) {
    const { data } = await supabase.storage.from("practice-audio").createSignedUrl(r.audio_path, 3600);
    if (data?.signedUrl) setUrls((u) => ({ ...u, [r.id]: data.signedUrl }));
  }

  if (!rows.length) return null;
  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <h3 className="rx-sec-title">Whole script run-throughs</h3>
      {rows.map((r) => (
        <div key={r.id} style={{ padding: "6px 0", borderTop: "1px solid var(--line)" }}>
          <b>{names[r.user_id] || "…"}</b>{" "}
          <small className="muted">
            {r.scripts?.title ? `${r.scripts.title} · ` : ""}
            {new Date(r.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
            {r.seconds ? ` · ${clock(Number(r.seconds))}` : ""}
          </small>{" "}
          {urls[r.id] ? (
            <audio controls autoPlay src={urls[r.id]} style={{ width: "100%", marginTop: 4 }} />
          ) : (
            <button className="link-btn" onClick={() => hear(r)}>
              Listen
            </button>
          )}
        </div>
      ))}
    </section>
  );
}
