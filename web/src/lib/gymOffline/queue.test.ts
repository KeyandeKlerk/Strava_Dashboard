import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import {
  enqueueMutation,
  findExerciseByClientUuid,
  getGymOfflineDb,
  listPendingMutations,
  listSetsForSession,
  putExerciseCache,
  putSessionCache,
  putSetCache,
  resetGymOfflineDbForTests,
  type GymOfflineDb,
} from "./db";
import { flushQueue } from "./queue";

function jsonResponse(body: unknown, init: { status?: number; ok?: boolean; contentType?: string } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    redirected: false,
    headers: new Headers({ "content-type": init.contentType ?? "application/json" }),
    json: async () => body,
  } as unknown as Response;
}

let db: GymOfflineDb;

beforeEach(async () => {
  // Fresh IndexedDB + a fresh module-level handle per test, so tests never
  // see another test's data.
  globalThis.indexedDB = new IDBFactory();
  resetGymOfflineDbForTests();
  db = await getGymOfflineDb();
});

describe("flushQueue ordering", () => {
  it("sends pending mutations in createdAt (FIFO) order", async () => {
    const calls: string[] = [];
    await enqueueMutation(db, {
      clientUuid: "m2",
      type: "create_set",
      payload: { client_uuid: "s2", session_client_uuid: "sess-1", exercise_id: 1, set_number: 1, weight_kg: 1, reps: 1 },
      createdAt: 2,
    });
    await enqueueMutation(db, {
      clientUuid: "m1",
      type: "create_session",
      payload: { client_uuid: "sess-1", session_date: "2026-07-20" },
      createdAt: 1,
    });

    const fetchImpl = (async (url: string) => {
      calls.push(String(url));
      if (String(url).includes("sessions")) return jsonResponse({ id: 1, client_uuid: "sess-1" });
      return jsonResponse({ id: 10, client_uuid: "s2" });
    }) as typeof fetch;

    const result = await flushQueue(fetchImpl, db);

    expect(calls).toEqual(["/api/gym/sessions", "/api/gym/sets"]);
    expect(result).toEqual({ sentCount: 2, stoppedReason: null });
    expect(await listPendingMutations(db)).toHaveLength(0);
  });
});

describe("flushQueue failure handling", () => {
  it("stops on the first network failure, leaving the remainder queued", async () => {
    await enqueueMutation(db, {
      clientUuid: "m1",
      type: "create_session",
      payload: { client_uuid: "sess-1", session_date: "2026-07-20" },
      createdAt: 1,
    });
    await enqueueMutation(db, {
      clientUuid: "m2",
      type: "create_session",
      payload: { client_uuid: "sess-2", session_date: "2026-07-21" },
      createdAt: 2,
    });

    let callCount = 0;
    const fetchImpl = (async () => {
      callCount++;
      if (callCount === 1) throw new Error("network down");
      return jsonResponse({ id: 2, client_uuid: "sess-2" });
    }) as typeof fetch;

    const result = await flushQueue(fetchImpl, db);

    expect(result).toEqual({ sentCount: 0, stoppedReason: "network" });
    expect(callCount).toBe(1);
    expect(await listPendingMutations(db)).toHaveLength(2);
  });

  it("treats a non-JSON (login redirect) response as an auth failure and stops", async () => {
    await enqueueMutation(db, {
      clientUuid: "m1",
      type: "create_session",
      payload: { client_uuid: "sess-1", session_date: "2026-07-20" },
      createdAt: 1,
    });

    const fetchImpl = (async () =>
      jsonResponse("<html>login</html>", { contentType: "text/html" })) as unknown as typeof fetch;

    const result = await flushQueue(fetchImpl, db);
    expect(result).toEqual({ sentCount: 0, stoppedReason: "auth" });
  });

  it("blocks a create_set mutation whose session hasn't synced yet (409), without erroring", async () => {
    await enqueueMutation(db, {
      clientUuid: "m1",
      type: "create_set",
      payload: { client_uuid: "set-1", session_client_uuid: "never-synced", exercise_id: 1, set_number: 1, weight_kg: 1, reps: 1 },
      createdAt: 1,
    });

    const fetchImpl = (async () =>
      jsonResponse({ error: "Session not synced yet." }, { ok: false, status: 409 })) as typeof fetch;

    const result = await flushQueue(fetchImpl, db);
    expect(result).toEqual({ sentCount: 0, stoppedReason: "blocked" });
  });
});

describe("exercise placeholder resolution", () => {
  it("resolves a create_set's exercise_client_uuid to a real id once the exercise syncs, and reassigns the local set cache", async () => {
    // A custom exercise created offline, cached under a negative placeholder id.
    await putExerciseCache(db, {
      id: -1,
      client_uuid: "ex-client-1",
      name: "Reverse Nordic Curl",
      muscle_group: "Quads",
      equipment: null,
      is_custom: true,
    });
    await putSessionCache(db, {
      clientUuid: "sess-1",
      id: 5,
      sessionDate: "2026-07-20",
      startedAt: null,
      endedAt: null,
      activityId: null,
      notes: null,
    });
    await putSetCache(db, {
      clientUuid: "set-1",
      sessionClientUuid: "sess-1",
      exerciseId: -1,
      setNumber: 1,
      weightKg: 50,
      reps: 10,
    });

    await enqueueMutation(db, {
      clientUuid: "ex-client-1",
      type: "create_exercise",
      payload: { client_uuid: "ex-client-1", name: "Reverse Nordic Curl", muscle_group: "Quads" },
      createdAt: 1,
    });
    await enqueueMutation(db, {
      clientUuid: "set-1",
      type: "create_set",
      payload: {
        client_uuid: "set-1",
        session_client_uuid: "sess-1",
        exercise_client_uuid: "ex-client-1",
        set_number: 1,
        weight_kg: 50,
        reps: 10,
      },
      createdAt: 2,
    });

    const setUrls: string[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      if (String(url).includes("/api/gym/exercises")) {
        return jsonResponse({ id: 99, client_uuid: "ex-client-1" });
      }
      setUrls.push(String(init?.body));
      return jsonResponse({ id: 1, client_uuid: "set-1" });
    }) as typeof fetch;

    const result = await flushQueue(fetchImpl, db);

    expect(result).toEqual({ sentCount: 2, stoppedReason: null });
    expect(JSON.parse(setUrls[0]).exercise_id).toBe(99);

    // Local cache reconciled: placeholder gone, real id resolvable, set reassigned.
    const resolved = await findExerciseByClientUuid(db, "ex-client-1");
    expect(resolved?.id).toBe(99);
    const sets = await listSetsForSession(db, "sess-1");
    expect(sets[0].exerciseId).toBe(99);
  });

  it("blocks the create_set mutation until its exercise has synced (FIFO dependency)", async () => {
    await putExerciseCache(db, {
      id: -1,
      client_uuid: "ex-client-2",
      name: "Zercher Squat",
      muscle_group: "Quads",
      equipment: null,
      is_custom: true,
    });

    await enqueueMutation(db, {
      clientUuid: "set-2",
      type: "create_set",
      payload: {
        client_uuid: "set-2",
        session_client_uuid: "sess-2",
        exercise_client_uuid: "ex-client-2",
        set_number: 1,
        weight_kg: 40,
        reps: 12,
      },
      createdAt: 1,
    });

    const fetchImpl = (async () => {
      throw new Error("should not be called — set has no resolvable exercise yet");
    }) as typeof fetch;

    const result = await flushQueue(fetchImpl, db);
    expect(result).toEqual({ sentCount: 0, stoppedReason: "blocked" });
    expect(await listPendingMutations(db)).toHaveLength(1);
  });
});
