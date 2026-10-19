"use client";

import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Master Your Craft ideas are saved as topics in this category until they're taught. */
export const IDEA_CATEGORY = "Idea";

export type IdeaFor = "meeting" | "myc";

/**
 * Jot down an idea for the Thursday meeting or Master Your Craft before it's
 * forgotten. Thursday ideas land in the meeting backlog; Master Your Craft
 * ideas land in the topic list, waiting on the Master Your Craft page.
 */
export default function IdeaBox({
  supabase,
  orgId,
  me,
  initial = "meeting",
  fixed,
  onSaved,
}: {
  supabase: SupabaseClient;
  orgId: string;
  me: string;
  initial?: IdeaFor;
  fixed?: boolean;
  onSaved?: (to: IdeaFor) => void;
}) {
  const [to, setTo] = useState<IdeaFor>(initial);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const lines = text.trim().split("\n");
    const title = lines[0].trim().slice(0, 200);
    const notes = lines.slice(1).join("\n").trim() || null;
    if (!title) return;
    setBusy(true);
    setError("");
    const { error } =
      to === "meeting"
        ? await supabase.from("meeting_items").insert({ org_id: orgId, meeting_id: null, title, notes, minutes: 3, updated_by: me })
        : await supabase.from("training_topics").insert({ org_id: orgId, title, description: notes, category: IDEA_CATEGORY, created_by: me });
    setBusy(false);
    if (error) return setError(error.message);
    setText("");
    setStatus(to === "meeting" ? "Saved to the Thursday meeting backlog." : "Saved to Master Your Craft ideas.");
    setTimeout(() => setStatus(""), 3000);
    onSaved?.(to);
  }

  return (
    <form onSubmit={save} style={{ display: "grid", gap: 8 }}>
      {!fixed && (
        <div className="rx-tags" role="group" aria-label="Idea for">
          <button type="button" className={to === "meeting" ? "on" : ""} aria-pressed={to === "meeting"} onClick={() => setTo("meeting")}>
            Thursday meeting
          </button>
          <button type="button" className={to === "myc" ? "on" : ""} aria-pressed={to === "myc"} onClick={() => setTo("myc")}>
            Master Your Craft
          </button>
        </div>
      )}
      <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="The idea. A second line or more for notes, if you want." style={{ width: "100%" }} />
      <div className="rx-actions">
        <button className="primary" disabled={busy || !text.trim()}>
          {busy ? "Saving…" : "Save idea"}
        </button>
      </div>
      {error && <div className="error">{error}</div>}
      {status && <div className="status">{status}</div>}
    </form>
  );
}
