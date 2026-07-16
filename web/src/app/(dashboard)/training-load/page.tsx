import { getTrainingLoadPageData } from "@/lib/pageData";
import { RACE_DISTANCE_KM } from "@/lib/shared";
import {
  CategoryLoadChart,
  LongRunProgressionChart,
  MonthlyVolumeChart,
  TimeOnFeetChart,
  WeeklyDistanceChart,
} from "@/components/charts/TrainingLoadCharts";

export const runtime = "nodejs";

export default async function TrainingLoadPage() {
  const { volume, distanceData, timeData, longRunData, monthlySorted, categorySorted } = await getTrainingLoadPageData();

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
