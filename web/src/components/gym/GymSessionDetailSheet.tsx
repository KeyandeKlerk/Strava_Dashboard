"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  addCustomExerciseAction,
  deleteGymSessionAction,
  deleteGymSetAction,
  getGymSessionDetailAction,
  listGymExercisesAction,
  logGymSetAction,
} from "@/lib/gymActions";
import { useWeightUnit } from "@/lib/gymOffline/useWeightUnit";
import { MUSCLE_GROUPS } from "@/lib/db/gymExerciseSeed";
import type { GymExerciseRow, GymSessionDetail } from "@/lib/db/gymMutations";

const FIELD_CLASS =
  "w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900";

// Viewing/editing a session's history — reached from WorkoutDetailSheet (an
// activity-linked session) or the /gym history list (a standalone one).
// Not offline-capable on purpose: this is a backfill/edit flow, not the
// live-at-the-gym logging path (see web/src/lib/gymOffline/ for that one).
export function GymSessionDetailSheet({
  sessionId,
  onClose,
}: {
  sessionId: number;
  onClose: (deletedSessionId?: number) => void;
}) {
  const [detail, setDetail] = useState<GymSessionDetail | null | undefined>(undefined);
  const [exercises, setExercises] = useState<GymExerciseRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isPending, startTransition] = useTransition();
  const { unit, toDisplay, toKg } = useWeightUnit();
  const confirmTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (confirmTimeout.current) clearTimeout(confirmTimeout.current);
    };
  }, []);

  function reload() {
    getGymSessionDetailAction(sessionId).then(setDetail);
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([getGymSessionDetailAction(sessionId), listGymExercisesAction()]).then(([sessionDetail, exerciseList]) => {
      if (cancelled) return;
      setDetail(sessionDetail);
      setExercises(exerciseList);
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  function handleLogSet(formData: FormData) {
    setError(null);
    const weightDisplay = Number(formData.get("weight_kg"));
    formData.set("weight_kg", String(toKg(weightDisplay)));
    startTransition(async () => {
      const result = await logGymSetAction(sessionId, formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      reload();
    });
  }

  function handleDeleteSet(clientUuid: string) {
    startTransition(async () => {
      await deleteGymSetAction(clientUuid);
      reload();
    });
  }

  function handleDeleteSession() {
    if (!detail) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      confirmTimeout.current = setTimeout(() => setConfirmingDelete(false), 4000);
      return;
    }
    if (confirmTimeout.current) clearTimeout(confirmTimeout.current);
    const deletedId = detail.id;
    startTransition(async () => {
      await deleteGymSessionAction(detail.client_uuid);
      onClose(deletedId);
    });
  }

  function handleAddCustomExercise(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await addCustomExerciseAction(formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      const exerciseList = await listGymExercisesAction();
      setExercises(exerciseList);
      setShowCustomForm(false);
    });
  }

  const totalVolumeKg = detail?.sets.reduce((sum, s) => sum + s.weight_kg * s.reps, 0) ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => onClose()}>
      <div
        className="w-full max-w-3xl rounded-t-xl bg-white p-4 dark:bg-neutral-950"
        onClick={(e) => e.stopPropagation()}
      >
        {detail === undefined && <p className="text-sm text-neutral-500">Loading...</p>}
        {detail === null && <p className="text-sm text-neutral-500">Couldn&apos;t find that session.</p>}
        {detail && (
          <>
            <h3 className="text-sm font-medium">Gym session — {detail.session_date}</h3>
            <p className="text-xs text-neutral-500">
              {detail.sets.length} sets · {Math.round(totalVolumeKg)} kg total volume
            </p>

            {detail.sets.length === 0 ? (
              <p className="mt-3 text-sm text-neutral-500">No sets logged yet.</p>
            ) : (
              <div className="mt-3 space-y-3">
                {[...new Map(detail.sets.map((s) => [s.exercise_id, s.exercise_name])).entries()].map(
                  ([exerciseId, exerciseName]) => (
                    <div key={exerciseId}>
                      <p className="text-xs font-medium text-neutral-500">{exerciseName}</p>
                      {detail.sets
                        .filter((s) => s.exercise_id === exerciseId)
                        .sort((a, b) => a.set_number - b.set_number)
                        .map((s) => (
                          <div
                            key={s.id}
                            className={`mt-1 flex items-center justify-between text-sm ${s.is_warmup ? "italic text-neutral-400 dark:text-neutral-500" : ""}`}
                          >
                            <span>
                              Set {s.set_number}: {toDisplay(s.weight_kg).toFixed(1)}
                              {unit} x {s.reps}
                              {s.rpe != null && ` @RPE ${s.rpe}`}
                              {s.is_warmup && (
                                <span className="ml-2 rounded bg-neutral-200 px-1 py-0.5 text-[10px] font-medium not-italic text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                                  W
                                </span>
                              )}
                            </span>
                            <button
                              type="button"
                              disabled={isPending}
                              onClick={() => handleDeleteSet(s.client_uuid)}
                              className="text-xs text-red-600"
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                    </div>
                  ),
                )}
              </div>
            )}

            <details className="mt-4">
              <summary className="cursor-pointer text-xs font-medium text-neutral-500">Log a set</summary>
              <form action={handleLogSet} className="mt-2 space-y-2">
                <select name="exercise_id" required className={FIELD_CLASS}>
                  {exercises.map((exercise) => (
                    <option key={exercise.id} value={exercise.id}>
                      {exercise.muscle_group} — {exercise.name}
                    </option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <input
                    name="weight_kg"
                    type="number"
                    step="0.5"
                    min="0"
                    placeholder={`Weight (${unit})`}
                    required
                    className={FIELD_CLASS}
                  />
                  <input name="reps" type="number" step="1" min="1" placeholder="Reps" required className={FIELD_CLASS} />
                </div>
                <button
                  type="submit"
                  disabled={isPending}
                  className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900"
                >
                  Save
                </button>
              </form>

              {!showCustomForm ? (
                <button type="button" onClick={() => setShowCustomForm(true)} className="mt-2 text-xs text-neutral-500 underline">
                  + Add a custom exercise
                </button>
              ) : (
                <form action={handleAddCustomExercise} className="mt-2 space-y-2">
                  <input name="name" placeholder="Exercise name" required className={FIELD_CLASS} />
                  <select name="muscle_group" required className={FIELD_CLASS}>
                    {MUSCLE_GROUPS.map((group) => (
                      <option key={group} value={group}>
                        {group}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    disabled={isPending}
                    className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700"
                  >
                    Add exercise
                  </button>
                </form>
              )}

              {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
            </details>
          </>
        )}

        <button type="button" onClick={() => onClose()} className="mt-3 w-full text-center text-xs text-neutral-500">
          Close
        </button>

        {detail && (
          <button
            type="button"
            disabled={isPending}
            onClick={handleDeleteSession}
            className="mt-2 w-full rounded-md border border-red-300 px-3 py-2 text-center text-xs text-red-600 dark:border-red-900"
          >
            {confirmingDelete ? "Tap again to confirm" : "Delete session"}
          </button>
        )}
      </div>
    </div>
  );
}
