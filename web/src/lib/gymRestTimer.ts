// Pure rest-timer preset logic, extracted from RestTimer.tsx so the
// preset-cycling rule can be unit-tested without touching React state,
// setInterval, or the DOM. See gymRestTimer.test.ts.
//
// Persistence mirrors useWeightUnit.ts's localStorage pattern: a single
// string key, read with a safe SSR-friendly fallback, written on every
// change.

export const REST_TIMER_PRESETS_SECONDS = [60, 90, 120, 180] as const;

const DEFAULT_REST_SECONDS: number = REST_TIMER_PRESETS_SECONDS[1]; // 90s

const STORAGE_KEY = "gym-rest-timer-seconds";

// Cycles to the next preset after `current`, wrapping around. If `current`
// isn't one of the known presets (e.g. a stale/corrupt localStorage value),
// resets to the first preset rather than erroring.
export function nextRestTimerPreset(current: number): number {
  const index = REST_TIMER_PRESETS_SECONDS.indexOf(current as (typeof REST_TIMER_PRESETS_SECONDS)[number]);
  if (index === -1) return REST_TIMER_PRESETS_SECONDS[0];
  return REST_TIMER_PRESETS_SECONDS[(index + 1) % REST_TIMER_PRESETS_SECONDS.length];
}

export function readStoredRestSeconds(): number {
  if (typeof window === "undefined") return DEFAULT_REST_SECONDS;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  const parsed = raw != null ? Number(raw) : NaN;
  return REST_TIMER_PRESETS_SECONDS.includes(parsed as (typeof REST_TIMER_PRESETS_SECONDS)[number])
    ? parsed
    : DEFAULT_REST_SECONDS;
}

export function storeRestSeconds(seconds: number): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, String(seconds));
}
