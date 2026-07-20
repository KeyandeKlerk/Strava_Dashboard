import type { DuckDBConnection } from "@duckdb/node-api";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestConnection } from "./testHelper";
import {
  addDailySession,
  addNutritionLog,
  deleteDailySession,
  deleteNutritionLog,
  moveDailySession,
  queryPlanDay,
  upsertActivity,
  upsertNutritionTargets,
} from "./mutations";
import { queryRow } from "./client";

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

describe("deleteDailySession", () => {
  it("removes a non-completed session", async () => {
    const id = await addDailySession(conn, baseSession());
    const result = await deleteDailySession(conn, id);

    expect(result.error).toBeUndefined();
    const rows = await queryPlanDay(conn, id);
    expect(rows).toHaveLength(0);
  });

  it("refuses to remove a completed session", async () => {
    const id = await addDailySession(conn, baseSession());
    await conn.run("UPDATE training_plan_daily SET completed = TRUE WHERE id = $id", { id });

    const result = await deleteDailySession(conn, id);

    expect(result.error).toBe("Can't remove a completed session.");
    const rows = await queryPlanDay(conn, id);
    expect(rows).toHaveLength(1);
  });
});

describe("moveDailySession", () => {
  it("moves a session to an empty day", async () => {
    const id = await addDailySession(conn, baseSession({ planned_date: "2026-07-20", day_of_week: "Monday" }));

    const result = await moveDailySession(conn, id, "2026-07-22");

    expect(result.error).toBeUndefined();
    const [row] = await queryPlanDay(conn, id);
    expect(row.planned_date).toBe("2026-07-22");
    expect(row.day_of_week).toBe("Wednesday");
  });

  it("swaps with the one existing session of the same type on the target day", async () => {
    const tuesday = await addDailySession(
      conn,
      baseSession({ planned_date: "2026-07-21", day_of_week: "Tuesday", session_type: "easy_run", description: "Tuesday run" }),
    );
    const thursday = await addDailySession(
      conn,
      baseSession({ planned_date: "2026-07-23", day_of_week: "Thursday", session_type: "easy_run", description: "Thursday run" }),
    );

    const result = await moveDailySession(conn, tuesday, "2026-07-23");

    expect(result.error).toBeUndefined();
    const rows = await queryPlanDay(conn, tuesday, thursday);
    const movedToThursday = rows.find((r) => r.id === tuesday)!;
    const movedToTuesday = rows.find((r) => r.id === thursday)!;
    expect(movedToThursday.planned_date).toBe("2026-07-23");
    expect(movedToThursday.day_of_week).toBe("Thursday");
    expect(movedToTuesday.planned_date).toBe("2026-07-21");
    expect(movedToTuesday.day_of_week).toBe("Tuesday");
  });

  it("blocks moving a completed session", async () => {
    const id = await addDailySession(conn, baseSession({ planned_date: "2026-07-20" }));
    await conn.run("UPDATE training_plan_daily SET completed = TRUE WHERE id = $id", { id });

    const result = await moveDailySession(conn, id, "2026-07-22");

    expect(result.error).toBe("Can't move a completed session.");
    const [row] = await queryPlanDay(conn, id);
    expect(row.planned_date).toBe("2026-07-20");
  });

  it("blocks moving onto a day whose same-type session is completed", async () => {
    const source = await addDailySession(conn, baseSession({ planned_date: "2026-07-20", session_type: "easy_run" }));
    const target = await addDailySession(conn, baseSession({ planned_date: "2026-07-22", session_type: "easy_run" }));
    await conn.run("UPDATE training_plan_daily SET completed = TRUE WHERE id = $id", { id: target });

    const result = await moveDailySession(conn, source, "2026-07-22");

    expect(result.error).toBe("That day's session is already completed and can't be replaced.");
    const [row] = await queryPlanDay(conn, source);
    expect(row.planned_date).toBe("2026-07-20");
  });

  it("blocks moving a session to a different week", async () => {
    const id = await addDailySession(conn, baseSession({ planned_date: "2026-07-20", day_of_week: "Monday" }));

    const result = await moveDailySession(conn, id, "2026-07-27");

    expect(result.error).toBe("Can't move a session to a different week.");
    const [row] = await queryPlanDay(conn, id);
    expect(row.planned_date).toBe("2026-07-20");
  });

  it("blocks moving onto a day that already has two or more sessions of that type", async () => {
    const source = await addDailySession(conn, baseSession({ planned_date: "2026-07-20", session_type: "cross_training" }));
    await addDailySession(conn, baseSession({ planned_date: "2026-07-22", session_type: "cross_training", description: "Volleyball" }));
    await addDailySession(conn, baseSession({ planned_date: "2026-07-22", session_type: "cross_training", description: "Cycling" }));

    const result = await moveDailySession(conn, source, "2026-07-22");

    expect(result.error).toBe("That day already has 2 cross training sessions — remove one first or pick a different day.");
    const [row] = await queryPlanDay(conn, source);
    expect(row.planned_date).toBe("2026-07-20");
  });
});

describe("upsertNutritionTargets", () => {
  it("inserts then updates the single target row in place", async () => {
    await upsertNutritionTargets(conn, { target_carbs_g_per_hour: 60, target_sodium_mg_per_hour: 500 });
    await upsertNutritionTargets(conn, { target_carbs_g_per_hour: 90, target_sodium_mg_per_hour: 700, target_fluid_ml_per_hour: 500 });

    const row = await queryRow<{ target_carbs_g_per_hour: number; target_sodium_mg_per_hour: number; target_fluid_ml_per_hour: number }>(
      conn,
      "SELECT target_carbs_g_per_hour, target_sodium_mg_per_hour, target_fluid_ml_per_hour FROM nutrition_targets",
    );
    expect(row?.target_carbs_g_per_hour).toBe(90);
    expect(row?.target_sodium_mg_per_hour).toBe(700);
    expect(row?.target_fluid_ml_per_hour).toBe(500);

    const countRow = await queryRow<{ n: number | bigint }>(conn, "SELECT COUNT(*) AS n FROM nutrition_targets");
    expect(Number(countRow?.n)).toBe(1);
  });
});

describe("addNutritionLog / deleteNutritionLog", () => {
  it("adds a log entry tied to an activity and returns its id", async () => {
    await upsertActivity(conn, { id: 501, name: "Long run", category: "running", start_date_local: "2026-03-01T07:00:00", moving_time_min: 180 });

    const id = await addNutritionLog(conn, {
      activity_id: 501,
      logged_date: "2026-03-01",
      carbs_g: 200,
      sodium_mg: 1500,
      fluid_ml: 1200,
      notes: "2x gels/hr",
    });

    const row = await queryRow<{ activity_id: number; carbs_g: number }>(
      conn,
      "SELECT activity_id, carbs_g FROM nutrition_logs WHERE id = $id",
      { id },
    );
    expect(row?.activity_id).toBe(501);
    expect(row?.carbs_g).toBe(200);
  });

  it("removes a log entry", async () => {
    await upsertActivity(conn, { id: 502, name: "Long run", category: "running", start_date_local: "2026-03-01T07:00:00", moving_time_min: 180 });
    const id = await addNutritionLog(conn, { activity_id: 502, logged_date: "2026-03-01", carbs_g: 200, sodium_mg: 1500 });

    await deleteNutritionLog(conn, id);

    const row = await queryRow(conn, "SELECT id FROM nutrition_logs WHERE id = $id", { id });
    expect(row).toBeUndefined();
  });
});
