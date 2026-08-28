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
  const [myNarratorId, setMyNarratorId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const [segRes, narRes, profRes] = await Promise.all([
        supabase
          .from("segments")
          .select(
            "id, segment_code, title, script_text, recordings(narrator_id, audio_path, timings, words, version)"
          )
          .eq("id", params.segmentId)
          .single(),
        supabase.from("narrators").select("id, name, sort_order"),
        // Filtered to this user: admins can see every profile in the org, so
        // an unfiltered .single() answers 406 once a second person exists.
        user
          ? supabase
              .from("profiles")
              .select("narrator_id")
              .eq("id", user.id)
              .single()
          : Promise.resolve({ data: null, error: null }),
      ]);

      if (cancelled) return;

      if (segRes.error) setError(segRes.error.message);

      setSegment((segRes.data as unknown as EditorSegment) ?? null);
      setNarrators(
        ((narRes.data || []) as Narrator[]).sort(
          (a, b) => a.sort_order - b.sort_order
        )
      );
      setMyNarratorId(
        (profRes.data as { narrator_id: string | null } | null)?.narrator_id ??
          null
      );
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [params.segmentId, supabase]);

  return (
    <main className="shell">
      <div className="topbar">
        <Link className="btn" href="/admin" style={{ textDecoration: "none" }}>
          &larr; Segments
        </Link>
      </div>
      {loading && <p className="muted">Loading&hellip;</p>}
      {error && <div className="error">{error}</div>}
      {segment && (
        <TimingEditor
          segment={segment}
          narrators={narrators}
          myNarratorId={myNarratorId}
        />
      )}
    </main>
  );
}
