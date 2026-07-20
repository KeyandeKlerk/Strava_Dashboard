"use server";
import { revalidatePath, updateTag } from "next/cache";
import { getConnection, queryRow } from "@/lib/db/client";
import { addNutritionLog, upsertNutritionTargets } from "@/lib/db/mutations";
import { DASHBOARD_DATA_TAG } from "@/lib/pageData";

export interface NutritionActionState {
  error?: string;
}

function revalidateNutrition(): void {
  updateTag(DASHBOARD_DATA_TAG);
  revalidatePath("/today");
}

// Plain `<form action={...}>` (no client wrapper), so this returns `void`
// like `addRaceEvent` in race-prep/actions.ts — invalid input just no-ops
// rather than surfacing an inline error.
export async function setNutritionTargetsAction(formData: FormData): Promise<void> {
  const carbs = Number(formData.get("target_carbs_g_per_hour") ?? "");
  const sodium = Number(formData.get("target_sodium_mg_per_hour") ?? "");
  const fluidRaw = String(formData.get("target_fluid_ml_per_hour") ?? "").trim();
  const fluid = fluidRaw ? Number(fluidRaw) : null;

  if (!Number.isFinite(carbs) || carbs <= 0) return;
  if (!Number.isFinite(sodium) || sodium <= 0) return;
  if (fluid != null && (!Number.isFinite(fluid) || fluid <= 0)) return;

  await upsertNutritionTargets(await getConnection(), {
    target_carbs_g_per_hour: carbs,
    target_sodium_mg_per_hour: sodium,
    target_fluid_ml_per_hour: fluid,
  });

  revalidateNutrition();
}

export async function logNutritionEntryAction(formData: FormData): Promise<NutritionActionState> {
  const activityId = Number(formData.get("activity_id") ?? "");
  const carbs = Number(formData.get("carbs_g") ?? "");
  const sodium = Number(formData.get("sodium_mg") ?? "");
  const fluidRaw = String(formData.get("fluid_ml") ?? "").trim();
  const fluid = fluidRaw ? Number(fluidRaw) : null;
  const notes = String(formData.get("notes") ?? "").trim() || null;

  if (!activityId) return { error: "Pick which run this fueling log is for." };
  if (!Number.isFinite(carbs) || carbs < 0) return { error: "Carbs (g) must be a non-negative number." };
  if (!Number.isFinite(sodium) || sodium < 0) return { error: "Sodium (mg) must be a non-negative number." };
  if (fluid != null && (!Number.isFinite(fluid) || fluid < 0)) return { error: "Fluid (ml) must be a non-negative number." };

  const conn = await getConnection();
  const activity = await queryRow<{ activity_date: string }>(
    conn,
    "SELECT start_date_local::DATE::VARCHAR AS activity_date FROM activities WHERE id = $id",
    { id: activityId },
  );
  if (!activity) return { error: "That activity no longer exists." };

  await addNutritionLog(conn, {
    activity_id: activityId,
    logged_date: activity.activity_date,
    carbs_g: carbs,
    sodium_mg: sodium,
    fluid_ml: fluid,
    notes,
  });

  revalidateNutrition();
  return {};
}
