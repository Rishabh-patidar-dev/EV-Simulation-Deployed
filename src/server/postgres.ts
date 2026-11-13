import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

/**
 * Direct Postgres backend, used when the Supabase keys are not set but
 * DATABASE_URL is (e.g. a Render Postgres database). It stores rows in the
 * same `sim_*` tables, with the same `(id, data jsonb, created_at)` shape, and
 * creates any missing table on first use by running supabase/schema.sql —
 * every statement there is `if not exists`, so existing rows are untouched.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

let pool: pg.Pool | null | undefined;
let ready: Promise<void> | null = null;

/**
 * Hosted databases (Supabase, Render's external URL) require TLS; their chains
 * are not in Node's trust store, so encrypt without verifying — what
 * `sslmode=require` means in psql. Local hosts and Render's internal
 * hostnames (no dot, private network) get no TLS.
 */
function poolOptions(raw: string): pg.PoolConfig {
  const url = new URL(raw);
  url.searchParams.delete("sslmode");
  url.searchParams.delete("ssl");
  const plain = LOCAL_HOSTS.has(url.hostname) || !url.hostname.includes(".");
  return {
    connectionString: url.toString(),
    ssl: plain ? false : { rejectUnauthorized: false },
    max: 5,
    connectionTimeoutMillis: 15_000,
    idleTimeoutMillis: 30_000,
  };
}

export function getPostgres(): pg.Pool | null {
  if (pool !== undefined) return pool;
  const raw = process.env.DATABASE_URL;
  pool = raw ? new pg.Pool(poolOptions(raw)) : null;
  // An idle client dropping (database restart) must not crash the server.
  pool?.on("error", (error) => console.error(`[postgres] idle client error: ${error.message}`));
  return pool;
}

/** Creates any missing sim_* table once per process; retried after a failure. */
export function ensureSchema(db: pg.Pool): Promise<void> {
  if (!ready) {
    const sql = readFileSync(path.join(process.cwd(), "supabase", "schema.sql"), "utf8");
    ready = db.query(sql).then(
      () => undefined,
      (error: unknown) => {
        ready = null;
        throw error;
      }
    );
  }
  return ready;
}

/** Table names come from the fixed collection list; refuse anything else. */
export function quoteTable(table: string): string {
  if (!/^sim_[a-z_]+$/.test(table)) throw new Error(`Invalid table name: ${table}`);
  return `"${table}"`;
}
