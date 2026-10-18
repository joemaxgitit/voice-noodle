"use client";

import { useState } from "react";
import { CARD_KIND, type Card } from "@/lib/cards";
import "./cards.css";

/**
 * One training card as the rep sees it. Managers see the same thing as a
 * preview while they edit (no buttons work there).
 */
export default function CardView({
  card,
  preview,
  onPractice,
  onRespond,
}: {
  card: Pick<Card, "kind" | "skill" | "noticed" | "why" | "try_this" | "when_then" | "call_moment" | "drill" | "signed_name"> &
    Partial<Pick<Card, "id" | "rep_plan" | "rep_response" | "rep_note" | "practiced" | "sent_at">>;
  preview?: boolean;
  onPractice?: () => Promise<unknown> | void;
  onRespond?: (response: "got_it" | "question" | "disagree" | null, note: string | null, plan: string | null) => Promise<void>;
}) {
  const [plan, setPlan] = useState(card.rep_plan ?? card.when_then);
  const [asking, setAsking] = useState<"question" | "disagree" | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState("");

  const drillHref = card.drill ? (card.drill.type === "module" ? `/train/${card.drill.id}` : `/roleplay?persona=${card.drill.id}`) : null;
  const kind = CARD_KIND[card.kind];

  async function respond(r: "got_it" | "question" | "disagree" | null, n: string | null, p: string | null) {
    if (!onRespond) return;
    setBusy(true);
    await onRespond(r, n, p);
    setBusy(false);
    setAsking(null);
    setNote("");
    setSaved(r === "got_it" ? "Noted." : r ? "Sent to your manager." : "Plan saved.");
  }

  return (
    <article className={`tc tc-${card.kind}`}>
      <header className="tc-head">
        <span className="tc-kind">{kind.label}</span>
        <h3>{card.skill || "Untitled skill"}</h3>
      </header>

      {card.noticed && (
        <section>
          <div className="tc-label">What I noticed</div>
          <p>{card.noticed}</p>
          {card.call_moment && <p className="tc-moment">{card.call_moment}</p>}
        </section>
      )}
      {card.why && (
        <section>
          <div className="tc-label">Why it matters</div>
          <p>{card.why}</p>
        </section>
      )}
      {card.try_this && (
        <section>
          <div className="tc-label">Try this</div>
          <p className="tc-try">{card.try_this}</p>
        </section>
      )}
      {card.when_then && (
        <section>
          <div className="tc-label">My plan</div>
          {preview ? (
            <p className="tc-plan">{card.when_then}</p>
          ) : (
            <>
              <textarea className="tc-plan" rows={2} value={plan} onChange={(e) => setPlan(e.target.value)} aria-label="Your plan in your own words" />
              {plan.trim() !== (card.rep_plan ?? card.when_then).trim() && (
                <button className="tr-sm" disabled={busy} onClick={() => void respond(null, null, plan.trim())}>
                  Save my plan
                </button>
              )}
            </>
          )}
        </section>
      )}

      {drillHref && (
        <div className="tc-drill">
          {preview ? (
            <span className="btn primary">Practice: {card.drill!.label}</span>
          ) : (
            <a
              className="btn primary"
              href={drillHref}
              onClick={async (e) => {
                // Log the practice before leaving, or the navigation can cut it off.
                e.preventDefault();
                await Promise.resolve(onPractice?.()).catch(() => undefined);
                window.location.href = drillHref;
              }}
              style={{ textDecoration: "none" }}
            >
              Practice: {card.drill!.label}
            </a>
          )}
          {!!card.practiced && <span className="hint">Practiced {card.practiced}×</span>}
        </div>
      )}

      <footer className="tc-foot">
        <span>&mdash; {card.signed_name || "Your manager"}</span>
        {!preview && onRespond && (
          <span className="tc-actions">
            {card.rep_response ? (
              <span className="hint">
                {card.rep_response === "got_it" ? "You said: got it" : card.rep_response === "question" ? "You asked a question" : "You shared your take"}
              </span>
            ) : null}
            {!asking && (
              <>
                <button className="tr-sm" disabled={busy} onClick={() => void respond("got_it", null, null)}>
                  Got it
                </button>
                <button className="tr-sm" disabled={busy} onClick={() => setAsking("question")}>
                  Ask a question
                </button>
                <button className="tr-sm" disabled={busy} onClick={() => setAsking("disagree")}>
                  I see it differently
                </button>
              </>
            )}
          </span>
        )}
      </footer>
      {asking && (
        <div className="tc-ask">
          <textarea
            rows={3}
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={asking === "question" ? "What would you like to ask?" : "How do you see that moment? Your manager will read this."}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button className="primary tr-sm" disabled={busy || !note.trim()} onClick={() => void respond(asking, note.trim(), null)}>
              Send to {card.signed_name?.split(" ")[0] || "your manager"}
            </button>
            <button className="tr-sm" onClick={() => setAsking(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {saved && <p className="hint" style={{ margin: "6px 0 0" }}>{saved}</p>}
    </article>
  );
}
