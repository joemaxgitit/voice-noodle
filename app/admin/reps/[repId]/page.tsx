"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { loadRepHistory, type RepHistory } from "@/lib/repHistory";
import type { MetricPref } from "@/lib/kpi";
import KpiTab from "./KpiTab";
import Overview from "./Overview";
import Activity from "./Activity";
import NotesFiles from "./NotesFiles";
import Reviews from "./Reviews";
import Cards from "./Cards";
import OneOnOne from "./OneOnOne";
import "../../calls/calls.css";
import "../../training/training.css";
import "../reps.css";

type Tab = "overview" | "one" | "kpi" | "activity" | "notes" | "cards" | "review";
const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "one", label: "One-on-one" },
  { id: "kpi", label: "KPI one-on-one" },
  { id: "activity", label: "Calls & activity" },
  { id: "notes", label: "Notes & files" },
  { id: "cards", label: "Training cards" },
  { id: "review", label: "Coaching review" },
];

export type Ctx = {
  supabase: ReturnType<typeof createClient>;
  orgId: string;
  me: string;
  repId: string;
  repName: string;
  history: RepHistory;
  people: Map<string, string>;
  reload: () => Promise<void>;
  openTab: (t: Tab) => void;
  seedCard: (focus: string, reviewId: string | null) => void;
};

/** One rep, everything on record: managers and admins only. */
export default function RepProfile() {
  const { repId } = useParams<{ repId: string }>();
  const supabase = useMemo(() => createClient(), []);
  const [tab, setTab] = useState<Tab>("overview");
  const [rep, setRep] = useState<{ full_name: string | null; role: string; team: string | null; active: boolean; kpi_name: string | null } | null>(null);
  const [orgId, setOrgId] = useState("");
  const [me, setMe] = useState("");
  const [people, setPeople] = useState<Map<string, string>>(new Map());
  const [history, setHistory] = useState<RepHistory | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [seed, setSeed] = useState<{ focus: string; reviewId: string | null } | null>(null);
  const clearSeed = useCallback(() => setSeed(null), []);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab") as Tab | null;
    if (t && TABS.some((x) => x.id === t)) setTab(t);
  }, []);
  const openTab = useCallback((t: Tab) => {
    setTab(t);
    const u = new URL(window.location.href);
    u.searchParams.set("tab", t);
    window.history.replaceState(null, "", u.toString());
  }, []);

  const reload = useCallback(async () => {
    const { history, errors } = await loadRepHistory(supabase, repId);
    setHistory(history);
    setErrors(errors);
  }, [supabase, repId]);

  useEffect(() => {
    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;
      setMe(session.user.id);
      const [{ data: r }, { data: mine }] = await Promise.all([
        supabase.from("profiles").select("full_name, role, team, active, kpi_name").eq("id", repId).maybeSingle(),
        supabase.from("profiles").select("org_id").eq("id", session.user.id).single(),
      ]);
      setRep(r);
      setOrgId(mine?.org_id ?? "");
      const { data: ppl } = await supabase.from("profiles").select("id, full_name").eq("org_id", mine?.org_id ?? "");
      setPeople(new Map((ppl || []).map((p) => [p.id as string, (p.full_name as string) || "Someone"])));
      await reload();
    })();
  }, [supabase, repId, reload]);

  const name = rep?.full_name || "This rep";
  const missingSql = errors.some((e) => /rep_notes|rep_files|rep_reviews|kpi_|does not exist/i.test(e));

  const ctx: Ctx | null =
    history && orgId
      ? { supabase, orgId, me, repId, repName: name, history, people, reload, openTab, seedCard: (focus: string, reviewId: string | null) => (setSeed({ focus, reviewId }), openTab("cards")) }
      : null;

  return (
    <main className="shell rx-page">
      <div className="rx-head">
        <div>
          <div className="eyebrow">
            <Link href="/admin/reps" style={{ color: "inherit" }}>
              Reps
            </Link>{" "}
            / profile
          </div>
          <h1>{rep ? name : "Loading…"}</h1>
          {rep && (
            <p className="muted" style={{ margin: 0 }}>
              {rep.team === "closers" ? "Sales" : rep.team === "ams" ? "Account manager" : rep.role === "rep" ? "Rep" : rep.role}
              {!rep.active ? " · inactive" : ""}
              {rep.kpi_name && rep.kpi_name !== rep.full_name ? ` · "${rep.kpi_name}" in the CRM reports` : ""}
            </p>
          )}
        </div>
        <div className="rx-actions rx-noprint">
          <button className="primary" onClick={() => openTab("one")}>
            One-on-one
          </button>
          <button onClick={() => openTab("review")}>Coaching review</button>
          <Link className="btn" href={`/admin/reps/${repId}/view`} style={{ textDecoration: "none" }}>
            Rep&rsquo;s view
          </Link>
        </div>
      </div>
      <p className="hint rx-noprint" style={{ marginTop: 8 }}>
        Private to managers and admins. {name.split(" ")[0]} can&rsquo;t see anything on this page.
      </p>

      <nav className="tr-tabs rx-noprint" role="tablist" aria-label="Profile sections">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "active" : ""} onClick={() => openTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      {missingSql && <div className="error">Some of this page needs supabase/rep-profile.sql -- run it in the Supabase SQL Editor. ({errors[0]})</div>}
      {!missingSql && errors.length > 0 && <div className="error">{errors.join(" · ")}</div>}

      {!ctx ? (
        <p className="muted">Loading&hellip;</p>
      ) : (
        <>
          {tab === "overview" && <Overview ctx={ctx} />}
          {tab === "one" && <OneOnOne ctx={ctx} />}
          {tab === "kpi" && (
            <KpiTab
              supabase={supabase}
              orgId={orgId}
              repId={repId}
              repName={name}
              history={ctx.history}
              setPrefs={(p: Map<string, MetricPref>) => setHistory((h) => (h ? { ...h, prefs: p } : h))}
            />
          )}
          {tab === "activity" && <Activity ctx={ctx} />}
          {tab === "notes" && <NotesFiles ctx={ctx} />}
          {tab === "cards" && <Cards ctx={ctx} seed={seed} clearSeed={clearSeed} />}
          {tab === "review" && <Reviews ctx={ctx} />}
        </>
      )}
    </main>
  );
}
