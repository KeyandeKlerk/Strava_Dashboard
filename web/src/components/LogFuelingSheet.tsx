"use client";
import { useState, useTransition } from "react";
import { logNutritionEntryAction } from "@/app/(dashboard)/today/actions";
import type { RunningActivityOption } from "@/lib/metrics";

const FIELD_CLASS =
  "w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900";

export function LogFuelingSheet({
  activities,
  onClose,
}: {
  activities: RunningActivityOption[];
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await logNutritionEntryAction(formData);
      if (result.error) setError(result.error);
      else onClose();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-3xl rounded-t-xl bg-white p-4 dark:bg-neutral-950"
        onClick={(e) => e.stopPropagation()}
      >
        {activities.length === 0 ? (
          <p className="text-sm text-neutral-500">No recent runs to log fueling against yet.</p>
        ) : (
          <form action={handleSubmit} className="space-y-2">
            <h3 className="text-sm font-medium">Log fueling</h3>
            <select name="activity_id" required defaultValue={activities[0].id} className={FIELD_CLASS}>
              {activities.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.activity_date} · {a.name} ({a.distance_km} km)
                </option>
              ))}
            </select>
            <input name="carbs_g" type="number" step="1" min="0" required placeholder="Carbs (g)" className={FIELD_CLASS} />
            <input name="sodium_mg" type="number" step="1" min="0" required placeholder="Sodium (mg)" className={FIELD_CLASS} />
            <input name="fluid_ml" type="number" step="1" min="0" placeholder="Fluid (ml, optional)" className={FIELD_CLASS} />
            <input name="notes" placeholder="Notes (optional)" className={FIELD_CLASS} />
            <button
              type="submit"
              disabled={isPending}
              className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900"
            >
              Save
            </button>
          </form>
        )}

        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        <button type="button" onClick={onClose} className="mt-3 w-full text-center text-xs text-neutral-500">
          Cancel
        </button>
      </div>
    </div>
  );
}
