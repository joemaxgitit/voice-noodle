"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { clientKey, numbered } from "@/lib/journey";
import { TEAM_MIN_REPS, type TeamPattern } from "@/lib/fingerprint";
import { okToSpend } from "@/lib/spend";
import { asProven, compare, favouring, formatValue, MIN_FOR_FINDINGS, type InsightCall, type Metric } from "@/lib/insights";
import Archetypes from "./Archetypes";
import GradingRules from "./GradingRules";
import { plainCounts } from "@/lib/plain";
import "../calls.css";
import "../../reps/reps.css";

type Correction = {
  id: string;
  call_id: string;
  item_kind: string;
  item_label: string | null;
  original: string;
  correction: string;
  created_at: string;
};

function Gap({ m }: { m: Metric }) {
  const f = favouring(m);
  if (f === null) return <span className="muted">&ndash;</span>;
  const w = Math.min(100, Math.abs(f));
  return (
    <span className="gap">
      <span className={`gap-bar ${f >= 0 ? "toward" : "away"}`} style={{ width: `${w}%` }} />
      <span className="gap-n">
        {f >= 0 ? "+" : "−"}
        {Math.abs(Math.round(f))}
      </span>
    </span>
  );
}

/**
 * Insights & tuning: what separates graduates' enrollment calls from cancels,
 * the lessons a manager approved from that, and every correction managers
 * have made to a grade. Lessons and corrections both feed every future grade.
 */
