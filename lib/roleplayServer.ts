import { NextResponse } from "next/server";
import { createTokenSupabase, subjectOf } from "@/lib/supabase/server";
import type { Supa } from "@/lib/callsServer";
import type { AgentSpec } from "@/lib/roleplay";

/*
  Server helpers for practice calls: who is calling, and the ElevenLabs
  Agents API (the voice of the mock client).
*/

const XI = process.env.ELEVENLABS_API_BASE || "https://api.elevenlabs.io";

export type MemberContext = {
  supabase: Supa;
  userId: string;
  orgId: string;
  role: string;
  name: string;
  isAdmin: boolean;
};

/** Any signed-in, active user -- reps included. */
export async function requireMember(request: Request): Promise<MemberContext | NextResponse> {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const userId = token ? subjectOf(token) : null;
  if (!userId) {
    return NextResponse.json({ error: "Your session has expired. Reload the page and sign in again." }, { status: 401 });
  }
  const supabase = await createTokenSupabase(token);
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role, active, org_id, full_name")
    .eq("id", userId)
    .single();
  if (error || !profile || !profile.active) {
    return NextResponse.json({ error: `Could not verify your account. ${error?.message ?? ""}` }, { status: 401 });
  }
  return {
    supabase,
    userId,
    orgId: profile.org_id,
    role: profile.role,
    name: profile.full_name || "",
    isAdmin: ["admin", "manager"].includes(profile.role),
  };
}

export function xiKey(): string | null {
  return process.env.ELEVENLABS_API_KEY || null;
}

async function xi(path: string, init: RequestInit = {}) {
  const key = xiKey();
  if (!key) throw new Error("ELEVENLABS_API_KEY is not set on the server.");
  return fetch(XI + path, {
    ...init,
    headers: { "xi-api-key": key, "content-type": "application/json", ...(init.headers || {}) },
    signal: init.signal ?? AbortSignal.timeout(30_000),
  });
}

async function xiError(res: Response, what: string): Promise<Error> {
  const raw = await res.text().catch(() => "");
  let msg = raw.slice(0, 400);
  try {
    const j = JSON.parse(raw);
    const d = j?.detail;
    msg = typeof d === "string" ? d : d?.message || JSON.stringify(d ?? j).slice(0, 400);
  } catch {
    // not JSON
  }
  if (res.status === 401 || /permission|missing_permissions/i.test(msg)) {
    msg += " -- your ElevenLabs API key needs access to ElevenLabs Agents (in ElevenLabs: Developers > API keys > edit the key > ElevenLabs Agents: Write).";
  }
  return new Error(`${what} failed (${res.status}). ${msg}`);
}

/*
  The body is built in decreasing order of ambition. Some accounts reject a
  setting the API documents (a TTS model their plan lacks, an English agent on
  a multilingual model, a call length over the plan's cap). Rather than fail
  the whole sync, drop the optional parts one at a time.
*/
function bodies(s: AgentSpec) {
  const agent = {
    first_message: s.firstMessage,
    language: s.language,
    prompt: { prompt: s.prompt, llm: s.llm, temperature: 0.7 },
  };
  const voice = s.voiceId ? { voice_id: s.voiceId } : {};
  const full = {
    name: s.name,
    tags: ["voice-noodle", "roleplay"],
    conversation_config: {
      agent,
      tts: { ...voice, model_id: "eleven_flash_v2_5" },
      conversation: { max_duration_seconds: s.maxSeconds },
    },
    // Private: a conversation can only start from a signed URL our server
    // hands out, so nobody can ring the agent directly with its id.
    platform_settings: { auth: { enable_auth: true } },
  };
  const noModel = {
    ...full,
    conversation_config: { ...full.conversation_config, tts: { ...voice } },
  };
  const minimal = {
    name: s.name,
    conversation_config: { agent, tts: { ...voice } },
    platform_settings: { auth: { enable_auth: true } },
  };
  return [full, noModel, minimal];
}

/** Creates the agent, or updates it in place. Returns its id. */
export async function upsertAgent(existingId: string | null, spec: AgentSpec): Promise<string> {
  let last: Error | null = null;
  for (const body of bodies(spec)) {
    const res = existingId
      ? await xi(`/v1/convai/agents/${encodeURIComponent(existingId)}`, { method: "PATCH", body: JSON.stringify(body) })
      : await xi("/v1/convai/agents/create", { method: "POST", body: JSON.stringify(body) });

    if (res.ok) {
      if (existingId) return existingId;
      const j = (await res.json()) as { agent_id?: string };
      if (!j.agent_id) throw new Error("ElevenLabs did not return an agent id.");
      return j.agent_id;
    }
    // The agent was deleted on the ElevenLabs side: make a new one.
    if (existingId && res.status === 404) return upsertAgent(null, spec);
    last = await xiError(res, existingId ? "Updating the voice agent" : "Creating the voice agent");
    // Only a rejected setting is worth retrying with less.
    if (res.status !== 400 && res.status !== 422) throw last;
  }
  throw last ?? new Error("Could not set up the voice agent.");
}

/** A one-time URL the browser uses to open the call. */
export async function signedUrl(agentId: string): Promise<string> {
  const res = await xi(`/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`);
  if (!res.ok) throw await xiError(res, "Opening the call");
  const j = (await res.json()) as { signed_url?: string };
  if (!j.signed_url) throw new Error("ElevenLabs did not return a call link.");
  return j.signed_url;
}

export type XiConversation = {
  status: "initiated" | "in-progress" | "processing" | "done" | "failed";
  transcript: { role: "user" | "agent"; message: string | null; time_in_call_secs: number }[];
  metadata?: { call_duration_secs?: number; cost?: number | null; start_time_unix_secs?: number };
  has_audio?: boolean;
  agent_id?: string;
};

export async function getConversation(id: string): Promise<XiConversation> {
  const res = await xi(`/v1/convai/conversations/${encodeURIComponent(id)}`);
  if (!res.ok) throw await xiError(res, "Fetching the practice call");
  return (await res.json()) as XiConversation;
}

/** The recording, streamed through so the API key stays on the server. */
export async function conversationAudio(id: string): Promise<Response> {
  const key = xiKey();
  if (!key) throw new Error("ELEVENLABS_API_KEY is not set on the server.");
  return fetch(`${XI}/v1/convai/conversations/${encodeURIComponent(id)}/audio`, {
    headers: { "xi-api-key": key },
    signal: AbortSignal.timeout(60_000),
  });
}

export type XiVoice = { voice_id: string; name: string; labels?: Record<string, string>; category?: string };

export async function listVoices(): Promise<XiVoice[]> {
  const res = await xi("/v1/voices");
  if (!res.ok) throw await xiError(res, "Listing voices");
  const j = (await res.json()) as { voices?: XiVoice[] };
  return j.voices || [];
}
