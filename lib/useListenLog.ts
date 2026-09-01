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
 * away.
 */
export function useListenLog(
  audio: HTMLAudioElement | null,
  segmentId: string | null,
  source: "train" | "read",
  narratorId?: string | null
) {
  const supabase = createClient();

  const banked = useRef(0);
  const lastTime = useRef(0);
  const currentSegment = useRef<string | null>(null);

  /*
    Whose voice they were listening to. Held in a ref alongside the segment so
    the value banked is the one that was playing, not whatever is selected by
    the time the write happens.
  */
  const currentNarrator = useRef<string | null>(null);

  /*
    The access token, cached.

    The unload path cannot await anything, so it cannot ask for the session at
    the moment it needs it. Kept current here instead.
  */
  const token = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) token.current = data.session?.access_token ?? null;
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      token.current = session?.access_token ?? null;
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  // Held in a ref so listeners always call the current version without
  // needing to be torn down and rebound on every render.
  const flush = useRef<(unloading?: boolean) => void>(() => {});

  flush.current = (unloading = false) => {
    const seconds = Math.round(banked.current * 10) / 10;
    const segment = currentSegment.current;
    const narrator = currentNarrator.current;

    banked.current = 0;

    if (!segment || seconds < MIN_SECONDS) return;

    const row = {
      segment_id: segment,
      narrator_id: narrator,
      seconds,
      source,
    };

    /*
      On unload the normal client is no good -- the page is going away and any
      request still in flight is cancelled, which is how the last segment of a
      read used to vanish.

      fetch with keepalive survives that. sendBeacon does not work here: it
      cannot set the apikey and Authorization headers Supabase requires, and
      without them the row is rejected.
    */
    if (unloading && token.current) {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      if (url && key) {
        void fetch(`${url}/rest/v1/listens`, {
          method: "POST",
          keepalive: true,
          headers: {
            apikey: key,
            Authorization: `Bearer ${token.current}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify(row),
        }).catch(() => {
          // Nothing useful to do -- the page is already leaving.
        });
        return;
      }
    }

    // Fire and forget. A failed write should never interrupt playback, and
    // the number is a coaching aid rather than an accounting record.
    void supabase
      .from("listens")
      .insert(row)
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
    currentNarrator.current = narratorId ?? null;
    lastTime.current = 0;
  }, [segmentId, narratorId]);

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

  /*
    pagehide rather than beforeunload: it fires on mobile backgrounding and on
    back/forward navigation, both of which beforeunload misses. visibilitychange
    covers the tab being switched away and never returned to.
  */
  useEffect(() => {
    const onHide = () => flush.current(true);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush.current(true);
    };

    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
}
