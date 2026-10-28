"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { okToSpend, usd, useEstimate } from "@/lib/spend";
import { useMode } from "@/lib/superMode";
import { BENCH_MIN, BENCH_TOLERANCE, rulesHash, type BenchItem, type BenchKey } from "@/lib/benchmark";
import type { GradingRule } from "@/lib/gradingRules";

/*
  The answer key: the calls the super admin graded by hand, every test of the
  grader against them, new standing rules waiting on a test, and every earlier
  set of rules (with a rollback). Super admin only.
*/

type Keyed = { call_id: string; key: BenchKey; updated_at: string; call?: { client_label: string | null; call_date: string | null; rep_name: string | null; profiles: { full_name: string | null } | null } | null };
type Run = {
  id: string;
  purpose: string;
  grader_version: number;
  rules: GradingRule[] | null;
  rules_hash: string;
  status: string;
  expected: number;
  agreement: number | null;
  breakdown: Record<string, { label: string; agree: number; n: number }> | null;
  verdict: string | null;
  usd: number | null;
  created_at: string;
};
type Result = { call_id: string; agreement: number | null; items: BenchItem[] | null; error: string | null };
type Guidance = { rules: GradingRule[] | null; rules_pending: GradingRule[] | null; rules_pending_at: string | null; rules_history: { rules: GradingRule[]; until: string; why: string }[] | null };

const PURPOSE: Record<string, string> = { manual: "Run by hand", version: "New grader version", rules: "New grading rules", baseline: "Current rules (for comparison)" };
const VERDICT: Record<string, string> = { promoted: "went live", held: "held for your approval", approved: "approved", rejected: "rejected" };
const day = (iso: string) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const band = (n: number | null) => (n === null ? "" : n >= 80 ? "good" : n >= 60 ? "fair" : "poor");

