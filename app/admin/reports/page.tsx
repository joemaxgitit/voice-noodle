"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { readSheet } from "@/lib/xlsx";
import {
  displayName,
  exportDateFromFile,
  fmtKpi,
  KIND_LABEL,
  kindFromFile,
  matchRep,
  parseReport,
  type KpiColumn,
  type KpiReport,
  type KpiRow,
  type ParsedReport,
} from "@/lib/kpi";
import { addDays, fmtDate, mondayOf, today } from "@/lib/training";
import "../calls/calls.css";
import "../reps/reps.css";

type Person = { id: string; full_name: string | null; role: string; kpi_name: string | null; active: boolean };
type Preset = "week" | "month" | "day" | "custom";

const SKIP = "__skip";

function periodFor(p: Preset, end: string): [string, string] {
  if (p === "week") return [mondayOf(end), end];
  if (p === "month") return [`${end.slice(0, 8)}01`, end];
  if (p === "day") return [end, end];
  return [end, end];
}

function fmtPeriod(a: string, b: string) {
  if (a === b) return fmtDate(a, { month: "short", day: "numeric", year: "numeric" });
  return `${fmtDate(a, { month: "short", day: "numeric" })} – ${fmtDate(b, { month: "short", day: "numeric", year: "numeric" })}`;
}

/**
 * Sales reports from the CRM. Upload the team-wide Excel once; every row is
 * matched to a rep and lands on their profile as KPI history.
 */
