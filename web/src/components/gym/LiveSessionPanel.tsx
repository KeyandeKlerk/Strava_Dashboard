"use client";
import { Suspense, useMemo } from "react";
import { useGymOffline } from "@/lib/gymOffline/context";
import { getActiveSession } from "@/lib/gymOffline/liveSession";
import { SessionExerciseQueue } from "./SessionExerciseQueue";
import { ActiveSessionSets } from "./ActiveSessionSets";
import { RestTimer } from "./RestTimer";

function todayIso(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function weekdayNameFor(sessionDate: string): string {
  return new Date(`${sessionDate}T00:00:00`).toLocaleDateString("en-US", { weekday: "long" });
}

export function LiveSessionPanel() {
  const { sessions, sets, startSession, endSession, startRestTimer } = useGymOffline();

  const activeSession = useMemo(() => getActiveSession(sessions), [sessions]);

  const activeSessionSets = useMemo(() => {
    if (!activeSession) return [];
    return sets.filter((s) => s.sessionClientUuid === activeSession.clientUuid);
  }, [sets, activeSession]);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Gym</h2>
      </div>

      {!activeSession ? (
        <button
          type="button"
          onClick={() => startSession(todayIso())}
          className="mt-3 w-full rounded-md bg-neutral-900 px-3 py-2 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900"
        >
          Start session
        </button>
      ) : (
        <div className="mt-3">
          <p className="text-xs text-neutral-500">Session started {activeSession.sessionDate}</p>

          <Suspense fallback={<div className="mt-3 h-9 animate-pulse rounded-lg bg-neutral-200 dark:bg-neutral-800" />}>
            <RestTimer />
          </Suspense>

          <ActiveSessionSets sets={activeSessionSets} />

          <div className="mt-3">
            <SessionExerciseQueue
              sessionClientUuid={activeSession.clientUuid}
              activeSessionSets={activeSessionSets}
              planDayName={weekdayNameFor(activeSession.sessionDate)}
              onLogged={startRestTimer}
            />
          </div>

          <button
            type="button"
            onClick={() => endSession(activeSession.clientUuid)}
            className="mt-4 w-full rounded-md border border-red-300 px-3 py-2 text-sm text-red-600 dark:border-red-900"
          >
            End session
          </button>
        </div>
      )}
    </div>
  );
}
