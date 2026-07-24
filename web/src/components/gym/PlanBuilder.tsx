"use client";
import { useState, type ReactNode } from "react";
import { addCustomExerciseAction, setPlanForDayAction } from "@/lib/gymActions";
import { MUSCLE_GROUPS } from "@/lib/db/gymExerciseSeed";
import {
  buildPlanItems,
  flattenPlanItems,
  isContiguousSelection,
  normalizeGroups,
} from "@/lib/gymSupersets";
import type { GymExerciseRow, PlanExerciseRow } from "@/lib/db/gymMutations";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

const FIELD_CLASS =
  "w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900";

// Deliberately separate from ExercisePicker (web/src/components/gym/ExercisePicker.tsx):
// that component is coupled to the offline GymOfflineProvider/CachedExercise cache, while
// this one works directly off server-action data (GymExerciseRow) since plan editing is
// online-only. The search/group-filter logic is small enough that duplicating it here is
// simpler than forcing a shared abstraction over two different data sources.
function PlanExercisePicker({
  allExercises,
  onSelect,
  onCancel,
}: {
  allExercises: GymExerciseRow[];
  onSelect: (exercise: GymExerciseRow) => void;
  onCancel: () => void;
}) {
  const [search, setSearch] = useState("");
  const [showCustomForm, setShowCustomForm] = useState(false);

  const query = search.trim().toLowerCase();
  const filtered = query ? allExercises.filter((e) => e.name.toLowerCase().includes(query)) : allExercises;
  const byGroup = new Map<string, GymExerciseRow[]>();
  for (const exercise of filtered) {
    const list = byGroup.get(exercise.muscle_group) ?? [];
    list.push(exercise);
    byGroup.set(exercise.muscle_group, list);
  }

  async function handleCreateCustom(formData: FormData) {
    const result = await addCustomExerciseAction(formData);
    if (result.exercise) onSelect(result.exercise);
  }

  return (
    <div className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search exercises..."
        className={FIELD_CLASS}
      />
      <div className="mt-2 max-h-64 overflow-y-auto rounded-md border border-neutral-200 dark:border-neutral-800">
        {[...byGroup.entries()].map(([muscleGroup, list]) => (
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
              </button>
            ))}
          </div>
        ))}
        {byGroup.size === 0 && <p className="px-3 py-2 text-sm text-neutral-500">No matches.</p>}
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
          <button
            type="submit"
            className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm text-white dark:bg-neutral-100 dark:text-neutral-900"
          >
            Add
          </button>
        </form>
      )}

      <button type="button" onClick={onCancel} className="mt-2 text-xs text-neutral-500">
        Cancel
      </button>
    </div>
  );
}

