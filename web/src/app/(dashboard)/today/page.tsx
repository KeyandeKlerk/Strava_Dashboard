import { getTodayPageData } from "@/lib/pageData";
import { DailySessionList } from "@/components/DailySessionList";

export const runtime = "nodejs";

export default async function TodayPage() {
  const { weekSummary, today, current, daily } = await getTodayPageData();

  if (weekSummary.length === 0 || !current) {
    return (
      <div>
        <h1 className="text-lg font-semibold">This Week&apos;s Plan</h1>
        <p className="mt-2 text-sm text-neutral-500">
          No plan loaded yet. Upload a CSV on the Plan &amp; History page or add a race on the
          Race Prep page.
        </p>
      </div>
    );
  }

  const pct = Math.round(current.completion_pct ?? 0);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">This Week&apos;s Plan</h1>
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
      {daily.length === 0 ? (
        <p className="text-sm text-neutral-500">No daily sessions yet for this week.</p>
      ) : (
        <DailySessionList daily={daily} today={today} />
      )}
    </div>
  );
}
