// Ported from src/db.py's upsert_*/get_*/correlate_* functions.
import type { DuckDBConnection } from "@duckdb/node-api";
import { queryRow, queryRows } from "./client";

export interface ActivityInput {
  id: number;
  name?: string | null;
  sport_type?: string | null;
  category?: string | null;
  start_date_local?: string | null;
  distance_km?: number | null;
  moving_time_min?: number | null;
  elapsed_time_min?: number | null;
  elevation_gain_m?: number | null;
  average_heartrate?: number | null;
  max_heartrate?: number | null;
  average_cadence?: number | null;
  average_speed_kmh?: number | null;
  relative_effort?: number | null;
  load_score?: number | null;
  gear_id?: string | null;
  gear_name?: string | null;
}

export async function upsertActivity(conn: DuckDBConnection, a: ActivityInput): Promise<void> {
  await conn.run(
    `INSERT INTO activities (
      id, name, sport_type, category, start_date_local,
      distance_km, moving_time_min, elapsed_time_min, elevation_gain_m,
      average_heartrate, max_heartrate, average_cadence, average_speed_kmh,
      relative_effort, load_score, gear_id, gear_name, synced_at
    ) VALUES ($id, $name, $sport_type, $category, $start_date_local,
      $distance_km, $moving_time_min, $elapsed_time_min, $elevation_gain_m,
      $average_heartrate, $max_heartrate, $average_cadence, $average_speed_kmh,
      $relative_effort, $load_score, $gear_id, $gear_name, now())
    ON CONFLICT (id) DO UPDATE SET
      name = excluded.name,
      sport_type = excluded.sport_type,
      category = excluded.category,
      start_date_local = excluded.start_date_local,
      distance_km = excluded.distance_km,
      moving_time_min = excluded.moving_time_min,
      elapsed_time_min = excluded.elapsed_time_min,
      elevation_gain_m = excluded.elevation_gain_m,
      average_heartrate = excluded.average_heartrate,
      max_heartrate = excluded.max_heartrate,
      average_cadence = excluded.average_cadence,
      average_speed_kmh = excluded.average_speed_kmh,
      relative_effort = excluded.relative_effort,
      load_score = excluded.load_score,
      gear_id = excluded.gear_id,
      gear_name = excluded.gear_name,
      synced_at = now()`,
    {
      id: a.id,
      name: a.name ?? null,
      sport_type: a.sport_type ?? null,
      category: a.category ?? null,
      start_date_local: a.start_date_local ?? null,
      distance_km: a.distance_km ?? null,
      moving_time_min: a.moving_time_min ?? null,
      elapsed_time_min: a.elapsed_time_min ?? null,
      elevation_gain_m: a.elevation_gain_m ?? null,
      average_heartrate: a.average_heartrate ?? null,
      max_heartrate: a.max_heartrate ?? null,
      average_cadence: a.average_cadence ?? null,
      average_speed_kmh: a.average_speed_kmh ?? null,
      relative_effort: a.relative_effort ?? null,
      load_score: a.load_score ?? null,
      gear_id: a.gear_id ?? null,
      gear_name: a.gear_name ?? null,
    },
  );
}

export interface StreamsDerivedInput {
  activity_id: number;
  elevation_loss_m?: number | null;
  decoupling_pct?: number | null;
  pct_time_z1?: number | null;
  pct_time_z2?: number | null;
  pct_time_z3?: number | null;
  pct_time_z4?: number | null;
  pct_time_z5?: number | null;
  grade_adjusted_pace?: number | null;
  cadence_avg?: number | null;
}

export async function upsertStreamsDerived(conn: DuckDBConnection, d: StreamsDerivedInput): Promise<void> {
  await conn.run(
    `INSERT INTO activity_streams_derived (
      activity_id, elevation_loss_m, decoupling_pct,
      pct_time_z1, pct_time_z2, pct_time_z3, pct_time_z4, pct_time_z5,
      grade_adjusted_pace, cadence_avg
    ) VALUES ($activity_id, $elevation_loss_m, $decoupling_pct,
      $pct_time_z1, $pct_time_z2, $pct_time_z3, $pct_time_z4, $pct_time_z5,
      $grade_adjusted_pace, $cadence_avg)
    ON CONFLICT (activity_id) DO UPDATE SET
      elevation_loss_m = excluded.elevation_loss_m,
      decoupling_pct = excluded.decoupling_pct,
      pct_time_z1 = excluded.pct_time_z1,
      pct_time_z2 = excluded.pct_time_z2,
      pct_time_z3 = excluded.pct_time_z3,
      pct_time_z4 = excluded.pct_time_z4,
      pct_time_z5 = excluded.pct_time_z5,
      grade_adjusted_pace = excluded.grade_adjusted_pace,
      cadence_avg = excluded.cadence_avg`,
    {
      activity_id: d.activity_id,
      elevation_loss_m: d.elevation_loss_m ?? null,
      decoupling_pct: d.decoupling_pct ?? null,
      pct_time_z1: d.pct_time_z1 ?? null,
      pct_time_z2: d.pct_time_z2 ?? null,
      pct_time_z3: d.pct_time_z3 ?? null,
      pct_time_z4: d.pct_time_z4 ?? null,
      pct_time_z5: d.pct_time_z5 ?? null,
      grade_adjusted_pace: d.grade_adjusted_pace ?? null,
      cadence_avg: d.cadence_avg ?? null,
    },
  );
}

