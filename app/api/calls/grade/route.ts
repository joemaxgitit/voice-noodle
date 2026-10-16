import { NextResponse, after } from "next/server";
import { requireAdmin, log } from "@/lib/callsServer";
import { prepareGrade } from "@/lib/gradeCall";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Grades a transcribed call against its script. Returns at once; the work
 * runs in after() and the page polls the calls row. The grader itself lives
 * in lib/gradeCall.ts, shared with practice calls.
 */
export async function POST(request: Request) {
  const started = Date.now();
  const ctx = await requireAdmin(request);
  if (ctx instanceof NextResponse) return ctx;
  const { supabase } = ctx;

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not set on the server. Add it in Vercel > Project > Settings > Environment Variables, then redeploy." },
      { status: 500 }
    );
  }

  let callId = "";
  try {
    callId = String((await request.json())?.callId || "");
  } catch {
    // fall through
  }
  if (!callId) return NextResponse.json({ error: "No call id." }, { status: 400 });

  const prep = await prepareGrade(supabase, callId, key, started);
  if (!prep.ok) return NextResponse.json({ error: prep.error }, { status: prep.status });
  if (prep.already) return NextResponse.json({ ok: true, already: true }, { status: 202 });

  after(prep.run);
  log("grade", callId, started, `accepted (${prep.summary})`);
  return NextResponse.json({ ok: true }, { status: 202 });
}
