"use client";

import { useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { IngestResult } from "@/lib/ingest";
import { slug, type ColType, type KpiColumn } from "@/lib/kpi";
import { TAG_LABEL } from "@/lib/repHistory";
import { fmtBytes, MAX_UPLOAD_BYTES, today } from "@/lib/training";
import { okToSpend, usd, useEstimate } from "@/lib/spend";

type Person = { id: string; full_name: string | null; role: string };

const UNIT: Record<string, ColType> = { number: "number", ratio: "ratio", money: "money", hours: "hours" };

function monthEnd(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  const end = `${ym}-${String(last).padStart(2, "0")}`;
  return end > today() && today().startsWith(ym) ? today() : end;
}

function fmtVal(v: number, unit: string) {
  if (unit === "ratio") return `${Math.round(v * 1000) / 10}%`;
  if (unit === "money") return `$${Math.round(v).toLocaleString()}`;
  if (unit === "hours") return `${Math.round(v * 10) / 10}h`;
  return Number.isInteger(v) ? v.toLocaleString() : String(Math.round(v * 100) / 100);
}

/**
 * The team drop box: paste or upload anything about several reps. Claude
 * sorts it by rep; the manager checks the preview and files it.
 */
export default function DropBox({
  supabase,
  orgId,
  me,
  people,
  onSaved,
}: {
  supabase: SupabaseClient;
  orgId: string;
  me: string;
  people: Person[];
  onSaved: () => void;
}) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [path, setPath] = useState("");
  const [phase, setPhase] = useState<"idle" | "reading" | "preview" | "saving">("idle");
  const [result, setResult] = useState<IngestResult | null>(null);
  const [keep, setKeep] = useState<boolean[]>([]);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [over, setOver] = useState(false);
  const pick = useRef<HTMLInputElement>(null);
  const est = useEstimate(supabase, "dropbox");

  const reps = [...people].sort((a, b) => Number(b.role === "rep") - Number(a.role === "rep") || (a.full_name || "").localeCompare(b.full_name || ""));

  function choose(f: File) {
    if (f.size > MAX_UPLOAD_BYTES) return setError(`${f.name} is over ${fmtBytes(MAX_UPLOAD_BYTES)}.`);
    setError("");
    setFile(f);
    setPath("");
  }

  async function read() {
    if (!(await okToSpend(supabase, est ?? 0, "Sorting this"))) return;
    setError("");
    setStatus("");
    setPhase("reading");
    let p = path;
    if (file && !p) {
      p = `${orgId}/inbox/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]+/g, "_")}`;
      const up = await supabase.storage.from("rep-files").upload(p, file, { contentType: file.type || undefined });
      if (up.error) {
        setPhase("idle");
        return setError(`Upload failed: ${up.error.message}`);
      }
      setPath(p);
    }
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const res = await fetch("/api/reps/ingest", {
      method: "POST",
      headers: { Authorization: `Bearer ${session?.access_token ?? ""}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text, path: p || undefined, name: file?.name, mime: file?.type }),
    }).catch((e) => e as Error);
    if (res instanceof Error) {
      setPhase("idle");
      return setError(res.message);
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setPhase("idle");
      return setError(body?.error || `Request failed (${res.status}).`);
    }
    const r = body.result as IngestResult;
    setResult(r);
    setTitle(r.title);
    setKeep(r.items.map((it) => !!it.rep_id));
    setPhase("preview");
  }

  function setRep(i: number, id: string) {
    if (!result) return;
    const items = result.items.map((it, j) => (j === i ? { ...it, rep_id: id } : it));
    setResult({ ...result, items });
    setKeep((k) => k.map((x, j) => (j === i ? !!id : x)));
  }

  async function save() {
    if (!result) return;
    setPhase("saving");
    setError("");
    const items = result.items.filter((it, i) => keep[i] && it.rep_id);
    const name = title.trim() || result.title || "Upload";
    let notes = 0;

    // Notes
    const noteRows = items
      .filter((it) => it.note.trim())
      .map((it) => ({
        org_id: orgId,
        rep_id: it.rep_id,
        author_id: me,
        tag: it.tag,
        body: `${it.note.trim()}\n\n(from the team drop box: ${name}${file ? `, "${file.name}"` : ""})`,
        note_date: /^\d{4}-\d{2}-\d{2}$/.test(it.date) ? it.date : today(),
      }));
    if (noteRows.length) {
      const { error } = await supabase.from("rep_notes").insert(noteRows);
      if (error) {
        setPhase("preview");
        return setError(error.message);
      }
      notes = noteRows.length;
    }

    // The file itself, on every profile it's about
    if (path && file) {
      const { error } = await supabase.from("rep_files").insert(
        [...new Set(items.map((it) => it.rep_id))].map((rep) => ({
          org_id: orgId,
          rep_id: rep,
          uploaded_by: me,
          name: file.name,
          path,
          mime: file.type || null,
          size_bytes: file.size,
          note: name,
        }))
      );
      if (error) setError(error.message);
    }

    // Numbers: one report per month, so months line up for the one-on-one
    const byMonth = new Map<string, { rep: string; key: string; label: string; unit: string; value: number; better: string }[]>();
    for (const it of items)
      for (const m of it.metrics) {
        if (!/^\d{4}-\d{2}$/.test(m.month) || typeof m.value !== "number" || !isFinite(m.value)) continue;
        const list = byMonth.get(m.month) ?? [];
        list.push({ rep: it.rep_id, key: slug(m.category), label: m.category, unit: m.unit, value: m.value, better: m.better });
        byMonth.set(m.month, list);
      }
    let months = 0;
    for (const [ym, list] of byMonth) {
      const cols: KpiColumn[] = [{ key: "salesman", label: "Rep", type: "name" }];
      for (const x of list) if (!cols.some((c) => c.key === x.key)) cols.push({ key: x.key, label: x.label, type: UNIT[x.unit] ?? "number" });
      const id = crypto.randomUUID();
      const { error } = await supabase.from("kpi_reports").insert({
        id,
        org_id: orgId,
        kind: "other",
        title: name,
        file_name: file?.name ?? null,
        path: path || null,
        period_start: `${ym}-01`,
        period_end: monthEnd(ym),
        columns: cols,
        uploaded_by: me,
      });
      if (error) {
        setError(error.message);
        continue;
      }
      const rows = new Map<string, Record<string, number>>();
      for (const x of list) rows.set(x.rep, { ...(rows.get(x.rep) ?? {}), [x.key]: x.value });
      const { error: e2 } = await supabase.from("kpi_rows").insert(
        [...rows].map(([rep, data]) => ({
          org_id: orgId,
          report_id: id,
          rep_id: rep,
          salesman: people.find((p) => p.id === rep)?.full_name || "Rep",
          data,
        }))
      );
      if (e2) setError(e2.message);
      else months++;
    }
    // Which way is good, as Claude read it -- without overriding a manager's choice.
    const prefs = new Map<string, string>();
    for (const [, list] of byMonth) for (const x of list) prefs.set(x.key, x.better);
    if (prefs.size)
      await supabase
        .from("kpi_metric_prefs")
        .upsert([...prefs].map(([k, b]) => ({ org_id: orgId, metric_key: k, better: b })), { onConflict: "org_id,metric_key", ignoreDuplicates: true });

    const repsTouched = new Set(items.map((it) => it.rep_id)).size;
    setStatus(
      `Filed on ${repsTouched} profile${repsTouched === 1 ? "" : "s"}: ${notes} note${notes === 1 ? "" : "s"}${months ? `, KPI numbers for ${months} month${months === 1 ? "" : "s"}` : ""}${path ? ", and the file" : ""}.`
    );
    setPhase("idle");
    setResult(null);
    setText("");
    setFile(null);
    setPath("");
    onSaved();
  }

  if (phase === "preview" || phase === "saving") {
    const r = result!;
    const kept = r.items.filter((it, i) => keep[i] && it.rep_id).length;
    return (
      <section className="card" style={{ marginTop: 14 }}>
        <div className="rx-head">
          <div>
            <div className="eyebrow" style={{ margin: 0 }}>
              Check before filing
            </div>
            <b>{r.summary}</b>
          </div>
          <div className="rx-actions">
            <button onClick={() => (setPhase("idle"), setResult(null))}>Back</button>
            <button className="primary" disabled={phase === "saving" || !kept} onClick={save}>
              {phase === "saving" ? "Filing…" : `File on ${kept} profile${kept === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
        <label className="field" style={{ marginTop: 10 }}>
          <span className="label">Name for this kind of source (keep it the same each month so months line up)</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        {r.team_note && (
          <p className="hint">
            <b>About the whole team:</b> {r.team_note}
          </p>
        )}
        {error && <div className="error">{error}</div>}
        <div style={{ display: "grid", gap: 10 }}>
          {r.items.map((it, i) => (
            <div key={i} className="rx-note" style={!keep[i] ? { opacity: 0.55 } : undefined}>
              <div className="meta" style={{ flexWrap: "wrap" }}>
                <input type="checkbox" checked={keep[i]} disabled={!it.rep_id} onChange={(e) => setKeep((k) => k.map((x, j) => (j === i ? e.target.checked : x)))} aria-label={`File for ${it.name_in_source}`} style={{ width: "auto" }} />
                <b style={{ color: "var(--text)" }}>&ldquo;{it.name_in_source}&rdquo;</b>
                <span>&rarr;</span>
                <select value={it.rep_id} onChange={(e) => setRep(i, e.target.value)} style={{ width: "auto", padding: "4px 8px", fontSize: 13 }}>
                  <option value="">Not on the team -- skip</option>
                  {reps.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.full_name}
                      {p.role !== "rep" ? ` (${p.role})` : ""}
                    </option>
                  ))}
                </select>
                {it.note && <span className={`rx-kind ${it.tag === "concern" ? "concern" : "note"}`}>{TAG_LABEL[it.tag]}</span>}
              </div>
              {it.note && <p>{it.note}</p>}
              {it.metrics.length > 0 && (
                <p className="hint" style={{ margin: "6px 0 0" }}>
                  {it.metrics.length} number{it.metrics.length === 1 ? "" : "s"}:{" "}
                  {it.metrics
                    .slice(0, 8)
                    .map((m) => `${m.category} ${fmtVal(m.value, m.unit)} (${m.month})`)
                    .join(" · ")}
                  {it.metrics.length > 8 ? " …" : ""}
                </p>
              )}
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section
      className="card"
      style={{ marginTop: 14, ...(over ? { borderColor: "var(--live)" } : {}) }}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files[0];
        if (f) choose(f);
      }}
    >
      <h3 className="rx-sec-title">Team drop box</h3>
      <p className="hint" style={{ marginTop: 0 }}>
        Paste or drop anything about several reps: a KPI file in any layout, a meeting recap, QA notes, a screenshot of a dashboard. Claude sorts
        it onto each rep&rsquo;s profile by name, and you check it before anything is filed. (For one rep, use &ldquo;Add anything&rdquo; on their profile.)
      </p>
      <textarea
        rows={4}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => {
          const f = e.clipboardData.files[0];
          if (f) {
            e.preventDefault();
            choose(f.name && f.name !== "image.png" ? f : new File([f], `screenshot-${today()}.png`, { type: f.type }));
          }
        }}
        placeholder="Paste here -- text, rows copied from Excel, or a screenshot"
        style={{ width: "100%" }}
      />
      <div className="rx-actions" style={{ marginTop: 8 }}>
        <input
          ref={pick}
          type="file"
          style={{ display: "none" }}
          accept=".xlsx,.csv,.pdf,.txt,.md,image/*"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) choose(f);
            e.target.value = "";
          }}
        />
        <button type="button" onClick={() => pick.current?.click()}>
          {file ? "Change file" : "Choose a file"}
        </button>
        {file && (
          <span className="hint" style={{ margin: 0 }}>
            {file.name} · {fmtBytes(file.size)}{" "}
            <button className="link-btn" onClick={() => (setFile(null), setPath(""))}>
              remove
            </button>
          </span>
        )}
        <button className="primary" disabled={phase === "reading" || (!text.trim() && !file)} onClick={read}>
          {phase === "reading" ? "Reading…" : `Sort it onto profiles${est !== null ? ` · about ${usd(est)}` : ""}`}
        </button>
      </div>
      {phase === "reading" && (
        <div className="rx-working" style={{ marginTop: 10 }}>
          <span className="rx-spin" aria-hidden="true" />
          <span className="hint" style={{ margin: 0 }}>
            Reading it and matching names -- usually under a minute.
          </span>
        </div>
      )}
      {error && <div className="error">{error}</div>}
      {status && <div className="status">{status}</div>}
    </section>
  );
}
