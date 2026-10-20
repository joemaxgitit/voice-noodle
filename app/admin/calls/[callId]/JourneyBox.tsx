"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clock, scoreBand } from "@/lib/calls";
import { HANDOFF_LABEL, journeyStatus, numbered, type JourneyCall } from "@/lib/journey";

/**
 * This call in the client's journey: its call number, whether another rep
 * took it over, and every other call with the same client ID.
 */
export default function JourneyBox({ supabase, callId, clientLabel, source }: { supabase: SupabaseClient; callId: string; clientLabel: string | null; source: string | null }) {
  const [calls, setCalls] = useState<(JourneyCall & { rep: string; duration_secs?: number | null })[]>([]);
  const [mine, setMine] = useState<{ call_number: number | null; handoff: string | null } | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const load = useCallback(async () => {
    const own = await supabase.from("calls").select("call_number, handoff").eq("id", callId).maybeSingle();
    if (own.error) return setError(/call_number|handoff/.test(own.error.message) ? "Run supabase/follow-ups.sql to track call numbers." : own.error.message);
    setMine((own.data as { call_number: number | null; handoff: string | null }) ?? { call_number: null, handoff: null });
    if (!clientLabel?.trim()) return setCalls([]);
    const { data } = await supabase
      .from("calls")
      .select("id, client_label, call_date, created_at, call_number, handoff, rep_id, rep_name, status, outcome, outcome_manual, retention, score, slp_score, duration_secs, scripts(title), profiles:rep_id(full_name)")
      .ilike("client_label", clientLabel.trim())
      .neq("source", "roleplay");
    setCalls(
      ((data || []) as unknown as (JourneyCall & { rep_name: string | null; duration_secs: number | null; scripts: { title: string } | null; profiles: { full_name: string | null } | null })[]).map((c) => ({
        ...c,
        script_title: c.scripts?.title ?? null,
        rep: c.profiles?.full_name || c.rep_name || "A rep",
      }))
    );
  }, [supabase, callId, clientLabel]);

  useEffect(() => {
    void load();
  }, [load]);

  async function set(patch: { call_number?: number | null; handoff?: string | null }) {
    setError("");
    const { error } = await supabase.from("calls").update(patch).eq("id", callId);
    if (error) return setError(error.message);
    setSaved("Saved. Press Re-grade so the grade knows.");
    setTimeout(() => setSaved(""), 4000);
    await load();
  }

  if (source === "roleplay") return null;
  const list = numbered(calls);
  const me = list.find((c) => c.id === callId);
  const status = journeyStatus(calls);

  return (
    <div className="report-part no-print" style={{ marginTop: 18 }}>
      <h2>Client journey</h2>
      {error && <div className="error">{error}</div>}
      {saved && <div className="status">{saved}</div>}
      {mine && (
        <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label className="field" style={{ margin: 0 }}>
            <span>Call #</span>
            <select value={mine.call_number ?? ""} onChange={(e) => void set({ call_number: e.target.value ? Number(e.target.value) : null })} style={{ width: "auto" }}>
              <option value="">Auto{me && !mine.call_number ? ` (call ${me.n})` : ""}</option>
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  Call {n}
                </option>
              ))}
            </select>
          </label>
          <label className="field" style={{ margin: 0 }}>
            <span>Taken by another rep?</span>
            <select value={mine.handoff ?? ""} onChange={(e) => void set({ handoff: e.target.value || null })} style={{ width: "auto" }}>
              <option value="">No -- the client&rsquo;s own rep</option>
              <option value="renew">{HANDOFF_LABEL.renew}</option>
              <option value="coverage">{HANDOFF_LABEL.coverage}</option>
            </select>
          </label>
          <span className="muted" style={{ fontSize: 13 }}>
            {clientLabel?.trim()
              ? `${list.length} call${list.length === 1 ? "" : "s"} with ${clientLabel.trim()} on record · ${status === "enrolled" ? "enrolled" : status === "renew" ? "went to renew" : "still open"}`
              : "Add the client ID to link this client's calls together."}
          </span>
        </div>
      )}
      {list.length > 1 && (
        <div className="rx-timeline" style={{ marginTop: 10 }}>
          {list.map((c) => (
            <Link key={c.id} href={`/admin/calls/${c.id}`} className="rx-ev" style={c.id === callId ? { background: "var(--ink-3)" } : undefined}>
              <span className="when">Call {c.n}</span>
              <span className="what">
                <b>
                  {c.rep}
                  {c.handoff ? <small className="muted"> · {c.handoff === "renew" ? "renew" : "covering"}</small> : null}
                </b>
                <small>
                  {c.call_date || c.created_at.slice(0, 10)}
                  {c.duration_secs ? ` · ${clock(c.duration_secs)}` : ""} · {(c.outcome_manual || c.outcome || c.status).replace("_", " ")}
                  {c.retention ? ` · ${c.retention === "paid6" ? "6+ payments" : c.retention}` : ""}
                </small>
              </span>
              <span className={`pill ${scoreBand(c.slp_score)}`}>SLP {c.slp_score ?? "--"}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
