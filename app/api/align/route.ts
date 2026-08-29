import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/*
  Abort our own call before Vercel kills the function. 60s is the platform
  ceiling on this plan; stopping at 50 leaves room to answer with JSON saying
  what happened. Past the ceiling Vercel returns an HTML error page instead,
  which the browser cannot parse and the rep sees as gibberish.
*/
const UPSTREAM_TIMEOUT_MS = 50_000;

type AlignedWord = { text: string; start: number; end: number };

/**
 * Forced alignment: audio + known script text in, word timestamps out.
 *
 * This runs server-side for two reasons. The ElevenLabs key never reaches the
 * browser, and we can verify the caller is an admin before spending credits --
 * otherwise any logged-in rep could run up the bill.
 *
 * Every path returns JSON. An unhandled throw here becomes a Vercel HTML 500
 * with no message at all, which is unusable for diagnosis -- so the whole
 * handler is wrapped and the outer catch reports the real error.
 */
export async function POST(request: Request) {
  try {
    return await align(request);
  } catch (e) {
    // Last resort. Something threw outside the specific guards below.
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

async function align(request: Request) {
  const key = process.env.ELEVENLABS_API_KEY;

  if (!key) {
    return NextResponse.json(
      { error: "ELEVENLABS_API_KEY is not set on the server." },
      { status: 500 }
    );
  }

  // --- authorize -------------------------------------------------------
  const supabase = await createServerSupabase();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, active")
    .eq("id", user.id)
    .single();

  if (!profile?.active || !["admin", "manager"].includes(profile.role)) {
    return NextResponse.json({ error: "Admins only." }, { status: 403 });
  }

  // --- read the upload -------------------------------------------------
  let file: File | null = null;
  let text = "";

  try {
    const form = await request.formData();
    const f = form.get("file");
    file = f instanceof File ? f : null;
    text = String(form.get("text") || "").trim();
  } catch (e) {
    // A stalled or aborted upload lands here. Say so, rather than letting it
    // surface as an unexplained crash.
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

  // --- call ElevenLabs -------------------------------------------------
  const outbound = new FormData();
  outbound.append("file", file, file.name || "audio.mp3");
  outbound.append("text", text); // plain string; must not be JSON-wrapped

  let res: Response;

  try {
    res = await fetch("https://api.elevenlabs.io/v1/forced-alignment", {
      method: "POST",
      headers: { "xi-api-key": key },
      body: outbound,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (e) {
    const timedOut =
      e instanceof Error &&
      (e.name === "TimeoutError" || e.name === "AbortError");

    if (timedOut) {
      return NextResponse.json(
        {
          error:
            `Alignment gave up after 50 seconds on a ${sizeMb.toFixed(1)} MB ` +
            "file. A WAV is roughly eight times the size of an MP3 of the " +
            "same take -- export as MP3 and try again.",
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

  // Reading the body can fail on its own -- headers arrive, then the stream
  // stalls or the payload is not JSON. Unwrapped, that throw became an HTML
  // 500 with nothing in it.
  let data: { words?: { text: string; start: number; end: number }[] };

  try {
    data = await res.json();
  } catch (e) {
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

  return NextResponse.json({ words });
}
