"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  useKaraoke,
  marksToPhrases,
  splitIntoPhrases,
  type Phrase,
} from "@/lib/useKaraoke";

export type EditorSegment = {
  id: string;
  segment_code: string;
  title: string | null;
  script_text: string;
  audio_path: string | null;
  timings: Phrase[];
  version: number;
};

/**
 * Replaces hand-writing timestamp JSON.
 *
 * Split the script into phrases, play the recording, tap the spacebar as each
 * phrase begins. A 15-second clip is timed in 15 seconds.
 */
export default function TimingEditor({ segment }: { segment: EditorSegment }) {
  const supabase = createClient();
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);

  const [raw, setRaw] = useState(
    segment.timings?.length
      ? segment.timings.map((p) => p.text).join("\n")
      : splitIntoPhrases(segment.script_text).join("\n")
  );

  const [marks, setMarks] = useState<number[]>(
    (segment.timings || []).map((p) => p.start)
  );
  const [armed, setArmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const lines = useMemo(
    () => raw.split("\n").map((l) => l.trim()).filter(Boolean),
    [raw]
  );

  const phrases = useMemo(
    () => marksToPhrases(lines, marks, duration),
    [lines, marks, duration]
  );

  const { activeIndex, playing } = useKaraoke(audioRef, phrases);

  // A newly chosen local file wins over the stored recording.
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setAudioUrl(url);
    setMarks([]);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    if (file || !segment.audio_path) return;
    let cancelled = false;

    supabase.storage
      .from("master-audio")
      .createSignedUrl(segment.audio_path, 3600)
      .then(({ data }) => {
        if (!cancelled && data) setAudioUrl(data.signedUrl);
      });

    return () => {
      cancelled = true;
    };
  }, [file, segment.audio_path, supabase]);

  useEffect(() => {
    if (!armed) return;

    const onKey = (e: KeyboardEvent) => {
      const el = audioRef.current;
      if (!el) return;

      if (e.code === "Space") {
        e.preventDefault();
        setMarks((m) => (m.length >= lines.length ? m : [...m, el.currentTime]));
      } else if (e.code === "Backspace") {
        e.preventDefault();
        setMarks((m) => (m.length > 1 ? m.slice(0, -1) : m));
      } else if (e.code === "Escape") {
        e.preventDefault();
        setArmed(false);
        el.pause();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [armed, lines.length]);

  function startTapping() {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = 0;
    setMarks([0]);
    setArmed(true);
    void el.play();
  }

  function nudge(i: number, delta: number) {
    setMarks((m) => {
      const next = [...m];
      if (next[i] === undefined) return m;
      next[i] = Math.max(0, Math.round((next[i] + delta) * 1000) / 1000);
      return next;
    });
  }

  function playFrom(i: number) {
    const el = audioRef.current;
    if (!el || marks[i] === undefined) return;
    el.currentTime = marks[i];
    void el.play();
  }

  async function save() {
    setSaving(true);
    setStatus("");
    setError("");

    try {
      let audioPath = segment.audio_path;
      let version = segment.version;

      if (file) {
        const { data: profile, error: profileErr } = await supabase
          .from("profiles")
          .select("org_id")
          .single();

        if (profileErr) throw profileErr;
        if (!profile?.org_id) {
          throw new Error("Your profile has no organization set.");
        }

        version = segment.version + 1;
        audioPath = `${profile.org_id}/${segment.segment_code}-v${version}.mp3`;

        const { error: upErr } = await supabase.storage
          .from("master-audio")
          .upload(audioPath, file, {
            contentType: file.type || "audio/mpeg",
            upsert: true,
          });

        if (upErr) throw upErr;

        // Snapshot what we are replacing so it can be restored later.
        if (segment.audio_path) {
          await supabase.from("segment_versions").insert({
            segment_id: segment.id,
            version: segment.version,
            audio_path: segment.audio_path,
            timings: segment.timings,
            script_text: segment.script_text,
          });
        }
      }

      const { error: updErr } = await supabase
        .from("segments")
        .update({
          audio_path: audioPath,
          timings: phrases,
          version,
          status: "published",
          updated_at: new Date().toISOString(),
        })
        .eq("id", segment.id);

      if (updErr) throw updErr;

      setStatus(`Published as v${version}. Reps get it on their next load.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  const remaining = lines.length - marks.length;

  return (
    <div>
      <div className="code">{segment.segment_code}</div>
      <h1>{segment.title || "Untitled segment"}</h1>
      <p className="muted">Currently v{segment.version}</p>

      <h2>1 · Recording</h2>
      <input
        type="file"
        accept="audio/*"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      {audioUrl ? (
        <audio
          ref={audioRef}
          className="player"
          src={audioUrl}
          controls
          preload="metadata"
          style={{ marginTop: 12 }}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        />
      ) : (
        <p className="hint" style={{ marginTop: 12 }}>
          Choose an MP3 to time.
        </p>
      )}

      <h2>2 · Phrasing</h2>
      <p className="hint">
        One phrase per line. Break on thought groups, not sentences — this is
        exactly what the rep will watch illuminate.
      </p>
      <textarea
        rows={Math.max(4, lines.length + 2)}
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        disabled={armed}
      />

      <h2>3 · Tap the timing</h2>
      <p className="hint">
        Press start, then hit <kbd>Space</kbd> the instant each new phrase begins.{" "}
        <kbd>Backspace</kbd> undoes the last tap. <kbd>Esc</kbd> stops.
      </p>

      <div className="row">
        <button onClick={startTapping} disabled={!audioUrl || armed}>
          Start tapping
        </button>
        <button onClick={() => setMarks([])} disabled={armed}>
          Clear marks
        </button>
        {armed && (
          <span className="live-count">
            {remaining > 0
              ? `${remaining} phrase${remaining === 1 ? "" : "s"} to go`
              : "All marked — press Esc"}
          </span>
        )}
      </div>

      <ol className="phrases">
        {lines.map((text, i) => (
          <li
            key={i}
            className={
              i === activeIndex
                ? "current"
                : marks[i] !== undefined
                ? "set"
                : ""
            }
          >
            <button className="ts" onClick={() => playFrom(i)}>
              {marks[i] !== undefined ? `${marks[i].toFixed(2)}s` : "—"}
            </button>
            <span className="text">{text}</span>
            <span className="nudges">
              <button
                onClick={() => nudge(i, -0.05)}
                disabled={marks[i] === undefined}
                aria-label="Move earlier"
              >
                −
              </button>
              <button
                onClick={() => nudge(i, 0.05)}
                disabled={marks[i] === undefined}
                aria-label="Move later"
              >
                +
              </button>
            </span>
          </li>
        ))}
      </ol>

      <h2>4 · Preview and publish</h2>
      <div className="script">
        {phrases.map((p, i) => (
          <span
            key={i}
            className={`phrase ${
              i < activeIndex ? "spoken" : i === activeIndex ? "current" : ""
            }`}
          >
            {p.text}{" "}
          </span>
        ))}
      </div>

      <div className="row">
        <button
          onClick={() => {
            const el = audioRef.current;
            if (!el) return;
            el.currentTime = 0;
            void el.play();
          }}
          disabled={!audioUrl}
        >
          {playing ? "Playing…" : "▶ Preview karaoke"}
        </button>
        <button
          className="primary"
          onClick={save}
          disabled={saving || lines.length === 0 || marks.length !== lines.length}
        >
          {saving ? "Saving…" : file ? "Upload and publish" : "Save timings"}
        </button>
      </div>

      {marks.length !== lines.length && (
        <p className="hint" style={{ marginTop: 10 }}>
          Mark every phrase before publishing.
        </p>
      )}
      {status && <p className="status">{status}</p>}
      {error && <div className="error">{error}</div>}
    </div>
  );
}
