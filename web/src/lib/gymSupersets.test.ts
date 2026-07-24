import { describe, expect, it } from "vitest";
import {
  buildPlanItems,
  flattenPlanItems,
  isContiguousSelection,
  nextSupersetKey,
  normalizeGroups,
} from "./gymSupersets";

// Minimal row shape for the plan-side helpers (they only read superset_group /
// id), avoiding a full PlanExerciseRow.
function row(id: number, superset_group: number | null = null) {
  return { id, superset_group };
}

describe("normalizeGroups", () => {
  it("nulls out a group left with a single member", () => {
    const result = normalizeGroups([row(1, 100), row(2)]);
    expect(result.map((r) => r.superset_group)).toEqual([null, null]);
  });

  it("keeps a group with 2+ members intact", () => {
    const result = normalizeGroups([row(1, 100), row(2, 100), row(3)]);
    expect(result.map((r) => r.superset_group)).toEqual([100, 100, null]);
  });

  it("handles multiple groups independently", () => {
    // group 100 has 2 members (kept), group 200 has 1 (nulled)
    const result = normalizeGroups([row(1, 100), row(2, 100), row(3, 200), row(4)]);
    expect(result.map((r) => r.superset_group)).toEqual([100, 100, null, null]);
  });

  it("leaves an all-solo list unchanged", () => {
    const input = [row(1), row(2), row(3)];
    expect(normalizeGroups(input).map((r) => r.superset_group)).toEqual([null, null, null]);
  });
});

describe("buildPlanItems / flattenPlanItems", () => {
  it("collapses contiguous group members into a single group item", () => {
    const rows = [row(1, 100), row(2, 100), row(3)];
    const items = buildPlanItems(rows);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ type: "group", groupId: 100 });
    expect((items[0] as { members: unknown[] }).members).toHaveLength(2);
    expect(items[1]).toMatchObject({ type: "solo" });
  });

  it("round-trips through flatten without reordering solos", () => {
    const rows = [row(1), row(2, 100), row(3, 100), row(4)];
    expect(flattenPlanItems(buildPlanItems(rows))).toEqual(rows);
  });

  it("keeps two adjacent groups from interleaving when an item is moved", () => {
    // [A1(1), A2(1), B1(2), B2(2)] -> move group 1 (item 0) down past group 2
    const rows = [row(1, 1), row(2, 1), row(3, 2), row(4, 2)];
    const items = buildPlanItems(rows);
    [items[0], items[1]] = [items[1], items[0]];
    const flat = flattenPlanItems(items);
    // group 2's members stay contiguous, group 1's members stay contiguous —
    // no interleaving (the block-move bug the brief warns about).
    expect(flat.map((r) => [r.id, r.superset_group])).toEqual([
      [3, 2],
      [4, 2],
      [1, 1],
      [2, 1],
    ]);
  });
});

describe("isContiguousSelection", () => {
  const ordered = [1, 2, 3, 4];

  it("is false for fewer than 2 selected", () => {
    expect(isContiguousSelection(ordered, new Set([2]))).toBe(false);
    expect(isContiguousSelection(ordered, new Set())).toBe(false);
  });

  it("is true for an adjacent run", () => {
    expect(isContiguousSelection(ordered, new Set([2, 3]))).toBe(true);
    expect(isContiguousSelection(ordered, new Set([1, 2, 3]))).toBe(true);
  });

  it("is false for a non-adjacent selection", () => {
    expect(isContiguousSelection(ordered, new Set([1, 3]))).toBe(false);
    expect(isContiguousSelection(ordered, new Set([1, 4]))).toBe(false);
  });

  it("is false when a selected id is absent from this day", () => {
    expect(isContiguousSelection(ordered, new Set([3, 4, 99]))).toBe(false);
  });
});

describe("nextSupersetKey", () => {
  it("returns null when current has no group (caller falls back)", () => {
    const entries = [
      { key: "a", supersetGroup: null },
      { key: "b", supersetGroup: null },
    ];
    expect(nextSupersetKey(entries, "a")).toBeNull();
  });

  it("cycles a 3-member group A->B->C->A", () => {
    const entries = [
      { key: "a", supersetGroup: 1 },
      { key: "b", supersetGroup: 1 },
      { key: "c", supersetGroup: 1 },
    ];
    expect(nextSupersetKey(entries, "a")).toBe("b");
    expect(nextSupersetKey(entries, "b")).toBe("c");
    expect(nextSupersetKey(entries, "c")).toBe("a");
  });

  it("cycles a 2-member group A->B->A", () => {
    const entries = [
      { key: "a", supersetGroup: 7 },
      { key: "b", supersetGroup: 7 },
    ];
    expect(nextSupersetKey(entries, "a")).toBe("b");
    expect(nextSupersetKey(entries, "b")).toBe("a");
  });

  it("filters by group membership, not queue adjacency", () => {
    // group 1 members are interleaved with a solo entry in the queue order
    const entries = [
      { key: "a", supersetGroup: 1 },
      { key: "solo", supersetGroup: null },
      { key: "b", supersetGroup: 1 },
    ];
    expect(nextSupersetKey(entries, "a")).toBe("b");
    expect(nextSupersetKey(entries, "b")).toBe("a");
  });
});
