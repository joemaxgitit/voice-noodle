"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

export type Phrase = { start: number; end: number; text: string };

/**
 * Tracks audio playback with requestAnimationFrame instead of the <audio>
 * element's onTimeUpdate event.
 *
 * onTimeUpdate fires roughly 4x per second, which puts phrase highlighting up
 * to 250ms behind the voice. At conversational pace that reads as broken.
 * rAF gives ~60fps and costs nothing while paused.
 */
export function useKaraoke(
  audioRef: RefObject<HTMLAudioElement | null>,
  phrases: Phrase[]
) {
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    const tick = () => {
      setTime(el.currentTime);
      frame.current = requestAnimationFrame(tick);
    };

    const onPlay = () => {
      setPlaying(true);
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(tick);
    };

    const onStop = () => {
      setPlaying(false);
      if (frame.current) cancelAnimationFrame(frame.current);
      setTime(el.currentTime);
    };

    const onSeek = () => setTime(el.currentTime);

    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onStop);
    el.addEventListener("ended", onStop);
    el.addEventListener("seeked", onSeek);

    return () => {
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onStop);
      el.removeEventListener("ended", onStop);
      el.removeEventListener("seeked", onSeek);
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [audioRef]);

  const activeIndex = phrases.findIndex((p) => time >= p.start && time < p.end);

  return { time, playing, activeIndex };
}

/** Turn tapped start-marks into the stored phrase array. */
export function marksToPhrases(
  lines: string[],
  marks: number[],
  duration: number
): Phrase[] {
  return lines.map((text, i) => ({
    text,
    start: marks[i] ?? 0,
    end: marks[i + 1] ?? (duration || (marks[i] ?? 0) + 3),
  }));
}

/** First-pass phrase split on thought groups. A human always adjusts it. */
export function splitIntoPhrases(text: string): string[] {
  return text
    .replace(/([.!?\u2026])\s+/g, "$1\n")
    .replace(/,\s+(and|but|so|then|because)\s/gi, ",\n$1 ")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}
