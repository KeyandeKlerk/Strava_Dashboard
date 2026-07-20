"use client";
import { useEffect, useState } from "react";
import { getWorkoutDetailAction, type WorkoutDetail } from "@/lib/workoutActions";
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

export function WorkoutDetailSheet({ activityId, onClose }: { activityId: number; onClose: () => void }) {
  const [detail, setDetail] = useState<WorkoutDetail | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    getWorkoutDetailAction(activityId).then((result) => {
      if (!cancelled) setDetail(result);
    });
    return () => {
      cancelled = true;
    };
  }, [activityId]);

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
          </>
        )}

        <button type="button" onClick={onClose} className="mt-3 w-full text-center text-xs text-neutral-500">
          Close
        </button>
      </div>
    </div>
  );
}
