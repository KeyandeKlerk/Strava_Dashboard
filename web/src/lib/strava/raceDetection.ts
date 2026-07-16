// Ported from src/periodization.py's detect_and_analyse_race +
// update_comrades_projection (race-result detection/analysis, run during
// sync). The full periodization plan-builder (build_plan and friends) is a
// separate feature not required for sync and is not ported here.
import type { DuckDBConnection } from "@duckdb/node-api";
import { queryRows } from "../db/client";
import { stampRaceActivity, upsertRaceAnalysis } from "../db/mutations";
import type { ActivityInput } from "../db/mutations";

export const RACE_DISTANCE_KM = 90.0;
const TERRAIN_FACTOR = 1.04; // +4% for Comrades Down Run

export interface RaceAnalysisResult {
  race_event_id: number;
  activity_id: number;
  avg_pace_min_km: number | null;
  comrades_projection_h: number;
  riegel_factor: number;
}

export async function detectAndAnalyseRace(
  conn: DuckDBConnection,
  activity: ActivityInput,
): Promise<RaceAnalysisResult | null> {
  if (activity.category !== "running") return null;
  if (!activity.distance_km) return null;

  const actDate = (activity.start_date_local ?? "").slice(0, 10); // "YYYY-MM-DD"
  const actKm = activity.distance_km;

  const races = await queryRows<{ id: number; distance_km: number }>(
    conn,
    `SELECT id, distance_km
     FROM race_events
     WHERE strava_activity_id IS NULL
       AND ABS(CAST($act_date AS DATE) - CAST(race_date AS DATE)) <= 1`,
    { act_date: actDate },
  );

  const candidates = races
    .map((r) => ({ id: r.id, diff: Math.abs(actKm - r.distance_km), km: r.distance_km }))
    .filter((c) => c.km > 0 && Math.abs(actKm - c.km) / c.km <= 0.1);

  if (candidates.length === 0) return null;

  // Tiebreak: closest distance
  const best = candidates.reduce((a, b) => (a.diff <= b.diff ? a : b));
  const raceEventId = best.id;
  const raceKm = best.km;

  await stampRaceActivity(conn, raceEventId, activity.id);

  const avgPace =
    actKm && activity.moving_time_min != null ? activity.moving_time_min / actKm : null;
  const raceTimeH = activity.moving_time_min != null ? activity.moving_time_min / 60.0 : null;

  const analysis: RaceAnalysisResult = {
    race_event_id: raceEventId,
    activity_id: activity.id,
    avg_pace_min_km: avgPace,
    comrades_projection_h: 0.0,
    riegel_factor: 1.06,
  };

  if (raceTimeH) {
    analysis.comrades_projection_h = await updateComradesProjection(conn, raceEventId, {
      activity_id: activity.id,
      avg_pace_min_km: avgPace,
      race_distance_km: raceKm,
      race_time_h: raceTimeH,
    });
  }

  return analysis;
}

interface RaceResultInput {
  activity_id: number;
  avg_pace_min_km: number | null;
  race_distance_km: number;
  race_time_h: number;
}

export async function updateComradesProjection(
  conn: DuckDBConnection,
  raceEventId: number,
  raceResult: RaceResultInput,
): Promise<number> {
  const riegel =
    raceResult.race_time_h * (RACE_DISTANCE_KM / raceResult.race_distance_km) ** 1.06 * TERRAIN_FACTOR;
  const projectionH = Math.round(riegel * 1000) / 1000;

  await upsertRaceAnalysis(conn, {
    race_event_id: raceEventId,
    activity_id: raceResult.activity_id,
    avg_pace_min_km: raceResult.avg_pace_min_km,
    comrades_projection_h: projectionH,
    riegel_factor: 1.06,
  });

  return projectionH;
}
