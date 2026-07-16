// Ported from src/metrics.py. Query shapes are preserved; DATE/TIMESTAMP output
// columns are cast to VARCHAR (ISO format, so lexical order == chronological
// order) and BIGINT counts/ids are cast to INTEGER/DOUBLE so results cross the
// Node boundary as plain strings/numbers instead of driver-specific value types.
import type { DuckDBConnection } from "@duckdb/node-api";
import { queryRow, queryRows } from "./db/client";

export const RACE_DISTANCE_KM = 90.0;
export const TRAINING_START = "2026-01-01";
export const TRAINING_END: string | null = null;

function dateFilter(alias = ""): string {
  const col = alias ? `${alias}.start_date_local` : "start_date_local";
  const parts = [`${col}::DATE >= '${TRAINING_START}'`];
  if (TRAINING_END) parts.push(`${col}::DATE <= '${TRAINING_END}'`);
  return parts.join(" AND ");
}

export interface WeeklyVolumeRow {
  week_start: string;
  run_distance_km: number;
  elevation_gain_m: number;
  longest_run_km: number;
  run_time_min: number;
  total_time_min: number;
  session_count: number;
  rest_day_count: number;
}

export async function weeklyVolume(conn: DuckDBConnection): Promise<WeeklyVolumeRow[]> {
  return queryRows<WeeklyVolumeRow>(
    conn,
    `SELECT
        DATE_TRUNC('week', start_date_local::DATE)::VARCHAR AS week_start,
        SUM(CASE WHEN category = 'running' THEN distance_km ELSE 0 END) AS run_distance_km,
        SUM(CASE WHEN category = 'running' THEN elevation_gain_m ELSE 0 END) AS elevation_gain_m,
        MAX(CASE WHEN category = 'running' THEN COALESCE(distance_km, 0) ELSE 0 END) AS longest_run_km,
        SUM(CASE WHEN category = 'running' THEN moving_time_min ELSE 0 END) AS run_time_min,
        SUM(moving_time_min) AS total_time_min,
        COUNT(*)::INTEGER AS session_count,
        (7 - COUNT(DISTINCT start_date_local::DATE))::INTEGER AS rest_day_count
     FROM activities
     WHERE ${dateFilter()}
     GROUP BY 1
     ORDER BY 1 DESC`,
  );
}

export interface WeeklyCategoryLoadRow {
  week_start: string;
  running_load: number;
  volleyball_load: number;
  cricket_load: number;
  gym_load: number;
  total_load: number;
}

export async function weeklyCategoryLoad(conn: DuckDBConnection): Promise<WeeklyCategoryLoadRow[]> {
  return queryRows<WeeklyCategoryLoadRow>(
    conn,
    `SELECT
        DATE_TRUNC('week', start_date_local::DATE)::VARCHAR AS week_start,
        SUM(CASE WHEN category = 'running'    THEN load_score ELSE 0 END) AS running_load,
        SUM(CASE WHEN category = 'volleyball' THEN load_score ELSE 0 END) AS volleyball_load,
        SUM(CASE WHEN category = 'cricket'    THEN load_score ELSE 0 END) AS cricket_load,
        SUM(CASE WHEN category = 'gym'        THEN load_score ELSE 0 END) AS gym_load,
        SUM(load_score) AS total_load
     FROM activities
     WHERE ${dateFilter()}
     GROUP BY 1
     ORDER BY 1 DESC`,
  );
}

export interface RecentActivityRow {
  date: string;
  name: string;
  category: string;
  sport_type: string;
  distance_km: number;
  duration_min: number;
  elevation_m: number;
  average_heartrate: number | null;
  load_score: number;
}

export async function recentActivities(conn: DuckDBConnection, n = 15): Promise<RecentActivityRow[]> {
  return queryRows<RecentActivityRow>(
    conn,
    `SELECT
        start_date_local::DATE::VARCHAR AS date,
        name,
        category,
        sport_type,
        ROUND(distance_km, 1) AS distance_km,
        ROUND(moving_time_min, 0) AS duration_min,
        ROUND(elevation_gain_m, 0) AS elevation_m,
        average_heartrate,
        ROUND(load_score, 0) AS load_score
     FROM activities
     WHERE ${dateFilter()}
     ORDER BY start_date_local DESC
     LIMIT ${n}`,
  );
}

export interface AcwrRow {
  day: string;
  load_7d: number;
  load_28d: number;
  acwr: number | null;
}

