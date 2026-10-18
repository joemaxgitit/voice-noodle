import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/callsServer";
import { askJson, REVIEW_MODEL, type Block } from "@/lib/repReview";
import { INGEST_SCHEMA, ingestInstructions, type IngestResult } from "@/lib/ingest";
import { readAllSheets, readCsv, sheetAsText } from "@/lib/xlsx";

export const runtime = "nodejs";
export const maxDuration = 300;

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const MAX_TEXT = 180_000;

/**
 * The team drop box. Reads pasted text and/or a file already uploaded to the
 * private rep-files bucket, and returns Claude's proposal of which rep each
 * piece belongs to. Saves nothing -- the manager confirms on the page.
 */
export async function POST(request: Request) {
  const ctx = await requireAdmin(request);
  if (ctx instanceof NextResponse) return ctx;
  const { supabase, orgId } = ctx;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 500 });

  const body = (await request.json().catch(() => ({}))) as { text?: string; path?: string; name?: string; mime?: string };
  const text = (body.text || "").slice(0, MAX_TEXT);
  const path = body.path || "";
  if (!text.trim() && !path) return NextResponse.json({ error: "Nothing to read." }, { status: 400 });
  if (path && !path.startsWith(`${orgId}/`)) return NextResponse.json({ error: "That file isn't yours." }, { status: 403 });

  const [{ data: people }, { data: reports }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, kpi_name, role, active").eq("org_id", orgId),
    supabase.from("kpi_reports").select("title, kind").eq("kind", "other"),
  ]);
  const roster = (people || [])
    .filter((p) => p.full_name)
    .map((p) => ({ id: p.id as string, name: `${p.full_name}${p.role !== "rep" ? ` (${p.role})` : ""}${p.active ? "" : " (inactive)"}`, aka: (p.kpi_name as string) || null }));
  const titles = [...new Set((reports || []).map((r) => r.title as string))].slice(0, 20);

  const content: Block[] = [{ type: "text", text: ingestInstructions(roster, new Date().toISOString().slice(0, 10), titles) }];
  if (text.trim()) content.push({ type: "text", text: `PASTED BY THE MANAGER:\n${text}` });

  if (path) {
    const name = body.name || path.split("/").pop() || "file";
    const mime = (body.mime || "").toLowerCase();
    const { data, error } = await supabase.storage.from("rep-files").download(path);
    if (error || !data) return NextResponse.json({ error: `Couldn't read the file: ${error?.message ?? "missing"}` }, { status: 500 });
    const bytes = new Uint8Array(await data.arrayBuffer());
    if (/\.xlsx$/i.test(name)) {
      let all = "";
      for (const s of readAllSheets(bytes)) {
        const t = sheetAsText(s.grid, 400);
        if (t) all += `\n--- sheet "${s.name}" ---\n${t}\n`;
        if (all.length > MAX_TEXT) break;
      }
      content.push({ type: "text", text: `FILE "${name}" (spreadsheet, tab-separated):${all.slice(0, MAX_TEXT)}` });
    } else if (/\.csv$/i.test(name)) {
      content.push({ type: "text", text: `FILE "${name}":\n${sheetAsText(readCsv(new TextDecoder().decode(bytes)), 400)}` });
    } else if (mime === "application/pdf" || /\.pdf$/i.test(name)) {
      content.push({ type: "text", text: `FILE "${name}":` }, { type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(bytes).toString("base64") } });
    } else if (IMAGE_TYPES.includes(mime)) {
      content.push({ type: "text", text: `FILE "${name}" (image):` }, { type: "image", source: { type: "base64", media_type: mime, data: Buffer.from(bytes).toString("base64") } });
    } else if (/^text\//.test(mime) || /\.(txt|md|json)$/i.test(name)) {
      content.push({ type: "text", text: `FILE "${name}":\n${new TextDecoder().decode(bytes).slice(0, MAX_TEXT)}` });
    } else {
      return NextResponse.json({ error: `${name}: I can read Excel, CSV, PDF, images and text files. For a Word file, paste its text instead.` }, { status: 400 });
    }
  }

  try {
    const result = await askJson<IngestResult>(content, INGEST_SCHEMA, key, "Sorting", 24000);
    const valid = new Set(roster.map((r) => r.id));
    for (const it of result.items) if (!valid.has(it.rep_id)) it.rep_id = "";
    return NextResponse.json({ ok: true, result, model: REVIEW_MODEL });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
