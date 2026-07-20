"use client";
import { useState } from "react";
import { INTENSITY_LABEL, SESSION_ICON, weekDates } from "@/lib/shared";
import { EditSessionSheet } from "@/components/EditSessionSheet";
import { WorkoutDetailSheet } from "@/components/WorkoutDetailSheet";
import type { DailyPlanRow } from "@/lib/metrics";

function statusIcon(row: DailyPlanRow, today: string): string {
  if (row.completed) return "✅";
  return row.planned_date >= today ? "⏳" : "❌";
}

// A session is "resolved" once there's nothing left to do about it — either
// it's done, or its day has passed without it happening. Resolved sessions
// sink below whatever's still upcoming this week, so the list leads with
// what actually needs attention.
function isResolved(row: DailyPlanRow, today: string): boolean {
  return row.completed || row.planned_date < today;
}

export function DailySessionList({
  daily,
  today,
  weekStartDate,
  weekNumber,
}: {
  daily: DailyPlanRow[];
  today: string;
  weekStartDate: string;
  weekNumber: number;
}) {
  const [editing, setEditing] = useState<DailyPlanRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [viewingActivityId, setViewingActivityId] = useState<number | null>(null);
  const dates = weekDates(weekStartDate);
  const ordered = [...daily].sort((a, b) => Number(isResolved(a, today)) - Number(isResolved(b, today)));

  return (
    <>
      {daily.length === 0 ? (
        <p className="text-sm text-neutral-500">No sessions loaded for this week.</p>
      ) : (
        <ul className="space-y-2">
          {ordered.map((row) => {
            const icon = SESSION_ICON[row.session_type] ?? "⬜";
            const effort = INTENSITY_LABEL[row.intensity] ?? row.intensity;
            const dayName = row.day_of_week.slice(0, 3);
            const dateLabel = new Date(`${row.planned_date}T00:00:00`).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            });
            const editable = !row.completed;
            const viewable = row.completed && row.completed_activity_id != null;
            const onRowClick = editable
              ? () => setEditing(row)
              : viewable
                ? () => setViewingActivityId(row.completed_activity_id!)
                : undefined;
            return (
              <li
                key={row.id}
                onClick={onRowClick}
                className={`rounded-lg border border-neutral-200 px-3 py-2 dark:border-neutral-800 ${
                  onRowClick ? "cursor-pointer" : ""
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-baseline gap-2">
                    <span aria-hidden="true">{statusIcon(row, today)}</span>
                    <span className="text-sm font-medium">
                      {dayName} {dateLabel}
                    </span>
                  </div>
                  <div className="text-right text-sm">
                    <div>{row.planned_km && row.planned_km > 0 ? `${row.planned_km} km` : "—"}</div>
                    {row.actual_km != null && (
                      <div className="text-neutral-500">{row.actual_km} km actual</div>
                    )}
                  </div>
                </div>
                <div className="mt-1 text-sm">
                  {icon} {row.session_type.replace(/_/g, " ")}{" "}
                  <span className="text-neutral-500">· {effort}</span>
                </div>
                {row.description && (
                  <p className="mt-1 text-sm text-neutral-500">{row.description}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <button
        type="button"
        onClick={() => setAdding(true)}
        className="mt-2 w-full rounded-md border border-dashed border-neutral-300 px-3 py-2 text-sm text-neutral-500 dark:border-neutral-700"
      >
        + Add workout
      </button>

      {editing && (
        <EditSessionSheet
          mode="edit"
          session={editing}
          daily={daily}
          weekDates={dates}
          onClose={() => setEditing(null)}
        />
      )}
      {adding && (
        <EditSessionSheet
          mode="create"
          weekNumber={weekNumber}
          daily={daily}
          weekDates={dates}
          onClose={() => setAdding(false)}
        />
      )}
      {viewingActivityId != null && (
        <WorkoutDetailSheet activityId={viewingActivityId} onClose={() => setViewingActivityId(null)} />
      )}
    </>
  );
}
