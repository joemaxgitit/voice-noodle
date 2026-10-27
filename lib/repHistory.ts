import type { SupabaseClient } from "@supabase/supabase-js";
import type { Experiment, FingerprintRow } from "@/lib/fingerprint";
import type { Flag, SlpSkill, ThreeTens, ComplianceResult, SectionResult, Spotlights, LineControl } from "@/lib/calls";
import type { KpiReport, KpiRow, MetricPref } from "@/lib/kpi";
import type { CoachingSession } from "@/lib/coaching";

/*
  Everything on record about one rep, for their profile page and for the
  coaching review. Loaded with the caller's own token, so row level security
  decides what comes back -- managers and admins only.
*/

export type HistCall = {
  id: string;
  created_at: string;
  call_date: string | null;
  /** "HH:MM" when known. */
  call_time?: string | null;
  graded_at?: string | null;
  objections?: { items: { at: number; before_pitch: boolean; said: string; handled: string; loop: string; rounds: number }[]; read: string } | null;
  source: string; // 'upload' | 'roleplay'
  persona_id: string | null;
  status: string;
  score: number | null;
  slp_score: number | null;
  outcome: string | null;
  outcome_manual: string | null;
  duration_secs: number | null;
  client_label: string | null;
  summary: string | null;
  slp_summary: string | null;
  slp: SlpSkill[] | null;
  strengths: string[] | null;
  coaching: string[] | null;
  flags: Flag[] | null;
  compliance: ComplianceResult[] | null;
  sections: SectionResult[] | null;
  three_tens: ThreeTens | null;
  tonality: string | null;
  close_quality: string | null;
  spotlights?: Spotlights | null;
  line_control?: LineControl | null;
  /** Practice calls: the client archetype the mock client was played as. */
  archetype?: string | null;
  retention?: string | null;
};

export type RepNote = {
  id: string;
  rep_id: string;
  author_id: string | null;
  tag: "note" | "one_on_one" | "win" | "concern";
  body: string;
  note_date: string;
  private?: boolean;
  created_at: string;
};

export type RepFile = {
  id: string;
  rep_id: string;
  uploaded_by: string | null;
  name: string;
  path: string;
  mime: string | null;
  size_bytes: number | null;
  note: string | null;
  created_at: string;
};

export type ReviewTrend = { title: string; evidence: string; since?: string; action?: string };
export type ReviewBody = {
  trajectory: "improving" | "steady" | "slipping" | "mixed" | "early";
  headline: string;
  arc: string;
  slipping: ReviewTrend[];
  improving: ReviewTrend[];
  focus_next: { skill: string; why: string; drill: string }[];
  kpi_read: string;
  kpi_talking_points: string[];
  compliance_watch: string[];
  questions_to_ask: string[];
  data_gaps: string;
  /** The voice, tone, script and Straight Line view (core mode). Missing on reviews run before it existed. */
  core?: ReviewCore;
};

export type ReviewCore = Pick<ReviewBody, "trajectory" | "headline" | "arc" | "slipping" | "improving" | "focus_next" | "questions_to_ask">;

/** What a manager sees of a review: everything in super mode, the core view otherwise (null if the review predates it). */
export function reviewView(r: ReviewBody | null | undefined, superMode: boolean): (ReviewBody & { coreOnly?: boolean }) | null {
  if (!r) return null;
  if (superMode) return r;
  if (!r.core) return null;
  return { ...r, ...r.core, kpi_read: "", kpi_talking_points: [], compliance_watch: [], data_gaps: "", coreOnly: true };
}

export type RepReview = {
  id: string;
  rep_id: string;
  created_by: string | null;
  status: "working" | "done" | "failed";
  period_from: string | null;
  period_to: string | null;
  focus: string | null;
  inputs: Record<string, number> | null;
  review: ReviewBody | null;
  model: string | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
};

export type QuizAttempt = { material_id: string; score: number; passed: boolean; created_at: string; title?: string };
export type Completion = { material_id: string; completed_at: string; title?: string; kind?: string };
export type AttendanceRow = { week_start: string; day: number; status: string };

