// Ported from src/parser.py.
import { categorizeActivity } from "./categoryMap";
import type { ActivityInput } from "../db/mutations";

export interface RawStravaActivity {
  id: number;
  name?: string;
  sport_type?: string;
  start_date_local?: string;
  distance?: number;
  moving_time?: number;
  elapsed_time?: number;
  suffer_score?: number;
  average_cadence?: number;
  average_speed?: number;
  total_elevation_gain?: number;
  average_heartrate?: number;
  max_heartrate?: number;
  gear_id?: string;
}

export function parseActivity(raw: RawStravaActivity): ActivityInput {
  const sportType = raw.sport_type ?? "";
  const name = raw.name ?? "";
  const category = categorizeActivity(sportType, name);

  const distanceM = raw.distance || 0;
  const movingTimeS = raw.moving_time || 0;
  const elapsedTimeS = raw.elapsed_time || 0;
  const relativeEffort = raw.suffer_score ?? null;
  const movingTimeMin = movingTimeS / 60;
  const loadScore = relativeEffort ?? movingTimeMin;

  // Strava reports cadence as steps/min per leg — double for full SPM
  const rawCadence = raw.average_cadence;
  const cadenceSpm = rawCadence ? Math.round(rawCadence * 2 * 10) / 10 : null;

  const rawSpeed = raw.average_speed || 0;
  const speedKmh = rawSpeed ? Math.round(rawSpeed * 3.6 * 1000) / 1000 : null;

  return {
    id: raw.id,
    name,
    sport_type: sportType,
    category,
    start_date_local: (raw.start_date_local ?? "").replace("Z", ""),
    distance_km: distanceM ? Math.round((distanceM / 1000) * 1000) / 1000 : null,
    moving_time_min: Math.round(movingTimeMin * 100) / 100,
    elapsed_time_min: Math.round((elapsedTimeS / 60) * 100) / 100,
    elevation_gain_m: raw.total_elevation_gain ?? null,
    average_heartrate: raw.average_heartrate ?? null,
    max_heartrate: raw.max_heartrate ?? null,
    average_cadence: cadenceSpm,
    average_speed_kmh: speedKmh,
    relative_effort: relativeEffort,
    load_score: Math.round(loadScore * 100) / 100,
    gear_id: raw.gear_id ?? null,
  };
}
