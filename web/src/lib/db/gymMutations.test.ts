import type { DuckDBConnection } from "@duckdb/node-api";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestConnection } from "./testHelper";
import { queryRow, queryRows } from "./client";
import { upsertActivity } from "./mutations";
import {
  addCustomExercise,
  addGymSet,
  correlateGymSessionsToActivities,
  deleteGymSession,
  deleteGymSet,
  getGymSessionByActivityId,
  getGymSessionDetail,
  getWeeklyPlan,
  listGymExercises,
  listRecentGymSessions,
  setPlanForDay,
  updateGymSessionNotes,
  upsertGymSession,
} from "./gymMutations";

let conn: DuckDBConnection;

beforeEach(async () => {
  conn = await createTestConnection();
});

describe("listGymExercises", () => {
  it("returns the seeded curated exercise library", async () => {
    const rows = await listGymExercises(conn);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.name === "Barbell Bench Press")).toBe(true);
  });
});

describe("addCustomExercise", () => {
  it("creates a new custom exercise", async () => {
    const result = await addCustomExercise(conn, {
      client_uuid: "ex-1",
      name: "Reverse Nordic Curl",
      muscle_group: "Quads",
    });
    expect(result.client_uuid).toBe("ex-1");

    const rows = await listGymExercises(conn);
    const created = rows.find((r) => r.name === "Reverse Nordic Curl");
    expect(created?.is_custom).toBe(true);
  });

  it("is idempotent when retried with the same client_uuid", async () => {
    const first = await addCustomExercise(conn, {
      client_uuid: "ex-2",
      name: "Zercher Squat",
      muscle_group: "Quads",
    });
    const second = await addCustomExercise(conn, {
      client_uuid: "ex-2",
      name: "Zercher Squat",
      muscle_group: "Quads",
    });
    expect(second.id).toBe(first.id);

    const rows = await queryRows<{ count: number | bigint }>(
      conn,
      "SELECT COUNT(*) AS count FROM gym_exercises WHERE name = 'Zercher Squat'",
    );
    expect(Number(rows[0].count)).toBe(1);
  });

  it("reuses an existing exercise when the name matches case-insensitively", async () => {
    const result = await addCustomExercise(conn, {
      client_uuid: "ex-3",
      name: "barbell bench press",
      muscle_group: "Chest",
    });
    expect(result.client_uuid).not.toBe("ex-3");

    const rows = await queryRows<{ count: number | bigint }>(
      conn,
      "SELECT COUNT(*) AS count FROM gym_exercises WHERE lower(name) = 'barbell bench press'",
    );
    expect(Number(rows[0].count)).toBe(1);
  });
});

describe("upsertGymSession", () => {
  it("creates a session on first call", async () => {
    const result = await upsertGymSession(conn, {
      client_uuid: "sess-1",
      session_date: "2026-07-20",
    });
    expect(result.client_uuid).toBe("sess-1");
  });

  it("is idempotent and merges fields across start/end replays", async () => {
    const start = await upsertGymSession(conn, {
      client_uuid: "sess-2",
      session_date: "2026-07-20",
      started_at: "2026-07-20T06:00:00",
    });
    const end = await upsertGymSession(conn, {
      client_uuid: "sess-2",
      session_date: "2026-07-20",
      ended_at: "2026-07-20T07:00:00",
    });
    expect(end.id).toBe(start.id);

    const detail = await getGymSessionDetail(conn, start.id);
    expect(detail?.started_at).toContain("2026-07-20 06:00:00");
    expect(detail?.ended_at).toContain("2026-07-20 07:00:00");
  });

  it("does not null out a synced field when a stale retry replays without it", async () => {
    const session = await upsertGymSession(conn, {
      client_uuid: "sess-3",
      session_date: "2026-07-20",
      activity_id: 555,
    });
    // Simulates a "start" mutation retried after "end"/link already landed.
    await upsertGymSession(conn, {
      client_uuid: "sess-3",
      session_date: "2026-07-20",
    });

    const detail = await getGymSessionDetail(conn, session.id);
    expect(detail?.activity_id).toBe(555);
  });
});

