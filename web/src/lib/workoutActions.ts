"use server";
import { getConnection } from "./db/client";
import { getActivityDetail, nutritionLogsForActivity, type ActivityDetailRow, type NutritionLogRow } from "./metrics";

export interface WorkoutDetail {
  activity: ActivityDetailRow;
  nutritionLogs: NutritionLogRow[];
}

export async function getWorkoutDetailAction(activityId: number): Promise<WorkoutDetail | null> {
  const conn = await getConnection();
  const activity = await getActivityDetail(conn, activityId);
  if (!activity) return null;

  const nutritionLogs = await nutritionLogsForActivity(conn, activityId);
  return { activity, nutritionLogs };
}
