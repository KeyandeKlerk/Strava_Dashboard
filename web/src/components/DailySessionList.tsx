import { INTENSITY_LABEL, SESSION_ICON } from "@/lib/shared";
import type { DailyPlanRow } from "@/lib/metrics";

function statusIcon(row: DailyPlanRow, today: string): string {
  if (row.completed) return "✅";
  return row.planned_date >= today ? "⏳" : "❌";
}

export function DailySessionList({ daily, today }: { daily: DailyPlanRow[]; today: string }) {
  if (daily.length === 0) {
    return <p className="text-sm text-neutral-500">No sessions loaded for this week.</p>;
  }

  return (
    <ul className="space-y-2">
      {daily.map((row) => {
        const icon = SESSION_ICON[row.session_type] ?? "⬜";
        const effort = INTENSITY_LABEL[row.intensity] ?? row.intensity;
        const dayName = row.day_of_week.slice(0, 3);
        const dateLabel = new Date(`${row.planned_date}T00:00:00`).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        });
        return (
          <li
            key={`${row.planned_date}-${row.session_type}`}
            className="rounded-lg border border-neutral-200 px-3 py-2 dark:border-neutral-800"
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
  );
}