describe("addGymSet", () => {
  it("resolves session_id by session_client_uuid and inserts the set", async () => {
    const session = await upsertGymSession(conn, { client_uuid: "sess-4", session_date: "2026-07-20" });
    const exercises = await listGymExercises(conn);
    const exerciseId = exercises[0].id;

    const result = await addGymSet(conn, {
      client_uuid: "set-1",
      session_client_uuid: "sess-4",
      exercise_id: exerciseId,
      set_number: 1,
      weight_kg: 100,
      reps: 5,
    });
    expect("error" in result).toBe(false);

    const detail = await getGymSessionDetail(conn, session.id);
    expect(detail?.sets).toHaveLength(1);
    expect(detail?.sets[0].weight_kg).toBe(100);
  });

  it("is idempotent when retried with the same client_uuid", async () => {
    await upsertGymSession(conn, { client_uuid: "sess-5", session_date: "2026-07-20" });
    const exercises = await listGymExercises(conn);
    const exerciseId = exercises[0].id;

    await addGymSet(conn, {
      client_uuid: "set-2",
      session_client_uuid: "sess-5",
      exercise_id: exerciseId,
      set_number: 1,
      weight_kg: 80,
      reps: 8,
    });
    await addGymSet(conn, {
      client_uuid: "set-2",
      session_client_uuid: "sess-5",
      exercise_id: exerciseId,
      set_number: 1,
      weight_kg: 80,
      reps: 8,
    });

    const rows = await queryRows<{ count: number | bigint }>(
      conn,
      "SELECT COUNT(*) AS count FROM gym_sets WHERE client_uuid = 'set-2'",
    );
    expect(Number(rows[0].count)).toBe(1);
  });

  it("returns an error when the session hasn't synced yet", async () => {
    const exercises = await listGymExercises(conn);
    const result = await addGymSet(conn, {
      client_uuid: "set-3",
      session_client_uuid: "never-synced",
      exercise_id: exercises[0].id,
      set_number: 1,
      weight_kg: 50,
      reps: 10,
    });
    expect("error" in result).toBe(true);
  });

  it("defaults is_warmup to false when not provided", async () => {
    const session = await upsertGymSession(conn, { client_uuid: "sess-warmup-default", session_date: "2026-07-20" });
    const exercises = await listGymExercises(conn);
    await addGymSet(conn, {
      client_uuid: "set-warmup-default",
      session_client_uuid: "sess-warmup-default",
      exercise_id: exercises[0].id,
      set_number: 1,
      weight_kg: 50,
      reps: 10,
    });

    const detail = await getGymSessionDetail(conn, session.id);
    expect(detail?.sets[0].is_warmup).toBe(false);
  });

  it("persists is_warmup: true and round-trips it through getGymSessionDetail", async () => {
    const session = await upsertGymSession(conn, { client_uuid: "sess-warmup-true", session_date: "2026-07-20" });
    const exercises = await listGymExercises(conn);
    await addGymSet(conn, {
      client_uuid: "set-warmup-true",
      session_client_uuid: "sess-warmup-true",
      exercise_id: exercises[0].id,
      set_number: 1,
      weight_kg: 20,
      reps: 15,
      is_warmup: true,
    });

    const detail = await getGymSessionDetail(conn, session.id);
    expect(detail?.sets[0].is_warmup).toBe(true);
  });

  it("defaults rpe to null when not provided", async () => {
    const session = await upsertGymSession(conn, { client_uuid: "sess-rpe-default", session_date: "2026-07-20" });
    const exercises = await listGymExercises(conn);
    await addGymSet(conn, {
      client_uuid: "set-rpe-default",
      session_client_uuid: "sess-rpe-default",
      exercise_id: exercises[0].id,
      set_number: 1,
      weight_kg: 50,
      reps: 10,
    });

    const detail = await getGymSessionDetail(conn, session.id);
    expect(detail?.sets[0].rpe).toBe(null);
  });

  it("persists rpe and round-trips it through getGymSessionDetail", async () => {
    const session = await upsertGymSession(conn, { client_uuid: "sess-rpe-set", session_date: "2026-07-20" });
    const exercises = await listGymExercises(conn);
    await addGymSet(conn, {
      client_uuid: "set-rpe-set",
      session_client_uuid: "sess-rpe-set",
      exercise_id: exercises[0].id,
      set_number: 1,
      weight_kg: 20,
      reps: 15,
      rpe: 8.5,
    });

    const detail = await getGymSessionDetail(conn, session.id);
    expect(detail?.sets[0].rpe).toBe(8.5);
  });
});

