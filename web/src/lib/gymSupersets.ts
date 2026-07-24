// Pure superset-grouping logic, extracted from PlanBuilder/SessionExerciseQueue
// so the two load-bearing behaviours — the plan-side group cleanup pass and the
// live-session round-robin advance — can be unit-tested in isolation, away from
// component state. See gymSupersets.test.ts.
//
// A superset group is just a shared opaque integer (superset_group / supersetGroup)
// tagged onto 2+ plan entries. The contiguity/round-robin rules live here.

// ---------------------------------------------------------------------------
// Plan-side (PlanBuilder)
// ---------------------------------------------------------------------------

// Central cleanup pass: re-scan the day's exercises and null out any
// superset_group left with fewer than 2 members. A "group of one" is a stale
// artefact (e.g. after removing one member of a 2-exercise group, or after
// re-grouping a subset out of an existing group) and would otherwise persist a
// meaningless group tag. Call this after every group-mutating operation, right
// before persist.
export function normalizeGroups<T extends { superset_group: number | null }>(rows: T[]): T[] {
  const counts = new Map<number, number>();
  for (const row of rows) {
    if (row.superset_group != null) {
      counts.set(row.superset_group, (counts.get(row.superset_group) ?? 0) + 1);
    }
  }
  return rows.map((row) =>
    row.superset_group != null && (counts.get(row.superset_group) ?? 0) < 2
      ? { ...row, superset_group: null }
      : row,
  );
}

// A collapsed-group view of a day's plan: a solo exercise, or a group of 2+
// members rendered as one reorderable unit. Reordering these ITEMS (not the raw
// exercises) is what makes group-vs-group and group-vs-solo moves correct by
// construction — a group can never be split by a move, because it moves as one
// item. See the "block-move bug" note in the task brief.
export type PlanItem<T> =
  | { type: "solo"; exercise: T }
  | { type: "group"; groupId: number; members: T[] };

export function buildPlanItems<T extends { superset_group: number | null }>(rows: T[]): PlanItem<T>[] {
  const items: PlanItem<T>[] = [];
  const groupItemIndex = new Map<number, number>();
  for (const row of rows) {
    const group = row.superset_group;
    if (group == null) {
      items.push({ type: "solo", exercise: row });
      continue;
    }
    const existing = groupItemIndex.get(group);
    if (existing != null) {
      (items[existing] as { members: T[] }).members.push(row);
    } else {
      groupItemIndex.set(group, items.length);
      items.push({ type: "group", groupId: group, members: [row] });
    }
  }
  return items;
}

// Flatten items back to a raw ordered exercise list to persist. Because a group
// item holds all its members, they always emit contiguously — this is also what
// keeps the contiguity invariant intact after an item move.
export function flattenPlanItems<T>(items: PlanItem<T>[]): T[] {
  return items.flatMap((item) => (item.type === "solo" ? [item.exercise] : item.members));
}

// "Group selected" is only valid when 2+ selected exercises are already
// adjacent in the day's current order — grouping never silently reorders.
export function isContiguousSelection(orderedIds: number[], selectedIds: Set<number>): boolean {
  if (selectedIds.size < 2) return false;
  const positions: number[] = [];
  orderedIds.forEach((id, index) => {
    if (selectedIds.has(id)) positions.push(index);
  });
  // Every selected id must be present in this day and form one unbroken run.
  if (positions.length !== selectedIds.size) return false;
  return positions[positions.length - 1] - positions[0] === positions.length - 1;
}

// ---------------------------------------------------------------------------
// Live-session side (SessionExerciseQueue)
// ---------------------------------------------------------------------------

// Round-robin advance within a superset. If the current entry belongs to a
// group, return the NEXT member's key cyclically (order-preserving filter, not
// position-adjacency — correct wherever the members sit in the queue), always
// advancing regardless of whether the next member already has sets logged.
// Returns null when the current entry has no group (caller falls back to its
// "first not-yet-logged" behaviour).
export function nextSupersetKey(
  entries: { key: string; supersetGroup: number | null }[],
  currentKey: string | null,
): string | null {
  const current = entries.find((e) => e.key === currentKey);
  if (!current || current.supersetGroup == null) return null;
  const members = entries.filter((e) => e.supersetGroup === current.supersetGroup);
  const currentIndex = members.findIndex((m) => m.key === currentKey);
  if (currentIndex === -1) return null;
  return members[(currentIndex + 1) % members.length].key;
}
