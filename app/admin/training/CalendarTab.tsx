"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addDays,
  AUDIENCE_LABEL,
  firstName,
  fmtDate,
  fmtRange,
  fmtTime,
  fmtWeek,
  MASTERY,
  MEETING,
  minutesOf,
  mondayOf,
  NEW_HIRE_WEEK,
  newHireLengths,
  today,
  workWeek,
  weekdayOf,
  type MasteryWeek,
  type Meeting,
  type MeetingItem,
  type TrainingEvent,
  mycTeacherName,
} from "@/lib/training";
import { Drawer, ManagerChips, MaterialPicker, useHub } from "./shared";

type Draft = Omit<TrainingEvent, "id"> & { id: string | null };

type Item =
  | { key: string; kind: "event"; date: string; start: string; minutes: number; ev: TrainingEvent }
  | { key: string; kind: "mastery"; date: string; start: string; minutes: number; week: MasteryWeek | null; day: number }
  | { key: string; kind: "meeting"; date: string; start: string; minutes: number; meeting: Meeting | null; total: number };

const MINUTE_CHOICES = [15, 20, 30, 45, 60, 75, 90, 120, 150, 180, 240];

const blank = (date: string, start = "09:00"): Draft => ({
  id: null,
  kind: "training",
  title: "",
  topic_id: null,
  event_date: date,
  start_time: start,
  minutes: 60,
  instructor_ids: [],
  guest_instructors: null,
  audience: "all",
  required: true,
  status: "draft",
  notes: null,
  material_ids: [],
});