export async function acwrHistory(conn: DuckDBConnection): Promise<AcwrRow[]> {
  return queryRows<AcwrRow>(
    conn,
    `WITH daily AS (
        SELECT start_date_local::DATE AS day, SUM(load_score) AS daily_load
        FROM activities
        WHERE ${dateFilter()}
        GROUP BY 1
    ),
    rolling AS (
        SELECT
            day,
            daily_load,
            SUM(daily_load) OVER (ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) AS load_7d,
            SUM(daily_load) OVER (ORDER BY day ROWS BETWEEN 27 PRECEDING AND CURRENT ROW) AS load_28d
        FROM daily
    )
    SELECT
        day::VARCHAR AS day,
        load_7d,
        load_28d,
        CASE WHEN load_28d > 0
            THEN ROUND(load_7d / (load_28d / 4.0), 3)
            ELSE NULL
        END AS acwr
    FROM rolling
    ORDER BY day DESC`,
  );
}

export interface RampRateRow {
  day: string;
  run_distance_km: number;
  prev_period_km: number;
  ramp_pct: number | null;
}

export async function weeklyRampRate(conn: DuckDBConnection): Promise<RampRateRow[]> {
  return queryRows<RampRateRow>(
    conn,
    `WITH date_spine AS (
        SELECT UNNEST(generate_series(
            (SELECT MIN(start_date_local::DATE) FROM activities WHERE category = 'running' AND ${dateFilter()}),
            CURRENT_DATE,
            INTERVAL '1 day'
        ))::DATE AS day
    ),
    daily_km AS (
        SELECT start_date_local::DATE AS day, SUM(COALESCE(distance_km, 0)) AS run_km
        FROM activities
        WHERE category = 'running' AND ${dateFilter()}
        GROUP BY 1
    ),
    daily AS (
        SELECT d.day, COALESCE(k.run_km, 0.0) AS run_km
        FROM date_spine d
        LEFT JOIN daily_km k ON d.day = k.day
    ),
    rolling AS (
        SELECT
            day,
            SUM(run_km) OVER (ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) AS run_distance_km,
            SUM(run_km) OVER (ORDER BY day ROWS BETWEEN 13 PRECEDING AND 7 PRECEDING) AS prev_period_km,
            COUNT(*) OVER (ORDER BY day ROWS BETWEEN 13 PRECEDING AND CURRENT ROW) AS window_days
        FROM daily
    )
    SELECT
        day::VARCHAR AS day,
        run_distance_km,
        prev_period_km,
        CASE
            WHEN window_days = 14 AND prev_period_km > 0
            THEN ROUND((run_distance_km - prev_period_km) / prev_period_km * 100, 1)
            ELSE NULL
        END AS ramp_pct
    FROM rolling
    ORDER BY day DESC`,
  );
}

export interface MonotonyRow {
  day: string;
  mean_daily_load: number;
  stddev_daily_load: number | null;
  weekly_total_load: number;
  monotony: number | null;
  strain: number | null;
}

export async function weeklyMonotony(conn: DuckDBConnection): Promise<MonotonyRow[]> {
  return queryRows<MonotonyRow>(
    conn,
    `WITH date_spine AS (
        SELECT UNNEST(generate_series(
            (SELECT MIN(start_date_local::DATE) FROM activities WHERE ${dateFilter()}),
            CURRENT_DATE,
            INTERVAL '1 day'
        ))::DATE AS day
    ),
    daily_load AS (
        SELECT start_date_local::DATE AS day, SUM(load_score) AS daily_load
        FROM activities
        WHERE ${dateFilter()}
        GROUP BY 1
    ),
    daily AS (
        SELECT d.day, COALESCE(l.daily_load, 0.0) AS daily_load
        FROM date_spine d
        LEFT JOIN daily_load l ON d.day = l.day
    ),
    rolling AS (
        SELECT
            day,
            AVG(daily_load) OVER (ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) AS mean_daily_load,
            STDDEV(daily_load) OVER (ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) AS stddev_daily_load,
            SUM(daily_load) OVER (ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) AS weekly_total_load,
            COUNT(*) OVER (ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) AS window_days
        FROM daily
    )
    SELECT
        day::VARCHAR AS day,
        mean_daily_load,
        stddev_daily_load,
        weekly_total_load,
        CASE
            WHEN window_days = 7 AND stddev_daily_load > 0
            THEN ROUND(mean_daily_load / stddev_daily_load, 3)
            ELSE NULL
        END AS monotony,
        CASE
            WHEN window_days = 7 AND stddev_daily_load > 0
            THEN ROUND(mean_daily_load / stddev_daily_load * weekly_total_load, 1)
            ELSE NULL
        END AS strain
    FROM rolling
    ORDER BY day DESC`,
  );
}

