"use client";
// Mounted once for the /gym route (see web/src/app/gym/layout.tsx). Exposes
// the live-logging operations as optimistic writes to the local cache plus
// an enqueued mutation, immediately followed by a flush attempt — so an
// online user gets a near-instant real save and an offline user gets
// instant optimistic UI plus a queued badge, via the same code path either
// way. No Background Sync API (iOS Safari has no reliable support, and this
// is the user's primary device) — flushing is triggered only in the
// foreground: on mount, on the `online` event, and on tab visibility.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import {
  enqueueMutation,
  getGymOfflineDb,
  listAllSetsCache,
  listExercisesCache,
  listPendingMutations,
  listPlanCache,
  listRecentSessionsCache,
  listSessionsCache,
  listSetsForSession,
  patchSessionCache,
  putExerciseCache,
  putSessionCache,
  putSetCache,
  removeRecentSessionCache,
  replaceExercisesCache,
  replacePlanCache,
  replaceRecentSessionsCache,
  type CachedExercise,
  type CachedRecentSession,
  type CachedSession,
  type CachedSet,
} from "./db";
import { flushQueue, type FlushResult } from "./queue";

function newUuid(): string {
  return crypto.randomUUID();
}

interface LogSetInput {
  sessionClientUuid: string;
  exercise: CachedExercise;
  setNumber: number;
  weightKg: number;
  reps: number;
  isWarmup?: boolean;
}

interface AddCustomExerciseInput {
  name: string;
  muscleGroup: string;
  equipment?: string | null;
}

interface GymOfflineContextValue {
  exercises: CachedExercise[];
  sessions: CachedSession[];
  sets: CachedSet[];
  recentSessions: CachedRecentSession[];
  planByDay: Record<string, number[]>;
  pendingCount: number;
  isOnline: boolean;
  lastFlush: FlushResult | null;
  startSession(sessionDate: string): Promise<CachedSession>;
  endSession(sessionClientUuid: string): Promise<void>;
  logSet(input: LogSetInput): Promise<CachedSet>;
  deleteSet(clientUuid: string): Promise<void>;
  dismissDeletedSession(id: number): Promise<void>;
  addCustomExercise(input: AddCustomExerciseInput): Promise<CachedExercise>;
  getSetsForSession(sessionClientUuid: string): Promise<CachedSet[]>;
  refresh(): Promise<void>;
}

const GymOfflineContext = createContext<GymOfflineContextValue | null>(null);

export function useGymOffline(): GymOfflineContextValue {
  const ctx = useContext(GymOfflineContext);
  if (!ctx) throw new Error("useGymOffline must be used within a GymOfflineProvider");
  return ctx;
}

