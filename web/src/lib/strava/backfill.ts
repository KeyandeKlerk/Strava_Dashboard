// Ported from src/backfill.py.
import type { DuckDBConnection } from "@duckdb/node-api";
import { queryRows } from "../db/client";
import { getHrZones, upsertHrZones, upsertStreamsDerived } from "../db/mutations";
import { getActivityStreams, getAthleteZones, refreshAccessToken } from "./client";
import { computeStreamsDerived } from "./streams";

const STREAMS_DISTANCE_THRESHOLD_KM = 0.0;
// Strava rate limit: 200 req/15min = ~13/min → 5s sleep keeps us safely under
const RATE_LIMIT_SLEEP_MS = 5_000;

function parseHrZones(zonesResponse: { heart_rate?: { zones?: Array<{ min: number; max: number }> } }): Array<[number, number]> {
  const raw = zonesResponse.heart_rate?.zones ?? [];
  return raw.map((z) => [z.min, z.max !== -1 ? z.max : 9999]);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runBackfill(conn: DuckDBConnection, force = false): Promise<void> {
  const accessToken = await refreshAccessToken(conn);

  let zonesResponse: Awaited<ReturnType<typeof getAthleteZones>> | null = null;
  try {
    zonesResponse = await getAthleteZones(accessToken);
  } catch (err) {
    console.warn(`Warning: failed to fetch HR zones from Strava, using cached zones: ${err}`);
  }

  if (zonesResponse !== null) {
    try {
      const parsedZones = parseHrZones(zonesResponse);
      if (parsedZones.length > 0) {
        await upsertHrZones(conn, parsedZones);
      } else {
        console.warn("Warning: Strava returned no HR zones, using cached zones");
      }
    } catch (err) {
      console.warn(`Warning: failed to parse/cache HR zones response, using cached zones: ${err}`);
    }
  }

  const hrZones = await getHrZones(conn);

  const candidates = force
    ? await queryRows<{ id: number; name: string; distance_km: number }>(
        conn,
        `SELECT a.id, a.name, a.distance_km
         FROM activities a
         WHERE a.category = 'running'
           AND a.distance_km >= $min_km
         ORDER BY a.start_date_local DESC`,
        { min_km: STREAMS_DISTANCE_THRESHOLD_KM },
      )
    : await queryRows<{ id: number; name: string; distance_km: number }>(
        conn,
        `SELECT a.id, a.name, a.distance_km
         FROM activities a
         LEFT JOIN activity_streams_derived sd ON a.id = sd.activity_id
         WHERE a.category = 'running'
           AND a.distance_km >= $min_km
           AND sd.activity_id IS NULL
         ORDER BY a.start_date_local DESC`,
        { min_km: STREAMS_DISTANCE_THRESHOLD_KM },
      );

  if (candidates.length === 0) {
    console.log("No activities need streams backfill.");
    return;
  }

  console.log(`Fetching streams for ${candidates.length} activities...`);

  for (let i = 0; i < candidates.length; i++) {
    const { id: activityId, name, distance_km: distanceKm } = candidates[i];
    console.log(`  [${i + 1}/${candidates.length}] ${name} (${distanceKm.toFixed(1)} km)...`);
    try {
      const streams = await getActivityStreams(accessToken, activityId);
      const derived = computeStreamsDerived(streams, activityId, hrZones);
      await upsertStreamsDerived(conn, derived);
    } catch (err) {
      console.warn(`    Warning: failed for activity ${activityId}: ${err}`);
    }
    await sleep(RATE_LIMIT_SLEEP_MS);
  }

  console.log("Backfill complete.");
}
