"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import HubShell from "./HubShell";
import CalendarTab from "./CalendarTab";
import LibraryTab from "./LibraryTab";
import ProgressTab from "./ProgressTab";

type Tab = "calendar" | "library" | "progress";
const TABS: { id: Tab; label: string }[] = [
  { id: "calendar", label: "Calendar" },
  { id: "library", label: "Library" },
  { id: "progress", label: "Rep progress" },
];
const TAB_KEY = "vn-training-tab";

/**
 * Training hub for managers: the calendar, the library of videos, documents
 * and assignments, and rep progress. Master Your Craft and the Thursday
 * meeting have their own pages under Meetings.
 */
export default function TrainingHub() {
  const router = useRouter();
  const [tab, setTabState] = useState<Tab>("calendar");

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

  return (
    <HubShell
      eyebrow="Training"
      title="Training hub"
      intro="Plan the training calendar, keep the videos, documents and knowledge checks reps study from, and see who is keeping up. Reps see only what you publish."
      above={
        <nav className="tr-tabs" role="tablist" aria-label="Training hub sections">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "active" : ""} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
      }
    >
      {tab === "calendar" && <CalendarTab openTab={(t) => router.push(t === "mastery" ? "/admin/mastery" : "/admin/meeting")} />}
      {tab === "library" && <LibraryTab />}
      {tab === "progress" && <ProgressTab />}
    </HubShell>
  );
}
