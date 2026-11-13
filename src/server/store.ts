import "server-only";
import { cache } from "react";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { getSupabase, TABLE_PREFIX } from "./supabase";
import type { CollectionName, Dataset } from "./types";

/**
 * The one way any screen gets data.
 *
 * Every collection lives in its `sim_<collection>` table in Supabase, and that
 * table is the only copy: reads come from it — an empty table is empty — and
 * writes go to it. There is no fallback. When the database cannot answer
 * (not configured, a table not created yet, or a refused request) a
 * StoreError says which, and the screen shows it rather than guessing.
 *
 * `npm run db:setup` creates the tables.
 */

interface Collection<K extends CollectionName> {
  rows: Dataset[K];
}

/** Why the database could not answer — the status menu words each one differently. */
export type StoreFailure = "not-configured" | "missing-table" | "refused";

/** Thrown when the database cannot serve a read or write — shown to the user, never swallowed. */
export class StoreError extends Error {
  constructor(
    message: string,
    readonly failure: StoreFailure
  ) {
    super(message);
    this.name = "StoreError";
  }
}

/** PostgREST's "no such table" (schema cache) and Postgres's own. */
const isMissingTable = (error: PostgrestError) => error.code === "PGRST205" || error.code === "42P01";

function refused(action: string, table: string, error: PostgrestError): StoreError {
  return isMissingTable(error)
    ? new StoreError(`${table} does not exist — run npm run db:setup to create the tables.`, "missing-table")
    : new StoreError(`Could not ${action} ${table}: ${error.message}`, "refused");
}

function database(): SupabaseClient {
  const supabase = getSupabase();
  if (!supabase) throw new StoreError("The database is not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.", "not-configured");
  return supabase;
}

/**
 * Supabase's gateway now and then rejects the short-lived token it mints for
 * a secret key ("JWT issued at future" — clock skew on their side). Those
 * requests were refused before they ran, so trying once more is safe even
 * for a write.
 */
const isTokenRejection = (error: PostgrestError, status: number) =>
  status === 401 || error.code?.startsWith("PGRST3") || /\bJWT\b/i.test(error.message);

/**
 * Runs a Supabase request, and runs it once more after a short pause if it
 * failed in a way worth retrying. Reads retry any failure except a missing
 * table (they are idempotent); writes retry only a rejected token.
 */
async function withRetry<T extends { error: PostgrestError | null; status: number }>(kind: "read" | "write", run: () => PromiseLike<T>): Promise<T> {
  const first = await run();
  const error = first.error;
  if (!error || isMissingTable(error)) return first;
  if (kind === "write" && !isTokenRejection(error, first.status)) return first;
  await new Promise((resolve) => setTimeout(resolve, 250));
  return run();
}

/**
 * A fresh signal per read. Next memoizes identical GET fetches within one
 * render, so without it a retry would be handed the first, failed response
 * instead of asking Supabase again. Reads are already deduplicated per render
 * by fetchTable's own cache(), so nothing is lost by opting out.
 */
const unmemoized = () => new AbortController().signal;

/** Supabase caps a single response at 1000 rows, so reads page through. */
const PAGE = 1000;

/**
 * Every row of one table, newest first — `created_at` is stamped by the
 * database, so a new row sorts ahead of everything before it.
 *
 * Wrapped in React's `cache`, so the layout and the page reading the same
 * collection during one render share a single request.
 */
const fetchTable = cache(async (name: CollectionName): Promise<unknown[]> => {
  const supabase = database();
  const table = `${TABLE_PREFIX}${name}`;
  const rows: unknown[] = [];

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await withRetry("read", () =>
      supabase
        .from(table)
        .select("id, data")
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1)
        .abortSignal(unmemoized())
    );
    if (error) throw refused("read", table, error);
    rows.push(...(data as Array<{ data: unknown }>).map((row) => row.data));
    if (data.length < PAGE) return rows;
  }
});

export async function readCollection<K extends CollectionName>(name: K): Promise<Collection<K>> {
  return { rows: (await fetchTable(name)) as Dataset[K] };
}

/** Reads several collections at once, keeping each one's rows typed. */
export async function readMany<K extends CollectionName>(names: readonly K[]): Promise<{ data: { [P in K]: Dataset[P] } }> {
  const results = await Promise.all(names.map((name) => fetchTable(name)));
  const data = {} as { [P in K]: Dataset[P] };
  names.forEach((name, i) => {
    (data as Record<string, unknown>)[name] = results[i];
  });
  return { data };
}

/** Runs a write against the collection's table; throws when the database refuses it. */
async function write(
  name: CollectionName,
  action: string,
  run: (table: ReturnType<SupabaseClient["from"]>) => PromiseLike<{ error: PostgrestError | null; status: number }>
): Promise<void> {
  const supabase = database();
  const table = `${TABLE_PREFIX}${name}`;
  const { error } = await withRetry("write", () => run(supabase.from(table)));
  if (error) throw refused(action, table, error);
}

/** Adds a new row. */
export async function insertRow<K extends CollectionName>(name: K, row: Dataset[K][number] & { id: string }): Promise<void> {
  await write(name, "save to", (t) => t.insert({ id: row.id, data: row }));
}

/**
 * Merges `patch` into the row with this id and persists the result. Reads
 * the current row first so a partial update never clobbers fields the caller
 * did not mention. Returns null when there is no such row.
 */
export async function updateRow<K extends CollectionName>(
  name: K,
  id: string,
  patch: Partial<Dataset[K][number]>
): Promise<Dataset[K][number] | null> {
  const supabase = database();
  const table = `${TABLE_PREFIX}${name}`;
  const { data, error } = await withRetry("read", () => supabase.from(table).select("data").eq("id", id).abortSignal(unmemoized()).maybeSingle());
  if (error) throw refused("read", table, error);
  if (!data) return null;

  const updated = { ...(data.data as object), ...patch } as Dataset[K][number];
  await write(name, "update", (t) => t.update({ data: updated }).eq("id", id));
  return updated;
}

/**
 * Writes whole rows in one request. A flow that touches a collection at fleet
 * scale — the provider sweeps that refresh every device or message — would
 * otherwise spend two round trips per row and get slower every time the fleet
 * grows. The caller passes complete rows, so nothing is merged here.
 */
export async function upsertRows<K extends CollectionName>(name: K, rows: readonly (Dataset[K][number] & { id: string })[]): Promise<void> {
  for (let from = 0; from < rows.length; from += PAGE) {
    const batch = rows.slice(from, from + PAGE).map((row) => ({ id: row.id, data: row }));
    await write(name, "save to", (t) => t.upsert(batch, { onConflict: "id" }));
  }
}

/** Removes a row by id. */
export async function deleteRow<K extends CollectionName>(name: K, id: string): Promise<void> {
  await write(name, "delete from", (t) => t.delete().eq("id", id));
}
