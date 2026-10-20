"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { excelDate, readSheet, readSheetWithFills, type Cell } from "@/lib/xlsx";
import { exportDateFromFile, matchRep } from "@/lib/kpi";
import { fmtDay, fmtHours, isoOf, nextWorkDay, readDay, readTracker, RULES, score, type ColumnPick, type DayRow, type TrackerEntry } from "@/lib/rotation";
import "../calls/calls.css";
import "../reps/reps.css";

type Person = { id: string; full_name: string | null; role: string; active: boolean; kpi_name: string | null; on_vindico?: boolean };
const VINDICO = "On Vindico";
const ABSENT = "Absent -- no talk time, calls or deals";
type Daily = {
  id: string;
  rep_id: string | null;
  salesman: string;
  day: string;
  for_day: string;
  talk_hours: number | null;
  calls: number | null;
  deals: number | null;
  points: number | null;
  status: "worked" | "absent";
  made: boolean;
  override_made: boolean | null;
  override_note: string | null;
  source: string;
};
const SKIP = "__skip";
const madeOf = (d: Daily) => d.override_made ?? d.made;
/** One line of numbers. Old tracker days often only have a colour, so say what we know. */
const lineOf = (d: Daily) => {
  if (d.status === "absent") return "Absent";
  if (d.points === null && d.calls === null && d.talk_hours === null) return d.source === "import" ? `From the old tracker${d.override_note ? `: ${d.override_note}` : ""}` : "No numbers";
  const bits = [d.points !== null ? `${d.points} pt` : "", d.talk_hours !== null ? fmtHours(d.talk_hours) : "", d.calls !== null ? `${d.calls} calls` : "", d.deals !== null ? dealsText(d.deals) : ""].filter(Boolean);
  return bits.join(" · ") + (d.source === "import" && d.override_note ? ` (${d.override_note})` : "");
};
const dealsText = (n: number | null) => `${n ?? 0} deal${n === 1 ? "" : "s"}`;

/** Today, or the last weekday if it's the weekend. */
function lastWorkDay(): string {
  const d = new Date();
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return isoOf(d);
}

/**
 * Rotation: the nightly close. Upload the day's Sales Dashboard, see who
 * made rotation for the next working day's leads, and keep every day's
 * talk time, calls and deals per rep.
 */
