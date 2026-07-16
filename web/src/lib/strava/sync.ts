// Ported from src/sync.py.
import type { DuckDBConnection } from "@duckdb/node-api";
import { queryRows } from "../db/client";
import { correlateActivitiesToPlan, getLastSynced, setLastSynced, upsertActivity, upsertGear } from "../db/mutations";
import { getActivities, getGear, refreshAccessToken } from "./client";
import { parseActivity } from "./parser";
import { detectAndAnalyseRace } from "./raceDetection";
import { runBackfill } from "./backfill";

export async function runSync(conn: DuckDBConnection): Promise<{ processedCount: number }> {
  const lastSynced = await getLastSynced(conn);

  console.log(lastSynced ? `Fetching activities after ${lastSynced}...` : "Fetching activities (all time)...");
  const accessToken = await refreshAccessToken(conn);
  const rawActivities = await getActivities(accessToken, lastSynced);

  if (rawActivities.length === 0) {
    console.log("No new activities.");
  } else {
    console.log(`Syncing ${rawActivities.length} activities...`);
    const seenGearRows = await queryRows<{ id: string }>(conn, "SELECT id FROM gear");
    const seenGear = new Set(seenGearRows.map((r) => r.id));

    const newActivities = [];
    for (const raw of rawActivities) {
      const activity = parseActivity(raw);
      await upsertActivity(conn, activity);
      newActivities.push(activity);

      const gearId = activity.gear_id;
      if (gearId && !seenGear.has(gearId)) {
        const gearData = await getGear(accessToken, gearId);
        const gearName = gearData?.name ?? gearId;
        await upsertGear(conn, gearId, gearName);
        seenGear.add(gearId);
      }
    }

    for (const activity of newActivities) {
      await detectAndAnalyseRace(conn, activity);
    }
  }

  const nowTs = Math.floor(Date.now() / 1000);
  await setLastSynced(conn, nowTs);
  await correlateActivitiesToPlan(conn);
  console.log(`Sync complete. ${rawActivities.length} activities processed.`);
  await runBackfill(conn);

  return { processedCount: rawActivities.length };
}
