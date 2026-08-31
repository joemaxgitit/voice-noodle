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
  const [lang, setLang] = useState<"en" | "es">("en");
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

      const [profileRes, scriptRes, moduleRes, progressRes] = await Promise.all([
        supabase.from("profiles").select("full_name, role").eq("id", user.id).single(),
        supabase.from("scripts").select("id, title, sort_order, logo_url"),
        supabase
          .from("modules")
          .select("id, title, sort_order, script_id, kind, language, segments(id)"),
        supabase.from("progress").select("segment_id").eq("completed", true),
      ]);

      if (cancelled) return;

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
        <p className="muted">Loading…</p>
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
          {["admin", "manager"].includes(role) && (
            <Link className="btn" href="/admin" style={{ textDecoration: "none" }}>
              Admin
            </Link>
          )}
          <button onClick={signOut}>Sign out</button>
        </div>
      </header>

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
                      {total === 0 ? "empty" : `${complete} / ${total}`}
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
                  onClick={() => setLang("en")}
                >
                  English
                </button>
                <button
                  aria-pressed={lang === "es"}
                  onClick={() => setLang("es")}
                >
                  Espa&ntilde;ol
                </button>
              </div>
            )}

            {sequence.length > 0 && (
              <>
                <h2>
                  The call, in order
                  <Link className="section-link" href={`/script/${script.id}`}>
                    Full script
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
                <h2>When they object</h2>
                <p className="muted group-note">
                  An objection is uncertainty about one of three things: the
                  program, you, or the company. Pick the loop that rebuilds
                  the one that slipped.
                </p>
                {renderList(loops)}
              </>
            )}
          </section>
        );
      })}
    </main>
  );
}
