import { NextResponse, after } from "next/server";
import { requireAdmin, log } from "@/lib/callsServer";
import { prepareGrade } from "@/lib/gradeCall";
import { afterGrade } from "@/lib/chain";
import { prepareQuick } from "@/lib/quickRead";

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
  const { supabase, orgId, userId } = ctx;

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not set on the server. Add it in Vercel > Project > Settings > Environment Variables, then redeploy." },
      { status: 500 }
    );
  }

  let callId = "";
  let full = false;
  try {
    const body = await request.json();
    callId = String(body?.callId || "");
    full = !!body?.full;
  } catch {
    // fall through
  }
  if (!callId) return NextResponse.json({ error: "No call id." }, { status: 400 });

  // A full grade replaces any earlier quick read (no-op before supabase/quick_reads.sql).
  if (full) await supabase.from("calls").update({ kind: null, quick: null }).eq("id", callId).then(() => undefined, () => undefined);

  // A voicemail or a short call gets a cheap read instead of the full grade ("Grade it fully" sends full).
  if (!full) {
    const quick = await prepareQuick(supabase, callId, key, orgId, userId);
    if (quick) {
      after(async () => {
        await quick.run();
      });
      log("grade", callId, started, `quick read (${quick.kind})`);
      return NextResponse.json({ ok: true, quick: quick.kind }, { status: 202 });
    }
  }

  const prep = await prepareGrade(supabase, callId, key, started);
  if (!prep.ok) return NextResponse.json({ error: prep.error }, { status: prep.status });
  if (prep.already) return NextResponse.json({ ok: true, already: true }, { status: 202 });

  // Then learn from it, keep its client journey current and refresh the practice voices -- by itself.
  after(async () => {
    await prep.run();
    await afterGrade(request, supabase, callId);
  });
  log("grade", callId, started, `accepted (${prep.summary})`);
  return NextResponse.json({ ok: true }, { status: 202 });
}