export function GymOfflineProvider({ children }: { children: ReactNode }) {
  const [exercises, setExercises] = useState<CachedExercise[]>([]);
  const [sessions, setSessions] = useState<CachedSession[]>([]);
  const [sets, setSets] = useState<CachedSet[]>([]);
  const [recentSessions, setRecentSessions] = useState<CachedRecentSession[]>([]);
  const [planByDay, setPlanByDay] = useState<Record<string, number[]>>({});
  const [pendingCount, setPendingCount] = useState(0);
  const [isOnline, setIsOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [lastFlush, setLastFlush] = useState<FlushResult | null>(null);
  const flushing = useRef(false);
  const placeholderCounter = useRef(0);

  const refresh = useCallback(async () => {
    const db = await getGymOfflineDb();
    const [exerciseRows, sessionRows, setRows, recentRows, pending, planRows] = await Promise.all([
      listExercisesCache(db),
      listSessionsCache(db),
      listAllSetsCache(db),
      listRecentSessionsCache(db),
      listPendingMutations(db),
      listPlanCache(db),
    ]);
    setExercises(exerciseRows);
    setSessions(sessionRows);
    setSets(setRows);
    setRecentSessions(recentRows);
    setPendingCount(pending.length);
    setPlanByDay(Object.fromEntries(planRows.map((p) => [p.dayOfWeek, p.exerciseIds])));
  }, []);

  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      const result = await flushQueue();
      setLastFlush(result);
      await refresh();
    } finally {
      flushing.current = false;
    }
  }, [refresh]);

  const bootstrap = useCallback(async () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    try {
      const res = await fetch("/api/gym/bootstrap");
      if (!res.ok) return;
      const body = (await res.json()) as {
        exercises: CachedExercise[];
        recentSessions: CachedRecentSession[];
        planByDay: Record<string, number[]>;
      };
      const db = await getGymOfflineDb();
      // Only the curated/synced library is replaced wholesale — locally
      // pending custom exercises (negative placeholder ids) aren't part of
      // this response and are left alone; the queue reconciles them once
      // their create_exercise mutation syncs.
      const pendingCustom = (await listExercisesCache(db)).filter((e) => e.id < 0);
      await replaceExercisesCache(db, [...body.exercises, ...pendingCustom]);
      await replaceRecentSessionsCache(db, body.recentSessions);
      await replacePlanCache(
        db,
        Object.entries(body.planByDay).map(([dayOfWeek, exerciseIds]) => ({ dayOfWeek, exerciseIds })),
      );
    } catch {
      // offline — cache stays as-is
    }
  }, []);

  useEffect(() => {
    (async () => {
      await refresh();
      await bootstrap();
      await flush();
    })();

    function handleOnline() {
      setIsOnline(true);
      flush();
    }
    function handleOffline() {
      setIsOnline(false);
    }
    function handleVisibility() {
      if (!document.hidden) flush();
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
    // Intentionally run only on mount — refresh/bootstrap/flush are stable
    // via useCallback, and re-running this on every render would re-attach
    // listeners repeatedly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startSession = useCallback(
    async (sessionDate: string): Promise<CachedSession> => {
      const db = await getGymOfflineDb();
      const clientUuid = newUuid();
      const startedAt = new Date().toISOString();
      const session: CachedSession = {
        clientUuid,
        id: null,
        sessionDate,
        startedAt,
        endedAt: null,
        activityId: null,
        notes: null,
      };
      await putSessionCache(db, session);
      await enqueueMutation(db, {
        clientUuid,
        type: "create_session",
        payload: { client_uuid: clientUuid, session_date: sessionDate, started_at: startedAt },
      });
      await refresh();
      flush();
      return session;
    },
    [refresh, flush],
  );

  const endSession = useCallback(
    async (sessionClientUuid: string): Promise<void> => {
      const db = await getGymOfflineDb();
      const existing = (await listSessionsCache(db)).find((s) => s.clientUuid === sessionClientUuid);
      if (!existing) return;

      const endedAt = new Date().toISOString();
      await patchSessionCache(db, sessionClientUuid, { endedAt });
      await enqueueMutation(db, {
        clientUuid: newUuid(),
        type: "create_session",
        // Always resend the full known state (not just the delta) so this
        // replays safely through upsertGymSession's INSERT ... ON CONFLICT
        // even if it somehow lands before the original "start" mutation.
        payload: {
          client_uuid: sessionClientUuid,
          session_date: existing.sessionDate,
          started_at: existing.startedAt,
          ended_at: endedAt,
          activity_id: existing.activityId,
        },
      });
      await refresh();
      flush();
    },
    [refresh, flush],
  );

  const logSet = useCallback(
    async (input: LogSetInput): Promise<CachedSet> => {
      const db = await getGymOfflineDb();
      const clientUuid = newUuid();
      const isWarmup = input.isWarmup ?? false;
      const set: CachedSet = {
        clientUuid,
        sessionClientUuid: input.sessionClientUuid,
        exerciseId: input.exercise.id,
        setNumber: input.setNumber,
        weightKg: input.weightKg,
        reps: input.reps,
        isWarmup,
      };
      await putSetCache(db, set);

      const payload: Record<string, unknown> = {
        client_uuid: clientUuid,
        session_client_uuid: input.sessionClientUuid,
        set_number: input.setNumber,
        weight_kg: input.weightKg,
        reps: input.reps,
        is_warmup: isWarmup,
      };
      // A negative id marks a custom exercise that hasn't synced yet —
      // reference it by client_uuid so the queue can resolve the real id
      // once its create_exercise mutation has gone through (see queue.ts).
      if (input.exercise.id < 0 && input.exercise.client_uuid) {
        payload.exercise_client_uuid = input.exercise.client_uuid;
      } else {
        payload.exercise_id = input.exercise.id;
      }

      await enqueueMutation(db, { clientUuid, type: "create_set", payload });
      await refresh();
      flush();
      return set;
    },
    [refresh, flush],
  );

  const deleteSet = useCallback(
    async (clientUuid: string): Promise<void> => {
      const db = await getGymOfflineDb();
      await db.delete("setsCache", clientUuid);
      await enqueueMutation(db, { clientUuid: newUuid(), type: "delete_set", payload: { client_uuid: clientUuid } });
      await refresh();
      flush();
    },
    [refresh, flush],
  );

  // Corrects the local recentSessionsCache after a session was deleted via
  // the online-only deleteGymSessionAction (see GymSessionDetailSheet) —
  // that action doesn't touch this cache, so a targeted removal + refresh
  // stands in for a full re-bootstrap.
  const dismissDeletedSession = useCallback(
    async (id: number): Promise<void> => {
      const db = await getGymOfflineDb();
      await removeRecentSessionCache(db, id);
      await refresh();
    },
    [refresh],
  );

  const addCustomExercise = useCallback(
    async (input: AddCustomExerciseInput): Promise<CachedExercise> => {
      const db = await getGymOfflineDb();
      const clientUuid = newUuid();
      placeholderCounter.current += 1;
      const placeholderId = -(Date.now() * 1000 + placeholderCounter.current);
      const exercise: CachedExercise = {
        id: placeholderId,
        client_uuid: clientUuid,
        name: input.name,
        muscle_group: input.muscleGroup,
        equipment: input.equipment ?? null,
        is_custom: true,
      };
      await putExerciseCache(db, exercise);
      await enqueueMutation(db, {
        clientUuid,
        type: "create_exercise",
        payload: {
          client_uuid: clientUuid,
          name: input.name,
          muscle_group: input.muscleGroup,
          equipment: input.equipment ?? null,
        },
      });
      await refresh();
      flush();
      return exercise;
    },
    [refresh, flush],
  );

  const getSetsForSession = useCallback(async (sessionClientUuid: string): Promise<CachedSet[]> => {
    const db = await getGymOfflineDb();
    return listSetsForSession(db, sessionClientUuid);
  }, []);

  return (
    <GymOfflineContext.Provider
      value={{
        exercises,
        sessions,
        sets,
        recentSessions,
        planByDay,
        pendingCount,
        isOnline,
        lastFlush,
        startSession,
        endSession,
        logSet,
        deleteSet,
        dismissDeletedSession,
        addCustomExercise,
        getSetsForSession,
        refresh,
      }}
    >
      {children}
    </GymOfflineContext.Provider>
  );
}