describe("deleteGymSet", () => {
  it("removes a set", async () => {
    await upsertGymSession(conn, { client_uuid: "sess-6", session_date: "2026-07-20" });
    const exercises = await listGymExercises(conn);
    await addGymSet(conn, {
      client_uuid: "set-4",
      session_client_uuid: "sess-6",
      exercise_id: exercises[0].id,
      set_number: 1,
      weight_kg: 60,
      reps: 10,
    });

    await deleteGymSet(conn, "set-4");

    const row = await queryRow(conn, "SELECT id FROM gym_sets WHERE client_uuid = 'set-4'");
    expect(row).toBeUndefined();
  });

  it("is a no-op for an already-deleted or never-landed client_uuid", async () => {
    await expect(deleteGymSet(conn, "never-existed")).resolves.not.toThrow();
  });
});

describe("deleteGymSession", () => {
  it("removes the session from listRecentGymSessions", async () => {
    const session = await upsertGymSession(conn, { client_uuid: "sess-13", session_date: "2026-07-20" });

    await deleteGymSession(conn, "sess-13");

    const rows = await listRecentGymSessions(conn);
    expect(rows.some((r) => r.id === session.id)).toBe(false);
  });

  it("removes the session's sets along with it", async () => {
    const session = await upsertGymSession(conn, { client_uuid: "sess-14", session_date: "2026-07-20" });
    const exercises = await listGymExercises(conn);
    await addGymSet(conn, {
      client_uuid: "set-6",
      session_client_uuid: "sess-14",
      exercise_id: exercises[0].id,
      set_number: 1,
      weight_kg: 40,
      reps: 12,
    });

    await deleteGymSession(conn, "sess-14");

    const detail = await getGymSessionDetail(conn, session.id);
    expect(detail).toBeNull();

    const setRow = await queryRow(conn, "SELECT id FROM gym_sets WHERE client_uuid = 'set-6'");
    expect(setRow).toBeUndefined();
  });

  it("is a no-op for an already-deleted or never-landed client_uuid", async () => {
    await expect(deleteGymSession(conn, "never-existed-session")).resolves.not.toThrow();
  });
});

describe("updateGymSessionNotes", () => {
  it("updates a session's notes", async () => {
    const session = await upsertGymSession(conn, { client_uuid: "sess-notes-1", session_date: "2026-07-20" });

    await updateGymSessionNotes(conn, "sess-notes-1", "Great workout, felt strong");

    const detail = await getGymSessionDetail(conn, session.id);
    expect(detail?.notes).toBe("Great workout, felt strong");
  });

  it("clears notes when passed null", async () => {
    const session = await upsertGymSession(conn, {
      client_uuid: "sess-notes-2",
      session_date: "2026-07-20",
      notes: "Initial notes",
    });

    await updateGymSessionNotes(conn, "sess-notes-2", null);

    const detail = await getGymSessionDetail(conn, session.id);
    expect(detail?.notes).toBeNull();
  });

  it("is a no-op for an already-deleted or never-landed client_uuid", async () => {
    await expect(updateGymSessionNotes(conn, "never-existed-session", "notes")).resolves.not.toThrow();
  });
});

