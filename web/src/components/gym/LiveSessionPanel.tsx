"use client";
import { useMemo, useRef } from "react";
import { useGymOffline } from "@/lib/gymOffline/context";
import { SessionExerciseQueue } from "./SessionExerciseQueue";
import { ActiveSessionSets } from "./ActiveSessionSets";
import { WeightUnitToggle } from "./WeightUnitToggle";
import { RestTimer, type RestTimerHandle } from "./RestTimer";

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
  const { sessions, sets, pendingCount, isOnline, startSession, endSession } = useGymOffline();
  // One rest timer per active session, owned here (not inside the queue) so
  // it survives exercise swaps/next-exercise navigation within a session.
  const restTimerRef = useRef<RestTimerHandle>(null);

  // The most recently started session that hasn't been ended yet — durable
  // across reloads/app kills since sessionsCache lives in IndexedDB, not
  // React state.
  const activeSession = useMemo(() => {
    return [...sessions]
      .filter((s) => !s.endedAt)
      .sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""))[0];
  }, [sessions]);

  const activeSessionSets = useMemo(() => {
    if (!activeSession) return [];
    return sets.filter((s) => s.sessionClientUuid === activeSession.clientUuid);
  }, [sets, activeSession]);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Gym</h2>
        <div className="flex items-center gap-2">
          {!isOnline && <span className="text-xs text-amber-600">Offline</span>}
          {pendingCount > 0 && <span className="text-xs text-neutral-500">{pendingCount} pending sync</span>}
          <WeightUnitToggle />
        </div>
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

          <RestTimer ref={restTimerRef} />

          <ActiveSessionSets sets={activeSessionSets} />

          <div className="mt-3">
            <SessionExerciseQueue
              sessionClientUuid={activeSession.clientUuid}
              activeSessionSets={activeSessionSets}
              planDayName={weekdayNameFor(activeSession.sessionDate)}
              onLogged={() => restTimerRef.current?.start()}
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
