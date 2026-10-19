"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  addDays,
  ATTENDANCE_LABEL,
  classDayOf,
  DAY_NAME,
  firstName,
  fmtDate,
  fmtWeek,
  GUEST_KEY,
  isMycTeacher,
  mycTeacherName,
  mondayOf,
  today,
  workWeek,
  type Attendance,
  type MasteryRequest,
  type MasteryWeek,
  type Person,
} from "@/lib/training";
import { MaterialPicker, useHub } from "./shared";
import IdeaBox, { IDEA_CATEGORY } from "../IdeaBox";
import LessonText from "./LessonText";
import AfterClass, { RecordingPlayer } from "./AfterClass";

type WeekForm = {
  topic_id: string | null;
  title: string;
  instructor_id: string | null;
  day_instructors: Record<string, string>;
  material_ids: string[];
  notes: string;
  capacity: string;
};

const COLS = [
  { day: 1, label: "Monday" },
  { day: 2, label: "Tuesday" },
  { day: 3, label: "Wednesday" },
  { day: 0, label: "Unassigned" },
];

const ATT_SHORT: Record<Attendance, string> = { present: "P", absent: "A", excused: "E", makeup_required: "MU", makeup_done: "MU✓" };

/**
 * Master Your Craft: Monday-Wednesday, 1:30-2:00. One manager teaches the
 * week's topic to three groups; each rep belongs to one day.
 */
