"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Switch practice recording on and off for the whole organisation.
 *
 * Off is the safe state: every scored attempt costs an alignment call, and
 * this is the control that stops that spending without touching the code or
 * pulling the feature out.
 *
 * The switch is enforced in /api/align as well as here. Hiding the interface
 * alone would leave a stale tab able to keep spending.
 */
export default function PracticeToggle() {
  const supabase = createClient();

  const [on, setOn] = useState<boolean | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data: prof } = await supabase
        .from("profiles")
        .select("org_id")
        .eq("id", user.id)
        .single();

      if (!prof?.org_id || cancelled) return;

      const { data: org } = await supabase
        .from("orgs")
        .select("practice_enabled")
        .eq("id", prof.org_id)
        .single();

      if (cancelled) return;

      setOrgId(prof.org_id);
      setOn(!!org?.practice_enabled);
    })();

    return () => {
      cancelled = true;
    };
  }, [supabase]);

  async function flip() {
    if (!orgId || on === null) return;

    setBusy(true);
    setError("");

    const next = !on;

    const { error } = await supabase
      .from("orgs")
      .update({ practice_enabled: next })
      .eq("id", orgId);

    if (error) setError(error.message);
    else setOn(next);

    setBusy(false);
  }

  if (on === null) return null;

  return (
    <div className="practice-switch">
      <div>
        <div className="label">Practice recording</div>
        <div className="hint" style={{ margin: 0 }}>
          {on
            ? "Reps can record and score takes. Each scored take costs an alignment call."
            : "Hidden from reps entirely. Past takes reappear when this is switched back on."}
        </div>
      </div>

      <button
        className={on ? "primary" : ""}
        onClick={flip}
        disabled={busy}
        aria-pressed={on}
      >
        {busy ? "\u2026" : on ? "On" : "Off"}
      </button>

      {error && <div className="error">{error}</div>}
    </div>
  );
}
