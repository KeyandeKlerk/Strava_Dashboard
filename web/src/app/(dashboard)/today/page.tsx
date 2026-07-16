import { getConnection } from "@/lib/db/client";
import { dailyPlanForWeek, weeklyCompletionSummary } from "@/lib/metrics";
import { DailySessionList } from "@/components/DailySessionList";

export const runtime = "nodejs";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function TodayPage() {
  const conn = await getConnection();
  const weekSummary = await weeklyCompletionSummary(conn);

  if (weekSummary.length === 0) {
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

  const today = todayIso();
  const current =
    weekSummary.find((w) => {
      const start = w.week_start_date;
      const end = new Date(new Date(`${start}T00:00:00`).getTime() + 7 * 86400000)
        .toISOString()
        .slice(0, 10);
      return start <= today && today < end;
    }) ?? weekSummary[0];

  const pct = Math.round(current.completion_pct ?? 0);
  const daily = await dailyPlanForWeek(conn, current.week_number);

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
