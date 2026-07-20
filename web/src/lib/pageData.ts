// Caches each page's data fetch so tab navigation is instant, and only
// re-queries MotherDuck when explicitly invalidated (the webhook route calls
// revalidateTag(DASHBOARD_DATA_TAG) after a sync completes). No time-based
// fallback revalidation on purpose — data is meant to stay cached until the
// next sync, not silently go stale-then-refresh on a timer. If a sync ever
// fails to invalidate (e.g. an error before that point), the cache simply
// keeps serving the last-known-good data until the next successful sync.
import { unstable_cache } from "next/cache";
import { getConnection, queryRow } from "./db/client";
import { getAllRaceEvents, getPrimaryGoalRace } from "./db/mutations";
import {
  acwrHistory,
  backToBackRuns,
  bestRecentEffort,
  comradesProjectedSplits,
  COMRADES_CHECKPOINTS,
  ctlAtlTsbHistory,
  dailyPlanForWeek,
  getNutritionTargets,
  longRunHistory,
  longRunPct,
  longRunQualityScores,
  monthlyVolume,
  nutritionLogHistory,
  planAdherence,
  projectedRaceFueling,
  raceMilestones,
  recentActivities,
  recentNiggleLogs,
  recentRunningActivitiesForPicker,
  runPaceTrend,
  shoeMileage,
  weeklyCategoryLoad,
  weeklyCompletionSummary,
  weeklyEfficiencyFactor,
  weeklyElevation,
  weeklyMonotony,
  weeklyRampRate,
  weeklyVolume,
  weeklyZoneTime,
  TRAINING_END,
  TRAINING_START,
} from "./metrics";
import {
  BANDS,
  computeReadiness,
  computeTrainingStatus,
  danielsVo2max,
  firstNonNull,
  flag,
  latestCompleteDay,
  riegelPredict,
  todayIso,
} from "./shared";

interface GoalRaceRow {
  id: number;
  name: string;
  race_date: string;
  distance_km: number;
  priority: string;
  target_finish_h: number | null;
  notes: string | null;
  strava_activity_id: number | null;
  terrain_factor: number | null;
  cutoff_h: number | null;
}

function isComradesRace(goalRace: GoalRaceRow | undefined): boolean {
  return goalRace ? goalRace.name.toLowerCase().includes("comrades") : false;
}

export const DASHBOARD_DATA_TAG = "dashboard-data";

