import { describe, expect, it } from "vitest";
import type { CachedExercise } from "./db";
import { keyFor, resolveByKey } from "./exerciseKey";

function makeExercise(overrides: Partial<CachedExercise> = {}): CachedExercise {
  return {
    id: 1,
    client_uuid: null,
    name: "Barbell Squat",
    muscle_group: "Quads",
    equipment: "barbell",
    is_custom: false,
    ...overrides,
  };
}

describe("keyFor", () => {
  it("uses client_uuid when present", () => {
    const exercise = makeExercise({ id: -123, client_uuid: "abc-uuid" });
    expect(keyFor(exercise)).toBe("abc-uuid");
  });

  it("falls back to the stringified id when client_uuid is null", () => {
    const exercise = makeExercise({ id: 42, client_uuid: null });
    expect(keyFor(exercise)).toBe("42");
  });
});

describe("resolveByKey", () => {
  it("returns null for a null key", () => {
    expect(resolveByKey([makeExercise()], null)).toBeNull();
  });

  it("resolves a custom exercise's key across an id reassignment", () => {
    // Reproduces the "Unknown exercise" bug scenario: a placeholder exercise
    // (negative id) gets its id reassigned to a real one once it syncs
    // (see queue.ts's create_exercise handling), but its client_uuid never
    // changes.
    const beforeSync = makeExercise({ id: -555, client_uuid: "custom-1", name: "My Exercise" });
    const key = keyFor(beforeSync);

    const afterSync = makeExercise({ id: 88, client_uuid: "custom-1", name: "My Exercise" });

    expect(resolveByKey([afterSync], key)).toEqual(afterSync);
  });

  it("returns null when the keyed exercise is no longer in the cache", () => {
    const exercise = makeExercise({ id: -1, client_uuid: "gone" });
    const key = keyFor(exercise);
    expect(resolveByKey([], key)).toBeNull();
  });
});
