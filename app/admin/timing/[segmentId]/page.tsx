"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import TimingEditor, {
  type EditorSegment,
  type Narrator,
} from "./TimingEditor";

export default function TimingPage() {
  const supabase = createClient();
  const params = useParams<{ segmentId: string }>();

  const [segment, setSegment] = useState<EditorSegment | null>(null);
  const [narrators, setNarrators] = useState<Narrator[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      supabase
        .from("segments")
        .select(
          "id, segment_code, title, script_text, recordings(narrator_id, audio_path, timings, words, version)"
        )
        .eq("id", params.segmentId)
        .single(),
      supabase.from("narrators").select("id, name, sort_order"),
    ]).then(([segRes, narRes]) => {
      if (segRes.error) setError(segRes.error.message);
      setSegment((segRes.data as unknown as EditorSegment) ?? null);
      setNarrators(
        ((narRes.data || []) as Narrator[]).sort(
          (a, b) => a.sort_order - b.sort_order
        )
      );
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
      {segment && <TimingEditor segment={segment} narrators={narrators} />}
    </main>
  );
}
