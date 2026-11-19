import { NextResponse } from "next/server";

/*
  A manager adds a new rep to their own team; an admin adds anyone (as a rep,
  on any team -- jobs are changed afterwards on People & access).

  Edge runtime and plain fetch, like set-password: Auth calls hang from our
  Node functions. The new person signs in with the temporary password and is
  asked to choose their own. The service key never leaves the server.
*/

export const runtime = "edge";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const TEAMS = ["closers", "ams", "openers"];

function subject(token: string): string | null {
  try {
    const part = token.split(".")[1];
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "="));
    return (JSON.parse(json) as { sub?: string }).sub || null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!service) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY isn't set in Vercel." }, { status: 500 });

  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const me = token && subject(token);
  if (!me) return NextResponse.json({ error: "Sign in again." }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { email?: string; name?: string; password?: string; team?: string };
  const email = String(body.email || "").trim().toLowerCase();
  const name = String(body.name || "").trim();
  const password = String(body.password || "");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
  if (!name) return NextResponse.json({ error: "Enter their full name." }, { status: 400 });
  if (password.length < 8) return NextResponse.json({ error: "Use a temporary password of at least 8 characters." }, { status: 400 });

  // Who's asking -- read with their own token.
  const r = await fetch(`${URL_}/rest/v1/profiles?id=eq.${me}&select=id,role,team,active,org_id`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } });
  const caller = r.ok ? ((await r.json()) as { role: string; team: string | null; active: boolean; org_id: string | null }[])[0] : null;
  if (!caller || !caller.active || !caller.org_id || !["admin", "manager"].includes(caller.role))
    return NextResponse.json({ error: "Managers and admins only." }, { status: 403 });

  // A manager's new rep joins the manager's own team; an admin picks.
  const team = caller.role === "admin" ? (TEAMS.includes(String(body.team)) ? String(body.team) : null) : caller.team || "closers";

  const res = await fetch(`${URL_}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: service, Authorization: `Bearer ${service}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: name, org_id: caller.org_id, role: "rep" } }),
  });
  const out = (await res.json().catch(() => ({}))) as { id?: string; msg?: string; message?: string; error_description?: string; error?: string };
  if (!res.ok || !out.id) {
    const m = out.msg || out.message || out.error_description || out.error || `Failed (${res.status})`;
    return NextResponse.json({ error: /already|registered|exists/i.test(m) ? "Someone already has an account with that email." : `Couldn't add them: ${m}` }, { status: 400 });
  }

  // The sign-up trigger made their profile; set the rest.
  await fetch(`${URL_}/rest/v1/profiles?id=eq.${out.id}`, {
    method: "PATCH",
    headers: { apikey: service, Authorization: `Bearer ${service}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ full_name: name, org_id: caller.org_id, role: "rep", team, active: true, must_change_password: true }),
  });

  return NextResponse.json({ ok: true, id: out.id, team });
}
