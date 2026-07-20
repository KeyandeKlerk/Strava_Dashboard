import { setNutritionTargetsAction } from "@/app/(dashboard)/today/actions";
import { flag } from "@/lib/shared";
import type { NutritionLogRow, NutritionTargets, ProjectedRaceFueling, RunningActivityOption } from "@/lib/metrics";
import { StatCard } from "@/components/StatCard";
import { ChartCard } from "@/components/charts/ChartCard";
import { CarbsPerHourChart, SodiumPerHourChart } from "@/components/charts/NutritionCharts";
import { LogFuelingButton } from "@/components/LogFuelingButton";

const FIELD_CLASS =
  "w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900";

export function NutritionSection({
  targets,
  log,
  activities,
  projection,
}: {
  targets: NutritionTargets | null;
  log: NutritionLogRow[];
  activities: RunningActivityOption[];
  projection: ProjectedRaceFueling | null;
}) {
  const latest = log.length > 0 ? log[log.length - 1] : null;

  return (
    <div>
      <div className="mt-4 flex items-center justify-between">
        <h2 className="text-base font-semibold">Fueling</h2>
        <LogFuelingButton activities={activities} />
      </div>

      {!targets ? (
        <p className="mt-2 text-sm text-neutral-500">
          No fueling plan set yet — add your target carb/sodium rates below.
        </p>
      ) : (
        <>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <StatCard label="Target Carbs" value={`${targets.target_carbs_g_per_hour} g/h`} />
            <StatCard label="Target Sodium" value={`${targets.target_sodium_mg_per_hour} mg/h`} />
            <StatCard
              label="Last Run Carbs"
              value={latest?.carbs_g_per_hour != null ? `${latest.carbs_g_per_hour} g/h` : "—"}
              caption={latest ? latest.activity_date : undefined}
              flag={
                latest?.carbs_g_per_hour != null
                  ? flag(latest.carbs_g_per_hour, targets.target_carbs_g_per_hour * 0.9, targets.target_carbs_g_per_hour * 1.1)
                  : "gray"
              }
            />
            <StatCard
              label="Last Run Sodium"
              value={latest?.sodium_mg_per_hour != null ? `${latest.sodium_mg_per_hour} mg/h` : "—"}
              caption={latest ? latest.activity_date : undefined}
              flag={
                latest?.sodium_mg_per_hour != null
                  ? flag(latest.sodium_mg_per_hour, targets.target_sodium_mg_per_hour * 0.9, targets.target_sodium_mg_per_hour * 1.1)
                  : "gray"
              }
            />
          </div>

          {projection && (
            <p className="mt-2 text-xs text-neutral-500">
              Projected race day ({projection.projected_finish_h.toFixed(1)}h): {projection.total_carbs_g} g carbs ·{" "}
              {projection.total_sodium_mg} mg sodium
              {projection.total_fluid_ml != null && ` · ${projection.total_fluid_ml} ml fluid`}
            </p>
          )}

          {log.length > 0 && (
            <>
              <ChartCard title="Carbs per Hour" subtitle="Actual carb intake rate on logged runs vs. your target (dashed line).">
                <CarbsPerHourChart data={log} targetGPerHour={targets.target_carbs_g_per_hour} />
              </ChartCard>
              <ChartCard title="Sodium per Hour" subtitle="Actual sodium intake rate on logged runs vs. your target (dashed line).">
                <SodiumPerHourChart data={log} targetMgPerHour={targets.target_sodium_mg_per_hour} />
              </ChartCard>
            </>
          )}
        </>
      )}

      <details className="mt-3">
        <summary className="cursor-pointer text-sm font-medium">Edit fueling plan</summary>
        <form action={setNutritionTargetsAction} className="mt-2 space-y-2">
          <input
            name="target_carbs_g_per_hour"
            type="number"
            step="1"
            min="1"
            required
            defaultValue={targets?.target_carbs_g_per_hour ?? undefined}
            placeholder="Target carbs (g/hr)"
            className={FIELD_CLASS}
          />
          <input
            name="target_sodium_mg_per_hour"
            type="number"
            step="1"
            min="1"
            required
            defaultValue={targets?.target_sodium_mg_per_hour ?? undefined}
            placeholder="Target sodium (mg/hr)"
            className={FIELD_CLASS}
          />
          <input
            name="target_fluid_ml_per_hour"
            type="number"
            step="1"
            min="1"
            defaultValue={targets?.target_fluid_ml_per_hour ?? undefined}
            placeholder="Target fluid (ml/hr, optional)"
            className={FIELD_CLASS}
          />
          <button type="submit" className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900">
            Save plan
          </button>
        </form>
      </details>
    </div>
  );
}
