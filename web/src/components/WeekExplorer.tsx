"use client";
import { useState } from "react";
import { DailySessionList } from "@/components/DailySessionList";
import { weekLabel } from "@/lib/shared";
import type { DailyPlanRow, WeeklyCompletionSummaryRow } from "@/lib/metrics";

export function WeekExplorer({
  weeks,
  dailyByWeek,
  defaultWeekNumber,
  today,
}: {
  weeks: WeeklyCompletionSummaryRow[];
  dailyByWeek: Record<number, DailyPlanRow[]>;
  defaultWeekNumber: number;
  today: string;
}) {
  const [selected, setSelected] = useState(defaultWeekNumber);
  const row = weeks.find((w) => w.week_number === selected) ?? weeks[0];
  const pct = Math.round(row?.completion_pct ?? 0);

  return (
    <div>
      <select
        value={selected}
        onChange={(e) => setSelected(Number(e.target.value))}
        className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
      >
        {weeks.map((w) => (
          <option key={w.week_number} value={w.week_number}>
            {weekLabel(w)}
          </option>
        ))}
      </select>
      <div className="mt-2">
        <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
          <div
            className="h-full bg-emerald-500"
            style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
          />
        </div>
        <p className="mt-1 text-xs text-neutral-500">
          {row?.run_days_done ?? 0}/{row?.run_days ?? 0} runs done · {pct}% complete
        </p>
      </div>
      <div className="mt-3">
        <DailySessionList
          daily={dailyByWeek[selected] ?? []}
          today={today}
          weekStartDate={row?.week_start_date ?? ""}
          weekNumber={selected}
        />
      </div>
    </div>
  );
}
