"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { IDLE_KEY, IDLE_MS, stayAwake } from "@/lib/idle";

/** Signs out after 30 minutes without activity (any tab counts; a playing recording counts). Accounts marked never_timeout stay signed in. */
export default function IdleTimeout() {
  const path = usePathname() || "/";
  useEffect(() => {
    if (path.startsWith("/login")) return;
    stayAwake();
    let last = 0;
    const bump = () => {
      // At most every 15 seconds -- mouse moves fire constantly.
      const now = Date.now();
      if (now - last < 15_000) return;
      last = now;
      stayAwake();
    };
    const events = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "wheel"];
    for (const e of events) window.addEventListener(e, bump, { passive: true, capture: true });
    // Audio and video events don't bubble; capture them so listening to a long call keeps you signed in.
    document.addEventListener("timeupdate", bump, true);
    const timer = setInterval(async () => {
      let at = Date.now();
      try {
        at = Number(localStorage.getItem(IDLE_KEY)) || Date.now();
      } catch {}
      if (Date.now() - at < IDLE_MS) return;
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      if (!data.session) return;
      // Some accounts never time out (set per person in the database: profiles.never_timeout).
      const { data: me } = await supabase.from("profiles").select("never_timeout").eq("id", data.session.user.id).maybeSingle();
      if ((me as { never_timeout?: boolean } | null)?.never_timeout) {
        stayAwake();
        return;
      }
      await supabase.auth.signOut();
      window.location.href = "/login?timeout=1";
    }, 30_000);
    return () => {
      for (const e of events) window.removeEventListener(e, bump, { capture: true } as EventListenerOptions);
      document.removeEventListener("timeupdate", bump, true);
      clearInterval(timer);
    };
  }, [path]);
  return null;
}
