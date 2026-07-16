import { getConnection } from "@/lib/db/client";
import { monthlyVolume, planAdherence, weeklyCategoryLoad, weeklyVolume } from "@/lib/metrics";
import { RACE_DISTANCE_KM } from "@/lib/shared";
import {
  CategoryLoadChart,
  LongRunProgressionChart,
  MonthlyVolumeChart,
  TimeOnFeetChart,
  WeeklyDistanceChart,
} from "@/components/charts/TrainingLoadCharts";

export const runtime = "nodejs";

function rollingAvg(values: number[], window: number): Array<number | null> {
  return values.map((_, i) => {
    if (i + 1 < window) return null;
    const slice = values.slice(i + 1 - window, i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

export default async function TrainingLoadPage() {
  const conn = await getConnection();
  const [volume, adherence, monthly, categoryLoad] = await Promise.all([
    weeklyVolume(conn),
    planAdherence(conn),
    monthlyVolume(conn),
    weeklyCategoryLoad(conn),
  ]);

  const volSorted = [...volume].sort((a, b) => (a.week_start < b.week_start ? -1 : 1));
  const rolling = rollingAvg(volSorted.map((v) => v.run_distance_km), 4);
  const plannedByWeek = new Map(adherence.map((a) => [a.week_start_date.slice(0, 10), a.planned_distance_km]));

  const distanceData = volSorted.map((v, i) => ({
    week_start: v.week_start,
    actual_km: v.run_distance_km,
    planned_km: plannedByWeek.get(v.week_start.slice(0, 10)) ?? 0,
    rolling_4w_avg: rolling[i],
  }));
  const timeData = volSorted.map((v) => ({ week_start: v.week_start, run_time_h: v.run_time_min / 60 }));
  const longRunData = volSorted.filter((v) => v.longest_run_km > 0).map((v) => ({ week_start: v.week_start, longest_run_km: v.longest_run_km }));
  const monthlySorted = [...monthly].sort((a, b) => (a.month_start < b.month_start ? -1 : 1));
  const categorySorted = [...categoryLoad].sort((a, b) => (a.week_start < b.week_start ? -1 : 1));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Weekly Mileage</h1>
        {volume.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">No activity data yet. Run sync first.</p>
        ) : (
          <>
            <div className="mt-3">
              <WeeklyDistanceChart data={distanceData} />
            </div>
            <div className="mt-3">
              <TimeOnFeetChart data={timeData} />
            </div>
            {monthlySorted.length > 0 && (
              <div className="mt-3">
                <MonthlyVolumeChart data={monthlySorted} />
              </div>
            )}
          </>
        )}
      </div>

      {longRunData.length > 0 && (
        <div>
          <h2 className="text-base font-semibold">Long Run Progression</h2>
          <div className="mt-2">
            <LongRunProgressionChart data={longRunData} raceDistanceKm={RACE_DISTANCE_KM} />
          </div>
        </div>
      )}

      <div>
        <h2 className="text-base font-semibold">Training Load by Category</h2>
        {categorySorted.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">No activity data yet.</p>
        ) : (
          <div className="mt-2">
            <CategoryLoadChart data={categorySorted} />
          </div>
        )}
      </div>
    </div>
  );
}
