import { getTodayPageData } from "@/lib/pageData";
import { DailySessionList } from "@/components/DailySessionList";
import { NutritionSection } from "@/components/NutritionSection";
import { StatCard } from "@/components/StatCard";

export const runtime = "nodejs";

export default async function TodayPage() {
  const {
    weekSummary,
    today,
    current,
    daily,
    nutritionTargets,
    nutritionLog,
    pickerActivities,
    fuelingProjection,
    milestones,
  } = await getTodayPageData();

  if (weekSummary.length === 0 || !current) {
    return (
      <div>
        <h1 className="text-lg font-semibold">This Week&apos;s Plan</h1>
        <p className="mt-2 text-sm text-neutral-500">
          No plan loaded yet. Upload a CSV on the Plan &amp; History page or add a race on the
          Race Prep page.
        </p>
        <NutritionSection
          targets={nutritionTargets}
          log={nutritionLog}
          activities={pickerActivities}
          projection={fuelingProjection}
        />
      </div>
    );
  }

  const pct = Math.round(current.completion_pct ?? 0);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">This Week&apos;s Plan</h1>
      <div className="grid grid-cols-2 gap-2">
        <StatCard label="Week Phase" value={current.phase} caption={current.is_deload ? "Deload week" : "Build week"} />
        <StatCard
          label="Projected Finish"
          value={milestones.projected_finish_h != null ? `${milestones.projected_finish_h.toFixed(1)}h` : "—"}
          caption={`Cutoff ${milestones.cutoff_h.toFixed(0)}h`}
        />
      </div>
      <div>
        <div className="h-3 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
          <div
            className="h-full bg-emerald-500 transition-[width]"
            style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
          />
        </div>
        <p className="mt-1 text-sm text-neutral-500">
          {current.run_days_done}/{current.run_days} runs done · {pct}% complete
        </p>
      </div>
      <DailySessionList
        daily={daily}
        today={today}
        weekStartDate={current.week_start_date}
        weekNumber={current.week_number}
      />
      <NutritionSection
        targets={nutritionTargets}
        log={nutritionLog}
        activities={pickerActivities}
        projection={fuelingProjection}
      />
    </div>
  );
}
