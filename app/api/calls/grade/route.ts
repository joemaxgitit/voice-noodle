import { NextResponse, after } from "next/server";
import { isStuck, scoreOf, type CallStatus, type Grade, type Transcript } from "@/lib/calls";
import { requireAdmin, failCall, log, type Supa } from "@/lib/callsServer";

export const runtime = "nodejs";
export const maxDuration = 300;

const UPSTREAM_TIMEOUT_MS = 270_000;
const MODEL = process.env.GRADER_MODEL || "claude-sonnet-5-5";

type ModuleRow = {
  title: string;
  kind: string | null;
  sort_order: number;
  segments: {
    segment_code: string;
    title: string | null;
    script_text: string;
    sort_order: number;
    active: boolean;
  }[];
};

/**
 * Grades a transcribed call against its script. Returns at once; the work
 * runs in after() and the page polls the calls row.
 *
 * The grader only ever sees the redacted transcript.
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

  const { data: call, error } = await supabase
    .from("calls")
    .select("id, status, updated_at, transcript, script_id, call_date, client_label, profiles:rep_id(full_name)")
    .eq("id", callId)
    .single();

  if (error || !call) {
    return NextResponse.json({ error: `Call not found. ${error?.message ?? ""}` }, { status: 404 });
  }

  const status = call.status as CallStatus;
  if ((status === "transcribing" || status === "grading") && !isStuck(status, call.updated_at)) {
    return NextResponse.json({ ok: true, already: true }, { status: 202 });
  }
  if (!call.transcript) {
    return NextResponse.json({ error: "Transcribe the call first." }, { status: 400 });
  }
  if (!call.script_id) {
    return NextResponse.json({ error: "Pick which script this call should be graded against." }, { status: 400 });
  }

  const [{ data: script }, { data: modules, error: modErr }] = await Promise.all([
    supabase.from("scripts").select("title").eq("id", call.script_id).single(),
    supabase
      .from("modules")
      .select("title, kind, sort_order, segments(segment_code, title, script_text, sort_order, active)")
      .eq("script_id", call.script_id)
      .eq("active", true)
      .order("sort_order"),
  ]);

  if (modErr || !modules || modules.length === 0) {
    return NextResponse.json(
      { error: `Could not load the script. ${modErr?.message ?? "It has no modules."}` },
      { status: 500 }
    );
  }

  const { error: claimErr } = await supabase
    .from("calls")
    .update({ status: "grading", updated_at: new Date().toISOString() })
    .eq("id", callId);
  if (claimErr) {
    return NextResponse.json({ error: `Could not start. ${claimErr.message}` }, { status: 500 });
  }

  const repName =
    (call as unknown as { profiles: { full_name: string | null } | null }).profiles?.full_name ||
    "the rep";

  const prompt = buildPrompt(
    script?.title || "Script",
    modules as unknown as ModuleRow[],
    call.transcript as Transcript,
    repName
  );

  after(() => grade(supabase, callId, prompt, key, started));

  log("grade", callId, started, "accepted");
  return NextResponse.json({ ok: true }, { status: 202 });
}

function scriptText(modules: ModuleRow[]): { text: string; sequence: string[]; loops: string[] } {
  const sequence: string[] = [];
  const loops: string[] = [];
  const blocks: string[] = [];

  for (const m of modules) {
    const isLoop = m.kind === "loop";
    (isLoop ? loops : sequence).push(m.title);
    const segs = (m.segments || [])
      .filter((s) => s.active !== false)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((s) => `  [${s.segment_code}] ${s.script_text.trim()}`)
      .join("\n");
    blocks.push(`### ${isLoop ? "OBJECTION LOOP" : "SECTION"}: ${m.title}\n${segs}`);
  }

  return { text: blocks.join("\n\n"), sequence, loops };
}

function transcriptText(t: Transcript): string {
  const lines = t.utterances.map((u) => `[${Math.round(u.start)}] ${u.speaker}: ${u.text}`);
  let out = lines.join("\n");
  // A 90-minute call is ~90k characters. This only bites on something absurd.
  if (out.length > 300_000) out = out.slice(0, 300_000) + "\n[transcript truncated]";
  return out;
}

function buildPrompt(scriptTitle: string, modules: ModuleRow[], t: Transcript, repName: string): string {
  const s = scriptText(modules);
  return `You are reviewing a recorded phone call for a sales manager who coaches reps on a script. Grade how well the rep followed the script, and flag anything a compliance reviewer should hear.

The rep's name is ${repName}. The script is "${scriptTitle}".

<script>
${s.text}
</script>

<transcript>
Each line is [seconds from start] speaker_id: words.
Speaker ids come from automatic diarization and can be imperfect. If the ids are "agent" and "customer", those are the transcriber's own guess -- check them against what is said.
Banking and ID numbers have been removed and appear as [REDACTED] or [... REDACTED]. That is expected; never penalize it.
${transcriptText(t)}
</transcript>

How to grade:

speaker_roles: one entry per speaker id in the transcript. role is "rep" (${repName}), "client", "am" (an account manager conferenced in near the end), or "other".

sections: exactly one entry for each SECTION below, in this order:
${s.sequence.map((x) => `- ${x}`).join("\n")}
Add an entry for an OBJECTION LOOP only if that objection came up on the call; name it "Objection: <loop title>".
- "hit": the rep delivered the substance of the section. Word-for-word is not required.
- "partial": the rep did the section but left out something that matters. Say what in coaching.
- "missed": the call got past this point and the rep skipped it.
- "not_reached": the call ended or was handed off before this point.
evidence: a short quote from the transcript (25 words or fewer) showing what happened, or "" if missed/not reached. time: the seconds value of that line, or null.
coaching: one specific, practical sentence for the rep. "" if nothing to improve.

compliance: every required disclosure or confirmation question that appears in the script itself -- for example the call-recording notice, each compliance question the client must answer yes to, and statements about cancellation rights. One entry each, worded as the item. status "yes" if clearly done (for questions: asked and answered yes), "no" if the call reached that point and it was not done or the answer was not a clear yes, "unclear", or "not_reached".

flags: anything a compliance reviewer should listen to:
- every promise or claim about results (credit scores, timelines, savings, legal awards, debt being "gone"), even if the script contains it -- set in_script true when the script says essentially the same thing;
- anything said that contradicts the client acknowledgements (for example calling the program a loan or debt settlement, or saying the debt is no longer owed);
- misstatements, pressure, rushing past a client question or hesitation, or a client who sounds confused about what they agreed to;
- the rep reading sensitive numbers back aloud.
severity: "high" for anything that could mislead a client about what they are buying or what will happen to them; "medium" for overstated claims; "low" for minor wording. Quote 25 words or fewer.

furthest_point: one short phrase for where the call ended (for example "Enrolled and handed to account manager" or "Client hung up during options").
summary: 2-3 plain sentences a busy manager can read in ten seconds.
strengths: 2-4 short items. coaching_priorities: the top 3 things for this rep to work on, most important first.

You are grading from words only. Do not judge tone of voice or pacing.
Return only the JSON object described by the schema.`;
}

/*
  Structured output: the API guarantees the reply matches this schema.
  Every object must say additionalProperties: false.
*/
const GRADE_SCHEMA = {
  schema: {
    type: "object",
    required: [
      "speaker_roles",
      "summary",
      "furthest_point",
      "sections",
      "compliance",
      "flags",
      "strengths",
      "coaching_priorities",
    ],
    additionalProperties: false,
    properties: {
      speaker_roles: {
        type: "array",
        items: {
          type: "object",
          required: ["speaker", "role"],
          additionalProperties: false,
          properties: {
            speaker: { type: "string" },
            role: { type: "string", enum: ["rep", "client", "am", "other"] },
          },
        },
      },
      summary: { type: "string" },
      furthest_point: { type: "string" },
      sections: {
        type: "array",
        items: {
          type: "object",
          required: ["section", "status", "evidence", "time", "coaching"],
          additionalProperties: false,
          properties: {
            section: { type: "string" },
            status: { type: "string", enum: ["hit", "partial", "missed", "not_reached"] },
            evidence: { type: "string" },
            time: { type: ["number", "null"] },
            coaching: { type: "string" },
          },
        },
      },
      compliance: {
        type: "array",
        items: {
          type: "object",
          required: ["item", "status", "evidence", "time"],
          additionalProperties: false,
          properties: {
            item: { type: "string" },
            status: { type: "string", enum: ["yes", "no", "unclear", "not_reached"] },
            evidence: { type: "string" },
            time: { type: ["number", "null"] },
          },
        },
      },
      flags: {
        type: "array",
        items: {
          type: "object",
          required: ["time", "quote", "issue", "in_script", "severity"],
          additionalProperties: false,
          properties: {
            time: { type: ["number", "null"] },
            quote: { type: "string" },
            issue: { type: "string" },
            in_script: { type: "boolean" },
            severity: { type: "string", enum: ["high", "medium", "low"] },
          },
        },
      },
      strengths: { type: "array", items: { type: "string" } },
      coaching_priorities: { type: "array", items: { type: "string" } },
    },
  },
};

