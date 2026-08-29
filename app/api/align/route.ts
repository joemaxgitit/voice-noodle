import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const UPSTREAM_TIMEOUT_MS = 50_000;

type AlignedWord = { text: string; start: number; end: number };

/*
  Marks stay until this is confirmed fixed across a few real uploads. They
  cost nothing and they are the only reason the cause was found: the log
  stopped dead after "supabase client built", which located the hang at
  getUser() rather than anywhere it had been guessed.
*/
const mark = (started: number, label: string) =>
  console.log(`[align] ${label} @ ${Date.now() - started}ms`);

/**
 * Forced alignment: audio + known script text in, word timestamps out.
 *
 * ORDER MATTERS HERE. The request body is read before anything else,
 * including the auth check.
 *
 * With a 2.4MB upload still streaming in, supabase.auth.getUser() hung for
 * ~31 seconds and the runtime killed the invocation -- FUNCTION_INVOCATION_
 * FAILED, no outgoing request recorded, and no catchable exception, so the
 * handler's own try/catch never fired. Smaller takes were fully buffered by
 * the platform before the function started, which is why thirty shorter
 * segments aligned fine and this one did not.
 *
 * Consuming the body first frees the connection before any outbound call.
 *
 * The cost: an unauthorized caller can make us buffer their upload. The
 * authorization check still runs before ElevenLabs is called, which is the
 * point that actually spends credits, so this trades a little wasted compute
 * for a route that works.
 */
export async function POST(request: Request) {
  const started = Date.now();
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

  console.log(
    `[align] content-length: ${request.headers.get("content-length") ?? "absent"}`
  );

  // --- read the upload FIRST -------------------------------------------
  // Nothing that touches the network may run before this. See the note above.
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

  // --- authorize --------------------------------------------------------
  // Now safe: the body is consumed, so outbound requests are not blocked
  // behind an unread stream.
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

  // --- call ElevenLabs ---------------------------------------------------
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
