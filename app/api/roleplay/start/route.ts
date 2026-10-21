import { NextResponse } from "next/server";
import { requireMember, signedUrl, xiKey } from "@/lib/roleplayServer";
import { archetypeText, callModeText, type ArchetypeMix, type Persona, type RoleplayInfo, type RoleplayLang, type RoleplayMode } from "@/lib/roleplay";

export const runtime = "nodejs";

/**
 * Starts a practice call: checks the switch, files the call, and hands the
 * browser a one-time link to the mock client's voice agent.
 * Body: { personaId, lang: "en" | "es" }.
 */
export async function POST(request: Request) {
  const ctx = await requireMember(request);
  if (ctx instanceof NextResponse) return ctx;
  const { supabase, userId, orgId } = ctx;

  if (!xiKey()) {
    return NextResponse.json({ error: "Practice calls are not set up on the server yet (no ElevenLabs key)." }, { status: 500 });
  }

  const body = (await request.json().catch(() => ({}))) as { personaId?: string; lang?: string; mode?: string };
  const mode: RoleplayMode = body.mode === "followup" ? "followup" : "first";
  const lang: RoleplayLang = body.lang === "es" ? "es" : "en";
  if (!body.personaId) return NextResponse.json({ error: "Pick a client first." }, { status: 400 });

  // The switch is enforced here, not just by hiding the button, so a stale
  // tab cannot keep spending after a manager turns it off.
  const { data: org } = await supabase.from("orgs").select("roleplay_enabled").eq("id", orgId).single();
  if (!org?.roleplay_enabled) {
    return NextResponse.json({ error: "Practice calls are switched off." }, { status: 403 });
  }

  const { data: personaRow, error } = await supabase
    .from("roleplay_personas")
    .select("*")
    .eq("id", body.personaId)
    .single();
  const persona = personaRow as Persona | null;
  if (error || !persona || !persona.active) {
    return NextResponse.json({ error: "That client is not available." }, { status: 404 });
  }

  const agentId = lang === "es" ? persona.agent_es : persona.agent_en;
  if (!agentId) {
    return NextResponse.json(
      { error: "This client's voice is not set up yet. Ask a manager to press \"Sync voice agents\" on the Practice calls page." },
      { status: 409 }
    );
  }

  // A follow-up picks up from this rep's last practice call with this client, if there was one.
  let previous: string | null = null;
  if (mode === "followup") {
    const { data: last } = await supabase
      .from("calls")
      .select("grade, created_at")
      .eq("rep_id", userId)
      .eq("persona_id", persona.id)
      .eq("source", "roleplay")
      .eq("status", "graded")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const g = last?.grade as { summary?: string; furthest_point?: string } | null;
    if (g?.summary) previous = `${g.summary} It ended: ${g.furthest_point ?? "without a decision"}.`;
  }

  // Today's client type: one of the approved archetypes, picked at random (the common ones more often).
  // Read with the server key -- the archetypes are managers-only -- and never shown on the rep's screen.
  let mix: ArchetypeMix | null = null;
  try {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (key && base) {
      const q = new URLSearchParams({ select: "body", org_id: `eq.${orgId}`, status: "eq.approved", order: "approved_at.desc", limit: "1" });
      const r = await fetch(`${base}/rest/v1/client_archetypes?${q}`, { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: "no-store", signal: AbortSignal.timeout(8_000) });
      const rows = r.ok ? ((await r.json()) as { body: { archetypes?: (ArchetypeMix & { clients?: number })[] } }[]) : [];
      const list = rows[0]?.body?.archetypes ?? [];
      const total = list.reduce((a, x) => a + Math.max(1, Number(x.clients) || 1), 0);
      let pick = Math.random() * total;
      for (const a of list) {
        pick -= Math.max(1, Number(a.clients) || 1);
        if (pick <= 0) {
          mix = a;
          break;
        }
      }
    }
  } catch {
    mix = null;
  }
  const clientType = archetypeText(mix);

  const info: RoleplayInfo = {
    mode,
    previous,
    persona: persona.name,
    persona_title: persona.title,
    lang,
    agent_id: agentId,
    conversation_id: null,
    started_at: new Date().toISOString(),
    archetype: mix ? { name: mix.name, text: clientType } : null,
  };

  const { data: call, error: insErr } = await supabase
    .from("calls")
    .insert({
      org_id: orgId,
      uploaded_by: userId,
      rep_id: userId,
      source: "roleplay",
      persona_id: persona.id,
      script_id: persona.script_id,
      client_label: `Practice: ${persona.name}`,
      call_date: new Date().toISOString().slice(0, 10),
      status: "live",
      roleplay: info,
    })
    .select("id")
    .single();
  if (insErr || !call) {
    return NextResponse.json({ error: `Could not start the call. ${insErr?.message ?? ""}` }, { status: 500 });
  }

  try {
    const url = await signedUrl(agentId);
    return NextResponse.json({ callId: call.id, signedUrl: url, info: { ...info, archetype: null }, dynamicVariables: { call_mode: callModeText(mode, previous), client_type: clientType } });
  } catch (e) {
    await supabase.from("calls").delete().eq("id", call.id);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