/** The training calendar: new-hire and general training only. */
export default function CalendarTab({ openTab }: { openTab: (t: string) => void }) {
  const { supabase, orgId, me, topics, managers, personById } = useHub();
  const [view, setView] = useState<"week" | "month">("week");
  const [anchor, setAnchor] = useState(workWeek());
  const [events, setEvents] = useState<TrainingEvent[]>([]);
  const [weeks, setWeeks] = useState<MasteryWeek[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [items, setItems] = useState<MeetingItem[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [filter, setFilter] = useState("");
  const [over, setOver] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Visible range: one work week, or every week touching the month.
  const range = useMemo(() => {
    if (view === "week") return { from: anchor, to: addDays(anchor, 4), mondays: [anchor] };
    const first = anchor.slice(0, 8) + "01";
    const y = Number(first.slice(0, 4));
    const mo = Number(first.slice(5, 7));
    const last = `${first.slice(0, 8)}${String(new Date(y, mo, 0).getDate()).padStart(2, "0")}`;
    const mondays: string[] = [];
    for (let m = mondayOf(first); m <= last; m = addDays(m, 7)) mondays.push(m);
    return { from: mondays[0], to: addDays(mondays[mondays.length - 1], 4), mondays };
  }, [view, anchor]);

  const load = useCallback(async () => {
    const [e, w, m] = await Promise.all([
      supabase.from("training_events").select("*").gte("event_date", range.from).lte("event_date", range.to).order("start_time"),
      supabase.from("mastery_weeks").select("*").gte("week_start", range.from).lte("week_start", range.to),
      supabase.from("meetings").select("*").gte("meeting_date", range.from).lte("meeting_date", range.to),
    ]);
    const err = e.error || w.error || m.error;
    if (err) setError(err.message);
    setEvents((e.data || []) as TrainingEvent[]);
    setWeeks((w.data || []) as MasteryWeek[]);
    const ms = (m.data || []) as Meeting[];
    setMeetings(ms);
    if (ms.length) {
      const { data } = await supabase.from("meeting_items").select("*").in("meeting_id", ms.map((x) => x.id));
      setItems((data || []) as MeetingItem[]);
    } else setItems([]);
  }, [supabase, range.from, range.to]);

  useEffect(() => {
    load();
  }, [load]);

  /** Everything on one day, in time order. */
  const dayItems = useCallback(
    (date: string): Item[] => {
      const out: Item[] = events
        .filter((e) => e.event_date === date)
        .map((ev) => ({ key: ev.id, kind: "event" as const, date, start: ev.start_time.slice(0, 5), minutes: ev.minutes, ev }));
      // New-hire training only: Master Your Craft and the Thursday meeting live on their own pages.
      return out.sort((a, b) => minutesOf(a.start) - minutesOf(b.start));
    },
    [events, weeks, meetings, items]
  );

  const drafts = events.filter((e) => e.status === "draft");

  // What the signed-in manager is responsible for in view.
  const mine = useMemo(() => {
    const out: { key: string; text: string }[] = [];
    for (const e of events) {
      if (e.instructor_ids.includes(me))
        out.push({ key: `${e.event_date} ${e.start_time}`, text: `${fmtDate(e.event_date)} ${fmtTime(e.start_time)} -- ${e.title}` });
    }
    return out.sort((a, b) => a.key.localeCompare(b.key)).map((x) => x.text);
  }, [events, weeks, items, meetings, me]);

  // ---------------------------------------------------------------- saving

  async function save(d: Draft, publish = false) {
    if (!d.title.trim()) return setError("Give the session a title.");
    setBusy(true);
    setError("");
    const row = {
      org_id: orgId,
      kind: d.kind,
      title: d.title.trim(),
      topic_id: d.topic_id,
      event_date: d.event_date,
      start_time: d.start_time,
      minutes: d.minutes,
      instructor_ids: d.instructor_ids,
      guest_instructors: d.guest_instructors?.trim() || null,
      audience: d.audience,
      required: d.required,
      status: publish ? "published" : d.status,
      notes: d.notes?.trim() || null,
      material_ids: d.material_ids,
      updated_by: me,
      updated_at: new Date().toISOString(),
    };
    const res = d.id
      ? await supabase.from("training_events").update(row).eq("id", d.id)
      : await supabase.from("training_events").insert({ ...row, created_by: me });
    setBusy(false);
    if (res.error) return setError(res.error.message);
    setDraft(null);
    load();
  }

  async function remove(id: string) {
    if (!confirm("Delete this session?")) return;
    await supabase.from("training_events").delete().eq("id", id);
    setDraft(null);
    load();
  }

  async function moveEvent(id: string, date: string) {
    const ev = events.find((e) => e.id === id);
    if (!ev || ev.event_date === date) return;
    setEvents((es) => es.map((e) => (e.id === id ? { ...e, event_date: date } : e)));
    const { error } = await supabase
      .from("training_events")
      .update({ event_date: date, updated_by: me, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) setError(error.message);
    load();
  }

  async function publishDrafts() {
    if (!drafts.length) return;
    if (!confirm(`Publish ${drafts.length} draft session${drafts.length === 1 ? "" : "s"}? Reps will see them on their schedule.`)) return;
    const { error } = await supabase
      .from("training_events")
      .update({ status: "published", updated_by: me, updated_at: new Date().toISOString() })
      .in("id", drafts.map((d) => d.id));
    if (error) setError(error.message);
    load();
  }

  async function copyPreviousWeek() {
    const prev = addDays(anchor, -7);
    const { data } = await supabase.from("training_events").select("*").gte("event_date", prev).lte("event_date", addDays(prev, 4));
    const src = (data || []) as TrainingEvent[];
    if (!src.length) return setError("Last week has no sessions to copy.");
    if (!confirm(`Copy ${src.length} session${src.length === 1 ? "" : "s"} from last week into this week as drafts?`)) return;
    const rows = src.map((e) => ({
      org_id: orgId,
      kind: e.kind,
      title: e.title,
      topic_id: e.topic_id,
      event_date: addDays(e.event_date, 7),
      start_time: e.start_time,
      minutes: e.minutes,
      instructor_ids: e.instructor_ids,
      guest_instructors: e.guest_instructors,
      audience: e.audience,
      required: e.required,
      status: "draft",
      notes: e.notes,
      material_ids: e.material_ids,
      created_by: me,
      updated_by: me,
    }));
    const { error } = await supabase.from("training_events").insert(rows);
    if (error) setError(error.message);
    load();
  }

  async function loadNewHireWeek() {
    if (!confirm(`Add the new-hire week (from the Aug 31 schedule) to the week of ${fmtWeek(anchor)} as drafts? You can edit every session before publishing.`)) return;
    const who = (key: string) => managers.find((m) => (m.full_name || "").toLowerCase().startsWith(key))?.id;
    const lengths = newHireLengths();
    const rows = NEW_HIRE_WEEK.map((s, i) => {
      const ids = s.who.map(who).filter(Boolean) as string[];
      const missing = s.who.filter((k) => !who(k));
      const guest = [s.guest, ...missing.map((k) => k[0].toUpperCase() + k.slice(1))].filter(Boolean).join(", ");
      return {
        org_id: orgId,
        kind: "training",
        title: s.title,
        topic_id: topics.find((t) => t.title.toLowerCase() === s.title.toLowerCase())?.id ?? null,
        event_date: addDays(anchor, s.day - 1),
        start_time: s.time,
        minutes: lengths[i],
        instructor_ids: ids,
        guest_instructors: guest || null,
        audience: "new_hires",
        required: true,
        status: "draft",
        created_by: me,
        updated_by: me,
      };
    });
    const { error } = await supabase.from("training_events").insert(rows);
    if (error) setError(error.message);
    load();
  }

  // ---------------------------------------------------------------- drag and drop

  function onDrop(date: string, e: React.DragEvent) {
    e.preventDefault();
    setOver(null);
    const data = e.dataTransfer.getData("text/plain");
    if (data.startsWith("event:")) moveEvent(data.slice(6), date);
    if (data.startsWith("topic:")) {
      const t = topics.find((x) => x.id === data.slice(6));
      if (t) setDraft({ ...blank(date), title: t.title, topic_id: t.id });
    }
    if (data === "new") setDraft(blank(date));
  }

  const dropProps = (date: string) => ({
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      if (over !== date) setOver(date);
    },
    onDragLeave: () => setOver((o) => (o === date ? null : o)),
    onDrop: (e: React.DragEvent) => onDrop(date, e),
  });

  // ---------------------------------------------------------------- rendering

  const names = (ids: string[], guest?: string | null) =>
    [...ids.map((id) => firstName(personById(id))), ...(guest ? [guest] : [])].join(", ") || "No instructor";

  function renderItem(it: Item, compact = false) {
    if (it.kind === "event") {
      const ev = it.ev;
      return (
        <button
          key={it.key}
          className={`tr-ev ${ev.kind === "break" ? "break" : ""} ${ev.status === "draft" ? "draft" : ""}`}
          draggable
          onDragStart={(e) => e.dataTransfer.setData("text/plain", `event:${ev.id}`)}
          onClick={() => setDraft({ ...ev })}
        >
          {ev.status === "draft" && <span className="tag">Draft</span>}
          <span className="t">{compact ? fmtTime(ev.start_time) : fmtRange(ev.start_time, ev.minutes)}</span>
          <div>{ev.title}</div>
          {!compact && ev.kind !== "break" && <div className="who">{names(ev.instructor_ids, ev.guest_instructors)}</div>}
        </button>
      );
    }
    if (it.kind === "mastery") {
      const w = it.week;
      const who = mycTeacherName(w, it.day, (id) => firstName(personById(id)));
      return (
        <button key={it.key} className={`tr-ev mastery ${!w || w.status === "draft" ? "draft" : ""}`} onClick={() => openTab("mastery")}>
          {(!w || w.status === "draft") && <span className="tag">{w ? "Draft" : "Not planned"}</span>}
          <span className="t">{compact ? fmtTime(MASTERY.start) : fmtRange(MASTERY.start, MASTERY.minutes)}</span>
          <div>Master Your Craft{w?.title ? `: ${w.title}` : ""}</div>
          {!compact && <div className="who">{who || "No instructor yet"}</div>}
        </button>
      );
    }
    const mt = it.meeting;
    return (
      <button key={it.key} className={`tr-ev meeting ${!mt || mt.status === "draft" ? "draft" : ""}`} onClick={() => openTab("meeting")}>
        {(!mt || mt.status === "draft") && <span className="tag">{mt ? "Draft" : "No agenda"}</span>}
        <span className="t">{compact ? fmtTime(it.start) : fmtRange(it.start, it.minutes)}</span>
        <div>Thursday sales meeting</div>
        {!compact && <div className="who">{it.total ? `${items.filter((i) => i.meeting_id === mt?.id).length} topics · ${it.total} min` : "Agenda not built"}</div>}
      </button>
    );
  }

  const shownTopics = topics.filter((t) => !t.archived && (!filter || t.title.toLowerCase().includes(filter.toLowerCase())));

  return (
    <>
      {mine.length > 0 && (
        <details className="tr-mine">
          <summary style={{ cursor: "pointer" }}>
            <b>You&rsquo;re on for {mine.length} thing{mine.length === 1 ? "" : "s"} in view</b>
            <span className="muted"> · first: {mine[0]}</span>
          </summary>
          <div style={{ display: "grid", gap: 4, marginTop: 8 }}>
            {mine.map((m, i) => (
              <span key={i}>{m}</span>
            ))}
          </div>
        </details>
      )}

      <div className="tr-bar">
        <div className="row">
          <button className="tr-icon" aria-label="Previous" onClick={() => setAnchor(view === "week" ? addDays(anchor, -7) : mondayOf(addDays(range.from, -3)))}>
            &lsaquo;
          </button>
          <span className="tr-week">
            {view === "week" ? fmtWeek(anchor) : new Date(anchor.slice(0, 8) + "15T12:00").toLocaleDateString("en-US", { month: "long", year: "numeric" })}
          </span>
          <button className="tr-icon" aria-label="Next" onClick={() => setAnchor(view === "week" ? addDays(anchor, 7) : mondayOf(addDays(range.to, 7)))}>
            &rsaquo;
          </button>
          <button className="tr-sm" onClick={() => setAnchor(workWeek())}>
            Today
          </button>
          <div className="unit-switch" role="group" aria-label="Calendar view">
            <button aria-pressed={view === "week"} onClick={() => setView("week")}>Week</button>
            <button
              aria-pressed={view === "month"}
              onClick={() => {
                setView("month");
                // Month of the week shown, by its Wednesday.
                setAnchor(addDays(anchor, 2));
              }}
            >
              Month
            </button>
          </div>
        </div>
        <div className="row">
          {view === "week" && (
            <>
              <button className="tr-sm" onClick={copyPreviousWeek}>Copy last week</button>
              <button className="tr-sm" onClick={loadNewHireWeek}>Add new-hire week</button>
            </>
          )}
          <button className={`tr-sm ${drafts.length ? "primary" : ""}`} disabled={!drafts.length} onClick={publishDrafts}>
            Publish {drafts.length ? `${drafts.length} draft${drafts.length === 1 ? "" : "s"}` : "drafts"}
          </button>
        </div>
      </div>

      {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="tr-cal-wrap">
        <aside className="tr-topics">
          <div className="label" style={{ marginBottom: 6 }}>Topics</div>
          <p className="hint" style={{ fontSize: 12 }}>Drag one onto a day, or tap a day&rsquo;s + to add.</p>
          <input placeholder="Search topics" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <div className="tr-topic" draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", "new")}>
            <b>+ New session</b>
            <small>blank</small>
          </div>
          {shownTopics.map((t) => (
            <div key={t.id} className="tr-topic" draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", `topic:${t.id}`)}>
              {t.title}
              {t.category && <small>{t.category}</small>}
            </div>
          ))}
        </aside>

        {view === "week" ? (
          <div className="tr-grid">
            {[0, 1, 2, 3, 4].map((i) => {
              const date = addDays(anchor, i);
              const list = dayItems(date);
              return (
                <div key={date} className={`tr-day ${over === date ? "over" : ""} ${date === today() ? "today" : ""}`} {...dropProps(date)}>
                  <div className="tr-day-head">
                    <b title={fmtDate(date, { weekday: "long" })}>{fmtDate(date, { weekday: "short" })}</b>
                    <span>
                      {fmtDate(date, { month: "short", day: "numeric" })}{" "}
                      <button className="tr-icon" style={{ padding: "2px 8px", minWidth: 0 }} aria-label={`Add session ${date}`} onClick={() => setDraft(blank(date))}>
                        +
                      </button>
                    </span>
                  </div>
                  {list.map((it) => renderItem(it))}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="tr-month">
            {range.mondays.flatMap((mon) =>
              [0, 1, 2, 3, 4].map((i) => {
                const date = addDays(mon, i);
                const inMonth = date.slice(0, 7) === anchor.slice(0, 7);
                return (
                  <div key={date} className={`tr-day ${over === date ? "over" : ""} ${date === today() ? "today" : ""}`} style={{ opacity: inMonth ? 1 : 0.5 }} {...dropProps(date)}>
                    <div className="tr-day-head">
                      <button
                        className="tr-icon"
                        style={{ padding: "2px 8px", background: "none", border: "none" }}
                        onClick={() => {
                          setAnchor(mondayOf(date));
                          setView("week");
                        }}
                      >
                        <b>{fmtDate(date, { weekday: "short", day: "numeric" })}</b>
                      </button>
                    </div>
                    {dayItems(date).map((it) => renderItem(it, true))}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      <div className="tr-legend">
        <span><i style={{ background: "var(--tone)" }} />Training</span>
        <span><i style={{ border: "1px dashed var(--muted)" }} />Draft -- reps can&rsquo;t see it yet</span>
      </div>

      {draft && (
        <EventEditor
          draft={draft}
          setDraft={setDraft}
          busy={busy}
          error={error}
          conflicts={conflictsOf(draft, events, weeks)}
          onSave={save}
          onDelete={remove}
        />
      )}
    </>
  );
}

/** Overlaps with the same instructor, Master Your Craft or the Thursday meeting. Warnings only. */
function conflictsOf(d: Draft, events: TrainingEvent[], weeks: MasteryWeek[]): string[] {
  const out: string[] = [];
  const s = minutesOf(d.start_time);
  const e = s + d.minutes;
  const overlaps = (s2: number, m2: number) => s < s2 + m2 && s2 < e;
  for (const x of events) {
    if (x.id === d.id || x.event_date !== d.event_date) continue;
    if (!overlaps(minutesOf(x.start_time), x.minutes)) continue;
    const shared = x.instructor_ids.filter((i) => d.instructor_ids.includes(i));
    if (shared.length) out.push(`Same instructor already has "${x.title}" at ${fmtTime(x.start_time)}.`);
    else if (d.audience === x.audience && d.kind !== "break" && x.kind !== "break") out.push(`Overlaps "${x.title}" (${fmtTime(x.start_time)}) for the same group.`);
  }
  const wd = weekdayOf(d.event_date);
  if (wd <= 3 && overlaps(minutesOf(MASTERY.start), MASTERY.minutes)) {
    const w = weeks.find((x) => x.week_start === mondayOf(d.event_date));
    const teacher = w?.day_instructors?.[String(wd)] || w?.instructor_id;
    out.push(
      teacher && d.instructor_ids.includes(teacher)
        ? "This instructor teaches Master Your Craft at 1:30 that day."
        : "Overlaps Master Your Craft (1:30-2:00)."
    );
  }
  if (wd === 4 && overlaps(minutesOf(MEETING.start), MEETING.target)) out.push("Overlaps the Thursday sales meeting (10:00).");
  return out;
}

function EventEditor({
  draft,
  setDraft,
  busy,
  error,
  conflicts,
  onSave,
  onDelete,
}: {
  draft: Draft;
  setDraft: (d: Draft | null) => void;
  busy: boolean;
  error: string;
  conflicts: string[];
  onSave: (d: Draft, publish?: boolean) => void;
  onDelete: (id: string) => void;
}) {
  const { topics } = useHub();
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft({ ...draft, [k]: v });
  const close = useCallback(() => setDraft(null), [setDraft]);

  return (
    <Drawer
      eyebrow={draft.id ? (draft.status === "published" ? "Published session" : "Draft session") : "New session"}
      title={draft.title || "Untitled session"}
      onClose={close}
      footer={
        <>
          {error && <div className="error" style={{ margin: "0 0 10px" }}>{error}</div>}
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div className="row">
              <button className="primary" disabled={busy} onClick={() => onSave(draft, draft.status === "published")}>
                {busy ? "Saving..." : "Save"}
              </button>
              {draft.status === "draft" && (
                <button disabled={busy} onClick={() => onSave(draft, true)}>
                  Save &amp; publish
                </button>
              )}
              <button onClick={close}>Cancel</button>
            </div>
            {draft.id && (
              <button className="danger" onClick={() => onDelete(draft.id!)}>
                Delete
              </button>
            )}
          </div>
        </>
      }
    >
      <label className="field">
        <span>Topic</span>
        <select
          value={draft.topic_id ?? ""}
          onChange={(e) => {
            const t = topics.find((x) => x.id === e.target.value);
            setDraft({ ...draft, topic_id: t?.id ?? null, title: t && (!draft.title || draft.title === topics.find((x) => x.id === draft.topic_id)?.title) ? t.title : draft.title });
          }}
        >
          <option value="">-- none --</option>
          {topics.filter((t) => !t.archived).map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Title</span>
        <input value={draft.title} onChange={(e) => set("title", e.target.value)} />
      </label>
      <div className="tr-three">
        <label className="field">
          <span>Date</span>
          <input type="date" value={draft.event_date} onChange={(e) => set("event_date", e.target.value)} />
        </label>
        <label className="field">
          <span>Start</span>
          <input type="time" step={300} value={draft.start_time.slice(0, 5)} onChange={(e) => set("start_time", e.target.value)} />
        </label>
        <label className="field">
          <span>Length</span>
          <select value={draft.minutes} onChange={(e) => set("minutes", Number(e.target.value))}>
            {[...new Set([...MINUTE_CHOICES, draft.minutes])].sort((a, b) => a - b).map((m) => (
              <option key={m} value={m}>
                {m < 60 ? `${m} min` : `${Math.floor(m / 60)} hr${m % 60 ? ` ${m % 60} min` : ""}`}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="tr-two">
        <label className="field">
          <span>Type</span>
          <select value={draft.kind} onChange={(e) => set("kind", e.target.value as Draft["kind"])}>
            <option value="training">Training</option>
            <option value="break">Lunch / break</option>
          </select>
        </label>
        <label className="field">
          <span>For</span>
          <select value={draft.audience} onChange={(e) => set("audience", e.target.value as Draft["audience"])}>
            {Object.entries(AUDIENCE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>
      {draft.kind === "training" && (
        <>
          <div className="field">
            <span>Instructors</span>
            <ManagerChips value={draft.instructor_ids} onChange={(v) => set("instructor_ids", v)} />
          </div>
          <label className="field">
            <span>Guest instructor (no account)</span>
            <input value={draft.guest_instructors ?? ""} onChange={(e) => set("guest_instructors", e.target.value)} placeholder="Sebastian" />
          </label>
          <label className="row" style={{ gap: 8, marginBottom: 12 }}>
            <input type="checkbox" checked={draft.required} onChange={(e) => set("required", e.target.checked)} /> Attendance required
          </label>
          <div className="field">
            <span>Materials</span>
            <MaterialPicker value={draft.material_ids} onChange={(v) => set("material_ids", v)} />
          </div>
        </>
      )}
      <label className="field">
        <span>Notes</span>
        <textarea rows={3} value={draft.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
      </label>
      {conflicts.map((c, i) => (
        <div key={i} className="tr-warn">
          {c}
        </div>
      ))}
    </Drawer>
  );
}
