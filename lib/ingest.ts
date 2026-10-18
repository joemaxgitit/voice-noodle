/*
  The team drop box: paste or upload anything that covers several reps -- a
  KPI file in any layout, a meeting recap, a QA sheet -- and Claude sorts it
  onto the right profiles. Nothing is saved until a manager confirms the
  preview.
*/

export type IngestMetric = {
  category: string;
  month: string; // YYYY-MM
  value: number;
  unit: "number" | "ratio" | "money" | "hours";
  better: "up" | "down" | "none";
};

export type IngestItem = {
  rep_id: string; // "" when no account matched
  name_in_source: string;
  note: string; // what this source says about the rep, in plain words; "" if it's only numbers
  tag: "note" | "one_on_one" | "win" | "concern";
  date: string; // YYYY-MM-DD the note is about, or ""
  metrics: IngestMetric[];
};

export type IngestResult = {
  title: string; // a stable name for this kind of source, e.g. "Monthly KPI scorecard"
  summary: string;
  items: IngestItem[];
  team_note: string; // anything about the whole team rather than one rep
};

export const INGEST_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "summary", "items", "team_note"],
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    team_note: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["rep_id", "name_in_source", "note", "tag", "date", "metrics"],
        properties: {
          rep_id: { type: "string" },
          name_in_source: { type: "string" },
          note: { type: "string" },
          tag: { type: "string", enum: ["note", "one_on_one", "win", "concern"] },
          date: { type: "string" },
          metrics: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["category", "month", "value", "unit", "better"],
              properties: {
                category: { type: "string" },
                month: { type: "string" },
                value: { type: "number" },
                unit: { type: "string", enum: ["number", "ratio", "money", "hours"] },
                better: { type: "string", enum: ["up", "down", "none"] },
              },
            },
          },
        },
      },
    },
  },
};

export function ingestInstructions(roster: { id: string; name: string; aka: string | null }[], today: string, knownTitles: string[]) {
  return `You sort information onto sales reps' private profiles for the managers at ProEdge Solutions (Lionside Financial, debt relief). Managers paste or upload anything -- KPI spreadsheets in any layout, meeting recaps, QA notes, Slack messages, screenshots of dashboards -- and you work out which rep each piece is about.

THE TEAM (id | name | name used in CRM reports):
${roster.map((r) => `${r.id} | ${r.name}${r.aka ? ` | ${r.aka}` : ""}`).join("\n")}

Today is ${today}.

Rules:
- One item per rep the source mentions. Match names generously (first name only, nicknames, CRM-style "ShawnaMuckey (Shawna Muckey)", last-name-first). If you truly can't tell which account, set rep_id to "" and keep the name as written.
- Only use ids from the list above. Never invent one.
- "note": what the source says about this rep, in plain words, keeping specifics (numbers, quotes, dates). Leave it "" when the source is only numbers -- those go in metrics.
- "tag": concern for problems, win for achievements, one_on_one for 1:1 meeting notes, otherwise note.
- "metrics": every numeric KPI for the rep, one entry per category per month. Use the category name as the source writes it. "month" is YYYY-MM for the period the number covers (work it out from headers, titles or file names; if there is no clue, use the current month). Percentages go in as fractions with unit "ratio" (24% -> 0.24). Durations go in as hours. Dollar amounts are "money". "better" is which direction is good for the business (cancellations, chargebacks, issues: down).
- Skip totals, averages and subtotal rows -- they aren't a rep.
- "title": a short stable name for this kind of source, so next month's upload lines up with this one.${knownTitles.length ? ` If it is the same kind of report as one of these, reuse the exact name: ${knownTitles.map((t) => `"${t}"`).join(", ")}.` : ""}
- "summary": one or two sentences on what this is and what you found.
- "team_note": anything about the whole team rather than one rep, or "".
- Never copy a client's personal or banking details into a note.`;
}
