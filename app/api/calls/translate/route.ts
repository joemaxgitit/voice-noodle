import { NextResponse, after } from "next/server";
import {
  gradeCostUsd,
  langOf,
  translationStuck,
  type Transcript,
  type Translation,
} from "@/lib/calls";
import { requireAdmin, log, thinkingFor, type Supa } from "@/lib/callsServer";

export const runtime = "nodejs";
export const maxDuration = 300;

/*
  English translation of a Spanish call, for the manager to read.

  The grade does NOT depend on this: the grader reads the original Spanish
  itself. So this runs alongside grading, and a translation problem can never
  hold up or change a grade.

  Haiku by default -- translation is a plain task it does well, and it is
  ~20x cheaper than Sonnet. Set TRANSLATE_MODEL in Vercel to override.
*/
const MODEL = process.env.TRANSLATE_MODEL || "claude-haiku-5-5";

const CHUNK_CHARS = 4000; // ~1k tokens of Spanish per request
const CONTEXT_LINES = 3; // previous lines sent along so each chunk reads in context
const CONCURRENCY = 6;
const CHUNK_TIMEOUT_MS = 100_000;
const DEADLINE_MS = 280_000;

type Line = { i: number; speaker: string; text: string };

export async function POST(request: Request) {
  const started = Date.now();
  const ctx = await requireAdmin(request);
  if (ctx instanceof NextResponse) return ctx;
  const { supabase } = ctx;

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 500 });
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
    .select("id, transcript, translation")
    .eq("id", callId)
    .single();

  if (error || !call) {
    return NextResponse.json({ error: `Call not found. ${error?.message ?? ""}` }, { status: 404 });
  }

  const transcript = call.transcript as Transcript | null;
  if (!transcript?.utterances?.length) {
    return NextResponse.json({ error: "Transcribe the call first." }, { status: 400 });
  }
  if (langOf(transcript.language) !== "es") {
    return NextResponse.json({ error: "This call is not in Spanish." }, { status: 400 });
  }

  const existing = call.translation as Translation | null;
  if (existing?.status === "working" && !translationStuck(existing)) {
    return NextResponse.json({ ok: true, already: true }, { status: 202 });
  }

  const claim: Translation = { status: "working", started_at: new Date().toISOString() };
  const { error: claimErr } = await supabase.from("calls").update({ translation: claim }).eq("id", callId);
  if (claimErr) {
    return NextResponse.json({ error: `Could not start. ${claimErr.message}` }, { status: 500 });
  }

  after(() => translate(supabase, callId, transcript, key, started));
  log("translate", callId, started, `accepted, ${transcript.utterances.length} lines`);
  return NextResponse.json({ ok: true }, { status: 202 });
}

function chunk(lines: Line[]): Line[][] {
  const out: Line[][] = [];
  let cur: Line[] = [];
  let size = 0;
  for (const l of lines) {
    if (cur.length && size + l.text.length > CHUNK_CHARS) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(l);
    size += l.text.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

const SCHEMA = {
  type: "object",
  required: ["lines"],
  additionalProperties: false,
  properties: {
    lines: {
      type: "array",
      items: {
        type: "object",
        required: ["i", "en"],
        additionalProperties: false,
        properties: { i: { type: "integer" }, en: { type: "string" } },
      },
    },
  },
};

const INSTRUCTIONS = `Translate lines from a recorded sales phone call (a debt-relief program, Lionside Financial / Bolton Services Group) from Spanish into English.

Rules:
- Faithful and natural. Keep the speaker's meaning, tone, hedges and promises exactly -- a compliance reviewer will rely on this. Never soften, strengthen, summarize or tidy up what was said.
- Keep every [REDACTED] or [... REDACTED] marker exactly as written.
- Keep names, company names (Lionside, Bolton, Slate, Chirp, SuperMoney, UA Law), dollar amounts, dates and numbers as said.
- If a line is already in English, or mixes languages, return it in English with the English parts unchanged.
- Return exactly one entry for every line you are asked to translate, with the same i. Do not translate the context lines.`;

async function translateChunk(
  lines: Line[],
  context: Line[],
  key: string
): Promise<{ map: Map<number, string>; usd: number }> {
  const body = {
    model: MODEL,
    max_tokens: 8000,
    ...thinkingFor(MODEL),
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: INSTRUCTIONS, cache_control: { type: "ephemeral" } },
          {
            type: "text",
            text:
              (context.length
                ? `Context (earlier in the call, do not translate):\n${JSON.stringify(context)}\n\n`
                : "") + `Translate these lines:\n${JSON.stringify(lines)}`,
          },
        ],
      },
    ],
  };

  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CHUNK_TIMEOUT_MS),
    });

    if (res.ok) {
      const data = (await res.json()) as {
        content?: { type: string; text?: string }[];
        usage?: Record<string, number>;
      };
      const text = data.content?.find((c) => c.type === "text")?.text || "{}";
      const parsed = JSON.parse(text) as { lines?: { i: number; en: string }[] };
      const map = new Map<number, string>();
      for (const l of parsed.lines ?? []) if (typeof l.en === "string") map.set(l.i, l.en);
      return { map, usd: gradeCostUsd(MODEL, data.usage ?? {}) ?? 0 };
    }

    const raw = await res.text().catch(() => "");
    try {
      lastErr = JSON.parse(raw)?.error?.message || raw.slice(0, 200);
    } catch {
      lastErr = raw.slice(0, 200);
    }
    lastErr = `Translation failed (${res.status}). ${lastErr}`;
    // Only rate limits and server errors are worth a second try.
    if (res.status !== 429 && res.status < 500) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(lastErr);
}

async function translate(supabase: Supa, callId: string, t: Transcript, key: string, started: number) {
  try {
    const lines: Line[] = t.utterances.map((u, i) => ({ i, speaker: u.speaker, text: u.text }));
    const chunks = chunk(lines);
    const out: string[] = t.utterances.map((u) => u.text);
    let usd = 0;
    let missing = 0;

    // A small worker pool: CONCURRENCY requests in flight at a time.
    let next = 0;
    const worker = async () => {
      while (next < chunks.length) {
        if (Date.now() - started > DEADLINE_MS) throw new Error("Translation ran out of time. Try again.");
        const c = chunks[next++];
        const first = c[0].i;
        const context = lines.slice(Math.max(0, first - CONTEXT_LINES), first);
        const r = await translateChunk(c, context, key);
        usd += r.usd;
        for (const l of c) {
          const en = r.map.get(l.i);
          if (en) out[l.i] = en;
          else missing += 1; // left in Spanish rather than invented
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, worker));

    const done: Translation = {
      status: "done",
      lines: out,
      model: MODEL,
      usd,
      error: missing ? `${missing} line${missing === 1 ? "" : "s"} could not be translated and are shown in Spanish.` : undefined,
    };
    const { error } = await supabase.from("calls").update({ translation: done }).eq("id", callId);
    if (error) throw new Error(`Could not save the translation. ${error.message}`);
    log("translate", callId, started, `saved, ${chunks.length} chunks, $${usd.toFixed(3)}`);
  } catch (e) {
    const failed: Translation = {
      status: "failed",
      error: e instanceof Error ? e.message : String(e),
    };
    await supabase.from("calls").update({ translation: failed }).eq("id", callId);
    log("translate", callId, started, `failed: ${failed.error}`);
  }
}
