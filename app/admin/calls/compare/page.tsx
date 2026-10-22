"use client";

import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { clock, hardshipScoreOf, OUTCOME_LABEL, RETENTION_LABEL, scoreBand, type Grade, type Outcome, type Retention } from "@/lib/calls";
import { bestPool, kindOf, pickBest } from "@/lib/bestCall";
import { okToSpend, usd, useEstimate } from "@/lib/spend";
import "../calls.css";

type Call = {
  id: string;
  rep_id: string | null;
  rep_name: string | null;
  client_label: string | null;
  call_date: string | null;
  created_at: string;
  duration_secs: number | null;
  slp_score: number | null;
  score: number | null;
  outcome: Outcome | null;
  retention: Retention | null;
  audio_path: string | null;
  script_id: string | null;
  handoff: string | null;
  grade: Grade | null;
  profiles: { full_name: string | null } | null;
};
type Pick = { id: string; call_date: string | null; created_at: string; client_label: string | null; slp_score: number | null; outcome: string | null; duration_secs: number | null };

const COLS =
  "id, rep_id, rep_name, client_label, call_date, created_at, duration_secs, slp_score, score, outcome, retention, audio_path, script_id, handoff, grade, profiles:rep_id(full_name)";
const STATUS: Record<string, string> = { hit: "Hit", partial: "Partial", missed: "Missed", not_reached: "Not reached" };
const BAND: Record<string, string> = { hit: "good", partial: "fair", missed: "poor", not_reached: "" };

export default function ComparePage() {
  return (
    <Suspense fallback={null}>
      <Compare />
    </Suspense>
  );
}

