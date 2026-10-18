import { NextResponse } from "next/server";

/*
  A manager sets a temporary password for someone on their team.

  Runs on the edge on purpose: calls to Supabase Auth (/auth/v1) hang from
  our Node functions, while the same calls from the edge work. Everything
  here is plain fetch.

  Rules: admins can reset anyone in their org except themselves; managers
  can reset reps only. The person is asked to choose their own password on
  their next sign-in. The service key never leaves the server.
*/

export const runtime = "edge";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function subject(token: string): string | null {
  try {
    const part = token.split(".")[1];
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "="));
    return (JSON.parse(json) as { sub?: string }).sub || null;
  } catch {
    return null;
  }
}

async function profile(id: string, auth: string) {
  const res = await fetch(`${URL_}/rest/v1/profiles?id=eq.${id}&select=id,role,active,org_id,full_name`, {
    headers: { apikey: ANON, Authorization: auth },
  });
  if (!res.ok) return null;
  const rows = (await res.json()) as { id: string; role: string; active: boolean; org_id: string | null; full_name: string | null }[];
  return rows[0] ?? null;
}

export async function POST(request: Request) {
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!service)
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY isn't set in Vercel yet. Add it under Project > Settings > Environment Variables, then redeploy." },
      { status: 500 }
    );

  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const me = token && subject(token);
  if (!me) return NextResponse.json({ error: "Sign in again." }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { userId?: string; password?: string };
  const userId = String(body.userId || "");
  const password = String(body.password || "");
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return NextResponse.json({ error: "No person chosen." }, { status: 400 });
  if (password.length < 8) return NextResponse.json({ error: "Use at least 8 characters." }, { status: 400 });
  if (userId === me) return NextResponse.json({ error: "Change your own password from Account instead." }, { status: 400 });

  // Who's asking -- read with their own token, so a forged token gets nothing.
  const caller = await profile(me, `Bearer ${token}`);
  if (!caller || !caller.active || !["admin", "manager"].includes(caller.role))
    return NextResponse.json({ error: "Managers and admins only." }, { status: 403 });

  const target = await profile(userId, `Bearer ${service}`);
  if (!target || target.org_id !== caller.org_id) return NextResponse.json({ error: "That person isn't on your team." }, { status: 404 });
  if (caller.role !== "admin" && target.role !== "rep")
    return NextResponse.json({ error: "Managers can reset reps' passwords. Ask an admin for anyone else." }, { status: 403 });

  const res = await fetch(`${URL_}/auth/v1/admin/users/${userId}`, {
    method: "PUT",
    headers: { apikey: service, Authorization: `Bearer ${service}`, "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    let m = msg.slice(0, 300);
    try {
      const j = JSON.parse(msg);
      m = j.msg || j.message || j.error_description || j.error || m;
    } catch {
      // not JSON
    }
    return NextResponse.json({ error: `Couldn't set it: ${m}` }, { status: 502 });
  }

  await fetch(`${URL_}/rest/v1/profiles?id=eq.${userId}`, {
    method: "PATCH",
    headers: { apikey: service, Authorization: `Bearer ${service}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ must_change_password: true }),
  });

  return NextResponse.json({ ok: true, name: target.full_name });
}
