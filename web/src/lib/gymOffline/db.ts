// IndexedDB-backed offline cache + mutation queue for the live-logging flow.
// Sessions/sets are keyed by client-generated UUID, never a server id — a
// session/set created offline doesn't have a server id yet, and gymMutations.ts's
// addGymSet resolves session_id server-side by session_client_uuid to match
// (see web/src/lib/db/gymMutations.ts's header comment).
import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export type PendingMutationType = "create_exercise" | "create_session" | "create_set" | "delete_set";

export interface PendingMutation {
  clientUuid: string;
  type: PendingMutationType;
  payload: Record<string, unknown>;
  createdAt: number;
}

export interface CachedExercise {
  id: number;
  client_uuid: string | null;
  name: string;
  muscle_group: string;
  equipment: string | null;
  is_custom: boolean;
}

export interface CachedSession {
  clientUuid: string;
  id: number | null; // null until the create_session mutation has synced
  sessionDate: string;
  startedAt: string | null;
  endedAt: string | null;
  activityId: number | null;
  notes: string | null;
}

export interface CachedSet {
  clientUuid: string;
  sessionClientUuid: string;
  exerciseId: number;
  setNumber: number;
  weightKg: number;
  reps: number;
  isWarmup: boolean;
}

// Read-only mirror of listRecentGymSessions, for the /gym history list.
// Deliberately separate from sessionsCache, which only ever tracks this
// device's own locally-originated (pending/synced) sessions keyed by
// client_uuid for the FK-by-uuid resolution — this cache holds every recent
// session server-side, keyed by its real id, refreshed wholesale on bootstrap.
export interface CachedRecentSession {
  id: number;
  client_uuid: string;
  session_date: string;
  activity_id: number | null;
  set_count: number;
  total_volume_kg: number;
}

export interface CachedPlanDay {
  dayOfWeek: string; // full weekday name, e.g. "Monday"
  exerciseIds: number[]; // in position order
}

interface GymOfflineSchema extends DBSchema {
  pendingMutations: {
    key: string;
    value: PendingMutation;
    indexes: { "by-createdAt": number };
  };
  exercisesCache: {
    key: number;
    value: CachedExercise;
  };
  sessionsCache: {
    key: string;
    value: CachedSession;
  };
  setsCache: {
    key: string;
    value: CachedSet;
    indexes: { "by-sessionClientUuid": string };
  };
  recentSessionsCache: {
    key: number;
    value: CachedRecentSession;
  };
  planCache: {
    key: string;
    value: CachedPlanDay;
  };
}

export type GymOfflineDb = IDBPDatabase<GymOfflineSchema>;

const DB_NAME = "gym-offline";
const DB_VERSION = 2;

let dbPromise: Promise<GymOfflineDb> | null = null;

export function getGymOfflineDb(): Promise<GymOfflineDb> {
  if (!dbPromise) {
    dbPromise = openDB<GymOfflineSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("pendingMutations")) {
          const mutations = db.createObjectStore("pendingMutations", { keyPath: "clientUuid" });
          mutations.createIndex("by-createdAt", "createdAt");
        }
        if (!db.objectStoreNames.contains("exercisesCache")) {
          db.createObjectStore("exercisesCache", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("sessionsCache")) {
          db.createObjectStore("sessionsCache", { keyPath: "clientUuid" });
        }
        if (!db.objectStoreNames.contains("setsCache")) {
          const sets = db.createObjectStore("setsCache", { keyPath: "clientUuid" });
          sets.createIndex("by-sessionClientUuid", "sessionClientUuid");
        }
        if (!db.objectStoreNames.contains("recentSessionsCache")) {
          db.createObjectStore("recentSessionsCache", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("planCache")) {
          db.createObjectStore("planCache", { keyPath: "dayOfWeek" });
        }
      },
    });
  }
  return dbPromise;
}

// Test-only: force a fresh database handle (each vitest case uses its own
// fake-indexeddb instance and must not reuse another test's cached handle).
export function resetGymOfflineDbForTests(): void {
  dbPromise = null;
}

export async function enqueueMutation(
  db: GymOfflineDb,
  mutation: Omit<PendingMutation, "createdAt"> & { createdAt?: number },
): Promise<void> {
  await db.put("pendingMutations", { ...mutation, createdAt: mutation.createdAt ?? Date.now() });
}

