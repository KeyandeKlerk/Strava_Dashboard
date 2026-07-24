// Used by the offline sync manager (web/src/lib/gymOffline/) to hydrate/
// refresh the client-side IndexedDB cache whenever the app has connectivity,
// independent of a full page reload.
import { NextResponse } from "next/server";
import { getConnection } from "@/lib/db/client";
import {
  getLastPerformanceByExercise,
  getWeeklyPlan,
  listGymExercises,
  listRecentGymSessions,
  type PlanEntryInput,
} from "@/lib/db/gymMutations";

export const runtime = "nodejs";

export async function GET() {
  const conn = await getConnection();
  const [exercises, recentSessions, plan, lastPerformance] = await Promise.all([
    listGymExercises(conn),
    listRecentGymSessions(conn),
    getWeeklyPlan(conn),
    getLastPerformanceByExercise(conn),
  ]);
  // Reshaped to plan-entry objects per day (exercise id + target/grouping
  // fields) — the client already caches full exercise rows separately
  // (exercisesCache) and resolves each entry's exerciseId against that cache,
  // so there's no reason to duplicate the exercise data itself in the plan
  // payload.
  const planByDay: Record<string, PlanEntryInput[]> = Object.fromEntries(
    Object.entries(plan).map(([day, dayExercises]) => [
      day,
      dayExercises.map((e) => ({
        exerciseId: e.id,
        targetSets: e.target_sets,
        targetReps: e.target_reps,
        supersetGroup: e.superset_group,
      })),
    ]),
  );
  return NextResponse.json({ exercises, recentSessions, planByDay, lastPerformanceByExercise: lastPerformance });
}
