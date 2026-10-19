"use client";

import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readSheet } from "@/lib/xlsx";
import { displayName, exportDateFromFile, KIND_LABEL, kindFromFile, matchRep, nameKey, parseReport, type KpiReport, type ParsedReport } from "@/lib/kpi";

type Person = { id: string; full_name: string | null; role: string; kpi_name: string | null; active: boolean };
type Item = { file: File; parsed: ParsedReport; order: string };

const SKIP = "__skip";
const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(y, m, 0).getDate();
/** "2024-11" + n months -> [first day, last day]. */
function monthAt(start: string, n: number): [string, string, string] {
  const [y0, m0] = start.split("-").map(Number);
  const t = y0 * 12 + (m0 - 1) + n;
  const y = Math.floor(t / 12);
  const m = (t % 12) + 1;
  return [`${y}-${pad(m)}-01`, `${y}-${pad(m)}-${pad(lastDay(y, m))}`, new Date(y, m - 1, 15).toLocaleDateString(undefined, { month: "long", year: "numeric" })];
}
const isNumber = (v: unknown) => typeof v === "number" && v !== 0;

/**
 * Back records: drop a stack of monthly Sales Dashboards at once. They're put
 * in the order the CRM exported them (the number in the file name), one
 * calendar month each, oldest first. A rep's months before they started
 * (all zeros) are left out so they don't drag down their history.
 */
