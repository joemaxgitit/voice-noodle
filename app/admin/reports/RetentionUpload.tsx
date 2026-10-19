"use client";

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { displayName, matchRep, nameKey } from "@/lib/kpi";
import { pct, pts, reasonsText, type RetentionParsed } from "@/lib/retention";
import { fmtDate } from "@/lib/training";

type Person = { id: string; full_name: string | null; role: string; kpi_name: string | null; active: boolean };
const SKIP = "__skip";
const period = (a: string, b: string) => `${fmtDate(a, { month: "short", day: "numeric" })} – ${fmtDate(b, { month: "short", day: "numeric", year: "numeric" })}`;

/** The Friday Retention Lookback: preview, match names, save onto rep profiles. */
export default function RetentionUpload({
  supabase,
  orgId,
  me,
  file,
  parsed,
  people,
  onDone,
  onCancel,
}: {
  supabase: SupabaseClient;
  orgId: string;
  me: string;
  file: File;
  parsed: RetentionParsed;
  people: Person[];
  onDone: (msg: string) => void;
  onCancel: () => void;
}) {
  const [match, setMatch] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ideas, setIdeas] = useState(true);
  const pick = (s: string) => match[nameKey(s)] ?? matchRep(s, people) ?? SKIP;
  // Only people with sales this window or a point-of-sale loss matter here.
  const reps = parsed.reps.filter((r) => (r.deals ?? 0) > 0 || r.pos_lost > 0);
  const sorted = [...people].sort((a, b) => Number(b.role === "rep") - Number(a.role === "rep") || (a.full_name || "").localeCompare(b.full_name || ""));

  const [taken, setTaken] = useState(false);
  useEffect(() => {
    void supabase
      .from("retention_reports")
      .select("id")
      .eq("period_start", parsed.period_start)
      .eq("period_end", parsed.period_end)
      .maybeSingle()
      .then(({ data }) => setTaken(!!data));
  }, [supabase, parsed]);

  async function save() {
    setBusy(true);
    setError("");
    if (taken) {
      const { error } = await supabase.from("retention_reports").delete().eq("period_start", parsed.period_start).eq("period_end", parsed.period_end);
      if (error) {
        setBusy(false);
        return setError(error.message);
      }
    }
    const id = crypto.randomUUID();
    const path = `${orgId}/reports/${id}-${file.name.replace(/[^\w.-]+/g, "_")}`;
    const up = await supabase.storage.from("rep-files").upload(path, file, { contentType: file.type || undefined });
    const { error: e1 } = await supabase.from("retention_reports").insert({
      id,
      org_id: orgId,
      period_start: parsed.period_start,
      period_end: parsed.period_end,
      team: parsed.team,
      file_name: file.name,
      path: up.error ? null : path,
      uploaded_by: me,
    });
    if (e1) {
      setBusy(false);
      return setError(/retention_reports|does not exist/i.test(e1.message) ? `${e1.message} -- run supabase/retention.sql first.` : e1.message);
    }
    const rows = reps.map((r) => {
      const m = pick(r.salesman);
      return {
        org_id: orgId,
        report_id: id,
        rep_id: m === SKIP ? null : m,
        salesman: r.salesman,
        deals: r.deals,
        before1_rate: r.before1_rate,
        prior_rate: r.prior_rate,
        pending_share: r.pending_share,
        requests: r.requests,
        pos_lost: r.pos_lost,
        pos_reasons: r.pos_reasons,
      };
    });
    const { error: e2 } = await supabase.from("retention_reps").insert(rows);
    if (e2) {
      await supabase.from("retention_reports").delete().eq("id", id);
      setBusy(false);
      return setError(e2.message);
    }
    // Every lost client, once each, for the 3-month look back.
    if (parsed.cancels.length) {
      const rows = parsed.cancels.map((c) => {
        const m = pick(c.salesman);
        return { org_id: orgId, rep_id: m === SKIP ? null : m, salesman: c.salesman, client_id: c.client_id, requested: c.requested, stage: c.stage };
      });
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await supabase.from("retention_cancels").upsert(rows.slice(i, i + 500), { onConflict: "org_id,client_id" });
        if (error && !/retention_cancels|does not exist/i.test(error.message)) {
          setBusy(false);
          return setError(error.message);
        }
      }
    }
    // Remember hand-picked names.
    for (const r of reps) {
      const m = match[nameKey(r.salesman)];
      if (m && m !== SKIP && !matchRep(r.salesman, people.filter((p) => p.id === m))) await supabase.from("profiles").update({ kpi_name: displayName(r.salesman) }).eq("id", m);
    }
    // The team's biggest sales-side reasons, as Thursday meeting ideas.
    let added = 0;
    if (ideas) {
      for (const [reason, n] of parsed.team.top_reasons.slice(0, 3)) {
        if (n < 2) continue;
        // Don't pile up the same idea week after week.
        const { count } = await supabase.from("meeting_items").select("id", { count: "exact", head: true }).is("meeting_id", null).eq("title", `Retention: "${reason}"`);
        if (count) continue;
        const { error } = await supabase.from("meeting_items").insert({
          org_id: orgId,
          meeting_id: null,
          title: `Retention: "${reason}"`,
          notes: `${n} clients cancelled for this in ${period(parsed.period_start, parsed.period_end)} -- a reason that traces back to the sale.`,
          minutes: 3,
          updated_by: me,
        });
        if (!error) added++;
      }
    }
    setBusy(false);
    onDone(
      `Saved the retention lookback for ${period(parsed.period_start, parsed.period_end)} -- ${rows.filter((r) => r.rep_id).length} reps updated${added ? `, ${added} idea${added === 1 ? "" : "s"} added to the Thursday backlog` : ""}.`
    );
  }

  const t = parsed.team;
  return (
    <section className="card" style={{ marginTop: 14 }}>
      <div className="rx-head">
        <div>
          <div className="eyebrow" style={{ margin: 0 }}>
            Retention lookback
          </div>
          <b>{period(parsed.period_start, parsed.period_end)}</b>
          {taken && <span className="muted"> · already uploaded -- saving replaces it</span>}
        </div>
        <div className="rx-actions">
          <button onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="primary" disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save to rep profiles"}
          </button>
        </div>
      </div>
      {error && <div className="error">{error}</div>}
      <p style={{ margin: "8px 0" }}>
        Team: <b>{pct(t.before1_rate)}</b> cancelled before the 1st payment &middot; {t.requests ?? "--"} cancel requests, {pct(t.save_rate)} saved &middot;{" "}
        <b>{t.pos_lost}</b> lost for reasons that trace back to the sale
      </p>
      {t.top_reasons.length > 0 && <p className="hint" style={{ marginTop: 0 }}>Top sales-side reasons: {reasonsText(Object.fromEntries(t.top_reasons.slice(0, 5)))}</p>}
      <p className="hint">Only the sales side comes in: no client names, escalations or retention AM numbers. Before-1st rates are a floor while first payments are still pending.</p>

      <div className="rx-scroll">
        <table className="rx-table">
          <thead>
            <tr>
              <th>Salesman</th>
              <th className="num">Before-1st</th>
              <th className="num">Change</th>
              <th className="num">Requests</th>
              <th>Sales-side reasons</th>
              <th>Account</th>
            </tr>
          </thead>
          <tbody>
            {reps.map((r) => (
              <tr key={r.salesman}>
                <td>{r.salesman}</td>
                <td className="num">{pct(r.before1_rate)}</td>
                <td className="num">{pts(r.before1_rate, r.prior_rate)}</td>
                <td className="num">{r.requests ?? "--"}</td>
                <td style={{ fontSize: 13 }}>{reasonsText(r.pos_reasons) || <span className="muted">--</span>}</td>
                <td>
                  <select value={pick(r.salesman)} onChange={(e) => setMatch((m) => ({ ...m, [nameKey(r.salesman)]: e.target.value }))} aria-label={`Account for ${r.salesman}`}>
                    <option value={SKIP}>Not on the team -- keep by name</option>
                    {sorted.map((p) => (
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
      <label className="hint" style={{ display: "inline-flex", gap: 6, alignItems: "center", marginTop: 10 }}>
        <input type="checkbox" checked={ideas} onChange={(e) => setIdeas(e.target.checked)} style={{ width: "auto" }} /> Add the team&rsquo;s top sales-side reasons to the Thursday meeting ideas
      </label>
    </section>
  );
}
