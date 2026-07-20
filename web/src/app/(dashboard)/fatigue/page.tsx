import { getFatiguePageData } from "@/lib/pageData";
import { firstNonNull, flag, latestCompleteDay, todayIso, type TrainingStatus } from "@/lib/shared";
import { StatCard } from "@/components/StatCard";
import { ChartCard } from "@/components/charts/ChartCard";
import {
  AcwrChart,
  EfficiencyFactorChart,
  MonotonyChart,
  RampRateChart,
  StrainChart,
  TsbChart,
} from "@/components/charts/FatigueCharts";

export const runtime = "nodejs";

// Same plain-Tailwind-conditional-class convention as ReadinessBanner —
// green/amber/red/gray, not the SVG-chart CSS var palette.
const TRAINING_STATUS_STYLE: Record<TrainingStatus, string> = {
  Peaking: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
  Productive: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
  Maintaining: "border-neutral-200 bg-neutral-50 text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400",
  Recovery: "border-neutral-200 bg-neutral-50 text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400",
  Detraining: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
  Overreaching: "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300",
  "Insufficient Data": "border-neutral-200 bg-neutral-50 text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400",
};

// Isolated from the component body: this is a per-request Server Component
// (force-dynamic), so wall-clock time here is intentional, not a purity bug —
// factoring it out just satisfies the linter's static "no Date.now() in
// render" check, which can't see that this route never gets prerendered.
function fourWeeksAgoMs(): number {
  return Date.now() - 28 * 86400000;
}

