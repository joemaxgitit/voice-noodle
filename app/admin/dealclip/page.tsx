"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { readSheet } from "@/lib/xlsx";
import { exportDateFromFile } from "@/lib/kpi";
import { fmtDay } from "@/lib/rotation";
import { clipOf, exportHour, readClip, round1, throughDay, twoADay, workDays, type ClipRow } from "@/lib/dealclip";
import "../calls/calls.css";
import "../reps/reps.css";

// Today's team name, kept for the day so a reload doesn't lose it. A new day starts blank.
const NAME_KEY = "vn.dealclip.name";
const todayIso = () => new Date().toLocaleDateString("en-CA");
const loadName = () => {
  try {
    const v = JSON.parse(localStorage.getItem(NAME_KEY) || "null") as { day: string; name: string } | null;
    return v && v.day === todayIso() ? v.name : "";
  } catch {
    return "";
  }
};
const saveName = (name: string) => {
  try {
    localStorage.setItem(NAME_KEY, JSON.stringify({ day: todayIso(), name }));
  } catch {}
};
// "If Two a Day" is a once-or-twice-a-month play, so it's off unless switched on.
const TWO_KEY = "vn.dealclip.two";
const loadTwo = () => {
  try {
    return localStorage.getItem(TWO_KEY) === "1";
  } catch {
    return false;
  }
};
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

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
  const [title, setTitle] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  const [showTwo, setShowTwo] = useState(false);

  useEffect(() => {
    setTitle(loadName());
    setShowTwo(loadTwo());
  }, []);
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

  const COLS = ["Deals", "Closing Ratio", "Deal Clip", "Days Remaining", ...(showTwo ? ["If Two a Day"] : [])];
  const cells = (r: (typeof ranked)[number]) => [String(r.deals), pct(r.ratio), round1(r.clip), String(left), ...(showTwo ? [round1(r.two)] : [])];

  /** Copies the clip as a table (for chats that take one) with a plain-text version underneath for the rest. */
  async function copy() {
    if (!title.trim()) {
      nameRef.current?.focus();
      return setError("Give the team a name for today first.");
    }
    setError("");
    const name = title.trim();
    const text = [name, `Through ${fmtDay(through, true)} · ${left} work days left`, "", ...ranked.map((r, i) => `${i + 1}. ${r.name}: ${r.deals} deals · ${pct(r.ratio)} · clip ${round1(r.clip)}${showTwo ? ` · two a day ${round1(r.two)}` : ""}`)].join("\n");
    const td = "border:1px solid #bbb;padding:4px 8px";
    const html =
      `<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px">` +
      `<tr><th style="${td};text-align:left;background:#222;color:#fff">${esc(name)}</th>${COLS.map((c) => `<th style="${td};background:#222;color:#fff">${c}</th>`).join("")}</tr>` +
      ranked.map((r) => `<tr><td style="${td}">${esc(r.name)}</td>${cells(r).map((c) => `<td style="${td};text-align:center">${c}</td>`).join("")}</tr>`).join("") +
      `</table>`;
    try {
      await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([text], { type: "text/plain" }) })]);
    } catch {
      await navigator.clipboard.writeText(text);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <main className="shell rx-page">
      <div className="eyebrow">Team</div>
      <h1>Deal Clip</h1>
      <p className="muted" style={{ maxWidth: "66ch" }}>
        Each morning, drop last night&rsquo;s month-to-date Sales Dashboard. The team is ranked by deals with a month-end projection. The clip is
        deals per work day so far × work days in the month. Switch on &ldquo;If Two a Day&rdquo; when you want it: deals so far + 2 per work day left. Only managers
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
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "end" }}>
            <label style={{ flex: "1 1 260px", display: "grid", gap: 4 }}>
              <b>Today&rsquo;s team name</b>
              <input
                ref={nameRef}
                value={title}
                placeholder="e.g. The Nightmare on Minimum Street"
                onChange={(e) => {
                  setTitle(e.target.value);
                  saveName(e.target.value);
                }}
                style={{ fontSize: 17, fontWeight: 650 }}
              />
            </label>
            <button className="primary" style={{ fontSize: 16, padding: "10px 20px" }} onClick={() => void copy()}>
              {copied ? "Copied -- paste it in sales chat" : "Copy for sales chat"}
            </button>
          </div>

          <label className="hint" style={{ display: "inline-flex", gap: 6, alignItems: "center", margin: "10px 0 0" }}>
            <input
              type="checkbox"
              checked={showTwo}
              onChange={(e) => {
                setShowTwo(e.target.checked);
                try {
                  localStorage.setItem(TWO_KEY, e.target.checked ? "1" : "0");
                } catch {}
              }}
              style={{ width: "auto" }}
            />
            Show &ldquo;If Two a Day&rdquo;
          </label>

          <div className="rx-scroll" style={{ marginTop: 10 }}>
            <table className="rx-table dc-table">
              <thead>
                <tr>
                  <th className="dc-name">{title.trim() || <span className="muted">Team name</span>}</th>
                  {COLS.map((c) => (
                    <th key={c} className="num">
                      {c}
                    </th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {ranked.map((r) => (
                  <tr key={r.name}>
                    <td>
                      <b>{r.name}</b>
                    </td>
                    {cells(r).map((c, j) => (
                      <td key={j} className="num">
                        {j === 0 ? <b>{c}</b> : c}
                      </td>
                    ))}
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
          <details style={{ marginTop: 12 }}>
            <summary className="hint" style={{ cursor: "pointer" }}>
              Through {fmtDay(through, true)} &middot; {gone} of {total} work days gone &middot; {left} left (change for a holiday)
            </summary>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "end", marginTop: 8 }}>
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
            <p className="hint">{file}</p>
          </details>
          <div className="rx-actions" style={{ marginTop: 10 }}>
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