export default function BulkUpload({
  supabase,
  orgId,
  me,
  files,
  people,
  existing,
  onDone,
  onCancel,
}: {
  supabase: SupabaseClient;
  orgId: string;
  me: string;
  files: File[];
  people: Person[];
  existing: KpiReport[];
  onDone: (msg: string) => void;
  onCancel: () => void;
}) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [startMonth, setStartMonth] = useState("");
  const [match, setMatch] = useState<Record<string, string>>({});

  // Read every file once.
  useEffect(() => {
    void (async () => {
      try {
        const out: Item[] = [];
        for (const f of files) {
          const parsed = parseReport(readSheet(f.name, new Uint8Array(await f.arrayBuffer())));
          out.push({ file: f, parsed, order: f.name.match(/(\d{18})/)?.[1] ?? f.name });
        }
        out.sort((a, b) => a.order.localeCompare(b.order));
        // Default: the newest file is last month, counting back from there.
        const e = exportDateFromFile(out[out.length - 1].file.name) ?? new Date().toISOString().slice(0, 10);
        const [y, m] = e.split("-").map(Number);
        const t = y * 12 + (m - 1) - out.length;
        setStartMonth(`${Math.floor(t / 12)}-${pad((t % 12) + 1)}`);
        setItems(out);
      } catch (e) {
        setError(`Couldn't read the files: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files]);

  // Hand-picked accounts; anything not picked is matched by name (people may still be loading).
  const pick = (k: string, salesman: string) => match[k] ?? matchRep(salesman, people) ?? SKIP;
  // Worked that month: any calls, talk time or deals. (Lead and cancellation columns carry over from other months.)
  const active = (data: Record<string, unknown>) => Object.entries(data).some(([k, v]) => /outbound|talk|deal/.test(k) && isNumber(v));
  const names = useMemo(() => {
    const m = new Map<string, { salesman: string; months: number }>();
    for (const it of items || [])
      for (const r of it.parsed.rows) {
        if (!active(r.data)) continue;
        const k = nameKey(r.salesman);
        m.set(k, { salesman: r.salesman, months: (m.get(k)?.months ?? 0) + 1 });
      }
    return [...m].sort((a, b) => displayName(a[1].salesman).localeCompare(displayName(b[1].salesman)));
  }, [items]);

  const dealKey = (it: Item) => it.parsed.columns.find((c) => /total.?deal/i.test(c.label))?.key;
  const dealsOf = (it: Item) => {
    const k = dealKey(it);
    return k ? it.parsed.rows.reduce((s, r) => s + (typeof r.data[k] === "number" ? (r.data[k] as number) : 0), 0) : null;
  };
  const taken = (a: string, b: string) => existing.some((r) => r.kind === "sales_dashboard" && r.period_start === a && r.period_end === b);

  async function saveAll() {
    if (!items || !startMonth) return;
    setError("");
    let saved = 0;
    let skipped = 0;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const [a, b, label] = monthAt(startMonth, i);
      if (taken(a, b)) {
        skipped++;
        continue;
      }
      setBusy(`Saving ${label} (${i + 1} of ${items.length})…`);
      const id = crypto.randomUUID();
      const path = `${orgId}/reports/${id}-${it.file.name.replace(/[^\w.-]+/g, "_")}`;
      const up = await supabase.storage.from("rep-files").upload(path, it.file, { contentType: it.file.type || undefined });
      if (up.error) {
        setBusy("");
        return setError(`${label}: upload failed -- ${up.error.message}`);
      }
      const kind = kindFromFile(it.file.name);
      const { error: e1 } = await supabase.from("kpi_reports").insert({
        id,
        org_id: orgId,
        kind,
        title: KIND_LABEL[kind] ?? "Report",
        file_name: it.file.name,
        path,
        period_start: a,
        period_end: b,
        columns: it.parsed.columns,
        uploaded_by: me,
      });
      if (e1) {
        setBusy("");
        return setError(`${label}: ${e1.message}`);
      }
      const rows = it.parsed.rows
        .filter((r) => active(r.data))
        .map((r) => {
          const m = pick(nameKey(r.salesman), r.salesman);
          return { org_id: orgId, report_id: id, rep_id: !m || m === SKIP ? null : m, salesman: r.salesman, data: r.data };
        });
      if (rows.length) {
        const { error: e2 } = await supabase.from("kpi_rows").insert(rows);
        if (e2) {
          await supabase.from("kpi_reports").delete().eq("id", id);
          setBusy("");
          return setError(`${label}: ${e2.message}`);
        }
      }
      saved++;
    }
    // Remember hand-picked names so next month's upload matches by itself.
    for (const [k, id] of Object.entries(match)) {
      if (id === SKIP) continue;
      const s = names.find(([n]) => n === k)?.[1].salesman;
      if (s && !matchRep(s, people.filter((p) => p.id === id))) await supabase.from("profiles").update({ kpi_name: displayName(s) }).eq("id", id);
    }
    setBusy("");
    onDone(`Saved ${saved} month${saved === 1 ? "" : "s"} of Sales Dashboards${skipped ? ` (${skipped} skipped -- already uploaded for that month)` : ""}.`);
  }

  const sortedPeople = [...people].sort((a, b) => Number(b.role === "rep") - Number(a.role === "rep") || (a.full_name || "").localeCompare(b.full_name || ""));

  if (error && !items) return <div className="error">{error}</div>;
  if (!items) return <p className="muted">Reading {files.length} files&hellip;</p>;

  return (
    <section className="card" style={{ marginTop: 14 }}>
      <div className="rx-head">
        <div>
          <div className="eyebrow" style={{ margin: 0 }}>
            Back records
          </div>
          <b>{items.length} monthly reports</b>
        </div>
        <div className="rx-actions">
          <button onClick={onCancel} disabled={!!busy}>
            Cancel
          </button>
          <button className="primary" disabled={!!busy} onClick={() => void saveAll()}>
            {busy || `Save all ${items.length} months`}
          </button>
        </div>
      </div>
      {error && <div className="error">{error}</div>}

      <label className="field" style={{ maxWidth: 260, marginTop: 10 }}>
        <span className="label">The first file is</span>
        <input type="month" value={startMonth} onChange={(e) => setStartMonth(e.target.value)} />
      </label>
      <p className="hint" style={{ marginTop: -4 }}>
        Files are in the order you exported them, one month each. Months before a rep started (all zeros) are left off their profile.
      </p>

      <div className="rx-scroll">
        <table className="rx-table">
          <thead>
            <tr>
              <th>Month</th>
              <th className="num">Deals</th>
              <th className="num">Reps</th>
              <th>File</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => {
              const [a, b, label] = monthAt(startMonth || "2000-01", i);
              return (
                <tr key={it.file.name}>
                  <td>
                    <b>{label}</b>
                    {taken(a, b) && <span className="muted"> · already uploaded, will skip</span>}
                  </td>
                  <td className="num">{dealsOf(it) ?? "--"}</td>
                  <td className="num">{it.parsed.rows.filter((r) => active(r.data)).length}</td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {it.file.name}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h3 className="rx-sec-title" style={{ marginTop: 16 }}>
        Who&rsquo;s who
      </h3>
      <div className="rx-scroll">
        <table className="rx-table">
          <tbody>
            {names.map(([k, v]) => (
              <tr key={k}>
                <td>
                  {displayName(v.salesman)}
                  <div className="hint" style={{ margin: 0 }}>
                    {v.salesman} · {v.months} month{v.months === 1 ? "" : "s"}
                  </div>
                </td>
                <td>
                  <select value={pick(k, v.salesman)} onChange={(e) => setMatch((m) => ({ ...m, [k]: e.target.value }))} aria-label={`Account for ${v.salesman}`}>
                    <option value={SKIP}>Not on the team -- keep by name</option>
                    {sortedPeople.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name || "Unnamed"}
                        {p.role !== "rep" ? ` (${p.role})` : ""}
                        {!p.active ? " -- inactive" : ""}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