async function grade(supabase: Supa, callId: string, prompt: string, key: string, started: number) {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 12000,
        output_config: {
          format: { type: "json_schema", schema: GRADE_SCHEMA.schema },
        },
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    log("grade", callId, started, `anthropic ${res.status}`);

    if (!res.ok) {
      const raw = await res.text().catch(() => "");
      let message = raw.slice(0, 300);
      try {
        message = JSON.parse(raw)?.error?.message || message;
      } catch {
        // not JSON
      }
      throw new Error(`Grading failed (${res.status}). ${message}`);
    }

    const data = (await res.json()) as {
      content?: { type: string; text?: string }[];
      stop_reason?: string;
    };

    if (data.stop_reason === "refusal") {
      throw new Error("The grader declined to grade this call.");
    }
    if (data.stop_reason === "max_tokens") {
      throw new Error("The grade was too long and got cut off. Try again.");
    }

    const text = data.content?.find((c) => c.type === "text")?.text || "";
    let result: Grade;
    try {
      result = JSON.parse(text) as Grade;
    } catch {
      throw new Error("The grader returned something unreadable. Try again.");
    }

    result.sections ||= [];
    result.compliance ||= [];
    result.flags ||= [];
    result.strengths ||= [];
    result.coaching_priorities ||= [];
    result.speaker_roles ||= [];

    // The API can capitalize enum values ("Hit" for "hit"). Normalize so
    // scoring and the colored pills match.
    const low = <T extends string>(v: T) => String(v).toLowerCase().replace(/ /g, "_") as T;
    for (const s of result.sections) s.status = low(s.status);
    for (const c of result.compliance) c.status = low(c.status);
    for (const f of result.flags) f.severity = low(f.severity);
    for (const r of result.speaker_roles) r.role = low(r.role);

    result.model = MODEL;
    result.graded_at = new Date().toISOString();

    const { error } = await supabase
      .from("calls")
      .update({
        status: "graded",
        error: null,
        grade: result,
        score: scoreOf(result),
        updated_at: new Date().toISOString(),
      })
      .eq("id", callId);

    if (error) throw new Error(`Could not save the grade. ${error.message}`);
    log("grade", callId, started, "saved");
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    await failCall(
      supabase,
      callId,
      timedOut ? "Grading took longer than the time limit. Try again." : e instanceof Error ? e.message : String(e)
    );
    log("grade", callId, started, `failed: ${e instanceof Error ? e.message : e}`);
  }
}
