"use client";
import { useState, useTransition } from "react";
import { addDailySessionAction, deleteDailySessionAction, moveDailySessionAction } from "@/lib/planActions";
import { INTENSITY_LABEL, SESSION_ICON, type WeekDate } from "@/lib/shared";
import type { DailyPlanRow } from "@/lib/metrics";

const SESSION_TYPES = ["rest", "sc", "easy_run", "quality_run", "long_run", "hills", "cross_training", "cricket", "race"];
const INTENSITIES = ["easy", "moderate", "hard", "race", "rest"];

const FIELD_CLASS =
  "w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900";

type Props =
  | { mode: "edit"; session: DailyPlanRow; daily: DailyPlanRow[]; weekDates: WeekDate[]; onClose: () => void }
  | { mode: "create"; weekNumber: number; daily: DailyPlanRow[]; weekDates: WeekDate[]; onClose: () => void };

function targetDayState(
  daily: DailyPlanRow[],
  date: string,
  sessionType: string,
  ownId: number,
): { disabled: boolean; reason: string | null } {
  const sameType = daily.filter((d) => d.planned_date === date && d.session_type === sessionType && d.id !== ownId);
  if (sameType.length > 1) {
    return { disabled: true, reason: `Already has ${sameType.length} ${sessionType.replace(/_/g, " ")} sessions` };
  }
  if (sameType.length === 1 && sameType[0].completed) {
    return { disabled: true, reason: "Already completed" };
  }
  return { disabled: false, reason: null };
}

export function EditSessionSheet(props: Props) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleMove(toDate: string) {
    if (props.mode !== "edit") return;
    setError(null);
    startTransition(async () => {
      const result = await moveDailySessionAction(props.session.id, toDate);
      if (result.error) setError(result.error);
      else props.onClose();
    });
  }

  function handleRemove() {
    if (props.mode !== "edit") return;
    setError(null);
    startTransition(async () => {
      const result = await deleteDailySessionAction(props.session.id);
      if (result.error) setError(result.error);
      else props.onClose();
    });
  }

  function handleCreate(formData: FormData) {
    if (props.mode !== "create") return;
    setError(null);
    formData.set("week_number", String(props.weekNumber));
    startTransition(async () => {
      const result = await addDailySessionAction(formData);
      if (result.error) setError(result.error);
      else props.onClose();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={props.onClose}>
      <div
        className="w-full max-w-3xl rounded-t-xl bg-white p-4 dark:bg-neutral-950"
        onClick={(e) => e.stopPropagation()}
      >
        {props.mode === "edit" ? (
          <>
            <h3 className="text-sm font-medium">
              {SESSION_ICON[props.session.session_type] ?? "⬜"} {props.session.session_type.replace(/_/g, " ")}
            </h3>
            {props.session.description && (
              <p className="mt-1 text-sm text-neutral-500">{props.session.description}</p>
            )}

            <p className="mt-3 text-xs text-neutral-500">Move to</p>
            <div className="mt-1 grid grid-cols-4 gap-1.5">
              {props.weekDates.map((wd) => {
                const isOwnDay = wd.date === props.session.planned_date;
                const { disabled, reason } = isOwnDay
                  ? { disabled: true, reason: null }
                  : targetDayState(props.daily, wd.date, props.session.session_type, props.session.id);
                return (
                  <button
                    key={wd.date}
                    type="button"
                    disabled={disabled || isPending}
                    title={reason ?? undefined}
                    onClick={() => handleMove(wd.date)}
                    className="rounded-md border border-neutral-300 px-2 py-1.5 text-xs disabled:opacity-40 dark:border-neutral-700"
                  >
                    {wd.dayName.slice(0, 3)}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              disabled={isPending}
              onClick={handleRemove}
              className="mt-4 w-full rounded-md border border-red-300 px-3 py-2 text-sm text-red-600 dark:border-red-900"
            >
              Remove from plan
            </button>
          </>
        ) : (
          <form action={handleCreate} className="space-y-2">
            <h3 className="text-sm font-medium">Add workout</h3>
            <select name="planned_date" required className={FIELD_CLASS}>
              {props.weekDates.map((wd) => (
                <option key={wd.date} value={wd.date}>
                  {wd.dayName} ({wd.date})
                </option>
              ))}
            </select>
            <select name="session_type" required className={FIELD_CLASS}>
              {SESSION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, " ")}
                </option>
              ))}
            </select>
            <input name="planned_distance_km" type="number" step="0.1" min="0" placeholder="Distance (km)" className={FIELD_CLASS} />
            <select name="intensity" required className={FIELD_CLASS}>
              {INTENSITIES.map((i) => (
                <option key={i} value={i}>
                  {INTENSITY_LABEL[i]}
                </option>
              ))}
            </select>
            <input name="description" placeholder="Description" className={FIELD_CLASS} />
            <button
              type="submit"
              disabled={isPending}
              className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900"
            >
              Add
            </button>
          </form>
        )}

        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        <button type="button" onClick={props.onClose} className="mt-3 w-full text-center text-xs text-neutral-500">
          Cancel
        </button>
      </div>
    </div>
  );
}
