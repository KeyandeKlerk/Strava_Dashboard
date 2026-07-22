"use client";
import { useWeightUnit } from "@/lib/gymOffline/useWeightUnit";

export function WeightUnitToggle() {
  const { unit, setUnit } = useWeightUnit();

  return (
    <div className="inline-flex rounded-md border border-neutral-300 text-xs dark:border-neutral-700">
      {(["kg", "lb"] as const).map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => setUnit(option)}
          className={`px-2 py-1 first:rounded-l-md last:rounded-r-md ${
            unit === option
              ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
              : "text-neutral-500 dark:text-neutral-400"
          }`}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
