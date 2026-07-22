import { DuckDBConnection } from "@duckdb/node-api";
import { describe, expect, it } from "vitest";
import { createTestConnection } from "./testHelper";
import { initSchema } from "./schema";
import { queryRows } from "./client";

describe("activities schema", () => {
  it("has a description column", async () => {
    const conn: DuckDBConnection = await createTestConnection();
    const cols = await queryRows<{ column_name: string }>(
      conn,
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'activities'",
    );
    expect(cols.map((c) => c.column_name)).toContain("description");
  });

  it("running initSchema twice does not error (ALTER TABLE ADD COLUMN IF NOT EXISTS is idempotent)", async () => {
    const conn: DuckDBConnection = await createTestConnection();
    await expect(initSchema((sql) => conn.run(sql))).resolves.not.toThrow();
  });
});

describe("gym_exercises seed", () => {
  it("seeds the curated exercise library", async () => {
    const conn: DuckDBConnection = await createTestConnection();
    const row = await queryRows<{ count: number | bigint }>(conn, "SELECT COUNT(*) AS count FROM gym_exercises");
    expect(Number(row[0].count)).toBeGreaterThan(0);
  });

  it("running initSchema twice does not duplicate seed rows (ON CONFLICT DO NOTHING is idempotent)", async () => {
    const conn: DuckDBConnection = await createTestConnection();
    const before = await queryRows<{ count: number | bigint }>(conn, "SELECT COUNT(*) AS count FROM gym_exercises");
    await initSchema((sql) => conn.run(sql));
    const after = await queryRows<{ count: number | bigint }>(conn, "SELECT COUNT(*) AS count FROM gym_exercises");
    expect(Number(after[0].count)).toBe(Number(before[0].count));
  });
});
