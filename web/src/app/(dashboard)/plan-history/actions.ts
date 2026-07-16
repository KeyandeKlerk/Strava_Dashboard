"use server";
import { revalidatePath } from "next/cache";
import { getConnection } from "@/lib/db/client";
import {
  clearTrainingPlan,
  correlateActivitiesToPlan,
  syncWeeklyFromDaily,
  upsertDailySession,
} from "@/lib/db/mutations";
import { parseCsv } from "@/lib/csv";

const REQUIRED_COLUMNS = [
  "planned_date",
  "week_number",
  "day_of_week",
  "session_type",
  "planned_distance_km",
  "intensity",
  "description",
  "is_quality",
];

export interface ImportPlanState {
  error?: string;
  success?: string;
}

export async function importPlanCsv(_prev: ImportPlanState, formData: FormData): Promise<ImportPlanState> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "No file selected." };
  }

  const rows = parseCsv(await file.text());
  if (rows.length === 0) return { error: "CSV is empty." };

  const missing = REQUIRED_COLUMNS.filter((c) => !(c in rows[0]));
  if (missing.length > 0) return { error: `Missing columns: ${missing.join(", ")}` };

  const conn = await getConnection();
  await clearTrainingPlan(conn);
  for (const row of rows) {
    await upsertDailySession(conn, {
      planned_date: row.planned_date,
      week_number: Number(row.week_number),
      day_of_week: row.day_of_week,
      session_type: row.session_type,
      planned_distance_km: Number(row.planned_distance_km) || 0,
      intensity: row.intensity,
      description: row.description,
      is_quality: ["true", "1", "yes"].includes(row.is_quality.toLowerCase()),
    });
  }
  await syncWeeklyFromDaily(conn);
  await correlateActivitiesToPlan(conn);

  revalidatePath("/plan-history");
  revalidatePath("/today");
  return { success: `Replaced plan with ${rows.length} sessions and matched to Strava activities.` };
}
