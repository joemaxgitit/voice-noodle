import { excelDate, readSheet, type Cell } from "@/lib/xlsx";
import { convosoName } from "@/lib/uploadCall";

/*
  The dialer's call log (CDR export, CSV or Excel): one row per call with the
  date, time, the client's number, the rep, the length and the client ID.
  Bulk upload matches each recording to its row -- by the client's number and
  the time in the file name -- so the rep, client ID, date, time and order
  fill in by themselves, and the rows with no recording show what's missing.
*/

export type LogRow = {
  date: string; // YYYY-MM-DD
  time: string; // HH:MM, 24h
  phone: string; // the client's number, 10 digits
  agent: string; // as the dialer writes it, e.g. "RolandoGonzalez"
  secs: number | null;
  clientId: string | null;
  campaign: string;
  service: string;
  /** What the dialer marked it (Vindico: SALE, Answering Machine, NOT_INTERESTED...). */
  disposition: string;
  /** Vindico logs name the dialer seat, not the person: "Ryan Smith" on Vindico may be someone else. */
  dialer: "convoso" | "vindico";
};

const digits = (v: Cell) => String(v ?? "").replace(/\D/g, "").slice(-10);

function toDate(v: Cell): string | null {
  const x = excelDate(v);
  if (x) return x;
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function toTime(v: Cell): string | null {
  if (typeof v === "number") {
    const mins = Math.round((v % 1) * 24 * 60);
    return `${String(Math.floor(mins / 60) % 24).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
  }
  const m = String(v ?? "").trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]\.?m\.?)?/i);
  if (!m) return null;
  let h = +m[1];
  const ap = m[3]?.toLowerCase()[0];
  if (ap === "p" && h < 12) h += 12;
  if (ap === "a" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

function toSecs(v: Cell): number | null {
  if (typeof v === "number") return v < 1 ? Math.round(v * 86400) : Math.round(v); // an Excel time, or plain seconds
  const p = String(v ?? "").trim().split(":").map(Number);
  if (!p.length || p.some((x) => !isFinite(x))) return null;
  return p.reduce((s, x) => s * 60 + x, 0);
}

/** Reads the call log. Throws with a plain message when the columns aren't there. */
export function readCallLog(name: string, bytes: Uint8Array): LogRow[] {
  const grid = readSheet(name, bytes);
  // Convoso: "Call To". Vindico: "Phone" (and its times are UTC).
  const hi = grid.findIndex((r) => r.some((c) => /call\s*to|^phone$/i.test(String(c ?? "").trim())) && r.some((c) => /duration/i.test(String(c ?? ""))));
  if (hi < 0) throw new Error("This doesn't look like a call log -- it needs Date, Time, a phone number (Call To or Phone) and Duration columns.");
  const head = grid[hi].map((c) => String(c ?? "").trim().toLowerCase());
  const col = (re: RegExp) => head.findIndex((h) => re.test(h));
  const c = {
    date: col(/^date/),
    time: col(/^time/),
    to: col(/call\s*to/) >= 0 ? col(/call\s*to/) : col(/^phone$/),
    agent: col(/agent|^rep/),
    dur: col(/duration/),
    client: col(/client\s*id/),
    campaign: col(/campaign/),
    service: col(/service/),
    disp: col(/disposition/),
  };
  if (c.date < 0 || c.time < 0) throw new Error("The call log needs its Date and Time columns.");
  const vindico = c.disp >= 0 && head.includes("direction");
  const out: LogRow[] = [];
  for (const r of grid.slice(hi + 1)) {
    let date = toDate(r[c.date]);
    let time = toTime(r[c.time]);
    const phone = digits(r[c.to]);
    if (!date || !time || phone.length < 10) continue;
    if (vindico) {
      // Vindico writes UTC: show it in this computer's time.
      const d = new Date(`${date}T${time}:00Z`);
      date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    }
    out.push({
      date,
      time,
      phone,
      agent: c.agent >= 0 ? String(r[c.agent] ?? "").trim() : "",
      secs: c.dur >= 0 ? toSecs(r[c.dur]) : null,
      clientId: c.client >= 0 ? String(r[c.client] ?? "").trim() || null : null,
      campaign: c.campaign >= 0 ? String(r[c.campaign] ?? "").trim() : "",
      service: c.service >= 0 ? String(r[c.service] ?? "").trim() : "",
      disposition: c.disp >= 0 ? String(r[c.disp] ?? "").trim() : "",
      dialer: vindico ? "vindico" : "convoso",
    });
  }
  return out.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

const minutesOf = (date: string, time: string) => {
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  return Date.UTC(y, m - 1, d, h, mi) / 60000;
};

/**
 * Pairs each recording with its row in the log. The dialer may stamp file
 * names in another time zone, so the hour offset that lines up the most
 * recordings is found first, then each file takes the closest row for its
 * number. Returns the row index for each file (or -1).
 */
export function matchRecordings(files: { name: string; secs: number | null }[], log: LogRow[], seat?: string | null): number[] {
  const parsed = files.map((f) => ({ ...convosoName(f.name), secs: f.secs }));
  let best = 0;
  let bestHits = -1;
  for (let off = -12; off <= 12; off++) {
    let hits = 0;
    for (const p of parsed) {
      if (!p.phone || !p.date || !p.time) continue;
      const t = minutesOf(p.date, p.time) - off * 60;
      if (log.some((r) => r.phone === p.phone && Math.abs(minutesOf(r.date, r.time) - t) <= 3)) hits++;
    }
    if (hits > bestHits || (hits === bestHits && Math.abs(off) < Math.abs(best))) {
      best = off;
      bestHits = hits;
    }
  }
  const taken = new Set<number>();
  const out = parsed.map((p) => {
    if (!p.phone) return -1;
    const cands = log.map((r, i) => ({ r, i })).filter(({ r, i }) => r.phone === p.phone && !taken.has(i));
    if (!cands.length) return -1;
    const t = p.date && p.time ? minutesOf(p.date, p.time) - best * 60 : null;
    const pick =
      t === null
        ? cands.length === 1
          ? cands[0]
          : null
        : cands.sort((a, b) => Math.abs(minutesOf(a.r.date, a.r.time) - t) - Math.abs(minutesOf(b.r.date, b.r.time) - t))[0];
    // Too far off in time to be the same call (unless it's the only call to that number).
    if (!pick || (t !== null && cands.length > 1 && Math.abs(minutesOf(pick.r.date, pick.r.time) - t) > 20)) return -1;
    taken.add(pick.i);
    return pick.i;
  });
  // Recordings with nothing in the name (Vindico's "recording-<id>.mp3"): match on length, longest first.
  // A long call's length is close to unique in a day; short ones are often ambiguous and stay unmatched.
  const order = parsed.map((p, k) => k).filter((k) => out[k] < 0 && !parsed[k].phone && parsed[k].secs).sort((a, b) => (parsed[b].secs ?? 0) - (parsed[a].secs ?? 0));
  for (const k of order) {
    const secs = parsed[k].secs!;
    const cands = log
      .map((r, i) => ({ i, d: r.secs === null ? Infinity : Math.abs(r.secs - secs) }))
      .filter((x) => !taken.has(x.i) && x.d <= 3 && log[x.i].agent && (!seat || log[x.i].agent === seat))
      .sort((a, b) => a.d - b.d);
    if (!cands.length) continue;
    // Two rows equally close: can't tell which -- leave it for the manager.
    if (cands.length > 1 && cands[1].d === cands[0].d) continue;
    taken.add(cands[0].i);
    out[k] = cands[0].i;
  }
  return out;
}

/** "RolandoGonzalez" -> the rep whose name or CRM name squashes to the same letters. */
export function repForAgent<T extends { id: string; full_name: string | null; kpi_name?: string | null }>(agent: string, people: T[]): T | null {
  const sq = (s: string | null | undefined) => (s || "").toLowerCase().replace(/[^a-z]/g, "");
  const a = sq(agent);
  if (!a) return null;
  return (
    people.find((p) => sq(p.full_name) === a || sq(p.kpi_name) === a) ??
    // First + last only ("Rolando J Gonzalez" in the app, "RolandoGonzalez" in the dialer).
    people.find((p) => {
      const parts = (p.full_name || "").toLowerCase().split(/\s+/).filter(Boolean);
      return parts.length > 1 && sq(parts[0] + parts[parts.length - 1]) === a;
    }) ??
    // Spelled a little differently ("Gonzales" / "Gonzalez"): the only rep whose first name starts it.
    (() => {
      const hits = people.filter((p) => {
        const first = sq((p.full_name || "").split(/\s+/)[0]);
        return first.length >= 3 && a.startsWith(first);
      });
      return hits.length === 1 ? hits[0] : null;
    })()
  );
}

export { fmtTime } from "@/lib/dayReview";
