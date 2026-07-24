"use client";
import { useRef, useState, useTransition } from "react";
import { deleteBodyWeightLogAction, listBodyWeightLogsAction, logBodyWeightAction } from "@/lib/gymActions";
import { useWeightUnit } from "@/lib/gymOffline/useWeightUnit";
import { ChartCard } from "@/components/charts/ChartCard";
import { BodyWeightChart } from "@/components/charts/GymCharts";
import type { BodyWeightLogRow } from "@/lib/db/bodyWeightMutations";

const FIELD_CLASS =
  "w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900";

export function BodyWeightPage({
  initialLogs,
  initialChartData,
  today,
}: {
  initialLogs: BodyWeightLogRow[];
  initialChartData: BodyWeightLogRow[];
  today: string;
}) {
  const [logs, setLogs] = useState(initialLogs);
  const [chartData, setChartData] = useState(initialChartData);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const { unit, setUnit, toDisplay, toKg } = useWeightUnit();
  // Row (client_uuid) currently in "tap again to confirm" state — matches
  // GymSessionDetailSheet's two-tap delete pattern, mirrored per-row here.
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const confirmTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  function reload() {
    listBodyWeightLogsAction().then((next) => {
      setLogs(next);
      setChartData([...next].sort((a, b) => (a.logged_date < b.logged_date ? -1 : 1)));
    });
  }

  function handleSubmit(formData: FormData) {
    setError(null);
    const displayWeight = Number(formData.get("weight_display"));
    if (!Number.isFinite(displayWeight) || displayWeight <= 0) {
      setError("Enter a valid weight.");
      return;
    }
    formData.set("weight_kg", String(toKg(displayWeight)));

    startTransition(async () => {
      const result = await logBodyWeightAction(formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      reload();
    });
  }

  function handleDelete(clientUuid: string) {
    if (!clientUuid) return;
    if (confirmingDelete !== clientUuid) {
      setConfirmingDelete(clientUuid);
      if (confirmTimeout.current) clearTimeout(confirmTimeout.current);
      confirmTimeout.current = setTimeout(() => setConfirmingDelete(null), 4000);
      return;
    }
    if (confirmTimeout.current) clearTimeout(confirmTimeout.current);
    setConfirmingDelete(null);
    startTransition(async () => {
      await deleteBodyWeightLogAction(clientUuid);
      reload();
    });
  }

  return (
    <div>
      <form action={handleSubmit} className="space-y-2 rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-neutral-500">Log weight</label>
          <div className="flex items-center gap-1 text-xs">
            <button
              type="button"
              onClick={() => setUnit("kg")}
              className={`rounded-full px-2 py-0.5 ${unit === "kg" ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "bg-neutral-100 text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400"}`}
            >
              kg
            </button>
            <button
              type="button"
              onClick={() => setUnit("lb")}
              className={`rounded-full px-2 py-0.5 ${unit === "lb" ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "bg-neutral-100 text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400"}`}
            >
              lb
            </button>
          </div>
        </div>
        <input type="date" name="logged_date" defaultValue={today} required className={FIELD_CLASS} />
        <input
          type="number"
          name="weight_display"
          inputMode="decimal"
          step="0.1"
          min="0"
          placeholder={`Weight (${unit})`}
          required
          className={FIELD_CLASS}
        />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={isPending}
          className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
        >
          {isPending ? "Saving..." : "Log weight"}
        </button>
      </form>

      {chartData.length > 0 && (
        <ChartCard title="Body Weight" subtitle="Logged weight over time, kg.">
          <BodyWeightChart data={chartData} />
        </ChartCard>
      )}

      <div className="mt-4">
        <h2 className="text-sm font-medium">Recent entries</h2>
        {logs.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">No entries logged yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-neutral-200 text-sm dark:divide-neutral-800">
            {logs.map((log) => (
              <li key={log.client_uuid ?? log.id} className="flex items-center justify-between py-2">
                <span>
                  {log.logged_date} — {toDisplay(log.weight_kg).toFixed(1)} {unit}
                </span>
                <button
                  type="button"
                  onClick={() => log.client_uuid && handleDelete(log.client_uuid)}
                  disabled={isPending || !log.client_uuid}
                  className="text-xs text-red-600 disabled:opacity-40"
                >
                  {confirmingDelete === log.client_uuid ? "Tap again to confirm" : "Delete"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