function rollingAvg(values: number[], window: number): Array<number | null> {
  return values.map((_, i) => {
    if (i + 1 < window) return null;
    const slice = values.slice(i + 1 - window, i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

export const getTodayPageData = unstable_cache(
  async () => {
    const conn = await getConnection();
    const weekSummary = await weeklyCompletionSummary(conn);
    const [nutritionTargets, nutritionLog, pickerActivities, goalRace, acwr, ramp, mono, longPct, paceTrend] =
      await Promise.all([
        getNutritionTargets(conn),
        nutritionLogHistory(conn),
        recentRunningActivitiesForPicker(conn),
        getPrimaryGoalRace<GoalRaceRow>(conn),
        acwrHistory(conn),
        weeklyRampRate(conn),
        weeklyMonotony(conn),
        longRunPct(conn),
        runPaceTrend(conn),
      ]);
    const milestones = goalRace
      ? await raceMilestones(conn, goalRace.distance_km, goalRace.cutoff_h, isComradesRace(goalRace) ? 1800 : undefined)
      : null;
    const fuelingProjection = milestones ? projectedRaceFueling(milestones.projected_finish_h, nutritionTargets) : null;
    const today = todayIso();

    // Same "latest value" derivation and thresholds as fatigue/page.tsx's
    // per-signal StatCards — rolled up into one worst-signal-wins verdict
    // instead of five separate numbers the reader has to combine mentally.
    // ACWR/monotony are anchored to the last fully-elapsed day, not today —
    // today's row only reflects however much of today has happened so far
    // (0km before you've run), which would otherwise read as a false dip.
    // Ramp is a calendar-week metric whose in-progress week already
    // substitutes the plan's target distance, so it needs no such anchor.
    const latestAcwr = latestCompleteDay(acwr, "acwr", today);
    const latestRamp = firstNonNull(ramp, "ramp_pct");
    const latestMono = latestCompleteDay(mono, "monotony", today);
    const latestLongPct = firstNonNull(longPct, "long_run_pct");
    const decoupled = paceTrend
      .filter((r) => r.decoupling_pct != null)
      .sort((a, b) => (a.activity_date < b.activity_date ? -1 : 1));
    const latestDecoupling = decoupled.length > 0 ? decoupled[decoupled.length - 1].decoupling_pct : null;

    const readiness = computeReadiness([
      {
        label: "ACWR",
        flag: flag(latestAcwr, 0.8, 1.3),
        detail: latestAcwr != null ? latestAcwr.toFixed(2) : undefined,
        range: "0.8–1.3 safe zone",
      },
      {
        label: "Ramp rate",
        flag: flag(latestRamp, -10, 10),
        detail: latestRamp != null ? `${latestRamp.toFixed(1)}%` : undefined,
        range: "±10% guardrail",
      },
      {
        label: "Monotony",
        flag: flag(latestMono, 0, 1.5),
        detail: latestMono != null ? latestMono.toFixed(2) : undefined,
        range: "0–1.5 target",
      },
      {
        label: "Long run %",
        flag: flag(latestLongPct, 0, 35),
        detail: latestLongPct != null ? `${latestLongPct.toFixed(1)}%` : undefined,
        range: "≤35% target",
      },
      {
        label: "Decoupling",
        flag: flag(latestDecoupling, -5, 5),
        detail: latestDecoupling != null ? `${latestDecoupling.toFixed(1)}%` : undefined,
        range: "±5% target",
      },
    ]);

    if (weekSummary.length === 0) {
      return {
        weekSummary,
        today,
        current: null,
        daily: [] as Awaited<ReturnType<typeof dailyPlanForWeek>>,
        nutritionTargets,
        nutritionLog,
        pickerActivities,
        fuelingProjection,
        milestones,
        readiness,
      };
    }

    const current =
      weekSummary.find((w) => {
        const start = w.week_start_date;
        const end = new Date(new Date(`${start}T00:00:00`).getTime() + 7 * 86400000).toISOString().slice(0, 10);
        return start <= today && today < end;
      }) ?? weekSummary[0];

    const daily = await dailyPlanForWeek(conn, current.week_number);
    return {
      weekSummary,
      today,
      current,
      daily,
      nutritionTargets,
      nutritionLog,
      pickerActivities,
      fuelingProjection,
      milestones,
      readiness,
    };
  },
  ["today-page-data"],
  { tags: [DASHBOARD_DATA_TAG] },
);

export const getFatiguePageData = unstable_cache(
  async () => {
    const conn = await getConnection();
    const [tsb, ef, acwr, ramp, mono, longPct, b2b, niggles, bestEffort] = await Promise.all([
      ctlAtlTsbHistory(conn, TRAINING_START ?? undefined, TRAINING_END ?? undefined),
      weeklyEfficiencyFactor(conn),
      acwrHistory(conn),
      weeklyRampRate(conn),
      weeklyMonotony(conn),
      longRunPct(conn),
      backToBackRuns(conn, 15.0),
      recentNiggleLogs(conn),
      bestRecentEffort(conn),
    ]);
    const paceTrend = await runPaceTrend(conn);

    const vo2max = bestEffort ? danielsVo2max(bestEffort.distance_km, bestEffort.moving_time_min) : null;

    // Training status: CTL "now" vs ~28 days back in the same ascending
    // series, same worst-case-first philosophy as the readiness verdict.
    const today = todayIso();
    const latestCtlRow = tsb.length > 0 ? tsb[tsb.length - 1] : null;
    const ctlPast = tsb.length > 0 ? tsb[Math.max(0, tsb.length - 1 - 28)].ctl : null;
    const trainingStatus = computeTrainingStatus({
      ctlNow: latestCtlRow?.ctl ?? null,
      ctlPast,
      tsb: latestCtlRow?.tsb ?? null,
      acwr: latestCompleteDay(acwr, "acwr", today),
      rampPct: firstNonNull(ramp, "ramp_pct"),
    });

    return { tsb, ef, acwr, ramp, mono, longPct, b2b, paceTrend, niggles, vo2max, trainingStatus };
  },
  ["fatigue-page-data"],
  { tags: [DASHBOARD_DATA_TAG] },
);

export const getTrainingLoadPageData = unstable_cache(
  async () => {
    const conn = await getConnection();
    const [volume, adherence, monthly, categoryLoad, goalRace] = await Promise.all([
      weeklyVolume(conn),
      planAdherence(conn),
      monthlyVolume(conn),
      weeklyCategoryLoad(conn),
      getPrimaryGoalRace<GoalRaceRow>(conn),
    ]);
    const goalRaceDistanceKm = goalRace?.distance_km ?? null;

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
    const longRunData = volSorted
      .filter((v) => v.longest_run_km > 0)
      .map((v) => ({ week_start: v.week_start, longest_run_km: v.longest_run_km }));
    const monthlySorted = [...monthly].sort((a, b) => (a.month_start < b.month_start ? -1 : 1));
    const categorySorted = [...categoryLoad].sort((a, b) => (a.week_start < b.week_start ? -1 : 1));

    return { volume, distanceData, timeData, longRunData, monthlySorted, categorySorted, goalRaceDistanceKm };
  },
  ["training-load-page-data"],
  { tags: [DASHBOARD_DATA_TAG] },
);

export const getAerobicPageData = unstable_cache(
  async () => {
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

    return { zoneSorted, withEasyPct, latestEasyPct, paceTrend, qualityScores };
  },
  ["aerobic-page-data"],
  { tags: [DASHBOARD_DATA_TAG] },
);

export const getPlanHistoryPageData = unstable_cache(
  async () => {
    const conn = await getConnection();
    const [longRuns, recent, weekSummary] = await Promise.all([
      longRunHistory(conn, 20.0, 20),
      recentActivities(conn, 20),
      weeklyCompletionSummary(conn),
    ]);

    const today = todayIso();
    const dailyEntries = await Promise.all(
      weekSummary.map(async (w) => [w.week_number, await dailyPlanForWeek(conn, w.week_number)] as const),
    );
    const dailyByWeek = Object.fromEntries(dailyEntries);

    const defaultWeek =
      weekSummary.find((w) => {
        const end = new Date(new Date(`${w.week_start_date}T00:00:00`).getTime() + 7 * 86400000)
          .toISOString()
          .slice(0, 10);
        return w.week_start_date <= today && today < end;
      })?.week_number ?? weekSummary[0]?.week_number;

    return { longRuns, recent, weekSummary, dailyByWeek, defaultWeek, today };
  },
  ["plan-history-page-data"],
  { tags: [DASHBOARD_DATA_TAG] },
);

export const getRacePrepPageData = unstable_cache(
  async () => {
    const conn = await getConnection();
    interface RaceEventRow {
      id: number;
      name: string;
      race_date: string;
      distance_km: number;
      priority: string;
      target_finish_h: number | null;
      notes: string | null;
      strava_activity_id: number | null;
      terrain_factor: number | null;
      cutoff_h: number | null;
    }
    const [races, goalRace, b2b, elevation, splits, shoes, bestEffort] = await Promise.all([
      getAllRaceEvents<RaceEventRow>(conn),
      getPrimaryGoalRace<GoalRaceRow>(conn),
      backToBackRuns(conn),
      weeklyElevation(conn),
      comradesProjectedSplits(conn),
      shoeMileage(conn),
      bestRecentEffort(conn),
    ]);
    const isComrades = isComradesRace(goalRace);
    const milestones = goalRace
      ? await raceMilestones(conn, goalRace.distance_km, goalRace.cutoff_h, isComrades ? 1800 : undefined)
      : null;

    // Generic multi-distance predictor — same Riegel model already used for
    // the Comrades projection, applied to a standard distance set plus the
    // goal race's own distance (if it isn't already one of those four).
    const predictionDistances: Array<[string, number]> = [
      ["5K", 5.0],
      ["10K", 10.0],
      ["Half Marathon", 21.0975],
      ["Marathon", 42.195],
    ];
    if (goalRace && !predictionDistances.some(([, km]) => Math.abs(km - goalRace.distance_km) < 0.5)) {
      predictionDistances.push([goalRace.name, goalRace.distance_km]);
    }
    const predictedTimes = bestEffort
      ? predictionDistances.map(([label, km]) => ({
          label,
          distance_km: km,
          predicted_min: riegelPredict(bestEffort.distance_km, bestEffort.moving_time_min, km),
        }))
      : [];

    const today = todayIso();
    const analysed = races.filter((r) => r.strava_activity_id);
    const analyses = await Promise.all(
      analysed.map((r) =>
        queryRow<{ avg_pace_min_km: number | null; projected_finish_h: number | null; computed_at: string }>(
          conn,
          `SELECT avg_pace_min_km, projected_finish_h::VARCHAR AS projected_finish_h, computed_at::VARCHAR AS computed_at
           FROM race_analysis WHERE race_event_id = $id`,
          { id: r.id },
        ),
      ),
    );

    // Comrades-only bonus content — named checkpoints/medal tiers are a
    // specific course's data, not generic; the page only renders these
    // sections when the goal race actually is Comrades (isComrades).
    const elevationProfile = COMRADES_CHECKPOINTS.map(([checkpoint, km, elevation_m]) => ({
      checkpoint,
      km,
      elevation_m,
    }));

    const bandRows = milestones
      ? BANDS.reduce<Array<{ medal: string; label: string; onTrack: boolean }>>((rows, [medal, label, cutoffH]) => {
          const prevH = rows.length > 0 ? BANDS[rows.length - 1][2] : 0;
          const onTrack =
            milestones.projected_finish_h != null &&
            prevH <= milestones.projected_finish_h &&
            milestones.projected_finish_h < cutoffH;
          return [...rows, { medal, label, onTrack }];
        }, [])
      : [];

    return {
      races,
      goalRace,
      isComrades,
      milestones,
      b2b,
      elevation,
      splits,
      shoes,
      today,
      analysed,
      analyses,
      elevationProfile,
      bandRows,
      predictedTimes,
    };
  },
  ["race-prep-page-data"],
  { tags: [DASHBOARD_DATA_TAG] },
);
