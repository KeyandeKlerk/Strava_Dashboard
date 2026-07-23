// A custom exercise is cached under a negative placeholder id until its
// create_exercise mutation syncs, at which point queue.ts deletes the
// placeholder row and reassigns any already-logged sets to the real id (see
// queue.ts's "create_exercise" case). Components that hold a selected
// exercise across that transition must key off client_uuid, not id — id can
// change (and the placeholder row can disappear) underneath a held
// reference, but client_uuid never does. Library exercises have no
// client_uuid and a stable id, so they key off the id instead.
import type { CachedExercise } from "./db";

export function keyFor(exercise: CachedExercise): string {
  return exercise.client_uuid ?? String(exercise.id);
}

export function resolveByKey(exercises: CachedExercise[], key: string | null): CachedExercise | null {
  if (!key) return null;
  return exercises.find((e) => keyFor(e) === key) ?? null;
}
