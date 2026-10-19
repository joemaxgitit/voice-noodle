"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Person = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: string;
  team: string | null;
  active: boolean;
  org_id: string | null;
  in_training?: boolean;
};

const ROLES = [
  { value: "rep", label: "Rep" },
  { value: "manager", label: "Manager" },
  { value: "admin", label: "Admin" },
];

// Team decides which script someone can reach. Enforced by row level
// security, not just hidden in the interface.
const TEAMS = [
  { value: "", label: "No team" },
  { value: "closers", label: "Closers" },
  { value: "ams", label: "Account Managers" },
];

export default function People() {
  const supabase = createClient();

  const [me, setMe] = useState<string>("");
  const [orgId, setOrgId] = useState<string | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string>("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [myRole, setMyRole] = useState("");
  const [pwFor, setPwFor] = useState<string | null>(null);
  const [tempPw, setTempPw] = useState("");
  const [pwDone, setPwDone] = useState<{ id: string; pw: string } | null>(null);

  const load = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) setMe(user.id);

    const { data, error } = await supabase
      .from("profiles")
      .select("id, email, full_name, role, team, active, org_id");

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    // Separate query: an older database without this column must not break the page.
    const { data: tr } = await supabase.from("profiles").select("id, in_training");
    const training = new Set(((tr || []) as { id: string; in_training: boolean }[]).filter((x) => x.in_training).map((x) => x.id));
    const rows = ((data || []) as Person[]).map((p) => ({ ...p, in_training: training.has(p.id) }));
    setPeople(rows);
    setOrgId(rows.find((p) => p.id === user?.id)?.org_id ?? null);
    setMyRole(rows.find((p) => p.id === user?.id)?.role ?? "");
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  async function patch(id: string, changes: Partial<Person>) {
    setBusy(id);
    setError("");
    setStatus("");

    const { error } = await supabase.from("profiles").update(changes).eq("id", id);

    if (error) setError(error.message);
    else {
      setPeople((list) =>
        list.map((p) => (p.id === id ? { ...p, ...changes } : p))
      );
      setStatus("Saved.");
    }

    setBusy("");
  }

  async function claim(id: string) {
    if (!orgId) {
      setError("Your own profile has no organization.");
      return;
    }
    await patch(id, { org_id: orgId, active: true });
    void load();
  }

  // Easy to read out loud or text: Edge-4827-km
  function makeTemp() {
    const n = Math.floor(1000 + Math.random() * 9000);
    const a = "abcdefghjkmnpqrstuvwxyz";
    const l = a[Math.floor(Math.random() * a.length)] + a[Math.floor(Math.random() * a.length)];
    return `Edge-${n}-${l}`;
  }

  async function setPassword(p: Person) {
    setError("");
    setStatus("");
    setBusy(p.id);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const res = await fetch("/api/admin/set-password", {
      method: "POST",
      headers: { Authorization: `Bearer ${session?.access_token ?? ""}`, "Content-Type": "application/json" },
      body: JSON.stringify({ userId: p.id, password: tempPw }),
    }).catch((e) => e as Error);
    setBusy("");
    if (res instanceof Error) return setError(res.message);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setError(body?.error || `Failed (${res.status}).`);
    setPwDone({ id: p.id, pw: tempPw });
    setPwFor(null);
  }

  if (loading) {
    return (
      <main className="shell">
        <p className="muted">Loading&hellip;</p>
      </main>
    );
  }

  const members = people.filter((p) => p.org_id);
  const unassigned = people.filter((p) => !p.org_id);

  return (
    <main className="shell">

      <h1>People</h1>
      <p className="muted">
        Create the account in Supabase first, then claim it here and set the
        name, team, and role. Team decides which script they can reach &mdash;
        closers and account managers cannot see each other&rsquo;s.
      </p>

      {error && <div className="error">{error}</div>}
      {status && <p className="status">{status}</p>}

      {unassigned.length > 0 && (
        <>
          <h2>Waiting to be added ({unassigned.length})</h2>
          <ul className="list">
            {unassigned.map((p) => (
              <li key={p.id}>
                <div className="person">
                  <div>
                    <div className="value">{p.email || "no email"}</div>
                    <div className="muted">Not in an organization yet</div>
                  </div>
                  <button
                    className="primary"
                    disabled={busy === p.id}
                    onClick={() => claim(p.id)}
                  >
                    {busy === p.id ? "Adding\u2026" : "Add to my team"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2>Team ({members.length})</h2>
      <ul className="list">
        {members.map((p) => (
          <li key={p.id}>
            <div className="person">
              <div style={{ flex: 1, minWidth: 0 }}>
                <input
                  type="text"
                  defaultValue={p.full_name || ""}
                  placeholder="Full name"
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v !== (p.full_name || "")) patch(p.id, { full_name: v });
                  }}
                />
                <div className="muted" style={{ marginTop: 6 }}>
                  {p.email || "no email"}
                  {p.id === me && " \u00b7 you"}
                </div>
              </div>

              <select
                value={p.team || ""}
                onChange={(e) =>
                  patch(p.id, { team: e.target.value || null })
                }
              >
                {TEAMS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>

              <select
                value={p.role}
                disabled={p.id === me}
                onChange={(e) => patch(p.id, { role: e.target.value })}
              >
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>

              {p.role === "rep" && (
                <label className="muted" style={{ display: "inline-flex", gap: 6, alignItems: "center", whiteSpace: "nowrap" }} title="Reps in training aren't in Master Your Craft">
                  <input
                    type="checkbox"
                    checked={!!p.in_training}
                    disabled={busy === p.id}
                    onChange={async (e) => {
                      const on = e.target.checked;
                      await patch(p.id, { in_training: on });
                      // In training means no Master Your Craft day until they graduate.
                      if (on) await supabase.from("mastery_regular").delete().eq("rep_id", p.id);
                    }}
                    style={{ width: "auto" }}
                  />
                  In training
                </label>
              )}

              <button
                disabled={busy === p.id || p.id === me}
                onClick={() => patch(p.id, { active: !p.active })}
              >
                {p.active ? "Disable" : "Enable"}
              </button>
            </div>
            {!p.active && (
              <div className="muted" style={{ marginTop: 6 }}>
                Disabled &mdash; cannot sign in to any content.
              </div>
            )}
            {p.id !== me && (myRole === "admin" || p.role === "rep") && (
              <div style={{ marginTop: 8 }}>
                {pwDone?.id === p.id ? (
                  <div className="status" style={{ margin: 0 }}>
                    Temporary password set: <b style={{ fontFamily: "var(--mono)" }}>{pwDone.pw}</b> &mdash; give it to {(p.full_name || "them").split(" ")[0]}. They&rsquo;ll pick their own when they sign in.
                  </div>
                ) : pwFor === p.id ? (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <input value={tempPw} onChange={(e) => setTempPw(e.target.value)} style={{ maxWidth: 220, fontFamily: "var(--mono)" }} aria-label="Temporary password" />
                    <button className="primary" disabled={busy === p.id || tempPw.length < 8} onClick={() => void setPassword(p)}>
                      {busy === p.id ? "Setting\u2026" : "Set temporary password"}
                    </button>
                    <button onClick={() => setPwFor(null)}>Cancel</button>
                  </div>
                ) : (
                  <button
                    className="link-btn"
                    onClick={() => {
                      setPwFor(p.id);
                      setTempPw(makeTemp());
                      setPwDone(null);
                    }}
                  >
                    Reset password
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      <h2>Adding someone new</h2>
      <ol className="muted" style={{ lineHeight: 1.8, paddingLeft: 20 }}>
        <li>Supabase &rarr; Authentication &rarr; Users &rarr; Add user</li>
        <li>Enter their email and a starting password</li>
        <li>Check <strong>Auto Confirm User</strong></li>
        <li>Come back here and press <strong>Add to my team</strong></li>
      </ol>
    </main>
  );
}
