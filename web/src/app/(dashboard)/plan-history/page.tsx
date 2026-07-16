import { getPlanHistoryPageData } from "@/lib/pageData";
import { fmtPace } from "@/lib/shared";
import { CsvImportForm } from "@/components/CsvImportForm";
import { WeekExplorer } from "@/components/WeekExplorer";

export const runtime = "nodejs";

export default async function PlanHistoryPage() {
  const { longRuns, recent, weekSummary, dailyByWeek, defaultWeek, today } = await getPlanHistoryPageData();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Long Run Log (≥20 km)</h1>
        {longRuns.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">No runs ≥20 km yet.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-neutral-500">
                  <th className="py-1 pr-2">Date</th>
                  <th className="py-1 pr-2">Name</th>
                  <th className="py-1 pr-2">km</th>
                  <th className="py-1 pr-2">Pace</th>
                  <th className="py-1 pr-2">Gain (m)</th>
                  <th className="py-1 pr-2">Avg HR</th>
                  <th className="py-1 pr-2">Decoupling %</th>
                </tr>
              </thead>
              <tbody>
                {longRuns.map((r) => (
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
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <h2 className="text-base font-semibold">Recent Activities</h2>
        {recent.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">No activities to display.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-neutral-500">
                  <th className="py-1 pr-2">Date</th>
                  <th className="py-1 pr-2">Name</th>
                  <th className="py-1 pr-2">Category</th>
                  <th className="py-1 pr-2">km</th>
                  <th className="py-1 pr-2">Time (min)</th>
                  <th className="py-1 pr-2">Load</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={`${r.date}-${r.name}`} className="border-t border-neutral-100 dark:border-neutral-900">
                    <td className="py-1 pr-2">{r.date}</td>
                    <td className="py-1 pr-2">{r.name}</td>
                    <td className="py-1 pr-2">{r.category}</td>
                    <td className="py-1 pr-2">{r.distance_km ?? "—"}</td>
                    <td className="py-1 pr-2">{r.duration_min}</td>
                    <td className="py-1 pr-2">{r.load_score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <h2 className="text-base font-semibold">Training Plan</h2>
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
              weeks={weekSummary}
              dailyByWeek={dailyByWeek}
              defaultWeekNumber={defaultWeek}
              today={today}
            />
          </div>
        )}
      </div>
    </div>
  );
}
