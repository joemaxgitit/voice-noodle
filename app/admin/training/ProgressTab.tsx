"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addDays,
  assignmentsFor,
  ATTENDANCE_LABEL,
  fmtDate,
  KIND_ICON,
  KIND_LABEL,
  mondayOf,
  today,
  type Assignment,
  type Attendance,
  type Enrollment,
  type Person,
  type Progress,
  type Track,
  type TrackItem,
} from "@/lib/training";
import { Drawer, useHub } from "./shared";

type AttRow = { rep_id: string; week_start: string; status: Attendance };
type Attempt = { material_id: string; user_id: string; score: number; passed: boolean; created_at: string };

const WEEKS_BACK = 8;

/**
 * Where every rep stands: what's done, what's overdue, Master Your Craft
 * attendance, and the new-hire tracks they're enrolled in.
 */
export default function ProgressTab() {
  const { supabase, orgId, me, reps, materials } = useHub();
  const [progress, setProgress] = useState<Progress[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [items, setItems] = useState<TrackItem[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [attendance, setAttendance] = useState<AttRow[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [team, setTeam] = useState<"all" | "closers" | "ams">("all");
  const [openRep, setOpenRep] = useState<Person | null>(null);
  const [openTrack, setOpenTrack] = useState<Track | null>(null);
  const [newTrack, setNewTrack] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const since = addDays(mondayOf(today()), -7 * WEEKS_BACK);
    const [p, t, i, e, a, q] = await Promise.all([
      supabase.from("training_progress").select("material_id, user_id, version, pct, completed_at, position_secs, watched_secs"),
      supabase.from("training_tracks").select("*").order("created_at"),
      supabase.from("training_track_items").select("*").order("position"),
      supabase.from("training_enrollments").select("*"),
      supabase.from("mastery_attendance").select("rep_id, week_start, status").gte("week_start", since),
      supabase.from("training_quiz_attempts").select("material_id, user_id, score, passed, created_at").order("created_at", { ascending: false }),
    ]);
    const err = t.error || i.error || e.error;
    if (err) setError(/relation|does not exist/i.test(err.message) ? `${err.message} -- run supabase/training-2.sql in the Supabase SQL Editor first.` : err.message);
    setProgress((p.data || []) as Progress[]);
    setTracks((t.data || []) as Track[]);
    setItems((i.data || []) as TrackItem[]);
    setEnrollments((e.data || []) as Enrollment[]);
    setAttendance((a.data || []) as AttRow[]);
    setAttempts((q.data || []) as Attempt[]);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const now = today();
  const shown = reps.filter((r) => team === "all" || r.team === team);
  const plan = useMemo(() => {
    const out = new Map<string, Assignment[]>();
    for (const r of reps) out.set(r.id, assignmentsFor(r, materials, progress, enrollments, items, tracks, now));
    return out;
  }, [reps, materials, progress, enrollments, items, tracks, now]);

  const attendanceOf = (repId: string) => {
    const rows = attendance.filter((a) => a.rep_id === repId);
    const present = rows.filter((a) => a.status === "present" || a.status === "makeup_done").length;
    return { present, total: rows.length };
  };

  function exportCsv() {
    const lines = [["Rep", "Team", "Item", "Kind", "From", "Due", "Status", "Percent"].join(",")];
    const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    for (const r of shown) {
      for (const a of plan.get(r.id) || []) {
        lines.push(
          [r.full_name ?? "", r.team ?? "", a.material.title, KIND_LABEL[a.material.kind], a.from, a.due ?? "", a.done ? "Done" : a.overdue ? "Overdue" : "Open", a.pct]
            .map(q)
            .join(",")
        );
      }
      const att = attendanceOf(r.id);
      lines.push([r.full_name ?? "", r.team ?? "", `Master Your Craft attendance (last ${WEEKS_BACK} weeks)`, "Class", "", "", `${att.present} of ${att.total}`, ""].map(q).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `training-progress-${now}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function createTrack() {
    const title = newTrack.trim();
    if (!title) return;
    const { data, error } = await supabase.from("training_tracks").insert({ org_id: orgId, title }).select("*").single();
    if (error) return setError(error.message);
    setNewTrack("");
    await load();
    setOpenTrack(data as Track);
  }

  return (
    <>
      {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}

      {/* ---------- tracks ---------- */}
      <div className="tr-bar">
        <h2 style={{ margin: 0, fontSize: 17 }}>Tracks</h2>
        <form
          className="row"
          style={{ flexWrap: "nowrap" }}
          onSubmit={(e) => {
            e.preventDefault();
            createTrack();
          }}
        >
          <input value={newTrack} onChange={(e) => setNewTrack(e.target.value)} placeholder="New track -- e.g. New hire: first 30 days" style={{ padding: "8px 10px", fontSize: 14, minWidth: 260 }} />
          <button className="tr-sm" type="submit" disabled={!newTrack.trim()}>Create</button>
        </form>
      </div>
      <p className="hint">A track is a list of training, each due a set number of days after a rep starts. Enroll a new hire and their whole plan appears on their My Training page.</p>
      <div className="tr-lib" style={{ marginBottom: 26 }}>
        {tracks.filter((t) => !t.archived).length === 0 && <p className="muted">No tracks yet.</p>}
        {tracks
          .filter((t) => !t.archived)
          .map((t) => {
            const enrolled = enrollments.filter((e) => e.track_id === t.id);
            const n = items.filter((i) => i.track_id === t.id).length;
            return (
              <div key={t.id} className="tr-mat">
                <span className="ico">◆</span>
                <div>
                  <div className="title">{t.title}</div>
                  <div className="meta">
                    <span>{n} item{n === 1 ? "" : "s"}</span>
                    <span>{enrolled.length} enrolled</span>
                  </div>
                </div>
                <div className="ctrl">
                  <button className="tr-sm" onClick={() => setOpenTrack(t)}>Open</button>
                </div>
              </div>
            );
          })}
      </div>

      {/* ---------- reps ---------- */}
      <div className="tr-bar">
        <h2 style={{ margin: 0, fontSize: 17 }}>Reps</h2>
        <div className="row">
          <select value={team} onChange={(e) => setTeam(e.target.value as typeof team)} style={{ width: "auto", padding: "7px 10px", fontSize: 13 }}>
            <option value="all">All reps</option>
            <option value="closers">Sales reps</option>
            <option value="ams">Account managers</option>
          </select>
          <button className="tr-sm" onClick={exportCsv}>Export CSV</button>
        </div>
      </div>
      <div className="card" style={{ padding: "4px 12px", overflowX: "auto" }}>
        <table className="tr-history">
          <thead>
            <tr>
              <th>Rep</th>
              <th>Assigned</th>
              <th>Overdue</th>
              <th>Master Your Craft</th>
              <th>Track</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const list = plan.get(r.id) || [];
              const done = list.filter((a) => a.done).length;
              const overdue = list.filter((a) => a.overdue).length;
              const att = attendanceOf(r.id);
              const ens = enrollments.filter((e) => e.rep_id === r.id);
              return (
                <tr key={r.id} onClick={() => setOpenRep(r)} style={{ cursor: "pointer" }}>
                  <td>
                    <b>{r.full_name}</b>
                  </td>
                  <td>{list.length ? `${done} / ${list.length} done` : <span className="muted">Nothing assigned</span>}</td>
                  <td>{overdue ? <span className="pill poor">{overdue} overdue</span> : <span className="muted">--</span>}</td>
                  <td>{att.total ? `${att.present} of ${att.total} attended` : <span className="muted">No record</span>}</td>
                  <td>
                    {ens.length
                      ? ens.map((e) => (
                          <div key={e.id} className="muted" style={{ fontSize: 13 }}>
                            {tracks.find((t) => t.id === e.track_id)?.title} · started {fmtDate(e.start_date, { month: "short", day: "numeric" })}
                          </div>
                        ))
                      : <span className="muted">--</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="hint" style={{ marginTop: 8 }}>Attendance covers the last {WEEKS_BACK} weeks. Click a rep for the detail.</p>

      {openRep && (
        <Drawer eyebrow="Rep progress" title={openRep.full_name || "Rep"} onClose={() => setOpenRep(null)}>
          {(plan.get(openRep.id) || []).length === 0 && <p className="muted">Nothing assigned yet.</p>}
          {(plan.get(openRep.id) || []).map((a) => {
            const last = attempts.find((x) => x.material_id === a.material.id && x.user_id === openRep.id);
            return (
              <div key={a.material.id} className="tr-mat" style={{ gridTemplateColumns: "36px minmax(0,1fr) auto", padding: "8px 10px", marginBottom: 6 }}>
                <span className="ico" style={{ width: 36, height: 36 }}>{KIND_ICON[a.material.kind]}</span>
                <div>
                  <div className="title" style={{ fontSize: 14 }}>{a.material.title}</div>
                  <div className="meta">
                    <span>{a.from}</span>
                    {a.due && <span>due {fmtDate(a.due, { month: "short", day: "numeric" })}</span>}
                    {last && <span>last quiz {last.score}%{last.passed ? " (passed)" : ""}</span>}
                  </div>
                </div>
                <span className={`pill ${a.done ? "good" : a.overdue ? "poor" : ""}`}>{a.done ? "Done" : a.overdue ? "Overdue" : a.pct ? `${a.pct}%` : "Open"}</span>
              </div>
            );
          })}
          <div className="label" style={{ marginTop: 14 }}>Master Your Craft</div>
          {attendance.filter((a) => a.rep_id === openRep.id).length === 0 ? (
            <p className="muted">No attendance recorded in the last {WEEKS_BACK} weeks.</p>
          ) : (
            attendance
              .filter((a) => a.rep_id === openRep.id)
              .sort((x, y) => y.week_start.localeCompare(x.week_start))
              .map((a) => (
                <div key={a.week_start} className="row" style={{ justifyContent: "space-between", fontSize: 14, padding: "4px 0" }}>
                  <span>Week of {fmtDate(a.week_start, { month: "short", day: "numeric" })}</span>
                  <span className="muted">{ATTENDANCE_LABEL[a.status]}</span>
                </div>
              ))
          )}
        </Drawer>
      )}

      {openTrack && (
        <TrackEditor
          track={openTrack}
          items={items.filter((i) => i.track_id === openTrack.id)}
          enrollments={enrollments.filter((e) => e.track_id === openTrack.id)}
          onClose={() => setOpenTrack(null)}
          reload={load}
          me={me}
        />
      )}
    </>
  );
}

function TrackEditor({
  track,
  items,
  enrollments,
  onClose,
  reload,
  me,
}: {
  track: Track;
  items: TrackItem[];
  enrollments: Enrollment[];
  onClose: () => void;
  reload: () => Promise<void>;
  me: string;
}) {
  const { supabase, orgId, reps, materials, personById } = useHub();
  const [title, setTitle] = useState(track.title);
  const [addMat, setAddMat] = useState("");
  const [addDay, setAddDay] = useState(1);
  const [enrollRep, setEnrollRep] = useState("");
  const [enrollStart, setEnrollStart] = useState(today());
  const [error, setError] = useState("");

  const sorted = [...items].sort((a, b) => a.day_offset - b.day_offset || a.position - b.position);
  const matTitle = (id: string) => materials.find((m) => m.id === id);

  async function run(p: PromiseLike<{ error: { message: string } | null }>) {
    const { error } = await p;
    if (error) setError(error.message);
    else setError("");
    await reload();
  }

  return (
    <Drawer
      eyebrow="Track"
      title={title || "Untitled track"}
      onClose={onClose}
      footer={
        <div className="row" style={{ justifyContent: "space-between" }}>
          <button onClick={onClose}>Close</button>
          <button
            className="danger"
            onClick={async () => {
              if (!confirm(`Archive "${track.title}"? Enrolled reps stop seeing its items.`)) return;
              await supabase.from("training_tracks").update({ archived: true }).eq("id", track.id);
              await supabase.from("training_enrollments").delete().eq("track_id", track.id);
              await reload();
              onClose();
            }}
          >
            Archive track
          </button>
        </div>
      }
    >
      {error && <div className="error">{error}</div>}
      <label className="field">
        <span>Name</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title.trim() && title !== track.title && run(supabase.from("training_tracks").update({ title: title.trim() }).eq("id", track.id))}
        />
      </label>

      <div className="label">Plan ({sorted.length})</div>
      {sorted.length === 0 && <p className="hint">Add training below. Day 1 is the rep&rsquo;s start date.</p>}
      {sorted.map((it) => {
        const m = matTitle(it.material_id);
        return (
          <div key={it.id} className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap", padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
            <span style={{ minWidth: 0 }}>
              <b>Day {it.day_offset + 1}</b> · {m ? m.title : "Deleted item"}
              {m && <small className="muted"> · {KIND_LABEL[m.kind]}{m.published ? "" : " · not published"}</small>}
            </span>
            <span className="row" style={{ flexWrap: "nowrap" }}>
              <input
                type="number"
                min={1}
                max={366}
                defaultValue={it.day_offset + 1}
                aria-label="Due on day"
                style={{ width: 70, padding: "6px 8px", fontSize: 13 }}
                onBlur={(e) => {
                  const d = Math.max(1, Math.min(366, Number(e.target.value) || 1)) - 1;
                  if (d !== it.day_offset) run(supabase.from("training_track_items").update({ day_offset: d }).eq("id", it.id));
                }}
              />
              <button className="tr-icon" aria-label="Remove" onClick={() => run(supabase.from("training_track_items").delete().eq("id", it.id))}>
                &times;
              </button>
            </span>
          </div>
        );
      })}
      <div className="row" style={{ flexWrap: "nowrap", marginTop: 10 }}>
        <select value={addMat} onChange={(e) => setAddMat(e.target.value)}>
          <option value="">Add training…</option>
          {materials
            .filter((m) => !items.some((i) => i.material_id === m.id))
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.title} ({KIND_LABEL[m.kind]})
              </option>
            ))}
        </select>
        <input type="number" min={1} max={366} value={addDay} onChange={(e) => setAddDay(Number(e.target.value) || 1)} aria-label="Due on day" style={{ width: 80 }} />
        <button
          className="tr-sm"
          disabled={!addMat}
          onClick={async () => {
            await run(
              supabase.from("training_track_items").insert({
                org_id: orgId,
                track_id: track.id,
                material_id: addMat,
                day_offset: Math.max(0, addDay - 1),
                position: items.length,
              })
            );
            setAddMat("");
          }}
        >
          Add
        </button>
      </div>
      <p className="hint" style={{ marginTop: 6 }}>The number is the day it&rsquo;s due -- day 1 is the start date.</p>

      <div className="label" style={{ marginTop: 16 }}>Enrolled ({enrollments.length})</div>
      {enrollments.map((e) => (
        <div key={e.id} className="row" style={{ justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
          <span>
            {personById(e.rep_id)?.full_name ?? "Rep"} · started {fmtDate(e.start_date, { month: "short", day: "numeric", year: "numeric" })}
          </span>
          <button className="link-btn" onClick={() => run(supabase.from("training_enrollments").delete().eq("id", e.id))}>
            Remove
          </button>
        </div>
      ))}
      <div className="row" style={{ flexWrap: "nowrap", marginTop: 10 }}>
        <select value={enrollRep} onChange={(e) => setEnrollRep(e.target.value)}>
          <option value="">Enroll a rep…</option>
          {reps
            .filter((r) => !enrollments.some((e) => e.rep_id === r.id))
            .map((r) => (
              <option key={r.id} value={r.id}>
                {r.full_name}
              </option>
            ))}
        </select>
        <input type="date" value={enrollStart} onChange={(e) => setEnrollStart(e.target.value)} aria-label="Start date" style={{ width: 170 }} />
        <button
          className="tr-sm primary"
          disabled={!enrollRep}
          onClick={async () => {
            await run(
              supabase.from("training_enrollments").insert({ org_id: orgId, track_id: track.id, rep_id: enrollRep, start_date: enrollStart, created_by: me })
            );
            setEnrollRep("");
          }}
        >
          Enroll
        </button>
      </div>
    </Drawer>
  );
}
