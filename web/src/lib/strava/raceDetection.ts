// Ported from src/periodization.py's detect_and_analyse_race +
// update_comrades_projection (race-result detection/analysis, run during
// sync). The full periodization plan-builder (build_plan and friends) is a
// separate feature not required for sync and is not ported here.
import type { DuckDBConnection } from "@duckdb/node-api";
import { queryRows } from "../db/client";
import { getPrimaryGoalRace, stampRaceActivity, upsertRaceAnalysis } from "../db/mutations";
import type { ActivityInput } from "../db/mutations";

// Riegel's endurance-fatigue exponent — a generic default, not tuned to any
// specific race.
const RIEGEL_EXPONENT = 1.06;

export interface RaceAnalysisResult {
  race_event_id: number;
  activity_id: number;
  avg_pace_min_km: number | null;
  projected_finish_h: number;
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
    projected_finish_h: 0.0,
    riegel_factor: RIEGEL_EXPONENT,
  };

  if (raceTimeH) {
    const projection = await updateRaceProjection(conn, raceEventId, {
      activity_id: activity.id,
      avg_pace_min_km: avgPace,
      race_distance_km: raceKm,
      race_time_h: raceTimeH,
    });
    if (projection != null) analysis.projected_finish_h = projection;
  }

  return analysis;
}

interface RaceResultInput {
  activity_id: number;
  avg_pace_min_km: number | null;
  race_distance_km: number;
  race_time_h: number;
}

interface GoalRaceRow {
  distance_km: number;
  terrain_factor: number | null;
}

// Projects a completed race/effort forward to the *primary goal race*
// (nearest upcoming A-priority race_events row, see getPrimaryGoalRace) —
// not a hardcoded distance. terrain_factor is per-race data (defaults to
// 1.0, neutral) rather than a single constant baked in for one course.
// Returns null if there's no upcoming goal race to project toward.
export async function updateRaceProjection(
  conn: DuckDBConnection,
  raceEventId: number,
  raceResult: RaceResultInput,
): Promise<number | null> {
  const goalRace = await getPrimaryGoalRace<GoalRaceRow>(conn);
  if (!goalRace) return null;

  const riegel =
    raceResult.race_time_h *
    (goalRace.distance_km / raceResult.race_distance_km) ** RIEGEL_EXPONENT *
    (goalRace.terrain_factor ?? 1.0);
  const projectionH = Math.round(riegel * 1000) / 1000;

  await upsertRaceAnalysis(conn, {
    race_event_id: raceEventId,
    activity_id: raceResult.activity_id,
    avg_pace_min_km: raceResult.avg_pace_min_km,
    projected_finish_h: projectionH,
    riegel_factor: RIEGEL_EXPONENT,
  });

  return projectionH;
}
