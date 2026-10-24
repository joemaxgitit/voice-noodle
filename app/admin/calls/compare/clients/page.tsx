"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { clock, ENDED_LABEL, OUTCOME_LABEL, RETENTION_LABEL, scoreBand, type Ended, type Outcome, type Retention } from "@/lib/calls";
import { clientKey, journeyStatus, numbered, type JourneyCall } from "@/lib/journey";
import { okToSpend, usd, useEstimate } from "@/lib/spend";
import type { JourneyRead } from "@/app/api/journeys/read/route";
import "../../calls.css";

/*
  Two clients' whole journeys side by side -- every call with that client ID,
  in order -- so a manager can see how one lead was walked to a sale (or lost)
  against another: how many calls, how far apart, what stalled each time,
  where it was decided. "Explain it" reads both journeys and says what the
  stronger one did across the calls that the other didn't.
*/

type Row = JourneyCall & {
  duration_secs: number | null;
  rep_name: string | null;
  profiles: { full_name: string | null } | null;
  close_quality: string | null;
  stall: string | null;
  next_step: string | null;
  fu: string | null;
  ended: Ended | null;
};
type Side = { label: string; calls: (Row & { n: number })[]; read: JourneyRead | null };
type Opt = { key: string; label: string; rep: string; n: number; status: string; retention: Retention | null };

const COLS =
  "id, client_label, call_date, call_time, created_at, call_number, handoff, rep_id, rep_name, status, outcome, outcome_manual, retention, score, slp_score, duration_secs, profiles:rep_id(full_name), close_quality:grade->>close_quality, stall:grade->spotlights->followup->>stall_stated, next_step:grade->spotlights->followup->>next_step_detail, fu:grade->spotlights->followup->>kind, ended:grade->ended";

export default function ClientsPage() {
  return (
    <Suspense fallback={null}>
      <Clients />
    </Suspense>
  );
}

