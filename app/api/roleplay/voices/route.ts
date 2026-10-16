import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/callsServer";
import { listVoices } from "@/lib/roleplayServer";

export const runtime = "nodejs";

/** The voices on the ElevenLabs account, for the mock-client editor. */
export async function GET(request: Request) {
  const ctx = await requireAdmin(request);
  if (ctx instanceof NextResponse) return ctx;
  try {
    const voices = await listVoices();
    return NextResponse.json({
      voices: voices
        .map((v) => ({
          id: v.voice_id,
          name: v.name,
          about: [v.labels?.gender, v.labels?.age, v.labels?.accent, v.labels?.description || v.labels?.descriptive]
            .filter(Boolean)
            .join(", "),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