export interface LongRunPctRow {
  week_start: string;
  run_distance_km: number;
  longest_run_km: number;
  long_run_pct: number | null;
}

export async function longRunPct(conn: DuckDBConnection): Promise<LongRunPctRow[]> {
  return queryRows<LongRunPctRow>(
    conn,
    `WITH weekly AS (
        SELECT
            DATE_TRUNC('week', start_date_local::DATE) AS week_start,
            SUM(CASE WHEN category = 'running' THEN COALESCE(distance_km, 0) ELSE 0 END) AS run_distance_km,
            MAX(CASE WHEN category = 'running' THEN COALESCE(distance_km, 0) ELSE 0 END) AS longest_run_km
        FROM activities
        WHERE ${dateFilter()}
        GROUP BY 1
    )
    SELECT
        week_start::VARCHAR AS week_start,
        run_distance_km,
        longest_run_km,
        CASE
            WHEN run_distance_km > 0
            THEN ROUND(longest_run_km / run_distance_km * 100, 1)
            ELSE NULL
        END AS long_run_pct
    FROM weekly
    ORDER BY week_start DESC`,
  );
}

export interface WeeklyElevationRow {
  week_start: string;
  weekly_gain_m: number;
}

export async function weeklyElevation(conn: DuckDBConnection): Promise<WeeklyElevationRow[]> {
  return queryRows<WeeklyElevationRow>(
    conn,
    `SELECT
        DATE_TRUNC('week', start_date_local::DATE)::VARCHAR AS week_start,
        SUM(CASE WHEN category = 'running' THEN COALESCE(elevation_gain_m, 0) ELSE 0 END) AS weekly_gain_m
     FROM activities
     WHERE ${dateFilter()}
     GROUP BY 1
     ORDER BY 1`,
  );
}

export interface WeeklyZoneTimeRow {
  week_start: string;
  z1_min: number;
  z2_min: number;
  z3_min: number;
  z4_min: number;
  z5_min: number;
}

export async function weeklyZoneTime(conn: DuckDBConnection): Promise<WeeklyZoneTimeRow[]> {
  return queryRows<WeeklyZoneTimeRow>(
    conn,
    `SELECT
        DATE_TRUNC('week', a.start_date_local::DATE)::VARCHAR AS week_start,
        ROUND(SUM(a.moving_time_min * sd.pct_time_z1 / 100.0), 1) AS z1_min,
        ROUND(SUM(a.moving_time_min * sd.pct_time_z2 / 100.0), 1) AS z2_min,
        ROUND(SUM(a.moving_time_min * sd.pct_time_z3 / 100.0), 1) AS z3_min,
        ROUND(SUM(a.moving_time_min * sd.pct_time_z4 / 100.0), 1) AS z4_min,
        ROUND(SUM(a.moving_time_min * sd.pct_time_z5 / 100.0), 1) AS z5_min
     FROM activities a
     JOIN activity_streams_derived sd ON a.id = sd.activity_id
     WHERE a.category = 'running'
       AND ${dateFilter("a")}
     GROUP BY 1
     ORDER BY 1`,
  );
}

export interface LongRunHistoryRow {
  activity_date: string;
  name: string;
  distance_km: number;
  duration_min: number;
  elevation_gain_m: number;
  avg_hr: number | null;
  pace_min_km: number | null;
  decoupling_pct: number | null;
  pct_time_z2: number | null;
}

export async function longRunHistory(conn: DuckDBConnection, minKm = 20.0): Promise<LongRunHistoryRow[]> {
  return queryRows<LongRunHistoryRow>(
    conn,
    `SELECT
        a.start_date_local::DATE::VARCHAR AS activity_date,
        a.name,
        ROUND(a.distance_km, 1) AS distance_km,
        ROUND(a.moving_time_min, 0) AS duration_min,
        ROUND(a.elevation_gain_m, 0) AS elevation_gain_m,
        ROUND(a.average_heartrate, 0) AS avg_hr,
        CASE WHEN a.average_speed_kmh > 0
            THEN ROUND(60.0 / a.average_speed_kmh, 2)
            ELSE NULL
        END AS pace_min_km,
        sd.decoupling_pct,
        sd.pct_time_z2
     FROM activities a
     LEFT JOIN activity_streams_derived sd ON a.id = sd.activity_id
     WHERE a.category = 'running'
       AND a.distance_km >= ${minKm}
       AND ${dateFilter("a")}
     ORDER BY a.start_date_local DESC`,
  );
}

