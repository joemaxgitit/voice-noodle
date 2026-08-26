"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  useKaraoke,
  marksToPhrases,
  wordsToPhrases,
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
  words: Phrase[] | null;
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

  const [file, setFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const [raw, setRaw] = useState(
    segment.timings?.length
      ? segment.timings.map((p) => p.text).join("\n")
      : splitIntoPhrases(segment.script_text).join("\n")
  );

  const [marks, setMarks] = useState<number[]>(
    (segment.timings || []).map((p) => p.start)
  );
  const [armed, setArmed] = useState(false);
  const [words, setWords] = useState<Phrase[]>(segment.words || []);
  const [aligning, setAligning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const lines = useMemo(
    () => raw.split("\n").map((l) => l.trim()).filter(Boolean),
    [raw]
  );

  // duration comes from the hook, which listens for loadedmetadata itself
  const [phrases, setPhrases] = useState<Phrase[]>([]);
  const { audio, setAudioEl, duration, playing, activeIndex } =
    useKaraoke(phrases);

  useEffect(() => {
    // Aligned words win. Tapped marks are the fallback.
    setPhrases(
      words.length
        ? wordsToPhrases(lines, words)
        : marksToPhrases(lines, marks, duration)
    );
  }, [lines, marks, duration, words]);

  // A newly chosen local file wins over the stored recording.
  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setAudioUrl(url);
    setMarks([]);
    setWords([]);
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
    if (!armed || !audio) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        setMarks((m) =>
          m.length >= lines.length ? m : [...m, audio.currentTime]
        );
      } else if (e.code === "Backspace") {
        e.preventDefault();
        setMarks((m) => (m.length > 1 ? m.slice(0, -1) : m));
      } else if (e.code === "Escape") {
        e.preventDefault();
        setArmed(false);
        audio.pause();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [armed, lines.length, audio]);

  async function autoAlign() {
    if (!file) {
      setError("Choose an audio file first. Alignment runs on the new upload.");
      return;
    }

    setAligning(true);
    setError("");
    setStatus("");

    try {
      const form = new FormData();
      form.append("file", file);
      // Must match the phrase lines exactly, so the returned word sequence
      // lines up one-to-one with them.
      form.append("text", lines.join(" "));

      const res = await fetch("/api/align", { method: "POST", body: form });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "Alignment failed.");

      const aligned: Phrase[] = data.words;
      const expected = lines.join(" ").split(/\s+/).filter(Boolean).length;

      setWords(aligned);
      setMarks(wordsToPhrases(lines, aligned).map((p) => p.start));

      setStatus(
        aligned.length === expected
          ? `Aligned ${aligned.length} words. Check the preview, then publish.`
          : `Aligned ${aligned.length} words but expected ${expected}. Check the boundaries carefully.`
      );
    } catch (e) {
      setError(describe(e, "Alignment failed."));
    } finally {
      setAligning(false);
    }
  }

  function startTapping() {
    if (!audio) return;
    audio.currentTime = 0;
    setMarks([0]);
    setArmed(true);
    void audio.play();
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
    if (!audio || marks[i] === undefined) return;
    audio.currentTime = marks[i];
    void audio.play();
  }

  function previewFromStart() {
    if (!audio) return;
    audio.currentTime = 0;
    void audio.play();
  }

  async function save() {
    setSaving(true);
    setStatus("");
    setError("");

    try {
      let audioPath = segment.audio_path;
      let version = segment.version;

      if (file) {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) throw new Error("You are signed out. Sign in and try again.");

        // Must filter to the current user. Admins can see every profile in
        // their org, so an unfiltered .single() returns multiple rows and
        // Postgrest answers 406 as soon as a second person exists.
        const { data: profile, error: profileErr } = await supabase
          .from("profiles")
          .select("org_id")
          .eq("id", user.id)
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
          words: words.length ? words : null,
          version,
          status: "published",
          updated_at: new Date().toISOString(),
        })
        .eq("id", segment.id);

      if (updErr) throw updErr;

      setStatus(`Published as v${version}. Reps get it on their next load.`);
    } catch (e) {
      setError(describe(e, "Save failed."));
    } finally {
      setSaving(false);
    }
  }

  const remaining = lines.length - marks.length;

  return (
    <div>
      <div className="code">{segment.segment_code}</div>
      <h1>{segment.title || "Untitled segment"}</h1>
      <p className="muted">
        Currently v{segment.version}
        {duration > 0 && ` \u00b7 ${duration.toFixed(1)}s of audio`}
      </p>

      <h2>1 &middot; Recording</h2>
      <input
        type="file"
        accept="audio/*"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      {audioUrl ? (
        <audio
          ref={setAudioEl}
          className="player"
          src={audioUrl}
          controls
          preload="metadata"
          style={{ marginTop: 12 }}
        />
      ) : (
        <p className="hint" style={{ marginTop: 12 }}>
          Choose an MP3 to time.
        </p>
      )}

      <h2>2 &middot; Phrasing</h2>
      <p className="hint">
        One phrase per line. Break on thought groups, not sentences &mdash; this
        is exactly what the rep will watch illuminate.
      </p>
      <textarea
        rows={Math.max(4, lines.length + 2)}
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        disabled={armed}
      />

      <h2>3 &middot; Timing</h2>
      <p className="hint">
        Alignment listens to your recording and finds every word for you. Tap
        by hand only if it gets something wrong.
      </p>

      <div className="row">
        <button className="primary" onClick={autoAlign} disabled={!file || aligning}>
          {aligning ? "Aligning\u2026" : "\u2728 Auto-align to my voice"}
        </button>
        {words.length > 0 && (
          <span className="live-count">{words.length} words aligned</span>
        )}
      </div>

      <p className="hint" style={{ marginTop: 16 }}>
        Or tap it manually:
      </p>
      <p className="hint">
        Press start, then hit <kbd>Space</kbd> the instant each new phrase
        begins. The first line is marked for you. <kbd>Backspace</kbd> undoes
        the last tap. <kbd>Esc</kbd> stops.
      </p>

      <div className="row">
        <button onClick={startTapping} disabled={!audio || armed}>
          Start tapping
        </button>
        <button onClick={() => setMarks([])} disabled={armed}>
          Clear marks
        </button>
        {armed && (
          <span className="live-count">
            {remaining > 0
              ? `${remaining} phrase${remaining === 1 ? "" : "s"} to go`
              : "All marked \u2014 press Esc"}
          </span>
        )}
      </div>

      <ol className="phrases">
        {lines.map((text, i) => (
          <li
            key={i}
            className={
              i === activeIndex ? "current" : marks[i] !== undefined ? "set" : ""
            }
          >
            <button className="ts" onClick={() => playFrom(i)}>
              {marks[i] !== undefined ? `${marks[i].toFixed(2)}s` : "\u2014"}
            </button>
            <span className="text">{text}</span>
            <span className="nudges">
              <button
                onClick={() => nudge(i, -0.05)}
                disabled={marks[i] === undefined}
                aria-label="Move earlier"
              >
                &minus;
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

      <h2>4 &middot; Preview and publish</h2>
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
        <button onClick={previewFromStart} disabled={!audio}>
          {playing ? "Playing\u2026" : "\u25b6 Preview karaoke"}
        </button>
        <button
          className="primary"
          onClick={save}
          disabled={saving || lines.length === 0 || marks.length !== lines.length}
        >
          {saving ? "Saving\u2026" : file ? "Upload and publish" : "Save timings"}
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

/**
 * Supabase returns plain objects ({ message, details, hint, code }), not Error
 * instances -- so `e instanceof Error` is false and the real reason gets
 * thrown away. Pull the message out of whatever shape actually arrived.
 */
function describe(e: unknown, fallback: string): string {
  if (e instanceof Error) return e.message;

  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    const parts = [o.message, o.details, o.hint]
      .filter((x): x is string => typeof x === "string" && x.length > 0);
    const code = typeof o.code === "string" ? ` (${o.code})` : "";
    if (parts.length) return parts.join(" \u2014 ") + code;
  }

  if (typeof e === "string" && e) return e;
  return fallback;
}
