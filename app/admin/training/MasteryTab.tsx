"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addDays,
  ATTENDANCE_LABEL,
  classDayOf,
  DAY_NAME,
  firstName,
  fmtDate,
  fmtWeek,
  mondayOf,
  today,
  workWeek,
  type Attendance,
  type MasteryRequest,
  type MasteryWeek,
  type Person,
} from "@/lib/training";
import { ManagerChips, MaterialPicker, useHub } from "./shared";

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
  const { supabase, orgId, me, reps, topics, managers, personById } = useHub();
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

  const shownReps = reps.filter((r) => team === "all" || r.team === team);
  const dayOf = (id: string) => classDayOf(id, regular, moves);
  const capacity = Number(form?.capacity) || 0;

  // ---------------------------------------------------------------- week setup

  async function saveWeek(publish?: boolean) {
    if (!form) return;
    setError("");
    const title = form.title.trim() || topics.find((t) => t.id === form.topic_id)?.title || "";
    if (publish && (!title || !form.instructor_id)) return setError("Pick a topic and an instructor before publishing.");
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
    const byTopic = new Map<string, { title: string; dates: { week: string; who: string | null }[] }>();
    for (const w of all) {
      if (w.status !== "published" || w.week_start > today()) continue;
      const key = (w.topic_id || w.title || "").toLowerCase();
      if (!key) continue;
      const title = w.title || topics.find((t) => t.id === w.topic_id)?.title || "Untitled";
      const e = byTopic.get(key) || { title, dates: [] };
      e.dates.push({ week: w.week_start, who: w.instructor_id });
      byTopic.set(key, e);
    }
    const rows = topics
      .filter((t) => !t.archived)
      .map((t) => {
        const h = byTopic.get(t.id.toLowerCase());
        byTopic.delete(t.id.toLowerCase());
        return { title: t.title, dates: h?.dates ?? [] };
      });
    for (const h of byTopic.values()) rows.push(h);
    const cutoff = historyDays ? addDays(today(), -historyDays) : null;
    return rows
      .filter((r) => !cutoff || !r.dates.length || r.dates[0].week < cutoff)
      .sort((a, b) => (a.dates[0]?.week ?? "0").localeCompare(b.dates[0]?.week ?? "0"));
  }, [all, topics, historyDays]);

  const lastTaught = useMemo(() => {
    if (!form) return null;
    const key = form.topic_id || form.title.trim().toLowerCase();
    if (!key) return null;
    const past = all.filter((w) => w.week_start !== week && w.status === "published" && (w.topic_id === form.topic_id && form.topic_id ? true : (w.title || "").toLowerCase() === form.title.trim().toLowerCase() && !!form.title.trim()));
    if (!past.length) return "Not taught before.";
    const p = past[0];
    return `Last taught the week of ${fmtDate(p.week_start, { month: "short", day: "numeric", year: "numeric" })} by ${firstName(personById(p.instructor_id))} · ${past.length} time${past.length === 1 ? "" : "s"} in all.`;
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
        <div className="tr-two">
          <label className="field">
            <span>Topic</span>
            <select
              value={form.topic_id ?? ""}
              onChange={(e) => {
                const t = topics.find((x) => x.id === e.target.value);
                setForm({ ...form, topic_id: t?.id ?? null, title: t?.title ?? form.title });
              }}
            >
              <option value="">-- pick a topic, or type one below --</option>
              {topics.filter((t) => !t.archived).map((t) => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Title reps see</span>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Handling Objections" />
          </label>
        </div>
        {lastTaught && <p className="hint" style={{ marginTop: -6 }}>{lastTaught}</p>}
        <div className="field">
          <span>Teaching all three classes</span>
          <ManagerChips single value={form.instructor_id ? [form.instructor_id] : []} onChange={(v) => setForm({ ...form, instructor_id: v[0] ?? null })} />
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
                  {managers.map((m) => (
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
        </p>

        <div className="tr-roster">
          {COLS.map((c) => {
            const inCol = shownReps.filter((r) => dayOf(r.id) === c.day);
            const teacher = c.day ? form.day_instructors[String(c.day)] || form.instructor_id : null;
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
                  {c.day ? `${fmtDate(addDays(week, c.day - 1), { month: "short", day: "numeric" })} · ${teacher ? firstName(personById(teacher)) : "no instructor"}` : mode === "week" ? "Not in class this week" : "No regular day"}
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

      {/* ---------- topic history ---------- */}
      <div className="rp-section" style={{ marginTop: 26 }}>
        <div className="tr-bar">
          <h2 style={{ margin: 0, fontSize: 17 }}>Topic history</h2>
          <select value={historyDays} onChange={(e) => setHistoryDays(Number(e.target.value))} style={{ width: "auto", padding: "7px 10px", fontSize: 13 }}>
            <option value={0}>All topics</option>
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
              {history.map((h, i) => (
                <tr key={i}>
                  <td>{h.title}</td>
                  <td>{h.dates[0] ? fmtDate(h.dates[0].week, { month: "short", day: "numeric", year: "numeric" }) : <span className="muted">Not yet</span>}</td>
                  <td>{h.dates[0] ? firstName(personById(h.dates[0].who)) : "--"}</td>
                  <td>{h.dates.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
