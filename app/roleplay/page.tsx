"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { clock, scoreBand, OUTCOME_LABEL, type Outcome, type VoiceTimeline } from "@/lib/calls";
import { decodeMono } from "@/lib/shrinkAudio";
import { measureVoice } from "@/lib/voice";
import { DIFFICULTY_LABEL, leadTotal, leadMoney, type Persona, type RoleplayInfo, type RoleplayLang } from "@/lib/roleplay";
import LeadCard from "./LeadCard";
import "../admin/calls/calls.css";
import "./roleplay.css";

type Phase = "pick" | "connecting" | "live" | "ending";

type PastCall = {
  id: string;
  created_at: string;
  status: string;
  score: number | null;
  slp_score: number | null;
  outcome: string | null;
  duration_secs: number | null;
  roleplay: RoleplayInfo | null;
};

type Line = { who: "rep" | "client"; text: string };

// The live conversation, typed loosely: the SDK is loaded only when a call starts.
type LiveConversation = {
  endSession: () => Promise<void>;
  getId: () => string;
  setMicMuted: (m: boolean) => void;
};

/**
 * Practice calls: the rep phones a mock client, by voice, and the call is
 * graded like a real one. Behind the manager's on/off switch.
 */
export default function Roleplay() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [scripts, setScripts] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<PastCall[]>([]);
  const [lang, setLang] = useState<RoleplayLang>("en");
  // A first call, or a follow-up with a client who put it off last time.
  const [callMode, setCallMode] = useState<"first" | "followup">("first");
  const [phase, setPhase] = useState<Phase>("pick");
  const [persona, setPersona] = useState<Persona | null>(null);
  // A training card can point here with ?persona=<id>: that client goes first.
  const [suggested, setSuggested] = useState<string | null>(null);
  useEffect(() => {
    setSuggested(new URLSearchParams(window.location.search).get("persona"));
  }, []);
  const [mode, setMode] = useState<"speaking" | "listening">("listening");
  const [muted, setMuted] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [captions, setCaptions] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const conv = useRef<LiveConversation | null>(null);
  const callId = useRef<string>("");
  const info = useRef<RoleplayInfo | null>(null);
  const convId = useRef<string>("");
  const startedAt = useRef<number>(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  // Managers can follow a practice call live (/admin/live/[callId]): every line goes out on a channel.
  const live = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const sent = useRef<{ who: string; text: string; at: number }[]>([]);
  // Live audio for listening managers: both sides of the call mixed, sent browser to browser (WebRTC).
  const mix = useRef<MediaStream | null>(null);
  const peers = useRef(new Map<string, RTCPeerConnection>());
  const buildMix = (c: unknown) => {
    try {
      const out = (c as { output?: { getAnalyser?: () => AnalyserNode | undefined } }).output;
      const an = out?.getAnalyser?.();
      if (!an) return;
      const ctx = an.context as AudioContext;
      const dest = ctx.createMediaStreamDestination();
      an.connect(dest); // the practice client's voice
      if (micStream.current) ctx.createMediaStreamSource(micStream.current).connect(dest); // the rep
      mix.current = dest.stream;
    } catch {
      mix.current = null; // the live transcript still works
    }
  };
  const openLive = (id: string) => {
    sent.current = [];
    const ch = supabase.channel(`practice-live:${id}`, { config: { broadcast: { self: false } } });
    const send = (event: string, payload: Record<string, unknown>) => void ch.send({ type: "broadcast", event, payload });
    // Someone joined late: send them everything so far.
    ch.on("broadcast", { event: "hello" }, () => send("all", { lines: sent.current, persona: info.current?.persona ?? "", audio: !!mix.current }));
    ch.on("broadcast", { event: "listen" }, async ({ payload }) => {
      const from = String((payload as { from?: string }).from || "");
      if (!from) return;
      if (!mix.current) return send("noaudio", { to: from });
      peers.current.get(from)?.close();
      const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }] });
      peers.current.set(from, pc);
      for (const t of mix.current.getAudioTracks()) pc.addTrack(t, mix.current);
      pc.onicecandidate = (e) => e.candidate && send("ice", { to: from, from: "rep", candidate: e.candidate.toJSON() });
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      send("offer", { to: from, sdp: offer });
    });
    ch.on("broadcast", { event: "answer" }, async ({ payload }) => {
      const p = payload as { from: string; sdp: RTCSessionDescriptionInit };
      await peers.current.get(p.from)?.setRemoteDescription(p.sdp).catch(() => {});
    });
    ch.on("broadcast", { event: "ice" }, async ({ payload }) => {
      const p = payload as { to: string; from: string; candidate: RTCIceCandidateInit };
      if (p.to !== "rep") return;
      await peers.current.get(p.from)?.addIceCandidate(p.candidate).catch(() => {});
    });
    ch.subscribe();
    live.current = ch;
  };
  const sendLive = (event: string, payload: Record<string, unknown>) => void live.current?.send({ type: "broadcast", event, payload });
  const closeLive = () => {
    sendLive("end", {});
    for (const pc of peers.current.values()) pc.close();
    peers.current.clear();
    mix.current = null;
    if (live.current) void supabase.removeChannel(live.current);
    live.current = null;
  };
  const micStream = useRef<MediaStream | null>(null);
  const ending = useRef(false);

  const es = lang === "es";

  const load = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      router.replace("/login");
      return;
    }
    const { data: prof } = await supabase.from("profiles").select("org_id").eq("id", session.user.id).single();
    const [{ data: org }, { data: ps }, { data: sc }, { data: past }] = await Promise.all([
      supabase.from("orgs").select("roleplay_enabled").eq("id", prof?.org_id ?? "").maybeSingle(),
      supabase.from("roleplay_personas").select("*").eq("active", true).order("sort_order"),
      supabase.from("scripts").select("id, title"),
      supabase
        .from("calls")
        .select("id, created_at, status, score, slp_score, outcome, duration_secs, roleplay")
        .eq("source", "roleplay")
        .eq("rep_id", session.user.id)
        .order("created_at", { ascending: false })
        .limit(30),
    ]);
    setEnabled(!!org?.roleplay_enabled);
    // A client tied to a script this rep cannot see could not be graded.
    const visible = new Map((sc || []).map((s) => [s.id as string, s.title as string]));
    setScripts(Object.fromEntries(visible));
    setPersonas(((ps || []) as Persona[]).filter((p) => !p.script_id || visible.has(p.script_id)));
    setHistory((past || []) as PastCall[]);
    setLoading(false);
  }, [supabase, router]);

  useEffect(() => {
    load();
  }, [load]);

  // The call timer.
  useEffect(() => {
    if (phase !== "live") return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)), 500);
    return () => clearInterval(t);
  }, [phase]);

  // Leaving the page mid-call hangs up rather than leaving the meter running.
  useEffect(() => {
    const bye = () => {
      conv.current?.endSession().catch(() => {});
    };
    window.addEventListener("pagehide", bye);
    return () => {
      window.removeEventListener("pagehide", bye);
      bye();
    };
  }, []);

  async function token(): Promise<string | null> {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  }

  function stopMic() {
    micStream.current?.getTracks().forEach((t) => t.stop());
    micStream.current = null;
  }

  async function start(p: Persona) {
    setError("");
    setPersona(p);
    setPhase("connecting");
    setLines([]);
    setElapsed(0);
    setMuted(false);
    ending.current = false;
    convId.current = "";

    // Ask for the microphone first, so a denied permission doesn't file a call.
    try {
      micStream.current = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      setPhase("pick");
      setError(es ? "Se necesita el micrófono. Permítelo en el navegador e inténtalo de nuevo." : "The microphone is needed. Allow it in the browser and try again.");
      return;
    }

    const t = await token();
    if (!t) {
      stopMic();
      setPhase("pick");
      setError("Your session has expired. Sign in again.");
      return;
    }

    const res = await fetch("/api/roleplay/start", {
      method: "POST",
      headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
      body: JSON.stringify({ personaId: p.id, lang, mode: callMode }),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok) {
      stopMic();
      setPhase("pick");
      setError(body?.error || "Could not start the call.");
      return;
    }
    callId.current = body.callId;
    info.current = body.info;

    try {
      const { VoiceConversation } = await import("@elevenlabs/client");
      const c = await VoiceConversation.startSession({
        signedUrl: body.signedUrl,
        dynamicVariables: body.dynamicVariables ?? { call_mode: "This is the FIRST call. You've never spoken with this rep or Lionside before." },
        connectionType: "websocket",
        onConnect: ({ conversationId }) => {
          convId.current = conversationId;
          startedAt.current = Date.now();
          setPhase("live");
          startRecorder();
          openLive(callId.current);
          // Saved straight away, so a closed tab can still be graded later.
          supabase
            .from("calls")
            .update({ roleplay: { ...info.current, conversation_id: conversationId } })
            .eq("id", callId.current)
            .then(() => {});
        },
        onModeChange: ({ mode }) => setMode(mode),
        onMessage: (m) => {
          if (!m.message?.trim()) return;
          const line = { who: m.role === "user" ? "rep" : "client", text: m.message };
          setLines((ls) => [...ls, line as Line]);
          const at = startedAt.current ? Math.round((Date.now() - startedAt.current) / 1000) : 0;
          sent.current.push({ ...line, at });
          sendLive("line", { ...line, at });
        },
        onDisconnect: () => {
          // The client hung up, the time limit hit, or the line dropped.
          if (!ending.current) {
            sendLive("hangup", {});
            hangUp();
          }
        },
        onError: (message) => setError(String(message || "The call had a problem.")),
      });
      conv.current = c as unknown as LiveConversation;
      buildMix(c);
      if (!convId.current) convId.current = c.getId();
    } catch (e) {
      stopMic();
      await supabase.from("calls").delete().eq("id", callId.current);
      callId.current = "";
      setPhase("pick");
      setError(`Could not connect the call. ${e instanceof Error ? e.message : ""}`);
    }
  }

  /** The rep's own side, recorded locally to measure their voice. */
  function startRecorder() {
    if (!micStream.current || typeof MediaRecorder === "undefined") return;
    try {
      chunks.current = [];
      const r = new MediaRecorder(micStream.current);
      r.ondataavailable = (e) => {
        if (e.data.size) chunks.current.push(e.data);
      };
      r.start(1000);
      recorder.current = r;
    } catch {
      recorder.current = null; // grading still works, from the words alone
    }
  }

  function stopRecorder(): Promise<Blob | null> {
    const r = recorder.current;
    recorder.current = null;
    if (!r || r.state === "inactive") return Promise.resolve(chunks.current.length ? new Blob(chunks.current) : null);
    return new Promise((resolve) => {
      r.onstop = () => resolve(chunks.current.length ? new Blob(chunks.current, { type: r.mimeType }) : null);
      r.stop();
    });
  }

  async function hangUp() {
    if (ending.current) return;
    ending.current = true;
    setPhase("ending");
    setBusy(es ? "Colgando..." : "Hanging up...");

    try {
      await conv.current?.endSession();
    } catch {
      // already closed
    }
    conv.current = null;
    closeLive();

    const blob = await stopRecorder();
    stopMic();

    if (!convId.current) {
      await supabase.from("calls").delete().eq("id", callId.current);
      setBusy("");
      setPhase("pick");
      setError("The call never connected.");
      return;
    }

    let voice: VoiceTimeline | null = null;
    if (blob && blob.size > 2000) {
      try {
        setBusy(es ? "Midiendo tu voz..." : "Measuring your voice...");
        const decoded = await decodeMono(await blob.arrayBuffer());
        voice = (await measureVoice(decoded.pcm, decoded.rate, (f) =>
          setBusy(`${es ? "Midiendo tu voz" : "Measuring your voice"} ${Math.round(f * 100)}%...`)
        )) as VoiceTimeline;
      } catch {
        voice = null;
      }
    }

    setBusy(es ? "Enviando para calificar..." : "Sending for grading...");
    const t = await token();
    const res = await fetch("/api/roleplay/finish", {
      method: "POST",
      headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
      body: JSON.stringify({ callId: callId.current, conversationId: convId.current, voice }),
    }).catch(() => null);
    if (!res || !res.ok) {
      const b = res ? await res.json().catch(() => ({})) : {};
      // The results page offers a retry.
      setError(b?.error || "Could not send the call for grading.");
    }
    router.push(`/roleplay/${callId.current}`);
  }

  function toggleMute() {
    const next = !muted;
    conv.current?.setMicMuted(next);
    setMuted(next);
  }

  if (loading) {
    return (
      <main className="shell rp-shell">
        <p className="muted">Loading&hellip;</p>
      </main>
    );
  }

  // ---------------- on the call ----------------
  if (persona && phase !== "pick") {
    const who = persona.name.split(" ")[0];
    return (
      <main className="shell rp-shell">
        <div className="eyebrow">
          {es ? "Llamada de práctica" : "Practice call"} &middot; {persona.title}
        </div>
        <div className="rp-live">
          <div className="rp-phone">
            <div className="name">{persona.name}</div>
            <div className="timer">{clock(elapsed) || "0:00"}</div>
            <div className={`rp-orb ${phase === "live" ? mode : ""}`}>
              {phase === "connecting"
                ? es ? "Marcando" : "Dialing"
                : phase === "ending"
                  ? es ? "Fin" : "Ended"
                  : mode === "speaking"
                    ? es ? `${who} habla` : `${who} talking`
                    : es ? "Escuchando" : "Listening"}
            </div>
            {phase === "ending" ? (
              <p className="muted">{busy}</p>
            ) : (
              <div className="rp-controls">
                <button onClick={toggleMute} className={muted ? "rp-muted" : ""} disabled={phase !== "live"}>
                  {muted ? (es ? "Activar micrófono" : "Unmute") : es ? "Silenciar" : "Mute"}
                </button>
                <button className="rp-hangup" onClick={hangUp}>
                  {es ? "Colgar" : "Hang up"}
                </button>
              </div>
            )}
            <label className="hint" style={{ margin: 0, display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" checked={captions} onChange={(e) => setCaptions(e.target.checked)} />
              {es ? "Mostrar subtítulos" : "Show captions"}
            </label>
            {captions && (
              <div className="rp-captions">
                {lines.length === 0 && <p className="muted">&hellip;</p>}
                {lines.map((l, i) => (
                  <p key={i}>
                    <b>{l.who === "rep" ? (es ? "Tú" : "You") : who}:</b> {l.text}
                  </p>
                ))}
              </div>
            )}
            {error && <div className="error">{error}</div>}
          </div>
          <LeadCard name={persona.name} lead={persona.lead || {}} es={es} />
        </div>
      </main>
    );
  }

  // ---------------- picking a client ----------------
  return (
    <main className="shell rp-shell">
      <div className="topbar">
        <Link className="btn" href="/proedgesolutions" style={{ textDecoration: "none" }}>
          &larr; {es ? "Entrenamiento" : "Training"}
        </Link>
      </div>

      <div className="eyebrow">{es ? "Llamadas de práctica" : "Practice calls"}</div>
      <h1>{es ? "Llama a un cliente de práctica" : "Call a practice client"}</h1>

      {!enabled ? (
        <p className="muted">
          {es ? "Las llamadas de práctica están desactivadas por ahora." : "Practice calls are switched off right now."}
        </p>
      ) : (
        <>
          <p className="muted" style={{ maxWidth: "62ch" }}>
            {es
              ? "Cada cliente tiene una situación real que no te va a contar si no la descubres. Usa tu guion, tus audífonos y tu voz de siempre. La llamada se califica igual que una real."
              : "Each client has a real situation they won't tell you unless you dig for it. Use your script, a headset and your normal voice. The call is graded exactly like a real one."}
          </p>

          <div className="rp-toolbar">
            <div className="unit-switch" role="group" aria-label="Call language">
              <button aria-pressed={!es} onClick={() => setLang("en")}>English</button>
              <button aria-pressed={es} onClick={() => setLang("es")}>Español</button>
            </div>
            <div className="unit-switch" role="group" aria-label="Which call">
              <button aria-pressed={callMode === "first"} onClick={() => setCallMode("first")}>
                {es ? "Primera llamada" : "First call"}
              </button>
              <button aria-pressed={callMode === "followup"} onClick={() => setCallMode("followup")}>
                {es ? "Seguimiento" : "Follow-up"}
              </button>
            </div>
          </div>
          {callMode === "followup" && (
            <p className="hint" style={{ maxWidth: "62ch" }}>
              {es
                ? "El cliente ya habló con Lionside y lo pospuso. Reconecta con lo que está viviendo y llega al fondo de su duda antes de pedirle que avance."
                : "The client already spoke with Lionside and put it off. Reconnect with what they're going through and get to the bottom of the hesitation before asking again."}
            </p>
          )}

          {error && <div className="error" style={{ marginTop: 12 }}>{error}</div>}

          {personas.length === 0 ? (
            <p className="muted" style={{ marginTop: 18 }}>No practice clients are set up yet.</p>
          ) : (
            <div className="rp-grid">
              {[...personas].sort((a, b) => Number(b.id === suggested) - Number(a.id === suggested)).map((p) => {
                const ready = !!(es ? p.agent_es : p.agent_en);
                const lead = p.lead || {};
                return (
                  <div key={p.id} className="rp-persona" style={p.id === suggested ? { borderColor: "var(--live)", boxShadow: "0 0 0 1px var(--live)" } : undefined}>
                    <span className={`pill rp-diff ${p.difficulty}`}>{DIFFICULTY_LABEL[p.difficulty]}</span>
                    {p.id === suggested && <span className="pill" style={{ marginLeft: 6, color: "var(--live)", borderColor: "var(--live)" }}>{es ? "De tu tarjeta" : "From your card"}</span>}
                    <h3>{p.title}</h3>
                    <div className="who">
                      {p.name}
                      {lead.state ? ` · ${lead.state}` : ""}
                      {p.script_id && scripts[p.script_id] ? ` · ${scripts[p.script_id]}` : ""}
                    </div>
                    <div className="facts">
                      {lead.source}
                      {lead.requested ? <> &middot; {es ? "solicitó" : "requested"} {leadMoney(lead.requested)}</> : null}
                      {lead.accounts?.length ? (
                        <>
                          <br />
                          {lead.accounts.length} {es ? "cuentas" : "accounts"} &middot; {leadMoney(leadTotal(lead))}
                        </>
                      ) : null}
                    </div>
                    <button className="primary" disabled={!ready} onClick={() => start(p)}>
                      {ready
                        ? `${es ? "Llamar a" : "Call"} ${p.name.split(" ")[0]}`
                        : es ? "Voz no configurada" : "Voice not set up yet"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {history.length > 0 && (
        <div className="rp-history">
          <h2 style={{ fontSize: 17 }}>{es ? "Tus llamadas de práctica" : "Your practice calls"}</h2>
          <div className="card" style={{ padding: 0 }}>
            {history.map((h) => (
              <Link key={h.id} href={`/roleplay/${h.id}`} className="rp-hist-row">
                <span>
                  <b>{h.roleplay?.persona_title || h.roleplay?.persona || "Practice"}</b>
                  <span className="muted">
                    {" "}
                    &middot; {new Date(h.created_at).toLocaleDateString()} &middot; {clock(h.duration_secs) || "--"}
                    {h.roleplay?.lang === "es" ? " · ES" : ""}
                  </span>
                </span>
                <span className="row" style={{ gap: 6 }}>
                  {h.outcome && <span className="pill">{OUTCOME_LABEL[h.outcome as Outcome] ?? h.outcome}</span>}
                  {h.status === "graded" ? (
                    <>
                      <span className={`pill ${scoreBand(h.score)}`}>Script {h.score ?? "--"}</span>
                      <span className={`pill ${scoreBand(h.slp_score)}`}>SLP {h.slp_score ?? "--"}</span>
                    </>
                  ) : (
                    <span className={`pill ${h.status === "failed" ? "failed" : "busy"}`}>
                      {h.status === "failed" ? "Failed" : h.status === "live" ? "Unfinished" : "Grading"}
                    </span>
                  )}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
