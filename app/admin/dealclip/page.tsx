"use client";

import { useMemo, useState } from "react";
import { readSheet } from "@/lib/xlsx";
import { exportDateFromFile } from "@/lib/kpi";
import { fmtDay } from "@/lib/rotation";
import { clipOf, exportHour, readClip, round1, throughDay, twoADay, workDays, type ClipRow } from "@/lib/dealclip";
import "../calls/calls.css";
import "../reps/reps.css";

const TITLE_KEY = "vn.dealclip.title";
const loadTitle = () => {
  try {
    return localStorage.getItem(TITLE_KEY) || "Deal Clip";
  } catch {
    return "Deal Clip";
  }
};

/**
 * Morning Deal Clip. Drop last night's month-to-date Sales Dashboard and
 * get the team ranked by deals with month-end projections, ready to post.
 * Nothing is saved and reps never see this page.
 */
export default function DealClip() {
  const [file, setFile] = useState("");
  const [rows, setRows] = useState<ClipRow[] | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [through, setThrough] = useState("");
  const [gone, setGone] = useState(0);
  const [total, setTotal] = useState(0);
  const [title, setTitle] = useState(loadTitle);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [over, setOver] = useState(false);

  async function pick(f: File) {
    setError("");
    try {
      const r = readClip(readSheet(f.name, new Uint8Array(await f.arrayBuffer())));
      const t = throughDay(exportDateFromFile(f.name), exportHour(f.name));
      const w = workDays(t);
      setFile(f.name);
      setRows(r);
      setHidden(new Set(r.filter((x) => x.status && !/active/i.test(x.status)).map((x) => x.name)));
      setThrough(t);
      setGone(w.gone);
      setTotal(w.total);
    } catch (e) {
      setError(`Couldn't read ${f.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function changeThrough(v: string) {
    setThrough(v);
    if (v) {
      const w = workDays(v);
      setGone(w.gone);
      setTotal(w.total);
    }
  }

  const ranked = useMemo(
    () =>
      (rows || [])
        .filter((r) => !hidden.has(r.name))
        .map((r) => ({ ...r, clip: clipOf(r.deals, gone, total), two: twoADay(r.deals, gone, total) }))
        .sort((a, b) => b.deals - a.deals || (b.ratio ?? 0) - (a.ratio ?? 0) || a.name.localeCompare(b.name)),
    [rows, hidden, gone, total],
  );
  const left = Math.max(0, total - gone);
  const pct = (r: number | null) => (r === null ? "--" : `${Math.round(r * 100)}%`);

  async function copy() {
    const head = `${title}\nMonth to date through ${fmtDay(through, true)} · ${gone} of ${total} work days · ${left} left`;
    const lines = ranked.map((r, i) => `${i + 1}. ${r.name} -- ${r.deals} deal${r.deals === 1 ? "" : "s"} · ${pct(r.ratio)} close · clip ${round1(r.clip)} · two a day ${round1(r.two)}`);
    await navigator.clipboard.writeText([head, "", ...lines].join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <main className="shell rx-page">
      <div className="eyebrow">Team</div>
      <h1>Deal Clip</h1>
      <p className="muted" style={{ maxWidth: "66ch" }}>
        Each morning, drop last night&rsquo;s month-to-date Sales Dashboard. The team is ranked by deals with a month-end projection. The clip is
        deals per work day so far × work days in the month. &ldquo;Two a day&rdquo; is where they finish with 2 deals a day from here. Only managers
        see this page and nothing is saved.
      </p>
      {error && <div className="error">{error}</div>}

      {!rows ? (
        <label
          className={`rx-drop${over ? " over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const f = e.dataTransfer.files[0];
            if (f) void pick(f);
          }}
        >
          <input
            type="file"
            accept=".xlsx,.csv"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void pick(f);
              e.target.value = "";
            }}
          />
          <b>Morning: drop last night&rsquo;s month-to-date Sales Dashboard</b>
          <span className="hint">Excel or CSV, straight from the CRM</span>
        </label>
      ) : (
        <section className="card">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "end", marginBottom: 12 }}>
            <label style={{ flex: "1 1 220px", display: "grid", gap: 4 }}>
              <span className="hint" style={{ margin: 0 }}>Title</span>
              <input
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  try {
                    localStorage.setItem(TITLE_KEY, e.target.value);
                  } catch {}
                }}
              />
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              <span className="hint" style={{ margin: 0 }}>Numbers through</span>
              <input type="date" value={through} onChange={(e) => changeThrough(e.target.value)} style={{ width: "auto" }} />
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              <span className="hint" style={{ margin: 0 }}>Work days gone</span>
              <input type="number" min={1} value={gone} onChange={(e) => setGone(Math.max(0, Number(e.target.value) || 0))} style={{ width: 80 }} />
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              <span className="hint" style={{ margin: 0 }}>In the month</span>
              <input type="number" min={1} value={total} onChange={(e) => setTotal(Math.max(0, Number(e.target.value) || 0))} style={{ width: 80 }} />
            </label>
          </div>
          <p className="hint" style={{ marginTop: 0 }}>
            {file} &middot; counted Mon&ndash;Fri, so take a day off either box for a holiday.
          </p>

          <h2 style={{ margin: "4px 0 2px" }}>{title}</h2>
          <p className="muted" style={{ margin: "0 0 10px" }}>
            Month to date through {fmtDay(through, true)} &middot; {gone} of {total} work days &middot; {left} left
          </p>
          <div className="rx-scroll">
            <table className="rx-table">
              <thead>
                <tr>
                  <th className="num">#</th>
                  <th>Rep</th>
                  <th className="num">Deals</th>
                  <th className="num">Closing</th>
                  <th className="num">Deal clip</th>
                  <th className="num">Two a day</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {ranked.map((r, i) => (
                  <tr key={r.name}>
                    <td className="num muted">{i + 1}</td>
                    <td>
                      <b>{r.name}</b>
                    </td>
                    <td className="num">
                      <b>{r.deals}</b>
                    </td>
                    <td className="num">{pct(r.ratio)}</td>
                    <td className="num">{round1(r.clip)}</td>
                    <td className="num">{round1(r.two)}</td>
                    <td className="num">
                      <button className="link-btn" title="Leave off today's clip" onClick={() => setHidden((h) => new Set(h).add(r.name))}>
                        hide
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {hidden.size > 0 && (
            <p className="hint">
              Left off:{" "}
              {[...hidden].map((n, i) => (
                <span key={n}>
                  {i ? ", " : ""}
                  <button
                    className="link-btn"
                    onClick={() =>
                      setHidden((h) => {
                        const x = new Set(h);
                        x.delete(n);
                        return x;
                      })
                    }
                  >
                    {n}
                  </button>
                </span>
              ))}{" "}
              (tap to add back)
            </p>
          )}
          <div className="rx-actions" style={{ marginTop: 10 }}>
            <button className="primary" onClick={() => void copy()}>
              {copied ? "Copied" : "Copy to post"}
            </button>
            <button
              onClick={() => {
                setRows(null);
                setFile("");
              }}
            >
              Use a different file
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
