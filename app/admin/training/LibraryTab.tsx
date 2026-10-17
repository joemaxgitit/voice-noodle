"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AUDIENCE_LABEL,
  CATEGORIES,
  fmtBytes,
  fmtDate,
  fmtDuration,
  guessKind,
  KIND_ICON,
  KIND_LABEL,
  MAX_UPLOAD_BYTES,
  titleFromFile,
  videoDuration,
  type Material,
  type Progress,
} from "@/lib/training";
import { Drawer, useHub } from "./shared";
import QuizEditor from "./QuizEditor";

type ModuleRef = { id: string; title: string; language: string | null; scripts: { title: string } | null };
type PersonaRef = { id: string; name: string; title: string };

const safeName = (n: string) => n.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-120);

/**
 * The training library: videos, PDFs, slides, documents and links that
 * reps study from and sessions attach. Files go straight from the browser
 * to private storage.
 */
export default function LibraryTab() {
  const { supabase, orgId, me, reps, topics, materials, reloadLibrary } = useHub();
  const [progress, setProgress] = useState<Progress[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [over, setOver] = useState(false);
  const [editing, setEditing] = useState<Material | null>(null);
  const [link, setLink] = useState({ title: "", url: "" });
  const [topicForm, setTopicForm] = useState({ title: "", category: CATEGORIES[0] });
  const [filter, setFilter] = useState("");
  const [modules, setModules] = useState<ModuleRef[]>([]);
  const [personas, setPersonas] = useState<PersonaRef[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const replaceFor = useRef<Material | null>(null);

  const loadProgress = useCallback(async () => {
    const { data } = await supabase.from("training_progress").select("material_id, user_id, version, pct, completed_at, position_secs, watched_secs");
    setProgress((data || []) as Progress[]);
  }, [supabase]);

  useEffect(() => {
    loadProgress();
    // What a script-practice or practice-call assignment can point at.
    supabase
      .from("modules")
      .select("id, title, language, scripts(title)")
      .eq("active", true)
      .order("sort_order")
      .then(({ data }) => setModules((data || []) as unknown as ModuleRef[]));
    supabase
      .from("roleplay_personas")
      .select("id, name, title")
      .order("sort_order")
      .then(({ data }) => setPersonas((data || []) as PersonaRef[]));
  }, [loadProgress, supabase]);

  /** Knowledge checks, script practice and practice calls start as an empty, unpublished item. */
  async function create(kind: "quiz" | "module" | "practice") {
    setError("");
    const title = kind === "quiz" ? "New knowledge check" : kind === "module" ? "Script practice" : "Practice call";
    const { data, error } = await supabase
      .from("training_materials")
      .insert({ org_id: orgId, title, kind, published: false, created_by: me })
      .select("*")
      .single();
    if (error || !data) return setError(error?.message || "Could not create it.");
    await reloadLibrary();
    setEditing(data as Material);
  }

  const repIds = useMemo(() => new Set(reps.map((r) => r.id)), [reps]);
  const doneCount = (m: Material) =>
    progress.filter((p) => p.material_id === m.id && repIds.has(p.user_id) && p.completed_at && p.version === m.version).length;

  // ---------------------------------------------------------------- uploads

  async function upload(files: File[]) {
    setError("");
    const tooBig = files.filter((f) => f.size > MAX_UPLOAD_BYTES);
    if (tooBig.length) {
      setError(
        `${tooBig.map((f) => `${f.name} (${fmtBytes(f.size)})`).join(", ")} is over the 50 MB limit on your Supabase plan. Compress it first, or upload it to Loom/YouTube (unlisted) and add it as a link.`
      );
    }
    const ok = files.filter((f) => f.size <= MAX_UPLOAD_BYTES);
    for (let i = 0; i < ok.length; i++) {
      const f = ok[i];
      setBusy(`Uploading ${f.name}${ok.length > 1 ? ` (${i + 1} of ${ok.length})` : ""}…`);
      const kind = guessKind(f);
      const duration = kind === "video" ? await videoDuration(f) : null;
      const { data: row, error } = await supabase
        .from("training_materials")
        .insert({
          org_id: orgId,
          title: titleFromFile(f.name),
          kind,
          file_name: f.name,
          size_bytes: f.size,
          duration_secs: duration,
          published: false, // check it, then publish
          created_by: me,
        })
        .select("id")
        .single();
      if (error || !row) {
        setError(error?.message || "Could not add the file.");
        continue;
      }
      const path = `${orgId}/${row.id}/${safeName(f.name)}`;
      const { error: upErr } = await supabase.storage.from("training").upload(path, f, { contentType: f.type || undefined, upsert: true });
      if (upErr) {
        await supabase.from("training_materials").delete().eq("id", row.id);
        setError(`${f.name}: ${upErr.message}`);
        continue;
      }
      await supabase.from("training_materials").update({ storage_path: path }).eq("id", row.id);
    }
    setBusy("");
    await reloadLibrary();
  }

  /** A new copy of a file: same material, version + 1, so earlier completions don't count for the new one. */
  async function replace(m: Material, f: File) {
    if (f.size > MAX_UPLOAD_BYTES) return setError(`${f.name} is over the 50 MB limit.`);
    if (!confirm(`Replace "${m.title}" with ${f.name}? Reps who finished the old version will need to finish this one.`)) return;
    setBusy(`Uploading ${f.name}…`);
    const path = `${orgId}/${m.id}/v${m.version + 1}-${safeName(f.name)}`;
    const { error: upErr } = await supabase.storage.from("training").upload(path, f, { contentType: f.type || undefined, upsert: true });
    if (upErr) {
      setBusy("");
      return setError(upErr.message);
    }
    const duration = guessKind(f) === "video" ? await videoDuration(f) : null;
    const old = m.storage_path;
    await supabase
      .from("training_materials")
      .update({ storage_path: path, file_name: f.name, size_bytes: f.size, duration_secs: duration ?? m.duration_secs, version: m.version + 1, updated_at: new Date().toISOString() })
      .eq("id", m.id);
    if (old) await supabase.storage.from("training").remove([old]);
    setBusy("");
    await reloadLibrary();
  }

  async function addLink() {
    const url = link.url.trim();
    if (!/^https?:\/\//i.test(url)) return setError("Paste the full link, starting with https://");
    const { error } = await supabase.from("training_materials").insert({
      org_id: orgId,
      title: link.title.trim() || url,
      kind: "link",
      url,
      published: false,
      created_by: me,
    });
    if (error) return setError(error.message);
    setLink({ title: "", url: "" });
    reloadLibrary();
  }

  async function remove(m: Material) {
    if (!confirm(`Delete "${m.title}"? Reps' progress on it is deleted too.`)) return;
    if (m.storage_path) await supabase.storage.from("training").remove([m.storage_path]);
    await supabase.from("training_materials").delete().eq("id", m.id);
    setEditing(null);
    reloadLibrary();
  }

  async function save(m: Material) {
    const { error } = await supabase
      .from("training_materials")
      .update({
        title: m.title.trim() || "Untitled",
        description: m.description?.trim() || null,
        topic_id: m.topic_id,
        published: m.published,
        required: m.required,
        audience: m.audience,
        due_date: m.due_date || null,
        complete_pct: m.complete_pct,
        module_id: m.module_id ?? null,
        persona_id: m.persona_id ?? null,
        pass_pct: m.pass_pct ?? 80,
        min_score: m.min_score ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", m.id);
    if (error) return setError(error.message);
    setEditing(null);
    reloadLibrary();
  }

  async function addTopic() {
    const title = topicForm.title.trim();
    if (!title) return;
    if (topics.some((t) => t.title.toLowerCase() === title.toLowerCase())) return setError("That topic already exists.");
    const { error } = await supabase.from("training_topics").insert({ org_id: orgId, title, category: topicForm.category, created_by: me });
    if (error) return setError(error.message);
    setTopicForm({ ...topicForm, title: "" });
    reloadLibrary();
  }

  async function archiveTopic(id: string, archived: boolean) {
    await supabase.from("training_topics").update({ archived, updated_at: new Date().toISOString() }).eq("id", id);
    reloadLibrary();
  }

  const shown = materials.filter((m) => !filter || m.title.toLowerCase().includes(filter.toLowerCase()));
  const topicTitle = (id: string | null) => topics.find((t) => t.id === id)?.title;

  return (
    <>
      {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}

      <div
        className={`tr-drop ${over ? "over" : ""}`}
        onClick={() => fileInput.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          upload([...e.dataTransfer.files]);
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileInput.current?.click()}
      >
        {busy ? (
          <b>{busy}</b>
        ) : (
          <>
            <b>Drop training videos, PDFs or slides here</b>
            <span>or click to choose · up to 50 MB each · new files start unpublished so you can check them first</span>
          </>
        )}
      </div>
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        accept="video/*,.pdf,.ppt,.pptx,.doc,.docx,.key"
        onChange={(e) => {
          const files = [...(e.target.files || [])];
          e.target.value = "";
          const target = replaceFor.current;
          replaceFor.current = null;
          if (target && files[0]) replace(target, files[0]);
          else upload(files);
        }}
      />

      <form
        className="row"
        style={{ marginTop: 10, flexWrap: "nowrap" }}
        onSubmit={(e) => {
          e.preventDefault();
          addLink();
        }}
      >
        <input value={link.title} onChange={(e) => setLink({ ...link, title: e.target.value })} placeholder="Link title" style={{ maxWidth: 260 }} />
        <input value={link.url} onChange={(e) => setLink({ ...link, url: e.target.value })} placeholder="https://… (Loom, YouTube, OneDrive)" />
        <button type="submit" disabled={!link.url.trim()}>Add link</button>
      </form>

      <div className="row" style={{ marginTop: 10 }}>
        <button className="tr-sm" onClick={() => create("quiz")}>+ Knowledge check</button>
        <button className="tr-sm" onClick={() => create("module")}>+ Script practice assignment</button>
        <button className="tr-sm" onClick={() => create("practice")}>+ Practice call assignment</button>
      </div>

      <div className="tr-bar" style={{ marginTop: 22 }}>
        <h2 style={{ margin: 0, fontSize: 17 }}>Materials ({materials.length})</h2>
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search" style={{ maxWidth: 240, padding: "8px 10px", fontSize: 14 }} />
      </div>

      <div className="tr-lib">
        {shown.length === 0 && <p className="muted">Nothing here yet.</p>}
        {shown.map((m) => (
          <div key={m.id} className="tr-mat" style={{ opacity: m.published ? 1 : 0.75 }}>
            <span className="ico">{KIND_ICON[m.kind]}</span>
            <div>
              <div className="title">{m.title}</div>
              <div className="meta">
                <span>{KIND_LABEL[m.kind]}</span>
                {m.duration_secs ? <span>{fmtDuration(m.duration_secs)}</span> : null}
                {m.size_bytes ? <span>{fmtBytes(m.size_bytes)}</span> : null}
                {topicTitle(m.topic_id) && <span>{topicTitle(m.topic_id)}</span>}
                {m.version > 1 && <span>v{m.version}</span>}
              </div>
              <div className="meta">
                {!m.published && <span className="pill">Not published</span>}
                {m.required && <span className="pill fair">Required{m.due_date ? ` by ${fmtDate(m.due_date, { month: "short", day: "numeric" })}` : ""}</span>}
                {m.audience !== "all" && <span className="pill">{AUDIENCE_LABEL[m.audience]}</span>}
                {m.published && <span>{doneCount(m)} of {reps.length} reps done</span>}
              </div>
            </div>
            <div className="ctrl">
              <a className="btn tr-sm" href={`/training/${m.id}`} target="_blank" rel="noreferrer" style={{ textDecoration: "none", padding: "7px 11px", fontSize: 13 }}>
                Open
              </a>
              <button className="tr-sm" onClick={() => setEditing({ ...m })}>Edit</button>
              {!m.published && (
                <button className="tr-sm primary" onClick={() => save({ ...m, published: true })}>Publish</button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* ---------- topics ---------- */}
      <div className="rp-section" style={{ marginTop: 28 }}>
        <h2 style={{ fontSize: 17 }}>Topics</h2>
        <p className="hint">Topics are what you schedule. Reuse them across the calendar, Master Your Craft and the library.</p>
        <form
          className="row"
          style={{ flexWrap: "nowrap", marginBottom: 12 }}
          onSubmit={(e) => {
            e.preventDefault();
            addTopic();
          }}
        >
          <input value={topicForm.title} onChange={(e) => setTopicForm({ ...topicForm, title: e.target.value })} placeholder="New topic" />
          <select value={topicForm.category} onChange={(e) => setTopicForm({ ...topicForm, category: e.target.value })} style={{ width: "auto" }}>
            {CATEGORIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <button type="submit" disabled={!topicForm.title.trim()}>Add</button>
        </form>
        <div className="card" style={{ padding: "4px 12px" }}>
          <table className="tr-history">
            <thead>
              <tr>
                <th>Topic</th>
                <th>Category</th>
                <th>Materials</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {topics.map((t) => (
                <tr key={t.id} style={{ opacity: t.archived ? 0.5 : 1 }}>
                  <td>{t.title}</td>
                  <td>{t.category || "--"}</td>
                  <td>{materials.filter((m) => m.topic_id === t.id).length || ""}</td>
                  <td style={{ textAlign: "right" }}>
                    <button className="link-btn" onClick={() => archiveTopic(t.id, !t.archived)}>
                      {t.archived ? "Restore" : "Archive"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <MaterialEditor
          modules={modules}
          personas={personas}
          m={editing}
          setM={setEditing}
          progress={progress.filter((p) => p.material_id === editing.id)}
          onSave={() => save(editing)}
          onDelete={() => remove(editing)}
          onReplace={() => {
            replaceFor.current = editing;
            fileInput.current?.click();
          }}
        />
      )}
    </>
  );
}

function MaterialEditor({
  modules,
  personas,
  m,
  setM,
  progress,
  onSave,
  onDelete,
  onReplace,
}: {
  modules: ModuleRef[];
  personas: PersonaRef[];
  m: Material;
  setM: (m: Material | null) => void;
  progress: Progress[];
  onSave: () => void;
  onDelete: () => void;
  onReplace: () => void;
}) {
  const { topics, reps } = useHub();
  const set = <K extends keyof Material>(k: K, v: Material[K]) => setM({ ...m, [k]: v });
  const close = useCallback(() => setM(null), [setM]);
  const byRep = new Map(progress.map((p) => [p.user_id, p]));
  const audienceReps = reps.filter((r) => m.audience === "all" || r.team === m.audience);

  return (
    <Drawer
      eyebrow={KIND_LABEL[m.kind]}
      title={m.title || "Untitled"}
      onClose={close}
      footer={
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div className="row">
            <button className="primary" onClick={onSave}>Save</button>
            <button onClick={close}>Cancel</button>
          </div>
          <div className="row">
            {["video", "pdf", "doc", "slides"].includes(m.kind) && <button onClick={onReplace}>Replace file</button>}
            <button className="danger" onClick={onDelete}>Delete</button>
          </div>
        </div>
      }
    >
      <label className="field">
        <span>Title</span>
        <input value={m.title} onChange={(e) => set("title", e.target.value)} />
      </label>
      <label className="field">
        <span>What reps should get from it</span>
        <textarea rows={3} value={m.description ?? ""} onChange={(e) => set("description", e.target.value)} />
      </label>
      <label className="field">
        <span>Topic</span>
        <select value={m.topic_id ?? ""} onChange={(e) => set("topic_id", e.target.value || null)}>
          <option value="">-- none --</option>
          {topics.filter((t) => !t.archived).map((t) => (
            <option key={t.id} value={t.id}>{t.title}</option>
          ))}
        </select>
      </label>
      {m.kind === "module" && (
        <label className="field">
          <span>Script section to practice</span>
          <select
            value={m.module_id ?? ""}
            onChange={(e) => {
              const mod = modules.find((x) => x.id === e.target.value);
              setM({ ...m, module_id: mod?.id ?? null, title: mod && (m.title === "Script practice" || !m.title) ? `Practice: ${mod.title}` : m.title });
            }}
          >
            <option value="">-- pick a section --</option>
            {modules.map((x) => (
              <option key={x.id} value={x.id}>
                {x.scripts?.title ? `${x.scripts.title} · ` : ""}
                {x.title}
                {x.language === "es" ? " (ES)" : ""}
              </option>
            ))}
          </select>
          <p className="hint" style={{ marginTop: 6 }}>Done when the rep has completed every line of the section in the karaoke trainer.</p>
        </label>
      )}
      {m.kind === "practice" && (
        <div className="tr-two">
          <label className="field">
            <span>Practice client</span>
            <select
              value={m.persona_id ?? ""}
              onChange={(e) => {
                const p = personas.find((x) => x.id === e.target.value);
                setM({ ...m, persona_id: p?.id ?? null, title: p && (m.title === "Practice call" || !m.title) ? `Practice call: ${p.title}` : m.title });
              }}
            >
              <option value="">-- pick a client --</option>
              {personas.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.title} ({x.name})
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Lowest Straight Line score that counts</span>
            <input
              type="number"
              min={0}
              max={100}
              value={m.min_score ?? ""}
              placeholder="Any graded call"
              onChange={(e) => set("min_score", e.target.value === "" ? null : Math.max(0, Math.min(100, Number(e.target.value))))}
            />
          </label>
        </div>
      )}
      {m.kind === "quiz" && (
        <>
          <label className="field" style={{ maxWidth: 220 }}>
            <span>Pass mark (%)</span>
            <input type="number" min={1} max={100} value={m.pass_pct ?? 80} onChange={(e) => set("pass_pct", Math.max(1, Math.min(100, Number(e.target.value) || 80)))} />
          </label>
          <QuizEditor materialId={m.id} />
        </>
      )}

      <label className="row" style={{ gap: 8, marginBottom: 10 }}>
        <input type="checkbox" checked={m.published} onChange={(e) => set("published", e.target.checked)} /> Published -- reps can find it in their library
      </label>
      <label className="row" style={{ gap: 8, marginBottom: 10 }}>
        <input type="checkbox" checked={m.required} onChange={(e) => set("required", e.target.checked)} /> Required -- it goes on reps&rsquo; to-do list
      </label>
      {m.required && (
        <div className="tr-three">
          <label className="field">
            <span>For</span>
            <select value={m.audience} onChange={(e) => set("audience", e.target.value as Material["audience"])}>
              <option value="all">Everyone</option>
              <option value="closers">Sales reps</option>
              <option value="ams">Account managers</option>
            </select>
          </label>
          <label className="field">
            <span>Due</span>
            <input type="date" value={m.due_date ?? ""} onChange={(e) => set("due_date", e.target.value || null)} />
          </label>
          {m.kind === "video" && (
            <label className="field">
              <span>Done at (% watched)</span>
              <input type="number" min={10} max={100} value={m.complete_pct} onChange={(e) => set("complete_pct", Math.max(10, Math.min(100, Number(e.target.value) || 90)))} />
            </label>
          )}
        </div>
      )}
      {m.kind === "video" && (
        <p className="hint">Watch time only counts while the video actually plays -- skipping ahead doesn&rsquo;t complete it.</p>
      )}

      <div className="label" style={{ marginTop: 10 }}>Reps</div>
      <div className="card" style={{ padding: "4px 12px" }}>
        <table className="tr-history">
          <tbody>
            {audienceReps.map((r) => {
              const p = byRep.get(r.id);
              const current = p && p.version === m.version;
              return (
                <tr key={r.id}>
                  <td>{r.full_name}</td>
                  <td style={{ textAlign: "right" }}>
                    {current && p.completed_at ? (
                      <span className="pill good">Done {fmtDate(p.completed_at.slice(0, 10), { month: "short", day: "numeric" })}</span>
                    ) : current && p.pct > 0 ? (
                      <span className="muted">{p.pct}%</span>
                    ) : p && !current ? (
                      <span className="muted">Finished an older version</span>
                    ) : (
                      <span className="muted">Not started</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Drawer>
  );
}
