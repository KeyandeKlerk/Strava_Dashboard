// Caches each page's data fetch so tab navigation is instant, and only
// re-queries MotherDuck when explicitly invalidated (the webhook route calls
// revalidateTag(DASHBOARD_DATA_TAG) after a sync completes). No time-based
// fallback revalidation on purpose — data is meant to stay cached until the
// next sync, not silently go stale-then-refresh on a timer. If a sync ever
// fails to invalidate (e.g. an error before that point), the cache simply
// keeps serving the last-known-good data until the next successful sync.
import { unstable_cache } from "next/cache";
import { getConnection, queryRow } from "./db/client";
import { getAllRaceEvents } from "./db/mutations";
import {
  acwrHistory,
  backToBackRuns,
  comradesMilestones,
  comradesProjectedSplits,
  COMRADES_CHECKPOINTS,
  ctlAtlTsbHistory,
  dailyPlanForWeek,
  longRunHistory,
  longRunPct,
  longRunQualityScores,
  monthlyVolume,
  planAdherence,
  recentActivities,
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
import { BANDS, RACE_DISTANCE_KM } from "./shared";

export const DASHBOARD_DATA_TAG = "dashboard-data";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

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
    if (weekSummary.length === 0) {
      return { weekSummary, today: todayIso(), current: null, daily: [] as Awaited<ReturnType<typeof dailyPlanForWeek>> };
    }

    const today = todayIso();
    const current =
      weekSummary.find((w) => {
        const start = w.week_start_date;
        const end = new Date(new Date(`${start}T00:00:00`).getTime() + 7 * 86400000).toISOString().slice(0, 10);
        return start <= today && today < end;
      }) ?? weekSummary[0];

    const daily = await dailyPlanForWeek(conn, current.week_number);
    return { weekSummary, today, current, daily };
  },
  ["today-page-data"],
  { tags: [DASHBOARD_DATA_TAG] },
);

export const getFatiguePageData = unstable_cache(
  async () => {
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
    return { tsb, ef, acwr, ramp, mono, longPct, b2b, paceTrend };
  },
  ["fatigue-page-data"],
  { tags: [DASHBOARD_DATA_TAG] },
);

export const getTrainingLoadPageData = unstable_cache(
  async () => {
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
    const longRunData = volSorted
      .filter((v) => v.longest_run_km > 0)
      .map((v) => ({ week_start: v.week_start, longest_run_km: v.longest_run_km }));
    const monthlySorted = [...monthly].sort((a, b) => (a.month_start < b.month_start ? -1 : 1));
    const categorySorted = [...categoryLoad].sort((a, b) => (a.week_start < b.week_start ? -1 : 1));

    return { volume, distanceData, timeData, longRunData, monthlySorted, categorySorted };
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
      longRunHistory(conn, 20.0),
      recentActivities(conn, 15),
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
    }
    const [races, milestones, b2b, elevation, splits, shoes] = await Promise.all([
      getAllRaceEvents<RaceEventRow>(conn),
      comradesMilestones(conn, RACE_DISTANCE_KM),
      backToBackRuns(conn),
      weeklyElevation(conn),
      comradesProjectedSplits(conn),
      shoeMileage(conn),
    ]);

    const today = todayIso();
    const analysed = races.filter((r) => r.strava_activity_id);
    const analyses = await Promise.all(
      analysed.map((r) =>
        queryRow<{ avg_pace_min_km: number | null; comrades_projection_h: number | null; computed_at: string }>(
          conn,
          `SELECT avg_pace_min_km, comrades_projection_h::VARCHAR AS comrades_projection_h, computed_at::VARCHAR AS computed_at
           FROM race_analysis WHERE race_event_id = $id`,
          { id: r.id },
        ),
      ),
    );

    const elevationProfile = COMRADES_CHECKPOINTS.map(([checkpoint, km, elevation_m]) => ({
      checkpoint,
      km,
      elevation_m,
    }));

    const bandRows = BANDS.reduce<Array<{ medal: string; label: string; onTrack: boolean }>>(
      (rows, [medal, label, cutoffH]) => {
        const prevH = rows.length > 0 ? BANDS[rows.length - 1][2] : 0;
        const onTrack =
          milestones.projected_finish_h != null &&
          prevH <= milestones.projected_finish_h &&
          milestones.projected_finish_h < cutoffH;
        return [...rows, { medal, label, onTrack }];
      },
      [],
    );

    return { races, milestones, b2b, elevation, splits, shoes, today, analysed, analyses, elevationProfile, bandRows };
  },
  ["race-prep-page-data"],
  { tags: [DASHBOARD_DATA_TAG] },
);
