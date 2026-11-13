import { NextResponse } from "next/server";
import { readCollection, StoreError } from "@/server/store";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/health — is the app up, and can it read the database? Worth
 * knowing before a demo starts. 503 with the reason ("not-configured",
 * "missing-table" or "refused") when it cannot.
 */
export async function GET() {
  const at = new Date().toISOString();
  try {
    const { rows } = await readCollection("dealers");
    return NextResponse.json({ ok: true, database: "reachable", dealerCount: rows.length, at });
  } catch (error) {
    if (!(error instanceof StoreError)) throw error;
    console.error(`[health] ${error.message}`);
    return NextResponse.json({ ok: false, database: error.failure, at }, { status: 503 });
  }
}
