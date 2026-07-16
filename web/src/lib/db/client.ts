import { DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import { initSchema } from "./schema";

// This module touches native bindings and must only run on the Node.js
// runtime (not Edge) — every route/component importing it needs
// `export const runtime = "nodejs"`.

let instancePromise: Promise<DuckDBInstance> | null = null;

function databasePath(): string {
  // ":memory:" is used by tests (see test/dbTestHelper.ts). In production,
  // DUCKDB_DATABASE_URL is "md:<database>?motherduck_token=<token>".
  return process.env.DUCKDB_DATABASE_URL ?? ":memory:";
}

async function getInstance(): Promise<DuckDBInstance> {
  if (!instancePromise) {
    instancePromise = DuckDBInstance.create(databasePath());
  }
  return instancePromise;
}

export async function getConnection(): Promise<DuckDBConnection> {
  const instance = await getInstance();
  const connection = await instance.connect();
  await initSchema((sql) => connection.run(sql));
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
