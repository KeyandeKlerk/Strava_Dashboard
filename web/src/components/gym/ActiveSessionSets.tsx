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
    <div className="mt-3 space-y-3">
      {[...byExercise.entries()].map(([exerciseId, exerciseSets]) => {
        const exercise = exercises.find((e) => e.id === exerciseId);
        return (
          <div key={exerciseId}>
            <p className="text-xs font-medium text-neutral-500">{exercise?.name ?? "Unknown exercise"}</p>
            {exerciseSets
              .sort((a, b) => a.setNumber - b.setNumber)
              .map((set) => (
                <div key={set.clientUuid} className="mt-1 flex items-center justify-between text-sm">
                  <span>
                    Set {set.setNumber}: {toDisplay(set.weightKg).toFixed(1)}
                    {unit} x {set.reps}
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
