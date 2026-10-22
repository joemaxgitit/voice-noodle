import { jsonrepair } from "jsonrepair";
import type { Supa } from "@/lib/callsServer";
import { clock, gradeCostUsd, voiceNotes, type Transcript, type VoiceTimeline } from "@/lib/calls";
import { logSpend } from "@/lib/spendServer";
import { plainWords } from "@/lib/plain";

/*
  Voicemails and short calls never get the full grade -- it's the expensive
  step and there's nothing to score against the script. As soon as a
  transcript lands, a free check spots a voicemail (a recorded greeting, the
  tone, then only the rep talking); anything else under 1:30 is a short call.
  Each gets a cheap read instead, kept apart from every score and average:
  - voicemail: a 0-100 voicemail score (who they are, a reason to call back,
    a callback number, length, tone, nothing private on the message) plus mood.
  - short call: what happened (hang-up, wrong number, callback set...), how far
    the opening got, when and who ended it, and mood.
  "Grade it fully" on the call page always runs the full grade instead.
*/

const MODEL = process.env.LEARN_MODEL || "claude-haiku-5-5";

import { SHORT_SECS, type CallKind, type Quick, type ShortRead, type VoicemailRead } from "@/lib/quick";
export { SHORT_LABEL, SHORT_SECS, type CallKind, type Quick } from "@/lib/quick";

const GREETING =
  /leave (me |us |your |a )*(message|name|number)|after the (tone|beep)|at the (tone|beep)|record your (message|name)|(is |are )?(not|isn'?t) available|can'?t (come to|get to|take) the phone|unable to (take|answer)|voice ?mail|mail ?box|(person|party|number|customer) you (are|were|have) (trying to |)?(reach|call|dial)|not accepting calls|has not been set up|please try (your call )?again later|the subscriber/i;

/** A voicemail: a recorded greeting near the start, then the rep alone (no back-and-forth). Free -- no AI. */
export function detectVoicemail(t: Transcript | null): { yes: boolean; greetingEnd: number } {
  const us = t?.utterances ?? [];
  if (!us.length) return { yes: false, greetingEnd: 0 };
  const g = us.findIndex((u) => u.start < 45 && GREETING.test(u.text));
  if (g < 0) return { yes: false, greetingEnd: 0 };
  const greeter = us[g].speaker;
  const rest = us.slice(g + 1).filter((u) => u.text.trim().split(/\s+/).length >= 3);
  // After the greeting: one voice leaving a message. Two people really talking means someone picked up.
  let turns = 0;
  for (let i = 1; i < rest.length; i++) if (rest[i].speaker !== rest[i - 1].speaker) turns++;
  const others = new Set(rest.map((u) => u.speaker).filter((s) => s !== greeter));
  return { yes: turns <= 1 && others.size <= 1, greetingEnd: us[g].end };
}

const lengthPoints = (secs: number) => (secs <= 0 ? 0 : secs <= 35 ? 15 : secs <= 50 ? 10 : secs <= 70 ? 5 : 0);

function lines(t: Transcript, voice: VoiceTimeline | null): string {
  const vn = voiceNotes(voice, t);
  return t.utterances.map((u, i) => `[${clock(u.start)}] ${u.speaker}: ${u.text}${vn.lines[i] ? `  (voice: ${vn.lines[i]})` : ""}`).join("\n");
}

async function ask(key: string, prompt: string): Promise<{ data: Record<string, unknown> | null; usage: Record<string, number> }> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 800, messages: [{ role: "user", content: prompt }] }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Quick read failed (${res.status}). ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const out = (await res.json()) as { content?: { type: string; text?: string }[]; usage?: Record<string, number> };
  const text = (out.content || []).filter((c) => c.type === "text").map((c) => c.text || "").join("");
  const m = text.match(/\{[\s\S]*\}/);
  return { data: m ? (JSON.parse(jsonrepair(m[0])) as Record<string, unknown>) : null, usage: out.usage ?? {} };
}

const n = (x: unknown, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(Number(x) || 0)));
const s = (x: unknown) => plainWords(typeof x === "string" ? x : "");

