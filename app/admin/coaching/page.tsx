"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { CoachingHistory, CoachingSession, CoachingTopic } from "@/lib/coaching";
import "../calls/calls.css";
import "../reps/reps.css";

const PERIODS = [
  { days: 30, label: "Last 30 days" },
  { days: 90, label: "Last 90 days" },
  { days: 0, label: "All time" },
];

/**
 * Coaching trends: which topics keep coming up in one-on-ones across the
 * team, and with whom -- material for Master Your Craft and the Thursday
 * meeting. Built from the topics Claude tags on each one-on-one.
 */
export default function CoachingTrends() {
  const supabase = useMemo(() => createClient(), []);
  const [orgId, setOrgId] = useState("");
  const [me, setMe] = useState("");
  const [topics, setTopics] = useState<CoachingTopic[]>([]);
  const [sessions, setSessions] = useState<CoachingSession[]>([]);
  const [people, setPeople] = useState<Map<string, string>>(new Map());
  const [days, setDays] = useState(30);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [newTopic, setNewTopic] = useState("");
  const [earlier, setEarlier] = useState<CoachingHistory[]>([]);

  const load = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return;
    setMe(session.user.id);
    const { data: prof } = await supabase.from("profiles").select("org_id").eq("id", session.user.id).single();
    setOrgId(prof?.org_id ?? "");
    const [t, s, p] = await Promise.all([
      supabase.from("coaching_topics").select("*").order("sort_order"),
      supabase.from("coaching_sessions").select("*").order("session_date", { ascending: false }).limit(5000),
      supabase.from("profiles").select("id, full_name").eq("org_id", prof?.org_id ?? ""),
    ]);
    if (t.error) setError(/coaching_|does not exist/i.test(t.error.message) ? `${t.error.message} -- run supabase/coaching.sql first.` : t.error.message);
    setTopics((t.data || []) as CoachingTopic[]);
    // Personal one-on-ones are memory aids, not coaching data, and never feed AI.
    setSessions(((s.data || []) as CoachingSession[]).filter((x) => !x.private));
    setPeople(new Map((p.data || []).map((x) => [x.id as string, (x.full_name as string) || "Someone"])));
    // The old tracker's tallies (no dates), counted in "All time". Separate so a missing table doesn't break the page.
    const eh = await supabase.from("coaching_history").select("rep_id, topic, sessions");
    setEarlier(((eh.data || []) as CoachingHistory[]).filter((x) => x.sessions > 0));
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const now = Date.now();
    const start = days ? now - days * 86400000 : 0;
    const prevStart = days ? now - 2 * days * 86400000 : 0;
    const at = (s: CoachingSession) => new Date(`${s.session_date}T12:00:00`).getTime();
    const cur = sessions.filter((s) => at(s) >= start);
    const prev = days ? sessions.filter((s) => at(s) >= prevStart && at(s) < start) : [];
    const active = topics.filter((t) => !t.archived);
    const old = days ? [] : earlier;
    const rows = active
      .map((t) => {
        const mine = cur.filter((s) => s.topics.includes(t.name));
        const reps = new Map<string, number>();
        for (const s of mine) reps.set(s.rep_id, (reps.get(s.rep_id) ?? 0) + 1);
        const fromOld = old.filter((x) => x.topic === t.name);
        for (const x of fromOld) reps.set(x.rep_id, (reps.get(x.rep_id) ?? 0) + x.sessions);
        const commits = mine.flatMap((s) => s.commitments);
        return {
          topic: t,
          n: mine.length + fromOld.reduce((s, x) => s + x.sessions, 0),
          prev: prev.filter((s) => s.topics.includes(t.name)).length,
          reps: [...reps].sort((a, b) => b[1] - a[1]),
          kept: commits.filter((c) => c.status === "kept").length,
          missed: commits.filter((c) => c.status === "missed").length,
        };
      })
      .sort((a, b) => b.n - a.n);
    const repIds = [...new Set([...cur.map((s) => s.rep_id), ...old.map((x) => x.rep_id)])].sort((a, b) => (people.get(a) || "").localeCompare(people.get(b) || ""));
    return { cur, rows, repIds, max: Math.max(1, ...rows.map((r) => r.n)), oldTotal: old.reduce((s, x) => s + x.sessions, 0) };
  }, [sessions, topics, days, people, earlier]);

  async function toThursday(name: string, reps: [string, number][]) {
    const who = reps.slice(0, 5).map(([id, n]) => `${people.get(id) ?? "?"} (${n})`).join(", ");
    const { error } = await supabase.from("meeting_items").insert({
      org_id: orgId,
      meeting_id: null,
      title: `Coaching trend: ${name}`,
      notes: `Came up in ${reps.reduce((s, [, n]) => s + n, 0)} one-on-ones (${PERIODS.find((p) => p.days === days)?.label.toLowerCase()}). Most with: ${who}.`,
      minutes: 3,
      updated_by: me,
    });
    if (error) return setError(error.message);
    setStatus(`Added "${name}" to the Thursday meeting backlog.`);
  }

  async function addTopic(e: React.FormEvent) {
    e.preventDefault();
    const name = newTopic.trim();
    if (!name) return;
    const { error } = await supabase.from("coaching_topics").insert({ org_id: orgId, name, sort_order: topics.length + 1 });
    if (error) return setError(error.message);
    setNewTopic("");
    await load();
  }
  async function patchTopic(t: CoachingTopic, patch: Partial<CoachingTopic>) {
    const { error } = await supabase.from("coaching_topics").update(patch).eq("id", t.id);
    if (error) return setError(error.message);
    await load();
  }

  return (
    <main className="shell rx-page">
      <div className="eyebrow">Team</div>
      <h1>Coaching trends</h1>
      <p className="muted" style={{ maxWidth: "66ch" }}>
        What keeps coming up in one-on-ones, and with whom. Topics are tagged automatically from the notes managers save after each one-on-one. Use it
        to pick Master Your Craft and Thursday topics.
      </p>
      {error && <div className="error">{error}</div>}
      {status && <div className="status">{status}</div>}

      <div className="rx-presets" role="group" aria-label="Period">
        {PERIODS.map((p) => (
          <button key={p.days} className={days === p.days ? "on" : ""} aria-pressed={days === p.days} onClick={() => setDays(p.days)}>
            {p.label}
          </button>
        ))}
        <span className="hint" style={{ margin: "0 0 0 6px", alignSelf: "center" }}>
          {stats.cur.length} one-on-one{stats.cur.length === 1 ? "" : "s"}
          {stats.oldTotal ? ` + ${stats.oldTotal} from the old tracker` : days && earlier.length ? " · All time includes the old tracker" : ""}
        </span>
      </div>

      {!stats.cur.length && !stats.oldTotal ? (
        <div className="card">
          <p style={{ margin: 0 }}>
            No one-on-ones saved in this period yet. Open a rep from <Link href="/admin/reps">Reps</Link> and use the One-on-one tab after you meet.
          </p>
        </div>
      ) : (
        <section className="card">
          <h3 className="rx-sec-title">Topics, most discussed first</h3>
          <div className="rx-scroll">
            <table className="rx-table">
              <thead>
                <tr>
                  <th>Topic</th>
                  <th style={{ width: "30%" }}>One-on-ones</th>
                  {days > 0 && <th className="num">vs before</th>}
                  <th>Most with</th>
                  <th className="num">Commitments kept</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {stats.rows.map((r) => (
                  <tr key={r.topic.id}>
                    <td>
                      <b>{r.topic.name}</b>
                    </td>
                    <td>
                      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span className="sp-bar" style={{ flex: 1, margin: 0 }}>
                          <i style={{ width: `${(100 * r.n) / stats.max}%`, background: "var(--live)" }} />
                        </span>
                        <b style={{ minWidth: 20, textAlign: "right" }}>{r.n}</b>
                      </span>
                    </td>
                    {days > 0 && (
                      <td className="num" title="Compared with the same length of time just before">
                        {r.n === r.prev ? "same" : `${r.n > r.prev ? "+" : ""}${r.n - r.prev}`}
                      </td>
                    )}
                    <td style={{ fontSize: 13 }}>
                      {r.reps.length
                        ? r.reps.slice(0, 4).map(([id, n], i) => (
                            <span key={id}>
                              {i ? ", " : ""}
                              <Link href={`/admin/reps/${id}?tab=one`}>{(people.get(id) || "?").split(" ")[0]}</Link>
                              {n > 1 ? ` ×${n}` : ""}
                            </span>
                          ))
                        : <span className="muted">--</span>}
                      {r.reps.length > 4 ? ` +${r.reps.length - 4}` : ""}
                    </td>
                    <td className="num">{r.kept + r.missed ? `${r.kept} of ${r.kept + r.missed}` : "--"}</td>
                    <td className="num">
                      {r.n > 0 && (
                        <button className="tr-sm" onClick={() => void toThursday(r.topic.name, r.reps)} title="Add to the Thursday meeting backlog">
                          + Thursday
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint" style={{ marginBottom: 0 }}>
            &ldquo;vs before&rdquo; compares with the same length of time just before. Commitments count once a manager marks them kept or not yet.
          </p>
        </section>
      )}

      {stats.repIds.length > 0 && (
        <section className="card" style={{ marginTop: 14 }}>
          <h3 className="rx-sec-title">By rep</h3>
          <div className="rx-scroll">
            <table className="rx-table">
              <thead>
                <tr>
                  <th>Rep</th>
                  {stats.rows.map((r) => (
                    <th key={r.topic.id} className="num" style={{ whiteSpace: "normal", minWidth: 70 }}>
                      {r.topic.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stats.repIds.map((id) => (
                  <tr key={id}>
                    <td>
                      <Link href={`/admin/reps/${id}?tab=one`}>{people.get(id) ?? "?"}</Link>
                    </td>
                    {stats.rows.map((r) => {
                      const n = r.reps.find(([x]) => x === id)?.[1] ?? 0;
                      return (
                        <td key={r.topic.id} className="num" style={n ? { background: `rgba(212, 140, 40, ${Math.min(0.45, 0.1 + n * 0.1)})`, fontWeight: 650 } : { color: "var(--muted)" }}>
                          {n || "·"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <details className="card" style={{ marginTop: 14 }}>
        <summary style={{ cursor: "pointer", fontWeight: 650 }}>Edit the topic list</summary>
        <p className="hint">
          Claude sorts notes into these. The description helps it sort the way you would. Retired topics stay on old one-on-ones but aren&rsquo;t used for new ones.
        </p>
        {topics.map((t) => (
          <div key={t.id} className="rx-file" style={t.archived ? { opacity: 0.5 } : undefined}>
            <div style={{ display: "grid", gap: 6 }}>
              <input defaultValue={t.name} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== t.name && void patchTopic(t, { name: e.target.value.trim() })} aria-label="Topic name" />
              <input defaultValue={t.hint ?? ""} placeholder="What belongs here" onBlur={(e) => e.target.value !== (t.hint ?? "") && void patchTopic(t, { hint: e.target.value || null })} aria-label="Description" />
            </div>
            <button className="tr-sm" onClick={() => void patchTopic(t, { archived: !t.archived })}>
              {t.archived ? "Bring back" : "Retire"}
            </button>
          </div>
        ))}
        <form onSubmit={addTopic} className="rx-actions" style={{ marginTop: 10 }}>
          <input value={newTopic} onChange={(e) => setNewTopic(e.target.value)} placeholder="New topic" style={{ maxWidth: 260 }} />
          <button className="primary">Add</button>
        </form>
      </details>
    </main>
  );
}
