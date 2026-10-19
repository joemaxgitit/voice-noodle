import type { Cell } from "./xlsx";

/*
  The Friday Retention Lookback (built in the retention agent project).
  Only the sales-side parts come into Voice Noodle:
    - Rep Scorecard: each rep's cancelled-before-1st rate and its change
    - All Requests: lost requests in the window whose reason traces back to
      the sale ("Point-of-sale"), counted by reason per rep
  Escalations (compliance), retention AM save rates, note quality and
  client names stay out of rep coaching.
*/

export type RetentionRep = {
  salesman: string;
  deals: number | null;
  before1_rate: number | null; // 0-1
  prior_rate: number | null;
  pending_share: number | null;
  requests: number | null;
  pos_lost: number;
  pos_reasons: Record<string, number>;
};
/** One lost (cancelled) client, kept by client ID only so overlapping weekly lookbacks count each client once. */
export type RetentionCancel = { client_id: string; salesman: string; requested: string; stage: "before_1st" | "after_1st" | "other" };

export type RetentionParsed = {
  cancels: RetentionCancel[];
  period_start: string;
  period_end: string;
  team: { requests: number | null; lost: number | null; saved: number | null; save_rate: number | null; before1_rate: number | null; pos_lost: number; top_reasons: [string, number][] };
  reps: RetentionRep[];
};

