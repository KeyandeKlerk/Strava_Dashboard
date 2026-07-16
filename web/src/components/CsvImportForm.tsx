"use client";
import { useActionState } from "react";
import { importPlanCsv, type ImportPlanState } from "@/app/(dashboard)/plan-history/actions";

const initialState: ImportPlanState = {};

export function CsvImportForm() {
  const [state, formAction, pending] = useActionState(importPlanCsv, initialState);

  return (
    <form action={formAction} className="space-y-2">
      <p className="text-xs text-neutral-500">
        Columns: planned_date, week_number, day_of_week, session_type, planned_distance_km,
        intensity, description, is_quality. Uploading replaces the entire existing plan.
      </p>
      <input
        type="file"
        name="file"
        accept=".csv"
        required
        className="block w-full text-sm text-neutral-600 dark:text-neutral-400"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
      >
        {pending ? "Importing…" : "Import"}
      </button>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      {state.success && <p className="text-sm text-emerald-600">{state.success}</p>}
    </form>
  );
}
