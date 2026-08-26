"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import TimingEditor, { type EditorSegment } from "./TimingEditor";

export default function TimingPage() {
  const supabase = createClient();
  const params = useParams<{ segmentId: string }>();

  const [segment, setSegment] = useState<EditorSegment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    supabase
      .from("segments")
      .select(
        "id, segment_code, title, script_text, audio_path, timings, version"
      )
      .eq("id", params.segmentId)
      .single()
      .then(({ data, error }) => {
        if (error) setError(error.message);
        setSegment((data as unknown as EditorSegment) ?? null);
        setLoading(false);
      });
  }, [params.segmentId, supabase]);

  return (
    <main className="shell">
      <div className="topbar">
        <Link className="btn" href="/admin" style={{ textDecoration: "none" }}>
          ← Segments
        </Link>
      </div>

      {loading && <p className="muted">Loading…</p>}
      {error && <div className="error">{error}</div>}
      {segment && <TimingEditor segment={segment} />}
    </main>
  );
}
