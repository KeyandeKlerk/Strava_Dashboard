import type { DuckDBConnection } from "@duckdb/node-api";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestConnection } from "./testHelper";
import { queryRow, queryRows } from "./client";
import { deleteBodyWeightLog, listBodyWeightLogs, logBodyWeight } from "./bodyWeightMutations";

let conn: DuckDBConnection;

beforeEach(async () => {
  conn = await createTestConnection();
});

describe("logBodyWeight", () => {
  it("creates a new body weight log entry", async () => {
    const result = await logBodyWeight(conn, {
      client_uuid: "bw-1",
      logged_date: "2026-07-20",
      weight_kg: 78.5,
    });
    expect(result.client_uuid).toBe("bw-1");

    const rows = await listBodyWeightLogs(conn);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ client_uuid: "bw-1", logged_date: "2026-07-20", weight_kg: 78.5 });
  });

  it("is idempotent when retried with the same client_uuid", async () => {
    await logBodyWeight(conn, { client_uuid: "bw-2", logged_date: "2026-07-20", weight_kg: 80 });
    await logBodyWeight(conn, { client_uuid: "bw-2", logged_date: "2026-07-20", weight_kg: 80 });

    const rows = await queryRows<{ count: number | bigint }>(
      conn,
      "SELECT COUNT(*) AS count FROM body_weight_logs WHERE client_uuid = 'bw-2'",
    );
    expect(Number(rows[0].count)).toBe(1);
  });

  it("allows multiple distinct entries", async () => {
    await logBodyWeight(conn, { client_uuid: "bw-3", logged_date: "2026-07-19", weight_kg: 79 });
    await logBodyWeight(conn, { client_uuid: "bw-4", logged_date: "2026-07-20", weight_kg: 78.8 });

    const rows = await listBodyWeightLogs(conn);
    expect(rows).toHaveLength(2);
  });
});

describe("listBodyWeightLogs", () => {
  it("returns an empty list when nothing has been logged", async () => {
    const rows = await listBodyWeightLogs(conn);
    expect(rows).toEqual([]);
  });

  it("orders entries most-recent-first", async () => {
    await logBodyWeight(conn, { client_uuid: "bw-5", logged_date: "2026-07-18", weight_kg: 81 });
    await logBodyWeight(conn, { client_uuid: "bw-6", logged_date: "2026-07-20", weight_kg: 79.5 });
    await logBodyWeight(conn, { client_uuid: "bw-7", logged_date: "2026-07-19", weight_kg: 80.2 });

    const rows = await listBodyWeightLogs(conn);
    expect(rows.map((r) => r.logged_date)).toEqual(["2026-07-20", "2026-07-19", "2026-07-18"]);
  });

  it("respects a limit", async () => {
    await logBodyWeight(conn, { client_uuid: "bw-8", logged_date: "2026-07-18", weight_kg: 81 });
    await logBodyWeight(conn, { client_uuid: "bw-9", logged_date: "2026-07-19", weight_kg: 80 });
    await logBodyWeight(conn, { client_uuid: "bw-10", logged_date: "2026-07-20", weight_kg: 79 });

    const rows = await listBodyWeightLogs(conn, 2);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.logged_date)).toEqual(["2026-07-20", "2026-07-19"]);
  });
});

describe("deleteBodyWeightLog", () => {
  it("removes a logged entry", async () => {
    await logBodyWeight(conn, { client_uuid: "bw-11", logged_date: "2026-07-20", weight_kg: 78 });

    await deleteBodyWeightLog(conn, "bw-11");

    const row = await queryRow(conn, "SELECT id FROM body_weight_logs WHERE client_uuid = 'bw-11'");
    expect(row).toBeUndefined();
  });

  it("is a no-op for an already-deleted or never-landed client_uuid", async () => {
    await expect(deleteBodyWeightLog(conn, "never-existed")).resolves.not.toThrow();
  });
});
