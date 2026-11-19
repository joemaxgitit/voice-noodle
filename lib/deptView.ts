"use client";

import { useEffect, useState } from "react";
import { deptOfTeam } from "@/lib/training";

/*
  Which department an admin is looking at: everything, or just Sales,
  Service or Openers. Filters the Reps list, Calls, Home and the Training
  hub, and hides the sales-only pages when looking at Service or Openers.
  It's a view only -- the database still decides what anyone can see.
  Kept per browser; every open page follows a change.
*/
export type DeptView = "all" | "sales" | "service" | "openers";
const KEY = "vn-dept-view";
const EVENT = "vn-dept-view";

export function readDeptView(): DeptView {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "sales" || v === "service" || v === "openers") return v;
  } catch {
    // storage blocked
  }
  return "all";
}

export function setDeptView(v: DeptView) {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    // ignore
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: v }));
}

export function useDeptView(): DeptView {
  const [v, setV] = useState<DeptView>("all");
  useEffect(() => {
    setV(readDeptView());
    const on = () => setV(readDeptView());
    window.addEventListener(EVENT, on);
    window.addEventListener("storage", on);
    return () => {
      window.removeEventListener(EVENT, on);
      window.removeEventListener("storage", on);
    };
  }, []);
  return v;
}

/** Is a rep on this team part of the department being viewed? */
export const inDeptView = (view: DeptView, team: string | null | undefined) => view === "all" || deptOfTeam(team) === view;
