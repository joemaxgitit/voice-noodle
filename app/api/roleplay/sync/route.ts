import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/callsServer";
import { upsertAgent, xiKey } from "@/lib/roleplayServer";
import { agentHash, agentSpecs, type Persona, type PersonaSecret } from "@/lib/roleplay";
import { realVoice, type ClientInsight } from "@/lib/learn";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Builds (or rebuilds) the ElevenLabs voice agents for the mock clients:
 * one English and one Spanish agent per client. The hidden backstory goes
 * from here straight to ElevenLabs; it never reaches a rep's browser.
 *
 * Skips any client whose agents are already up to date, so pressing it
 * again is cheap. Body: { personaId?: string, force?: boolean }.
 */
export async function POST(request: Request) {
  const ctx = await requireAdmin(request);
  if (ctx instanceof NextResponse) return ctx;
  const { supabase, orgId } = ctx;

  if (!xiKey()) {
    return NextResponse.json({ error: "ELEVENLABS_API_KEY is not set on the server." }, { status: 500 });
  }

  const body = (await request.json().catch(() => ({}))) as { personaId?: string; force?: boolean };

  const { data: org } = await supabase
    .from("orgs")
    .select("roleplay_llm, roleplay_max_minutes")
    .eq("id", orgId)
    .single();
  const llm = (org?.roleplay_llm as string) || "claude-haiku-5-5";

  let q = supabase.from("roleplay_personas").select("*").order("sort_order");
  if (body.personaId) q = q.eq("id", body.personaId);
  const [{ data: personas, error }, { data: secrets }] = await Promise.all([
    q,
    supabase.from("roleplay_persona_secrets").select("*"),
  ]);
  // Real-call wording and hang-up triggers (empty until real calls have been learned from).
  const { data: ins } = await supabase.from("client_insights").select("id, lang, kind, objections, moments, ending, created_at, calls(retention)").order("created_at", { ascending: false }).limit(400);
  const pool = (ins || []) as unknown as ClientInsight[];
  const real = pool.length ? { en: realVoice(pool, "en"), es: realVoice(pool, "es") } : null;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const secretOf = new Map((secrets || []).map((s) => [s.persona_id as string, s as unknown as PersonaSecret]));
  const results: { id: string; name: string; ok: boolean; skipped?: boolean; error?: string }[] = [];

  for (const p of (personas || []) as Persona[]) {
    if (!p.active && !body.personaId) continue;
    const secret = secretOf.get(p.id);
    if (!secret) {
      results.push({ id: p.id, name: p.name, ok: false, error: "No hidden backstory yet -- add one and save." });
      continue;
    }

    const specs = agentSpecs(p, secret, llm, org?.roleplay_max_minutes, real);
    const hash = agentHash(specs);

    if (!body.force && p.agent_hash === hash && p.agent_en && p.agent_es) {
      results.push({ id: p.id, name: p.name, ok: true, skipped: true });
      continue;
    }

    try {
      const agentEn = await upsertAgent(p.agent_en, specs[0]);
      const agentEs = await upsertAgent(p.agent_es, specs[1]);
      const { error: upErr } = await supabase
        .from("roleplay_personas")
        .update({ agent_en: agentEn, agent_es: agentEs, agent_hash: hash, updated_at: new Date().toISOString() })
        .eq("id", p.id);
      if (upErr) throw new Error(upErr.message);
      results.push({ id: p.id, name: p.name, ok: true });
    } catch (e) {
      results.push({ id: p.id, name: p.name, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({ results });
}
