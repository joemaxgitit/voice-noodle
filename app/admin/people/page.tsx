"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type Person = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: string;
  active: boolean;
  org_id: string | null;
};

const ROLES = [
  { value: "rep", label: "Rep" },
  { value: "manager", label: "Manager" },
  { value: "admin", label: "Admin" },
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

  const load = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) setMe(user.id);

    const { data, error } = await supabase
      .from("profiles")
      .select("id, email, full_name, role, active, org_id");

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    const rows = (data || []) as Person[];
    setPeople(rows);
    setOrgId(rows.find((p) => p.id === user?.id)?.org_id ?? null);
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
      <div className="topbar">
        <Link className="btn" href="/admin" style={{ textDecoration: "none" }}>
          &larr; Admin
        </Link>
        <div className="brand">People</div>
      </div>

      <h1>People</h1>
      <p className="muted">
        Create the account in Supabase first, then claim it here and set the
        name and role.
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
