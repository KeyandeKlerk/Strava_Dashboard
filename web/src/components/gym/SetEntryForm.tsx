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
  onSwap,
  showNext,
  onNext,
}: {
  sessionClientUuid: string;
  exercise: CachedExercise;
  nextSetNumber: number;
  onSwap: () => void;
  showNext: boolean;
  onNext: () => void;
}) {
  const { logSet } = useGymOffline();
  const { unit, toKg } = useWeightUnit();
  const [weight, setWeight] = useState("");
  const [reps, setReps] = useState("");
  const [isWarmup, setIsWarmup] = useState(false);
  const [rpe, setRpe] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(formData: FormData) {
    const weightValue = Number(formData.get("weight"));
    const repsValue = Number(formData.get("reps"));
    if (!Number.isFinite(weightValue) || weightValue <= 0) return;
    if (!Number.isInteger(repsValue) || repsValue <= 0) return;

    // RPE is optional — blank means "not recorded". Out-of-range/garbage
    // input is silently rejected (set isn't logged) rather than clamped or
    // coerced, matching the weight/reps guards above.
    const rpeRaw = formData.get("rpe");
    const rpeText = typeof rpeRaw === "string" ? rpeRaw.trim() : "";
    let rpeValue: number | null = null;
    if (rpeText !== "") {
      const parsed = Number(rpeText);
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > 10) return;
      rpeValue = parsed;
    }

    setIsSaving(true);
    try {
      await logSet({
        sessionClientUuid,
        exercise,
        setNumber: nextSetNumber,
        weightKg: toKg(weightValue),
        reps: repsValue,
        isWarmup,
        rpe: rpeValue,
      });
      setWeight("");
      setReps("");
      // Warm-ups are the exception, not the rule — don't carry the checked
      // state forward to the next set.
      setIsWarmup(false);
      setRpe("");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form
      action={handleSubmit}
      className="rounded-xl border border-neutral-200 p-3 shadow-sm dark:border-neutral-800"
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{exercise.name}</p>
        <button type="button" onClick={onSwap} className="text-xs text-neutral-500 underline">
          Swap
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
      <input
        name="rpe"
        type="number"
        inputMode="decimal"
        step="0.5"
        min="1"
        max="10"
        value={rpe}
        onChange={(e) => setRpe(e.target.value)}
        placeholder="RPE (optional)"
        className={`mt-2 ${FIELD_CLASS}`}
      />
      <label className="mt-2 flex items-center gap-2 text-xs text-neutral-500">
        <input
          type="checkbox"
          checked={isWarmup}
          onChange={(e) => setIsWarmup(e.target.checked)}
          className="h-4 w-4 rounded border-neutral-300 dark:border-neutral-700"
        />
        Warm-up set
      </label>
      <div className="mt-2 flex gap-2">
        <button
          type="submit"
          disabled={isSaving}
          className="flex-1 rounded-md bg-neutral-900 px-3 py-2 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900"
        >
          Log set {nextSetNumber}
        </button>
        {showNext && (
          <button
            type="button"
            onClick={onNext}
            className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700"
          >
            Next exercise →
          </button>
        )}
      </div>
    </form>
  );
}
