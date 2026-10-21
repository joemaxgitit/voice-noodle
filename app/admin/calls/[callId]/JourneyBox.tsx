"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clock, scoreBand } from "@/lib/calls";
import { startJob } from "@/lib/callsClient";
import type { JourneyRead } from "@/app/api/journeys/read/route";
import { clientKey, journeyStatus, numbered, type JourneyCall } from "@/lib/journey";

/**
 * This call in the client's journey: its call number, whether another rep
 * took it over, and every other call with the same client ID.
 */
export default function JourneyBox({ supabase, callId, clientLabel, source, onChanged, version }: { supabase: SupabaseClient; callId: string; clientLabel: string | null; source: string | null; onChanged?: () => void; version?: string }) {
  const [calls, setCalls] = useState<(JourneyCall & { rep: string; duration_secs?: number | null })[]>([]);
  const [mine, setMine] = useState<{ call_number: number | null; handoff: string | null } | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [read, setRead] = useState<{ read: JourneyRead; updated_at: string; calls_read: number } | null>(null);

  const load = useCallback(async () => {
    const own = await supabase.from("calls").select("call_number, handoff").eq("id", callId).maybeSingle();
    if (own.error) return setError(/call_number|handoff/.test(own.error.message) ? "Run supabase/follow-ups.sql to track call numbers." : own.error.message);
    setMine((own.data as { call_number: number | null; handoff: string | null }) ?? { call_number: null, handoff: null });
    if (!clientLabel?.trim()) return setCalls([]);
    const jr = await supabase.from("client_journeys").select("read, updated_at, calls_read").eq("client_key", clientKey(clientLabel)).maybeSingle();
    setRead((jr.data as { read: JourneyRead; updated_at: string; calls_read: number } | null) ?? null);
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

  // Reload when this call changes (graded, re-graded), so its row in the timeline isn't left showing "transcribing".
  useEffect(() => {
    void load();
  }, [load, version]);

  async function set(patch: { call_number?: number | null; handoff?: string | null; script_id?: string }) {
    setError("");
    // A renew call is always graded on the Renew script (it picks up the Options Script at Phase 2);
    // switching it back off returns it to the script Renew continues into.
    if ("handoff" in patch) {
      const [{ data: sc }, { data: cur }] = await Promise.all([
        supabase.from("scripts").select("id, title, continues_into").eq("active", true),
        supabase.from("calls").select("script_id").eq("id", callId).maybeSingle(),
      ]);
      const renew = ((sc || []) as { id: string; title: string; continues_into: string | null }[]).find((x) => x.continues_into || /renew/i.test(x.title));
      if (renew && patch.handoff === "renew") patch.script_id = renew.id;
      else if (renew && !patch.handoff && cur?.script_id === renew.id && renew.continues_into) patch.script_id = renew.continues_into;
    }
    const { error } = await supabase.from("calls").update(patch).eq("id", callId);
    if (error) return setError(error.message);
    // Re-grade so the grade knows where this call sits in the journey.
    const err = await startJob(supabase, "grade", callId);
    setSaved(err ? `Saved, but the re-grade didn't start: ${err}` : "Saved. Re-grading so the grade knows…");
    setTimeout(() => setSaved(""), 5000);
    await load();
    onChanged?.();
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
            <span>Renew?</span>
            <select value={mine.handoff === "renew" ? "renew" : ""} onChange={(e) => void set({ handoff: e.target.value || null })} style={{ width: "auto" }}>
              <option value="">No</option>
              <option value="renew">Renew</option>
            </select>
          </label>
          <span className="muted" style={{ fontSize: 13 }}>
            {clientLabel?.trim()
              ? `${list.length} call${list.length === 1 ? "" : "s"} with ${clientLabel.trim()} on record · ${status === "enrolled" ? "enrolled" : status === "renew" ? "went to renew" : "still open"}`
              : "Add the client ID to link this client's calls together."}
          </span>
        </div>
      )}
      {read && list.length > 1 && (
        <div className="card" style={{ marginTop: 10 }}>
          <b>The journey so far</b> <small className="muted">· read across {read.calls_read} calls, {new Date(read.updated_at).toLocaleDateString()}</small>
          <p style={{ margin: "6px 0" }}>{read.read.story}</p>
          {read.read.bridges.length > 0 && (
            <>
              <small className="muted" style={{ fontWeight: 600 }}>Bridges -- what carried over well</small>
              <ul className="plain-list" style={{ marginTop: 2 }}>
                {read.read.bridges.map((b, i) => (
                  <li key={i}>
                    <b>{b.what}</b> <small className="muted">· calls {b.calls}</small> -- {b.evidence}
                  </li>
                ))}
              </ul>
            </>
          )}
          {read.read.disconnects.length > 0 && (
            <>
              <small style={{ fontWeight: 600, color: "var(--bad)" }}>Disconnects -- what broke between calls</small>
              <ul className="plain-list" style={{ marginTop: 2 }}>
                {read.read.disconnects.map((b, i) => (
                  <li key={i}>
                    <b>{b.what}</b> <small className="muted">· calls {b.calls}</small> -- {b.evidence}
                  </li>
                ))}
              </ul>
            </>
          )}
          <p style={{ margin: "6px 0 0" }}>
            <b>What decided it:</b> {read.read.decided_it}
          </p>
          <p style={{ margin: "4px 0 0" }}>
            <b>Next move:</b> {read.read.next_move}
          </p>
          {read.read.renew?.applies && (
            <div className="card" style={{ marginTop: 10, borderLeft: "3px solid var(--live)" }}>
              <b>Second chance (renew)</b>{" "}
              <small className="muted">· {read.read.renew.same_rep ? "same rep both times" : "a different rep on the renew"}</small>
              {read.read.renew.first_stall && (
                <p style={{ margin: "6px 0 0" }}>
                  <b>Why the first call didn&rsquo;t close:</b> {read.read.renew.first_stall}
                </p>
              )}
              {read.read.renew.really && (
                <p style={{ margin: "4px 0 0" }}>
                  <b>What was really underneath:</b> {read.read.renew.really}
                </p>
              )}
              {read.read.renew.what_moved && (
                <p style={{ margin: "4px 0 0" }}>
                  <b>What moved them on the renew:</b> {read.read.renew.what_moved}
                </p>
              )}
              {read.read.renew.lesson && (
                <p style={{ margin: "4px 0 0" }}>
                  <b>Lesson for the first rep:</b> {read.read.renew.lesson}
                </p>
              )}
            </div>
          )}
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
                  {c.handoff === "renew" || /renew/i.test(c.script_title || "") ? <small className="muted"> · renew</small> : null}
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
