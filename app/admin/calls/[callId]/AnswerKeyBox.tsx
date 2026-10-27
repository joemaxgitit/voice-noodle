"use client";

import { useEffect, useState } from "react";
import type { createClient } from "@/lib/supabase/client";
import { ENDED_LABEL, OUTCOME_LABEL, ROADMAP, type Ended, type Outcome } from "@/lib/calls";
import { keyIsUsable, type BenchKey } from "@/lib/benchmark";
import { useMode } from "@/lib/superMode";

/*
  The super admin's own grade of this call, for the answer key. Filled once,
  from a fresh listen; every grader version and every new set of standing
  rules is then tested against it. Only the super admin sees this box.
*/
export default function AnswerKeyBox({
  supabase,
  callId,
  orgId,
  enrolled,
}: {
  supabase: ReturnType<typeof createClient>;
  callId: string;
  orgId: string | null;
  enrolled: boolean;
}) {
  const mode = useMode();
  const [k, setK] = useState<BenchKey>({});
  const [saved, setSaved] = useState<BenchKey | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!mode.superAdmin) return;
    void supabase
      .from("grading_benchmark")
      .select("key")
      .eq("call_id", callId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) return setMissing(true);
        const key = (data as { key: BenchKey } | null)?.key ?? null;
        setSaved(key);
        if (key) setK(key);
      });
  }, [supabase, callId, mode.superAdmin]);

  if (!mode.superAdmin) return null;

  const set = <F extends keyof BenchKey>(f: F, v: BenchKey[F] | "" | undefined) =>
    setK((x) => {
      const n = { ...x };
      if (v === "" || v === undefined || (typeof v === "number" && !isFinite(v))) delete n[f];
      else n[f] = v as BenchKey[F];
      return n;
    });
  const num = (v: string, lo: number, hi: number) => (v.trim() === "" ? undefined : Math.max(lo, Math.min(hi, Math.round(Number(v)))));

  async function save() {
    if (!orgId) return setMsg("Couldn't tell which organization this is. Reload and try again.");
    if (!keyIsUsable(k)) return setMsg("Answer at least one question first.");
    setBusy(true);
    setMsg("");
    const { error } = await supabase
      .from("grading_benchmark")
      .upsert({ call_id: callId, org_id: orgId, key: k, updated_at: new Date().toISOString() }, { onConflict: "call_id" });
    setBusy(false);
    if (error) return setMsg(/grading_benchmark/.test(error.message) ? "Run supabase/grading_benchmark.sql in the Supabase SQL Editor first." : error.message);
    setSaved(k);
    setOpen(false);
    setMsg("Saved to the answer key.");
  }

  async function remove() {
    setBusy(true);
    const { error } = await supabase.from("grading_benchmark").delete().eq("call_id", callId);
    setBusy(false);
    if (error) return setMsg(error.message);
    setSaved(null);
    setK({});
    setOpen(false);
    setMsg("Taken out of the answer key.");
  }

  const tens = ["product", "rep", "company"] as const;

  return (
    <section className="card no-print" style={{ marginTop: 16 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <b>Answer key</b>
        <span>
          {saved && <span className="pill good">in the answer key</span>}{" "}
          {!open && (
            <button onClick={() => setOpen(true)} disabled={missing}>
              {saved ? "Edit my answers" : "Add to the answer key"}
            </button>
          )}
        </span>
      </div>
      {missing && <p className="hint">Run supabase/grading_benchmark.sql in the Supabase SQL Editor to turn this on.</p>}
      {!open && !missing && (
        <p className="hint" style={{ marginBottom: 0 }}>
          Your own grade of this call, from a fresh listen. Every new grader version and every new set of grading rules is tested against the calls in the answer key.
        </p>
      )}
      {open && (
        <div style={{ marginTop: 10 }}>
          <p className="hint" style={{ marginTop: 0 }}>Answer what you&rsquo;re sure of and leave the rest blank &mdash; only what you answer is compared. Go by what you heard, not by the grade above.</p>
          <div className="retention-fields">
            <label className="field">
              <span>Outcome</span>
              <select value={k.outcome ?? ""} onChange={(e) => set("outcome", e.target.value as Outcome)}>
                <option value="">--</option>
                {(Object.keys(OUTCOME_LABEL) as Outcome[]).map((o) => (
                  <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Why it ended</span>
              <select value={k.ended_why ?? ""} onChange={(e) => set("ended_why", e.target.value as Ended["why"])}>
                <option value="">--</option>
                {(Object.keys(ENDED_LABEL) as Ended["why"][]).map((o) => (
                  <option key={o} value={o}>{ENDED_LABEL[o]}</option>
                ))}
              </select>
            </label>
            {enrolled && (
              <label className="field">
                <span>Close quality</span>
                <select value={k.close_quality ?? ""} onChange={(e) => set("close_quality", e.target.value as BenchKey["close_quality"])}>
                  <option value="">--</option>
                  <option value="solid">Solid</option>
                  <option value="ok">Normal</option>
                  <option value="fragile">Fragile</option>
                </select>
              </label>
            )}
            <label className="field">
              <span>Where the roadmap first broke</span>
              <select value={k.arc_break ?? ""} onChange={(e) => set("arc_break", e.target.value)}>
                <option value="">--</option>
                <option value="none">It didn&rsquo;t</option>
                {ROADMAP.map((r) => (
                  <option key={r.stage} value={r.stage}>{r.label}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Dug into the hardship enough?</span>
              <select value={k.hardship ?? ""} onChange={(e) => set("hardship", e.target.value as BenchKey["hardship"])}>
                <option value="">--</option>
                <option value="yes">Yes</option>
                <option value="partly">Partly</option>
                <option value="no">No</option>
              </select>
            </label>
            {tens.map((t) => (
              <label key={t} className="field">
                <span>{t === "rep" ? "Rep" : t === "product" ? "Product" : "Company"} certainty (1&ndash;10, 0 = not reached)</span>
                <input type="number" min={0} max={10} value={k[t] ?? ""} onChange={(e) => set(t, num(e.target.value, 0, 10))} />
              </label>
            ))}
            <label className="field">
              <span>Script score, your gut (0&ndash;100)</span>
              <input type="number" min={0} max={100} value={k.script ?? ""} onChange={(e) => set("script", num(e.target.value, 0, 100))} />
            </label>
            <label className="field">
              <span>Straight Line score, your gut (0&ndash;100)</span>
              <input type="number" min={0} max={100} value={k.slp ?? ""} onChange={(e) => set("slp", num(e.target.value, 0, 100))} />
            </label>
            <label className="field wide">
              <span>The one thing you&rsquo;d coach first</span>
              <textarea rows={2} value={k.coach_first ?? ""} onChange={(e) => set("coach_first", e.target.value)} placeholder="e.g. Dig past the first 'no hardship' instead of filling the time with his own stories" />
            </label>
            <label className="field wide">
              <span>Notes (optional, not compared)</span>
              <input value={k.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
            </label>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="primary" disabled={busy} onClick={save}>
              Save my answers
            </button>
            <button disabled={busy} onClick={() => { setOpen(false); setK(saved ?? {}); }}>
              Cancel
            </button>
            {saved && (
              <button className="link-btn" disabled={busy} onClick={remove}>
                Take it out of the answer key
              </button>
            )}
          </div>
        </div>
      )}
      {msg && <p className="hint" style={{ marginBottom: 0 }}>{msg}</p>}
    </section>
  );
}
