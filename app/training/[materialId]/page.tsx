"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { fmtDuration, KIND_LABEL, type Material, type Progress } from "@/lib/training";
import { ModuleStatus, PracticeStatus, QuizTaker } from "./Activities";
import "../../admin/calls/calls.css";
import "../training.css";

const PING_SECS = 10;

/**
 * One training video or document. Videos resume where the rep left off and
 * report how long they actually played; documents and links are marked done
 * with "I've read it".
 */
export default function MaterialPage() {
  const { materialId } = useParams<{ materialId: string }>();
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [m, setM] = useState<Material | null>(null);
  const [p, setP] = useState<Progress | null>(null);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [pct, setPct] = useState(0);
  const [done, setDone] = useState(false);
  const [userId, setUserId] = useState("");
  const video = useRef<HTMLVideoElement>(null);
  const played = useRef(0); // seconds played since the last report
  const lastT = useRef<number | null>(null);
  const resumed = useRef(false);

  const load = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      router.replace("/login");
      return;
    }
    setUserId(session.user.id);
    // Script-practice and practice-call assignments complete from what was done.
    await supabase.rpc("training_sync_links");
    const [{ data, error }, { data: prog }] = await Promise.all([
      supabase.from("training_materials").select("*").eq("id", materialId).maybeSingle(),
      supabase.from("training_progress").select("*").eq("material_id", materialId).eq("user_id", session.user.id).maybeSingle(),
    ]);
    if (error || !data) {
      setError("This training isn't available.");
      return;
    }
    const mat = data as Material;
    setM(mat);
    const pr = (prog as Progress | null) ?? null;
    const current = pr && pr.version === mat.version ? pr : null;
    setP(current);
    setPct(current?.pct ?? 0);
    setDone(!!current?.completed_at);
    if (mat.storage_path) {
      const { data: s } = await supabase.storage.from("training").createSignedUrl(mat.storage_path, 4 * 3600);
      if (s?.signedUrl) setUrl(s.signedUrl);
      else setError("Could not open the file.");
    }
  }, [supabase, router, materialId]);

  useEffect(() => {
    load();
  }, [load]);

  const report = useCallback(async () => {
    const v = video.current;
    if (!m || !v) return;
    const secs = played.current;
    played.current = 0;
    const { data } = await supabase.rpc("training_watch", { p_material: m.id, p_position: v.currentTime, p_played: secs });
    const r = (Array.isArray(data) ? data[0] : data) as { pct: number; completed: boolean } | null;
    if (r) {
      setPct(r.pct);
      if (r.completed) setDone(true);
    }
  }, [m, supabase]);

  // Report on a timer while playing, and when the page is hidden or closed.
  useEffect(() => {
    if (m?.kind !== "video") return;
    const t = setInterval(() => {
      if (played.current > 0) report();
    }, PING_SECS * 1000);
    const flush = () => {
      if (played.current > 0) report();
    };
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("pagehide", flush);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", flush);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [m, report]);

  async function acknowledge() {
    if (!m) return;
    const { error } = await supabase.rpc("training_acknowledge", { p_material: m.id });
    if (error) return setError(error.message);
    setDone(true);
    setPct(100);
  }

  if (error && !m) {
    return (
      <main className="shell">
        <Link className="btn" href="/training" style={{ textDecoration: "none" }}>&larr; My training</Link>
        <p className="muted" style={{ marginTop: 20 }}>{error}</p>
      </main>
    );
  }
  if (!m) return <main className="shell"><p className="muted">Loading&hellip;</p></main>;

  return (
    <main className="shell my-shell">
      <div className="topbar">
        <Link className="btn" href="/training" style={{ textDecoration: "none" }}>&larr; My training</Link>
        {done ? <span className="pill good">Completed</span> : m.kind === "video" ? <span className="pill">{pct}% watched</span> : null}
      </div>
      <div className="eyebrow">
        {KIND_LABEL[m.kind]}
        {m.duration_secs ? ` · ${fmtDuration(m.duration_secs)}` : ""}
      </div>
      <h1>{m.title}</h1>
      {m.description && <p className="muted" style={{ maxWidth: "66ch" }}>{m.description}</p>}

      {m.kind === "video" && url && (
        <>
          <video
            ref={video}
            className="my-video"
            src={url}
            controls
            playsInline
            preload="metadata"
            controlsList="nodownload"
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              // A video uploaded without its length (some browsers can't read
              // it at upload): the first manager to open it fills it in. For
              // reps this update is refused, which is fine.
              if (!m.duration_secs && isFinite(v.duration)) {
                void supabase.from("training_materials").update({ duration_secs: v.duration }).eq("id", m.id).then(() => {});
              }
              if (!resumed.current && p?.position_secs && p.position_secs < v.duration - 5) v.currentTime = p.position_secs;
              resumed.current = true;
            }}
            onTimeUpdate={(e) => {
              const v = e.currentTarget;
              const t = v.currentTime;
              if (lastT.current !== null && !v.seeking && !v.paused) {
                const d = t - lastT.current;
                if (d > 0 && d < 3) played.current += d;
              }
              lastT.current = t;
            }}
            onSeeking={() => (lastT.current = null)}
            onPause={() => {
              lastT.current = null;
              if (played.current > 0) report();
            }}
            onEnded={() => {
              if (played.current > 0) report();
            }}
            onRateChange={(e) => {
              if (e.currentTarget.playbackRate > 2) e.currentTarget.playbackRate = 2;
            }}
          />
          <div className="tr-progress" style={{ marginTop: 10 }} aria-label={`${pct}% watched`}>
            <i style={{ width: `${pct}%` }} />
          </div>
          <p className="hint" style={{ marginTop: 8 }}>
            {done
              ? "Done -- this counts as completed."
              : `Counts as done once you've watched ${m.complete_pct}%. It picks up where you left off.`}
          </p>
        </>
      )}

      {m.kind === "pdf" && url && <iframe className="my-doc" src={url} title={m.title} />}

      {(m.kind === "doc" || m.kind === "slides") && url && (
        <p>
          <a className="btn" href={url} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
            Open {m.file_name || "the file"}
          </a>
        </p>
      )}

      {m.kind === "link" && m.url && (
        <p>
          <a className="btn" href={m.url} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
            Open the link
          </a>
        </p>
      )}

      {m.kind === "quiz" && <QuizTaker supabase={supabase} m={m} onDone={() => setDone(true)} />}
      {m.kind === "module" && userId && <ModuleStatus supabase={supabase} m={m} userId={userId} />}
      {m.kind === "practice" && userId && <PracticeStatus supabase={supabase} m={m} userId={userId} />}

      {["pdf", "doc", "slides", "link"].includes(m.kind) && (
        <div className="row" style={{ marginTop: 14 }}>
          {done ? (
            <span className="pill good">Marked as read</span>
          ) : (
            <button className="primary" onClick={acknowledge}>I&rsquo;ve read it</button>
          )}
        </div>
      )}
      {error && <div className="error">{error}</div>}
    </main>
  );
}