export default function Reports() {
  const supabase = useMemo(() => createClient(), []);
  const [orgId, setOrgId] = useState("");
  const [me, setMe] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [reports, setReports] = useState<(KpiReport & { matched: number; total: number })[]>([]);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  // the upload in progress
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedReport | null>(null);
  const [kind, setKind] = useState("other");
  const [title, setTitle] = useState("");
  const [preset, setPreset] = useState<Preset>("month");
  const [start, setStart] = useState(today());
  const [end, setEnd] = useState(today());
  const [matches, setMatches] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState<string | null>(null);
  const [openRows, setOpenRows] = useState<KpiRow[]>([]);

  const load = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return;
    setMe(session.user.id);
    const { data: prof } = await supabase.from("profiles").select("org_id").eq("id", session.user.id).single();
    setOrgId(prof?.org_id ?? "");
    const [{ data: ppl, error: pe }, { data: reps, error: re }, { data: rows }] = await Promise.all([
      supabase.from("profiles").select("id, full_name, role, kpi_name, active").eq("org_id", prof?.org_id ?? "").order("full_name"),
      supabase.from("kpi_reports").select("*").order("period_end", { ascending: false }).order("created_at", { ascending: false }),
      supabase.from("kpi_rows").select("report_id, rep_id"),
    ]);
    const err = pe || re;
    if (err)
      setError(/kpi_name|kpi_reports|does not exist/i.test(err.message) ? `${err.message} -- run supabase/rep-profile.sql in the Supabase SQL Editor first.` : err.message);
    setPeople((ppl || []) as Person[]);
    const count = new Map<string, { m: number; t: number }>();
    for (const r of rows || []) {
      const c = count.get(r.report_id) || { m: 0, t: 0 };
      c.t++;
      if (r.rep_id) c.m++;
      count.set(r.report_id, c);
    }
    setReports(((reps || []) as KpiReport[]).map((r) => ({ ...r, matched: count.get(r.id)?.m ?? 0, total: count.get(r.id)?.t ?? 0 })));
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  async function pick(f: File) {
    setError("");
    setStatus("");
    try {
      const grid = readSheet(f.name, new Uint8Array(await f.arrayBuffer()));
      const p = parseReport(grid);
      if (!p.rows.length) throw new Error("No salesman rows found in this file.");
      const k = kindFromFile(f.name);
      const e = exportDateFromFile(f.name) || today();
      const [a, b] = periodFor("month", e);
      setFile(f);
      setParsed(p);
      setKind(k);
      setTitle(KIND_LABEL[k] ?? "Report");
      setPreset("month");
      setStart(a);
      setEnd(b);
      setMatches(p.rows.map((r) => matchRep(r.salesman, people) ?? SKIP));
    } catch (e) {
      setError(`Couldn't read ${f.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function choosePreset(p: Preset) {
    setPreset(p);
    if (p !== "custom") {
      const [a, b] = periodFor(p, end);
      setStart(a);
      setEnd(b);
    }
  }

  async function save() {
    if (!file || !parsed) return;
    if (end < start) return setError("The period ends before it starts.");
    setBusy(true);
    setError("");
    const id = crypto.randomUUID();
    const path = `${orgId}/reports/${id}-${file.name.replace(/[^\w.-]+/g, "_")}`;
    const up = await supabase.storage.from("rep-files").upload(path, file, { contentType: file.type || undefined });
    if (up.error) {
      setBusy(false);
      return setError(`Upload failed: ${up.error.message}`);
    }
    const { error: e1 } = await supabase.from("kpi_reports").insert({
      id,
      org_id: orgId,
      kind,
      title: title.trim() || KIND_LABEL[kind] || "Report",
      file_name: file.name,
      path,
      period_start: start,
      period_end: end,
      columns: parsed.columns,
      uploaded_by: me,
    });
    if (e1) {
      setBusy(false);
      return setError(e1.message);
    }
    const rows = parsed.rows.map((r, i) => ({
      org_id: orgId,
      report_id: id,
      rep_id: matches[i] === SKIP ? null : matches[i],
      salesman: r.salesman,
      data: r.data,
    }));
    const { error: e2 } = await supabase.from("kpi_rows").insert(rows);
    if (e2) {
      await supabase.from("kpi_reports").delete().eq("id", id);
      setBusy(false);
      return setError(e2.message);
    }
    // Remember hand-picked matches, so the next upload matches by itself.
    const learned = parsed.rows
      .map((r, i) => ({ id: matches[i], name: displayName(r.salesman) }))
      .filter((x) => x.id !== SKIP && !matchRep(x.name, people.filter((p) => p.id === x.id)));
    for (const l of learned) await supabase.from("profiles").update({ kpi_name: l.name }).eq("id", l.id);

    setBusy(false);
    setFile(null);
    setParsed(null);
    setStatus(`Saved -- ${rows.filter((r) => r.rep_id).length} of ${rows.length} rows went onto rep profiles.`);
    await load();
  }

  async function view(id: string) {
    if (open === id) return setOpen(null);
    setOpen(id);
    const { data } = await supabase.from("kpi_rows").select("*").eq("report_id", id);
    setOpenRows((data || []) as KpiRow[]);
  }

  async function rematch(row: KpiRow, repId: string) {
    const v = repId === SKIP ? null : repId;
    await supabase.from("kpi_rows").update({ rep_id: v }).eq("id", row.id);
    if (v) await supabase.from("profiles").update({ kpi_name: displayName(row.salesman) }).eq("id", v);
    setOpenRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, rep_id: v } : r)));
    void load();
  }

  async function remove(r: KpiReport) {
    if (!confirm(`Delete "${r.title}" for ${fmtPeriod(r.period_start, r.period_end)}? Its numbers come off every rep's profile.`)) return;
    const { error } = await supabase.from("kpi_reports").delete().eq("id", r.id);
    if (error) return setError(error.message);
    if (r.path) {
      // Files from the team drop box can also sit on rep profiles; keep them while anything uses them.
      const [{ count: files }, { count: reports }] = await Promise.all([
        supabase.from("rep_files").select("id", { count: "exact", head: true }).eq("path", r.path),
        supabase.from("kpi_reports").select("id", { count: "exact", head: true }).eq("path", r.path),
      ]);
      if (!files && !reports) await supabase.storage.from("rep-files").remove([r.path]);
    }
    if (open === r.id) setOpen(null);
    await load();
  }

  async function download(r: KpiReport) {
    if (!r.path) return;
    const { data, error } = await supabase.storage.from("rep-files").createSignedUrl(r.path, 120, { download: r.file_name || true });
    if (error) return setError(error.message);
    window.location.href = data.signedUrl;
  }

  const sortedPeople = useMemo(
    () => [...people].sort((a, b) => Number(b.role === "rep") - Number(a.role === "rep") || (a.full_name || "").localeCompare(b.full_name || "")),
    [people]
  );
  const repSelect = (value: string, onChange: (v: string) => void, label: string) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      <option value={SKIP}>Not on the team -- skip</option>
      {sortedPeople.map((p) => (
        <option key={p.id} value={p.id}>
          {p.full_name || "Unnamed"}
          {p.role !== "rep" ? ` (${p.role})` : ""}
          {!p.active ? " -- inactive" : ""}
        </option>
      ))}
    </select>
  );

  const showCols = (cols: KpiColumn[]) => cols.filter((c) => c.type !== "name" && c.type !== "text").slice(0, 7);

  return (
    <main className="shell">
      <div className="eyebrow">Team</div>
      <h1>Sales reports</h1>
      <p className="muted" style={{ maxWidth: "66ch" }}>
        Upload the CRM&rsquo;s Sales Dashboard or Sale Report once for the whole team. Every salesman row is matched to a
        rep and goes onto their profile, so you can see their numbers move over time. Managers only -- reps never see this.
      </p>

      {error && <div className="error">{error}</div>}
      {status && <div className="status">{status}</div>}

      {!parsed ? (
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
            ref={input}
            type="file"
            accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void pick(f);
              e.target.value = "";
            }}
          />
          <b>Drop a sales report here, or tap to choose</b>
          <span className="hint">Excel (.xlsx) or CSV, straight from the CRM</span>
        </label>
      ) : (
        <section className="card" style={{ marginTop: 14 }}>
          <div className="rx-head">
            <div>
              <div className="eyebrow" style={{ margin: 0 }}>
                New upload
              </div>
              <b>{file?.name}</b>
            </div>
            <div className="rx-actions">
              <button onClick={() => (setParsed(null), setFile(null))}>Cancel</button>
              <button className="primary" disabled={busy} onClick={save}>
                {busy ? "Saving…" : `Save report (${matches.filter((m) => m !== SKIP).length} reps)`}
              </button>
            </div>
          </div>

          <div className="tr-two" style={{ marginTop: 12 }}>
            <label className="field">
              <span className="label">Name</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="field">
              <span className="label">Type</span>
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                {Object.entries(KIND_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <span className="label">What period does it cover?</span>
          <div className="rx-presets" role="group">
            {(
              [
                ["month", "Month to date"],
                ["week", "Week to date"],
                ["day", "One day"],
                ["custom", "Custom"],
              ] as [Preset, string][]
            ).map(([p, l]) => (
              <button key={p} type="button" className={preset === p ? "on" : ""} aria-pressed={preset === p} onClick={() => choosePreset(p)}>
                {l}
              </button>
            ))}
          </div>
          <div className="tr-two">
            <label className="field">
              <span className="label">From</span>
              <input type="date" value={start} disabled={preset !== "custom"} onChange={(e) => setStart(e.target.value)} />
            </label>
            <label className="field">
              <span className="label">To</span>
              <input
                type="date"
                value={end}
                onChange={(e) => {
                  const v = e.target.value;
                  setEnd(v);
                  if (preset !== "custom" && v) setStart(periodFor(preset, v)[0]);
                }}
              />
            </label>
          </div>
          <p className="hint" style={{ marginTop: 0 }}>
            The date in the file name says it was exported {fmtDate(exportDateFromFile(file?.name || "") || today())}. Pick the
            stretch the numbers add up over, so trends compare like with like.
          </p>

          <div className="rx-scroll">
            <table className="rx-table">
              <thead>
                <tr>
                  <th>In the report</th>
                  <th>Rep</th>
                  {showCols(parsed.columns).map((c) => (
                    <th key={c.key} className="num">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parsed.rows.map((r, i) => (
                  <tr key={i} style={matches[i] === SKIP ? { opacity: 0.55 } : undefined}>
                    <td>{displayName(r.salesman)}</td>
                    <td>
                      {repSelect(matches[i], (v) => setMatches((m) => m.map((x, j) => (j === i ? v : x))), `Rep for ${displayName(r.salesman)}`)}
                    </td>
                    {showCols(parsed.columns).map((c) => (
                      <td key={c.key} className="num">
                        {fmtKpi(r.data[c.key], c.type)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint">
            Names are matched automatically. Pick the account for anyone unmatched and it&rsquo;s remembered for next time.
          </p>
        </section>
      )}

      <h2 style={{ marginTop: 28 }}>Uploaded</h2>
      {!reports.length ? (
        <p className="muted">No reports yet.</p>
      ) : (
        <div className="rx-scroll">
          <table className="rx-table">
            <thead>
              <tr>
                <th>Period</th>
                <th>Report</th>
                <th className="num">Matched</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <FragmentRow key={r.id}>
                  <tr className="link" onClick={() => void view(r.id)}>
                    <td style={{ whiteSpace: "nowrap" }}>{fmtPeriod(r.period_start, r.period_end)}</td>
                    <td>
                      {r.title}
                      <div className="hint" style={{ margin: 0 }}>
                        {r.file_name} · uploaded {new Date(r.created_at).toLocaleDateString()}
                        {r.uploaded_by ? ` by ${people.find((p) => p.id === r.uploaded_by)?.full_name || "someone"}` : ""}
                      </div>
                    </td>
                    <td className="num">
                      <span className={`pill ${r.matched === r.total ? "good" : "fair"}`}>
                        {r.matched}/{r.total}
                      </span>
                    </td>
                    <td className="num" onClick={(e) => e.stopPropagation()} style={{ whiteSpace: "nowrap" }}>
                      {r.path && (
                        <button className="tr-sm" onClick={() => void download(r)}>
                          Download
                        </button>
                      )}{" "}
                      <button className="tr-sm danger" onClick={() => void remove(r)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                  {open === r.id && (
                    <tr>
                      <td colSpan={4} style={{ background: "var(--ink-2)" }}>
                        <div className="rx-scroll">
                          <table className="rx-table">
                            <thead>
                              <tr>
                                <th>In the report</th>
                                <th>Rep</th>
                                {showCols(r.columns).map((c) => (
                                  <th key={c.key} className="num">
                                    {c.label}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {openRows.map((row) => (
                                <tr key={row.id}>
                                  <td>
                                    {row.rep_id ? (
                                      <Link href={`/admin/reps/${row.rep_id}`}>{displayName(row.salesman)}</Link>
                                    ) : (
                                      displayName(row.salesman)
                                    )}
                                  </td>
                                  <td>{repSelect(row.rep_id ?? SKIP, (v) => void rematch(row, v), `Rep for ${displayName(row.salesman)}`)}</td>
                                  {showCols(r.columns).map((c) => (
                                    <td key={c.key} className="num">
                                      {fmtKpi(row.data[c.key], c.type)}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </FragmentRow>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
