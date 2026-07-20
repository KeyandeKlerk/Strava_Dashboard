import { getPlanHistoryPageData } from "@/lib/pageData";
import { fmtPace } from "@/lib/shared";
import { CsvImportForm } from "@/components/CsvImportForm";
import { WeekExplorer } from "@/components/WeekExplorer";
import { ShowMoreTable } from "@/components/ShowMoreTable";
import { StatCard } from "@/components/StatCard";

export const runtime = "nodejs";

export default async function PlanHistoryPage() {
  const { longRuns, recent, weekSummary, dailyByWeek, defaultWeek, today } = await getPlanHistoryPageData();

  // Every other week — past and future — stays browsable here; only the
  // current in-progress week is excluded, since its live checklist already
  // renders on the Today tab and showing it here too was the exact duplicate
  // view being removed.
  const otherWeeks = weekSummary.filter((w) => w.week_number !== defaultWeek);
  const explorerWeeks = otherWeeks.length > 0 ? otherWeeks : weekSummary;
  const explorerDefaultWeek = otherWeeks[0]?.week_number ?? defaultWeek;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-2">
        <StatCard label="Long Runs Logged" value={String(longRuns.length)} />
        <StatCard label="Weeks Tracked" value={String(weekSummary.length)} />
      </div>

      <div>
        <h1 className="text-lg font-semibold">Long Run Log (≥20 km)</h1>
        {longRuns.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">No runs ≥20 km yet.</p>
        ) : (
          <ShowMoreTable
            headers={["Date", "Name", "km", "Pace", "Gain (m)", "Avg HR", "Decoupling %"]}
            rows={longRuns.map((r) => (
              <tr key={`${r.activity_date}-${r.name}`} className="border-t border-neutral-100 dark:border-neutral-900">
                <td className="py-1 pr-2">{r.activity_date}</td>
                <td className="py-1 pr-2">{r.name}</td>
                <td className="py-1 pr-2">{r.distance_km.toFixed(1)}</td>
                <td className="py-1 pr-2">{fmtPace(r.pace_min_km)}</td>
                <td className="py-1 pr-2">{r.elevation_gain_m}</td>
                <td className="py-1 pr-2">{r.avg_hr ?? "—"}</td>
                <td className="py-1 pr-2">{r.decoupling_pct ?? "—"}</td>
              </tr>
            ))}
          />
        )}
      </div>

      <div>
        <h2 className="text-base font-semibold">Recent Activities</h2>
        {recent.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">No activities to display.</p>
        ) : (
          <ShowMoreTable
            headers={["Date", "Name", "Category", "km", "Time (min)", "Load"]}
            rows={recent.map((r) => (
              <tr key={`${r.date}-${r.name}`} className="border-t border-neutral-100 dark:border-neutral-900">
                <td className="py-1 pr-2">{r.date}</td>
                <td className="py-1 pr-2">{r.name}</td>
                <td className="py-1 pr-2">{r.category}</td>
                <td className="py-1 pr-2">{r.distance_km ?? "—"}</td>
                <td className="py-1 pr-2">{r.duration_min}</td>
                <td className="py-1 pr-2">{r.load_score}</td>
              </tr>
            ))}
          />
        )}
      </div>

      <div>
        <h2 className="text-base font-semibold">Training Plan</h2>
        <p className="mt-1 text-xs text-neutral-500">
          This week&apos;s live checklist is on the Today tab — browse any other week here.
        </p>
        <details className="mt-2">
          <summary className="cursor-pointer text-sm font-medium">Import plan from CSV</summary>
          <div className="mt-2">
            <CsvImportForm />
          </div>
        </details>

        {weekSummary.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-500">
            No plan loaded yet. Upload a CSV above or add a race on the Race Prep page.
          </p>
        ) : (
          <div className="mt-3">
            <WeekExplorer
              weeks={explorerWeeks}
              dailyByWeek={dailyByWeek}
              defaultWeekNumber={explorerDefaultWeek}
              today={today}
            />
          </div>
        )}
      </div>
    </div>
  );
}
