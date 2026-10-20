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
};

export type FingerprintRow = { id: string; rep_id: string; created_at: string; inputs: { proven?: number; cancelled?: number }; body: Fingerprint; usd: number | null };

/** The least it will run on, and where it stops being "early". */
export const FINGERPRINT_MIN = { proven: 3, cancelled: 2 };
export const FINGERPRINT_SOLID = { proven: 8, cancelled: 4 };
