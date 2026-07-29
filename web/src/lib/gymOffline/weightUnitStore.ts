// Module-level shared store (read via useSyncExternalStore in useWeightUnit)
// so every mounted useWeightUnit() instance reflects the same value — e.g.
// the persistent header's WeightUnitToggle and an active session's
// SetEntryForm are mounted at the same time under gym/layout.tsx, and a
// plain per-instance useState left the second stale until it unmounted.
export type WeightUnit = "kg" | "lb";

const STORAGE_KEY = "gym-weight-unit";

function readStoredUnit(): WeightUnit {
  if (typeof window === "undefined") return "kg";
  return window.localStorage.getItem(STORAGE_KEY) === "lb" ? "lb" : "kg";
}

let currentUnit: WeightUnit | null = null;
const listeners = new Set<() => void>();

export function getUnit(): WeightUnit {
  if (currentUnit === null) currentUnit = readStoredUnit();
  return currentUnit;
}

export function setUnit(next: WeightUnit): void {
  currentUnit = next;
  if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, next);
  listeners.forEach((listener) => listener());
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Test-only: clears the in-memory cache and subscribers between test cases.
export function resetWeightUnitStoreForTests(): void {
  currentUnit = null;
  listeners.clear();
}