export default function Rotation() {
  const supabase = useMemo(() => createClient(), []);
  const [orgId, setOrgId] = useState("");
  const [me, setMe] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [days, setDays] = useState<Daily[]>([]);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // the upload in progress
  const [fileName, setFileName] = useState("");
  const [grid, setGrid] = useState<Cell[][] | null>(null);
  const [header, setHeader] = useState<string[]>([]);
  const [cols, setCols] = useState<ColumnPick | null>(null);
  const [rows, setRows] = useState<DayRow[]>([]);
  const [day, setDay] = useState(lastWorkDay());
  const [busy, setBusy] = useState(false);
  const [weeks, setWeeks] = useState(4);
  const [copied, setCopied] = useState(false);
  // history import
  const [imp, setImp] = useState<{ file: string; entries: TrackerEntry[]; names: string[]; from: string; to: string } | null>(null);
  const [impMap, setImpMap] = useState<Record<string, string>>({});
  const [impBusy, setImpBusy] = useState("");
  const impInput = useRef<HTMLInputElement>(null);

  const [canEdit, setCanEdit] = useState(false);
  const load = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return;
    setMe(session.user.id);
    const { data: prof } = await supabase.from("profiles").select("org_id").eq("id", session.user.id).single();
    setOrgId(prof?.org_id ?? "");
    const clean = (rows: Daily[]) =>
      rows.map((x) => ({ ...x, talk_hours: x.talk_hours === null ? null : Number(x.talk_hours), deals: x.deals === null ? null : Number(x.deals), points: x.points === null ? null : Number(x.points) }));
    const daysAgo = (n: number) => {
      const d = new Date();
      d.setDate(d.getDate() - n);
      return isoOf(d);
    };
    // Supabase hands back at most 1,000 rows at a time. Count first, then fetch every page at once.
    const fetchSince = async (from: string) => {
      const { count, error } = await supabase.from("rep_daily").select("id", { count: "exact", head: true }).gte("day", from);
      if (error) return { data: [] as Daily[], error };
      const pages = Math.max(1, Math.ceil((count ?? 0) / 1000));
      const res = await Promise.all(
        Array.from({ length: pages }, (_, i) => supabase.from("rep_daily").select("*").gte("day", from).order("day", { ascending: false }).order("id").range(i * 1000, i * 1000 + 999))
      );
      const bad = res.find((r) => r.error);
      return { data: res.flatMap((r) => (r.data || []) as Daily[]), error: bad?.error ?? null };
    };

    // People and the last couple of months first, so the page shows right away; the full year follows.
    // Only the super admin runs rotation; every manager can see the record.
    void supabase
      .from("profiles")
      .select("super_admin")
      .eq("id", session.user.id)
      .maybeSingle()
      .then(({ data }) => setCanEdit(!!(data as { super_admin?: boolean } | null)?.super_admin));
    const [p, v, recent] = await Promise.all([
      supabase.from("profiles").select("id, full_name, role, active, kpi_name").eq("org_id", prof?.org_id ?? "").order("full_name"),
      // Reps on the Vindico auto dialer make rotation automatically (own query, so a missing column never breaks the page).
      supabase.from("profiles").select("id, on_vindico").eq("on_vindico", true),
      fetchSince(daysAgo(60)),
    ]);
    if (recent.error) setError(/rep_daily|does not exist/i.test(recent.error.message) ? `${recent.error.message} -- run supabase/rotation.sql first.` : recent.error.message);
    const onV = new Set(((v.data || []) as { id: string }[]).map((x) => x.id));
    setPeople(((p.data || []) as Person[]).map((x) => ({ ...x, on_vindico: onV.has(x.id) })));
    setDays(clean(recent.data));

    const full = await fetchSince(daysAgo(380));
    if (!full.error) setDays(clean(full.data));
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  function parse(g: Cell[][], pick?: ColumnPick) {
    const r = readDay(g, people, pick);
    setHeader(r.header);
    setCols(r.cols);
    // Vindico reps hit rotation automatically while they're on the project, even if they're missing from the file.
    const vin = people.filter((x) => x.on_vindico && x.active);
    const onVin = (id: string | null) => vin.some((x) => x.id === id);
    const nothing = (n: { talk_hours: number | null; calls: number | null; deals: number | null }) => !n.talk_hours && !n.calls && !n.deals;
    const rows = r.rows.map((x) =>
      onVin(x.rep_id)
        ? { ...x, scored: { ...x.scored, made: true, hint: VINDICO } }
        : // Nothing at all that day: they weren't in, so it's an absence, not a miss.
          nothing(x.numbers)
          ? { ...x, scored: { ...x.scored, made: false, hint: ABSENT } }
          : x
    );
    for (const x of vin)
      if (!rows.some((y) => y.rep_id === x.id)) {
        const numbers = { talk_hours: null, calls: null, deals: null };
        rows.push({ salesman: x.full_name || "Unnamed", rep_id: x.id, numbers, scored: { ...numbers, points: 0, made: true, parts: [], hint: VINDICO } });
      }
    setRows(rows);
  }

  // A file dropped before the team list finished loading gets matched again once it arrives.
  const matchedWith = useRef(0);
  useEffect(() => {
    if (grid && people.length && matchedWith.current !== people.length) {
      matchedWith.current = people.length;
      parse(grid, cols ?? undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people, grid]);

  async function pick(f: File) {
    setError("");
    setStatus("");
    try {
      const g = readSheet(f.name, new Uint8Array(await f.arrayBuffer()));
      setGrid(g);
      setFileName(f.name);
      parse(g);
      const exported = exportDateFromFile(f.name);
      if (exported) setDay(exported);
    } catch (e) {
      setError(`Couldn't read ${f.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function setCol(key: keyof ColumnPick, i: number) {
    if (!cols || !grid) return;
    const next = { ...cols, [key]: i };
    parse(grid, next);
    setCols(next);
  }

  async function save() {
    if (!rows.length) return;
    const missing = !cols || cols.talk < 0 || cols.calls < 0 || cols.deals < 0;
    if (missing && !confirm("Not every column was found (talk time, calls, deals). Missing ones count as zero. Save anyway?")) return;
    const existing = days.filter((d) => d.day === day).length;
    if (existing && !confirm(`${fmtDay(day, true)} is already saved (${existing} reps). Replace it with this file?`)) return;
    setBusy(true);
    setError("");
    const forDay = nextWorkDay(day);
    const kept = rows.filter((r) => r.rep_id !== SKIP);
    const payload = kept.map((r) => ({
      org_id: orgId,
      rep_id: r.rep_id && r.rep_id !== SKIP ? r.rep_id : null,
      salesman: r.salesman,
      day,
      for_day: forDay,
      talk_hours: r.numbers.talk_hours,
      calls: r.numbers.calls === null ? null : Math.round(r.numbers.calls),
      deals: r.numbers.deals,
      points: r.scored.points,
      made: r.scored.made,
      status: r.scored.hint === ABSENT ? "absent" : "worked",
      override_note: r.scored.hint === VINDICO ? VINDICO : null,
      source: "upload",
      updated_by: me,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await supabase.from("rep_daily").upsert(payload, { onConflict: "org_id,salesman,day" });
    if (error) {
      setBusy(false);
      return setError(error.message);
    }
    // Remember names picked by hand, so the next upload matches by itself.
    for (const r of kept) {
      const p = people.find((x) => x.id === r.rep_id);
      if (p && !matchRep(r.salesman, [p]))
        await supabase.from("profiles").update({ kpi_name: r.salesman }).eq("id", p.id);
    }
    setBusy(false);
    setGrid(null);
    setRows([]);
    setStatus(`Saved ${fmtDay(day, true)}: ${kept.filter((r) => r.scored.made).length} of ${kept.length} made rotation for ${fmtDay(forDay, true)}.`);
    await load();
  }

  // The account name when there is one, so lists and history agree.
  const nameOf = useCallback((d: Daily) => (d.rep_id ? people.find((p) => p.id === d.rep_id)?.full_name || d.salesman : d.salesman), [people]);

  // Only current reps by default: people with no account (who left, or never had one) stay
  // on record but out of the way.
  const [showFormer, setShowFormer] = useState(false);
  const isCurrent = useCallback((d: Daily) => !!d.rep_id && people.some((p) => p.id === d.rep_id && p.active && p.role === "rep"), [people]);
  const shown = useMemo(() => (showFormer ? days : days.filter(isCurrent)), [days, showFormer, isCurrent]);
  const formerNames = useMemo(() => [...new Set(days.filter((d) => !isCurrent(d)).map((d) => d.salesman))].sort(), [days, isCurrent]);

  // The latest saved day: tomorrow's rotation.
  const latest = useMemo(() => {
    const d = shown[0]?.day;
    if (!d) return null;
    const list = shown.filter((x) => x.day === d).sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
    return { day: d, forDay: list[0].for_day, made: list.filter(madeOf), missed: list.filter((x) => !madeOf(x)) };
  }, [shown, nameOf]);

  async function pickTracker(f: File) {
    setError("");
    setStatus("");
    try {
      const s = readSheetWithFills(new Uint8Array(await f.arrayBuffer()), /rotation/i);
      const t = readTracker(s.grid, s.fills, excelDate);
      setImp({ file: f.name, ...t });
      setImpMap(Object.fromEntries(t.names.map((n) => [n, matchRep(n, people) ?? ""])));
    } catch (e) {
      setError(`Couldn't read ${f.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function runImport() {
    if (!imp) return;
    const kept = imp.entries.filter((e) => impMap[e.name] !== SKIP);
    const rows = kept.map((e) => {
      const repId = impMap[e.name] || null;
      const name = repId ? people.find((p) => p.id === repId)?.full_name || e.name : e.name;
      const sc = e.calls !== null && e.talk_hours !== null ? score({ calls: e.calls, talk_hours: e.talk_hours, deals: null }) : null;
      return {
        org_id: orgId,
        rep_id: repId,
        salesman: name,
        day: e.day,
        for_day: nextWorkDay(e.day),
        talk_hours: e.talk_hours,
        calls: e.calls,
        deals: null,
        points: sc ? sc.points : null,
        made: e.status === "made",
        status: e.status === "absent" ? "absent" : "worked",
        override_note: e.note && e.status !== "absent" ? e.note : null,
        source: "import",
        updated_by: me,
      };
    });
    // Days already uploaded from the CRM keep their real numbers.
    for (let i = 0; i < rows.length; i += 500) {
      setImpBusy(`Importing ${Math.min(i + 500, rows.length)} of ${rows.length}…`);
      const { error } = await supabase.from("rep_daily").upsert(rows.slice(i, i + 500), { onConflict: "org_id,salesman,day", ignoreDuplicates: true });
      if (error) {
        setImpBusy("");
        return setError(error.message);
      }
    }
    for (const [n, id] of Object.entries(impMap)) {
      const p = people.find((x) => x.id === id);
      if (p && !matchRep(n, [p])) await supabase.from("profiles").update({ kpi_name: n }).eq("id", p.id);
    }
    setImpBusy("");
    setImp(null);
    setStatus(`Imported ${rows.length} days of history.`);
    await load();
  }

  async function copyList() {
    if (!latest) return;
    const text = `Rotation for ${fmtDay(latest.forDay, true)}\nIn (${latest.made.length}): ${latest.made.map(nameOf).join(", ")}\nOut (${latest.missed.length}): ${latest.missed.map(nameOf).join(", ")}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      prompt("Copy this:", text);
    }
  }

  async function override(d: Daily) {
    if (!canEdit) return;
    const now = madeOf(d);
    const note = prompt(`${nameOf(d)}, ${fmtDay(d.day, true)}: mark as ${now ? "MISSED" : "MADE"} rotation? Add a reason (e.g. "excused -- training all afternoon"):`, d.override_note ?? "");
    if (note === null) return;
    const back = !now === d.made; // flipping back to what the numbers say clears the override
    const { error } = await supabase
      .from("rep_daily")
      .update({ override_made: back ? null : !now, override_note: back ? null : note || null, updated_by: me, updated_at: new Date().toISOString() })
      .eq("id", d.id);
    if (error) return setError(error.message);
    await load();
  }

  // History grid: reps (rows) x working days (columns), newest on the right.
  const grid2 = useMemo(() => {
    const allDays = [...new Set(shown.map((d) => d.day))].sort().slice(-weeks * 5);
    const byName = new Map<string, Map<string, Daily>>();
    for (const d of shown) {
      if (!allDays.includes(d.day)) continue;
      const key = d.rep_id ? people.find((p) => p.id === d.rep_id)?.full_name || d.salesman : d.salesman;
      const m = byName.get(key) ?? new Map();
      m.set(d.day, d);
      byName.set(key, m);
    }
    const reps = [...byName.keys()].sort();
    return { allDays, reps, byName };
  }, [shown, weeks, people]);

  const repSelect = (value: string | null, onChange: (v: string) => void) => (
    <select value={value ?? ""} onChange={(e) => onChange(e.target.value)} style={{ width: "auto", minWidth: 150, padding: "5px 8px", fontSize: 13 }}>
      <option value="">No account yet -- keep by name</option>
      <option value={SKIP}>Not a rep -- skip</option>
      {people
        .filter((p) => p.active)
        .map((p) => (
          <option key={p.id} value={p.id}>
            {p.full_name}
          </option>
        ))}
    </select>
  );

  return (
    <main className="shell rx-page">
      <div className="eyebrow">Team</div>
      <h1>Rotation</h1>
      <p className="muted" style={{ maxWidth: "70ch" }}>
        Upload the day&rsquo;s Sales Dashboard at close. A rep makes rotation for the next working day&rsquo;s leads with {RULES.needed} point: CRM talk
        time 2.5h = 0.5 or 4h = 1 &middot; calls 60 = 0.5 or 90 = 1 &middot; each enrollment 0.5. Every day&rsquo;s talk time, calls and deals are kept
        per rep. Reps see only their own.
      </p>
      {error && <div className="error">{error}</div>}
      {status && <div className="status">{status}</div>}

      {!canEdit ? null : !grid ? (
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
            accept=".xlsx,.csv"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void pick(f);
              e.target.value = "";
            }}
          />
          <b>Nightly close: drop today&rsquo;s Sales Dashboard here</b>
          <span className="hint">Excel or CSV, straight from the CRM</span>
        </label>
      ) : (
        <section className="card" style={{ marginTop: 14 }}>
          <div className="rx-head">
            <div>
              <div className="eyebrow" style={{ margin: 0 }}>
                {fileName}
              </div>
              <b>
                {rows.filter((r) => r.rep_id !== SKIP && r.scored.made).length} of {rows.filter((r) => r.rep_id !== SKIP).length} make rotation for{" "}
                {fmtDay(nextWorkDay(day), true)}
              </b>
            </div>
            <div className="rx-actions">
              <label className="hint" style={{ margin: 0, display: "inline-flex", gap: 6, alignItems: "center" }}>
                Day worked
                <input type="date" value={day} onChange={(e) => setDay(e.target.value)} style={{ width: "auto" }} />
              </label>
              <button onClick={() => (setGrid(null), setRows([]))}>Cancel</button>
              <button className="primary" disabled={busy} onClick={() => void save()}>
                {busy ? "Saving…" : "Save the day"}
              </button>
            </div>
          </div>
          {cols && (
            <p className="hint">
              Reading{" "}
              {(["talk", "calls", "deals"] as const).map((k, i) => (
                <span key={k}>
                  {i ? ", " : ""}
                  {k === "talk" ? "talk time" : k} from{" "}
                  <select value={cols[k]} onChange={(e) => setCol(k, Number(e.target.value))} style={{ width: "auto", padding: "2px 6px", fontSize: 13 }}>
                    <option value={-1}>(none)</option>
                    {header.map((h, j) => (
                      <option key={j} value={j}>
                        {h || `Column ${j + 1}`}
                      </option>
                    ))}
                  </select>
                </span>
              ))}
            </p>
          )}
          <div className="rx-scroll">
            <table className="rx-table">
              <thead>
                <tr>
                  <th>In the report</th>
                  <th>Rep</th>
                  <th className="num">Talk</th>
                  <th className="num">Calls</th>
                  <th className="num">Deals</th>
                  <th className="num">Points</th>
                  <th>Rotation</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} style={r.rep_id === SKIP ? { opacity: 0.5 } : undefined}>
                    <td>{r.salesman}</td>
                    <td>{repSelect(r.rep_id, (v) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, rep_id: v || null } : x))))}</td>
                    <td className="num">{fmtHours(r.numbers.talk_hours)}</td>
                    <td className="num">{r.numbers.calls ?? "--"}</td>
                    <td className="num">{r.numbers.deals ?? "--"}</td>
                    <td className="num">
                      <b>{r.scored.points}</b>
                    </td>
                    <td>
                      {r.scored.made ? (
                        <>
                          <span className="pill good">Made it</span>
                          {r.scored.hint === VINDICO && <small className="muted"> {VINDICO}</small>}
                        </>
                      ) : r.scored.hint === ABSENT ? (
                        <span className="pill">Absent</span>
                      ) : (
                        <>
                          <span className="pill poor">Missed</span> <small className="muted">{r.scored.hint}</small>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {latest && (
        <section className="card" style={{ marginTop: 14 }}>
          <div className="rx-head">
            <div>
              <h3 className="rx-sec-title" style={{ margin: 0 }}>
                Rotation for {fmtDay(latest.forDay, true)}
              </h3>
              <p className="hint" style={{ margin: "2px 0 0" }}>
                From {fmtDay(latest.day, true)}&rsquo;s numbers{canEdit ? " · tap a name to override with a reason" : ""}
              </p>
            </div>
            <button onClick={() => void copyList()}>{copied ? "Copied" : "Copy the list"}</button>
          </div>
          <div className="rx-grid2" style={{ marginTop: 10 }}>
            <div>
              <div className="rx-sec-title" style={{ color: "var(--ok)" }}>
                In ({latest.made.length})
              </div>
              {latest.made.map((d) => (
                <button key={d.id} className="rot-name" onClick={() => void override(d)}>
                  <b>{nameOf(d)}</b>
                  <small>
                    {lineOf(d)}
                    {d.override_made !== null ? ` · override: ${d.override_note || "no reason"}` : ""}
                  </small>
                </button>
              ))}
            </div>
            <div>
              <div className="rx-sec-title" style={{ color: "var(--bad)" }}>
                Out ({latest.missed.length})
              </div>
              {latest.missed.map((d) => (
                <button key={d.id} className="rot-name" onClick={() => void override(d)}>
                  <b>{nameOf(d)}</b>
                  <small>
                    {lineOf(d)}
                    {d.override_made !== null ? ` · override: ${d.override_note || "no reason"}` : ` · ${score(d).hint}`}
                  </small>
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {grid2.allDays.length > 0 && (
        <section className="card" style={{ marginTop: 14 }}>
          <div className="rx-head">
            <h3 className="rx-sec-title" style={{ margin: 0 }}>
              History
            </h3>
            <div className="rx-presets" style={{ margin: 0 }}>
              {[2, 4, 8, 16, 52].map((w) => (
                <button key={w} className={weeks === w ? "on" : ""} onClick={() => setWeeks(w)}>
                  {w === 52 ? "Year" : `${w} weeks`}
                </button>
              ))}
            </div>
          </div>
          <div className="rx-scroll">
            <table className="rx-table rot-grid">
              <thead>
                <tr>
                  <th>Rep</th>
                  <th className="num">Made</th>
                  {grid2.allDays.map((d) => (
                    <th key={d} className="num" title={fmtDay(d, true)}>
                      {new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: "numeric", day: "numeric" })}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid2.reps.map((name) => {
                  const m = grid2.byName.get(name)!;
                  const worked = grid2.allDays.filter((d) => m.has(d) && m.get(d)!.status !== "absent");
                  const made = worked.filter((d) => madeOf(m.get(d)!)).length;
                  const repId = [...m.values()][0]?.rep_id;
                  return (
                    <tr key={name}>
                      <td style={{ whiteSpace: "nowrap" }}>{repId ? <Link href={`/admin/reps/${repId}`}>{name}</Link> : name}</td>
                      <td className="num" style={{ whiteSpace: "nowrap" }}>
                        {made}/{worked.length}
                      </td>
                      {grid2.allDays.map((d) => {
                        const x = m.get(d);
                        if (!x) return <td key={d} className="num muted">·</td>;
                        if (x.status === "absent")
                          return (
                            <td key={d} className="num">
                              <span className="rot-cell ab" title={`${fmtDay(d, true)}: absent`}>
                                A
                              </span>
                            </td>
                          );
                        const ok = madeOf(x);
                        return (
                          <td key={d} className="num">
                            <button
                              className={`rot-cell ${ok ? "in" : "out"}${x.override_made !== null ? " ov" : ""}`}
                              title={`${fmtDay(d, true)}: ${lineOf(x)}${x.override_made !== null ? ` (override: ${x.override_note || "no reason"})` : ""}`}
                              onClick={() => void override(x)}
                            >
                              {ok ? "✓" : "✗"}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="hint" style={{ marginBottom: 0 }}>
            ✓ made rotation, ✗ missed, A absent, · no numbers that day. A ring marks a manager override or a note from the old tracker.{canEdit ? " Tap any day to change it." : ""}
            {formerNames.length > 0 && (
              <>
                {" "}
                <label style={{ display: "inline-flex", gap: 6, alignItems: "center" }} title={formerNames.join(", ")}>
                  <input type="checkbox" checked={showFormer} onChange={(e) => setShowFormer(e.target.checked)} style={{ width: "auto" }} />
                  Show {formerNames.length} people without a current rep account
                </label>
              </>
            )}
          </p>
        </section>
      )}
      {canEdit && (
      <details className="card" style={{ marginTop: 14 }} open={!!imp}>
        <summary style={{ cursor: "pointer", fontWeight: 650 }}>Import past rotation records</summary>
        {!imp ? (
          <div style={{ marginTop: 10 }}>
            <p className="hint" style={{ marginTop: 0 }}>
              The colour-coded Sales Rotation Tracker: a row per rep, a column per day, coloured by the legend (Yes / No / Absent). Calls and talk
              time written in a cell are kept. Days already uploaded from the CRM aren&rsquo;t touched.
            </p>
            <input
              ref={impInput}
              type="file"
              accept=".xlsx"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void pickTracker(f);
                e.target.value = "";
              }}
            />
          </div>
        ) : (
          <div style={{ marginTop: 10 }}>
            <p style={{ marginTop: 0 }}>
              <b>{imp.file}</b>: {imp.names.length} reps, {imp.entries.length} days from {fmtDay(imp.from, true)} to {fmtDay(imp.to, true)} &middot;{" "}
              {imp.entries.filter((e) => e.status === "made").length} made, {imp.entries.filter((e) => e.status === "missed").length} missed,{" "}
              {imp.entries.filter((e) => e.status === "absent").length} absent
            </p>
            <div className="rx-scroll">
              <table className="rx-table">
                <tbody>
                  {imp.names.map((n) => (
                    <tr key={n}>
                      <td>{n}</td>
                      <td>{repSelect(impMap[n] || null, (v) => setImpMap((m) => ({ ...m, [n]: v })))}</td>
                      <td className="num muted">{imp.entries.filter((e) => e.name === n).length} days</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="rx-actions" style={{ marginTop: 10 }}>
              <button className="primary" disabled={!!impBusy} onClick={() => void runImport()}>
                {impBusy || "Import history"}
              </button>
              <button disabled={!!impBusy} onClick={() => setImp(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </details>
      )}
    </main>
  );
}
