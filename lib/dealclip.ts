import type { Cell } from "./xlsx";
import { displayName } from "./kpi";

/**
 * The morning Deal Clip: last night's month-to-date Sales Dashboard,
 * ranked by deals, with each rep's month-end projection.
 *
 *   Deal Clip    = deals so far ÷ work days gone × work days in the month
 *   If Two a Day = deals so far + 2 × work days left
 *
 * Manager-side only -- reps never see a ranking.
 */

export type ClipRow = { name: string; status: string; deals: number; ratio: number | null };

const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isWork = (d: Date) => d.getDay() !== 0 && d.getDay() !== 6;

/** Mon-Fri work days in the month of `through`: how many are done (through that day) and how many in all. */
export function workDays(through: string): { gone: number; total: number } {
  const [y, m, day] = through.split("-").map(Number);
  let gone = 0;
  let total = 0;
  for (let d = new Date(y, m - 1, 1); d.getMonth() === m - 1; d.setDate(d.getDate() + 1)) {
    if (!isWork(d)) continue;
    total++;
    if (d.getDate() <= day) gone++;
  }
  return { gone, total };
}

/** The work day the numbers run through: the export day, or the work day before if it was exported before noon. */
export function throughDay(exportedIso: string | null, exportedHour: number | null): string {
  const d = exportedIso ? new Date(`${exportedIso}T12:00:00`) : new Date();
  if (exportedHour !== null && exportedHour < 12) d.setDate(d.getDate() - 1);
  while (!isWork(d)) d.setDate(d.getDate() - 1);
  return isoOf(d);
}

/** Hour of day the CRM file was exported, from the .NET ticks in its name. */
export function exportHour(fileName: string): number | null {
  const m = fileName.match(/(\d{18})/);
  if (!m) return null;
  const d = new Date(Math.floor(Number(BigInt(m[1]) - BigInt("621355968000000000")) / 1e4));
  return isNaN(d.getTime()) ? null : d.getHours();
}

export function readClip(grid: Cell[][]): ClipRow[] {
  const hi = grid.findIndex((r) => r.filter((c) => typeof c === "string" && c.trim()).length >= 3);
  if (hi < 0) throw new Error("Couldn't find the header row.");
  const header = grid[hi].map((c) => (c == null ? "" : String(c).toLowerCase().trim()));
  const col = (res: RegExp[]) => {
    for (const re of res) {
      const i = header.findIndex((h) => re.test(h));
      if (i >= 0) return i;
    }
    return -1;
  };
  const name = Math.max(0, col([/salesman/, /^rep|agent|employee|^name/]));
  const deals = col([/total.?deals?/, /^deals?$/]);
  const ratio = col([/closing.?ratio.*actual/, /^closing.?ratio$/, /closing.?ratio/]);
  const status = col([/^status$/]);
  if (deals < 0) throw new Error('No "Total Deal" column in this file. Is it the Sales Dashboard?');
  const num = (v: Cell | undefined) => (typeof v === "number" ? v : typeof v === "string" && v.trim() && isFinite(Number(v.replace(/[,%]/g, ""))) ? Number(v.replace(/[,%]/g, "")) : null);
  return grid
    .slice(hi + 1)
    .filter((r) => r[name] != null && String(r[name]).trim())
    .filter((r) => !/^(sub ?totals?|totals?|grand total|average)\b/i.test(String(r[name]).trim()))
    .map((r) => {
      let rt = ratio >= 0 ? num(r[ratio]) : null;
      if (rt !== null && rt > 1) rt = rt / 100;
      return { name: displayName(String(r[name]).trim()), status: status >= 0 ? String(r[status] ?? "") : "", deals: num(r[deals]) ?? 0, ratio: rt };
    });
}

export const clipOf = (deals: number, gone: number, total: number) => (gone > 0 ? (deals / gone) * total : deals);
export const twoADay = (deals: number, gone: number, total: number) => deals + 2 * Math.max(0, total - gone);
export const round1 = (n: number) => String(Math.round(n));
