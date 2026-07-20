"use client";
import { useEffect, useState, useTransition } from "react";
import { getWorkoutDetailAction, logNiggleAction, type WorkoutDetail } from "@/lib/workoutActions";
import { fmtPace } from "@/lib/shared";
import type { ActivityDetailRow } from "@/lib/metrics";
import { StatCard } from "@/components/StatCard";

const ZONE_LABELS: Array<[keyof ActivityDetailRow, string]> = [
  ["z1_min", "Z1"],
  ["z2_min", "Z2"],
  ["z3_min", "Z3"],
  ["z4_min", "Z4"],
  ["z5_min", "Z5"],
] as const;

const BODY_PARTS: Array<[string, string]> = [
  ["knee_itb", "Knee / ITB"],
  ["calf", "Calf"],
  ["achilles", "Achilles"],
  ["hip", "Hip"],
  ["foot_ankle", "Foot / Ankle"],
  ["back", "Back"],
  ["hamstring", "Hamstring"],
  ["other", "Other"],
];

const FIELD_CLASS =
  "w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900";

export function WorkoutDetailSheet({ activityId, onClose }: { activityId: number; onClose: () => void }) {
  const [detail, setDetail] = useState<WorkoutDetail | null | undefined>(undefined);
  const [niggleError, setNiggleError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    getWorkoutDetailAction(activityId).then((result) => {
      if (!cancelled) setDetail(result);
    });
    return () => {
      cancelled = true;
    };
  }, [activityId]);

  function handleLogNiggle(formData: FormData) {
    setNiggleError(null);
    startTransition(async () => {
      const result = await logNiggleAction(activityId, formData);
      if (result.error) {
        setNiggleError(result.error);
        return;
      }
      // Not part of server-rendered page props (fetched client-side on
      // open), so a plain page revalidation wouldn't refresh this sheet —
      // re-invoke the same fetch directly instead.
      getWorkoutDetailAction(activityId).then(setDetail);
    });
  }

  const isRunning = detail?.activity.category === "running";
  const hasZoneData = detail?.activity.z1_min != null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-3xl rounded-t-xl bg-white p-4 dark:bg-neutral-950"
        onClick={(e) => e.stopPropagation()}
      >
        {detail === undefined && <p className="text-sm text-neutral-500">Loading...</p>}
        {detail === null && <p className="text-sm text-neutral-500">Couldn&apos;t find that activity.</p>}
        {detail && (
          <>
            <h3 className="text-sm font-medium">{detail.activity.name}</h3>
            <p className="text-xs text-neutral-500">
              {detail.activity.activity_date} · {detail.activity.category.replace(/_/g, " ")}
            </p>

            <div className="mt-2 grid grid-cols-2 gap-2">
              {isRunning && detail.activity.distance_km != null && (
                <StatCard label="Distance" value={`${detail.activity.distance_km.toFixed(1)} km`} />
              )}
              {detail.activity.moving_time_min != null && (
                <StatCard label="Duration" value={`${Math.round(detail.activity.moving_time_min)} min`} />
              )}
              {isRunning && (
                <StatCard label="Pace" value={detail.activity.pace_min_km != null ? `${fmtPace(detail.activity.pace_min_km)}/km` : "—"} />
              )}
              {isRunning && detail.activity.elevation_gain_m != null && (
                <StatCard label="Elevation Gain" value={`${Math.round(detail.activity.elevation_gain_m)} m`} />
              )}
              {detail.activity.average_heartrate != null && (
                <StatCard label="Avg HR" value={`${Math.round(detail.activity.average_heartrate)} bpm`} />
              )}
              {detail.activity.max_heartrate != null && (
                <StatCard label="Max HR" value={`${Math.round(detail.activity.max_heartrate)} bpm`} />
              )}
              {isRunning && detail.activity.average_cadence != null && (
                <StatCard label="Cadence" value={`${Math.round(detail.activity.average_cadence)} spm`} />
              )}
              {detail.activity.load_score != null && (
                <StatCard label="Load" value={Math.round(detail.activity.load_score).toString()} />
              )}
              {detail.activity.decoupling_pct != null && (
                <StatCard label="Decoupling" value={`${detail.activity.decoupling_pct.toFixed(1)}%`} />
              )}
            </div>

            {hasZoneData && (
              <div className="mt-3">
                <p className="text-xs font-medium text-neutral-500">HR Zone Time</p>
                <p className="mt-1 text-sm">
                  {ZONE_LABELS.map(([key, label]) => {
                    const value = detail.activity[key] as number | null;
                    return `${label}: ${value != null ? Math.round(value) : 0}min`;
                  }).join(" · ")}
                </p>
              </div>
            )}

            {detail.activity.gear_name && (
              <p className="mt-2 text-xs text-neutral-500">Shoe: {detail.activity.gear_name}</p>
            )}

            {detail.nutritionLogs.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-medium text-neutral-500">Fueling</p>
                {detail.nutritionLogs.map((log) => (
                  <p key={log.id} className="mt-1 text-sm">
                    {log.carbs_g}g carbs · {log.sodium_mg}mg sodium
                    {log.fluid_ml != null && ` · ${log.fluid_ml}ml fluid`}
                    {log.carbs_g_per_hour != null && ` (${log.carbs_g_per_hour}g/h, ${log.sodium_mg_per_hour}mg/h)`}
                    {log.notes && ` — ${log.notes}`}
                  </p>
                ))}
              </div>
            )}

            {detail.niggleLogs.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-medium text-neutral-500">Niggles</p>
                {detail.niggleLogs.map((log) => (
                  <p key={log.id} className="mt-1 text-sm">
                    {BODY_PARTS.find(([key]) => key === log.body_part)?.[1] ?? log.body_part} — severity {log.severity}/5
                    {log.notes && ` — ${log.notes}`}
                  </p>
                ))}
              </div>
            )}

            <details className="mt-3">
              <summary className="cursor-pointer text-xs font-medium text-neutral-500">Log a niggle</summary>
              <form action={handleLogNiggle} className="mt-2 space-y-2">
                <select name="body_part" required className={FIELD_CLASS}>
                  {BODY_PARTS.map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
                <select name="severity" required defaultValue={2} className={FIELD_CLASS}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n} {n === 1 ? "— barely noticeable" : n === 5 ? "— severe" : ""}
                    </option>
                  ))}
                </select>
                <input name="notes" placeholder="Notes (optional)" className={FIELD_CLASS} />
                <button
                  type="submit"
                  disabled={isPending}
                  className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900"
                >
                  Save
                </button>
                {niggleError && <p className="text-xs text-red-600">{niggleError}</p>}
              </form>
            </details>
          </>
        )}

        <button type="button" onClick={onClose} className="mt-3 w-full text-center text-xs text-neutral-500">
          Close
        </button>
      </div>
    </div>
  );
}