async function readVoicemail(key: string, t: Transcript, voice: VoiceTimeline | null, greetingEnd: number) {
  const rep = t.utterances.filter((u) => u.start >= greetingEnd - 0.5);
  const repSecs = Math.round(rep.length ? rep[rep.length - 1].end - rep[0].start : 0);
  const { data, usage } = await ask(
    key,
    `A debt-relief sales rep called a client and got their voicemail. Below is the call: the client's greeting, then the message the rep left (with voice measurements where taken). Judge the message the rep left.

${lines(t, voice)}

Reply with only this JSON:
{"who": 0-20 (rep gave their name and the company clearly), "reason": 0-20 (a specific reason to call back that sparks curiosity -- not "just following up"), "callback": 0-15 (a callback number given clearly, slowly or twice; 0 if none), "tone": 0-15 (certainty and warmth -- not flat, rushed, mumbled or apologetic), "safe": 0-15 (15 unless the message said something private someone else in the house shouldn't hear: their debts, amounts, missed payments, financial trouble), "said": "the message in one plain sentence", "mood": 1-10 (the rep's energy and certainty), "mood_word": "one or two words, e.g. upbeat, flat, rushed, tired", "flag": "anything private or risky said on the message, or empty", "read": "one plain sentence a manager can act on"}
If the rep hung up without leaving a message, set every score to 0, said "No message left", read "Hung up at the tone".`
  );
  if (!data) throw new Error("The quick read came back empty.");
  const parts = { who: n(data.who, 0, 20), reason: n(data.reason, 0, 20), callback: n(data.callback, 0, 15), length: lengthPoints(repSecs), tone: n(data.tone, 0, 15), safe: n(data.safe, 0, 15) };
  const left = !/^no message/i.test(s(data.said));
  const q: Quick = {
    kind: "voicemail",
    score: left ? Object.values(parts).reduce((a, b) => a + b, 0) : 0,
    parts: left ? parts : { ...parts, length: 0 },
    rep_secs: repSecs,
    said: s(data.said),
    mood: n(data.mood, 1, 10),
    mood_word: s(data.mood_word),
    flag: s(data.flag),
    read: s(data.read),
  };
  return { q, usage };
}

async function readShort(key: string, t: Transcript, voice: VoiceTimeline | null) {
  const { data, usage } = await ask(
    key,
    `A short call (under a minute and a half) between a debt-relief sales rep and a client, with voice measurements where taken. The rep should open with their name, the company and why they're calling, with energy and certainty.

${lines(t, voice)}

Reply with only this JSON:
{"what": one of "hang_up" | "live_short" | "wrong_number" | "callback_set" | "not_interested" | "screened" | "other", "opening": "how far the rep's opening got, in a few words", "ended_at": seconds from the start when the call ended or the client checked out (number or null), "ended_by": "client" | "rep" | "unclear", "mood": 1-10 (the rep's energy and certainty), "mood_word": "one or two words", "read": "one plain sentence a manager can act on -- if the client dropped during the opening, say what in the opening may have lost them"}`
  );
  if (!data) throw new Error("The quick read came back empty.");
  const what = ["hang_up", "live_short", "wrong_number", "callback_set", "not_interested", "screened", "other"].includes(String(data.what)) ? (data.what as ShortRead["what"]) : "other";
  const q: Quick = {
    kind: "short",
    what,
    opening: s(data.opening),
    ended_at: data.ended_at == null ? null : n(data.ended_at, 0, 3600),
    ended_by: ["client", "rep"].includes(String(data.ended_by)) ? (data.ended_by as "client" | "rep") : "unclear",
    mood: n(data.mood, 1, 10),
    mood_word: s(data.mood_word),
    read: s(data.read),
  };
  return { q, usage };
}

/**
 * Called before the full grade. Returns null when the call should get the full
 * grade; otherwise marks it and returns the cheap read to run instead.
 */
export async function prepareQuick(supabase: Supa, callId: string, key: string, orgId: string, userId: string): Promise<{ kind: CallKind; run: () => Promise<boolean> } | null> {
  const { data: c } = await supabase.from("calls").select("id, source, status, grade, transcript, duration_secs, voice").eq("id", callId).maybeSingle();
  if (!c || c.source === "roleplay" || c.grade || !c.transcript) return null;
  if (!["transcribed", "read", "failed"].includes(c.status as string)) return null;
  const t = c.transcript as Transcript;
  const vm = detectVoicemail(t);
  const secs = (c.duration_secs as number | null) ?? (t.utterances.length ? t.utterances[t.utterances.length - 1].end : 0);
  const kind: CallKind | null = vm.yes ? "voicemail" : secs < SHORT_SECS ? "short" : null;
  if (!kind) return null;
  // Needs supabase/quick_reads.sql; without it the call just gets the full grade.
  const { error } = await supabase.from("calls").update({ status: "grading", kind, error: null, updated_at: new Date().toISOString() }).eq("id", callId);
  if (error) return null;
  const voice = (c.voice as VoiceTimeline | null) ?? null;
  return {
    kind,
    run: async () => {
      try {
        const { q, usage } = kind === "voicemail" ? await readVoicemail(key, t, voice, vm.greetingEnd) : await readShort(key, t, voice);
        const usd = gradeCostUsd(MODEL, usage) ?? 0;
        const { error: e } = await supabase.from("calls").update({ status: "read", kind, quick: q, updated_at: new Date().toISOString() }).eq("id", callId);
        if (e) throw new Error(e.message);
        await logSpend(supabase, { org_id: orgId, kind: kind === "voicemail" ? "voicemail" : "quickread", usd, user_id: userId, ref_id: callId });
        return true;
      } catch (err) {
        await supabase.from("calls").update({ status: "failed", error: `Quick read: ${err instanceof Error ? err.message : String(err)}`, updated_at: new Date().toISOString() }).eq("id", callId);
        return false;
      }
    },
  };
}
