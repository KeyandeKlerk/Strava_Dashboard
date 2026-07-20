import { getTrainingLoadPageData } from "@/lib/pageData";
import { StatCard } from "@/components/StatCard";
import { ChartCard } from "@/components/charts/ChartCard";
import {
  CategoryLoadChart,
  LongRunProgressionChart,
  MonthlyDistanceChart,
  MonthlyTimeChart,
  TimeOnFeetChart,
  WeeklyDistanceChart,
} from "@/components/charts/TrainingLoadCharts";

export const runtime = "nodejs";

export default async function TrainingLoadPage() {
  const { volume, distanceData, timeData, longRunData, monthlySorted, categorySorted, goalRaceDistanceKm } =
    await getTrainingLoadPageData();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Weekly Mileage</h1>
        {volume.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">No activity data yet. Run sync first.</p>
        ) : (
          <>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <StatCard
                label="This Week"
                value={`${distanceData[distanceData.length - 1].actual_km.toFixed(1)} km`}
                caption={`Planned ${distanceData[distanceData.length - 1].planned_km.toFixed(1)} km`}
              />
              <StatCard
                label="4wk Rolling Avg"
                value={
                  distanceData[distanceData.length - 1].rolling_4w_avg != null
                    ? `${distanceData[distanceData.length - 1].rolling_4w_avg!.toFixed(1)} km`
                    : "—"
                }
              />
            </div>
            <ChartCard title="Weekly Distance" subtitle="Planned vs. actual running distance, km. Orange line is the 4-week rolling average.">
              <WeeklyDistanceChart data={distanceData} />
            </ChartCard>
            <ChartCard title="Time on Feet" subtitle="Total running time per week, hours. Dashed line marks the 8h/week reference.">
              <TimeOnFeetChart data={timeData} />
            </ChartCard>
            {monthlySorted.length > 0 && (
              <>
                <ChartCard title="Monthly Distance" subtitle="Total running distance per month, km.">
                  <MonthlyDistanceChart data={monthlySorted} />
                </ChartCard>
                <ChartCard title="Monthly Time" subtitle="Total running time per month, hours.">
                  <MonthlyTimeChart data={monthlySorted} />
                </ChartCard>
              </>
            )}
          </>
        )}
      </div>

      {longRunData.length > 0 && (
        <div>
          <h2 className="text-base font-semibold">Long Run Progression</h2>
          <ChartCard title="Longest Run per Week" subtitle="Distance, km. Lines mark 50% and 67% of race distance — common long-run benchmarks.">
            <LongRunProgressionChart data={longRunData} raceDistanceKm={goalRaceDistanceKm} />
          </ChartCard>
        </div>
      )}

      <div>
        <h2 className="text-base font-semibold">Training Load by Category</h2>
        {categorySorted.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">No activity data yet.</p>
        ) : (
          <ChartCard title="Weekly Load by Activity Type" subtitle="Stacked training load per week, by sport.">
            <CategoryLoadChart data={categorySorted} />
          </ChartCard>
        )}
      </div>
    </div>
  );
}
