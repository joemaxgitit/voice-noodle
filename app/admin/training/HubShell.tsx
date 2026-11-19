"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { DEPT_LABEL, deptOfTeam, type Dept, type Material, type Person, type Topic } from "@/lib/training";
import { HubContext, type HubData } from "./shared";
import { setDeptView, useDeptView } from "@/lib/deptView";
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
  switchable,
}: {
  eyebrow: string;
  title: string;
  intro: ReactNode;
  above?: ReactNode;
  children: ReactNode;
  /** Admins can switch between the Sales, Service and Openers hubs (the Training hub). Otherwise it's sales. */
  switchable?: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [base, setBase] = useState<{ orgId: string; me: string; managers: Person[]; reps: Person[]; isAdmin: boolean; ownDept: Exclude<Dept, "all"> } | null>(null);
  // Admins: the department picked in the sidebar's Viewing switch (or here); sales when viewing everything.
  const view = useDeptView();
  const [topics, setTopics] = useState<Topic[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [error, setError] = useState("");

  const reloadLibrary = useCallback(async () => {
    // eslint-disable-next-line prefer-const
    let [t, m] = await Promise.all([
      supabase.from("training_topics").select("id, title, category, description, archived, dept").order("title"),
      supabase.from("training_materials").select("*").order("created_at", { ascending: false }),
    ]);
    // Before supabase/training-depts.sql is run there's no dept column yet.
    if (t.error && /dept/.test(t.error.message)) t = (await supabase.from("training_topics").select("id, title, category, description, archived").order("title")) as unknown as typeof t;
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
      const { data: me } = await supabase.from("profiles").select("org_id, role, team").eq("id", session.user.id).single();
      const { data: people } = await supabase
        .from("profiles")
        .select("id, full_name, role, team, active")
        .eq("org_id", me?.org_id ?? "")
        .eq("active", true)
        .order("full_name");
      // Separate query: an older database without this column must not break the hub.
      const { data: tr } = await supabase.from("profiles").select("id, in_training").eq("org_id", me?.org_id ?? "");
      const training = new Set(((tr || []) as { id: string; in_training: boolean }[]).filter((x) => x.in_training).map((x) => x.id));
      const all = ((people || []) as (Person & { role: string })[]).map((p) => ({ ...p, in_training: training.has(p.id) }));
      setBase({
        orgId: me?.org_id ?? "",
        me: session.user.id,
        managers: all.filter((p) => p.role === "admin" || p.role === "manager"),
        reps: all.filter((p) => p.role === "rep"),
        isAdmin: me?.role === "admin",
        ownDept: deptOfTeam(me?.team),
      });
      await reloadLibrary();
    })();
  }, [supabase, reloadLibrary]);

  // Managers work in their own department's hub; admins in the one they picked (sales on the meeting pages).
  const dept: Exclude<Dept, "all"> = !base ? "sales" : base.isAdmin ? (switchable && view !== "all" ? view : "sales") : base.ownDept;
  const hub: HubData | null = useMemo(() => {
    if (!base) return null;
    const everyone = new Map([...base.managers, ...base.reps].map((p) => [p.id, p]));
    const mine = <T extends { dept?: Dept }>(xs: T[]) => xs.filter((x) => !x.dept || x.dept === dept || x.dept === "all");
    return {
      supabase,
      orgId: base.orgId,
      me: base.me,
      managers: base.managers,
      reps: base.reps.filter((p) => deptOfTeam(p.team) === dept),
      topics: mine(topics),
      materials: mine(materials),
      reloadLibrary,
      dept,
      isAdmin: base.isAdmin,
      personById: (id) => (id ? everyone.get(id) : undefined),
    };
  }, [base, topics, materials, supabase, reloadLibrary, dept]);

  return (
    <main className="shell tr-shell">
      <div className="eyebrow">{eyebrow}</div>
      <h1>{title}</h1>
      <p className="muted" style={{ maxWidth: "66ch", marginBottom: 0 }}>
        {intro}
      </p>
      {switchable && base?.isAdmin && (
        <div className="unit-switch" role="group" aria-label="Department" style={{ marginTop: 12 }}>
          {(Object.keys(DEPT_LABEL) as Exclude<Dept, "all">[]).map((d) => (
            <button key={d} aria-pressed={dept === d} onClick={() => setDeptView(d)}>
              {DEPT_LABEL[d]}
            </button>
          ))}
        </div>
      )}
      {switchable && base && !base.isAdmin && <div className="eyebrow" style={{ marginTop: 10 }}>{DEPT_LABEL[base.ownDept]} training</div>}
      {above}
      {error && <div className="error">{error}</div>}
      {!hub ? <p className="muted">Loading&hellip;</p> : <HubContext.Provider value={hub}>{children}</HubContext.Provider>}
    </main>
  );
}
