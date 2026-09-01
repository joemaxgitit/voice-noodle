"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

/*
  Anything shorter than this is not listening -- it is a mis-click or a
  fragment of a scrub. Not worth a row.
*/
const MIN_SECONDS = 3;

/*
  timeupdate fires roughly four times a second, so a real gap between events
  is a fraction of a second. Anything larger is a seek, and counting it would
  credit someone for audio they dragged past rather than heard.
*/
const MAX_STEP = 2;

/**
 * Banks how much of a segment was actually heard.
 *
 * Deliberately not "time on the page" or "time with the audio open" -- those
 * count a tab left open overnight as practice. This only accumulates while
 * the audio is genuinely advancing, and drops any jump big enough to be a
 * scrub.
 *
 * Writes on pause, on end, when the segment changes, and when the page goes
 * away. Nothing is written for a segment that never really played.
 */
export function useListenLog(
  audio: HTMLAudioElement | null,
  segmentId: string | null,
  source: "train" | "read"
) {
  const supabase = createClient();

  const banked = useRef(0);
  const lastTime = useRef(0);
  const currentSegment = useRef<string | null>(null);

  // Held in a ref so listeners always call the current version without
  // needing to be torn down and rebound on every render.
  const flush = useRef<() => void>(() => {});

  flush.current = () => {
    const seconds = Math.round(banked.current * 10) / 10;
    const segment = currentSegment.current;

    banked.current = 0;

    if (!segment || seconds < MIN_SECONDS) return;

    // Fire and forget. A failed write should never interrupt playback, and
    // the number is a coaching aid rather than an accounting record.
    void supabase
      .from("listens")
      .insert({ segment_id: segment, seconds, source })
      .then(({ error }) => {
        if (error) console.warn("[listens]", error.message);
      });
  };

  // Bank the previous segment before the new one starts counting.
  useEffect(() => {
    if (currentSegment.current && currentSegment.current !== segmentId) {
      flush.current();
    }
    currentSegment.current = segmentId;
    lastTime.current = 0;
  }, [segmentId]);

  useEffect(() => {
    if (!audio) return;

    const onTime = () => {
      const now = audio.currentTime;
      const step = now - lastTime.current;
      if (step > 0 && step < MAX_STEP) banked.current += step;
      lastTime.current = now;
    };

    const onStop = () => flush.current();

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("pause", onStop);
    audio.addEventListener("ended", onStop);

    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("pause", onStop);
      audio.removeEventListener("ended", onStop);
      flush.current();
    };
  }, [audio]);

  // Closing the tab or navigating away still banks what was heard.
  useEffect(() => {
    const onHide = () => flush.current();
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, []);
}
