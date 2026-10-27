"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { clock } from "@/lib/calls";
import { FOCUS_CHECKS, FOCUS_RESULT_LABEL, SHOWN_LABEL, type CoachFocus, type FocusCheck } from "@/lib/coachFocus";
import type { Ctx } from "./page";

/**
 * Coaching follow-through: every "Coach this" for this rep, and how each of
 * the next calls went on it. Managers only.
 */
export default function CoachFocusPanel({ ctx }: { ctx: Ctx }) {
  const { supabase, repId, repName } = ctx;
  const [list, setList] = useState<CoachFocus[] | null>(null);
  const [checks, setChecks] = useState<FocusCheck[]>([]);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("coaching_focus").select("*").eq("rep_id", repId).order("created_at", { ascending: false }).limit(8);
    if (error) return setList([]);
    const fs = (data || []) as CoachFocus[];
    setList(fs);
    if (fs.length) {
      const { data: c } = await supabase.from("coaching_focus_checks").select("*").in("focus_id", fs.map((f) => f.id)).order("call_date", { ascending: true });
      setChecks((c || []) as FocusCheck[]);
    }
  }, [supabase, repId]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!list || !list.length) return null;
  const first = repName.split(" ")[0];

  return (
    <section style={{ marginBottom: 18 }}>
      <h2 style={{ marginBottom: 4 }}>Coaching follow-through</h2>
      <p className="hint" style={{ marginTop: 0 }}>
        What you coached {first} on from a call&rsquo;s Coach Now card, and whether it showed up on the next {FOCUS_CHECKS} calls that gave a chance.
      </p>
      {list.map((f) => {
        const mine = checks.filter((c) => c.focus_id === f.id);
        return (
          <div key={f.id} className="card" style={{ margin: "0 0 10px" }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
              <b>{f.title}</b>
              <span className="row" style={{ gap: 6 }}>
                {f.status === "active" ? (
                  <span className="pill">
                    {mine.length} of {FOCUS_CHECKS} checked
                  </span>
                ) : f.status === "done" && f.result ? (
                  <span className={`pill ${f.result === "improved" ? "good" : f.result === "mixed" ? "fair" : "poor"}`}>{FOCUS_RESULT_LABEL[f.result]}</span>
                ) : (
                  <span className="pill">{f.status === "replaced" ? "replaced" : "stopped"}</span>
                )}
                {f.shared && f.status === "active" && <span className="pill">on {first}&rsquo;s home page</span>}
              </span>
            </div>
            <small className="muted">
              Started {new Date(f.created_at).toLocaleDateString()}
              {f.call_id ? (
                <>
                  {" "}
                  from <Link href={`/admin/calls/${f.call_id}`}>this call</Link>
                </>
              ) : null}
              {f.next_call ? ` · ${f.next_call}` : ""}
            </small>
            {mine.length > 0 && (
              <ul className="plain-list" style={{ margin: "8px 0 0" }}>
                {mine.map((c) => (
                  <li key={c.call_id}>
                    <span className={`pill ${c.shown === "yes" ? "good" : c.shown === "partly" ? "fair" : "poor"}`}>{SHOWN_LABEL[c.shown]}</span>{" "}
                    <Link href={`/admin/calls/${c.call_id}`}>{c.call_date ?? "call"}</Link>
                    {typeof c.at_secs === "number" ? <small className="muted"> at {clock(c.at_secs)}</small> : null} {c.note}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </section>
  );
}
