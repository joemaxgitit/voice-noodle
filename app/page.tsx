"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type ModuleRow = {
  id: string;
  title: string;
  sort_order: number;
  script_id: string;
  segments: { id: string }[];
};

type ScriptRow = {
  id: string;
  title: string;
  sort_order: number;
};

export default function Home() {
  const supabase = createClient();
  const router = useRouter();

  const [scripts, setScripts] = useState<ScriptRow[]>([]);
  const [modules, setModules] = useState<ModuleRow[]>([]);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [role, setRole] = useState<string>("rep");
  const [name, setName] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const [profileRes, scriptRes, moduleRes, progressRes] = await Promise.all([
        supabase.from("profiles").select("full_name, role").eq("id", user.id).single(),
        supabase.from("scripts").select("id, title, sort_order"),
        supabase
          .from("modules")
          .select("id, title, sort_order, script_id, segments(id)"),
        supabase.from("progress").select("segment_id").eq("completed", true),
      ]);

      if (cancelled) return;

      if (moduleRes.error) setError(moduleRes.error.message);

      setName(profileRes.data?.full_name || "");
      setRole(profileRes.data?.role || "rep");
      setScripts(
        (scriptRes.data || []).sort((a, b) => a.sort_order - b.sort_order)
      );
      setModules(
        ((moduleRes.data || []) as unknown as ModuleRow[]).sort(
          (a, b) => a.sort_order - b.sort_order
        )
      );
      setDone(new Set((progressRes.data || []).map((r) => r.segment_id)));
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [supabase]);

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  if (loading) {
    return (
      <main className="shell">
        <p className="muted">Loading…</p>
      </main>
    );
  }

  return (
    <main className="shell">
      <div className="topbar">
        <div className="brand">Voice Noodle</div>
        <div className="row">
          {["admin", "manager"].includes(role) && (
            <Link className="btn" href="/admin" style={{ textDecoration: "none" }}>
              Admin
            </Link>
          )}
          <button onClick={signOut}>Sign out</button>
        </div>
      </div>

      <div className="eyebrow">{name ? `Welcome back, ${name}` : "Training"}</div>
      <h1>Pick a section</h1>
      <p className="muted">
        Work one card at a time. Listen, repeat it out loud, then move on.
      </p>

      {error && <div className="error">{error}</div>}

      {scripts.length === 0 && !error && (
        <p className="muted" style={{ marginTop: 24 }}>
          No scripts are assigned to your account yet. Ask your manager to add you
          to an organization.
        </p>
      )}

      {scripts.map((script) => {
        const mine = modules.filter((m) => m.script_id === script.id);
        if (mine.length === 0) return null;

        return (
          <section key={script.id}>
            <h2>{script.title}</h2>
            <ul className="list">
              {mine.map((m) => {
                const total = m.segments?.length ?? 0;
                const complete = (m.segments || []).filter((s) =>
                  done.has(s.id)
                ).length;

                return (
                  <li key={m.id}>
                    <Link href={`/train/${m.id}`}>
                      <span>{m.title}</span>
                      <span className="count">
                        {total === 0 ? "empty" : `${complete} / ${total}`}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </main>
  );
}
