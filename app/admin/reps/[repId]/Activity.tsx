"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { OUTCOME_LABEL, scoreBand, type Outcome } from "@/lib/calls";
import { TAG_LABEL } from "@/lib/repHistory";
import type { Ctx } from "./page";

type Kind = "real" | "practice" | "training" | "note";
type Ev = { at: string; kind: Kind; title: string; sub?: string; right?: React.ReactNode; href?: string };
const FILTERS: { id: Kind | "all"; label: string }[] = [
  { id: "all", label: "Everything" },
  { id: "real", label: "Real calls" },
  { id: "practice", label: "Practice calls" },
  { id: "training", label: "Training" },
  { id: "note", label: "Notes & files" },
];
const KIND_TEXT: Record<Kind, string> = { real: "Call", practice: "Practice", training: "Training", note: "Note" };

/** Everything on record, newest first. */
export default function Activity({ ctx }: { ctx: Ctx }) {
  const { history: h, people } = ctx;
  const [filter, setFilter] = useState<Kind | "all">("all");

  const events = useMemo(() => {
    const out: Ev[] = [];
    for (const c of h.calls) {
      const practice = c.source === "roleplay";
      const outcome = (c.outcome_manual || c.outcome) as Outcome | null;
      out.push({
        at: c.call_date || c.created_at,
        kind: practice ? "practice" : "real",
        title: practice ? `Practice call with ${h.personas.get(c.persona_id || "") ?? "a mock client"}` : `Client call${c.client_label ? ` -- ${c.client_label}` : ""}`,
        sub: [outcome ? OUTCOME_LABEL[outcome] : "", c.coaching?.[0] ? `Coach: ${c.coaching[0]}` : ""].filter(Boolean).join(" · "),
        right:
          c.status === "graded" ? (
            <span className={`pill ${scoreBand(c.slp_score)}`}>SLP {c.slp_score ?? "--"}</span>
          ) : (
            <span className="pill">{c.status}</span>
          ),
        href: `/admin/calls/${c.id}`,
      });
    }
    for (const q of h.quizzes)
      out.push({
        at: q.created_at,
        kind: "training",
        title: `Knowledge check: ${q.title ?? "quiz"}`,
        right: <span className={`pill ${q.passed ? "good" : "poor"}`}>{q.score}%</span>,
      });
    for (const c of h.completions)
      if (c.kind !== "quiz") out.push({ at: c.completed_at, kind: "training", title: `Completed: ${c.title ?? "training item"}`, sub: c.kind });
    for (const a of h.attendance)
      if (a.status !== "present")
        out.push({ at: a.week_start, kind: "training", title: `Master Your Craft: ${a.status.replace(/_/g, " ")}`, sub: `week of ${a.week_start}` });
    for (const n of h.notes)
      out.push({
        at: n.note_date,
        kind: "note",
        title: `${TAG_LABEL[n.tag]} from ${people.get(n.author_id || "") ?? "a manager"}`,
        sub: n.body.length > 200 ? `${n.body.slice(0, 200)}…` : n.body,
      });
    for (const c of h.cards)
      if (c.sent_at)
        out.push({
          at: c.sent_at,
          kind: "training",
          title: `Training card (${c.kind}): ${c.skill}`,
          sub: [c.status === "closed" ? "closed" : "open", c.practiced ? `practiced ${c.practiced}×` : "not practiced yet", c.rep_response ? `rep: ${c.rep_response.replace("_", " ")}` : ""]
            .filter(Boolean)
            .join(" · "),
        });
    for (const f of h.files) out.push({ at: f.created_at, kind: "note", title: `File: ${f.name}`, sub: f.note || undefined });
    return out.sort((a, b) => (a.at < b.at ? 1 : -1));
  }, [h, people]);

  const shown = filter === "all" ? events : events.filter((e) => e.kind === filter);

  return (
    <div>
      <div className="rx-presets" role="group" aria-label="Filter">
        {FILTERS.map((f) => (
          <button key={f.id} className={filter === f.id ? "on" : ""} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>
      {!shown.length ? (
        <p className="muted">Nothing here yet.</p>
      ) : (
        <div className="rx-timeline">
          {shown.slice(0, 300).map((e, i) => {
            const body = (
              <>
                <span className="when">{new Date(e.at.length === 10 ? `${e.at}T12:00:00` : e.at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" })}</span>
                <span className="what">
                  <b>
                    <span className={`rx-kind ${e.kind}`}>{KIND_TEXT[e.kind]}</span>
                    {e.title}
                  </b>
                  {e.sub && <small style={{ whiteSpace: "pre-wrap" }}>{e.sub}</small>}
                </span>
                <span>{e.right}</span>
              </>
            );
            return e.href ? (
              <Link key={i} href={e.href} className="rx-ev">
                {body}
              </Link>
            ) : (
              <div key={i} className="rx-ev">
                {body}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