describe("listRecentGymSessions / getGymSessionByActivityId", () => {
  it("lists sessions with set counts and volume", async () => {
    await upsertGymSession(conn, { client_uuid: "sess-7", session_date: "2026-07-20" });
    const exercises = await listGymExercises(conn);
    await addGymSet(conn, {
      client_uuid: "set-5",
      session_client_uuid: "sess-7",
      exercise_id: exercises[0].id,
      set_number: 1,
      weight_kg: 100,
      reps: 5,
    });

    const rows = await listRecentGymSessions(conn);
    expect(rows).toHaveLength(1);
    expect(rows[0].set_count).toBe(1);
    expect(rows[0].total_volume_kg).toBe(500);
  });

  it("finds a session by its linked activity_id", async () => {
    const session = await upsertGymSession(conn, {
      client_uuid: "sess-8",
      session_date: "2026-07-20",
      activity_id: 777,
    });
    const found = await getGymSessionByActivityId(conn, 777);
    expect(found?.id).toBe(session.id);
  });
});

describe("correlateGymSessionsToActivities", () => {
  it("links a standalone session to a same-day unclaimed gym activity", async () => {
    await upsertActivity(conn, {
      id: 9001,
      name: "Gym",
      category: "gym",
      start_date_local: "2026-07-20T06:00:00",
    });
    const session = await upsertGymSession(conn, { client_uuid: "sess-9", session_date: "2026-07-20" });

    const linkedCount = await correlateGymSessionsToActivities(conn);
    expect(linkedCount).toBe(1);

    const detail = await getGymSessionDetail(conn, session.id);
    expect(detail?.activity_id).toBe(9001);
  });

  it("does not claim an activity already linked to another session", async () => {
    await upsertActivity(conn, {
      id: 9002,
      name: "Gym",
      category: "gym",
      start_date_local: "2026-07-21T06:00:00",
    });
    await upsertGymSession(conn, { client_uuid: "sess-10", session_date: "2026-07-21", activity_id: 9002 });
    const secondSession = await upsertGymSession(conn, { client_uuid: "sess-11", session_date: "2026-07-21" });

    await correlateGymSessionsToActivities(conn);

    const detail = await getGymSessionDetail(conn, secondSession.id);
    expect(detail?.activity_id).toBeNull();
  });

  it("is a no-op when there's no matching activity", async () => {
    const session = await upsertGymSession(conn, { client_uuid: "sess-12", session_date: "2026-07-22" });
    await correlateGymSessionsToActivities(conn);
    const detail = await getGymSessionDetail(conn, session.id);
    expect(detail?.activity_id).toBeNull();
  });
});

describe("getWeeklyPlan / setPlanForDay", () => {
  it("returns an empty plan when nothing has been set", async () => {
    const plan = await getWeeklyPlan(conn);
    expect(plan).toEqual({});
  });

  it("sets and retrieves an ordered exercise list for a day", async () => {
    const exercises = await listGymExercises(conn);
    const squat = exercises.find((e) => e.name === "Barbell Back Squat")!;
    const legPress = exercises.find((e) => e.name === "Leg Press")!;

    await setPlanForDay(conn, "Monday", [squat.id, legPress.id]);

    const plan = await getWeeklyPlan(conn);
    expect(plan["Monday"].map((e) => e.name)).toEqual(["Barbell Back Squat", "Leg Press"]);
  });

  it("replaces (not appends to) a day's plan on a second call", async () => {
    const exercises = await listGymExercises(conn);
    const squat = exercises.find((e) => e.name === "Barbell Back Squat")!;
    const curl = exercises.find((e) => e.name === "Barbell Curl")!;

    await setPlanForDay(conn, "Monday", [squat.id]);
    await setPlanForDay(conn, "Monday", [curl.id]);

    const plan = await getWeeklyPlan(conn);
    expect(plan["Monday"].map((e) => e.name)).toEqual(["Barbell Curl"]);
  });

  it("leaves other days untouched", async () => {
    const exercises = await listGymExercises(conn);
    const squat = exercises.find((e) => e.name === "Barbell Back Squat")!;
    const curl = exercises.find((e) => e.name === "Barbell Curl")!;

    await setPlanForDay(conn, "Monday", [squat.id]);
    await setPlanForDay(conn, "Wednesday", [curl.id]);

    const plan = await getWeeklyPlan(conn);
    expect(plan["Monday"].map((e) => e.name)).toEqual(["Barbell Back Squat"]);
    expect(plan["Wednesday"].map((e) => e.name)).toEqual(["Barbell Curl"]);
  });
});
