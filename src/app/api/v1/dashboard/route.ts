import { NextResponse } from "next/server";
import { buildDashboard } from "@/server/analytics";

export const dynamic = "force-dynamic";

/** GET /api/v1/dashboard — every figure the single dashboard renders. */
export async function GET() {
  return NextResponse.json(await buildDashboard());
}