export interface MonthlyVolumeRow {
  month_start: string;
  run_distance_km: number;
  run_time_h: number;
  elevation_gain_m: number;
  run_count: number;
}

export async function monthlyVolume(conn: DuckDBConnection): Promise<MonthlyVolumeRow[]> {
  return queryRows<MonthlyVolumeRow>(
    conn,
    `SELECT
        DATE_TRUNC('month', start_date_local::DATE)::VARCHAR AS month_start,
        SUM(CASE WHEN category = 'running' THEN COALESCE(distance_km, 0) ELSE 0 END) AS run_distance_km,
        ROUND(SUM(CASE WHEN category = 'running' THEN COALESCE(moving_time_min, 0) ELSE 0 END) / 60.0, 1) AS run_time_h,
        SUM(CASE WHEN category = 'running' THEN COALESCE(elevation_gain_m, 0) ELSE 0 END) AS elevation_gain_m,
        COUNT(CASE WHEN category = 'running' THEN 1 END)::INTEGER AS run_count
     FROM activities
     WHERE ${dateFilter()}
     GROUP BY 1
     ORDER BY 1`,
  );
}

export interface PlanAdherenceRow {
  week_start_date: string;
  week_number: number;
  phase: string;
  planned_distance_km: number;
  planned_long_run_km: number;
  is_deload: boolean;
  actual_distance_km: number;
  adherence_pct: number | null;
}

export async function planAdherence(conn: DuckDBConnection): Promise<PlanAdherenceRow[]> {
  return queryRows<PlanAdherenceRow>(
    conn,
    `WITH weekly_actual AS (
        SELECT
            DATE_TRUNC('week', start_date_local::DATE) AS week_start,
            SUM(CASE WHEN category = 'running' THEN COALESCE(distance_km, 0) ELSE 0 END) AS actual_distance_km
        FROM activities
        WHERE ${dateFilter()}
        GROUP BY 1
    )
    SELECT
        tp.week_start_date::VARCHAR AS week_start_date,
        tp.week_number,
        tp.phase,
        tp.planned_distance_km,
        tp.planned_long_run_km,
        tp.is_deload,
        COALESCE(wa.actual_distance_km, 0) AS actual_distance_km,
        CASE
            WHEN tp.planned_distance_km > 0
            THEN ROUND(COALESCE(wa.actual_distance_km, 0) / tp.planned_distance_km * 100, 1)
            ELSE NULL
        END AS adherence_pct
    FROM training_plan tp
    LEFT JOIN weekly_actual wa ON tp.week_start_date::DATE = wa.week_start::DATE
    ORDER BY tp.week_start_date DESC`,
  );
}

export interface CurrentWeekStats {
  run_distance_km: number;
  planned_km: number;
  phase: string;
  adherence_pct: number;
  session_count: number;
}

export async function currentWeekStats(conn: DuckDBConnection): Promise<CurrentWeekStats> {
  const row = await queryRow<{ run_km: number | null; sessions: number }>(
    conn,
    `SELECT
        SUM(CASE WHEN category = 'running' THEN COALESCE(distance_km, 0) ELSE 0 END) AS run_km,
        COUNT(*)::INTEGER AS sessions
     FROM activities
     WHERE DATE_TRUNC('week', start_date_local::DATE) = DATE_TRUNC('week', current_date)`,
  );
  const planRow = await queryRow<{ planned_distance_km: number; phase: string }>(
    conn,
    `SELECT planned_distance_km, phase
     FROM training_plan
     WHERE week_start_date = DATE_TRUNC('week', current_date)::DATE
     LIMIT 1`,
  );

  const runKm = row?.run_km ?? 0.0;
  const plannedKm = planRow?.planned_distance_km ?? 0.0;
  const phase = planRow?.phase ?? "No plan loaded";
  const adherencePct = plannedKm > 0 ? (runKm / plannedKm) * 100 : 0.0;

  return {
    run_distance_km: runKm,
    planned_km: plannedKm,
    phase,
    adherence_pct: adherencePct,
    session_count: row?.sessions ?? 0,
  };
}

