"use client";

import { useEffect, useRef, useState } from "react";

/*
  Record a segment's master take right in the browser: record, listen back,
  redo as often as needed, then keep it. The kept take becomes an MP3 at a
  quality fit for the read-along (mono, 44.1 kHz, 96 kbps) and goes into the
  same flow as an uploaded file -- so ElevenLabs aligns it the same way.
*/

const RATE = 44_100;
const KBPS = 96;

async function toMp3(blob: Blob, name: string): Promise<{ file: File; peak: number; rms: number }> {
  const ctx = new OfflineAudioContext(1, 1, RATE);
  const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
  const n = buf.numberOfChannels;
  const pcm = new Float32Array(buf.length);
  for (let c = 0; c < n; c++) {
    const ch = buf.getChannelData(c);
    for (let i = 0; i < ch.length; i++) pcm[i] += ch[i] / n;
  }
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) {
    const a = Math.abs(pcm[i]);
    if (a > peak) peak = a;
    sum += pcm[i] * pcm[i];
  }
  const rms = Math.sqrt(sum / Math.max(1, pcm.length));
  const { Mp3Encoder } = await import("@breezystack/lamejs");
  const enc = new Mp3Encoder(1, buf.sampleRate, KBPS);
  const parts: Uint8Array[] = [];
  const FRAME = 1152;
  for (let i = 0; i < pcm.length; i += FRAME) {
    const end = Math.min(i + FRAME, pcm.length);
    const chunk = new Int16Array(end - i);
    for (let k = i; k < end; k++) {
      const s = pcm[k];
      chunk[k - i] = s < -1 ? -32768 : s > 1 ? 32767 : Math.round(s * 32767);
    }
    const out = enc.encodeBuffer(chunk);
    if (out.length) parts.push(out.slice());
  }
  const tail = enc.flush();
  if (tail.length) parts.push(tail.slice());
  return { file: new File(parts as BlobPart[], `${name}.mp3`, { type: "audio/mpeg" }), peak, rms };
}

export default function SegmentRecorder({ name, onTake }: { name: string; onTake: (f: File) => void }) {
  const [state, setState] = useState<"idle" | "recording" | "review" | "working">("idle");
  const [secs, setSecs] = useState(0);
  const [take, setTake] = useState<{ blob: Blob; url: string } | null>(null);
  const [warn, setWarn] = useState("");
  const [error, setError] = useState("");
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
      rec.current?.stream.getTracks().forEach((t) => t.stop());
    },
    []
  );

  async function start() {
    setError("");
    setWarn("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true } });
      const r = new MediaRecorder(stream);
      chunks.current = [];
      r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks.current, { type: r.mimeType || "audio/webm" });
        if (take) URL.revokeObjectURL(take.url);
        setTake({ blob, url: URL.createObjectURL(blob) });
        setState("review");
      };
      rec.current = r;
      r.start();
      setSecs(0);
      timer.current = setInterval(() => setSecs((s) => s + 1), 1000);
      setState("recording");
    } catch {
      setError("The microphone isn't available. Allow microphone access for this site in the browser, then try again.");
    }
  }

  function stop() {
    if (timer.current) clearInterval(timer.current);
    rec.current?.stop();
  }

  async function keep() {
    if (!take) return;
    setState("working");
    try {
      const { file, peak, rms } = await toMp3(take.blob, name);
      // Reps learn from these takes, so flag a take that will sound bad before it's kept.
      if (rms < 0.015) setWarn("That take is very quiet -- move closer to the mic or speak up, and record again if it sounds faint.");
      else if (peak > 0.995) setWarn("That take clipped (too loud in places) -- back off the mic a little and record again if it sounds distorted.");
      onTake(file);
      setState("idle");
    } catch {
      setError("Couldn't process that take. Try recording again.");
      setState("review");
    }
  }

  return (
    <div className="card" style={{ marginTop: 10 }}>
      {state === "idle" && (
        <button className="primary" onClick={() => void start()}>
          ● Record it here
        </button>
      )}
      {state === "recording" && (
        <div className="row" style={{ gap: 10, alignItems: "center" }}>
          <button className="primary" onClick={stop}>
            ■ Stop
          </button>
          <span className="live-count">
            Recording… {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}
          </span>
        </div>
      )}
      {(state === "review" || state === "working") && take && (
        <>
          <audio src={take.url} controls className="player" />
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <button className="primary" onClick={() => void keep()} disabled={state === "working"}>
              {state === "working" ? "Saving the take…" : "Keep this take"}
            </button>
            <button onClick={() => void start()} disabled={state === "working"}>
              Record again
            </button>
          </div>
        </>
      )}
      {warn && <p className="hint" style={{ color: "var(--warn, #c98a1b)", marginBottom: 0 }}>{warn}</p>}
      {error && <div className="error">{error}</div>}
      <p className="hint" style={{ marginBottom: 0 }}>Read it exactly as written, in a quiet room. Listen back before you keep it.</p>
    </div>
  );
}
