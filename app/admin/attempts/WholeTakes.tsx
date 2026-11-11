"use client";

import { useEffect, useState } from "react";
import type { createClient } from "@/lib/supabase/client";
import RunReviewView, { type TakeRow } from "@/app/script/[scriptId]/RunReviewView";

type Row = TakeRow & { user_id: string; scripts: { title: string } | null };
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Whole-script run-throughs reps recorded from the Whole script page, each with its review. Hidden until there is one. */
export default function WholeTakes({ supabase }: { supabase: ReturnType<typeof createClient> }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [openId, setOpenId] = useState<string | null>(null);

  async function load() {
    const { data, error } = await supabase
      .from("script_takes")
      .select("id, user_id, audio_path, seconds, created_at, status, error, score, review, scripts(title)")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error || !data?.length) return;
    const list = data as unknown as Row[];
    setRows(list);
    const ids = [...new Set(list.map((r) => r.user_id))].filter((id) => !names[id]);
    if (ids.length) {
      const { data: ps } = await supabase.from("profiles").select("id, full_name").in("id", ids);
      setNames((n) => ({ ...n, ...Object.fromEntries(((ps || []) as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name || "Unnamed"])) }));
    }
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  const working = rows.some((r) => r.status === "saved" || r.status === "transcribing" || r.status === "reviewing");
  useEffect(() => {
    if (!working) return;
    const id = setInterval(() => void load(), 15_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [working]);

  async function openRow(r: Row) {
    const next = openId === r.id ? null : r.id;
    setOpenId(next);
    if (next && !urls[r.id]) {
      const { data } = await supabase.storage.from("practice-audio").createSignedUrl(r.audio_path, 3600);
      if (data?.signedUrl) setUrls((u) => ({ ...u, [r.id]: data.signedUrl }));
    }
  }

  async function again(r: Row) {
    const { data: sess } = await supabase.auth.getSession();
    await fetch("/api/script-takes/review", {
      method: "POST",
      headers: { authorization: `Bearer ${sess.session?.access_token ?? ""}`, "content-type": "application/json" },
      body: JSON.stringify({ takeId: r.id }),
    });
    await load();
  }

  if (!rows.length) return null;
  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <h3 className="rx-sec-title">Whole script run-throughs</h3>
      {rows.map((r) => (
        <div key={r.id} style={{ padding: "6px 0", borderTop: "1px solid var(--line)" }}>
          <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <b>{names[r.user_id] || "…"}</b>
            <small className="muted">
              {r.scripts?.title ? `${r.scripts.title} · ` : ""}
              {new Date(r.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              {r.seconds ? ` · ${clock(Number(r.seconds))}` : ""}
            </small>
            {r.score != null && <span className={`pill ${r.score >= 85 ? "good" : r.score >= 70 ? "fair" : "poor"}`}>Delivery {r.score}</span>}
            {r.review && <span className="pill">Script {r.review.coverage}%</span>}
            {(r.status === "saved" || r.status === "transcribing" || r.status === "reviewing") && <small className="muted">reviewing&hellip;</small>}
            {r.status === "failed" && (
              <button className="link-btn" onClick={() => again(r)}>
                Review failed &mdash; try again
              </button>
            )}
            <button className="link-btn" onClick={() => openRow(r)}>
              {openId === r.id ? "Close" : "Open review"}
            </button>
          </div>
          {openId === r.id && <RunReviewView take={r} url={urls[r.id] ?? null} />}
        </div>
      ))}
    </section>
  );
}
