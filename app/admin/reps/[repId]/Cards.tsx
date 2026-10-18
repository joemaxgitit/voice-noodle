"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import CardView from "@/app/training/CardView";
import { CARD_KIND, cardWords, RESPONSE_LABEL, type Card, type CardDrill, type CardKind } from "@/lib/cards";
import type { Ctx } from "./page";
import { okToSpend, usd, useEstimate } from "@/lib/spend";

type Draft = {
  id?: string;
  kind: CardKind;
  skill: string;
  noticed: string;
  why: string;
  try_this: string;
  when_then: string;
  call_id: string | null;
  call_moment: string | null;
  drill: CardDrill;
  review_id: string | null;
};
type Option = { id: string; label: string };

const BLANK = (kind: CardKind): Draft => ({ kind, skill: "", noticed: "", why: "", try_this: "", when_then: "", call_id: null, call_moment: null, drill: null, review_id: null });

/**
 * Training cards for one rep: Claude drafts, a manager edits and signs,
 * the rep gets it on My training. One behavior per card.
 */
export default function Cards({ ctx, seed, clearSeed }: { ctx: Ctx; seed: { focus: string; reviewId: string | null } | null; clearSeed: () => void }) {
  const { supabase, orgId, me, repId, repName, people, history } = ctx;
  const first = repName.split(" ")[0];
  const [cards, setCards] = useState<Card[]>([]);
  const [modules, setModules] = useState<Option[]>([]);
  const [personas, setPersonas] = useState<Option[]>([]);
  const [reps, setReps] = useState<Option[]>([]);
  const [kind, setKind] = useState<CardKind>("focus");
  const [about, setAbout] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [also, setAlso] = useState<string[]>([]);
  const [drafting, setDrafting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const est = useEstimate(supabase, "card_draft");

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("training_cards").select("*").eq("rep_id", repId).neq("status", "discarded").order("created_at", { ascending: false });
    if (error) setError(/training_cards|does not exist/i.test(error.message) ? `${error.message} -- run supabase/training-cards.sql first.` : error.message);
    setCards((data || []) as Card[]);
  }, [supabase, repId]);

  useEffect(() => {
    void load();
    void (async () => {
      const [{ data: mods }, { data: ps }, { data: rs }] = await Promise.all([
        supabase.from("modules").select("id, title, language, scripts(title)").order("sort_order"),
        supabase.from("roleplay_personas").select("id, name, title").eq("active", true).order("sort_order"),
        supabase.from("profiles").select("id, full_name, role, active").eq("org_id", orgId).eq("role", "rep").eq("active", true).order("full_name"),
      ]);
      setModules(
        ((mods || []) as { id: string; title: string; language: string | null; scripts: { title: string } | { title: string }[] | null }[])
          .filter((m) => (m.language || "en") === "en")
          .map((m) => {
            const s = Array.isArray(m.scripts) ? m.scripts[0] : m.scripts;
            return { id: m.id, label: `${s?.title ? `${s.title} · ` : ""}${m.title}` };
          })
      );
      setPersonas(((ps || []) as { id: string; name: string; title: string }[]).map((p) => ({ id: p.id, label: `${p.name} -- ${p.title}` })));
      setReps(((rs || []) as { id: string; full_name: string | null }[]).filter((r) => r.id !== repId).map((r) => ({ id: r.id, label: r.full_name || "Rep" })));
    })();
  }, [load, supabase, orgId, repId]);

  const askClaude = useCallback(
    async (k: CardKind, focus: string, reviewId: string | null, callId?: string) => {
      if (!(await okToSpend(supabase, est ?? 0, "Drafting this card"))) return;
      setDrafting(true);
      setError("");
      setStatus("");
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const res = await fetch("/api/cards/draft", {
        method: "POST",
        headers: { Authorization: `Bearer ${session?.access_token ?? ""}`, "Content-Type": "application/json" },
        body: JSON.stringify({ repId, kind: k, focus: focus || undefined, reviewId: reviewId || undefined, callId }),
      }).catch((e) => e as Error);
      setDrafting(false);
      if (res instanceof Error) return setError(res.message);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return setError(body?.error || `Drafting failed (${res.status}).`);
      setDraft(body.draft as Draft);
      setAlso([]);
    },
    [supabase, repId, est]
  );

  // "Make a card" from a coaching review lands here with the skill filled in.
  useEffect(() => {
    if (!seed) return;
    setKind("focus");
    setAbout(seed.focus);
    clearSeed();
    void askClaude("focus", seed.focus, seed.reviewId);
  }, [seed, clearSeed, askClaude]);

  const active = cards.filter((c) => c.status === "sent");
  const drafts = cards.filter((c) => c.status === "draft");
  const closed = cards.filter((c) => c.status === "closed");
  const activeFocus = active.find((c) => c.kind === "focus" && c.id !== draft?.id);
  const myName = people.get(me) || "Your manager";
  const words = draft ? cardWords(draft) : 0;
  const recentCalls = useMemo(() => history.calls.filter((c) => c.status === "graded").slice(0, 12), [history.calls]);

  const row = (d: Draft, rep: string, status: "draft" | "sent", groupId: string | null) => ({
    org_id: orgId,
    rep_id: rep,
    kind: d.kind,
    skill: d.skill.trim(),
    noticed: d.noticed.trim(),
    why: d.why.trim(),
    try_this: d.try_this.trim(),
    when_then: d.when_then.trim(),
    call_id: rep === repId ? d.call_id : null,
    call_moment: rep === repId ? d.call_moment : null,
    drill: d.drill,
    review_id: d.review_id,
    group_id: groupId,
    status,
    created_by: me,
    ...(status === "sent" ? { signed_by: me, signed_name: myName, sent_at: new Date().toISOString() } : {}),
    updated_at: new Date().toISOString(),
  });

  async function save(send: boolean) {
    if (!draft) return;
    if (!draft.skill.trim() || !draft.try_this.trim()) return setError("A card needs at least a skill and a \"Try this\".");
    if (send && draft.kind === "focus" && activeFocus && !confirm(`${first} already has an open focus card: "${activeFocus.skill}". One focus at a time works best. Send this one anyway?`)) return;
    setBusy(true);
    setError("");
    const groupId = send && also.length ? crypto.randomUUID() : null;
    const status = send ? "sent" : "draft";
    const res = draft.id
      ? await supabase.from("training_cards").update(row(draft, repId, status, groupId)).eq("id", draft.id)
      : await supabase.from("training_cards").insert(row(draft, repId, status, groupId));
    if (res.error) {
      setBusy(false);
      return setError(res.error.message);
    }
    if (send && also.length) {
      const { error } = await supabase.from("training_cards").insert(also.map((r) => row(draft, r, "sent", groupId)));
      if (error) setError(`Sent to ${first}, but not the others: ${error.message}`);
    }
    setBusy(false);
    setDraft(null);
    setStatus(send ? `Sent to ${first}${also.length ? ` and ${also.length} more` : ""}.` : "Draft saved.");
    await load();
  }

  async function discard() {
    if (!draft) return;
    if (draft.id) await supabase.from("training_cards").update({ status: "discarded", updated_at: new Date().toISOString() }).eq("id", draft.id);
    setDraft(null);
    await load();
  }

  async function close(c: Card) {
    const note = prompt(`Close "${c.skill}"? Add a note for the record (optional) -- e.g. "showed it on 3 calls this week".`, "");
    if (note === null) return;
    await supabase.from("training_cards").update({ status: "closed", closed_at: new Date().toISOString(), close_note: note || null, updated_at: new Date().toISOString() }).eq("id", c.id);
    await load();
  }

  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  return (
    <div>
      {error && <div className="error">{error}</div>}
      {status && <div className="status">{status}</div>}

      {!draft ? (
        <section className="card">
          <h3 className="rx-sec-title">New card for {first}</h3>
          <div className="rx-tags" role="group" aria-label="Kind of card">
            {(Object.keys(CARD_KIND) as CardKind[]).map((k) => (
              <button key={k} className={kind === k ? "on" : ""} aria-pressed={kind === k} onClick={() => setKind(k)} title={CARD_KIND[k].blurb}>
                {CARD_KIND[k].label}
              </button>
            ))}
          </div>
          <label className="field">
            <span className="label">About (optional -- leave blank and Claude picks the highest-leverage thing)</span>
            <input value={about} onChange={(e) => setAbout(e.target.value)} placeholder="e.g. looping after the first objection" />
          </label>
          <div className="rx-actions">
            <button className="primary" disabled={drafting} onClick={() => void askClaude(kind, about, null)}>
              {drafting ? "Drafting…" : `Draft it with Claude${est !== null ? ` · about ${usd(est)}` : ""}`}
            </button>
            <button disabled={drafting} onClick={() => (setDraft(BLANK(kind)), setAlso([]))}>
              Write it myself
            </button>
          </div>
          {drafting && (
            <div className="rx-working" style={{ marginTop: 10 }}>
              <span className="rx-spin" aria-hidden="true" />
              <span className="hint" style={{ margin: 0 }}>
                Reading {first}&rsquo;s recent calls and picking one moment&hellip;
              </span>
            </div>
          )}
          {activeFocus && (
            <p className="hint" style={{ marginBottom: 0 }}>
              Open focus right now: <b>{activeFocus.skill}</b>. One focus at a time works best -- close it when {first} shows it on calls.
            </p>
          )}
        </section>
      ) : (
        <section className="rx-grid2" style={{ alignItems: "start" }}>
          <div className="card">
            <div className="rx-head">
              <h3 className="rx-sec-title" style={{ margin: 0 }}>
                {draft.id ? "Edit draft" : "New card"} · {CARD_KIND[draft.kind].label}
              </h3>
              <span className={`hint ${words > 90 ? "rx-down" : ""}`} style={{ margin: 0 }}>
                {words} words{words > 90 ? " -- aim for 40-90" : ""}
              </span>
            </div>
            <label className="field">
              <span className="label">Skill</span>
              <input value={draft.skill} onChange={(e) => set({ skill: e.target.value })} placeholder="Looping" />
            </label>
            <label className="field">
              <span className="label">What I noticed</span>
              <textarea rows={3} value={draft.noticed} onChange={(e) => set({ noticed: e.target.value })} />
            </label>
            <div className="tr-two">
              <label className="field">
                <span className="label">From which call</span>
                <select value={draft.call_id ?? ""} onChange={(e) => set({ call_id: e.target.value || null })}>
                  <option value="">None</option>
                  {recentCalls.map((c) => (
                    <option key={c.id} value={c.id}>
                      {new Date(c.call_date || c.created_at).toLocaleDateString()} · {c.source === "roleplay" ? "practice" : "real"} · SLP {c.slp_score ?? "--"}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="label">The moment</span>
                <input value={draft.call_moment ?? ""} onChange={(e) => set({ call_moment: e.target.value || null })} placeholder="at 4:12 -- 'I need to talk to my wife'" />
              </label>
            </div>
            <label className="field">
              <span className="label">Why it matters</span>
              <textarea rows={2} value={draft.why} onChange={(e) => set({ why: e.target.value })} />
            </label>
            <label className="field">
              <span className="label">Try this</span>
              <textarea rows={2} value={draft.try_this} onChange={(e) => set({ try_this: e.target.value })} />
            </label>
            <label className="field">
              <span className="label">When-then plan</span>
              <input value={draft.when_then} onChange={(e) => set({ when_then: e.target.value })} placeholder="When the client says ___, I'll ___." />
            </label>
            <label className="field">
              <span className="label">Practice</span>
              <select
                value={draft.drill ? `${draft.drill.type}:${draft.drill.id}` : ""}
                onChange={(e) => {
                  const [t, id] = e.target.value.split(":");
                  const opt = (t === "module" ? modules : personas).find((o) => o.id === id);
                  set({ drill: opt ? { type: t as "module" | "persona", id, label: opt.label } : null });
                }}
              >
                <option value="">No drill</option>
                <optgroup label="Script sections">
                  {modules.map((m) => (
                    <option key={m.id} value={`module:${m.id}`}>
                      {m.label}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Mock clients">
                  {personas.map((p) => (
                    <option key={p.id} value={`persona:${p.id}`}>
                      {p.label}
                    </option>
                  ))}
                </optgroup>
              </select>
            </label>
            {!draft.id && reps.length > 0 && (
              <details style={{ margin: "4px 0 12px" }}>
                <summary className="hint" style={{ cursor: "pointer" }}>
                  Also send to other reps{also.length ? ` (${also.length})` : ""}
                </summary>
                <div className="tr-checklist" style={{ marginTop: 8 }}>
                  {reps.map((r) => (
                    <label key={r.id}>
                      <input type="checkbox" checked={also.includes(r.id)} onChange={(e) => setAlso((a) => (e.target.checked ? [...a, r.id] : a.filter((x) => x !== r.id)))} />
                      <span>{r.label}</span>
                    </label>
                  ))}
                </div>
                <p className="hint">They get the same card without the call moment, which is {first}&rsquo;s.</p>
              </details>
            )}
            <div className="rx-actions">
              <button className="primary" disabled={busy} onClick={() => void save(true)}>
                {busy ? "Sending…" : `Sign and send to ${first}${also.length ? ` +${also.length}` : ""}`}
              </button>
              <button disabled={busy} onClick={() => void save(false)}>
                Save draft
              </button>
              <button className="link-btn" disabled={busy} onClick={() => void discard()}>
                Discard
              </button>
            </div>
          </div>
          <div>
            <div className="hint" style={{ margin: "0 0 6px" }}>
              What {first} will see
            </div>
            <CardView card={{ ...draft, signed_name: myName }} preview />
          </div>
        </section>
      )}

      {drafts.length > 0 && (
        <section style={{ marginTop: 18 }}>
          <h3 className="rx-sec-title">Drafts</h3>
          {drafts.map((c) => (
            <div key={c.id} className="rx-file">
              <div>
                <b>
                  {CARD_KIND[c.kind].label}: {c.skill || "untitled"}
                </b>
                <div className="hint" style={{ margin: 0 }}>
                  saved {new Date(c.updated_at).toLocaleDateString()}
                </div>
              </div>
              <button
                className="tr-sm"
                onClick={() =>
                  setDraft({
                    id: c.id,
                    kind: c.kind,
                    skill: c.skill,
                    noticed: c.noticed,
                    why: c.why,
                    try_this: c.try_this,
                    when_then: c.when_then,
                    call_id: c.call_id,
                    call_moment: c.call_moment,
                    drill: c.drill,
                    review_id: c.review_id,
                  })
                }
              >
                Edit
              </button>
            </div>
          ))}
        </section>
      )}

      <section style={{ marginTop: 18 }}>
        <h3 className="rx-sec-title">With {first} now ({active.length})</h3>
        {!active.length && <p className="hint">No open cards.</p>}
        {active.map((c) => (
          <div key={c.id} className="rx-note">
            <div className="meta" style={{ flexWrap: "wrap" }}>
              <span className={`rx-kind ${c.kind === "focus" ? "real" : "note"}`}>{CARD_KIND[c.kind].label}</span>
              <b style={{ color: "var(--text)" }}>{c.skill}</b>
              <span>
                sent {c.sent_at ? new Date(c.sent_at).toLocaleDateString() : ""} by {c.signed_name}
                {c.read_at ? " · opened" : " · not opened yet"}
                {c.practiced ? ` · practiced ${c.practiced}×` : ""}
              </span>
              <button className="tr-sm" onClick={() => void close(c)}>
                Close
              </button>
            </div>
            {c.rep_response && (
              <p>
                <span className={`pill ${c.rep_response === "got_it" ? "good" : "fair"}`}>{RESPONSE_LABEL[c.rep_response]}</span>
                {c.rep_note ? ` "${c.rep_note}"` : ""}
              </p>
            )}
            {c.rep_plan && c.rep_plan !== c.when_then && <p className="hint">Their plan, in their words: &ldquo;{c.rep_plan}&rdquo;</p>}
          </div>
        ))}
      </section>

      {closed.length > 0 && (
        <section style={{ marginTop: 18 }}>
          <h3 className="rx-sec-title">Closed ({closed.length})</h3>
          {closed.map((c) => (
            <div key={c.id} className="rx-file">
              <div>
                <b>
                  {CARD_KIND[c.kind].label}: {c.skill}
                </b>
                <div className="hint" style={{ margin: 0 }}>
                  {c.sent_at ? new Date(c.sent_at).toLocaleDateString() : ""} → {c.closed_at ? new Date(c.closed_at).toLocaleDateString() : ""}
                  {c.practiced ? ` · practiced ${c.practiced}×` : ""}
                  {c.close_note ? ` · ${c.close_note}` : ""}
                </div>
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
