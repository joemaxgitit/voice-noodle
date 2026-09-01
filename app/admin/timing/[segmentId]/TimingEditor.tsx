"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  useKaraoke,
  marksToPhrases,
  wordsToPhrases,
  splitIntoPhrases,
  stateFor,
  type Phrase,
} from "@/lib/useKaraoke";

export type EditorSegment = {
  id: string;
  segment_code: string;
  title: string | null;
  script_text: string;
  recordings: Recording[];
};

export type Narrator = { id: string; name: string; sort_order: number };

export type Recording = {
  narrator_id: string;
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
 *
 * The voice is whoever is signed in -- not a choice. Three people recording
 * against a shared picker kept overwriting each other, and the picker was the
 * only thing deciding. Row-level security enforces the same rule, so this is
 * the UI agreeing with the database rather than the other way round.
 */
export default function TimingEditor({
  segment,
  narrators,
  myNarratorId,
}: {
  segment: EditorSegment;
  narrators: Narrator[];
  myNarratorId: string | null;
}) {
  const supabase = createClient();

  const narratorId = myNarratorId ?? "";
  const me = narrators.find((n) => n.id === narratorId) ?? null;

  const current = segment.recordings.find((r) => r.narrator_id === narratorId);

  const [file, setFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const [raw, setRaw] = useState(
    current?.timings?.length
      ? current.timings.map((p) => p.text).join("\n")
      : splitIntoPhrases(segment.script_text).join("\n")
  );

  const [marks, setMarks] = useState<number[]>(
    (current?.timings || []).map((p) => p.start)
  );
  const [armed, setArmed] = useState(false);
  const [words, setWords] = useState<Phrase[]>(current?.words || []);
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
  const { audio, setAudioEl, duration, playing, time, activeIndex } =
    useKaraoke(phrases);

  useEffect(() => {
    // Aligned words win. Tapped marks are the fallback.
    setPhrases(
      words.length
        ? wordsToPhrases(lines, words)
        : marksToPhrases(lines, marks, duration)
    );
  }, [lines, marks, duration, words]);

  // Load this person's existing take, or a blank slate if they have not
  // recorded this segment yet.
  useEffect(() => {
    const rec = segment.recordings.find((r) => r.narrator_id === narratorId);
    setFile(null);
    setAudioUrl(null);
    setWords(rec?.words || []);
    setMarks((rec?.timings || []).map((p) => p.start));
    setRaw(
      rec?.timings?.length
        ? rec.timings.map((p) => p.text).join("\n")
        : splitIntoPhrases(segment.script_text).join("\n")
    );
    setStatus("");
    setError("");
  }, [narratorId, segment.recordings, segment.script_text]);

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
    if (file || !current?.audio_path) return;
    let cancelled = false;

    supabase.storage
      .from("master-audio")
      .createSignedUrl(current.audio_path, 3600)
      .then(({ data }) => {
        if (!cancelled && data) setAudioUrl(data.signedUrl);
      });

    return () => {
      cancelled = true;
    };
  }, [file, current?.audio_path, supabase]);

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
      // An admin building reference timings. Not gated on the practice
      // switch, so masters can still be aligned while practice is off.
      form.append("mode", "master");

      // The route authenticates with this rather than calling /auth/v1,
      // which hangs from the server. getSession reads locally, no network.
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        throw new Error("You are signed out. Sign in and try again.");
      }

      const res = await fetch("/api/align", {
        method: "POST",
        body: form,
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      /*
        Read as text first. Vercel answers a timeout or a crash with an HTML
        page, and calling res.json() on that throws a parse error that buries
        the real cause -- the rep sees "Unexpected token '<'" and learns
        nothing.
      */
      const body = await res.text();
      let data: { error?: string; words?: Phrase[] } = {};

      try {
        data = JSON.parse(body);
      } catch {
        if (res.status === 504) {
          throw new Error(
            "Alignment timed out. Try again, and if it keeps happening the " +
              "recording may be too long."
          );
        }
        throw new Error(
          `Alignment failed (${res.status}). The server returned a page ` +
            "instead of a result, which means it crashed or timed out."
        );
      }

      if (!res.ok) {
        throw new Error(data.error || `Alignment failed (${res.status}).`);
      }

      const aligned: Phrase[] = data.words || [];
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
      if (!narratorId) {
        throw new Error(
          "Your account is not linked to a voice, so there is nothing to save it under."
        );
      }

      let audioPath = current?.audio_path ?? null;
      let version = current?.version ?? 0;

      if (file) {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) throw new Error("You are signed out. Sign in and try again.");

        // Filter to the current user. Admins can see every profile in their
        // org, so an unfiltered .single() returns several rows and Postgrest
        // answers 406 as soon as a second person exists.
        const { data: profile, error: profileErr } = await supabase
          .from("profiles")
          .select("org_id")
          .eq("id", user.id)
          .single();

        if (profileErr) throw profileErr;
        if (!profile?.org_id) {
          throw new Error("Your profile has no organization set.");
        }

        version = version + 1;

        // Keep the real extension. Anything odd falls back to mp3 rather
        // than putting whatever the filename ended with into a storage key.
        const ext = (file.name.split(".").pop() || "").toLowerCase();
        const safeExt = /^[a-z0-9]{1,5}$/.test(ext) ? ext : "mp3";

        // Narrator id in the path keeps each voice's takes separate in
        // storage, so re-recording one never overwrites another.
        audioPath =
          `${profile.org_id}/${segment.segment_code}` +
          `-${narratorId.slice(0, 8)}-v${version}.${safeExt}`;

        const { error: upErr } = await supabase.storage
          .from("master-audio")
          .upload(audioPath, file, {
            contentType: file.type || "audio/mpeg",
            upsert: true,
          });

        if (upErr) throw upErr;
      }

      if (!audioPath) throw new Error("Choose an audio file for this voice.");

      const { error: upsertErr } = await supabase.from("recordings").upsert(
        {
          segment_id: segment.id,
          narrator_id: narratorId,
          audio_path: audioPath,
          timings: phrases,
          words: words.length ? words : null,
          version,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "segment_id,narrator_id" }
      );

      if (upsertErr) throw upsertErr;

      await supabase
        .from("segments")
        .update({ status: "published" })
        .eq("id", segment.id);

      setStatus(
        `Saved as v${version} under ${me?.name ?? "your voice"}. Reps get it on their next load.`
      );
    } catch (e) {
      setError(describe(e, "Save failed."));
    } finally {
      setSaving(false);
    }
  }

  const remaining = lines.length - marks.length;

  // Not linked to a narrator: everything below would fail at the database, so
  // say why here rather than letting them record and lose the take.
  if (!narratorId) {
    return (
      <div>
        <div className="code">{segment.segment_code}</div>
        <h1>{segment.title || "Untitled segment"}</h1>
        <div className="error" style={{ marginTop: 18 }}>
          Your account is not linked to a voice, so you cannot upload
          recordings. Ask Max to link your profile to a narrator.
        </div>
      </div>
    );
  }

  const others = narrators.filter(
    (n) =>
      n.id !== narratorId &&
      segment.recordings.some((r) => r.narrator_id === n.id && r.audio_path)
  );

  return (
    <div>
      <div className="code">{segment.segment_code}</div>
      <h1>{segment.title || "Untitled segment"}</h1>
      <p className="muted">
        {current?.audio_path ? `Currently v${current.version}` : "Not recorded yet"}
        {duration > 0 && ` \u00b7 ${duration.toFixed(1)}s of audio`}
      </p>

      {/*
        Every voice performs the same tone map. Only the delivery differs,
        which is the point -- one model teaches imitation of that person,
        several teach the pattern underneath.
      */}
      <h2>Voice</h2>
      <div className="narrators">
        <span className="narrator-label">Recording as</span>
        <button aria-pressed={true} disabled>
          {me?.name ?? "You"}
        </button>
      </div>
      <p className="hint" style={{ marginTop: 8 }}>
        {others.length > 0
          ? `Also recorded by ${others.map((n) => n.name).join(", ")}. You can only change your own take.`
          : "You can only change your own take."}
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
          Choose an audio file to time.
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
          <span key={i} className={`phrase ${stateFor(p, time)}`}>
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
