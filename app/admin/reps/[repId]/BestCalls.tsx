"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { bestPool, kindOf, pickBest, rankOf, type BestPick, type BestRow } from "@/lib/bestCall";
import { clock, PROVEN, scoreBand } from "@/lib/calls";
import type { Ctx } from "./page";

/**
 * The rep's best regular call and best Renew: the recording to hand them as
 * the model of their own best day. Managers only for now.
 */
export default function BestCalls({ ctx }: { ctx: Ctx }) {
  const { supabase, repId, repName } = ctx;
  const [picks, setPicks] = useState<BestPick[] | null>(null);
  const [pools, setPools] = useState<Map<string, BestRow[]>>(new Map());
  const [pinCol, setPinCol] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const r = await bestPool(supabase, repId);
    if (r.error && !r.rows.length) return setError(r.error);
    setPinCol(r.pinCol);
    setPicks(pickBest(r.rows, r.renewScripts));
    const m = new Map<string, BestRow[]>();
    for (const c of r.rows) {
      const k = kindOf(c, r.renewScripts);
      m.set(k, [...(m.get(k) ?? []), c]);
    }
    for (const [k, v] of m) m.set(k, v.sort((a, b) => rankOf(b) - rankOf(a)));
    setPools(m);
  }, [supabase, repId]);
  useEffect(() => {
    void load();
  }, [load]);

  async function pin(kind: string, id: string | null) {
    setError("");
    const ids = (pools.get(kind) ?? []).map((c) => c.id);
    if (ids.length) {
      const { error: e } = await supabase.from("calls").update({ best_pin: false }).in("id", ids);
      if (e) return setError(e.message);
    }
    if (id) {
      const { error: e } = await supabase.from("calls").update({ best_pin: true }).eq("id", id);
      if (e) return setError(e.message);
    }
    await load();
  }

  if (error) return <div className="error">Best calls: {error}</div>;
  if (!picks) return null;

  return (
    <section style={{ marginBottom: 18 }}>
      <h2 style={{ marginBottom: 4 }}>Best calls</h2>
      <p className="hint" style={{ marginTop: 0 }}>
        {repName.split(" ")[0]}&rsquo;s own best day, to listen back to: the highest Straight Line score of every enrolled call on file (clients who cancelled are left out), with +10 when the
        client made 6+ payments. Updates by itself as calls come in.
      </p>
      {!picks.length ? (
        <p className="muted">No enrolled call with a recording graded yet.</p>
      ) : (
        <div className="rx-grid2">
          {picks.map((p) => (
            <Card key={p.kind} p={p} ctx={ctx} pool={pools.get(p.kind) ?? []} pinCol={pinCol} onPin={(id) => void pin(p.kind, id)} />
          ))}
        </div>
      )}
      {!pinCol && <p className="hint">To pin a different call, run supabase/best_calls.sql in the Supabase SQL Editor.</p>}
    </section>
  );
}

function Card({ p, ctx, pool, pinCol, onPin }: { p: BestPick; ctx: Ctx; pool: BestRow[]; pinCol: boolean; onPin: (id: string | null) => void }) {
  const { supabase, repName } = ctx;
  const c = p.call;
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!c.audio_path) return;
    void supabase.storage
      .from("call-audio")
      .createSignedUrl(c.audio_path, 3600)
      .then(({ data }) => setUrl(data?.signedUrl || ""));
  }, [supabase, c.audio_path]);

  const date = c.call_date || c.created_at.slice(0, 10);
  async function download() {
    const ext = (c.audio_path?.split(".").pop() || "mp3").toLowerCase();
    const name = `Best ${p.kind === "renew" ? "Renew" : "call"} - ${repName} - ${date}.${ext}`;
    const { data } = await supabase.storage.from("call-audio").createSignedUrl(c.audio_path!, 600, { download: name });
    if (data?.signedUrl) window.location.href = data.signedUrl;
  }

  return (
    <div className="card" style={{ margin: 0 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <b>{p.kind === "renew" ? "Best Renew call" : "Best call"}</b>
        <span className="row" style={{ gap: 6 }}>
          {p.proven && <span className="pill good">{c.retention === "graduated" ? "Graduated" : "6+ payments"}</span>}
          {p.pinned && <span className="pill">Pinned</span>}
        </span>
      </div>
      <p className="muted" style={{ margin: "4px 0 8px" }}>
        {date}
        {c.client_label ? ` · ${c.client_label}` : ""}
        {c.duration_secs ? ` · ${clock(c.duration_secs)}` : ""}
      </p>
      <div className="row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        <span className={`pill ${scoreBand(c.slp_score)}`}>SLP {c.slp_score ?? "--"}</span>
        <span className={`pill ${scoreBand(c.score)}`}>Script {c.score ?? "--"}</span>
        {c.close_quality && c.close_quality !== "n/a" && <span className={`pill ${c.close_quality === "solid" ? "good" : c.close_quality === "fragile" ? "poor" : "fair"}`}>{c.close_quality} close</span>}
      </div>
      {url ? <audio src={url} controls preload="none" className="player" style={{ width: "100%" }} /> : <p className="hint">Loading the recording…</p>}
      <p className="hint" style={{ margin: "6px 0" }}>
        {p.why}
        {p.pool < 3 && !p.pinned ? " Picked from only a few calls so far -- it may change soon." : ""}
      </p>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button className="primary" onClick={() => void download()}>
          Download
        </button>
        <Link className="btn" href={`/admin/calls/${c.id}`} style={{ textDecoration: "none" }}>
          Open the graded call
        </Link>
        <Link className="btn" href={`/admin/calls/compare?a=${c.id}`} style={{ textDecoration: "none" }}>
          Compare with…
        </Link>
      </div>
      {pinCol && pool.length > 1 && (
        <label className="hint" style={{ display: "grid", gap: 4, marginTop: 10 }}>
          Use a different call
          <select value={p.pinned ? c.id : ""} onChange={(e) => onPin(e.target.value || null)}>
            <option value="">Automatic (best score)</option>
            {pool.map((x) => (
              <option key={x.id} value={x.id}>
                {(x.call_date || x.created_at.slice(0, 10)) + (x.client_label ? ` · ${x.client_label}` : "")} · SLP {x.slp_score}
                {x.retention && PROVEN.includes(x.retention) ? " · 6+ payments" : ""}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