export function PlanBuilder({
  initialPlan,
  allExercises,
}: {
  initialPlan: Record<string, PlanExerciseRow[]>;
  allExercises: GymExerciseRow[];
}) {
  const [plan, setPlan] = useState(initialPlan);
  const [exerciseLibrary, setExerciseLibrary] = useState(allExercises);
  const [selectedDay, setSelectedDay] = useState<(typeof WEEKDAYS)[number]>("Monday");
  const [showPicker, setShowPicker] = useState(false);
  // Exercise ids checked for "Group selected" (by gym_exercises id, unique per
  // day). Cleared on day switch and after any grouping change.
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const dayExercises = plan[selectedDay] ?? [];
  const items = buildPlanItems(dayExercises);
  const canGroup = isContiguousSelection(
    dayExercises.map((e) => e.id),
    selectedIds,
  );

  async function persist(day: string, dayExercises: PlanExerciseRow[]) {
    setPlan((prev) => ({ ...prev, [day]: dayExercises }));
    await setPlanForDayAction(
      day,
      dayExercises.map((e) => ({
        exerciseId: e.id,
        targetSets: e.target_sets,
        targetReps: e.target_reps,
        supersetGroup: e.superset_group,
      })),
    );
  }

  // Reorder ITEMS (solos + collapsed groups), not raw exercises. The same
  // one-line swap that plain exercises used works here because a group moves as
  // a single item — two groups can never interleave and no adjacency detection
  // is needed (see the "block-move bug" note in the task brief).
  function moveItem(itemIndex: number, direction: -1 | 1) {
    const next = [...items];
    const target = itemIndex + direction;
    if (target < 0 || target >= next.length) return;
    [next[itemIndex], next[target]] = [next[target], next[itemIndex]];
    persist(selectedDay, flattenPlanItems(next));
  }

  function removeExercise(index: number) {
    persist(selectedDay, normalizeGroups(dayExercises.filter((_, i) => i !== index)));
  }

  // Tag the (already-contiguous) selected exercises with a fresh opaque group
  // id. Date.now() is fine — the group id is opaque and the whole day list is
  // replaced wholesale on every persist, so there's no max to scan for.
  function groupSelected() {
    if (!canGroup) return;
    const groupId = Date.now();
    const next = normalizeGroups(
      dayExercises.map((e) => (selectedIds.has(e.id) ? { ...e, superset_group: groupId } : e)),
    );
    setSelectedIds(new Set());
    persist(selectedDay, next);
  }

  function ungroupGroup(groupId: number) {
    const next = normalizeGroups(
      dayExercises.map((e) => (e.superset_group === groupId ? { ...e, superset_group: null } : e)),
    );
    persist(selectedDay, next);
  }

  function toggleSelected(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Update one row's target field locally (optimistic, no round-trip on every
  // keystroke); the actual whole-list persist fires on blur (see the inputs'
  // onBlur below). Blank input = null = "no target set".
  function setTarget(index: number, field: "target_sets" | "target_reps", raw: string) {
    const trimmed = raw.trim();
    const parsed = trimmed === "" ? null : Math.trunc(Number(trimmed));
    const value = parsed === null || !Number.isFinite(parsed) || parsed <= 0 ? null : parsed;
    setPlan((prev) => {
      const list = (prev[selectedDay] ?? []).map((e, i) => (i === index ? { ...e, [field]: value } : e));
      return { ...prev, [selectedDay]: list };
    });
  }

  function addExercise(exercise: GymExerciseRow) {
    if (!exerciseLibrary.some((e) => e.id === exercise.id)) {
      setExerciseLibrary((prev) => [...prev, exercise]);
    }
    setShowPicker(false);
    if (dayExercises.some((e) => e.id === exercise.id)) return;
    // A newly-added exercise starts with no targets/grouping (all null) — the
    // "just an ordered list" default, matching pre-target behaviour.
    const planRow: PlanExerciseRow = { ...exercise, target_sets: null, target_reps: null, superset_group: null };
    persist(selectedDay, [...dayExercises, planRow]);
  }

  // One exercise's editable row: select checkbox, name, optional extra controls
  // (↑/↓ for a solo item — group members have none), Remove, and target inputs.
  // Shared by both solo cards and group member sub-rows. `index` is the row's
  // position in the flat dayExercises list (what removeExercise/setTarget take).
  function renderMemberRow(exercise: PlanExerciseRow, index: number, extraControls?: ReactNode) {
    return (
      <>
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={selectedIds.has(exercise.id)}
              onChange={() => toggleSelected(exercise.id)}
              className="accent-neutral-900 dark:accent-neutral-100"
            />
            <span>
              {index + 1}. {exercise.name}
            </span>
          </label>
          <div className="flex items-center gap-3 text-xs text-neutral-500">
            {extraControls}
            <button type="button" onClick={() => removeExercise(index)} className="text-red-600">
              Remove
            </button>
          </div>
        </div>
        <div className="mt-2 flex items-center gap-2 text-xs text-neutral-500">
          <label className="flex items-center gap-1">
            Sets
            <input
              type="number"
              inputMode="numeric"
              min="1"
              step="1"
              value={exercise.target_sets ?? ""}
              onChange={(e) => setTarget(index, "target_sets", e.target.value)}
              onBlur={() => persist(selectedDay, dayExercises)}
              placeholder="–"
              className="w-14 rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            />
          </label>
          <label className="flex items-center gap-1">
            Reps
            <input
              type="number"
              inputMode="numeric"
              min="1"
              step="1"
              value={exercise.target_reps ?? ""}
              onChange={(e) => setTarget(index, "target_reps", e.target.value)}
              onBlur={() => persist(selectedDay, dayExercises)}
              placeholder="–"
              className="w-14 rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            />
          </label>
        </div>
      </>
    );
  }

  return (
    <div>
      <div className="flex gap-1.5 overflow-x-auto pb-1.5">
        {WEEKDAYS.map((day) => {
          const count = plan[day]?.length ?? 0;
          const active = day === selectedDay;
          return (
            <button
              key={day}
              type="button"
              onClick={() => {
                setSelectedDay(day);
                setShowPicker(false);
                setSelectedIds(new Set());
              }}
              className={`flex-none whitespace-nowrap rounded-full px-3 py-1.5 text-xs transition-colors ${
                active
                  ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                  : "bg-neutral-100 text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400"
              }`}
            >
              {day.slice(0, 3)}
              {count > 0 ? ` · ${count}` : ""}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-neutral-500">
          {selectedDay} —{" "}
          {dayExercises.length === 0
            ? "rest day"
            : `${dayExercises.length} exercise${dayExercises.length === 1 ? "" : "s"}`}
        </p>
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2 text-xs">
            <button
              type="button"
              onClick={groupSelected}
              disabled={!canGroup}
              className="rounded-md bg-violet-600 px-2 py-1 text-white disabled:opacity-40 dark:bg-violet-500"
              title={canGroup ? undefined : "Select 2+ adjacent exercises to group"}
            >
              Group selected ({selectedIds.size})
            </button>
            <button type="button" onClick={() => setSelectedIds(new Set())} className="text-neutral-500">
              Clear
            </button>
          </div>
        )}
      </div>

      <div className="mt-2 space-y-2">
        {items.map((item, itemIndex) => {
          const moveControls = (
            <>
              <button type="button" onClick={() => moveItem(itemIndex, -1)} disabled={itemIndex === 0}>
                ↑
              </button>
              <button type="button" onClick={() => moveItem(itemIndex, 1)} disabled={itemIndex === items.length - 1}>
                ↓
              </button>
            </>
          );

          if (item.type === "solo") {
            const index = dayExercises.findIndex((e) => e.id === item.exercise.id);
            return (
              <div
                key={`solo-${item.exercise.id}`}
                className="rounded-xl border border-neutral-200 p-3 text-sm dark:border-neutral-800"
              >
                {renderMemberRow(item.exercise, index, moveControls)}
              </div>
            );
          }

          return (
            <div
              key={`group-${item.groupId}`}
              className="rounded-xl border border-violet-300 bg-violet-50/50 p-3 text-sm dark:border-violet-900 dark:bg-violet-950/20"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-medium uppercase tracking-wide text-violet-600 dark:text-violet-400">
                  Superset
                </span>
                <div className="flex items-center gap-3 text-xs text-neutral-500">
                  {moveControls}
                  <button
                    type="button"
                    onClick={() => ungroupGroup(item.groupId)}
                    className="text-violet-600 dark:text-violet-400"
                  >
                    Ungroup
                  </button>
                </div>
              </div>
              <div className="mt-2 space-y-2">
                {item.members.map((member) => {
                  const index = dayExercises.findIndex((e) => e.id === member.id);
                  return (
                    <div
                      key={member.id}
                      className="rounded-lg border border-violet-200 bg-white p-2 dark:border-violet-900/60 dark:bg-neutral-950"
                    >
                      {renderMemberRow(member, index)}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {showPicker ? (
        <div className="mt-2">
          <PlanExercisePicker allExercises={exerciseLibrary} onSelect={addExercise} onCancel={() => setShowPicker(false)} />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowPicker(true)}
          className="mt-2 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700"
        >
          + Add exercise to {selectedDay}
        </button>
      )}
    </div>
  );
}