export interface PaceTrendRow {
  activity_date: string;
  name: string;
  distance_km: number;
  pct_time_z2: number | null;
  average_heartrate: number | null;
  pace_min_per_km: number | null;
  grade_adjusted_pace: number | null;
  decoupling_pct: number | null;
  cadence_avg: number | null;
}

export async function runPaceTrend(conn: DuckDBConnection): Promise<PaceTrendRow[]> {
  return queryRows<PaceTrendRow>(
    conn,
    `SELECT
        a.start_date_local::DATE::VARCHAR AS activity_date,
        a.name,
        a.distance_km,
        sd.pct_time_z2,
        a.average_heartrate,
        CASE WHEN a.average_speed_kmh > 0
            THEN ROUND(60.0 / a.average_speed_kmh, 2)
            ELSE NULL
        END AS pace_min_per_km,
        sd.grade_adjusted_pace,
        sd.decoupling_pct,
        sd.cadence_avg
     FROM activities a
     LEFT JOIN activity_streams_derived sd ON a.id = sd.activity_id
     WHERE a.category = 'running'
       AND a.distance_km >= 5
       AND ${dateFilter("a")}
     ORDER BY a.start_date_local`,
  );
}

export interface EfficiencyFactorRow {
  week_start: string;
  mean_ef: number;
  run_count: number;
}

export async function weeklyEfficiencyFactor(conn: DuckDBConnection): Promise<EfficiencyFactorRow[]> {
  return queryRows<EfficiencyFactorRow>(
    conn,
    `WITH per_run AS (
        SELECT
            DATE_TRUNC('week', a.start_date_local::DATE) AS week_start,
            a.average_speed_kmh / a.average_heartrate AS ef
        FROM activities a
        WHERE a.category = 'running'
          AND a.average_heartrate > 0
          AND a.average_speed_kmh > 0
          AND ${dateFilter("a")}
    )
    SELECT
        week_start::VARCHAR AS week_start,
        ROUND(AVG(ef), 4) AS mean_ef,
        COUNT(*)::INTEGER AS run_count
    FROM per_run
    GROUP BY 1
    HAVING COUNT(*) >= 2
    ORDER BY 1`,
  );
}

export interface BackToBackRow {
  day1: string;
  day2: string;
  day1_km: number;
  day2_km: number;
  combined_km: number;
}

export async function backToBackRuns(conn: DuckDBConnection, minKm = 15.0): Promise<BackToBackRow[]> {
  return queryRows<BackToBackRow>(
    conn,
    `WITH runs AS (
        SELECT start_date_local::DATE AS run_date, distance_km
        FROM activities
        WHERE category = 'running'
          AND distance_km >= ${minKm}
          AND ${dateFilter()}
    )
    SELECT
        r1.run_date::VARCHAR AS day1,
        r2.run_date::VARCHAR AS day2,
        r1.distance_km AS day1_km,
        r2.distance_km AS day2_km,
        r1.distance_km + r2.distance_km AS combined_km
    FROM runs r1
    JOIN runs r2 ON r2.run_date = r1.run_date + INTERVAL 1 DAY
    ORDER BY r1.run_date DESC`,
  );
}

export interface ComradesMilestones {
  longest_run_km: number;
  longest_run_pct_race: number;
  total_descent_m: number;
  race_descent_m: number;
  descent_pct_practiced: number;
  total_gain_m: number;
  runs_20plus: number;
  runs_30plus: number;
  runs_40plus: number;
  max_b2b_km: number;
  projected_finish_min: number | null;
  projected_finish_h: number | null;
  cutoff_h: number;
}

