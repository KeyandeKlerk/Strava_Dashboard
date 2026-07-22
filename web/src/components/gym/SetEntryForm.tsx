"use client";
import { useState } from "react";
import { useGymOffline } from "@/lib/gymOffline/context";
import { useWeightUnit } from "@/lib/gymOffline/useWeightUnit";
import type { CachedExercise } from "@/lib/gymOffline/db";

const FIELD_CLASS =
  "w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900";

export function SetEntryForm({
  sessionClientUuid,
  exercise,
  nextSetNumber,
  onClear,
}: {
  sessionClientUuid: string;
  exercise: CachedExercise;
  nextSetNumber: number;
  onClear: () => void;
}) {
  const { logSet } = useGymOffline();
  const { unit, toKg } = useWeightUnit();
  const [weight, setWeight] = useState("");
  const [reps, setReps] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(formData: FormData) {
    const weightValue = Number(formData.get("weight"));
    const repsValue = Number(formData.get("reps"));
    if (!Number.isFinite(weightValue) || weightValue <= 0) return;
    if (!Number.isInteger(repsValue) || repsValue <= 0) return;

    setIsSaving(true);
    try {
      await logSet({
        sessionClientUuid,
        exercise,
        setNumber: nextSetNumber,
        weightKg: toKg(weightValue),
        reps: repsValue,
      });
      setWeight("");
      setReps("");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form action={handleSubmit} className="mt-2 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{exercise.name}</p>
        <button type="button" onClick={onClear} className="text-xs text-neutral-500">
          Change
        </button>
      </div>
      <div className="mt-2 flex gap-2">
        <input
          name="weight"
          type="number"
          inputMode="decimal"
          step="0.5"
          min="0"
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
          placeholder={`Weight (${unit})`}
          required
          className={FIELD_CLASS}
        />
        <input
          name="reps"
          type="number"
          inputMode="numeric"
          step="1"
          min="1"
          value={reps}
          onChange={(e) => setReps(e.target.value)}
          placeholder="Reps"
          required
          className={FIELD_CLASS}
        />
      </div>
      <button
        type="submit"
        disabled={isSaving}
        className="mt-2 w-full rounded-md bg-neutral-900 px-3 py-2 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900"
      >
        Log set {nextSetNumber}
      </button>
    </form>
  );
}
