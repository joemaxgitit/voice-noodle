"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type Phrase = { start: number; end: number; text: string };

/**
 * Tracks audio playback and reports which phrase is currently being spoken.
 *
 * Two things this has to get right:
 *
 * 1. It uses requestAnimationFrame rather than the <audio> element's
 *    onTimeUpdate event. onTimeUpdate fires roughly 4x per second, which puts
 *    highlighting up to 250ms behind the voice -- at conversational pace that
 *    reads as broken.
 *
 * 2. It attaches via a CALLBACK REF, not a plain ref object. The audio element
 *    renders conditionally (only once a URL exists), so it is absent on first
 *    render. A useEffect keyed on a ref object would run once, find nothing,
 *    and never re-run, because ref identity never changes. That was the bug
 *    that left highlighting frozen. A callback ref fires exactly when the
 *    element mounts, and again if it is swapped out.
 */
export function useKaraoke(phrases: Phrase[]) {
  const [el, setEl] = useState<HTMLAudioElement | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const frame = useRef<number | null>(null);

  // Pass this straight to <audio ref={setAudioEl} />
  const setAudioEl = useCallback((node: HTMLAudioElement | null) => {
    setEl(node);
  }, []);

  useEffect(() => {
    if (!el) return;

    const tick = () => {
      setTime(el.currentTime);
      frame.current = requestAnimationFrame(tick);
    };

    const start = () => {
      setPlaying(true);
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(tick);
    };

    const stop = () => {
      setPlaying(false);
      if (frame.current) cancelAnimationFrame(frame.current);
      setTime(el.currentTime);
    };

    const seek = () => setTime(el.currentTime);

    const meta = () => {
      // Some encoders omit duration from the header; isFinite guards NaN.
      if (Number.isFinite(el.duration)) setDuration(el.duration);
    };

    el.addEventListener("play", start);
    el.addEventListener("playing", start);
    el.addEventListener("pause", stop);
    el.addEventListener("ended", stop);
    el.addEventListener("seeked", seek);
    el.addEventListener("loadedmetadata", meta);
    el.addEventListener("durationchange", meta);

    // The element may already be loaded or playing by the time we attach.
    meta();
    setTime(el.currentTime);
    if (!el.paused) start();

    return () => {
      el.removeEventListener("play", start);
      el.removeEventListener("playing", start);
      el.removeEventListener("pause", stop);
      el.removeEventListener("ended", stop);
      el.removeEventListener("seeked", seek);
      el.removeEventListener("loadedmetadata", meta);
      el.removeEventListener("durationchange", meta);
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [el]);

  const activeIndex = phrases.findIndex((p) => time >= p.start && time < p.end);

  return { audio: el, setAudioEl, time, duration, playing, activeIndex };
}

/** Turn tapped start-marks into the stored phrase array. */
export function marksToPhrases(
  lines: string[],
  marks: number[],
  duration: number
): Phrase[] {
  return lines.map((text, i) => {
    const start = marks[i] ?? 0;
    const next = marks[i + 1];
    // Last phrase runs to the end of the audio. If duration is unknown, give
    // it a generous tail rather than a zero-length window.
    const end = next ?? (duration > start ? duration : start + 10);
    return { text, start, end };
  });
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
