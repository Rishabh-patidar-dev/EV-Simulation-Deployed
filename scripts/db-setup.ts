/**
 * npm run db:setup — create the sim_* tables in Supabase, from here.
 *
 * Creating tables needs more than the API key the app runs with (by design,
 * that key can read and write rows but not change the schema), so this
 * connects to Postgres directly with DATABASE_URL from .env and runs
 * supabase/schema.sql in one transaction — a failure leaves the database
 * exactly as it was. Every statement is safe to repeat (`if not exists`,
 * grants), so tables that are already there, and the rows in them, are left
 * untouched: safe to run again.
 *
 * DATABASE_URL: Supabase dashboard → Connect → "Session pooler" connection
 * string, with your database password in place of [YOUR-PASSWORD]. It holds
 * that password, so it lives in .env (gitignored) and is never printed here.
 */

import { existsSync, readFileSync } from "node:fs";
import { loadEnvFile } from "node:process";
import pg from "pg";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/**
 * Supabase requires TLS. Its certificate chain is not in Node's default trust
 * store, so the connection is encrypted without verifying the chain — what
 * `sslmode=require` means in psql. A local database gets no TLS at all.
 * Any sslmode in the URL is dropped: node-pg would let it override this.
 */
function connectionOptions(raw: string): pg.ClientConfig {
  const url = new URL(raw);
  url.searchParams.delete("sslmode");
  url.searchParams.delete("ssl");
  return {
    connectionString: url.toString(),
    ssl: LOCAL_HOSTS.has(url.hostname) ? false : { rejectUnauthorized: false },
    connectionTimeoutMillis: 15_000,
  };
}

/**
 * A connection failure in words. A refused connection to a host with several
 * addresses arrives as an AggregateError whose own message is empty, so fall
 * back to the first underlying error, then to the error code.
 */
function connectFailure(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const inner = error instanceof AggregateError ? error.errors.find((e) => e instanceof Error) : undefined;
  const code = (error as NodeJS.ErrnoException).code;
  return error.message || inner?.message || code || "unknown error";
}

async function main(): Promise<boolean> {
  if (existsSync(".env")) loadEnvFile(".env");
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    console.error("DATABASE_URL is not set in .env.");
    console.error("Supabase dashboard → Connect → Session pooler → copy the URI, put your database password in it, and add it to .env as DATABASE_URL=…\n");
    return false;
  }

  let options: pg.ClientConfig;
  try {
    options = connectionOptions(raw);
  } catch {
    console.error("DATABASE_URL is not a valid postgresql:// connection string.");
    return false;
  }

  const client = new pg.Client(options);
  try {
    await client.connect();
  } catch (error) {
    const message = connectFailure(error);
    console.error(`Could not connect to the database: ${message}`);
    console.error(
      /password|auth/i.test(message)
        ? "Check the password in DATABASE_URL — it is the database password, not an API key. Reset it under Project Settings → Database if needed."
        : /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|timeout/i.test(message)
          ? "Use the Session pooler connection string (Connect → Session pooler): the direct connection needs IPv6, which many networks lack."
          : "Copy the connection string again from Connect → Session pooler, with your database password in it."
    );
    return false;
  }

  try {
    await client.query("begin");
    await client.query(readFileSync("supabase/schema.sql", "utf8"));

    const { rows: tables } = await client.query<{ name: string }>(
      "select tablename as name from pg_tables where schemaname = 'public' and tablename like 'sim\\_%' order by tablename"
    );
    const counts: Array<[string, number]> = [];
    for (const { name } of tables) {
      const { rows } = await client.query<{ n: number }>(`select count(*)::int as n from ${client.escapeIdentifier(name)}`);
      counts.push([name, rows[0].n]);
    }
    await client.query("commit");
    // Supabase's API caches the schema; tell it about any new tables now
    // rather than whenever it next looks.
    await client.query("notify pgrst, 'reload schema'");

    for (const [name, n] of counts) console.log(`  ${name.padEnd(22)} ${n} rows`);
    console.log(`\nDone — ${counts.length} sim_* tables ready. Existing tables and their rows were left as they were.`);
    return true;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

// exitCode rather than process.exit(): exiting while network sockets are still
// closing crashes Node on Windows ("UV_HANDLE_CLOSING").
main().then(
  (ok) => {
    if (!ok) process.exitCode = 1;
  },
  (error: unknown) => {
    console.error(`\nNothing was changed — ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
);