export async function listPendingMutations(db: GymOfflineDb): Promise<PendingMutation[]> {
  return db.getAllFromIndex("pendingMutations", "by-createdAt");
}

export async function replaceExercisesCache(db: GymOfflineDb, exercises: CachedExercise[]): Promise<void> {
  const tx = db.transaction("exercisesCache", "readwrite");
  await tx.store.clear();
  for (const exercise of exercises) await tx.store.put(exercise);
  await tx.done;
}

export async function putExerciseCache(db: GymOfflineDb, exercise: CachedExercise): Promise<void> {
  await db.put("exercisesCache", exercise);
}

export async function deleteExerciseCache(db: GymOfflineDb, id: number): Promise<void> {
  await db.delete("exercisesCache", id);
}

// A not-yet-synced custom exercise is cached under a negative placeholder id
// (see gymOffline/context.tsx's addCustomExercise). Once its create_exercise
// mutation syncs, any sets already logged against the placeholder need their
// local exerciseId rewritten to the real id so lookups by id keep resolving.
export async function reassignSetsExerciseId(db: GymOfflineDb, oldExerciseId: number, newExerciseId: number): Promise<void> {
  const tx = db.transaction("setsCache", "readwrite");
  const all = await tx.store.getAll();
  for (const set of all) {
    if (set.exerciseId === oldExerciseId) {
      await tx.store.put({ ...set, exerciseId: newExerciseId });
    }
  }
  await tx.done;
}

export async function listExercisesCache(db: GymOfflineDb): Promise<CachedExercise[]> {
  return db.getAll("exercisesCache");
}

export async function findExerciseByClientUuid(db: GymOfflineDb, clientUuid: string): Promise<CachedExercise | undefined> {
  const all = await db.getAll("exercisesCache");
  return all.find((e) => e.client_uuid === clientUuid);
}

export async function putSessionCache(db: GymOfflineDb, session: CachedSession): Promise<void> {
  await db.put("sessionsCache", session);
}

export async function patchSessionCache(db: GymOfflineDb, clientUuid: string, patch: Partial<CachedSession>): Promise<void> {
  const existing = await db.get("sessionsCache", clientUuid);
  if (!existing) return;
  await db.put("sessionsCache", { ...existing, ...patch });
}

export async function listSessionsCache(db: GymOfflineDb): Promise<CachedSession[]> {
  return db.getAll("sessionsCache");
}

export async function putSetCache(db: GymOfflineDb, set: CachedSet): Promise<void> {
  await db.put("setsCache", set);
}

export async function deleteSetCache(db: GymOfflineDb, clientUuid: string): Promise<void> {
  await db.delete("setsCache", clientUuid);
}

export async function listSetsForSession(db: GymOfflineDb, sessionClientUuid: string): Promise<CachedSet[]> {
  return db.getAllFromIndex("setsCache", "by-sessionClientUuid", sessionClientUuid);
}

export async function listAllSetsCache(db: GymOfflineDb): Promise<CachedSet[]> {
  return db.getAll("setsCache");
}

export async function replaceRecentSessionsCache(db: GymOfflineDb, sessions: CachedRecentSession[]): Promise<void> {
  const tx = db.transaction("recentSessionsCache", "readwrite");
  await tx.store.clear();
  for (const session of sessions) await tx.store.put(session);
  await tx.done;
}

export async function listRecentSessionsCache(db: GymOfflineDb): Promise<CachedRecentSession[]> {
  return db.getAll("recentSessionsCache");
}

// Targeted correction after an online-only deleteGymSessionAction — avoids
// forcing a full bootstrap just to drop one row from the cache.
export async function removeRecentSessionCache(db: GymOfflineDb, id: number): Promise<void> {
  await db.delete("recentSessionsCache", id);
}

export async function replacePlanCache(db: GymOfflineDb, days: CachedPlanDay[]): Promise<void> {
  const tx = db.transaction("planCache", "readwrite");
  await tx.store.clear();
  for (const day of days) await tx.store.put(day);
  await tx.done;
}

export async function listPlanCache(db: GymOfflineDb): Promise<CachedPlanDay[]> {
  return db.getAll("planCache");
}
