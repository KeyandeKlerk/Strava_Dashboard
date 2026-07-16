import { getConnection } from "@/lib/db/client";
import { longRunQualityScores, runPaceTrend, weeklyZoneTime } from "@/lib/metrics";
import { flag } from "@/lib/shared";
import { StatCard } from "@/components/StatCard";
import {
  DecouplingChart,
  EasyPctChart,
  PaceTrendChart,
  QualityScoreChart,
  ZoneTimeChart,
} from "@/components/charts/AerobicCharts";

export const runtime = "nodejs";

export default async function AerobicPage() {
  const conn = await getConnection();
  const [zoneTime, paceTrend, qualityScores] = await Promise.all([
    weeklyZoneTime(conn),
    runPaceTrend(conn),
    longRunQualityScores(conn),
  ]);

  const zoneSorted = [...zoneTime].sort((a, b) => (a.week_start < b.week_start ? -1 : 1));
  const withEasyPct = zoneSorted.map((z) => {
    const total = z.z1_min + z.z2_min + z.z3_min + z.z4_min + z.z5_min;
    return { week_start: z.week_start, easy_pct: total > 0 ? ((z.z1_min + z.z2_min) / total) * 100 : null };
  });
  const easyPctValues = withEasyPct.filter((z) => z.easy_pct != null);
  const latestEasyPct = easyPctValues.length > 0 ? easyPctValues[easyPctValues.length - 1].easy_pct : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Aerobic Fitness</h1>

        {zoneSorted.length > 0 ? (
          <>
            <div className="mt-3">
              <ZoneTimeChart data={zoneSorted} />
            </div>
            <div className="mt-3">
              <StatCard
                label="80/20 Compliance"
                value={latestEasyPct != null ? `${latestEasyPct.toFixed(0)}%` : "—"}
                caption="% of run time in Z1+Z2. Target 75–85%."
                flag={flag(latestEasyPct, 75, 85)}
              />
              <div className="mt-2">
                <EasyPctChart data={withEasyPct} />
              </div>
            </div>
          </>
        ) : (
          <p className="mt-2 text-sm text-neutral-500">No HR zone data yet.</p>
        )}

        {paceTrend.length > 0 ? (
          <>
            <div className="mt-3">
              <h2 className="text-sm font-medium text-neutral-500">Run Pace Trend (min/km)</h2>
              <PaceTrendChart data={paceTrend} />
            </div>
            <div className="mt-3">
              <h2 className="text-sm font-medium text-neutral-500">Aerobic Decoupling % (last 20)</h2>
              <DecouplingChart data={paceTrend} />
            </div>
          </>
        ) : (
          <p className="mt-2 text-sm text-neutral-500">No streams data yet — run the backfill.</p>
        )}
      </div>

      <div>
        <h2 className="text-base font-semibold">Long Run Quality (≥20 km)</h2>
        {qualityScores.length > 0 ? (
          <div className="mt-2">
            <QualityScoreChart data={qualityScores} />
          </div>
        ) : (
          <p className="mt-2 text-sm text-neutral-500">
            No long runs ≥20 km with stream data yet — run the backfill.
          </p>
        )}
      </div>
    </div>
  );
}
