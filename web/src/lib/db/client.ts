import { DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import { initSchema } from "./schema";

// This module touches native bindings and must only run on the Node.js
// runtime (not Edge) — every route/component importing it needs
// `export const runtime = "nodejs"`.

let instancePromise: Promise<DuckDBInstance> | null = null;

// ":memory:" is used by tests (see test/dbTestHelper.ts). In production,
// DUCKDB_DATABASE_URL is "md:<database>?motherduck_token=<token>" — but
// DuckDB's motherduck extension doesn't reliably parse `?motherduck_token=`
// as part of the attach path (same issue hit in scripts/migrate-to-motherduck.ts).
// It needs the token as its own `motherduck_token` env var and a bare
// `md:<dbname>` path.
function databasePath(): string {
  const url = process.env.DUCKDB_DATABASE_URL;
  if (!url) return ":memory:";

  const match = url.match(/^md:([^?]+)(?:\?motherduck_token=(.+))?$/);
  if (!match) return url;

  const [, dbName, token] = match;
  if (token) process.env.motherduck_token = token;
  return `md:${dbName}`;
}

async function getInstance(): Promise<DuckDBInstance> {
  if (!instancePromise) {
    // Vercel's serverless filesystem is read-only except /tmp, and DuckDB
    // (via the motherduck extension) needs a writable home directory for its
    // own config/cache — without this it fails with "Can't find the home
    // directory at ''". Harmless to set locally too.
    instancePromise = DuckDBInstance.create(databasePath(), { home_directory: "/tmp" });
  }
  return instancePromise;
}

// MotherDuck already has the schema (created by the one-time migration) —
// running `CREATE TABLE IF NOT EXISTS` against it on every request causes
// "TransactionContext Error: Catalog write-write conflict" under concurrent
// requests, since MotherDuck uses optimistic concurrency and DDL isn't safe
// to race across connections. Only local/test runs against a fresh
// `:memory:` instance need this.
const usingMotherDuck = Boolean(process.env.DUCKDB_DATABASE_URL);

export async function getConnection(): Promise<DuckDBConnection> {
  const instance = await getInstance();
  const connection = await instance.connect();
  if (!usingMotherDuck) {
    await initSchema((sql) => connection.run(sql));
  }
  return connection;
}

export type SqlParams = Record<string, unknown> | unknown[];

// BIGINT columns (activity ids, etc.) come back as JS `bigint` from the driver.
// Strava ids fit comfortably within Number.MAX_SAFE_INTEGER, and `bigint` isn't
// JSON-serializable (breaks Server Component/API-route responses), so convert.
function coerceBigInts<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = typeof value === "bigint" ? Number(value) : value;
  }
  return out as T;
}

export async function queryRows<T = Record<string, unknown>>(
  connection: DuckDBConnection,
  sql: string,
  params?: SqlParams,
): Promise<T[]> {
  const reader = params
    ? await connection.runAndReadAll(sql, params as never)
    : await connection.runAndReadAll(sql);
  return reader.getRowObjectsJS().map((row) => coerceBigInts<T>(row));
}

export async function queryRow<T = Record<string, unknown>>(
  connection: DuckDBConnection,
  sql: string,
  params?: SqlParams,
): Promise<T | undefined> {
  const rows = await queryRows<T>(connection, sql, params);
  return rows[0];
}
