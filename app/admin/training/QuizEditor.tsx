"use client";

import { useEffect, useState } from "react";
import type { QuizQuestion } from "@/lib/training";
import { useHub } from "./shared";

/**
 * Questions for a knowledge check. Saved as a set: replacing the questions
 * replaces them all. Reps never receive the answers -- grading happens on
 * the server.
 */
export default function QuizEditor({ materialId }: { materialId: string }) {
  const { supabase, orgId } = useHub();
  const [qs, setQs] = useState<QuizQuestion[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    supabase
      .from("training_quiz_questions")
      .select("id, position, prompt, options, correct, explain")
      .eq("material_id", materialId)
      .order("position")
      .then(({ data }) => setQs((data || []) as QuizQuestion[]));
  }, [supabase, materialId]);

  if (!qs) return <p className="hint">Loading questions&hellip;</p>;

  const edit = (i: number, patch: Partial<QuizQuestion>) => {
    setQs(qs.map((q, n) => (n === i ? { ...q, ...patch } : q)));
    setDirty(true);
  };
  const add = () => {
    setQs([...qs, { position: qs.length + 1, prompt: "", options: ["", ""], correct: 0, explain: "" }]);
    setDirty(true);
  };

  async function save() {
    if (!qs) return;
    const clean = qs
      .map((q) => ({ ...q, prompt: q.prompt.trim(), options: q.options.map((o) => o.trim()).filter(Boolean) }))
      .filter((q) => q.prompt && q.options.length >= 2);
    const bad = clean.find((q) => q.correct >= q.options.length);
    if (bad) return setMsg(`Pick the right answer for "${bad.prompt.slice(0, 40)}".`);
    setSaving(true);
    setMsg("");
    const { error: delErr } = await supabase.from("training_quiz_questions").delete().eq("material_id", materialId);
    const { error } = delErr
      ? { error: delErr }
      : clean.length
        ? await supabase.from("training_quiz_questions").insert(
            clean.map((q, i) => ({
              org_id: orgId,
              material_id: materialId,
              position: i + 1,
              prompt: q.prompt,
              options: q.options,
              correct: q.correct,
              explain: q.explain?.trim() || null,
            }))
          )
        : { error: null };
    setSaving(false);
    if (error) return setMsg(error.message);
    setQs(clean.map((q, i) => ({ ...q, position: i + 1 })));
    setDirty(false);
    setMsg(`Saved ${clean.length} question${clean.length === 1 ? "" : "s"}.`);
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="label" style={{ margin: 0 }}>Questions ({qs.length})</div>
      {qs.map((q, i) => (
        <div key={i} className="card" style={{ padding: 12, display: "grid", gap: 8 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <b>{i + 1}.</b>
            <button
              className="link-btn danger"
              onClick={() => {
                setQs(qs.filter((_, n) => n !== i));
                setDirty(true);
              }}
            >
              Remove
            </button>
          </div>
          <textarea rows={2} value={q.prompt} onChange={(e) => edit(i, { prompt: e.target.value })} placeholder="Question" />
          {q.options.map((o, k) => (
            <label key={k} className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
              <input
                type="radio"
                name={`correct-${i}`}
                checked={q.correct === k}
                onChange={() => edit(i, { correct: k })}
                aria-label={`Answer ${k + 1} is correct`}
                style={{ width: "auto" }}
              />
              <input
                value={o}
                onChange={(e) => edit(i, { options: q.options.map((x, j) => (j === k ? e.target.value : x)) })}
                placeholder={`Answer ${k + 1}`}
                style={{ padding: "8px 10px", fontSize: 14 }}
              />
              {q.options.length > 2 && (
                <button
                  className="tr-icon"
                  aria-label="Remove answer"
                  onClick={() =>
                    edit(i, {
                      options: q.options.filter((_, j) => j !== k),
                      correct: q.correct === k ? 0 : q.correct > k ? q.correct - 1 : q.correct,
                    })
                  }
                >
                  &times;
                </button>
              )}
            </label>
          ))}
          {q.options.length < 5 && (
            <button className="tr-sm" style={{ justifySelf: "start" }} onClick={() => edit(i, { options: [...q.options, ""] })}>
              + Answer
            </button>
          )}
          <input value={q.explain ?? ""} onChange={(e) => edit(i, { explain: e.target.value })} placeholder="Why it's right (shown after they answer)" style={{ padding: "8px 10px", fontSize: 14 }} />
        </div>
      ))}
      <div className="row">
        <button className="tr-sm" onClick={add}>+ Question</button>
        <button className={`tr-sm ${dirty ? "primary" : ""}`} disabled={!dirty || saving} onClick={save}>
          {saving ? "Saving…" : "Save questions"}
        </button>
        {msg && <span className="hint" style={{ margin: 0 }}>{msg}</span>}
      </div>
      <p className="hint" style={{ margin: 0 }}>The selected circle is the right answer. Reps see the answers and explanations only after they submit.</p>
    </div>
  );
}
