"use server";
import { revalidatePath, updateTag } from "next/cache";
import { getConnection } from "@/lib/db/client";
import { upsertRaceEvent } from "@/lib/db/mutations";
import { DASHBOARD_DATA_TAG } from "@/lib/pageData";

// Note: the original Streamlit version also called `build_plan(...)` here to
// regenerate the full periodized training plan after adding a race. That
// plan-builder (src/periodization.py's build_plan) is a separate engine not
// yet ported — see SETUP.md. This action only saves the race; rebuilding the
// plan from it is a known follow-up.
export async function addRaceEvent(formData: FormData): Promise<void> {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

  const targetFinish = Number(formData.get("target_finish_h") ?? 0);

  await upsertRaceEvent(await getConnection(), {
    name,
    race_date: String(formData.get("race_date")),
    distance_km: Number(formData.get("distance_km")),
    priority: String(formData.get("priority") ?? "B"),
    target_finish_h: targetFinish > 0 ? targetFinish : null,
    notes: String(formData.get("notes") ?? "").trim() || null,
  });

  updateTag(DASHBOARD_DATA_TAG);
  revalidatePath("/race-prep");
}
