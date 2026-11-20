"use client";

import { useEffect, useState } from "react";
import type { createClient } from "@/lib/supabase/client";
import type { Grade } from "@/lib/calls";
import type { FeedbackContent } from "@/lib/repFeedback";

/*
  Send this call's feedback to the rep. The grade is AI, so nothing reaches a
  rep until a manager has read it, edited it and pressed Send -- and what the
  rep gets is a copy of exactly that (a re-grade later never changes it). The
  rep never sees the call, its grade or its transcript.
*/

type Sent = { id: string; created_at: string; sent_by_name: string | null; seen_at: string | null; content: FeedbackContent };

const plain = (x: unknown): string => {
  if (x == null) return "";
  if (typeof x === "string") return x;
  const o = x as Record<string, unknown>;
  return typeof o.text === "string" ? o.text : typeof o.title === "string" ? o.title : "";
};

export default function SendToRep({
  supabase,
  call,
  grade,
  repFirst,
  scriptTitle,
}: {
  supabase: ReturnType<typeof createClient>;
  call: { id: string; rep_id: string | null; call_date: string | null; created_at: string; score: number | null };
  grade: Grade;
  repFirst: string;
  scriptTitle: string | null;
}) {
  const [sent, setSent] = useState<Sent[]>([]);
  const [setup, setSetup] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const cn = grade.coach_now;
  const points = [cn?.priority, cn?.second].filter(Boolean) as NonNullable<typeof cn>["priority"][];
  const [pick, setPick] = useState(0);
  const [note, setNote] = useState("");
  const [didWell, setDidWell] = useState("");
  const [work, setWork] = useState({ title: "", what_happened: "", next_call: "", practice: "" });
  const [withScore, setWithScore] = useState(false);

  const load = async () => {
    const { data, error } = await supabase.from("rep_feedback").select("id, created_at, sent_by_name, seen_at, content").eq("call_id", call.id).order("created_at", { ascending: false });
    if (error) return setSetup(/rep_feedback/.test(error.message) ? "Run supabase/rep-feedback.sql in the Supabase SQL Editor first." : error.message);
    setSetup("");
    setSent((data || []) as Sent[]);
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call.id]);

  const fill = (i: number) => {
    const p = points[i];
    setPick(i);
    setWork(p ? { title: p.title, what_happened: p.observed, next_call: p.next_call, practice: p.drill } : { title: "", what_happened: "", next_call: "", practice: "" });
  };
  const start = () => {
    setNote("");
    const well = (cn?.strengths?.length ? cn.strengths.map((s) => s.text) : (grade.strengths ?? []).map(plain)).filter(Boolean);
    setDidWell(well.join("\n"));
    fill(0);
    setWithScore(false);
    setMsg("");
    setOpen(true);
  };

  const send = async () => {
    if (!call.rep_id) return;
    const content: FeedbackContent = {
      note: note.trim() || undefined,
      did_well: didWell.split("\n").map((s) => s.trim()).filter(Boolean),
      work_on: work.title.trim() ? { title: work.title.trim(), what_happened: work.what_happened.trim(), next_call: work.next_call.trim(), practice: work.practice.trim() } : null,
      score: withScore && typeof call.score === "number" ? call.score : null,
    };
    if (!content.note && !content.did_well.length && !content.work_on) return setMsg("Nothing to send yet.");
    setBusy(true);
    setMsg("");
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const uid = session?.user.id;
    const { data: me } = await supabase.from("profiles").select("org_id, full_name").eq("id", uid ?? "").maybeSingle();
    const { error } = await supabase.from("rep_feedback").insert({
      org_id: (me as { org_id?: string } | null)?.org_id,
      rep_id: call.rep_id,
      call_id: call.id,
      sent_by: uid,
      sent_by_name: (me as { full_name?: string } | null)?.full_name ?? null,
      call_date: call.call_date || call.created_at.slice(0, 10),
      script_title: scriptTitle,
      content,
    });
    setBusy(false);
    if (error) return setMsg(error.message);
    setOpen(false);
    setMsg(`Sent to ${repFirst}.`);
    void load();
  };

  const takeBack = async (id: string) => {
    const { error } = await supabase.from("rep_feedback").delete().eq("id", id);
    if (error) return setMsg(error.message);
    void load();
  };

  const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  return (
    <section className="card" style={{ marginTop: 18 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <b>Send feedback to {repFirst}</b>
        {!open && call.rep_id && !setup && (
          <button className="btn primary" onClick={start}>
            {sent.length ? "Send more" : `Review and send to ${repFirst}`}
          </button>
        )}
      </div>
      <p className="muted" style={{ margin: "6px 0 0", fontSize: 14 }}>
        Reps never see a call&rsquo;s grade. They only see what you review here and send &mdash; a copy of exactly what you sent, on their My feedback page.
      </p>
      {setup && <div className="error">{setup}</div>}
      {!call.rep_id && (
        <p className="muted" style={{ margin: "6px 0 0" }}>
          This call isn&rsquo;t linked to a rep&rsquo;s account. Pick the rep under Settings below first.
        </p>
      )}

      {sent.map((s) => (
        <div key={s.id} className="row" style={{ marginTop: 8, gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span className="pill good">Sent {day(s.created_at)}</span>
          {s.sent_by_name && <small className="muted">by {s.sent_by_name}</small>}
          <small className="muted">{s.seen_at ? `· seen ${day(s.seen_at)}` : "· not opened yet"}</small>
          {s.content.work_on && <small>· Work on: {s.content.work_on.title}</small>}
          <button className="link-btn" onClick={() => takeBack(s.id)}>
            Take it back
          </button>
        </div>
      ))}

      {open && (
        <div className="retention-fields" style={{ marginTop: 12 }}>
          <div className="error" style={{ gridColumn: "1 / -1", background: "transparent" }}>
            {repFirst} will see exactly what&rsquo;s below. Read it first: fix anything the AI got wrong.
          </div>
          <label className="field wide">
            <span>A note from you (optional)</span>
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Great energy on this one. Let's go over the read-backs at 2pm." />
          </label>
          <label className="field wide">
            <span>Did well (one per line)</span>
            <textarea rows={4} value={didWell} onChange={(e) => setDidWell(e.target.value)} />
          </label>
          {points.length > 1 && (
            <label className="field wide">
              <span>Work on</span>
              <select value={pick} onChange={(e) => fill(Number(e.target.value))}>
                {points.map((p, i) => (
                  <option key={i} value={i}>
                    {p.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field wide">
            <span>Work on: in a few words (leave blank to leave it out)</span>
            <input value={work.title} onChange={(e) => setWork({ ...work, title: e.target.value })} />
          </label>
          <label className="field wide">
            <span>What happened</span>
            <textarea rows={3} value={work.what_happened} onChange={(e) => setWork({ ...work, what_happened: e.target.value })} />
          </label>
          <label className="field wide">
            <span>On the next call</span>
            <textarea rows={2} value={work.next_call} onChange={(e) => setWork({ ...work, next_call: e.target.value })} />
          </label>
          <label className="field wide">
            <span>Practice</span>
            <textarea rows={2} value={work.practice} onChange={(e) => setWork({ ...work, practice: e.target.value })} />
          </label>
          {typeof call.score === "number" && (
            <label className="row" style={{ gap: 8, gridColumn: "1 / -1" }}>
              <input type="checkbox" checked={withScore} onChange={(e) => setWithScore(e.target.checked)} />
              <span>Include the score ({call.score})</span>
            </label>
          )}
          <div className="row" style={{ gap: 8, gridColumn: "1 / -1" }}>
            <button className="btn primary" disabled={busy} onClick={send}>
              {busy ? "Sending…" : `Send to ${repFirst}`}
            </button>
            <button className="btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {msg && <p className="muted" style={{ margin: "8px 0 0" }}>{msg}</p>}
    </section>
  );
}
