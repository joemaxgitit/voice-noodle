"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { okToSpend, usd, useEstimate } from "@/lib/spend";
import type { GradingRule } from "@/lib/gradingRules";

/**
 * The standing grading rules the app writes from every "Not right?" correction.
 * They rewrite themselves as corrections come in; a manager can delete one,
 * or add one by hand (kept unless a newer correction says otherwise).
 */
export default function GradingRules() {
  const supabase = useMemo(() => createClient(), []);
  const est = useEstimate(supabase, "rules");
  const [rules, setRules] = useState<GradingRule[]>([]);
  const [info, setInfo] = useState<{ updated_at: string | null; count: number; stale: boolean } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [add, setAdd] = useState("");

  const token = async () => (await supabase.auth.getSession()).data.session?.access_token ?? "";
  const load = useCallback(async () => {
    const r = await fetch("/api/calls/rules", { headers: { Authorization: `Bearer ${await token()}` } }).catch(() => null);
    const b = r ? await r.json().catch(() => ({})) : {};
    if (!r?.ok) return setError(b?.error || "Couldn't load the grading rules.");
    setError("");
    setRules((b.rules || []) as GradingRule[]);
    setInfo({ updated_at: b.updated_at, count: b.count, stale: b.stale });
    return b as { stale: boolean };
  }, [supabase]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void load();
  }, [load]);

  async function rewrite(force: boolean) {
    if (force && !(await okToSpend(supabase, est ?? 0.06, "Rewriting the grading rules"))) return;
    setBusy("Writing the rules from every correction…");
    const r = await fetch("/api/calls/rules", { method: "POST", headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" }, body: JSON.stringify({ force }) }).catch(() => null);
    const b = r ? await r.json().catch(() => ({})) : {};
    setBusy("");
    if (!r?.ok) return setError(b?.error || "Couldn't write the rules.");
    await load();
  }

  async function save(next: GradingRule[]) {
    setError("");
    const { data: me } = await supabase.auth.getSession();
    const { data: p } = await supabase.from("profiles").select("org_id").eq("id", me.session?.user.id ?? "").maybeSingle();
    const { error: e } = await supabase.from("grading_guidance").upsert({ org_id: p?.org_id, rules: next }, { onConflict: "org_id" });
    if (e) return setError(e.message);
    setRules(next);
  }

  return (
    <>
      <h2>Grading rules from your corrections</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Every &ldquo;Not right?&rdquo; you&rsquo;ve ever saved, boiled down to standing rules the grader follows on every call -- the same mistake corrected five times becomes one firm
        rule. New corrections are folded in once, just before the next call is graded (not after every correction), and apply to every call graded from then on -- calls already graded keep their grade.
        {info?.updated_at ? ` Last written ${new Date(info.updated_at).toLocaleString()} from ${info.count} correction${info.count === 1 ? "" : "s"}.` : ""}
        {info?.stale && !busy ? " New corrections since -- they'll be folded in before the next call is graded." : ""}
      </p>
      {error && <div className="error">{error}</div>}
      {busy && <p className="hint">{busy}</p>}
      {!rules.length && !busy && <p className="muted">No rules yet.</p>}
      <ol style={{ paddingLeft: 20 }}>
        {rules.map((r, i) => (
          <li key={i} style={{ marginBottom: 8 }}>
            {r.rule}{" "}
            <small className="muted">
              · {r.manual ? "added by hand" : `from ${r.count} correction${r.count === 1 ? "" : "s"}`}
              {r.why ? ` · ${r.why}` : ""}
            </small>{" "}
            <button className="link-btn danger" onClick={() => void save(rules.filter((_, k) => k !== i))}>
              Delete
            </button>
          </li>
        ))}
      </ol>
      <div className="row" style={{ gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
        <label className="field" style={{ margin: 0, flex: "1 1 320px" }}>
          <span>Add a rule by hand</span>
          <input value={add} onChange={(e) => setAdd(e.target.value)} placeholder="e.g. A booked time with both spouses is a strong next step, not a stall." />
        </label>
        <button
          disabled={!add.trim()}
          onClick={() => {
            void save([...rules, { rule: add.trim(), why: "", count: 0, manual: true }]);
            setAdd("");
          }}
        >
          Add rule
        </button>
      </div>
      <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <button disabled={!!busy} onClick={() => void rewrite(true)}>
          Rewrite from all corrections now{est !== null ? ` · about ${usd(est)}` : ""}
        </button>
      </div>
    </>
  );
}
