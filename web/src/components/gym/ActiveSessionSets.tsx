"use client";
import { useGymOffline } from "@/lib/gymOffline/context";
import { useWeightUnit } from "@/lib/gymOffline/useWeightUnit";
import type { CachedSet } from "@/lib/gymOffline/db";

export function ActiveSessionSets({ sets }: { sets: CachedSet[] }) {
  const { exercises, deleteSet } = useGymOffline();
  const { unit, toDisplay } = useWeightUnit();

  if (sets.length === 0) {
    return <p className="mt-3 text-sm text-neutral-500">No sets logged yet.</p>;
  }

  const byExercise = new Map<number, CachedSet[]>();
  for (const set of sets) {
    const list = byExercise.get(set.exerciseId) ?? [];
    list.push(set);
    byExercise.set(set.exerciseId, list);
  }

  return (
    <div className="mt-3 space-y-2">
      {[...byExercise.entries()].map(([exerciseId, exerciseSets]) => {
        const exercise = exercises.find((e) => e.id === exerciseId);
        return (
          <div key={exerciseId} className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
            <p className="text-xs font-medium text-neutral-500">{exercise?.name ?? "Unknown exercise"}</p>
            {exerciseSets
              .sort((a, b) => a.setNumber - b.setNumber)
              .map((set) => (
                <div
                  key={set.clientUuid}
                  className={`mt-1 flex items-center justify-between text-sm ${set.isWarmup ? "italic text-neutral-400 dark:text-neutral-500" : ""}`}
                >
                  <span>
                    Set {set.setNumber}: {toDisplay(set.weightKg).toFixed(1)}
                    {unit} x {set.reps}
                    {set.rpe != null && ` @RPE ${set.rpe}`}
                    {set.isWarmup && (
                      <span className="ml-2 rounded bg-neutral-200 px-1 py-0.5 text-[10px] font-medium not-italic text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                        W
                      </span>
                    )}
                  </span>
                  <button type="button" onClick={() => deleteSet(set.clientUuid)} className="text-xs text-red-600">
                    Remove
                  </button>
                </div>
              ))}
          </div>
        );
      })}
    </div>
  );
}
