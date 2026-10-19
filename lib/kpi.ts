import type { Cell } from "@/lib/xlsx";

/*
  Sales (KPI) reports from the CRM: one row per salesman, one upload for the
  whole team. This file turns a sheet into typed rows and matches each
  salesman to a rep's account.
*/

export type ColType = "name" | "text" | "number" | "ratio" | "money" | "hours";
export type KpiColumn = { key: string; label: string; type: ColType };
export type KpiValue = string | number | null;
export type KpiReport = {
  id: string;
  kind: string;
  title: string;
  file_name: string | null;
  path: string | null;
  period_start: string;
  period_end: string;
  columns: KpiColumn[];
  uploaded_by: string | null;
  created_at: string;
};
export type KpiRow = { id: string; report_id: string; rep_id: string | null; salesman: string; data: Record<string, KpiValue> };

export const KIND_LABEL: Record<string, string> = {
  sales_dashboard: "Sales dashboard",
  sale_report: "Sale report",
  kpi_scorecard: "KPI scorecard",
  monthly_report: "Granite Bay monthly report",
  other: "Report",
};

/** The CRM exports name files like SalesDashboard_639232531302862339.xlsx. */
export function kindFromFile(name: string): string {
  if (/salesdashboard/i.test(name)) return "sales_dashboard";
  if (/granite.?bay/i.test(name)) return "monthly_report";
  if (/salereport|salesreport/i.test(name)) return "sale_report";
  if (/kpi|scorecard/i.test(name)) return "kpi_scorecard";
  return "other";
}

/**
 * The long number in the CRM's file names is a .NET timestamp (ticks since
 * year 1). It is when the report was exported -- a good default for the end
 * of the period it covers.
 */
export function exportDateFromFile(name: string): string | null {
  const m = name.match(/(\d{18})/);
  if (!m) return null;
  const ms = Math.floor(Number(BigInt(m[1]) - BigInt("621355968000000000")) / 1e4);
  const d = new Date(ms);
  if (isNaN(d.getTime()) || d.getFullYear() < 2015 || d.getFullYear() > 2100) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "") || "col";

/** "68h:36m:11s" or "69h:55m" -> 68.6 hours */
export function hoursOf(v: Cell): number | null {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return null;
  const m = v.match(/^\s*(\d+)h(?::?(\d+)m)?(?::?(\d+)s)?\s*$/i);
  if (!m) return null;
  return Math.round((Number(m[1]) + Number(m[2] || 0) / 60 + Number(m[3] || 0) / 3600) * 100) / 100;
}

function typeFor(label: string, values: Cell[], first: boolean): ColType {
  const l = label.toLowerCase();
  if (first || /salesman|sales rep|^rep$|agent|employee/.test(l)) return "name";
  const present = values.filter((v) => v !== null && v !== "");
  if (/time/.test(l) && present.some((v) => typeof v === "string" && hoursOf(v) !== null)) return "hours";
  const nums = present.filter((v): v is number => typeof v === "number");
  if (!nums.length || nums.length < present.length / 2) return "text";
  if (/debt|amount|revenue|\$/.test(l)) return "money";
  if ((/ratio|rate|retention|closing|%|percent/.test(l)) && nums.every((n) => n >= 0 && n <= 1.5)) return "ratio";
  return "number";
}

/** "ShawnaMuckey (Shawna Muckey)" -> "Shawna Muckey" */
export function displayName(raw: string): string {
  const inner = raw.match(/\(([^)]+)\)\s*$/)?.[1];
  return (inner || raw).replace(/\s+/g, " ").trim();
}

/** Lowercase letters only, for matching. */
export const nameKey = (s: string | null | undefined) => (s || "").toLowerCase().replace(/[^a-z]/g, "");

export type ParsedReport = { columns: KpiColumn[]; rows: { salesman: string; data: Record<string, KpiValue> }[] };

/**
 * Finds the header row (the first row with several text cells), types each
 * column from its values, and returns one row per salesman. Total and blank
 * rows are dropped.
 */
