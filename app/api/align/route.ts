import { NextResponse } from "next/server";
import { createTokenSupabase, subjectOf } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const UPSTREAM_TIMEOUT_MS = 45_000;

type AlignedWord = { text: string; start: number; end: number };

const mark = (started: number, label: string) =>
  console.log(`[align] ${label} @ ${Date.now() - started}ms`);

/**
 * Forced alignment: audio + known script text in, word timestamps out.
 *
 * Two callers, two rules:
 *
 *   master   -- an admin aligning a recording they just made. Admins only,
 *               always allowed. This is how the reference timings get built,
 *               so it must keep working whatever else is switched off.
 *
 *   practice -- a rep scoring their own attempt. Any active member of the
 *               org, and only while that org has practice switched on.
 *
 * The flag is checked HERE, not only in the interface. Hiding a button stops
 * nobody: a stale tab or a direct call would still spend credits, which is
 * the entire thing the switch exists to prevent.
 *
 * Two constraints found the hard way:
 *
 * 1. The request body is read before anything else. With an upload still
 *    streaming in, outbound calls stalled and the runtime killed the
 *    invocation at ~31s with no catchable error.
 *
 * 2. Authentication never calls /auth/v1 -- that endpoint hangs
 *    intermittently from this function. The caller sends its access token and
 *    the profile query carries it, so only /rest/v1 is touched. PostgREST
 *    verifies the signature, so this is not a weaker check.
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

  // --- read the upload FIRST -------------------------------------------
  let file: File | null = null;
  let text = "";
  let mode = "master";

  try {
    const form = await request.formData();
    const f = form.get("file");
    file = f instanceof File ? f : null;
    text = String(form.get("text") || "").trim();
    // Absent means an older client, which is only ever the master path.
    mode = String(form.get("mode") || "master");
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
    `body read: ${(file.size / (1024 * 1024)).toFixed(2)}MB ${mode}`
  );

  // --- authorize --------------------------------------------------------
  const supabase = await createTokenSupabase(token);

  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("role, active, org_id")
    .eq("id", userId)
    .single();
  mark(started, `profile checked${profileErr ? " (error)" : ""}`);

  if (profileErr) {
    return NextResponse.json(
      { error: `Could not verify your account. ${profileErr.message}` },
      { status: 401 }
    );
  }

  if (!profile?.active) {
    return NextResponse.json({ error: "Your account is inactive." }, { status: 403 });
  }

  if (mode === "practice") {
    const { data: org } = await supabase
      .from("orgs")
      .select("practice_enabled")
      .eq("id", profile.org_id)
      .single();

    if (!org?.practice_enabled) {
      // Deliberately before ElevenLabs is touched. Nothing is spent.
      return NextResponse.json(
        { error: "Practice scoring is switched off." },
        { status: 403 }
      );
    }
  } else if (!["admin", "manager"].includes(profile.role)) {
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
