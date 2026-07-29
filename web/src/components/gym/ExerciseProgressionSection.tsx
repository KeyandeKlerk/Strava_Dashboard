"use client";
import { useRef, useState, useTransition } from "react";
import { getExerciseProgressionAction } from "@/lib/gymActions";
import { ChartCard } from "@/components/charts/ChartCard";
import { ExerciseProgressionChart } from "@/components/charts/GymCharts";
import { FIELD_CLASS } from "@/lib/uiStyles";
import { createLatestRequestGuard } from "@/lib/latestRequestGuard";
import type { GymExerciseRow } from "@/lib/db/gymMutations";
import type { ExerciseProgressionRow } from "@/lib/gymMetrics";

export function ExerciseProgressionSection({
  exercises,
  defaultExerciseId,
  defaultProgression,
}: {
  exercises: GymExerciseRow[];
  defaultExerciseId: number | null;
  defaultProgression: ExerciseProgressionRow[];
}) {
  const [selectedId, setSelectedId] = useState<number | null>(defaultExerciseId);
  const [progression, setProgression] = useState<ExerciseProgressionRow[]>(defaultProgression);
  const [isPending, startTransition] = useTransition();
  const requestGuard = useRef(createLatestRequestGuard<number>());

  function handleChange(exerciseId: number) {
    setSelectedId(exerciseId);
    requestGuard.current.begin(exerciseId);
    startTransition(async () => {
      const data = await getExerciseProgressionAction(exerciseId);
      // An uncached (first-time) lookup can resolve after a faster, already-
      // cached one picked afterward — only apply the response that still
      // matches the current selection.
      if (requestGuard.current.isLatest(exerciseId)) {
        setProgression(data);
      }
    });
  }

  if (exercises.length === 0 || selectedId == null) {
    return <p className="mt-2 text-sm text-neutral-500">No exercises logged yet.</p>;
  }

  return (
    <div>
      <select
        value={selectedId}
        onChange={(e) => handleChange(Number(e.target.value))}
        disabled={isPending}
        className={FIELD_CLASS}
      >
        {exercises.map((exercise) => (
          <option key={exercise.id} value={exercise.id}>
            {exercise.muscle_group} — {exercise.name}
          </option>
        ))}
      </select>

      {progression.length > 0 ? (
        <ChartCard title="Exercise Progression" subtitle="Top weight and estimated 1-rep-max (Epley) per session, kg.">
          <ExerciseProgressionChart data={progression} />
        </ChartCard>
      ) : (
        <p className="mt-2 text-sm text-neutral-500">No sets logged for this exercise yet.</p>
      )}
    </div>
  );
}