export function parseReport(grid: Cell[][]): ParsedReport {
  const hi = grid.findIndex((r) => r.filter((c) => typeof c === "string" && c.trim()).length >= 3);
  if (hi < 0) throw new Error("Couldn't find a header row in this sheet.");
  const header = grid[hi].map((c) => (c == null ? "" : String(c).trim()));
  // CSV exports write "$247,721" and "18.5%" as text; turn them into numbers and remember which kind.
  const dollar = new Set<number>();
  const percent = new Set<number>();
  const body = grid
    .slice(hi + 1)
    .filter((r) => r.some((c) => c !== null && c !== ""))
    .map((r) =>
      r.map((c, i) => {
        if (typeof c !== "string") return c;
        const t = c.trim();
        if (/^null%?$/i.test(t)) return null;
        let m = t.match(/^\$\s*(-?[\d,]*\.?\d+)$/);
        if (m) {
          dollar.add(i);
          return Number(m[1].replace(/,/g, ""));
        }
        m = t.match(/^(-?[\d,]*\.?\d+)\s*%$/);
        if (m) {
          percent.add(i);
          return Number(m[1].replace(/,/g, "")) / 100;
        }
        return c;
      })
    );

  const used = new Set<string>();
  const columns: KpiColumn[] = header.map((label, i) => {
    let key = slug(label || `col ${i + 1}`);
    while (used.has(key)) key += "_2";
    used.add(key);
    let type = typeFor(label, body.map((r) => r[i] ?? null), i === 0);
    if (type === "number" && dollar.has(i)) type = "money";
    if (type === "number" && percent.has(i)) type = "ratio";
    return { key, label: label || `Column ${i + 1}`, type };
  });
  const nameCol = columns.findIndex((c) => c.type === "name");

  const rows = body
    .map((r) => {
      const salesman = String(r[nameCol] ?? "").trim();
      const data: Record<string, KpiValue> = {};
      columns.forEach((c, i) => {
        if (i === nameCol) return;
        const v = r[i] ?? null;
        data[c.key] = c.type === "hours" ? hoursOf(v) : typeof v === "boolean" ? String(v) : v;
      });
      return { salesman, data };
    })
    .filter((r) => r.salesman && !/^(sub ?totals?|totals?|grand total|average|sum)\b/i.test(r.salesman));

  return { columns, rows };
}

/** Matches a report's salesman to an account by report name, then account name. */
export function matchRep(
  salesman: string,
  people: { id: string; full_name: string | null; kpi_name?: string | null }[]
): string | null {
  const shown = nameKey(displayName(salesman));
  const login = nameKey(salesman.replace(/\(.*\)\s*$/, ""));
  for (const p of people) if (p.kpi_name && [shown, login].includes(nameKey(p.kpi_name))) return p.id;
  for (const p of people) if (p.full_name && [shown, login].includes(nameKey(p.full_name))) return p.id;
  return null;
}

export function fmtKpi(v: KpiValue | undefined, type: ColType): string {
  if (v === null || v === undefined || v === "") return "--";
  if (typeof v !== "number") return String(v);
  switch (type) {
    case "ratio":
      return `${Math.round(v * 1000) / 10}%`;
    case "money":
      return `$${Math.round(v).toLocaleString()}`;
    case "hours": {
      const h = Math.floor(v);
      return `${h}h ${String(Math.round((v - h) * 60)).padStart(2, "0")}m`;
    }
    default:
      return Number.isInteger(v) ? v.toLocaleString() : (Math.round(v * 10) / 10).toLocaleString();
  }
}

/**
 * Columns worth leading with, when present. Matched loosely so the two CRM
 * exports (and future ones) line up: "Deals" and "Total Deal" are the same
 * idea.
 */
export const HEADLINE: { id: string; label: string; match: RegExp; better: "up" | "down" }[] = [
  { id: "deals", label: "Deals", match: /^(total_deal|deals)$/, better: "up" },
  { id: "close", label: "Closing ratio", match: /^(closing_ratio_actual|closing)$/, better: "up" },
  { id: "retention", label: "Retention", match: /^retention$/, better: "up" },
  { id: "cxl1", label: "Cancelled before 1st", match: /^cancelled_before_1st$/, better: "down" },
  { id: "issues", label: "Sales issues", match: /^sales_issue$/, better: "down" },
  { id: "debt", label: "Debt sold", match: /^(total_sold_debt|total_debt)$/, better: "up" },
  { id: "outbound", label: "Outbound", match: /^outbound$/, better: "up" },
  { id: "talk", label: "CRM talk time", match: /^crm_talk_time$/, better: "up" },
];

/** The value of a headline metric in one row, with its column type. */
export function headlineValue(
  row: KpiRow,
  cols: KpiColumn[],
  id: string
): { v: KpiValue; type: ColType } | null {
  const h = HEADLINE.find((x) => x.id === id);
  const col = h && cols.find((c) => h.match.test(c.key));
  if (!col) return null;
  return { v: row.data[col.key] ?? null, type: col.type };
}

/* ---------------- month-to-month comparison ---------------- */

export type Better = "up" | "down" | "none";
export type MetricPref = { metric_key: string; better: Better; hidden: boolean };

/** A sensible guess at which way is good, from the category's name. */
export function defaultBetter(label: string, type: ColType): Better {
  if (type === "text" || type === "name") return "none";
  const l = label.toLowerCase();
  if (/cancel|issue|not included|chargeback|refund|nsf|complaint|late|absent|drop|declin|lost|bounce|fail|error|pending/.test(l)) return "down";
  return "up";
}

