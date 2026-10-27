"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { createClient } from "@/lib/supabase/client";
import type { CoachNow } from "@/lib/calls";
import { FOCUS_CHECKS, FOCUS_RESULT_LABEL, SHOWN_LABEL, type CoachFocus, type FocusCheckGrade } from "@/lib/coachFocus";

/*
  "Coach this" on the Coach Now card: start tracking this coaching point on
  the rep's next calls. One focus per rep at a time; starting a new one
  replaces the old. It stays with managers unless one sends it to the rep's
  home page.
*/
export default function CoachThis({
  supabase,
  callId,
  repId,
  orgId,
  cn,
  check,
}: {
  supabase: ReturnType<typeof createClient>;
  callId: string;
  repId: string | null;
  orgId: string | null;
  cn: CoachNow;
  /** This call's check against an earlier focus, if one was being tracked. */
  check?: FocusCheckGrade;
}) {
  const [active, setActive] = useState<CoachFocus | null>(null);
  const [checked, setChecked] = useState(0);
  const [checkedOf, setCheckedOf] = useState<CoachFocus | null>(null);
  const [form, setForm] = useState(false);
  const [share, setShare] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    if (!repId) return;
    const { data, error } = await supabase.from("coaching_focus").select("*").eq("rep_id", repId).eq("status", "active").order("created_at", { ascending: false }).limit(1);
    if (error) return setMissing(true);
    const f = ((data || []) as CoachFocus[])[0] ?? null;
    setActive(f);
    if (f) {
      const { count } = await supabase.from("coaching_focus_checks").select("call_id", { count: "exact", head: true }).eq("focus_id", f.id);
      setChecked(count ?? 0);
    }
    if (check?.focus_id) {
      const { data: c } = await supabase.from("coaching_focus").select("*").eq("id", check.focus_id).maybeSingle();
      setCheckedOf((c as CoachFocus | null) ?? null);
    }
  }, [supabase, repId, check?.focus_id]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!repId) return null;
  const p = cn.priority;
  const fromHere = active?.call_id === callId;

  async function start() {
    if (!orgId) return setMsg("Couldn't tell which organization this is. Reload and try again.");
    setBusy(true);
    setMsg("");
    if (active) await supabase.from("coaching_focus").update({ status: "replaced", finished_at: new Date().toISOString() }).eq("id", active.id);
    const { error } = await supabase.from("coaching_focus").insert({
      org_id: orgId,
      rep_id: repId,
      call_id: callId,
      skill: p.skill || null,
      title: p.title,
      next_call: p.next_call || null,
      drill: p.drill || null,
      check_for: p.check || null,
      shared: share,
    });
    setBusy(false);
    if (error) return setMsg(/coaching_focus/.test(error.message) ? "Run supabase/coaching_focus.sql in the Supabase SQL Editor first." : error.message);
    setForm(false);
    setMsg(`Tracking it: the rep's next ${FOCUS_CHECKS} calls that give a chance will be checked for it.`);
    await load();
  }

  async function update(patch: Partial<CoachFocus>, note: string) {
    if (!active) return;
    setBusy(true);
    const { error } = await supabase.from("coaching_focus").update(patch).eq("id", active.id);
    setBusy(false);
    setMsg(error ? error.message : note);
    await load();
  }

  return (
    <div className="no-print" style={{ marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
      {check?.chance && checkedOf && (
        <p style={{ margin: "0 0 8px" }}>
          <span className={`pill ${check.shown === "yes" ? "good" : check.shown === "partly" ? "fair" : "poor"}`}>{SHOWN_LABEL[check.shown as "yes" | "partly" | "no"]}</span>{" "}
          <span className="muted">Coaching check &mdash; {checkedOf.title}:</span> {check.note}
        </p>
      )}
      {missing ? (
        <small className="muted">Run supabase/coaching_focus.sql in the Supabase SQL Editor to turn on &ldquo;Coach this&rdquo;.</small>
      ) : fromHere ? (
        <div className="row" style={{ alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span className="pill good">Being tracked</span>
          <small className="muted">
            {checked} of {FOCUS_CHECKS} calls checked{active!.shared ? " · on the rep's home page" : " · managers only"}
          </small>
          {!active!.shared ? (
            <button className="link-btn" disabled={busy} onClick={() => update({ shared: true }, "Sent to the rep's home page.")}>
              Send it to the rep
            </button>
          ) : (
            <button className="link-btn" disabled={busy} onClick={() => update({ shared: false }, "Taken off the rep's home page.")}>
              Take it off the rep&rsquo;s page
            </button>
          )}
          <button className="link-btn" disabled={busy} onClick={() => update({ status: "stopped", finished_at: new Date().toISOString() }, "Stopped tracking it.")}>
            Stop tracking
          </button>
        </div>
      ) : !form ? (
        <div className="row" style={{ alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button className="primary" onClick={() => setForm(true)}>
            Coach this
          </button>
          <small className="muted">
            {active ? (
              <>
                Replaces the focus being tracked now: <Link href={active.call_id ? `/admin/calls/${active.call_id}` : "#"}>{active.title}</Link> ({checked} of {FOCUS_CHECKS} checked)
              </>
            ) : (
              <>After you&rsquo;ve coached it: the rep&rsquo;s next {FOCUS_CHECKS} calls that give a chance are checked for it.</>
            )}
          </small>
        </div>
      ) : (
        <div>
          <label className="row" style={{ gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} style={{ width: "auto" }} />
            <span>Also show it on the rep&rsquo;s home page (what to do on the next call, and the practice drill)</span>
          </label>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="primary" disabled={busy} onClick={start}>
              Start tracking
            </button>
            <button disabled={busy} onClick={() => setForm(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {msg && <small className="muted" style={{ display: "block", marginTop: 6 }}>{msg}</small>}
      {checkedOf?.status === "done" && checkedOf.result && check?.chance && (
        <small className="muted" style={{ display: "block", marginTop: 4 }}>
          That focus is finished: {FOCUS_RESULT_LABEL[checkedOf.result]}.
        </small>
      )}
    </div>
  );
}