function Compare() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const sp = useSearchParams();
  const aId = sp.get("a");
  const bId = sp.get("b");
  const [A, setA] = useState<Call | null>(null);
  const [B, setB] = useState<Call | null>(null);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const est = useEstimate(supabase, "compare");
  const [diff, setDiff] = useState("");
  const [busy, setBusy] = useState(false);
  const urls = useRef<{ a?: HTMLAudioElement | null; b?: HTMLAudioElement | null }>({});

  const go = (a: string | null, b: string | null) => router.replace(`/admin/calls/compare?${new URLSearchParams({ ...(a ? { a } : {}), ...(b ? { b } : {}) })}`);

  useEffect(() => {
    void (async () => {
      setError("");
      setDiff("");
      const ids = [aId, bId].filter(Boolean) as string[];
      if (!ids.length) return setError("Open this from a rep's best call or from a graded call.");
      const { data, error: e } = await supabase.from("calls").select(COLS).in("id", ids);
      if (e) return setError(e.message);
      const rows = (data || []) as unknown as Call[];
      const a = rows.find((x) => x.id === aId) ?? null;
      const b = rows.find((x) => x.id === bId) ?? null;
      // Only B given ("Compare to their best call"): A is that rep's best call of the same kind.
      if (!a && b?.rep_id) {
        const r = await bestPool(supabase, b.rep_id);
        const kind = kindOf(b, r.renewScripts);
        const best = pickBest(r.rows.filter((x) => x.id !== b.id), r.renewScripts).find((p) => p.kind === kind);
        if (best) return go(best.call.id, b.id);
        setNote(`${b.profiles?.full_name ?? "This rep"} has no other enrolled ${kind === "renew" ? "Renew " : ""}call on file to compare with yet.`);
      }
      setA(a);
      setB(b);
      const rep = (a ?? b)?.rep_id;
      if (rep) {
        const { data: list } = await supabase
          .from("calls")
          .select("id, call_date, created_at, client_label, slp_score, outcome, duration_secs")
          .eq("rep_id", rep)
          .eq("status", "graded")
          .neq("source", "roleplay")
          .order("call_date", { ascending: false, nullsFirst: false })
          .limit(300);
        setPicks(((list || []) as Pick[]).filter((x) => x.id !== aId && x.id !== bId));
      }
    })();
  }, [supabase, aId, bId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function difference() {
    if (!A || !B) return;
    if (!(await okToSpend(supabase, est ?? 0.05, "Comparing two calls"))) return;
    setBusy(true);
    setError("");
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    const res = await fetch("/api/calls/compare", { method: "POST", headers: { Authorization: `Bearer ${token ?? ""}`, "Content-Type": "application/json" }, body: JSON.stringify({ a: A.id, b: B.id }) }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) return setError(body?.error || "Couldn't compare the calls.");
    setDiff(body.text || "");
  }

  const seek = (which: "a" | "b", t: number | null | undefined) => {
    const el = urls.current[which];
    if (!el || typeof t !== "number") return;
    el.currentTime = Math.max(0, t - 2);
    void el.play();
  };
  // "[A 9:40]" / "[B 4:15]" in the write-up become buttons that play that moment.
  const linked = (line: string) =>
    line.split(/(\[[AB] \d+:\d{2}(?::\d{2})?\])/g).map((part, i) => {
      const m = part.match(/^\[([AB]) ((?:\d+:)?\d+:\d{2})\]$/);
      if (!m) return <span key={i}>{part}</span>;
      const secs = m[2].split(":").reduce((s, x) => s * 60 + Number(x), 0);
      return (
        <button key={i} className="cmp-time" onClick={() => seek(m[1] === "A" ? "a" : "b", secs)}>
          {m[1] === "A" ? "Best" : "This"} {m[2]}
        </button>
      );
    });

  const sections = useMemo(() => {
    const names: string[] = [];
    for (const g of [A?.grade, B?.grade]) for (const s of g?.sections ?? []) if (!names.includes(s.section)) names.push(s.section);
    return names;
  }, [A, B]);

  const time = (which: "a" | "b", t: number | null | undefined) =>
    typeof t === "number" ? (
      <button className="cmp-time" onClick={() => seek(which, t)}>
        {clock(t)}
      </button>
    ) : null;

  const picker = (which: "a" | "b") => (
    <select value="" onChange={(e) => e.target.value && go(which === "a" ? e.target.value : aId, which === "b" ? e.target.value : bId)} style={{ marginTop: 6 }}>
      <option value="">{which === "b" ? "Choose a call to compare…" : "Use a different model call…"}</option>
      {picks.map((p) => (
        <option key={p.id} value={p.id}>
          {(p.call_date || p.created_at.slice(0, 10)) + (p.client_label ? ` · ${p.client_label}` : "")} · {clock(p.duration_secs)} · {OUTCOME_LABEL[p.outcome as Outcome] ?? p.outcome ?? "?"} · SLP {p.slp_score ?? "--"}
        </option>
      ))}
    </select>
  );

  const head = (c: Call | null, which: "a" | "b") => (
    <div className="card" style={{ margin: 0 }}>
      <div className="eyebrow">{which === "a" ? "Model call (best)" : "Compared call"}</div>
      {c ? (
        <>
          <Link href={`/admin/calls/${c.id}`}>
            <b>
              {c.call_date || c.created_at.slice(0, 10)}
              {c.client_label ? ` · ${c.client_label}` : ""}
            </b>
          </Link>
          <p className="muted" style={{ margin: "2px 0 6px" }}>
            {clock(c.duration_secs)} · {OUTCOME_LABEL[c.outcome as Outcome] ?? "--"}
            {c.retention ? ` · ${RETENTION_LABEL[c.retention]}` : ""}
          </p>
          <Player call={c} supabase={supabase} onEl={(el) => (urls.current[which] = el)} />
        </>
      ) : (
        <p className="muted">No call chosen yet.</p>
      )}
      {picks.length > 0 && picker(which)}
    </div>
  );

  const row = (label: string, a: ReactNode, b: ReactNode) => (
    <tr>
      <th>{label}</th>
      <td>{a}</td>
      <td>{b}</td>
    </tr>
  );
  const pill = (n: number | null | undefined) => (typeof n === "number" ? <span className={`pill ${scoreBand(n)}`}>{n}</span> : <span className="muted">--</span>);
  const hs = (c: Call | null) => {
    const h = c?.grade?.spotlights?.hardship;
    if (!h) return <span className="muted">--</span>;
    return (
      <>
        {pill(h.score ?? hardshipScoreOf(h.parts))} <span className="muted">moved on at</span> {time(c === A ? "a" : "b", h.moved_on_at)}
      </>
    );
  };
  const tens = (c: Call | null) => {
    const t = c?.grade?.three_tens;
    return t ? `Product ${t.product ?? "-"} · Rep ${t.rep ?? "-"} · Company ${t.company ?? "-"}` : "--";
  };
  const close = (c: Call | null) => {
    const q = c?.grade?.close_quality;
    return q && q !== "n/a" ? <span className={`pill ${q === "solid" ? "good" : q === "fragile" ? "poor" : "fair"}`}>{q}</span> : <span className="muted">--</span>;
  };

  return (
    <main className="shell calls-shell">
      <Link className="btn" href={A?.rep_id || B?.rep_id ? `/admin/reps/${A?.rep_id || B?.rep_id}` : "/admin/calls"} style={{ textDecoration: "none" }}>
        ← {A?.profiles?.full_name || B?.profiles?.full_name || "Back"}
      </Link>
      <h1 style={{ marginTop: 14 }}>Compare calls</h1>
      {note && <p className="hint">{note}</p>}
      {error && <div className="error">{error}</div>}

      <div className="rx-grid2" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 14 }}>
        {head(A, "a")}
        {head(B, "b")}
      </div>

      {A && B && (
        <>
          <section className="card" style={{ marginTop: 14 }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <b>What&rsquo;s the difference?</b>
              <button className="primary" onClick={() => void difference()} disabled={busy}>
                {busy ? "Reading both calls…" : `${diff ? "Read it again" : "Explain it"}${est !== null ? ` · about ${usd(est)}` : ""}`}
              </button>
            </div>
            {diff ? (
              <div style={{ marginTop: 10 }}>
                {diff
                  .split("\n")
                  .filter((l) => l.trim())
                  .map((l, i) => (
                    <p key={i} style={{ margin: "6px 0" }}>
                      {linked(l.replace(/^-\s*/, "• "))}
                    </p>
                  ))}
              </div>
            ) : (
              <p className="hint" style={{ margin: "6px 0 0" }}>
                Where the compared call went off against the best one, with the moment on each call to play.
              </p>
            )}
          </section>

          <div className="rx-scroll" style={{ marginTop: 14 }}>
            <table className="cmp-table">
              <thead>
                <tr>
                  <th />
                  <th>Best</th>
                  <th>This call</th>
                </tr>
              </thead>
              <tbody>
                {row("Straight Line", pill(A.slp_score), pill(B.slp_score))}
                {row("Script", pill(A.score), pill(B.score))}
                {row("Close", close(A), close(B))}
                {row("Hardship", hs(A), hs(B))}
                {row("Staying on the line", pill(A.grade?.line_control?.score), pill(B.grade?.line_control?.score))}
                {row("Three Tens", tens(A), tens(B))}
                <tr>
                  <th colSpan={3} className="cmp-sub">
                    Script sections
                  </th>
                </tr>
                {sections.map((name) => {
                  const sa = A.grade?.sections.find((s) => s.section === name);
                  const sb = B.grade?.sections.find((s) => s.section === name);
                  const cell = (s: typeof sa, w: "a" | "b") =>
                    s ? (
                      <>
                        <span className={`pill ${BAND[s.status] ?? ""}`}>{STATUS[s.status] ?? s.status}</span> {time(w, s.time)}
                      </>
                    ) : (
                      <span className="muted">--</span>
                    );
                  return row(name, cell(sa, "a"), cell(sb, "b"));
                })}
              </tbody>
            </table>
          </div>

          <h2 style={{ marginTop: 18 }}>Turning points</h2>
          <div className="rx-grid2" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 14 }}>
            {(["a", "b"] as const).map((w) => {
              const c = w === "a" ? A : B;
              const tps = c.grade?.turning_points ?? [];
              return (
                <div key={w} className="card" style={{ margin: 0 }}>
                  <div className="eyebrow">{w === "a" ? "Best" : "This call"}</div>
                  {tps.length ? (
                    tps.map((p, i) => (
                      <p key={i} style={{ margin: "6px 0" }}>
                        {time(w, p.time)} <span className={`pill ${p.direction === "toward" ? "good" : "poor"}`}>{p.direction === "toward" ? "toward" : "away"}</span> {p.moment}
                      </p>
                    ))
                  ) : (
                    <p className="muted">None recorded.</p>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
      <style>{`
        .cmp-table { width: 100%; border-collapse: collapse; }
        .cmp-table th, .cmp-table td { text-align: left; padding: 8px; border-bottom: 1px solid var(--line); vertical-align: middle; }
        .cmp-table thead th { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; }
        .cmp-table tbody th { font-weight: 600; width: 34%; }
        .cmp-table .cmp-sub { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; padding-top: 16px; }
        .cmp-time { padding: 1px 7px; font-size: 12px; border-radius: 999px; font-variant-numeric: tabular-nums; }
      `}</style>
    </main>
  );
}

function Player({ call, supabase, onEl }: { call: Call; supabase: ReturnType<typeof createClient>; onEl: (el: HTMLAudioElement | null) => void }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!call.audio_path) return setUrl("");
    void supabase.storage
      .from("call-audio")
      .createSignedUrl(call.audio_path, 3600)
      .then(({ data }) => setUrl(data?.signedUrl || ""));
  }, [supabase, call.audio_path]);
  if (!call.audio_path) return <p className="hint">The recording was deleted; the grade is still here.</p>;
  return url ? <audio ref={onEl} src={url} controls preload="none" className="player" style={{ width: "100%" }} /> : null;
}

