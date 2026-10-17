"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Material } from "@/lib/training";

type Q = { id: string; qpos: number; prompt: string; options: string[] };
type Result = { id: string; chosen: number | null; correct: number; right: boolean; explain: string | null };
type Outcome = { score: number; passed: boolean; pass_pct: number; results: Result[] };

/** A knowledge check: answer, submit, see what was right and why. Graded on the server. */
export function QuizTaker({ supabase, m, onDone }: { supabase: SupabaseClient; m: Material; onDone: () => void }) {
  const [qs, setQs] = useState<Q[] | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [best, setBest] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    supabase.rpc("training_quiz_for", { p_material: m.id }).then(({ data, error }) => {
      if (error) setError(error.message);
      setQs((data || []) as Q[]);
    });
    supabase
      .from("training_quiz_attempts")
      .select("score")
      .eq("material_id", m.id)
      .order("score", { ascending: false })
      .limit(1)
      .then(({ data }) => setBest(data?.[0]?.score ?? null));
  }, [supabase, m.id]);

  async function submit() {
    setBusy(true);
    setError("");
    const { data, error } = await supabase.rpc("training_quiz_submit", { p_material: m.id, p_answers: answers });
    setBusy(false);
    if (error) return setError(error.message);
    const o = data as Outcome;
    setOutcome(o);
    setBest((b) => Math.max(b ?? 0, o.score));
    if (o.passed) onDone();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (!qs) return <p className="muted">Loading&hellip;</p>;
  if (!qs.length) return <p className="muted">This knowledge check has no questions yet.</p>;

  const byId = new Map(outcome?.results.map((r) => [r.id, r]) ?? []);
  const answered = Object.keys(answers).length;

  return (
    <div className="my-quiz">
      {outcome ? (
        <div className={`my-result ${outcome.passed ? "pass" : "fail"}`}>
          <b>{outcome.score}%</b>
          <span>
            {outcome.passed
              ? "Passed -- nice work."
              : `You need ${outcome.pass_pct}% to pass. See which ones you missed below, then try again.`}
          </span>
        </div>
      ) : (
        <p className="hint">
          {qs.length} questions · pass mark {m.pass_pct ?? 80}%{best !== null ? ` · your best so far ${best}%` : ""}
        </p>
      )}

      {qs.map((q, i) => {
        const r = byId.get(q.id);
        return (
          <fieldset key={q.id} className="my-q" disabled={!!outcome}>
            <legend>
              {i + 1}. {q.prompt}
            </legend>
            {q.options.map((o, k) => {
              // After a pass, show the right answers. After a fail, only mark
              // what they chose, so the retake still tests them.
              const cls = !r
                ? ""
                : outcome?.passed
                  ? k === r.correct ? "right" : k === r.chosen ? "wrong" : ""
                  : k === r.chosen ? (r.right ? "right" : "wrong") : "";
              return (
                <label key={k} className={`my-opt ${cls}`}>
                  <input type="radio" name={q.id} checked={answers[q.id] === k} onChange={() => setAnswers({ ...answers, [q.id]: k })} />
                  <span>{o}</span>
                </label>
              );
            })}
            {r && (outcome?.passed || r.right) && r.explain && <p className="my-explain">{r.right ? "✓ " : "✗ "}{r.explain}</p>}
            {r && !outcome?.passed && !r.right && <p className="my-explain">✗ Not quite -- think it through again on your retake.</p>}
          </fieldset>
        );
      })}

      {error && <div className="error">{error}</div>}
      {outcome ? (
        !outcome.passed && (
          <button
            className="primary"
            onClick={() => {
              setOutcome(null);
              setAnswers({});
            }}
          >
            Try again
          </button>
        )
      ) : (
        <button className="primary" disabled={busy || answered < qs.length} onClick={submit}>
          {busy ? "Checking…" : answered < qs.length ? `Answer all ${qs.length} to submit (${answered} done)` : "Submit"}
        </button>
      )}
    </div>
  );
}