export async function comradesMilestones(
  conn: DuckDBConnection,
  raceDistanceKm = RACE_DISTANCE_KM,
  raceDescentM = 1800.0,
): Promise<ComradesMilestones> {
  const longestRunRow = await queryRow<{ longest: number }>(
    conn,
    `SELECT COALESCE(MAX(distance_km), 0) AS longest FROM activities
     WHERE category = 'running' AND ${dateFilter()}`,
  );
  const longestRun = longestRunRow?.longest ?? 0;

  const descentRow = await queryRow<{ total_descent: number }>(
    conn,
    `SELECT COALESCE(SUM(sd.elevation_loss_m), 0) AS total_descent
     FROM activities a
     JOIN activity_streams_derived sd ON a.id = sd.activity_id
     WHERE a.category = 'running' AND ${dateFilter("a")}`,
  );
  const totalDescent = descentRow?.total_descent ?? 0;

  const gainRow = await queryRow<{ total_gain: number }>(
    conn,
    `SELECT COALESCE(SUM(elevation_gain_m), 0) AS total_gain FROM activities
     WHERE category = 'running' AND ${dateFilter()}`,
  );
  const totalGain = gainRow?.total_gain ?? 0;

  const runCounts = await queryRow<{ runs_20plus: number; runs_30plus: number; runs_40plus: number }>(
    conn,
    `SELECT
        COUNT(CASE WHEN distance_km >= 20 THEN 1 END)::INTEGER AS runs_20plus,
        COUNT(CASE WHEN distance_km >= 30 THEN 1 END)::INTEGER AS runs_30plus,
        COUNT(CASE WHEN distance_km >= 40 THEN 1 END)::INTEGER AS runs_40plus
     FROM activities
     WHERE category = 'running' AND ${dateFilter()}`,
  );

  const maxB2bRow = await queryRow<{ max_b2b: number }>(
    conn,
    `WITH runs AS (
        SELECT start_date_local::DATE AS run_date, distance_km
        FROM activities
        WHERE category = 'running' AND ${dateFilter()}
    )
    SELECT COALESCE(MAX(r1.distance_km + r2.distance_km), 0) AS max_b2b
    FROM runs r1
    JOIN runs r2 ON r2.run_date = r1.run_date + INTERVAL 1 DAY`,
  );
  const maxB2b = maxB2bRow?.max_b2b ?? 0;

  const recentPaces = await queryRows<{ pace_min_km: number }>(
    conn,
    `SELECT 60.0 / average_speed_kmh AS pace_min_km
     FROM activities
     WHERE category = 'running'
       AND distance_km >= 25
       AND average_speed_kmh > 0
       AND ${dateFilter()}
     ORDER BY start_date_local DESC
     LIMIT 5`,
  );

  const avgPace = recentPaces.length > 0
    ? recentPaces.reduce((sum, r) => sum + r.pace_min_km, 0) / recentPaces.length
    : null;
  const projectedMin = avgPace ? avgPace * raceDistanceKm : null;

  return {
    longest_run_km: longestRun,
    longest_run_pct_race: Math.round((longestRun / raceDistanceKm) * 100 * 10) / 10,
    total_descent_m: totalDescent,
    race_descent_m: raceDescentM,
    descent_pct_practiced: totalDescent ? Math.round((totalDescent / raceDescentM) * 100 * 10) / 10 : 0.0,
    total_gain_m: totalGain,
    runs_20plus: runCounts?.runs_20plus ?? 0,
    runs_30plus: runCounts?.runs_30plus ?? 0,
    runs_40plus: runCounts?.runs_40plus ?? 0,
    max_b2b_km: maxB2b,
    projected_finish_min: projectedMin,
    projected_finish_h: projectedMin ? Math.round((projectedMin / 60) * 100) / 100 : null,
    cutoff_h: 12.0,
  };
}

export interface DailyPlanRow {
  planned_date: string;
  day_of_week: string;
  session_type: string;
  planned_km: number | null;
  intensity: string;
  is_quality: boolean;
  completed: boolean;
  actual_km: number | null;
  completed_activity_id: number | null;
  description: string;
}

export async function dailyPlanForWeek(conn: DuckDBConnection, weekNumber: number): Promise<DailyPlanRow[]> {
  return queryRows<DailyPlanRow>(
    conn,
    `SELECT
        planned_date::VARCHAR AS planned_date,
        day_of_week,
        session_type,
        ROUND(planned_distance_km, 1) AS planned_km,
        intensity,
        is_quality,
        completed,
        ROUND(completed_distance_km, 1) AS actual_km,
        completed_activity_id::DOUBLE AS completed_activity_id,
        description
     FROM training_plan_daily
     WHERE week_number = $week_number
     ORDER BY planned_date`,
    { week_number: weekNumber },
  );
}

export interface WeeklyCompletionSummaryRow {
  week_number: number;
  week_start_date: string;
  phase: string;
  planned_distance_km: number;
  is_deload: boolean;
  total_days: number;
  days_done: number;
  run_days: number;
  run_days_done: number;
  completion_pct: number | null;
}

