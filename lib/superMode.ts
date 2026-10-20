"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/*
  Super mode: the core of Voice Noodle is voice, tone, script and Straight
  Line training. The extras (sales reports, rotation, Deal Clip, Master Your
  Craft, the Thursday meeting, coaching trends, KPI and retention numbers,
  one-on-ones and notes) show only for people the super admin switches into
  super mode on the Account page. The data keeps flowing either way, and
  coaching reviews always read everything; only the screens change.
*/

export type Mode = { loaded: boolean; superMode: boolean; superAdmin: boolean };

let cached: Mode | null = null;

export async function readMode(): Promise<Mode> {
  if (cached) return cached;
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { loaded: true, superMode: false, superAdmin: false };
  // Separate queries so a missing column never breaks a page.
  const [a, b] = await Promise.all([
    supabase.from("profiles").select("super_admin").eq("id", session.user.id).maybeSingle(),
    supabase.from("profiles").select("super_mode").eq("id", session.user.id).maybeSingle(),
  ]);
  const superAdmin = !!(a.data as { super_admin?: boolean } | null)?.super_admin;
  // Before super_mode exists, the super admin keeps everything.
  const superMode = b.error ? superAdmin : !!(b.data as { super_mode?: boolean } | null)?.super_mode;
  cached = { loaded: true, superMode, superAdmin };
  return cached;
}

/** Forget the cached mode (after switching it). */
export const resetMode = () => {
  cached = null;
};

export function useMode(): Mode {
  const [m, setM] = useState<Mode>(cached ?? { loaded: false, superMode: false, superAdmin: false });
  useEffect(() => {
    void readMode().then(setM);
  }, []);
  return m;
}

export { EXTRA_PATHS, isExtraPath } from "@/lib/features";
