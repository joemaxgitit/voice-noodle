"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { realVoice, type ClientInsight } from "@/lib/learn";
import { createClient } from "@/lib/supabase/client";
import { clock, money, scoreBand, OUTCOME_LABEL, type Grade, type Outcome } from "@/lib/calls";
import {
  agentHash,
  agentSpecs,
  patienceOf,
  DIFFICULTY_LABEL,
  RIGHT_OUTCOME_LABEL,
  ROLEPLAY_LLMS,
  verdictOf,
  type Difficulty,
  type Lead,
  type Persona,
  type PersonaSecret,
  type RightOutcome,
  type RoleplayInfo,
} from "@/lib/roleplay";
import "../calls/calls.css";
import "../../roleplay/roleplay.css";

type Org = { id: string; roleplay_enabled: boolean; roleplay_llm: string; roleplay_max_minutes: number };
type SecretRow = PersonaSecret & { persona_id: string };
type Voice = { id: string; name: string; about: string };
type PracticeRow = {
  id: string;
  created_at: string;
  status: string;
  score: number | null;
  slp_score: number | null;
  outcome: string | null;
  duration_secs: number | null;
  persona_id: string | null;
  roleplay: RoleplayInfo | null;
  close_quality: string | null;
  profiles: { full_name: string | null } | null;
};
type Tab = "clients" | "settings" | "calls";
const TABS: { id: Tab; label: string }[] = [
  { id: "clients", label: "Clients" },
  { id: "settings", label: "Settings & voices" },
  { id: "calls", label: "Practice calls" },
];
const TAB_KEY = "vn-practice-tab";

type SyncResult = { id: string; name: string; ok: boolean; skipped?: boolean; error?: string };

type Draft = {
  id: string | null;
  slug: string;
  name: string;
  title: string;
  difficulty: Difficulty;
  script_id: string;
  voice_id: string;
  first_message_en: string;
  first_message_es: string;
  active: boolean;
  sort_order: number;
  // lead card
  age: string;
  state: string;
  source: string;
  requested: string;
  purpose: string;
  credit_score: string;
  notes: string;
  loan_approved: boolean;
  loan_text: string;
  accounts: string; // one per line: Creditor | Type | Balance | Status
  // hidden
  backstory: string;
  product: number;
  rep: number;
  company: number;
  pain: number;
  patience: number;
  right_outcome: RightOutcome;
  right_outcome_note: string;
};

const num = (s: string) => {
  const n = Number(String(s).replace(/[$,\s]/g, ""));
  return isFinite(n) && n > 0 ? n : undefined;
};

function toDraft(p: Persona | null, s: PersonaSecret | null, nextSort: number): Draft {
  const l: Lead = p?.lead || {};
  return {
    id: p?.id ?? null,
    slug: p?.slug ?? "",
    name: p?.name ?? "",
    title: p?.title ?? "",
    difficulty: p?.difficulty ?? "medium",
    script_id: p?.script_id ?? "",
    voice_id: p?.voice_id ?? "",
    first_message_en: p?.first_message_en ?? "Hello?",
    first_message_es: p?.first_message_es ?? "¿Bueno?",
    active: p?.active ?? true,
    sort_order: p?.sort_order ?? nextSort,
    age: l.age ? String(l.age) : "",
    state: l.state ?? "",
    source: l.source ?? "Online loan application",
    requested: l.requested ? String(l.requested) : "",
    purpose: l.purpose ?? "Debt consolidation",
    credit_score: l.credit_score ? String(l.credit_score) : "",
    notes: l.notes ?? "",
    loan_approved: !!l.loan?.approved,
    loan_text: l.loan?.text ?? "Declined -- debt-to-income too high.",
    accounts: (l.accounts || []).map((a) => [a.creditor, a.type, a.balance, a.status].join(" | ")).join("\n"),
    backstory: s?.backstory ?? "",
    product: s?.tens.product ?? 5,
    rep: s?.tens.rep ?? 5,
    company: s?.tens.company ?? 5,
    pain: s?.tens.pain ?? 6,
    patience: s?.patience ?? patienceOf({ difficulty: p?.difficulty ?? "medium" }, { patience: null }),
    right_outcome: s?.right_outcome ?? "enrolled",
    right_outcome_note: s?.right_outcome_note ?? "",
  };
}

