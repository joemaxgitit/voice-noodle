import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/*
  Give up on the session refresh after this and serve the page anyway.

  updateSession() calls Supabase's /auth/v1, which from Vercel is
  intermittently unreachable -- usually a few hundred milliseconds, very
  occasionally never answering. Because this middleware runs on every request,
  one hung call took the whole site down with
  MIDDLEWARE_INVOCATION_TIMEOUT / 504 on 30 August. Supabase itself was
  healthy throughout: 3% CPU, 10 of 60 connections.

  Three seconds is roughly ten times a normal response, so this only fires
  when something is genuinely wrong.
*/
const AUTH_TIMEOUT_MS = 3_000;

/**
 * Refreshes the Supabase session cookie, but never at the cost of the page.
 *
 * On timeout the request passes through without a refreshed cookie. A visitor
 * whose token is still valid notices nothing. One whose token has just expired
 * gets sent to sign in. Both are better than every visitor getting a 504.
 */
export async function middleware(request: NextRequest) {
  try {
    return await Promise.race([
      updateSession(request),
      new Promise<NextResponse>((resolve) =>
        setTimeout(() => resolve(NextResponse.next()), AUTH_TIMEOUT_MS)
      ),
    ]);
  } catch {
    // A thrown auth error should not be fatal either.
    return NextResponse.next();
  }
}

export const config = {
  /*
    api is excluded: /api/align authenticates with a bearer token against
    /rest/v1 and does not read the session cookie, so putting it through the
    auth refresh is exposure to the flaky call for no benefit.
  */
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp3|m4a|wav)$).*)"],
};