export async function upsertHrZones(conn: DuckDBConnection, zones: Array<[number, number]>): Promise<void> {
  await conn.run("BEGIN TRANSACTION");
  try {
    await conn.run("DELETE FROM hr_zones");
    let zoneNumber = 1;
    for (const [minBpm, maxBpm] of zones) {
      await conn.run(
        "INSERT INTO hr_zones (zone_number, min_bpm, max_bpm) VALUES ($zone_number, $min_bpm, $max_bpm)",
        { zone_number: zoneNumber, min_bpm: minBpm, max_bpm: maxBpm },
      );
      zoneNumber += 1;
    }
    await conn.run("COMMIT");
  } catch (err) {
    await conn.run("ROLLBACK");
    throw err;
  }
}

export async function getHrZones(conn: DuckDBConnection): Promise<Array<[number, number]>> {
  const rows = await queryRows<{ min_bpm: number; max_bpm: number }>(
    conn,
    "SELECT min_bpm, max_bpm FROM hr_zones ORDER BY zone_number",
  );
  if (rows.length === 0) {
    throw new Error(
      "No HR zones cached. Run the historical backfill script to fetch zones from Strava.",
    );
  }
  return rows.map((r) => [r.min_bpm, r.max_bpm]);
}

export interface TrainingPlanWeekInput {
  week_number: number;
  week_start_date?: string | null;
  phase?: string | null;
  planned_distance_km?: number | null;
  planned_long_run_km?: number | null;
  planned_sessions?: number | null;
  is_deload?: boolean;
  notes?: string | null;
}

export async function upsertTrainingPlanWeek(conn: DuckDBConnection, w: TrainingPlanWeekInput): Promise<void> {
  await conn.run(
    `INSERT INTO training_plan (
      week_number, week_start_date, phase, planned_distance_km,
      planned_long_run_km, planned_sessions, is_deload, notes
    ) VALUES ($week_number, $week_start_date, $phase, $planned_distance_km,
      $planned_long_run_km, $planned_sessions, $is_deload, $notes)
    ON CONFLICT (week_number) DO UPDATE SET
      week_start_date = excluded.week_start_date,
      phase = excluded.phase,
      planned_distance_km = excluded.planned_distance_km,
      planned_long_run_km = excluded.planned_long_run_km,
      planned_sessions = excluded.planned_sessions,
      is_deload = excluded.is_deload,
      notes = excluded.notes`,
    {
      week_number: w.week_number,
      week_start_date: w.week_start_date ?? null,
      phase: w.phase ?? null,
      planned_distance_km: w.planned_distance_km ?? null,
      planned_long_run_km: w.planned_long_run_km ?? null,
      planned_sessions: w.planned_sessions ?? null,
      is_deload: w.is_deload ?? false,
      notes: w.notes ?? null,
    },
  );
}

export async function syncWeeklyFromDaily(conn: DuckDBConnection): Promise<void> {
  await conn.run(`
    INSERT INTO training_plan (
        week_number, week_start_date, phase, planned_distance_km,
        planned_long_run_km, planned_sessions, is_deload
    )
    SELECT
        d.week_number,
        MIN(d.planned_date) AS week_start_date,
        'Base' AS phase,
        SUM(d.planned_distance_km) AS planned_distance_km,
        COALESCE(MAX(CASE WHEN d.session_type = 'long_run' THEN d.planned_distance_km END), 0.0)
            AS planned_long_run_km,
        COUNT(CASE WHEN d.session_type IN ('easy_run','quality_run','long_run','hills','race')
                   THEN 1 END) AS planned_sessions,
        FALSE AS is_deload
    FROM training_plan_daily d
    GROUP BY d.week_number
    ON CONFLICT (week_number) DO UPDATE SET
        week_start_date = excluded.week_start_date,
        planned_distance_km = excluded.planned_distance_km,
        planned_long_run_km = excluded.planned_long_run_km,
        planned_sessions = excluded.planned_sessions
  `);
}

