"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { readLang, setLang as rememberLang, type Lang } from "@/lib/lang";
import { copyFor } from "@/lib/copy";
import TodayPanel from "./TodayPanel";
import ProgressPanel from "./ProgressPanel";
import "./training/training.css";

type HomeTab = "today" | "practice" | "progress";
const TAB_KEY = "vn-home-tab";

type ModuleRow = {
  id: string;
  title: string;
  sort_order: number;
  script_id: string;
  kind: string;
  language: string;
  segments: { id: string }[];
};

type ScriptRow = {
  id: string;
  title: string;
  sort_order: number;
  logo_url: string | null;
};

export default function HomeView() {
  const supabase = createClient();
  const router = useRouter();

  const [scripts, setScripts] = useState<ScriptRow[]>([]);
  const [modules, setModules] = useState<ModuleRow[]>([]);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [role, setRole] = useState<string>("rep");
  const [roleplayOn, setRoleplayOn] = useState(false);
  const [newCards, setNewCards] = useState(0);
  const [userId, setUserId] = useState("");
  const [tab, setTabState] = useState<HomeTab>("today");
  useEffect(() => {
    try {
      const t = localStorage.getItem(TAB_KEY) as HomeTab | null;
      if (t === "today" || t === "practice" || t === "progress") setTabState(t);
    } catch {
      // storage blocked
    }
  }, []);
  const setTab = (t: HomeTab) => {
    setTabState(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      // ignore
    }
  };
  const [lang, setLangState] = useState<Lang>("en");
  const [name, setName] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      /*
        getSession reads the stored session and refreshes it when expired,
        rather than making a bare network call for the user. Straight after
        sign-in the token can briefly not be in place yet, and querying then
        returns zero rows -- which used to render as "no scripts assigned".
      */
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.replace("/login");
        return;
      }

      const user = session.user;
      setUserId(user.id);

      const [profileRes, scriptRes, moduleRes, progressRes] = await Promise.all([
        supabase.from("profiles").select("full_name, role, org_id").eq("id", user.id).single(),
        supabase.from("scripts").select("id, title, sort_order, logo_url"),
        supabase
          .from("modules")
          .select("id, title, sort_order, script_id, kind, language, segments(id)"),
        supabase.from("progress").select("segment_id").eq("completed", true),
      ]);

      if (cancelled) return;

      // Signed in with a temporary password: pick your own first. Asked
      // separately so the page still works before passwords.sql has run.
      void supabase
        .from("profiles")
        .select("must_change_password")
        .eq("id", user.id)
        .maybeSingle()
        .then(({ data }) => {
          if (!cancelled && (data as { must_change_password?: boolean } | null)?.must_change_password) router.replace("/account?first=1");
        });

      /*
        Surface whichever query failed. Only the modules error was reported
        before, so a failure on scripts fell through to zero rows and the page
        told the person their account had no scripts -- which sent them to
        their manager over what was actually a token problem.
      */
      const failed = scriptRes.error || moduleRes.error || profileRes.error;
      if (failed) setError(failed.message);

      setName(profileRes.data?.full_name || "");
      setRole(profileRes.data?.role || "rep");

      // A dot on My training when a manager has sent a card they haven't opened.
      supabase
        .from("training_cards")
        .select("id", { count: "exact", head: true })
        .eq("rep_id", user.id)
        .eq("status", "sent")
        .is("read_at", null)
        .then(({ count }) => {
          if (!cancelled) setNewCards(count ?? 0);
        });

      // Practice calls appear only while a manager has them switched on.
      if (profileRes.data?.org_id) {
        supabase
          .from("orgs")
          .select("roleplay_enabled")
          .eq("id", profileRes.data.org_id)
          .maybeSingle()
          .then(({ data }) => {
            if (!cancelled) setRoleplayOn(!!data?.roleplay_enabled);
          });
      }
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

  // Remembered across pages, so the footer's tone key matches.
  useEffect(() => {
    setLangState(readLang());
  }, []);

  const c = copyFor(lang);
  const es = lang === "es";

  // The script section they're partway through, for "pick up where you left off".
  const resume = (() => {
    for (const m of modules.filter((x) => (x.language || "en") === lang && x.kind !== "loop")) {
      const total = m.segments?.length ?? 0;
      const complete = (m.segments || []).filter((sg) => done.has(sg.id)).length;
      if (total && complete > 0 && complete < total) return { id: m.id, title: m.title, total, complete };
    }
    const first = modules.find((x) => (x.language || "en") === lang && x.kind !== "loop" && (x.segments?.length ?? 0) > 0 && !(x.segments || []).every((sg) => done.has(sg.id)));
    return first ? { id: first.id, title: first.title, total: first.segments.length, complete: first.segments.filter((sg) => done.has(sg.id)).length } : null;
  })();

  function choose(next: Lang) {
    setLangState(next);
    rememberLang(next);
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  // Row level security already limits scripts to this person's team, so when
  // exactly one comes back it is theirs. Admins see several; fall back to the
  // product mark rather than picking a client's logo arbitrarily.
  // One script means one client, so show theirs. Admins see every script and
  // get the parent company mark instead of an arbitrary client's.
  const headerLogo =
    (scripts.length === 1 ? scripts[0].logo_url : null) ?? "/proedge-logo.png";

  if (loading) {
    return (
      <main className="shell">
        <p className="muted">{c.loading}</p>
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="site-header">
        <span className="site-header-spacer" aria-hidden="true" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className={`header-logo dark-only ${
            headerLogo === "/proedge-logo.png" ? "header-logo-wide" : ""
          }`}
          src={headerLogo}
          alt=""
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className={`header-logo light-only ${
            headerLogo === "/proedge-logo.png" ? "header-logo-wide" : ""
          }`}
          src={headerLogo.replace(/\.png$/, "-light.png").replace(
            "/lionside-logo-light.png",
            "/lionside-logo-print.png"
          )}
          alt=""
        />
        <div className="site-header-actions">
          <Link className="btn" href="/training" style={{ textDecoration: "none" }}>
            {lang === "es" ? "Mi capacitación" : "My training"}
            {newCards > 0 && (
              <span className="pill" style={{ marginLeft: 6, color: "var(--live)", borderColor: "var(--live)" }}>
                {newCards} new
              </span>
            )}
          </Link>
          {["admin", "manager"].includes(role) && (
            <Link className="btn" href="/admin/home" style={{ textDecoration: "none" }}>
              {c.admin}
            </Link>
          )}
          <Link className="btn" href="/account" style={{ textDecoration: "none" }} title={lang === "es" ? "Cambiar contraseña" : "Change password"}>
            {lang === "es" ? "Cuenta" : "Account"}
          </Link>
          <button onClick={signOut}>{c.signOut}</button>
        </div>
      </header>

      <div className="eyebrow">
        {name ? `${c.welcomeBack}, ${name}` : c.training}
      </div>

      <nav className="home-tabs" role="tablist" aria-label={es ? "Secciones" : "Sections"}>
        {(
          [
            ["today", es ? "Hoy" : "Today"],
            ["practice", es ? "Práctica" : "Practice"],
            ["progress", es ? "Mi progreso" : "My progress"],
          ] as [HomeTab, string][]
        ).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>

      {error && <div className="error">{error}</div>}

      {tab === "today" && <TodayPanel supabase={supabase} es={es} resume={resume} roleplayOn={roleplayOn} openPractice={() => setTab("practice")} />}
      {tab === "progress" && userId && <ProgressPanel supabase={supabase} userId={userId} es={es} linesDone={done.size} />}
      {tab === "practice" && (
        <>
      <h1>{c.pickSection}</h1>
      <p className="muted">{c.pickSectionBlurb}</p>

      {scripts.length === 0 && !error && (
        <p className="muted" style={{ marginTop: 24 }}>
          {c.noScripts}
        </p>
      )}

      {scripts.map((script) => {
        const mine = modules.filter((m) => m.script_id === script.id);
        if (mine.length === 0) return null;

        const hasSpanish = mine.some((m) => m.language === "es");
        const inLang = mine.filter((m) => (m.language || "en") === lang);
        const sequence = inLang.filter((m) => m.kind !== "loop");
        const loops = inLang.filter((m) => m.kind === "loop");

        const renderList = (list: ModuleRow[]) => (
          <ul className="list">
            {list.map((m) => {
              const total = m.segments?.length ?? 0;
              const complete = (m.segments || []).filter((sg) =>
                done.has(sg.id)
              ).length;

              return (
                <li key={m.id}>
                  <Link href={`/train/${m.id}`}>
                    <span>{m.title}</span>
                    <span className="count">
                      {total === 0 ? c.empty : `${complete} / ${total}`}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        );

        return (
          <section key={script.id}>
            {scripts.length > 1 && <h2 className="script-title">{script.title}</h2>}

            {hasSpanish && (
              <div className="lang-switch">
                <button
                  aria-pressed={lang === "en"}
                  onClick={() => choose("en")}
                >
                  English
                </button>
                <button
                  aria-pressed={lang === "es"}
                  onClick={() => choose("es")}
                >
                  Espa&ntilde;ol
                </button>
              </div>
            )}

            {sequence.length > 0 && (
              <>
                <h2>
                  {c.callInOrder}
                  <Link className="section-link" href={`/script/${script.id}`}>
                    {c.fullScriptLink}
                  </Link>
                </h2>
                {renderList(sequence)}
              </>
            )}

            {/*
              Loops are conditional, not sequential. Listing them inside the
              numbered flow would teach reps to run all three every time. The
              point is to reach for the one matching whatever the client is
              actually uncertain about.
            */}
            {loops.length > 0 && (
              <>
                <h2>{c.whenTheyObject}</h2>
                <p className="muted group-note">{c.objectionBlurb}</p>
                {renderList(loops)}
              </>
            )}
          </section>
        );
      })}
        </>
      )}
    </main>
  );
}
