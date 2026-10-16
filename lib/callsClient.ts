import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * POSTs to a call-monitoring route with the session token, the same way
 * /api/align is called (getSession reads locally; no /auth/v1 round trip).
 * Returns an error message, or "" on success.
 */
export async function startJob(
  supabase: SupabaseClient,
  route: "transcribe" | "grade",
  callId: string
): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return "Your session has expired. Sign in again.";

  try {
    const res = await fetch(`/api/calls/${route}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ callId }),
    });
    if (res.ok) return "";
    const body = await res.json().catch(() => ({}));
    return body?.error || `Request failed (${res.status}).`;
  } catch (e) {
    return e instanceof Error ? e.message : "Network error.";
  }
}