export type CardLite = {
  id: string;
  kind: string;
  skill: string;
  status: string;
  sent_at: string | null;
  closed_at: string | null;
  practiced: number;
  rep_response: string | null;
  rep_note: string | null;
  close_note: string | null;
  signed_name: string | null;
};

export type RetentionLite = {
  period_start: string;
  period_end: string;
  deals: number | null;
  before1_rate: number | null;
  prior_rate: number | null;
  pending_share: number | null;
  requests: number | null;
  pos_lost: number;
  pos_reasons: Record<string, number>;
};

export type DailyLite = { day: string; talk_hours: number | null; calls: number | null; deals: number | null; points: number | null; made: boolean; override_made: boolean | null; status?: string };

export type DealClipLite = { day: string; deals: number; ratio: number | null; clip: number; gone: number; total: number };

export type RepHistory = {
  daily: DailyLite[];
  cards: CardLite[];
  sessions: CoachingSession[];
  /** One-on-ones per topic from the old tracker (no dates). */
  earlier: { topic: string; sessions: number }[];
  /** Friday retention lookbacks, newest first (sales side only). */
  retention: RetentionLite[];
  /** Morning Deal Clip snapshots, newest first: month-to-date deals and the month-end projection. */
  dealClips: DealClipLite[];
  /** The rep's own style that works, newest first. */
  fingerprints: FingerprintRow[];
  /** Team patterns this rep is trying, has kept or dropped. */
  experiments: Experiment[];
  /** Script practice: recorded line attempts (pace, clarity, pauses) and lines completed. */
  practice: { attempts: { created_at: string; segment: string; pace: number | null; clarity: number | null; pauses: number | null }[]; linesDone: number; lastDone: string | null };
  calls: HistCall[];
  notes: RepNote[];
  files: RepFile[];
  reviews: RepReview[];
  /** One-day reviews (a bad day's calls against the rep's best call). Kept apart from the overall reviews. */
  dayReviews: RepReview[];
  quizzes: QuizAttempt[];
  completions: Completion[];
  attendance: AttendanceRow[];
  kpiReports: KpiReport[];
  kpiRows: KpiRow[]; // every row of every report, so a rep can be ranked against the team
  prefs: Map<string, MetricPref>;
  personas: Map<string, string>;
};

const CALL_COLS = [
  "id",
  "created_at",
  "call_date",
  "call_time",
  "source",
  "persona_id",
  "status",
  "score",
  "slp_score",
  "outcome",
  "outcome_manual",
  "duration_secs",
  "client_label",
  "summary:grade->>summary",
  "slp_summary:grade->>slp_summary",
  "slp:grade->slp",
  "strengths:grade->strengths",
  "coaching:grade->coaching_priorities",
  "flags:grade->flags",
  "compliance:grade->compliance",
  "sections:grade->sections",
  "three_tens:grade->three_tens",
  "tonality:grade->tonality->>summary",
  "close_quality:grade->>close_quality",
  "spotlights:grade->spotlights",
  "line_control:grade->line_control",
  "archetype:roleplay->archetype->>name",
  "retention",
  "graded_at:grade->>graded_at",
  "objections:grade->objections",
].join(", ");

/** Supabase returns an error for a missing table; treat those as empty so one gap doesn't blank the page. */
function rows<T>(res: { data: unknown; error: { message: string } | null }, errors: string[], what: string): T[] {
  if (res.error) errors.push(`${what}: ${res.error.message}`);
  return (res.data || []) as T[];
}

