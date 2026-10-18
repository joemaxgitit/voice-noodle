"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CARD_KIND, type Card } from "@/lib/cards";
import CardView from "./CardView";

/** The rep's open training cards, newest first, with past ones folded away. */
export default function MyCards({ supabase, openOnly, empty }: { supabase: SupabaseClient; openOnly?: boolean; empty?: ReactNode }) {
  const [cards, setCards] = useState<Card[] | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("training_cards").select("*").order("sent_at", { ascending: false }).limit(40);
    const list = (data || []) as Card[];
    setCards(list);
    for (const c of list) if (c.status === "sent" && !c.read_at) void supabase.rpc("training_card_seen", { p_card: c.id });
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!cards) return null;
  if (!cards.filter((c) => c.status === "sent").length && (openOnly || !cards.length)) return empty ? <>{empty}</> : null;
  const open = cards.filter((c) => c.status === "sent");
  const done = cards.filter((c) => c.status === "closed");

  return (
    <section className="my-section">
      <h2>{open.length === 1 ? "Your focus" : open.length ? "Your cards" : "Your cards"}</h2>
      {!open.length && <p className="muted">No open cards right now.</p>}
      <div style={{ display: "grid", gap: 14 }}>
        {open.map((c) => (
          <CardView
            key={c.id}
            card={c}
            onPractice={async () => {
              await supabase.rpc("training_card_practiced", { p_card: c.id });
            }}
            onRespond={async (r, note, plan) => {
              await supabase.rpc("training_card_respond", { p_card: c.id, p_response: r, p_note: note, p_plan: plan });
              await load();
            }}
          />
        ))}
      </div>
      {!openOnly && done.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary className="hint" style={{ cursor: "pointer" }}>
            Done ({done.length})
          </summary>
          {done.map((c) => (
            <div key={c.id} className="my-mat" style={{ gridTemplateColumns: "minmax(0,1fr) auto" }}>
              <span>
                <b>{c.skill}</b>
                <small>
                  {CARD_KIND[c.kind].label} · {c.signed_name}
                  {c.practiced ? ` · practiced ${c.practiced}×` : ""}
                </small>
              </span>
              <span className="pill good">done</span>
            </div>
          ))}
        </details>
      )}
    </section>
  );
}
