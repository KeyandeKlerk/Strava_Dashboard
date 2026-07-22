import type { DuckDBConnection } from "@duckdb/node-api";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestConnection } from "./db/testHelper";
import { addCustomExercise, addGymSet, upsertGymSession } from "./db/gymMutations";
import {
  estimatedOneRepMax,
  exerciseProgression,
  gymSessionsPerWeek,
  muscleGroupFrequency,
  muscleGroupWeeklyVolume,
  personalRecords,
  sessionVolume,
  weeklyGymVolume,
} from "./gymMetrics";

let conn: DuckDBConnection;

beforeEach(async () => {
  conn = await createTestConnection();
});

describe("estimatedOneRepMax", () => {
  it("returns the weight itself for a single rep", () => {
    expect(estimatedOneRepMax(100, 1)).toBeCloseTo(103.33, 1);
  });

  it("applies the Epley formula for multiple reps", () => {
    expect(estimatedOneRepMax(100, 10)).toBeCloseTo(133.33, 1);
  });
});

describe("exerciseProgression / personalRecords", () => {
  let exerciseId: number;

  beforeEach(async () => {
    const exercise = await addCustomExercise(conn, {
      client_uuid: "ex-bench",
      name: "Test Bench Press",
      muscle_group: "Chest",
    });
    exerciseId = exercise.id;

    // Session 1: heaviest weight (120x1, est1RM 124) but not the best est1RM.
    const session1 = await upsertGymSession(conn, { client_uuid: "sess-1", session_date: "2026-07-01" });
    await addGymSet(conn, {
      client_uuid: "set-1",
      session_client_uuid: session1.client_uuid,
      exercise_id: exerciseId,
      set_number: 1,
      weight_kg: 120,
      reps: 1,
    });

    // Session 2: lighter weight but higher reps gives a better est1RM (100x8, est1RM 126.67).
    const session2 = await upsertGymSession(conn, { client_uuid: "sess-2", session_date: "2026-07-08" });
    await addGymSet(conn, {
      client_uuid: "set-2",
      session_client_uuid: session2.client_uuid,
      exercise_id: exerciseId,
      set_number: 1,
      weight_kg: 100,
      reps: 8,
    });
  });

  it("tracks top weight and best est. 1RM independently per session", async () => {
    const rows = await exerciseProgression(conn, exerciseId);
    expect(rows).toHaveLength(2);
    expect(rows[0].session_date).toBe("2026-07-01");
    expect(rows[0].top_weight_kg).toBe(120);
    expect(rows[1].session_date).toBe("2026-07-08");
    expect(rows[1].top_weight_kg).toBe(100);
  });

  it("attributes the heaviest weight and best est. 1RM to different sets/dates", async () => {
    const [record] = await personalRecords(conn);
    expect(record.exercise_name).toBe("Test Bench Press");
    expect(record.max_weight_kg).toBe(120);
    expect(record.max_weight_date).toBe("2026-07-01");
    expect(record.best_est_1rm).toBeCloseTo(126.67, 1);
    expect(record.best_est_1rm_date).toBe("2026-07-08");
  });
});

describe("volume aggregations", () => {
  beforeEach(async () => {
    const chest = await addCustomExercise(conn, { client_uuid: "ex-chest", name: "Vol Chest", muscle_group: "Chest" });
    const quads = await addCustomExercise(conn, { client_uuid: "ex-quads", name: "Vol Quads", muscle_group: "Quads" });

    const session = await upsertGymSession(conn, { client_uuid: "sess-vol-1", session_date: "2026-07-06" });
    await addGymSet(conn, {
      client_uuid: "set-vol-1",
      session_client_uuid: session.client_uuid,
      exercise_id: chest.id,
      set_number: 1,
      weight_kg: 100,
      reps: 5,
    });
    await addGymSet(conn, {
      client_uuid: "set-vol-2",
      session_client_uuid: session.client_uuid,
      exercise_id: quads.id,
      set_number: 1,
      weight_kg: 150,
      reps: 4,
    });
  });

  it("computes total volume per session", async () => {
    const rows = await sessionVolume(conn);
    expect(rows[0].total_volume_kg).toBe(100 * 5 + 150 * 4);
  });

  it("computes total volume per week", async () => {
    const rows = await weeklyGymVolume(conn);
    expect(rows).toHaveLength(1);
    expect(rows[0].total_volume_kg).toBe(100 * 5 + 150 * 4);
  });

  it("splits weekly volume per muscle group", async () => {
    const rows = await muscleGroupWeeklyVolume(conn);
    const byGroup = Object.fromEntries(rows.map((r) => [r.muscle_group, r.total_volume_kg]));
    expect(byGroup["Chest"]).toBe(500);
    expect(byGroup["Quads"]).toBe(600);
  });
});

describe("consistency metrics", () => {
  it("counts sessions per week", async () => {
    await upsertGymSession(conn, { client_uuid: "sess-c1", session_date: "2026-07-06" });
    await upsertGymSession(conn, { client_uuid: "sess-c2", session_date: "2026-07-08" });
    await upsertGymSession(conn, { client_uuid: "sess-c3", session_date: "2026-07-15" });

    const rows = await gymSessionsPerWeek(conn);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.week_start.startsWith("2026-07-06"))?.session_count).toBe(2);
  });

  it("reports last-trained date and recent frequency per muscle group", async () => {
    const exercise = await addCustomExercise(conn, {
      client_uuid: "ex-freq",
      name: "Freq Test Exercise",
      muscle_group: "Back Test",
    });
    const session = await upsertGymSession(conn, { client_uuid: "sess-freq", session_date: "2026-07-20" });
    await addGymSet(conn, {
      client_uuid: "set-freq",
      session_client_uuid: session.client_uuid,
      exercise_id: exercise.id,
      set_number: 1,
      weight_kg: 50,
      reps: 10,
    });

    const rows = await muscleGroupFrequency(conn);
    const row = rows.find((r) => r.muscle_group === "Back Test");
    expect(row?.last_trained_date).toBe("2026-07-20");
  });
});
