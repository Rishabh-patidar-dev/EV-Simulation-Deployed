import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client, pointed at the SAME project the CRM and the
 * landing page already use (see their .env files) — the simulation just keeps
 * its rows in its own `sim_*` tables so it can never disturb production data.
 *
 * The service-role key bypasses RLS, so this module must never be imported
 * from a client component — the `server-only` import above turns any such
 * import into a build error. Every caller goes through src/server/store.ts.
 */

let cached: SupabaseClient | null | undefined;

export function getSupabase(): SupabaseClient | null {
  if (cached !== undefined) return cached;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Null when not configured; the store turns that into a clear error on
  // every screen rather than showing anything that is not in the database.
  cached = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
  return cached;
}

/** Prefix keeping simulation rows clearly separate from the CRM's own tables. */
export const TABLE_PREFIX = "sim_";
