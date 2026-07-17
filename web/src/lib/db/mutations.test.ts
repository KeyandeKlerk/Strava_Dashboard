import type { DuckDBConnection } from "@duckdb/node-api";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestConnection } from "./testHelper";
import { addDailySession, queryPlanDay } from "./mutations";

let conn: DuckDBConnection;

beforeEach(async () => {
  conn = await createTestConnection();
});

function baseSession(overrides: Partial<Parameters<typeof addDailySession>[1]> = {}) {
  return {
    planned_date: "2026-07-20",
    week_number: 1,
    day_of_week: "Monday",
    session_type: "cross_training",
    planned_distance_km: 0,
    intensity: "easy",
    description: "Volleyball",
    is_quality: false,
    ...overrides,
  };
}

describe("addDailySession", () => {
  it("allows two sessions of the same type on the same day", async () => {
    const id1 = await addDailySession(conn, baseSession({ description: "Volleyball" }));
    const id2 = await addDailySession(conn, baseSession({ description: "Easy spin on the bike" }));

    expect(id1).not.toBe(id2);

    const rows = await queryPlanDay(conn, id1, id2);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.description).sort()).toEqual(["Easy spin on the bike", "Volleyball"]);
  });
});
