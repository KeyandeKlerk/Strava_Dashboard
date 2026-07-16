import { DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import { initSchema } from "./schema";

export async function createTestConnection(): Promise<DuckDBConnection> {
  const instance = await DuckDBInstance.create(":memory:");
  const conn = await instance.connect();
  await initSchema((sql) => conn.run(sql));
  return conn;
}
