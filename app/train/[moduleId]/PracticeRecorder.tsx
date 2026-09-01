"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { toWav } from "@/lib/wav";

type Attempt = {
  id: string;
  audio_path: string;
  seconds: number | null;
  created_at: string;
};

/*
  Below this, nothing was said. Stops a stray click filing an empty attempt
  and cluttering the history a manager has to look through.
*/
const MIN_SECONDS = 2;

function when(iso: string): string {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

/**
 * Record yourself saying the segment, then hear it back against the master.
 *
 * Deliberately plain about where the audio goes. A rep who discovers later
 * that their practice was audible to their manager stops practising, so it
 * says so up front.
 */
export default function PracticeRecorder({
  segmentId,
  segmentCode,
  narratorId,
}: {
  segmentId: string;
  segmentCode: string;
  narratorId: string | null;
}) {
  const supabase = createClient();

  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [saving, setSaving] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const [error, setError] = useState("");

  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const startedAt = useRef(0);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);

  // This person's attempts at this segment. RLS keeps it to their own.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from("attempts")
        .select("id, audio_path, seconds, created_at")
        .eq("segment_id", segmentId)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(10);

      if (!cancelled) setAttempts((data || []) as Attempt[]);
    })();

    return () => {
      cancelled = true;
    };
  }, [segmentId, supabase]);

  // Release the microphone if the card is left mid-recording.
  useEffect(() => {
    return () => {
      if (ticker.current) clearInterval(ticker.current);
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function start() {
    setError("");

    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      stream.current = media;
      chunks.current = [];

      const rec = new MediaRecorder(media);
      recorder.current = rec;

      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };

      rec.onstop = () => void save();

      rec.start();
      startedAt.current = Date.now();
      setElapsed(0);
      setRecording(true);

      ticker.current = setInterval(
        () => setElapsed((Date.now() - startedAt.current) / 1000),
        200
      );
    } catch (e) {
      setError(
        e instanceof Error && e.name === "NotAllowedError"
          ? "The browser blocked the microphone. Allow it for this site and try again."
          : "Could not start recording. Check that a microphone is connected."
      );
    }
  }

  function stop() {
    if (ticker.current) clearInterval(ticker.current);
    ticker.current = null;
    setRecording(false);
    recorder.current?.stop();
  }

  async function save() {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;

    const raw = new Blob(chunks.current, {
      type: chunks.current[0]?.type || "audio/webm",
    });
    chunks.current = [];

    if (raw.size === 0) return;

    setSaving(true);
    setError("");

    try {
      // One known format reaches the server regardless of browser.
      const { wav, seconds } = await toWav(raw);

      if (seconds < MIN_SECONDS) {
        setError("That was too short to keep. Try again.");
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) throw new Error("You are signed out. Sign in and try again.");

      // The user id leads the path: the storage policy reads ownership from
      // that first folder.
      const path = `${user.id}/${segmentCode}-${Date.now()}.wav`;

      const { error: upErr } = await supabase.storage
        .from("practice-audio")
        .upload(path, wav, { contentType: "audio/wav" });

      if (upErr) throw upErr;

      const { data: row, error: insErr } = await supabase
        .from("attempts")
        .insert({
          segment_id: segmentId,
          narrator_id: narratorId,
          audio_path: path,
          seconds: Math.round(seconds * 10) / 10,
        })
        .select("id, audio_path, seconds, created_at")
        .single();

      if (insErr) throw insErr;

      setAttempts((prev) => [row as Attempt, ...prev].slice(0, 10));
    } catch (e) {
      setError(describe(e, "Could not save that take."));
    } finally {
      setSaving(false);
    }
  }

  async function hear(a: Attempt) {
    setError("");
    setPlaying(a.id);

    try {
      const { data, error } = await supabase.storage
        .from("practice-audio")
        .createSignedUrl(a.audio_path, 3600);

      if (error) throw error;

      const audio = new Audio(data.signedUrl);
      audio.onended = () => setPlaying(null);
      audio.onerror = () => {
        setPlaying(null);
        setError("That recording could not be played.");
      };
      await audio.play();
    } catch (e) {
      setPlaying(null);
      setError(describe(e, "Could not play that take."));
    }
  }

  return (
    <div className="practice">
      <h2>Your turn</h2>
      <p className="hint">
        Say it back against the master, then listen to both. Your takes are
        saved and your manager can hear them.
      </p>

      <div className="row">
        {recording ? (
          <button className="primary" onClick={stop}>
            &#9632; Stop &middot; {elapsed.toFixed(1)}s
          </button>
        ) : (
          <button className="primary" onClick={start} disabled={saving}>
            {saving ? "Saving\u2026" : "\u25cf Record"}
          </button>
        )}
        {recording && (
          <span className="live-count">Recording&hellip;</span>
        )}
      </div>

      {error && <div className="error">{error}</div>}

      {attempts.length > 0 && (
        <ul className="phrases" style={{ marginTop: 14 }}>
          {attempts.map((a) => (
            <li key={a.id} className="set">
              <button className="ts" onClick={() => hear(a)}>
                {playing === a.id ? "\u25b6" : "\u25b7"}
              </button>
              <span className="text">{when(a.created_at)}</span>
              <span className="count">
                {a.seconds ? `${a.seconds.toFixed(1)}s` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
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
    const parts = [o.message, o.details, o.hint].filter(
      (x): x is string => typeof x === "string" && x.length > 0
    );
    if (parts.length) return parts.join(" \u2014 ");
  }

  return fallback;
}
