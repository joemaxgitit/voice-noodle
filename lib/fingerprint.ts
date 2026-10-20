/*
  A rep's own "style that works" (see app/api/reps/fingerprint). Compared
  only against the rep's own calls: proven sales (graduated or 6+ payments)
  vs their cancels. Straight Line grading stays universal for everyone.
*/

export type Fingerprint = {
  summary: string;
  markers: { marker: string; how_it_sounds: string; evidence: string; in_proven: number; in_cancels: number }[];
  watch_outs: { marker: string; evidence: string; in_proven: number; in_cancels: number }[];
  keep_universal: string;
  practice_focus: string;
  try_next?: { pattern: string; why_fits: string; how_to_try: string }[];
  experiment_checks?: { id: string; showing_in: number; of: number; effect: string; verdict: "keep_trying" | "kept" | "dropped"; note: string }[];
};

export type FingerprintRow = { id: string; rep_id: string; created_at: string; inputs: { proven?: number; cancelled?: number }; body: Fingerprint; usd: number | null };

/** The least it will run on, and where it stops being "early". */
export const FINGERPRINT_MIN = { proven: 3, cancelled: 2 };
export const FINGERPRINT_SOLID = { proven: 8, cancelled: 4 };

/** A pattern that shows up in proven sales across several reps: offered, never required. */
export type TeamPattern = { pattern: string; how_it_sounds: string; reps: string[]; evidence: string };
export const TEAM_MIN_REPS = 3;

export type Experiment = {
  id: string;
  rep_id: string;
  pattern: string;
  how_to_try: string | null;
  why_fits: string | null;
  status: "trying" | "kept" | "dropped";
  last_check: { showing_in: number; of: number; effect: string; note: string; at: string } | null;
  started_at: string;
  ended_at: string | null;
};

/** Calls after an experiment starts before it's judged kept or dropped. */
export const EXPERIMENT_FAIR_TRY = 8;
