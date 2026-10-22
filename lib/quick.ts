/* Shared by the server quick read (lib/quickRead.ts) and the pages that show it. */

/** Calls shorter than this get a quick read, not the full grade. */
export const SHORT_SECS = 90;

export type CallKind = "voicemail" | "short";

export type VoicemailRead = {
  score: number;
  parts: { who: number; reason: number; callback: number; length: number; tone: number; safe: number };
  rep_secs: number;
  said: string; // the message, in a sentence
  mood: number; // 1-10 energy and certainty
  mood_word: string;
  flag: string; // anything private or risky said on the message, or ""
  read: string;
};

export type ShortRead = {
  what: "hang_up" | "live_short" | "wrong_number" | "callback_set" | "not_interested" | "screened" | "other";
  opening: string; // how far the opening got
  ended_at: number | null;
  ended_by: "client" | "rep" | "unclear";
  mood: number;
  mood_word: string;
  read: string;
};

export type Quick = ({ kind: "voicemail" } & VoicemailRead) | ({ kind: "short" } & ShortRead);

export const SHORT_LABEL: Record<ShortRead["what"], string> = {
  hang_up: "Hang-up",
  live_short: "Short conversation",
  wrong_number: "Wrong number",
  callback_set: "Callback set",
  not_interested: "Not interested",
  screened: "Call screening",
  other: "Short call",
};