const num = (v: Cell | undefined): number | null => {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() && isFinite(Number(v.replace(/[,%$]/g, "")))) return Number(v.replace(/[,%$]/g, ""));
  return null;
};
const iso = (m: string, d: string, y: string) => `${y.length === 2 ? `20${y}` : y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;

export function isRetentionWorkbook(sheets: { name: string }[]) {
  const names = sheets.map((s) => s.name.toLowerCase());
  return names.includes("rep scorecard") && names.includes("all requests");
}

/** "AB. Would rather just pay it themselves" -> "Would rather just pay it themselves" */
const reasonOf = (theme: string) => theme.replace(/^[A-Z]{1,2}\.\s*/, "").trim();

export function parseRetention(sheets: { name: string; grid: Cell[][] }[]): RetentionParsed {
  const get = (n: string) => sheets.find((s) => s.name.toLowerCase() === n)?.grid ?? [];
  const summary = get("summary");
  const text = summary.flat().filter((c) => typeof c === "string").join(" ");
  const m = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*(?:to|-|–)\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) throw new Error("Couldn't find the date range on the Summary tab.");
  const period_start = iso(m[1], m[2], m[3]);
  const period_end = iso(m[4], m[5], m[6]);
  const row = (label: RegExp) => summary.find((r) => typeof r[0] === "string" && label.test(r[0]));

  // Rep Scorecard
  const sc = get("rep scorecard");
  const hi = sc.findIndex((r) => r.some((c) => typeof c === "string" && /^salesman$/i.test(c.trim())));
  if (hi < 0) throw new Error("Couldn't find the Rep Scorecard header.");
  const h = sc[hi].map((c) => (c == null ? "" : String(c).toLowerCase().trim()));
  const col = (re: RegExp) => h.findIndex((x) => re.test(x));
  const c = {
    name: col(/^salesman$/),
    deals: col(/^deals$/),
    rate: col(/^before-?1st rate$/),
    prior: col(/^prior rate$/),
    pend: col(/^pending share$/),
    req: col(/requests in window/),
  };
  const reps = new Map<string, RetentionRep>();
  let teamRate: number | null = null;
  for (const r of sc.slice(hi + 1)) {
    const name = String(r[c.name] ?? "").trim();
    if (!name) continue;
    if (/^team$|^total/i.test(name)) {
      // The team row is shifted (no closing ratio); find the first 0-1 value after the counts.
      teamRate = r.map(num).find((v, i) => i > c.deals && v !== null && v > 0 && v < 1) ?? null;
      continue;
    }
    if (/^green|^prior rate is|^pink/i.test(name)) continue;
    reps.set(name, {
      salesman: name,
      deals: num(r[c.deals]),
      before1_rate: c.rate >= 0 ? num(r[c.rate]) : null,
      prior_rate: c.prior >= 0 ? num(r[c.prior]) : null,
      pending_share: c.pend >= 0 ? num(r[c.pend]) : null,
      requests: c.req >= 0 ? num(r[c.req]) : null,
      pos_lost: 0,
      pos_reasons: {},
    });
  }

  // All Requests: lost, in the window, point-of-sale
  const ar = get("all requests");
  const ai = ar.findIndex((r) => r.some((x) => typeof x === "string" && /^outcome$/i.test(x.trim())));
  const team: Record<string, number> = {};
  const cancels: RetentionCancel[] = [];
  let teamPos = 0;
  if (ai >= 0) {
    const ah = ar[ai].map((x) => (x == null ? "" : String(x).toLowerCase().trim()));
    const ix = (re: RegExp) => ah.findIndex((x) => re.test(x));
    const [o, w, s, t, k] = [ix(/^outcome$/), ix(/^in window$/), ix(/^salesman$/), ix(/^theme$/), ix(/^category$/)];
    const [cid, req, st] = [ix(/^client id$/), ix(/^requested$/), ix(/^client status$/)];
    for (const r of ar.slice(ai + 1)) {
      // Every lost client, for the 3-month look back.
      if (String(r[o] ?? "") === "Lost" && cid >= 0 && r[cid]) {
        const v = r[req];
        const requested =
          typeof v === "number" && v > 20000
            ? new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000).toISOString().slice(0, 10)
            : typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)
              ? v.slice(0, 10)
              : null;
        const status = String(r[st] ?? "").toLowerCase();
        if (requested)
          cancels.push({
            client_id: String(r[cid]).trim(),
            salesman: String(r[s] ?? "").trim(),
            requested,
            stage: /before 1st/.test(status) ? "before_1st" : /after 1st/.test(status) ? "after_1st" : "other",
          });
      }
      if (String(r[o] ?? "") !== "Lost" || !/^yes$/i.test(String(r[w] ?? "")) || !/point-of-sale/i.test(String(r[k] ?? ""))) continue;
      const name = String(r[s] ?? "").trim();
      const reason = reasonOf(String(r[t] ?? ""));
      if (!name || !reason) continue;
      teamPos++;
      team[reason] = (team[reason] ?? 0) + 1;
      const rep =
        reps.get(name) ??
        (() => {
          const x: RetentionRep = { salesman: name, deals: null, before1_rate: null, prior_rate: null, pending_share: null, requests: null, pos_lost: 0, pos_reasons: {} };
          reps.set(name, x);
          return x;
        })();
      rep.pos_lost++;
      rep.pos_reasons[reason] = (rep.pos_reasons[reason] ?? 0) + 1;
    }
  }

  const saved = row(/^saved/i);
  const lost = row(/^lost/i);
  return {
    cancels,
    period_start,
    period_end,
    team: {
      requests: num(row(/^requests in window/i)?.[1]),
      lost: num(lost?.[1]),
      saved: num(saved?.[1]),
      save_rate: num(row(/^save rate$/i)?.[1]),
      before1_rate: teamRate,
      pos_lost: teamPos,
      top_reasons: Object.entries(team).sort((a, b) => b[1] - a[1]),
    },
    reps: [...reps.values()],
  };
}

export const pct = (v: number | null | undefined) => (v === null || v === undefined ? "--" : `${Math.round(v * 100)}%`);
export const pts = (now: number | null, before: number | null) =>
  now === null || before === null ? "" : `${now - before >= 0 ? "+" : ""}${Math.round((now - before) * 100)} pts`;
export const reasonsText = (r: Record<string, number>) =>
  Object.entries(r)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k}${n > 1 ? ` ×${n}` : ""}`)
    .join(", ");
