import "server-only";
import { cache } from "react";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type pg from "pg";
import { getSupabase, TABLE_PREFIX } from "./supabase";
import { ensureSchema, getPostgres, quoteTable } from "./postgres";
import { demoDataset } from "./demoSeed";
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
  if (!supabase) throw new StoreError("The database is not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or DATABASE_URL) in .env.", "not-configured");
  return supabase;
}

/**
 * Which backend serves the data: Supabase when its keys are set, otherwise a
 * direct Postgres connection when DATABASE_URL is set (see ./postgres.ts).
 */
export function databaseBackend(): "supabase" | "postgres" | "memory" {
  if (getSupabase()) return "supabase";
  if (getPostgres()) return "postgres";
  return "memory";
}

const isPostgresBackend = () => !getSupabase() && getPostgres() !== null;

/**
 * Built-in store, used when no database is configured: seeded with demo data
 * (./demoSeed.ts) and kept in this server process — changes last until the
 * process restarts, then the demo starts fresh. Rows are kept newest first,
 * the same order the database reads return.
 */
const isMemoryBackend = () => !getSupabase() && !getPostgres();
const memoryHolder = globalThis as typeof globalThis & { __evSimMemory?: Map<CollectionName, Array<{ id: string }>> };
function memory(name: CollectionName): Array<{ id: string }> {
  if (!memoryHolder.__evSimMemory) {
    const data = structuredClone(demoDataset()) as unknown as Record<CollectionName, Array<{ id: string }>>;
    memoryHolder.__evSimMemory = new Map(Object.entries(data) as Array<[CollectionName, Array<{ id: string }>]>);
  }
  const store = memoryHolder.__evSimMemory;
  if (!store.has(name)) store.set(name, []);
  return store.get(name)!;
}

/** Runs a query on the Postgres backend, after making sure the tables exist. */
async function pgQuery<R extends pg.QueryResultRow = pg.QueryResultRow>(action: string, table: string, text: string, values: unknown[] = []): Promise<pg.QueryResult<R>> {
  const db = getPostgres();
  if (!db) throw new StoreError("The database is not configured — set DATABASE_URL in .env.", "not-configured");
  try {
    await ensureSchema(db);
    return await db.query<R>(text, values);
  } catch (error) {
    const err = error as { code?: string; message?: string };
    if (err.code === "42P01") throw new StoreError(`${table} does not exist — run npm run db:setup to create the tables.`, "missing-table");
    throw new StoreError(`Could not ${action} ${table}: ${err.message ?? String(error)}`, "refused");
  }
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
  const table = `${TABLE_PREFIX}${name}`;
  if (isMemoryBackend()) return structuredClone(memory(name));
  if (isPostgresBackend()) {
    const { rows } = await pgQuery<{ data: unknown }>("read", table, `select data from ${quoteTable(table)} order by created_at desc, id asc`);
    return rows.map((row) => row.data);
  }
  const supabase = database();
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
  if (isMemoryBackend()) {
    const rows = memory(name);
    if (rows.some((r) => r.id === row.id)) throw new StoreError(`Could not save to ${TABLE_PREFIX}${name}: duplicate id ${row.id}`, "refused");
    rows.unshift(structuredClone(row));
    return;
  }
  if (isPostgresBackend()) {
    const table = `${TABLE_PREFIX}${name}`;
    await pgQuery("save to", table, `insert into ${quoteTable(table)} (id, data) values ($1, $2::jsonb)`, [row.id, JSON.stringify(row)]);
    return;
  }
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
  const table = `${TABLE_PREFIX}${name}`;
  if (isMemoryBackend()) {
    const rows = memory(name);
    const index = rows.findIndex((r) => r.id === id);
    if (index < 0) return null;
    const updated = JSON.parse(JSON.stringify({ ...rows[index], ...patch })) as Dataset[K][number] & { id: string };
    rows[index] = updated;
    return structuredClone(updated);
  }
  if (isPostgresBackend()) {
    // Same merge as the Supabase path (a key patched to undefined is dropped).
    const { rows } = await pgQuery<{ data: object }>("read", table, `select data from ${quoteTable(table)} where id = $1`, [id]);
    if (!rows[0]) return null;
    const updated = { ...rows[0].data, ...patch } as Dataset[K][number];
    await pgQuery("update", table, `update ${quoteTable(table)} set data = $2::jsonb where id = $1`, [id, JSON.stringify(updated)]);
    return updated;
  }
  const supabase = database();
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
  if (isMemoryBackend()) {
    const stored = memory(name);
    for (const row of rows) {
      const index = stored.findIndex((r) => r.id === row.id);
      if (index >= 0) stored[index] = structuredClone(row);
      else stored.unshift(structuredClone(row));
    }
    return;
  }
  if (isPostgresBackend()) {
    const table = `${TABLE_PREFIX}${name}`;
    for (let from = 0; from < rows.length; from += PAGE) {
      const batch = rows.slice(from, from + PAGE);
      await pgQuery(
        "save to",
        table,
        `insert into ${quoteTable(table)} (id, data) select * from unnest($1::text[], $2::jsonb[]) on conflict (id) do update set data = excluded.data`,
        [batch.map((row) => row.id), batch.map((row) => JSON.stringify(row))]
      );
    }
    return;
  }
  for (let from = 0; from < rows.length; from += PAGE) {
    const batch = rows.slice(from, from + PAGE).map((row) => ({ id: row.id, data: row }));
    await write(name, "save to", (t) => t.upsert(batch, { onConflict: "id" }));
  }
}

/** Removes a row by id. */
export async function deleteRow<K extends CollectionName>(name: K, id: string): Promise<void> {
  if (isMemoryBackend()) {
    const rows = memory(name);
    const index = rows.findIndex((r) => r.id === id);
    if (index >= 0) rows.splice(index, 1);
    return;
  }
  if (isPostgresBackend()) {
    const table = `${TABLE_PREFIX}${name}`;
    await pgQuery("delete from", table, `delete from ${quoteTable(table)} where id = $1`, [id]);
    return;
  }
  await write(name, "delete from", (t) => t.delete().eq("id", id));
}
