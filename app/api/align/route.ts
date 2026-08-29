import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const UPSTREAM_TIMEOUT_MS = 50_000;

type AlignedWord = { text: string; start: number; end: number };

/*
  Instrumentation, temporary.

  /api/align dies at a fixed ~31s with FUNCTION_INVOCATION_FAILED and no
  outgoing request, across three deployments (31.07s, 31.08s, 30.87s). The
  outer try/catch never fires, so the runtime is terminating the invocation
  rather than throwing something catchable. Excluding middleware changed
  nothing, which ruled that out.

  Between entry and the ElevenLabs call there are only the Supabase auth
  queries and request.formData(). These marks show which one it reaches and
  which one it never returns from. Whichever line has a "start" with no
  matching "done" is the culprit.

  Remove once the cause is known.
*/
const t0 = () => Date.now();
const mark = (started: number, label: string) =>
  console.log(`[align] ${label} @ ${Date.now() - started}ms`);

export async function POST(request: Request) {
  const started = t0();
  mark(started, "handler entered");

  try {
    return await align(request, started);
  } catch (e) {
    mark(started, "outer catch fired");
    return NextResponse.json(
      {
        error:
          "The alignment service crashed. " +
          (e instanceof Error ? e.message : String(e)),
      },
      { status: 500 }
    );
  }
}

async function align(request: Request, started: number) {
  const key = process.env.ELEVENLABS_API_KEY;

  if (!key) {
    return NextResponse.json(
      { error: "ELEVENLABS_API_KEY is not set on the server." },
      { status: 500 }
    );
  }

  mark(started, "key present");

  // Content-Length tells us what the browser said it was sending, before we
  // try to read any of it. If the parse stalls, this is the size it stalled
  // on.
  const declared = request.headers.get("content-length");
  console.log(`[align] content-length: ${declared ?? "absent"}`);

  // --- authorize -------------------------------------------------------
  const supabase = await createServerSupabase();
  mark(started, "supabase client built");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  mark(started, `getUser done, user ${user ? "found" : "missing"}`);

  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, active")
    .eq("id", user.id)
    .single();
  mark(started, "profile query done");

  if (!profile?.active || !["admin", "manager"].includes(profile.role)) {
    return NextResponse.json({ error: "Admins only." }, { status: 403 });
  }

  // --- read the upload -------------------------------------------------
  let file: File | null = null;
  let text = "";

  mark(started, "formData START");

  try {
    const form = await request.formData();
    mark(started, "formData done");

    const f = form.get("file");
    file = f instanceof File ? f : null;
    text = String(form.get("text") || "").trim();
  } catch (e) {
    mark(started, "formData threw");
    return NextResponse.json(
      {
        error:
          "The audio never finished uploading. " +
          (e instanceof Error ? e.message : "The connection dropped."),
      },
      { status: 400 }
    );
  }

  if (!file) {
    return NextResponse.json({ error: "No audio file." }, { status: 400 });
  }

  if (!text) {
    return NextResponse.json({ error: "No text to align." }, { status: 400 });
  }

  const sizeMb = file.size / (1024 * 1024);
  console.log(
    `[align] file ${file.name} ${sizeMb.toFixed(2)}MB type=${file.type} ` +
      `text=${text.length} chars`
  );

  // --- call ElevenLabs -------------------------------------------------
  const outbound = new FormData();
  outbound.append("file", file, file.name || "audio.mp3");
  outbound.append("text", text); // plain string; must not be JSON-wrapped

  mark(started, "elevenlabs fetch START");

  let res: Response;

  try {
    res = await fetch("https://api.elevenlabs.io/v1/forced-alignment", {
      method: "POST",
      headers: { "xi-api-key": key },
      body: outbound,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    mark(started, `elevenlabs responded ${res.status}`);
  } catch (e) {
    mark(started, "elevenlabs fetch threw");

    const timedOut =
      e instanceof Error &&
      (e.name === "TimeoutError" || e.name === "AbortError");

    if (timedOut) {
      return NextResponse.json(
        {
          error:
            `Alignment gave up after 50 seconds on a ${sizeMb.toFixed(1)} MB ` +
            "file. Try a shorter take or a smaller file.",
        },
        { status: 504 }
      );
    }

    return NextResponse.json(
      {
        error:
          "Could not reach the alignment service. " +
          (e instanceof Error ? e.message : ""),
      },
      { status: 502 }
    );
  }

  if (!res.ok) {
    const raw = await res.text().catch(() => "");

    // ElevenLabs returns 401 for BOTH a bad key and a key that is missing
    // permissions. The status code alone cannot tell them apart, so surface
    // the body rather than collapsing it into a generic message.
    let status = "";
    let message = "";

    try {
      const parsed = JSON.parse(raw);
      status = parsed?.detail?.status || "";
      message = parsed?.detail?.message || "";
    } catch {
      // non-JSON body; fall through to the raw text
    }

    let error: string;

    if (status === "missing_permissions") {
      error =
        "Your ElevenLabs key is missing a permission. In ElevenLabs go to " +
        "Developers > API Keys > Edit, and either turn Restrict Key off or " +
        "grant Speech to Text access. " +
        message;
    } else if (status === "invalid_api_key") {
      error =
        "ElevenLabs did not recognise the key. Make sure the value starts " +
        "with sk_ and was copied in full.";
    } else if (status === "quota_exceeded") {
      error = "Your ElevenLabs account is out of credits.";
    } else {
      error = `Alignment failed (${res.status}). ${message || raw.slice(0, 300)}`;
    }

    return NextResponse.json({ error }, { status: 502 });
  }

  let data: { words?: { text: string; start: number; end: number }[] };

  try {
    data = await res.json();
    mark(started, "response parsed");
  } catch (e) {
    mark(started, "response parse threw");
    return NextResponse.json(
      {
        error:
          "Alignment answered, but the result could not be read. " +
          (e instanceof Error ? e.message : ""),
      },
      { status: 502 }
    );
  }

  const words: AlignedWord[] = (data.words || [])
    .filter((w) => w.text && w.text.trim())
    .map((w) => ({
      text: w.text,
      start: Number(w.start) || 0,
      end: Number(w.end) || 0,
    }));

  if (words.length === 0) {
    return NextResponse.json(
      { error: "Alignment returned no words." },
      { status: 502 }
    );
  }

  mark(started, `returning ${words.length} words`);
  return NextResponse.json({ words });
}
