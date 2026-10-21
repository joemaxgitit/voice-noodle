"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { okToSpend, usd, useEstimate } from "@/lib/spend";
import { plainWords } from "@/lib/plain";

// Every string in a saved draft, in plain words (older drafts may say "n=2").
const plain = <T,>(x: T): T =>
  typeof x === "string" ? (plainWords(x) as T) : Array.isArray(x) ? (x.map(plain) as T) : x && typeof x === "object" ? (Object.fromEntries(Object.entries(x).map(([k, v]) => [k, plain(v)])) as T) : x;
import type { Archetype } from "@/app/api/archetypes/route";

type Row = { id: string; status: "draft" | "approved" | "replaced"; body: { archetypes: Archetype[]; notes: string }; inputs: { clients?: number; proven?: number; cancelled?: number; straight_line?: number }; created_at: string; approved_at: string | null };

/**
 * Client archetypes from real calls, through the Straight Line lens. The app
 * drafts them; a manager keeps the ones that ring true and approves; the
 * approved set builds and mixes the practice clients.
 */
export default function Archetypes() {
  const supabase = useMemo(() => createClient(), []);
  const est = useEstimate(supabase, "archetypes");
  const [rows, setRows] = useState<Row[]>([]);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [keep, setKeep] = useState<Set<number>>(new Set());
  const [learn, setLearn] = useState<number | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("client_archetypes").select("id, status, body, inputs, created_at, approved_at").neq("status", "replaced").order("created_at", { ascending: false }).limit(4);
    if (error) return setMissing(/client_archetypes|does not exist/i.test(error.message));
    setRows(((data || []) as Row[]).map((r) => ({ ...r, body: plain(r.body) })));
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    const l = await fetch("/api/calls/relearn-all", { headers: { Authorization: `Bearer ${token ?? ""}` } }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
    setLearn(l?.remaining ?? null);
  }, [supabase]);
  useEffect(() => {
    void load();
  }, [load]);

  const approved = rows.find((r) => r.status === "approved") ?? null;
  const draft = rows.find((r) => r.status === "draft" && (!approved || r.created_at > approved.created_at)) ?? null;
  useEffect(() => {
    if (draft) setKeep(new Set(draft.body.archetypes.map((_, i) => i)));
  }, [draft?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function find() {
    if (!(await okToSpend(supabase, est ?? 0.25, "Finding client archetypes"))) return;
    setBusy(true);
    setError("");
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    const res = await fetch("/api/archetypes", { method: "POST", headers: { Authorization: `Bearer ${token ?? ""}`, "Content-Type": "application/json" }, body: "{}" }).catch(() => null);
    const b = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) return setError(b?.error || "Couldn't group the clients.");
    await load();
  }

  async function approve() {
    if (!draft) return;
    const kept = draft.body.archetypes.filter((_, i) => keep.has(i));
    if (!kept.length) return setError("Keep at least one archetype.");
    setError("");
    if (approved) await supabase.from("client_archetypes").update({ status: "replaced" }).eq("id", approved.id);
    const { error } = await supabase.from("client_archetypes").update({ status: "approved", approved_at: new Date().toISOString(), body: { ...draft.body, archetypes: kept } }).eq("id", draft.id);
    if (error) return setError(error.message);
    await load();
  }

  async function discard() {
    if (!draft) return;
    await supabase.from("client_archetypes").update({ status: "replaced" }).eq("id", draft.id);
    await load();
  }

  const shown = draft ?? approved;

  return (
    <>
      <h2>Client archetypes</h2>
      <p className="hint" style={{ marginTop: -4 }}>
        The kinds of clients that actually show up on your real calls, grouped the Straight Line way: buyer type, action threshold, pain, the weakest Ten, the belief behind the
        stall, how open they are and how they pull a call off to Pluto. You keep the ones that ring true; the approved set builds the practice clients.
        {learn ? ` ${learn} real call${learn === 1 ? " is" : "s are"} still being read with the Straight Line fields -- best to wait for those before grouping.` : ""}
      </p>
      {missing ? (
        <div className="error">Run supabase/archetypes.sql in the Supabase SQL Editor first.</div>
      ) : (
        <>
          {shown ? (
            <>
              <p className="muted" style={{ margin: "4px 0 10px" }}>
                {shown === draft ? <b>Draft for you to review</b> : <b>Approved {new Date(shown.approved_at || shown.created_at).toLocaleDateString()}</b>} · from {shown.inputs.clients ?? "?"} real clients
                {shown.inputs.proven || shown.inputs.cancelled ? ` (${shown.inputs.proven ?? 0} proven, ${shown.inputs.cancelled ?? 0} cancelled)` : ""}. {shown.body.notes}
              </p>
              <div className="rx-grid2">
                {shown.body.archetypes.map((a, i) => (
                  <section className="card" key={i} style={shown === draft && !keep.has(i) ? { opacity: 0.45 } : undefined}>
                    <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                      <b>{a.name}</b>
                      <small className="muted">
                        {a.clients} client{a.clients === 1 ? "" : "s"} · <span className={`pill ${a.confidence === "solid" ? "good" : "fair"}`}>{a.confidence}</span>
                      </small>
                    </div>
                    <p style={{ margin: "6px 0" }}>{a.summary}</p>
                    <small className="muted">
                      Buyer: {a.buyer_type} · needs {a.action_threshold} certainty to act · pain: {a.pain_awareness} · weakest Ten: {a.weakest_ten}
                      {a.core_belief ? ` · "${a.core_belief}"` : ""} · {a.openness}
                      {a.decision ? ` · ${a.decision}` : ""}
                    </small>
                    <p style={{ margin: "8px 0 0" }}>
                      <b>Spot it:</b> {a.spot_it}
                    </p>
                    {a.pluto && (
                      <p style={{ margin: "4px 0 0" }}>
                        <b>Off to Pluto:</b> {a.pluto}
                      </p>
                    )}
                    <p style={{ margin: "4px 0 0" }}>
                      <b>Hardship layers:</b> {[a.layers.facts, a.layers.cause, a.layers.impact, a.layers.feelings, a.layers.future].filter(Boolean).join(" → ")}
                    </p>
                    {a.sounds_like.length > 0 && <p style={{ margin: "4px 0 0" }} className="muted">&ldquo;{a.sounds_like.join("” · “")}&rdquo;</p>}
                    <p style={{ margin: "4px 0 0" }}>
                      <b>What closes them:</b> {a.what_closes}
                    </p>
                    <p style={{ margin: "4px 0 0" }}>
                      <b>What loses them:</b> {a.what_loses}
                    </p>
                    <small className="muted">{a.results}</small>
                    {shown === draft && (
                      <label className="hint" style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8 }}>
                        <input
                          type="checkbox"
                          style={{ width: "auto" }}
                          checked={keep.has(i)}
                          onChange={(e) =>
                            setKeep((k) => {
                              const n = new Set(k);
                              if (e.target.checked) n.add(i);
                              else n.delete(i);
                              return n;
                            })
                          }
                        />
                        Keep this one
                      </label>
                    )}
                  </section>
                ))}
              </div>
              {shown === draft && (
                <div className="row" style={{ gap: 8, marginTop: 10 }}>
                  <button className="primary" onClick={() => void approve()}>
                    Approve the {keep.size} kept
                  </button>
                  <button onClick={() => void discard()}>Discard draft</button>
                </div>
              )}
            </>
          ) : (
            <p className="hint">Not grouped yet.</p>
          )}
          <button onClick={() => void find()} disabled={busy} style={{ marginTop: 10 }}>
            {busy ? "Grouping clients… (a minute or two)" : `${shown ? "Regroup" : "Find"} archetypes from real calls${est !== null ? ` · about ${usd(est)}` : ""}`}
          </button>
          {error && <div className="error">{error}</div>}
        </>
      )}
    </>
  );
}
