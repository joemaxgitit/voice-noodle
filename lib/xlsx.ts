import { unzipSync, strFromU8 } from "fflate";

/*
  A small Excel reader: the first worksheet of an .xlsx as a grid of cells.
  Enough for the CRM's sales reports (plain numbers and text, one header
  row); no formulas are evaluated -- Excel saves the last computed value,
  which is what we read. Works in the browser and on the server. CSV too.
*/

export type Cell = string | number | boolean | null;

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function unxml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENT[e] ?? m;
  });
}

/** "AB12" -> column index 27 */
function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, "")) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function textOf(xml: string): string {
  // Every <t>..</t> run inside a string item, ignoring phonetic runs.
  const noPh = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let out = "";
  for (const m of noPh.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) out += m[1];
  return unxml(out);
}

function firstSheetPath(files: Record<string, Uint8Array>): string | null {
  const wb = files["xl/workbook.xml"] && strFromU8(files["xl/workbook.xml"]);
  const rels = files["xl/_rels/workbook.xml.rels"] && strFromU8(files["xl/_rels/workbook.xml.rels"]);
  const rid = wb?.match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1];
  if (rid && rels) {
    const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((r) => r.includes(`Id="${rid}"`));
    const target = rel?.match(/Target="([^"]+)"/)?.[1];
    if (target) {
      const p = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
      if (files[p]) return p;
    }
  }
  const any = Object.keys(files).filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort();
  return any[0] ?? null;
}

function sharedStrings(files: Record<string, Uint8Array>): string[] {
  const shared: string[] = [];
  if (files["xl/sharedStrings.xml"]) {
    for (const m of strFromU8(files["xl/sharedStrings.xml"]).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) shared.push(textOf(m[1]));
  }
  return shared;
}

export function readXlsx(bytes: Uint8Array): Cell[][] {
  const files = unzipSync(bytes, { filter: (f) => f.name.startsWith("xl/") });
  const path = firstSheetPath(files);
  if (!path) throw new Error("No worksheet found in this file.");
  return parseSheet(strFromU8(files[path]), sharedStrings(files));
}

/** Every worksheet, by name, in workbook order. */
export function readAllSheets(bytes: Uint8Array): { name: string; grid: Cell[][] }[] {
  const files = unzipSync(bytes, { filter: (f) => f.name.startsWith("xl/") });
  const shared = sharedStrings(files);
  const wb = files["xl/workbook.xml"] ? strFromU8(files["xl/workbook.xml"]) : "";
  const rels = files["xl/_rels/workbook.xml.rels"] ? strFromU8(files["xl/_rels/workbook.xml.rels"]) : "";
  const out: { name: string; grid: Cell[][] }[] = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const name = unxml(m[0].match(/\bname="([^"]*)"/)?.[1] ?? "Sheet");
    const rid = m[0].match(/\br:id="([^"]+)"/)?.[1];
    const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((x) => x[0]).find((r) => r.includes(`Id="${rid}"`));
    const target = rel?.match(/Target="([^"]+)"/)?.[1];
    const p = target ? (target.startsWith("/") ? target.slice(1) : `xl/${target}`) : "";
    if (files[p]) out.push({ name, grid: parseSheet(strFromU8(files[p]), shared) });
  }
  if (!out.length) out.push({ name: "Sheet1", grid: readXlsx(bytes) });
  return out;
}

function parseSheet(xml: string, shared: string[]): Cell[][] {

  const rows: Cell[][] = [];
  for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rnum = Number(rm[1].match(/\br="(\d+)"/)?.[1] ?? rows.length + 1) - 1;
    const row: Cell[] = [];
    let next = 0;
    for (const cm of (rm[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1];
      const ci = ref ? colIndex(ref) : next;
      next = ci + 1;
      const t = attrs.match(/\bt="(\w+)"/)?.[1];
      const body = cm[2] ?? "";
      const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let val: Cell = null;
      if (t === "s") val = v != null ? shared[Number(v)] ?? "" : null;
      else if (t === "inlineStr") val = textOf(body);
      else if (t === "str") val = v != null ? unxml(v) : null;
      else if (t === "b") val = v === "1";
      else if (t === "e") val = null;
      else if (v != null) val = Number(v);
      row[ci] = val;
    }
    rows[rnum] = Array.from(row, (c) => (c === undefined ? null : c));
  }
  return Array.from(rows, (r) => r ?? []);
}

/** Plain CSV with quoted fields. */
export function readCsv(text: string): Cell[][] {
  const rows: Cell[][] = [];
  let row: Cell[] = [];
  let f = "";
  let q = false;
  const push = () => {
    const t = f.trim();
    row.push(t === "" ? null : /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : t);
    f = "";
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') (f += '"'), i++;
      else if (ch === '"') q = false;
      else f += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") push();
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      push();
      rows.push(row);
      row = [];
    } else f += ch;
  }
  if (f || row.length) (push(), rows.push(row));
  return rows;
}

/** Either format, picked by the file name. */
export function readSheet(name: string, bytes: Uint8Array): Cell[][] {
  if (/\.csv$/i.test(name)) return readCsv(new TextDecoder().decode(bytes));
  return readXlsx(bytes);
}

/** A grid as compact text for a model to read: tab-separated, capped. */
export function sheetAsText(grid: Cell[][], maxRows = 200): string {
  return grid
    .slice(0, maxRows)
    .filter((r) => r.some((c) => c !== null && c !== ""))
    .map((r) => r.map((c) => (c === null ? "" : String(c))).join("\t"))
    .join("\n");
}
