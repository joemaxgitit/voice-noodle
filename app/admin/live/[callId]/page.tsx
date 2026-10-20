"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import "../../reps/reps.css";

type Line = { who: "rep" | "client"; text: string; at: number };
type Note = { at: number; text: string; by: string; name: string; when: string };

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/**
 * Follow a rep's practice call as it happens: the conversation scrolls in
 * live, and notes dropped at a moment are kept on the call for later.
 * Nothing here is heard by the rep or the practice client.
 */
export default function ListenIn() {
  const { callId } = useParams<{ callId: string }>();
  const supabase = useMemo(() => createClient(), []);
  const [lines, setLines] = useState<Line[]>([]);
  const [state, setState] = useState<"waiting" | "live" | "ended" | "hungup">("waiting");
  const [who, setWho] = useState({ rep: "", persona: "" });
  const [notes, setNotes] = useState<Note[]>([]);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [me, setMe] = useState({ id: "", name: "" });
  const end = useRef<HTMLDivElement>(null);
  // Live audio: the rep's browser sends both sides of the call straight here (WebRTC).
  const chRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const myId = useRef(`m${Math.random().toString(36).slice(2, 10)}`);
  const pendingIce = useRef<RTCIceCandidateInit[]>([]);
  const [audio, setAudio] = useState<"off" | "connecting" | "on" | "none" | "failed">("off");

  useEffect(() => {
    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session) {
        const { data: p } = await supabase.from("profiles").select("full_name").eq("id", session.user.id).single();
        setMe({ id: session.user.id, name: p?.full_name || "Manager" });
      }
      const { data: c } = await supabase.from("calls").select("status, roleplay, live_notes, profiles:rep_id(full_name)").eq("id", callId).single();
      const row = c as unknown as { status: string; roleplay: { persona?: string } | null; live_notes?: Note[] | null; profiles: { full_name: string | null } | null } | null;
      if (row) {
        setWho({ rep: row.profiles?.full_name || "The rep", persona: row.roleplay?.persona || "the client" });
        setNotes(row.live_notes || []);
        if (row.status !== "live") setState("ended");
      }
    })();

    const ch = supabase.channel(`practice-live:${callId}`, { config: { broadcast: { self: false } } });
    ch.on("broadcast", { event: "line" }, ({ payload }) => {
      setState("live");
      setLines((ls) => [...ls, payload as Line]);
    })
      .on("broadcast", { event: "all" }, ({ payload }) => {
        setState("live");
        setLines((payload as { lines: Line[] }).lines || []);
      })
      .on("broadcast", { event: "offer" }, async ({ payload }) => {
        const p = payload as { to: string; sdp: RTCSessionDescriptionInit };
        if (p.to !== myId.current) return;
        pcRef.current?.close();
        const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }] });
        pcRef.current = pc;
        pc.ontrack = (e) => {
          if (audioRef.current) {
            audioRef.current.srcObject = e.streams[0] ?? new MediaStream([e.track]);
            void audioRef.current.play().catch(() => {});
          }
          setAudio("on");
        };
        pc.onconnectionstatechange = () => {
          if (pc.connectionState === "failed") setAudio("failed");
        };
        pc.onicecandidate = (e) => e.candidate && void ch.send({ type: "broadcast", event: "ice", payload: { to: "rep", from: myId.current, candidate: e.candidate.toJSON() } });
        await pc.setRemoteDescription(p.sdp);
        for (const c of pendingIce.current.splice(0)) await pc.addIceCandidate(c).catch(() => {});
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        void ch.send({ type: "broadcast", event: "answer", payload: { from: myId.current, sdp: answer } });
      })
      .on("broadcast", { event: "ice" }, async ({ payload }) => {
        const p = payload as { to: string; candidate: RTCIceCandidateInit };
        if (p.to !== myId.current) return;
        const pc = pcRef.current;
        if (pc?.remoteDescription) await pc.addIceCandidate(p.candidate).catch(() => {});
        else pendingIce.current.push(p.candidate);
      })
      .on("broadcast", { event: "noaudio" }, ({ payload }) => {
        if ((payload as { to: string }).to === myId.current) setAudio("none");
      })
      .on("broadcast", { event: "hangup" }, () => {
        setState("hungup");
        pcRef.current?.close();
        setAudio("off");
      })
      .on("broadcast", { event: "end" }, () => {
        setState((s) => (s === "hungup" ? s : "ended"));
        pcRef.current?.close();
        setAudio("off");
      })
      .subscribe((status) => {
        // Ask the rep's page for everything said so far.
        if (status === "SUBSCRIBED") void ch.send({ type: "broadcast", event: "hello", payload: {} });
      });
    chRef.current = ch;
    return () => {
      pcRef.current?.close();
      void supabase.removeChannel(ch);
    };
  }, [supabase, callId]);

  useEffect(() => end.current?.scrollIntoView({ behavior: "smooth", block: "end" }), [lines.length]);

  function listen() {
    setAudio("connecting");
    void chRef.current?.send({ type: "broadcast", event: "listen", payload: { from: myId.current } });
    // No answer within 10 seconds: the rep's page may be older or the audio couldn't be shared.
    setTimeout(() => setAudio((a) => (a === "connecting" ? "failed" : a)), 10_000);
  }

  function stopListening() {
    pcRef.current?.close();
    pcRef.current = null;
    if (audioRef.current) audioRef.current.srcObject = null;
    setAudio("off");
  }

  async function addNote() {
    const text = note.trim();
    if (!text) return;
    const at = lines.at(-1)?.at ?? 0;
    const next = [...notes, { at, text, by: me.id, name: me.name, when: new Date().toISOString() }];
    const { error } = await supabase.from("calls").update({ live_notes: next }).eq("id", callId);
    if (error) return setError(/live_notes/.test(error.message) ? "Run supabase/real-call-learning.sql first to keep notes." : error.message);
    setNotes(next);
    setNote("");
  }

  return (
    <main className="shell rx-page" style={{ maxWidth: 860 }}>
      <div className="topbar">
        <Link className="btn" href="/admin/live" style={{ textDecoration: "none" }}>
          &larr; Live
        </Link>
      </div>
      <div className="eyebrow">Listening in</div>
      <h1>
        {who.rep} &middot; practice with {who.persona}
      </h1>
      <p className="muted">
        {state === "waiting" && "Connecting to the call… the conversation so far will appear in a moment."}
        {state === "live" && "Live. The rep and the client can't see you or your notes."}
        {state === "hungup" && "The client hung up. The full grade will be on the call once it's ready."}
        {state === "ended" && "This call has ended. The full grade and recording are on the call."}{" "}
        {state !== "live" && state !== "waiting" && (
          <Link href={`/admin/calls/${callId}`}>Open the call</Link>
        )}
      </p>
      {error && <div className="error">{error}</div>}

      {(state === "live" || state === "waiting") && (
        <div className="row" style={{ margin: "0 0 12px", gap: 10 }}>
          {audio === "on" ? (
            <button onClick={stopListening}>Stop audio</button>
          ) : (
            <button className="primary" onClick={listen} disabled={audio === "connecting"}>
              {audio === "connecting" ? "Connecting audio…" : "🔊 Listen to the call"}
            </button>
          )}
          <small className="muted">
            {audio === "on" && "You're hearing both sides live. They can't hear you."}
            {audio === "none" && "Audio isn't available from this rep's browser -- the transcript still updates live."}
            {audio === "failed" && "Couldn't connect the audio (often a strict network). Try again, or follow the transcript."}
          </small>
        </div>
      )}
      <audio ref={audioRef} autoPlay hidden />

      <section className="card" style={{ maxHeight: "60vh", overflowY: "auto", display: "grid", gap: 8 }}>
        {!lines.length && <p className="hint" style={{ margin: 0 }}>Nothing said yet.</p>}
        {lines.map((l, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "48px 64px 1fr", gap: 8, alignItems: "baseline" }}>
            <small className="muted">{clock(l.at)}</small>
            <b style={{ color: l.who === "rep" ? "var(--tone)" : "var(--live)" }}>{l.who === "rep" ? "Rep" : "Client"}</b>
            <span>{l.text}</span>
          </div>
        ))}
        {state === "hungup" && <p className="hint" style={{ margin: 0 }}>— The client hung up —</p>}
        <div ref={end} />
      </section>

      <section className="card" style={{ marginTop: 14 }}>
        <h3 className="rx-sec-title">Notes at this moment</h3>
        {notes.map((n, i) => (
          <p key={i} style={{ margin: "4px 0" }}>
            <small className="muted">
              {clock(n.at)} · {n.name.split(" ")[0]}
            </small>{" "}
            {n.text}
          </p>
        ))}
        <div className="row" style={{ marginTop: 8 }}>
          <input value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void addNote()} placeholder="e.g. rushed past the hardship -- coach this" style={{ flex: 1 }} />
          <button className="primary" onClick={() => void addNote()} disabled={!note.trim()}>
            Add note
          </button>
        </div>
        <p className="hint">Notes are kept on the call, stamped with the time in the call.</p>
      </section>
    </main>
  );
}
