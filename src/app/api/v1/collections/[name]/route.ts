import { NextResponse } from "next/server";
import { filterRows } from "@/lib/search";
import { readCollection, StoreError } from "@/server/store";
import { COLLECTIONS, type CollectionName } from "@/server/types";

export const dynamic = "force-dynamic";

const VALID = new Set<string>(COLLECTIONS);

/**
 * GET /api/v1/collections/:name?q=&limit=&offset=&format=
 *
 * The screens in this app are server-rendered and call the store directly, so
 * this endpoint is not what paints the UI — it exists so the simulation can be
 * wired to anything else during a demo (a spreadsheet, a WhatsApp bot, the
 * client's own front end) without opening the database up.
 *
 * `format=csv` downloads every matching row (no paging) — the "Export CSV"
 * button on module screens.
 */
export async function GET(request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;

  if (!VALID.has(name)) {
    return NextResponse.json(
      { error: "Unknown collection", collections: [...VALID].sort() },
      { status: 404 }
    );
  }

  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  const limit = clamp(Number(url.searchParams.get("limit") ?? 200), 1, 1000);
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);

  let rows: object[];
  try {
    ({ rows } = await readCollection(name as CollectionName));
  } catch (error) {
    if (!(error instanceof StoreError)) throw error;
    console.error(`[api] ${error.message}`);
    return NextResponse.json({ error: "The database could not be read", reason: error.failure }, { status: 503 });
  }
  const filtered = filterRows(rows as object[], q);

  if (url.searchParams.get("format") === "csv") {
    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(toCsv(filtered as Array<Record<string, unknown>>), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}-${stamp}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return NextResponse.json({
    collection: name,
    total: filtered.length,
    limit,
    offset,
    rows: filtered.slice(offset, offset + limit),
  });
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/** Header row from the union of keys, in first-seen order; nested values as JSON. */
function toCsv(rows: Array<Record<string, unknown>>): string {
  const columns: string[] = [];
  for (const row of rows) for (const key of Object.keys(row)) if (!columns.includes(key)) columns.push(key);

  const lines = [columns.map(cell).join(",")];
  for (const row of rows) lines.push(columns.map((key) => cell(row[key])).join(","));
  // BOM so Excel opens the ₹ and other non-ASCII text as UTF-8.
  return `﻿${lines.join("\r\n")}\r\n`;
}

function cell(value: unknown): string {
  if (value == null) return "";
  let text = typeof value === "object" ? JSON.stringify(value) : String(value);
  // An inline image exports as what it is, not as its bytes.
  if (typeof value === "string" && value.startsWith("data:")) return value.slice(0, Math.max(5, value.indexOf(";")));
  // A string a spreadsheet would evaluate as a formula is prefixed so it stays
  // text — leads and notes are typed by users, and exports get opened in
  // Excel. Numbers are left alone: a negative number is not an attack.
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
