"use client";
import { useEffect, useMemo, useState } from "react";
import { useGymOffline } from "@/lib/gymOffline/context";
import { keyFor, resolveByKey } from "@/lib/gymOffline/exerciseKey";
import { ExercisePicker } from "./ExercisePicker";
import { SetEntryForm } from "./SetEntryForm";
import type { CachedExercise, CachedSet } from "@/lib/gymOffline/db";

type PickerMode = null | "add" | "swap";

export function SessionExerciseQueue({
  sessionClientUuid,
  activeSessionSets,
  planDayName,
}: {
  sessionClientUuid: string;
  activeSessionSets: CachedSet[];
  planDayName: string;
}) {
  const { exercises, planByDay } = useGymOffline();
  const [queueKeys, setQueueKeys] = useState<string[]>([]);
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const [pickerMode, setPickerMode] = useState<PickerMode>(null);
  const [seeded, setSeeded] = useState(false);

  // Seed the queue once from today's plan, as soon as the exercise library
  // (needed to resolve plan exercise ids to CachedExercise objects) is
  // loaded. Only ever seeds once per mount — re-running this whenever
  // `exercises` refreshes (e.g. after every set logged) would stomp on
  // later swap/add/next interactions.
  useEffect(() => {
    if (seeded || exercises.length === 0) return;
    const planIds = planByDay[planDayName] ?? [];
    const seededExercises = planIds
      .map((id) => exercises.find((e) => e.id === id))
      .filter((e): e is CachedExercise => e != null);
    if (seededExercises.length > 0) {
      setQueueKeys(seededExercises.map(keyFor));
      setCurrentKey(keyFor(seededExercises[0]));
    }
    setSeeded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exercises, planByDay, planDayName, seeded]);

  const queueExercises = useMemo(
    () => queueKeys.map((key) => resolveByKey(exercises, key)).filter((e): e is CachedExercise => e != null),
    [queueKeys, exercises],
  );

  const currentExercise = resolveByKey(exercises, currentKey);

  const loggedExerciseIds = useMemo(
    () => new Set(activeSessionSets.map((s) => s.exerciseId)),
    [activeSessionSets],
  );

  function handleAdd(exercise: CachedExercise) {
    const key = keyFor(exercise);
    setQueueKeys((prev) => (prev.includes(key) ? prev : [...prev, key]));
    setCurrentKey(key);
    setPickerMode(null);
  }

  function handleSwap(exercise: CachedExercise) {
    const newKey = keyFor(exercise);
    setQueueKeys((prev) => prev.map((key) => (key === currentKey ? newKey : key)));
    setCurrentKey(newKey);
    setPickerMode(null);
  }

  function handleNext() {
    const nextUnlogged = queueExercises.find((e) => !loggedExerciseIds.has(e.id));
    if (nextUnlogged) {
      setCurrentKey(keyFor(nextUnlogged));
    } else {
      setCurrentKey(null);
      setPickerMode("add");
    }
  }

  const nextSetNumber = useMemo(() => {
    if (!currentExercise) return 1;
    return activeSessionSets.filter((s) => s.exerciseId === currentExercise.id).length + 1;
  }, [activeSessionSets, currentExercise]);

  if (pickerMode === "add" || pickerMode === "swap") {
    return (
      <div>
        <ExercisePicker onSelect={pickerMode === "add" ? handleAdd : handleSwap} />
        {(queueKeys.length > 0 || pickerMode === "swap") && (
          <button type="button" onClick={() => setPickerMode(null)} className="mt-2 text-xs text-neutral-500">
            Cancel
          </button>
        )}
      </div>
    );
  }

  if (!currentExercise) {
    return <ExercisePicker onSelect={handleAdd} />;
  }

  const hasLoggedCurrent = loggedExerciseIds.has(currentExercise.id);

  return (
    <div>
      {queueExercises.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1.5">
          {queueExercises.map((exercise) => {
            const key = keyFor(exercise);
            const done = loggedExerciseIds.has(exercise.id);
            const active = key === currentKey;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setCurrentKey(key)}
                className={`flex-none whitespace-nowrap rounded-full px-3 py-1.5 text-xs transition-colors ${
                  active
                    ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                    : done
                      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                      : "bg-neutral-100 text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400"
                }`}
              >
                {done && !active ? "✓ " : ""}
                {exercise.name}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setPickerMode("add")}
            className="flex-none whitespace-nowrap rounded-full bg-neutral-100 px-3 py-1.5 text-xs text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400"
          >
            + Add
          </button>
        </div>
      )}

      <div key={currentKey} className="mt-2 transition-opacity duration-150">
        <SetEntryForm
          sessionClientUuid={sessionClientUuid}
          exercise={currentExercise}
          nextSetNumber={nextSetNumber}
          onSwap={() => setPickerMode("swap")}
          showNext={hasLoggedCurrent}
          onNext={handleNext}
        />
      </div>
    </div>
  );
}
