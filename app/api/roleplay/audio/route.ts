import { NextResponse } from "next/server";
import { conversationAudio, requireMember } from "@/lib/roleplayServer";
import type { RoleplayInfo } from "@/lib/roleplay";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * The recording of a practice call, streamed from ElevenLabs. Row-level
 * security decides who may hear it: the rep who made it, and managers.
 * GET /api/roleplay/audio?callId=...  with the bearer token.
 */
export async function GET(request: Request) {
  const ctx = await requireMember(request);
  if (ctx instanceof NextResponse) return ctx;

  const callId = new URL(request.url).searchParams.get("callId") || "";
  const { data: call } = await ctx.supabase
    .from("calls")
    .select("source, roleplay")
    .eq("id", callId)
    .single();
  const conv = (call?.roleplay as RoleplayInfo | null)?.conversation_id;
  if (!call || call.source !== "roleplay" || !conv) {
    return NextResponse.json({ error: "No recording for this call." }, { status: 404 });
  }

  try {
    const res = await conversationAudio(conv);
    if (!res.ok || !res.body) {
      return NextResponse.json({ error: `The recording is not available (${res.status}).` }, { status: 502 });
    }
    return new Response(res.body, {
      headers: {
        "content-type": res.headers.get("content-type") || "audio/mpeg",
        "cache-control": "private, max-age=3600",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
