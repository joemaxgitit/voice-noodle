"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FEATURES, type FeatureFlags, type FeatureKey } from "@/lib/features";

/** Super admin only: switch the extra features on or off for every other admin and manager. */
export default function FeatureToggles({ supabase }: { supabase: SupabaseClient }) {
  const [show, setShow] = useState(false);
  const [orgId, setOrgId] = useState("");
  const [flags, setFlags] = useState<FeatureFlags>({});
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  useEffect(() => {
    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;
      const { data: me } = await supabase.from("profiles").select("org_id").eq("id", session.user.id).single();
      const { data: sa } = await supabase.from("profiles").select("super_admin").eq("id", session.user.id).maybeSingle();
      if (!(sa as { super_admin?: boolean } | null)?.super_admin) return;
      setOrgId(me?.org_id ?? "");
      setShow(true);
      const { data, error } = await supabase.from("app_features").select("flags").maybeSingle();
      if (error) setError(/app_features|does not exist/i.test(error.message) ? "Run supabase/features.sql first." : error.message);
      setFlags(((data as { flags?: FeatureFlags } | null)?.flags ?? {}) as FeatureFlags);
    })();
  }, [supabase]);

  async function toggle(key: FeatureKey, on: boolean) {
    const next = { ...flags, [key]: on };
    setFlags(next);
    setError("");
    const { error } = await supabase.from("app_features").upsert({ org_id: orgId, flags: next, updated_at: new Date().toISOString() }, { onConflict: "org_id" });
    if (error) {
      setFlags(flags);
      return setError(error.message);
    }
    setSaved(`${FEATURES.find((f) => f.key === key)?.label} is ${on ? "on" : "off"} for admins and managers.`);
    setTimeout(() => setSaved(""), 2500);
  }

  if (!show) return null;
  return (
    <section style={{ marginTop: 26 }}>
      <div className="eyebrow">Super admin</div>
      <h2 style={{ margin: "0 0 4px", fontSize: 19 }}>Features for admins and managers</h2>
      <p className="muted" style={{ marginTop: 0 }}>You always have all of these. Switch one on to give it to every other admin and manager; off hides it from them.</p>
      <div className="card" style={{ display: "grid", gap: 4 }}>
        {FEATURES.map((f) => (
          <label key={f.key} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "8px 0", cursor: "pointer" }}>
            <input type="checkbox" checked={!!flags[f.key]} onChange={(e) => void toggle(f.key, e.target.checked)} style={{ width: 18, height: 18, marginTop: 2 }} />
            <span>
              <b>{f.label}</b>
              <br />
              <small className="muted">{f.desc}</small>
            </span>
          </label>
        ))}
        {error && <div className="error">{error}</div>}
        {saved && <div className="status">{saved}</div>}
      </div>
      <p className="hint">Changes take effect the next time they open or refresh a page.</p>
    </section>
  );
}