function leadOf(d: Draft): Lead {
  return {
    age: num(d.age),
    state: d.state.trim() || undefined,
    source: d.source.trim() || undefined,
    requested: num(d.requested),
    purpose: d.purpose.trim() || undefined,
    credit_score: num(d.credit_score),
    notes: d.notes.trim() || undefined,
    loan: { approved: d.loan_approved, text: d.loan_text.trim() },
    accounts: d.accounts
      .split("\n")
      .map((line) => line.split("|").map((x) => x.trim()))
      .filter((x) => x[0])
      .map(([creditor, type, balance, status]) => ({
        creditor,
        type: type || "Credit card",
        balance: num(balance || "") ?? 0,
        status: status || "Current",
      })),
  };
}

const slugOf = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || `client-${Date.now()}`;

/**
 * Practice calls, for managers: the on/off switch, the mock clients and
 * their hidden sides, and every rep's practice calls.
 */
export default function RoleplayAdmin() {
  const supabase = useMemo(() => createClient(), []);

  const [org, setOrg] = useState<Org | null>(null);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [secrets, setSecrets] = useState<Map<string, PersonaSecret>>(new Map());
  const [scripts, setScripts] = useState<{ id: string; title: string }[]>([]);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voiceError, setVoiceError] = useState("");
  const [calls, setCalls] = useState<PracticeRow[]>([]);
  const [insights, setInsights] = useState<ClientInsight[] | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResults, setSyncResults] = useState<SyncResult[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [tab, setTabState] = useState<Tab>("clients");
  const draftStart = useRef("");

  // Remember the last tab, per browser.
  useEffect(() => {
    try {
      const t = localStorage.getItem(TAB_KEY) as Tab | null;
      if (t && TABS.some((x) => x.id === t)) setTabState(t);
    } catch {
      // storage blocked; default tab is fine
    }
  }, []);
  function setTab(t: Tab) {
    setTabState(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      // ignore
    }
  }

  // The editor opens in a side panel. Opening remembers where it started,
  // so closing with unsaved changes can ask first.
  function openEditor(d: Draft) {
    draftStart.current = JSON.stringify(d);
    setError("");
    setDraft(d);
  }
  function closeEditor() {
    if (draft && JSON.stringify(draft) !== draftStart.current && !confirm("Discard your changes to this client?")) return;
    setDraft(null);
  }

  // While the panel is open: Escape closes it, and the page behind stays put.
  useEffect(() => {
    if (!draft) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeEditor();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  async function token() {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token ?? "";
  }

  const load = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) return;
    const { data: me } = await supabase.from("profiles").select("org_id").eq("id", session.user.id).single();

    const [o, p, s, sc, c] = await Promise.all([
      supabase
        .from("orgs")
        .select("id, roleplay_enabled, roleplay_llm, roleplay_max_minutes")
        .eq("id", me?.org_id ?? "")
        .single(),
      supabase.from("roleplay_personas").select("*").order("sort_order"),
      supabase.from("roleplay_persona_secrets").select("*"),
      supabase.from("scripts").select("id, title").eq("active", true).order("sort_order"),
      supabase
        .from("calls")
        .select(
          "id, created_at, status, score, slp_score, outcome, duration_secs, persona_id, roleplay, close_quality:grade->>close_quality, profiles:rep_id(full_name)"
        )
        .eq("source", "roleplay")
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    const failed = o.error || p.error;
    if (failed) {
      setError(
        /roleplay|column|relation/i.test(failed.message)
          ? `${failed.message} -- run supabase/roleplay.sql in the Supabase SQL Editor first.`
          : failed.message
      );
    }
    setOrg((o.data as Org) ?? null);
    setPersonas((p.data || []) as Persona[]);
    setSecrets(new Map(((s.data || []) as SecretRow[]).map((x) => [x.persona_id, x])));
    setScripts(sc.data || []);
    setCalls((c.data || []) as unknown as PracticeRow[]);
    // The real-call library (separate, so the page works before its table exists).
    const ins = await supabase.from("client_insights").select("id, call_id, lang, kind, outcome, objections, moments, ending, used_in, created_at").order("created_at", { ascending: false }).limit(400);
    setInsights(ins.error ? null : ((ins.data || []) as ClientInsight[]));
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  // The account's voices, for the voice picker.
  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/roleplay/voices", { headers: { Authorization: `Bearer ${await token()}` } }).catch(
        () => null
      );
      const b = res ? await res.json().catch(() => ({})) : {};
      if (res?.ok) setVoices(b.voices || []);
      else setVoiceError(b?.error || "Could not list ElevenLabs voices.");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function setOrgField(patch: Partial<Org>) {
    if (!org) return;
    setError("");
    const { error } = await supabase.from("orgs").update(patch).eq("id", org.id);
    if (error) {
      setError(error.message);
      return;
    }
    // Read back: an update blocked by row-level security silently matches nothing.
    const { data } = await supabase
      .from("orgs")
      .select("id, roleplay_enabled, roleplay_llm, roleplay_max_minutes")
      .eq("id", org.id)
      .single();
    const saved = data as Org | null;
    if (saved && Object.entries(patch).every(([k, v]) => saved[k as keyof Org] === v)) setOrg(saved);
    else setError("That did not save. You may not have permission to change it.");
  }

  async function sync(personaId?: string, force = false) {
    setSyncing(true);
    setError("");
    setSyncResults([]);
    const res = await fetch("/api/roleplay/sync", {
      method: "POST",
      headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ personaId, force }),
    }).catch(() => null);
    const b = res ? await res.json().catch(() => ({})) : {};
    if (!res?.ok) setError(b?.error || "Sync failed.");
    else setSyncResults(b.results || []);
    setSyncing(false);
    await load();
  }

  async function save() {
    if (!draft || !org) return;
    if (!draft.name.trim() || !draft.title.trim()) return setError("Give the client a name and a title.");
    if (!draft.backstory.trim()) return setError("The hidden backstory is what makes the client real -- add one.");
    setSaving(true);
    setError("");
    setNotice("");

    const row = {
      org_id: org.id,
      slug: draft.slug || slugOf(draft.title),
      name: draft.name.trim(),
      title: draft.title.trim(),
      difficulty: draft.difficulty,
      script_id: draft.script_id || null,
      voice_id: draft.voice_id.trim() || null,
      first_message_en: draft.first_message_en.trim() || "Hello?",
      first_message_es: draft.first_message_es.trim() || "¿Bueno?",
      active: draft.active,
      sort_order: draft.sort_order,
      lead: leadOf(draft),
      updated_at: new Date().toISOString(),
    };
    const q = draft.id
      ? supabase.from("roleplay_personas").update(row).eq("id", draft.id).select("id").single()
      : supabase.from("roleplay_personas").insert(row).select("id").single();
    const { data: saved, error: pErr } = await q;
    if (pErr || !saved) {
      setSaving(false);
      return setError(pErr?.message || "Could not save.");
    }

    const clamp = (n: number) => Math.max(1, Math.min(10, Math.round(Number(n) || 5)));
    const { error: sErr } = await supabase.from("roleplay_persona_secrets").upsert({
      persona_id: saved.id,
      org_id: org.id,
      backstory: draft.backstory.trim(),
      tens: { product: clamp(draft.product), rep: clamp(draft.rep), company: clamp(draft.company), pain: clamp(draft.pain) },
      right_outcome: draft.right_outcome,
      right_outcome_note: draft.right_outcome_note.trim() || null,
      patience: clamp(draft.patience),
      updated_at: new Date().toISOString(),
    });
    setSaving(false);
    if (sErr) return setError(sErr.message);

    setDraft(null);
    setNotice(`Saved ${row.name}. Updating the voice agent...`);
    await sync(saved.id);
    setNotice("");
  }

  async function remove(p: Persona) {
    if (!confirm(`Delete ${p.name} (${p.title})? Past practice calls with them are kept.`)) return;
    const { error } = await supabase.from("roleplay_personas").delete().eq("id", p.id);
    if (error) setError(error.message);
    setDraft(null);
    load();
  }

  // Real-call wording for the practice clients; changes once a week.
  const real = useMemo(() => (insights && insights.length ? { en: realVoice(insights, "en"), es: realVoice(insights, "es") } : null), [insights]);

  // When only the weekly real-call wording has moved on, bring the voices up to date by themselves.
  const autoSynced = useRef(false);
  useEffect(() => {
    if (autoSynced.current || loading || syncing || !real) return;
    const due = personas.filter((p) => p.active && stale.get(p.id) === "stale");
    if (!due.length) return;
    autoSynced.current = true;
    void sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [real, personas, loading]);

  async function suggest() {
    setSuggesting(true);
    setError("");
    setNotice("");
    const res = await fetch("/api/roleplay/suggest", { method: "POST", headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" }, body: "{}" }).catch(() => null);
    const b = res ? await res.json().catch(() => ({})) : {};
    setSuggesting(false);
    if (!res?.ok) return setError(b?.error || "Could not draft new clients.");
    setNotice(b.made ? `Drafted ${b.made} new practice client${b.made === 1 ? "" : "s"} from real calls. They're hidden until you check them and switch them on.` : "Nothing new to draft yet.");
    await load();
  }

  // Which voice agents no longer match what's saved.
  const stale = useMemo(() => {
    const out = new Map<string, "ready" | "stale" | "missing" | "no-secret">();
    for (const p of personas) {
      const s = secrets.get(p.id);
      if (!s) out.set(p.id, "no-secret");
      else if (!p.agent_en || !p.agent_es) out.set(p.id, "missing");
      else if (org && agentHash(agentSpecs(p, s, org.roleplay_llm, org.roleplay_max_minutes, real)) !== p.agent_hash)
        out.set(p.id, "stale");
      else out.set(p.id, "ready");
    }
    return out;
  }, [personas, secrets, org, real]);

  const needSync = personas.filter((p) => p.active && stale.get(p.id) !== "ready").length;
  const voiceName = (id: string | null) => voices.find((v) => v.id === id)?.name || (id ? "Custom voice" : "Default voice");

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthCalls = calls.filter((c) => new Date(c.created_at) >= monthStart);
  const monthUsd = monthCalls.reduce((sum, c) => sum + (c.roleplay?.usd || 0), 0);

  if (loading) {
    return (
      <main className="shell rp-shell">
        <p className="muted">Loading&hellip;</p>
      </main>
    );
  }

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));

  return (
    <main className="shell rp-shell">

      <div className="eyebrow">Training</div>
      <h1>Practice calls</h1>
      <p className="muted" style={{ maxWidth: "66ch", marginBottom: 10 }}>
        Reps call an AI client by voice and the call is graded exactly like a real one. Each client hides a real situation
        the rep has to uncover, and has a right result -- including some who should not be closed.
      </p>
      {org && (
        <div className="rp-status">
          <span className={`pill ${org.roleplay_enabled ? "good" : ""}`}>{org.roleplay_enabled ? "On for reps" : "Off"}</span>
          <span>
            {personas.filter((p) => p.active).length} active client{personas.filter((p) => p.active).length === 1 ? "" : "s"}
          </span>
          {needSync > 0 && <span style={{ color: "var(--live)" }}>{needSync} need{needSync === 1 ? "s" : ""} a voice sync</span>}
          <span>
            {monthCalls.length} practice call{monthCalls.length === 1 ? "" : "s"} this month
          </span>
        </div>
      )}

      <nav className="rp-tabs" role="tablist" aria-label="Practice sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? "active" : ""}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === "settings" && needSync > 0 && <span className="rp-tab-dot" aria-label="needs attention" />}
            {t.id === "calls" && calls.length > 0 && <span className="rp-tab-count">{calls.length}</span>}
          </button>
        ))}
      </nav>

      {error && !draft && <div className="error">{error}</div>}
      {notice && <div className="note">{notice}</div>}

      {org && tab === "settings" && (
        <>
          <div className="practice-switch">
            <div>
              <div className="label">Practice calls</div>
              <div className="hint" style={{ margin: 0 }}>
                {org.roleplay_enabled
                  ? `Reps see a "Practice call" button. Each call costs about $0.10 a minute plus about $0.15 to grade.`
                  : "Hidden from reps, and blocked on the server. Nothing is spent while it's off."}
              </div>
            </div>
            <div className="unit-switch" role="group" aria-label="Practice calls">
              <button aria-pressed={!org.roleplay_enabled} onClick={() => setOrgField({ roleplay_enabled: false })}>
                Off
              </button>
              <button aria-pressed={org.roleplay_enabled} onClick={() => setOrgField({ roleplay_enabled: true })}>
                On
              </button>
            </div>
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <div className="row" style={{ gap: 16, alignItems: "flex-end" }}>
              <label className="field" style={{ margin: 0, minWidth: 260 }}>
                <span>AI playing the clients</span>
                <select value={org.roleplay_llm} onChange={(e) => setOrgField({ roleplay_llm: e.target.value })}>
                  {ROLEPLAY_LLMS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                  {!ROLEPLAY_LLMS.some((m) => m.id === org.roleplay_llm) && (
                    <option value={org.roleplay_llm}>{org.roleplay_llm}</option>
                  )}
                </select>
              </label>
              <label className="field" style={{ margin: 0, width: 150 }}>
                <span>Longest call (min)</span>
                <input
                  type="number"
                  min={5}
                  max={120}
                  defaultValue={org.roleplay_max_minutes}
                  onBlur={(e) => {
                    const v = Math.max(5, Math.min(120, Number(e.target.value) || 45));
                    if (v !== org.roleplay_max_minutes) setOrgField({ roleplay_max_minutes: v });
                  }}
                />
              </label>
              <button className={needSync ? "primary" : ""} onClick={() => sync()} disabled={syncing}>
                {syncing ? "Syncing voice agents..." : "Sync voice agents"}
              </button>
              <span className="hint" style={{ margin: 0 }}>
                {needSync ? `${needSync} client${needSync === 1 ? "" : "s"} to set up or update.` : "All voice agents are up to date."}
              </span>
            </div>
            {syncResults.some((r) => !r.ok) && (
              <div className="error" style={{ marginTop: 12 }}>
                {syncResults
                  .filter((r) => !r.ok)
                  .map((r) => (
                    <div key={r.id}>
                      <b>{r.name}:</b> {r.error}
                    </div>
                  ))}
              </div>
            )}
            {syncResults.length > 0 && syncResults.every((r) => r.ok) && (
              <div className="hint" style={{ margin: "12px 0 0", color: "var(--ok)" }}>
                Voice agents ready: {syncResults.map((r) => r.name).join(", ")}.
              </div>
            )}
          </div>
        </>
      )}

      {/* ---------- clients ---------- */}
      {tab === "clients" && (
      <div className="rp-section">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>Clients</h2>
          <button onClick={() => openEditor(toDraft(null, null, (personas.at(-1)?.sort_order ?? 0) + 10))}>
            Add a client
          </button>
        </div>

        {insights && (() => {
          const full = insights.filter((i) => i.kind === "full");
          const es = full.filter((i) => i.lang === "es").length;
          const fresh = full.filter((i) => !i.used_in).length;
          const lines = (real?.en.lines.length ?? 0) + (real?.es.lines.length ?? 0);
          return (
            <div className="rp-banner" style={{ alignItems: "flex-start" }}>
              <span>
                <b>Learning from real calls:</b> {full.length} full call{full.length === 1 ? "" : "s"}
                {es ? ` (${es} in Spanish)` : ""} and {insights.filter((i) => i.kind === "short").length} short ones so far. Practice clients use {lines} real objection
                line{lines === 1 ? "" : "s"} and what real clients hung up on, refreshed every Monday.
                {fresh >= 3 ? ` ${fresh} calls haven't been used for a new client yet.` : ""}
              </span>
              {fresh >= 3 && (
                <button onClick={() => void suggest()} disabled={suggesting}>
                  {suggesting ? "Drafting…" : "Draft new clients from real calls · about $0.10"}
                </button>
              )}
            </div>
          );
        })()}
        {needSync > 0 && (
          <div className="rp-banner">
            <span>
              {needSync} client{needSync === 1 ? "'s voice is" : "s' voices are"} not up to date. Reps can't call a client until its voice is ready.
            </span>
            <button className="primary" onClick={() => sync()} disabled={syncing}>
              {syncing ? "Syncing voice agents..." : "Sync voice agents"}
            </button>
          </div>
        )}
        {syncResults.some((r) => !r.ok) && (
          <div className="error">
            {syncResults
              .filter((r) => !r.ok)
              .map((r) => (
                <div key={r.id}>
                  <b>{r.name}:</b> {r.error}
                </div>
              ))}
          </div>
        )}

        <div className="rp-grid">
          {personas.map((p) => {
            const st = stale.get(p.id);
            const s = secrets.get(p.id);
            return (
              <div key={p.id} className="rp-persona" style={{ opacity: p.active ? 1 : 0.6 }}>
                <div className="row" style={{ gap: 6 }}>
                  <span className={`pill rp-diff ${p.difficulty}`}>{DIFFICULTY_LABEL[p.difficulty]}</span>
                  <span className={`pill ${st === "ready" ? "good" : "fair"}`}>
                    {st === "ready" ? "Voice ready" : st === "stale" ? "Needs sync" : st === "no-secret" ? "No backstory" : "Not set up"}
                  </span>
                  {!p.active && <span className="pill">Hidden</span>}
                  {(p as Persona & { origin?: string }).origin === "learned" && <span className="pill tone">From real calls</span>}
                </div>
                <h3>{p.title}</h3>
                <div className="who">
                  {p.name} &middot; {voiceName(p.voice_id)}
                  {p.script_id ? ` · ${scripts.find((x) => x.id === p.script_id)?.title ?? "script"}` : " · no script"}
                </div>
                {s && <div className="facts">Right result: {RIGHT_OUTCOME_LABEL[s.right_outcome]}</div>}
                <div className="row">
                  <button onClick={() => openEditor(toDraft(p, s ?? null, p.sort_order))}>Edit</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      )}

      {/* ---------- practice calls ---------- */}
      {tab === "calls" && (
      <div className="rp-section">
        <h2>Practice calls</h2>
        <p className="hint">
          This month: {monthCalls.length} call{monthCalls.length === 1 ? "" : "s"}, about {money(monthUsd)} in voice time
          (grading is on top, the same as real calls).
        </p>
        {calls.length === 0 ? (
          <p className="muted">No practice calls yet.</p>
        ) : (
          <div className="card" style={{ padding: 0 }}>
            {calls.map((c) => {
              const s = c.persona_id ? secrets.get(c.persona_id) : null;
              const v = s && c.status === "graded" ? verdictOf(s.right_outcome, c.outcome, c.close_quality) : null;
              return (
                <Link key={c.id} href={`/admin/calls/${c.id}`} className="rp-hist-row">
                  <span>
                    <b>{c.profiles?.full_name || "Rep"}</b>
                    <span className="muted">
                      {" "}
                      &middot; {c.roleplay?.persona_title || c.roleplay?.persona} &middot;{" "}
                      {new Date(c.created_at).toLocaleDateString()} &middot; {clock(c.duration_secs) || "--"}
                      {c.roleplay?.lang === "es" ? " · ES" : ""}
                    </span>
                  </span>
                  <span className="row" style={{ gap: 6 }}>
                    {c.outcome && <span className="pill">{OUTCOME_LABEL[c.outcome as Outcome] ?? c.outcome}</span>}
                    {v && (
                      <span className={`pill ${v.ok === true ? "good" : v.ok === false ? "poor" : "fair"}`} title={v.text}>
                        {v.ok === true ? "Right result" : v.ok === false ? "Wrong result" : "Acceptable"}
                      </span>
                    )}
                    {c.status === "graded" ? (
                      <>
                        <span className={`pill ${scoreBand(c.score)}`}>Script {c.score ?? "--"}</span>
                        <span className={`pill ${scoreBand(c.slp_score)}`}>SLP {c.slp_score ?? "--"}</span>
                      </>
                    ) : (
                      <span className={`pill ${c.status === "failed" ? "failed" : "busy"}`}>
                        {c.status === "live" ? "Unfinished" : c.status}
                      </span>
                    )}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
      )}

      {/* ---------- the client editor, in a side panel ---------- */}
      {draft && (
        <>
          <div className="rp-drawer-backdrop" aria-hidden="true" />
          <aside className="rp-drawer" role="dialog" aria-modal="true" aria-label={draft.id ? `Edit ${draft.name}` : "New client"}>
            {editorFor()}
          </aside>
        </>
      )}
    </main>
  );

  // The edit form. Called as a plain function rather than used as a
  // component, so typing doesn't remount it and lose focus.
  function editorFor() {
    if (!draft) return null;
    const d = draft;
    return (
      <>
        <div className="rp-drawer-head">
          <div>
            <div className="eyebrow" style={{ margin: 0 }}>{d.id ? "Edit client" : "New client"}</div>
            <div className="rp-drawer-title">{d.title || d.name || "Untitled client"}</div>
          </div>
          <button className="rp-drawer-x" aria-label="Close" onClick={closeEditor}>
            &times;
          </button>
        </div>
        <div className="rp-drawer-body">
        <label className="row" style={{ gap: 6 }}>
          <input type="checkbox" checked={d.active} onChange={(e) => set("active", e.target.checked)} /> Shown to reps
        </label>

        <div className="rp-form-grid">
          <label className="field">
            <span>Title (what reps see)</span>
            <input value={d.title} onChange={(e) => set("title", e.target.value)} placeholder="The Overwhelmed One" />
          </label>
          <label className="field">
            <span>Client name</span>
            <input value={d.name} onChange={(e) => set("name", e.target.value)} />
          </label>
          <label className="field">
            <span>Difficulty</span>
            <select value={d.difficulty} onChange={(e) => set("difficulty", e.target.value as Difficulty)}>
              {(["easy", "medium", "hard"] as const).map((x) => (
                <option key={x} value={x}>
                  {DIFFICULTY_LABEL[x]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Graded against</span>
            <select value={d.script_id} onChange={(e) => set("script_id", e.target.value)}>
              <option value="">-- pick a script --</option>
              {scripts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Voice</span>
            {voices.length ? (
              <select value={d.voice_id} onChange={(e) => set("voice_id", e.target.value)}>
                <option value="">ElevenLabs default</option>
                {d.voice_id && !voices.some((v) => v.id === d.voice_id) && <option value={d.voice_id}>Custom ({d.voice_id})</option>}
                {voices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                    {v.about ? ` -- ${v.about}` : ""}
                  </option>
                ))}
              </select>
            ) : (
              <input value={d.voice_id} onChange={(e) => set("voice_id", e.target.value)} placeholder="ElevenLabs voice id" />
            )}
          </label>
          <label className="field">
            <span>Answers the phone with (English / Spanish)</span>
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <input value={d.first_message_en} onChange={(e) => set("first_message_en", e.target.value)} />
              <input value={d.first_message_es} onChange={(e) => set("first_message_es", e.target.value)} />
            </div>
          </label>
        </div>
        {voiceError && !voices.length && <div className="hint">{voiceError}</div>}

        <div>
          <div className="label">Lead card -- what the rep sees</div>
          <div className="rp-form-grid">
            <label className="field">
              <span>Age</span>
              <input value={d.age} onChange={(e) => set("age", e.target.value)} />
            </label>
            <label className="field">
              <span>State</span>
              <input value={d.state} onChange={(e) => set("state", e.target.value)} />
            </label>
            <label className="field">
              <span>Lead source</span>
              <input value={d.source} onChange={(e) => set("source", e.target.value)} />
            </label>
            <label className="field">
              <span>Loan requested</span>
              <input value={d.requested} onChange={(e) => set("requested", e.target.value)} />
            </label>
            <label className="field">
              <span>Purpose</span>
              <input value={d.purpose} onChange={(e) => set("purpose", e.target.value)} />
            </label>
            <label className="field">
              <span>Credit score</span>
              <input value={d.credit_score} onChange={(e) => set("credit_score", e.target.value)} />
            </label>
          </div>
          <label className="field">
            <span>Notes on the lead (optional)</span>
            <input value={d.notes} onChange={(e) => set("notes", e.target.value)} />
          </label>
          <label className="field">
            <span>SuperMoney result</span>
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <select
                value={d.loan_approved ? "yes" : "no"}
                onChange={(e) => set("loan_approved", e.target.value === "yes")}
                style={{ width: 140 }}
              >
                <option value="no">Declined</option>
                <option value="yes">Approved</option>
              </select>
              <input value={d.loan_text} onChange={(e) => set("loan_text", e.target.value)} />
            </div>
          </label>
          <label className="field">
            <span>Credit report -- one account per line: Creditor | Type | Balance | Status</span>
            <textarea
              rows={6}
              value={d.accounts}
              onChange={(e) => set("accounts", e.target.value)}
              placeholder={"Discover | Credit card | 7840 | 90 days late"}
              style={{ fontFamily: "var(--mono)", fontSize: 13 }}
            />
          </label>
        </div>

        <div>
          <div className="label">Hidden side -- managers only, never shown to the rep until after the call</div>
          <label className="field">
            <span>Who they are and what they're holding back</span>
            <textarea
              className="prose"
              rows={12}
              value={d.backstory}
              onChange={(e) => set("backstory", e.target.value)}
              placeholder="Age, job, family, how they fell behind, what they'll only say if asked well, what they can really afford, how they react when confused or pushed..."
            />
          </label>
          <div className="rp-form-grid">
            {(["product", "rep", "company", "pain"] as const).map((k) => (
              <label className="field" key={k}>
                <span style={{ textTransform: "capitalize" }}>
                  {k === "pain" ? "Pain" : `${k} certainty`} at the start (1-10)
                </span>
                <input type="number" min={1} max={10} value={d[k]} onChange={(e) => set(k, Number(e.target.value))} />
              </label>
            ))}
            <label className="field">
              <span>Patience (1 hangs up fast, 10 very patient)</span>
              <input type="number" min={1} max={10} value={d.patience} onChange={(e) => set("patience", Number(e.target.value))} />
            </label>
          </div>
          <div className="rp-form-grid">
            <label className="field">
              <span>The right result</span>
              <select value={d.right_outcome} onChange={(e) => set("right_outcome", e.target.value as RightOutcome)}>
                {(Object.keys(RIGHT_OUTCOME_LABEL) as RightOutcome[]).map((k) => (
                  <option key={k} value={k}>
                    {RIGHT_OUTCOME_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="field">
            <span>Why that's the right result (the grader reads this)</span>
            <textarea className="prose" rows={3} value={d.right_outcome_note} onChange={(e) => set("right_outcome_note", e.target.value)} />
          </label>
        </div>

        </div>
        <div className="rp-drawer-foot">
          {error && <div className="error" style={{ margin: "0 0 10px" }}>{error}</div>}
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div className="row">
              <button className="primary" onClick={save} disabled={saving || syncing}>
                {saving ? "Saving..." : "Save"}
              </button>
              <button onClick={closeEditor} disabled={saving}>
                Cancel
              </button>
            </div>
            {d.id && (
              <button className="danger" onClick={() => remove(personas.find((p) => p.id === d.id)!)}>
                Delete client
              </button>
            )}
          </div>
        </div>
      </>
    );
  }
}
