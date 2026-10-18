"use client";

import { useRef, useState } from "react";
import { TAG_LABEL, type RepNote } from "@/lib/repHistory";
import { fmtBytes, MAX_UPLOAD_BYTES, today } from "@/lib/training";
import type { Ctx } from "./page";

/**
 * "Add anything": type, paste (text, Excel rows, screenshots) or drop files.
 * It all lands on this rep, private to managers, and the coaching review
 * reads it.
 */
export default function NotesFiles({ ctx }: { ctx: Ctx }) {
  const { supabase, orgId, me, repId, repName, history: h, people, reload } = ctx;
  const [body, setBody] = useState("");
  const [tag, setTag] = useState<RepNote["tag"]>("note");
  const [date, setDate] = useState(today());
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [over, setOver] = useState(false);
  const [vault, setVault] = useState(false);
  const pickRef = useRef<HTMLInputElement>(null);

  function addFiles(list: FileList | File[]) {
    const arr = [...list];
    const big = arr.find((f) => f.size > MAX_UPLOAD_BYTES);
    if (big) setError(`${big.name} is over ${fmtBytes(MAX_UPLOAD_BYTES)}.`);
    setFiles((fs) => [...fs, ...arr.filter((f) => f.size <= MAX_UPLOAD_BYTES)]);
  }

  async function save() {
    if (!body.trim() && !files.length) return;
    setBusy(true);
    setError("");
    setStatus("");
    const text = body.trim();
    if (text) {
      const { error } = await supabase.from("rep_notes").insert({ org_id: orgId, rep_id: repId, author_id: me, tag, body: text, note_date: date, ...(vault ? { private: true } : {}) });
      if (error) {
        setBusy(false);
        return setError(error.message);
      }
    }
    let up = 0;
    for (const f of files) {
      const name = f.name || `pasted-${Date.now()}.png`;
      const path = `${orgId}/reps/${repId}/${crypto.randomUUID()}-${name.replace(/[^\w.-]+/g, "_")}`;
      const r = await supabase.storage.from("rep-files").upload(path, f, { contentType: f.type || undefined });
      if (r.error) {
        setError(`${name}: ${r.error.message}`);
        continue;
      }
      const { error } = await supabase.from("rep_files").insert({
        org_id: orgId,
        rep_id: repId,
        uploaded_by: me,
        name,
        path,
        mime: f.type || null,
        size_bytes: f.size,
        note: text ? text.split("\n")[0].slice(0, 200) : null,
      });
      if (error) setError(error.message);
      else up++;
    }
    setBusy(false);
    setBody("");
    setFiles([]);
    setTag("note");
    setDate(today());
    setVault(false);
    setStatus(`Added${text ? " a note" : ""}${text && up ? " and" : ""}${up ? ` ${up} file${up === 1 ? "" : "s"}` : ""}.`);
    await reload();
  }

  async function delNote(id: string) {
    if (!confirm("Delete this note?")) return;
    const { error } = await supabase.from("rep_notes").delete().eq("id", id);
    if (error) return setError(error.message);
    await reload();
  }
  async function delFile(id: string, path: string) {
    if (!confirm("Delete this file?")) return;
    const { error } = await supabase.from("rep_files").delete().eq("id", id);
    if (error) return setError(error.message);
    // A team upload can sit on several profiles; only remove the file itself once nobody uses it.
    const [{ count: files }, { count: reports }] = await Promise.all([
      supabase.from("rep_files").select("id", { count: "exact", head: true }).eq("path", path),
      supabase.from("kpi_reports").select("id", { count: "exact", head: true }).eq("path", path),
    ]);
    if (!files && !reports) await supabase.storage.from("rep-files").remove([path]);
    await reload();
  }
  async function open(path: string, name: string, download: boolean) {
    const { data, error } = await supabase.storage.from("rep-files").createSignedUrl(path, 300, download ? { download: name } : undefined);
    if (error) return setError(error.message);
    if (download) window.location.href = data.signedUrl;
    else window.open(data.signedUrl, "_blank", "noopener");
  }

  return (
    <div>
      <section
        className={`card${over ? " rx-over" : ""}`}
        style={over ? { borderColor: "var(--live)" } : undefined}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
        }}
      >
        <h3 className="rx-sec-title">Add anything about {repName.split(" ")[0]}</h3>
        <textarea
          rows={5}
          value={body}
          placeholder="Type a note, paste a Slack message, a QA write-up or rows copied from Excel, paste a screenshot, or drop files here."
          onChange={(e) => setBody(e.target.value)}
          onPaste={(e) => {
            const fs = [...e.clipboardData.files];
            if (fs.length) {
              e.preventDefault();
              addFiles(fs.map((f, i) => (f.name && f.name !== "image.png" ? f : new File([f], `screenshot-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}${i ? `-${i}` : ""}.png`, { type: f.type }))));
            }
          }}
          style={{ width: "100%" }}
        />
        <div className="rx-tags" role="group" aria-label="Kind of note">
          {(Object.keys(TAG_LABEL) as RepNote["tag"][]).map((t) => (
            <button key={t} type="button" className={tag === t ? "on" : ""} aria-pressed={tag === t} onClick={() => setTag(t)}>
              {TAG_LABEL[t]}
            </button>
          ))}
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" style={{ width: "auto", padding: "5px 8px", fontSize: 13 }} />
          <label className="hint" style={{ display: "inline-flex", gap: 6, alignItems: "center", margin: 0 }} title="Only you will see this note -- not other managers, and it stays out of coaching reviews">
            <input type="checkbox" checked={vault} onChange={(e) => setVault(e.target.checked)} style={{ width: "auto" }} /> 🔒 Vault (only me)
          </label>
        </div>
        {files.length > 0 && (
          <ul className="plain-list" style={{ margin: "6px 0" }}>
            {files.map((f, i) => (
              <li key={i}>
                {f.name} <small className="muted">· {fmtBytes(f.size)}</small>{" "}
                <button className="link-btn" onClick={() => setFiles((fs) => fs.filter((_, j) => j !== i))}>
                  remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="rx-actions">
          <input
            ref={pickRef}
            type="file"
            multiple
            style={{ display: "none" }}
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button type="button" onClick={() => pickRef.current?.click()}>
            Attach files
          </button>
          <button className="primary" disabled={busy || (!body.trim() && !files.length)} onClick={save}>
            {busy ? "Saving…" : "Add to profile"}
          </button>
        </div>
        {error && <div className="error">{error}</div>}
        {status && <div className="status">{status}</div>}
      </section>

      <div className="rx-grid2" style={{ marginTop: 14 }}>
        <section>
          <h3 className="rx-sec-title">Notes ({h.notes.length})</h3>
          {!h.notes.length && <p className="hint">No notes yet.</p>}
          {h.notes.map((n) => (
            <div key={n.id} className="rx-note">
              <div className="meta">
                <span className={`rx-kind ${n.tag === "concern" ? "concern" : "note"}`}>{TAG_LABEL[n.tag]}</span>
                {n.private && <span title="Vaulted: only you can see this">🔒 only you</span>}
                <span>
                  {n.note_date} · {people.get(n.author_id || "") ?? "someone"}
                </span>
                <button className="link-btn" onClick={() => void delNote(n.id)}>
                  Delete
                </button>
              </div>
              <p>{n.body}</p>
            </div>
          ))}
        </section>
        <section>
          <h3 className="rx-sec-title">Files ({h.files.length})</h3>
          {!h.files.length && <p className="hint">No files yet.</p>}
          {h.files.map((f) => (
            <div key={f.id} className="rx-file">
              <div>
                <b>{f.name}</b>
                <div className="hint" style={{ margin: 0 }}>
                  {new Date(f.created_at).toLocaleDateString()} · {fmtBytes(f.size_bytes)} · {people.get(f.uploaded_by || "") ?? "someone"}
                  {f.note ? ` · ${f.note}` : ""}
                </div>
              </div>
              <div style={{ whiteSpace: "nowrap" }}>
                <button className="tr-sm" onClick={() => void open(f.path, f.name, false)}>
                  Open
                </button>{" "}
                <button className="tr-sm" onClick={() => void open(f.path, f.name, true)}>
                  Download
                </button>{" "}
                <button className="tr-sm danger" onClick={() => void delFile(f.id, f.path)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