export async function clearTrainingPlan(conn: DuckDBConnection): Promise<void> {
  await conn.run("DELETE FROM training_plan_daily");
  await conn.run("DELETE FROM training_plan");
}

export interface DailySessionInput {
  planned_date: string;
  week_number: number;
  day_of_week: string;
  session_type: string;
  planned_distance_km?: number | null;
  intensity: string;
  description: string;
  is_quality?: boolean;
}

export async function addDailySession(conn: DuckDBConnection, s: DailySessionInput): Promise<number> {
  const row = await queryRow<{ id: number }>(
    conn,
    `INSERT INTO training_plan_daily (
      planned_date, week_number, day_of_week, session_type,
      planned_distance_km, intensity, description, is_quality
    ) VALUES ($planned_date, $week_number, $day_of_week, $session_type,
      $planned_distance_km, $intensity, $description, $is_quality)
    RETURNING id`,
    {
      planned_date: s.planned_date,
      week_number: s.week_number,
      day_of_week: s.day_of_week,
      session_type: s.session_type,
      planned_distance_km: s.planned_distance_km ?? null,
      intensity: s.intensity,
      description: s.description,
      is_quality: s.is_quality ?? false,
    },
  );
  return row!.id;
}

export async function deleteDailySession(conn: DuckDBConnection, id: number): Promise<{ error?: string }> {
  const row = await queryRow<{ completed: boolean }>(
    conn,
    "SELECT completed FROM training_plan_daily WHERE id = $id",
    { id },
  );
  if (!row) return { error: "Session not found." };
  if (row.completed) return { error: "Can't remove a completed session." };

  await conn.run("DELETE FROM training_plan_daily WHERE id = $id", { id });
  return {};
}

export interface PlanDayRow {
  id: number;
  planned_date: string;
  day_of_week: string;
  session_type: string;
  completed: boolean;
  description: string;
}

export async function queryPlanDay(conn: DuckDBConnection, ...ids: number[]): Promise<PlanDayRow[]> {
  return queryRows<PlanDayRow>(
    conn,
    `SELECT id, planned_date::VARCHAR AS planned_date, day_of_week, session_type, completed, description
     FROM training_plan_daily WHERE id IN (${ids.map((_, i) => `$id${i}`).join(", ")})
     ORDER BY id`,
    Object.fromEntries(ids.map((id, i) => [`id${i}`, id])),
  );
}

export async function correlateActivitiesToPlan(conn: DuckDBConnection): Promise<number> {
  await conn.run(`
    UPDATE training_plan_daily d
    SET completed = TRUE,
        completed_activity_id = a.id,
        completed_distance_km = a.distance_km
    FROM (
        SELECT start_date_local::DATE AS run_date,
               ARG_MAX(id, distance_km) AS id,
               MAX(distance_km) AS distance_km
        FROM activities
        WHERE category = 'running'
        GROUP BY 1
    ) a
    WHERE d.planned_date = a.run_date
      AND d.session_type IN ('easy_run', 'quality_run', 'long_run', 'hills', 'race')
  `);
  await conn.run(`
    UPDATE training_plan_daily d
    SET completed = TRUE,
        completed_activity_id = a.id
    FROM (
        SELECT start_date_local::DATE AS gym_date, MIN(id) AS id
        FROM activities WHERE category = 'gym'
        GROUP BY 1
    ) a
    WHERE d.planned_date = a.gym_date
      AND d.session_type = 'sc'
  `);
  await conn.run(`
    UPDATE training_plan_daily d
    SET completed = TRUE,
        completed_activity_id = a.id
    FROM (
        SELECT start_date_local::DATE AS ct_date, MIN(id) AS id
        FROM activities WHERE category IN ('volleyball', 'cricket')
        GROUP BY 1
    ) a
    WHERE d.planned_date = a.ct_date
      AND d.session_type IN ('cross_training', 'cricket')
  `);
  const row = await queryRow<{ count: number | bigint }>(
    conn,
    "SELECT COUNT(*) AS count FROM training_plan_daily WHERE completed",
  );
  return Number(row?.count ?? 0);
}

export async function getLastSynced(conn: DuckDBConnection): Promise<number | undefined> {
  const row = await queryRow<{ value: string }>(
    conn,
    "SELECT value FROM sync_state WHERE key = 'last_synced_at'",
  );
  return row ? Number(row.value) : undefined;
}

