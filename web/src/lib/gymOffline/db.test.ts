import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { openDB } from "idb";
import { beforeEach, describe, expect, it } from "vitest";
import {
  getGymOfflineDb,
  listExercisesCache,
  listPlanCache,
  replacePlanCache,
  resetGymOfflineDbForTests,
  type GymOfflineDb,
} from "./db";

let db: GymOfflineDb;

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  resetGymOfflineDbForTests();
  db = await getGymOfflineDb();
});

describe("planCache", () => {
  it("stores and replaces the weekly plan", async () => {
    await replacePlanCache(db, [
      { dayOfWeek: "Monday", exerciseIds: [1, 2] },
      { dayOfWeek: "Wednesday", exerciseIds: [3] },
    ]);
    expect(await listPlanCache(db)).toHaveLength(2);

    await replacePlanCache(db, [{ dayOfWeek: "Friday", exerciseIds: [4] }]);
    expect(await listPlanCache(db)).toEqual([{ dayOfWeek: "Friday", exerciseIds: [4] }]);
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

    await replacePlanCache(migrated, [{ dayOfWeek: "Monday", exerciseIds: [1] }]);
    expect(await listPlanCache(migrated)).toEqual([{ dayOfWeek: "Monday", exerciseIds: [1] }]);
  });
});
