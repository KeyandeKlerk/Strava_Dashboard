import { getAerobicPageData } from "@/lib/pageData";
import { flag } from "@/lib/shared";
import { StatCard } from "@/components/StatCard";
import { ChartCard } from "@/components/charts/ChartCard";
import {
  DecouplingChart,
  EasyPctChart,
  PaceTrendChart,
  QualityScoreChart,
  SEMANTIC_COLOR,
  ZoneTimeChart,
} from "@/components/charts/AerobicCharts";

const QUALITY_LEGEND = [
  { color: SEMANTIC_COLOR.good, label: "Good (≥70)" },
  { color: SEMANTIC_COLOR.borderline, label: "Fair (40–69)" },
  { color: SEMANTIC_COLOR.bad, label: "Poor (<40)" },
];

const DECOUPLING_LEGEND = [
  { color: SEMANTIC_COLOR.good, label: "Holding up (≤0%)" },
  { color: SEMANTIC_COLOR.borderline, label: "Borderline (0–5%)" },
  { color: SEMANTIC_COLOR.bad, label: "Drifting (≥5%)" },
];

export const runtime = "nodejs";

export default async function AerobicPage() {
  const { zoneSorted, withEasyPct, latestEasyPct, paceTrend, qualityScores } = await getAerobicPageData();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Aerobic Fitness</h1>

        {zoneSorted.length > 0 ? (
          <>
            <ChartCard title="Weekly Time in HR Zones" subtitle="Minutes per week in each heart-rate zone, Z1 (easiest) to Z5 (hardest).">
              <ZoneTimeChart data={zoneSorted} />
            </ChartCard>
            <div className="mt-3">
              <StatCard
                label="80/20 Compliance"
                value={latestEasyPct != null ? `${latestEasyPct.toFixed(0)}%` : "—"}
                caption="% of run time in Z1+Z2. Target 75–85%."
                flag={flag(latestEasyPct, 75, 85)}
              />
              <ChartCard title="80/20 Compliance Trend" subtitle="% of weekly run time in Z1+Z2 (easy). Dashed line marks the 80% target.">
                <EasyPctChart data={withEasyPct} />
              </ChartCard>
            </div>
          </>
        ) : (
          <p className="mt-2 text-sm text-neutral-500">No HR zone data yet.</p>
        )}

        {paceTrend.length > 0 ? (
          <>
            <ChartCard title="Run Pace Trend" subtitle="Average pace per run, min/km. Axis is inverted so faster runs plot higher.">
              <PaceTrendChart data={paceTrend} />
            </ChartCard>
            <ChartCard
              title="Aerobic Decoupling (Last 20 Runs)"
              subtitle="Pace-to-HR drift over a run's second half, %. Below 5% (dashed line) means the aerobic system held up."
              legend={DECOUPLING_LEGEND}
            >
              <DecouplingChart data={paceTrend} />
            </ChartCard>
          </>
        ) : (
          <p className="mt-2 text-sm text-neutral-500">No streams data yet — run the backfill.</p>
        )}
      </div>

      <div>
        <h2 className="text-base font-semibold">Long Run Quality (≥20 km)</h2>
        {qualityScores.length > 0 ? (
          <ChartCard
            title="Long Run Quality Score"
            subtitle="0–100 score per long run; bubble size is the run's distance."
            legend={QUALITY_LEGEND}
          >
            <QualityScoreChart data={qualityScores} />
          </ChartCard>
        ) : (
          <p className="mt-2 text-sm text-neutral-500">
            No long runs ≥20 km with stream data yet — run the backfill.
          </p>
        )}
      </div>
    </div>
  );
}
