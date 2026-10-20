"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resetMode } from "@/lib/superMode";

type Person = { id: string; full_name: string | null; email: string | null; role: string; team: string | null };

/** Super admin only: who gets super mode (the extras beyond voice, tone, script and Straight Line training). */
export default function SuperModeList({ supabase }: { supabase: SupabaseClient }) {
  const [show, setShow] = useState(false);
  const [me, setMe] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [on, setOn] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;
      const { data: sa } = await supabase.from("profiles").select("super_admin").eq("id", session.user.id).maybeSingle();
      if (!(sa as { super_admin?: boolean } | null)?.super_admin) return;
      setMe(session.user.id);
      setShow(true);
      const { data } = await supabase.from("profiles").select("id, full_name, email, role, team").in("role", ["admin", "manager"]).eq("active", true).order("full_name");
      setPeople((data || []) as Person[]);
      const sm = await supabase.from("profiles").select("id, super_mode").eq("super_mode", true);
      if (sm.error) setError(/super_mode/.test(sm.error.message) ? "Run supabase/super-mode.sql first." : sm.error.message);
      setOn(new Set(((sm.data || []) as { id: string }[]).map((x) => x.id)));
    })();
  }, [supabase]);

  async function flip(p: Person, value: boolean) {
    setBusy(p.id);
    setError("");
    const { data, error } = await supabase.from("profiles").update({ super_mode: value }).eq("id", p.id).select("id");
    setBusy("");
    if (error) return setError(error.message);
    if (!data?.length) return setError(`Couldn't change ${p.full_name || "that account"}.`);
    setOn((s) => {
      const n = new Set(s);
      if (value) n.add(p.id);
      else n.delete(p.id);
      return n;
    });
    if (p.id === me) {
      // Your own view changes right away.
      resetMode();
      window.location.reload();
    }
  }

  if (!show) return null;
  return (
    <section style={{ marginTop: 26 }}>
      <div className="eyebrow">Super admin</div>
      <h2 style={{ margin: "0 0 4px", fontSize: 19 }}>Super mode</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Voice Noodle is voice, tone, script and Straight Line training. Super mode adds the extras: sales reports, rotation, Deal Clip, Master Your Craft, the Thursday
        meeting, coaching trends, KPI and retention numbers, one-on-ones and notes. The data keeps coming in either way; only the screens change.
      </p>
      <div className="card" style={{ display: "grid", gap: 2 }}>
        {people.map((p) => (
          <label key={p.id} style={{ display: "flex", gap: 12, alignItems: "center", padding: "8px 0", cursor: "pointer", borderBottom: "1px solid var(--line)" }}>
            <input type="checkbox" checked={on.has(p.id)} disabled={busy === p.id} onChange={(e) => void flip(p, e.target.checked)} style={{ width: 18, height: 18 }} />
            <span style={{ flex: 1 }}>
              <b>{p.full_name || p.email || "Unnamed"}</b>
              {p.id === me && <small className="muted"> · you</small>}
              <br />
              <small className="muted">{p.role === "admin" ? "Admin" : p.team === "ams" ? "Service manager" : "Sales manager"}</small>
            </span>
            <span className={`pill ${on.has(p.id) ? "good" : ""}`}>{on.has(p.id) ? "Super mode" : "Core"}</span>
          </label>
        ))}
        {error && <div className="error">{error}</div>}
      </div>
      <p className="hint">This list always stays here for you, even with your own super mode off. Others see the change the next time they open or refresh a page.</p>
    </section>
  );
}
