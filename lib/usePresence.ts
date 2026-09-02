"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type Here = {
  name: string;
  where: string;
  segment: string | null;
  title: string | null;
  playing: boolean;
  since: number;
};

/** One channel per organisation. Nobody sees another org's people. */
export const presenceChannel = (orgId: string) => `presence:${orgId}`;

/**
 * Announce that this person is here, and what they are on.
 *
 * Realtime presence rather than database rows: nothing is written, nothing
 * accumulates, and the moment a tab closes the entry disappears on its own.
 * A heartbeat table would need cleaning up and would still be wrong whenever
 * a browser died without saying goodbye.
 *
 * What it can honestly report is that a page is open and whether audio is
 * running. That is not the same as attention -- a tab left open on a segment
 * shows as present and idle, and should be read that way.
 */
export function usePresence(
  audio: HTMLAudioElement | null,
  what: { where: string; segment: string | null; title: string | null }
) {
  const supabase = createClient();

  const [playing, setPlaying] = useState(false);
  const me = useRef<{ name: string; orgId: string } | null>(null);
  const channel = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const since = useRef(Date.now());

  // Follow the audio so the entry can say playing or idle.
  useEffect(() => {
    if (!audio) {
      setPlaying(false);
      return;
    }

    const on = () => setPlaying(true);
    const off = () => setPlaying(false);

    audio.addEventListener("play", on);
    audio.addEventListener("pause", off);
    audio.addEventListener("ended", off);

    return () => {
      audio.removeEventListener("play", on);
      audio.removeEventListener("pause", off);
      audio.removeEventListener("ended", off);
    };
  }, [audio]);

  // Join once, on mount.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;

      const { data: prof } = await supabase
        .from("profiles")
        .select("full_name, org_id")
        .eq("id", user.id)
        .single();

      if (!prof?.org_id || cancelled) return;

      me.current = { name: prof.full_name || "Someone", orgId: prof.org_id };

      const ch = supabase.channel(presenceChannel(prof.org_id), {
        config: { presence: { key: user.id } },
      });

      channel.current = ch;
      ch.subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel.current) {
        void supabase.removeChannel(channel.current);
        channel.current = null;
      }
    };
  }, [supabase]);

  // Push the current state whenever it changes.
  useEffect(() => {
    const ch = channel.current;
    if (!ch || !me.current) return;

    const state: Here = {
      name: me.current.name,
      where: what.where,
      segment: what.segment,
      title: what.title,
      playing,
      since: since.current,
    };

    void ch.track(state);
  }, [what.where, what.segment, what.title, playing]);
}
