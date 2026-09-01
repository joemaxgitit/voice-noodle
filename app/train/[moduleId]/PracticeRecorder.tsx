"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { toWav } from "@/lib/wav";
import {
  score as scoreAttempt,
  paceNote,
  passed,
  PASS,
  type Scores,
} from "@/lib/score";
import type { Phrase } from "@/lib/useKaraoke";

type Attempt = {
  id: string;
  audio_path: string;
  seconds: number | null;
  scores: Scores | null;
  created_at: string;
};

/*
  Below this, nothing was said. Stops a stray click filing an empty attempt.
*/
const MIN_SECONDS = 2;

function when(iso: string): string {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function band(n: number): string {
  return n >= 80 ? "good" : n >= 55 ? "fair" : "poor";
}

/**
 * Record yourself saying the segment, hear it back, keep it or bin it.
 *
 * A take is only filed once the rep chooses to keep it. That is deliberate:
 * they asked to be able to bin a cough or a false start, but a take that has
 * been filed stays filed -- otherwise the ones that score badly are exactly
 * the ones that get deleted, and those are the ones worth coaching.
 *
 * Scoring is relative to the master they were imitating, never to a general
 * model of speech. See lib/score.
 */
export default function PracticeRecorder({
  segmentId,
  segmentCode,
  narratorId,
  masterWords,
  onPass,
}: {
  segmentId: string;
  segmentCode: string;
  narratorId: string | null;
  masterWords: Phrase[] | null;
  onPass?: () => void;
}) {
  const supabase = createClient();

  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  // A finished take, not yet filed.
  const [pending, setPending] = useState<{ blob: Blob; url: string } | null>(
    null
  );

  const [saving, setSaving] = useState("");
  const [playing, setPlaying] = useState<string | null>(null);
  const [cleared, setCleared] = useState(false);
  const [error, setError] = useState("");

  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const startedAt = useRef(0);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);
  const moveOn = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canScore = !!masterWords && masterWords.length > 0;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from("attempts")
        .select("id, audio_path, seconds, scores, created_at")
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

  // Release the microphone and any preview URL if the card is left.
  useEffect(() => {
    return () => {
      if (ticker.current) clearInterval(ticker.current);
      if (moveOn.current) clearTimeout(moveOn.current);
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    return () => {
      if (pending) URL.revokeObjectURL(pending.url);
    };
  }, [pending]);

  async function start() {
    setError("");
    setCleared(false);

    if (pending) {
      URL.revokeObjectURL(pending.url);
      setPending(null);
    }

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

      rec.onstop = () => {
        stream.current?.getTracks().forEach((t) => t.stop());
        stream.current = null;

        const blob = new Blob(chunks.current, {
          type: chunks.current[0]?.type || "audio/webm",
        });
        chunks.current = [];

        if (blob.size === 0) return;
        setPending({ blob, url: URL.createObjectURL(blob) });
      };

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

  function discard() {
    if (pending) URL.revokeObjectURL(pending.url);
    setPending(null);
    setError("");
  }

  /** Align the take and compare it to the master. Never fatal. */
  async function scoreTake(
    wav: Blob
  ): Promise<{ words: Phrase[]; scores: Scores } | null> {
    if (!masterWords || masterWords.length === 0) return null;

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) return null;

    const form = new FormData();
    form.append("file", wav, `${segmentCode}.wav`);
    // Built from the master's own words so the two token sequences match
    // exactly -- anything else risks scoring against a different split.
    form.append("text", masterWords.map((w) => w.text).join(" "));

    const res = await fetch("/api/align", {
      method: "POST",
      body: form,
      headers: { Authorization: `Bearer ${session.access_token}` },
    });

    const body = await res.text();

    let data: { words?: Phrase[]; error?: string } = {};
    try {
      data = JSON.parse(body);
    } catch {
      return null;
    }

    if (!res.ok || !data.words) return null;

    const scores = scoreAttempt(data.words, masterWords);
    return scores ? { words: data.words, scores } : null;
  }

  async function keep() {
    if (!pending) return;

    setSaving("Saving\u2026");
    setError("");

    try {
      const { wav, seconds } = await toWav(pending.blob);

      if (seconds < MIN_SECONDS) {
        setError("That was too short to keep. Try again.");
        setSaving("");
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
        .select("id, audio_path, seconds, scores, created_at")
        .single();

      if (insErr) throw insErr;

      const saved = row as Attempt;
      setAttempts((prev) => [saved, ...prev].slice(0, 10));
      discard();

      // The take is safe from here. Scoring is a bonus on top, so a failure
      // leaves the recording in place rather than losing it.
      if (canScore) {
        setSaving("Scoring\u2026");
        const result = await scoreTake(wav);

        if (result) {
          await supabase
            .from("attempts")
            .update({ words: result.words, scores: result.scores })
            .eq("id", saved.id);

          setAttempts((prev) =>
            prev.map((a) =>
              a.id === saved.id ? { ...a, scores: result.scores } : a
            )
          );

          /*
            Passing clears the segment. The pause before moving on is so the
            rep sees the result rather than the page changing under them --
            without it the reward for a good take is the screen vanishing.
          */
          if (passed(result.scores)) {
            setCleared(true);
            if (onPass) {
              moveOn.current = setTimeout(() => onPass(), 1800);
            }
          }
        } else {
          setError(
            "Saved, but this take could not be scored. Play it back and try again if it sounded off."
          );
        }
      }
    } catch (e) {
      setError(describe(e, "Could not save that take."));
    } finally {
      setSaving("");
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
        Say it back against the master, then listen to both. Keep a take and
        it is saved, and you and your manager can hear them.
      </p>

      {canScore ? (
        <p className="hint">
          Clear this segment with Pace {PASS.pace}, Clarity {PASS.clarity} and
          Pauses {PASS.pauses}. Record as many takes as you like &mdash; you can
          always come back and work on it again.
        </p>
      ) : (
        <p className="hint">
          This segment has no aligned master yet, so takes are saved but not
          scored.
        </p>
      )}

      {cleared && (
        <div className="cleared">
          Passed &mdash; moving to the next one.
        </div>
      )}

      <div className="row">
        {recording ? (
          <button className="primary" onClick={stop}>
            &#9632; Stop &middot; {elapsed.toFixed(1)}s
          </button>
        ) : (
          <button className="primary" onClick={start} disabled={!!saving}>
            {saving || "\u25cf Record"}
          </button>
        )}
        {recording && <span className="live-count">Recording&hellip;</span>}
      </div>

      {/*
        Nothing is filed until it is kept. This is the moment a cough or a
        false start gets binned -- after this, the take stays.
      */}
      {pending && !saving && (
        <div className="pending">
          <p className="hint">Hear it back, then keep it or bin it.</p>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio className="player" src={pending.url} controls />
          <div className="row">
            <button className="primary" onClick={keep}>
              Keep this take
            </button>
            <button onClick={discard}>Discard</button>
          </div>
        </div>
      )}

      {error && <div className="error">{error}</div>}

      {attempts.length > 0 && (
        <ul className="list" style={{ marginTop: 14 }}>
          {attempts.map((a) => (
            <li key={a.id}>
              <div className="attempt">
                <button className="ts" onClick={() => hear(a)}>
                  {playing === a.id ? "\u25b6" : "\u25b7"}
                </button>
                <span className="attempt-when">
                  {when(a.created_at)}
                  {a.seconds ? ` \u00b7 ${a.seconds.toFixed(1)}s` : ""}
                </span>

                {a.scores && passed(a.scores) && (
                  <span className="score good">Passed</span>
                )}

                {a.scores && (
                  <span className="scores">
                    <span className={`score ${band(a.scores.pace)}`}>
                      Pace {a.scores.pace}
                    </span>
                    {a.scores.pauses !== null && (
                      <span className={`score ${band(a.scores.pauses)}`}>
                        Pauses {a.scores.pauses}
                      </span>
                    )}
                    <span className={`score ${band(a.scores.clarity)}`}>
                      Clarity {a.scores.clarity}
                    </span>
                  </span>
                )}
              </div>

              {a.scores && (
                <p className="attempt-note">
                  {paceNote(a.scores.paceDelta)}
                  {a.scores.rushed.length > 0 &&
                    ` \u00b7 ${a.scores.rushed.length} ${
                      a.scores.rushed.length === 1 ? "word" : "words"
                    } went past too fast`}
                  {a.scores.missedPauses.length > 0 &&
                    ` \u00b7 missed ${a.scores.missedPauses.length} of ${a.scores.pauseCount} pauses`}
                </p>
              )}
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