export async function loadRepHistory(
  supabase: SupabaseClient,
  repId: string,
  opts: { since?: string; callLimit?: number } = {}
): Promise<{ history: RepHistory; errors: string[] }> {
  const errors: string[] = [];
  let callQ = supabase
    .from("calls")
    .select(CALL_COLS)
    .eq("rep_id", repId)
    .order("created_at", { ascending: false })
    .limit(opts.callLimit ?? 300);
  if (opts.since) callQ = callQ.gte("created_at", opts.since);

  const [calls, notes, files, reviews, quizzes, completions, attendance, reports, kpiRows, prefs, personas, mats, cards, sessions, daily] = await Promise.all([
    callQ,
    supabase.from("rep_notes").select("*").eq("rep_id", repId).order("note_date", { ascending: false }).order("created_at", { ascending: false }),
    supabase.from("rep_files").select("*").eq("rep_id", repId).order("created_at", { ascending: false }),
    supabase.from("rep_reviews").select("*").eq("rep_id", repId).order("created_at", { ascending: false }).limit(60),
    supabase.from("training_quiz_attempts").select("material_id, score, passed, created_at").eq("user_id", repId).order("created_at", { ascending: false }),
    supabase.from("training_progress").select("material_id, completed_at").eq("user_id", repId).not("completed_at", "is", null),
    supabase.from("mastery_attendance").select("week_start, day, status").eq("rep_id", repId).order("week_start", { ascending: false }),
    supabase.from("kpi_reports").select("*").order("period_end", { ascending: false }),
    supabase.from("kpi_rows").select("id, report_id, rep_id, salesman, data"),
    supabase.from("kpi_metric_prefs").select("metric_key, better, hidden"),
    supabase.from("roleplay_personas").select("id, name, title"),
    supabase.from("training_materials").select("id, title, kind"),
    supabase
      .from("training_cards")
      .select("id, kind, skill, status, sent_at, closed_at, practiced, rep_response, rep_note, close_note, signed_name")
      .eq("rep_id", repId)
      .in("status", ["sent", "closed"])
      .order("sent_at", { ascending: false }),
    supabase.from("coaching_sessions").select("*").eq("rep_id", repId).order("session_date", { ascending: false }).order("created_at", { ascending: false }),
    supabase
      .from("rep_daily")
      .select("*")
      .eq("rep_id", repId)
      .order("day", { ascending: false })
      .limit(130),
  ]);

  const matById = new Map(rows<{ id: string; title: string; kind: string }>(mats, [], "materials").map((m) => [m.id, m]));
  const history: RepHistory = {
    daily: rows<DailyLite>(daily, [], "daily").filter((d) => d.status !== "absent").map((d) => ({
      ...d,
      talk_hours: d.talk_hours === null ? null : Number(d.talk_hours),
      deals: d.deals === null ? null : Number(d.deals),
      points: d.points === null ? null : Number(d.points),
    })),
    cards: rows<CardLite>(cards, [], "cards"),
    sessions: rows<CoachingSession>(sessions, [], "sessions"),
    earlier: [],
    retention: [],
    dealClips: [],
    fingerprints: [],
    experiments: [],
    practice: { attempts: [], linesDone: 0, lastDone: null },
    calls: rows<HistCall>(calls, errors, "calls"),
    notes: rows<RepNote>(notes, errors, "notes"),
    files: rows<RepFile>(files, errors, "files"),
    reviews: rows<RepReview>(reviews, errors, "reviews").filter((r) => !r.inputs?.day_review).slice(0, 20),
    dayReviews: rows<RepReview>(reviews, [], "reviews").filter((r) => !!r.inputs?.day_review).slice(0, 30),
    quizzes: rows<QuizAttempt>(quizzes, [], "quizzes").map((q) => ({ ...q, title: matById.get(q.material_id)?.title })),
    completions: rows<Completion>(completions, [], "completions").map((c) => ({
      ...c,
      title: matById.get(c.material_id)?.title,
      kind: matById.get(c.material_id)?.kind,
    })),
    attendance: rows<AttendanceRow>(attendance, [], "attendance"),
    kpiReports: rows<KpiReport>(reports, errors, "sales reports"),
    kpiRows: rows<KpiRow>(kpiRows, errors, "sales report rows"),
    prefs: new Map(rows<MetricPref>(prefs, [], "prefs").map((p) => [p.metric_key, p])),
    personas: new Map(rows<{ id: string; name: string; title: string }>(personas, [], "personas").map((p) => [p.id, `${p.name} -- ${p.title}`])),
  };
  // Separate, so a database without this table still loads the profile.
  const fp = await supabase.from("rep_fingerprints").select("id, rep_id, created_at, inputs, body, usd").eq("rep_id", repId).order("created_at", { ascending: false }).limit(10);
  history.fingerprints = (fp.data || []) as FingerprintRow[];
  const ex = await supabase.from("rep_experiments").select("*").eq("rep_id", repId).order("started_at", { ascending: false }).limit(20);
  history.experiments = (ex.data || []) as Experiment[];
  const dc = await supabase.from("deal_clips").select("day, deals, ratio, clip, gone, total").eq("rep_id", repId).order("day", { ascending: false }).limit(120);
  history.dealClips = ((dc.data || []) as DealClipLite[]).map((x) => ({ ...x, deals: Number(x.deals), ratio: x.ratio === null ? null : Number(x.ratio), clip: Number(x.clip) }));
  const eh = await supabase.from("coaching_history").select("topic, sessions").eq("rep_id", repId);
  const rr = await supabase
    .from("retention_reps")
    .select("deals, before1_rate, prior_rate, pending_share, requests, pos_lost, pos_reasons, report:retention_reports(period_start, period_end)")
    .eq("rep_id", repId);
  history.retention = ((rr.data || []) as unknown as (Omit<RetentionLite, "period_start" | "period_end"> & { report: { period_start: string; period_end: string } | null })[])
    .filter((x) => x.report)
    .map(({ report, ...x }) => ({
      ...x,
      period_start: report!.period_start,
      period_end: report!.period_end,
      deals: x.deals === null ? null : Number(x.deals),
      before1_rate: x.before1_rate === null ? null : Number(x.before1_rate),
      prior_rate: x.prior_rate === null ? null : Number(x.prior_rate),
      pending_share: x.pending_share === null ? null : Number(x.pending_share),
    }))
    .sort((a, b) => b.period_end.localeCompare(a.period_end));
  const [at, pg] = await Promise.all([
    supabase.from("attempts").select("created_at, scores, segments(segment_code, title)").eq("user_id", repId).order("created_at", { ascending: false }).limit(500),
    supabase.from("progress").select("updated_at").eq("user_id", repId).eq("completed", true),
  ]);
  type Att = { created_at: string; scores: { pace?: number; clarity?: number; pauses?: number | null } | null; segments: { segment_code: string; title: string | null } | null };
  history.practice = {
    attempts: ((at.data || []) as unknown as Att[]).map((a) => ({
      created_at: a.created_at,
      segment: a.segments ? a.segments.title || a.segments.segment_code : "a script line",
      pace: a.scores?.pace ?? null,
      clarity: a.scores?.clarity ?? null,
      pauses: a.scores?.pauses ?? null,
    })),
    linesDone: (pg.data || []).length,
    lastDone: ((pg.data || []) as { updated_at: string }[]).map((x) => x.updated_at).sort().pop() ?? null,
  };
  history.earlier = ((eh.data || []) as { topic: string; sessions: number }[]).filter((x) => x.sessions > 0).sort((a, b) => b.sessions - a.sessions);
  return { history, errors };
}

export const TAG_LABEL: Record<RepNote["tag"], string> = {
  note: "Note",
  one_on_one: "One-on-one",
  win: "Win",
  concern: "Concern",
};

/** Average of a skill's 1-10 scores across calls, ignoring "no chance to show it". */
export function skillAverages(calls: HistCall[]): Map<string, { avg: number; n: number }> {
  const acc = new Map<string, { sum: number; n: number }>();
  for (const c of calls)
    for (const s of c.slp ?? []) {
      if (typeof s.score !== "number") continue;
      const a = acc.get(s.skill) ?? { sum: 0, n: 0 };
      a.sum += s.score;
      a.n++;
      acc.set(s.skill, a);
    }
  return new Map([...acc].map(([k, v]) => [k, { avg: v.sum / v.n, n: v.n }]));
}
