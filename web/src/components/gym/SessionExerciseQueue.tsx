"use client";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useGymOffline } from "@/lib/gymOffline/context";
import { keyFor, resolveByKey } from "@/lib/gymOffline/exerciseKey";
import { nextSupersetKey } from "@/lib/gymSupersets";
import { ExercisePicker } from "./ExercisePicker";
import { SetEntryForm } from "./SetEntryForm";
import type { CachedExercise, CachedSet } from "@/lib/gymOffline/db";

type PickerMode = null | "add" | "swap";

// A queue slot: which exercise (by key) plus its plan-derived target/grouping
// fields. supersetGroup drives the round-robin "Next exercise" behaviour for
// plan-authored supersets (see handleNext).
interface QueueEntry {
  key: string;
  targetSets: number | null;
  targetReps: number | null;
  supersetGroup: number | null;
}

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
  const [queueEntries, setQueueEntries] = useState<QueueEntry[]>([]);
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const [pickerMode, setPickerMode] = useState<PickerMode>(null);
  const [seeded, setSeeded] = useState(false);

  // Seed the queue once from today's plan, as soon as the exercise library
  // (needed to resolve plan exercise ids to CachedExercise objects) is
  // loaded. Only ever seeds once per mount — re-running this whenever
  // `exercises` refreshes (e.g. after every set logged) would stomp on
  // later swap/add/next interactions. Each seeded slot carries the plan
  // entry's target sets/reps (and superset group, unused for now).
  useEffect(() => {
    if (seeded || exercises.length === 0) return;
    const planEntries = planByDay[planDayName] ?? [];
    const seededEntries = planEntries
      .map((entry): QueueEntry | null => {
        const exercise = exercises.find((e) => e.id === entry.exerciseId);
        if (!exercise) return null;
        return {
          key: keyFor(exercise),
          targetSets: entry.targetSets,
          targetReps: entry.targetReps,
          supersetGroup: entry.supersetGroup,
        };
      })
      .filter((e): e is QueueEntry => e != null);
    if (seededEntries.length > 0) {
      setQueueEntries(seededEntries);
      setCurrentKey(seededEntries[0].key);
    }
    setSeeded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exercises, planByDay, planDayName, seeded]);

  const queueExercises = useMemo(
    () => queueEntries.map((entry) => resolveByKey(exercises, entry.key)).filter((e): e is CachedExercise => e != null),
    [queueEntries, exercises],
  );

  const currentExercise = resolveByKey(exercises, currentKey);
  const currentEntry = queueEntries.find((e) => e.key === currentKey) ?? null;

  const loggedExerciseIds = useMemo(
    () => new Set(activeSessionSets.map((s) => s.exerciseId)),
    [activeSessionSets],
  );

  // An ad-hoc exercise added mid-session has no plan target/grouping.
  function handleAdd(exercise: CachedExercise) {
    const key = keyFor(exercise);
    setQueueEntries((prev) =>
      prev.some((e) => e.key === key)
        ? prev
        : [...prev, { key, targetSets: null, targetReps: null, supersetGroup: null }],
    );
    setCurrentKey(key);
    setPickerMode(null);
  }

  // Swapping replaces the exercise in this slot with a different one. The plan
  // target was tied to the specific planned exercise, so null it — but PRESERVE
  // supersetGroup: swap means "substitute the exercise in this slot" (e.g. a
  // machine's taken), and a substituted exercise is still part of the superset.
  function handleSwap(exercise: CachedExercise) {
    const newKey = keyFor(exercise);
    setQueueEntries((prev) =>
      prev.map((entry) =>
        entry.key === currentKey
          ? { key: newKey, targetSets: null, targetReps: null, supersetGroup: entry.supersetGroup }
          : entry,
      ),
    );
    setCurrentKey(newKey);
    setPickerMode(null);
  }

  // If the current entry is in a superset group, round-robin cyclically to the
  // next member (always advances, even if that member already has sets logged).
  // Otherwise fall back to the first not-yet-logged exercise, else open the
  // "add" picker.
  function handleNext() {
    const groupNext = nextSupersetKey(queueEntries, currentKey);
    if (groupNext) {
      setCurrentKey(groupNext);
      return;
    }
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
        {(queueEntries.length > 0 || pickerMode === "swap") && (
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
          {(() => {
            const seenGroups = new Set<number>();
            return queueEntries.map((entry) => {
              const exercise = resolveByKey(exercises, entry.key);
              if (!exercise) return null;
              const key = entry.key;
              const done = loggedExerciseIds.has(exercise.id);
              const active = key === currentKey;
              const grouped = entry.supersetGroup != null;
              const isGroupFirst = grouped && !seenGroups.has(entry.supersetGroup!);
              if (grouped) seenGroups.add(entry.supersetGroup!);
              return (
                <Fragment key={key}>
                  {isGroupFirst && (
                    <span className="flex-none self-center whitespace-nowrap pl-1 text-[10px] font-medium uppercase tracking-wide text-violet-600 dark:text-violet-400">
                      Superset
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setCurrentKey(key)}
                    className={`flex-none whitespace-nowrap rounded-full px-3 py-1.5 text-xs transition-colors ${
                      active
                        ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                        : done
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                          : grouped
                            ? "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300"
                            : "bg-neutral-100 text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400"
                    }`}
                  >
                    {done && !active ? "✓ " : ""}
                    {exercise.name}
                  </button>
                </Fragment>
              );
            });
          })()}
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
          target={currentEntry ? { sets: currentEntry.targetSets, reps: currentEntry.targetReps } : undefined}
          onSwap={() => setPickerMode("swap")}
          showNext={hasLoggedCurrent}
          onNext={handleNext}
        />
      </div>
    </div>
  );
}
