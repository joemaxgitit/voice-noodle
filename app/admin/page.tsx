"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type Row = {
  id: string;
  segment_code: string;
  title: string | null;
  recordings: { audio_path: string | null }[];
  status: string;
  sort_order: number;
  modules: { title: string; sort_order: number } | null;
};

export default function Admin() {
  const supabase = createClient();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    supabase
      .from("segments")
      .select(
        "id, segment_code, title, status, sort_order, modules(title, sort_order), recordings(audio_path)"
      )
      .then(({ data, error }) => {
        if (error) setError(error.message);
        const list = ((data || []) as unknown as Row[]).sort((a, b) => {
          const am = a.modules?.sort_order ?? 999;
          const bm = b.modules?.sort_order ?? 999;
          return am !== bm ? am - bm : a.sort_order - b.sort_order;
        });
        setRows(list);
        setLoading(false);
      });
  }, [supabase]);

  const voiceCount = (r: Row) =>
    (r.recordings || []).filter((x) => x.audio_path).length;

  const timed = rows.filter((r) => voiceCount(r) > 0).length;

  if (loading) {
    return (
      <main className="shell">
        <p className="muted">Loading…</p>
      </main>
    );
  }

  return (
    <main className="shell">
      <div className="topbar">
        <Link className="btn" href="/proedgesolutions" style={{ textDecoration: "none" }}>
          ← Training
        </Link>
        <Link className="btn" href="/admin/people" style={{ textDecoration: "none" }}>
          People
        </Link>
      </div>

      <div className="eyebrow">
        {timed} of {rows.length} segments recorded
      </div>
      <h1>Segments</h1>
      <p className="muted">
        Pick a segment to upload a master recording and tap its phrase timing.
      </p>

      {error && <div className="error">{error}</div>}

      <ul className="list" style={{ marginTop: 22 }}>
        {rows.map((r) => (
          <li key={r.id}>
            <Link href={`/admin/timing/${r.id}`}>
              <span>
                <span className="code">{r.segment_code}</span>
                <br />
                {r.title || "Untitled"}
              </span>
              <span className="count">
                {voiceCount(r) > 0
                  ? `${voiceCount(r)} ${voiceCount(r) === 1 ? "voice" : "voices"}`
                  : "no audio"}
                {r.status === "draft" ? " \u00b7 draft" : ""}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
