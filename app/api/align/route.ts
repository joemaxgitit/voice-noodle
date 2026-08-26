import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

type AlignedWord = { text: string; start: number; end: number };

/**
 * Forced alignment: audio + known script text in, word timestamps out.
 *
 * This runs server-side for two reasons. The ElevenLabs key never reaches the
 * browser, and we can verify the caller is an admin before spending credits --
 * otherwise any logged-in rep could run up the bill.
 */
export async function POST(request: Request) {
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
  } catch {
    return NextResponse.json({ error: "Bad request body." }, { status: 400 });
  }

  if (!file) {
    return NextResponse.json({ error: "No audio file." }, { status: 400 });
  }

  if (!text) {
    return NextResponse.json({ error: "No text to align." }, { status: 400 });
  }

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
    });
  } catch {
    return NextResponse.json(
      { error: "Could not reach the alignment service." },
      { status: 502 }
    );
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return NextResponse.json(
      {
        error:
          res.status === 401
            ? "ElevenLabs rejected the API key."
            : `Alignment failed (${res.status}). ${detail.slice(0, 300)}`,
      },
      { status: 502 }
    );
  }

  const data = (await res.json()) as {
    words?: { text: string; start: number; end: number }[];
  };

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
