// Ported from src/sync.py.
import type { DuckDBConnection } from "@duckdb/node-api";
import { queryRows } from "../db/client";
import {
  correlateActivitiesToPlan,
  getLastSynced,
  setLastSynced,
  upsertActivity,
  upsertGear,
  type ActivityInput,
} from "../db/mutations";
import { getActivities, getGear, refreshAccessToken } from "./client";
import { parseActivity } from "./parser";
import { detectAndAnalyseRace } from "./raceDetection";
import { runBackfill } from "./backfill";

export async function runSync(conn: DuckDBConnection): Promise<{ processedCount: number }> {
  const lastSynced = await getLastSynced(conn);

  console.log(lastSynced ? `Fetching activities after ${lastSynced}...` : "Fetching activities (all time)...");
  const accessToken = await refreshAccessToken(conn);
  const rawActivities = await getActivities(accessToken, lastSynced);

  const newActivities: ActivityInput[] = [];
  if (rawActivities.length === 0) {
    console.log("No new activities.");
  } else {
    console.log(`Syncing ${rawActivities.length} activities...`);
    for (const raw of rawActivities) {
      const activity = parseActivity(raw);
      await upsertActivity(conn, activity);
      newActivities.push(activity);
    }

    for (const activity of newActivities) {
      await detectAndAnalyseRace(conn, activity);
    }
  }

  // Refresh every known shoe/gear's name + retired status from Strava on
  // every sync, not just gear seen on brand-new activities — a shoe you just
  // retired in Strava won't appear on any new activity again, so that's
  // exactly the case that needs an unconditional refresh to be caught.
  await refreshGear(conn, accessToken, newActivities);

  const nowTs = Math.floor(Date.now() / 1000);
  await setLastSynced(conn, nowTs);
  await correlateActivitiesToPlan(conn);
  console.log(`Sync complete. ${rawActivities.length} activities processed.`);
  await runBackfill(conn);

  return { processedCount: rawActivities.length };
}

async function refreshGear(conn: DuckDBConnection, accessToken: string, newActivities: ActivityInput[]): Promise<void> {
  const knownGearRows = await queryRows<{ id: string }>(conn, "SELECT id FROM gear");
  const gearIds = new Set(knownGearRows.map((r) => r.id));
  for (const activity of newActivities) {
    if (activity.gear_id) gearIds.add(activity.gear_id);
  }

  for (const gearId of gearIds) {
    const gearData = await getGear(accessToken, gearId);
    if (gearData) {
      await upsertGear(conn, gearId, gearData.name ?? gearId, gearData.retired ?? false);
    }
  }
}
