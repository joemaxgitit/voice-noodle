import { NextResponse } from "next/server";
import { createTokenSupabase, subjectOf } from "@/lib/supabase/server";

/*
  Shared by the call-monitoring routes. Same rules as /api/align: the caller
  sends its access token, only /rest/v1 and /storage/v1 are touched (never
  /auth/v1, which hangs from Node functions), and row-level security does the
  real enforcement.
*/

export type Supa = Awaited<ReturnType<typeof createTokenSupabase>>;

export type AdminContext = {
  supabase: Supa;
  userId: string;
  orgId: string;
};

/** Returns the context, or a ready-made error response. */
export async function requireAdmin(
  request: Request
): Promise<AdminContext | NextResponse> {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
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

  const supabase = await createTokenSupabase(token);
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role, active, org_id")
    .eq("id", userId)
    .single();

  if (error || !profile) {
    return NextResponse.json(
      { error: `Could not verify your account. ${error?.message ?? ""}` },
      { status: 401 }
    );
  }

  if (!profile.active || !["admin", "manager"].includes(profile.role)) {
    return NextResponse.json({ error: "Managers and admins only." }, { status: 403 });
  }

  return { supabase, userId, orgId: profile.org_id };
}

/** Records a failure on the call so the page can show it. Never throws. */
export async function failCall(supabase: Supa, callId: string, message: string) {
  try {
    await supabase
      .from("calls")
      .update({
        status: "failed",
        error: message.slice(0, 1000),
        updated_at: new Date().toISOString(),
      })
      .eq("id", callId);
  } catch {
    // Nothing more we can do; the page will show it as stuck and offer a retry.
  }
}

export const log = (tag: string, callId: string, started: number, msg: string) =>
  console.log(`[${tag}] ${callId.slice(0, 8)} ${msg} @ ${Date.now() - started}ms`);
