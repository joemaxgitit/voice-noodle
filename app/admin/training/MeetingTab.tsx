"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addDays,
  firstName,
  fmtDate,
  fmtTime,
  MEETING,
  minutesOf,
  mondayOf,
  timeOf,
  today,
  type Meeting,
  type MeetingItem,
} from "@/lib/training";
import { Drawer, MaterialPicker, useHub } from "./shared";

const thursdayOf = (iso: string) => addDays(mondayOf(iso), 3);

/** The upcoming Thursday (today, if it is Thursday). */
const nextThursday = () => {
  const t = thursdayOf(today());
  return t < today() ? addDays(t, 7) : t;
};

/**
 * The Thursday 10:00 sales meeting: a quick agenda of 4-7 topics in
 * 15-20 minutes, each with a presenter, plus a backlog of ideas.
 */
export default function MeetingTab() {
  const { supabase, orgId, me, managers, personById } = useHub();
  const [date, setDate] = useState(nextThursday());
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [agenda, setAgenda] = useState<MeetingItem[]>([]);
  const [backlog, setBacklog] = useState<MeetingItem[]>([]);
  const [newTitle, setNewTitle] = useState("");
  const [newIdea, setNewIdea] = useState("");
  const [editing, setEditing] = useState<MeetingItem | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<string | null>(null);
  const [backlogOver, setBacklogOver] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [m, b] = await Promise.all([
      supabase.from("meetings").select("*").eq("meeting_date", date).maybeSingle(),
      supabase.from("meeting_items").select("*").is("meeting_id", null).order("created_at"),
    ]);
    if (m.error) setError(m.error.message);
    const mt = (m.data as Meeting | null) ?? null;
    setMeeting(mt);
    setBacklog((b.data || []) as MeetingItem[]);
    if (mt) {
      const { data } = await supabase.from("meeting_items").select("*").eq("meeting_id", mt.id).order("position");
      setAgenda((data || []) as MeetingItem[]);
    } else setAgenda([]);
  }, [supabase, date]);

  useEffect(() => {
    load();
  }, [load]);

  /** The meeting row, created the first time something is added. */
  async function ensureMeeting(): Promise<string | null> {
    if (meeting) return meeting.id;
    const { data, error } = await supabase
      .from("meetings")
      .upsert({ org_id: orgId, meeting_date: date, start_time: MEETING.start }, { onConflict: "org_id,meeting_date" })
      .select("*")
      .single();
    if (error || !data) {
      setError(error?.message || "Could not create the meeting.");
      return null;
    }
    setMeeting(data as Meeting);
    return (data as Meeting).id;
  }

  const total = agenda.filter((i) => i.delivery !== "deferred").reduce((s, i) => s + i.minutes, 0);
  const start = meeting?.start_time?.slice(0, 5) ?? MEETING.start;
  const end = timeOf(minutesOf(start) + total);

  // ---------------------------------------------------------------- edits

  async function addTopic(title: string) {
    const t = title.trim();
    if (!t) return;
    const id = await ensureMeeting();
    if (!id) return;
    const { error } = await supabase.from("meeting_items").insert({
      org_id: orgId,
      meeting_id: id,
      title: t,
      minutes: 3,
      position: agenda.length,
      updated_by: me,
    });
    if (error) return setError(error.message);
    setNewTitle("");
    load();
  }

  async function addIdea() {
    const t = newIdea.trim();
    if (!t) return;
    const { error } = await supabase.from("meeting_items").insert({ org_id: orgId, meeting_id: null, title: t, minutes: 3, updated_by: me });
    if (error) return setError(error.message);
    setNewIdea("");
    load();
  }

  async function patch(id: string, p: Partial<MeetingItem>) {
    setAgenda((a) => a.map((i) => (i.id === id ? { ...i, ...p } : i)));
    setBacklog((a) => a.map((i) => (i.id === id ? { ...i, ...p } : i)));
    const { error } = await supabase
      .from("meeting_items")
      .update({ ...p, updated_by: me, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) setError(error.message);
  }

  /** Save a new order: positions 0..n. */
  async function reorder(list: MeetingItem[]) {
    // Items still carry their old position, so only the ones that moved are written.
    setAgenda(list.map((x, n) => ({ ...x, position: n })));
    const results = await Promise.all(
      list.map((i, n) => (i.position === n ? null : supabase.from("meeting_items").update({ position: n }).eq("id", i.id)))
    );
    const failed = results.find((r) => r?.error);
    if (failed?.error) setError(failed.error.message);
    load();
  }

  async function moveIntoAgenda(itemId: string, beforeId: string | null) {
    const id = await ensureMeeting();
    if (!id) return;
    const fromBacklog = backlog.find((b) => b.id === itemId);
    let list = agenda.filter((a) => a.id !== itemId);
    const item = fromBacklog ?? agenda.find((a) => a.id === itemId);
    if (!item) return;
    const at = beforeId ? list.findIndex((a) => a.id === beforeId) : list.length;
    list = [...list.slice(0, at < 0 ? list.length : at), { ...item, meeting_id: id, position: fromBacklog ? -1 : item.position }, ...list.slice(at < 0 ? list.length : at)];
    if (fromBacklog) {
      await supabase.from("meeting_items").update({ meeting_id: id, delivery: "planned", updated_by: me }).eq("id", itemId);
    }
    reorder(list);
  }

  async function toBacklog(item: MeetingItem) {
    await supabase.from("meeting_items").update({ meeting_id: null, position: 0, delivery: "planned", updated_by: me }).eq("id", item.id);
    load();
  }

  async function remove(item: MeetingItem) {
    if (!confirm(`Delete "${item.title}"?`)) return;
    await supabase.from("meeting_items").delete().eq("id", item.id);
    setEditing(null);
    load();
  }

  async function setStatus(status: "draft" | "published") {
    const id = await ensureMeeting();
    if (!id) return;
    const { error } = await supabase.from("meetings").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) setError(error.message);
    load();
  }

  async function copyFromLast(onlyDeferred: boolean) {
    const prevDate = addDays(date, -7);
    const { data: prev } = await supabase.from("meetings").select("id").eq("meeting_date", prevDate).maybeSingle();
    if (!prev) return setError(`There was no agenda on ${fmtDate(prevDate)}.`);
    const { data } = await supabase.from("meeting_items").select("*").eq("meeting_id", prev.id).order("position");
    const src = ((data || []) as MeetingItem[]).filter((i) => (onlyDeferred ? i.delivery === "deferred" : true));
    if (!src.length) return setError(onlyDeferred ? "Nothing was deferred last Thursday." : "Last Thursday's agenda was empty.");
    const id = await ensureMeeting();
    if (!id) return;
    if (onlyDeferred) {
      // Carried over: the same items move to this week.
      await Promise.all(
        src.map((i, n) =>
          supabase.from("meeting_items").update({ meeting_id: id, delivery: "planned", position: agenda.length + n, updated_by: me }).eq("id", i.id)
        )
      );
    } else {
      const { error } = await supabase.from("meeting_items").insert(
        src.map((i, n) => ({
          org_id: orgId,
          meeting_id: id,
          title: i.title,
          notes: i.notes,
          presenter_id: i.presenter_id,
          minutes: i.minutes,
          position: agenda.length + n,
          material_ids: i.material_ids,
          updated_by: me,
        }))
      );
      if (error) setError(error.message);
    }
    load();
  }

  // ---------------------------------------------------------------- drag

  const onItemDragStart = (id: string) => (e: React.DragEvent) => {
    e.dataTransfer.setData("text/plain", id);
    setDragId(id);
  };
  const onItemDrop = (beforeId: string | null) => (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const id = e.dataTransfer.getData("text/plain");
    setDropAt(null);
    setDragId(null);
    if (id && id !== beforeId) moveIntoAgenda(id, beforeId);
  };

  const shift = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= agenda.length) return;
    const list = [...agenda];
    [list[i], list[j]] = [list[j], list[i]];
    reorder(list);
  };

  const needsPrep = agenda.filter((i) => i.prep !== "ready" && i.delivery === "planned").length;
  const noPresenter = agenda.filter((i) => !i.presenter_id).length;

  return (
    <>
      <div className="tr-bar">
        <div className="row">
          <button className="tr-icon" aria-label="Previous Thursday" onClick={() => setDate(addDays(date, -7))}>&lsaquo;</button>
          <span className="tr-week">{fmtDate(date, { weekday: "short", month: "short", day: "numeric" })}</span>
          <button className="tr-icon" aria-label="Next Thursday" onClick={() => setDate(addDays(date, 7))}>&rsaquo;</button>
          <button className="tr-sm" onClick={() => setDate(nextThursday())}>Next meeting</button>
          <span className={`pill ${meeting?.status === "published" ? "good" : ""}`}>{meeting ? (meeting.status === "published" ? "Published" : "Draft") : "No agenda yet"}</span>
        </div>
        <div className="row">
          <button className="tr-sm" onClick={() => copyFromLast(true)}>Carry over deferred</button>
          <button className="tr-sm" onClick={() => copyFromLast(false)}>Copy last week</button>
          <button className="tr-sm" disabled={!agenda.length} onClick={() => setPresenting(true)}>Present</button>
          {meeting?.status === "published" ? (
            <button className="tr-sm" onClick={() => setStatus("draft")}>Unpublish</button>
          ) : (
            <button className="tr-sm primary" disabled={!agenda.length} onClick={() => setStatus("published")}>Publish</button>
          )}
        </div>
      </div>

      {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="tr-meet">
        <div>
          <div className="tr-budget">
            <b>
              {total} / {MEETING.target} min
            </b>
            <span className={`tr-meter ${total > MEETING.target ? "over" : ""}`}>
              <i style={{ width: `${Math.min(100, (total / MEETING.target) * 100)}%` }} />
            </span>
            <span className="muted">
              {fmtTime(start)} – {fmtTime(end)} · {agenda.length} topic{agenda.length === 1 ? "" : "s"}
            </span>
          </div>
          {total > MEETING.target && (
            <div className="tr-warn" style={{ marginBottom: 10 }}>
              That&rsquo;s {total - MEETING.target} minute{total - MEETING.target === 1 ? "" : "s"} over the 20-minute target. Trim a topic or defer one -- or keep it if this week needs it.
            </div>
          )}
          {(needsPrep > 0 || noPresenter > 0) && agenda.length > 0 && (
            <p className="hint">
              {noPresenter > 0 && `${noPresenter} without a presenter. `}
              {needsPrep > 0 && `${needsPrep} not marked ready yet.`}
            </p>
          )}

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDropAt("end");
            }}
            onDrop={onItemDrop(null)}
          >
            {agenda.map((it, i) => (
              <div
                key={it.id}
                className={`tr-item ${dragId === it.id ? "dragging" : ""} ${dropAt === it.id ? "drop" : ""} ${it.delivery}`}
                draggable
                onDragStart={onItemDragStart(it.id)}
                onDragEnd={() => {
                  setDragId(null);
                  setDropAt(null);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDropAt(it.id);
                }}
                onDrop={onItemDrop(it.id)}
              >
                <span className="n" title="Drag to reorder">{i + 1}</span>
                <div>
                  <button className="link-btn title" style={{ padding: 0, background: "none", border: "none", textAlign: "left" }} onClick={() => setEditing(it)}>
                    {it.title}
                  </button>
                  <div className="meta">
                    <span className={`pill ${it.prep === "ready" ? "good" : ""}`}>{it.prep === "ready" ? "Ready" : "Needs prep"}</span>
                    {it.delivery !== "planned" && <span className="pill">{it.delivery === "presented" ? "Presented" : "Deferred"}</span>}
                    {it.notes && <span>{it.notes.slice(0, 60)}{it.notes.length > 60 ? "…" : ""}</span>}
                    {it.material_ids.length > 0 && <span>{it.material_ids.length} attachment{it.material_ids.length === 1 ? "" : "s"}</span>}
                  </div>
                </div>
                <div className="ctrl">
                  <select aria-label="Presenter" value={it.presenter_id ?? ""} onChange={(e) => patch(it.id, { presenter_id: e.target.value || null })}>
                    <option value="">Presenter…</option>
                    {managers.map((m) => (
                      <option key={m.id} value={m.id}>{firstName(m)}</option>
                    ))}
                  </select>
                  <select aria-label="Minutes" value={it.minutes} onChange={(e) => patch(it.id, { minutes: Number(e.target.value) })}>
                    {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => (
                      <option key={n} value={n}>{n} min</option>
                    ))}
                  </select>
                  <button className="tr-icon" aria-label="Move up" onClick={() => shift(i, -1)} disabled={i === 0}>↑</button>
                  <button className="tr-icon" aria-label="Move down" onClick={() => shift(i, 1)} disabled={i === agenda.length - 1}>↓</button>
                </div>
              </div>
            ))}
            {agenda.length === 0 && (
              <div className={`tr-drop ${dropAt === "end" ? "over" : ""}`} style={{ cursor: "default" }}>
                <b>No topics yet</b>
                <span>Add one below, or drag ideas in from the backlog.</span>
              </div>
            )}
          </div>

          <form
            className="row"
            style={{ marginTop: 10, flexWrap: "nowrap" }}
            onSubmit={(e) => {
              e.preventDefault();
              addTopic(newTitle);
            }}
          >
            <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Add a topic -- e.g. Objection of the week" />
            <button type="submit" className="primary" disabled={!newTitle.trim()}>Add</button>
          </form>
          <p className="hint" style={{ marginTop: 8 }}>Usually {MEETING.typical}. Drag the numbers, or use the arrows, to reorder.</p>
        </div>

        <aside
          className={`tr-backlog ${backlogOver ? "over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setBacklogOver(true);
          }}
          onDragLeave={() => setBacklogOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setBacklogOver(false);
            const it = agenda.find((a) => a.id === e.dataTransfer.getData("text/plain"));
            if (it) toBacklog(it);
          }}
        >
          <div className="label">Backlog</div>
          <p className="hint" style={{ fontSize: 12 }}>Ideas for future meetings. Drag one onto the agenda, or drag an agenda topic here to save it for later.</p>
          {backlog.map((b) => (
            <div key={b.id} className="tr-item" draggable onDragStart={onItemDragStart(b.id)}>
              <button className="link-btn" style={{ padding: 0, background: "none", border: "none", textAlign: "left" }} onClick={() => setEditing(b)}>
                {b.title}
                {b.presenter_id && <small className="muted"> · {firstName(personById(b.presenter_id))}</small>}
              </button>
              <button className="tr-sm" onClick={() => moveIntoAgenda(b.id, null)} aria-label={`Add ${b.title} to the agenda`}>
                Add →
              </button>
            </div>
          ))}
          <form
            className="row"
            style={{ flexWrap: "nowrap", marginTop: 6 }}
            onSubmit={(e) => {
              e.preventDefault();
              addIdea();
            }}
          >
            <input value={newIdea} onChange={(e) => setNewIdea(e.target.value)} placeholder="New idea" style={{ padding: "8px 10px", fontSize: 14 }} />
            <button type="submit" className="tr-sm" disabled={!newIdea.trim()}>Save</button>
          </form>
        </aside>
      </div>

      {editing && (
        <ItemEditor
          item={editing}
          onClose={() => setEditing(null)}
          onSave={async (p) => {
            await patch(editing.id, p);
            setEditing(null);
            load();
          }}
          onDelete={() => remove(editing)}
          onBacklog={editing.meeting_id ? () => {
            toBacklog(editing);
            setEditing(null);
          } : undefined}
        />
      )}

      {presenting && (
        <Presenter
          items={agenda}
          start={start}
          onMark={(id, delivery) => patch(id, { delivery })}
          onClose={() => {
            setPresenting(false);
            load();
          }}
        />
      )}
    </>
  );
}

function ItemEditor({
  item,
  onClose,
  onSave,
  onDelete,
  onBacklog,
}: {
  item: MeetingItem;
  onClose: () => void;
  onSave: (p: Partial<MeetingItem>) => void;
  onDelete: () => void;
  onBacklog?: () => void;
}) {
  const { managers } = useHub();
  const [d, setD] = useState(item);
  return (
    <Drawer
      eyebrow={item.meeting_id ? "Agenda topic" : "Backlog idea"}
      title={d.title || "Untitled"}
      onClose={onClose}
      footer={
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div className="row">
            <button
              className="primary"
              onClick={() =>
                onSave({ title: d.title.trim() || item.title, notes: d.notes?.trim() || null, presenter_id: d.presenter_id, minutes: d.minutes, prep: d.prep, material_ids: d.material_ids })
              }
            >
              Save
            </button>
            <button onClick={onClose}>Cancel</button>
          </div>
          <div className="row">
            {onBacklog && <button onClick={onBacklog}>Save for later</button>}
            <button className="danger" onClick={onDelete}>Delete</button>
          </div>
        </div>
      }
    >
      <label className="field">
        <span>Topic</span>
        <input value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} />
      </label>
      <div className="tr-two">
        <label className="field">
          <span>Presenter</span>
          <select value={d.presenter_id ?? ""} onChange={(e) => setD({ ...d, presenter_id: e.target.value || null })}>
            <option value="">-- not assigned --</option>
            {managers.map((m) => (
              <option key={m.id} value={m.id}>{m.full_name}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Minutes</span>
          <select value={d.minutes} onChange={(e) => setD({ ...d, minutes: Number(e.target.value) })}>
            {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => (
              <option key={n} value={n}>{n} min</option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span>Speaking notes</span>
        <textarea rows={6} value={d.notes ?? ""} onChange={(e) => setD({ ...d, notes: e.target.value })} />
      </label>
      <div className="field">
        <span>Materials</span>
        <MaterialPicker value={d.material_ids} onChange={(v) => setD({ ...d, material_ids: v })} />
      </div>
      <label className="row" style={{ gap: 8 }}>
        <input type="checkbox" checked={d.prep === "ready"} onChange={(e) => setD({ ...d, prep: e.target.checked ? "ready" : "draft" })} /> Ready to present
      </label>
    </Drawer>
  );
}

/** Full-screen run-through for the meeting room. */
function Presenter({
  items,
  start,
  onMark,
  onClose,
}: {
  items: MeetingItem[];
  start: string;
  onMark: (id: string, d: MeetingItem["delivery"]) => void;
  onClose: () => void;
}) {
  const { personById } = useHub();
  const list = useMemo(() => items.filter((i) => i.delivery !== "deferred"), [items]);
  const [at, setAt] = useState(0);
  const [, tick] = useState(0);
  const began = useRef(Date.now());
  const topicBegan = useRef(Date.now());

  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 500);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      clearInterval(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const cur = list[at];
  const next = list[at + 1];
  const left = cur ? cur.minutes * 60 - Math.floor((Date.now() - topicBegan.current) / 1000) : 0;
  const elapsed = Math.floor((Date.now() - began.current) / 1000);
  const mmss = (s: number) => `${s < 0 ? "-" : ""}${Math.floor(Math.abs(s) / 60)}:${String(Math.abs(s) % 60).padStart(2, "0")}`;

  const go = (delivery: MeetingItem["delivery"] | null) => {
    if (cur && delivery) onMark(cur.id, delivery);
    topicBegan.current = Date.now();
    if (at + 1 >= list.length) onClose();
    else setAt(at + 1);
  };

  return (
    <div className="tr-present" role="dialog" aria-modal="true" aria-label="Meeting presentation">
      <div className="muted">
        Thursday sales meeting · started {fmtTime(start)} · {mmss(elapsed)} in · topic {at + 1} of {list.length}
      </div>
      {cur ? (
        <>
          <div className="who">{cur.presenter_id ? personById(cur.presenter_id)?.full_name : "No presenter"}</div>
          <div className="now">{cur.title}</div>
          <div className={`clock ${left < 0 ? "late" : ""}`}>{mmss(left)}</div>
          {cur.notes && <div className="notes">{cur.notes}</div>}
          <div className="next">{next ? `Next: ${next.title} · ${next.presenter_id ? firstName(personById(next.presenter_id)) : "?"}` : "Last topic"}</div>
          <div className="row">
            <button
              onClick={() => {
                topicBegan.current = Date.now();
                setAt(Math.max(0, at - 1));
              }}
              disabled={at === 0}
            >
              ← Back
            </button>
            <button onClick={() => go("deferred")}>Defer</button>
            <button className="primary" onClick={() => go("presented")}>
              {next ? "Done → next" : "Done"}
            </button>
            <button onClick={onClose}>Exit</button>
          </div>
        </>
      ) : (
        <button onClick={onClose}>Close</button>
      )}
    </div>
  );
}
