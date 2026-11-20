/** What a rep sees for one call: only what a manager reviewed and sent (supabase/rep-feedback.sql). */
export type FeedbackContent = {
  note?: string;
  did_well: string[];
  work_on: { title: string; what_happened: string; next_call: string; practice: string } | null;
  score?: number | null;
};

export type RepFeedback = {
  id: string;
  created_at: string;
  seen_at: string | null;
  sent_by_name: string | null;
  call_date: string | null;
  script_title: string | null;
  content: FeedbackContent;
};
