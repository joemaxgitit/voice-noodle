import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Supabase client for server-side route handlers.
 * Reads the caller's session from cookies so we can check their role.
 */
export async function createServerSupabase() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {
          // Route handlers here only read; nothing to persist.
        },
      },
    }
  );
}

/**
 * Client that authenticates with a token the caller supplied, rather than
 * with cookies.
 *
 * Why this exists: supabase.auth.getUser() makes a round trip to /auth/v1 to
 * validate the session, and that call hangs from our Node functions -- it
 * stalled for a full 60 seconds on /api/align while the same request from the
 * browser and from edge middleware succeeded normally.
 *
 * Passing the access token straight through means the only Supabase endpoint
 * we touch is /rest/v1, a different service. Security is unchanged: PostgREST
 * verifies the JWT signature itself and row-level security still applies, so
 * a forged or expired token is rejected at the database rather than trusted
 * here.
 */
export async function createTokenSupabase(accessToken: string) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return [];
        },
        setAll() {
          // No cookies in play; the token is the credential.
        },
      },
      global: {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    }
  );
}

/**
 * The user id inside a JWT, without verifying it.
 *
 * Safe because nothing is trusted on the strength of this alone -- it only
 * picks which profile row to ask for, and PostgREST rejects the request
 * outright if the signature is bad. A forged token cannot read anything.
 */
export function subjectOf(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = Buffer.from(payload, "base64url").toString("utf8");
    const claims = JSON.parse(json) as { sub?: string };
    return claims.sub || null;
  } catch {
    return null;
  }
}
