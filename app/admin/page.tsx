"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

import PracticeToggle from "./PracticeToggle";
type ScriptRef = { id: string; title: string; sort_order: number };

type ModuleRef = {
  id: string;
  title: string;
  sort_order: number;
  language: string;
  scripts: ScriptRef | null;
};

type Row = {
  id: string;
  segment_code: string;
  title: string | null;
  recordings: { audio_path: string | null }[];
  status: string;
  sort_order: number;
  modules: ModuleRef | null;
};

const UNFILED: ScriptRef = {
  id: "__unfiled",
  title: "Unfiled",
  sort_order: 9999,
};

/**
 * Recording queue.
 *
 * 431 segments in one flat list is unusable for a logging session -- the
 * person recording needs to see one script's worth of one module at a time,
 * and to make finished work disappear. So: a tab per script, headings per
 * module, and a filter that hides anything already recorded.
 */
export default function Admin() {
  const supabase = createClient();
  const [rows, setRows] = useState<Row[]>([]);
  const [activeScript, setActiveScript] = useState<string | null>(null);
  const [hideRecorded, setHideRecorded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    supabase
      .from("segments")
      .select(
        "id, segment_code, title, status, sort_order, modules(id, title, sort_order, language, scripts(id, title, sort_order)), recordings(audio_path)"
      )
      .then(({ data, error }) => {
        if (error) setError(error.message);
        setRows((data || []) as unknown as Row[]);
        setLoading(false);
      });
  }, [supabase]);

  const voiceCount = (r: Row) =>
    (r.recordings || []).filter((x) => x.audio_path).length;

  const scriptOf = (r: Row) => r.modules?.scripts ?? UNFILED;

  // One tab per script, in the order they appear on the training page.
  const scripts = useMemo(() => {
    const seen = new Map<string, ScriptRef>();
    for (const r of rows) {
      const s = scriptOf(r);
      if (!seen.has(s.id)) seen.set(s.id, s);
    }
    return [...seen.values()].sort((a, b) => a.sort_order - b.sort_order);
  }, [rows]);

  // First tab, once the data arrives.
  useEffect(() => {
    if (!activeScript && scripts.length > 0) setActiveScript(scripts[0].id);
  }, [scripts, activeScript]);

  const perScript = useMemo(() => {
    const out = new Map<string, { total: number; done: number }>();
    for (const r of rows) {
      const id = scriptOf(r).id;
      const cur = out.get(id) || { total: 0, done: 0 };
      cur.total += 1;
      if (voiceCount(r) > 0) cur.done += 1;
      out.set(id, cur);
    }
    return out;
  }, [rows]);

  /*
    Segments for the open tab, bucketed by module. Modules keep their running
    order, and the recorded count stays visible per module even when the rows
    themselves are filtered out -- otherwise hiding finished work also hides
    the evidence of progress.
  */
  const groups = useMemo(() => {
    if (!activeScript) return [];

    const buckets = new Map<
      string,
      { module: ModuleRef | null; all: Row[]; shown: Row[] }
    >();

    for (const r of rows) {
      if (scriptOf(r).id !== activeScript) continue;
      const key = r.modules?.id ?? "__none";
      const b = buckets.get(key) || { module: r.modules, all: [], shown: [] };
      b.all.push(r);
      if (!hideRecorded || voiceCount(r) === 0) b.shown.push(r);
      buckets.set(key, b);
    }

    const list = [...buckets.values()];
    for (const b of list) {
      b.all.sort((x, y) => x.sort_order - y.sort_order);
      b.shown.sort((x, y) => x.sort_order - y.sort_order);
    }
    return list.sort(
      (a, b) => (a.module?.sort_order ?? 999) - (b.module?.sort_order ?? 999)
    );
  }, [rows, activeScript, hideRecorded]);

  const timed = rows.filter((r) => voiceCount(r) > 0).length;
  const nothingLeft =
    groups.length > 0 && groups.every((g) => g.shown.length === 0);

  if (loading) {
    return (
      <main className="shell">
        <p className="muted">Loading&hellip;</p>
      </main>
    );
  }

  return (
    <main className="shell">
      <div className="topbar">
        <Link
          className="btn"
          href="/proedgesolutions"
          style={{ textDecoration: "none" }}
        >
          &larr; Training
        </Link>
        <div className="row">
          <Link
            className="btn"
            href="/admin/live"
            style={{ textDecoration: "none" }}
          >
            Live
          </Link>
          <Link
            className="btn"
            href="/admin/attempts"
            style={{ textDecoration: "none" }}
          >
            Attempts
          </Link>
          <Link
            className="btn"
            href="/admin/listening"
            style={{ textDecoration: "none" }}
          >
            Listening
          </Link>
          <Link
            className="btn"
            href="/admin/people"
            style={{ textDecoration: "none" }}
          >
            People
          </Link>
        </div>
      </div>

      <div className="eyebrow">
        {timed} of {rows.length} segments recorded
      </div>
      <h1>Segments</h1>
      <p className="muted">
        Pick a segment to upload a master recording and tap its phrase timing.
      </p>

      <PracticeToggle />

      {error && <div className="error">{error}</div>}

      {scripts.length > 1 && (
        <div className="section-tabs" style={{ marginTop: 20 }}>
          {scripts.map((s) => {
            const c = perScript.get(s.id);
            return (
              <button
                key={s.id}
                aria-pressed={activeScript === s.id}
                onClick={() => setActiveScript(s.id)}
              >
                {s.title}
                <span className="section-count">
                  {c ? `${c.done} / ${c.total}` : "0"}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="row" style={{ marginTop: 4 }}>
        <button
          aria-pressed={hideRecorded}
          onClick={() => setHideRecorded((v) => !v)}
        >
          {hideRecorded ? "Showing what's left" : "Hide recorded"}
        </button>
      </div>

      {nothingLeft && (
        <p className="muted" style={{ marginTop: 24 }}>
          Everything in this script is recorded. Turn off &ldquo;Hide
          recorded&rdquo; to see it all again.
        </p>
      )}

      {groups.map((g) => {
        if (g.shown.length === 0) return null;

        const done = g.all.filter((r) => voiceCount(r) > 0).length;
        const isSpanish = g.module?.language === "es";

        return (
          <section key={g.module?.id ?? "__none"}>
            <h2>
              {g.module?.title || "Unassigned"}
              {isSpanish ? " \u00b7 Espa\u00f1ol" : ""}
              <span className="section-count" style={{ marginLeft: 10 }}>
                {done} / {g.all.length}
              </span>
            </h2>

            <ul className="list">
              {g.shown.map((r) => (
                <li key={r.id}>
                  <Link href={`/admin/timing/${r.id}`}>
                    <span>
                      <span className="code">{r.segment_code}</span>
                      <br />
                      {r.title || "Untitled"}
                    </span>
                    <span className="count">
                      {voiceCount(r) > 0
                        ? `${voiceCount(r)} ${
                            voiceCount(r) === 1 ? "voice" : "voices"
                          }`
                        : "no audio"}
                      {r.status === "draft" ? " \u00b7 draft" : ""}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </main>
  );
}
