import type { Cell } from "@/lib/xlsx";
import { displayName, hoursOf, matchRep } from "@/lib/kpi";

/*
  Rotation: to get leads the next working day, a rep needs 1 point from the
  day's numbers, in any mix:
    CRM talk time   2.5 hours = 0.5, 4 hours = 1
    calls           60 = 0.5, 90 = 1
    enrollments     0.5 each
  Talk time and calls count their higher level only (4 hours is 1, not 1.5);
  that never changes who makes it, it just keeps the totals readable.
  Change the numbers here and nothing else needs to change.
*/
export const RULES = {
  talk: [
    { at: 4, pts: 1 },
    { at: 2.5, pts: 0.5 },
  ],
  calls: [
    { at: 90, pts: 1 },
    { at: 60, pts: 0.5 },
  ],
  perDeal: 0.5,
  needed: 1,
};

export type DayNumbers = { talk_hours: number | null; calls: number | null; deals: number | null };
export type Scored = DayNumbers & { points: number; made: boolean; parts: { label: string; pts: number }[]; hint: string };

const tier = (v: number | null, levels: { at: number; pts: number }[]) => (v === null ? 0 : levels.find((l) => v >= l.at)?.pts ?? 0);

export function fmtHours(h: number | null | undefined): string {
  if (h === null || h === undefined) return "--";
  const m = Math.round(h * 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

export function score(n: DayNumbers): Scored {
  const talk = tier(n.talk_hours, RULES.talk);
  const calls = tier(n.calls, RULES.calls);
  const deals = (n.deals ?? 0) * RULES.perDeal;
  const points = Math.round((talk + calls + deals) * 100) / 100;
  const made = points >= RULES.needed;
  const parts = [
    { label: `${fmtHours(n.talk_hours)} talk`, pts: talk },
    { label: `${n.calls ?? 0} calls`, pts: calls },
    { label: `${n.deals ?? 0} deal${n.deals === 1 ? "" : "s"}`, pts: deals },
  ];
  // What the cheapest next half point would have been.
  let hint = "";
  if (!made) {
    const short = RULES.needed - points;
    const ideas: string[] = [];
    const nextTalk = [...RULES.talk].reverse().find((l) => (n.talk_hours ?? 0) < l.at && l.pts - talk >= short);
    if (nextTalk) ideas.push(`${fmtHours(nextTalk.at - (n.talk_hours ?? 0))} more talk`);
    const nextCalls = [...RULES.calls].reverse().find((l) => (n.calls ?? 0) < l.at && l.pts - calls >= short);
    if (nextCalls) ideas.push(`${nextCalls.at - (n.calls ?? 0)} more calls`);
    const dealsNeeded = Math.ceil(short / RULES.perDeal);
    ideas.push(`${dealsNeeded} more deal${dealsNeeded === 1 ? "" : "s"}`);
    hint = `needed ${ideas.join(", or ")}`;
  }
  return { ...n, points, made, parts, hint };
}

const pad = (x: number) => String(x).padStart(2, "0");
export const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The leads day a day's numbers decide: the next weekday. */
export function nextWorkDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  do d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6);
  return isoOf(d);
}

export function fmtDay(iso: string, long = false): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, long ? { weekday: "long", month: "short", day: "numeric" } : { weekday: "short", month: "numeric", day: "numeric" });
}

/** Talk time can come as "3h:12m:05s", "03:12:05", "3:12" or plain hours. */
export function parseHours(v: Cell): number | null {
  if (typeof v === "number") return v < 1 && v > 0 ? Math.round(v * 24 * 100) / 100 : v; // Excel time fractions are days
  if (typeof v !== "string") return null;
  const h = hoursOf(v);
  if (h !== null) return h;
  const m = v.trim().match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (m) return Math.round((Number(m[1]) + Number(m[2]) / 60 + Number(m[3] || 0) / 3600) * 100) / 100;
  const n = Number(v.replace(/[^\d.]/g, ""));
  return isFinite(n) && v.trim() ? n : null;
}

export type ColumnPick = { name: number; talk: number; calls: number; deals: number };

/** Finds the name, CRM talk time, call count and total deal columns in the header row. */
export function findColumns(header: string[]): ColumnPick {
  const idx = (res: RegExp[]) => {
    for (const re of res) {
      const i = header.findIndex((h) => re.test(h.toLowerCase().trim()));
      if (i >= 0) return i;
    }
    return -1;
  };
  return {
    name: Math.max(0, idx([/salesman/, /^rep|agent|employee|^name/])),
    talk: idx([/crm.*talk/, /talk.*time/, /talk/]),
    calls: idx([/call.?count/, /^calls?$/, /total.*calls/, /outbound/, /dials?/]),
    deals: idx([/total.?deals?/, /^deals?$/, /enroll/, /saves?/]),
  };
}

export type DayRow = { salesman: string; rep_id: string | null; numbers: DayNumbers; scored: Scored };

/** Reads a day's Sales Dashboard grid into scored rows, matched to accounts. */
export function readDay(grid: Cell[][], people: { id: string; full_name: string | null; kpi_name?: string | null }[], pick?: ColumnPick) {
  const hi = grid.findIndex((r) => r.filter((c) => typeof c === "string" && c.trim()).length >= 3);
  if (hi < 0) throw new Error("Couldn't find the header row.");
  const header = grid[hi].map((c) => (c == null ? "" : String(c)));
  const cols = pick ?? findColumns(header);
  const num = (v: Cell) => (typeof v === "number" ? v : typeof v === "string" && v.trim() && isFinite(Number(v.replace(/,/g, ""))) ? Number(v.replace(/,/g, "")) : null);
  const rows: DayRow[] = grid
    .slice(hi + 1)
    .filter((r) => r[cols.name] != null && String(r[cols.name]).trim())
    .filter((r) => !/^(sub ?totals?|totals?|grand total|average)\b/i.test(String(r[cols.name]).trim()))
    .map((r) => {
      const raw = String(r[cols.name]).trim();
      const numbers: DayNumbers = {
        talk_hours: cols.talk >= 0 ? parseHours(r[cols.talk] ?? null) : null,
        calls: cols.calls >= 0 ? num(r[cols.calls] ?? null) : null,
        deals: cols.deals >= 0 ? num(r[cols.deals] ?? null) : null,
      };
      return { salesman: displayName(raw), rep_id: matchRep(raw, people), numbers, scored: score(numbers) };
    });
  return { header, cols, rows };
}
