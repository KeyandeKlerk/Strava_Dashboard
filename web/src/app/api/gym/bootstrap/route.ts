// Used by the offline sync manager (web/src/lib/gymOffline/) to hydrate/
// refresh the client-side IndexedDB cache whenever the app has connectivity,
// independent of a full page reload.
import { NextResponse } from "next/server";
import { getConnection } from "@/lib/db/client";
import { getWeeklyPlan, listGymExercises, listRecentGymSessions } from "@/lib/db/gymMutations";

export const runtime = "nodejs";

export async function GET() {
  const conn = await getConnection();
  const [exercises, recentSessions, plan] = await Promise.all([
    listGymExercises(conn),
    listRecentGymSessions(conn),
    getWeeklyPlan(conn),
  ]);
  // Reshaped to just exercise ids per day — the client already caches full
  // exercise rows separately (exercisesCache) and resolves plan entries
  // against that cache, so there's no reason to duplicate the exercise data
  // itself in the plan payload.
  const planByDay = Object.fromEntries(
    Object.entries(plan).map(([day, dayExercises]) => [day, dayExercises.map((e) => e.id)]),
  );
  return NextResponse.json({ exercises, recentSessions, planByDay });
}
