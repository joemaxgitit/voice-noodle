"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clock } from "@/lib/calls";
import { fmtTime, matchRecordings, readCallLog, repForAgent, type LogRow } from "@/lib/callLog";
import { SHORT_SECS } from "@/lib/quick";
import { estimateFor, okToSpend, transcribeEstimate, usd } from "@/lib/spend";
import { audioSeconds, convosoName, uploadCall } from "@/lib/uploadCall";

type Person = { id: string; full_name: string | null; kpi_name?: string | null };
type ScriptOpt = { id: string; title: string; continues_into?: string | null };
type Item = {
  file: File;
  row: LogRow | null;
  secs: number | null;
  /** The recording's own length. */
  fileSecs: number | null;
  date: string | null;
  time: string | null;
  repId: string;
  state: "waiting" | "working" | "done" | "dupe" | "error";
  note: string;
  callId?: string;
};

/**
 * A whole day at once: drop the dialer's call log and that day's recordings.
 * Each recording is matched to its row in the log (client's number and time),
 * so the rep, client ID, date, time and order fill in by themselves. Calls
 * over 1:30 get the full grade; voicemails and shorter calls a cheap quick read.
 */
export default function BulkUpload({
  supabase,
  me,
  people,
  scripts,
  onDone,
}: {
  supabase: SupabaseClient;
  me: { id: string; org_id: string | null } | null;
  people: Person[];
  scripts: ScriptOpt[];
  onDone: () => void;
}) {
  const renew = scripts.find((x) => x.continues_into || /renew/i.test(x.title)) ?? null;
  const [scriptId, setScriptId] = useState(() => scripts.find((x) => x.id !== renew?.id)?.id ?? scripts[0]?.id ?? "");
  const [log, setLog] = useState<LogRow[] | null>(null);
  const [logName, setLogName] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [fallbackRep, setFallbackRep] = useState("");
  // Vindico: whose seat these recordings are from (the log's agent name), remembered per rep on this computer.
  const [seat, setSeat] = useState("");
  const SEATS = "vn_vindico_seats";
  const seats = (): Record<string, string> => {
    try {
      return JSON.parse(localStorage.getItem(SEATS) || "{}");
    } catch {
      return {};
    }
  };
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [kpi, setKpi] = useState<Map<string, string | null>>(new Map());
  const [est, setEst] = useState<{ grade: number; quick: number } | null>(null);

  useEffect(() => {
    void Promise.all([estimateFor(supabase, "grade"), estimateFor(supabase, "quickread")]).then(([grade, quick]) => setEst({ grade, quick }));
    void supabase
      .from("profiles")
      .select("id, kpi_name")
      .then(({ data }) => setKpi(new Map(((data || []) as { id: string; kpi_name: string | null }[]).map((p) => [p.id, p.kpi_name]))));
  }, [supabase]);
  const reps = useMemo(() => people.map((p) => ({ ...p, kpi_name: kpi.get(p.id) ?? null })), [people, kpi]);

  // Re-match whenever the log or the recordings change.
  const rematch = (list: Item[], rows: LogRow[] | null, seatName = seat): Item[] => {
    const vin = rows?.[0]?.dialer === "vindico";
    // A Vindico log covers every seat: only match against the chosen seat's calls (nothing until one is picked).
    const idx = rows && (!vin || seatName) ? matchRecordings(list.map((i) => ({ name: i.file.name, secs: i.fileSecs })), rows, vin ? seatName : null) : list.map(() => -1);
    return list
      .map((it, k) => {
        const row = rows && idx[k] >= 0 ? rows[idx[k]] : null;
        const fromName = convosoName(it.file.name);
        // Vindico agent names are seats, not people: the rep is the one picked above.
        const rep = row && row.dialer !== "vindico" ? repForAgent(row.agent, reps) : null;
        return { ...it, row, secs: row?.secs ?? it.fileSecs, date: row?.date ?? fromName.date, time: row?.time ?? fromName.time, repId: rep?.id ?? it.repId };
      })
      .sort((a, b) => `${a.date ?? ""}${a.time ?? ""}`.localeCompare(`${b.date ?? ""}${b.time ?? ""}`));
  };

  async function pickLog(f: File | null) {
    setError("");
    if (!f) return;
    try {
      const rows = readCallLog(f.name, new Uint8Array(await f.arrayBuffer()));
      if (!rows.length) return setError("No calls found in that call log.");
      setLog(rows);
      setLogName(f.name);
      const remembered = rows[0]?.dialer === "vindico" && fallbackRep ? (seats()[fallbackRep] ?? "") : "";
      setSeat(remembered);
      setItems((list) => rematch(list, rows, remembered));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function pickFiles(fs: FileList | null) {
    setError("");
    if (!fs?.length) return;
    const have = new Set(items.map((i) => i.file.name));
    const added: Item[] = [];
    for (const f of Array.from(fs)) {
      if (have.has(f.name)) continue;
      const fs_ = await audioSeconds(f);
      added.push({ file: f, row: null, secs: fs_, fileSecs: fs_, date: null, time: null, repId: "", state: "waiting", note: "" });
    }
    setItems((list) => rematch([...list.filter((i) => i.state !== "done"), ...added], log));
  }

  const isVinLog = log?.[0]?.dialer === "vindico";
  const vinAgents = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of log ?? []) if (r.dialer === "vindico" && r.agent && (r.secs ?? 0) >= 20) m.set(r.agent, (m.get(r.agent) ?? 0) + 1);
    return [...m].sort((a, b) => a[0].localeCompare(b[0]));
  }, [log]);
  const matchedRows = new Set(items.map((i) => i.row).filter(Boolean));
  // The log can hold every rep's calls (Vindico logs do): only list the reps whose recordings were dropped in,
  // and only calls someone actually talked on (an agent, 20+ seconds).
  const agents = new Set(isVinLog ? (seat ? [seat] : []) : items.map((i) => i.row?.agent).filter(Boolean));
  const missing = (log ?? []).filter((r) => !matchedRows.has(r) && r.agent && (r.secs ?? 0) >= 20 && (isVinLog ? !!seat && r.agent === seat : !agents.size || agents.has(r.agent)));
  const todo = items.filter((i) => i.state === "waiting" || i.state === "error");
  const repOf = (i: Item) => i.repId || fallbackRep;
  const isVindico = (name: string) => /^recording-[0-9a-f]{8}-[0-9a-f]{4}-/i.test(name);
  // A Vindico recording is a renew lead -- unless its row in the log says it's from a sales (non-renew) campaign.
  // With a Vindico log, an unmatched recording goes by the chosen seat's campaign (mostly renew, or not).
  const seatRenew = (() => {
    const mine = (log ?? []).filter((r) => r.dialer === "vindico" && (!seat || r.agent === seat));
    return mine.length ? mine.filter((r) => /renew/i.test(`${r.campaign} ${r.service}`)).length * 2 > mine.length : true;
  })();
  const renewFor = (i: Item) => !!renew && isVindico(i.file.name) && (i.row ? /renew/i.test(`${i.row.campaign} ${i.row.service}`) : seatRenew);
  const full = todo.filter((i) => (i.secs ?? 0) >= SHORT_SECS).length;
  const cost = est ? todo.reduce((s, i) => s + transcribeEstimate(i.secs ?? 60) + ((i.secs ?? 0) >= SHORT_SECS ? est.grade : est.quick), 0) : null;
  const needRep = todo.some((i) => !repOf(i));

  async function run() {
    if (!me?.org_id) return;
    if (!scriptId) return setError("Choose the script.");
    if (isVinLog && !fallbackRep) return setError("Pick whose calls these are -- Vindico logs don’t name the rep.");
    if (needRep) return setError("Some recordings have no rep -- pick one under “Rep for anything the log doesn’t name”.");
    if (!(await okToSpend(supabase, cost ?? 0, `${todo.length} calls`))) return;
    setError("");
    setRunning(true);
    for (const it of todo) {
      const set = (p: Partial<Item>) => setItems((list) => list.map((x) => (x.file === it.file ? { ...x, ...p } : x)));
      set({ state: "working", note: "Starting..." });
      const vin = renewFor(it) ? renew : null;
      const res = await uploadCall(
        supabase,
        it.file,
        {
          orgId: me.org_id,
          uploadedBy: me.id,
          repId: repOf(it),
          repName: null,
          scriptId: vin ? vin.id : scriptId,
          clientLabel: it.row?.clientId ?? null,
          callDate: it.date,
          callTime: it.time,
          handoff: vin ? "renew" : null,
        },
        (s) => set({ note: s })
      );
      if (res.ok) set({ state: "done", note: "Uploaded -- transcribing, then graded or read by itself", callId: res.id });
      else set({ state: res.dupe ? "dupe" : "error", note: res.error, callId: res.dupe?.id });
    }
    setRunning(false);
    onDone();
  }

  return (
    <div className="card" style={{ marginTop: 18 }}>
      <b>Upload a whole day</b>
      <p className="hint" style={{ marginTop: 4 }}>
        Drop the call log from the dialer, then that day&rsquo;s recordings (as many as you like). Each recording is matched to its row in the log, so the rep, client ID, date and time
        fill in by themselves. Calls over 1:30 get the full grade; voicemails and shorter calls get a quick read that never touches the scores.
      </p>

      <div className="calls-form">
        <label className="field">
          <span>Call log (CSV or Excel)</span>
          <input type="file" accept=".csv,.xlsx" onChange={(e) => void pickLog(e.target.files?.[0] ?? null)} disabled={running} />
          {log && (
            <small className="muted">
              {logName}: {log.length} calls
            </small>
          )}
        </label>
        <label className="field">
          <span>Recordings</span>
          <input type="file" multiple accept="audio/*,.mp3,.wav,.m4a" onChange={(e) => void pickFiles(e.target.files)} disabled={running} />
        </label>
        <label className="field">
          <span>Script</span>
          <select value={scriptId} onChange={(e) => setScriptId(e.target.value)} disabled={running}>
            {scripts.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{isVinLog ? "Whose calls these are" : "Rep for anything the log doesn’t name"}</span>
          <select
            value={fallbackRep}
            onChange={(e) => {
              setFallbackRep(e.target.value);
              if (isVinLog) {
                const s = seats()[e.target.value] ?? "";
                setSeat(s);
                setItems((l) => rematch(l, log, s));
              }
            }}
            disabled={running}
          >
            <option value="">Choose&hellip;</option>
            {reps.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
              </option>
            ))}
          </select>
        </label>
        {isVinLog && (
          <label className="field">
            <span>Their name in this Vindico log</span>
            <select
              value={seat}
              onChange={(e) => {
                setSeat(e.target.value);
                if (fallbackRep)
                  try {
                    localStorage.setItem(SEATS, JSON.stringify({ ...seats(), [fallbackRep]: e.target.value }));
                  } catch {}
                setItems((l) => rematch(l, log, e.target.value));
              }}
              disabled={running}
            >
              <option value="">Choose&hellip;</option>
              {vinAgents.map(([a, n]) => (
                <option key={a} value={a}>
                  {a} ({n} calls)
                </option>
              ))}
            </select>
            <small className="muted">Vindico names the seat, not the person -- this is remembered for next time.</small>
          </label>
        )}
      </div>

      {items.length > 0 && (
        <div className="rx-scroll" style={{ marginTop: 10 }}>
          <table className="bu-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Length</th>
                <th>Client</th>
                <th>Rep</th>
                <th>Gets</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.file.name}>
                  <td>{i.time ? fmtTime(i.time) : <span className="muted">--</span>}</td>
                  <td>{clock(i.secs) || "--"}</td>
                  <td>
                    {i.row ? (
                      i.row.clientId ?? <span className="muted">…{i.row.phone.slice(-4)}</span>
                    ) : (
                      <span className="muted" title={i.file.name}>
                        not matched -- pick the rep
                      </span>
                    )}
                    {i.row?.disposition ? <small className="muted"> · {i.row.disposition.replace(/_/g, " ").toLowerCase()}</small> : null}
                  </td>
                  <td>
                    <select value={i.repId} onChange={(e) => setItems((l) => l.map((x) => (x.file === i.file ? { ...x, repId: e.target.value } : x)))} disabled={running || i.state === "done"}>
                      <option value="">{fallbackRep ? "(the rep above)" : "Choose…"}</option>
                      {reps.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.full_name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>{renewFor(i) ? "Renew grade" : (i.secs ?? 0) >= SHORT_SECS ? "Full grade" : "Quick read"}</td>
                  <td>
                    {i.state === "done" && i.callId ? (
                      <Link href={`/admin/calls/${i.callId}`}>Uploaded</Link>
                    ) : i.state === "dupe" && i.callId ? (
                      <Link href={`/admin/calls/${i.callId}`} className="danger">
                        Already on file
                      </Link>
                    ) : i.state === "error" ? (
                      <span className="danger">{i.note}</span>
                    ) : i.state === "working" ? (
                      <span className="muted">{i.note}</span>
                    ) : (
                      <button onClick={() => setItems((l) => l.filter((x) => x.file !== i.file))} disabled={running} title="Leave this one out">
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {missing.length > 0 && items.length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary className="hint" style={{ cursor: "pointer" }}>
            {missing.length} call{missing.length === 1 ? "" : "s"} in the log with no recording dropped in
          </summary>
          <ul className="hint" style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {missing.map((r, k) => (
              <li key={k}>
                {fmtTime(r.time)} · {clock(r.secs)} · ({r.phone.slice(0, 3)}) {r.phone.slice(3, 6)}-{r.phone.slice(6)}
                {r.clientId ? ` · ${r.clientId}` : ""}
                {r.agent ? ` · ${r.agent}` : ""}
                {r.disposition ? ` · ${r.disposition.replace(/_/g, " ").toLowerCase()}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}

      {todo.length > 0 && (
        <div className="row" style={{ marginTop: 12, gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button className="primary" disabled={running} onClick={() => void run()}>
            {running ? "Uploading… keep this tab open" : `Upload ${todo.length} call${todo.length === 1 ? "" : "s"}`}
          </button>
          <span className="muted" style={{ fontSize: 14 }}>
            {full} full grade{full === 1 ? "" : "s"}, {todo.length - full} quick read{todo.length - full === 1 ? "" : "s"}
            {cost !== null ? ` · about ${usd(cost)} in all` : ""} (voicemails among the long ones cost less)
          </span>
        </div>
      )}
      {error && <div className="error">{error}</div>}
      <style>{`
        .bu-table { width: 100%; border-collapse: collapse; font-size: 14px; }
        .bu-table th, .bu-table td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: middle; }
        .bu-table th { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; }
        .bu-table select { padding: 4px 6px; font-size: 13px; width: auto; }
        .bu-table button { padding: 2px 8px; }
      `}</style>
    </div>
  );
}
