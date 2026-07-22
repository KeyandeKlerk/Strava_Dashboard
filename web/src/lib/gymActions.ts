"use server";
// Everything here is a plain server action (not the offline REST routes under
// web/src/app/api/gym/*) — these are reached from WorkoutDetailSheet/
// GymSessionDetailSheet for viewing/backfilling history, not live-logging at
// the gym, so they don't need offline queuing.
import { updateTag } from "next/cache";
import { getConnection, queryRow } from "./db/client";
import {
  addCustomExercise,
  addGymSet,
  deleteGymSet,
  getGymSessionDetail,
  listGymExercises,
  upsertGymSession,
  type GymExerciseRow,
  type GymSessionDetail,
} from "./db/gymMutations";
import { exerciseProgression, type ExerciseProgressionRow } from "./gymMetrics";
import { DASHBOARD_DATA_TAG } from "./pageData";

export async function getGymSessionDetailAction(sessionId: number): Promise<GymSessionDetail | null> {
  const conn = await getConnection();
  return getGymSessionDetail(conn, sessionId);
}

export async function listGymExercisesAction(): Promise<GymExerciseRow[]> {
  const conn = await getConnection();
  return listGymExercises(conn);
}

// Backs the /gym/insights exercise-progression select for any exercise not
// already preloaded in getGymInsightsPageData's default.
export async function getExerciseProgressionAction(exerciseId: number): Promise<ExerciseProgressionRow[]> {
  const conn = await getConnection();
  return exerciseProgression(conn, exerciseId);
}

export interface GymActionState {
  error?: string;
}

export async function logGymSetAction(sessionId: number, formData: FormData): Promise<GymActionState> {
  const exerciseId = Number(formData.get("exercise_id"));
  const weightKg = Number(formData.get("weight_kg"));
  const reps = Number(formData.get("reps"));

  if (!Number.isInteger(exerciseId)) return { error: "Pick an exercise." };
  if (!Number.isFinite(weightKg) || weightKg <= 0) return { error: "Enter a valid weight." };
  if (!Number.isInteger(reps) || reps <= 0) return { error: "Enter valid reps." };

  const conn = await getConnection();
  const session = await getGymSessionDetail(conn, sessionId);
  if (!session) return { error: "Session not found." };

  const setNumber = session.sets.filter((s) => s.exercise_id === exerciseId).length + 1;
  const result = await addGymSet(conn, {
    client_uuid: crypto.randomUUID(),
    session_client_uuid: session.client_uuid,
    exercise_id: exerciseId,
    set_number: setNumber,
    weight_kg: weightKg,
    reps,
  });
  if ("error" in result) return { error: result.error };

  updateTag(DASHBOARD_DATA_TAG);
  return {};
}

export async function deleteGymSetAction(clientUuid: string): Promise<void> {
  const conn = await getConnection();
  await deleteGymSet(conn, clientUuid);
  updateTag(DASHBOARD_DATA_TAG);
}

export async function addCustomExerciseAction(formData: FormData): Promise<GymActionState & { exercise?: GymExerciseRow }> {
  const name = String(formData.get("name") ?? "").trim();
  const muscleGroup = String(formData.get("muscle_group") ?? "");
  if (!name) return { error: "Enter an exercise name." };
  if (!muscleGroup) return { error: "Pick a muscle group." };

  const conn = await getConnection();
  const result = await addCustomExercise(conn, {
    client_uuid: crypto.randomUUID(),
    name,
    muscle_group: muscleGroup,
  });
  const exercise = await queryRow<GymExerciseRow>(conn, "SELECT id, client_uuid, name, muscle_group, equipment, is_custom FROM gym_exercises WHERE id = $id", {
    id: result.id,
  });
  return { exercise };
}

// Creates a gym session already linked to a known Strava activity — used by
// WorkoutDetailSheet's "Log sets for this workout" CTA, skipping the
// auto-link reconciliation entirely since the activity is already known.
export async function createGymSessionForActivityAction(
  activityId: number,
): Promise<{ error: string } | { sessionId: number }> {
  const conn = await getConnection();
  const activity = await queryRow<{ session_date: string }>(
    conn,
    "SELECT start_date_local::DATE::VARCHAR AS session_date FROM activities WHERE id = $id",
    { id: activityId },
  );
  if (!activity) return { error: "That activity no longer exists." };

  const session = await upsertGymSession(conn, {
    client_uuid: crypto.randomUUID(),
    session_date: activity.session_date,
    activity_id: activityId,
  });
  updateTag(DASHBOARD_DATA_TAG);
  return { sessionId: session.id };
}
