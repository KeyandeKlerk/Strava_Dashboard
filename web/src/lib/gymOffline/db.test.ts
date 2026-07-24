import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { openDB } from "idb";
import { beforeEach, describe, expect, it } from "vitest";
import {
  getGymOfflineDb,
  listExercisesCache,
  listLastPerformanceCache,
  listPlanCache,
  replaceLastPerformanceCache,
  replacePlanCache,
  resetGymOfflineDbForTests,
  type GymOfflineDb,
} from "./db";
import type { PlanEntryInput } from "@/lib/db/gymMutations";

let db: GymOfflineDb;

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  resetGymOfflineDbForTests();
  db = await getGymOfflineDb();
});

// Helper: a plan entry with all target/grouping fields defaulted to null.
function entry(exerciseId: number, overrides: Partial<PlanEntryInput> = {}): PlanEntryInput {
  return { exerciseId, targetSets: null, targetReps: null, supersetGroup: null, ...overrides };
}

describe("planCache", () => {
  it("stores and replaces the weekly plan", async () => {
    await replacePlanCache(db, [
      { dayOfWeek: "Monday", entries: [entry(1), entry(2)] },
      { dayOfWeek: "Wednesday", entries: [entry(3)] },
    ]);
    expect(await listPlanCache(db)).toHaveLength(2);

    await replacePlanCache(db, [{ dayOfWeek: "Friday", entries: [entry(4)] }]);
    expect(await listPlanCache(db)).toEqual([{ dayOfWeek: "Friday", entries: [entry(4)] }]);
  });

  it("round-trips target sets/reps and superset group on entries", async () => {
    await replacePlanCache(db, [
      { dayOfWeek: "Monday", entries: [entry(1, { targetSets: 3, targetReps: 8, supersetGroup: 1 })] },
    ]);
    expect(await listPlanCache(db)).toEqual([
      { dayOfWeek: "Monday", entries: [{ exerciseId: 1, targetSets: 3, targetReps: 8, supersetGroup: 1 }] },
    ]);
  });
});

describe("lastPerformanceCache", () => {
  it("stores and replaces the last-performance-by-exercise cache", async () => {
    await replaceLastPerformanceCache(db, [
      { exerciseId: 1, sessionDate: "2026-07-20", sets: [{ setNumber: 1, weightKg: 60, reps: 8 }] },
      { exerciseId: 2, sessionDate: "2026-07-19", sets: [{ setNumber: 1, weightKg: 20, reps: 15 }] },
    ]);
    expect(await listLastPerformanceCache(db)).toHaveLength(2);

    await replaceLastPerformanceCache(db, [
      { exerciseId: 3, sessionDate: "2026-07-21", sets: [{ setNumber: 1, weightKg: 100, reps: 5 }] },
    ]);
    expect(await listLastPerformanceCache(db)).toEqual([
      { exerciseId: 3, sessionDate: "2026-07-21", sets: [{ setNumber: 1, weightKg: 100, reps: 5 }] },
    ]);
  });
});

describe("v2 -> v3 migration", () => {
  it("adds lastPerformanceCache to an existing v2 database without losing existing data", async () => {
    globalThis.indexedDB = new IDBFactory();
    resetGymOfflineDbForTests();

    // Simulate an install that's already on the current (pre-this-change) v2 schema.
    const v2 = await openDB("gym-offline", 2, {
      upgrade(db) {
        const mutations = db.createObjectStore("pendingMutations", { keyPath: "clientUuid" });
        mutations.createIndex("by-createdAt", "createdAt");
        db.createObjectStore("exercisesCache", { keyPath: "id" });
        db.createObjectStore("sessionsCache", { keyPath: "clientUuid" });
        const sets = db.createObjectStore("setsCache", { keyPath: "clientUuid" });
        sets.createIndex("by-sessionClientUuid", "sessionClientUuid");
        db.createObjectStore("recentSessionsCache", { keyPath: "id" });
        db.createObjectStore("planCache", { keyPath: "dayOfWeek" });
      },
    });
    await v2.put("exercisesCache", {
      id: 1,
      client_uuid: null,
      name: "Existing Exercise",
      muscle_group: "Chest",
      equipment: null,
      is_custom: false,
    });
    await v2.put("planCache", { dayOfWeek: "Monday", entries: [entry(1)] });
    v2.close();

    const migrated = await getGymOfflineDb();
    const exercises = await listExercisesCache(migrated);
    expect(exercises).toHaveLength(1);
    expect(exercises[0].name).toBe("Existing Exercise");
    expect(await listPlanCache(migrated)).toEqual([{ dayOfWeek: "Monday", entries: [entry(1)] }]);

    await replaceLastPerformanceCache(migrated, [
      { exerciseId: 1, sessionDate: "2026-07-20", sets: [{ setNumber: 1, weightKg: 60, reps: 8 }] },
    ]);
    expect(await listLastPerformanceCache(migrated)).toEqual([
      { exerciseId: 1, sessionDate: "2026-07-20", sets: [{ setNumber: 1, weightKg: 60, reps: 8 }] },
    ]);
  });
});

describe("v1 -> v2 migration", () => {
  it("adds planCache to an existing v1 database without losing existing data", async () => {
    globalThis.indexedDB = new IDBFactory();
    resetGymOfflineDbForTests();

    // Simulate an install that's already on the current (pre-this-change) v1 schema.
    const v1 = await openDB("gym-offline", 1, {
      upgrade(db) {
        const mutations = db.createObjectStore("pendingMutations", { keyPath: "clientUuid" });
        mutations.createIndex("by-createdAt", "createdAt");
        db.createObjectStore("exercisesCache", { keyPath: "id" });
        db.createObjectStore("sessionsCache", { keyPath: "clientUuid" });
        const sets = db.createObjectStore("setsCache", { keyPath: "clientUuid" });
        sets.createIndex("by-sessionClientUuid", "sessionClientUuid");
        db.createObjectStore("recentSessionsCache", { keyPath: "id" });
      },
    });
    await v1.put("exercisesCache", {
      id: 1,
      client_uuid: null,
      name: "Existing Exercise",
      muscle_group: "Chest",
      equipment: null,
      is_custom: false,
    });
    v1.close();

    const migrated = await getGymOfflineDb();
    const exercises = await listExercisesCache(migrated);
    expect(exercises).toHaveLength(1);
    expect(exercises[0].name).toBe("Existing Exercise");

    await replacePlanCache(migrated, [{ dayOfWeek: "Monday", entries: [entry(1)] }]);
    expect(await listPlanCache(migrated)).toEqual([{ dayOfWeek: "Monday", entries: [entry(1)] }]);
  });
});
