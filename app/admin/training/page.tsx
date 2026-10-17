"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Material, Person, Topic } from "@/lib/training";
import { HubContext, type HubData } from "./shared";
import CalendarTab from "./CalendarTab";
import MasteryTab from "./MasteryTab";
import MeetingTab from "./MeetingTab";
import LibraryTab from "./LibraryTab";
import "../calls/calls.css";
import "./training.css";

type Tab = "calendar" | "mastery" | "meeting" | "library";
const TABS: { id: Tab; label: string }[] = [
  { id: "calendar", label: "Calendar" },
  { id: "mastery", label: "Master Your Craft" },
  { id: "meeting", label: "Thursday meeting" },
  { id: "library", label: "Library" },
];
const TAB_KEY = "vn-training-tab";

/**
 * Training Hub for managers: the calendar, Master Your Craft classes, the
 * Thursday sales meeting, and the library of videos and documents.
 */
export default function TrainingHub() {
  const supabase = useMemo(() => createClient(), []);
  const [tab, setTabState] = useState<Tab>("calendar");
  const [base, setBase] = useState<{ orgId: string; me: string; managers: Person[]; reps: Person[] } | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    try {
      const t = localStorage.getItem(TAB_KEY) as Tab | null;
      if (t && TABS.some((x) => x.id === t)) setTabState(t);
    } catch {
      // storage blocked
    }
  }, []);
  const setTab = (t: Tab) => {
    setTabState(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      // ignore
    }
  };

  const reloadLibrary = useCallback(async () => {
    const [t, m] = await Promise.all([
      supabase.from("training_topics").select("id, title, category, description, archived").order("title"),
      supabase.from("training_materials").select("*").order("created_at", { ascending: false }),
    ]);
    if (t.error) setError(/relation|does not exist/i.test(t.error.message) ? `${t.error.message} -- run supabase/training.sql in the Supabase SQL Editor first.` : t.error.message);
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
      <div className="eyebrow">Training</div>
      <h1>Training hub</h1>
      <p className="muted" style={{ maxWidth: "66ch", marginBottom: 0 }}>
        Plan the training calendar, run Master Your Craft and the Thursday meeting, and keep the videos and documents reps
        study from. Reps see only what you publish.
      </p>

      <nav className="tr-tabs" role="tablist" aria-label="Training hub sections">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "active" : ""} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      {error && <div className="error">{error}</div>}
      {!hub ? (
        <p className="muted">Loading&hellip;</p>
      ) : (
        <HubContext.Provider value={hub}>
          {tab === "calendar" && <CalendarTab openTab={(t) => setTab(t as Tab)} />}
          {tab === "mastery" && <MasteryTab />}
          {tab === "meeting" && <MeetingTab />}
          {tab === "library" && <LibraryTab />}
        </HubContext.Provider>
      )}
    </main>
  );
}