export default function Insights() {
  const supabase = createClient();
  const [calls, setCalls] = useState<InsightCall[]>([]);
  const [fixes, setFixes] = useState<Correction[]>([]);
  // The newest 5 corrections; "Show 10 more" for the rest.
  const [fixN, setFixN] = useState(5);
  const [saved, setSaved] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  // Team-proven patterns: what works in proven sales across 3+ reps.
  const [team, setTeam] = useState<{ body: { patterns: TeamPattern[]; reps?: number }; created_at: string } | null>(null);
  const [teamBusy, setTeamBusy] = useState(false);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const loadTeam = useCallback(async () => {
    const { data } = await supabase.from("team_patterns").select("body, created_at").order("created_at", { ascending: false }).limit(1).maybeSingle();
    setTeam((data as typeof team) ?? null);
    const { data: p } = await supabase.from("profiles").select("id, full_name");
    setNames(new Map(((p || []) as { id: string; full_name: string | null }[]).map((x) => [x.id, (x.full_name || "").split(" ")[0]])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    void loadTeam();
  }, [loadTeam]);
  async function findTeam() {
    if (!(await okToSpend(supabase, 0.05, "Finding team patterns"))) return;
    setTeamBusy(true);
    setError("");
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const res = await fetch("/api/team/patterns", { method: "POST", headers: { Authorization: `Bearer ${session?.access_token ?? ""}`, "Content-Type": "application/json" }, body: "{}" }).catch(() => null);
    const b = res ? await res.json().catch(() => ({})) : {};
    setTeamBusy(false);
    if (!res?.ok) return setError(b?.error || "Couldn't find team patterns.");
    await loadTeam();
  }

  // The follow-up game: journeys by client ID.
  type FCall = { id: string; client_label: string | null; call_date: string | null; created_at: string; outcome: string | null; outcome_manual: string | null; retention: string | null; call_number?: number | null; kind: string | null; gtb: string | null; next: string | null; repeat: boolean | null; ended_open: boolean | null };
  // Second chances: journeys where a renew followed a call that didn't close.
  const [renews, setRenews] = useState<{ client_key: string; updated_at: string; read: { renew?: { applies?: boolean; first_stall?: string; really?: string; what_moved?: string; lesson?: string; renew_outcome?: string | null; first_rep_id?: string | null; renew_rep_id?: string | null; same_rep?: boolean } } }[]>([]);
  useEffect(() => {
    void supabase
      .from("client_journeys")
      .select("client_key, updated_at, read")
      .eq("read->renew->>applies", "true")
      .order("updated_at", { ascending: false })
      .limit(200)
      .then(({ data }) => setRenews((data || []) as typeof renews));
  }, [supabase]);
  const [fcalls, setFcalls] = useState<FCall[]>([]);
  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from("calls")
        .select("id, client_label, call_date, created_at, outcome, outcome_manual, retention, kind:grade->spotlights->followup->>kind, gtb:grade->spotlights->followup->>got_to_bottom, next:grade->spotlights->followup->>next_step, repeat:grade->spotlights->followup->repeat_stall, ended_open:grade->spotlights->followup->ended_open")
        .neq("source", "roleplay")
        .eq("status", "graded")
        .not("client_label", "is", null)
        .limit(2000);
      const nums = await supabase.from("calls").select("id, call_number").not("call_number", "is", null).limit(2000);
      const num = new Map(((nums.data || []) as { id: string; call_number: number }[]).map((x) => [x.id, x.call_number]));
      setFcalls(((data || []) as unknown as FCall[]).map((c) => ({ ...c, call_number: num.get(c.id) ?? null })));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Spotlights vs results: does time in hardship and the turndown pickup line up with enrollments on real calls?
  const [spot, setSpot] = useState<{ outcome: string | null; manual: string | null; hs: number | null; pickup: string | null; even: string | null }[]>([]);

  const load = useCallback(async () => {
    const [c, f, g] = await Promise.all([
      supabase
        .from("calls")
        .select("id, retention, score, slp_score, grade")
        .in("retention", ["graduated", "paid6", "cancelled"])
        .not("grade", "is", null)
        .order("created_at", { ascending: false })
        .limit(400),
      supabase
        .from("call_corrections")
        .select("id, call_id, item_kind, item_label, original, correction, created_at")
        .order("created_at", { ascending: false })
        .limit(1000),
      supabase.from("grading_guidance").select("lessons").maybeSingle(),
    ]);
    if (c.error) setError(c.error.message);
    else if (f.error) setError(`${f.error.message} -- has the calls-learning SQL been run?`);
    // "Made 6+ payments" counts as a proven sale, the same as graduated.
    setCalls(asProven((c.data || []) as unknown as (InsightCall & { retention: string })[]) as InsightCall[]);
    setFixes((f.data || []) as Correction[]);
    const lessons = plainCounts((g.data?.lessons as string | null) ?? "");
    setSaved(lessons);
    setDraft(lessons);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void load();
    void supabase
      .from("calls")
      .select("outcome, outcome_manual, hs:grade->spotlights->hardship->moved_on_at, hst:grade->spotlights->hardship->>target, pickup:grade->spotlights->turndown->>pickup, even:grade->spotlights->turndown->>options_even")
      .neq("source", "roleplay")
      .eq("status", "graded")
      .not("grade->spotlights", "is", null)
      .order("created_at", { ascending: false })
      .limit(1000)
      // The 8-12 minute bins are about first calls: a renew's hardship (2-4 minute target) is left out of them.
      .then(({ data }) => setSpot(((data || []) as { outcome: string | null; outcome_manual: string | null; hs: number | null; hst: string | null; pickup: string | null; even: string | null }[]).map((x) => ({ ...x, hs: x.hst === "renew" ? null : x.hs, manual: x.outcome_manual }))));
  }, [load, supabase]);

  const nG = calls.filter((c) => c.retention === "graduated").length;
  const nC = calls.filter((c) => c.retention === "cancelled").length;
  const metrics = useMemo(() => compare(calls), [calls]);
  const top = useMemo(
    () =>
      metrics
        .filter((m) => m.gap !== null && m.nGraduated > 0 && m.nCancelled > 0)
        .sort((a, b) => Math.abs(favouring(b) ?? 0) - Math.abs(favouring(a) ?? 0))
        .slice(0, 6),
    [metrics]
  );
  const groups = useMemo(() => {
    const by = new Map<string, Metric[]>();
    for (const m of metrics) by.set(m.group, [...(by.get(m.group) || []), m]);
    return [...by.entries()];
  }, [metrics]);

  async function draftLessons() {
    setError("");
    setNote("");
    setBusy("Drafting from the graded calls... (about a minute)");
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Your session has expired. Sign in again.");
      const res = await fetch("/api/calls/lessons", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `Request failed (${res.status}).`);
      setDraft(plainCounts(body.draft || ""));
      setNote("Draft ready. Edit it, delete anything you don't agree with, then press Save. Nothing is used until you save.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy("");
  }

  async function saveLessons(text: string) {
    setError("");
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const { data: me } = await supabase
      .from("profiles")
      .select("org_id")
      .eq("id", session?.user.id ?? "")
      .single();
    if (!me?.org_id) {
      setError("Could not find your organization.");
      return;
    }
    const { error } = await supabase.from("grading_guidance").upsert({
      org_id: me.org_id,
      lessons: text.trim() || null,
      updated_by: session?.user.id ?? null,
      updated_at: new Date().toISOString(),
    });
    if (error) {
      setError(error.message);
      return;
    }
    setSaved(text.trim());
    setDraft(text.trim());
    setNote(text.trim() ? "Saved. Every grade from now on uses these lessons." : "Lessons cleared.");
  }

  async function removeFix(id: string) {
    if (!confirm("Delete this correction? Future grades will stop using it.")) return;
    const { error } = await supabase.from("call_corrections").delete().eq("id", id);
    if (error) setError(error.message);
    else setFixes((f) => f.filter((x) => x.id !== id));
  }

  if (loading) {
    return (
      <main className="shell calls-shell">
        <p className="muted">Loading&hellip;</p>
      </main>
    );
  }

  return (
    <main className="shell calls-shell">

      <div className="eyebrow">
        {nG} proven (graduated or 6+ payments) &middot; {nC} cancelled &middot; {fixes.length} correction{fixes.length === 1 ? "" : "s"}
      </div>
      <h1>Insights &amp; tuning</h1>
      <p className="muted">
        What was different about the enrollment calls of proven sales (graduated or made 6+ payments) and clients who cancelled, and what the
        grader has been taught. Approved lessons and corrections are added to every grade.
      </p>
      {error && <div className="error">{error}</div>}
      {note && <div className="note">{note}</div>}

      <Archetypes />

      <h2>Team patterns</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Things that show up in proven sales (graduated or 6+ payments) across {TEAM_MIN_REPS} or more reps, found from each rep&rsquo;s &ldquo;Style that works&rdquo;.
        They&rsquo;re offered to reps as things worth trying when they fit their style -- never required.
      </p>
      {team?.body.patterns.length ? (
        <div style={{ display: "grid", gap: 10 }}>
          {team.body.patterns.map((p, i) => (
            <section key={i} className="card">
              <b>{p.pattern}</b> <small className="muted">· works for {p.reps.map((r) => names.get(r) || "a rep").join(", ")}</small>
              <div>{p.how_it_sounds}</div>
              <small className="muted">{p.evidence}</small>
            </section>
          ))}
          <small className="muted">Found {new Date(team.created_at).toLocaleDateString()} from {team.body.reps ?? "?"} reps&rsquo; styles.</small>
        </div>
      ) : (
        <p className="hint">{team ? "No pattern reached 3 reps yet." : "Not looked for yet."}</p>
      )}
      <button onClick={() => void findTeam()} disabled={teamBusy} style={{ marginTop: 8 }}>
        {teamBusy ? "Looking across reps…" : `${team ? "Refresh" : "Find"} team patterns · about $0.05`}
      </button>

      <h2>The follow-up game</h2>
      {(() => {
        const byClient = new Map<string, FCall[]>();
        for (const c of fcalls) {
          const k = clientKey(c.client_label);
          if (!k) continue;
          byClient.set(k, [...(byClient.get(k) || []), c]);
        }
        const won = (c: FCall) => (c.outcome_manual || c.outcome) === "enrolled";
        const journeys = [...byClient.values()].map((cs) => numbered(cs.map((c) => ({ ...c, rep_id: null, status: "graded", score: null, slp_score: null }))));
        const closes = journeys.flatMap((j) => j.filter((c) => won(c as unknown as FCall)));
        const at = (lo: number, hi: number) => closes.filter((c) => c.n >= lo && c.n <= hi);
        const proven = (xs: typeof closes) => xs.filter((c) => c.retention === "graduated" || c.retention === "paid6").length;
        const cancelled = (xs: typeof closes) => xs.filter((c) => c.retention === "cancelled").length;
        // Calls that ended open, and whether that client enrolled later.
        const open = journeys.flatMap((j) => j.filter((c) => (c as unknown as FCall).ended_open).map((c) => ({ c: c as unknown as FCall, later: j.some((x) => x.n > c.n && won(x as unknown as FCall)) })));
        const rate = (xs: typeof open) => (xs.length ? `${Math.round((xs.filter((x) => x.later).length / xs.length) * 100)}%` : "--");
        if (!closes.length && !open.length)
          return <p className="muted">Give calls a client ID (and a Call # if you know it). As journeys build up, this shows which call enrollments happen on, whether they last, and what in a call that doesn&rsquo;t close leads to a yes later.</p>;
        const row = (label: string, xs: typeof open) => (
          <tr key={label}>
            <td>{label}</td>
            <td className="num">{xs.length} calls</td>
            <td className="num">
              <b>{rate(xs)}</b> enrolled later
            </td>
          </tr>
        );
        return (
          <div className="rx-grid2">
            <section className="card">
              <b>Which call the enrollment happened on</b>
              <table className="rx-table" style={{ marginTop: 6 }}>
                <tbody>
                  {[
                    ["Call 1 (one-call close)", 1, 1],
                    ["Call 2", 2, 2],
                    ["Call 3", 3, 3],
                    ["Call 4+", 4, 99],
                  ].map(([label, lo, hi]) => {
                    const xs = at(lo as number, hi as number);
                    return (
                      <tr key={label as string}>
                        <td>{label}</td>
                        <td className="num">
                          <b>{xs.length}</b> enrolled
                        </td>
                        <td className="num">
                          {proven(xs)} proven · {cancelled(xs)} cancelled
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
            <section className="card">
              <b>Calls that didn&rsquo;t close -- what led to a yes later</b>
              <table className="rx-table" style={{ marginTop: 6 }}>
                <tbody>
                  {row("Rep got to the bottom of the stall", open.filter((x) => x.c.gtb === "yes"))}
                  {row("Rep accepted the brush-off", open.filter((x) => x.c.gtb === "no"))}
                  {row("A specific next step was set", open.filter((x) => x.c.next === "set"))}
                  {row("Next step vague or none", open.filter((x) => x.c.next === "vague" || x.c.next === "none"))}
                  {row("Same stall as an earlier call", open.filter((x) => x.c.repeat))}
                </tbody>
              </table>
            </section>
          </div>
        );
      })()}

      <h2>Second chances (renews)</h2>
      {(() => {
        if (!renews.length)
          return <p className="muted">When a renew is uploaded with the same client ID as an earlier call that didn&rsquo;t close, the journey read shows why the first call stalled and what moved them on the renew. They collect here. Patterns get reliable at around 15&ndash;20 renews.</p>;
        const closed = renews.filter((r) => r.read.renew?.renew_outcome === "enrolled").length;
        const who = (id?: string | null) => (id ? names.get(id) ?? "a rep" : "a rep");
        return (
          <section className="card">
            <b>
              {renews.length} renew{renews.length === 1 ? "" : "s"} of leads that didn&rsquo;t close the first time · {closed} enrolled on the renew
            </b>
            <table className="rx-table" style={{ marginTop: 6 }}>
              <thead>
                <tr>
                  <th>First call stalled on</th>
                  <th>Really underneath</th>
                  <th>What moved them</th>
                  <th>Reps</th>
                </tr>
              </thead>
              <tbody>
                {renews.slice(0, 25).map((r) => {
                  const x = r.read.renew!;
                  return (
                    <tr key={r.client_key}>
                      <td>{x.first_stall || "--"}</td>
                      <td>{x.really || "--"}</td>
                      <td>
                        {x.what_moved || "--"}
                        {x.renew_outcome && <small className={`pill ${x.renew_outcome === "enrolled" ? "good" : ""}`} style={{ marginLeft: 6 }}>{x.renew_outcome}</small>}
                      </td>
                      <td>
                        <small>{x.same_rep ? `${who(x.first_rep_id)} both times` : `${who(x.first_rep_id)} → ${who(x.renew_rep_id)}`}</small>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        );
      })()}

      <h2>Spotlights vs results</h2>
      {(() => {
        const won = (x: (typeof spot)[number]) => (x.manual || x.outcome) === "enrolled";
        const rate = (xs: typeof spot) => (xs.length ? `${Math.round((xs.filter(won).length / xs.length) * 100)}%` : "--");
        const bands = [
          { label: "Under 5 min", f: (m: number) => m < 5 },
          { label: "5–8 min", f: (m: number) => m >= 5 && m < 8 },
          { label: "8–12 min (target)", f: (m: number) => m >= 8 && m <= 12 },
          { label: "Over 12 min", f: (m: number) => m > 12 },
        ];
        const withHs = spot.filter((x) => typeof x.hs === "number" && x.hs > 0);
        const td = spot.filter((x) => x.pickup && x.pickup !== "n/a");
        if (!withHs.length)
          return <p className="muted">Real calls graded from now on show how long the rep stayed in hardship and how they picked the client up after the loan turndown. Once there are some, this shows which actually goes with enrollments on your calls.</p>;
        return (
          <>
            <p className="muted" style={{ marginTop: 0 }}>
              From {spot.length} graded real call{spot.length === 1 ? "" : "s"}. This only measures -- it never changes a grade -- so your own calls show whether the 8–12 minute target and a strong pickup hold up.
            </p>
            <div className="rx-grid2">
              <section className="card">
                <b>Time in hardship before moving on</b>
                <table className="rx-table" style={{ marginTop: 6 }}>
                  <tbody>
                    {bands.map((b) => {
                      const xs = withHs.filter((x) => b.f((x.hs as number) / 60));
                      return (
                        <tr key={b.label}>
                          <td>{b.label}</td>
                          <td className="num">{xs.length} calls</td>
                          <td className="num">
                            <b>{rate(xs)}</b> enrolled
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </section>
              <section className="card">
                <b>After the loan turndown</b>
                <table className="rx-table" style={{ marginTop: 6 }}>
                  <tbody>
                    {(["strong", "ok", "flat"] as const).map((k) => {
                      const xs = td.filter((x) => x.pickup === k);
                      return (
                        <tr key={k}>
                          <td>Pickup {k}</td>
                          <td className="num">{xs.length} calls</td>
                          <td className="num">
                            <b>{rate(xs)}</b> enrolled
                          </td>
                        </tr>
                      );
                    })}
                    {(["yes", "no"] as const).map((k) => {
                      const xs = td.filter((x) => x.even === k);
                      return (
                        <tr key={`e${k}`}>
                          <td>Options laid out evenly: {k}</td>
                          <td className="num">{xs.length} calls</td>
                          <td className="num">
                            <b>{rate(xs)}</b> enrolled
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </section>
            </div>
          </>
        );
      })()}

      <h2>Proven sales vs cancels</h2>
      {nG === 0 || nC === 0 ? (
        <p className="muted">
          Upload enrollment calls of proven sales and clients who cancelled, grade them, then set Retention on
          each call to <strong>Graduated</strong>, <strong>Made 6+ payments</strong> or <strong>Cancelled</strong>. The comparison appears here once there is
          at least one of each.
        </p>
      ) : (
        <>
          {(nG < MIN_FOR_FINDINGS || nC < MIN_FOR_FINDINGS) && (
            <div className="note" style={{ marginTop: 0 }}>
              Early days: {nG} proven and {nC} cancelled. Treat these differences as hints until there are at least{" "}
              {MIN_FOR_FINDINGS} of each.
            </div>
          )}

          <p className="muted" style={{ marginBottom: 6 }}>
            Biggest differences. Green means graduates&rsquo; calls were stronger here.
          </p>
          <div className="compare">
            <div className="compare-row compare-head">
              <span />
              <span>Proven</span>
              <span>Cancelled</span>
              <span>Difference</span>
            </div>
            {top.map((m) => (
              <div key={m.group + m.label} className="compare-row">
                <span>
                  {m.label}
                  <span className="calls-meta">{m.group}</span>
                </span>
                <span>{formatValue(m, m.graduated)}</span>
                <span>{formatValue(m, m.cancelled)}</span>
                <Gap m={m} />
              </div>
            ))}
          </div>

          <details className="fold" style={{ marginTop: 14 }}>
            <summary>
              <span className="fold-title">Everything compared</span>
              <span className="fold-preview">{metrics.length} measures</span>
            </summary>
            <div className="fold-body">
              {groups.map(([group, ms]) => (
                <div key={group} className="compare" style={{ marginTop: 10 }}>
                  <div className="compare-row compare-head">
                    <span>{group}</span>
                    <span>Proven</span>
                    <span>Cancelled</span>
                    <span>Difference</span>
                  </div>
                  {ms.map((m) => (
                    <div key={m.label} className="compare-row">
                      <span>
                        {m.label}
                        {m.hint && <span className="stage-term">{m.hint}</span>}
                      </span>
                      <span>
                        {formatValue(m, m.graduated)}
                        <span className="calls-meta">n={m.nGraduated}</span>
                      </span>
                      <span>
                        {formatValue(m, m.cancelled)}
                        <span className="calls-meta">n={m.nCancelled}</span>
                      </span>
                      <Gap m={m} />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </details>
        </>
      )}

      <h2>Lessons for the grader</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Claude can draft lessons from the calls above. Nothing is used until you edit and save it, because early patterns
        can be coincidence. One lesson per line.
      </p>
      <textarea
        rows={8}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="- On graduates' calls, the client restated the program in their own words before the close."
      />
      <div className="row" style={{ marginTop: 10 }}>
        <button disabled={!!busy || nG === 0 || nC === 0} onClick={draftLessons}>
          {busy || "Draft lessons from these calls"}
        </button>
        <button className="primary" disabled={!!busy || draft.trim() === saved.trim()} onClick={() => saveLessons(draft)}>
          Save lessons
        </button>
        {saved && (
          <button className="danger" disabled={!!busy} onClick={() => saveLessons("")}>
            Clear lessons
          </button>
        )}
      </div>
      <p className="muted" style={{ fontSize: 12 }}>
        {saved ? "Saved lessons are in use on every grade." : "No lessons in use yet."} Drafting costs about 10&ndash;20
        cents.
      </p>

      <GradingRules />

      <h2>Corrections ({fixes.length})</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Made with &ldquo;Not right?&rdquo; on a report, newest first. All of them feed the rules above. Delete any that turned out to be wrong.
      </p>
      {fixes.length === 0 && <p className="muted">None yet.</p>}
      {fixes.slice(0, fixN).map((f) => (
        <div key={f.id} className="grade-item">
          <div className="grade-item-head">
            <span>
              <span className="tone-chip">{f.item_kind}</span> {f.item_label}
            </span>
            <span className="row" style={{ gap: 10 }}>
              <Link href={`/admin/calls/${f.call_id}`} className="link-btn">
                Open call
              </Link>
              <button className="link-btn danger" onClick={() => removeFix(f.id)}>
                Delete
              </button>
            </span>
          </div>
          <div className="grade-quote" style={{ textDecoration: "line-through" }}>
            {f.original}
          </div>
          <div className="grade-coach">
            <strong>Correction:</strong> {f.correction}
          </div>
          <div className="calls-meta">{new Date(f.created_at).toLocaleDateString()}</div>
        </div>
      ))}
      {fixes.length > fixN && (
        <div className="row" style={{ justifyContent: "center", gap: 10, marginTop: 10 }}>
          <button onClick={() => setFixN((n) => n + 10)}>Show 10 more</button>
          <span className="muted" style={{ fontSize: 13 }}>{fixes.length - fixN} older</span>
        </div>
      )}
    </main>
  );
}