/** A script section to practice in the karaoke trainer. */
export function ModuleStatus({ supabase, m, userId }: { supabase: SupabaseClient; m: Material; userId: string }) {
  const [info, setInfo] = useState<{ title: string; total: number; done: number } | null>(null);
  useEffect(() => {
    if (!m.module_id) return;
    void (async () => {
      const [{ data: mod }, { data: segs }] = await Promise.all([
        supabase.from("modules").select("title").eq("id", m.module_id).maybeSingle(),
        supabase.from("segments").select("id").eq("module_id", m.module_id).eq("active", true),
      ]);
      const ids = (segs || []).map((s) => s.id as string);
      const { data: prog } = ids.length
        ? await supabase.from("progress").select("segment_id").eq("user_id", userId).eq("completed", true).in("segment_id", ids)
        : { data: [] };
      setInfo({ title: (mod?.title as string) || "the section", total: ids.length, done: (prog || []).length });
    })();
  }, [supabase, m.module_id, userId]);

  if (!m.module_id) return <p className="muted">This assignment isn&rsquo;t linked to a script section yet.</p>;
  return (
    <div className="card">
      <p style={{ marginTop: 0 }}>
        Practice <b>{info?.title ?? "…"}</b> in the script trainer. It counts as done once you&rsquo;ve completed every line.
      </p>
      {info && (
        <>
          <div className="tr-progress" style={{ marginBottom: 6 }}>
            <i style={{ width: `${info.total ? (100 * info.done) / info.total : 0}%` }} />
          </div>
          <p className="hint">
            {info.done} of {info.total} lines done
          </p>
        </>
      )}
      <Link className="btn" href={`/train/${m.module_id}`} style={{ textDecoration: "none", display: "inline-block" }}>
        Practice it
      </Link>
    </div>
  );
}

/** A practice call with one of the mock clients. */
export function PracticeStatus({ supabase, m, userId }: { supabase: SupabaseClient; m: Material; userId: string }) {
  const [persona, setPersona] = useState<{ name: string; title: string } | null>(null);
  const [calls, setCalls] = useState<{ id: string; created_at: string; slp_score: number | null; status: string }[]>([]);
  useEffect(() => {
    if (!m.persona_id) return;
    supabase
      .from("roleplay_personas")
      .select("name, title")
      .eq("id", m.persona_id)
      .maybeSingle()
      .then(({ data }) => setPersona(data as { name: string; title: string } | null));
    supabase
      .from("calls")
      .select("id, created_at, slp_score, status")
      .eq("source", "roleplay")
      .eq("rep_id", userId)
      .eq("persona_id", m.persona_id)
      .order("created_at", { ascending: false })
      .limit(10)
      .then(({ data }) => setCalls((data || []) as typeof calls));
  }, [supabase, m.persona_id, userId]);

  if (!m.persona_id) return <p className="muted">This assignment isn&rsquo;t linked to a practice client yet.</p>;
  return (
    <div className="card">
      <p style={{ marginTop: 0 }}>
        Call <b>{persona ? `${persona.name} -- ${persona.title}` : "the practice client"}</b>.{" "}
        {m.min_score ? `It counts once a call scores ${m.min_score} or more on Straight Line.` : "Any graded call counts."}
      </p>
      {calls.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          {calls.map((c) => (
            <Link key={c.id} href={`/roleplay/${c.id}`} className="my-mat" style={{ gridTemplateColumns: "minmax(0,1fr) auto" }}>
              <span>{new Date(c.created_at).toLocaleDateString()}</span>
              <span className={`pill ${c.slp_score !== null && m.min_score && c.slp_score >= m.min_score ? "good" : ""}`}>
                {c.status === "graded" ? `SLP ${c.slp_score ?? "--"}` : c.status}
              </span>
            </Link>
          ))}
        </div>
      )}
      <Link className="btn" href="/roleplay" style={{ textDecoration: "none", display: "inline-block" }}>
        Go to practice calls
      </Link>
    </div>
  );
}