export async function setLastSynced(conn: DuckDBConnection, timestamp: number): Promise<void> {
  await conn.run(
    `INSERT INTO sync_state (key, value) VALUES ('last_synced_at', $value)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    { value: String(timestamp) },
  );
}

export async function getRefreshToken(conn: DuckDBConnection): Promise<string | undefined> {
  const row = await queryRow<{ value: string }>(
    conn,
    "SELECT value FROM sync_state WHERE key = 'strava_refresh_token'",
  );
  return row?.value;
}

export async function setRefreshToken(conn: DuckDBConnection, token: string): Promise<void> {
  await conn.run(
    `INSERT INTO sync_state (key, value) VALUES ('strava_refresh_token', $value)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    { value: token },
  );
}

export interface RaceEventInput {
  id?: number | null;
  name: string;
  race_date: string;
  distance_km: number;
  priority: string;
  target_finish_h?: number | null;
  notes?: string | null;
}

export async function upsertRaceEvent(conn: DuckDBConnection, event: RaceEventInput): Promise<number> {
  if (event.id) {
    await conn.run(
      `UPDATE race_events
       SET name = $name, race_date = $race_date, distance_km = $distance_km, priority = $priority,
           target_finish_h = $target_finish_h, notes = $notes
       WHERE id = $id`,
      {
        name: event.name,
        race_date: event.race_date,
        distance_km: event.distance_km,
        priority: event.priority,
        target_finish_h: event.target_finish_h ?? null,
        notes: event.notes ?? null,
        id: event.id,
      },
    );
    return event.id;
  }
  const row = await queryRow<{ id: number }>(
    conn,
    `INSERT INTO race_events (name, race_date, distance_km, priority, target_finish_h, notes)
     VALUES ($name, $race_date, $distance_km, $priority, $target_finish_h, $notes)
     RETURNING id`,
    {
      name: event.name,
      race_date: event.race_date,
      distance_km: event.distance_km,
      priority: event.priority,
      target_finish_h: event.target_finish_h ?? null,
      notes: event.notes ?? null,
    },
  );
  return Number(row?.id);
}

export async function stampRaceActivity(conn: DuckDBConnection, raceEventId: number, stravaActivityId: number): Promise<void> {
  await conn.run("UPDATE race_events SET strava_activity_id = $activity_id WHERE id = $id", {
    activity_id: stravaActivityId,
    id: raceEventId,
  });
}

export async function upsertGear(
  conn: DuckDBConnection,
  gearId: string,
  gearName: string,
  isRetired = false,
): Promise<void> {
  await conn.run(
    `INSERT INTO gear (id, name, is_retired) VALUES ($id, $name, $is_retired)
     ON CONFLICT (id) DO UPDATE SET name = excluded.name, is_retired = excluded.is_retired`,
    { id: gearId, name: gearName, is_retired: isRetired },
  );
}

export interface RaceAnalysisInput {
  race_event_id: number;
  activity_id: number;
  avg_pace_min_km?: number | null;
  comrades_projection_h: number;
  riegel_factor?: number | null;
}

export async function upsertRaceAnalysis(conn: DuckDBConnection, analysis: RaceAnalysisInput): Promise<void> {
  await conn.run(
    `INSERT INTO race_analysis
        (race_event_id, activity_id, avg_pace_min_km, comrades_projection_h, riegel_factor, computed_at)
     VALUES ($race_event_id, $activity_id, $avg_pace_min_km, $comrades_projection_h, $riegel_factor, now())
     ON CONFLICT (race_event_id) DO UPDATE SET
        activity_id = excluded.activity_id,
        avg_pace_min_km = excluded.avg_pace_min_km,
        comrades_projection_h = excluded.comrades_projection_h,
        riegel_factor = excluded.riegel_factor,
        computed_at = excluded.computed_at`,
    {
      race_event_id: analysis.race_event_id,
      activity_id: analysis.activity_id,
      avg_pace_min_km: analysis.avg_pace_min_km ?? null,
      comrades_projection_h: analysis.comrades_projection_h,
      riegel_factor: analysis.riegel_factor ?? null,
    },
  );
}

export async function getAllRaceEvents<T = Record<string, unknown>>(conn: DuckDBConnection) {
  return queryRows<T>(
    conn,
    `SELECT id, name, race_date, distance_km, priority,
            target_finish_h, notes, strava_activity_id
     FROM race_events
     ORDER BY race_date`,
  );
}
