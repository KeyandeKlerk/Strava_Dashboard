"use client";
import { useMemo, useState } from "react";
import { useGymOffline } from "@/lib/gymOffline/context";
import { MUSCLE_GROUPS } from "@/lib/db/gymExerciseSeed";
import type { CachedExercise } from "@/lib/gymOffline/db";

const FIELD_CLASS =
  "w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900";

export function ExercisePicker({ onSelect }: { onSelect: (exercise: CachedExercise) => void }) {
  const { exercises, addCustomExercise } = useGymOffline();
  const [search, setSearch] = useState("");
  const [showCustomForm, setShowCustomForm] = useState(false);

  const grouped = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = query ? exercises.filter((e) => e.name.toLowerCase().includes(query)) : exercises;
    const byGroup = new Map<string, CachedExercise[]>();
    for (const exercise of filtered) {
      const list = byGroup.get(exercise.muscle_group) ?? [];
      list.push(exercise);
      byGroup.set(exercise.muscle_group, list);
    }
    return byGroup;
  }, [exercises, search]);

  async function handleCreateCustom(formData: FormData) {
    const name = String(formData.get("name") ?? "").trim();
    const muscleGroup = String(formData.get("muscle_group") ?? "");
    if (!name || !muscleGroup) return;
    const exercise = await addCustomExercise({ name, muscleGroup });
    setShowCustomForm(false);
    setSearch("");
    onSelect(exercise);
  }

  return (
    <div>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search exercises..."
        className={FIELD_CLASS}
      />

      <div className="mt-2 max-h-64 overflow-y-auto rounded-md border border-neutral-200 dark:border-neutral-800">
        {[...grouped.entries()].map(([muscleGroup, list]) => (
          <div key={muscleGroup}>
            <p className="bg-neutral-50 px-3 py-1 text-xs font-medium text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
              {muscleGroup}
            </p>
            {list.map((exercise) => (
              <button
                key={exercise.id}
                type="button"
                onClick={() => onSelect(exercise)}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-neutral-50 dark:hover:bg-neutral-900"
              >
                {exercise.name}
                {exercise.id < 0 && <span className="ml-1 text-xs text-neutral-400">(syncing...)</span>}
              </button>
            ))}
          </div>
        ))}
        {grouped.size === 0 && <p className="px-3 py-2 text-sm text-neutral-500">No matches.</p>}
      </div>

      {!showCustomForm ? (
        <button
          type="button"
          onClick={() => setShowCustomForm(true)}
          className="mt-2 text-xs text-neutral-500 underline"
        >
          + Add a custom exercise
        </button>
      ) : (
        <form action={handleCreateCustom} className="mt-2 space-y-2">
          <input name="name" placeholder="Exercise name" required className={FIELD_CLASS} />
          <select name="muscle_group" required className={FIELD_CLASS}>
            {MUSCLE_GROUPS.map((group) => (
              <option key={group} value={group}>
                {group}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <button
              type="submit"
              className="flex-1 rounded-md bg-neutral-900 px-3 py-2 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => setShowCustomForm(false)}
              className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
