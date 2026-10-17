"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  addDays,
  DAY_NAME,
  firstName,
  fmtDate,
  fmtDuration,
  fmtRange,
  fmtTime,
  KIND_LABEL,
  MASTERY,
  MEETING,
  minutesOf,
  mondayOf,
  today,
  workWeek,
  weekdayOf,
  type Material,
  type MasteryRequest,
  type MasteryWeek,
  type Meeting,
  type Person,
  type Progress,
  type TrainingEvent,
} from "@/lib/training";
import "../admin/calls/calls.css";
import "./training.css";

type Slot = { date: string; start: string; minutes: number; title: string; who: string; kind: "event" | "mastery" | "meeting"; notes?: string | null; materials: string[] };

/**
 * My Training: what's next, what's due, and what's done -- for one rep.
 */
export default function MyTraining() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [me, setMe] = useState<{ id: string; org_id: string; team: string | null; created_at: string } | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [week, setWeek] = useState(workWeek());
  const [events, setEvents] = useState<TrainingEvent[]>([]);
  const [mastery, setMastery] = useState<MasteryWeek | null>(null);
  const [myDay, setMyDay] = useState(0);
  const [regularDay, setRegularDay] = useState(0);
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [progress, setProgress] = useState<Map<string, Progress>>(new Map());
  const [requests, setRequests] = useState<MasteryRequest[]>([]);
  const [asking, setAsking] = useState(false);
  const [askDay, setAskDay] = useState(1);
  const [askNote, setAskNote] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      router.replace("/login");
      return;
    }
    const uid = session.user.id;
    const thu = addDays(week, 3);
    const [prof, ppl, ev, mw, reg, mv, mt, mats, prog, rq] = await Promise.all([
      supabase.from("profiles").select("id, org_id, team, created_at").eq("id", uid).single(),
      supabase.rpc("training_people"),
      supabase.from("training_events").select("*").gte("event_date", week).lte("event_date", addDays(week, 4)).order("start_time"),
      supabase.from("mastery_weeks").select("*").eq("week_start", week).maybeSingle(),
      supabase.from("mastery_regular").select("day").eq("rep_id", uid).maybeSingle(),
      supabase.from("mastery_moves").select("day").eq("rep_id", uid).eq("week_start", week).maybeSingle(),
      supabase.from("meetings").select("*").eq("meeting_date", thu).maybeSingle(),
      supabase.from("training_materials").select("*").order("created_at", { ascending: false }),
      supabase.from("training_progress").select("*").eq("user_id", uid),
      supabase.from("mastery_requests").select("*").eq("rep_id", uid).gte("week_start", mondayOf(today())).order("created_at", { ascending: false }),
    ]);
    const err = prof.error || ev.error || mats.error;
    if (err) setError(/relation|does not exist/i.test(err.message) ? "Training isn't set up yet." : err.message);
    setMe((prof.data as typeof me) ?? null);
    setPeople((ppl.data || []) as Person[]);
    setEvents((ev.data || []) as TrainingEvent[]);
    setMastery((mw.data as MasteryWeek | null) ?? null);
    const r = (reg.data?.day as number | undefined) ?? 0;
    setRegularDay(r);
    setMyDay(mv.data ? (mv.data.day as number) : r);
    setMeeting((mt.data as Meeting | null) ?? null);
    setMaterials((mats.data || []) as Material[]);
    setProgress(new Map(((prog.data || []) as Progress[]).map((p) => [p.material_id, p])));
    setRequests((rq.data || []) as MasteryRequest[]);
    setLoading(false);
  }, [supabase, router, week]);

  useEffect(() => {
    load();
  }, [load]);

  const name = (id: string | null | undefined) => (id ? firstName(people.find((p) => p.id === id)) : "");
  const isNewHire = me ? Date.now() - new Date(me.created_at).getTime() < 45 * 86400000 : false;

  const forMe = useCallback(
    (aud: string) => aud === "all" || aud === me?.team || (aud === "new_hires" && isNewHire),
    [me, isNewHire]
  );

  // The week, as one list.
  const slots: Slot[] = useMemo(() => {
    const out: Slot[] = events
      .filter((e) => forMe(e.audience))
      .map((e) => ({
        date: e.event_date,
        start: e.start_time.slice(0, 5),
        minutes: e.minutes,
        title: e.title,
        who: [...e.instructor_ids.map(name), e.guest_instructors].filter(Boolean).join(", "),
        kind: "event" as const,
        notes: e.notes,
        materials: e.material_ids,
      }));
    if (mastery && myDay) {
      const teacher = mastery.day_instructors?.[String(myDay)] || mastery.instructor_id;
      out.push({
        date: addDays(week, myDay - 1),
        start: MASTERY.start,
        minutes: MASTERY.minutes,
        title: `Master Your Craft${mastery.title ? `: ${mastery.title}` : ""}`,
        who: name(teacher),
        kind: "mastery",
        notes: null,
        materials: mastery.material_ids,
      });
    }
    out.push({
      date: addDays(week, 3),
      start: meeting?.start_time.slice(0, 5) ?? MEETING.start,
      minutes: MEETING.target,
      title: "Thursday sales meeting",
      who: "Team",
      kind: "meeting",
      materials: [],
    });
    return out.sort((a, b) => (a.date === b.date ? minutesOf(a.start) - minutesOf(b.start) : a.date.localeCompare(b.date)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, mastery, myDay, meeting, week, people, forMe]);

  const now = new Date();
  const nowDate = today();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const next = slots.find((s) => s.date > nowDate || (s.date === nowDate && minutesOf(s.start) + s.minutes > nowMin));

  const current = (m: Material) => {
    const p = progress.get(m.id);
    return p && p.version === m.version ? p : null;
  };
  const todo = materials
    .filter((m) => m.required && forMe(m.audience) && !current(m)?.completed_at)
    .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"));
  const done = materials.filter((m) => current(m)?.completed_at);
  const byId = new Map(materials.map((m) => [m.id, m]));

  async function requestDay() {
    if (!me) return;
    const { error } = await supabase.from("mastery_requests").insert({
      org_id: me.org_id,
      week_start: week,
      rep_id: me.id,
      to_day: askDay,
      note: askNote.trim() || null,
    });
    if (error) return setError(error.message);
    setAsking(false);
    setAskNote("");
    load();
  }

  if (loading) {
    return (
      <main className="shell my-shell">
        <p className="muted">Loading&hellip;</p>
      </main>
    );
  }

  const pending = requests.find((r) => r.week_start === week && r.status === "pending");
  const thisWeek = week === workWeek();

  return (
    <main className="shell my-shell">
      <div className="topbar">
        <Link className="btn" href="/proedgesolutions" style={{ textDecoration: "none" }}>
          &larr; Training
        </Link>
        <Link className="btn" href="/roleplay" style={{ textDecoration: "none" }}>
          Practice call
        </Link>
      </div>

      <div className="eyebrow">My training</div>
      <h1>{next ? "Up next" : "You're all caught up"}</h1>
      {error && <div className="error">{error}</div>}

      {next && (
        <div className="my-next">
          <div className="when">
            {next.date === nowDate ? "Today" : fmtDate(next.date, { weekday: "long" })} · {fmtRange(next.start, next.minutes)}
          </div>
          <div className="what">{next.title}</div>
          {next.who && <div className="who">{next.who}</div>}
          {next.materials.filter((id) => byId.has(id)).length > 0 && (
            <div className="prep">
              Before it:{" "}
              {next.materials
                .filter((id) => byId.has(id))
                .map((id) => (
                  <Link key={id} href={`/training/${id}`}>
                    {byId.get(id)!.title}
                  </Link>
                ))}
            </div>
          )}
        </div>
      )}

      {/* ---------- to do ---------- */}
      {todo.length > 0 && (
        <section className="my-section">
          <h2>To do ({todo.length})</h2>
          {todo.map((m) => {
            const p = current(m);
            const late = m.due_date && m.due_date < nowDate;
            return (
              <Link key={m.id} href={`/training/${m.id}`} className="my-mat">
                <span className="ico">{m.kind === "video" ? "▶" : m.kind === "slides" ? "PPT" : m.kind.toUpperCase()}</span>
                <span>
                  <b>{m.title}</b>
                  <small>
                    {KIND_LABEL[m.kind]}
                    {m.duration_secs ? ` · ${fmtDuration(m.duration_secs)}` : ""}
                    {m.due_date ? ` · ${late ? "was due" : "due"} ${fmtDate(m.due_date, { month: "short", day: "numeric" })}` : ""}
                  </small>
                  {p && p.pct > 0 && (
                    <span className="tr-progress" style={{ marginTop: 6 }}>
                      <i style={{ width: `${p.pct}%` }} />
                    </span>
                  )}
                </span>
                {late ? <span className="pill poor">Overdue</span> : p && p.pct > 0 ? <span className="pill">{p.pct}%</span> : <span className="pill fair">Start</span>}
              </Link>
            );
          })}
        </section>
      )}

      {/* ---------- the week ---------- */}
      <section className="my-section">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>{thisWeek ? "This week" : `Week of ${fmtDate(week, { month: "short", day: "numeric" })}`}</h2>
          <div className="row">
            <button className="tr-icon" aria-label="Previous week" onClick={() => setWeek(addDays(week, -7))} disabled={thisWeek}>&lsaquo;</button>
            <button className="tr-icon" aria-label="Next week" onClick={() => setWeek(addDays(week, 7))}>&rsaquo;</button>
          </div>
        </div>

        {[0, 1, 2, 3, 4].map((i) => {
          const date = addDays(week, i);
          const list = slots.filter((s) => s.date === date);
          if (!list.length) return null;
          const past = date < nowDate;
          return (
            <div key={date} className={`my-day ${past ? "past" : ""} ${date === nowDate ? "today" : ""}`}>
              <div className="d">{date === nowDate ? "Today" : fmtDate(date, { weekday: "long", month: "short", day: "numeric" })}</div>
              {list.map((s, k) => (
                <div key={k} className={`my-slot ${s.kind}`}>
                  <span className="t">{fmtTime(s.start)}</span>
                  <span>
                    <b>{s.title}</b>
                    {s.who && <small> · {s.who}</small>}
                    {s.materials.filter((id) => byId.has(id)).map((id) => (
                      <Link key={id} href={`/training/${id}`} className="my-att">
                        {byId.get(id)!.title}
                      </Link>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          );
        })}
      </section>

      {/* ---------- Master Your Craft ---------- */}
      <section className="my-section">
        <h2>Master Your Craft</h2>
        <div className="card">
          {myDay ? (
            <p style={{ margin: 0 }}>
              Your class {thisWeek ? "this week" : "that week"}: <b>{DAY_NAME[myDay]} · 1:30 – 2:00 PM</b>
              {mastery?.instructor_id && <> with {name(mastery.day_instructors?.[String(myDay)] || mastery.instructor_id)}</>}
              {mastery?.title && <> -- {mastery.title}</>}
              {regularDay && regularDay !== myDay && <span className="muted"> (moved from your usual {DAY_NAME[regularDay]})</span>}
            </p>
          ) : (
            <p style={{ margin: 0 }} className="muted">
              {regularDay ? "You're not in a class that week." : "You haven't been placed in a class yet -- your manager will assign your day."}
            </p>
          )}
          {pending ? (
            <p className="hint" style={{ margin: "10px 0 0" }}>
              You asked for {DAY_NAME[pending.to_day]} -- waiting on your manager.
            </p>
          ) : asking ? (
            <div style={{ marginTop: 12 }}>
              <div className="tr-two">
                <label className="field">
                  <span>Day you can make</span>
                  <select value={askDay} onChange={(e) => setAskDay(Number(e.target.value))}>
                    {[1, 2, 3].filter((d) => d !== myDay).map((d) => (
                      <option key={d} value={d}>{DAY_NAME[d]}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Why (optional)</span>
                  <input value={askNote} onChange={(e) => setAskNote(e.target.value)} placeholder="Doctor's appointment" />
                </label>
              </div>
              <div className="row">
                <button className="primary" onClick={requestDay}>Send request</button>
                <button onClick={() => setAsking(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            myDay > 0 && (
              <button
                className="tr-sm"
                style={{ marginTop: 12 }}
                onClick={() => {
                  setAskDay([1, 2, 3].find((d) => d !== myDay) ?? 1);
                  setAsking(true);
                }}
              >
                Can&rsquo;t make it? Ask for another day
              </button>
            )
          )}
        </div>
      </section>

      {/* ---------- library ---------- */}
      <section className="my-section">
        <h2>Library</h2>
        {materials.length === 0 ? (
          <p className="muted">No training materials yet.</p>
        ) : (
          materials.map((m) => {
            const p = current(m);
            return (
              <Link key={m.id} href={`/training/${m.id}`} className="my-mat">
                <span className="ico">{m.kind === "video" ? "▶" : m.kind === "slides" ? "PPT" : m.kind.toUpperCase()}</span>
                <span>
                  <b>{m.title}</b>
                  <small>
                    {KIND_LABEL[m.kind]}
                    {m.duration_secs ? ` · ${fmtDuration(m.duration_secs)}` : ""}
                  </small>
                </span>
                {p?.completed_at ? <span className="pill good">Done</span> : p && p.pct > 0 ? <span className="pill">{p.pct}%</span> : null}
              </Link>
            );
          })
        )}
        {done.length > 0 && <p className="hint" style={{ marginTop: 8 }}>{done.length} completed.</p>}
      </section>
    </main>
  );
}
