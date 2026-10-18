"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { scoreBand } from "@/lib/calls";
import { addDays, fmtDate, fmtRange, fmtWeek, MASTERY, MEETING, today, weekdayOf, workWeek, type MasteryWeek, type Meeting, type TrainingEvent } from "@/lib/training";
import { loadSpend, type SpendSummary } from "@/lib/spend";
import SpendMeters from "../spending/SpendMeters";
import "../calls/calls.css";
import "../training/training.css";
import "../reps/reps.css";

type Person = { id: string; full_name: string | null; role: string; active: boolean };
type CallLite = {
  id: string;
  rep_id: string | null;
  created_at: string;
  call_date: string | null;
  source: string;
  status: string;
  slp_score: number | null;
  client_label: string | null;
};
type Attn = { href: string; title: string; why: string; tone: "bad" | "fair" };

const DAY = 86400000;
const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

/** Where managers land: this week's schedule, who needs attention, and the latest calls. */
export default function ManagerHome() {
  const supabase = useMemo(() => createClient(), []);
  const [name, setName] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [calls, setCalls] = useState<CallLite[]>([]);
  const [events, setEvents] = useState<TrainingEvent[]>([]);
  const [mastery, setMastery] = useState<MasteryWeek | null>(null);
  const [meeting, setMeeting] = useState<(Meeting & { items: number }) | null>(null);
  const [slipping, setSlipping] = useState<{ rep_id: string; headline: string | null; created_at: string }[]>([]);
  const [lastReport, setLastReport] = useState<{ title: string; period_end: string } | null>(null);
  const [spend, setSpend] = useState<SpendSummary | null>(null);
  useEffect(() => {
    void loadSpend(supabase).then(({ summary }) => setSpend(summary));
  }, [supabase]);
  const week = workWeek();

  useEffect(() => {
    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;
      const { data: me } = await supabase.from("profiles").select("org_id, full_name").eq("id", session.user.id).single();
      setName((me?.full_name || "").split(" ")[0]);
      const org = me?.org_id ?? "";
      const since = new Date(Date.now() - 60 * DAY).toISOString();
      const thu = addDays(week, 3);
      const [p, c, e, m, mt, rv, kr] = await Promise.all([
        supabase.from("profiles").select("id, full_name, role, active").eq("org_id", org),
        supabase
          .from("calls")
          .select("id, rep_id, created_at, call_date, source, status, slp_score, client_label")
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(400),
        supabase.from("training_events").select("*").gte("event_date", week).lte("event_date", addDays(week, 4)).order("event_date").order("start_time"),
        supabase.from("mastery_weeks").select("*").eq("week_start", week).maybeSingle(),
        supabase.from("meetings").select("*").eq("meeting_date", thu).maybeSingle(),
        supabase.from("rep_reviews").select("rep_id, created_at, status, trajectory:review->>trajectory, headline:review->>headline").eq("status", "done").order("created_at", { ascending: false }),
        supabase.from("kpi_reports").select("title, period_end").order("created_at", { ascending: false }).limit(1),
      ]);
      setPeople((p.data || []) as Person[]);
      setCalls((c.data || []) as CallLite[]);
      setEvents((e.data || []) as TrainingEvent[]);
      setMastery((m.data as MasteryWeek) || null);
      if (mt.data) {
        const { count } = await supabase.from("meeting_items").select("id", { count: "exact", head: true }).eq("meeting_id", mt.data.id);
        setMeeting({ ...(mt.data as Meeting), items: count ?? 0 });
      }
      // latest review per rep, only those that came back slipping
      const seen = new Set<string>();
      const slip: { rep_id: string; headline: string | null; created_at: string }[] = [];
      for (const r of (rv.data || []) as { rep_id: string; created_at: string; trajectory: string | null; headline: string | null }[]) {
        if (seen.has(r.rep_id)) continue;
        seen.add(r.rep_id);
        if (r.trajectory === "slipping") slip.push(r);
      }
      setSlipping(slip);
      setLastReport((kr.data?.[0] as { title: string; period_end: string }) || null);
    })();
  }, [supabase, week]);

  const nameOf = (id: string | null) => people.find((p) => p.id === id)?.full_name || "Unknown rep";

  const attention = useMemo(() => {
    const out: Attn[] = [];
    const now = Date.now();
    const at = (c: CallLite) => new Date(c.call_date || c.created_at).getTime();
    for (const s of slipping)
      out.push({ href: `/admin/reps/${s.rep_id}?tab=review`, title: nameOf(s.rep_id), why: `Coaching review says slipping: ${s.headline ?? ""}`, tone: "bad" });
    // Straight Line average down 5+ against the 30 days before
    for (const p of people.filter((x) => x.role === "rep" && x.active)) {
      const mine = calls.filter((c) => c.rep_id === p.id && c.status === "graded" && c.slp_score !== null);
      const a = avg(mine.filter((c) => at(c) >= now - 30 * DAY).map((c) => c.slp_score!));
      const b = avg(mine.filter((c) => at(c) < now - 30 * DAY).map((c) => c.slp_score!));
      if (a !== null && b !== null && b - a >= 5)
        out.push({ href: `/admin/reps/${p.id}`, title: p.full_name || "Rep", why: `Straight Line down ${Math.round(b - a)} (${Math.round(b)} → ${Math.round(a)}) vs the 30 days before`, tone: "fair" });
    }
    for (const c of calls.filter((x) => x.status === "failed").slice(0, 5))
      out.push({ href: `/admin/calls/${c.id}`, title: `${nameOf(c.rep_id)} -- call failed to process`, why: "Open it to retry", tone: "fair" });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calls, people, slipping]);

  const recent = calls.filter((c) => c.status === "graded").slice(0, 8);

  const days = [0, 1, 2, 3, 4].map((i) => addDays(week, i));
  const isThisWeek = weekdayOf(today()) < 6;

  return (
    <main className="shell rx-page">
      <div className="eyebrow">{fmtDate(today(), { weekday: "long", month: "long", day: "numeric" })}</div>
      <h1>{name ? `Hi ${name}` : "Home"}</h1>

      <div className="rx-actions" style={{ margin: "6px 0 16px" }}>
        <Link className="btn" href="/admin/calls" style={{ textDecoration: "none" }}>
          Upload a call
        </Link>
        <Link className="btn" href="/admin/reports" style={{ textDecoration: "none" }}>
          Upload a sales report
        </Link>
        <Link className="btn" href="/admin/reps" style={{ textDecoration: "none" }}>
          Team drop box
        </Link>
      </div>

      {spend && (
        <Link href="/admin/spending" style={{ color: "inherit", textDecoration: "none", display: "block" }} aria-label="Spending details">
          <SpendMeters s={spend} />
        </Link>
      )}

      <div className="rx-grid2">
        <section className="card">
          <h3 className="rx-sec-title">Needs attention</h3>
          {!attention.length ? (
            <p className="hint">Nothing flagged. Slipping coaching reviews and Straight Line drops show up here.</p>
          ) : (
            <div className="rx-attn">
              {attention.slice(0, 10).map((a, i) => (
                <Link key={i} href={a.href}>
                  <span>
                    <b>{a.title}</b>
                    <small>{a.why}</small>
                  </span>
                  <span className={`pill ${a.tone === "bad" ? "poor" : "fair"}`}>{a.tone === "bad" ? "look" : "watch"}</span>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <h3 className="rx-sec-title">{isThisWeek ? "This week" : "Next week"} · {fmtWeek(week)}</h3>
          {days.map((d) => {
            const dow = weekdayOf(d);
            const evs = events.filter((e) => e.event_date === d);
            const myc = (MASTERY.days as readonly number[]).includes(dow);
            const instructor = mastery ? nameOf(mastery.day_instructors?.[String(dow)] || mastery.instructor_id) : null;
            const meet = dow === 4;
            if (!evs.length && !myc && !meet) return null;
            return (
              <div key={d} style={{ padding: "8px 0", borderBottom: "1px solid var(--line)", ...(d === today() ? { background: "var(--live-dim)", margin: "0 -8px", padding: "8px" } : {}) }}>
                <b style={{ fontSize: 13 }}>{fmtDate(d)}</b>
                {meet && (
                  <div>
                    <Link href="/admin/meeting">Sales meeting</Link> <small className="muted">· {fmtRange(MEETING.start, MEETING.target)}</small>{" "}
                    {meeting ? (
                      <span className={`pill ${meeting.status === "published" ? "good" : "fair"}`}>{meeting.items} topics · {meeting.status}</span>
                    ) : (
                      <span className="pill fair">no agenda yet</span>
                    )}
                  </div>
                )}
                {myc && (
                  <div>
                    <Link href="/admin/mastery">Master Your Craft</Link> <small className="muted">· {fmtRange(MASTERY.start, MASTERY.minutes)}</small>{" "}
                    {mastery ? (
                      <small>
                        {mastery.title || "topic not set"} · {mastery.instructor_id ? instructor : "no teacher yet"}
                      </small>
                    ) : (
                      <span className="pill fair">not planned</span>
                    )}
                  </div>
                )}
                {evs.map((e) => (
                  <div key={e.id}>
                    <Link href="/admin/training">{e.title}</Link> <small className="muted">· {fmtRange(e.start_time.slice(0, 5), e.minutes)}</small>
                    {e.status === "draft" && <span className="pill fair"> draft</span>}
                  </div>
                ))}
              </div>
            );
          })}
        </section>
      </div>

      <section className="card" style={{ marginTop: 14 }}>
        <div className="rx-head">
          <h3 className="rx-sec-title" style={{ margin: 0 }}>
            Latest graded calls
          </h3>
          <Link href="/admin/calls" className="hint" style={{ margin: 0 }}>
            All calls
          </Link>
        </div>
        {!recent.length ? (
          <p className="hint">No graded calls in the last 60 days.</p>
        ) : (
          <div className="rx-timeline">
            {recent.map((c) => (
              <Link key={c.id} href={`/admin/calls/${c.id}`} className="rx-ev">
                <span className="when">{new Date(c.call_date || c.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                <span className="what">
                  <b>
                    <span className={`rx-kind ${c.source === "roleplay" ? "practice" : "real"}`}>{c.source === "roleplay" ? "Practice" : "Call"}</span>
                    {nameOf(c.rep_id)}
                  </b>
                  {c.client_label && <small>{c.client_label}</small>}
                </span>
                <span className={`pill ${scoreBand(c.slp_score)}`}>SLP {c.slp_score ?? "--"}</span>
              </Link>
            ))}
          </div>
        )}
      </section>
      {lastReport && (
        <p className="hint">
          Latest sales report: {lastReport.title}, through {fmtDate(lastReport.period_end, { month: "short", day: "numeric" })}.
        </p>
      )}
    </main>
  );
}
