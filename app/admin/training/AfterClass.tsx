"use client";

import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Upload } from "tus-js-client";
import LessonText from "./LessonText";

/*
  After a Master Your Craft class: the meeting recording(s) and the leave
  behind that goes in the reps' Teams chat. Kept on the week, so Topic
  history shows them. The leave behind is shown exactly as pasted -- only
  laid out, never reworded.
*/

export type Recording = { path?: string; link?: string; name: string; size?: number; day?: string; added_at: string };

const DAYS = ["", "Monday", "Tuesday", "Wednesday"];
const mb = (n?: number) => (n ? `${Math.round(n / 1024 / 1024)} MB` : "");
const safe = (s: string) => s.replace(/[^\w.-]+/g, "_");

/** Big files go up in 6 MB pieces, so a long recording survives a shaky connection. */
function uploadResumable(supabase: SupabaseClient, token: string, path: string, file: File, onPct: (p: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const up = new Upload(file, {
      endpoint: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/upload/resumable`,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: { authorization: `Bearer ${token}`, "x-upsert": "true" },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: { bucketName: "training", objectName: path, contentType: file.type || "video/mp4", cacheControl: "3600" },
      chunkSize: 6 * 1024 * 1024,
      onError: reject,
      onProgress: (sent, total) => onPct(Math.round((sent / total) * 100)),
      onSuccess: () => resolve(),
    });
    void up.findPreviousUploads().then((prev) => {
      if (prev.length) up.resumeFromPreviousUpload(prev[0]);
      up.start();
    });
  });
}

export function RecordingPlayer({ supabase, rec }: { supabase: SupabaseClient; rec: Recording }) {
  const [url, setUrl] = useState("");
  if (rec.link)
    return (
      <a href={rec.link} target="_blank" rel="noreferrer">
        {rec.name || "Open the recording"} ↗
      </a>
    );
  if (!url)
    return (
      <button
        className="tr-sm"
        onClick={async () => {
          const { data } = await supabase.storage.from("training").createSignedUrl(rec.path!, 3600);
          if (data) setUrl(data.signedUrl);
        }}
      >
        ▶ Play {rec.day ? `${rec.day}'s` : ""} recording
      </button>
    );
  return <video src={url} controls autoPlay style={{ width: "100%", maxWidth: 760, borderRadius: 8, background: "#000" }} />;
}

export default function AfterClass({
  supabase,
  orgId,
  me,
  week,
  recordings,
  leaveBehind,
  onSaved,
}: {
  supabase: SupabaseClient;
  orgId: string;
  me: string;
  week: string;
  recordings: Recording[];
  leaveBehind: string | null;
  onSaved: () => void;
}) {
  const [text, setText] = useState(leaveBehind ?? "");
  const [editing, setEditing] = useState(!leaveBehind);
  const [day, setDay] = useState("");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setText(leaveBehind ?? "");
    setEditing(!leaveBehind);
  }, [leaveBehind, week]);

  async function write(changes: { recordings?: Recording[]; leave_behind?: string | null }) {
    const { error } = await supabase
      .from("mastery_weeks")
      .upsert({ org_id: orgId, week_start: week, ...changes, updated_by: me, updated_at: new Date().toISOString() }, { onConflict: "org_id,week_start" });
    if (error) {
      setError(/recordings|leave_behind/.test(error.message) ? `${error.message} -- run supabase/myc-after-class.sql first.` : error.message);
      return false;
    }
    onSaved();
    return true;
  }

  async function addFile(f: File) {
    setError("");
    if (!/^video\/|^audio\//.test(f.type) && !/\.(mp4|mov|m4v|webm|mkv|mp3|m4a|wav)$/i.test(f.name)) return setError(`${f.name} doesn't look like a video or audio file.`);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return;
    const path = `${orgId}/myc/${week}/${Date.now()}-${safe(f.name)}`;
    setBusy(`Uploading ${f.name} (${mb(f.size)})… 0%`);
    try {
      await uploadResumable(supabase, session.access_token, path, f, (p) => setBusy(`Uploading ${f.name} (${mb(f.size)})… ${p}% -- keep this page open`));
    } catch (e) {
      setBusy("");
      const msg = e instanceof Error ? e.message : String(e);
      return setError(
        /413|too large|exceeded|maximum/i.test(msg)
          ? `${f.name} is bigger than your storage allows per file. Raise the upload size limit in Supabase (Storage → Settings), or paste the Teams/Stream link instead.`
          : `Upload failed: ${msg}`
      );
    }
    const ok = await write({ recordings: [...recordings, { path, name: f.name, size: f.size, day: day || undefined, added_at: new Date().toISOString() }] });
    setBusy("");
    if (ok) flash("Recording saved.");
  }

  async function addLink() {
    const url = link.trim();
    if (!/^https?:\/\//i.test(url)) return setError("Paste the full link, starting with https://");
    setError("");
    // A Teams recap link carries the recording's date (…-20261019_202446UTC-Meeting Recording.mp4), so the day fills itself in.
    let d = day;
    const m = decodeURIComponent(url).match(/-(20\d{2})(\d{2})(\d{2})_\d{6}UTC/);
    if (!d && m) d = DAYS[new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay()] || "";
    if (await write({ recordings: [...recordings, { link: url, name: d ? `${d}'s recording` : "Recording", day: d || undefined, added_at: new Date().toISOString() }] })) {
      setLink("");
      flash("Link saved.");
    }
  }

  async function remove(r: Recording) {
    if (!confirm(`Remove ${r.name}?`)) return;
    if (await write({ recordings: recordings.filter((x) => x !== r) })) if (r.path) await supabase.storage.from("training").remove([r.path]);
  }

  async function saveText() {
    if (await write({ leave_behind: text.trim() || null })) {
      setEditing(!text.trim());
      flash("Leave behind saved.");
    }
  }

  function flash(s: string) {
    setSaved(s);
    setTimeout(() => setSaved(""), 2500);
  }

  return (
    <div className="card" style={{ display: "grid", gap: 14 }}>
      {error && <div className="error">{error}</div>}
      {saved && <div className="status">{saved}</div>}

      <div className="field" style={{ margin: 0 }}>
        <span>Class recording</span>
        {recordings.map((r) => (
          <div key={r.added_at + r.name} className="rx-file" style={{ alignItems: "center" }}>
            <div style={{ display: "grid", gap: 6, flex: 1 }}>
              <small className="muted">
                {r.day ? `${r.day} · ` : ""}
                {r.name} {r.size ? `· ${mb(r.size)}` : ""}
              </small>
              <RecordingPlayer supabase={supabase} rec={r} />
            </div>
            <button className="tr-sm" onClick={() => void remove(r)} aria-label={`Remove ${r.name}`}>
              Remove
            </button>
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select value={day} onChange={(e) => setDay(e.target.value)} style={{ width: "auto" }} aria-label="Which class">
            <option value="">Any day</option>
            {DAYS.slice(1).map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
          <button disabled={!!busy} onClick={() => input.current?.click()}>
            Upload the video
          </button>
          <input
            ref={input}
            type="file"
            accept="video/*,audio/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void addFile(f);
            }}
          />
          <span className="muted">or</span>
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste a Teams / Stream link" style={{ flex: 1, minWidth: 200 }} />
          <button disabled={!link.trim() || !!busy} onClick={() => void addLink()}>
            Save link
          </button>
        </div>
        {busy && <p className="hint" style={{ margin: 0 }}>{busy}</p>}
      </div>

      <div className="field" style={{ margin: 0 }}>
        <span>Leave behind (what went in the reps&rsquo; chat)</span>
        {editing ? (
          <>
            <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the leave behind here. It's kept word for word -- only laid out to read nicely." style={{ fontFamily: "var(--font)" }} />
            <div style={{ display: "flex", gap: 8 }}>
              <button className="primary" onClick={() => void saveText()}>
                Save leave behind
              </button>
              {leaveBehind && (
                <button
                  onClick={() => {
                    setText(leaveBehind);
                    setEditing(false);
                  }}
                >
                  Cancel
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="card" style={{ background: "var(--ink-3)" }}>
              <LessonText text={leaveBehind ?? ""} />
            </div>
            <div>
              <button className="tr-sm" onClick={() => setEditing(true)}>
                Edit
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
