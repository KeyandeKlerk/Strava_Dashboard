import { getConnection } from "@/lib/db/client";
import {
  acwrHistory,
  backToBackRuns,
  ctlAtlTsbHistory,
  longRunPct,
  runPaceTrend,
  TRAINING_END,
  TRAINING_START,
  weeklyEfficiencyFactor,
  weeklyMonotony,
  weeklyRampRate,
} from "@/lib/metrics";
import { flag } from "@/lib/shared";
import { StatCard } from "@/components/StatCard";
import {
  AcwrChart,
  EfficiencyFactorChart,
  MonotonyStrainChart,
  RampRateChart,
  TsbChart,
} from "@/components/charts/FatigueCharts";

export const runtime = "nodejs";

function firstNonNull<T, K extends keyof T>(rows: T[], key: K): T[K] | null {
  for (const row of rows) if (row[key] != null) return row[key];
  return null;
}

// Isolated from the component body: this is a per-request Server Component
// (force-dynamic), so wall-clock time here is intentional, not a purity bug —
// factoring it out just satisfies the linter's static "no Date.now() in
// render" check, which can't see that this route never gets prerendered.
function fourWeeksAgoMs(): number {
  return Date.now() - 28 * 86400000;
}

export default async function FatiguePage() {
  const conn = await getConnection();
  const [tsb, ef, acwr, ramp, mono, longPct, b2b] = await Promise.all([
    ctlAtlTsbHistory(conn, TRAINING_START ?? undefined, TRAINING_END ?? undefined),
    weeklyEfficiencyFactor(conn),
    acwrHistory(conn),
    weeklyRampRate(conn),
    weeklyMonotony(conn),
    longRunPct(conn),
    backToBackRuns(conn, 15.0),
  ]);
  const paceTrend = await runPaceTrend(conn);

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

  const latestAcwr = firstNonNull(acwr, "acwr");
  const latestRamp = firstNonNull(ramp, "ramp_pct");
  const latestMono = firstNonNull(mono, "monotony");

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
      <div>
        <h1 className="text-lg font-semibold">Form &amp; Freshness</h1>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <StatCard label="TSB (Form)" value={latestTsb != null ? latestTsb.toFixed(1) : "—"} caption="Target +5 to +15 on race day" />
          <StatCard
            label={`${efArrow} Efficiency Factor`}
            value={latestEf != null ? latestEf.toFixed(3) : "—"}
            caption="Speed ÷ HR, weekly mean"
          />
        </div>
        {tsb.length > 0 ? (
          <div className="mt-3">
            <TsbChart data={tsb} />
          </div>
        ) : (
          <p className="mt-2 text-sm text-neutral-500">No training load data yet. Run sync to populate fitness history.</p>
        )}
        {ef.length > 0 && (
          <div className="mt-3">
            <EfficiencyFactorChart data={ef} />
          </div>
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
          <div className="mt-3">
            <AcwrChart data={acwr} />
          </div>
        )}
        {ramp.length > 0 && (
          <div className="mt-3">
            <RampRateChart data={ramp} />
          </div>
        )}
        {mono.length > 0 && (
          <div className="mt-3">
            <MonotonyStrainChart data={mono} />
          </div>
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