export default function MasteryTab() {
  const { supabase, orgId, me, reps, topics, managers, personById, reloadLibrary } = useHub();
  // Patrick, Kevin and Max teach; anyone else is typed in as a guest. Falls back to every manager if none match.
  const mycTeachers = managers.filter(isMycTeacher).length ? managers.filter(isMycTeacher) : managers;
  const [guestOn, setGuestOn] = useState(false);
  const [week, setWeek] = useState(workWeek());
  const [row, setRow] = useState<MasteryWeek | null>(null);
  const [form, setForm] = useState<WeekForm | null>(null);
  const [all, setAll] = useState<MasteryWeek[]>([]);
  const [regular, setRegular] = useState<Map<string, number>>(new Map());
  const [moves, setMoves] = useState<Map<string, number>>(new Map());
  const [attendance, setAttendance] = useState<Map<string, Attendance>>(new Map());
  const [requests, setRequests] = useState<MasteryRequest[]>([]);
  const [mode, setMode] = useState<"week" | "regular">("week");
  const [taking, setTaking] = useState(false);
  const [team, setTeam] = useState<"all" | "closers" | "ams">("all");
  const [over, setOver] = useState<number | null>(null);
  const [historyDays, setHistoryDays] = useState(0);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const load = useCallback(async () => {
    const [w, a, r, m, at, rq] = await Promise.all([
      supabase.from("mastery_weeks").select("*").eq("week_start", week).maybeSingle(),
      supabase.from("mastery_weeks").select("*").order("week_start", { ascending: false }),
      supabase.from("mastery_regular").select("rep_id, day"),
      supabase.from("mastery_moves").select("rep_id, day").eq("week_start", week),
      supabase.from("mastery_attendance").select("rep_id, status").eq("week_start", week),
      supabase.from("mastery_requests").select("*").eq("status", "pending").gte("week_start", mondayOf(today())).order("created_at"),
    ]);
    const err = w.error || a.error || r.error || m.error || at.error || rq.error;
    if (err) setError(err.message);
    const wk = (w.data as MasteryWeek | null) ?? null;
    setRow(wk);
    setGuestOn(!!wk?.day_instructors?.[GUEST_KEY]);
    setForm({
      topic_id: wk?.topic_id ?? null,
      title: wk?.title ?? "",
      instructor_id: wk?.instructor_id ?? null,
      day_instructors: wk?.day_instructors ?? {},
      material_ids: wk?.material_ids ?? [],
      notes: wk?.notes ?? "",
      capacity: wk?.capacity ? String(wk.capacity) : "",
    });
    setAll((a.data || []) as MasteryWeek[]);
    setRegular(new Map((r.data || []).map((x) => [x.rep_id as string, x.day as number])));
    setMoves(new Map((m.data || []).map((x) => [x.rep_id as string, x.day as number])));
    setAttendance(new Map((at.data || []).map((x) => [x.rep_id as string, x.status as Attendance])));
    setRequests((rq.data || []) as MasteryRequest[]);
  }, [supabase, week]);

  useEffect(() => {
    load();
  }, [load]);

  // Reps in training don't go to Master Your Craft until they graduate.
  const classReps = reps.filter((r) => !r.in_training);
  const trainees = reps.filter((r) => r.in_training);
  const shownReps = classReps.filter((r) => team === "all" || r.team === team);
  const dayOf = (id: string) => classDayOf(id, regular, moves);
  const capacity = Number(form?.capacity) || 0;

  // ---------------------------------------------------------------- week setup

  async function saveWeek(publish?: boolean) {
    if (!form) return;
    setError("");
    const title = form.title.trim() || topics.find((t) => t.id === form.topic_id)?.title || "";
    if (publish && (!title || (!form.instructor_id && !form.day_instructors[GUEST_KEY]))) return setError("Pick a topic and who's teaching before publishing.");
    const payload = {
      org_id: orgId,
      week_start: week,
      topic_id: form.topic_id,
      title: title || null,
      instructor_id: form.instructor_id,
      day_instructors: form.day_instructors,
      material_ids: form.material_ids,
      notes: form.notes.trim() || null,
      capacity: Number(form.capacity) || null,
      status: publish === undefined ? row?.status ?? "draft" : publish ? "published" : "draft",
      updated_by: me,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("mastery_weeks").upsert(payload, { onConflict: "org_id,week_start" });
    if (error) return setError(error.message);
    setSaved(publish ? "Published -- reps can see this week's class." : "Saved.");
    setTimeout(() => setSaved(""), 2500);
    load();
  }

  // ---------------------------------------------------------------- mixing up the days

  const [mix, setMix] = useState<Map<string, number> | null>(null);

  /** New regular days for everyone: even across Mon-Wed within each team, and as few reps as possible on the day they had. */
  function proposeMix() {
    let best: Map<string, number> | null = null;
    let bestSame = Infinity;
    for (let t = 0; t < 200; t++) {
      const plan = new Map<string, number>();
      // Deal each team round the three days in turn, carrying on where the last team stopped so the days stay even overall.
      let next = Math.floor(Math.random() * 3);
      for (const tm of ["closers", "ams", null]) {
        const group = classReps.filter((r) => (tm === null ? r.team !== "closers" && r.team !== "ams" : r.team === tm));
        for (const r of [...group].sort(() => Math.random() - 0.5)) {
          plan.set(r.id, (next % 3) + 1);
          next++;
        }
      }
      const same = classReps.filter((r) => regular.get(r.id) === plan.get(r.id)).length;
      if (same < bestSame) {
        best = plan;
        bestSame = same;
      }
      if (same === 0) break;
    }
    setMix(best);
  }

  async function saveMix() {
    if (!mix) return;
    setError("");
    const now = new Date().toISOString();
    const rows = [...mix].map(([rep_id, day]) => ({ rep_id, org_id: orgId, day, updated_by: me, updated_at: now }));
    const { error } = await supabase.from("mastery_regular").upsert(rows);
    if (error) return setError(error.message);
    setMix(null);
    setSaved(`New class days saved for ${rows.length} reps. One-week moves already set stay as they are.`);
    setTimeout(() => setSaved(""), 4000);
    load();
  }

  // ---------------------------------------------------------------- moving reps

  async function move(rep: Person, to: number) {
    setError("");
    const from = dayOf(rep.id);
    if (from === to && mode === "week") return;
    if (attendance.has(rep.id) && !confirm(`${rep.full_name} already has attendance recorded this week. Move anyway? Their attendance record is kept.`)) return;

    if (mode === "regular") {
      if (to === 0) await supabase.from("mastery_regular").delete().eq("rep_id", rep.id);
      else {
        const { error } = await supabase
          .from("mastery_regular")
          .upsert({ rep_id: rep.id, org_id: orgId, day: to, updated_by: me, updated_at: new Date().toISOString() });
        if (error) return setError(error.message);
      }
      // A regular change applies to this week too.
      await supabase.from("mastery_moves").delete().eq("week_start", week).eq("rep_id", rep.id);
    } else {
      const reg = regular.get(rep.id) ?? 0;
      if (to === reg) await supabase.from("mastery_moves").delete().eq("week_start", week).eq("rep_id", rep.id);
      else {
        const { error } = await supabase
          .from("mastery_moves")
          .upsert({ org_id: orgId, week_start: week, rep_id: rep.id, day: to, updated_by: me, updated_at: new Date().toISOString() });
        if (error) return setError(error.message);
      }
    }
    load();
  }

  async function mark(rep: Person, status: Attendance) {
    const day = dayOf(rep.id);
    if (!day) return;
    const cur = attendance.get(rep.id);
    if (cur === status) {
      await supabase.from("mastery_attendance").delete().eq("week_start", week).eq("rep_id", rep.id);
    } else {
      const { error } = await supabase.from("mastery_attendance").upsert({
        org_id: orgId,
        week_start: week,
        rep_id: rep.id,
        day,
        status,
        marked_by: me,
        marked_at: new Date().toISOString(),
      });
      if (error) return setError(error.message);
    }
    load();
  }

  async function decide(r: MasteryRequest, approve: boolean) {
    if (approve) {
      const { error } = await supabase
        .from("mastery_moves")
        .upsert({ org_id: orgId, week_start: r.week_start, rep_id: r.rep_id, day: r.to_day, updated_by: me, updated_at: new Date().toISOString() });
      if (error) return setError(error.message);
    }
    await supabase.from("mastery_requests").update({ status: approve ? "approved" : "declined", decided_by: me }).eq("id", r.id);
    load();
  }

  // ---------------------------------------------------------------- history

  const history = useMemo(() => {
    type Taught = { week: string; who: string | null; guest?: string; shown: string; notes: string | null; recordings: NonNullable<MasteryWeek["recordings"]>; leave: string | null };
    const byTopic = new Map<string, { key: string; title: string; content: string | null; dates: Taught[] }>();
    for (const w of all) {
      if (w.status !== "published" || w.week_start > today()) continue;
      const key = (w.topic_id || w.title || "").toLowerCase();
      if (!key) continue;
      const title = w.title || topics.find((t) => t.id === w.topic_id)?.title || "Untitled";
      const t = topics.find((x) => x.id === w.topic_id);
      const e = byTopic.get(key) || { key, title: t?.title || title, content: t?.description ?? null, dates: [] };
      e.dates.push({ week: w.week_start, who: w.instructor_id, guest: w.day_instructors?.[GUEST_KEY], shown: w.title || "", notes: w.notes ?? null, recordings: w.recordings ?? [], leave: w.leave_behind ?? null });
      byTopic.set(key, e);
    }
    const rows = topics
      .filter((t) => !t.archived)
      .map((t) => {
        const h = byTopic.get(t.id.toLowerCase());
        byTopic.delete(t.id.toLowerCase());
        return { key: t.id.toLowerCase(), title: t.title, content: t.description, dates: h?.dates ?? [] };
      });
    for (const h of byTopic.values()) rows.push(h);
    const cutoff = historyDays ? addDays(today(), -historyDays) : null;
    // Only what's actually been taught (live or logged for a past week), newest first.
    return rows
      .filter((r) => r.dates.length && (!cutoff || r.dates[0].week < cutoff))
      .map((r) => ({ ...r, dates: [...r.dates].sort((a, b) => b.week.localeCompare(a.week)) }))
      .sort((a, b) => b.dates[0].week.localeCompare(a.dates[0].week));
  }, [all, topics, historyDays]);
  const [openTopic, setOpenTopic] = useState<string | null>(null);

  // Saved ideas that haven't been taught yet.
  const ideas = useMemo(
    () => topics.filter((t) => t.category === IDEA_CATEGORY && !t.archived && !all.some((w) => w.topic_id === t.id && w.status === "published")),
    [topics, all],
  );

  const mycTopics = useMemo(
    () => topics.filter((t) => !t.archived && (t.category === IDEA_CATEGORY || all.some((w) => w.topic_id === t.id))),
    [topics, all],
  );

  const lastTaught = useMemo(() => {
    if (!form) return null;
    const key = form.topic_id || form.title.trim().toLowerCase();
    if (!key) return null;
    const past = all.filter((w) => w.week_start !== week && w.status === "published" && (w.topic_id === form.topic_id && form.topic_id ? true : (w.title || "").toLowerCase() === form.title.trim().toLowerCase() && !!form.title.trim()));
    if (!past.length) return null;
    const p = past[0];
    return `Last taught the week of ${fmtDate(p.week_start, { month: "short", day: "numeric", year: "numeric" })} by ${p.day_instructors?.[GUEST_KEY] || firstName(personById(p.instructor_id))} · ${past.length} time${past.length === 1 ? "" : "s"} in all.`;
  }, [form, all, week, personById]);

  if (!form) return <p className="muted">Loading&hellip;</p>;

  return (
    <>
      <div className="tr-bar">
        <div className="row">
          <button className="tr-icon" aria-label="Previous week" onClick={() => setWeek(addDays(week, -7))}>&lsaquo;</button>
          <span className="tr-week">{fmtWeek(week)}</span>
          <button className="tr-icon" aria-label="Next week" onClick={() => setWeek(addDays(week, 7))}>&rsaquo;</button>
          <button className="tr-sm" onClick={() => setWeek(workWeek())}>This week</button>
          <span className={`pill ${row?.status === "published" ? "good" : ""}`}>{row ? (row.status === "published" ? "Published" : "Draft") : "Not planned"}</span>
        </div>
        <span className="hint" style={{ margin: 0 }}>Mon, Tue, Wed · 1:30 – 2:00 PM</span>
      </div>

      {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}

      {/* ---------- the week ---------- */}
      <div className="card" style={{ display: "grid", gap: 4 }}>
        <label className="field">
          <span>Topic</span>
          <input
            list="myc-topics"
            value={form.title}
            placeholder="Type the topic, or pick a saved idea"
            onChange={(e) => {
              const title = e.target.value;
              const t = mycTopics.find((x) => x.title.trim().toLowerCase() === title.trim().toLowerCase());
              setForm({ ...form, title, topic_id: t?.id ?? null });
            }}
          />
          <datalist id="myc-topics">
            {mycTopics.map((t) => (
              <option key={t.id} value={t.title} />
            ))}
          </datalist>
        </label>
        {lastTaught && <p className="hint" style={{ marginTop: -6 }}>{lastTaught}</p>}
        <div className="field">
          <span>Teaching all three classes</span>
          <div className="tr-chips" role="group">
            {mycTeachers.map((m) => {
              const on = form.instructor_id === m.id && !guestOn;
              return (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={on}
                  className={on ? "on" : ""}
                  onClick={() => {
                    const next = { ...form.day_instructors };
                    delete next[GUEST_KEY];
                    setGuestOn(false);
                    setForm({ ...form, instructor_id: on ? null : m.id, day_instructors: next });
                  }}
                >
                  {m.full_name || "Unnamed"}
                </button>
              );
            })}
            <button
              type="button"
              aria-pressed={guestOn}
              className={guestOn ? "on" : ""}
              onClick={() => {
                const next = { ...form.day_instructors };
                if (guestOn) delete next[GUEST_KEY];
                setGuestOn(!guestOn);
                setForm({ ...form, instructor_id: guestOn ? form.instructor_id : null, day_instructors: next });
              }}
            >
              Guest speaker
            </button>
          </div>
          {guestOn && (
            <input
              style={{ marginTop: 8 }}
              value={form.day_instructors[GUEST_KEY] ?? ""}
              placeholder="Guest speaker's name"
              autoFocus
              onChange={(e) => {
                const next = { ...form.day_instructors };
                if (e.target.value.trim()) next[GUEST_KEY] = e.target.value;
                else delete next[GUEST_KEY];
                setForm({ ...form, day_instructors: next });
              }}
            />
          )}
        </div>
        <details style={{ marginBottom: 10 }}>
          <summary className="hint" style={{ cursor: "pointer" }}>Someone else covering one day?</summary>
          <div className="tr-three" style={{ marginTop: 8 }}>
            {[1, 2, 3].map((d) => (
              <label className="field" key={d}>
                <span>{DAY_NAME[d]}</span>
                <select
                  value={form.day_instructors[String(d)] ?? ""}
                  onChange={(e) => {
                    const next = { ...form.day_instructors };
                    if (e.target.value) next[String(d)] = e.target.value;
                    else delete next[String(d)];
                    setForm({ ...form, day_instructors: next });
                  }}
                >
                  <option value="">Same as the week</option>
                  {mycTeachers.map((m) => (
                    <option key={m.id} value={m.id}>{m.full_name}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </details>
        <div className="tr-two">
          <div className="field">
            <span>Materials</span>
            <MaterialPicker value={form.material_ids} onChange={(v) => setForm({ ...form, material_ids: v })} />
          </div>
          <div>
            <label className="field">
              <span>Seats per class (optional)</span>
              <input type="number" min={1} value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} />
            </label>
            <label className="field">
              <span>Notes for the instructor</span>
              <textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} style={{ fontFamily: "var(--font)" }} />
            </label>
          </div>
        </div>
        <div className="row">
          <button onClick={() => saveWeek()}>Save</button>
          {row?.status !== "published" ? (
            <button className="primary" onClick={() => saveWeek(true)}>Publish week</button>
          ) : (
            <button onClick={() => saveWeek(false)}>Unpublish</button>
          )}
          {saved && <span className="hint" style={{ margin: 0, color: "var(--ok)" }}>{saved}</span>}
        </div>
      </div>

      {/* ---------- requests ---------- */}
      {requests.length > 0 && (
        <div className="tr-mine" style={{ marginTop: 14 }}>
          <b>Class change requests</b>
          {requests.map((r) => (
            <div key={r.id} className="row" style={{ justifyContent: "space-between" }}>
              <span>
                {personById(r.rep_id)?.full_name ?? "A rep"} wants <b>{DAY_NAME[r.to_day]}</b> the week of {fmtDate(r.week_start, { month: "short", day: "numeric" })}
                {r.note ? ` -- "${r.note}"` : ""}
              </span>
              <span className="row">
                <button className="tr-sm primary" onClick={() => decide(r, true)}>Approve</button>
                <button className="tr-sm" onClick={() => decide(r, false)}>Decline</button>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ---------- after class ---------- */}
      <div className="rp-section" style={{ marginTop: 22 }}>
        <h2 style={{ margin: "0 0 8px", fontSize: 17 }}>After class</h2>
        <AfterClass supabase={supabase} orgId={orgId} me={me} week={week} recordings={row?.recordings ?? []} leaveBehind={row?.leave_behind ?? null} onSaved={load} />
      </div>

      {/* ---------- ideas ---------- */}
      <div className="rp-section" style={{ marginTop: 22 }}>
        <h2 style={{ margin: "0 0 8px", fontSize: 17 }}>Ideas for future weeks</h2>
        <div className="card" style={{ display: "grid", gap: 10 }}>
          {ideas.length === 0 ? (
            <p className="hint" style={{ margin: 0 }}>No ideas saved yet. Jot one down below, or use &ldquo;Log an idea&rdquo; on Home.</p>
          ) : (
            ideas.map((t) => (
              <div key={t.id} className="rx-file">
                <div>
                  <b>{t.title}</b>
                  {t.description && (
                    <details style={{ marginTop: 4 }}>
                      <summary className="hint" style={{ margin: 0, cursor: "pointer" }}>Show the content</summary>
                      <div style={{ marginTop: 8 }}>
                        <LessonText text={t.description} />
                      </div>
                    </details>
                  )}
                </div>
                <div style={{ whiteSpace: "nowrap" }}>
                  <button
                    className="tr-sm"
                    onClick={() => {
                      setForm({ ...form, topic_id: t.id, title: t.title });
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                  >
                    Use this week
                  </button>{" "}
                  <button
                    className="tr-sm"
                    onClick={async () => {
                      await supabase.from("training_topics").update({ archived: true }).eq("id", t.id);
                      await reloadLibrary();
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))
          )}
          <IdeaBox supabase={supabase} orgId={orgId} me={me} initial="myc" fixed onSaved={() => void reloadLibrary()} />
        </div>
      </div>

      {/* ---------- roster ---------- */}
      <div className="rp-section" style={{ marginTop: 22 }}>
        <div className="tr-bar">
          <h2 style={{ margin: 0, fontSize: 17 }}>Who&rsquo;s in each class</h2>
          <div className="row">
            <select value={team} onChange={(e) => setTeam(e.target.value as typeof team)} style={{ width: "auto", padding: "7px 10px", fontSize: 13 }}>
              <option value="all">All reps</option>
              <option value="closers">Sales reps</option>
              <option value="ams">Account managers</option>
            </select>
            <div className="unit-switch" role="group" aria-label="What a move changes">
              <button aria-pressed={mode === "week"} onClick={() => setMode("week")}>Move this week</button>
              <button aria-pressed={mode === "regular"} onClick={() => setMode("regular")}>Change regular day</button>
            </div>
            <button className={`tr-sm ${taking ? "primary" : ""}`} onClick={() => setTaking(!taking)}>
              {taking ? "Done taking attendance" : "Take attendance"}
            </button>
          </div>
        </div>
        <p className="hint">
          {mode === "week"
            ? "Drag a rep, or use their menu, to move them for this week only. Their regular day stays the same."
            : "Moves now change the rep's regular class day for every week from now on."}
          {mode === "regular" && !mix && (
            <>
              {" "}
              <button className="tr-sm" onClick={proposeMix}>
                Mix up everyone&rsquo;s days
              </button>
            </>
          )}
        </p>

        {mix && (
          <div className="card" style={{ marginBottom: 12, borderColor: "var(--live)" }}>
            <b>New class days -- not saved yet</b>
            <p className="hint" style={{ marginTop: 4 }}>
              Spread evenly across Monday to Wednesday, sales reps and account managers each split three ways, with as few reps as possible
              staying on the day they had ({classReps.filter((r) => regular.get(r.id) === mix.get(r.id)).length} stay put). Save, then drag anyone you want to change.
            </p>
            <div className="tr-roster">
              {[1, 2, 3].map((d) => {
                const inDay = classReps.filter((r) => mix.get(r.id) === d).sort((a, b) => (a.full_name || "").localeCompare(b.full_name || ""));
                return (
                  <div key={d} className="tr-col">
                    <h3>
                      {DAY_NAME[d]}
                      <span>{inDay.length}</span>
                    </h3>
                    {inDay.map((r) => (
                      <div key={r.id} className="tr-rep">
                        <span>
                          {r.full_name || "Unnamed"}
                          <div className="moved-tag" style={{ color: "var(--muted)" }}>
                            {regular.get(r.id) ? (regular.get(r.id) === d ? "same day" : `was ${DAY_NAME[regular.get(r.id)!].slice(0, 3)}`) : "new"}
                            {r.team === "ams" ? " · AM" : ""}
                          </div>
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
            <div className="rx-actions" style={{ marginTop: 10 }}>
              <button className="primary" onClick={() => void saveMix()}>
                Save new days
              </button>
              <button onClick={proposeMix}>Shuffle again</button>
              <button onClick={() => setMix(null)}>Cancel</button>
            </div>
          </div>
        )}

        <div className="tr-roster">
          {COLS.map((c) => {
            const inCol = shownReps.filter((r) => dayOf(r.id) === c.day);
            const teacher = c.day ? mycTeacherName(form, c.day, (id) => firstName(personById(id))) : "";
            return (
              <div
                key={c.day}
                className={`tr-col ${over === c.day ? "over" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOver(c.day);
                }}
                onDragLeave={() => setOver((o) => (o === c.day ? null : o))}
                onDrop={(e) => {
                  e.preventDefault();
                  setOver(null);
                  const rep = reps.find((r) => r.id === e.dataTransfer.getData("text/plain"));
                  if (rep) move(rep, c.day);
                }}
              >
                <h3>
                  {c.label}
                  <span className={capacity && c.day && inCol.length > capacity ? "full" : ""}>
                    {inCol.length}
                    {capacity && c.day ? ` / ${capacity}` : ""}
                  </span>
                </h3>
                <div className="sub">
                  {c.day ? `${fmtDate(addDays(week, c.day - 1), { month: "short", day: "numeric" })} · ${teacher || "no instructor"}` : mode === "week" ? "Not in class this week" : "No regular day"}
                </div>
                {inCol.map((r) => {
                  const moved = moves.has(r.id);
                  const att = attendance.get(r.id);
                  return (
                    <div key={r.id} className={`tr-rep ${moved ? "moved" : ""}`} draggable={!taking} onDragStart={(e) => e.dataTransfer.setData("text/plain", r.id)}>
                      <span>
                        {r.full_name || "Unnamed"}
                        {moved && (
                          <div className="moved-tag">
                            This week only{regular.get(r.id) ? ` · usually ${DAY_NAME[regular.get(r.id)!].slice(0, 3)}` : ""}
                          </div>
                        )}
                        {att && !taking && <div className="moved-tag" style={{ color: "var(--muted)" }}>{ATTENDANCE_LABEL[att]}</div>}
                      </span>
                      {taking && c.day ? (
                        <span className="att" role="group" aria-label={`Attendance for ${r.full_name}`}>
                          {(Object.keys(ATT_SHORT) as Attendance[]).map((s) => (
                            <button key={s} aria-pressed={att === s} title={ATTENDANCE_LABEL[s]} onClick={() => mark(r, s)}>
                              {ATT_SHORT[s]}
                            </button>
                          ))}
                        </span>
                      ) : (
                        <select aria-label={`Move ${r.full_name}`} value={c.day} onChange={(e) => move(r, Number(e.target.value))}>
                          <option value={1}>Mon</option>
                          <option value={2}>Tue</option>
                          <option value={3}>Wed</option>
                          <option value={0}>{mode === "week" ? "Off" : "None"}</option>
                        </select>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {trainees.length > 0 && (
        <p className="hint" style={{ marginTop: 8 }}>
          In training, not in Master Your Craft yet: {trainees.map((r) => r.full_name || "Unnamed").join(", ")}. Untick &ldquo;In training&rdquo; on People &amp;
          access when they graduate, then give them a day.
        </p>
      )}

      {/* ---------- topic history ---------- */}
      <div className="rp-section" style={{ marginTop: 26 }}>
        <div className="tr-bar">
          <h2 style={{ margin: 0, fontSize: 17 }}>Topic history</h2>
          <select value={historyDays} onChange={(e) => setHistoryDays(Number(e.target.value))} style={{ width: "auto", padding: "7px 10px", fontSize: 13 }}>
            <option value={0}>Everything taught</option>
            <option value={30}>Not taught in 30 days</option>
            <option value={60}>Not taught in 60 days</option>
            <option value={90}>Not taught in 90 days</option>
          </select>
        </div>
        <div className="card" style={{ padding: "4px 12px", overflowX: "auto" }}>
          <table className="tr-history">
            <thead>
              <tr>
                <th>Topic</th>
                <th>Last taught</th>
                <th>By</th>
                <th>Times</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    Nothing taught yet. Each week you publish lands here. To log a past class, go back to that week with the arrows above, fill it in and publish.
                  </td>
                </tr>
              )}
              {history.map((h) => {
                const open = openTopic === h.key;
                return (
                  <Fragment key={h.key}>
                    <tr className={`click${open ? " open" : ""}`} onClick={() => setOpenTopic(open ? null : h.key)} title={open ? "Close" : "Open to see the content"}>
                      <td>
                        <span className="muted" style={{ display: "inline-block", width: 14 }}>{open ? "▾" : "▸"}</span>
                        {h.title}
                      </td>
                      <td>{h.dates[0] ? fmtDate(h.dates[0].week, { month: "short", day: "numeric", year: "numeric" }) : <span className="muted">Not yet</span>}</td>
                      <td>{h.dates[0] ? h.dates[0].guest || firstName(personById(h.dates[0].who)) : "--"}</td>
                      <td>{h.dates.length}</td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={4} className="lesson-cell">
                          {h.dates[0]?.shown && h.dates[0].shown !== h.title && (
                            <p className="hint" style={{ marginTop: 0 }}>
                              Reps saw it as: <b>{h.dates[0].shown}</b>
                            </p>
                          )}
                          {h.content ? <LessonText text={h.content} /> : <p className="muted" style={{ margin: 0 }}>No content saved with this topic.</p>}
                          {h.dates
                            .filter((d) => d.recordings.length || d.leave)
                            .map((d) => (
                              <div key={`after-${d.week}`} style={{ marginTop: 14 }}>
                                <p className="lesson-sub">After class &middot; week of {fmtDate(d.week, { month: "short", day: "numeric", year: "numeric" })}</p>
                                <div style={{ display: "grid", gap: 8, marginBottom: 8 }}>
                                  {d.recordings.map((r) => (
                                    <div key={r.added_at + r.name}>
                                      {r.day && <small className="muted">{r.day} </small>}
                                      <RecordingPlayer supabase={supabase} rec={r} />
                                    </div>
                                  ))}
                                </div>
                                {d.leave && (
                                  <div className="card" style={{ background: "var(--ink-3)" }}>
                                    <p className="hint" style={{ marginTop: 0 }}>Leave behind</p>
                                    <LessonText text={d.leave} />
                                  </div>
                                )}
                              </div>
                            ))}
                          {h.dates.some((d) => d.notes) && (
                            <div style={{ marginTop: 12 }}>
                              <p className="lesson-sub">Notes for the instructor</p>
                              {h.dates.filter((d) => d.notes).map((d) => (
                                <div key={d.week} style={{ marginBottom: 8 }}>
                                  <span className="hint">{fmtDate(d.week, { month: "short", day: "numeric", year: "numeric" })}</span>
                                  <LessonText text={d.notes!} />
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
