"use client";

import { useState } from "react";
import { EXPERIMENT_FAIR_TRY, FINGERPRINT_MIN, FINGERPRINT_SOLID, type Experiment } from "@/lib/fingerprint";
import { okToSpend } from "@/lib/spend";
import type { Ctx } from "./page";

/**
 * The rep's own style that works: what shows up in their calls whose
 * clients stuck (graduated or 6+ payments) and not in their cancels.
 * Only ever compared with their own calls. Managers only.
 */
export default function StyleTab({ ctx }: { ctx: Ctx }) {
  const { history: h, supabase, repId, repName, reload } = ctx;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const first = repName.split(" ")[0];

  const real = h.calls.filter((c) => c.source !== "roleplay" && c.status === "graded");
  const proven = real.filter((c) => c.retention === "graduated" || c.retention === "paid6").length;
  const cancelled = real.filter((c) => c.retention === "cancelled").length;
  const enough = proven >= FINGERPRINT_MIN.proven && cancelled >= FINGERPRINT_MIN.cancelled;
  const latest = h.fingerprints[0];
  const trying = h.experiments.filter((e) => e.status === "trying");
  const past = h.experiments.filter((e) => e.status !== "trying");

  async function settle(e: Experiment, status: "kept" | "dropped") {
    const { error } = await supabase.from("rep_experiments").update({ status, ended_at: new Date().toISOString() }).eq("id", e.id);
    if (error) return setError(error.message);
    await reload();
  }

  async function run() {
    if (!(await okToSpend(supabase, 0.15, "Finding this rep's style"))) return;
    setBusy(true);
    setError("");
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const res = await fetch("/api/reps/fingerprint", {
      method: "POST",
      headers: { Authorization: `Bearer ${session?.access_token ?? ""}`, "Content-Type": "application/json" },
      body: JSON.stringify({ repId }),
    }).catch(() => null);
    const b = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) return setError(b?.error || "Something went wrong.");
    await reload();
  }

  return (
    <div>
      <section className="card">
        <h3 className="rx-sec-title">{first}&rsquo;s style that works</h3>
        <p className="hint" style={{ marginTop: 0 }}>
          What shows up in {first}&rsquo;s calls whose clients stuck (graduated or made 6+ payments) and not in {first}&rsquo;s calls whose clients cancelled.
          Compared only with {first}&rsquo;s own calls -- never with other reps -- so it strengthens {first}&rsquo;s own way of selling. Each refresh also checks how
          {first}&rsquo;s experiments are going and, when there&rsquo;s room, suggests a team-proven pattern that fits {first}&rsquo;s style. The Straight Line
          grading stays the same for everyone. Managers only.
        </p>
        <p style={{ margin: "6px 0" }}>
          On record: <b>{proven}</b> proven sale{proven === 1 ? "" : "s"} and <b>{cancelled}</b> cancel{cancelled === 1 ? "" : "s"} with a graded enrollment
          call. Set a call&rsquo;s status on the call page (or when uploading).
        </p>
        {error && <div className="error">{error}</div>}
        {enough ? (
          <button className="primary" onClick={() => void run()} disabled={busy}>
            {busy ? "Reading their calls…" : `${latest ? "Refresh" : "Find"} ${first}'s style · about $0.15`}
          </button>
        ) : (
          <p className="hint">
            Needs at least {FINGERPRINT_MIN.proven} proven sales and {FINGERPRINT_MIN.cancelled} cancels to start; it gets dependable around{" "}
            {FINGERPRINT_SOLID.proven} and {FINGERPRINT_SOLID.cancelled}.
          </p>
        )}
      </section>

      {latest && (
        <section className="card" style={{ marginTop: 14 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <small className="muted">
              {new Date(latest.created_at).toLocaleDateString()} · from {latest.inputs.proven ?? "?"} proven and {latest.inputs.cancelled ?? "?"} cancelled
            </small>
            {((latest.inputs.proven ?? 0) < FINGERPRINT_SOLID.proven || (latest.inputs.cancelled ?? 0) < FINGERPRINT_SOLID.cancelled) && (
              <span className="pill fair">Early pattern</span>
            )}
          </div>
          <p style={{ fontWeight: 600, lineHeight: 1.5 }}>{latest.body.summary}</p>

          <h3 className="rx-sec-title">Keep doing -- what works for {first}</h3>
          {latest.body.markers.map((m, i) => (
            <div key={i} style={{ marginBottom: 12 }}>
              <b>{m.marker}</b>{" "}
              <small className="muted">
                · in {m.in_proven} of {latest.inputs.proven} proven, {m.in_cancels} of {latest.inputs.cancelled} cancels
              </small>
              <div>{m.how_it_sounds}</div>
              <small className="muted">{m.evidence}</small>
            </div>
          ))}

          <h3 className="rx-sec-title">Trying now</h3>
          {trying.length === 0 ? (
            <p className="hint" style={{ marginTop: 0 }}>
              Nothing right now. Each refresh can suggest a team-proven pattern that fits {first}&rsquo;s style, once there are team patterns (Insights &amp;
              tuning).
            </p>
          ) : (
            trying.map((e) => (
              <div key={e.id} className="card" style={{ marginBottom: 10, background: "var(--ink-3)" }}>
                <b>{e.pattern}</b> <small className="muted">· since {new Date(e.started_at).toLocaleDateString()}</small>
                {e.why_fits && <div className="hint" style={{ margin: "2px 0" }}>{e.why_fits}</div>}
                {e.how_to_try && <div>{e.how_to_try}</div>}
                {e.last_check && (
                  <small className="muted">
                    Showing up in {e.last_check.showing_in} of {e.last_check.of} calls since · {e.last_check.effect.replace("_", " ")}
                    {e.last_check.of < EXPERIMENT_FAIR_TRY ? ` · judged after ${EXPERIMENT_FAIR_TRY} calls` : ""} -- {e.last_check.note}
                  </small>
                )}
                <div className="row" style={{ marginTop: 6 }}>
                  <button className="tr-sm" onClick={() => void settle(e, "kept")}>
                    It&rsquo;s working -- keep it
                  </button>
                  <button className="tr-sm" onClick={() => void settle(e, "dropped")}>
                    Drop it
                  </button>
                </div>
              </div>
            ))
          )}
          {past.length > 0 && (
            <details style={{ marginBottom: 10 }}>
              <summary className="hint" style={{ cursor: "pointer" }}>Earlier experiments ({past.length})</summary>
              {past.map((e) => (
                <p key={e.id} style={{ margin: "4px 0" }}>
                  <span className={`pill ${e.status === "kept" ? "good" : ""}`}>{e.status}</span> {e.pattern}
                  {e.last_check?.note ? <small className="muted"> -- {e.last_check.note}</small> : null}
                </p>
              ))}
            </details>
          )}

          {latest.body.watch_outs.length > 0 && (
            <>
              <h3 className="rx-sec-title" style={{ color: "var(--bad)" }}>
                {first}&rsquo;s own cancel pattern
              </h3>
              {latest.body.watch_outs.map((m, i) => (
                <div key={i} style={{ marginBottom: 10 }}>
                  <b>{m.marker}</b>{" "}
                  <small className="muted">
                    · in {m.in_cancels} of {latest.inputs.cancelled} cancels, {m.in_proven} of {latest.inputs.proven} proven
                  </small>
                  <div className="hint" style={{ margin: 0 }}>{m.evidence}</div>
                </div>
              ))}
            </>
          )}

          <h3 className="rx-sec-title">Still universal</h3>
          <p style={{ marginTop: 0 }}>{latest.body.keep_universal}</p>
          <h3 className="rx-sec-title">Practice focus</h3>
          <p style={{ marginTop: 0 }}>{latest.body.practice_focus}</p>
        </section>
      )}
    </div>
  );
}
