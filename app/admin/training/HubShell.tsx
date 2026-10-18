"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Material, Person, Topic } from "@/lib/training";
import { HubContext, type HubData } from "./shared";
import "../calls/calls.css";
import "./training.css";

/**
 * Loads what the training and meeting pages share (people, topics, library)
 * once, and hands it to whatever is inside. Used by the Training hub, Master
 * Your Craft and the Thursday meeting pages.
 */
export default function HubShell({
  eyebrow,
  title,
  intro,
  above,
  children,
}: {
  eyebrow: string;
  title: string;
  intro: ReactNode;
  above?: ReactNode;
  children: ReactNode;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [base, setBase] = useState<{ orgId: string; me: string; managers: Person[]; reps: Person[] } | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [error, setError] = useState("");

  const reloadLibrary = useCallback(async () => {
    const [t, m] = await Promise.all([
      supabase.from("training_topics").select("id, title, category, description, archived").order("title"),
      supabase.from("training_materials").select("*").order("created_at", { ascending: false }),
    ]);
    if (t.error)
      setError(
        /relation|does not exist/i.test(t.error.message)
          ? `${t.error.message} -- run supabase/training.sql in the Supabase SQL Editor first.`
          : t.error.message
      );
    setTopics((t.data || []) as Topic[]);
    setMaterials((m.data || []) as Material[]);
  }, [supabase]);

  useEffect(() => {
    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;
      const { data: me } = await supabase.from("profiles").select("org_id").eq("id", session.user.id).single();
      const { data: people } = await supabase
        .from("profiles")
        .select("id, full_name, role, team, active")
        .eq("org_id", me?.org_id ?? "")
        .eq("active", true)
        .order("full_name");
      const all = (people || []) as (Person & { role: string })[];
      setBase({
        orgId: me?.org_id ?? "",
        me: session.user.id,
        managers: all.filter((p) => p.role === "admin" || p.role === "manager"),
        reps: all.filter((p) => p.role === "rep"),
      });
      await reloadLibrary();
    })();
  }, [supabase, reloadLibrary]);

  const hub: HubData | null = useMemo(() => {
    if (!base) return null;
    const everyone = new Map([...base.managers, ...base.reps].map((p) => [p.id, p]));
    return {
      supabase,
      ...base,
      topics,
      materials,
      reloadLibrary,
      personById: (id) => (id ? everyone.get(id) : undefined),
    };
  }, [base, topics, materials, supabase, reloadLibrary]);

  return (
    <main className="shell tr-shell">
      <div className="eyebrow">{eyebrow}</div>
      <h1>{title}</h1>
      <p className="muted" style={{ maxWidth: "66ch", marginBottom: 0 }}>
        {intro}
      </p>
      {above}
      {error && <div className="error">{error}</div>}
      {!hub ? <p className="muted">Loading&hellip;</p> : <HubContext.Provider value={hub}>{children}</HubContext.Provider>}
    </main>
  );
}