export async function weeklyCompletionSummary(conn: DuckDBConnection): Promise<WeeklyCompletionSummaryRow[]> {
  return queryRows<WeeklyCompletionSummaryRow>(
    conn,
    `SELECT
        tp.week_number,
        tp.week_start_date::VARCHAR AS week_start_date,
        tp.phase,
        tp.planned_distance_km,
        tp.is_deload,
        COUNT(d.planned_date)::INTEGER AS total_days,
        SUM(CASE WHEN d.completed THEN 1 ELSE 0 END)::INTEGER AS days_done,
        SUM(CASE WHEN d.session_type IN ('easy_run','quality_run','long_run','hills','race')
                 THEN 1 ELSE 0 END)::INTEGER AS run_days,
        SUM(CASE WHEN d.session_type IN ('easy_run','quality_run','long_run','hills','race')
                      AND d.completed THEN 1 ELSE 0 END)::INTEGER AS run_days_done,
        ROUND(SUM(CASE WHEN d.session_type IN ('easy_run','quality_run','long_run','hills','race')
                          AND d.completed THEN 1 ELSE 0 END)::DOUBLE
              / NULLIF(SUM(CASE WHEN d.session_type IN ('easy_run','quality_run','long_run','hills','race')
                                THEN 1 ELSE 0 END), 0) * 100, 0) AS completion_pct
     FROM training_plan tp
     LEFT JOIN training_plan_daily d ON d.week_number = tp.week_number
     GROUP BY tp.week_number, tp.week_start_date, tp.phase,
              tp.planned_distance_km, tp.is_deload
     ORDER BY tp.week_number`,
  );
}

export interface CtlAtlTsbRow {
  day: string;
  load: number;
  ctl: number;
  atl: number;
  tsb: number;
}

export async function ctlAtlTsbHistory(
  conn: DuckDBConnection,
  since?: string,
  until?: string,
): Promise<CtlAtlTsbRow[]> {
  const daily = await queryRows<{ day: string; load: number }>(
    conn,
    `WITH date_spine AS (
        SELECT UNNEST(generate_series(
            (SELECT MIN(start_date_local::DATE) FROM activities),
            CURRENT_DATE,
            INTERVAL '1 day'
        ))::DATE AS day
    ),
    daily_load AS (
        SELECT start_date_local::DATE AS day, SUM(load_score) AS load
        FROM activities GROUP BY 1
    )
    SELECT d.day::VARCHAR AS day, COALESCE(l.load, 0.0) AS load
    FROM date_spine d
    LEFT JOIN daily_load l ON d.day = l.day
    ORDER BY d.day`,
  );

  if (daily.length === 0) return [];

  let ctl = 0.0;
  let atl = 0.0;
  const rows: CtlAtlTsbRow[] = daily.map(({ day, load }) => {
    const tsb = ctl - atl;
    ctl = ctl + (load - ctl) / 42.0;
    atl = atl + (load - atl) / 7.0;
    return {
      day,
      load,
      ctl: Math.round(ctl * 100) / 100,
      atl: Math.round(atl * 100) / 100,
      tsb: Math.round(tsb * 100) / 100,
    };
  });

  return rows.filter((r) => (!since || r.day >= since) && (!until || r.day <= until));
}

export interface LongRunQualityRow {
  activity_date: string;
  name: string;
  distance_km: number;
  z2_compliance_pct: number;
  decoupling_pct: number;
  quality_score: number;
}

export async function longRunQualityScores(conn: DuckDBConnection): Promise<LongRunQualityRow[]> {
  return queryRows<LongRunQualityRow>(
    conn,
    `SELECT
        a.start_date_local::DATE::VARCHAR AS activity_date,
        a.name,
        ROUND(a.distance_km, 1) AS distance_km,
        ROUND(COALESCE(s.pct_time_z1 + s.pct_time_z2, 0), 1) AS z2_compliance_pct,
        ROUND(COALESCE(s.decoupling_pct, 0), 2) AS decoupling_pct,
        ROUND(GREATEST(0, LEAST(100,
            GREATEST(0, (COALESCE(s.pct_time_z1 + s.pct_time_z2, 0) - 60.0) / 40.0 * 100.0) * 0.5
            +
            GREATEST(0, (5.0 - LEAST(5.0, ABS(COALESCE(s.decoupling_pct, 5.0)))) / 5.0 * 100.0) * 0.5
        )), 1) AS quality_score
     FROM activities a
     JOIN activity_streams_derived s ON a.id = s.activity_id
     WHERE a.category = 'running'
       AND a.distance_km >= 20
     ORDER BY a.start_date_local DESC`,
  );
}

