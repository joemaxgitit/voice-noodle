"use client";

import { useEffect, useState } from "react";

/*
  "View as" a rep: a manager clicking around the rep side exactly as that rep
  would -- their menu, their sections and progress, their training, their
  feedback. Kept for this browser tab only (sessionStorage), set by
  /view-as/[repId] and cleared the moment the manager is back on /admin.
  Read only: every rep page checks this before saving anything.
*/
export type ViewAs = { id: string; name: string };
const KEY = "vn-view-as";
const EVENT = "vn-view-as";

export function readViewAs(): ViewAs | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) || "null") as ViewAs | null;
    return v?.id ? v : null;
  } catch {
    return null;
  }
}

export function setViewAs(v: ViewAs | null) {
  try {
    if (v) sessionStorage.setItem(KEY, JSON.stringify(v));
    else sessionStorage.removeItem(KEY);
    // The rep home links (/proedgesolutions) lead back to the view-as home while this is set (lib/supabase/middleware.ts).
    document.cookie = v ? `vn_viewas=${encodeURIComponent(v.id)}; path=/; samesite=lax` : "vn_viewas=; path=/; max-age=0";
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* private mode: view-as just doesn't carry between pages */
  }
}

/** undefined while reading (first render), then the rep being viewed or null. */
export function useViewAs(): ViewAs | null | undefined {
  const [v, setV] = useState<ViewAs | null | undefined>(undefined);
  useEffect(() => {
    const read = () => setV(readViewAs());
    read();
    window.addEventListener(EVENT, read);
    return () => window.removeEventListener(EVENT, read);
  }, []);
  return v;
}
