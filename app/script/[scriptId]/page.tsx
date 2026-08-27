"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/client";

type Seg = {
  id: string;
  segment_code: string;
  script_text: string;
  tones: string[];
  verbatim: boolean;
  section: string | null;
  sort_order: number;
  module_id: string;
};

type Mod = {
  id: string;
  title: string;
  sort_order: number;
  kind: string;
  language: string;
};

/**
 * The whole script on one page.
 *
 * This is a second rendering of the same segments the cards use, not a
 * separate document -- so it cannot drift out of sync with training, and it
 * prints as the handout. Module names sit in the left margin inside a bracket
 * spanning their segments, which is the signalling cue: a rep can see at a
 * glance which part of the script they are looking at.
 */
function ScriptView() {
  const supabase = createClient();
  const params = useParams<{ scriptId: string }>();
  const search = useSearchParams();
  const focus = search.get("segment");

  const [title, setTitle] = useState("");
  const [mods, setMods] = useState<Mod[]>([]);
  const [segs, setSegs] = useState<Seg[]>([]);
  const [lang, setLang] = useState<"en" | "es">("en");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [sRes, mRes] = await Promise.all([
        supabase.from("scripts").select("title").eq("id", params.scriptId).single(),
        supabase
          .from("modules")
          .select("id, title, sort_order, kind, language")
          .eq("script_id", params.scriptId),
      ]);

      if (cancelled) return;

      const modules = ((mRes.data || []) as Mod[]).sort(
        (a, b) => a.sort_order - b.sort_order
      );

      const { data: segData } = await supabase
        .from("segments")
        .select(
          "id, segment_code, script_text, tones, verbatim, section, sort_order, module_id"
        )
        .in("module_id", modules.map((m) => m.id));

      if (cancelled) return;

      setTitle(sRes.data?.title || "Script");
      setMods(modules);
      setSegs(((segData || []) as Seg[]).sort((a, b) => a.sort_order - b.sort_order));
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [params.scriptId, supabase]);

  // Scroll to the passage a rep came from, then leave it marked.
  useEffect(() => {
    if (!focus || loading) return;
    const el = document.getElementById(`seg-${focus}`);
    if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focus, loading, segs]);

  const visible = useMemo(
    () => mods.filter((m) => (m.language || "en") === lang),
    [mods, lang]
  );

  const hasSpanish = mods.some((m) => m.language === "es");

  if (loading) {
    return (
      <main className="shell">
        <p className="muted">Loading&hellip;</p>
      </main>
    );
  }

  return (
    <main className="shell script-page">
      <div className="topbar no-print">
        <Link className="btn" href="/" style={{ textDecoration: "none" }}>
          &larr; Sections
        </Link>
        <button onClick={() => window.print()}>Print</button>
      </div>

      <h1>{title}</h1>
      <p className="muted no-print">
        The full script. Section names sit in the margin &mdash; click one to
        practise that part.
      </p>

      {hasSpanish && (
        <div className="lang-switch no-print">
          <button aria-pressed={lang === "en"} onClick={() => setLang("en")}>
            English
          </button>
          <button aria-pressed={lang === "es"} onClick={() => setLang("es")}>
            Espa&ntilde;ol
          </button>
        </div>
      )}

      {visible.map((m) => {
        const mine = segs.filter((sg) => sg.module_id === m.id);
        if (mine.length === 0) return null;

        return (
          <section className="script-block" key={m.id}>
            {/*
              Margin bracket. The label reads horizontally and sits at the
              vertical midpoint of the bracket spanning its segments.
            */}
            <div className="script-margin">
              <Link className="script-margin-label" href={`/train/${m.id}`}>
                {m.title}
                {m.kind === "loop" && <span className="margin-note">loop</span>}
              </Link>
              <span className="script-brace" aria-hidden="true" />
            </div>

            <div className="script-body">
              {mine.map((sg) => (
                <p
                  key={sg.id}
                  id={`seg-${sg.id}`}
                  className={`script-line ${
                    focus === sg.id ? "script-line-focus" : ""
                  } ${sg.verbatim ? "script-line-verbatim" : ""}`}
                >
                  {sg.tones?.length > 0 && (
                    <span className="script-tones">{sg.tones.join(" \u00b7 ")}</span>
                  )}
                  {sg.script_text}
                </p>
              ))}
            </div>
          </section>
        );
      })}
    </main>
  );
}

export default function Page() {
  return (
    <Suspense
      fallback={
        <main className="shell">
          <p className="muted">Loading&hellip;</p>
        </main>
      }
    >
      <ScriptView />
    </Suspense>
  );
}
