"use client";

import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TRANSCRIBE_USD_PER_HOUR } from "@/lib/calls";

/*
  Spending for managers: what paid actions cost, today and this month,
  against the limits set on the Spending page. Estimates come from what the
  same action actually cost recently, so they sharpen as the app is used.
  "Today" and "this month" are in the viewer's own time zone.
*/

export type SpendKind = "transcribe" | "grade" | "translate" | "roleplay" | "review" | "card_draft" | "dropbox" | "lessons" | "coaching" | "archetypes" | "compare" | "voicemail" | "quickread" | "rules";

export const SPEND_LABEL: Record<string, string> = {
  transcribe: "Call transcription",
  grade: "Call grading",
  translate: "Spanish translation",
  roleplay: "Practice calls (voice)",
  review: "Coaching reviews",
  card_draft: "Card drafts",
  dropbox: "Drop box sorting",
  lessons: "Insights drafts",
  coaching: "One-on-one notes",
  archetypes: "Client archetypes",
  compare: "Call comparisons",
  voicemail: "Voicemail scores",
  quickread: "Short-call reads",
  rules: "Grading rules from corrections",
};

/** Used until there's history to average. Rough list-price guesses. */
const FALLBACK: Record<string, number> = {
  grade: 0.08,
  translate: 0.03,
  review: 0.12,
  card_draft: 0.03,
  dropbox: 0.05,
  lessons: 0.15,
  coaching: 0.005,
  archetypes: 0.25,
  compare: 0.05,
  voicemail: 0.005,
  quickread: 0.01,
  rules: 0.06,
};

export type SpendRow = { at: string; kind: string; usd: number; user_id: string | null; ref_id: string | null };
export type Budgets = { daily: number | null; monthly: number | null };
export type SpendSummary = {
  today: number;
  month: number;
  budgets: Budgets;
  byKind: { kind: string; usd: number; n: number }[]; // this month
  daily: { day: string; usd: number }[]; // last 30 days, oldest first
  rows: SpendRow[];
};

const pad = (n: number) => String(n).padStart(2, "0");
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function usd(n: number | null | undefined, exact = false): string {
  if (n === null || n === undefined) return "--";
  if (!exact && n > 0 && n < 0.01) return "<$0.01";
  return `$${n.toFixed(n >= 100 ? 0 : 2)}`;
}

export async function loadSpend(supabase: SupabaseClient): Promise<{ summary: SpendSummary | null; error: string }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { summary: null, error: "" };
  const { data: me } = await supabase.from("profiles").select("org_id").eq("id", session.user.id).single();
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const thirty = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
  const since = monthStart < thirty ? monthStart : thirty;
  const [{ data: org }, { data, error }] = await Promise.all([
    supabase.from("orgs").select("budget_daily_usd, budget_monthly_usd").eq("id", me?.org_id ?? "").maybeSingle(),
    supabase.from("spend_log").select("at, kind, usd, user_id, ref_id").gte("at", since.toISOString()).order("at", { ascending: false }).limit(20000),
  ]);
  if (error) return { summary: null, error: /spend_log|does not exist/i.test(error.message) ? "Run supabase/spend.sql to turn on spending." : error.message };
  const rows = ((data || []) as SpendRow[]).map((r) => ({ ...r, usd: Number(r.usd) }));
  const todayKey = dayKey(now);
  const inMonth = rows.filter((r) => new Date(r.at) >= monthStart);
  const kinds = new Map<string, { usd: number; n: number }>();
  for (const r of inMonth) {
    const k = kinds.get(r.kind) ?? { usd: 0, n: 0 };
    k.usd += r.usd;
    k.n++;
    kinds.set(r.kind, k);
  }
  const daily: { day: string; usd: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    daily.push({ day: dayKey(d), usd: 0 });
  }
  const idx = new Map(daily.map((d, i) => [d.day, i]));
  for (const r of rows) {
    const i = idx.get(dayKey(new Date(r.at)));
    if (i !== undefined) daily[i].usd += r.usd;
  }
  const o = org as { budget_daily_usd: number | null; budget_monthly_usd: number | null } | null;
  return {
    error: "",
    summary: {
      today: rows.filter((r) => dayKey(new Date(r.at)) === todayKey).reduce((s, r) => s + r.usd, 0),
      month: inMonth.reduce((s, r) => s + r.usd, 0),
      budgets: { daily: o?.budget_daily_usd != null ? Number(o.budget_daily_usd) : null, monthly: o?.budget_monthly_usd != null ? Number(o.budget_monthly_usd) : null },
      byKind: [...kinds].map(([kind, v]) => ({ kind, ...v })).sort((a, b) => b.usd - a.usd),
      daily,
      rows,
    },
  };
}

/** Average of the last 20 times this action ran; a list-price guess until then. */
export async function estimateFor(supabase: SupabaseClient, kind: SpendKind): Promise<number> {
  const { data } = await supabase.from("spend_log").select("usd").eq("kind", kind).order("at", { ascending: false }).limit(20);
  const xs = (data || []).map((r) => Number(r.usd)).filter((x) => x > 0);
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : FALLBACK[kind] ?? 0.05;
}

/** Transcription is priced by the minute, exactly; grading from recent averages. */
export function transcribeEstimate(seconds: number): number {
  return (seconds / 3600) * TRANSCRIBE_USD_PER_HOUR;
}

/**
 * Before a paid action: if it would push today or this month past a limit,
 * ask first. Returns false to stop. With no limits set, it never asks.
 */
export async function okToSpend(supabase: SupabaseClient, estimate: number, what: string): Promise<boolean> {
  const { summary } = await loadSpend(supabase);
  if (!summary) return true;
  const { daily, monthly } = summary.budgets;
  const lines: string[] = [];
  if (daily != null && summary.today + estimate > daily)
    lines.push(`Today: ${usd(summary.today)} spent of your ${usd(daily)} daily limit; this adds about ${usd(estimate)}.`);
  if (monthly != null && summary.month + estimate > monthly)
    lines.push(`This month: ${usd(summary.month)} of your ${usd(monthly)} monthly limit; this adds about ${usd(estimate)}.`);
  if (!lines.length) return true;
  return confirm(`${what} would go over your limit.\n\n${lines.join("\n")}\n\nGo ahead anyway?`);
}

/** An estimate for a button label, loaded once. */
export function useEstimate(supabase: SupabaseClient, kind: SpendKind): number | null {
  const [v, setV] = useState<number | null>(null);
  const load = useCallback(() => estimateFor(supabase, kind).then(setV), [supabase, kind]);
  useEffect(() => {
    void load();
  }, [load]);
  return v;
}
