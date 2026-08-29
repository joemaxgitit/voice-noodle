import { NextResponse } from "next/server";
import { createTokenSupabase, subjectOf } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/*
  Abort before the platform does. 60s is the function ceiling on this plan;
  stopping at 45 leaves room to answer with JSON. Past the ceiling Vercel
  returns an HTML error page, which the browser cannot parse.
*/
const UPSTREAM_TIMEOUT_MS = 45_000;

type AlignedWord = { text: string; start: number; end: number };

/*
  These marks are permanent, not debugging leftovers.

  This route has failed twice in ways that were impossible to diagnose from
  Vercel's own trace, and both times a single instrumented deploy found the
  cause immediately after hours of guessing without one. Three console lines
  cost nothing and turn the next incident into one log read. Do not remove
  them as tidying.
*/
const mark = (started: number, label: string) =>
  console.log(`[align] ${label} @ ${Date.now() - started}ms`);

/**
 * Forced alignment: audio + known script text in, word timestamps out.
 *
 * WHY THERE IS NO getUser() CALL HERE.
 *
 * supabase.auth.getUser() hits /auth/v1, and from this function that endpoint
 * is unreliable -- usually instant, intermittently never returning. When it
 * hangs the runtime kills the invocation at ~31s with
 * FUNCTION_INVOCATION_FAILED and "No outgoing requests", or at exactly 60s
 * with a timeout. No exception is thrown, so try/catch cannot help. It struck
 * on 29 August, appeared to be fixed by NODE_OPTIONS=--dns-result-order=
 * ipv4first, then returned hours later on a healthy deployment.
 *
 * So the call is gone. The caller sends its access token and the profiles
 * query carries it, which touches /rest/v1 instead -- a different service
 * that has never exhibited this. Security is unchanged: PostgREST verifies
 * the JWT signature and row-level security still applies, so a forged or
 * expired token is rejected by the database rather than trusted here.
 *
 * The role check still runs before ElevenLabs is called, so credits are never
 * spent for a caller who is not an active admin.
 *
 * Every path returns JSON. An unhandled throw becomes a Vercel HTML 500 with
 * no message, which is unusable, so the handler is wrapped.
 */
export async function POST(request: Request) {
  const started = Date.now();
  mark(started, "entered");

  try {
    return await align(request, started);
  } catch (e) {
    mark(started, "outer catch");
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

  // Reading headers is free, so gate on the token before buffering an upload.
  const token = (request.headers.get("authorization") || "").replace(
    /^Bearer\s+/i,
    ""
  );

  if (!token) {
    return NextResponse.json(
      { error: "No session token was sent. Reload the page and sign in again." },
      { status: 401 }
    );
  }

  const userId = subjectOf(token);

  if (!userId) {
    return NextResponse.json(
      { error: "Your session token could not be read. Sign in again." },
      { status: 401 }
    );
  }

  // --- read the upload ---------------------------------------------------
  let file: File | null = null;
  let text = "";

  try {
    const form = await request.formData();
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

  mark(
    started,
    `body read: ${(file.size / (1024 * 1024)).toFixed(2)}MB ${file.type}`
  );

  // --- authorize, without /auth/v1 ---------------------------------------
  const supabase = await createTokenSupabase(token);

  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("role, active")
    .eq("id", userId)
    .single();
  mark(started, `profile checked${profileErr ? " (error)" : ""}`);

  if (profileErr) {
    // An expired or invalid token lands here, rejected by PostgREST.
    return NextResponse.json(
      { error: `Could not verify your account. ${profileErr.message}` },
      { status: 401 }
    );
  }

  if (!profile?.active || !["admin", "manager"].includes(profile.role)) {
    return NextResponse.json({ error: "Admins only." }, { status: 403 });
  }

  // --- call ElevenLabs ---------------------------------------------------
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
    mark(started, `elevenlabs ${res.status}`);
  } catch (e) {
    mark(started, "elevenlabs threw");

    const timedOut =
      e instanceof Error &&
      (e.name === "TimeoutError" || e.name === "AbortError");

    if (timedOut) {
      return NextResponse.json(
        {
          error:
            "The alignment service did not answer within 45 seconds. This is " +
            "the call out from our server, not your recording.",
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

  mark(started, `done, ${words.length} words`);
  return NextResponse.json({ words });
}
