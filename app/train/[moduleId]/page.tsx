"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useKaraoke, type Phrase } from "@/lib/useKaraoke";

type Segment = {
  id: string;
  segment_code: string;
  title: string | null;
  script_text: string;
  tones: string[];
  coaching: string | null;
  client_should_feel: string | null;
  audio_path: string | null;
  timings: Phrase[];
  sort_order: number;
};

export default function Train() {
  const supabase = createClient();
  const params = useParams<{ moduleId: string }>();
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [moduleTitle, setModuleTitle] = useState("");
  const [segments, setSegments] = useState<Segment[]>([]);
  const [index, setIndex] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [loop, setLoop] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const segment = segments[index];
  const phrases: Phrase[] = segment?.timings?.length ? segment.timings : [];
  const { activeIndex } = useKaraoke(audioRef, phrases);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [modRes, segRes] = await Promise.all([
        supabase.from("modules").select("title").eq("id", params.moduleId).single(),
        supabase
          .from("segments")
          .select(
            "id, segment_code, title, script_text, tones, coaching, client_should_feel, audio_path, timings, sort_order"
          )
          .eq("module_id", params.moduleId),
      ]);

      if (cancelled) return;

      if (segRes.error) setError(segRes.error.message);
      setModuleTitle(modRes.data?.title || "Training");
      setSegments(
        ((segRes.data || []) as unknown as Segment[]).sort(
          (a, b) => a.sort_order - b.sort_order
        )
      );
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [params.moduleId, supabase]);

  // Signed URL per segment. Never a permanent public MP3 link.
  useEffect(() => {
    if (!segment?.audio_path) {
      setAudioUrl(null);
      return;
    }

    let cancelled = false;

    supabase.storage
      .from("master-audio")
      .createSignedUrl(segment.audio_path, 3600)
      .then(({ data, error }) => {
        if (cancelled) return;
        setAudioUrl(error ? null : data.signedUrl);
      });

    return () => {
      cancelled = true;
    };
  }, [segment?.id, segment?.audio_path, supabase]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed, audioUrl]);

  async function complete() {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user && segment) {
      await supabase.from("progress").upsert({
        user_id: user.id,
        segment_id: segment.id,
        completed: true,
        updated_at: new Date().toISOString(),
      });
    }

    if (index < segments.length - 1) setIndex(index + 1);
  }

  if (loading) {
    return (
      <main className="shell">
        <p className="muted">Loading…</p>
      </main>
    );
  }

  if (!segment) {
    return (
      <main className="shell">
        <div className="topbar">
          <Link className="btn" href="/" style={{ textDecoration: "none" }}>
            ← Sections
          </Link>
        </div>
        <div className="card">
          <h1>Nothing to practice yet</h1>
          <p className="muted">
            This section has no published segments. An admin can add them from the
            admin area.
          </p>
          {error && <div className="error">{error}</div>}
        </div>
      </main>
    );
  }

  const pct = Math.round(((index + 1) / segments.length) * 100);

  return (
    <main className="shell">
      <div className="topbar">
        <Link className="btn" href="/" style={{ textDecoration: "none" }}>
          ← Sections
        </Link>
        <div className="brand">
          {moduleTitle} · {index + 1} of {segments.length}
        </div>
      </div>

      <div className="progressbar">
        <div style={{ width: `${pct}%` }} />
      </div>

      <div className="tones">
        {segment.tones?.map((t) => (
          <span className="tone" key={t}>
            {t}
          </span>
        ))}
      </div>

      <div className="script" aria-live="polite">
        {phrases.length ? (
          phrases.map((p, i) => (
            <span
              key={i}
              className={`phrase ${
                i < activeIndex ? "spoken" : i === activeIndex ? "current" : ""
              }`}
            >
              {p.text}{" "}
            </span>
          ))
        ) : (
          <span className="phrase">{segment.script_text}</span>
        )}
      </div>

      {audioUrl ? (
        <>
          <audio
            ref={audioRef}
            className="player"
            src={audioUrl}
            loop={loop}
            controls
            preload="metadata"
          />
          <div className="row">
            <button
              onClick={() => {
                const el = audioRef.current;
                if (!el) return;
                el.currentTime = 0;
                el.play();
              }}
            >
              ▶ Play master
            </button>
            <button onClick={() => setLoop(!loop)}>
              ↻ Loop {loop ? "on" : "off"}
            </button>
            <button onClick={() => setSpeed(speed === 1 ? 0.75 : 1)}>
              {speed}× speed
            </button>
          </div>
        </>
      ) : (
        <p className="muted">No master recording uploaded for this one yet.</p>
      )}

      <div className="coaching">
        <div>
          <div className="label">Delivery</div>
          <div className="value">{segment.coaching || "—"}</div>
        </div>
        <div>
          <div className="label">Client should feel</div>
          <div className="value">{segment.client_should_feel || "—"}</div>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="nav">
        <button disabled={index === 0} onClick={() => setIndex(index - 1)}>
          ← Previous
        </button>
        <button className="primary" onClick={complete}>
          {index === segments.length - 1 ? "Mark complete" : "Got it → next"}
        </button>
      </div>
    </main>
  );
}
