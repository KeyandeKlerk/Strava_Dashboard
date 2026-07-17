"use server";
import { revalidatePath, updateTag } from "next/cache";
import { getConnection } from "./db/client";
import {
  addDailySession,
  correlateActivitiesToPlan,
  deleteDailySession,
  moveDailySession,
  syncWeeklyFromDaily,
  type DailySessionInput,
} from "./db/mutations";
import { DASHBOARD_DATA_TAG } from "./pageData";

export interface PlanActionState {
  error?: string;
}

function revalidatePlanPages(): void {
  updateTag(DASHBOARD_DATA_TAG);
  revalidatePath("/today");
  revalidatePath("/plan-history");
}

export async function moveDailySessionAction(id: number, toDate: string): Promise<PlanActionState> {
  const conn = await getConnection();
  const result = await moveDailySession(conn, id, toDate);
  if (result.error) return result;

  await syncWeeklyFromDaily(conn);
  await correlateActivitiesToPlan(conn);
  revalidatePlanPages();
  return {};
}

export async function deleteDailySessionAction(id: number): Promise<PlanActionState> {
  const conn = await getConnection();
  const result = await deleteDailySession(conn, id);
  if (result.error) return result;

  await syncWeeklyFromDaily(conn);
  revalidatePlanPages();
  return {};
}

export async function addDailySessionAction(formData: FormData): Promise<PlanActionState> {
  const plannedDate = String(formData.get("planned_date") ?? "");
  const sessionType = String(formData.get("session_type") ?? "");
  const weekNumberRaw = String(formData.get("week_number") ?? "");
  const weekNumber = Number(weekNumberRaw);

  if (!plannedDate || !sessionType) return { error: "Day and session type are required." };
  if (!weekNumberRaw || Number.isNaN(weekNumber)) return { error: "Missing week number." };

  const dayOfWeek = new Date(`${plannedDate}T00:00:00`).toLocaleDateString("en-US", { weekday: "long" });
  const input: DailySessionInput = {
    planned_date: plannedDate,
    week_number: weekNumber,
    day_of_week: dayOfWeek,
    session_type: sessionType,
    planned_distance_km: Number(formData.get("planned_distance_km") ?? 0) || 0,
    intensity: String(formData.get("intensity") ?? "easy"),
    description: String(formData.get("description") ?? ""),
    is_quality: formData.get("is_quality") === "on",
  };

  const conn = await getConnection();
  await addDailySession(conn, input);
  await syncWeeklyFromDaily(conn);
  await correlateActivitiesToPlan(conn);
  revalidatePlanPages();
  return {};
}