export default function AnswerKey() {
  const supabase = useMemo(() => createClient(), []);
  const mode = useMode();
  const est = useEstimate(supabase, "benchmark");
  const [keyed, setKeyed] = useState<Keyed[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [g, setG] = useState<Guidance | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const token = async () => (await supabase.auth.getSession()).data.session?.access_token ?? "";
  const post = async (body: object) => {
    const r = await fetch("/api/calls/answer-key", { method: "POST", headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const b = r ? await r.json().catch(() => ({})) : {};
    return { ok: !!r?.ok, ...b } as { ok: boolean; error?: string; what?: string };
  };

  const load = useCallback(async () => {
    const [k, r, gd] = await Promise.all([
      supabase.from("grading_benchmark").select("call_id, key, updated_at, call:calls(client_label, call_date, rep_name, profiles:rep_id(full_name))").order("updated_at", { ascending: false }),
      supabase.from("grading_benchmark_runs").select("*").order("created_at", { ascending: false }).limit(30),
      supabase.from("grading_guidance").select("rules, rules_pending, rules_pending_at, rules_history").maybeSingle(),
    ]);
    if (k.error || r.error || gd.error) return setError(/grading_benchmark|rules_pending|rules_history/.test((k.error || r.error || gd.error)!.message) ? "Run supabase/grading_benchmark.sql in the Supabase SQL Editor first." : (k.error || r.error || gd.error)!.message);
    setError("");
    setKeyed((k.data || []) as unknown as Keyed[]);
    setRuns((r.data || []) as Run[]);
    setG((gd.data as Guidance | null) ?? { rules: null, rules_pending: null, rules_pending_at: null, rules_history: null });
  }, [supabase]);

  useEffect(() => {
    void (async () => {
      await load();
      // Start whatever test is due (a new grader version, or new rules waiting), then show it.
      const a = await post({ action: "auto" });
      if (a.what?.startsWith("started")) await load();
    })();
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  // While a test is running, check back every 20 seconds.
  const running = runs.some((r) => r.status === "running" || r.status === "finishing");
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void load(), 20_000);
    return () => clearInterval(t);
  }, [running, load]);

  useEffect(() => {
    if (!open) return setResults([]);
    void supabase
      .from("grading_benchmark_results")
      .select("call_id, agreement, items, error")
      .eq("run_id", open)
      .then(({ data }) => setResults((data || []) as Result[]));
  }, [supabase, open, runs]);

  if (mode.loaded && !mode.superAdmin) {
    return (
      <div>
        <h2>Answer key</h2>
        <p className="muted">Only the super admin can see the answer key.</p>
      </div>
    );
  }

  const name = (id: string) => {
    const c = keyed.find((x) => x.call_id === id)?.call;
    return c ? `${c.profiles?.full_name || c.rep_name || "Rep"} · ${c.call_date ?? ""}${c.client_label ? ` · ${c.client_label}` : ""}` : "A call";
  };
  const estimate = (est ?? 0.09) * keyed.length;
  const active = g?.rules ?? [];
  const pending = g?.rules_pending ?? null;
  const candRun = pending ? runs.find((r) => r.purpose === "rules" && r.rules_hash === rulesHash(pending)) : undefined;
  // The newest test of the current rules (the server only compares tests on the same grader version).
  const baseRun = runs.find((r) => r.purpose !== "rules" && r.rules_hash === rulesHash(active));
  const version = runs[0]?.grader_version;
  const latest = runs.find((r) => r.status === "done");

  async function act(body: object, label: string, cost?: number) {
    if (cost && !(await okToSpend(supabase, cost, label))) return;
    setBusy(label);
    const b = await post(body);
    setBusy("");
    if (!b.ok) setError(b.error || "That didn't work.");
    await load();
  }

  return (
    <div>
      <div className="eyebrow">
        {keyed.length} call{keyed.length === 1 ? "" : "s"} in the key{version ? ` · grader v${version}` : ""}
        {latest?.agreement != null ? ` · latest agreement ${latest.agreement}%` : ""}
      </div>
      <h2>Answer key</h2>
      <p className="muted">
        Calls you graded by hand. Every new grader version and every new set of grading rules is tested against them: the grader re-grades each call
        (never saved onto the call) and its answers are compared with yours. New rules from corrections go live by themselves unless they agree with you
        more than {BENCH_TOLERANCE} points less often than the rules they&rsquo;d replace &mdash; then they wait here for you. Tests start by themselves once
        there are {BENCH_MIN} calls in the key.
      </p>
      {error && <div className="error">{error}</div>}
      {busy && <div className="note">{busy}&hellip;</div>}

      {pending && (
        <section className="card" style={{ marginTop: 16, borderColor: "var(--live)" }}>
          <b>New grading rules waiting</b>{" "}
          <small className="muted">written {g?.rules_pending_at ? day(g.rules_pending_at) : ""} from your corrections</small>
          <p style={{ margin: "8px 0" }}>
            {!candRun || candRun.status === "running" || candRun.status === "finishing" || !baseRun || baseRun.status !== "done" ? (
              keyed.length < BENCH_MIN ? (
                <>Not tested yet &mdash; the answer key needs {BENCH_MIN} calls.</>
              ) : (
                <>Being tested against the answer key&hellip;</>
              )
            ) : (
              <>
                New rules agree with you <b className={band(candRun.agreement)}>{candRun.agreement}%</b> of the time; the current rules{" "}
                <b className={band(baseRun.agreement)}>{baseRun.agreement}%</b>.{" "}
                {candRun.verdict ? <span className="pill">{VERDICT[candRun.verdict] ?? candRun.verdict}</span> : null}
              </>
            )}
          </p>
          <div className="rx-grid2">
            <div>
              <small className="muted">New rules ({pending.length})</small>
              <ol className="plain-list" style={{ fontSize: 14 }}>
                {pending.map((r, i) => (
                  <li key={i}>{r.rule}</li>
                ))}
              </ol>
            </div>
            <div>
              <small className="muted">Current rules ({active.length})</small>
              <ol className="plain-list" style={{ fontSize: 14 }}>
                {active.map((r, i) => (
                  <li key={i} className={pending.some((p) => p.rule === r.rule) ? "" : "muted"}>{r.rule}</li>
                ))}
              </ol>
            </div>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="primary" disabled={!!busy} onClick={() => act({ action: "approve" }, "Putting the new rules live")}>
              Use the new rules
            </button>
            <button disabled={!!busy} onClick={() => act({ action: "reject" }, "Throwing the new rules away")}>
              Keep the current rules
            </button>
          </div>
        </section>
      )}

      <div className="row" style={{ marginTop: 18, alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>Tests</h2>
        <button disabled={!!busy || running || keyed.length === 0} onClick={() => act({ action: "run" }, "Testing the grader against the answer key", estimate)}>
          {running ? "A test is running…" : `Test the grader now${keyed.length ? ` · about ${usd(estimate)}` : ""}`}
        </button>
      </div>
      {runs.length === 0 ? (
        <p className="hint">No tests yet.</p>
      ) : (
        <table className="rx-table" style={{ marginTop: 8 }}>
          <thead>
            <tr>
              <th>When</th>
              <th>Why</th>
              <th>Grader</th>
              <th>Agreement</th>
              <th>Cost</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td>{day(r.created_at)}</td>
                <td>
                  {PURPOSE[r.purpose] ?? r.purpose}
                  {r.verdict ? <small className="muted"> &middot; {VERDICT[r.verdict] ?? r.verdict}</small> : null}
                </td>
                <td>v{r.grader_version} &middot; {(r.rules ?? []).length} rules</td>
                <td>
                  {r.status === "done" ? (
                    <span className={`pill ${band(r.agreement)}`}>{r.agreement ?? "--"}%</span>
                  ) : r.status === "failed" ? (
                    <span className="pill poor">failed</span>
                  ) : (
                    <span className="muted">running ({r.expected} calls)</span>
                  )}
                </td>
                <td>{r.usd ? usd(r.usd) : ""}</td>
                <td>
                  <button className="link-btn" onClick={() => setOpen(open === r.id ? null : r.id)}>
                    {open === r.id ? "Hide" : "Details"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {open && (() => {
        const r = runs.find((x) => x.id === open);
        if (!r) return null;
        return (
          <section className="card" style={{ marginTop: 12 }}>
            <b>{PURPOSE[r.purpose] ?? r.purpose}, {day(r.created_at)}</b>
            {r.breakdown && (
              <div style={{ marginTop: 8 }}>
                {Object.entries(r.breakdown)
                  .sort((a, b) => a[1].agree - b[1].agree)
                  .map(([k, b]) => (
                    <div className="rx-skill" key={k}>
                      <span>{b.label}</span>
                      <span className="bar">
                        <i style={{ width: `${b.agree}%` }} />
                      </span>
                      <span className="delta">
                        {b.agree}% <small className="muted">({b.n})</small>
                      </span>
                    </div>
                  ))}
                <small className="muted">Weakest first: these are where the grader disagrees with you most.</small>
              </div>
            )}
            {results.map((x) => (
              <div key={x.call_id} className="grade-item" style={{ marginTop: 10 }}>
                <div className="grade-item-head">
                  <Link href={`/admin/calls/${x.call_id}`}>{name(x.call_id)}</Link>
                  {x.error ? <span className="pill poor">couldn&rsquo;t grade</span> : <span className={`pill ${band(x.agreement)}`}>{x.agreement ?? "--"}%</span>}
                </div>
                {x.error && <div className="grade-coach">{x.error}</div>}
                {(x.items ?? [])
                  .filter((it) => it.score < 1)
                  .map((it, i) => (
                    <div key={i} className="grade-coach">
                      <b>{it.label}:</b> you said &ldquo;{it.key}&rdquo;, the grader said &ldquo;{it.grader}&rdquo;
                      {it.score === 0.5 ? <small className="muted"> (close)</small> : null}
                    </div>
                  ))}
                {!x.error && (x.items ?? []).every((it) => it.score === 1) && <div className="grade-coach muted">Agreed on everything you answered.</div>}
              </div>
            ))}
          </section>
        );
      })()}

      <h2>Calls in the key</h2>
      {keyed.length === 0 ? (
        <p className="hint">
          None yet. Open any graded call and use &ldquo;Add to the answer key&rdquo; near the bottom. A good set: about 15 calls &mdash; enrolled, fragile closes, lost
          calls, a renew, a Spanish call, a short follow-up, and calls you think the grader got wrong (Arturo&rsquo;s Oct 26 call is a good first one).
        </p>
      ) : (
        <ul className="plain-list">
          {keyed.map((k) => (
            <li key={k.call_id}>
              <Link href={`/admin/calls/${k.call_id}`}>{name(k.call_id)}</Link>{" "}
              <small className="muted">
                &middot; {Object.keys(k.key).filter((f) => f !== "notes").length} answers &middot; saved {day(k.updated_at)}
              </small>
            </li>
          ))}
        </ul>
      )}

      {(g?.rules_history?.length ?? 0) > 0 && (
        <>
          <h2>Earlier grading rules</h2>
          <p className="muted" style={{ marginTop: 0 }}>Every set of rules that was replaced, newest first. Rolling back puts that set live again (and keeps the current one here).</p>
          {g!.rules_history!.map((h, i) => (
            <details key={i} className="fold">
              <summary>
                <span className="fold-title">
                  {h.rules.length} rules, until {day(h.until)}
                </span>
                <span className="fold-preview">{h.why}</span>
              </summary>
              <div className="fold-body">
                <ol className="plain-list" style={{ fontSize: 14 }}>
                  {h.rules.map((r, j) => (
                    <li key={j}>{r.rule}</li>
                  ))}
                </ol>
                <button disabled={!!busy} onClick={() => act({ action: "rollback", index: i }, "Rolling the rules back")}>
                  Roll back to these rules
                </button>
              </div>
            </details>
          ))}
        </>
      )}
    </div>
  );
}