export const COMRADES_CHECKPOINTS: ReadonlyArray<[string, number, number]> = [
  ["Pietermaritzburg", 0.0, 750],
  ["Camperdown", 24.0, 700],
  ["Cato Ridge", 36.0, 820],
  ["Drummond", 46.0, 660],
  ["Botha's Hill", 60.0, 560],
  ["Hillcrest", 68.0, 450],
  ["Pinetown", 76.0, 180],
  ["45th Cutting", 84.0, 60],
  ["Durban", 90.0, 5],
];

export interface ComradesSplitRow {
  checkpoint: string;
  km: number;
  cumulative_min: number;
  cumulative_time: string;
}

export async function comradesProjectedSplits(conn: DuckDBConnection): Promise<ComradesSplitRow[]> {
  const projRow = await queryRow<{ comrades_projection_h: number }>(
    conn,
    "SELECT comrades_projection_h FROM race_analysis ORDER BY computed_at DESC LIMIT 1",
  );

  let totalH: number;
  if (!projRow) {
    const z2Row = await queryRow<{ avg_min_per_km: number | null }>(
      conn,
      `SELECT AVG(moving_time_min / NULLIF(distance_km, 0)) AS avg_min_per_km
       FROM activities
       WHERE category = 'running' AND distance_km >= 10
         AND start_date_local >= CURRENT_DATE - INTERVAL '90 days'`,
    );
    if (!z2Row?.avg_min_per_km) return [];
    totalH = (z2Row.avg_min_per_km * 90.0) / 60.0 * 1.04;
  } else {
    totalH = projRow.comrades_projection_h;
  }

  const totalMin = totalH * 60.0;
  const rows: ComradesSplitRow[] = [];
  let rawCumulative = 0.0;
  const segMins: number[] = [];

  COMRADES_CHECKPOINTS.forEach(([name, km, elev], i) => {
    if (i === 0) {
      rows.push({ checkpoint: name, km, cumulative_min: 0.0, cumulative_time: "0:00" });
      segMins.push(0.0);
      return;
    }
    const [, prevKm, prevElev] = COMRADES_CHECKPOINTS[i - 1];
    const segKm = km - prevKm;
    const grade = (elev - prevElev) / (segKm * 1000.0);
    const adj = 1.0 + grade * (grade > 0 ? 2.0 : -1.5);
    const segMin = totalMin * (segKm / 90.0) * adj;
    rawCumulative += segMin;
    segMins.push(segMin);
    rows.push({ checkpoint: name, km, cumulative_min: Math.round(rawCumulative * 10) / 10, cumulative_time: "" });
  });

  const scale = rawCumulative ? totalMin / rawCumulative : 1.0;
  let cum = 0.0;
  rows.forEach((r, i) => {
    if (i === 0) return;
    cum += segMins[i] * scale;
    r.cumulative_min = Math.round(cum * 10) / 10;
    const h = Math.floor(cum / 60);
    const m = Math.floor(cum % 60);
    r.cumulative_time = `${h}:${String(m).padStart(2, "0")}`;
  });

  return rows;
}

export interface ShoeMileageRow {
  id: string;
  name: string;
  type: string;
  retire_km_threshold: number;
  is_retired: boolean;
  total_km: number;
  km_remaining: number;
}

export async function shoeMileage(conn: DuckDBConnection): Promise<ShoeMileageRow[]> {
  return queryRows<ShoeMileageRow>(
    conn,
    `SELECT
        g.id,
        g.name,
        g.type,
        g.retire_km_threshold,
        g.is_retired,
        ROUND(COALESCE(SUM(a.distance_km), 0), 1) AS total_km,
        ROUND(g.retire_km_threshold - COALESCE(SUM(a.distance_km), 0), 1) AS km_remaining
     FROM gear g
     LEFT JOIN activities a
        ON a.gear_id = g.id AND a.category = 'running'
     WHERE NOT g.is_retired
     GROUP BY g.id, g.name, g.type, g.retire_km_threshold, g.is_retired
     ORDER BY total_km DESC`,
  );
}