/** Reports of the same sort are compared with each other. */
export function groupOf(r: Pick<KpiReport, "kind" | "title">): string {
  return r.kind !== "other" ? r.kind : `other:${slug(r.title)}`;
}

export const monthOf = (r: Pick<KpiReport, "period_end">) => r.period_end.slice(0, 7);

export function fmtMonth(ym: string, long = true): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, long ? { month: "long", year: "numeric" } : { month: "short" });
}

/** For each group and month, the report covering the most of that month (the latest one). */
export function monthlyReports(reports: KpiReport[]): Map<string, Map<string, KpiReport>> {
  const out = new Map<string, Map<string, KpiReport>>();
  for (const r of reports) {
    const g = groupOf(r);
    const byMonth = out.get(g) ?? new Map<string, KpiReport>();
    const cur = byMonth.get(monthOf(r));
    if (!cur || r.period_end > cur.period_end || (r.period_end === cur.period_end && r.created_at > cur.created_at)) byMonth.set(monthOf(r), r);
    out.set(g, byMonth);
  }
  return out;
}

export type Movement = {
  key: string;
  label: string;
  type: ColType;
  cur: number | null;
  prev: number | null;
  delta: number | null;
  /** relative change, 0.25 = +25% (ratios: change in points / 100) */
  change: number | null;
  better: Better;
  /** true good, false bad, null neutral or unknown */
  good: boolean | null;
  notable: boolean;
  rank: number | null;
  of: number;
  teamAvg: number | null;
};

const num = (v: KpiValue | undefined): number | null => (typeof v === "number" && isFinite(v) ? v : null);

/**
 * Every numeric category for one rep: this month against last month, with
 * team rank and team average for context. Notable = a move big enough to
 * bring up in a one-on-one.
 */
export function compareRep(opts: {
  repId: string;
  cur: KpiReport;
  prev: KpiReport | null;
  curRows: KpiRow[];
  prevRows: KpiRow[];
  prefs: Map<string, MetricPref>;
}): Movement[] {
  const { repId, cur, prev, curRows, prevRows, prefs } = opts;
  const mine = curRows.find((r) => r.rep_id === repId);
  const before = prevRows.find((r) => r.rep_id === repId);
  if (!mine) return [];
  const team = curRows.filter((r) => r.rep_id);
  const out: Movement[] = [];
  for (const c of cur.columns) {
    if (c.type === "name" || c.type === "text") continue;
    const pref = prefs.get(c.key);
    if (pref?.hidden) continue;
    const better = pref?.better ?? defaultBetter(c.label, c.type);
    const a = num(mine.data[c.key]);
    const prevCol = prev?.columns.find((x) => x.key === c.key);
    const b = prevCol && before ? num(before.data[c.key]) : null;
    const delta = a !== null && b !== null ? a - b : null;
    let change: number | null = null;
    if (delta !== null && b !== null) {
      if (c.type === "ratio") change = delta; // points
      else change = b === 0 ? (a === 0 ? 0 : null) : delta / Math.abs(b);
    }
    const good = delta === null || delta === 0 || better === "none" ? null : (delta > 0) === (better === "up");
    const notable =
      delta !== null &&
      delta !== 0 &&
      (c.type === "ratio" ? Math.abs(delta) >= 0.03 : change === null ? Math.abs(delta) >= 3 : Math.abs(change) >= 0.15);
    const vals = team.map((r) => num(r.data[c.key])).filter((v): v is number => v !== null);
    const teamAvg = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
    let rank: number | null = null;
    if (a !== null && better !== "none") rank = 1 + vals.filter((v) => (better === "up" ? v > a : v < a)).length;
    out.push({ key: c.key, label: c.label, type: c.type, cur: a, prev: b, delta, change, better, good, notable, rank, of: vals.length, teamAvg });
  }
  return out;
}

/** "+4 pts", "-12%", "+3" */
export function fmtChange(m: Movement): string {
  if (m.delta === null) return "--";
  if (m.delta === 0) return "no change";
  const sign = m.delta > 0 ? "+" : "−";
  if (m.type === "ratio") return `${sign}${Math.abs(Math.round(m.delta * 1000) / 10)} pts`;
  const abs = fmtKpi(Math.abs(m.delta), m.type);
  return m.change !== null && m.type !== "hours" ? `${sign}${abs} (${sign}${Math.abs(Math.round(m.change * 100))}%)` : `${sign}${abs}`;
}

/** Biggest notable moves first, by size of the change. */
export function highlights(ms: Movement[]): { good: Movement[]; bad: Movement[] } {
  const size = (m: Movement) => (m.type === "ratio" ? Math.abs(m.delta ?? 0) * 3 : Math.abs(m.change ?? 0.2));
  const notable = ms.filter((m) => m.notable && m.good !== null).sort((x, y) => size(y) - size(x));
  return { good: notable.filter((m) => m.good), bad: notable.filter((m) => m.good === false) };
}
