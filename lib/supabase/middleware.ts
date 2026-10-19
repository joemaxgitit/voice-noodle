import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase session cookie and gates protected routes.
 *
 * Note: this runs on every request, which means it touches Supabase on every
 * request. If the site starts returning 504s, check whether the Supabase
 * project has auto-paused before looking anywhere else.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(
          cookiesToSet: {
            name: string;
            value: string;
            options: CookieOptions;
          }[]
        ) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isLogin = path.startsWith("/login");

  if (!user && !isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  if (user && isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Managers and admins start on the manager home. "Rep view" (?view=rep)
  // sets a cookie for this browser session so they can look around the rep
  // side; going back into /admin clears it.
  const REP_VIEW = "vn_repview";
  if (user && (path === "/" || path === "/proedgesolutions")) {
    if (request.nextUrl.searchParams.get("view") === "rep") {
      response.cookies.set(REP_VIEW, "1", { path: "/", sameSite: "lax" });
      return response;
    }
    if (!request.cookies.get(REP_VIEW)) {
      const { data: profile } = await supabase.from("profiles").select("role, active").eq("id", user.id).single();
      if (profile?.active && ["admin", "manager"].includes(profile.role)) {
        // Separate query: a temporary password still goes to the rep home, which sends them to change it.
        const { data: pw } = await supabase.from("profiles").select("must_change_password").eq("id", user.id).maybeSingle();
        if (!(pw as { must_change_password?: boolean } | null)?.must_change_password) {
          const url = request.nextUrl.clone();
          url.pathname = "/admin/home";
          url.search = "";
          const redirect = NextResponse.redirect(url);
          response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
          return redirect;
        }
      }
    }
  }

  if (user && path.startsWith("/admin") && request.cookies.get(REP_VIEW)) response.cookies.delete(REP_VIEW);

  if (user && path.startsWith("/admin")) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, active")
      .eq("id", user.id)
      .single();

    if (!profile?.active || !["admin", "manager"].includes(profile.role)) {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  return response;
}