function Clients() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const sp = useSearchParams();
  const a = sp.get("a") ?? "";
  const b = sp.get("b") ?? "";
  const [rep, setRep] = useState(sp.get("rep") ?? "");
  const [opts, setOpts] = useState<Opt[]>([]);
  const [reps, setReps] = useState<{ id: string; name: string }[]>([]);
  const [sides, setSides] = useState<{ a: Side | null; b: Side | null }>({ a: null, b: null });
  const [error, setError] = useState("");
  const est = useEstimate(supabase, "compare");
  const [diff, setDiff] = useState("");
  const [busy, setBusy] = useState(false);

  const go = (na: string, nb: string, r = rep) => router.replace(`/admin/calls/compare/clients?${new URLSearchParams({ ...(na ? { a: na } : {}), ...(nb ? { b: nb } : {}), ...(r ? { rep: r } : {}) })}`);

  // Every client ID with graded calls, for the two pickers.
  useEffect(() => {
    void (async () => {
      const { data, error: e } = await supabase
        .from("calls")
        .select("id, client_label, call_date, created_at, rep_id, rep_name, status, outcome, outcome_manual, retention, score, slp_score, handoff, profiles:rep_id(full_name)")
        .neq("source", "roleplay")
        .eq("status", "graded")
        .not("client_label", "is", null)
        .limit(5000);
      if (e) return setError(e.message);
      const by = new Map<string, Row[]>();
      for (const c of (data || []) as unknown as Row[]) {
        const k = clientKey(c.client_label);
        if (!k) continue;
        by.set(k, [...(by.get(k) ?? []), c]);
      }
      const o: Opt[] = [...by.entries()].map(([k, cs]) => {
        const st = journeyStatus(cs);
        return {
          key: k,
          label: cs[0].client_label!.trim(),
          rep: cs.find((c) => c.rep_id === rep)?.profiles?.full_name || cs[0].profiles?.full_name || cs[0].rep_name || "A rep",
          n: cs.length,
          status: st,
          retention: (cs.find((c) => c.retention)?.retention as Retention | undefined) ?? null,
        };
      });
      const repIds = new Map<string, string>();
      for (const cs of by.values()) for (const c of cs) if (c.rep_id) repIds.set(c.rep_id, c.profiles?.full_name || "A rep");
      setReps([...repIds].map(([id, name]) => ({ id, name })).sort((x, y) => x.name.localeCompare(y.name)));
      setOpts(
        o
          .map((x) => ({ ...x, reps: by.get(x.key)!.map((c) => c.rep_id) }))
          .filter((x) => !rep || x.reps.includes(rep))
          .sort((x, y) => y.n - x.n || x.label.localeCompare(y.label))
      );
    })();
  }, [supabase, rep]);

  // The two journeys.
  useEffect(() => {
    void (async () => {
      setDiff("");
      const load = async (label: string): Promise<Side | null> => {
        if (!label) return null;
        const [{ data }, jr] = await Promise.all([
          supabase.from("calls").select(COLS).ilike("client_label", label).neq("source", "roleplay"),
          supabase.from("client_journeys").select("read").eq("client_key", clientKey(label)).maybeSingle(),
        ]);
        return { label, calls: numbered((data || []) as unknown as Row[]), read: ((jr.data as { read: JourneyRead } | null)?.read as JourneyRead) ?? null };
      };
      const [sa, sb] = await Promise.all([load(a), load(b)]);
      setSides({ a: sa, b: sb });
    })();
  }, [supabase, a, b]);

  async function explain() {
    if (!a || !b) return;
    if (!(await okToSpend(supabase, (est ?? 0.05) * 2, "Comparing two client journeys"))) return;
    setBusy(true);
    setError("");
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    const res = await fetch("/api/calls/compare", { method: "POST", headers: { Authorization: `Bearer ${token ?? ""}`, "Content-Type": "application/json" }, body: JSON.stringify({ clientA: a, clientB: b }) }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) return setError(body?.error || "Couldn't compare the journeys.");
    setDiff(body.text || "");
  }

  const span = (s: Side) => {
    const ds = s.calls.map((c) => c.call_date || c.created_at.slice(0, 10)).sort();
    if (ds.length < 2) return "one call";
    const days = Math.round((new Date(`${ds[ds.length - 1]}T12:00:00`).getTime() - new Date(`${ds[0]}T12:00:00`).getTime()) / 86400000);
    return `${s.calls.length} calls over ${days} day${days === 1 ? "" : "s"}`;
  };
  const result = (s: Side) => {
    const won = s.calls.find((c) => (c.outcome_manual || c.outcome) === "enrolled");
    const st = journeyStatus(s.calls);
    return won ? `Enrolled on call ${won.n}` : st === "renew" ? "Went to renew" : "Still open";
  };
  const avg = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => typeof x === "number");
    return v.length ? Math.round(v.reduce((p, q) => p + q, 0) / v.length) : null;
  };

  const picker = (which: "a" | "b") => (
    <select value={(which === "a" ? a : b) || ""} onChange={(e) => (which === "a" ? go(e.target.value, b) : go(a, e.target.value))}>
      <option value="">{which === "a" ? "Choose a client (the model journey)…" : "Choose a client to compare…"}</option>
      {opts.map((o) => (
        <option key={o.key} value={o.label}>
          {o.label} · {o.rep} · {o.n} call{o.n === 1 ? "" : "s"} · {o.status === "enrolled" ? "enrolled" : o.status === "renew" ? "renew" : "open"}
          {o.retention ? ` · ${RETENTION_LABEL[o.retention].toLowerCase()}` : ""}
        </option>
      ))}
    </select>
  );

  const head = (s: Side | null, which: "a" | "b") => (
    <div className="card" style={{ margin: 0 }}>
      <div className="eyebrow">{which === "a" ? "Model journey" : "Compared journey"}</div>
      {picker(which)}
      {s && (
        <>
          <p style={{ margin: "10px 0 4px" }}>
            <b>{result(s)}</b>
            {s.calls.find((c) => c.retention) ? ` · ${RETENTION_LABEL[s.calls.find((c) => c.retention)!.retention as Retention]}` : ""}
          </p>
          <p className="muted" style={{ margin: 0 }}>
            {span(s)} · reps: {[...new Set(s.calls.map((c) => c.profiles?.full_name || c.rep_name || "A rep"))].join(", ")}
          </p>
          <div className="row" style={{ gap: 6, marginTop: 8 }}>
            <span className={`pill ${scoreBand(avg(s.calls.map((c) => c.slp_score)))}`}>avg SLP {avg(s.calls.map((c) => c.slp_score)) ?? "--"}</span>
            <span className={`pill ${scoreBand(avg(s.calls.map((c) => c.score)))}`}>avg Script {avg(s.calls.map((c) => c.score)) ?? "--"}</span>
          </div>
        </>
      )}
    </div>
  );

  const cell = (c: (Row & { n: number }) | undefined) =>
    c ? (
      <div>
        <Link href={`/admin/calls/${c.id}`}>
          {c.call_date || c.created_at.slice(0, 10)} · {clock(c.duration_secs)}
        </Link>{" "}
        <span className="muted">· {c.profiles?.full_name || c.rep_name || "A rep"}</span>
        <div className="row" style={{ gap: 6, margin: "4px 0", flexWrap: "wrap" }}>
          <span className="pill">{OUTCOME_LABEL[(c.outcome_manual || c.outcome) as Outcome] ?? (c.status === "graded" ? "--" : c.status)}</span>
          {c.slp_score !== null && <span className={`pill ${scoreBand(c.slp_score)}`}>SLP {c.slp_score}</span>}
          {c.score !== null && <span className={`pill ${scoreBand(c.score)}`}>Script {c.score}</span>}
          {c.close_quality && c.close_quality !== "n/a" && <span className={`pill ${c.close_quality === "solid" ? "good" : c.close_quality === "fragile" ? "poor" : "fair"}`}>{c.close_quality} close</span>}
        </div>
        {c.stall && <small className="muted">Stalled on: &ldquo;{c.stall}&rdquo;{c.next_step ? ` · next: ${c.next_step}` : ""}</small>}
        {c.ended?.early && (
          <div>
            <small className="muted">
              {ENDED_LABEL[c.ended.why]} · handled {c.ended.handled}
            </small>
          </div>
        )}
      </div>
    ) : (
      <span className="muted">--</span>
    );

  const rows = Math.max(sides.a?.calls.length ?? 0, sides.b?.calls.length ?? 0);
  const readBlock = (s: Side | null) =>
    s?.read ? (
      <div className="card" style={{ margin: 0 }}>
        <p style={{ marginTop: 0 }}>{s.read.story}</p>
        <p style={{ margin: "4px 0" }}>
          <b>What decided it:</b> {s.read.decided_it}
        </p>
        {s.read.disconnects.length > 0 && (
          <>
            <small style={{ fontWeight: 600, color: "var(--bad)" }}>What broke between calls</small>
            <ul className="plain-list" style={{ marginTop: 2 }}>
              {s.read.disconnects.map((d, i) => (
                <li key={i}>
                  <b>{d.what}</b> <small className="muted">· calls {d.calls}</small>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    ) : (
      <div className="card" style={{ margin: 0 }}>
        <p className="hint" style={{ margin: 0 }}>{s ? "No journey read yet -- it's written once a client has two graded calls." : ""}</p>
      </div>
    );

  return (
    <main className="shell calls-shell">
      <Link className="btn" href={rep ? `/admin/reps/${rep}` : "/admin/calls"} style={{ textDecoration: "none" }}>
        ← Back
      </Link>
      <h1 style={{ marginTop: 14 }}>Compare client journeys</h1>
      <p className="hint" style={{ marginTop: -4 }}>
        Every call with each client ID, in order: how the lead was walked to a sale (or lost) across the calls. Want two single calls instead?{" "}
        <Link href="/admin/calls/compare">Compare calls</Link>
      </p>
      <label className="field" style={{ maxWidth: 320 }}>
        <span>Clients of</span>
        <select
          value={rep}
          onChange={(e) => {
            setRep(e.target.value);
            go(a, b, e.target.value);
          }}
        >
          <option value="">Every rep</option>
          {reps.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      {error && <div className="error">{error}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 14 }}>
        {head(sides.a, "a")}
        {head(sides.b, "b")}
      </div>

      {sides.a && sides.b && (
        <>
          <section className="card" style={{ marginTop: 14 }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <b>What&rsquo;s the difference?</b>
              <button className="primary" onClick={() => void explain()} disabled={busy}>
                {busy ? "Reading both journeys…" : `${diff ? "Read it again" : "Explain it"}${est !== null ? ` · about ${usd(est * 2)}` : ""}`}
              </button>
            </div>
            {diff ? (
              <div style={{ marginTop: 10 }}>
                {diff
                  .split("\n")
                  .filter((l) => l.trim())
                  .map((l, i) => (
                    <p key={i} style={{ margin: "6px 0" }}>
                      {l.replace(/^-\s*/, "• ")}
                    </p>
                  ))}
              </div>
            ) : (
              <p className="hint" style={{ margin: "6px 0 0" }}>What the model journey did across its calls that the other didn&rsquo;t -- re-opening, handling the stall, timing, re-anchoring the pain.</p>
            )}
          </section>

          <div className="rx-scroll" style={{ marginTop: 14 }}>
            <table className="cmp-table">
              <thead>
                <tr>
                  <th />
                  <th>{sides.a.label}</th>
                  <th>{sides.b.label}</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: rows }, (_, i) => (
                  <tr key={i}>
                    <th>Call {i + 1}</th>
                    <td>{cell(sides.a!.calls[i])}</td>
                    <td>{cell(sides.b!.calls[i])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 style={{ marginTop: 18 }}>The journey so far</h2>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 14 }}>
            {readBlock(sides.a)}
            {readBlock(sides.b)}
          </div>
        </>
      )}
      <style>{`
        .cmp-table { width: 100%; border-collapse: collapse; }
        .cmp-table th, .cmp-table td { text-align: left; padding: 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
        .cmp-table thead th { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; }
        .cmp-table tbody th { font-weight: 600; width: 80px; white-space: nowrap; }
      `}</style>
    </main>
  );
}
