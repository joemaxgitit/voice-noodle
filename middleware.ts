import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  /*
    api is excluded deliberately. Routes under it authenticate themselves,
    and streaming a multipart audio upload through session middleware was
    crashing the alignment call before its handler ever ran.
  */
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp3|m4a|wav)$).*)"],
};
