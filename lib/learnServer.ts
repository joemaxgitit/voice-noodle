import { thinkingFor, type Supa } from "@/lib/callsServer";
import { gradeCostUsd, langOf, resolveRoles, type Grade, type Role, type Transcript, type Translation } from "@/lib/calls";
import { OBJECTION_TYPES, SHORT_CALL_SECS } from "@/lib/learn";

/*
  Reads one graded real call and keeps an anonymous client profile
  (see lib/learn.ts). Haiku, about a third of a cent per call. Never sees
  or keeps names: the transcript is already redacted for numbers, and the
  model is told to drop names and anything that could identify the client.
*/

const MODEL = process.env.LEARN_MODEL || "claude-haiku-5-5";

const str = { type: "string" } as const;
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["usable", "profile", "objections", "cold", "warm", "ending"],
  properties: {
    usable: { type: "boolean" },
    profile: {
      type: "object",
      additionalProperties: false,
      required: ["situation", "hardship", "debts", "personality", "speech", "wanted", "decision", "opened_up", "turndown"],
      properties: { situation: str, hardship: str, debts: str, personality: str, speech: str, wanted: str, decision: str, opened_up: str, turndown: str },
    },
    objections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "quote", "underneath", "handled", "what_worked"],
        properties: { type: { type: "string", enum: [...OBJECTION_TYPES] }, quote: str, underneath: str, handled: { type: "boolean" }, what_worked: str },
      },
    },
    cold: { type: "array", items: { type: "object", additionalProperties: false, required: ["rep_did", "client_reaction"], properties: { rep_did: str, client_reaction: str } } },
    warm: { type: "array", items: { type: "object", additionalProperties: false, required: ["rep_did", "client_reaction"], properties: { rep_did: str, client_reaction: str } } },
    ending: {
      type: "object",
      additionalProperties: false,
      required: ["how", "hung_up", "trigger", "last_words"],
      properties: { how: { type: "string", enum: ["enrolled", "callback", "declined", "hung_up", "other"] }, hung_up: { type: "boolean" }, trigger: str, last_words: str },
    },
  },
} as const;

const INSTRUCTIONS = `You read a real sales call between a debt relief rep (Lionside Financial) and a client, and describe the CLIENT so an AI can later play a realistic practice client. Everything you write must be anonymous.

Rules:
- Never write a name (client, rep, family, employer), a city or street, a phone, account or reference number, a date of birth, or any exact dollar amount. Round money to rough ranges ("around 20 thousand in credit cards"). Replace names with a role ("my husband", "the rep").
- quote: the client's own words for the objection, lightly trimmed, anonymized, in the language they spoke. Keep their phrasing, fillers and tone -- that is the point.
- underneath: what the real concern turned out to be, in plain words (English).
- what_worked: what the rep said or did that settled it, or "" if nothing did.
- cold / warm: up to 4 each -- the specific thing the rep did (English, plain, "pitched the program before asking about the hardship"), and how the client reacted.
- ending.trigger: if the client hung up, went silent or bailed, what the rep did in the last 20-30 seconds before that; otherwise "".
- ending.last_words: the client's last line, anonymized.
- profile fields: short, plain English. speech = how they talk (pace, fillers, slang, formality, Spanish/English mix). decision = who decides and how (alone, with spouse, needs time).
- opened_up: how the client's hardship came out -- the surface version first, what deeper thing they shared, roughly when, and what the rep did that got them there (or cut it off).
- turndown: if the loan was declined, how the client took it and what the rep did in the next minute that lifted them back up or lost them; "" if there was no decline.
- usable: false if this is not a real sales conversation with a client (voicemail, wrong number, internal call, mostly silence).
Return the JSON only.`;

export async function learnFromCall(supabase: Supa, orgId: string, callId: string, key: string): Promise<{ ok: boolean; skipped?: string; error?: string }> {
  const { data: call, error } = await supabase
    .from("calls")
    .select("id, org_id, source, status, transcript, translation, grade, speaker_roles, duration_secs, outcome, outcome_manual")
    .eq("id", callId)
    .single();
  if (error || !call) return { ok: false, error: error?.message || "Call not found." };
  if (call.source === "roleplay") return { ok: true, skipped: "practice call" };
  if (call.status !== "graded" || !call.transcript) return { ok: true, skipped: "not graded yet" };

  const t = call.transcript as Transcript;
  const roles = resolveRoles(t, (call.speaker_roles as Record<string, Role> | null) ?? null, (call.grade as Grade | null) ?? null);
  const label = (s: string) => (roles[s] === "rep" ? "REP" : roles[s] === "client" ? "CLIENT" : "OTHER");
  const lang = langOf(t.language);
  const english = (call.translation as Translation | null)?.status === "done" ? (call.translation as Translation).lines : undefined;
  const clientLines = t.utterances.filter((u) => roles[u.speaker] === "client");
  const secs = Number(call.duration_secs) || (t.utterances.at(-1)?.end ?? 0);
  const short = secs < SHORT_CALL_SECS || clientLines.length < 8;

  let text = t.utterances
    .map((u, i) => `[${Math.round(u.start)}] ${label(u.speaker)}: ${u.text}${english?.[i] && lang === "es" ? `  (English: ${english[i]})` : ""}`)
    .join("\n");
  if (text.length > 120_000) text = text.slice(0, 120_000) + "\n[transcript cut]";

  const res = await fetch(`${process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com"}/v1/messages`, {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      ...thinkingFor(MODEL),
      output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA } },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: INSTRUCTIONS },
            {
              type: "text",
              text: `${short ? "This is a SHORT call: focus on how it ended and why; keep the profile brief.\n" : ""}Call outcome: ${call.outcome_manual || call.outcome || "unknown"}. Language: ${lang === "es" ? "Spanish" : "English"}.\n\n<transcript>\n${text}\n</transcript>`,
            },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(110_000),
  });
  if (!res.ok) return { ok: false, error: `Learning failed (${res.status}). ${(await res.text().catch(() => "")).slice(0, 200)}` };
  const data = (await res.json()) as { content?: { type: string; text?: string }[]; usage?: Record<string, number> };
  const raw = (data.content || []).filter((c) => c.type === "text").map((c) => c.text || "").join("");
  let j: {
    usable: boolean;
    profile: Record<string, string>;
    objections: unknown[];
    cold: unknown[];
    warm: unknown[];
    ending: Record<string, unknown>;
  };
  try {
    j = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
  } catch {
    return { ok: false, error: "The learning step returned something unreadable." };
  }

  const row = {
    org_id: orgId,
    call_id: callId,
    lang,
    kind: !j.usable ? "skip" : short ? "short" : "full",
    outcome: (call.outcome_manual as string | null) || (call.outcome as string | null) || null,
    profile: j.profile ?? {},
    objections: (j.objections ?? []).slice(0, 8),
    moments: { cold: (j.cold ?? []).slice(0, 4), warm: (j.warm ?? []).slice(0, 4) },
    ending: j.ending ?? {},
    model: MODEL,
    usd: gradeCostUsd(MODEL, data.usage ?? {}),
  };
  const { error: upErr } = await supabase.from("client_insights").upsert(row, { onConflict: "call_id" });
  if (upErr) return { ok: false, error: /client_insights|does not exist/i.test(upErr.message) ? "Run supabase/real-call-learning.sql first." : upErr.message };
  return { ok: true };
}
