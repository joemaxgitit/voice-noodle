"use client";

import { useEffect, useRef, useState } from "react";
import type { createClient } from "@/lib/supabase/client";

type Take = { id: string; audio_path: string; seconds: number | null; created_at: string };

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/*
  Record the whole script in one go. The take stays compressed (webm/mp4) --
  a 30-minute run-through as WAV would be 60 MB. Saved under the rep's own
  folder, so the storage policy that guards practice takes covers it.
*/
export default function WholeTake({ supabase, scriptId }: { supabase: ReturnType<typeof createClient>; scriptId: string }) {
  const [open, setOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [pending, setPending] = useState<{ blob: Blob; url: string; secs: number } | null>(null);
  const [takes, setTakes] = useState<Take[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const started = useRef(0);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);

  async function load() {
    const { data: u } = await supabase.auth.getSession();
    const me = u.session?.user.id;
    if (!me) return;
    const { data, error } = await supabase
      .from("script_takes")
      .select("id, audio_path, seconds, created_at")
      .eq("script_id", scriptId)
      .eq("user_id", me)
      .order("created_at", { ascending: false })
      .limit(5);
    if (error) return setError(/script_takes/.test(error.message) ? "Run supabase/script-takes.sql in the Supabase SQL Editor to turn this on." : error.message);
    setTakes((data || []) as Take[]);
  }
  useEffect(() => {
    if (open) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, scriptId]);

  useEffect(
    () => () => {
      if (ticker.current) clearInterval(ticker.current);
      stream.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  async function start() {
    setError("");
    if (pending) URL.revokeObjectURL(pending.url);
    setPending(null);
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      stream.current = media;
      chunks.current = [];
      const r = new MediaRecorder(media);
      rec.current = r;
      r.ondataavailable = (e) => e.data.size > 0 && chunks.current.push(e.data);
      r.onstop = () => {
        stream.current?.getTracks().forEach((t) => t.stop());
        stream.current = null;
        const blob = new Blob(chunks.current, { type: chunks.current[0]?.type || "audio/webm" });
        chunks.current = [];
        if (blob.size) setPending({ blob, url: URL.createObjectURL(blob), secs: (Date.now() - started.current) / 1000 });
      };
      r.start(1000); // a chunk a second, so a long take isn't held as one piece
      started.current = Date.now();
      setElapsed(0);
      setRecording(true);
      ticker.current = setInterval(() => setElapsed((Date.now() - started.current) / 1000), 500);
    } catch (e) {
      setError(e instanceof Error && e.name === "NotAllowedError" ? "The browser blocked the microphone. Allow it for this site and try again." : "Could not start recording. Check that a microphone is connected.");
    }
  }

  function stop() {
    if (ticker.current) clearInterval(ticker.current);
    ticker.current = null;
    setRecording(false);
    rec.current?.stop();
  }

  async function keep() {
    if (!pending) return;
    if (pending.secs < 30) return setError("That was too short to keep as a whole-script take.");
    setBusy("Saving…");
    setError("");
    try {
      const { data: u } = await supabase.auth.getSession();
      const me = u.session?.user.id;
      if (!me) throw new Error("You are signed out. Sign in and try again.");
      const ext = /mp4|aac|m4a/.test(pending.blob.type) ? "m4a" : "webm";
      const path = `${me}/whole-${scriptId}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("practice-audio").upload(path, pending.blob, { contentType: pending.blob.type || "audio/webm" });
      if (upErr) throw upErr;
      const { error: insErr } = await supabase.from("script_takes").insert({ script_id: scriptId, audio_path: path, seconds: Math.round(pending.secs) });
      if (insErr) throw insErr;
      URL.revokeObjectURL(pending.url);
      setPending(null);
      await load();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setError(/script_takes/.test(m) ? "Run supabase/script-takes.sql in the Supabase SQL Editor to turn this on." : m);
    }
    setBusy("");
  }

  async function hear(t: Take) {
    if (urls[t.id]) return;
    const { data } = await supabase.storage.from("practice-audio").createSignedUrl(t.audio_path, 3600);
    if (data?.signedUrl) setUrls((u) => ({ ...u, [t.id]: data.signedUrl }));
  }

  if (!open)
    return (
      <div className="no-print" style={{ margin: "8px 0 16px" }}>
        <button onClick={() => setOpen(true)}>&#9679; Record the whole script</button>
      </div>
    );

  return (
    <section className="card no-print" style={{ margin: "8px 0 16px" }}>
      <h3 className="rx-sec-title">Record the whole script</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Read it top to bottom in one take, like a real call. Keep it and you and your manager can listen back.
      </p>
      <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {!recording ? (
          <button className="primary" onClick={start} disabled={!!busy}>
            &#9679; {pending ? "Record again" : "Record"}
          </button>
        ) : (
          <button className="primary" onClick={stop}>
            &#9632; Stop
          </button>
        )}
        {recording && <span className="pill poor">Recording {clock(elapsed)}</span>}
        <button className="link-btn" onClick={() => (recording ? stop() : setOpen(false))}>
          Close
        </button>
      </div>
      {pending && !recording && (
        <div style={{ marginTop: 10 }}>
          <audio controls src={pending.url} style={{ width: "100%" }} />
          <div className="row" style={{ gap: 8, marginTop: 6 }}>
            <button className="primary" onClick={keep} disabled={!!busy}>
              {busy || `Keep this take (${clock(pending.secs)})`}
            </button>
            <button
              onClick={() => {
                URL.revokeObjectURL(pending.url);
                setPending(null);
              }}
              disabled={!!busy}
            >
              Discard
            </button>
          </div>
        </div>
      )}
      {error && <p className="error" style={{ marginTop: 8 }}>{error}</p>}
      {takes.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <small className="muted">Your last {takes.length === 1 ? "take" : `${takes.length} takes`}</small>
          {takes.map((t) => (
            <div key={t.id} style={{ marginTop: 6 }}>
              <small>
                {new Date(t.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                {t.seconds ? ` · ${clock(Number(t.seconds))}` : ""}{" "}
              </small>
              {urls[t.id] ? (
                <audio controls src={urls[t.id]} style={{ width: "100%" }} />
              ) : (
                <button className="link-btn" onClick={() => hear(t)}>
                  Listen
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
