"use server";
import { updateTag } from "next/cache";
import { getConnection } from "./db/client";
import { addNiggleLog } from "./db/mutations";
import {
  getActivityDetail,
  niggleLogsForActivity,
  nutritionLogsForActivity,
  type ActivityDetailRow,
  type NiggleLogRow,
  type NutritionLogRow,
} from "./metrics";
import { DASHBOARD_DATA_TAG } from "./pageData";

export interface WorkoutDetail {
  activity: ActivityDetailRow;
  nutritionLogs: NutritionLogRow[];
  niggleLogs: NiggleLogRow[];
}

export async function getWorkoutDetailAction(activityId: number): Promise<WorkoutDetail | null> {
  const conn = await getConnection();
  const activity = await getActivityDetail(conn, activityId);
  if (!activity) return null;

  const [nutritionLogs, niggleLogs] = await Promise.all([
    nutritionLogsForActivity(conn, activityId),
    niggleLogsForActivity(conn, activityId),
  ]);
  return { activity, nutritionLogs, niggleLogs };
}

export interface NiggleActionState {
  error?: string;
}

export async function logNiggleAction(activityId: number, formData: FormData): Promise<NiggleActionState> {
  const bodyPart = String(formData.get("body_part") ?? "").trim();
  const severity = Number(formData.get("severity") ?? "");
  const notes = String(formData.get("notes") ?? "").trim() || null;

  if (!bodyPart) return { error: "Pick where it's bothering you." };
  if (!Number.isInteger(severity) || severity < 1 || severity > 5) return { error: "Severity must be 1-5." };

  const conn = await getConnection();
  const activity = await getActivityDetail(conn, activityId);
  if (!activity) return { error: "That activity no longer exists." };

  await addNiggleLog(conn, {
    activity_id: activityId,
    logged_date: activity.activity_date,
    body_part: bodyPart,
    severity,
    notes,
  });

  // Fatigue page's recent-niggles summary reads cached page data, unlike
  // this sheet's own fetch (re-invoked directly by the client on success).
  updateTag(DASHBOARD_DATA_TAG);
  return {};
}