export default async function FatiguePage() {
  const { tsb, ef, acwr, ramp, mono, longPct, b2b, paceTrend, niggles, vo2max, trainingStatus } = await getFatiguePageData();

  const latestTsb = tsb.length > 0 ? tsb[tsb.length - 1].tsb : null;
  const efSorted = [...ef].sort((a, b) => (a.week_start < b.week_start ? -1 : 1));
  const latestEf = efSorted.length > 0 ? efSorted[efSorted.length - 1].mean_ef : null;
  const recentEf = efSorted.slice(-4);
  const efArrow =
    recentEf.length >= 2
      ? recentEf[recentEf.length - 1].mean_ef > recentEf[0].mean_ef
        ? "↑"
        : recentEf[recentEf.length - 1].mean_ef < recentEf[0].mean_ef
          ? "↓"
          : "→"
      : "→";

  // acwr/ramp/mono come back most-recent-first, but charts need
  // chronological (ascending) order — Recharts renders array order
  // left-to-right, so passing these as-is would draw the x-axis backwards.
  //
  // ACWR/monotony "latest" is anchored to the last fully-elapsed day, not
  // today — today's rolling window only reflects however much of today has
  // happened so far (0km before you've logged a run), which reads as a
  // false dip rather than a real signal until you've actually run. Ramp is
  // exempt: it's now a calendar-week metric whose in-progress week already
  // substitutes the plan's target distance, so its latest row needs no such
  // anchor — a plain "most recent" read is already meaningful.
  const today = todayIso();
  const latestAcwr = latestCompleteDay(acwr, "acwr", today);
  const latestRamp = firstNonNull(ramp, "ramp_pct");
  const latestMono = latestCompleteDay(mono, "monotony", today);

  const acwrSorted = [...acwr].sort((a, b) => (a.day < b.day ? -1 : 1));
  const rampSorted = [...ramp].sort((a, b) => (a.week_start < b.week_start ? -1 : 1));
  const monoSorted = [...mono].sort((a, b) => (a.day < b.day ? -1 : 1));
  const strainVals = monoSorted.map((r) => r.strain);
  let latestStrain: number | null = null;
  let strainFlagColor: ReturnType<typeof flag> = "gray";
  const lastStrainIdx = [...strainVals].map((v, i) => (v != null ? i : -1)).filter((i) => i >= 0).pop();
  if (lastStrainIdx !== undefined) {
    latestStrain = strainVals[lastStrainIdx];
    const windowVals = strainVals
      .slice(Math.max(0, lastStrainIdx - 28), lastStrainIdx)
      .filter((v): v is number => v != null);
    const baseline = windowVals.length > 0 ? windowVals.reduce((a, b) => a + b, 0) / windowVals.length : null;
    if (baseline == null || baseline <= 0) strainFlagColor = "gray";
    else if (latestStrain! <= baseline) strainFlagColor = "green";
    else if (latestStrain! <= baseline * 2) strainFlagColor = "yellow";
    else strainFlagColor = "red";
  }

  const latestLongPct = firstNonNull(longPct, "long_run_pct");
  const cutoff = fourWeeksAgoMs();
  const b2bCount4w = b2b.filter((r) => new Date(`${r.day1}T00:00:00`).getTime() >= cutoff).length;
  const b2bFlagColor: ReturnType<typeof flag> = b2bCount4w <= 1 ? "green" : b2bCount4w === 2 ? "yellow" : "red";

  const decoupled = paceTrend.filter((r) => r.decoupling_pct != null).sort((a, b) => (a.activity_date < b.activity_date ? -1 : 1));
  const latestDecoupling = decoupled.length > 0 ? decoupled[decoupled.length - 1].decoupling_pct : null;

  return (
    <div className="space-y-6">
      <div className={`rounded-lg border p-3 ${TRAINING_STATUS_STYLE[trainingStatus.status]}`}>
        <p className="text-sm font-semibold">Training Status: {trainingStatus.status}</p>
        <p className="mt-1 text-xs opacity-90">{trainingStatus.description}</p>
      </div>

      <div>
        <h1 className="text-lg font-semibold">Form &amp; Freshness</h1>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <StatCard label="TSB (Form)" value={latestTsb != null ? latestTsb.toFixed(1) : "—"} caption="Target +5 to +15 on race day" />
          <StatCard
            label={`${efArrow} Efficiency Factor`}
            value={latestEf != null ? latestEf.toFixed(3) : "—"}
            caption="Speed ÷ HR, weekly mean"
          />
          <StatCard
            label="VO2max"
            value={vo2max != null ? vo2max.toFixed(1) : "—"}
            caption="Est. from best recent effort"
          />
        </div>
        {tsb.length > 0 ? (
          <ChartCard title="Fitness, Fatigue & Form" subtitle="CTL (fitness) and ATL (fatigue) build over time; TSB (form) is the gap between them — the target is +5 to +15 near race day.">
            <TsbChart data={tsb} />
          </ChartCard>
        ) : (
          <p className="mt-2 text-sm text-neutral-500">No training load data yet. Run sync to populate fitness history.</p>
        )}
        {ef.length > 0 && (
          <ChartCard title="Efficiency Factor" subtitle="Weekly mean speed ÷ heart rate. A rising trend means more speed for the same effort — better aerobic fitness.">
            <EfficiencyFactorChart data={ef} />
          </ChartCard>
        )}
      </div>

      <div>
        <h2 className="text-base font-semibold">Overreaching Risk</h2>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <StatCard label="ACWR" value={latestAcwr != null ? latestAcwr.toFixed(2) : "—"} caption="0.8–1.3 = safe zone" flag={flag(latestAcwr, 0.8, 1.3)} />
          <StatCard label="Weekly Ramp" value={latestRamp != null ? `${latestRamp.toFixed(1)}%` : "—"} caption="Stay within ±10%" flag={flag(latestRamp, -10, 10)} />
          <StatCard label="Monotony" value={latestMono != null ? latestMono.toFixed(2) : "—"} caption="Above 2.0 = too repetitive" flag={flag(latestMono, 0, 1.5)} />
          <StatCard label="Strain" value={latestStrain != null ? latestStrain.toFixed(0) : "—"} caption="Vs. trailing 4-week average" flag={strainFlagColor} />
        </div>
        {acwr.length > 0 && (
          <ChartCard title="Acute:Chronic Workload Ratio" subtitle="7-day load ÷ 28-day load. Green band (0.8–1.3) is the safe zone; above 1.5 is high injury risk.">
            <AcwrChart data={acwrSorted} />
          </ChartCard>
        )}
        {ramp.length > 0 && (
          <ChartCard title="Weekly Ramp Rate" subtitle="Week-over-week change in training load, %. Dashed lines mark the recommended ±10% guardrail.">
            <RampRateChart data={rampSorted} />
          </ChartCard>
        )}
        {mono.length > 0 && (
          <>
            <ChartCard title="Monotony" subtitle="How repetitive day-to-day training has been. Above 2.0 = too little variation between hard and easy days.">
              <MonotonyChart data={monoSorted} />
            </ChartCard>
            <ChartCard title="Strain" subtitle="Weekly load × monotony — a combined injury-risk signal. Compared against your trailing 4-week average above.">
              <StrainChart data={monoSorted} />
            </ChartCard>
          </>
        )}
      </div>

      <div>
        <h2 className="text-base font-semibold">Session / Structural Risk</h2>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <StatCard
            label="Long Run %"
            value={latestLongPct != null ? `${latestLongPct.toFixed(1)}%` : "—"}
            caption="Above 35% risks ITB"
            flag={flag(latestLongPct, 0, 35)}
          />
          <StatCard
            label="Back-to-Back (4wk)"
            value={String(b2bCount4w)}
            caption="3+ = high recovery debt"
            flag={b2bFlagColor}
          />
        </div>
        {niggles.length > 0 && (
          <div className="mt-3">
            <p className="text-xs font-medium text-neutral-500">Recent Niggles</p>
            {niggles.map((n) => (
              <p key={n.id} className="mt-1 text-sm">
                {n.activity_date} — {n.body_part.replace(/_/g, " ")} (severity {n.severity}/5)
                {n.notes && ` — ${n.notes}`}
              </p>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="text-base font-semibold">In-Session Physiological Fatigue</h2>
        <div className="mt-2">
          <StatCard
            label="Aerobic Decoupling"
            value={latestDecoupling != null ? `${latestDecoupling.toFixed(1)}%` : "—"}
            caption="Below 5% = aerobic system holding up. Full trend on Aerobic page."
            flag={flag(latestDecoupling, -5, 5)}
          />
        </div>
      </div>
    </div>
  );
}
